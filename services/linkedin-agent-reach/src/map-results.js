/**
 * Maps raw mcp-server-linkedin output into the flat shape the app's
 * normalize.ts already understands. Nothing is invented: a field the source did
 * not return is omitted so the app records it as null.
 */

function pick(raw, ...keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function arr(raw, ...keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

export function extractList(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["results", "people", "profiles", "companies", "jobs", "items", "data"]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

export function mapPerson(raw) {
  return dropUndefined({
    id: pick(raw, "id", "urn", "public_identifier", "publicIdentifier", "profile_url", "profileUrl"),
    name: pick(raw, "name", "full_name", "fullName", "title"),
    headline: pick(raw, "headline", "summary_line", "subtitle"),
    job_title: pick(raw, "job_title", "jobTitle", "position", "current_title", "currentTitle"),
    company: pick(raw, "company", "current_company", "currentCompany", "company_name", "organization"),
    location: pick(raw, "location", "geo", "region", "location_name"),
    profile_url: pick(raw, "profile_url", "profileUrl", "url", "link", "public_profile_url"),
    photo_url: pick(raw, "photo_url", "photoUrl", "picture", "profile_picture", "image"),
    industry: pick(raw, "industry", "industry_name"),
    about: pick(raw, "about", "summary", "bio", "description"),
    skills: arr(raw, "skills", "top_skills"),
    education: arr(raw, "education", "educations", "schools"),
    experience: arr(raw, "experience", "experiences", "positions"),
  });
}

export function mapCompany(raw) {
  return dropUndefined({
    id: pick(raw, "id", "urn", "universal_name", "universalName", "linkedin_url", "url"),
    name: pick(raw, "name", "company_name", "companyName", "title"),
    industry: pick(raw, "industry", "industry_name"),
    location: pick(raw, "location", "headquarters", "hq", "region"),
    description: pick(raw, "description", "about", "summary", "tagline"),
    linkedin_url: pick(raw, "linkedin_url", "linkedinUrl", "url", "link", "profile_url"),
    website: pick(raw, "website", "website_url", "domain"),
  });
}

export function mapJob(raw) {
  return dropUndefined({
    id: pick(raw, "id", "job_id", "jobId", "urn", "url"),
    job_title: pick(raw, "job_title", "jobTitle", "title", "position"),
    company: pick(raw, "company", "company_name", "companyName", "organization"),
    location: pick(raw, "location", "job_location", "region"),
    description: pick(raw, "description", "summary", "snippet"),
    linkedin_url: pick(raw, "linkedin_url", "url", "link", "job_url"),
    published_at: pick(raw, "published_at", "posted_at", "postedAt", "listed_at", "date_posted"),
  });
}

export const MAPPERS = {
  people: mapPerson,
  companies: mapCompany,
  jobs: mapJob,
};

function dropUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
