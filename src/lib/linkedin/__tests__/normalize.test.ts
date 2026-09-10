import { describe, expect, it } from "vitest";
import {
  capabilityForType,
  normalizeCapabilities,
  normalizeResults,
  pruneUnsupportedFilters,
} from "../normalize";
import type { CompanyResult, JobResult, PersonResult } from "../types";

const AT = "2026-01-01T00:00:00.000Z";

describe("normalization", () => {
  it("normalizes people results and keeps missing values null", () => {
    const [person] = normalizeResults(
      "people",
      [{ full_name: "Ada Lovelace", location: "Riyadh", unknown_field: "ignored" }],
      AT,
    ) as PersonResult[];

    expect(person.name).toBe("Ada Lovelace");
    expect(person.location).toBe("Riyadh");
    expect(person.headline).toBeNull();
    expect(person.company).toBeNull();
    expect(person.skills).toBeNull();
    expect(person.source).toBe("linkedin");
    expect(person.retrieved_at).toBe(AT);
    // Unknown upstream fields are never carried into the normalized shape.
    expect(Object.keys(person)).not.toContain("unknown_field");
  });

  it("derives job title and company from the first experience entry only", () => {
    const [person] = normalizeResults(
      "people",
      [{ name: "X", experience: [{ title: "Engineer", company: "Acme" }] }],
      AT,
    ) as PersonResult[];
    expect(person.job_title).toBe("Engineer");
    expect(person.company).toBe("Acme");
    expect(person.experience).toHaveLength(1);
  });

  it("normalizes company results", () => {
    const [company] = normalizeResults(
      "companies",
      [{ company_name: "Acme", industry: "Software" }],
      AT,
    ) as CompanyResult[];
    expect(company.name).toBe("Acme");
    expect(company.industry).toBe("Software");
    expect(company.website).toBeNull();
  });

  it("normalizes job results", () => {
    const [job] = normalizeResults(
      "jobs",
      [{ title: "Software Engineer", company: "Acme", posted_at: "2026-01-01" }],
      AT,
    ) as JobResult[];
    expect(job.job_title).toBe("Software Engineer");
    expect(job.published_at).toBe("2026-01-01");
    expect(job.description).toBeNull();
  });

  it("returns an empty array for invalid normalization input", () => {
    expect(normalizeResults("people", null, AT)).toEqual([]);
    expect(normalizeResults("people", "nope", AT)).toEqual([]);
    expect(normalizeResults("people", [1, "a", null], AT)).toEqual([]);
  });

  it("never advertises capabilities the backend did not report", () => {
    const caps = normalizeCapabilities(
      { available: true, authenticated: true, capabilities: ["profile_search", "made_up"] },
      AT,
    );
    expect(caps.capabilities).toEqual(["profile_search"]);
    expect(caps.available).toBe(true);
  });

  it("marks a backend unavailable when it reports no capabilities", () => {
    const caps = normalizeCapabilities({ available: true, authenticated: true, capabilities: [] }, AT);
    expect(caps.available).toBe(false);
  });

  it("reports AUTH_REQUIRED when installed but not authenticated", () => {
    const caps = normalizeCapabilities(
      { available: false, authenticated: false, agent_reach_installed: true, capabilities: [] },
      AT,
    );
    expect(caps.state).toBe("AUTH_REQUIRED");
  });

  it("drops filters the backend did not declare", () => {
    expect(pruneUnsupportedFilters({ keywords: "a", skills: "b" }, ["keywords"])).toEqual({
      keywords: "a",
    });
    expect(pruneUnsupportedFilters({ keywords: "a" }, undefined)).toEqual({});
  });

  it("maps search types to capabilities", () => {
    expect(capabilityForType("people")).toBe("profile_search");
    expect(capabilityForType("companies")).toBe("company_search");
    expect(capabilityForType("jobs")).toBe("job_search");
  });
});
