/**
 * lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual|other>
 *   --command "<cmd>" --result <pass|fail>
 *   [--output-tail <text> | --output-tail-file <path>] [--by <name>] [--ac <id>]
 *   [--checklist-ref <id>]
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
 *   50-entry cap reached, bad oracle/result value, unknown ac_ref/checklist_ref),
 *   5 = STALE_VERSION.
 *
 * Source: SPEC-025 §4 AC-WF-1, AC-WF-2; SPEC-038 §4, §7 D3; SPEC-056 §Design Decisions D8
 */

import { readFileSync } from "fs";
import { defineCommand } from "citty";
import { ORACLE_KINDS, tailChars, type OracleKind } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";

const VALID_RESULTS = ["pass", "fail"] as const;

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

    const { app } = loadLoreApp();
    try {
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
