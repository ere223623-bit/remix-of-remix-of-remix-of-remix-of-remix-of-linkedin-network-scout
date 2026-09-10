import {
  capabilityForType,
  normalizeCapabilities,
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
  AnyResult,
  CompanyResult,
  FilterKey,
  JobResult,
  PersonResult,
  ProviderCapabilities,
  SearchType,
} from "./types";

type ProviderEntry = { provider: LinkedInProvider; tried: boolean; error?: LinkedInProviderError };

/**
 * Orchestrates the Lovable LinkedIn connector as primary and the Agent Reach
 * sidecar as fallback. Errors that indicate the primary cannot satisfy a
 * request trigger fallback; auth/rate-limit/configuration errors are surfaced.
 */
export class CompositeLinkedInProvider implements LinkedInProvider {
  readonly id = "composite";
  readonly label = "LinkedIn (auto)";

  constructor(
    private readonly primary: LinkedInProvider,
    private readonly fallback: LinkedInProvider,
  ) {}

  async healthCheck(): Promise<ProviderCapabilities> {
    const [primary, fallback] = await Promise.allSettled([
      this.primary.healthCheck(),
      this.fallback.healthCheck(),
    ]);

    const primaryCap =
      primary.status === "fulfilled"
        ? primary.value
        : normalizeCapabilities(
            {
              available: false,
              authenticated: false,
              backend: this.primary.id,
              capabilities: [],
              message: primary.reason instanceof LinkedInProviderError ? primary.reason.message : String(primary.reason),
            },
            new Date().toISOString(),
          );

    const fallbackCap =
      fallback.status === "fulfilled"
        ? fallback.value
        : normalizeCapabilities(
            {
              available: false,
              authenticated: false,
              backend: this.fallback.id,
              capabilities: [],
              message: fallback.reason instanceof LinkedInProviderError ? fallback.reason.message : String(fallback.reason),
            },
            new Date().toISOString(),
          );

    return mergeCapabilities(primaryCap, fallbackCap);
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return this.healthCheck();
  }

  private async trySearch<T extends AnyResult>(
    type: SearchType,
    args: ProviderSearchArgs,
    runner: (p: LinkedInProvider) => Promise<ProviderSearchResult<T>>,
  ): Promise<ProviderSearchResult<T> & { provider: string }> {
    const providers: ProviderEntry[] = [
      { provider: this.primary, tried: false },
      { provider: this.fallback, tried: false },
    ];

    for (const entry of providers) {
      entry.tried = true;
      try {
        const capabilities = await entry.provider.getCapabilities();
        if (!capabilities.available || !capabilities.capabilities.includes(capabilityForType(type))) {
          entry.error = PROVIDER_ERRORS.unsupported(type);
          continue;
        }
        const result = await runner(entry.provider);
        return { ...result, provider: entry.provider.id };
      } catch (error) {
        entry.error =
          error instanceof LinkedInProviderError
            ? error
            : PROVIDER_ERRORS.unavailable(error instanceof Error ? error.message : String(error));

        // Auth, rate-limit, and configuration errors are not fallback reasons.
        if (
          entry.error.code === "LINKEDIN_AUTH_REQUIRED" ||
          entry.error.code === "LINKEDIN_RATE_LIMITED" ||
          entry.error.code === "LINKEDIN_CONFIGURATION_ERROR"
        ) {
          throw entry.error;
        }
      }
    }

    // Both providers failed with availability/unsupported; surface the last error.
    const lastError = providers[providers.length - 1]?.error;
    if (lastError) throw lastError;
    throw PROVIDER_ERRORS.unavailable("No LinkedIn backend is available.");
  }

  searchPeople(args: ProviderSearchArgs): Promise<ProviderSearchResult<PersonResult> & { provider: string }> {
    return this.trySearch<PersonResult>("people", args, (p) => p.searchPeople(args));
  }

  searchCompanies(args: ProviderSearchArgs): Promise<ProviderSearchResult<CompanyResult> & { provider: string }> {
    return this.trySearch<CompanyResult>("companies", args, (p) => p.searchCompanies(args));
  }

  searchJobs(args: ProviderSearchArgs): Promise<ProviderSearchResult<JobResult> & { provider: string }> {
    return this.trySearch<JobResult>("jobs", args, (p) => p.searchJobs(args));
  }

  async getProfile(profileUrl: string): Promise<PersonResult> {
    for (const provider of [this.primary, this.fallback]) {
      try {
        return await provider.getProfile(profileUrl);
      } catch (error) {
        if (error instanceof LinkedInProviderError) {
          if (
            error.code === "LINKEDIN_AUTH_REQUIRED" ||
            error.code === "LINKEDIN_RATE_LIMITED" ||
            error.code === "LINKEDIN_CONFIGURATION_ERROR"
          ) {
            throw error;
          }
        }
      }
    }
    throw PROVIDER_ERRORS.unsupported("people");
  }
}

function mergeCapabilities(primary: ProviderCapabilities, fallback: ProviderCapabilities): ProviderCapabilities {
  const allCapabilities = Array.from(new Set([...primary.capabilities, ...fallback.capabilities]));
  const supportedFilters: ProviderCapabilities["supported_filters"] = {};
  for (const type of ["people", "companies", "jobs"] as SearchType[]) {
    const set = new Set<FilterKey>();
    (primary.supported_filters[type] ?? []).forEach((k) => set.add(k));
    (fallback.supported_filters[type] ?? []).forEach((k) => set.add(k));
    if (set.size) supportedFilters[type] = Array.from(set);
  }

  const available = primary.available || fallback.available;
  const state: ProviderCapabilities["state"] = available
    ? "READY"
    : primary.state === "AUTH_REQUIRED" || fallback.state === "AUTH_REQUIRED"
      ? "AUTH_REQUIRED"
      : primary.state;

  return {
    available,
    state,
    backend: primary.backend ?? fallback.backend,
    agent_reach_installed: fallback.agent_reach_installed,
    agent_reach_version: fallback.agent_reach_version,
    authenticated: primary.authenticated || fallback.authenticated,
    capabilities: allCapabilities as ProviderCapabilities["capabilities"],
    supported_filters: supportedFilters,
    message: [primary.message, fallback.message].filter(Boolean).join(" | "),
    checked_at: new Date().toISOString(),
  };
}
