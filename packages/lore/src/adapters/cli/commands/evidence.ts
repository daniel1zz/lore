/**
 * lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual|other>
 *   --command "<cmd>" --result <pass|fail|expected-fail>
 *   [--capture | --output-tail <text> | --output-tail-file <path>] [--by <name>]
 *   [--ac <id>] [--checklist-ref <id>]
 *
 * --capture (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the) —
 * spawns `--command` itself (`node:child_process.spawnSync`, `shell: true`, this
 * process's own `process.cwd()`, a fixed {@link CAPTURE_TIMEOUT_MS} timeout) and
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
 * A self-reported `--result pass` for `--oracle` `test`/`e2e` with NO `--capture`
 * and no genuine `--output-tail`/`--output-tail-file` used to record cleanly with
 * an EMPTY `output_tail` — two measurements this task's own doc records (a hand-
 * authored prose tail satisfying the non-empty predicate; eight `pass` rows with
 * `output_tail` length 0 recorded under an explicit dispatch instruction naming
 * this exact defect). `TaskWorkflowService`'s `rejectMissingPassOutputTail` now
 * refuses any `--result pass` self-report lacking a genuinely non-empty tail
 * UNLESS `capture_source === "runner"` (i.e. `--capture` was used) — the
 * PASS-side sibling of the pre-existing non-pass requirement
 * (spec-evidence-output-tail-integrity-a-self-reported-non-pass). Every write
 * this command makes stamps `capture_source: "self-report"` when `--capture` is
 * NOT used — never omitted, never inferred from the tail's shape.
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
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor.
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
 *   a self-reported `--result pass` with no genuine tail and no `--capture`, a
 *   `--capture` spawn whose observed exit code contradicts the declared
 *   `--result`, OR a missing oracle file / an unproven filtered pass / a
 *   mixed-runner command per the prechecks below, OR a `--result pass` from a
 *   claim whose recorded worktree is uncommitted / from a no-worktree claim
 *   running inside a real git repo — TaskWorkflowService's own uncommitted-
 *   worktree guard, see module header), 5 = STALE_VERSION.
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
 * missing" from "the precheck looked in the wrong tree". This CLI surface's
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
 *   the PASS-tail requirement, `capture_source`)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "fs";
import { dirname } from "path";
import { defineCommand } from "citty";
import { ORACLE_KINDS, tailChars, type CaptureSource, type LoreError, type OracleKind } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import {
  findMissingOracleFilesForEvidence,
  findFilteredPassRefusal,
  findMixedRunnerRefusal,
  findCaptureFlagConflict,
  describePrecheckRoots,
} from "../evidence-precheck.js";

const VALID_RESULTS = ["pass", "fail", "expected-fail"] as const;

/**
 * Fixed timeout for `--capture`'s own child-process spawn (task-a-non-empty-
 * output-tail-can-be-hand-authored-prose-and-the) — 10 minutes, matching this
 * harness's own Bash-tool maximum. Deliberately NOT a CLI-configurable flag: a
 * capture is meant for a single scoped oracle command (`bun run typecheck`, one
 * `vitest run <file>` invocation), not a full test suite — `bun run test:changed`
 * / individual test-file commands documented across this repo's own CLAUDE.md
 * all comfortably finish well inside this window.
 */
const CAPTURE_TIMEOUT_MS = 10 * 60 * 1000;

/** `spawnSync`'s own captured-buffer ceiling (CLAUDE.md standing lesson: a spawn
 * capturing growing output MUST set an explicit `maxBuffer` — the 1 MiB Node
 * default silently truncates). Generous relative to the 4000-char tail that
 * actually gets persisted — this only bounds what `spawnSync` buffers in memory
 * before `tailChars` trims it. */
const CAPTURE_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

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
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
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
    let captureSource: CaptureSource = "self-report";

    if (captureRequested) {
      const spawnResult = spawnSync(args.command as string, {
        shell: true,
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: CAPTURE_MAX_BUFFER_BYTES,
        timeout: CAPTURE_TIMEOUT_MS,
      });

      if (spawnResult.error !== undefined) {
        const captureError: LoreError = {
          code: "VALIDATION_ERROR",
          field: "capture",
          message: `--capture failed to spawn --command: ${spawnResult.error.message}`,
          value: args.command,
        };
        process.stderr.write(formatError(captureError) + "\n");
        process.exitCode = exitCode(captureError);
        return;
      }
      if (spawnResult.status === null) {
        // reason: killed by a signal (incl. this spawn's own timeout) before
        // exiting normally — there is no real exit code to cross-check the
        // declared --result against, so this is refused the same way a spawn
        // failure is, never silently treated as either pass or fail.
        const captureError: LoreError = {
          code: "VALIDATION_ERROR",
          field: "capture",
          message:
            `--capture's spawn of --command was killed by signal ${spawnResult.signal ?? "unknown"} ` +
            `(no exit code observed — possibly the ${CAPTURE_TIMEOUT_MS / 1000}s capture timeout). ` +
            "Recorded nothing; narrow --command to a smaller scope and retry.",
          value: args.command,
        };
        process.stderr.write(formatError(captureError) + "\n");
        process.exitCode = exitCode(captureError);
        return;
      }

      const declaredPass = args.result === "pass";
      const observedPass = spawnResult.status === 0;
      if (declaredPass !== observedPass) {
        const captureError: LoreError = {
          code: "VALIDATION_ERROR",
          field: "result",
          message:
            `--capture ran --command and observed exit code ${spawnResult.status} — declared ` +
            `--result "${args.result as string}" does not match (pass requires exit 0; fail/` +
            "expected-fail requires nonzero). Recorded nothing; fix --result or --command and retry.",
          value: { observed_exit_code: spawnResult.status, declared_result: args.result },
        };
        process.stderr.write(formatError(captureError) + "\n");
        process.exitCode = exitCode(captureError);
        return;
      }

      const combined = [spawnResult.stdout, spawnResult.stderr].filter((s) => s.length > 0).join("\n");
      outputTail = tailChars(combined, 4000);
      captureSource = "runner";
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

      const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
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
        // invariant for the full discriminator contract).
        capture_source: captureSource,
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
        `Recorded ${args.oracle as string} evidence (${args.result as string}) on ${result.value.slug} (v${result.value.version})`,
      );
    } finally {
      app.close();
    }
  },
});
