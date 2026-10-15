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
 *     silent downgrade to `"self-report"` and never a recorded row: a TIMEOUT
 *     (its own measured outcome, see below), a spawn failure, an EXTERNAL signal
 *     kill, and a declared-vs-observed exit-code mismatch each return an explicit
 *     `LoreError` and the caller records NOTHING. An empty captured output is
 *     preserved as the empty string rather than being replaced by a placeholder,
 *     so "the command really printed nothing" stays distinguishable from "we did
 *     not capture".
 *
 *     ⛔ This clause used to fold the timeout into the signal-kill case ("a signal
 *     kill (including this module's own timeout, where NO exit code was ever
 *     observed)"). Measurement disproved both halves of that parenthesis, and
 *     task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a is the
 *     correction: node's `spawnSync` sets `error.code = "ETIMEDOUT"` on a timeout,
 *     so a timeout never reached the signal-kill branch at all — it was rendered as
 *     `"--capture failed to spawn --command"`, a spawn FAILURE — and a timed-out
 *     child that traps SIGTERM exits with a real status (measured: 0 and 3), so "no
 *     exit code" was never a property of timeouts either. The timeout is now
 *     MEASURED (ETIMEDOUT or monotonic elapsed ≥ the window), checked FIRST, and
 *     reported as a distinct outcome naming the window, the elapsed time, and the
 *     config knob. The window itself is no longer a constant — see {@link
 *     DEFAULT_CAPTURE_TIMEOUT_MS} and {@link CaptureRequest.timeoutMs}.
 *
 *     The residual silence this does NOT close: an operator may set a window so
 *     large that a genuinely hung child is tolerated for hours. That is their trade
 *     to make, and it is why elapsed time is reported on EVERY capture ({@link
 *     CaptureSuccess.elapsedMs}), not only on refusal — the margin stays visible
 *     instead of becoming observable only on the day it is crossed.
 *   Q3 Opt-in — capture is opt-in per call (`--capture` / `capture: true`) and
 *     that is intentional: `--oracle manual` has no command whose exit code
 *     means anything, and a `fail`/`expected-fail` row is often recorded for a
 *     run the agent already performed. What is NOT opt-in is the LABEL: every
 *     write through either adapter stamps `capture_source` explicitly, and the
 *     absence of capture stamps `"self-report"` rather than omitting the field.
 *
 * ⛔ SPEC-143 AC-CT-2 (2026-08-23): the `"runner"` label no longer travels alone.
 * Every successful capture returns it PAIRED with a measured `attestation` block
 * ({@link CapturedProvenance}) built from `spawnResult.status`, the monotonic
 * `elapsedMs`, and the measured "did not time out" fact — numbers this function has
 * always computed and never persisted. A label with nothing behind it was the
 * measured defect; the pair is what makes it unrepresentable.
 *
 * @module
 */

import { spawnSync } from "node:child_process";

import { CAPTURE_TAIL_CHARS, resolveCaptureTimeoutMs, tailChars, type CaptureSource, type EvidenceEntry, type LoreError } from "@lore/core";

// reason: TYPE-ONLY (erased at compile time — this adds NO runtime edge from an
// adapter into the service layer, and nothing new is loaded when a vitest file
// imports this module). It exists so {@link CapturedProvenance} spells its fields
// as a COMPILE-TIME claim about the evidence write boundary instead of a
// convention. Load-bearing, not decorative: TypeScript exempts SPREAD properties
// from excess-property checking, and both adapters splat that pair into their
// `addEvidence` input — so a rename on either side would silently DROP the
// attestation and re-mint exactly the false trust label AC-CT-2 refuses, with no
// error raised anywhere. Deriving the field types from `EvidenceInput` turns that
// silent drop into a build failure.
import type { EvidenceInput } from "../service/task-workflow-service.js";
import { mergeStderrIntoStdout } from "../service/merged-stream-command.js";

/**
 * Default capture window in ms, DERIVED from the config schema rather than
 * restated here (task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a).
 *
 * The predecessor was `CAPTURE_TIMEOUT_MS = 10 * 60 * 1000`, a module constant
 * whose JSDoc asserted a capture is "always a single scoped oracle command" and
 * that "`bun run test:changed` / individual test-file commands ... all comfortably
 * finish well inside this window". Measurement falsified exactly that sentence:
 * `bun run test:changed <base>` — this repo's OWN mandated worktree oracle — ran
 * ~624s after a `@lore/core` edit pulled 482 files into transitive reverse-dep
 * selection. Because `--capture` is the ONLY producer of a `capture_source:
 * "runner"` row, and `lore done`'s attested-pass floor accepts nothing else, the
 * disciplined path became structurally unreachable and the honest fallback
 * (`--output-tail-file` with the real log) records the WEAKER `"self-report"`
 * class. One constant had fused a hang detector (roughly fixed) with an honest
 * oracle's runtime (grows with the suite); {@link resolveCaptureTimeoutMs} now
 * gives the second half to the operator.
 *
 * ⛔ `600_000` is NOT written here — `resolveCaptureTimeoutMs(undefined)` reads the
 * Zod default from `workflow.evidence.capture_timeout_ms`, keeping ONE number in
 * ONE place. A literal here would be the dual-write this repo's config module
 * explicitly warns against.
 */
export const DEFAULT_CAPTURE_TIMEOUT_MS = resolveCaptureTimeoutMs(undefined);

// reason: CAPTURE_TAIL_CHARS is defined once in @lore/core (context-variables.ts); this re-export keeps
// existing importers of this module working — it is NOT a second definition.
export { CAPTURE_TAIL_CHARS };

/**
 * `spawnSync`'s own captured-buffer ceiling (CLAUDE.md standing lesson: a spawn
 * capturing growing output MUST set an explicit `maxBuffer` — the 1 MiB Node
 * default silently truncates). Generous relative to the {@link
 * CAPTURE_TAIL_CHARS}-char tail that actually gets persisted — this only bounds
 * what `spawnSync` buffers in memory before `tailChars` trims it.
 */
export const CAPTURE_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

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
  /**
   * Capture window in ms. Omitted → {@link DEFAULT_CAPTURE_TIMEOUT_MS}, i.e. the
   * `workflow.evidence.capture_timeout_ms` schema default — so a caller that
   * passes nothing behaves byte-identically to the pre-config constant.
   *
   * BOTH surfaces resolve it from the project's own `.lore/config.yaml` via
   * `resolveCaptureTimeoutMs`: the CLI in `cli/commands/evidence.ts`, and the MCP
   * adapter in `mcp/tools.ts`'s `lore_evidence_add` handler — the latter calling
   * its injected config GETTER per invocation so a long-lived stdio server
   * observes a mid-session config edit (the residual that closed in
   * task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed, face 3 item 1;
   * behavioural oracle: the `CAPMCP-*` group in
   * `tests/unit/adapters/mcp-evidence-capture.test.ts`, which asserts both
   * directions of the knob plus a no-getter control). ⛔ A THIRD caller must pass
   * it too — omitting it is silent and indistinguishable from a working knob on
   * an exit-code-only check, which is exactly how the MCP gap survived.
   */
  timeoutMs?: number;
}

