/**
 * The CLI entry sequence, shared by the real binary (`src/index.ts`) and the in-process test runner
 * (`tests/helpers/run-lore-in-process.ts`, adr-tg-1 option b).
 *
 * Public surface: `runCli(options)`.
 * Invariants:
 *   - reads `process.argv.slice(2)` and `process.cwd()` at call time; it owns no argv/cwd/env parsing of its own.
 *   - every exit goes through `process.exit(code)`: a command's own `exitCode()` mapping (utils.ts), the
 *     identity-argument refusal (2), or citty's `runMain` catch-all (1). There is no second mapping, so a test
 *     that replaces `process.exit` observes the exact code the binary would have returned.
 *   - a run that never calls `process.exit` finished with code 0.
 * Side-effect class: stateful (rewrites `process.argv`, sets the invocation identity, may patch `console`)
 *   plus whatever the dispatched command does.
 *
 * reason: extracted verbatim from the CLI branch of `src/index.ts` (the MCP branch stays there: stdout is its
 * protocol channel and it never runs in-process). Do NOT inline the in-process runner's own copy of this
 * sequence: a second copy would drift from the binary.
 */

/** Options for {@link runCli}. */
export interface RunCliOptions {
  /**
   * Install the non-blocking-fd1-safe console (`stdio-sync.ts`). `true` for the real process; the in-process
   * runner passes `false` because it owns console and stdout capture itself.
   */
  readonly installSyncStdout: boolean;
}

/**
 * Resolve the invocation identity, then dispatch `process.argv.slice(2)` through the CLI command tree.
 *
 * @param options - see {@link RunCliOptions}
 * @returns resolves when the command finished normally; exits through `process.exit` otherwise
 */
export async function runCli(options: RunCliOptions): Promise<void> {
  // reason: CLI branch ONLY — installSyncStdio replaces console.log/info/warn/
  // error/debug with a writeAllSync-backed implementation immune to the
  // non-blocking-fd1 stdout truncation defect (see stdio-sync.ts's module
  // header for the full empirical root-cause chain + verified repro). MUST
  // run BEFORE citty/consola are imported (consola's own process.stdout
  // access is what triggers Bun's non-blocking-fd1 side effect) and MUST
  // NEVER run on the --mcp-server branch — stdout there IS the MCP
  // JSON-RPC protocol channel, not free-form CLI output.
  if (options.installSyncStdout) {
    const { installSyncStdio } = await import("./stdio-sync.js");
    installSyncStdio();
  }
  // spec-run-identity-slice-1 D1: resolve the invocation identity ONCE, here, before any command runs.
  // `--harness-run <id>` is harness-owned: it is consumed (stripped from argv) so no command sees it as an
  // unknown flag, and it is verified against the corpus's run registry at the first write
  // (`withVerifiedWriteContext`, wired by `createApp`). `process.argv` is rewritten because several commands
  // read it directly (`rawArgv`) besides citty's own `rawArgs`.
  const { resolveCliInvocation, setInvocationIdentity } = await import("./invocation-identity.js");
  const { RunIdentityArgumentError } = await import("@lore/core/node");
  try {
    const resolution = resolveCliInvocation(process.argv.slice(2));
    setInvocationIdentity(resolution.identity);
    process.argv = [...process.argv.slice(0, 2), ...resolution.argv];
  } catch (error) {
    if (!(error instanceof RunIdentityArgumentError)) throw error;
    process.stderr.write(`Error: ${error.message}\n`); // CLI surface
    process.exit(2);
  }
  const { runMain } = await import("citty");
  const { default: main } = await import("./index.js");
  // SPEC-073 D2: citty's own built-in `showUsage` renders a multi-char
  // alias (`lore verify`'s `--yes`) with a single dash (`-yes`) — exactly
  // the broken form D1's strict-flag scan now rejects. `renderUsageDoubleDash`
  // is citty's own documented `RunMainOptions.showUsage` override point
  // (`usage-render.ts`'s module header has the full root-cause chain), the
  // ONE composition-site seam this fix needs — no per-command edit, no fork.
  const { renderUsageDoubleDash } = await import("./usage-render.js");
  await runMain(main, { showUsage: renderUsageDoubleDash });
}
