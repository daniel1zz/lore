#!/usr/bin/env bun

// Mark as ES module so top-level await is valid per TS1375.
export {};

// Detect --mcp-server flag before handing off to citty.
// citty doesn't support top-level flags alongside subcommands,
// so we intercept here before calling runMain().
if (process.argv.includes("--mcp-server")) {
  const { startMcpServer } = await import("./adapters/mcp/index.js");
  const { loadLoreApp, loadProjectConfig } = await import("./adapters/cli/loader.js");
  // SPEC-070 F6 (config-staleness fix): pass a GETTER, not the one-time `config`
  // snapshot `loadLoreApp()` returned at server-start — `loadProjectConfig` re-runs
  // the SAME canonical `.lore/config.yaml` parse `loadLoreApp` uses (never a second
  // hand-rolled YAML read) so a long-lived `lore --mcp-server` process observes
  // `workflow.task_feed.*` (and any other config) edits made mid-session, without
  // requiring a restart — the CLI never had this staleness problem because each
  // invocation is a fresh process. `app` itself still comes from the one-time
  // `loadLoreApp()` call (DB connection + services are legitimately long-lived).
  const { app } = loadLoreApp();
  await startMcpServer(app, loadProjectConfig);
} else {
  // reason: the CLI branch lives in adapters/cli/run-cli.ts so the in-process test runner executes the
  // SAME startup sequence (identity resolution, strict usage renderer, runMain exit mapping) as the binary
  // instead of a copy of it. The real process keeps the synchronous stdio console ON.
  const { runCliFromProcess } = await import("./adapters/cli/run-cli.js");
  void runCliFromProcess({ installSyncStdout: true });
}
