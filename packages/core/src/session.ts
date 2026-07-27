/**
 * Session layer — bootstrap pointer-set + lossless handoff schemas (SPEC-041 S1+S2)
 * + the derived session-registry projection (SPEC-042 S3 D1). Pure, browser-safe
 * module: no IO, no Date.now()/Math.random() calls — every field that depends on
 * wall-clock time (staleness, ages) is computed by the SERVICE layer
 * (`packages/lore/src/service/session-service.ts` /
 * `packages/lore/src/service/task-workflow-service.ts`) and handed in as plain data.
 *
 * Public surface:
 *   - handoffKeyDecisionSchema / HandoffKeyDecision — one scored decision inside a handoff
 *   - handoffFailingOracleSchema / HandoffFailingOracle — the oracle command that was
 *     failing when the handoff was written, plus a bounded output tail
 *   - handoffExtraSchema / HandoffExtra — the full typed SSOT for a `knowledge` doc's
 *     `extra.handoff` (sub_type "handoff", SPEC-041 §3 D3)
 *   - renderHandoffContent(extra) — deterministic Markdown rendering of a `HandoffExtra`
 *     for the knowledge doc's `content` field (assessment-renderer precedent — `extra`
 *     is the SSOT, `content` is generated ONLY by this function)
 *   - bootstrapReportSchema / BootstrapReport — the S1 pointer-set `SessionService.bootstrap`
 *     returns (SPEC-041 §3 D2) — every field is a slug/title/count/timestamp pointer,
 *     NEVER doc body content (IoC ADR boundary 2: pointers + summaries, never full dump)
 *   - readySessionSchema / ReadySession — one derived session grouping (SPEC-042 D1)
 *   - deriveSessions(tasks, nowIso, ttlMinutes) — groups FRESH claims by
 *     `(by, machine, worktree)`; the pure computation behind both `lore ready`'s
 *     per-plan `sessions[]` and `lore bootstrap`'s corpus-wide `active_sessions`
 *   - deriveLastActivityAt(plan, tasks) — max `updated_at` across a plan and its
 *     child tasks; populates each `bootstrap.active_plans[]` entry's required
 *     `last_activity_at` (SPEC-069 §Design Decisions D6, D7)
 *   - buildBootstrapInjection(report, budgets, seatScoped?) — SPEC-080(bootstrap-injection)
 *     §Projection Contract: the SOLE owner of ALL tier-1 injection trimming
 *     (selection, count caps, char budget, omission accounting). Projects a
 *     full `BootstrapReport` down to the small, truncation-safe payload the
 *     SessionStart hook injects. `resume_hint` is DROPPED entirely for an
 *     ordinary (non-seat-scoped) session (spec-session-start-handoff-neutrality
 *     D1) — the user is the router, an ambient "resume this" guess misdirects
 *     every session but one in a multi-session workflow. `seatScoped: true`
 *     (caller-computed — the seat signal never round-trips through
 *     `BootstrapReport` itself, D1's "do not touch the full report's
 *     schema/shape" constraint) is the ONE exception: a seat's resume hint
 *     derives from the session's OWN worktree branch (SPEC-057), not a
 *     corpus-wide guess, so it is retained (D2).
 *   - bootstrapInjectionSchema / BootstrapInjection — the projection's OWN Zod
 *     schema + type (SPEC-080(bootstrap-injection) §Module Boundary) — never a
 *     patch on `bootstrapReportSchema`.
 *
 * Invariants:
 *   - No IO, no wall-clock reads, no randomness — `renderHandoffContent` is deterministic:
 *     the same `HandoffExtra` always renders the same Markdown string.
 *   - `handoffExtraSchema`'s nested caps (`judgment` ≤300 chars, `output_tail` ≤2000 chars)
 *     bound document growth the same way `evidenceEntrySchema.output_tail` (≤4000 chars,
 *     task-workflow.ts) does for evidence entries.
 *   - `bootstrapReportSchema` carries only slug/title/count/timestamp/boolean fields —
 *     never a doc's `content`. Titles are truncated to ≤120 chars by the SERVICE layer
 *     before being placed into a `BootstrapReport` (this schema does not itself enforce
 *     that truncation — it validates shape, not provenance).
 *   - `deriveSessions` NEVER STORES anything (SPEC-042 D1 — sessions are derived,
 *     never stored, no daemon, no open/close lifecycle). Staleness is computed by
 *     the CALLER (a `nowIso` + `ttlMinutes` pair is passed in, mirroring
 *     `evaluateReadiness`'s identical D10 time-seam discipline) — this module never
 *     reads a wall clock itself.
 *   - `buildBootstrapInjection` is the SOLE trimming owner
 *     (SPEC-080(bootstrap-injection) D1, D2): count caps AND the char-budget
 *     rule both live inside this one function, sharing ONE `omitted` ledger —
 *     never a second, independent truncation policy elsewhere (that
 *     duplication is the exact bug class SPEC-080(bootstrap-injection) fixes).
 *     It NEVER mid-JSON-slices its output — an over-budget payload with nothing
 *     left to drop returns intact with `budget_exceeded: true` instead.
 *
 * Source: SPEC-041 §3 D2, D3; SPEC-042 §Design Decisions D1;
 * SPEC-080(bootstrap-injection; corpus slug
 * spec-080-bootstrap-injection-projection-tier-1-tier-2-payload) §Projection
 * Contract, §Public Interface, §Design Decisions D1-D8;
 * spec-session-start-handoff-neutrality-injection-drops-resume §Design
 * Decisions D1, D2 (resume_hint dropped from the injection except for a
 * seat-scoped session).
 */

