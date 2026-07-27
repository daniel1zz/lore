/**
 * Real `McpRegistrar` (SPEC-046 §Design, P1 port implementation) — shells the
 * `claude` CLI to register/de-register the `lore` MCP server at user scope,
 * via `node:child_process.spawn` and `@lore/core`'s pure argv builders
 * (`buildMcpAddArgs`/`buildMcpRemoveArgs`, `register-mcp.ts`).
 *
 * Public surface:
 *   - RealMcpRegistrar implements McpRegistrar — constructor(env?) (`env`
 *     optional, defaults to `process.env`; the `claude` command is resolved
 *     via `env.PATH`, mirroring `ClaudeCliProvider`)
 *
 * Invariants:
 *   - `node:child_process.spawn`, NOT `Bun.spawn` — the global `Bun` object is
 *     absent inside vitest's worker-thread pool (verified empirically: this
 *     module's own dedicated suite, `real-setup-ports.test.ts`, is a `bunx
 *     vitest` oracle, mirroring `packages/lore/tests/integration/cli/*.test.ts`'s
 *     established `node:child_process` precedent for CLI-integration tests
 *     that must run under vitest, not `.bun.test.ts`). Do not "simplify" this
 *     back to `Bun.spawn` — it would make this port's own test suite silently
 *     untestable under its declared oracle.
 *   - Never throws — `add`/`remove` always resolve to a `Result`, mirroring
 *     `SetupService`'s own "MCP registration failure is NEVER thrown, records
 *     mcp: 'failed'" contract (the CALLER decides how to react; this port
 *     itself never aborts a process).
 *   - `claude` not on `PATH` (spawn emits an `"error"` event, ENOENT) →
 *     `err(VALIDATION_ERROR)` naming the EXACT manual command an operator can
 *     run themselves (`claude mcp add -s user lore -- <binPath> --mcp-server`
 *     / `claude mcp remove -s user lore`) — never a bare "command not found",
 *     since the whole point of this port failing is that the user needs a
 *     literal fallback command, not just a diagnosis.
 *   - A non-zero exit is `err(VALIDATION_ERROR)` carrying up to 500 chars of
 *     stderr (mirrors `claude-cli-provider.ts`'s stderr-tail truncation
 *     precedent, at a smaller cap since this is a short CLI subcommand, not a
 *     generation call) — EXCEPT `add()`'s one documented reclassification
 *     below (idempotency fix, task-lore-setup-mcp-add-step-is-non-idempotent-
 *     already-exists): `claude mcp add` exits 1 with a stderr message
 *     containing "already exists" when the `lore` MCP server is already
 *     registered at user scope — a SECOND `lore setup` run against an
 *     already-converged machine is the expected steady state (SPEC-076 I2
 *     idempotency), not a failure. `add()` treats this ONE stderr shape as
 *     `ok("already_registered")`; every other non-zero exit (missing `claude`,
 *     a genuinely different stderr) still resolves `err(...)` unchanged.
 *     `remove()` keeps its original all-non-zero-exits-are-errors contract —
 *     this task's repro and Scope are add-only.
 *   - argv is built EXCLUSIVELY via `buildMcpAddArgs`/`buildMcpRemoveArgs` —
 *     this class never inlines `["mcp", "add", ...]` itself, so the argv
 *     contract stays defined in exactly one (pure, vitest-tested) place.
 *   - `env` is constructor-injected (default `process.env`) rather than read
 *     ad hoc inside `add`/`remove` — the test suite overrides `PATH` per
 *     scenario (a recording shim directory, or an empty string to force
 *     ENOENT) without ever mutating the real, process-global `process.env`
 *     (a mutate/restore-in-test pattern would race concurrently-running
 *     vitest worker threads in the SAME process).
 *
 * Side-effect class: IO (child_process subprocess).
 * Source: SPEC-046 §Design ("Global MCP registration via `claude mcp add`").
 */

import { spawn } from "node:child_process";

import { buildMcpAddArgs, buildMcpRemoveArgs, err, ok } from "@lore/core";
import type { Result, LoreError } from "@lore/core";

import type { McpAddOutcome, McpRegistrar } from "../service/setup-service.js";

const CLAUDE_COMMAND = "claude";
const STDERR_TAIL_MAX_CHARS = 500;

