#!/usr/bin/env bun

// Mark as ES module so top-level await is valid per TS1375.
export {};

// Detect --mcp-server flag before handing off to citty.
// citty doesn't support top-level flags alongside subcommands,
// so we intercept here before calling runMain().
if (process.argv.includes("--mcp-server")) {
  const { startMcpServer } = await import("./adapters/mcp/index.js");
  const { loadLoreApp } = await import("./adapters/cli/loader.js");
  // SPEC-070 AC-070-9: thread the SAME parsed config the CLI's `lore feed
  // task-start` reads through to the MCP surface, so `lore_feed`'s "task-start"
  // branch resolves `workflow.task_feed.*` budgets identically instead of
  // always falling back to DEFAULT_TASK_START_BUDGETS (previously `config` was
  // destructured off and silently discarded here).
  const { app, config } = loadLoreApp();
  await startMcpServer(app, config);
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