import { z } from "zod";
import { extractClaim, isClaimStale } from "./task-workflow.js";
import type { DocRecord } from "./types.js";

// ─── Handoff Extra Schema (S2, SPEC-041 §3 D3) ─────────────────────────────

/**
 * One scored decision recorded in a handoff. `confidence` is an optional 0-100
 * integer — the agent's own calibration of how sure it is about `judgment`, not a
 * system-computed value (mirrors `review-judgment.ts`'s judge-confidence shape at a
 * per-decision granularity rather than per-doc).
 *
 * @example
 * handoffKeyDecisionSchema.parse({ judgment: "Chose InMemoryStore proxy over a spy library", confidence: 90 });
 */
export const handoffKeyDecisionSchema = z.object({
  judgment: z.string().min(1).max(300),
  confidence: z.number().int().min(0).max(100).optional(),
});

/** Derived TypeScript type for one handoff key decision. */
export type HandoffKeyDecision = z.infer<typeof handoffKeyDecisionSchema>;

/**
 * The oracle command that was failing (or last run) when the handoff was written,
 * plus a bounded tail of its output — the same "last known state of the world" a
 * human handoff comment would include. `output_tail` is capped at 2000 chars
 * (tighter than `evidenceEntrySchema.output_tail`'s 4000 — a handoff is a pointer
 * document, not a full oracle log).
 *
 * @example
 * handoffFailingOracleSchema.parse({ command: "bun run typecheck", output_tail: "error TS2345: ..." });
 */
export const handoffFailingOracleSchema = z.object({
  command: z.string().min(1),
  output_tail: z.string().max(2000),
});

/** Derived TypeScript type for a handoff's failing-oracle snapshot. */
export type HandoffFailingOracle = z.infer<typeof handoffFailingOracleSchema>;

/**
 * The full typed SSOT for a `knowledge` doc's `extra.handoff` (sub_type "handoff").
 * `content` is a deterministic projection of this shape via {@link renderHandoffContent}
 * — never hand-authored (D6: no `--content`/`--content-file` on `lore handoff`, ever).
 *
 * @invariant `next_steps` requires at least one entry — a handoff naming no next step
 *   is a status report, not a handoff (SPEC-041 §3 D3).
 * @invariant `task_refs` / `modified_files` / `key_decisions` all default to `[]` when
 *   omitted from input — the OUTPUT type always carries an array (never `undefined`),
 *   matching this schema's own declared shape below.
 * @invariant `plan_ref` is the CALLER-supplied id/slug the parent was resolved from —
 *   NOT the resolved doc's own id. `SessionService.writeHandoff` re-resolves it at
 *   write time (parent resolution is service-layer, not schema-layer — schemas cannot
 *   see the store). See that method's JSDoc for the four-way resolution rule.
 * @invariant `degraded: true` marks a git-only capture with no `key_decisions` (D7 —
 *   a Stop/PreCompact hook cannot compute decisions/next_steps, only `git status`
 *   output) — {@link renderHandoffContent} renders a visible warning marker for these.
 *
 * @example
 * handoffExtraSchema.parse({
 *   by: "claude",
 *   plan_ref: "plan-session-layer",
 *   task_refs: ["task-t1-core-schemas"],
 *   modified_files: ["packages/core/src/session.ts"],
 *   key_decisions: [{ judgment: "extra is SSOT, content is a projection", confidence: 95 }],
 *   next_steps: ["wire SessionService into app.ts"],
 * });
 *
 * @example
 * // degraded git-only capture (D7) — no key_decisions, marked explicitly
 * handoffExtraSchema.parse({
 *   by: "stop-hook",
 *   task_refs: [],
 *   modified_files: ["packages/core/src/session.ts"],
 *   key_decisions: [],
 *   next_steps: ["review uncommitted changes"],
 *   degraded: true,
 * });
 */
export const handoffExtraSchema = z.object({
  by: z.string().min(1),
  plan_ref: z.string().min(1).optional(),
  task_refs: z.array(z.string()).default([]),
  modified_files: z.array(z.string()).default([]),
  key_decisions: z.array(handoffKeyDecisionSchema).default([]),
  failing_oracle: handoffFailingOracleSchema.optional(),
  next_steps: z.array(z.string().min(1)).min(1),
  degraded: z.boolean().optional(),
});

/** Derived TypeScript type for a `knowledge` doc's `extra.handoff` (sub_type "handoff"). */
export type HandoffExtra = z.infer<typeof handoffExtraSchema>;

/**
 * Marker line rendered as the first body line of a degraded (`extra.handoff.degraded
 * === true`) handoff — a git-only capture with no recorded decisions (D7). Exported
 * so callers (and this module's own tests) can assert on the exact substring rather
 * than re-deriving it.
 */
export const DEGRADED_HANDOFF_MARKER =
  "⚠ degraded (git-only capture — no key decisions recorded, next_steps may be incomplete)";

/**
 * Deterministic Markdown rendering of a `HandoffExtra` for the knowledge doc's
 * `content` field. `extra.handoff` is the SSOT; `content` is generated ONLY by this
 * function at write time (assessment-renderer precedent — `renderAssessmentContent`,
 * `assessment.ts`). Two calls with the same input always produce the same string.
 *
 * @param extra - A `handoffExtraSchema`-valid handoff payload.
 * @returns Markdown body text.
 * @example
 * renderHandoffContent({
 *   by: "claude", task_refs: [], modified_files: [], key_decisions: [],
 *   next_steps: ["ship it"],
 * }).startsWith("# Handoff — claude"); // => true
 */
