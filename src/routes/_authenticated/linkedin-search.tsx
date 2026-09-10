import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  getLinkedInStatus,
  searchLinkedIn,
  saveLinkedInProfile,
  getLinkedInSearchHistory,
} from "@/lib/linkedin/linkedin.functions";
import { FILTER_LABELS, type FilterKey, type SearchType } from "@/lib/linkedin/types";
import type { AnyResult, PersonResult, CompanyResult, JobResult } from "@/lib/linkedin/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Search,
  AlertTriangle,
  Bookmark,
  ExternalLink,
  History,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/linkedin-search")({
  component: LinkedInSearchPage,
  head: () => ({
    title: "LinkedIn Search — Professional Intelligence Research",
    meta: [
      {
        name: "description",
        content:
          "Search and analyze LinkedIn people, companies, and jobs with structured, source-labelled results.",
      },
      { property: "og:title", content: "LinkedIn Search — Professional Intelligence Research" },
      {
        property: "og:description",
        content:
          "Search and analyze LinkedIn people, companies, and jobs with structured, source-labelled results.",
      },
    ],
  }),
});

const TABS: { value: SearchType; label: string }[] = [
  { value: "people", label: "People" },
  { value: "companies", label: "Companies" },
  { value: "jobs", label: "Jobs" },
];

