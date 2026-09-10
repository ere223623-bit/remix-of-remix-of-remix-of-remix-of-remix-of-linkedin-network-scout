import { describe, expect, it } from "vitest";
import {
  AgentReachLinkedInProvider,
  readAgentReachConfig,
} from "../agent-reach-provider.server";
import { LinkedInProviderError } from "../provider";

const HEALTH = {
  available: true,
  authenticated: true,
  agent_reach_installed: true,
  backend: "mcp-server-linkedin",
  capabilities: ["profile_search", "company_search", "job_search", "profile_detail"],
  supported_filters: { people: ["keywords", "location"] },
};

function provider(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return new AgentReachLinkedInProvider({
    baseUrl: "https://sidecar.example.com",
    token: "t".repeat(40),
    timeoutMs: 1000,
    fetchImpl: ((url: string, init: RequestInit) =>
      Promise.resolve(handler(url, init))) as unknown as typeof fetch,
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Agent Reach provider", () => {
  it("requires configuration", () => {
    expect(() => readAgentReachConfig({})).toThrow(LinkedInProviderError);
    const config = readAgentReachConfig({
      LINKEDIN_SERVICE_URL: "https://x.example.com/",
      LINKEDIN_SERVICE_TOKEN: "abc",
    });
    expect(config.baseUrl).toBe("https://x.example.com");
  });

  it("reports capabilities from the health endpoint", async () => {
    const caps = await provider(() => json(HEALTH)).healthCheck();
    expect(caps.available).toBe(true);
    expect(caps.authenticated).toBe(true);
    expect(caps.capabilities).toContain("profile_search");
    expect(caps.supported_filters.people).toEqual(["keywords", "location"]);
  });

  it("sends the bearer token server-side only", async () => {
    let seenAuth: string | null = null;
    await provider((_url, init) => {
      seenAuth = (init.headers as Record<string, string>)["authorization"] ?? null;
      return json(HEALTH);
    }).healthCheck();
    expect(seenAuth).toBe(`Bearer ${"t".repeat(40)}`);
  });

  it("surfaces an offline sidecar as backend unavailable", async () => {
    const p = provider(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(p.healthCheck()).rejects.toMatchObject({
      code: "LINKEDIN_BACKEND_UNAVAILABLE",
    });
  });

  it("surfaces a timeout", async () => {
    const p = new AgentReachLinkedInProvider({
      baseUrl: "https://sidecar.example.com",
      token: "t".repeat(40),
      timeoutMs: 1000,
      fetchImpl: (() => {
        const err = new Error("aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      }) as unknown as typeof fetch,
    });
    await expect(p.healthCheck()).rejects.toMatchObject({ code: "LINKEDIN_TIMEOUT" });
  });

  it("surfaces sidecar authentication failure", async () => {
    await expect(provider(() => json({}, 401)).healthCheck()).rejects.toMatchObject({
      code: "LINKEDIN_AUTH_REQUIRED",
    });
  });

  it("surfaces rate limiting", async () => {
    await expect(provider(() => json({}, 429)).healthCheck()).rejects.toMatchObject({
      code: "LINKEDIN_RATE_LIMITED",
    });
  });

  it("rejects malformed JSON", async () => {
    const p = provider(() => new Response("<html>oops</html>", { status: 200 }));
    await expect(p.healthCheck()).rejects.toMatchObject({ code: "LINKEDIN_INVALID_RESPONSE" });
  });

  it("rejects a malformed search payload", async () => {
    const p = provider((url) =>
      url.endsWith("/health") ? json(HEALTH) : json({ results: "not-an-array" }),
    );
    await expect(p.searchPeople({ query: "a", filters: {}, limit: 5 })).rejects.toMatchObject({
      code: "LINKEDIN_INVALID_RESPONSE",
    });
  });

  it("never forwards an upstream error body verbatim", async () => {
    const p = provider(() => json({ secret_cookie: "li_at=abc", message: "li_at=abc" }, 500));
    await expect(p.healthCheck()).rejects.toSatisfy(
      (e: LinkedInProviderError) => !e.message.includes("li_at"),
    );
  });

  it("returns normalized results and prunes unsupported filters", async () => {
    let body: Record<string, unknown> = {};
    const p = provider((url, init) => {
      if (url.endsWith("/health")) return json(HEALTH);
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json({
        results: [{ full_name: "Ada", headline: "Engineer" }],
        backend: "mcp-server-linkedin",
        retrieved_at: "2026-01-01T00:00:00.000Z",
      });
    });

    const result = await p.searchPeople({
      query: "Software Engineer",
      filters: { keywords: "engineer", skills: "dropped" },
      limit: 5,
    });

    expect(body["filters"]).toEqual({ keywords: "engineer" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.name).toBe("Ada");
    expect(result.results[0]!.source).toBe("linkedin");
  });
});
