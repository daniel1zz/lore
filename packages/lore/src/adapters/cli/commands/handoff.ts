/**
 * lore handoff — SPEC-041 S2 lossless session-continuity handoff authoring surface.
 * (The `coverage-check` subcommand and its Stop hook were removed: AC-LG-7 follow-up, serves neither goal.)
 *
 * ── Default (write) path ──────────────────────────────────────────────────────
 *
 * PRIMARY path: `--json-file <path>` — the file IS the `extra.handoff` SSOT payload
 * (D6: "the JSON IS the extra.handoff SSOT — no fork"). Human convenience path:
 * repeatable `--file` / `--decision "<judgment>[@<conf>]"` / `--next` flags, plus
 * `--failing-command` + `--failing-tail-file` (mutually required). `--plan`
 * works with BOTH paths (D6) — passed explicitly, it overrides the json-file's own
 * `plan_ref`; omitted, the json-file's own value is left untouched. `by` is always the
 * invoking identity — there is no `--by`, and a payload-supplied `by` is overridden. The two
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
 * that sibling module instead (mirrors `status-stamp-verdict.ts`'s split for
 * `commands/assess.ts`, `packages/lore/src/adapters/cli/CLAUDE.md`).
 *
 * There is deliberately no `--content`/`--content-file` flag, ever — a
 * hand-authored body would fork the SSOT; `content` is always the deterministic
 * `renderHandoffContent(extra.handoff)` projection (D6).
 */

import { readFileSync } from "fs";

import { defineLoreCommand } from "../cli-exit.js";
import { handoffExtraSchema, tailChars } from "@lore/core";
import type { HandoffExtra } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor, resolveActor } from "../utils.js";
import { assembleHandoffInput, parseHandoffJsonFile } from "../handoff-input.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/** Field flags mutually exclusive with `--json-file` (D6) — `--plan` is NOT in this list; it works with both paths. */
const FIELD_FLAGS = ["file", "decision", "next", "failing-command", "failing-tail-file"] as const;

/** citty/mri yields a single string for one occurrence of a repeatable flag, an array for ≥2, or `undefined` for zero. Normalizes to a string array. */
function normalizeRepeatable(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

export default defineLoreCommand({
  meta: {
    name: "handoff",
    description: "Write a lossless session-continuity handoff document (SPEC-041 S2)",
  },
  args: {
    subcommand: {
      type: "positional",
      description: "Not used: any value is refused (the former `coverage-check` subcommand was removed).",
      required: false,
    },
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
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const subcommand = typeof args.subcommand === "string" ? args.subcommand : undefined;
    if (subcommand !== undefined) {
      inv.io.stderr.write(`Error: unknown \`lore handoff\` subcommand "${subcommand}" (omit it: \`lore handoff\` takes only flags)\n`);
      return 2;
    }

    const rawArgv = inv.argv;
    const jsonFilePassed = typeof args["json-file"] === "string";
    const conflictingFlags = FIELD_FLAGS.filter((f) => rawArgv.includes(`--${f}`));

    if (jsonFilePassed && conflictingFlags.length > 0) {
      inv.io.stderr.write(
        `Error: --json-file is mutually exclusive with ${conflictingFlags.map((f) => `--${f}`).join(", ")}.\n`,
      );
      return 2;
    }

    const explicitPlan = typeof args.plan === "string" && args.plan.trim() !== "" ? args.plan : undefined;

    let candidate: HandoffExtra;

    if (jsonFilePassed) {
      let raw: string;
      try {
        raw = readFileSync(args["json-file"] as string, "utf8");
      } catch (e) {
        inv.io.stderr.write(
          `Error: cannot read --json-file '${args["json-file"] as string}': ${e instanceof Error ? e.message : String(e)}\n`,
        );
        return 2;
      }

      const parsed = parseHandoffJsonFile(raw, {
        // reason: the writer is the invoking run alone — a payload-supplied `by` is overridden, never trusted.
        by: resolveActor(inv),
        ...(explicitPlan !== undefined ? { plan: explicitPlan } : {}),
      });
      if (!parsed.ok) {
        inv.io.stderr.write(`Error: ${parsed.error}\n`);
        return 2;
      }
      candidate = parsed.value;
    } else {
      const hasFailingCommand = typeof args["failing-command"] === "string";
      const hasFailingTailFile = typeof args["failing-tail-file"] === "string";
      if (hasFailingCommand !== hasFailingTailFile) {
        inv.io.stderr.write(
          "Error: --failing-command and --failing-tail-file must be passed together.\n",
        );
        return 2;
      }

      let failingTail: string | undefined;
      if (hasFailingTailFile) {
        try {
          failingTail = tailChars(readFileSync(args["failing-tail-file"] as string, "utf8"), 2000);
        } catch (e) {
          inv.io.stderr.write(
            `Error: cannot read --failing-tail-file '${args["failing-tail-file"] as string}': ${e instanceof Error ? e.message : String(e)}\n`,
          );
          return 2;
        }
      }

      const assembled = assembleHandoffInput({
        by: resolveActor(inv),
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
        inv.io.stderr.write(
          `Error: invalid handoff payload — field '${issue !== undefined ? issue.path.join(".") : "(root)"}': ${issue?.message ?? "validation failed"}\n`,
        );
        return 2;
      }
      candidate = validated.data;
    }

    const { app } = loadLoreApp({ inv });
    try {
      if (app.sessionService === undefined) {
        inv.io.stderr.write("Error: SessionService not wired on this App instance.\n");
        return 1;
      }

      // reason: session-trail D16 — the trail read is keyed by the run lore VERIFIED (an unregistered, unverifiable or absent
      // `LORE_HARNESS_RUN` verifies to null), never the raw env value; the service reads that run's session trail.
      const identity = await app.verifiedInvocationIdentity?.();
      if (identity !== undefined && !identity.ok) {
        inv.io.stderr.write(formatErrorFor(inv, identity.error) + "\n");
        return exitCode(identity.error);
      }
      const run = identity?.value?.harnessRun ?? null;

      const result = await app.sessionService.writeHandoff(candidate, undefined, { run });
      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const doc = result.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        printLine(inv.io.stdout, `Recorded handoff by ${candidate.by}`);
        printLine(inv.io.stdout, `  Slug:   ${doc.slug}`);
        printLine(inv.io.stdout, `  Status: ${doc.status} (v${doc.version})`);
        printLine(inv.io.stdout, `\nRun \`lore get ${doc.slug}\` to view the document.`);
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
