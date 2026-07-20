/**
 * lore handoff — SPEC-041 S2 lossless session-continuity handoff authoring surface.
 *
 * PRIMARY path: `--json-file <path>` — the file IS the `extra.handoff` SSOT payload
 * (D6: "the JSON IS the extra.handoff SSOT — no fork"). Human convenience path:
 * repeatable `--file` / `--decision "<judgment>[@<conf>]"` / `--next` flags, plus
 * `--failing-command` + `--failing-tail-file` (mutually required). `--plan`/`--by`
 * work with BOTH paths (D6) — passed explicitly, they override the json-file's own
 * `plan_ref`/`by`; omitted, the json-file's own values are left untouched. The two
 * paths are otherwise mutually exclusive: `--json-file` rejects any field flag
 * (`--file`/`--decision`/`--next`/`--failing-command`/`--failing-tail-file`).
 *
 * Both paths funnel through the SAME `handoffExtraSchema` validation before calling
 * `SessionService.writeHandoff` — a Zod failure (including the schema's
 * `next_steps.min(1)` constraint — "a handoff naming no next step is a status
 * report, not a handoff") prints a field-precise message and exits 2.
 * `SessionService`-level errors (e.g. an unresolvable `--plan`) map through the
 * normal `exitCode()`/`formatError()` pipeline (VALIDATION_ERROR → 4).
 *
 * The pure candidate-assembly/parsing functions (`parseDecisionFlag`,
 * `assembleHandoffInput`, `parseHandoffJsonFile`) live in `../handoff-input.js`,
 * NOT this file — this file transitively imports `loader.ts` (`bun:sqlite`), which
 * vitest cannot resolve, so `session-roundtrip.test.ts` (AC-SL-7) imports them from
 * that sibling module instead (mirrors `assess-render.ts`'s split for
 * `commands/assess.ts`, `packages/lore/src/adapters/cli/CLAUDE.md`).
 *
 * There is deliberately no `--content`/`--content-file` flag, ever — a
 * hand-authored body would fork the SSOT; `content` is always the deterministic
 * `renderHandoffContent(extra.handoff)` projection (D6).
 *
 * Source: SPEC-041 §3 D6.
 */

import { readFileSync } from "fs";
import { defineCommand } from "citty";
import { handoffExtraSchema, tailChars } from "@lore/core";
import type { HandoffExtra } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { assembleHandoffInput, parseHandoffJsonFile } from "../handoff-input.js";

/** Field flags mutually exclusive with `--json-file` (D6) — `--plan`/`--by` are NOT in this list; they work with both paths. */
const FIELD_FLAGS = ["file", "decision", "next", "failing-command", "failing-tail-file"] as const;

