/**
 * lore uat — SPEC-054 structured UAT verdict surface.
 *
 * `lore uat record <plan> --json-file <path> [--json]` — the SOLE write path for a
 * `knowledge`/`uat` doc (mirrors `lore handoff --json-file`): the file IS the
 * `uatVerdictSchema`-valid `extra.uat` payload. Thin pipe over `UatService.record`
 * (validate → guarded create → informs-link to the plan). `lore-uat`'s PERSIST step calls
 * this instead of the free-text `lore create knowledge --sub-type retro`.
 *
 * `lore uat show <plan> [--json]` — reads the plan's LATEST linked UAT verdict via
 * `CorpusService.getLatestUatVerdict` (the SAME read the `plan-close` gate makes), printing
 * the P0-accept status + verdict summary; a plan with no verdict is a fact, not an error.
 *
 * Source: SPEC-054 §Scope.
 */

import { readFileSync } from "fs";
import { setExitCode } from "../run-scope.js";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";

const recordCommand = defineCommand({
  meta: { name: "record", description: "Record a structured UAT verdict for a plan (SPEC-054)" },
  args: {
    plan: {
      type: "positional",
      description:
        "Plan doc id/slug the verdict accepts/rejects — MUST resolve to a 'plan' doc; " +
        "UatService.record refuses any other type (the plan-close checkpoint is the sole " +
        "reader and only reads a verdict linked to a plan)",
    },
    "json-file": {
      type: "string",
      description: "Path to a uatVerdictSchema-valid JSON file — the file IS the extra.uat payload",
      required: true,
    },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      if (app.uatService === undefined) {
        process.stderr.write("Error: UAT service is not available in this build.\n");
        setExitCode(1);
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(readFileSync(args["json-file"] as string, "utf8"));
      } catch (e) {
        process.stderr.write(`Error: could not read/parse --json-file: ${(e as Error).message}\n`);
        setExitCode(2);
        return;
      }
      const by = resolveActor(undefined, inv.env, inv.cwd, inv.user);
      const result = await app.uatService.record(String(args.plan), payload, { by });
      if (!result.ok) {
        if (args.json) {
          console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
        } else {
          process.stderr.write(formatErrorFor(inv, result.error));
        }
        setExitCode(exitCode(result.error));
        return;
      }
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { slug: result.value.doc.slug } }, null, 2));
      } else {
        console.log(`Recorded UAT verdict: ${result.value.doc.slug} → informs ${String(args.plan)}`);
      }
    } finally {
      app.close();
    }
  },
});

const showCommand = defineCommand({
  meta: { name: "show", description: "Show a plan's latest linked UAT verdict (SPEC-054)" },
  args: {
    plan: { type: "positional", description: "Plan doc id/slug (reads its latest informs-linked UAT verdict)" },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const result = await app.corpusService.getLatestUatVerdict(String(args.plan));
      if (!result.ok) {
        if (args.json) {
          console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
        } else {
          process.stderr.write(formatErrorFor(inv, result.error));
        }
        setExitCode(exitCode(result.error));
        return;
      }
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
        return;
      }
      if (!result.value.present) {
        console.log(`No UAT verdict linked to plan "${String(args.plan)}".`);
        return;
      }
      const v = result.value.verdict!;
      console.log(`UAT verdict for ${result.value.docSlug}:`);
      console.log(`  Verdict: ${v.verdict}`);
      console.log(`  P0 accepted: ${result.value.p0Accepted ? "yes" : "no"}`);
      if (result.value.uncoveredP0.length > 0) {
        console.log(`  Uncovered P0: ${result.value.uncoveredP0.join(", ")}`);
      }
    } finally {
      app.close();
    }
  },
});

export default defineCommand({
  meta: { name: "uat", description: "Structured UAT verdict record/show (SPEC-054)" },
  subCommands: { record: recordCommand, show: showCommand },
});
