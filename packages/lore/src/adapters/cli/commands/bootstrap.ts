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
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor. Only filters `my_claims`; every other field is
 * corpus-wide regardless of `by`.
 *
 * **`--injection` (SPEC-080(bootstrap-injection) §Module Boundary CLI bullet, D3, D5)** — renders the
 * SAME `BootstrapReportWithStaleness` through `@lore/core`'s
 * `buildBootstrapInjection`, then prints exactly TWO lines to stdout: (1) the
 * `BOOTSTRAP_FRAMING_LINE` scope-boundary constant (verbatim, `@lore/core`,
 * spec-context-provenance-injected-corpus-global-state-and-a D2), (2) the
 * projection's compact `json` (never the `{ok, data}` envelope plain `--json`
 * uses). D2's rationale: an installed hook file drifts independently of the
 * binary, so the boundary prose describing this payload must ship in the SAME
 * artifact as the payload — the hook (still a blind pipe, D3) relays both
 * lines verbatim inside its markdown fence, with zero knowledge of either
 * line's content or the JSON's field names. AC-CP-3 asserts stdout line 1 by
 * `===` identity against the exported constant — never a remembered
 * substring. Budgets resolve from
 * `workflow.bootstrap_injection.*` via `resolveBootstrapInjectionBudgets(config)`,
 * the SAME `config` this command already threads through from `loadLoreApp()` for
 * telemetry (`app.ts` needs no change — `loadLoreApp()` already resolves and
 * returns the parsed project config; there is exactly one config-resolution path
 * here, mirroring the `claimTtlMinutes` DI precedent SPEC-080(bootstrap-injection) names). **Combined
 * `--injection --json` decision**: `--injection` takes precedence and produces the
 * SAME compact injection payload as `--injection` alone — never a rejection. The
 * SessionStart hook only ever spawns `--injection` on its own, so the two flags
 * have no real combined use case; erroring on a harmless overlap would just be
 * one more exit-2 path for callers to special-case. Plain `--json` and the human
 * text format are BYTE-UNCHANGED by this addition (`--injection` is a strict
 * additive branch ahead of the existing `if (args.json)` check).
 *
 * **`resume_hint` neutrality (spec-session-start-handoff-neutrality D1, D2)** —
 * the injection payload OMITS `resume_hint` entirely for an ordinary session
 * (the user is the router; an ambient "resume this" guess misdirects every
 * session but one in a multi-session workflow). The ONE exception is a
 * seat-scoped call (`--seat-branch` given AND `SessionService.bootstrap`
 * resolved it to a live plan, i.e. `result.value.seat_unresolved` is NOT
 * `true`) — that hint derives from the session's own worktree branch, not a
 * corpus-wide guess, so `seatScoped` is computed HERE (this command holds
 * both halves of the signal) and threaded into `buildBootstrapInjection` as
 * its third argument. Plain `--json`'s full `BootstrapReport` is unaffected —
 * `resume_hint` still appears there unconditionally, same as before.
 *
 * Exit codes: 0 = success (including an empty corpus — `root: null`, every array
 *   `[]`, AC-SL-10), non-zero only on an underlying store error.
 *
 * Source: SPEC-041 §3 D1, D2; SPEC-080(bootstrap-injection) §Module Boundary, D3, D5;
 * spec-session-start-handoff-neutrality §Design Decisions D1, D2
 */

