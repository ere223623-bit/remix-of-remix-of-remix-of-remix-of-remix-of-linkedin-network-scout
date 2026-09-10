import type {
  CompanyResult,
  DataSource,
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
  permissionDenied: (detail = "The connected account does not permit this LinkedIn operation.") =>
    new LinkedInProviderError("LINKEDIN_PERMISSION_DENIED", "PERMISSION_DENIED", detail),
  accountRestricted: () =>
    new LinkedInProviderError(
      "LINKEDIN_ACCOUNT_RESTRICTED",
      "ACCOUNT_RESTRICTED",
      "LinkedIn has restricted this account. Resolve the restriction before searching again.",
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
    new LinkedInProviderError("LINKEDIN_INVALID_RESPONSE", "INVALID_RESPONSE", detail),
  unsupported: (type: SearchType) =>
    new LinkedInProviderError(
      "LINKEDIN_CAPABILITY_UNSUPPORTED",
      "CAPABILITY_UNSUPPORTED",
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
  provider: string;
  source: DataSource;
  isLinkedInSourced: boolean;
  retrievedAt: string;
};

/**
 * Stable contract the application depends on. Agent Reach is one implementation;
 * swapping the backend must not touch the frontend.
 */
export interface LinkedInProvider {
  readonly id: string;
  readonly label: string;
  readonly source: DataSource;
  readonly isLinkedInSourced: boolean;
  readonly configured?: boolean;
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
