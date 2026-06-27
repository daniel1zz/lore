#!/usr/bin/env bun

// Mark as ES module so top-level await is valid per TS1375.
export {};

// Detect --mcp-server flag before handing off to citty.
// citty doesn't support top-level flags alongside subcommands,
// so we intercept here before calling runMain().
if (process.argv.includes("--mcp-server")) {
  const { startMcpServer } = await import("./adapters/mcp/index.js");
  const { loadLoreApp } = await import("./adapters/cli/loader.js");
  const { app } = loadLoreApp();
  await startMcpServer(app);
} else {
  const { runMain } = await import("citty");
  const { default: main } = await import("./adapters/cli/index.js");
  runMain(main);
}
