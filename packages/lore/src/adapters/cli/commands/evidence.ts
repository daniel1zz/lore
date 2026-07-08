/**
 * lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual|other>
 *   --command "<cmd>" --result <pass|fail>
 *   [--output-tail <text> | --output-tail-file <path>] [--by <name>] [--ac <id>]
 *
 * Appends one oracle verification record to task.extra.verification_evidence
 * (append-only, capped at 50 entries). Bumps the doc version — visible via
 * `lore log <task>`.
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
 * Exit codes: 0 = success, 2 = argument error (both/neither output-tail flags
 *   given inconsistently), 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task,
 *   50-entry cap reached, bad oracle/result value), 5 = STALE_VERSION.
 *
 * Source: SPEC-025 §4 AC-WF-1, AC-WF-2; SPEC-038 §4, §7 D3
 */

import { readFileSync } from "fs";
import { defineCommand } from "citty";
import { ORACLE_KINDS, type OracleKind } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";

const VALID_RESULTS = ["pass", "fail"] as const;

/** Truncate to the last N chars — keeps the most recent (most relevant) output. */
function tailChars(text: string, max: number): string {
  return text.length > max ? text.slice(text.length - max) : text;
}

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
      const result = await app.taskWorkflowService.addEvidence(args.task as string, {
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
      });

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
