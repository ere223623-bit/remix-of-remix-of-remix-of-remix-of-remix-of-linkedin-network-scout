// Shared, client-safe types for the LinkedIn module.
// These are the ONLY shapes the frontend knows about — the frontend never sees
// Agent Reach / MCP raw output.

export type SearchType = "people" | "companies" | "jobs";

/**
 * Where a record actually came from. Never label non-LinkedIn data as
 * "linkedin" — the UI shows this verbatim.
 */
export type DataSource = "linkedin" | "apollo" | "apify";

export const SOURCE_LABELS: Record<DataSource, string> = {
  linkedin: "LinkedIn",
  apollo: "Apollo",
  apify: "Apify",
};

export type Capability =
  | "profile_search"
  | "company_search"
  | "job_search"
  | "profile_detail";

export type IntegrationState =
  | "READY"
  | "AUTH_REQUIRED"
  | "BACKEND_UNAVAILABLE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CONFIGURATION_ERROR";

export type ErrorCode =
  | "LINKEDIN_AUTH_REQUIRED"
  | "LINKEDIN_BACKEND_UNAVAILABLE"
  | "LINKEDIN_RATE_LIMITED"
  | "LINKEDIN_TIMEOUT"
  | "LINKEDIN_CONFIGURATION_ERROR"
  | "LINKEDIN_INVALID_RESPONSE"
  | "LINKEDIN_INVALID_INPUT";

/** Every filter the UI can offer. The live backend decides which are usable. */
export type FilterKey =
  | "keywords"
  | "person_name"
  | "job_title"
  | "company"
  | "industry"
  | "location"
  | "country"
  | "current_company"
  | "previous_company"
  | "skills"
  | "seniority"
  | "profile_url";

export const ALL_FILTER_KEYS: FilterKey[] = [
  "keywords",
  "person_name",
  "job_title",
  "company",
  "industry",
  "location",
  "country",
  "current_company",
  "previous_company",
  "skills",
  "seniority",
  "profile_url",
];

export const FILTER_LABELS: Record<FilterKey, string> = {
  keywords: "Keywords",
  person_name: "Person name",
  job_title: "Job title",
  company: "Company",
  industry: "Industry",
  location: "Location",
  country: "Country",
  current_company: "Current company",
  previous_company: "Previous company",
  skills: "Skills",
  seniority: "Seniority",
  profile_url: "Profile URL",
};

export type ExperienceEntry = {
  title: string | null;
  company: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
};

export type EducationEntry = {
  school: string | null;
  degree: string | null;
  field: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type PersonResult = {
  id: string;
  name: string | null;
  headline: string | null;
  job_title: string | null;
  company: string | null;
  location: string | null;
  profile_url: string | null;
  photo_url: string | null;
  industry: string | null;
  about: string | null;
  skills: string[] | null;
  education: EducationEntry[] | null;
  experience: ExperienceEntry[] | null;
  source: DataSource;
  retrieved_at: string;
};

export type CompanyResult = {
  id: string;
  name: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
  linkedin_url: string | null;
  website: string | null;
  source: DataSource;
  retrieved_at: string;
};

export type JobResult = {
  id: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  linkedin_url: string | null;
  published_at: string | null;
  source: DataSource;
  retrieved_at: string;
};

export type AnyResult = PersonResult | CompanyResult | JobResult;

export type ProviderCapabilities = {
  available: boolean;
  state: IntegrationState;
  backend: string | null;
  agent_reach_installed: boolean;
  agent_reach_version: string | null;
  authenticated: boolean;
  capabilities: Capability[];
  supported_filters: Partial<Record<SearchType, FilterKey[]>>;
  message: string | null;
  checked_at: string;
};

export type SearchResponse<T extends AnyResult = AnyResult> = {
  success: true;
  query: { type: SearchType; query: string; filters: Record<string, string>; limit: number };
  results: T[];
  count: number;
  backend: string | null;
  retrieved_at: string;
};

export type ApiErrorResponse = {
  success: false;
  error: { code: ErrorCode; state: IntegrationState; message: string };
};
