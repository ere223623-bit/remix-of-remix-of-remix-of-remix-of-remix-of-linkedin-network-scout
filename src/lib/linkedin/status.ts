import type { IntegrationState, ProviderCapabilities } from "./types";

/**
 * Client-safe presentation of the backend status. Purely derived from the
 * capability report the provider layer already returns — no provider logic here.
 *
 * The six distinguishable outcomes:
 *   connected / authenticated / search supported /
 *   search unavailable / login required / service offline
 */
export type IntegrationStatusKey =
  | "SEARCH_SUPPORTED"
  | "SEARCH_UNAVAILABLE"
  | "LOGIN_REQUIRED"
  | "SERVICE_OFFLINE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NOT_CONFIGURED";

export type IntegrationStatus = {
  key: IntegrationStatusKey;
  label: string;
  detail: string;
  /** The sidecar/connector answered at all. */
  connected: boolean;
  /** A signed-in LinkedIn session exists on the backend. */
  authenticated: boolean;
  /** Real searches can run right now. */
  searchSupported: boolean;
  tone: "ready" | "warning" | "error";
};

const LABELS: Record<IntegrationStatusKey, string> = {
  SEARCH_SUPPORTED: "Search supported",
  SEARCH_UNAVAILABLE: "Search unavailable",
  LOGIN_REQUIRED: "LinkedIn login required",
  SERVICE_OFFLINE: "Search service offline",
  RATE_LIMITED: "Rate limited",
  TIMEOUT: "Backend timed out",
  NOT_CONFIGURED: "Search service not configured",
};

const DETAILS: Record<IntegrationStatusKey, string> = {
  SEARCH_SUPPORTED: "The LinkedIn backend is signed in and can run real searches.",
  SEARCH_UNAVAILABLE:
    "The backend is connected and authenticated, but it exposes no usable search capability.",
  LOGIN_REQUIRED:
    "The search service is running but not signed in to LinkedIn. An administrator must complete the LinkedIn login on the service host.",
  SERVICE_OFFLINE: "The LinkedIn search service is not reachable.",
  RATE_LIMITED: "Too many LinkedIn requests were made. Try again shortly.",
  TIMEOUT: "The LinkedIn backend did not respond in time.",
  NOT_CONFIGURED:
    "The LinkedIn search service address and access token have not been configured yet.",
};

export function deriveIntegrationStatus(
  capabilities: ProviderCapabilities | null,
  error?: { state: IntegrationState; message: string } | null,
): IntegrationStatus {
  const state: IntegrationState = capabilities?.state ?? error?.state ?? "BACKEND_UNAVAILABLE";
  const connected = Boolean(capabilities?.agent_reach_installed || capabilities?.available);
  const authenticated = Boolean(capabilities?.authenticated);
  const searchSupported = Boolean(capabilities?.available && capabilities.capabilities.length > 0);

  let key: IntegrationStatusKey;
  if (searchSupported) key = "SEARCH_SUPPORTED";
  else if (state === "RATE_LIMITED") key = "RATE_LIMITED";
  else if (state === "TIMEOUT") key = "TIMEOUT";
  else if (state === "CONFIGURATION_ERROR") key = "NOT_CONFIGURED";
  else if (state === "AUTH_REQUIRED" || (connected && !authenticated)) key = "LOGIN_REQUIRED";
  else if (connected && authenticated) key = "SEARCH_UNAVAILABLE";
  else key = "SERVICE_OFFLINE";

  return {
    key,
    label: LABELS[key],
    detail: error?.message ?? capabilities?.message ?? DETAILS[key],
    connected,
    authenticated,
    searchSupported,
    tone: key === "SEARCH_SUPPORTED" ? "ready" : key === "LOGIN_REQUIRED" ? "warning" : "error",
  };
}
