/**
 * lore calibration --stats [--doc-type <type>] [--prompt-version <v>] [--json]
 *
 * Read-only stats surface over `calibration_records` (SPEC-035 §4): one row per
 * doc_type × judge_prompt_version present in the bounded window (last 200,
 * `JudgmentService.computeCalibrationStats`), reporting {n, agreement_rate,
 * wilson_lower_bound (95% CI), window_limit}. Thin pipe — all aggregation math
 * lives in JudgmentService/`wilsonLowerBound` (@lore/core); this command only
 * resolves args and renders the result.
 *
 * `--stats` is currently the only mode (feeds SPEC-036 later per the parent
 * spec) — required so the command surface is unambiguous about intent as more
 * modes are added.
 *
 * Exit codes: 0 = success, 2 = missing --stats flag, 4 = VALIDATION_ERROR (bad
 * --doc-type), 1 = STORE_ERROR.
 *
 * Source: SPEC-035 §4
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";
import type { DocType } from "@lore/core";

export default defineCommand({
  meta: {
    name: "calibration",
    description: "Human-vs-AI review calibration stats (Wilson lower bound)",
  },
  args: {
    stats: {
      type: "boolean",
      description: "Print per (doc_type × prompt_version) calibration stats",
    },
    "doc-type": {
      type: "string",
      description: "Filter by doc type: prd | spec | adr | plan | knowledge | task",
    },
    "prompt-version": {
      type: "string",
      description: "Filter by judge prompt_version",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    if (!args.stats) {
      process.stderr.write("Error: `lore calibration` requires --stats (the only mode currently supported).\n");
      process.exitCode = 2;
      return;
    }

    const { app } = loadLoreApp();
    try {
      const filter: { doc_type?: DocType; prompt_version?: string } = {};
      if (typeof args["doc-type"] === "string") filter.doc_type = args["doc-type"] as DocType;
      if (typeof args["prompt-version"] === "string") filter.prompt_version = args["prompt-version"];

      const result = await app.judgmentService.computeCalibrationStats(filter);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const stats = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { stats } }, null, 2));
        return;
      }

      if (stats.length === 0) {
        console.log("No calibration records found.");
        return;
      }

      const headers = ["Doc Type", "Prompt Version", "N", "Agreement Rate", "Wilson LB", "Window"];
      const rows = stats.map((s) => [
        s.doc_type,
        s.prompt_version,
        String(s.n),
        s.agreement_rate.toFixed(3),
        s.wilson_lower_bound.toFixed(3),
        String(s.window_limit),
      ]);
      console.log(formatTable(headers, rows));
    } finally {
      app.close();
    }
  },
});
