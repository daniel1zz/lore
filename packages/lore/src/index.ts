#!/usr/bin/env bun

// Mark as ES module so top-level await is valid per TS1375.
export {};

// Detect --mcp-server flag before handing off to citty.
// citty doesn't support top-level flags alongside subcommands,
// so we intercept here before dispatching the command tree.
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
  // reason: the MCP server is an entry like the CLI: it resolves ONE Invocation at start (AS-26) and hands it to the
  // app composition and to the tools, which read ambient facts from it instead of the process.
  const { resolveEntryInvocation } = await import("./adapters/cli/run-cli.js");
  const { CliExit } = await import("./adapters/cli/cli-exit.js");
  try {
    const inv = await resolveEntryInvocation(process.argv.slice(2));
    const { app } = loadLoreApp({ inv });
    await startMcpServer(app, () => loadProjectConfig(inv.io, inv), inv);
  } catch (error) {
    // reason: startup helpers shared with the CLI end a failed start with `exitCli(code)` (a thrown CliExit); this
    // entry is where that becomes the process code, exactly as the CLI branch below does for a returned run.
    if (!(error instanceof CliExit)) throw error;
    process.exit(error.code);
  }
} else {
  // reason: the CLI branch's startup sequence lives in adapters/cli/run-cli.ts so the in-process test runner executes
  // the SAME sequence (strict usage renderer, exit-code mapping) as the binary instead of a copy of it. This entry
  // owns what only the real process has: the synchronous stdio console (non-blocking fd 1, stdio-sync.ts, installed
  // BEFORE citty is imported), the one read of the process into an Invocation, the refusal of a malformed identity
  // flag, and the ONE `process.exit(code)` of the program, fed by the code `runCli` RETURNS
  // (spec-process-state-end-state-one-invocation-per-entry-returned D2).
  const { installSyncStdio } = await import("./adapters/cli/stdio-sync.js");
  installSyncStdio();
  const { resolveEntryInvocation, runCli } = await import("./adapters/cli/run-cli.js");
  const { RunIdentityArgumentError } = await import("@lore/core/node");
  let exitCode: number;
  try {
    exitCode = await runCli(await resolveEntryInvocation(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof RunIdentityArgumentError)) throw error;
    process.stderr.write(`Error: ${error.message}\n`); // CLI surface
    exitCode = 2;
  }
  process.exit(exitCode);
}
