import { createServerFn } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import {
  profileRequestSchema,
  savedProfileInputSchema,
  searchRequestSchema,
  assertSearchable,
} from "./schemas";
import { checkRateLimit, SEARCH_RATE_LIMIT } from "./rate-limit.server";
import { LinkedInProviderError, PROVIDER_ERRORS } from "./provider";
import {
  integrationEventFor,
  resultRowsFor,
  savedProfileRowFor,
  searchRowFor,
} from "./persistence";
import {
  diagnosticsFromCapabilities,
  diagnosticsFromError,
  type DiagnosticsResponse,
} from "./diagnostics";
import type { AnyResult, ApiErrorResponse, SearchResponse, ProviderCapabilities } from "./types";

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

export type StatusResponse =
  { success: true; capabilities: ProviderCapabilities } | ApiErrorResponse;

export type SearchFnResponse = SearchResponse<AnyResult> | ApiErrorResponse;

function errorResponse(error: LinkedInProviderError): ApiErrorResponse {
  return {
    success: false,
    error: { code: error.code, state: error.state, message: error.message },
  };
}

function recordError(
  error: LinkedInProviderError | Error,
  _type: "people" | "companies" | "jobs",
): SearchFnResponse {
  const providerErr =
    error instanceof LinkedInProviderError
      ? error
      : new LinkedInProviderError(
          "LINKEDIN_BACKEND_UNAVAILABLE",
          "BACKEND_UNAVAILABLE",
          "The LinkedIn backend failed unexpectedly.",
        );
  return errorResponse(providerErr);
}

export const getLinkedInStatus = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }): Promise<StatusResponse> => {
    const start = performance.now();
    try {
      const { createLinkedInProvider } = await import("./factory.server");
      const provider = createLinkedInProvider();
      const capabilities = await provider.getCapabilities();
      await context.supabase.from("linkedin_integration_events").insert(
        integrationEventFor(context.userId, {
          kind: "health_check",
          status: capabilities.available ? "success" : "unavailable",
          backend: capabilities.backend,
          detail: { provider: provider.id, capabilities },
          duration_ms: Math.round(performance.now() - start),
        }),
      );
      return { success: true, capabilities };
    } catch (error) {
      const providerErr =
        error instanceof LinkedInProviderError
          ? error
          : new LinkedInProviderError(
              "LINKEDIN_BACKEND_UNAVAILABLE",
              "BACKEND_UNAVAILABLE",
              "The LinkedIn backend failed unexpectedly.",
            );
      await context.supabase.from("linkedin_integration_events").insert(
        integrationEventFor(context.userId, {
          kind: "health_check",
          status: "error",
          backend: null,
          detail: { error: providerErr.message, code: providerErr.code },
          duration_ms: Math.round(performance.now() - start),
        }),
      );
      return errorResponse(providerErr);
    }
  });

export const searchLinkedIn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((input: unknown) => searchRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<SearchFnResponse> => {
    if (!assertSearchable(data)) {
      return {
        success: false,
        error: {
          code: "LINKEDIN_INVALID_INPUT",
          state: "CONFIGURATION_ERROR",
          message: "Enter a query or at least one filter.",
        },
      };
    }

    const rate = checkRateLimit(
      `search:${context.userId}`,
      SEARCH_RATE_LIMIT.limit,
      SEARCH_RATE_LIMIT.windowMs,
    );
    if (!rate.allowed) {
      return {
        success: false,
        error: {
          code: "LINKEDIN_RATE_LIMITED",
          state: "RATE_LIMITED",
          message: `Too many searches. Retry in ${rate.retryAfterSeconds}s.`,
        },
      };
    }

    const start = performance.now();

    try {
      const { createLinkedInProvider } = await import("./factory.server");
      const provider = createLinkedInProvider();

      let result:
        | {
            results: AnyResult[];
            backend: string | null;
            retrieved_at: string;
            retrievedAt: string;
            provider: string;
            source: AnyResult["source"];
            isLinkedInSourced: boolean;
          }
        | undefined;
      if (data.type === "people") {
        result = await provider.searchPeople(data);
      } else if (data.type === "companies") {
        result = await provider.searchCompanies(data);
      } else {
        result = await provider.searchJobs(data);
      }

      const durationMs = Math.round(performance.now() - start);
      const searchRow = searchRowFor(context.userId, data, result, durationMs);

      const { data: inserted, error: insertError } = await context.supabase
        .from("linkedin_searches")
        .insert(searchRow)
        .select("id")
        .single();

      if (insertError) {
        console.error("Failed to record search:", insertError);
      }

      if (inserted && result.results.length > 0) {
        const resultRows = resultRowsFor(context.userId, inserted.id, data.type, result, toJson);
        const { error: resultsError } = await context.supabase
          .from("linkedin_results")
          .insert(resultRows);
        if (resultsError) console.error("Failed to record results:", resultsError);
      }

      await context.supabase.from("linkedin_integration_events").insert(
        integrationEventFor(context.userId, {
          kind: "search",
          status: "success",
          backend: result.backend,
          detail: { provider: result.provider, type: data.type, count: result.results.length },
          duration_ms: durationMs,
        }),
      );

      return {
        success: true,
        query: data,
        results: result.results,
        count: result.results.length,
        backend: result.backend,
        provider: result.provider,
        source: result.source,
        isLinkedInSourced: result.isLinkedInSourced,
        retrievedAt: result.retrievedAt,
        retrieved_at: result.retrieved_at,
      };
    } catch (error) {
      const response = recordError(error as Error, data.type);
      const errorMessage = !response.success ? response.error.message : "Unknown error";
      const errorCode = !response.success ? response.error.code : "LINKEDIN_BACKEND_UNAVAILABLE";
      await context.supabase.from("linkedin_integration_events").insert(
        integrationEventFor(context.userId, {
          kind: "search",
          status: "error",
          backend: null,
          detail: { error: errorMessage, code: errorCode, type: data.type },
          duration_ms: Math.round(performance.now() - start),
        }),
      );
      return response;
    }
  });

