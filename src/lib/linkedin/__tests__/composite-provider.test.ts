import { describe, expect, it, vi } from "vitest";
import { CompositeLinkedInProvider } from "../composite-provider.server";
import { normalizePerson } from "../normalize";
import { LinkedInProviderError, PROVIDER_ERRORS, type LinkedInProvider } from "../provider";
import type { ProviderCapabilities } from "../types";

const AT = "2026-01-01T00:00:00.000Z";
const ARGS = {
  query: "engineer",
  filters: { keywords: "typescript", location: "Cairo", skills: "React" },
  limit: 10,
};

function capabilities(
  available = true,
  supportedFilters: ProviderCapabilities["supported_filters"] = {
    people: ["keywords", "location"],
  },
): ProviderCapabilities {
  return {
    available,
    state: available ? "READY" : "BACKEND_UNAVAILABLE",
    backend: available ? "test-backend" : null,
    agent_reach_installed: true,
    agent_reach_version: "test",
    authenticated: available,
    capabilities: available ? ["profile_search"] : [],
    supported_filters: supportedFilters,
    message: null,
    checked_at: AT,
  };
}

function provider(
  id: string,
  options: {
    caps?: ProviderCapabilities | Error;
    search?: ReturnType<typeof vi.fn>;
    linkedIn?: boolean;
  } = {},
): LinkedInProvider {
  const linkedIn = options.linkedIn ?? true;
  const result = {
    results: [normalizePerson({ name: id }, AT, 0, linkedIn ? "linkedin" : "apollo", id)],
    backend: id,
    provider: id,
    source: linkedIn ? ("linkedin" as const) : ("apollo" as const),
    isLinkedInSourced: linkedIn,
    retrievedAt: AT,
    retrieved_at: AT,
  };
  const getCaps = vi.fn(async () => {
    if (options.caps instanceof Error) throw options.caps;
    return options.caps ?? capabilities();
  });
  const search = options.search ?? vi.fn(async () => result);
  return {
    id,
    label: id,
    source: linkedIn ? "linkedin" : "apollo",
    isLinkedInSourced: linkedIn,
    healthCheck: getCaps,
    getCapabilities: getCaps,
    searchPeople: search,
    searchCompanies: search,
    searchJobs: search,
    getProfile: vi.fn(async () => result.results[0]!),
  };
}

