/**
 * lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual|other>
 *   --command "<cmd>" --result <pass|fail|expected-fail>
 *   [--capture | --output-tail <text> | --output-tail-file <path>]
 *   [--ac <id>] [--checklist-ref <id>]
 *
 * --capture (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the) —
 * spawns `--command` itself via `../../evidence-capture.js::captureOracleCommand`
 * (the SHARED implementation, extracted from this file by task-mcp-lore-evidence-
 * add-cannot-set-capture-source-and-has-no so `lore_evidence_add` over MCP can
 * reach the same mechanism; `shell: true`, this process's own `process.cwd()`
 * passed EXPLICITLY as the spawn cwd, and the capture window described below) and
 * uses its OWN captured stdout+stderr (tail-truncated to 4000 chars, same as
 * `--output-tail-file`) as `output_tail` — the agent never types or redirects
 * anything; the tail IS the runner's real output. Cross-checks the spawn's actual
 * exit code against the declared `--result` (`pass` requires exit 0; `fail`/
 * `expected-fail` requires nonzero) and REFUSES on a mismatch, naming the real
 * exit code observed — the same anti-lying property `lore verify` already gets
 * from actually running commands itself. Stamps `capture_source: "runner"` on
 * the written entry (`TaskWorkflowService`'s own forcing logic additionally
 * re-derives this from `attestation` for `lore verify`-attested rows — see that
 * service's module header). Mutually exclusive with `--output-tail`/
 * `--output-tail-file` and with `--oracle manual` (nothing to spawn for a
 * browser/visual check) — `../evidence-precheck.js::findCaptureFlagConflict`
 * refuses both combinations before any spawn happens.
 *
 * Capture window (task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a) —
 * `--capture`'s spawn is bounded by `workflow.evidence.capture_timeout_ms` from this
 * project's `.lore/config.yaml` (default 600000 ms, byte-identical to the module
 * constant it replaced, so an upgrading consumer that sets nothing sees no change).
 * It was previously the hard-coded `CAPTURE_TIMEOUT_MS`, which fused two unrelated
 * facts — how long a HUNG child is tolerated versus how long an HONEST oracle may
 * take — into one number. The second grows with the test suite, and it outgrew the
 * constant: this repo's own mandated worktree oracle `bun run test:changed <base>`
 * measured ~624s against the 600s window, which made `--capture` (the ONLY producer
 * of a `capture_source: "runner"` row, and the only class `lore done`'s
 * attested-pass floor accepts) unreachable for a legitimately-scoped run and pushed
 * the author onto `--output-tail-file`, i.e. into the WEAKER `"self-report"` class.
 * ⛔ Raising the number was explicitly rejected as the fix — it relocates the cliff
 * instead of removing the class. Exceeding the window is now a FAILED capture: a
 * loud refusal (exit 4) naming the configured window, the measured elapsed time,
 * and this knob, with NOTHING recorded — never a quiet downgrade to a self-reported
 * row. The detection and wording live in `../../evidence-capture.js`, shared with
 * MCP — which resolves the SAME config knob through its own injected getter as of
 * task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed (face 3 item 1), so
 * the two surfaces no longer differ in window OR outcome.
 *
 * A SUCCESSFUL `--capture` additionally appends ` [captured in <n>ms of a <m>ms
 * window]` to the human success line — the margin was previously invisible until the
 * run that crossed it, and reporting elapsed-vs-window on every capture is the whole
 * mechanism for that (a proactive "approaching the window" warning was deliberately
 * NOT built: it needs a second, uncalibrated threshold). The suffix is appended ONLY
 * on the capture path and ONLY to the human line — `--json`'s payload is a consumed
 * shape and is untouched, and a non-`--capture` write's line stays byte-identical.
 *
 * A self-reported `--result pass` for `--oracle` `test`/`e2e` with NO `--capture`
 * and no genuine `--output-tail`/`--output-tail-file` used to record cleanly with
 * an EMPTY `output_tail` — two measurements this task's own doc records (a hand-
 * authored prose tail satisfying the non-empty predicate; eight `pass` rows with
 * `output_tail` length 0 recorded under an explicit dispatch instruction naming
 * this exact defect). `TaskWorkflowService`'s `rejectMissingPassOutputTail` used
 * to refuse any `--result pass` self-report lacking a genuinely non-empty tail
 * UNLESS `capture_source === "runner"` (i.e. `--capture` was used) — but a bare
 * non-empty check was ITSELF measured insufficient (task-raise-the-evidence-
 * tail-guard-s-predicate-to-its-own, spec-falsifiability-reachability-a-
 * feedable-checkpoint-an §D5): 2 of 3 dispatched agents satisfied "non-empty"
 * by hand-typing a summary that LOOKS like a real runner's, and both passed.
 * The predicate is now RAISED to match its own message: a self-reported
 * `--result pass` is refused for EVERY oracle kind (any tail, empty or not)
 * UNLESS `capture_source === "runner"` OR `--oracle manual` (the one kind
 * `--capture` structurally can never reach — nothing to spawn for a visual
 * check — so it keeps the prior "genuinely non-empty description" floor as
 * ITS proof instead). Every write this command makes stamps `capture_source:
 * "self-report"` when `--capture` is NOT used — never omitted, never inferred
 * from the tail's shape.
 *
 * `--result expected-fail` (spec-workflow-hardening-evidence-red-vocabulary-claim-
 * worktree §M1, AC-WH-1) records a deliberate RED-phase oracle run — a test that
 * fails BY DESIGN because its implementation hasn't landed yet. It is stored
 * verbatim (never coerced toward `pass`/`fail`) and is NEVER counted as passing
 * by any downstream consumer (`lore verify` summaries, `lore assess` evidence
 * facts, or AC-coverage aggregation via `computeAcCoverage` — the exact same
 * "satisfies neither pass nor fail filter" property `"inconclusive"` already has,
 * `@lore/core`'s task-workflow.ts). Unlike `"inconclusive"` (runner-issued only,
 * rejected here), `expected-fail` is a NORMAL self-reported value — no special
 * guard rejects it.
 *
 * Appends one oracle verification record to the target document's
 * `extra.verification_evidence` (append-only, capped at 50 entries). Bumps the doc
 * version — visible via `lore log <task>`.
 *
 * Target-type dispatch (SPEC-056 task-skill-implement-cli-mcp-surfaces-checklist-ref-
 * evidence): `TaskWorkflowService.addEvidence` is ALWAYS tried FIRST, UNCHANGED — a
 * successful call, a DOC_NOT_FOUND, or any other error stays byte-identical to
 * pre-SPEC-056 behavior (REGRESSION). ONLY when that call fails with its own
 * `VALIDATION_ERROR {field: "type", value: "phase"}` (i.e. the target genuinely
 * resolved, and IS a phase doc) does this adapter retry via
 * `PhaseWorkflowService.addEvidence` — deliberately NOT a pre-resolve-then-dispatch
 * (a `corpusService.get()` pre-fetch would attach DOC_NOT_FOUND's `suggestions[]`
 * field, changing the not-found error text `formatError` renders — see
 * `resolve.ts::resolveDoc` vs `CorpusService.resolve`'s divergent NOT_FOUND shapes).
 *
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`.
 *
 * --output-tail and --output-tail-file are mutually exclusive; when
 * --output-tail-file is given, only the last 4000 chars of the file are kept
 * (evidenceEntrySchema caps output_tail at 4000 chars). Intended use is
 * recording *final* oracle runs (e.g. `bun run typecheck` exit output), not
 * per-keystroke CI logs — keep the file small.
 *
 * --ac references a structured AC id declared on the plan's parent spec
 * (SPEC-038 §4). This adapter passes the raw string through untouched — the
 * cross-entity validation that it names a *declared* AC lives in
 * TaskWorkflowService.addEvidence (SPEC-038 §4 D4), not here.
 *
 * --checklist-ref references a checklist item id declared on a PHASE target's own
 * `extra.checklist` (SPEC-056 §Design Decisions D8). Also passed through untouched —
 * cross-entity validation lives in `PhaseWorkflowService`'s shared evidence-append
 * path. Meaningful only on a phase target; harmless-but-unvalidated on a task target
 * (the field is doc-schema-legal on any evidence entry, `checklist_ref` is additive on
 * `evidenceEntrySchema`).
 *
 * Exit codes: 0 = success, 2 = argument error (both output-tail flags given at
 *   once, or --output-tail-file names an unreadable path), 3 = DOC_NOT_FOUND,
 *   4 = VALIDATION_ERROR (not a task/phase, 50-entry cap reached, bad
 *   oracle/result value, unknown ac_ref/checklist_ref, `--capture` combined with
 *   either output-tail flag or with `--oracle manual` (`findCaptureFlagConflict`),
 *   a self-reported `--result pass` with no `--capture` and no `--oracle manual`
 *   escape (D5's raised predicate — ANY tail, empty or hand-authored, no longer
 *   suffices for a capturable oracle), a `--capture` spawn whose observed exit code contradicts the declared
 *   `--result`, a `--capture`d fail-family result whose OWN observed output is
 *   a runner discovery refusal (AC-OX-12 — see below), OR a missing oracle
 *   file / an unproven filtered pass / a mixed-runner command / a piped
 *   self-reported command per the prechecks below, OR a `--result pass` from a
 *   claim whose recorded worktree is
 *   uncommitted / from a no-worktree claim running inside a real git repo —
 *   TaskWorkflowService's own uncommitted-worktree guard, see module header),
 *   5 = STALE_VERSION.
 *
 * Discovery-refusal guard (task-wire-the-discovery-refusal-guard-into-the-
 * evidence-capture, spec-oracle-executability-a-runner-s-discovery-refusal-
 * is-not-a §M6.2's evidence-path sibling, AC-OX-12) — `--capture` measures a
 * REAL exit code from a REAL spawn, but a nonzero exit is ambiguous: every
 * runner this repo uses (vitest/bun test/playwright) returns the SAME exit
 * code for "found no matching test file" as for "ran and something failed".
 * Before this guard, a fail-family `--result` (`fail`/`expected-fail`) whose
 * captured output was actually a discovery refusal — e.g. a poisoned cwd
 * making `bunx vitest run <path>` print vitest's own "No test files found,
 * exiting with code 1" — recorded cleanly as `capture_source: "runner"`, the
 * corpus's strongest self-report label, for a run that measured NOTHING.
 * `service/verify-runner-service.ts`'s §M6.2 call site already downgrades
 * this exact shape to `"inconclusive"` for `lore verify`'s attested path; this
 * is the SAME primitive (`@lore/core`'s `findDiscoveryRefusal`) wired into the
 * SECOND write path that mints a red. Checked immediately after a successful
 * `--capture` spawn, scoped to `capture === true` AND `oracle === "test"` AND
 * a fail-family `result` (byte-identical scoping to §M6.2's own call site).
 * The decision itself lives in
 * `../evidence-precheck.js::findCapturedFailDiscoveryRefusal`, shared
 * verbatim with the MCP `lore_evidence_add` handler.
 *
 * Pipe-refusal guard (SPEC oracle-tier-falsifiability-a-criterion-never-
 * observed-red M2; ADR falsifiability-moves-from-the-task-tier-to-the-oracle-
 * tier) — a self-reported `--result pass` for `--oracle test`/`e2e` whose
 * `--command` contains an unquoted, non-`||` shell pipe used to record
 * cleanly even though `$?` after a pipe belongs to the LAST stage of the
 * pipeline, never the oracle the call means to assert about (THIRD measured
 * recurrence of this exact trap in this repo). Runs AFTER the missing-
 * oracle-file and mixed-runner guards above (a nonexistent file or a
 * dropped-runner file is a more fundamental fault); ordering against the
 * filtered-pass guard below is immaterial, the two conditions are
 * independent. `--capture` is the load-bearing escape — it measures the
 * real exit code itself, so the pipe hazard does not apply there. The
 * decision itself lives in `../evidence-precheck.js::findPipeRefusal`,
 * shared verbatim with the MCP `lore_evidence_add` handler.
 *
 * Mixed-runner invocation guard (defect: task-vitest-run-silently-drops-a-bun-
 * test-ts-named-alongside-a) — a single `vitest run` invocation naming a
 * `.bun.test.ts` path alongside a real vitest file (or the symmetric `bun test`
 * invocation naming a plain `.test.ts` file) used to record a self-reported
 * `pass` cleanly even though the runner silently ran ONLY the files belonging
 * to the invoked runner and dropped the rest — vitest's own "no test files
 * found" loud refusal evaluates over the WHOLE invocation, not per named
 * argument, so a quorum of one matching file silences it. Runs AFTER the
 * missing-oracle-file precheck (a nonexistent path is refused for that more
 * fundamental reason first) and BEFORE the filtered-pass guard (whether the
 * invocation would even run a named file matters before asking whether a
 * filter matched inside it). The decision itself lives in
 * `../evidence-precheck.js::findMixedRunnerRefusal`, shared verbatim with the
 * MCP `lore_evidence_add` handler — same CLI/MCP split the other two
 * prechecks already use.
 *
 * Filtered-pass matched-count guard (SPEC-061 AC-061-11..14, decided by
 * adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own) — a
 * `--result pass` whose `--command` carries a `-t` case filter used to record
 * cleanly with no proof the filter matched anything, and a zero-match filter
 * EXITS 0 with every test reported `skipped`. Such a call must now supply
 * `--output-tail`/`--output-tail-file` containing the runner's own summary
 * line; a missing, unparseable, count-less or zero-matched tail is refused
 * with `VALIDATION_ERROR` (exit 4). Fail-CLOSED, unlike `lore verify`'s
 * fail-OPEN `unknown_runner` — that runner observed the exit code itself,
 * this command has observed nothing. Deliberately NO `--matched <n>` flag: a
 * bare integer is as fabricable as the false `pass` it would gate. UNFILTERED
 * commands are completely unaffected. The decision is
 * `../evidence-precheck.js::findFilteredPassRefusal`, shared verbatim
 * with MCP `lore_evidence_add` (AC-061-17) — the same CLI/MCP split the
 * missing-oracle-file precheck already uses, for the same reason.
 *
 * Missing-oracle-file precheck (defect: task-lore-evidence-self-reported-pass-
 * lacks-oracle-file, AC-080-3 incident) — a self-reported `--oracle test|e2e
 * --result pass` used to record cleanly even when the test file named in
 * `--command` did not exist on disk; only `lore verify`'s SPEC-061 zero-match
 * guard caught the gap, two verify rounds later. BEFORE calling the service,
 * when `oracle` is `test`/`e2e` AND `result` is `pass`, this adapter extracts
 * test-file-like path tokens from `command` (`../evidence-precheck.js`,
 * vitest-safe / DI'd existence port) and checks each against `process.cwd()`,
 * a `cd <dir> &&` prefix target (if the command has one), and the discovered
 * corpus root (when distinct from cwd). A command referencing NO extractable
 * test-file token is a deliberate fail-open — it cannot be checked, so it is
 * left alone (same "cannot demand what isn't referenced" logic every other
 * oracle kind and every `fail` result already gets, unconditionally). A
 * command whose extracted token(s) exist nowhere plausible fails loud with
 * `VALIDATION_ERROR` (exit 4) BEFORE the service call — the same synthetic
 * error is rendered via the shared `formatError`/`exitCode` pair every other
 * `LoreError` in this file uses, so the failure mode is presentationally
 * identical to a service-rejected write even though no service call happens.
 * There is deliberately NO escape-hatch flag: a missing test file has no
 * legitimate "pass" outcome — the repair is either author the file, fix the
 * path, or record with `--oracle manual` for a genuinely manual check.
 *
 * The oracle/result gate ("only test/e2e + pass is in scope") plus the
 * `findMissingOracleFiles` composition live in
 * `../evidence-precheck.js::findMissingOracleFilesForEvidence` — the SAME
 * function the MCP adapter's `lore_evidence_add` handler calls
 * (`../../mcp/tools.js`, fixed 2026-07-26, defect: task-mcp-lore-evidence-
 * add-bypasses-the-oracle-file-existence). Before that fix, `lore_evidence_add`
 * called `TaskWorkflowService`/`PhaseWorkflowService` directly and never
 * routed through this command, so an MCP-originated self-reported pass could
 * bypass the precheck entirely.
 *
 * Refusal message names the checked root(s) (task-lore-evidence-s-oracle-
 * file-precheck-resolves-against-the) — `../evidence-precheck.js::
 * describePrecheckRoots` recomputes the SAME candidate roots
 * `findMissingOracleFilesForEvidence` just tried (SSOT, never drifts) so an
 * author reading "Oracle file(s) not found" can tell "your file is genuinely
 * missing" from "the precheck looked in the wrong tree". The message also names
 * the cd target the precheck DERIVED from the command chain
 * (`describeDerivedCdTarget`, task-evidence-precheck-only-sees-a-cd-in-the-
 * first-segment-of-a) — the roots say WHERE it looked, the derived target says
 * WHY, so a future cd-derivation mismatch is diagnosable from the message
 * alone. This CLI surface's
 * `cwd` is always correct by construction (a fresh subprocess per invocation
 * inherits the caller's real shell cwd) — the MCP surface (`../../mcp/tools.js`)
 * is where a long-lived stdio server's own `process.cwd()` can differ from
 * the calling agent's actual directory, and gains a `caller_cwd` escape hatch
 * there instead (mirrors `lore verify`'s `--execution-root`, SPEC-063, for the
 * identical class of problem).
 *
 * Uncommitted-worktree attestation guard (task-lore-evidence-and-lore-
 * release-accept-an-attestation-from) — a self-reported `--result pass` used
 * to record cleanly even while the claim's own recorded `--worktree` sat
 * uncommitted, letting the corpus attest a task no commit backs (2026-08-01
 * incident: 7 such rows + a release recorded while the branch carried no
 * commits at all). `evidenceInput.callerCwd` below passes this process's own
 * `process.cwd()` through to `TaskWorkflowService.addEvidence` — used ONLY
 * to close an opt-in hole (a claim recording NO worktree, from a call
 * plainly running inside a real git repo, refuses instead of silently
 * passing); the primary whole-worktree `git status --porcelain` predicate
 * itself lives entirely in the service (`task-workflow-service.ts`), keyed
 * off the claim's own recorded worktree, not this cwd.
 *
 * Source: SPEC-025 §4 AC-WF-1, AC-WF-2; SPEC-038 §4, §7 D3; SPEC-056 §Design Decisions D8;
 *   task-lore-evidence-s-oracle-file-precheck-resolves-against-the;
 *   task-lore-evidence-and-lore-release-accept-an-attestation-from;
 *   task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the (`--capture`,
 *   the PASS-tail requirement, `capture_source`);
 *   task-wire-findpiperefusal-into-the-live-lore-evidence-and-mcp (spec
 *   oracle-tier-falsifiability-a-criterion-never-observed-red M2 — wires
 *   the pre-existing `findPipeRefusal` guard into this call sequence);
 *   task-raise-the-evidence-tail-guard-s-predicate-to-its-own (spec-
 *   falsifiability-reachability-a-feedable-checkpoint-an §D5 — raises
 *   `rejectMissingPassOutputTail`'s predicate to match its own message);
 *   task-wire-the-discovery-refusal-guard-into-the-evidence-capture (AC-OX-12,
 *   spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.2's
 *   evidence-path sibling — the discovery-refusal guard above)
 */

