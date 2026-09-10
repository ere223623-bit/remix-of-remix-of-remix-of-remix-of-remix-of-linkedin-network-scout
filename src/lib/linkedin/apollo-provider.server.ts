import { normalizeCapabilities } from "./normalize";
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

export type ApolloConfig = {
  lovableApiKey: string;
  apolloApiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/apollo";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Filters Apollo genuinely accepts for each search type. Anything the UI sends
 * that is not listed here is dropped rather than silently mistranslated.
 */
export const APOLLO_SUPPORTED_FILTERS: Partial<Record<SearchType, FilterKey[]>> = {
  people: [
    "keywords",
    "person_name",
    "job_title",
    "location",
    "country",
    "current_company",
    "seniority",
  ],
  companies: ["keywords", "company", "location", "country", "industry"],
};

export function readApolloConfig(
  env: Record<string, string | undefined> = process.env,
): ApolloConfig {
  const lovableApiKey = env["LOVABLE_API_KEY"];
  const apolloApiKey = env["APOLLO_API_KEY"];
  if (!lovableApiKey || !apolloApiKey) {
    throw PROVIDER_ERRORS.configuration(
      "Apollo is not connected yet. Connect the Apollo integration to enable professional-data research.",
    );
  }
  const timeout = Number(env["APOLLO_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MS);
  return {
    lovableApiKey,
    apolloApiKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

type Raw = Record<string, unknown>;

function isRaw(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(raw: Raw, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Apollo returns city/state/country separately; join only what exists. */
export function apolloLocation(raw: Raw): string | null {
  const parts = ["city", "state", "country"]
    .map((key) => text(raw, key))
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Maps one Apollo person record onto the app's PersonResult. Only fields Apollo
 * actually returned are mapped; everything else stays null. `source` is always
 * "apollo" — this data is not retrieved from LinkedIn.
 */
export function mapApolloPerson(raw: Raw, retrievedAt: string, index = 0): PersonResult {
  const org = isRaw(raw["organization"]) ? (raw["organization"] as Raw) : null;
  const history = Array.isArray(raw["employment_history"])
    ? (raw["employment_history"] as unknown[]).filter(isRaw)
    : null;

  const id = text(raw, "id");
  const linkedin = text(raw, "linkedin_url");

  return {
    id: `apollo:person:${id ?? linkedin ?? index}`,
    name: text(raw, "name") ?? joinName(raw),
    headline: text(raw, "headline"),
    job_title: text(raw, "title"),
    company: org ? text(org, "name") : text(raw, "organization_name"),
    location: apolloLocation(raw),
    profile_url: linkedin,
    photo_url: text(raw, "photo_url"),
    industry: org ? text(org, "industry") : null,
    about: null,
    skills: null,
    education: null,
    experience: history
      ? history.map((entry) => ({
          title: text(entry, "title"),
          company: text(entry, "organization_name"),
          location: null,
          start_date: text(entry, "start_date"),
          end_date: text(entry, "end_date"),
          description: text(entry, "description"),
        }))
      : null,
    source: "apollo",
    provider: "apollo",
    isLinkedInSourced: false,
    retrievedAt,
    retrieved_at: retrievedAt,
  };
}

function joinName(raw: Raw): string | null {
  const parts = [text(raw, "first_name"), text(raw, "last_name")].filter((part): part is string =>
    Boolean(part),
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

export function mapApolloCompany(raw: Raw, retrievedAt: string, index = 0): CompanyResult {
  const id = text(raw, "id");
  return {
    id: `apollo:company:${id ?? text(raw, "website_url") ?? index}`,
    name: text(raw, "name"),
    industry: text(raw, "industry"),
    location: apolloLocation(raw),
    description: text(raw, "short_description", "description"),
    linkedin_url: text(raw, "linkedin_url"),
    website: text(raw, "website_url"),
    source: "apollo",
    provider: "apollo",
    isLinkedInSourced: false,
    retrievedAt,
    retrieved_at: retrievedAt,
  };
}

/**
 * Research provider backed by Apollo's B2B dataset, reached through the Lovable
 * connector gateway. It runs entirely inside Lovable — no sidecar, no browser
 * session. It is deliberately NOT named a LinkedIn provider: Apollo data is
 * Apollo's own dataset, which includes LinkedIn profile URLs but is not a
 * LinkedIn search.
 */
export class ApolloResearchProvider implements LinkedInProvider {
  readonly id = "apollo";
  readonly label = "Apollo professional data";
  readonly source = "apollo" as const;
  readonly isLinkedInSourced = false;
  private readonly config: ApolloConfig;
  private readonly doFetch: typeof fetch;
  private capabilityCache: { value: ProviderCapabilities; at: number } | undefined;

  constructor(config: ApolloConfig) {
    this.config = config;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  private async rawRequest(path: string, params: URLSearchParams): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await this.doFetch(`${GATEWAY_URL}${path}?${params.toString()}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.lovableApiKey}`,
          "X-Connection-Api-Key": this.config.apolloApiKey,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(path: string, params: URLSearchParams): Promise<Raw> {
    let response: Response;
    try {
      response = await this.rawRequest(path, params);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw PROVIDER_ERRORS.timeout();
      throw PROVIDER_ERRORS.unavailable("Apollo could not be reached.");
    }

    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw PROVIDER_ERRORS.invalidResponse();

    if (response.status === 401) throw PROVIDER_ERRORS.authRequired();
    if (response.status === 403) {
      throw new LinkedInProviderError(
        "LINKEDIN_PERMISSION_DENIED",
        "PERMISSION_DENIED",
        "The connected Apollo key cannot call this endpoint. Enable it (or use a master key) in Apollo under Integrations → API.",
      );
    }
    if (response.status === 429)
      throw PROVIDER_ERRORS.rateLimited("Apollo rate limit reached. Try again shortly.");
    if (response.status === 408 || response.status === 504) throw PROVIDER_ERRORS.timeout();

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      throw PROVIDER_ERRORS.invalidResponse();
    }

    if (!response.ok) {
      throw PROVIDER_ERRORS.unavailable(`Apollo returned an error (status ${response.status}).`);
    }

    if (!isRaw(payload)) throw PROVIDER_ERRORS.invalidResponse();
    return payload;
  }

  private async probe(path: string, params: URLSearchParams): Promise<boolean> {
    try {
      await this.request(path, params);
      return true;
    } catch (error) {
      if (error instanceof LinkedInProviderError && error.state === "AUTH_REQUIRED") throw error;
      return false;
    }
  }

  async healthCheck(): Promise<ProviderCapabilities> {
    const checkedAt = new Date().toISOString();
    let authenticated = false;
    const capabilities: ("profile_search" | "company_search" | "job_search" | "profile_detail")[] =
      [];
    let message: string | null = null;

    try {
      const peopleOk = await this.probe(
        "/api/v1/mixed_people/search",
        new URLSearchParams({ per_page: "1", page: "1", q_keywords: "engineer" }),
      );
      if (peopleOk) {
        authenticated = true;
        capabilities.push("profile_search", "profile_detail");
      }

      const companiesOk = await this.probe(
        "/api/v1/mixed_companies/search",
        new URLSearchParams({ per_page: "1", page: "1", q_organization_name: "apollo" }),
      );
      if (companiesOk) {
        authenticated = true;
        capabilities.push("company_search");
      }
    } catch (error) {
      if (error instanceof LinkedInProviderError && error.state === "AUTH_REQUIRED") {
        message = error.message;
      } else {
        throw error;
      }
    }

    // Apollo has no job-posting search API. This is reported honestly and never
    // advertised as supported.
    const supportedFilters: Partial<Record<SearchType, FilterKey[]>> = {};
    if (capabilities.includes("profile_search"))
      supportedFilters.people = APOLLO_SUPPORTED_FILTERS.people!;
    if (capabilities.includes("company_search"))
      supportedFilters.companies = APOLLO_SUPPORTED_FILTERS.companies!;

    const result = normalizeCapabilities(
      {
        available: capabilities.length > 0,
        authenticated,
        backend: "apollo",
        capabilities,
        supported_filters: supportedFilters,
        message:
          message ??
          (capabilities.length > 0
            ? "Apollo ready. People and company research available; job-posting search is not offered by Apollo."
            : "Apollo did not answer any research endpoint."),
      },
      checkedAt,
    );
    this.capabilityCache = { value: result, at: Date.now() };
    return result;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    if (this.capabilityCache && Date.now() - this.capabilityCache.at < 60_000) {
      return this.capabilityCache.value;
    }
    return this.healthCheck();
  }

  async searchPeople(args: ProviderSearchArgs): Promise<ProviderSearchResult<PersonResult>> {
    const params = new URLSearchParams({
      per_page: String(Math.min(args.limit, 50)),
      page: "1",
    });
    const filters = args.filters;
    const keywords = [args.query, filters["keywords"], filters["person_name"]]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(" ")
      .trim();
    if (keywords) params.set("q_keywords", keywords);
    if (filters["job_title"]) params.append("person_titles[]", filters["job_title"]);
    if (filters["seniority"]) params.append("person_seniorities[]", filters["seniority"]);
    for (const key of ["location", "country"] as const) {
      const value = filters[key];
      if (value) params.append("person_locations[]", value);
    }
    const company = filters["current_company"] ?? filters["company"];
    if (company) params.set("q_organization_name", company);

    const payload = await this.request("/api/v1/mixed_people/search", params);
    const retrievedAt = new Date().toISOString();
    const rows = collect(payload, "people", "contacts");

    return {
      results: rows.map((row, i) => mapApolloPerson(row, retrievedAt, i)),
      backend: "apollo",
      provider: this.id,
      source: this.source,
      isLinkedInSourced: this.isLinkedInSourced,
      retrievedAt,
      retrieved_at: retrievedAt,
    };
  }

  async searchCompanies(args: ProviderSearchArgs): Promise<ProviderSearchResult<CompanyResult>> {
    const params = new URLSearchParams({
      per_page: String(Math.min(args.limit, 50)),
      page: "1",
    });
    const filters = args.filters;
    const name = filters["company"] ?? args.query;
    if (name) params.set("q_organization_name", name);
    for (const key of ["keywords", "industry"] as const) {
      const value = filters[key];
      if (value) params.append("q_organization_keyword_tags[]", value);
    }
    for (const key of ["location", "country"] as const) {
      const value = filters[key];
      if (value) params.append("organization_locations[]", value);
    }

    const payload = await this.request("/api/v1/mixed_companies/search", params);
    const retrievedAt = new Date().toISOString();
    const rows = collect(payload, "organizations", "accounts");

    return {
      results: rows.map((row, i) => mapApolloCompany(row, retrievedAt, i)),
      backend: "apollo",
      provider: this.id,
      source: this.source,
      isLinkedInSourced: this.isLinkedInSourced,
      retrievedAt,
      retrieved_at: retrievedAt,
    };
  }

  async searchJobs(_args: ProviderSearchArgs): Promise<ProviderSearchResult<JobResult>> {
    throw new LinkedInProviderError(
      "LINKEDIN_BACKEND_UNAVAILABLE",
      "BACKEND_UNAVAILABLE",
      "Apollo does not offer job-posting search. Use a backend that does.",
    );
  }

  async getProfile(profileUrl: string): Promise<PersonResult> {
    const params = new URLSearchParams({ linkedin_url: profileUrl });
    const payload = await this.request("/api/v1/people/match", params);
    const person = isRaw(payload["person"]) ? (payload["person"] as Raw) : null;
    if (!person) throw PROVIDER_ERRORS.invalidResponse();
    return mapApolloPerson(person, new Date().toISOString());
  }
}

/** Apollo splits results across two arrays depending on CRM ownership. */
function collect(payload: Raw, ...keys: string[]): Raw[] {
  const rows: Raw[] = [];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) rows.push(...value.filter(isRaw));
  }
  return rows;
}
