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
 * invocation's known-party name (`inv.identity.claimed`) is used. Only filters `my_claims`; every other field is
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

import { defineLoreCommand } from "../cli-exit.js";

import type { BootstrapReport } from "@lore/core";
import { warnSinkOf } from "../../../service/warn-sink.js";
import { buildBootstrapInjection, resolveBootstrapInjectionBudgets } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, relativeTime } from "../utils.js";
import { buildStalenessFlowDeps, listFreshStalenessEscalates } from "../../../flows/staleness-flow.js";
import { buildListSpecs, countArmedSpecs } from "../../../flows/drift-flow.js";
import { computeMemoryFileHealth, formatMemoryFileHealthLine } from "../memory-file-health.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/** The report's filter name for an invocation with no known party and no `--by`: names nobody, so it matches no claim. */
const NO_KNOWN_PARTY_FILTER = "(no known party)";

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
  lines.push(
    report.architecture !== null
      ? `Architecture: ${report.architecture.slug} "${report.architecture.title}" (${report.architecture.id})`
      : "Architecture: (none)",
  );
  lines.push("");

  // reason: BR-1371 — the report is bounded (BOOTSTRAP_MAX_BYTES). Idle plans (nothing ready, nothing claimed) print
  // as a count and only the first BOOTSTRAP_MAX_PLANS busy plans are named; the rest are one pointer line.
  const busyPlans = report.active_plans.filter((p) => p.task_counts.ready > 0 || p.task_counts.claimed > 0);
  const idleCount = report.active_plans.length - busyPlans.length;
  lines.push(`Active plans (${report.active_plans.length}; ${idleCount} idle):`);
  if (busyPlans.length > 0) {
    for (const plan of busyPlans.slice(0, BOOTSTRAP_MAX_PLANS)) {
      lines.push(
        `  - ${plan.slug} — ready ${plan.task_counts.ready}, claimed ${plan.task_counts.claimed}, ` +
          `done ${plan.task_counts.done}, ${relativeTime(plan.last_activity_at)}`,
      );
    }
    if (busyPlans.length > BOOTSTRAP_MAX_PLANS) {
      lines.push(`  (+${busyPlans.length - BOOTSTRAP_MAX_PLANS} more busy plans: lore list --type plan)`);
    }
  } else {
    lines.push("  (none busy)");
  }
  lines.push("");

  lines.push(`Pending reviews: ${report.pending_reviews.count} (lore pending)`);
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

  // reason: BR-1371 — this seat's own handoff (the resume hint's) plus the newest BOOTSTRAP_NEWEST_HANDOFFS, not all.
  const seatHandoff =
    report.resume_hint === null
      ? undefined
      : report.latest_handoffs.find((h) => h.handoff_slug === report.resume_hint?.handoff_slug);
  const shownHandoffs = [
    ...(seatHandoff === undefined ? [] : [seatHandoff]),
    ...report.latest_handoffs.filter((h) => h !== seatHandoff).slice(0, BOOTSTRAP_NEWEST_HANDOFFS),
  ];
  lines.push(`Latest handoffs (${shownHandoffs.length} of ${report.latest_handoffs.length}):`);
  if (shownHandoffs.length > 0) {
    for (const handoff of shownHandoffs) {
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

  // One line, only when `memory_file_health` is present (the root memory file has findings).
  const healthLine = formatMemoryFileHealthLine(report.memory_file_health);
  if (healthLine !== undefined) lines.push(healthLine);

  return capBootstrapText(lines.join("\n"));
}

/** Plans named in the plain bootstrap report (BR-1371); the rest are a count and a pointer. */
const BOOTSTRAP_MAX_PLANS = 8;
/** Newest handoffs named besides the seat's own. */
const BOOTSTRAP_NEWEST_HANDOFFS = 3;
/** The plain bootstrap report never exceeds this many bytes (BR-1371). */
export const BOOTSTRAP_MAX_BYTES = 3072;

/**
 * Backstop for {@link BOOTSTRAP_MAX_BYTES}: the sections above are bounded by construction except claims and gates,
 * which belong to the seat; if those alone push the text over, drop whole trailing lines and say so.
 *
 * @param text - the rendered report
 * @returns `text` when it fits, else its leading lines plus a pointer to `--json`, at most the cap
 */
function capBootstrapText(text: string): string {
  if (Buffer.byteLength(text) <= BOOTSTRAP_MAX_BYTES) return text;
  const note = "\n(output cut at 3 KB: lore bootstrap --json for everything)";
  const kept: string[] = [];
  let size = Buffer.byteLength(note);
  for (const line of text.split("\n")) {
    size += Buffer.byteLength(line) + 1;
    if (size > BOOTSTRAP_MAX_BYTES) break;
    kept.push(line);
  }
  return kept.join("\n") + note;
}

export default defineLoreCommand({
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
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app, config } = loadLoreApp({ inv });
    try {
      if (app.sessionService === undefined) {
        inv.io.stderr.write("Error: SessionService not wired on this App instance.\n");
        return 1;
      }

      // reason: `bootstrap` is a READ (never refused for identity, BR-1351) and `--by` is its own filter naming whose
      // claims to report (never a write identity, BR-1055). Absent a filter it reports the invocation's known-party
      // name; an invocation with no known party reports under a sentinel that matches no claim.
      const by = typeof args.by === "string" && args.by.trim() !== "" ? args.by : (inv.identity.claimed ?? NO_KNOWN_PARTY_FILTER);
      const seatBranch = typeof args["seat-branch"] === "string" ? args["seat-branch"] : undefined;
      const seatWorktreeArg = typeof args["seat-worktree"] === "string" ? args["seat-worktree"] : undefined;

      if (args.injection) {
        // D11 — the pair is required together in this mode; no cwd default.
        if ((seatBranch === undefined) !== (seatWorktreeArg === undefined)) {
          inv.io.stderr.write(
            "Error: --seat-branch and --seat-worktree must be given together with --injection.\n",
          );
          return 2;
        }
        // Resolved BEFORE the main-checkout early-out so a retired knob is announced on every call (D5).
        const budgets = resolveBootstrapInjectionBudgets(config, warnSinkOf(inv.io.stderr));
        if (seatBranch === undefined || seatWorktreeArg === undefined) return 0; // main checkout: print NOTHING (D2)

        const injectionSeat = { branch: seatBranch, worktree: seatWorktreeArg };
        const injectionReport = await app.sessionService.bootstrap(by, undefined, injectionSeat);
        if (!injectionReport.ok) {
          inv.io.stderr.write(formatErrorFor(inv, injectionReport.error) + "\n");
          return exitCode(injectionReport.error);
        }
        const seatClaims = await app.sessionService.seatClaims(injectionSeat);
        if (!seatClaims.ok) {
          inv.io.stderr.write(formatErrorFor(inv, seatClaims.error) + "\n");
          return exitCode(seatClaims.error);
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
        if (json !== "") printLine(inv.io.stdout, json);
        return 0;
      }

      const seat =
        seatBranch !== undefined
          ? { branch: seatBranch, worktree: seatWorktreeArg ?? inv.cwd }
          : undefined;
      const result = await app.sessionService.bootstrap(by, undefined, seat);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      // SPEC-044 §Design Decisions D14 — open_stale_candidates, computed by the SAME
      // query `lore review --staleness --list` uses (one derivation site,
      // `flows/staleness-flow.ts::listFreshStalenessEscalates`), spliced onto the
      // report's corpus summary here rather than inside SessionService.bootstrap (a
      // service file outside this task's file anchors).
      const staleListResult = await listFreshStalenessEscalates(buildStalenessFlowDeps(app));
      if (!staleListResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, staleListResult.error) + "\n");
        return exitCode(staleListResult.error);
      }

      // SPEC-045 §Design Decisions D5, D7 — store-only "declared code_anchors" count,
      // ZERO filesystem probing (same shared helper `lore status`'s plain-text
      // branch uses).
      const armedSpecsResult = await countArmedSpecs(buildListSpecs(app));
      if (!armedSpecsResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, armedSpecsResult.error) + "\n");
        return exitCode(armedSpecsResult.error);
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
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: reportWithStaleness }, null, 2));
      } else {
        printLine(inv.io.stdout, formatBootstrapReport(reportWithStaleness, by));
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