export function renderHandoffContent(extra: HandoffExtra): string {
  const lines: string[] = [];

  lines.push(`# Handoff — ${extra.by}`);
  lines.push("");

  if (extra.degraded === true) {
    lines.push(`> ${DEGRADED_HANDOFF_MARKER}`);
    lines.push("");
  }

  lines.push("## Plan");
  lines.push("");
  lines.push(extra.plan_ref !== undefined ? extra.plan_ref : "(none)");
  lines.push("");

  lines.push("## Task Refs");
  lines.push("");
  lines.push(extra.task_refs.length > 0 ? extra.task_refs.map((t) => `- ${t}`).join("\n") : "(none)");
  lines.push("");

  lines.push("## Modified Files");
  lines.push("");
  lines.push(
    extra.modified_files.length > 0 ? extra.modified_files.map((f) => `- ${f}`).join("\n") : "(none)",
  );
  lines.push("");

  lines.push("## Key Decisions");
  lines.push("");
  if (extra.key_decisions.length > 0) {
    lines.push("| Judgment | Confidence |");
    lines.push("|---|---|");
    for (const d of extra.key_decisions) {
      const confidence = d.confidence !== undefined ? `${d.confidence}` : "—";
      lines.push(`| ${d.judgment.replace(/\|/g, "\\|")} | ${confidence} |`);
    }
  } else {
    lines.push("(none)");
  }
  lines.push("");

  lines.push("## Failing Oracle");
  lines.push("");
  if (extra.failing_oracle !== undefined) {
    lines.push(`- Command: \`${extra.failing_oracle.command}\``);
    lines.push("- Output tail:");
    lines.push("```");
    lines.push(extra.failing_oracle.output_tail);
    lines.push("```");
  } else {
    lines.push("(none)");
  }
  lines.push("");

  lines.push("## Next Steps");
  lines.push("");
  lines.push(extra.next_steps.map((s) => `- ${s}`).join("\n"));

  return lines.join("\n");
}

// ─── Bootstrap Report Schema (S1, SPEC-041 §3 D2) ──────────────────────────

/** `{slug, title}` pointer to the corpus's root PRD, or absent when the corpus has none. */
export const bootstrapRootSchema = z.object({
  slug: z.string(),
  title: z.string(),
});

/** Per-plan task readiness counts. `done` counts tasks whose `status === "archived"` — the same "satisfied iff archived" convention `evaluateReadiness` (`task-workflow.ts`) uses for blockers. */
export const bootstrapTaskCountsSchema = z.object({
  ready: z.number().int().min(0),
  claimed: z.number().int().min(0),
  done: z.number().int().min(0),
});

/**
 * One non-terminal plan's pointer + task readiness snapshot.
 *
 * @invariant `last_activity_at` is REQUIRED (SPEC-069 §Design Decisions D7) —
 *   fail-loud: a caller that forgets to populate it throws at
 *   `bootstrapReportSchema.parse` (the same self-check that guards
 *   `active_sessions`, review S6) rather than silently stripping the field.
 *   Populated exclusively by {@link deriveLastActivityAt}.
 */
export const bootstrapActivePlanSchema = z.object({
  slug: z.string(),
  title: z.string(),
  task_counts: bootstrapTaskCountsSchema,
  last_activity_at: z.string(),
});

/** The draft-status review queue's size + a bounded slug sample (never the full queue). */
export const bootstrapPendingReviewsSchema = z.object({
  count: z.number().int().min(0),
  slugs: z.array(z.string()).max(10),
});

/** One task the requesting actor (`by`) currently holds a claim on. */
export const bootstrapMyClaimSchema = z.object({
  task_slug: z.string(),
  plan_slug: z.string(),
  claimed_at: z.string(),
  stale: z.boolean(),
});

/** One enabled (`workflow.gates.<checkpoint>.enabled !== false`) gate checkpoint + its discoverable feeding-skill source, when one exists. */
export const bootstrapArmedGateSchema = z.object({
  checkpoint: z.string(),
  feeding_source_slug: z.string().nullable(),
});

/** The newest handoff recorded for one plan grouping (`plan_slug: null` = parentless or PRD-parented handoffs). */
export const bootstrapLatestHandoffSchema = z.object({
  plan_slug: z.string().nullable(),
  handoff_slug: z.string(),
  by: z.string(),
  at: z.string(),
});

/** Pointer to the single newest handoff across the whole corpus, or `null` when none exist. */
export const bootstrapResumeHintSchema = z.object({
  plan_slug: z.string().nullable(),
  handoff_slug: z.string(),
});

/** Corpus-wide size + freshness snapshot. `last_updated: null` iff the corpus is empty. */
export const bootstrapCorpusStatsSchema = z.object({
  total_docs: z.number().int().min(0),
  last_updated: z.string().nullable(),
});