/**
 * The persisted `attestation` block's shape, DERIVED from the ONE Zod schema that
 * defines it (`@lore/core::evidenceEntrySchema`) rather than restated. A local
 * re-declaration of its fields would be the dual-write this repo refuses
 * everywhere else, and would go stale the moment that schema gains a field.
 */
export type CaptureAttestation = NonNullable<EvidenceEntry["attestation"]>;

/**
 * The provenance PAIR a captured evidence row must carry: the `"runner"` label AND
 * the measured attestation standing behind it, in ONE object that cannot be
 * half-forwarded.
 *
 * ⛔ THIS SHAPE IS THE MECHANISM FOR SPEC-143 AC-CT-2 ("NO FALSE TRUST LABEL"),
 * not a convenience. Measured defect, 2026-08-17: `--capture` stamped
 * `capture_source: "runner"` and wrote NO `attestation`, so an implementer
 * sincerely reported its pass as attested because the row said `runner` — and had
 * no second source to catch that with. A row that LOOKS compliant is more
 * dangerous than a bare self-report. The numbers were ALREADY measured right here
 * ({@link CaptureSuccess.observedExitCode}, {@link CaptureSuccess.elapsedMs});
 * nothing ever carried them onto the persisted row. So this is a WRITE-THROUGH
 * fix, not new measurement (SPEC-143 §C5).
 *
 * WHY A PAIR RATHER THAN TWO SIBLING FIELDS: the predecessor handed out
 * `captureSource` on its own and both adapters forwarded exactly that — a label
 * with nothing behind it. The label and its evidence are now inseparable at the
 * type level, so an adapter physically cannot forward one without the other. Field
 * names are snake_case and their types derive from {@link EvidenceInput}, so this
 * object splats straight into an evidence write and a rename breaks the build.
 *
 * ⛔ NAMED CONSEQUENCE, not a side effect for someone to discover later: `lore
 * done`'s attested-pass floor is `result === "pass" && attestation !== undefined`
 * (`service/task-workflow-service.ts`), so from this change on a `lore evidence
 * --capture --result pass` row SATISFIES that floor where previously only `lore
 * verify` could. SPEC-143 §C5 states that upstream effect deliberately
 * ("`deriveAcCoverageState`'s `attested_pass` / `fail_superseded` branches are
 * starved today precisely because captures never attest"). What still separates a
 * `lore verify` row is visible ON the row and never inferred: an AC-declared
 * command that passed command-provenance approval (`first_seen`), a completeness
 * verdict over the runner's own reported test files
 * (`completeness`/`executed_files`), and the tree it ran in
 * (`execution_root`/`execution_mode`) — all four ABSENT here by construction, see
 * the reason at the build site in {@link captureOracleCommand}.
 */
