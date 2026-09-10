import { capabilityForType, normalizeCapabilities, pruneUnsupportedFilters } from "./normalize";
import {
  LinkedInProviderError,
  PROVIDER_ERRORS,
  type LinkedInProvider,
  type ProviderSearchArgs,
  type ProviderSearchResult,
} from "./provider";
import type {
  AnyResult,
  CompanyResult,
  FilterKey,
  JobResult,
  PersonResult,
  ProviderCapabilities,
  SearchType,
} from "./types";

type ProviderEntry = { provider: LinkedInProvider; error?: LinkedInProviderError };

/** Preferred order for true LinkedIn-sourced search. Enrichment providers are excluded. */
const ROUTING: Record<SearchType, string[]> = {
  people: ["lovable-linkedin", "agent-reach"],
  companies: ["lovable-linkedin", "agent-reach"],
  jobs: ["lovable-linkedin", "agent-reach"],
};

const TERMINAL_ERROR_CODES = new Set([
  "LINKEDIN_AUTH_REQUIRED",
  "LINKEDIN_PERMISSION_DENIED",
  "LINKEDIN_ACCOUNT_RESTRICTED",
  "LINKEDIN_RATE_LIMITED",
  "LINKEDIN_CONFIGURATION_ERROR",
]);

/**
 * Orchestrates every configured research provider. Errors that mean a provider
 * simply cannot answer trigger the next candidate; auth, rate-limit and
 * configuration errors are surfaced immediately and never fall back silently.
 */
export class CompositeLinkedInProvider implements LinkedInProvider {
  readonly id = "composite";
  readonly label = "LinkedIn search (auto)";
  readonly source = "linkedin" as const;
  readonly isLinkedInSourced = true;
  private readonly providers: LinkedInProvider[];

  constructor(...providers: LinkedInProvider[]) {
    this.providers = providers
      .flat()
      .filter((provider) => provider.isLinkedInSourced && provider.configured !== false);
  }

  private ordered(type: SearchType): LinkedInProvider[] {
    const rank = (p: LinkedInProvider) => {
      const index = ROUTING[type].indexOf(p.id);
      return index === -1 ? ROUTING[type].length : index;
    };
    return [...this.providers].sort((a, b) => rank(a) - rank(b));
  }

  private assertConfigured(): void {
    if (this.providers.length === 0) {
      throw PROVIDER_ERRORS.configuration(
        "No LinkedIn search provider is configured. Connect LinkedIn in Lovable project settings or configure the Agent Reach service address and access token.",
      );
    }
  }