/**
 * The S1 pointer-set `SessionService.bootstrap(by)` returns — the volatile delta a
 * fresh session needs (plans, claims, queue, gates, handoffs). Deliberately excludes
 * the static layer (architecture, conventions) — that lives in CLAUDE.md/AGENTS.md
 * projections, not here (SPEC-041 §"Division of labor", review U1).
 *
 * @invariant Every string field is a slug/title/timestamp — NEVER doc body content
 *   (IoC ADR boundary 2: pointers + summaries, never full dump).
 * @invariant Empty corpus is legal: `root: null`, every array `[]`,
 *   `pending_reviews: {count: 0, slugs: []}`, `corpus.last_updated: null`.
 */
/**
 * One derived session — the group of FRESH claims sharing the composite key
 * `(by, machine, worktree)` (SPEC-042 D1). An absent `machine`/`worktree` is a
 * valid, stable grouping key equal to itself — legacy machine-less claims by one
 * actor group into ONE session, distinguishable from captured values only by the
 * field's absence (review S7).
 */
export const readySessionSchema = z.object({
  by: z.string(),
  machine: z.string().optional(),
  worktree: z.string().optional(),
  /** Distinct `branch` values across this session's member claims, insertion order. */
  branches: z.array(z.string()),
  /** Task slugs this session currently holds a fresh claim on, insertion order. */
  task_slugs: z.array(z.string()),
  /** The most recent `claim.at` among this session's member claims. */
  newest_at: z.string(),
});

/** Derived TypeScript type for one session grouping (SPEC-042 D1). */
export type ReadySession = z.infer<typeof readySessionSchema>;

/**
 * Groups `tasks`' FRESH (non-stale) claims into sessions by the composite key
 * `(by, machine, worktree)` (SPEC-042 D1). Pure — no IO, no wall-clock reads;
 * staleness is computed against the caller-supplied `nowIso`/`ttlMinutes`, the
 * same D10 time-seam discipline `evaluateReadiness` (task-workflow.ts) uses.
 *
 * All-stale input (every task's claim, if any, has aged past `ttlMinutes`)
 * produces `[]` — a stale claim contributes NO session row (SPEC-042 AC-S3-6
 * NEGATIVE case, review T5).
 *
 * @param tasks - Candidate tasks (a plan's children for `lore ready`'s per-plan
 *   scope; every active plan's children, concatenated, for `lore bootstrap`'s
 *   corpus-wide scope).
 * @param nowIso - Caller-supplied current time (D10 — never Date.now() here).
 * @param ttlMinutes - Claim TTL in minutes, forwarded to `isClaimStale`.
 * @returns One `ReadySession` per distinct `(by, machine, worktree)` key present
 *   among `tasks`' fresh claims, in first-seen order.
 *
 * @example
 * deriveSessions(
 *   [taskA, taskB], // taskA: claim{by:"agent:t1", machine:"hostA", worktree:"/w1"}
 *                    // taskB: claim{by:"agent:t2", machine:"hostA", worktree:"/w2"}
 *   "2026-07-11T10:00:00.000Z", 120,
 * );
 * // => two sessions — same machine, distinct worktree still discriminates (D1)
 */
export function deriveSessions(tasks: DocRecord[], nowIso: string, ttlMinutes: number): ReadySession[] {
  interface MutableGroup {
    by: string;
    machine?: string;
    worktree?: string;
    branches: string[];
    branchSeen: Set<string>;
    task_slugs: string[];
    newest_at: string;
  }

  const groups = new Map<string, MutableGroup>();
  const order: string[] = [];

  for (const task of tasks) {
    const claim = extractClaim(task);
    if (claim === undefined) continue;
    if (isClaimStale(claim, nowIso, ttlMinutes)) continue;

    // reason: `null` is used as the absent-field placeholder (never a legal
    // machine/worktree value) so JSON.stringify produces a stable, distinct key
    // per (by, machine, worktree) triple — including the "both absent" case,
    // which must equal itself across different tasks/claims (review S7).
    const key = JSON.stringify([claim.by, claim.machine ?? null, claim.worktree ?? null]);

    let group = groups.get(key);
    if (group === undefined) {
      group = {
        by: claim.by,
        ...(claim.machine !== undefined ? { machine: claim.machine } : {}),
        ...(claim.worktree !== undefined ? { worktree: claim.worktree } : {}),
        branches: [],
        branchSeen: new Set<string>(),
        task_slugs: [],
        newest_at: claim.at,
      };
      groups.set(key, group);
      order.push(key);
    }

    if (claim.branch !== undefined && !group.branchSeen.has(claim.branch)) {
      group.branchSeen.add(claim.branch);
      group.branches.push(claim.branch);
    }
    group.task_slugs.push(task.slug);
    if (claim.at > group.newest_at) group.newest_at = claim.at;
  }

  return order.map((key) => {
    // reason: `order` is built exclusively from keys just inserted into `groups`
    // in the loop above — this lookup cannot miss.
    const g = groups.get(key)!;
    return {
      by: g.by,
      ...(g.machine !== undefined ? { machine: g.machine } : {}),
      ...(g.worktree !== undefined ? { worktree: g.worktree } : {}),
      branches: g.branches,
      task_slugs: g.task_slugs,
      newest_at: g.newest_at,
    };
  });
}