export interface CapturedProvenance {
  /**
   * Always `"runner"` — derived from {@link EvidenceInput} and narrowed, so this
   * field can only ever mean "this process spawned the command and observed its
   * real exit code".
   */
  readonly capture_source: EvidenceInput["capture_source"] & "runner";
  /**
   * The measured attestation, REQUIRED here — unlike on the write boundary, where
   * it stays optional for self-reported rows and the legacy back-catalogue.
   */
  readonly capture_attestation: NonNullable<EvidenceInput["capture_attestation"]>;
}

/**
 * Provenance for ANY evidence write: the captured pair, or the self-report label
 * that carries no attestation because nothing measured one.
 *
 * Exported so each adapter declares ONE provenance variable whose type admits no
 * third possibility — in particular not a `"runner"` label with the attestation
 * omitted, which is unrepresentable in this union by construction.
 */
export type EvidenceProvenance =
  | CapturedProvenance
  | { readonly capture_source: Extract<CaptureSource, "self-report"> };

/**
 * A successful capture: the tail is the child's REAL combined output and the
 * provenance pair is fixed to `"runner"` plus a measured attestation (never
 * parameterised — see this module's header and {@link CapturedProvenance}).
 */
export interface CaptureSuccess {
  outputTail: string;
  /**
   * The label AND the attestation behind it, inseparable — splat this into the
   * evidence write (`...captured.value.provenance`), never pick one field out of
   * it. It replaced the bare `captureSource` field for exactly that reason.
   */
  provenance: CapturedProvenance;
  /** The child's real exit code, as observed by this process. */
  observedExitCode: number;
  /** Echoed back so a caller (and its tests) can assert WHERE the command actually ran. */
  cwd: string;
  /**
   * Monotonic wall-clock duration of the spawn, in ms.
   *
   * Reported on EVERY successful capture so the margin to the window is
   * observable rather than invisible until the day it is crossed — the governing
   * task's "Silence (b)". A proactive "you are at 90% of the window" warning was
   * considered and deliberately NOT built: it needs a second threshold nobody has
   * calibrated, and the elapsed figure gives a reader the same signal without one.
   */
  elapsedMs: number;
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
 * Four refusal outcomes, deliberately DISTINCT from one another (a collapsed pair
 * would leave an operator guessing at the cause): a TIMEOUT, a spawn failure, an
 * EXTERNAL signal kill, and a declared-vs-observed exit-code mismatch.
 *
 * @param request - command, explicit cwd, the caller's declared result, and
 *   optionally the capture window (`timeoutMs`; omitted → {@link
 *   DEFAULT_CAPTURE_TIMEOUT_MS})
 * @returns `{ ok: true }` with a runner-labelled tail, the measured `elapsedMs`, and
 *   the {@link CapturedProvenance} pair the caller splats into its evidence write,
 *   or `{ ok: false }` with a `VALIDATION_ERROR` — on which the caller MUST record
 *   nothing at all
 * @example
 * captureOracleCommand({ command: "true", cwd: "/repo", declaredResult: "pass" });
 * // => { ok: true, value: { provenance: { capture_source: "runner", capture_attestation:
 * //      { runner: "lore-cli", exit_code: 0, duration_ms: 4, timed_out: false } },
 * //      observedExitCode: 0, elapsedMs: 4, … } }
 * @example
 * captureOracleCommand({ command: "false", cwd: "/repo", declaredResult: "pass" });
 * // => { ok: false, error: VALIDATION_ERROR on field "result" (exit 1 vs declared pass) }
 * @example
 * captureOracleCommand({ command: "sleep 5", cwd: "/repo", declaredResult: "pass", timeoutMs: 300 });
 * // => { ok: false, error: VALIDATION_ERROR on field "capture" — timed out, names
 * //      the 300ms window, the elapsed ms, and workflow.evidence.capture_timeout_ms }
 */
export function captureOracleCommand(request: CaptureRequest): CaptureOutcome {
  const timeoutMs = request.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;

  // reason: performance.now() is MONOTONIC — Date.now() is wall-clock and an NTP
  // step during a long oracle could manufacture a phantom timeout (or mask a real
  // one) on the elapsed conjunct below.
  const startedAt = performance.now();
  const spawnResult = spawnSync(mergeStderrIntoStdout(request.command), {
    shell: true,
    cwd: request.cwd,
    encoding: "utf8",
    maxBuffer: CAPTURE_MAX_BUFFER_BYTES,
    timeout: timeoutMs,
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  // reason: THE TIMEOUT IS MEASURED, AND CHECKED FIRST (task-lore-evidence-capture-
  // has-a-hard-coded-600s-window-that-a). Both facts below were measured against
  // node's spawnSync with `shell: true` and a 300ms timeout, and both contradict
  // the pre-fix code:
  //
  //   `sleep 5`                            → status null, SIGTERM, code ETIMEDOUT
  //   `trap 'exit 0' TERM; sleep 5 & wait` → status 0,    null,    code ETIMEDOUT
  //   `trap 'exit 3' TERM; sleep 5 & wait` → status 3,    null,    code ETIMEDOUT
  //
  // (1) `error` is ALWAYS set on a timeout, so the generic spawn-error branch below
  // used to swallow EVERY timeout and render it as "--capture failed to spawn
  // --command: ... ETIMEDOUT" — a spawn FAILURE, which tells the operator their
  // command is malformed and names neither the window, the elapsed time, nor any
  // repair. That misdirection is what pushed agents onto --output-tail-file, i.e.
  // into the weaker `capture_source: "self-report"` class. It also made the
  // `status === null` branch's "possibly the 600s capture timeout" wording
  // UNREACHABLE for a real timeout: the hedge was dead code.
  // (2) A timed-out child can still exit 0 or 3 (rows 2/3 — it may trap SIGTERM),
  // so `status === null` is not a sound timeout predicate: row 2 declared `pass`
  // would have matched exit 0 and recorded a runner-attested PASS for an oracle
  // that never finished.
  //
  // Hence two INDEPENDENT conditions rather than one signal (this repo's standing
  // lone-signal/contiguous-substring lesson): the ETIMEDOUT code, OR the monotonic
  // elapsed reaching the window. The elapsed conjunct is what covers row 3 and
  // survives a platform that stops setting ETIMEDOUT; the code conjunct catches a
  // kill that somehow lands marginally under the measured window. A command that
  // legitimately finishes at the very boundary is refused rather than recorded —
  // spawnSync's own timer was already firing, and refusing is the safe side of a
  // race whose other side would be a fabricated row.
  const errorCode = (spawnResult.error as { code?: string } | undefined)?.code;
  if (errorCode === "ETIMEDOUT" || elapsedMs >= timeoutMs) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        field: "capture",
        message:
          `--capture timed out: --command ran for ${elapsedMs}ms, reaching the configured ` +
          `${timeoutMs}ms capture window. A timed-out capture is a FAILED capture — recorded ` +
          "NOTHING, and deliberately NOT downgraded to a self-reported row. Raise " +
          "workflow.evidence.capture_timeout_ms in .lore/config.yaml to fit this oracle, or " +
          "narrow --command's scope.",
        value: {
          command: request.command,
          elapsed_ms: elapsedMs,
          capture_timeout_ms: timeoutMs,
        },
      },
    };
  }

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
    // reason: killed by a signal that was NOT this capture's own timeout — the
    // timeout branch above already returned for that case, so this is now
    // exclusively an EXTERNAL kill (operator SIGINT, the OOM killer, a CI
    // harness reaping the process tree). There is no real exit code to
    // cross-check --result against, so it is refused exactly like a spawn
    // failure, never silently treated as pass or fail.
    //
    // The retired wording hedged here — "no exit code observed, possibly the
    // 600s capture timeout" — and that guess is precisely what this fix
    // removes: the runner MEASURES whether it timed out (above) and no longer
    // speculates. Elapsed time is still reported, because "killed at 3ms" and
    // "killed at 580s" call for completely different investigations.
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        field: "capture",
        message:
          `--capture's spawn of --command was killed by signal ${spawnResult.signal ?? "unknown"} ` +
          `after ${elapsedMs}ms, without reaching the configured ${timeoutMs}ms capture window ` +
          "(so this is an EXTERNAL kill, not a capture timeout) and without ever reporting an " +
          "exit code. Recorded nothing; re-run --command and investigate what killed it.",
        value: {
          command: request.command,
          signal: spawnResult.signal ?? "unknown",
          elapsed_ms: elapsedMs,
          capture_timeout_ms: timeoutMs,
        },
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

