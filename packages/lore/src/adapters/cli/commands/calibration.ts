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
 * `--stats` also prints the AUTONOMY outcome calibration per operation class (BR-1005,
 * spec AC-AU-8 half 4): auto decisions, outcomes in the window (stood / reversed), C (Wilson
 * lower bound over the window plus 50 pseudo-outcomes at the prior), the class threshold and
 * whether the class is escalating, plus the audit queue counts. `--observe` first runs one
 * outcome-observation sweep (reverted merges, stashes restored from refs/lore/archive/, reopened /
 * restored / corrected / invalidated decided docs; aged decisions with no reversal become `stood`).
 *
 * Exit codes: 0 = success, 2 = neither --stats nor --observe, 4 = VALIDATION_ERROR (bad
 * --doc-type), 1 = STORE_ERROR.
 *
 * Source: SPEC-035 §4
 */

import { spawnSync } from "node:child_process";

import { defineCommand } from "citty";
import { createAuditReversalProbe, createGitReversalProbes, type ClassCalibrationStats } from "../../../service/autonomy-calibration-service.js";
import { DecisionService } from "../../../service/decision-service.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, formatTable } from "../utils.js";
import { ok, type DocType, type LoreError, type Result } from "@lore/core";
import { wrapStoreError } from "../../../store/store-shared.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

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
    observe: {
      type: "boolean",
      description: "Run one autonomy outcome-observation sweep (records reversed / stood outcomes) before printing",
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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    if (!args.stats && !args.observe) {
      inv.io.stderr.write("Error: `lore calibration` requires --stats or --observe.\n");
      return 2;
    }

    const { app, dbPath } = loadLoreApp({ inv });
    try {
      const autonomy = await collectAutonomyStats(dbPath, app.repoRoot, args.observe === true);
      if (!autonomy.ok) {
        inv.io.stderr.write(formatErrorFor(inv, autonomy.error) + "\n");
        return exitCode(autonomy.error);
      }
      if (!args.stats) {
        printLine(inv.io.stdout, autonomy.value.swept === null ? "" : `Observed ${autonomy.value.swept.reversed} reversed, ${autonomy.value.swept.stood} stood (${autonomy.value.swept.probed} decision(s) probed).`);
        return;
      }
      const filter: { doc_type?: DocType; prompt_version?: string } = {};
      if (typeof args["doc-type"] === "string") filter.doc_type = args["doc-type"] as DocType;
      if (typeof args["prompt-version"] === "string") filter.prompt_version = args["prompt-version"];

      const result = await app.judgmentService.computeCalibrationStats(filter);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const stats = result.value;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { stats, autonomy: autonomy.value.classes } }, null, 2));
        return;
      }

      if (stats.length === 0) {
        printLine(inv.io.stdout, "No calibration records found.");
        printLine(inv.io.stdout, renderAutonomyStats(autonomy.value.classes));
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
      printLine(inv.io.stdout, formatTable(headers, rows));
      printLine(inv.io.stdout, renderAutonomyStats(autonomy.value.classes));
    } finally {
      app.close();
    }
  },
});

interface AutonomyStatsView {
  readonly classes: ClassCalibrationStats[];
  readonly swept: { readonly reversed: number; readonly stood: number; readonly probed: number } | null;
}

/** Git runner bound to `repoRoot`; never throws (a spawn failure is status 1 with the message on stderr). */
function gitRunnerFor(repoRoot: string) {
  return (args: readonly string[]) => {
    const result = spawnSync("git", [...args], { cwd: repoRoot, encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
  };
}

async function collectAutonomyStats(dbPath: string, repoRoot: string | undefined, observe: boolean): Promise<Result<AutonomyStatsView, LoreError>> {
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(dbPath);
  } catch (cause) {
    return wrapStoreError(cause);
  }
  try {
    const probes = [createAuditReversalProbe(store), ...(repoRoot === undefined ? [] : createGitReversalProbes(gitRunnerFor(repoRoot)))];
    const service = new DecisionService({ store, executorRun: null, reversalProbes: probes });
    let swept: AutonomyStatsView["swept"] = null;
    if (observe) {
      const report = await service.calibration().observe();
      if (!report.ok) return report;
      swept = report.value;
    }
    const classes = await service.calibrationStats();
    if (!classes.ok) return classes;
    return ok({ classes: classes.value, swept });
  } finally {
    store.close();
  }
}

/** BR-1005 surface: outcome-based counts and the calibrated C per autonomy class. */
function renderAutonomyStats(classes: readonly ClassCalibrationStats[]): string {
  const rows = classes.map((c) => [
    c.class,
    String(c.auto_decisions),
    `${c.stood} / ${c.reversed}`,
    String(c.window),
    String(c.prior),
    c.confidence.toFixed(3),
    c.threshold === null ? "-" : String(c.threshold),
    c.escalating ? "ESCALATING" : "auto",
    `${c.audit_pending} / ${c.audit_answered}`,
  ]);
  const headers = ["Class", "Auto decisions", "Stood / Reversed", "Window", "Prior", "C (Wilson LB)", "Threshold", "State", "Audit pending / answered"];
  return `\nAutonomy outcome calibration (C = Wilson lower bound over the last 50 outcomes plus 50 pseudo-outcomes at the prior):\n${formatTable(headers, rows)}`;
}