import { existsSync, readFileSync } from "fs";
import { dirname } from "path";
import { defineCommand } from "citty";
import {
  ORACLE_KINDS,
  resolveCaptureTimeoutMs,
  tailChars,
  type LoreError,
  type OracleKind,
} from "@lore/core";
import { loadLoreApp, loadProjectConfig } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import {
  findMissingOracleFilesForEvidence,
  findFilteredPassRefusal,
  findMixedRunnerRefusal,
  findCaptureFlagConflict,
  findPipeRefusal,
  findCapturedFailDiscoveryRefusal,
  describePrecheckRoots,
  describeDerivedCdTarget,
} from "../evidence-precheck.js";
import { captureOracleCommand, type EvidenceProvenance } from "../../evidence-capture.js";

const VALID_RESULTS = ["pass", "fail", "expected-fail"] as const;

export default defineCommand({
  meta: {
    name: "evidence",
    description: "Append an oracle verification record to a task",
  },
  args: {
    task: {
      type: "positional",
      description: "Task document ID or slug",
      required: true,
    },
    oracle: {
      type: "string",
      description: `Oracle kind: ${ORACLE_KINDS.join(" | ")}`,
      required: true,
    },
    command: {
      type: "string",
      description: "Exact command that was run",
      required: true,
    },
    result: {
      type: "string",
      description: `Outcome: ${VALID_RESULTS.join(" | ")}`,
      required: true,
    },
    "output-tail": {
      type: "string",
      description: "Inline output excerpt (≤4000 chars; mutually exclusive with --output-tail-file)",
    },
    "output-tail-file": {
      type: "string",
      description: "Path to a file whose last 4000 chars are recorded as output_tail",
    },
    capture: {
      type: "boolean",
      description:
        "Spawn --command itself and use ITS OWN captured stdout+stderr as output_tail " +
        "(capture_source: runner); mutually exclusive with --output-tail/--output-tail-file " +
        "and with --oracle manual",
    },
    ac: {
      type: "string",
      description:
        "References a structured AC id declared on the plan's parent spec (SPEC-038)",
    },
    "checklist-ref": {
      type: "string",
      description:
        "References a checklist item id declared on a phase target's own checklist (SPEC-056)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    if (args["output-tail"] !== undefined && args["output-tail-file"] !== undefined) {
      process.stderr.write(
        "Error: --output-tail and --output-tail-file are mutually exclusive.\n",
      );
      process.exitCode = 2;
      return;
    }

    const captureRequested = args.capture === true;

    // reason: capture-flag conflict guard (see module header) — pure CLI-usage
    // shape check, independent of `--result`, so it runs BEFORE any tail
    // resolution or spawn happens. Rendered via the SAME formatError/exitCode
    // pair every other precheck guard in this file uses (VALIDATION_ERROR, exit 4).
    const captureConflict = findCaptureFlagConflict({
      oracle: args.oracle as string,
      capture: captureRequested,
      ...(typeof args["output-tail"] === "string" ? { outputTail: args["output-tail"] } : {}),
      ...(typeof args["output-tail-file"] === "string" ? { outputTailFile: args["output-tail-file"] } : {}),
    });
    if (captureConflict !== null) {
      process.stderr.write(formatError(captureConflict) + "\n");
      process.exitCode = exitCode(captureConflict);
      return;
    }

    let outputTail: string | undefined;
    // reason: task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the —
    // capture_source is stamped on EVERY write (never omitted, never inferred
    // from the tail's shape): "runner" only when --capture actually spawned
    // --command and this process observed its real exit code; "self-report"
    // for every other case (the two --output-tail flags, or no tail at all).
    //
    // reason: SPEC-143 AC-CT-2 — this is a PROVENANCE PAIR, not a bare label. The
    // predecessor was `let captureSource: CaptureSource = "self-report"`, and the
    // measured defect is exactly what that shape permitted: the "runner" label was
    // forwarded on its own while the attestation the capture had already measured
    // was dropped on the floor. `EvidenceProvenance` cannot express a "runner"
    // label without its attestation, so the row this command writes is either
    // genuinely attested or not labelled runner — never the third thing.
    let provenance: EvidenceProvenance = { capture_source: "self-report" };
    /** Non-empty only on a successful `--capture` — see the assignment site's reason. */
    let captureMargin = "";

    if (captureRequested) {
      // reason: task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no
      // — the spawn/cross-check/tail-truncate body used to live INLINE here,
      // which is precisely why the MCP surface could not reach it and an agent
      // using lore through MCP could not produce a runner-captured row at all.
      // It now lives in `../../evidence-capture.js` and is shared VERBATIM by
      // both adapters, so `capture_source: "runner"` means the same measured
      // thing on either surface (a second copy would be the divergence hazard
      // task-two-independent-copies-of-does-this-task-have-a-claim-now names).
      // `cwd` is passed EXPLICITLY rather than defaulted inside the helper: for
      // the CLI it is correct by construction (a fresh subprocess inherits the
      // agent's real shell cwd), whereas MCP must supply a caller-declared one.
      // reason: task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a —
      // the capture window is the operator's, read from this project's own
      // `.lore/config.yaml` (`workflow.evidence.capture_timeout_ms`), not a
      // module constant. `loadProjectConfig()` rather than `loadLoreApp()`'s
      // `config` DELIBERATELY: `loadLoreApp` is called further down, AFTER this
      // spawn, and hoisting it would reorder DB discovery ahead of both this
      // capture and the `--output-tail-file` read — turning a usage error (exit
      // 2) in a corpus-less directory into a "no .lore/lore.db" exit 1. This
      // read is confined to the `--capture` path, so every other invocation is
      // byte-identical to pre-change behavior.
      //
      // ⛔ Known residual, NOT introduced here: `loadProjectConfig` degrades a
      // MALFORMED config to `undefined`, so a typo'd or out-of-range
      // `capture_timeout_ms` silently yields the default window rather than
      // failing loud. That fallback is `loader.ts`'s documented, pre-existing
      // behavior for every non-`ai` config section (an explicit SPEC-030
      // non-goal); fixing it belongs there and would change every section's
      // semantics at once, not just this key's.
      const captureTimeoutMs = resolveCaptureTimeoutMs(loadProjectConfig());
      const captured = captureOracleCommand({
        command: args.command as string,
        cwd: process.cwd(),
        declaredResult: args.result as string,
        timeoutMs: captureTimeoutMs,
      });
      if (!captured.ok) {
        process.stderr.write(formatError(captured.error) + "\n");
        process.exitCode = exitCode(captured.error);
        return;
      }
      outputTail = captured.value.outputTail;
      // reason: the WHOLE pair, assigned as one value — never destructured into a
      // label here (SPEC-143 AC-CT-2; see the declaration above).
      provenance = captured.value.provenance;
      // reason: margin observability (the governing task's "Silence (b)") — the
      // window closing was invisible until the run that crossed it. Reporting
      // elapsed-vs-window on EVERY successful capture is what makes it visible,
      // and it is deliberately the whole mechanism: a proactive "you are at 90%"
      // warning would need a second threshold nobody has calibrated. Appended to
      // the human line only (never the --json payload, which is a consumed shape).
      captureMargin = ` [captured in ${captured.value.elapsedMs}ms of a ${captureTimeoutMs}ms window]`;

      // reason: discovery-refusal guard (task-wire-the-discovery-refusal-guard-
      // into-the-evidence-capture, spec-oracle-executability-a-runner-s-
      // discovery-refusal-is-not-a §M6.2's evidence-path sibling, AC-OX-12) —
      // this is the SECOND write path that mints a red (`lore verify`'s own
      // §M6.2 call site, `service/verify-runner-service.ts`, is the first and
      // already downgrades to "inconclusive"). A fail-family `--result` whose
      // REAL captured output is a runner's own discovery-refusal phrase (found
      // no matching test file — a ZERO-EXECUTION event, never distinguishable
      // from a genuine assertion failure by exit code alone) is refused here,
      // BEFORE the DB is even opened, rather than recorded as a permanent
      // fail/expected-fail row that measured nothing. Checked immediately after
      // the capture that produced `outputTail`, using the SAME `captureRequested`
      // boolean already resolved — mirrors `findPipeRefusal`'s own `capture`
      // param shape below. The decision itself lives in
      // `../evidence-precheck.js::findCapturedFailDiscoveryRefusal`, shared
      // verbatim with the MCP `lore_evidence_add` handler.
      const capturedDiscoveryRefusal = findCapturedFailDiscoveryRefusal({
        oracle: args.oracle as string,
        result: args.result as string,
        capture: captureRequested,
        command: args.command as string,
        outputTail,
      });
      if (capturedDiscoveryRefusal !== null) {
        process.stderr.write(formatError(capturedDiscoveryRefusal) + "\n");
        process.exitCode = exitCode(capturedDiscoveryRefusal);
        return;
      }
    } else if (typeof args["output-tail"] === "string") {
      outputTail = tailChars(args["output-tail"], 4000);
    } else if (typeof args["output-tail-file"] === "string") {
      try {
        outputTail = tailChars(readFileSync(args["output-tail-file"], "utf8"), 4000);
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown error";
        process.stderr.write(`Error: could not read --output-tail-file: ${message}\n`);
        process.exitCode = 2;
        return;
      }
    }

    const { app, dbPath } = loadLoreApp();
    try {
      // reason: missing-oracle-file precheck (see module header) — only test/e2e
      // pass claims are checked; every other oracle/result combination is
      // completely unaffected (byte-identical to pre-precheck behavior). The
      // oracle/result gate + findMissingOracleFiles composition itself lives in
      // findMissingOracleFilesForEvidence (../evidence-precheck.js) — shared
      // verbatim with the MCP adapter's lore_evidence_add handler, so the two
      // surfaces cannot drift on which calls are in scope.
      const precheckRoots = {
        cwd: process.cwd(),
        // reason: dbPath is <corpusRoot>/.lore/lore.db — the corpus root is two
        // levels up. Distinct from cwd whenever the invocation runs from a
        // subdirectory of the corpus (or a linked worktree, SPEC-063).
        corpusRoot: dirname(dirname(dbPath)),
      };
      const missing = findMissingOracleFilesForEvidence({
        oracle: args.oracle as string,
        result: args.result as string,
        command: args.command as string,
        ...precheckRoots,
        fileExists: existsSync,
      });
      if (missing.length > 0) {
        // reason: task-lore-evidence-s-oracle-file-precheck-resolves-against-the
        // — the refusal must name WHICH root(s) it checked, so an author can
        // tell "your file is genuinely missing" from "I looked in the wrong
        // tree" (`describePrecheckRoots` recomputes the SAME candidates
        // `findMissingOracleFilesForEvidence` just tried — SSOT, never drifts).
        const checkedRoots = describePrecheckRoots(args.command as string, precheckRoots);
        const precheckError: LoreError = {
          code: "VALIDATION_ERROR",
          field: "command",
          message:
            `Oracle file(s) not found: ${missing.join(", ")}. ` +
            `Checked root(s): ${checkedRoots.join(", ")}. ` +
            `${describeDerivedCdTarget(args.command as string)} ` +
            "Author the oracle file or fix the path in --command; " +
            "use --oracle manual for genuinely manual checks.",
          value: args.command,
        };
        process.stderr.write(formatError(precheckError) + "\n");
        process.exitCode = exitCode(precheckError);
        return;
      }

      // reason: mixed-runner invocation guard (see module header) — runs
      // AFTER the missing-oracle-file precheck (a nonexistent path is refused
      // for that more fundamental reason first) and BEFORE the filtered-pass
      // guard below (whether the invocation would even run a named file
      // matters before asking whether a filter matched inside it). The
      // decision itself lives in `../evidence-precheck.js` and is shared
      // verbatim with the MCP `lore_evidence_add` handler.
      const mixedRunnerRefusal = findMixedRunnerRefusal({
        oracle: args.oracle as string,
        result: args.result as string,
        command: args.command as string,
      });
      if (mixedRunnerRefusal !== null) {
        process.stderr.write(formatError(mixedRunnerRefusal) + "\n");
        process.exitCode = exitCode(mixedRunnerRefusal);
        return;
      }

      // reason: pipe-refusal guard (see module header; SPEC oracle-tier-
      // falsifiability M2) — runs AFTER the missing-oracle-file and
      // mixed-runner guards above (a nonexistent file or a dropped-runner
      // file is a more fundamental fault than a pipe hazard); ordering
      // against the filtered-pass guard below is immaterial, the two
      // conditions are independent (`findPipeRefusal`'s own header). The
      // decision itself lives in `../evidence-precheck.js` and is shared
      // verbatim with the MCP `lore_evidence_add` handler, so neither
      // surface can drift. `capture: captureRequested` is the SAME boolean
      // already resolved above (governs whether this call spawned
      // `--command` itself) — a captured run's exit code is measured
      // directly, so the pipe hazard does not apply there.
      const pipeRefusal = findPipeRefusal({
        oracle: args.oracle as string,
        result: args.result as string,
        command: args.command as string,
        capture: captureRequested,
      });
      if (pipeRefusal !== null) {
        process.stderr.write(formatError(pipeRefusal) + "\n");
        process.exitCode = exitCode(pipeRefusal);
        return;
      }

      // reason: filtered-pass matched-count guard (see module header) — runs
      // AFTER the missing-oracle-file precheck so a command naming a
      // nonexistent file is refused for THAT reason first (the more
      // fundamental fault), never confounded with this one. The decision
      // itself lives in `../evidence-precheck.js` and is shared verbatim with
      // the MCP `lore_evidence_add` handler, so neither surface can drift.
      const filteredPassRefusal = findFilteredPassRefusal({
        oracle: args.oracle as string,
        result: args.result as string,
        command: args.command as string,
        ...(outputTail !== undefined ? { outputTail } : {}),
      });
      if (filteredPassRefusal !== null) {
        process.stderr.write(formatError(filteredPassRefusal) + "\n");
        process.exitCode = exitCode(filteredPassRefusal);
        return;
      }

      const by = resolveActor();
      const evidenceInput = {
        // reason: cast — CLI arg strings are validated by evidenceEntrySchema server-side;
        // an invalid oracle/result value fails loud with VALIDATION_ERROR rather than
        // silently coercing, matching every other CLI command's string→enum handoff.
        oracle: args.oracle as OracleKind,
        command: args.command as string,
        result: args.result as (typeof VALID_RESULTS)[number],
        recorded_by: by,
        source: app.callerSurface,
        // reason: task-lore-evidence-and-lore-release-accept-an-attestation-
        // from — TaskWorkflowService's uncommitted-worktree guard uses this
        // ONLY to detect the Q3 opt-in-hole mismatch (a claim recording NO
        // worktree while this call plainly runs from inside a real git repo).
        // A fresh subprocess per CLI invocation inherits the caller's real
        // shell cwd (same fact this file's own missing-oracle-file precheck
        // already documents), so this is always correct here.
        callerCwd: process.cwd(),
        // reason: task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the —
        // ALWAYS stamped, never omitted, never inferred from the tail's shape (see
        // this file's module header and TaskWorkflowService's own capture_source
        // invariant for the full discriminator contract). Splatted as a PAIR
        // (SPEC-143 AC-CT-2): on the --capture path this carries both
        // `capture_source: "runner"` AND the `capture_attestation` measured by the
        // spawn above, which `promoteCapturedAttestation` turns into the row's
        // `attestation`. ⛔ Never replace this spread with `capture_source:
        // provenance.capture_source` — that is the exact false-trust write this
        // criterion exists to refuse, and TypeScript cannot catch it (spread
        // properties escape excess-property checking).
        ...provenance,
        ...(outputTail !== undefined ? { output_tail: outputTail } : {}),
        ...(typeof args.ac === "string" ? { ac_ref: args.ac } : {}),
        ...(typeof args["checklist-ref"] === "string" ? { checklist_ref: args["checklist-ref"] } : {}),
      };

      // reason: SPEC-056 target-type dispatch (see module header) — try
      // taskWorkflowService FIRST, UNCHANGED; retry via phaseWorkflowService ONLY on
      // its own {field: "type", value: "phase"} rejection.
      let result = await app.taskWorkflowService.addEvidence(args.task as string, evidenceInput);
      if (
        !result.ok &&
        result.error.code === "VALIDATION_ERROR" &&
        result.error.field === "type" &&
        result.error.value === "phase"
      ) {
        result = await requirePhaseWorkflowService(app).addEvidence(args.task as string, evidenceInput);
      }

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { doc: result.value } }, null, 2));
        return;
      }

      console.log(
        `Recorded ${args.oracle as string} evidence (${args.result as string}) on ${result.value.slug} (v${result.value.version})${captureMargin}`,
      );
    } finally {
      app.close();
    }
  },
});
