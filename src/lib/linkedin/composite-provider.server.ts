import { capabilityForType, normalizeCapabilities } from "./normalize";
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

/**
 * Preferred provider order per research type. Apollo runs entirely inside
 * Lovable, so it leads people and company research; the Agent Reach sidecar is
 * kept last as the exact-LinkedIn source. Jobs stay on the LinkedIn-sourced
 * backends — Apollo has no job-posting search and never pretends otherwise.
 */
const ROUTING: Record<SearchType, string[]> = {
  people: ["apollo", "lovable-linkedin", "agent-reach"],
  companies: ["apollo", "lovable-linkedin", "agent-reach"],
  jobs: ["lovable-linkedin", "agent-reach", "apollo"],
};

/**
 * Orchestrates every configured research provider. Errors that mean a provider
 * simply cannot answer trigger the next candidate; auth, rate-limit and
 * configuration errors are surfaced immediately and never fall back silently.
 */
export class CompositeLinkedInProvider implements LinkedInProvider {
  readonly id = "composite";
  readonly label = "Research (auto)";
  private readonly providers: LinkedInProvider[];

  constructor(...providers: LinkedInProvider[]) {
    this.providers = providers.flat();
  }

  private ordered(type: SearchType): LinkedInProvider[] {
    const rank = (p: LinkedInProvider) => {
      const index = ROUTING[type].indexOf(p.id);
      return index === -1 ? ROUTING[type].length : index;
    };
    return [...this.providers].sort((a, b) => rank(a) - rank(b));
  }

  async healthCheck(): Promise<ProviderCapabilities> {
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
    _args: ProviderSearchArgs,
    runner: (p: LinkedInProvider) => Promise<ProviderSearchResult<T>>,
  ): Promise<ProviderSearchResult<T> & { provider: string }> {
    const entries: ProviderEntry[] = this.ordered(type).map((provider) => ({ provider }));

    for (const entry of entries) {
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

    const lastError = entries[entries.length - 1]?.error;
    if (lastError) throw lastError;
    throw PROVIDER_ERRORS.unavailable("No research backend is available.");
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
    for (const provider of this.ordered("people")) {
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
    message: reports.map((r) => r.message).filter(Boolean).join(" | "),
    checked_at: new Date().toISOString(),
  };
}