/**
 * Max `updated_at` across a plan doc and its child tasks (SPEC-069 §Design
 * Decisions D6) — the last corpus write anywhere in the plan's subtree. Pure,
 * total: no IO, no wall-clock reads, no store lookups — `plan.updated_at` and
 * every `tasks[].updated_at` are ISO-8601 UTC strings, which compare
 * correctly under plain lexicographic `>` (no `Date` parsing needed).
 *
 * @invariant Deliberately over-inclusive: ANY mutation counts — claim,
 *   evidence, release, or a plain title/content edit — not execution activity
 *   specifically. `release` clears a claim, making claim/evidence timestamps
 *   alone insufficient (activity would go invisible the instant a task is
 *   released); `updated_at` bounds every write and always exists on both the
 *   plan and each task, which is what makes this function total. Over-
 *   reporting is the safe direction here: a fresh session skipping one
 *   plan that turns out to be idle costs far less than two sessions
 *   colliding on the same live plan.
 * @invariant Totality: zero tasks still returns `plan.updated_at` — there is
 *   no undefined/null case to handle at call sites.
 *
 * @param plan - The plan doc itself.
 * @param tasks - The plan's child task docs (may be empty).
 * @returns The lexicographically greatest `updated_at` among `plan` and `tasks`.
 * @example
 * deriveLastActivityAt(
 *   { updated_at: "2026-07-20T00:00:00.000Z", ... } as DocRecord,
 *   [{ updated_at: "2026-07-23T00:00:00.000Z", ... } as DocRecord],
 * ); // => "2026-07-23T00:00:00.000Z" (a task's activity outpaces the plan's own)
 * @example
 * deriveLastActivityAt({ updated_at: "2026-07-20T00:00:00.000Z", ... } as DocRecord, []);
 * // => "2026-07-20T00:00:00.000Z" (totality — no tasks, falls back to the plan itself)
 */
export function deriveLastActivityAt(plan: DocRecord, tasks: DocRecord[]): string {
  let latest = plan.updated_at;
  for (const task of tasks) {
    if (task.updated_at > latest) latest = task.updated_at;
  }
  return latest;
}

export const bootstrapReportSchema = z.object({
  root: bootstrapRootSchema.nullable(),
  active_plans: z.array(bootstrapActivePlanSchema),
  pending_reviews: bootstrapPendingReviewsSchema,
  my_claims: z.array(bootstrapMyClaimSchema),
  armed_gates: z.array(bootstrapArmedGateSchema),
  latest_handoffs: z.array(bootstrapLatestHandoffSchema),
  resume_hint: bootstrapResumeHintSchema.nullable(),
  /**
   * Present (`true`) iff `SessionService.bootstrap` was called with a `seat`
   * signal whose `branch` did NOT resolve to a live plan doc — either the
   * branch isn't a well-formed seat branch (`parseSeatBranch` returns `null`)
   * or it parses but no plan's slug matches the recovered remainder (SPEC-057
   * §Design Decisions D3). `resume_hint` still degrades gracefully to the
   * corpus-global newest handoff in this case — this field is the caller's
   * signal that the degrade happened, mirroring the SPEC-043/044 warning-field
   * pattern (`invalidated_feeding_source_warnings`, `open_stale_candidates`).
   * ABSENT (not `false`) when no `seat` signal was given, or when it resolved
   * cleanly — present-iff-true, same convention as `attestation.first_seen`
   * (`task-workflow.ts`), so a pre-SPEC-057 caller's report stays byte-identical.
   */
  seat_unresolved: z.boolean().optional(),
  corpus: bootstrapCorpusStatsSchema,
  /**
   * Corpus-wide derived sessions over every ACTIVE (non-archived/deprecated)
   * plan's tasks (SPEC-042 D8) — a fresh session learns who else is working
   * BEFORE it claims. Empty corpus / no fresh claims anywhere → `[]`.
   *
   * @invariant This field is declared on the SCHEMA itself (not just the
   *   `BootstrapReport` TS literal) — a plain `z.object` silently STRIPS
   *   unrecognized keys on `.parse()`, so a caller that forgot to also update
   *   this schema would have `active_sessions` silently vanish at the exact
   *   `bootstrapReportSchema.parse(report)` self-consistency check
   *   `SessionService.bootstrap` runs before returning (review S6). A
   *   dedicated round-trip regression test pins this.
   */
  active_sessions: z.array(readySessionSchema),
  /**
   * The COUNT of current `computeArchiveCandidates` (R2-R4 sweep rule engine,
   * `archive-candidates.ts`) results — NOT the candidates themselves (this
   * schema carries pointers/counts, never doc-shaped payloads, the same
   * discipline every other field here already follows). Always present
   * (required, unlike `seat_unresolved`'s present-iff-true convention) — a
   * plain `0` when nothing is due is itself a meaningful fact, not an
   * anomaly to hide. `buildBootstrapInjection` is what applies the
   * present-iff-POSITIVE trim for the SMALLER tier-1 injection payload (see
   * that function's own doc) — this full report field always exists.
   *
   * Source: spec-lifecycle-archival-plan-close-cascade-deterministic
   *   §Design Decisions D4.
   */
  archive_candidates: z.number().int().min(0),
});

/** Derived TypeScript type for the S1 bootstrap pointer-set. */
export type BootstrapReport = z.infer<typeof bootstrapReportSchema>;

// ─── Bootstrap Injection Projection (SPEC-080(bootstrap-injection) §Projection Contract) ───

/**
 * The literal field order of the SPEC-080(bootstrap-injection) §Projection Contract (positions
 * 1-9; `omitted`/`budget_exceeded` are always the final two keys, appended
 * separately by {@link buildBootstrapInjection} after this set is exhausted).
 * Doubles as the OCP membership test: any `BootstrapReport` key NOT in this
 * set — including a schema-known-but-unlisted field like `seat_unresolved`,
 * not only a genuinely future one — is "unknown" for projection purposes and
 * gets appended between `corpus` and `omitted` in original report order (D8).
 */
