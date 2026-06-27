/**
 * `lore dashboard` — orchestrate local dashboard development environment.
 * Purpose: start in-process lore HTTP server + Vite dev server + auto-open browser,
 *   with local API key bootstrap so the SPA authenticates without user interaction.
 * Public surface: default citty command export; ensureLocalApiKey re-exported for tests.
 * Invariants:
 *   - HTTP server runs in-process (same App, same Database — no fork of lore binary).
 *   - Vite dev server is the only child process.
 *   - SIGINT kills Vite and stops the HTTP server before exiting.
 *   - --no-open skips browser launch.
 *   - Failure to open browser is non-fatal (prints URL and continues).
 * Side-effect class: IO (file system, network, child_process, process signals)
 * Source: SPEC-016 §3.6
 */

import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { startHttpServer } from "../../http/index.js";
import { ensureLocalApiKey } from "../local-key.js";

// Re-export for tests that import from this module path.
export { ensureLocalApiKey } from "../local-key.js";
export type { LocalApiKeyCreator } from "../local-key.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Poll a URL until it returns HTTP 200, or throw on timeout.
 *
 * @param url - URL to poll (GET request).
 * @param timeoutMs - Max wait in milliseconds (default 15 000).
 */
async function waitFor200(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // Server not up yet — retry after 200ms.
    }
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url} to return 200 after ${timeoutMs}ms`);
}

/**
 * Open the given URL in the system default browser.
 * Failure is non-fatal — prints the URL to stdout so the user can open it manually.
 *
 * @param url - URL to open.
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" });
  } catch {
    process.stdout.write(`Could not open browser automatically. Visit: ${url}\n`);
  }
}

// ─── Command ───────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "dashboard",
    description:
      "Run dashboard dev server (Vite) + lore HTTP server in one command, with auto-bootstrapped local auth",
  },
  args: {
    "api-port": {
      type: "string",
      default: "8787",
      description: "Port for the lore HTTP API server (default: 8787)",
    },
    "dashboard-port": {
      type: "string",
      default: "5173",
      description: "Port for the Vite dev server (default: 5173)",
    },
    "no-open": {
      type: "boolean",
      description: "Skip opening the browser",
    },
  },
  async run({ args }) {
    const { app, dbPath } = loadLoreApp();
    const loreDir = dirname(dbPath);
    const projectRoot = dirname(loreDir);

    // Ensure local API key (create if absent, reuse if present). Fail-loud on error.
    const localKey = await ensureLocalApiKey(app.apiKeyStore, loreDir);

    const apiPort = parseInt(args["api-port"] ?? "8787", 10);
    const dashPort = parseInt(args["dashboard-port"] ?? "5173", 10);

    if (isNaN(apiPort) || apiPort < 1 || apiPort > 65535) {
      process.stderr.write("Error: --api-port must be a valid port (1–65535)\n");
      process.exit(1);
    }
    if (isNaN(dashPort) || dashPort < 1 || dashPort > 65535) {
      process.stderr.write("Error: --dashboard-port must be a valid port (1–65535)\n");
      process.exit(1);
    }

    // Start HTTP server in-process — single Database connection, no cross-process sync.
    // reason: In-process server means no IPC latency, no race on .lore/lore.db, and the
    // dashboard and CLI share the same ApiKeyStore + SessionStore instance. SPEC-016 §3.6.
    const server = startHttpServer(app, { port: apiPort, host: "127.0.0.1" });

    // Spawn Vite dev server as the only child process.
    // reason: VITE_LORE_BOOTSTRAP_TOKEN is passed via env (not CLI args) to avoid it
    // appearing in process lists. The Vite plugin reads it server-side only. SPEC-016 §3.7.
    const vite = spawn(
      "bun",
      [
        "run",
        "--filter",
        "@lore/dashboard",
        "dev",
        "--",
        "--port",
        String(dashPort),
      ],
      {
        stdio: "inherit",
        cwd: projectRoot,
        env: { ...process.env, VITE_LORE_BOOTSTRAP_TOKEN: localKey },
      },
    );

    vite.on("error", (err) => {
      process.stderr.write(`[dashboard] Vite process error: ${err.message}\n`);
    });

    // Wait for Vite dev server to respond before opening the browser.
    try {
      await waitFor200(`http://127.0.0.1:${dashPort}/`);
    } catch (err) {
      process.stderr.write(
        `[dashboard] Warning: Vite did not respond in time: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      // Continue anyway — Vite may still be starting up.
    }

    const dashUrl = `http://localhost:${dashPort}/`;
    process.stdout.write(`\nDashboard ready: ${dashUrl}\n`);

    if (!args["no-open"]) {
      openBrowser(dashUrl);
    }

    // Block until SIGINT (Ctrl+C), then tear down gracefully.
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => {
        process.stdout.write("\n[dashboard] Shutting down...\n");

        // Kill Vite child process.
        try {
          vite.kill("SIGTERM");
        } catch {
          // Child may have already exited.
        }

        // Stop HTTP server and release app resources.
        try {
          server.stop(true);
        } catch {
          // Server may have already stopped.
        }

        app.close();
        resolve();
      });
    });

    process.exit(0);
  },
});
