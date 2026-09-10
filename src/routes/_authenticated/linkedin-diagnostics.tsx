import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getLinkedInDiagnostics } from "@/lib/linkedin/linkedin.functions";
import type { ProviderDiagnostics } from "@/lib/linkedin/diagnostics";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, RefreshCw, XCircle, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/linkedin-diagnostics")({
  component: DiagnosticsPage,
  head: () => ({
    title: "LinkedIn Backend Diagnostics — Connector & Sidecar Health",
    meta: [
      {
        name: "description",
        content:
          "Live health, authentication and capability status for the Lovable LinkedIn connector and the Agent Reach sidecar.",
      },
      { property: "og:title", content: "LinkedIn Backend Diagnostics" },
      {
        property: "og:description",
        content:
          "Live health, authentication and capability status for the LinkedIn connector and Agent Reach sidecar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Flag({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      {value ? (
        <span className="flex items-center gap-1 text-primary">
          <CheckCircle2 className="h-4 w-4" /> Yes
        </span>
      ) : (
        <span className="flex items-center gap-1 text-destructive">
          <XCircle className="h-4 w-4" /> No
        </span>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-words">{value}</span>
    </div>
  );
}

function fmt(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ProviderCard({ report }: { report: ProviderDiagnostics }) {
  const isSidecar = report.id === "agent-reach";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{report.label}</CardTitle>
        <Badge variant={report.state === "READY" ? "default" : "secondary"}>{report.state}</Badge>
      </CardHeader>
      <CardContent>
        <Flag label="Service configured" value={report.configured} />
        <Flag label={isSidecar ? "Sidecar reachable" : "Provider health"} value={report.reachable} />
        {isSidecar && <Flag label="Agent Reach installed" value={report.agent_reach_installed} />}
        {isSidecar && <Flag label="MCP backend available" value={report.mcp_available} />}
        <Flag label="LinkedIn authentication" value={report.authenticated} />
        <Flag label="People search" value={report.capabilities.people_search} />
        <Flag label="Company search" value={report.capabilities.company_search} />
        <Flag label="Job search" value={report.capabilities.job_search} />
        <Flag label="Profile detail" value={report.capabilities.profile_detail} />
        <Row
          label="Unsupported"
          value={report.unsupported.length ? report.unsupported.join(", ") : "None"}
        />
        <Row label="Last health check" value={fmt(report.last_health_check)} />
        <Row
          label={isSidecar ? "Last successful search" : "Last successful request"}
          value={fmt(report.last_successful_request)}
        />
        <Row
          label="Last error"
          value={report.last_error ? `${report.last_error.code}: ${report.last_error.message}` : "None"}
        />
        <Row
          label="Response time"
          value={report.response_time_ms === null ? "—" : `${report.response_time_ms} ms`}
        />
        {report.message && (
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">{report.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DiagnosticsPage() {
  const queryClient = useQueryClient();
  const fetchDiagnostics = useServerFn(getLinkedInDiagnostics);

  const diagnostics = useQuery({
    queryKey: ["linkedin", "diagnostics"],
    queryFn: () => fetchDiagnostics(),
  });

  const refresh = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ["linkedin", "diagnostics"] });
    await queryClient.invalidateQueries({ queryKey: ["linkedin", "status"] });
    await diagnostics.refetch();
    toast.success(message);
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">LinkedIn backend diagnostics</h1>
          <p className="text-muted-foreground text-sm">
            Live status of both search backends. No tokens, cookies or session data are ever shown.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void refresh("Health check complete.")}
            disabled={diagnostics.isFetching}
          >
            <Activity className="mr-2 h-4 w-4" /> Run health check
          </Button>
          <Button
            onClick={() => void refresh("Capabilities refreshed.")}
            disabled={diagnostics.isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${diagnostics.isFetching ? "animate-spin" : ""}`} />
            Refresh capabilities
          </Button>
        </div>
      </header>

      {diagnostics.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(diagnostics.data?.providers ?? []).map((report) => (
            <ProviderCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </main>
  );
}
