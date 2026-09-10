import { z } from "zod";

export const searchTypeSchema = z.enum(["people", "companies", "jobs"]);

const filterValue = z.string().trim().min(1).max(200);

export const filterKeySchema = z.enum([
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
]);

export const searchRequestSchema = z.object({
  type: searchTypeSchema,
  query: z.string().trim().max(300).default(""),
  filters: z.record(filterKeySchema, filterValue).default({}),
  limit: z.number().int().min(1).max(50).default(20),
});

export type SearchRequestInput = z.input<typeof searchRequestSchema>;
export type SearchRequest = z.output<typeof searchRequestSchema>;

/** A search must have something to search on. */
export function assertSearchable(req: SearchRequest): boolean {
  return req.query.length > 0 || Object.keys(req.filters).length > 0;
}

export const profileRequestSchema = z.object({
  profile_url: z.string().trim().url().max(500),
});

export const savedProfileInputSchema = z.object({
  profile_url: z.string().trim().url().max(500).nullable(),
  name: z.string().trim().max(200).nullable(),
  headline: z.string().trim().max(500).nullable(),
  job_title: z.string().trim().max(200).nullable(),
  company: z.string().trim().max(200).nullable(),
  location: z.string().trim().max(200).nullable(),
  payload: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().trim().max(4000).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  favorite: z.boolean().default(false),
  retrieved_at: z.string().nullable().default(null),
});

export type SavedProfileInput = z.input<typeof savedProfileInputSchema>;

/** Hard cap on incoming request bodies (bytes) for the raw HTTP endpoint. */
export const MAX_REQUEST_BYTES = 8 * 1024;