describe("CompositeLinkedInProvider", () => {
  it("uses the primary provider when it supports the requested capability", async () => {
    const primary = provider("lovable-linkedin");
    const fallback = provider("agent-reach");
    const result = await new CompositeLinkedInProvider(primary, fallback).searchPeople(ARGS);
    expect(result.provider).toBe("lovable-linkedin");
    expect(primary.searchPeople).toHaveBeenCalledOnce();
    expect(fallback.searchPeople).not.toHaveBeenCalled();
  });

  it("uses a valid fallback when the primary capability is unsupported", async () => {
    const primary = provider("lovable-linkedin", { caps: capabilities(false) });
    const fallback = provider("agent-reach");
    const result = await new CompositeLinkedInProvider(primary, fallback).searchPeople(ARGS);
    expect(result.provider).toBe("agent-reach");
  });

  it("falls back when a provider is unavailable", async () => {
    const primary = provider("lovable-linkedin", { caps: PROVIDER_ERRORS.unavailable() });
    const fallback = provider("agent-reach");
    await expect(
      new CompositeLinkedInProvider(primary, fallback).searchPeople(ARGS),
    ).resolves.toMatchObject({
      provider: "agent-reach",
    });
  });

  it("reports Agent Reach unavailable when it is the last candidate", async () => {
    const primary = provider("lovable-linkedin", { caps: capabilities(false) });
    const agent = provider("agent-reach", {
      caps: PROVIDER_ERRORS.unavailable("private upstream detail"),
    });
    await expect(
      new CompositeLinkedInProvider(primary, agent).searchPeople(ARGS),
    ).rejects.toMatchObject({
      code: "LINKEDIN_BACKEND_UNAVAILABLE",
      message: "The LinkedIn backend is not reachable.",
    });
  });

  it("reports all providers unavailable", async () => {
    const one = provider("lovable-linkedin", { caps: PROVIDER_ERRORS.unavailable() });
    const two = provider("agent-reach", { caps: PROVIDER_ERRORS.unavailable() });
    await expect(new CompositeLinkedInProvider(one, two).searchPeople(ARGS)).rejects.toMatchObject({
      code: "LINKEDIN_BACKEND_UNAVAILABLE",
    });
  });

  it("preserves and stamps reliable result provenance", async () => {
    const result = await new CompositeLinkedInProvider(provider("agent-reach")).searchPeople(ARGS);
    expect(result).toMatchObject({
      provider: "agent-reach",
      source: "linkedin",
      isLinkedInSourced: true,
      retrievedAt: AT,
    });
    expect(result.results[0]).toMatchObject({
      provider: "agent-reach",
      source: "linkedin",
      isLinkedInSourced: true,
      retrievedAt: AT,
    });
  });

  it("forwards the query and only provider-supported filters", async () => {
    const search = vi.fn(async () => ({
      results: [],
      backend: "agent",
      provider: "agent-reach",
      source: "linkedin" as const,
      isLinkedInSourced: true,
      retrievedAt: AT,
      retrieved_at: AT,
    }));
    const p = provider("agent-reach", { search });
    await new CompositeLinkedInProvider(p).searchPeople(ARGS);
    expect(search).toHaveBeenCalledWith({
      query: "engineer",
      filters: { keywords: "typescript", location: "Cairo" },
      limit: 10,
    });
  });

  it("does not falsely represent undeclared filters", async () => {
    const search = vi.fn(async () => ({
      results: [],
      backend: "agent",
      provider: "agent-reach",
      source: "linkedin" as const,
      isLinkedInSourced: true,
      retrievedAt: AT,
      retrieved_at: AT,
    }));
    const p = provider("agent-reach", { caps: capabilities(true, {}), search });
    await new CompositeLinkedInProvider(p).searchPeople(ARGS);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ filters: {} }));
  });

  it("falls back after a timeout", async () => {
    const primary = provider("lovable-linkedin", {
      search: vi.fn(async () => {
        throw PROVIDER_ERRORS.timeout();
      }),
    });
    const result = await new CompositeLinkedInProvider(
      primary,
      provider("agent-reach"),
    ).searchPeople(ARGS);
    expect(result.provider).toBe("agent-reach");
  });

  it("falls back after a malformed provider response", async () => {
    const malformed = vi.fn(async () => ({ results: "not-an-array" }));
    const primary = provider("lovable-linkedin", { search: malformed });
    const result = await new CompositeLinkedInProvider(
      primary,
      provider("agent-reach"),
    ).searchPeople(ARGS);
    expect(result.provider).toBe("agent-reach");
  });

  it("never exposes an unknown upstream error body", async () => {
    const primary = provider("lovable-linkedin", {
      search: vi.fn(async () => {
        throw new Error("li_at=secret upstream response");
      }),
    });
    const fallback = provider("agent-reach", {
      caps: PROVIDER_ERRORS.unavailable("cookie=secret"),
    });
    await expect(
      new CompositeLinkedInProvider(primary, fallback).searchPeople(ARGS),
    ).rejects.toSatisfy(
      (error: LinkedInProviderError) => !/secret|cookie|li_at/i.test(error.message),
    );
  });

  it.each([
    PROVIDER_ERRORS.authRequired(),
    PROVIDER_ERRORS.permissionDenied(),
    PROVIDER_ERRORS.accountRestricted(),
    PROVIDER_ERRORS.configuration("Safe configuration message."),
    PROVIDER_ERRORS.rateLimited(),
  ])("does not silently fall back for terminal error $code", async (terminalError) => {
    const primary = provider("lovable-linkedin", {
      search: vi.fn(async () => {
        throw terminalError;
      }),
    });
    const fallback = provider("agent-reach");
    await expect(new CompositeLinkedInProvider(primary, fallback).searchPeople(ARGS)).rejects.toBe(
      terminalError,
    );
    expect(fallback.searchPeople).not.toHaveBeenCalled();
  });

  it("excludes enrichment providers from LinkedIn search routing", async () => {
    const apollo = provider("apollo", { linkedIn: false });
    const linkedIn = provider("agent-reach");
    const result = await new CompositeLinkedInProvider(apollo, linkedIn).searchPeople(ARGS);
    expect(result.provider).toBe("agent-reach");
    expect(apollo.searchPeople).not.toHaveBeenCalled();
  });
});