import { defineCommand } from "citty";
import type { BootstrapReport } from "@lore/core";
import { BOOTSTRAP_FRAMING_LINE, buildBootstrapInjection, resolveBootstrapInjectionBudgets } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, relativeTime, resolveActor } from "../utils.js";
import { buildStalenessFlowDeps, listFreshStalenessEscalates } from "../../../flows/staleness-flow.js";
import { buildListSpecs, countArmedSpecs } from "../../../flows/drift-flow.js";

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
    injection: {
      type: "boolean",
      description:
        "SPEC-080(bootstrap-injection) tier-1 injection projection — print the BOOTSTRAP_FRAMING_LINE " +
        "scope-boundary constant on line 1, then buildBootstrapInjection's compact " +
        "JSON ([resume_hint/]my_claims/active_sessions/armed_gates/root/pending_reviews/" +
        "active_plans/latest_handoffs/corpus/omitted[/budget_exceeded]) on line 2, instead of the " +
        "full report. resume_hint appears ONLY for a seat-scoped call (--seat-branch " +
        "resolved to a live plan) — an ordinary session omits it entirely " +
        "(spec-session-start-handoff-neutrality D1, D2). Takes precedence over --json " +
        "when both are given (same two-line output either way — see this " +
        "file's module header).",
    },
    "seat-branch": {
      type: "string",
      description:
        "SPEC-057 D2 — the caller's resolved seat/worktree branch (the SessionStart hook's Phase D " +
        "detection, or a manual invocation). When given, resume_hint scopes to the matching plan's own " +
        "newest handoff; an unresolvable branch degrades to the corpus-global newest handoff and sets " +
        "seat_unresolved: true.",
    },
    "seat-worktree": {
      type: "string",
      description:
        "SPEC-057 D2 — the caller's worktree path, paired with --seat-branch. Currently unconsulted by " +
        "resolution (kept for signature completeness); defaults to the current working directory when " +
        "--seat-branch is given but this is omitted.",
    },
  },
  async run({ args }) {
    const { app, config } = loadLoreApp();
    try {
      if (app.sessionService === undefined) {
        process.stderr.write("Error: SessionService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }

      const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
      const seatBranch = typeof args["seat-branch"] === "string" ? args["seat-branch"] : undefined;
      const seat =
        seatBranch !== undefined
          ? {
              branch: seatBranch,
              worktree: typeof args["seat-worktree"] === "string" ? args["seat-worktree"] : process.cwd(),
            }
          : undefined;
      const result = await app.sessionService.bootstrap(by, undefined, seat);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
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
        process.stderr.write(formatError(staleListResult.error) + "\n");
        process.exitCode = exitCode(staleListResult.error);
        return;
      }

      // SPEC-045 §Design Decisions D5, D7 — store-only "declared code_anchors" count,
      // ZERO filesystem probing (same shared helper `lore status`'s plain-text
      // branch uses).
      const armedSpecsResult = await countArmedSpecs(buildListSpecs(app));
      if (!armedSpecsResult.ok) {
        process.stderr.write(formatError(armedSpecsResult.error) + "\n");
        process.exitCode = exitCode(armedSpecsResult.error);
        return;
      }

      const reportWithStaleness: BootstrapReportWithStaleness = {
        ...result.value,
        corpus: {
          ...result.value.corpus,
          open_stale_candidates: staleListResult.value.length,
          code_anchor_specs: armedSpecsResult.value,
        },
      };

      if (args.injection) {
        // SPEC-080(bootstrap-injection) D3, D5 — resolve budgets from the SAME config loadLoreApp() already
        // parsed (one resolution path, claimTtlMinutes DI precedent), then print the
        // projection's compact json verbatim. Takes precedence over --json (module
        // header's "Combined --injection --json decision").
        //
        // spec-context-provenance-injected-corpus-global-state-and-a D2 — the
        // BOOTSTRAP_FRAMING_LINE scope-boundary constant is printed FIRST, as its
        // own stdout line, ahead of the JSON payload. This is a deliberate,
        // binary-side stdout-shape change (the SessionStart hook's Phase E used to
        // author this boundary prose itself, in an installed asset file that drifts
        // independently of the binary — the exact defect class SPEC-083 already
        // retired for governance prose). The hook remains a blind pipe (D3): it
        // relays BOTH lines verbatim inside its markdown fence, never parsing
        // either. A consumer that wants ONLY the JSON reads stdout from its second
        // line onward.
        const budgets = resolveBootstrapInjectionBudgets(config);
        // spec-session-start-handoff-neutrality D1, D2 — "seat-scoped" (resume_hint
        // survives the injection) can ONLY be computed HERE: this command already
        // holds both halves of the signal (whether `--seat-branch` was given at
        // all, and whether SessionService resolved it to a live plan via the
        // ABSENCE of `seat_unresolved: true`) — the seat signal deliberately never
        // round-trips through `BootstrapReport` itself (D1's "do not touch the
        // full report's schema/shape" constraint), so `buildBootstrapInjection`
        // cannot re-derive this from `report` alone.
        const seatScoped = seat !== undefined && result.value.seat_unresolved !== true;
        const { json } = buildBootstrapInjection(reportWithStaleness, budgets, seatScoped);
        console.log(BOOTSTRAP_FRAMING_LINE);
        console.log(json);
      } else if (args.json) {
        console.log(JSON.stringify({ ok: true, data: reportWithStaleness }, null, 2));
      } else {
        console.log(formatBootstrapReport(reportWithStaleness, by));
      }
    } finally {
      app.close();
    }
  },
});
