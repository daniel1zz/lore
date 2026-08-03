/**
 * Runner-capture mechanism for `lore evidence` / `lore_evidence_add` — the ONE
 * implementation of "lore spawns the oracle command itself and records its real
 * stdout+stderr", shared verbatim by the CLI (`cli/commands/evidence.ts`) and
 * the MCP adapter (`mcp/tools.ts`).
 *
 * Why this module exists (task-mcp-lore-evidence-add-cannot-set-capture-source-
 * and-has-no): the capture spawn was born INLINE in the CLI command
 * (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the), so MCP had
 * no way to reach it and an agent using lore THROUGH MCP was structurally
 * unable to produce a `capture_source: "runner"` row at all — while a
 * self-reported `pass` with no captured tail is REFUSED. That made a passing
 * oracle unrecordable over MCP. Extracting rather than re-implementing is
 * deliberate: a second copy of this logic is exactly the divergence hazard
 * task-two-independent-copies-of-does-this-task-have-a-claim-now was filed
 * about, one layer down.
 *
 * ⛔ `capture_source` is DERIVED HERE, never accepted from a caller. The
 * `"runner"` label is stamped only on the path where THIS process observed the
 * child's real exit code and read its real output. There is deliberately no
 * input field on any adapter through which a caller could assert `"runner"` —
 * that would be a label with nothing behind it (option (a) of the governing
 * task, explicitly rejected as "a self-report wearing a runner's label").
 *
 * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the — the three
 * questions this mechanism answers:
 *
 *   Q1 Proxy — is "lore spawned this command and captured its output" a proxy
 *     for "this oracle really passed"? It is a PROXY, and the residual is
 *     NAMED: the caller still chooses WHICH command and (via {@link
 *     CaptureRequest.cwd}) WHERE it runs, so a caller determined to
 *     manufacture a green row can pick a vacuous command (`true`, a test glob
 *     matching nothing) in a directory where it trivially succeeds. Accepted,
 *     because it is EXACTLY the residual the CLI's `--capture` already
 *     carries — a fresh CLI subprocess also runs whatever command the agent
 *     typed, in whatever directory the agent stood in. What capture removes is
 *     the strictly larger hole underneath it: a hand-authored `output_tail`
 *     that never corresponded to any execution at all. Narrowing the
 *     command-choice residual is the separate job of `lore verify`'s
 *     command-provenance approval gate (SPEC-039 §M2), not of this module.
 *     What CANNOT be forged here: the tail itself (the caller never supplies
 *     one on this path — {@link findCaptureFlagConflict} refuses the
 *     combination) and the declared/observed exit-code agreement (cross-checked
 *     below, mismatch → refusal, nothing recorded).
 *   Q2 Silence — what happens when the capture cannot be measured? Never a
 *     silent downgrade to `"self-report"` and never a recorded row: a spawn
 *     failure, a signal kill (including this module's own timeout, where NO
 *     exit code was ever observed), and a declared-vs-observed exit-code
 *     mismatch each return an explicit `LoreError` and the caller records
 *     NOTHING. An empty captured output is preserved as the empty string
 *     rather than being replaced by a placeholder, so "the command really
 *     printed nothing" stays distinguishable from "we did not capture".
 *   Q3 Opt-in — capture is opt-in per call (`--capture` / `capture: true`) and
 *     that is intentional: `--oracle manual` has no command whose exit code
 *     means anything, and a `fail`/`expected-fail` row is often recorded for a
 *     run the agent already performed. What is NOT opt-in is the LABEL: every
 *     write through either adapter stamps `capture_source` explicitly, and the
 *     absence of capture stamps `"self-report"` rather than omitting the field.
 *
 * @module
 */

import { spawnSync } from "node:child_process";

import { tailChars, type CaptureSource, type LoreError } from "@lore/core";

/**
 * Fixed timeout for the capture spawn (task-a-non-empty-output-tail-can-be-
 * hand-authored-prose-and-the) — 10 minutes, matching this harness's own
 * Bash-tool maximum. Deliberately NOT caller-configurable on either adapter: a
 * capture is meant for a single scoped oracle command (`bun run typecheck`, one
 * `vitest run <file>` invocation), not a full test suite — `bun run
 * test:changed` / individual test-file commands documented across this repo's
 * own CLAUDE.md all comfortably finish well inside this window.
 */
export const CAPTURE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * `spawnSync`'s own captured-buffer ceiling (CLAUDE.md standing lesson: a spawn
 * capturing growing output MUST set an explicit `maxBuffer` — the 1 MiB Node
 * default silently truncates). Generous relative to the {@link
 * CAPTURE_TAIL_CHARS}-char tail that actually gets persisted — this only bounds
 * what `spawnSync` buffers in memory before `tailChars` trims it.
 */
export const CAPTURE_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

/** Persisted `output_tail` ceiling — mirrors `evidenceEntrySchema`'s own max. */
export const CAPTURE_TAIL_CHARS = 4000;