const BOOTSTRAP_INJECTION_KNOWN_KEYS: ReadonlySet<string> = new Set([
  "resume_hint",
  "my_claims",
  "active_sessions",
  "armed_gates",
  "root",
  "pending_reviews",
  "active_plans",
  "latest_handoffs",
  "corpus",
  // reason: unlike `seat_unresolved` (deliberately absent from this set —
  // it's ALREADY present-iff-true on `report` itself, so the D8 blind-copy
  // loop below does the right thing for free), `archive_candidates` is
  // ALWAYS present on `report` as a plain required number (even `0`).
  // Blind-copying it would leak a `0` into every ordinary injection payload,
  // breaking the present-iff-POSITIVE contract
  // (spec-lifecycle-archival-plan-close-cascade-deterministic D4) — so it is
  // "known" here specifically to OPT OUT of the blind-copy loop and get its
  // own conditional handling below instead.
  "archive_candidates",
]);

/**
 * The single typed omission ledger (SPEC-080(bootstrap-injection) D2) — every drop from ANY
 * trimming stage (dead/over-cap plans, over-cap pending slugs, over-cap
 * handoffs, char-budget entry drops) lands in exactly one of these four
 * counters. No free-text markers anywhere else in the payload.
 */
export const bootstrapInjectionOmittedSchema = z.object({
  active_plans: z.number().int().min(0),
  latest_handoffs: z.number().int().min(0),
  pending_slugs: z.number().int().min(0),
  budget_drops: z.number().int().min(0),
});

/** Derived TypeScript type for the injection payload's omission ledger. */
export type BootstrapInjectionOmitted = z.infer<typeof bootstrapInjectionOmittedSchema>;

/**
 * The projection's OWN Zod schema (SPEC-080(bootstrap-injection) §Module Boundary) — deliberately
 * NOT a patch on {@link bootstrapReportSchema}: the two payloads diverge
 * (`armed_gates` condenses to `string[]`, `active_plans`/`latest_handoffs`
 * shrink, `omitted`/`budget_exceeded` are new). Declared field order mirrors
 * the contract for readability; it does NOT by itself guarantee the runtime
 * `Object.keys(payload)` order — that is `buildBootstrapInjection`'s job via
 * explicit object-literal key insertion order (JS preserves string-key
 * insertion order; Zod parsing does not reorder in a way this module relies
 * on for its own output).
 *
 * @invariant Deliberately does NOT declare an unknown-field passthrough —
 *   `buildBootstrapInjection`'s D8 unknown-field appending is a payload-shape
 *   behavior, not a schema-validation guarantee. A genuinely new
 *   `BootstrapReport` field reaching this schema unhandled strips on
 *   `.parse()` (plain `z.object`, not `.strict()`/`.passthrough()`) — adding
 *   a new report field is expected to land a companion schema update here,
 *   the same "schema and shape move together" discipline `active_sessions`
 *   (`bootstrapReportSchema`) already documents.
 * @invariant `resume_hint` is OPTIONAL here (unlike `bootstrapReportSchema`'s
 *   unconditional `.nullable()`) — spec-session-start-handoff-neutrality D1:
 *   an ordinary session's payload omits the key entirely, a seat-scoped
 *   session's payload keeps it (`null` when the seat's own plan has no
 *   handoffs yet).
 */
export const bootstrapInjectionSchema = z.object({
  resume_hint: bootstrapResumeHintSchema.nullable().optional(),
  my_claims: z.array(bootstrapMyClaimSchema),
  active_sessions: z.array(readySessionSchema),
  /** Condensed to checkpoint names only (D7) — feeding-source detail is tier-2 (SPEC-049 self-carries it at denial time). */
  armed_gates: z.array(z.string()),
  root: bootstrapRootSchema.nullable(),
  pending_reviews: bootstrapPendingReviewsSchema,
  active_plans: z.array(bootstrapActivePlanSchema),
  latest_handoffs: z.array(bootstrapLatestHandoffSchema),
  corpus: bootstrapCorpusStatsSchema,
  /**
   * Present ONLY when `report.archive_candidates > 0` (positioned right after
   * `corpus`, before `omitted` — the same slot the D8 unknown-field loop would
   * place it were it not opted out of that loop, see `BOOTSTRAP_INJECTION_KNOWN_KEYS`'s
   * own comment). Absent (never `0`) when there is nothing due — same
   * present-iff-true FAMILY of convention as `budget_exceeded`/
   * `bootstrapReportSchema.seat_unresolved`, applied to a count instead of a
   * boolean (hence `min(1)`, not `min(0)`, on the optional schema below).
   *
   * Source: spec-lifecycle-archival-plan-close-cascade-deterministic §Design Decisions D4.
   */
  archive_candidates: z.number().int().min(1).optional(),
  omitted: bootstrapInjectionOmittedSchema,
  /** Present (`true`) iff the count-capped payload still exceeded `charBudget` after entry drops. Absent (never `false`) otherwise — same present-iff-true convention as `bootstrapReportSchema.seat_unresolved`. */
  budget_exceeded: z.literal(true).optional(),
});

