/**
 * Capability + status model.
 *
 * The sidecar reports six mutually exclusive statuses so the app never has to
 * guess why a search cannot run:
 *
 *   SERVICE_OFFLINE   - the MCP process is not running / cannot be spawned
 *   LOGIN_REQUIRED    - process runs, but the LinkedIn session is not signed in
 *   SEARCH_UNAVAILABLE- signed in, but no search tool is exposed / usable
 *   SEARCH_SUPPORTED  - signed in and at least one search capability is usable
 *
 * Two orthogonal booleans travel with every status:
 *   connected     - the sidecar reached the MCP process
 *   authenticated - the MCP process holds a signed-in LinkedIn session
 */

export const STATUS = {
  SERVICE_OFFLINE: "SERVICE_OFFLINE",
  LOGIN_REQUIRED: "LOGIN_REQUIRED",
  SEARCH_UNAVAILABLE: "SEARCH_UNAVAILABLE",
  SEARCH_SUPPORTED: "SEARCH_SUPPORTED",
};

const PEOPLE_HINTS = ["search_people", "people_search", "search_profiles", "profile_search"];
const COMPANY_HINTS = ["search_companies", "company_search", "search_organizations"];
const JOB_HINTS = ["search_jobs", "job_search", "jobs_search"];
const PROFILE_HINTS = ["get_profile", "profile_detail", "person_detail", "get_person"];
const SESSION_HINTS = ["session", "me", "whoami", "get_me", "status", "profile_me"];

const PEOPLE_FILTERS = [
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
];
const COMPANY_FILTERS = ["keywords", "company", "industry", "location", "country"];
const JOB_FILTERS = ["keywords", "job_title", "company", "location", "country", "seniority"];

function matches(toolName, hints) {
  const name = String(toolName ?? "").toLowerCase();
  return hints.some((hint) => name.includes(hint));
}

export function findTool(tools, hints) {
  return tools.find((tool) => matches(tool?.name, hints)) ?? null;
}

export function resolveToolMap(tools) {
  return {
    people: findTool(tools, PEOPLE_HINTS),
    companies: findTool(tools, COMPANY_HINTS),
    jobs: findTool(tools, JOB_HINTS),
    profile: findTool(tools, PROFILE_HINTS),
    session: findTool(tools, SESSION_HINTS),
  };
}

/** Intersects the app's filter vocabulary with the tool's declared input schema. */
function supportedFilters(tool, candidates) {
  const properties = tool?.inputSchema?.properties;
  if (!properties || typeof properties !== "object") return candidates;
  const declared = Object.keys(properties).map((key) => key.toLowerCase());
  const usable = candidates.filter((filter) =>
    declared.some((key) => key === filter || key.includes(filter) || filter.includes(key)),
  );
  return usable.length > 0 ? usable : ["keywords"];
}

export function buildCapabilityReport({ running, authenticated, tools, serverInfo, message }) {
  const toolMap = resolveToolMap(tools ?? []);
  const capabilities = [];
  if (toolMap.people) capabilities.push("profile_search");
  if (toolMap.companies) capabilities.push("company_search");
  if (toolMap.jobs) capabilities.push("job_search");
  if (toolMap.profile) capabilities.push("profile_detail");

  const searchCapable = capabilities.some((c) =>
    ["profile_search", "company_search", "job_search"].includes(c),
  );

  let status;
  if (!running) status = STATUS.SERVICE_OFFLINE;
  else if (!authenticated) status = STATUS.LOGIN_REQUIRED;
  else if (!searchCapable) status = STATUS.SEARCH_UNAVAILABLE;
  else status = STATUS.SEARCH_SUPPORTED;

  const available = status === STATUS.SEARCH_SUPPORTED;

  return {
    // ---- fields consumed by the app's normalizeCapabilities() ----
    available,
    authenticated: Boolean(authenticated),
    backend: "mcp-server-linkedin",
    agent_reach_installed: Boolean(running),
    agent_reach_version: serverInfo?.version ?? null,
    capabilities: available ? capabilities : [],
    supported_filters: {
      people: supportedFilters(toolMap.people, PEOPLE_FILTERS),
      companies: supportedFilters(toolMap.companies, COMPANY_FILTERS),
      jobs: supportedFilters(toolMap.jobs, JOB_FILTERS),
    },
    message: message ?? DEFAULT_MESSAGES[status],
    // ---- explicit status surface ----
    status,
    connected: Boolean(running),
    search_supported: available,
    search_unavailable: status === STATUS.SEARCH_UNAVAILABLE,
    login_required: status === STATUS.LOGIN_REQUIRED,
    service_offline: status === STATUS.SERVICE_OFFLINE,
    detected_tools: (tools ?? []).map((tool) => tool?.name).filter(Boolean),
    checked_at: new Date().toISOString(),
  };
}

export const DEFAULT_MESSAGES = {
  [STATUS.SERVICE_OFFLINE]:
    "The LinkedIn search service is offline. The MCP process is not running on the sidecar host.",
  [STATUS.LOGIN_REQUIRED]:
    "The LinkedIn search service is running but not signed in. Run `mcp-server-linkedin --login` on the sidecar host.",
  [STATUS.SEARCH_UNAVAILABLE]:
    "The LinkedIn session is signed in, but the backend exposes no usable search capability.",
  [STATUS.SEARCH_SUPPORTED]: "The LinkedIn search backend is signed in and ready.",
};
