import type {
  Capability,
  CompanyResult,
  EducationEntry,
  ExperienceEntry,
  FilterKey,
  JobResult,
  PersonResult,
  ProviderCapabilities,
  SearchType,
} from "./types";
import { ALL_FILTER_KEYS } from "./types";

/**
 * Normalization is deliberately conservative: anything the source did not
 * return stays null. Nothing is inferred, guessed, or generated.
 */

type Raw = Record<string, unknown>;

export function str(raw: Raw, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function strArray(raw: Raw, ...keys: string[]): string[] | null {
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) {
      const items = value
        .map((entry) =>
          typeof entry === "string"
            ? entry.trim()
            : isRaw(entry)
              ? str(entry, "name", "title", "skill")
              : null,
        )
        .filter((entry): entry is string => Boolean(entry));
      return items.length > 0 ? items : null;
    }
  }
  return null;
}

function isRaw(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objArray(raw: Raw, ...keys: string[]): Raw[] | null {
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) {
      const items = value.filter(isRaw);
      return items.length > 0 ? items : null;
    }
  }
  return null;
}

function idFor(prefix: string, raw: Raw, fallbackIndex: number): string {
  const url = str(raw, "profile_url", "profileUrl", "url", "link", "linkedin_url", "linkedinUrl");
  if (url) return `${prefix}:${url}`;
  const id = str(raw, "id", "urn", "public_id", "publicId");
  if (id) return `${prefix}:${id}`;
  const name = str(raw, "name", "full_name", "fullName", "title", "job_title");
  return `${prefix}:${name ?? "result"}:${fallbackIndex}`;
}

export function normalizeExperience(raw: Raw): ExperienceEntry {
  return {
    title: str(raw, "title", "position", "job_title"),
    company: str(raw, "company", "company_name", "organisation", "organization"),
    location: str(raw, "location"),
    start_date: str(raw, "start_date", "starts_at", "from"),
    end_date: str(raw, "end_date", "ends_at", "to"),
    description: str(raw, "description", "summary"),
  };
}

export function normalizeEducation(raw: Raw): EducationEntry {
  return {
    school: str(raw, "school", "institution", "name"),
    degree: str(raw, "degree", "degree_name"),
    field: str(raw, "field", "field_of_study", "fieldOfStudy"),
    start_date: str(raw, "start_date", "starts_at", "from"),
    end_date: str(raw, "end_date", "ends_at", "to"),
  };
}

export function normalizePerson(raw: Raw, retrievedAt: string, index = 0): PersonResult {
  const experience = objArray(raw, "experience", "experiences", "positions");
  const education = objArray(raw, "education", "educations", "schools");
  const currentExperience = experience?.[0];

  return {
    id: idFor("person", raw, index),
    name: str(raw, "name", "full_name", "fullName", "title"),
    headline: str(raw, "headline", "subtitle", "summary_line"),
    job_title:
      str(raw, "job_title", "jobTitle", "current_title", "position", "occupation") ??
      (currentExperience ? str(currentExperience, "title", "position") : null),
    company:
      str(raw, "company", "current_company", "currentCompany", "company_name", "organization") ??
      (currentExperience ? str(currentExperience, "company", "company_name") : null),
    location: str(raw, "location", "geo", "geo_location", "region"),
    profile_url: str(raw, "profile_url", "profileUrl", "url", "link", "linkedin_url"),
    photo_url: str(raw, "photo_url", "photoUrl", "avatar", "image", "profile_picture"),
    industry: str(raw, "industry"),
    about: str(raw, "about", "summary", "bio"),
    skills: strArray(raw, "skills"),
    education: education ? education.map(normalizeEducation) : null,
    experience: experience ? experience.map(normalizeExperience) : null,
    source: "linkedin",
    retrieved_at: retrievedAt,
  };
}

