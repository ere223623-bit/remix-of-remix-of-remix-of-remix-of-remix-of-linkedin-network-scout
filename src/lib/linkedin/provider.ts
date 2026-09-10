import type {
  CompanyResult,
  ErrorCode,
  IntegrationState,
  JobResult,
  PersonResult,
  ProviderCapabilities,
  SearchType,
} from "./types";

export class LinkedInProviderError extends Error {
  readonly code: ErrorCode;
  readonly state: IntegrationState;

  constructor(code: ErrorCode, state: IntegrationState, message: string) {
    super(message);
    this.name = "LinkedInProviderError";
    this.code = code;
    this.state = state;
  }
}

export const PROVIDER_ERRORS = {
  authRequired: () =>
    new LinkedInProviderError(
      "LINKEDIN_AUTH_REQUIRED",
      "AUTH_REQUIRED",
      "The LinkedIn backend is not authenticated. An administrator must complete the LinkedIn login on the search service host.",
    ),
  unavailable: (detail = "The LinkedIn backend is not reachable.") =>
    new LinkedInProviderError("LINKEDIN_BACKEND_UNAVAILABLE", "BACKEND_UNAVAILABLE", detail),
  rateLimited: (detail = "Too many LinkedIn requests. Try again shortly.") =>
    new LinkedInProviderError("LINKEDIN_RATE_LIMITED", "RATE_LIMITED", detail),
  timeout: () =>
    new LinkedInProviderError(
      "LINKEDIN_TIMEOUT",
      "TIMEOUT",
      "The LinkedIn backend did not respond in time.",
    ),
  configuration: (detail: string) =>
    new LinkedInProviderError("LINKEDIN_CONFIGURATION_ERROR", "CONFIGURATION_ERROR", detail),
  invalidResponse: (detail = "The LinkedIn backend returned a response this app cannot read.") =>
    new LinkedInProviderError("LINKEDIN_INVALID_RESPONSE", "BACKEND_UNAVAILABLE", detail),
  unsupported: (type: SearchType) =>
    new LinkedInProviderError(
      "LINKEDIN_BACKEND_UNAVAILABLE",
      "BACKEND_UNAVAILABLE",
      `Not supported by the currently configured LinkedIn backend (${type}).`,
    ),
} as const;

export type ProviderSearchArgs = {
  query: string;
  filters: Record<string, string>;
  limit: number;
};

export type ProviderSearchResult<T> = {
  results: T[];
  backend: string | null;
  retrieved_at: string;
  /** Which concrete provider answered. Set by the composite selector. */
  provider?: string;
};

/**
 * Stable contract the application depends on. Agent Reach is one implementation;
 * swapping the backend must not touch the frontend.
 */
export interface LinkedInProvider {
  readonly id: string;
  readonly label: string;
  healthCheck(): Promise<ProviderCapabilities>;
  getCapabilities(): Promise<ProviderCapabilities>;
  searchPeople(args: ProviderSearchArgs): Promise<ProviderSearchResult<PersonResult>>;
  searchCompanies(args: ProviderSearchArgs): Promise<ProviderSearchResult<CompanyResult>>;
  searchJobs(args: ProviderSearchArgs): Promise<ProviderSearchResult<JobResult>>;
  getProfile(profileUrl: string): Promise<PersonResult>;
}

export type ProviderErrorInfo = {
  code: ErrorCode;
  state: IntegrationState;
  message: string;
};