/** What to spawn, where, and what the caller claims the outcome will be. */
export interface CaptureRequest {
  /** The oracle command, run through a shell exactly as the caller wrote it. */
  command: string;
  /**
   * Working directory for the spawn — ALWAYS passed explicitly by the caller,
   * never defaulted inside this module. The CLI passes its own `process.cwd()`
   * (correct by construction: a fresh subprocess inherits the agent's real
   * shell cwd). MCP passes the caller-declared `caller_cwd` and REFUSES the
   * capture request outright when that field is absent — a long-lived stdio
   * server's own `process.cwd()` is fixed at startup and is exactly the wrong
   * value (see `mcp/tools.ts`'s `resolveMcpCallerCwd` JSDoc for why a
   * wrong-but-plausible default is worse than an honest refusal).
   */
  cwd: string;
  /** The `--result` / `result` the caller declared, cross-checked against the real exit code. */
  declaredResult: string;
}

/**
 * A successful capture: the tail is the child's REAL combined output and the
 * label is fixed to `"runner"` (never parameterised — see this module's header).
 */
export interface CaptureSuccess {
  outputTail: string;
  captureSource: Extract<CaptureSource, "runner">;
  /** The child's real exit code, as observed by this process. */
  observedExitCode: number;
  /** Echoed back so a caller (and its tests) can assert WHERE the command actually ran. */
  cwd: string;
}

/** Discriminated capture outcome — never a partial or silently-degraded value. */
export type CaptureOutcome = { ok: true; value: CaptureSuccess } | { ok: false; error: LoreError };

/**
 * Spawns `request.command` in `request.cwd`, cross-checks the observed exit code
 * against `request.declaredResult`, and returns the child's real combined
 * stdout+stderr tail-truncated to {@link CAPTURE_TAIL_CHARS}.
 *
 * Refusal wording is shared VERBATIM with the CLI (same reasoning the sibling
 * `findMixedRunnerRefusal` / `findFilteredPassRefusal` guards already rely on:
 * one function returning a fully-formed `LoreError` means code/field/wording
 * cannot drift between adapters). It therefore names the CLI's flags — the
 * established convention for this family of shared refusals.
 *
 * @param request - command, explicit cwd, and the caller's declared result
 * @returns `{ ok: true }` with a runner-labelled tail, or `{ ok: false }` with a
 *   `VALIDATION_ERROR` — on which the caller MUST record nothing at all
 * @example
 * captureOracleCommand({ command: "true", cwd: "/repo", declaredResult: "pass" });
 * // => { ok: true, value: { captureSource: "runner", observedExitCode: 0, … } }
 * @example
 * captureOracleCommand({ command: "false", cwd: "/repo", declaredResult: "pass" });
 * // => { ok: false, error: VALIDATION_ERROR on field "result" (exit 1 vs declared pass) }
 */
export function captureOracleCommand(request: CaptureRequest): CaptureOutcome {
  const spawnResult = spawnSync(request.command, {
    shell: true,
    cwd: request.cwd,
    encoding: "utf8",
    maxBuffer: CAPTURE_MAX_BUFFER_BYTES,
    timeout: CAPTURE_TIMEOUT_MS,
  });

  if (spawnResult.error !== undefined) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        field: "capture",
        message: `--capture failed to spawn --command: ${spawnResult.error.message}`,
        value: request.command,
      },
    };
  }

  if (spawnResult.status === null) {
    // reason: killed by a signal (incl. this spawn's own timeout) before
    // exiting normally — there is no real exit code to cross-check the
    // declared --result against, so this is refused the same way a spawn
    // failure is, never silently treated as either pass or fail.
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        field: "capture",
        message:
          `--capture's spawn of --command was killed by signal ${spawnResult.signal ?? "unknown"} ` +
          `(no exit code observed — possibly the ${CAPTURE_TIMEOUT_MS / 1000}s capture timeout). ` +
          "Recorded nothing; narrow --command to a smaller scope and retry.",
        value: request.command,
      },
    };
  }

  const declaredPass = request.declaredResult === "pass";
  const observedPass = spawnResult.status === 0;
  if (declaredPass !== observedPass) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        field: "result",
        message:
          `--capture ran --command and observed exit code ${spawnResult.status} — declared ` +
          `--result "${request.declaredResult}" does not match (pass requires exit 0; fail/` +
          "expected-fail requires nonzero). Recorded nothing; fix --result or --command and retry.",
        value: { observed_exit_code: spawnResult.status, declared_result: request.declaredResult },
      },
    };
  }

  const combined = [spawnResult.stdout, spawnResult.stderr].filter((s) => s.length > 0).join("\n");
  return {
    ok: true,
    value: {
      outputTail: tailChars(combined, CAPTURE_TAIL_CHARS),
      captureSource: "runner",
      observedExitCode: spawnResult.status,
      cwd: request.cwd,
    },
  };
}
