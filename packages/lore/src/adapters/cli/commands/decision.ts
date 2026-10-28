/**
 * lore decision — the outcome link and the rates of recorded decisions (BR-1481).
 *
 * Subcommands:
 *   trace <plan> --issue <n> --decision <slug>@<version> --part <gate id | score dimension | premise>
 *   rates [--kind <rule revision|document revision>] [--since <date>] [--json]
 *
 * Thin pipe over `DecisionOutcomeService`. `trace` appends the triple to the plan's latest milestone review once (a repeat
 * is a no-op; concurrent traces both land); a decision or part that does not exist is exit 4. `rates` prints, per gate and
 * score dimension, the decisions that passed, the traced failures, the share as a LOWER bound, the rule-of-three bound at
 * zero failures, the decisions in no plan, and the two guard figures. `lore set` refuses `traced_decisions`.
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, "Outcome link and rates".
 */

import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { RateRow, RatesReport } from "../../../service/decision-outcome-service.js";
import type { LoreError } from "@lore/core";

/** `≥ x/y (lower bound)` plus, at zero failures, the rule-of-three upper bound. */
function renderRow(label: string, row: RateRow): string {
  const share = `≥ ${String(row.tracedFailures)}/${String(row.decisions)} (lower bound)`;
  const bound = row.ruleOfThreeUpperBound !== undefined ? `; rule of three: < 3/${String(row.decisions)} at 95%` : "";
  return `  ${label} ${row.part}: ${String(row.decisions)} passed, ${String(row.tracedFailures)} traced failures, share ${share}${bound}`;
}

function ratio(value: number | null, top: number, bottom: number): string {
  return value === null ? `n/a (${String(top)}/${String(bottom)})` : `${value.toFixed(2)} (${String(top)}/${String(bottom)})`;
}

/** The text of a rates report. */
function renderRates(report: RatesReport): string[] {
  const lines = [`Decision rates — kind: ${report.kind ?? "all"}, since: ${report.since ?? "the beginning"}; ${String(report.decisions)} recorded decisions`];
  lines.push("Gates:");
  lines.push(...(report.gates.length === 0 ? ["  (none recorded)"] : report.gates.map((r) => renderRow("gate", r))));
  lines.push("Score dimensions:");
  lines.push(...(report.dimensions.length === 0 ? ["  (none recorded)"] : report.dimensions.map((r) => renderRow("dimension", r))));
  lines.push(`Decisions in no plan: ${String(report.decisionsInNoPlan)}`);
  lines.push("Guards:");
  lines.push(`  traced links per milestone review: ${ratio(report.guards.tracedLinksPerReview, report.guards.tracedLinks, report.guards.milestoneReviews)}`);
  lines.push(`  decisions per archived task: ${ratio(report.guards.decisionsPerArchivedTask, report.decisions, report.guards.archivedTasks)}`);
  return lines;
}

export default defineLoreCommand({
  meta: { name: "decision", description: "Trace escaped defects to recorded decisions and read the decision rates (BR-1481)" },
  subCommands: {
    trace: defineLoreCommand({
      meta: { name: "trace", description: "Link an issue to the decision part that let the defect through" },
      args: {
        plan: { type: "positional", description: "Plan ID or slug", required: true },
        issue: { type: "string", description: "The issue number that exposed the defect", required: true },
        decision: { type: "string", description: "The decision, <slug>@<version>", required: true },
        part: { type: "string", description: "A gate id, a score dimension, or premise", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const fail = (error: LoreError): number => {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, error));
            return exitCode(error);
          };
          const service = app.decisionOutcomeService;
          if (service === undefined) {
            inv.io.stderr.write("Error: DecisionOutcomeService is not available in this build.\n");
            return 1;
          }
          const issueText = (args.issue as string).replace(/^#/, "");
          const issue = /^\d+$/.test(issueText) ? Number(issueText) : Number.NaN;
          const result = await service.trace({ plan: args.plan as string, issue, decision: args.decision as string, part: args.part as string });
          if (!result.ok) return fail(result.error);
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          else {
            const { entry, review, added } = result.value;
            const what = `${entry.decision} (${entry.part}) to issue #${String(entry.issue)} on ${review}`;
            printLine(inv.io.stdout, added ? `Traced ${what}.` : `Already traced ${what}; nothing written.`);
          }
        } finally {
          app.close();
        }
        return 0;
      },
    }),
    rates: defineLoreCommand({
      meta: { name: "rates", description: "Per gate and score dimension: decisions passed, traced failures, lower-bound share" },
      args: {
        kind: { type: "string", description: "Only decisions of this kind: rule revision | document revision" },
        since: { type: "string", description: "Only decisions recorded at or after this date" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const service = app.decisionOutcomeService;
          if (service === undefined) {
            inv.io.stderr.write("Error: DecisionOutcomeService is not available in this build.\n");
            return 1;
          }
          const result = await service.rates({
            ...(args.kind !== undefined ? { kind: args.kind as string } : {}),
            ...(args.since !== undefined ? { since: args.since as string } : {}),
          });
          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error));
            return exitCode(result.error);
          }
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          else for (const line of renderRates(result.value)) printLine(inv.io.stdout, line);
        } finally {
          app.close();
        }
        return 0;
      },
    }),
  },
});