/** The literal manual fallback for `add(binPath)` — surfaced verbatim in the error message when `claude` is unreachable. */
function manualAddCommand(binPath: string): string {
  return `claude ${buildMcpAddArgs(binPath).join(" ")}`;
}

/** The literal manual fallback for `remove()` — surfaced verbatim in the error message when `claude` is unreachable. */
function manualRemoveCommand(): string {
  return `claude ${buildMcpRemoveArgs().join(" ")}`;
}

/**
 * Detects `claude mcp add`'s "already in desired state" stderr shape (observed
 * literal text: `MCP server lore already exists in user config`). A non-zero
 * exit matching this is an idempotent no-op, not a failure — see this
 * module's header comment ("A non-zero exit is `err(...)` — EXCEPT `add()`'s
 * one documented reclassification").
 */
function isAlreadyRegisteredStderr(stderr: string): boolean {
  return /already exists/i.test(stderr);
}

/**
 * Runs `claude` with the given argv and reports the outcome as a `Result<T, LoreError>`.
 * Shared by `add`/`remove` — the only differences between the two public
 * methods are which argv builder + manual-command renderer they pass in, and
 * (`add` only) the `reclassifyNonZeroExit` idempotency check.
 *
 * @param onExitZero - Value to resolve `ok(...)` with on a clean (exit 0) run.
 * @param reclassifyNonZeroExit - Optional: given the captured stderr of a
 *   non-zero exit, return a value to resolve `ok(...)` with instead of
 *   treating it as a hard failure, or `undefined` to fall through to the
 *   normal `err(...)` path. Omitted entirely by `remove()` — every non-zero
 *   exit there stays a hard failure.
 */
function runClaudeMcpCommand<T>(
  args: string[],
  manualCommand: string,
  env: NodeJS.ProcessEnv,
  onExitZero: T,
  reclassifyNonZeroExit?: (stderr: string) => T | undefined,
): Promise<Result<T, LoreError>> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_COMMAND, args, { stdio: ["ignore", "pipe", "pipe"], env });

    let stderr = "";
    let settled = false;

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (cause) => {
      if (settled) return;
      settled = true;
      resolve(
        err({
          code: "VALIDATION_ERROR",
          field: "claude",
          message:
            `"claude" CLI not found on PATH — could not run the MCP registration step ` +
            `(${cause instanceof Error ? cause.message : String(cause)}). ` +
            `Run it manually: ${manualCommand}`,
          value: CLAUDE_COMMAND,
        }),
      );
    });

    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      if (exitCode !== 0) {
        const reclassified = reclassifyNonZeroExit?.(stderr);
        if (reclassified !== undefined) {
          resolve(ok(reclassified));
          return;
        }
        resolve(
          err({
            code: "VALIDATION_ERROR",
            field: "claude",
            message:
              `"claude ${args.join(" ")}" exited ${exitCode}: ${stderr.slice(0, STDERR_TAIL_MAX_CHARS)}. ` +
              `Run it manually: ${manualCommand}`,
            value: exitCode,
          }),
        );
        return;
      }
      resolve(ok(onExitZero));
    });
  });
}

/**
 * `node:child_process`-backed {@link McpRegistrar}. See module doc for the
 * ENOENT/nonzero-exit contract.
 */
export class RealMcpRegistrar implements McpRegistrar {
  /**
   * @param env - Environment passed to the spawned `claude` process.
   *   Defaults to the current process's own env (production use — `claude`
   *   is resolved off the invoking user's real `PATH`). Overridable for
   *   deterministic testing (`real-setup-ports.test.ts` injects a `PATH`
   *   pointing at a recording shim, or an EMPTY `PATH` to force the ENOENT
   *   path) WITHOUT mutating the global `process.env` — vitest's worker
   *   pool can run other test files concurrently in the same process, and
   *   `process.env` is process-global, so a test-local mutate/restore of it
   *   would be a real cross-file race.
   */
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async add(binPath: string): Promise<Result<McpAddOutcome, LoreError>> {
    return runClaudeMcpCommand(buildMcpAddArgs(binPath), manualAddCommand(binPath), this.env, "added", (stderr) =>
      isAlreadyRegisteredStderr(stderr) ? "already_registered" : undefined,
    );
  }

  async remove(): Promise<Result<void, LoreError>> {
    return runClaudeMcpCommand(buildMcpRemoveArgs(), manualRemoveCommand(), this.env, undefined);
  }
}
