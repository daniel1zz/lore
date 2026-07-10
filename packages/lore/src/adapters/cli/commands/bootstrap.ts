/**
 * lore bootstrap [--by <name>] [--json] — SPEC-041 S1 volatile session pointer-set.
 *
 * A fresh session (an AI agent or a human) queries this ONE deterministic, read-only
 * verb to learn the volatile delta since the static layer (CLAUDE.md/AGENTS.md
 * projections cover architecture/conventions — deliberately NOT this command's job,
 * SPEC-041 "Division of labor"): active plans + task readiness, the pending-review
 * queue, the caller's own claims, armed gate checkpoints + their feeding-skill
 * source, and the newest handoffs recorded per plan (plus a corpus-wide resume
 * hint). Thin pipe over `SessionService.bootstrap` — zero store mutations.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor. Only filters `my_claims`; every other field is
 * corpus-wide regardless of `by`.
 *
 * Exit codes: 0 = success (including an empty corpus — `root: null`, every array
 *   `[]`, AC-SL-10), non-zero only on an underlying store error.
 *
 * Source: SPEC-041 §3 D1, D2
 */

import { defineCommand } from "citty";
import type { BootstrapReport } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";

/**
 * Compact human-readable rendering of a `BootstrapReport` — pointers only, never
 * doc body content (module header). Pure — no IO, no wall-clock reads (every
 * time-derived field is already computed by `SessionService.bootstrap`).
 *
 * @param report - A `BootstrapReport` from `SessionService.bootstrap`.
 * @param by - The actor identity `bootstrap` was called with (for the header line).
 * @returns Multi-line text block ready for `console.log`.
 */
export function formatBootstrapReport(report: BootstrapReport, by: string): string {
  const lines: string[] = [];

  lines.push(`── lore bootstrap (${by}) ──`);
  lines.push(
    report.root !== null ? `Root: ${report.root.slug} "${report.root.title}"` : "Root: (none)",
  );
  lines.push("");

  lines.push(`Active plans (${report.active_plans.length}):`);
  if (report.active_plans.length > 0) {
    for (const plan of report.active_plans) {
      lines.push(
        `  - ${plan.slug} "${plan.title}" — ready ${plan.task_counts.ready}, ` +
          `claimed ${plan.task_counts.claimed}, done ${plan.task_counts.done}`,
      );
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");

  lines.push(
    `Pending reviews: ${report.pending_reviews.count}` +
      (report.pending_reviews.slugs.length > 0
        ? ` (${report.pending_reviews.slugs.join(", ")})`
        : ""),
  );
  lines.push("");

  lines.push(`My claims (${by}, ${report.my_claims.length}):`);
  if (report.my_claims.length > 0) {
    for (const claim of report.my_claims) {
      lines.push(
        `  - ${claim.task_slug} (plan ${claim.plan_slug}) claimed ${claim.claimed_at}` +
          (claim.stale ? " (stale)" : ""),
      );
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");

  lines.push(`Armed gates (${report.armed_gates.length}):`);
  if (report.armed_gates.length > 0) {
    for (const gate of report.armed_gates) {
      lines.push(
        `  - ${gate.checkpoint}` +
          (gate.feeding_source_slug !== null ? ` (feeding: ${gate.feeding_source_slug})` : " (no feeding source)"),
      );
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");

  lines.push(`Latest handoffs (${report.latest_handoffs.length}):`);
  if (report.latest_handoffs.length > 0) {
    for (const handoff of report.latest_handoffs) {
      lines.push(
        `  - ${handoff.plan_slug ?? "(no plan)"}: ${handoff.handoff_slug} by ${handoff.by} at ${handoff.at}`,
      );
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");

  lines.push(
    report.resume_hint !== null
      ? `Resume hint: ${report.resume_hint.plan_slug ?? "(no plan)"} / ${report.resume_hint.handoff_slug}`
      : "Resume hint: (none)",
  );
  lines.push(
    `Corpus: ${report.corpus.total_docs} docs, last updated ${report.corpus.last_updated ?? "(never)"}`,
  );

  return lines.join("\n");
}

export default defineCommand({
  meta: {
    name: "bootstrap",
    description: "SPEC-041 S1 volatile session pointer-set (plans, claims, queue, gates, handoffs) — read-only",
  },
  args: {
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
    },
    json: {
      type: "boolean",
      description: "Output the raw BootstrapReport as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      if (app.sessionService === undefined) {
        process.stderr.write("Error: SessionService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }

      const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
      const result = await app.sessionService.bootstrap(by);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
      } else {
        console.log(formatBootstrapReport(result.value, by));
      }
    } finally {
      app.close();
    }
  },
});
