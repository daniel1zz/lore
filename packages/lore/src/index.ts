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
  // reason: CLI branch ONLY — installSyncStdio replaces console.log/info/warn/
  // error/debug with a writeAllSync-backed implementation immune to the
  // non-blocking-fd1 stdout truncation defect (see stdio-sync.ts's module
  // header for the full empirical root-cause chain + verified repro). MUST
  // run BEFORE citty/consola are imported (consola's own process.stdout
  // access is what triggers Bun's non-blocking-fd1 side effect) and MUST
  // NEVER run on the --mcp-server branch above — stdout there IS the MCP
  // JSON-RPC protocol channel, not free-form CLI output.
  const { installSyncStdio } = await import("./adapters/cli/stdio-sync.js");
  installSyncStdio();
  const { runMain } = await import("citty");
  const { default: main } = await import("./adapters/cli/index.js");
  runMain(main);
}
