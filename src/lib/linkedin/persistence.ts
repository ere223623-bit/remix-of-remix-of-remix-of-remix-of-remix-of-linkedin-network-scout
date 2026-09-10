import type { Json } from "@/integrations/supabase/types";
import { PROVIDER_ERRORS } from "./provider";
import type { AnyResult, DataSource, SearchType } from "./types";

export type PersistedSearch = {
  results: AnyResult[];
  backend: string | null;
  provider: string;
  source: DataSource;
  isLinkedInSourced: boolean;
};

export function searchRowFor(
  userId: string,
  request: { type: SearchType; query: string; filters: Record<string, string> },
  result: PersistedSearch,
  durationMs: number,
) {
  return {
    user_id: userId,
    search_type: request.type,
    query: request.query,
    filters: request.filters,
    result_count: result.results.length,
    backend: result.backend,
    provider: result.provider,
    source: result.source,
    is_linkedin_sourced: result.isLinkedInSourced,
    status: "READY" as const,
    duration_ms: durationMs,
  };
}

export function resultRowsFor(
  userId: string,
  searchId: string,
  type: SearchType,
  result: PersistedSearch,
  toJson: (value: unknown) => Json,
) {
  return result.results.map((record) => ({
    user_id: userId,
    search_id: searchId,
    result_type: type,
    payload: toJson(record),
    source: record.source,
    provider: record.provider,
    is_linkedin_sourced: record.isLinkedInSourced,
    backend: result.backend,
    retrieved_at: record.retrieved_at,
  }));
}

export function integrationEventFor<T extends Record<string, unknown>>(userId: string, event: T) {
  return { ...event, user_id: userId };
}

export function savedProfileRowFor(
  userId: string,
  data: {
    profile_url: string | null;
    name: string | null;
    headline: string | null;
    job_title: string | null;
    company: string | null;
    location: string | null;
    payload: Record<string, unknown>;
    notes: string | null;
    tags: string[];
    favorite: boolean;
    provider: string;
    source: DataSource;
    isLinkedInSourced: boolean;
    retrieved_at: string | null;
  },
  toJson: (value: unknown) => Json,
) {
  return {
    user_id: userId,
    profile_url: data.profile_url,
    name: data.name,
    headline: data.headline,
    job_title: data.job_title,
    company: data.company,
    location: data.location,
    payload: toJson(data.payload),
    notes: data.notes,
    tags: data.tags,
    favorite: data.favorite,
    provider: data.provider,
    source: data.source,
    is_linkedin_sourced: data.isLinkedInSourced,
    retrieved_at: data.retrieved_at,
  };
}

export function assertOwner(authenticatedUserId: string, recordUserId: string) {
  if (authenticatedUserId !== recordUserId) {
    throw PROVIDER_ERRORS.permissionDenied("You cannot access another user's LinkedIn data.");
  }
}
