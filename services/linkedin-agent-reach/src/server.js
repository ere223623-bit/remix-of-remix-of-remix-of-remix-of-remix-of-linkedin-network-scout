import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpStdioClient, dataOf } from "./mcp-client.js";
import { buildCapabilityReport, resolveToolMap, STATUS } from "./capability.js";
import { extractList, MAPPERS } from "./map-results.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const TOKEN = process.env.LINKEDIN_SERVICE_TOKEN ?? "";
const MCP_COMMAND = process.env.MCP_COMMAND ?? "mcp-server-linkedin";
const MCP_ARGS = (process.env.MCP_ARGS ?? "").split(" ").filter(Boolean);
const MCP_CWD = process.env.MCP_CWD || undefined;
const REQUEST_TIMEOUT_MS = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? 60_000);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LIMIT = 50;
const RATE_LIMIT = { limit: Number(process.env.RATE_LIMIT ?? 30), windowMs: 60_000 };

if (!TOKEN || TOKEN.length < 32) {
  console.error(
    "LINKEDIN_SERVICE_TOKEN is required and must be at least 32 characters. Refusing to start.",
  );
  process.exit(1);
}

const mcp = new McpStdioClient({
  command: MCP_COMMAND,
  args: MCP_ARGS,
  cwd: MCP_CWD,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT.limit;
}

function authorized(request) {
  const header = request.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function fail(response, status, code, message) {
  send(response, status, { error: { code, message } });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Session probe. Prefers a dedicated session/me tool; otherwise treats a
 * successful tools/list on a started process as "process up, session unknown"
 * and verifies with a 1-result search probe.
 */
async function probeAuthenticated(tools) {
  const { session, people, companies, jobs } = resolveToolMap(tools);
  if (session) {
    try {
      const data = dataOf(await mcp.callTool(session.name, {}));
      if (data && typeof data === "object") {
        if (data.authenticated === false || data.logged_in === false) return false;
        if (
          typeof data.text === "string" &&
          /log ?in|sign ?in|not authenticated/i.test(data.text)
        ) {
          return false;
        }
      }
      return true;
    } catch (error) {
      if (isAuthError(error)) return false;
      // fall through to the search probe
    }
  }
  const probe = people ?? companies ?? jobs;
  if (!probe) return false;
  try {
    await mcp.callTool(probe.name, { keywords: "linkedin", limit: 1, count: 1 });
    return true;
  } catch (error) {
    if (isAuthError(error)) return false;
    // A non-auth failure means signed-in state is unproven but the process
    // answered; report unauthenticated rather than claiming readiness.
    return false;
  }
}

function isAuthError(error) {
  return /log ?in|sign ?in|unauthorized|not authenticated|session expired|cookie/i.test(
    String(error?.message ?? ""),
  );
}

function isPermissionError(error) {
  return /forbidden|permission denied|access denied|not permitted/i.test(
    String(error?.message ?? ""),
  );
}

function isRestrictedError(error) {
  return /account (?:is )?(?:restricted|locked)|security challenge|checkpoint/i.test(
    String(error?.message ?? ""),
  );
}

async function capabilityReport() {
  try {
    const tools = await mcp.listTools();
    const authenticated = await probeAuthenticated(tools);
    return buildCapabilityReport({
      running: mcp.running,
      authenticated,
      tools,
      serverInfo: mcp.serverInfo,
    });
  } catch (error) {
    return buildCapabilityReport({
      running: false,
      authenticated: false,
      tools: [],
      serverInfo: mcp.serverInfo,
      message: isAuthError(error)
        ? "The LinkedIn session requires login on the sidecar host."
        : "The LinkedIn MCP process could not be started on the sidecar host.",
    });
  }
}

async function handleSearch(body) {
  const type = body?.type;
  if (!["people", "companies", "jobs"].includes(type)) {
    return {
      status: 400,
      payload: { error: { code: "BAD_REQUEST", message: "Unknown search type." } },
    };
  }
  const report = await capabilityReport();
  if (report.status === STATUS.SERVICE_OFFLINE) {
    return {
      status: 503,
      payload: {
        error: { code: "LINKEDIN_BACKEND_UNAVAILABLE", message: report.message },
        status: report.status,
      },
    };
  }
  if (report.status === STATUS.LOGIN_REQUIRED) {
    return {
      status: 401,
      payload: {
        error: { code: "LINKEDIN_AUTH_REQUIRED", message: report.message },
        status: report.status,
      },
    };
  }
  if (report.status === STATUS.SEARCH_UNAVAILABLE) {
    return {
      status: 503,
      payload: {
        error: { code: "LINKEDIN_BACKEND_UNAVAILABLE", message: report.message },
        status: report.status,
      },
    };
  }

  const tools = await mcp.listTools();
  const tool = resolveToolMap(tools)[type];
  if (!tool) {
    return {
      status: 503,
      payload: {
        error: {
          code: "LINKEDIN_BACKEND_UNAVAILABLE",
          message: `No ${type} search tool is exposed.`,
        },
      },
    };
  }

  const filters = body?.filters && typeof body.filters === "object" ? body.filters : {};
  const limit = Math.min(Math.max(Number(body?.limit ?? 10) || 10, 1), MAX_LIMIT);
  const args = {
    ...filters,
    ...(body?.query ? { keywords: body.query, query: body.query } : {}),
    limit,
    count: limit,
  };

  try {
    const raw = dataOf(await mcp.callTool(tool.name, args));
    const results = extractList(raw).slice(0, limit).map(MAPPERS[type]);
    return {
      status: 200,
      payload: {
        results,
        backend: "mcp-server-linkedin",
        retrieved_at: new Date().toISOString(),
        status: report.status,
      },
    };
  } catch (error) {
    if (error?.isTimeout) {
      return {
        status: 504,
        payload: {
          error: { code: "LINKEDIN_TIMEOUT", message: "LinkedIn did not respond in time." },
        },
      };
    }
    if (isAuthError(error)) {
      return {
        status: 401,
        payload: {
          error: {
            code: "LINKEDIN_AUTH_REQUIRED",
            message: "The LinkedIn session needs login on the sidecar host.",
          },
        },
      };
    }
    if (isPermissionError(error)) {
      return {
        status: 403,
        payload: {
          error: {
            code: "LINKEDIN_PERMISSION_DENIED",
            message: "The LinkedIn account does not permit this operation.",
          },
        },
      };
    }
    if (isRestrictedError(error)) {
      return {
        status: 423,
        payload: {
          error: {
            code: "LINKEDIN_ACCOUNT_RESTRICTED",
            message: "The LinkedIn account is restricted.",
          },
        },
      };
    }
    if (/rate|too many|429/i.test(String(error?.message))) {
      return {
        status: 429,
        payload: {
          error: { code: "LINKEDIN_RATE_LIMITED", message: "LinkedIn rate limited this session." },
        },
      };
    }
    console.error("[search] LinkedIn backend failed without a safe error classification.");
    return {
      status: 502,
      payload: {
        error: {
          code: "LINKEDIN_BACKEND_UNAVAILABLE",
          message: "The LinkedIn backend failed to complete the search.",
        },
      },
    };
  }
}

async function handleProfile(body) {
  const url = typeof body?.profile_url === "string" ? body.profile_url.trim() : "";
  if (!/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(url)) {
    return {
      status: 400,
      payload: { error: { code: "BAD_REQUEST", message: "A LinkedIn profile URL is required." } },
    };
  }
  const tools = await mcp.listTools();
  const tool = resolveToolMap(tools).profile;
  if (!tool) {
    return {
      status: 503,
      payload: {
        error: {
          code: "LINKEDIN_BACKEND_UNAVAILABLE",
          message: "Profile detail is not supported by this backend.",
        },
      },
    };
  }
  try {
    const raw = dataOf(await mcp.callTool(tool.name, { profile_url: url, url }));
    const profile = MAPPERS.people(raw?.profile ?? raw ?? {});
    return { status: 200, payload: { profile, retrieved_at: new Date().toISOString() } };
  } catch (error) {
    if (isAuthError(error)) {
      return {
        status: 401,
        payload: {
          error: {
            code: "LINKEDIN_AUTH_REQUIRED",
            message: "The LinkedIn session needs login on the sidecar host.",
          },
        },
      };
    }
    if (isPermissionError(error)) {
      return {
        status: 403,
        payload: {
          error: {
            code: "LINKEDIN_PERMISSION_DENIED",
            message: "The LinkedIn account does not permit this operation.",
          },
        },
      };
    }
    if (isRestrictedError(error)) {
      return {
        status: 423,
        payload: {
          error: {
            code: "LINKEDIN_ACCOUNT_RESTRICTED",
            message: "The LinkedIn account is restricted.",
          },
        },
      };
    }
    return {
      status: 502,
      payload: {
        error: {
          code: "LINKEDIN_BACKEND_UNAVAILABLE",
          message: "The profile could not be retrieved.",
        },
      },
    };
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Public liveness only — carries no LinkedIn or session information.
  if (path === "/healthz" && request.method === "GET") {
    return send(response, 200, { ok: true, service: "linkedin-agent-reach" });
  }

  if (!authorized(request)) {
    return fail(response, 401, "UNAUTHORIZED", "A valid service token is required.");
  }

  const clientKey = request.socket.remoteAddress ?? "unknown";
  if (rateLimited(clientKey)) {
    return fail(response, 429, "LINKEDIN_RATE_LIMITED", "Too many requests to the sidecar.");
  }

  try {
    if ((path === "/health" || path === "/status") && request.method === "GET") {
      return send(response, 200, await capabilityReport());
    }
    if (path === "/search" && request.method === "POST") {
      const { status, payload } = await handleSearch(await readJson(request));
      return send(response, status, payload);
    }
    if (path === "/profile" && request.method === "POST") {
      const { status, payload } = await handleProfile(await readJson(request));
      return send(response, status, payload);
    }
    return fail(response, 404, "NOT_FOUND", "Unknown endpoint.");
  } catch (error) {
    console.error("[sidecar] request failed without a safe error classification.");
    return fail(
      response,
      500,
      "LINKEDIN_BACKEND_UNAVAILABLE",
      "The sidecar failed to handle the request.",
    );
  }
});

server.headersTimeout = 65_000;
server.requestTimeout = 90_000;
server.listen(PORT, HOST, () => {
  console.log(`linkedin-agent-reach listening on ${HOST}:${PORT}`);
  mcp.ensureStarted().catch(() => console.error("[mcp] start failed."));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    mcp.stop();
    server.close(() => process.exit(0));
  });
}
