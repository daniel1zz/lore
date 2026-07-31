/**
 * lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual|other>
 *   --command "<cmd>" --result <pass|fail|expected-fail>
 *   [--output-tail <text> | --output-tail-file <path>] [--by <name>] [--ac <id>]
 *   [--checklist-ref <id>]
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
 * Exit codes: 0 = success, 2 = argument error (both/neither output-tail flags
 *   given inconsistently), 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task/phase,
 *   50-entry cap reached, bad oracle/result value, unknown ac_ref/checklist_ref, OR
 *   a missing oracle file / an unproven filtered pass per the two prechecks
 *   below), 5 = STALE_VERSION.
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
 * Source: SPEC-025 §4 AC-WF-1, AC-WF-2; SPEC-038 §4, §7 D3; SPEC-056 §Design Decisions D8
 */

import { existsSync, readFileSync } from "fs";
import { dirname } from "path";
import { defineCommand } from "citty";
import { ORACLE_KINDS, tailChars, type LoreError, type OracleKind } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import {
  findMissingOracleFilesForEvidence,
  findFilteredPassRefusal,
} from "../evidence-precheck.js";

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

    let outputTail: string | undefined;
    if (typeof args["output-tail"] === "string") {
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
      const missing = findMissingOracleFilesForEvidence({
        oracle: args.oracle as string,
        result: args.result as string,
        command: args.command as string,
        cwd: process.cwd(),
        // reason: dbPath is <corpusRoot>/.lore/lore.db — the corpus root is two
        // levels up. Distinct from cwd whenever the invocation runs from a
        // subdirectory of the corpus (or a linked worktree, SPEC-063).
        corpusRoot: dirname(dirname(dbPath)),
        fileExists: existsSync,
      });
      if (missing.length > 0) {
        const precheckError: LoreError = {
          code: "VALIDATION_ERROR",
          field: "command",
          message:
            `Oracle file(s) not found: ${missing.join(", ")}. ` +
            "Author the oracle file or fix the path in --command; " +
            "use --oracle manual for genuinely manual checks.",
          value: args.command,
        };
        process.stderr.write(formatError(precheckError) + "\n");
        process.exitCode = exitCode(precheckError);
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