export const getLinkedInProfile = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((input: unknown) => profileRequestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createLinkedInProvider } = await import("./factory.server");
    const provider = createLinkedInProvider();
    try {
      const profile = await provider.getProfile(data.profile_url);
      return { success: true as const, profile };
    } catch (error) {
      return recordError(error as Error, "people");
    }
  });

export const saveLinkedInProfile = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((input: unknown) => savedProfileInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const row = savedProfileRowFor(context.userId, data, toJson);

    const { error } = await context.supabase.from("linkedin_saved_profiles").insert(row);

    if (error) {
      console.error("Failed to save profile:", error);
      return { success: false as const, message: "Could not save profile." };
    }

    return { success: true as const };
  });

export const getLinkedInSearchHistory = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("linkedin_searches")
      .select(
        "id, search_type, query, filters, result_count, backend, provider, source, is_linkedin_sourced, status, created_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Failed to load search history:", error);
      return [];
    }
    return data ?? [];
  });

// ---------------------------------------------------------------------------
// Admin diagnostics: per-provider health, never exposing tokens or session data.
// ---------------------------------------------------------------------------

export const getLinkedInDiagnostics = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }): Promise<DiagnosticsResponse> => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError || !isAdmin) {
      throw PROVIDER_ERRORS.permissionDenied("Administrator access is required for diagnostics.");
    }
    const { createProviderSet } = await import("./factory.server");
    const { linkedInConnector, apollo, agentReach } = createProviderSet();

    const providers = await Promise.all(
      [
        {
          provider: linkedInConnector,
          id: "lovable-linkedin" as const,
          label: "Lovable LinkedIn connector",
        },
        { provider: apollo, id: "apollo" as const, label: "Apollo professional data" },
        { provider: agentReach, id: "agent-reach" as const, label: "Agent Reach sidecar" },
      ].map(async ({ provider, id, label }) => {
        const start = performance.now();
        try {
          const capabilities = await provider.healthCheck();
          return diagnosticsFromCapabilities(
            id,
            label,
            capabilities,
            Math.round(performance.now() - start),
          );
        } catch (error) {
          const err =
            error instanceof LinkedInProviderError
              ? error
              : new LinkedInProviderError(
                  "LINKEDIN_BACKEND_UNAVAILABLE",
                  "BACKEND_UNAVAILABLE",
                  error instanceof Error ? error.message : String(error),
                );
          return diagnosticsFromError(
            id,
            label,
            { code: err.code, state: err.state, message: err.message },
            Math.round(performance.now() - start),
            new Date().toISOString(),
          );
        }
      }),
    );

    // Attach the last successful search per provider from the event log.
    const { data: events } = await context.supabase
      .from("linkedin_integration_events")
      .select("kind, status, backend, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    for (const report of providers) {
      const lastSuccess = (events ?? []).find(
        (e) =>
          e.status === "success" &&
          e.kind === "search" &&
          (e.detail as { provider?: string } | null)?.provider === report.id,
      );
      if (lastSuccess) report.last_successful_request = lastSuccess.created_at;

      if (!report.last_error) {
        const lastError = (events ?? []).find(
          (e) =>
            e.status === "error" &&
            (e.detail as { provider?: string } | null)?.provider === report.id,
        );
        const detail = lastError?.detail as { code?: string; error?: string } | null;
        if (lastError && detail?.error) {
          report.last_error = {
            code:
              (detail.code as ApiErrorResponse["error"]["code"]) ?? "LINKEDIN_BACKEND_UNAVAILABLE",
            message: detail.error,
          };
        }
      }
    }

    return { success: true, providers, checked_at: new Date().toISOString() };
  });
