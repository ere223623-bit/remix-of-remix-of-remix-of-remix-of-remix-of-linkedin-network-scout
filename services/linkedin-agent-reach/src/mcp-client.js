import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * Minimal MCP stdio client (JSON-RPC 2.0 over newline-delimited stdin/stdout).
 * Zero dependencies on purpose: the sidecar must deploy with `node src/server.js`.
 *
 * The child process is `mcp-server-linkedin`, which owns the persisted LinkedIn
 * browser session. Credentials and cookies never leave this host.
 */
export class McpStdioClient {
  #proc = null;
  #pending = new Map();
  #buffer = "";
  #startedAt = null;
  #tools = null;
  #serverInfo = null;
  #lastError = null;
  #starting = null;

  constructor({ command, args, cwd, env, requestTimeoutMs = 60_000, logger = console }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.requestTimeoutMs = requestTimeoutMs;
    this.logger = logger;
  }

  get running() {
    return Boolean(this.#proc) && this.#proc.exitCode === null;
  }

  get serverInfo() {
    return this.#serverInfo;
  }

  get lastError() {
    return this.#lastError;
  }

  get startedAt() {
    return this.#startedAt;
  }

  async ensureStarted() {
    if (this.running) return;
    if (this.#starting) return this.#starting;
    this.#starting = this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start() {
    this.#tools = null;
    this.#lastError = null;
    this.#proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#startedAt = new Date().toISOString();

    this.#proc.stdout.setEncoding("utf8");
    this.#proc.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.#proc.stderr.setEncoding("utf8");
    this.#proc.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      // MCP stderr may contain cookies, profile data, or login details. Record
      // only a classification and never copy the upstream body into logs.
      this.#lastError = classifyMcpText(text);
      this.logger.warn(`[mcp-server-linkedin] ${this.#lastError}`);
    });
    this.#proc.on("error", (error) => {
      this.#lastError = "MCP process error.";
      this.#failAllPending(error);
    });
    this.#proc.on("exit", (code, signal) => {
      this.logger.warn(`[mcp-server-linkedin] exited code=${code} signal=${signal}`);
      this.#failAllPending(new Error("The LinkedIn MCP process exited."));
      this.#proc = null;
      this.#tools = null;
    });

    const init = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "linkedin-agent-reach", version: "1.0.0" },
    });
    this.#serverInfo = init?.serverInfo ?? null;
    this.notify("notifications/initialized", {});
  }

  #onStdout(chunk) {
    this.#buffer += chunk;
    let index;
    while ((index = this.#buffer.indexOf("\n")) !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // non-JSON log line from the child
      }
      if (message.id === undefined) continue; // server notification
      const entry = this.#pending.get(message.id);
      if (!entry) continue;
      this.#pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        const error = new Error(message.error.message ?? "MCP call failed");
        error.mcpCode = message.error.code;
        error.mcpData = message.error.data;
        entry.reject(error);
      } else {
        entry.resolve(message.result);
      }
    }
  }

  #failAllPending(error) {
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
  }

  notify(method, params) {
    if (!this.#proc) return;
    this.#proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params) {
    if (!this.#proc) return Promise.reject(new Error("The LinkedIn MCP process is not running."));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        const error = new Error("The LinkedIn MCP process did not respond in time.");
        error.isTimeout = true;
        reject(error);
      }, this.requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async listTools({ refresh = false } = {}) {
    await this.ensureStarted();
    if (this.#tools && !refresh) return this.#tools;
    const result = await this.request("tools/list", {});
    this.#tools = Array.isArray(result?.tools) ? result.tools : [];
    return this.#tools;
  }

  async callTool(name, args) {
    await this.ensureStarted();
    const result = await this.request("tools/call", { name, arguments: args });
    if (result?.isError) {
      const error = new Error(textOf(result) || "The LinkedIn MCP tool reported an error.");
      error.isToolError = true;
      throw error;
    }
    return result;
  }

  stop() {
    if (this.#proc) this.#proc.kill("SIGTERM");
    this.#proc = null;
  }
}

function classifyMcpText(text) {
  if (/rate|too many|429/i.test(text)) return "MCP provider reported rate limiting.";
  if (/log ?in|sign ?in|unauthorized|not authenticated|session expired/i.test(text)) {
    return "MCP provider requires authentication.";
  }
  if (/restricted|locked|challenge/i.test(text))
    return "MCP provider reported an account restriction.";
  if (/forbidden|permission|access denied/i.test(text)) return "MCP provider denied permission.";
  return "MCP provider wrote an error message.";
}

/** Flattens MCP tool content into text so JSON payloads can be recovered. */
export function textOf(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Extracts structured data from a tool result, tolerating text-wrapped JSON. */
export function dataOf(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = textOf(result);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
