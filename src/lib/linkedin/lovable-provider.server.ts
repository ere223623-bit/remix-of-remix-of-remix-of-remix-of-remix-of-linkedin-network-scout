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
  FilterKey,
  JobResult,
  PersonResult,
  ProviderCapabilities,
  SearchType,
} from "./types";

export type LovableLinkedInConfig = {
  lovableApiKey: string;
  linkedInApiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/linkedin";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Map of search types to a probe endpoint that detects support. */
const SEARCH_PROBE_PATHS: Record<SearchType, string> = {
  people: "/v2/search?q=people&keywords=engineer&count=1",
  companies: "/v2/search?q=companies&keywords=technology&count=1",
  jobs: "/v2/jobs?keywords=engineer&count=1",
};

export function readLovableLinkedInConfig(
  env: Record<string, string | undefined> = process.env,
): LovableLinkedInConfig {
  const lovableApiKey = env["LOVABLE_API_KEY"];
  const linkedInApiKey = env["LINKEDIN_API_KEY"];
  if (!lovableApiKey || !linkedInApiKey) {
    throw PROVIDER_ERRORS.configuration(
      "The Lovable LinkedIn connector is not configured. Connect LinkedIn in the project settings.",
    );
  }
  const timeout = Number(env["LINKEDIN_SERVICE_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MS);
  return {
    lovableApiKey,
    linkedInApiKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Provider backed by the Lovable LinkedIn connector gateway.
 * Detects real capabilities by probing endpoints; unsupported operations
 * surface as `unsupported` so the composite selector can fall back.
 */
export class LovableLinkedInProvider implements LinkedInProvider {
  readonly id = "lovable-linkedin";
  readonly label = "Lovable LinkedIn";
  private readonly config: LovableLinkedInConfig;
  private readonly doFetch: typeof fetch;
  private capabilityCache: { value: ProviderCapabilities; at: number } | undefined;

  constructor(config: LovableLinkedInConfig) {
    this.config = config;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  private async rawRequest(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await this.doFetch(`${GATEWAY_URL}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.config.lovableApiKey}`,
          "X-Connection-Api-Key": this.config.linkedInApiKey,
          ...(init?.headers ?? {}),
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.rawRequest(path, init);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw PROVIDER_ERRORS.timeout();
      throw PROVIDER_ERRORS.unavailable("The LinkedIn connector could not be reached.");
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw PROVIDER_ERRORS.invalidResponse();

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw PROVIDER_ERRORS.invalidResponse();
    }

    if (response.status === 401 || response.status === 403) throw PROVIDER_ERRORS.authRequired();
    if (response.status === 429) throw PROVIDER_ERRORS.rateLimited();
    if (response.status === 504 || response.status === 408) throw PROVIDER_ERRORS.timeout();

    if (!response.ok) {
      throw mapGatewayError(payload, response.status);
    }

    return payload;
  }

  private async probeSupport(path: string): Promise<boolean> {
    const res = await this.rawRequest(path);
    // 2xx = supported; 404 from the virtual-resource layer = not supported.
    if (res.status === 404) return false;
    if (res.status === 403) return false;
    return res.ok;
  }

  async healthCheck(): Promise<ProviderCapabilities> {
    const checkedAt = new Date().toISOString();
    let authenticated = false;
    let backend: string | null = null;

    try {
      const me = (await this.request("/v2/userinfo")) as Record<string, unknown>;
      authenticated = typeof me["sub"] === "string" && me["sub"].length > 0;
      backend = "linkedin-gateway";
    } catch (error) {
      if (error instanceof LinkedInProviderError && error.state === "AUTH_REQUIRED") {
        authenticated = false;
      } else {
        throw error;
      }
    }

    const capabilities: ("profile_search" | "company_search" | "job_search" | "profile_detail")[] = [];
    const supportedFilters: Partial<Record<SearchType, FilterKey[]>> = {};

    if (authenticated) {
      // The gateway connection supports basic profile reads and social posting.
      // We probe each search surface individually; most connections will not
      // expose LinkedIn search APIs, and that is surfaced honestly.
      for (const type of ["people", "companies", "jobs"] as SearchType[]) {
        if (await this.probeSupport(SEARCH_PROBE_PATHS[type])) {
          capabilities.push(capabilityForType(type));
          supportedFilters[type] = ["keywords", "location", "country", "industry"];
        }
      }

      // Profile detail by LinkedIn person URN is available on many connections.
      if (await this.probeSupport("/v2/people/(id:~)")) {
        capabilities.push("profile_detail");
      }
    }

    const raw = {
      available: capabilities.length > 0,
      authenticated,
      backend,
      capabilities,
      supported_filters: supportedFilters,
      message: capabilities.length
        ? "LinkedIn connector ready."
        : "LinkedIn connector is authenticated but does not expose search APIs for this connection.",
    };

    const capabilitiesResult = normalizeCapabilities(raw, checkedAt);
    this.capabilityCache = { value: capabilitiesResult, at: Date.now() };
    return capabilitiesResult;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    if (this.capabilityCache && Date.now() - this.capabilityCache.at < 60_000) {
      return this.capabilityCache.value;
    }
    return this.healthCheck();
  }

  private async search<T extends PersonResult | CompanyResult | JobResult>(
    type: SearchType,
    args: ProviderSearchArgs,
  ): Promise<ProviderSearchResult<T>> {
    const capabilities = await this.getCapabilities();
    if (!capabilities.available) {
      throw capabilities.state === "AUTH_REQUIRED"
        ? PROVIDER_ERRORS.authRequired()
        : PROVIDER_ERRORS.unsupported(type);
    }
    if (!capabilities.capabilities.includes(capabilityForType(type))) {
      throw PROVIDER_ERRORS.unsupported(type);
    }

    const filters = pruneUnsupportedFilters(args.filters, capabilities.supported_filters[type]);
    const params = new URLSearchParams();
    if (args.query) params.set("keywords", args.query);
    Object.entries(filters).forEach(([k, v]) => params.set(k, v));
    params.set("count", String(Math.min(args.limit, 50)));

    const payload = (await this.request(`/v2/search?${params.toString()}`)) as Record<string, unknown>;
    const retrievedAt = new Date().toISOString();

    return {
      results: normalizeResults(type, payload["elements"] ?? payload["results"], retrievedAt) as T[],
      backend: capabilities.backend,
      retrieved_at: retrievedAt,
    };
  }

  searchPeople(args: ProviderSearchArgs): Promise<ProviderSearchResult<PersonResult>> {
    return this.search<PersonResult>("people", args);
  }

  searchCompanies(args: ProviderSearchArgs): Promise<ProviderSearchResult<CompanyResult>> {
    return this.search<CompanyResult>("companies", args);
  }

  searchJobs(args: ProviderSearchArgs): Promise<ProviderSearchResult<JobResult>> {
    return this.search<JobResult>("jobs", args);
  }

  async getProfile(profileUrl: string): Promise<PersonResult> {
    const capabilities = await this.getCapabilities();
    if (!capabilities.capabilities.includes("profile_detail")) {
      throw PROVIDER_ERRORS.unsupported("people");
    }

    // The gateway can only resolve profiles by LinkedIn internal URN or ID.
    // Public URLs are not accepted; surface that clearly.
    const urn = extractLinkedInUrn(profileUrl);
    if (!urn) {
      throw PROVIDER_ERRORS.unavailable(
        "The LinkedIn connector can only fetch profiles by LinkedIn URN, not by public URL.",
      );
    }

    const payload = (await this.request(`/v2/people/${urn}?projection=(id,firstName,lastName,headline,location,industry)`)) as Record<string, unknown>;
    const raw =
      Array.isArray(payload["elements"]) && payload["elements"].length > 0
        ? (payload["elements"][0] as Record<string, unknown>)
        : payload;
    if (typeof raw !== "object" || raw === null) throw PROVIDER_ERRORS.invalidResponse();
    return normalizePerson(raw as Record<string, unknown>, new Date().toISOString());
  }
}

function mapGatewayError(payload: unknown, status: number): LinkedInProviderError {
  const body = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const code = body["code"] ?? body["errorCode"] ?? body["type"];
  const message = typeof body["message"] === "string" ? body["message"] : undefined;

  if (code === "RESOURCE_NOT_FOUND") {
    return PROVIDER_ERRORS.unsupported("people");
  }
  if (code === "AUTHENTICATION_FAILED" || code === "INVALID_TOKEN" || code === "UNAUTHORIZED") {
    return PROVIDER_ERRORS.authRequired();
  }
  if (code === "RATE_LIMIT_EXCEEDED" || code === "THROTTLED") {
    return PROVIDER_ERRORS.rateLimited(message);
  }
  if (code === "ACCESS_DENIED" || code === "FORBIDDEN") {
    return PROVIDER_ERRORS.unavailable(
      "This LinkedIn connection does not have permission for the requested operation.",
    );
  }

  return PROVIDER_ERRORS.unavailable(
    `The LinkedIn connector returned an error (status ${status}).`,
  );
}

function extractLinkedInUrn(url: string): string | null {
  if (url.startsWith("urn:")) return url;
  const match = url.match(/linkedin\.com\/in\/[^/]+/);
  if (match) {
    // Public URLs cannot be resolved to URNs by the public API. Return null
    // so the provider surfaces a clear unsupported message.
    return null;
  }
  return null;
}
