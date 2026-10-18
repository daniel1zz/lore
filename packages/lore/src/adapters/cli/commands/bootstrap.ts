/**
 * lore bootstrap [--by <name>] [--json] [--injection] — SPEC-041 S1 volatile
 * session pointer-set, plus the SPEC-080(bootstrap-injection; corpus slug
 * spec-080-bootstrap-injection-projection-tier-1-tier-2-payload) tier-1
 * injection projection.
 *
 * A fresh session (an AI agent or a human) queries this ONE deterministic, read-only
 * verb to learn the volatile delta since the static layer (CLAUDE.md/AGENTS.md
 * projections cover architecture/conventions — deliberately NOT this command's job,
 * SPEC-041 "Division of labor"): active plans + task readiness, the pending-review
 * queue, the caller's own claims, armed gate checkpoints + their feeding-skill
 * source, and the newest handoffs recorded per plan (plus a corpus-wide resume
 * hint). Thin pipe over `SessionService.bootstrap` — zero store mutations.
 *
 * Actor resolution: `--by` is a read-only FILTER naming whose claims to report; absent, the
 * invoking identity (utils.ts::resolveActor) is used. Only filters `my_claims`; every other field is
 * corpus-wide regardless of `by`.
 *
 * **`--injection` (spec-session-start-injection-carries-only-the-session-s-own)** —
 * the SessionStart hook's payload carries ONLY the seat's own open items:
 * the unfinished claims `SessionService.seatClaims` finds for the seat
 * (matched by branch name OR realpath of the worktree directory, D11) plus
 * the seat plan's `resume_hint`, composed by `@lore/core`'s pure
 * `buildBootstrapInjection`. A main-checkout session (no seat flags), or a
 * seat with neither, prints NOTHING (exit 0, empty stdout — D2: any text is a
 * per-session cost with zero information). The stream carries bare compact
 * JSON and nothing else (the hook is a blind pipe); the scope-boundary line is
 * served by the separate `lore governance bootstrap-framing` verb, spawned by
 * the hook only when this command printed a payload.
 *
 * `--seat-branch` and `--seat-worktree` are REQUIRED TOGETHER in `--injection`
 * mode (D11): the `process.cwd()` default for `--seat-worktree` is removed for
 * this mode and either flag without the other exits 2. Plain `bootstrap`
 * keeps its SPEC-057 behaviour (`--seat-branch` alone, worktree defaulting to
 * cwd) byte-unchanged. `--injection` takes precedence over `--json`. The
 * budget (`workflow.bootstrap_injection.char_budget`) resolves via
 * `resolveBootstrapInjectionBudgets(config)`, which also announces any retired
 * count-cap key on stderr (D5).
 *
 * Exit codes: 0 = success (including an empty corpus — `root: null`, every array
 *   `[]`, AC-SL-10), non-zero only on an underlying store error.
 *
 * Source: SPEC-041 §3 D1, D2; spec-session-start-injection-carries-only-the-session-s-own
 * §Module Boundary, D1-D3, D11
 */

import { defineCommand } from "citty";
import type { BootstrapReport } from "@lore/core";
import { buildBootstrapInjection, resolveBootstrapInjectionBudgets } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, relativeTime, resolveActor } from "../utils.js";
import { buildStalenessFlowDeps, listFreshStalenessEscalates } from "../../../flows/staleness-flow.js";
import { buildListSpecs, countArmedSpecs } from "../../../flows/drift-flow.js";
import { computeMemoryFileHealth, formatMemoryFileHealthLine } from "../memory-file-health.js";
import { invocationOf } from "../command-invocation.js";

/**
 * `BootstrapReport` widened with the SPEC-044 §Design Decisions D14
 * `open_stale_candidates` count AND the SPEC-045 §Design Decisions D5, D7
 * `code_anchor_specs` count — both computed OUTSIDE `SessionService.bootstrap` (a
 * service file outside this task's file anchors) via the SAME derivation helpers
 * `lore review --staleness --list` / `lore status`'s plain-text branch use, then
 * spliced onto the report's `corpus` block by this adapter before rendering.
 * `code_anchor_specs` is a store-only declared-anchor count — ZERO filesystem
 * probing, unlike `lore status --check-drift`.
 */