/** citty/mri yields a single string for one occurrence of a repeatable flag, an array for ≥2, or `undefined` for zero. Normalizes to a string array. */
function normalizeRepeatable(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

export default defineCommand({
  meta: {
    name: "handoff",
    description: "Write a lossless session-continuity handoff document (SPEC-041 S2)",
  },
  args: {
    "json-file": {
      type: "string",
      description:
        "PRIMARY path: path to a handoffExtraSchema-valid JSON file — the file IS the extra.handoff payload. Mutually exclusive with --file/--decision/--next/--failing-command/--failing-tail-file.",
    },
    file: {
      type: "string",
      description: "[repeatable] Modified file path (human path; mutually exclusive with --json-file)",
    },
    decision: {
      type: "string",
      description: '[repeatable] "<judgment>[@<confidence 0-100>]" (human path)',
    },
    next: {
      type: "string",
      description: "[repeatable, required unless --json-file] Next step (human path)",
    },
    "failing-command": {
      type: "string",
      description: "Failing oracle command — requires --failing-tail-file (human path)",
    },
    "failing-tail-file": {
      type: "string",
      description:
        "Path to a file whose last 2000 chars become the failing oracle's output_tail — requires --failing-command (human path)",
    },
    plan: {
      type: "string",
      description: "Plan doc id/slug this handoff's parent should resolve to (works with both paths)",
    },
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username (works with both paths)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    const rawArgv = process.argv.slice(2);
    const jsonFilePassed = typeof args["json-file"] === "string";
    const conflictingFlags = FIELD_FLAGS.filter((f) => rawArgv.includes(`--${f}`));

    if (jsonFilePassed && conflictingFlags.length > 0) {
      process.stderr.write(
        `Error: --json-file is mutually exclusive with ${conflictingFlags.map((f) => `--${f}`).join(", ")}.\n`,
      );
      process.exitCode = 2;
      return;
    }

    const explicitBy = typeof args.by === "string" && args.by.trim() !== "" ? args.by : undefined;
    const explicitPlan = typeof args.plan === "string" && args.plan.trim() !== "" ? args.plan : undefined;

    let candidate: HandoffExtra;

    if (jsonFilePassed) {
      let raw: string;
      try {
        raw = readFileSync(args["json-file"] as string, "utf8");
      } catch (e) {
        process.stderr.write(
          `Error: cannot read --json-file '${args["json-file"] as string}': ${e instanceof Error ? e.message : String(e)}\n`,
        );
        process.exitCode = 2;
        return;
      }

      const parsed = parseHandoffJsonFile(raw, {
        ...(explicitBy !== undefined ? { by: explicitBy } : {}),
        ...(explicitPlan !== undefined ? { plan: explicitPlan } : {}),
      });
      if (!parsed.ok) {
        process.stderr.write(`Error: ${parsed.error}\n`);
        process.exitCode = 2;
        return;
      }
      candidate = parsed.value;
    } else {
      const hasFailingCommand = typeof args["failing-command"] === "string";
      const hasFailingTailFile = typeof args["failing-tail-file"] === "string";
      if (hasFailingCommand !== hasFailingTailFile) {
        process.stderr.write(
          "Error: --failing-command and --failing-tail-file must be passed together.\n",
        );
        process.exitCode = 2;
        return;
      }

      let failingTail: string | undefined;
      if (hasFailingTailFile) {
        try {
          failingTail = tailChars(readFileSync(args["failing-tail-file"] as string, "utf8"), 2000);
        } catch (e) {
          process.stderr.write(
            `Error: cannot read --failing-tail-file '${args["failing-tail-file"] as string}': ${e instanceof Error ? e.message : String(e)}\n`,
          );
          process.exitCode = 2;
          return;
        }
      }

      const assembled = assembleHandoffInput({
        by: resolveActor(explicitBy),
        ...(explicitPlan !== undefined ? { plan: explicitPlan } : {}),
        files: normalizeRepeatable(args.file),
        decisions: normalizeRepeatable(args.decision),
        next: normalizeRepeatable(args.next),
        ...(hasFailingCommand ? { failingCommand: args["failing-command"] as string } : {}),
        ...(failingTail !== undefined ? { failingTail } : {}),
      });

      const validated = handoffExtraSchema.safeParse(assembled);
      if (!validated.success) {
        const issue = validated.error.issues[0];
        process.stderr.write(
          `Error: invalid handoff payload — field '${issue !== undefined ? issue.path.join(".") : "(root)"}': ${issue?.message ?? "validation failed"}\n`,
        );
        process.exitCode = 2;
        return;
      }
      candidate = validated.data;
    }

    const { app } = loadLoreApp();
    try {
      if (app.sessionService === undefined) {
        process.stderr.write("Error: SessionService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }

      const result = await app.sessionService.writeHandoff(candidate);
      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Recorded handoff by ${candidate.by}`);
        console.log(`  Slug:   ${doc.slug}`);
        console.log(`  Status: ${doc.status} (v${doc.version})`);
        console.log(`\nRun \`lore get ${doc.slug}\` to view the document.`);
      }
    } finally {
      app.close();
    }
  },
});
