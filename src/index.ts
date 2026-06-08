#!/usr/bin/env bun

// Detect --mcp-server flag before handing off to citty.
// citty doesn't support top-level flags alongside subcommands,
// so we intercept here before calling runMain().
if (process.argv.includes("--mcp-server")) {
  const { startMcpServer } = await import("./adapters/mcp/index.js");
  const { createApp } = await import("./app.js");
  const { findLoreDb } = await import("./adapters/cli/utils.js");
  const dbPath = findLoreDb();
  const app = createApp(dbPath);
  await startMcpServer(app);
} else {
  const { runMain } = await import("citty");
  const { default: main } = await import("./adapters/cli/index.js");
  runMain(main);
}