function LinkedInSearchPage() {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getLinkedInStatus);
  const runSearch = useServerFn(searchLinkedIn);
  const saveProfile = useServerFn(saveLinkedInProfile);
  const fetchHistory = useServerFn(getLinkedInSearchHistory);

  const [type, setType] = useState<SearchType>("people");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});

  const statusQuery = useQuery({
    queryKey: ["linkedin", "status"],
    queryFn: () => fetchStatus(),
    staleTime: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ["linkedin", "history"],
    queryFn: () => fetchHistory(),
  });

  const search = useMutation({
    mutationFn: (vars: { type: SearchType; query: string; filters: Record<string, string> }) =>
      runSearch({ data: { ...vars, limit: 20 } }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["linkedin", "history"] });
      if (!res.success) toast.error(res.error.message);
      else if (res.count === 0) toast.info("The search completed but returned no results.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const save = useMutation({
    mutationFn: (person: PersonResult) =>
      saveProfile({
        data: {
          profile_url: person.profile_url,
          name: person.name,
          headline: person.headline,
          job_title: person.job_title,
          company: person.company,
          location: person.location,
          payload: person as unknown as Record<string, unknown>,
          notes: null,
          tags: [],
          favorite: false,
          retrieved_at: person.retrieved_at,
        },
      }),
    onSuccess: (res) =>
      res.success ? toast.success("Saved to your library.") : toast.error(res.message),
    onError: (err: Error) => toast.error(err.message),
  });

  const capabilities = statusQuery.data?.success ? statusQuery.data.capabilities : null;
  const statusError = statusQuery.data && !statusQuery.data.success ? statusQuery.data.error : null;
  const supportedFilters = capabilities?.supported_filters[type] ?? [];
  const typeSupported =
    capabilities?.capabilities.includes(
      type === "people" ? "profile_search" : type === "companies" ? "company_search" : "job_search",
    ) ?? false;

  const searchResult = search.data;
  const results: AnyResult[] = searchResult?.success ? searchResult.results : [];
  const searchError = searchResult && !searchResult.success ? searchResult.error : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v && v.trim().length > 0),
    ) as Record<string, string>;
    if (!query.trim() && Object.keys(cleaned).length === 0) {
      toast.error("Enter a search term or a filter.");
      return;
    }
    search.mutate({ type, query: query.trim(), filters: cleaned });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">LinkedIn Research</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Discover and analyze people, companies, and roles. Every field shown is source data —
          nothing is inferred or generated.
        </p>
      </header>

      <BackendStatus
        loading={statusQuery.isLoading}
        capabilities={capabilities}
        error={statusError}
        onRefresh={() => statusQuery.refetch()}
      />

      <Card className="mt-6">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <Tabs value={type} onValueChange={(v) => setType(v as SearchType)}>
              <TabsList>
                {TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${type}…`}
                  className="pl-9"
                />
              </div>
              <Button type="submit" disabled={search.isPending || !typeSupported}>
                {search.isPending ? "Searching…" : "Search"}
              </Button>
            </div>

            {supportedFilters.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {supportedFilters.map((key) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`filter-${key}`} className="text-xs">
                      {FILTER_LABELS[key]}
                    </Label>
                    <Input
                      id={`filter-${key}`}
                      value={filters[key] ?? ""}
                      onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                      placeholder="Any"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                The connected backend reports no usable filters for {type}.
              </p>
            )}

            {!typeSupported && capabilities ? (
              <p className="text-muted-foreground text-xs">
                Not supported by the currently configured LinkedIn backend ({type}).
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {searchError ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Search failed — {searchError.state}</AlertTitle>
          <AlertDescription>{searchError.message}</AlertDescription>
        </Alert>
      ) : null}

      {search.isPending ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : null}

      {results.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">
              {results.length} result{results.length === 1 ? "" : "s"}
            </h2>
            {searchResult?.success ? (
              <span className="text-muted-foreground text-xs">
                Source: {searchResult.backend ?? "linkedin"} · retrieved{" "}
                {new Date(searchResult.retrieved_at).toLocaleString()}
              </span>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {results.map((r) => (
              <ResultCard
                key={r.id}
                result={r}
                type={type}
                onSave={(p) => save.mutate(p)}
                saving={save.isPending}
              />
            ))}
          </div>
        </section>
      ) : null}

      {search.isSuccess && searchResult?.success && results.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground text-sm">
              The backend responded successfully but returned no matching records.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
          <History className="h-4 w-4" /> Recent searches
        </h2>
        {historyQuery.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : historyQuery.data && historyQuery.data.length > 0 ? (
          <Card>
            <CardContent className="divide-y p-0">
              {historyQuery.data.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    setType(h.search_type as SearchType);
                    setQuery(h.query);
                    setFilters((h.filters as Record<FilterKey, string>) ?? {});
                  }}
                  className="hover:bg-accent flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant="secondary">{h.search_type}</Badge>
                    <span className="font-medium">{h.query || "(filters only)"}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {h.result_count} result{h.result_count === 1 ? "" : "s"} ·{" "}
                    {new Date(h.created_at).toLocaleString()}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        ) : (
          <p className="text-muted-foreground text-sm">No searches yet.</p>
        )}
      </section>
    </div>
  );
}

function BackendStatus({
  loading,
  capabilities,
  error,
  onRefresh,
}: {
  loading: boolean;
  capabilities: ProviderCapabilities | null;
  error: { code: string; state: string; message: string } | null;
  onRefresh: () => void;
}) {
  if (loading) return <Skeleton className="h-20 w-full rounded-lg" />;

  const status = deriveIntegrationStatus(
    capabilities,
    error ? { state: error.state as ProviderCapabilities["state"], message: error.message } : null,
  );

  const chips: Array<{ label: string; on: boolean }> = [
    { label: "Connected", on: status.connected },
    { label: "Authenticated", on: status.authenticated },
    { label: "Search supported", on: status.searchSupported },
  ];

  return (
    <Alert>
      {status.tone === "ready" ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4" />
      )}
      <AlertTitle className="flex items-center justify-between gap-4">
        <span>
          LinkedIn backend: {status.label}
          {capabilities?.backend ? ` — ${capabilities.backend}` : ""}
        </span>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-check
        </Button>
      </AlertTitle>
      <AlertDescription className="space-y-2 pt-1">
        <p>{status.detail}</p>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Badge key={chip.label} variant={chip.on ? "default" : "outline"}>
              {chip.on ? "✓" : "✕"} {chip.label}
            </Badge>
          ))}
          {(capabilities?.capabilities ?? []).map((c) => (
            <Badge key={c} variant="secondary">
              {c.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function ResultCard({
  result,
  type,
  onSave,
  saving,
}: {
  result: AnyResult;
  type: SearchType;
  onSave: (p: PersonResult) => void;
  saving: boolean;
}) {
  if (type === "people") {
    const p = result as PersonResult;
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{p.name ?? "Unnamed profile"}</CardTitle>
          {p.headline ? <p className="text-muted-foreground text-sm">{p.headline}</p> : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="space-y-1 text-sm">
            <Field label="Title" value={p.job_title} />
            <Field label="Company" value={p.company} />
            <Field label="Location" value={p.location} />
            <Field label="Industry" value={p.industry} />
          </dl>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onSave(p)} disabled={saving}>
              <Bookmark className="mr-1.5 h-3.5 w-3.5" /> Save
            </Button>
            {p.profile_url ? (
              <Button size="sm" variant="ghost" asChild>
                <a href={p.profile_url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> LinkedIn
                </a>
              </Button>
            ) : null}
          </div>
          <SourceLine retrievedAt={p.retrieved_at} />
        </CardContent>
      </Card>
    );
  }

  if (type === "companies") {
    const c = result as CompanyResult;
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{c.name ?? "Unnamed company"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="space-y-1 text-sm">
            <Field label="Industry" value={c.industry} />
            <Field label="Location" value={c.location} />
            <Field label="Website" value={c.website} />
          </dl>
          {c.description ? <p className="text-sm">{c.description}</p> : null}
          <SourceLine retrievedAt={c.retrieved_at} />
        </CardContent>
      </Card>
    );
  }

  const j = result as JobResult;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{j.job_title ?? "Untitled role"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-1 text-sm">
          <Field label="Company" value={j.company} />
          <Field label="Location" value={j.location} />
          <Field label="Published" value={j.published_at} />
        </dl>
        {j.description ? <p className="text-sm">{j.description}</p> : null}
        <SourceLine retrievedAt={j.retrieved_at} />
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground w-20 shrink-0">{label}</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  );
}

function SourceLine({ retrievedAt }: { retrievedAt: string }) {
  return (
    <p className="text-muted-foreground border-t pt-2 text-[11px] uppercase tracking-wide">
      Source data · LinkedIn · retrieved {new Date(retrievedAt).toLocaleString()}
    </p>
  );
}
