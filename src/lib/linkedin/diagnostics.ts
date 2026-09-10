import type { ErrorCode, IntegrationState, ProviderCapabilities, SearchType } from "./types";

/** Client-safe diagnostics shape. Contains no tokens, cookies or session data. */
export type ProviderDiagnostics = {
  id: "lovable-linkedin" | "agent-reach";
  label: string;
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  agent_reach_installed: boolean;
  mcp_available: boolean;
  capabilities: {
    people_search: boolean;
    company_search: boolean;
    job_search: boolean;
    profile_detail: boolean;
  };
  unsupported: SearchType[];
  supported_filters: Partial<Record<SearchType, string[]>>;
  state: IntegrationState;
  message: string | null;
  last_health_check: string | null;
  last_successful_request: string | null;
  last_error: { code: ErrorCode; message: string } | null;
  response_time_ms: number | null;
};

export type DiagnosticsResponse = {
  success: true;
  providers: ProviderDiagnostics[];
  checked_at: string;
};

export function diagnosticsFromCapabilities(
  id: ProviderDiagnostics["id"],
  label: string,
  capabilities: ProviderCapabilities,
  responseTimeMs: number,
): ProviderDiagnostics {
  const has = (c: string) => capabilities.capabilities.includes(c as never);
  const unsupported: SearchType[] = [];
  if (!has("profile_search")) unsupported.push("people");
  if (!has("company_search")) unsupported.push("companies");
  if (!has("job_search")) unsupported.push("jobs");

  return {
    id,
    label,
    configured: true,
    reachable: true,
    authenticated: capabilities.authenticated,
    agent_reach_installed: capabilities.agent_reach_installed,
    mcp_available: capabilities.agent_reach_installed || capabilities.available,
    capabilities: {
      people_search: has("profile_search"),
      company_search: has("company_search"),
      job_search: has("job_search"),
      profile_detail: has("profile_detail"),
    },
    unsupported,
    supported_filters: capabilities.supported_filters as Partial<Record<SearchType, string[]>>,
    state: capabilities.state,
    message: capabilities.message,
    last_health_check: capabilities.checked_at,
    last_successful_request: null,
    last_error: null,
    response_time_ms: responseTimeMs,
  };
}

export function diagnosticsFromError(
  id: ProviderDiagnostics["id"],
  label: string,
  error: { code: ErrorCode; state: IntegrationState; message: string },
  responseTimeMs: number,
  checkedAt: string,
): ProviderDiagnostics {
  return {
    id,
    label,
    configured: error.code !== "LINKEDIN_CONFIGURATION_ERROR",
    reachable: false,
    authenticated: false,
    agent_reach_installed: false,
    mcp_available: false,
    capabilities: {
      people_search: false,
      company_search: false,
      job_search: false,
      profile_detail: false,
    },
    unsupported: ["people", "companies", "jobs"],
    supported_filters: {},
    state: error.state,
    message: error.message,
    last_health_check: checkedAt,
    last_successful_request: null,
    last_error: { code: error.code, message: error.message },
    response_time_ms: responseTimeMs,
  };
}
