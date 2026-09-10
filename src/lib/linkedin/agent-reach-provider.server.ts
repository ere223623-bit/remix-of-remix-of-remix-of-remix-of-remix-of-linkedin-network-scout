import {
  capabilityForType,
  normalizeCapabilities,
  normalizePerson,
  normalizeResults,
  pruneUnsupportedFilters,
} from "./normalize";
import {
  LinkedInProviderError,
  PROVIDER_ERRORS,
  type LinkedInProvider,
  type ProviderSearchArgs,
  type ProviderSearchResult,
} from "./provider";
import type {
  CompanyResult,
  JobResult,
  PersonResult,
  ProviderCapabilities,
  SearchType,
} from "./types";

export type AgentReachConfig = {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function readAgentReachConfig(
  env: Record<string, string | undefined> = process.env,
): AgentReachConfig {
  const baseUrl = env["LINKEDIN_SERVICE_URL"];
  const token = env["LINKEDIN_SERVICE_TOKEN"];
  if (!baseUrl || !token) {
    throw PROVIDER_ERRORS.configuration(
      "The LinkedIn search service is not configured yet. An administrator must set the service address and access token.",
    );
  }
  const timeout = Number(env["LINKEDIN_SERVICE_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MS);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Talks to the self-hosted Agent Reach sidecar over HTTPS. The sidecar owns the
 * LinkedIn browser session; no credential or cookie ever crosses this boundary.
 */
export class AgentReachLinkedInProvider implements LinkedInProvider {
  readonly id = "agent-reach";
  readonly label = "Agent Reach sidecar";
  private readonly config: AgentReachConfig;
  private readonly doFetch: typeof fetch;
  private capabilityCache: { value: ProviderCapabilities; at: number } | undefined;

  constructor(config: AgentReachConfig) {
    this.config = config;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await this.doFetch(`${this.config.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw PROVIDER_ERRORS.timeout();
      throw PROVIDER_ERRORS.unavailable("The LinkedIn search service could not be reached.");
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) throw PROVIDER_ERRORS.authRequired();
    if (response.status === 429) throw PROVIDER_ERRORS.rateLimited();
    if (response.status === 504 || response.status === 408) throw PROVIDER_ERRORS.timeout();

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw PROVIDER_ERRORS.invalidResponse();

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw PROVIDER_ERRORS.invalidResponse();
    }

    if (!response.ok) {
      throw mapServiceError(payload, response.status);
    }
    if (typeof payload !== "object" || payload === null) throw PROVIDER_ERRORS.invalidResponse();
    return payload;
  }

  async healthCheck(): Promise<ProviderCapabilities> {
    const payload = await this.request("/health");
    const capabilities = normalizeCapabilities(payload, new Date().toISOString());
    this.capabilityCache = { value: capabilities, at: Date.now() };
    return capabilities;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    if (this.capabilityCache && Date.now() - this.capabilityCache.at < 60_000) {
      return this.capabilityCache.value;
    }
    return this.healthCheck();
  }

  private async search(
    type: SearchType,
    args: ProviderSearchArgs,
  ): Promise<ProviderSearchResult<never>> {
    const capabilities = await this.getCapabilities();
    if (!capabilities.available) {
      throw capabilities.state === "AUTH_REQUIRED"
        ? PROVIDER_ERRORS.authRequired()
        : PROVIDER_ERRORS.unavailable(
            capabilities.message ?? "The LinkedIn backend is not available.",
          );
    }
    if (!capabilities.capabilities.includes(capabilityForType(type))) {
      throw PROVIDER_ERRORS.unsupported(type);
    }

    const filters = pruneUnsupportedFilters(args.filters, capabilities.supported_filters[type]);
    const payload = (await this.request("/search", {
      type,
      query: args.query,
      filters,
      limit: args.limit,
    })) as Record<string, unknown>;

    if (!Array.isArray(payload["results"])) throw PROVIDER_ERRORS.invalidResponse();
    const retrievedAt =
      typeof payload["retrieved_at"] === "string"
        ? (payload["retrieved_at"] as string)
        : new Date().toISOString();

    return {
      results: normalizeResults(type, payload["results"], retrievedAt) as never[],
      backend:
        typeof payload["backend"] === "string"
          ? (payload["backend"] as string)
          : capabilities.backend,
      retrieved_at: retrievedAt,
    };
  }

  searchPeople(args: ProviderSearchArgs): Promise<ProviderSearchResult<PersonResult>> {
    return this.search("people", args) as Promise<ProviderSearchResult<PersonResult>>;
  }

  searchCompanies(args: ProviderSearchArgs): Promise<ProviderSearchResult<CompanyResult>> {
    return this.search("companies", args) as Promise<ProviderSearchResult<CompanyResult>>;
  }

  searchJobs(args: ProviderSearchArgs): Promise<ProviderSearchResult<JobResult>> {
    return this.search("jobs", args) as Promise<ProviderSearchResult<JobResult>>;
  }

  async getProfile(profileUrl: string): Promise<PersonResult> {
    const capabilities = await this.getCapabilities();
    if (!capabilities.capabilities.includes("profile_detail")) {
      throw PROVIDER_ERRORS.unsupported("people");
    }
    const payload = (await this.request("/profile", { profile_url: profileUrl })) as Record<
      string,
      unknown
    >;
    const raw = payload["profile"];
    if (typeof raw !== "object" || raw === null) throw PROVIDER_ERRORS.invalidResponse();
    const retrievedAt =
      typeof payload["retrieved_at"] === "string"
        ? (payload["retrieved_at"] as string)
        : new Date().toISOString();
    return normalizePerson(raw as Record<string, unknown>, retrievedAt);
  }
}

function mapServiceError(payload: unknown, status: number): LinkedInProviderError {
  const code =
    typeof payload === "object" && payload !== null
      ? (payload as { error?: { code?: unknown }; code?: unknown }).error?.code ??
        (payload as { code?: unknown }).code
      : undefined;

  switch (code) {
    case "LINKEDIN_AUTH_REQUIRED":
      return PROVIDER_ERRORS.authRequired();
    case "LINKEDIN_RATE_LIMITED":
      return PROVIDER_ERRORS.rateLimited();
    case "LINKEDIN_TIMEOUT":
      return PROVIDER_ERRORS.timeout();
    case "LINKEDIN_CONFIGURATION_ERROR":
      return PROVIDER_ERRORS.configuration("The LinkedIn search service is misconfigured.");
    default:
      // Never leak the upstream body: it can contain session detail.
      return PROVIDER_ERRORS.unavailable(
        `The LinkedIn backend reported a failure (status ${status}).`,
      );
  }
}