/**
 * Derived TypeScript type for the SPEC-080(bootstrap-injection) tier-1 injection payload. A
 * genuinely unknown `BootstrapReport` field appended per the D8 OCP rule is
 * NOT representable in this static type (there is no way to type "the
 * literal contract keys plus whatever else was on the input" without an
 * index signature that would weaken every other field's precision) — see
 * {@link buildBootstrapInjection}'s own cast comment for why that gap is
 * accepted rather than worked around.
 */
export type BootstrapInjection = z.infer<typeof bootstrapInjectionSchema>;

/**
 * Trimming knobs for {@link buildBootstrapInjection} (SPEC-080(bootstrap-injection) §Public
 * Interface). Plain interface, not Zod-derived — this shape never crosses an
 * untrusted boundary directly; it is always assembled by a trusted caller
 * (config resolution in `packages/core/src/config.ts`'s
 * `resolveBootstrapInjectionBudgets`, or a test fixture) and handed straight
 * to a pure function, mirroring `evaluateReadiness`'s `nowIso`/`ttlMinutes`
 * scalar-parameter precedent rather than `handoffExtraSchema`'s
 * boundary-validated shape.
 */
export interface BootstrapInjectionBudgets {
  /** Max `active_plans[]` entries kept in the payload. */
  maxActivePlans: number;
  /** Max `latest_handoffs[]` entries kept in the payload. */
  maxHandoffs: number;
  /** Max `pending_reviews.slugs[]` entries kept in the payload. */
  maxPendingSlugs: number;
  /** Compact-serialized length ceiling the char-budget rule trims against. */
  charBudget: number;
}

/** Return shape of {@link buildBootstrapInjection}. */
export interface BootstrapInjectionResult {
  /** The ordered, capped, budget-trimmed payload (SPEC-080(bootstrap-injection) §Projection Contract). */
  payload: BootstrapInjection;
  /** Compact (no-whitespace) JSON serialization of `payload`. */
  json: string;
}

/**
 * Projects a full `BootstrapReport` down to the small, truncation-safe
 * tier-1 payload the SessionStart hook injects (SPEC-080(bootstrap-injection) §Projection
 * Contract, §Public Interface). Pure — no IO, no wall-clock reads, no
 * randomness; the SOLE owner of ALL tier-1 trimming (SPEC-080(bootstrap-injection) D1, D2):
 * selection, count caps, and the char-budget rule all live here, sharing one
 * `omitted` ledger.
 *
 * Pipeline (each stage feeds the next; nothing is trimmed twice):
 *  0. `resume_hint` is included ONLY when `seatScoped` is `true`
 *     (spec-session-start-handoff-neutrality D1, D2) — an ordinary session's
 *     payload omits the key entirely (the user is the router; an ambient
 *     "resume this" guess misdirects every session but one). A seat-scoped
 *     session's hint derives from the session's OWN worktree branch, not a
 *     corpus-wide guess, so it survives untouched.
 *  1. `armed_gates` condenses to `string[]` of checkpoint names (D7).
 *  2. `pending_reviews.slugs` caps at `budgets.maxPendingSlugs` (`count`
 *     stays untouched — it reports the TRUE queue size, not the sample size).
 *  3. `active_plans` keeps only `ready>0 ∨ claimed>0` entries (D4), sorted
 *     `last_activity_at` descending, capped at `budgets.maxActivePlans`.
 *  4. `latest_handoffs` caps at `budgets.maxHandoffs` (input is already
 *     newest-first — upstream-sorted, this function never re-sorts it).
 *  5. Every `report` key NOT in the SPEC-080(bootstrap-injection) §Projection Contract's 9-field
 *     ordered list (D8 OCP rule) is appended between `corpus` and `omitted`,
 *     in original report order — this covers both a genuinely future field
 *     and an already-known-but-unlisted one (e.g. `seat_unresolved`).
 *  6. The char-budget rule runs LAST, on the compact-serialized length of
 *     the payload built by steps 1-5: while over `budgets.charBudget`, drop
 *     one WHOLE trailing entry — from `latest_handoffs` first, then from
 *     `active_plans` once `latest_handoffs` is empty — incrementing
 *     `omitted.budget_drops` per drop. NEVER a mid-JSON character slice.
 *     Both arrays empty and still over budget → `budget_exceeded: true` is
 *     set and the payload is returned INTACT (no field is ever truncated
 *     mid-value to force it under budget).
 *
 * @param report - A `bootstrapReportSchema`-valid pointer-set, typically
 *   `SessionService.bootstrap`'s return value.
 * @param budgets - Count caps + char budget (SPEC-080(bootstrap-injection) defaults: 5/3/3/8000
 *   — see `resolveBootstrapInjectionBudgets` in `config.ts`).
 * @param seatScoped - `true` when the caller resolved a SPEC-057 seat signal
 *   AND it matched a live plan (`report.seat_unresolved` was NOT set to
 *   `true` for that call) — computed by the caller (`commands/bootstrap.ts`),
 *   never derivable from `report` alone: the seat signal deliberately never
 *   round-trips through `BootstrapReport` itself
 *   (spec-session-start-handoff-neutrality D1 — the full report's schema/shape
 *   stays untouched beyond D3's data-hygiene fix). Defaults to `false`
 *   (ordinary session — `resume_hint` omitted) so every pre-existing caller
 *   that never passes this argument gets the new, safer default automatically.
 * @returns `{payload, json}` — `payload` is the ordered, trimmed object;
 *   `json` is its compact (no-whitespace) serialization, `json.length` at
 *   most `budgets.charBudget` unless `payload.budget_exceeded` is `true`.
 * @example
 * // Ordinary session (default) — resume_hint key is entirely absent.
 * const { payload, json } = buildBootstrapInjection(report, {
 *   maxActivePlans: 5, maxHandoffs: 3, maxPendingSlugs: 3, charBudget: 8000,
 * });
 * Object.keys(payload);
 * // => ["my_claims","active_sessions","armed_gates","root",
 * //     "pending_reviews","active_plans","latest_handoffs","corpus","omitted"]
 * @example
 * // Seat-scoped session — resume_hint retained at its contract position.
 * const seatResult = buildBootstrapInjection(report, budgets, true);
 * Object.keys(seatResult.payload);
 * // => ["resume_hint","my_claims","active_sessions","armed_gates","root",
 * //     "pending_reviews","active_plans","latest_handoffs","corpus","omitted"]
 */
