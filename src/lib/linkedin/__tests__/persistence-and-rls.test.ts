import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Json } from "@/integrations/supabase/types";
import { normalizePerson } from "../normalize";
import {
  assertOwner,
  integrationEventFor,
  resultRowsFor,
  savedProfileRowFor,
  searchRowFor,
} from "../persistence";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AT = "2026-01-01T00:00:00.000Z";
const toJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;

describe("LinkedIn persistence ownership", () => {
  const person = normalizePerson({ name: "Ada" }, AT, 0, "linkedin", "agent-reach");
  const result = {
    results: [person],
    backend: "mcp-server-linkedin",
    provider: "agent-reach",
    source: "linkedin" as const,
    isLinkedInSourced: true,
  };

  it("persists search history with authenticated ownership and provenance", () => {
    const row = searchRowFor(
      USER_A,
      { type: "people", query: "Ada", filters: { location: "Cairo" } },
      result,
      42,
    );
    expect(row).toMatchObject({
      user_id: USER_A,
      provider: "agent-reach",
      source: "linkedin",
      is_linkedin_sourced: true,
      result_count: 1,
    });
  });

  it("persists saved results under the authenticated user", () => {
    const [row] = resultRowsFor(USER_A, "search-id", "people", result, toJson);
    expect(row).toMatchObject({
      user_id: USER_A,
      search_id: "search-id",
      provider: "agent-reach",
      source: "linkedin",
      is_linkedin_sourced: true,
    });
  });

  it("persists saved profiles with source metadata", () => {
    const row = savedProfileRowFor(
      USER_A,
      {
        profile_url: "https://www.linkedin.com/in/ada",
        name: "Ada",
        headline: null,
        job_title: null,
        company: null,
        location: null,
        payload: person as unknown as Record<string, unknown>,
        notes: null,
        tags: [],
        favorite: false,
        provider: person.provider,
        source: person.source,
        isLinkedInSourced: person.isLinkedInSourced,
        retrieved_at: person.retrieved_at,
      },
      toJson,
    );
    expect(row.user_id).toBe(USER_A);
    expect(row.provider).toBe("agent-reach");
  });

  it("persists integration health events with caller ownership", () => {
    expect(integrationEventFor(USER_A, { kind: "health_check", status: "success" })).toEqual({
      user_id: USER_A,
      kind: "health_check",
      status: "success",
    });
  });

  it("rejects application-level access to another user's record", () => {
    expect(() => assertOwner(USER_A, USER_B)).toThrowError(
      expect.objectContaining({ code: "LINKEDIN_PERMISSION_DENIED" }),
    );
    expect(() => assertOwner(USER_A, USER_A)).not.toThrow();
  });
});

describe("database RLS ownership policies", () => {
  const migration0 = readFileSync("drizzle/migrations/0000_linkedin_module.sql", "utf8");
  const migration2 = readFileSync(
    "drizzle/migrations/0002_linkedin_provenance_and_event_ownership.sql",
    "utf8",
  );
  const sql = `${migration0}\n${migration2}`;

  it.each(["linkedin_searches", "linkedin_results", "linkedin_saved_profiles"])(
    "%s enables row-level security",
    (table) => {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"),
      );
    },
  );

  it("enforces auth.uid ownership for search history and results", () => {
    expect(sql).toContain("USING (user_id = auth.uid())");
    expect(sql).toContain("WITH CHECK (user_id = auth.uid())");
    expect(migration2).toContain("s.user_id = auth.uid()");
  });

  it("enforces ownership on saved profile reads and modifications", () => {
    for (const operation of ["select", "insert", "update", "delete"]) {
      expect(migration0.toLowerCase()).toContain(`own saved ${operation}`);
    }
  });

  it("limits integration event reads to the owner or an admin", () => {
    expect(migration2).toContain("user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')");
    expect(migration2).toContain('CREATE POLICY "Own integration events insert"');
  });

  it("prevents profile-role self-promotion at the privilege layer", () => {
    expect(migration2).toContain("REVOKE UPDATE ON public.profiles FROM authenticated");
    expect(migration2).not.toMatch(/GRANT UPDATE \([^)]*role[^)]*\)/i);
  });

  it("applies an explicit owner filter in application history queries", () => {
    const functions = readFileSync("src/lib/linkedin/linkedin.functions.ts", "utf8");
    expect(functions).toMatch(
      /from\("linkedin_searches"\)[\s\S]*?\.eq\("user_id", context\.userId\)/,
    );
  });

  it("requires server-function authentication before persistence access", () => {
    const functions = readFileSync("src/lib/linkedin/linkedin.functions.ts", "utf8");
    expect(
      functions.match(/middleware\(\[requireSupabaseAuth\]\)/g)?.length,
    ).toBeGreaterThanOrEqual(6);
  });
});