  // reason: stderr was merged into stdout by {@link mergeStderrIntoStdout}, so
  // `spawnResult.stdout` already IS the terminal-ordered combined stream and
  // `spawnResult.stderr` is empty by construction. Do NOT re-add a stdout+stderr
  // join here — that concatenation is the #181 defect (summary pushed out of the tail).
  const combined = spawnResult.stdout;
  // reason: SPEC-143 AC-CT-2 write-through — every number below was already
  // measured above; this is where they finally reach the persisted row instead of
  // dying in this function (see {@link CapturedProvenance} for the measured defect,
  // and for why the label and the attestation are ONE object).
  //
  //   `exit_code`   — `spawnResult.status`, the same value the declared/observed
  //                   cross-check above just ran on, so the row cannot disagree
  //                   with the check that admitted it.
  //   `duration_ms` — the monotonic `elapsedMs` this function already reports, read
  //                   from the SAME local as `CaptureSuccess.elapsedMs`, so the two
  //                   representations can never drift.
  //   `timed_out`   — `false` is MEASURED here, not assumed: the ETIMEDOUT/elapsed
  //                   branch above RETURNS on a timeout, so reaching this line is
  //                   itself the observation that no timeout occurred. (A timed-out
  //                   capture records nothing at all — never a row with
  //                   `timed_out: true`.)
  //   `runner`      — `"lore-cli"`, the only member of `ATTESTATION_RUNNERS`, and
  //                   honest on BOTH surfaces: the process that performed this
  //                   spawn is the lore binary itself (a CLI subprocess or the MCP
  //                   stdio server), never a remote or third-party runner.
  //
  // ⛔ FOUR attestation fields are deliberately ABSENT, and their absence is the
  // honest reading rather than an oversight: `first_seen` (SPEC-039 §M2) means a
  // command passed command-provenance approval, which `--capture` does not run;
  // `completeness`/`executed_files` (SPEC-061) are the verify runner's verdict over
  // a DECLARED test-file list this path has none of; `execution_root`/
  // `execution_mode` (SPEC-063) must be written BOTH-or-NEITHER by
  // `resolveVerifyExecutionRoot`, so putting `request.cwd` into one of them alone
  // would break that invariant and invent a resolution that never happened.
  const provenance: CapturedProvenance = {
    capture_source: "runner",
    capture_attestation: {
      runner: "lore-cli",
      exit_code: spawnResult.status,
      duration_ms: elapsedMs,
      timed_out: false,
    },
  };
  return {
    ok: true,
    value: {
      outputTail: tailChars(combined, CAPTURE_TAIL_CHARS),
      provenance,
      observedExitCode: spawnResult.status,
      cwd: request.cwd,
      elapsedMs,
    },
  };
}