export function buildBootstrapInjection(
  report: BootstrapReport,
  budgets: BootstrapInjectionBudgets,
  seatScoped = false,
): BootstrapInjectionResult {
  const armedGates = report.armed_gates.map((gate) => gate.checkpoint);

  const cappedPendingSlugs = report.pending_reviews.slugs.slice(0, budgets.maxPendingSlugs);
  const pendingSlugsDropped = report.pending_reviews.slugs.length - cappedPendingSlugs.length;

  // reason: dead plans (ready=0 AND claimed=0) are excluded regardless of
  // recency (D4) BEFORE the count cap applies, so `active_plans.length -
  // keptPlans.length` below folds BOTH the dead-plan exclusion and any cap
  // overflow into one omitted count without double-bookkeeping (SPEC-080(bootstrap-injection)
  // §Test Plan NEGATIVE + BOUNDARY cases both key off this single formula).
  const actionablePlans = report.active_plans
    .filter((plan) => plan.task_counts.ready > 0 || plan.task_counts.claimed > 0)
    .sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : a.last_activity_at > b.last_activity_at ? -1 : 0));
  const keptPlans = actionablePlans.slice(0, budgets.maxActivePlans);
  const activePlansDropped = report.active_plans.length - keptPlans.length;

  const keptHandoffs = report.latest_handoffs.slice(0, budgets.maxHandoffs);
  const handoffsDropped = report.latest_handoffs.length - keptHandoffs.length;

  // reason: built as a loosely-typed working record (not `BootstrapInjection`
  // directly) because step 5 below assigns keys the static type can't name
  // (the D8 OCP unknown-field escape hatch) — cast to the public type once
  // construction is complete, right before returning.
  //
  // reason: `resume_hint` is the FIRST key assigned only when `seatScoped` —
  // conditionally spreading it in BEFORE the rest of the literal preserves
  // its contract position-1 slot when present, while an ordinary session's
  // payload starts at `my_claims` with the key entirely absent (never
  // present-as-null) — spec-session-start-handoff-neutrality D1, D2.
  const payload: Record<string, unknown> = {
    ...(seatScoped ? { resume_hint: report.resume_hint } : {}),
    my_claims: report.my_claims,
    active_sessions: report.active_sessions,
    armed_gates: armedGates,
    root: report.root,
    pending_reviews: { count: report.pending_reviews.count, slugs: cappedPendingSlugs },
    active_plans: keptPlans,
    latest_handoffs: keptHandoffs,
    corpus: report.corpus,
    // reason: present-iff-POSITIVE (spec-lifecycle-archival-plan-close-cascade-deterministic
    // D4) — assigned here, in the object literal, at the EXACT slot the D8
    // unknown-field loop below would have placed it (between `corpus` and
    // `omitted`) had it not been opted out via `BOOTSTRAP_INJECTION_KNOWN_KEYS`.
    // A `0` count omits the key entirely rather than assigning `0` — same
    // convention as `resume_hint`'s conditional spread above.
    ...(report.archive_candidates > 0 ? { archive_candidates: report.archive_candidates } : {}),
  };

  for (const key of Object.keys(report)) {
    if (!BOOTSTRAP_INJECTION_KNOWN_KEYS.has(key)) {
      payload[key] = (report as unknown as Record<string, unknown>)[key];
    }
  }

  const omitted: BootstrapInjectionOmitted = {
    active_plans: activePlansDropped,
    latest_handoffs: handoffsDropped,
    pending_slugs: pendingSlugsDropped,
    budget_drops: 0,
  };
  payload.omitted = omitted;

  let workingHandoffs = keptHandoffs;
  let workingPlans = keptPlans;
  let json = JSON.stringify(payload);

  while (json.length > budgets.charBudget && (workingHandoffs.length > 0 || workingPlans.length > 0)) {
    if (workingHandoffs.length > 0) {
      workingHandoffs = workingHandoffs.slice(0, -1);
      payload.latest_handoffs = workingHandoffs;
    } else {
      workingPlans = workingPlans.slice(0, -1);
      payload.active_plans = workingPlans;
    }
    omitted.budget_drops += 1;
    json = JSON.stringify(payload);
  }

  if (json.length > budgets.charBudget) {
    // reason: nothing left to drop — the char-budget rule forbids a
    // mid-JSON slice (SPEC-080(bootstrap-injection) §Projection Contract), so the payload is
    // returned intact and the anomaly is signaled instead of hidden.
    payload.budget_exceeded = true;
    json = JSON.stringify(payload);
  }

  return { payload: payload as unknown as BootstrapInjection, json };
}