type BootstrapReportWithStaleness = BootstrapReport & {
  corpus: BootstrapReport["corpus"] & { open_stale_candidates: number; code_anchor_specs: number };
};

/**
 * Compact human-readable rendering of a `BootstrapReport` — pointers only, never
 * doc body content (module header). Pure — no IO, no wall-clock reads (every
 * time-derived field is already computed by `SessionService.bootstrap`).
 *
 * @param report - A `BootstrapReport` from `SessionService.bootstrap`, widened with
 *   `corpus.open_stale_candidates` (SPEC-044 §Design Decisions D14) and
 *   `corpus.code_anchor_specs` (SPEC-045 §Design Decisions D5, D7) by this
 *   command's `run()` before rendering.
 * @param by - The actor identity `bootstrap` was called with (for the header line).
 * @returns Multi-line text block ready for `console.log`.
 */
export function formatBootstrapReport(report: BootstrapReportWithStaleness, by: string): string {
  const lines: string[] = [];

  lines.push(`── lore bootstrap (${by}) ──`);
  lines.push(
    report.root !== null ? `Root: ${report.root.slug} "${report.root.title}"` : "Root: (none)",
  );
  if (report.strategy !== undefined) lines.push(`Strategy: ${report.strategy.slug} "${report.strategy.title}"`);
  lines.push("");

  lines.push(`Active plans (${report.active_plans.length}):`);
  if (report.active_plans.length > 0) {
    for (const plan of report.active_plans) {
      lines.push(
        `  - ${plan.slug} "${plan.title}" — ready ${plan.task_counts.ready}, ` +
          `claimed ${plan.task_counts.claimed}, done ${plan.task_counts.done}, ` +
          `last activity ${relativeTime(plan.last_activity_at)}`,
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
      ? `Resume hint: ${report.resume_hint.plan_slug ?? "(no plan)"} / ${report.resume_hint.handoff_slug}` +
          (report.seat_unresolved === true ? " (seat unresolved — corpus-global fallback)" : "")
      : "Resume hint: (none)",
  );
  lines.push(
    `Corpus: ${report.corpus.total_docs} docs, last updated ${report.corpus.last_updated ?? "(never)"}` +
      (report.corpus.open_stale_candidates > 0
        ? `, ${report.corpus.open_stale_candidates} open stale candidate(s)`
        : "") +
      (report.corpus.code_anchor_specs > 0
        ? `, ${report.corpus.code_anchor_specs} spec(s) declare code anchors`
        : ""),
  );

  // spec-claude-md-root-section-structure-check-and-adoption-mode D7 — one line, only
  // when `memory_file_health` is present (warn mode, or enforce with findings).
  const healthLine = formatMemoryFileHealthLine(report.memory_file_health);
  if (healthLine !== undefined) lines.push(healthLine);

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
      description: "Actor whose claims to report (read-only filter; defaults to the invoking identity)",
    },
    json: {
      type: "boolean",
      description: "Output the raw BootstrapReport as JSON",
    },
    injection: {
      type: "boolean",
      description:
        "Session-start injection — print ONLY the seat's own open items as compact JSON " +
        "(scope_declaration, [resume_hint,] seat_claims[, budget_exceeded]), or NOTHING (exit 0) " +
        "when there are none. Requires --seat-branch AND --seat-worktree together (exit 2 otherwise); " +
        "without them (main checkout) prints nothing. Takes precedence over --json.",
    },
    "seat-branch": {
      type: "string",
      description:
        "The caller's seat/worktree branch (the SessionStart hook's Phase D detection, or a manual " +
        "invocation). Plain bootstrap: scopes resume_hint to the matching plan's own newest handoff; an " +
        "unresolvable branch degrades to the corpus-global newest handoff and sets seat_unresolved: true. " +
        "--injection: matched against each task claim's recorded worktree; must be paired with --seat-worktree.",
    },
    "seat-worktree": {
      type: "string",
      description:
        "The caller's worktree directory, paired with --seat-branch. --injection: REQUIRED with " +
        "--seat-branch and matched (realpath-normalised) against absolute-path claim worktrees. Plain " +
        "bootstrap: unconsulted by resolution; defaults to the current working directory when " +
        "--seat-branch is given alone.",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app, config } = loadLoreApp({ inv });
    try {
      if (app.sessionService === undefined) {
        process.stderr.write("Error: SessionService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }

      const by = resolveActor(typeof args.by === "string" ? args.by : undefined, inv.env, inv.cwd, inv.user);
      const seatBranch = typeof args["seat-branch"] === "string" ? args["seat-branch"] : undefined;
      const seatWorktreeArg = typeof args["seat-worktree"] === "string" ? args["seat-worktree"] : undefined;

      if (args.injection) {
        // D11 — the pair is required together in this mode; no cwd default.
        if ((seatBranch === undefined) !== (seatWorktreeArg === undefined)) {
          process.stderr.write(
            "Error: --seat-branch and --seat-worktree must be given together with --injection.\n",
          );
          process.exitCode = 2;
          return;
        }
        // Resolved BEFORE the main-checkout early-out so a retired knob is announced on every call (D5).
        const budgets = resolveBootstrapInjectionBudgets(config);
        if (seatBranch === undefined || seatWorktreeArg === undefined) return; // main checkout: print NOTHING (D2)

        const injectionSeat = { branch: seatBranch, worktree: seatWorktreeArg };
        const injectionReport = await app.sessionService.bootstrap(by, undefined, injectionSeat);
        if (!injectionReport.ok) {
          process.stderr.write(formatErrorFor(inv, injectionReport.error) + "\n");
          process.exitCode = exitCode(injectionReport.error);
          return;
        }
        const seatClaims = await app.sessionService.seatClaims(injectionSeat);
        if (!seatClaims.ok) {
          process.stderr.write(formatErrorFor(inv, seatClaims.error) + "\n");
          process.exitCode = exitCode(seatClaims.error);
          return;
        }
        const { json } = buildBootstrapInjection(
          {
            report: injectionReport.value,
            seat: {
              ...injectionSeat,
              planResolved: injectionReport.value.seat_unresolved !== true,
              claims: seatClaims.value,
            },
          },
          budgets,
        );
        if (json !== "") console.log(json);
        return;
      }

      const seat =
        seatBranch !== undefined
          ? { branch: seatBranch, worktree: seatWorktreeArg ?? inv.cwd }
          : undefined;
      const result = await app.sessionService.bootstrap(by, undefined, seat);

      if (!result.ok) {
        process.stderr.write(formatErrorFor(inv, result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      // SPEC-044 §Design Decisions D14 — open_stale_candidates, computed by the SAME
      // query `lore review --staleness --list` uses (one derivation site,
      // `flows/staleness-flow.ts::listFreshStalenessEscalates`), spliced onto the
      // report's corpus summary here rather than inside SessionService.bootstrap (a
      // service file outside this task's file anchors).
      const staleListResult = await listFreshStalenessEscalates(buildStalenessFlowDeps(app));
      if (!staleListResult.ok) {
        process.stderr.write(formatErrorFor(inv, staleListResult.error) + "\n");
        process.exitCode = exitCode(staleListResult.error);
        return;
      }

      // SPEC-045 §Design Decisions D5, D7 — store-only "declared code_anchors" count,
      // ZERO filesystem probing (same shared helper `lore status`'s plain-text
      // branch uses).
      const armedSpecsResult = await countArmedSpecs(buildListSpecs(app));
      if (!armedSpecsResult.ok) {
        process.stderr.write(formatErrorFor(inv, armedSpecsResult.error) + "\n");
        process.exitCode = exitCode(armedSpecsResult.error);
        return;
      }

      // spec-claude-md-root-section-structure-check-and-adoption-mode D8 — root
      // memory-file health, computed HERE (SessionService is fs-free) from the SAME
      // `config` loadLoreApp() already parsed. Absent (not null) when nothing to report.
      const memoryFileHealth = computeMemoryFileHealth(inv.cwd, config);

      const reportWithStaleness: BootstrapReportWithStaleness = {
        ...result.value,
        ...(memoryFileHealth === undefined ? {} : { memory_file_health: memoryFileHealth }),
        corpus: {
          ...result.value.corpus,
          open_stale_candidates: staleListResult.value.length,
          code_anchor_specs: armedSpecsResult.value,
        },
      };

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: reportWithStaleness }, null, 2));
      } else {
        console.log(formatBootstrapReport(reportWithStaleness, by));
      }
    } finally {
      app.close();
    }
  },
});