  async healthCheck(): Promise<ProviderCapabilities> {
    this.assertConfigured();
    const settled = await Promise.allSettled(this.providers.map((p) => p.healthCheck()));
    const reports = settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : normalizeCapabilities(
            {
              available: false,
              authenticated: false,
              backend: this.providers[index]?.id ?? null,
              capabilities: [],
              message:
                result.reason instanceof LinkedInProviderError
                  ? result.reason.message
                  : String(result.reason),
            },
            new Date().toISOString(),
          ),
    );
    return mergeCapabilities(reports);
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return this.healthCheck();
  }

  private async trySearch<T extends AnyResult>(
    type: SearchType,
    args: ProviderSearchArgs,
    runner: (p: LinkedInProvider, args: ProviderSearchArgs) => Promise<ProviderSearchResult<T>>,
  ): Promise<ProviderSearchResult<T> & { provider: string }> {
    this.assertConfigured();
    const entries: ProviderEntry[] = this.ordered(type).map((provider) => ({ provider }));

    for (const entry of entries) {
      try {
        const capabilities = await entry.provider.getCapabilities();
        if (
          !capabilities.available ||
          !capabilities.capabilities.includes(capabilityForType(type))
        ) {
          entry.error = PROVIDER_ERRORS.unsupported(type);
          continue;
        }
        const filteredArgs = {
          ...args,
          filters: pruneUnsupportedFilters(args.filters, capabilities.supported_filters[type]),
        };
        const result = await runner(entry.provider, filteredArgs);
        if (
          !result ||
          !Array.isArray(result.results) ||
          typeof result.retrieved_at !== "string" ||
          Number.isNaN(Date.parse(result.retrieved_at))
        ) {
          throw PROVIDER_ERRORS.invalidResponse();
        }
        const retrievedAt = result.retrieved_at;
        return {
          ...result,
          results: result.results.map((item) => ({
            ...item,
            source: entry.provider.source,
            provider: entry.provider.id,
            isLinkedInSourced: entry.provider.isLinkedInSourced,
            retrievedAt,
            retrieved_at: retrievedAt,
          })),
          provider: entry.provider.id,
          source: entry.provider.source,
          isLinkedInSourced: entry.provider.isLinkedInSourced,
          retrievedAt,
        };
      } catch (error) {
        entry.error =
          error instanceof LinkedInProviderError ? error : PROVIDER_ERRORS.unavailable();

        // Auth, rate-limit, and configuration errors are not fallback reasons.
        if (TERMINAL_ERROR_CODES.has(entry.error.code)) {
          throw entry.error;
        }
      }
    }

    const lastError = entries[entries.length - 1]?.error;
    if (lastError?.code === "LINKEDIN_TIMEOUT") throw PROVIDER_ERRORS.timeout();
    if (lastError?.code === "LINKEDIN_INVALID_RESPONSE") throw PROVIDER_ERRORS.invalidResponse();
    if (lastError?.code === "LINKEDIN_CAPABILITY_UNSUPPORTED") {
      throw PROVIDER_ERRORS.unsupported(type);
    }
    if (lastError) throw PROVIDER_ERRORS.unavailable();
    throw PROVIDER_ERRORS.unavailable("No research backend is available.");
  }

  searchPeople(
    args: ProviderSearchArgs,
  ): Promise<ProviderSearchResult<PersonResult> & { provider: string }> {
    return this.trySearch<PersonResult>("people", args, (p, forwarded) =>
      p.searchPeople(forwarded),
    );
  }

  searchCompanies(
    args: ProviderSearchArgs,
  ): Promise<ProviderSearchResult<CompanyResult> & { provider: string }> {
    return this.trySearch<CompanyResult>("companies", args, (p, forwarded) =>
      p.searchCompanies(forwarded),
    );
  }

  searchJobs(
    args: ProviderSearchArgs,
  ): Promise<ProviderSearchResult<JobResult> & { provider: string }> {
    return this.trySearch<JobResult>("jobs", args, (p, forwarded) => p.searchJobs(forwarded));
  }

  async getProfile(profileUrl: string): Promise<PersonResult> {
    this.assertConfigured();
    for (const provider of this.ordered("people")) {
      try {
        const profile = await provider.getProfile(profileUrl);
        return {
          ...profile,
          source: provider.source,
          provider: provider.id,
          isLinkedInSourced: provider.isLinkedInSourced,
          retrievedAt: profile.retrieved_at,
        };
      } catch (error) {
        if (error instanceof LinkedInProviderError) {
          if (TERMINAL_ERROR_CODES.has(error.code)) {
            throw error;
          }
        }
      }
    }
    throw PROVIDER_ERRORS.unsupported("people");
  }
}

function mergeCapabilities(reports: ProviderCapabilities[]): ProviderCapabilities {
  const allCapabilities = Array.from(new Set(reports.flatMap((r) => r.capabilities)));
  const supportedFilters: ProviderCapabilities["supported_filters"] = {};
  for (const type of ["people", "companies", "jobs"] as SearchType[]) {
    const set = new Set<FilterKey>();
    reports.forEach((r) => (r.supported_filters[type] ?? []).forEach((k) => set.add(k)));
    if (set.size) supportedFilters[type] = Array.from(set);
  }

  const available = reports.some((r) => r.available);
  const state: ProviderCapabilities["state"] = available
    ? "READY"
    : reports.some((r) => r.state === "AUTH_REQUIRED")
      ? "AUTH_REQUIRED"
      : (reports[0]?.state ?? "BACKEND_UNAVAILABLE");

  return {
    available,
    state,
    backend: reports.find((r) => r.available)?.backend ?? reports[0]?.backend ?? null,
    agent_reach_installed: reports.some((r) => r.agent_reach_installed),
    agent_reach_version: reports.find((r) => r.agent_reach_version)?.agent_reach_version ?? null,
    authenticated: reports.some((r) => r.authenticated),
    capabilities: allCapabilities as ProviderCapabilities["capabilities"],
    supported_filters: supportedFilters,
    message: reports
      .map((r) => r.message)
      .filter(Boolean)
      .join(" | "),
    checked_at: new Date().toISOString(),
  };
}
