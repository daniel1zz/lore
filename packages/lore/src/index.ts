#!/usr/bin/env bun

// Mark as ES module so top-level await is valid per TS1375.
export {};

// reason: the CLI's startup sequence lives in adapters/cli/run-cli.ts so the in-process test runner executes
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
