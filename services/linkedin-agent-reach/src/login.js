/**
 * Interactive LinkedIn login helper.
 *
 * Runs `mcp-server-linkedin --login` attached to your terminal so the browser
 * flow can complete. The resulting session is persisted by mcp-server-linkedin
 * in its own profile directory (see MCP_PROFILE_DIR / the package's default),
 * which must be a persistent volume on the sidecar host.
 *
 *   node src/login.js
 */
import { spawn } from "node:child_process";

const command = process.env.MCP_COMMAND ?? "mcp-server-linkedin";
const args = [...(process.env.MCP_ARGS ?? "").split(" ").filter(Boolean), "--login"];

console.log(`Starting LinkedIn login: ${command} ${args.join(" ")}`);
const child = spawn(command, args, { stdio: "inherit", env: process.env });
child.on("exit", (code) => {
  console.log(
    code === 0
      ? "Login flow finished. Restart the sidecar and check GET /health for status SEARCH_SUPPORTED."
      : `Login flow exited with code ${code}.`,
  );
  process.exit(code ?? 1);
});