export function normalizeCompany(raw: Raw, retrievedAt: string, index = 0): CompanyResult {
  return {
    id: idFor("company", raw, index),
    name: str(raw, "name", "company_name", "title"),
    industry: str(raw, "industry"),
    location: str(raw, "location", "headquarters", "hq"),
    description: str(raw, "description", "about", "summary"),
    linkedin_url: str(raw, "linkedin_url", "linkedinUrl", "url", "profile_url", "link"),
    website: str(raw, "website", "site", "homepage"),
    source: "linkedin",
    retrieved_at: retrievedAt,
  };
}

export function normalizeJob(raw: Raw, retrievedAt: string, index = 0): JobResult {
  return {
    id: idFor("job", raw, index),
    job_title: str(raw, "job_title", "title", "position"),
    company: str(raw, "company", "company_name", "organization"),
    location: str(raw, "location"),
    description: str(raw, "description", "summary", "snippet"),
    linkedin_url: str(raw, "linkedin_url", "url", "link", "job_url"),
    published_at: str(raw, "published_at", "posted_at", "listed_at", "date_posted"),
    source: "linkedin",
    retrieved_at: retrievedAt,
  };
}

export function normalizeResults(
  type: SearchType,
  rawResults: unknown,
  retrievedAt: string,
): (PersonResult | CompanyResult | JobResult)[] {
  if (!Array.isArray(rawResults)) return [];
  const items = rawResults.filter(isRaw);
  if (type === "people") return items.map((raw, i) => normalizePerson(raw, retrievedAt, i));
  if (type === "companies") return items.map((raw, i) => normalizeCompany(raw, retrievedAt, i));
  return items.map((raw, i) => normalizeJob(raw, retrievedAt, i));
}

const KNOWN_CAPABILITIES: Capability[] = [
  "profile_search",
  "company_search",
  "job_search",
  "profile_detail",
];

/**
 * Capabilities are reported by the running service. Anything not explicitly
 * reported is treated as unsupported — never advertised optimistically.
 */
export function normalizeCapabilities(raw: unknown, checkedAt: string): ProviderCapabilities {
  const data = isRaw(raw) ? raw : {};
  const capabilities = Array.isArray(data["capabilities"])
    ? (data["capabilities"] as unknown[])
        .filter((c): c is string => typeof c === "string")
        .filter((c): c is Capability => (KNOWN_CAPABILITIES as string[]).includes(c))
    : [];

  const authenticated = data["authenticated"] === true;
  const backend = str(data, "backend");
  const installed = data["agent_reach_installed"] === true;
  const declaredAvailable = data["available"] === true;
  const available = declaredAvailable && capabilities.length > 0;

  const state: ProviderCapabilities["state"] = available
    ? "READY"
    : !installed
      ? "BACKEND_UNAVAILABLE"
      : !authenticated
        ? "AUTH_REQUIRED"
        : "BACKEND_UNAVAILABLE";

  return {
    available,
    state,
    backend,
    agent_reach_installed: installed,
    agent_reach_version: str(data, "agent_reach_version"),
    authenticated,
    capabilities,
    supported_filters: normalizeSupportedFilters(data["supported_filters"]),
    message: str(data, "message", "detail"),
    checked_at: checkedAt,
  };
}

function normalizeSupportedFilters(raw: unknown): Partial<Record<SearchType, FilterKey[]>> {
  const out: Partial<Record<SearchType, FilterKey[]>> = {};
  if (!isRaw(raw)) return out;
  for (const type of ["people", "companies", "jobs"] as SearchType[]) {
    const value = raw[type];
    if (!Array.isArray(value)) continue;
    out[type] = value
      .filter((entry): entry is string => typeof entry === "string")
      .filter((entry): entry is FilterKey => (ALL_FILTER_KEYS as string[]).includes(entry));
  }
  return out;
}

/** Only forward filters the live backend declared for this search type. */
export function pruneUnsupportedFilters(
  filters: Record<string, string>,
  supported: FilterKey[] | undefined,
): Record<string, string> {
  if (!supported) return {};
  const allowed = new Set<string>(supported);
  return Object.fromEntries(Object.entries(filters).filter(([key]) => allowed.has(key)));
}

export function capabilityForType(type: SearchType): Capability {
  if (type === "people") return "profile_search";
  if (type === "companies") return "company_search";
  return "job_search";
}
