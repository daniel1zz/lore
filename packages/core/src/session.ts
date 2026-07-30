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
 *     is the SSOT, `content` is generated ONLY by this function). Also the SOLE
 *     rendering site for the resume-ticket LOWER-bound ordinals (D1 below):
 *     the cardinality line and every `KD<n>`/`NS<n>` item id are woven in here,
 *     never re-derived by a consumer of the rendered `content`.
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
 *     corpus-wide guess, so it is retained (D2). The payload's literal FIRST
 *     key — before `resume_hint` itself — is now `scope_declaration`
 *     (spec-context-provenance-injected-corpus-global-state-and-a D1):
 *     always `BOOTSTRAP_SCOPE_DECLARATION`, never dropped by the trimmer and
 *     never mid-sliced. There is deliberately NO short-circuit for a small
 *     `budgets.charBudget` — over-budget behavior is SPEC-080(bootstrap-injection)'s
 *     existing, unchanged rule (drop trailing `latest_handoffs` then
 *     `active_plans`, then return the payload INTACT with
 *     `budget_exceeded: true`). An earlier draft of this spec added a
 *     short-circuit that discarded every OTHER field once the declaration
 *     alone approached the budget; it was removed on measurement — it broke
 *     SPEC-080(bootstrap-injection)'s own BOUNDARY oracle (oversized single field,
 *     both droppable arrays empty) and required a fabricated all-zero
 *     `omitted` ledger plus a schema cast-gap for a shape the schema
 *     rejected. The declaration buys nothing by discarding data — it just
 *     participates in the same char measurement as everything else.
 *   - bootstrapInjectionSchema / BootstrapInjection — the projection's OWN Zod
 *     schema + type (SPEC-080(bootstrap-injection) §Module Boundary) — never a
 *     patch on `bootstrapReportSchema`. Every payload {@link buildBootstrapInjection}
 *     can return validates against this schema — there is no accepted gap
 *     (see the retired short-circuit note above for the shape that USED to
 *     require one).
 *   - BOOTSTRAP_SCOPE_DECLARATION / REQUIRED_DISCLAIMER_TOKENS — the injection
 *     payload's leading self-description and the disclaimer obligations it
 *     discharges (D1). BOOTSTRAP_FRAMING_LINE — the boundary line
 *     `lore bootstrap --injection` prints binary-side (D2, sibling T2).
 *     RESUME_SCOPE_CLOSURE — the resume ticket's scope-closure block (D3,
 *     sibling T3), naming every `BOOTSTRAP_INJECTION_KNOWN_KEYS` member as
 *     outside a ticket's scope. SOURCE_CATEGORY_TOKENS — the three source
 *     categories (pasted ticket / session-start injection / this-turn query)
 *     a status report must distinguish (D4, sibling T4). Every AC over these
 *     constants asserts identity or exhaustive-set membership, never a
 *     remembered substring (D6).
 *   - BOOTSTRAP_INJECTION_KNOWN_KEYS — now exported (previously module-private)
 *     so `RESUME_SCOPE_CLOSURE` above, and sibling tasks' own tests, can derive
 *     the "every injected field" name list from this ONE set rather than a
 *     hand-copied duplicate that can silently drift out of sync with the
 *     projection contract.
 *   - RESUME_COVERAGE_FLOOR / RESUME_ITEM_ID_PREFIX_KEY_DECISION /
 *     RESUME_ITEM_ID_PREFIX_NEXT_STEP / formatResumeItemId /
 *     RESUME_DISPOSITION_MARKER / RESUME_DISPOSITION_DONE /
 *     RESUME_DISPOSITION_DEFERRED_PREFIX / renderResumeCoverageCardinalityLine
 *     — the resume ticket's LOWER-bound vocabulary
 *     (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D1, D3, D5,
 *     D8, D9). RESUME_SCOPE_CLOSURE above bounds a ticket from ABOVE (do not
 *     exceed scope); these bound it from BELOW (account for every printed
 *     item) — a SEPARATE constant from RESUME_SCOPE_CLOSURE, never merged
 *     into it (D3). `renderHandoffContent` (above) is the ONE place the
 *     ordinal-tagged `KD<n>`/`NS<n>` lines and the cardinality line are
 *     rendered — the SSOT projection point (spec D1 revision: an earlier
 *     draft assigned this to `feed-flow.ts::renderResumeRecord`, which is
 *     unbuildable — that function's parameter carries only a pre-rendered
 *     `content: string`, never the structured arrays; widening it would have
 *     obliged the consumer to re-render all seven `renderHandoffContent`
 *     sections, a second implementation of the same SSOT).
 *     `packages/lore/src/flows/feed-flow.ts` appends `RESUME_COVERAGE_FLOOR`
 *     alongside `RESUME_SCOPE_CLOSURE` on the single-record resume-ticket
 *     path only (D10 — never on the `multi_actor` branch). Parsing a
 *     disposition line back into a verdict is sibling T3's job (the
 *     `lore handoff` coverage-check verb, the SOLE parser of that grammar —
 *     D9).
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
 *   - The leading `scope_declaration` field (spec-context-provenance-injected-corpus-global-state-and-a
 *     D1) is NEVER a candidate for the char-budget drop loop and NEVER
 *     mid-sliced — it is the one field whose absence would change the
 *     meaning of every other field. NO EXCEPTION: even when the declaration
 *     alone is close to or exceeds `budgets.charBudget`, the payload is
 *     still returned INTACT (every data field present) with
 *     `budget_exceeded: true`, per SPEC-080(bootstrap-injection)'s own
 *     "sacrifice budget, never content" rule — see D1's own note above for
 *     why an earlier short-circuit here was measured wrong and removed.
 *   - `renderResumeCoverageCardinalityLine` and `formatResumeItemId`
 *     (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the) are pure:
 *     no IO, no wall-clock reads, no randomness — the same inputs always
 *     produce the same string. `renderHandoffContent` calls both directly
 *     (same module, no import needed) and remains itself pure/deterministic
 *     after gaining the ordinal/cardinality lines (D1).
 *
 * Source: SPEC-041 §3 D2, D3; SPEC-042 §Design Decisions D1;
 * SPEC-080(bootstrap-injection; corpus slug
 * spec-080-bootstrap-injection-projection-tier-1-tier-2-payload) §Projection
 * Contract, §Public Interface, §Design Decisions D1-D8;
 * spec-session-start-handoff-neutrality-injection-drops-resume §Design
 * Decisions D1, D2 (resume_hint dropped from the injection except for a
 * seat-scoped session);
 * spec-context-provenance-injected-corpus-global-state-and-a §Design
 * Decisions D1 (leading scope declaration, no short-circuit — SPEC-080's
 * existing over-budget rule applies unchanged), D6 (no AC may assert
 * against remembered wording);
 * spec-resume-ticket-coverage-a-shipped-upper-bound-left-the §Design
 * Decisions D1 (ids/counts derive from the structured SSOT, rendered ONLY by
 * `renderHandoffContent` — this module — never re-derived or parsed by a
 * consumer), D3 (the lower-bound constant is separate from the upper-bound
 * one), D5 (the obligation is to account, not to complete), D8 (zero
 * cross-process state), D9 (the coverage-check verb is the sole grammar
 * parser; this module only names the disposition tokens), D10 (the floor
 * binds on the single-record resume-ticket path only — `feed-flow.ts`'s
 * job, not this module's).
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
 * @invariant spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D1/D2 —
 *   this is the SOLE rendering site for the resume-ticket LOWER-bound ordinals:
 *   right after the header comes {@link renderResumeCoverageCardinalityLine}'s
 *   output (the one line whose early position survives a lost-in-middle
 *   truncation of everything below it), then every `## Key Decisions` row and
 *   `## Next Steps` bullet carries its own `KD<n>`/`NS<n>` id
 *   ({@link formatResumeItemId}, 1-based, array order). No other module
 *   re-derives these ids from this function's OUTPUT (`renderResumeRecord`,
 *   `feed-flow.ts`, prints `content` verbatim) — recovering them by parsing
 *   text elsewhere would be a second, driftable rendering implementation of
 *   the same SSOT (D1's own rationale for rejecting that shape).
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
  lines.push(renderResumeCoverageCardinalityLine(extra.key_decisions.length, extra.next_steps.length));
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
    lines.push("| ID | Judgment | Confidence |");
    lines.push("|---|---|---|");
    extra.key_decisions.forEach((d, index) => {
      const id = formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, index + 1);
      const confidence = d.confidence !== undefined ? `${d.confidence}` : "—";
      lines.push(`| ${id} | ${d.judgment.replace(/\|/g, "\\|")} | ${confidence} |`);
    });
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
  lines.push(
    extra.next_steps
      .map((s, index) => `- ${formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, index + 1)}: ${s}`)
      .join("\n"),
  );

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
 *
 * Exported (spec-context-provenance-injected-corpus-global-state-and-a D3,
 * D4) so downstream constants/tests can derive "every injected field" from
 * this ONE set — see {@link RESUME_SCOPE_CLOSURE} below — rather than a
 * hand-copied field list that can silently drift out of sync with this
 * projection contract.
 */
export const BOOTSTRAP_INJECTION_KNOWN_KEYS: ReadonlySet<string> = new Set([
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

// ─── Scope Provenance Constants (spec-context-provenance-injected-corpus-global-state-and-a D1-D4) ───
//
// The 2026-07-30 incident this spec fixes: a corpus-global bootstrap
// injection and a user-pasted single-handoff resume ticket landed in the
// same context window with neither declaring its own scope, so a consumer
// merged them and recommended two actions wholly outside the pasted
// ticket's scope. Prose defenses (§FEED governance rule) already existed
// and held — they didn't stop the trespass, which is what proves prose
// recall is the wrong layer. These constants make scope self-describing
// DATA instead: identity-asserted, never a remembered paraphrase (D6).

// reason: each disclaimer phrase is defined exactly ONCE, as a named
// binding — both REQUIRED_DISCLAIMER_TOKENS and BOOTSTRAP_SCOPE_DECLARATION
// below are assembled from these same bindings (never a hand-typed
// duplicate), so the declaration and the array the AC iterates against it
// can never drift apart.
const DISCLAIMER_TOKEN_GLOBAL = "corpus-global";
const DISCLAIMER_TOKEN_ALL_PLANS = "every plan";
const DISCLAIMER_TOKEN_ALL_ACTORS = "every actor";
const DISCLAIMER_TOKEN_ALL_SESSIONS = "every concurrent session";
const DISCLAIMER_TOKEN_NOT_WORKLIST = "NOT this session's worklist";
const DISCLAIMER_TOKEN_NOT_TICKET = "NOT any handoff ticket's scope";

/**
 * Lone, unambiguous substrings {@link BOOTSTRAP_SCOPE_DECLARATION} MUST
 * contain — one per disclaimer obligation the declaration discharges
 * (spec-context-provenance-injected-corpus-global-state-and-a D1). Exported
 * so AC-CP-1 (and this module's own tests) assert
 * `BOOTSTRAP_SCOPE_DECLARATION.includes(token)` per member, rather than a
 * remembered multi-word phrase — a contiguous-substring assumption built
 * from memory silently degrades to a no-match, one of the five measured
 * false-oracle vectors this repo's CLAUDE.md dogfood-eval-log tracks.
 * Adding a fourth+ obligation means adding a token here AND weaving it into
 * the declaration below — the AC fails until both happen.
 */
export const REQUIRED_DISCLAIMER_TOKENS: readonly string[] = [
  DISCLAIMER_TOKEN_GLOBAL,
  DISCLAIMER_TOKEN_ALL_PLANS,
  DISCLAIMER_TOKEN_ALL_ACTORS,
  DISCLAIMER_TOKEN_ALL_SESSIONS,
  DISCLAIMER_TOKEN_NOT_WORKLIST,
  DISCLAIMER_TOKEN_NOT_TICKET,
];

/**
 * The text carried as the bootstrap injection payload's FIRST key
 * (`scope_declaration`, {@link buildBootstrapInjection}) —
 * spec-context-provenance-injected-corpus-global-state-and-a D1. Declares
 * that the payload is a corpus-global snapshot spanning every
 * plan/actor/concurrent session, that it is NOT the session's own worklist,
 * and that it is NOT any pasted handoff ticket's scope. Built directly from
 * {@link REQUIRED_DISCLAIMER_TOKENS}'s own bindings (never a hand-typed
 * duplicate of them) so the two can never diverge.
 *
 * @invariant Every AC/test asserts this by `===` identity against the
 *   constant, never a remembered substring (D6).
 * @invariant Participates in {@link buildBootstrapInjection}'s char budget
 *   like every other field, but is NEVER a candidate for its drop loop and
 *   NEVER mid-sliced. There is no special case for a tiny `charBudget`: if
 *   the budget can't be met even after dropping every droppable entry, the
 *   whole payload — including this declaration — is returned INTACT with
 *   `budget_exceeded: true`, the same SPEC-080(bootstrap-injection)
 *   "never sacrifice content for budget" rule every other field already
 *   follows.
 */
export const BOOTSTRAP_SCOPE_DECLARATION =
  `SCOPE: this payload is a ${DISCLAIMER_TOKEN_GLOBAL} snapshot spanning ${DISCLAIMER_TOKEN_ALL_PLANS}, ` +
  `${DISCLAIMER_TOKEN_ALL_ACTORS}, and ${DISCLAIMER_TOKEN_ALL_SESSIONS}. It is ${DISCLAIMER_TOKEN_NOT_WORKLIST}. ` +
  `It is ${DISCLAIMER_TOKEN_NOT_TICKET}.`;

/**
 * The human/AI-readable boundary line `lore bootstrap --injection` prints
 * alongside the payload (spec-context-provenance-injected-corpus-global-state-and-a
 * D2, sibling T2) — emitted BINARY-side so it ships with every `lore`
 * upgrade and can never diverge from an independently-updated hook copy
 * (the exact drift class SPEC-083 already retired for governance-snapshot
 * prose). Exported here so T2's CLI command and its own AC (AC-CP-3) can
 * assert stdout by `===` identity against this one constant rather than
 * re-typing the line at the call site.
 */
export const BOOTSTRAP_FRAMING_LINE =
  "Lore bootstrap payload below is corpus-global state — not your worklist, not any handoff ticket's scope. See its scope_declaration field before acting on anything below.";

/**
 * The resume ticket's scope-closure boundary block (`lore feed
 * session-resume`, sibling T3) —
 * spec-context-provenance-injected-corpus-global-state-and-a D3. States that
 * the ticket's scope is exactly the plan / modified files / next steps it
 * printed, and names every corpus-global injected field — drawn from
 * {@link BOOTSTRAP_INJECTION_KNOWN_KEYS} itself, NEVER a hand-copied field
 * list that can drift out of sync with the projection contract — as OUTSIDE
 * that scope.
 *
 * @invariant Field names are joined in the set's own (insertion) iteration
 *   order — deterministic; this module still performs no IO, no
 *   wall-clock reads, no randomness.
 * @invariant A newly added injected field automatically fails AC-CP-4 (T3)
 *   until this constant is regenerated to include it — since it is derived,
 *   not hand-maintained, "regenerated" here just means re-running this
 *   module (no manual edit needed).
 */
export const RESUME_SCOPE_CLOSURE =
  "SCOPE CLOSURE: this ticket's scope is exactly the plan, modified files, and next steps printed above. " +
  `It is NOT any of the corpus-global bootstrap injection fields: ${Array.from(BOOTSTRAP_INJECTION_KNOWN_KEYS).join(", ")}.`;

// ─── Resume Ticket Coverage Floor (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D1, D3, D5, D8, D9) ───
//
// RESUME_SCOPE_CLOSURE above bounds a resume ticket from ABOVE: what a
// consumer must NOT treat as in-scope. It has no LOWER bound — nothing
// asserts that a consumer accounted for EVERY item the ticket printed. The
// 2026-07-30 handoff-40 incident measured a consumer silently dropping 3 of
// 10 printed items (the tails of both arrays) while RESUME_SCOPE_CLOSURE was
// present in the consumed output and obeyed — compliant on the upper bound,
// wrong on a bound that did not exist. These constants are the vocabulary
// for that lower bound: an id-tagging scheme so the render path and the
// Stop-time coverage verb agree on a line's identity (D1), a
// disposition-line grammar so a consumer's per-item accounting is
// machine-parseable (D5, D9), and a pure cardinality renderer so the printed
// item count is identity-assertable without constructing a whole ticket
// (D2, AC-RC-2). `renderHandoffContent` (below) is the ONE place the
// ordinal-tagged lines and the cardinality line are rendered — the SSOT
// projection point, never re-rendered by a consumer (D1: an earlier draft
// assigned this to `feed-flow.ts::renderResumeRecord`, unbuildable — that
// function's parameter carries only a pre-rendered `content: string`, never
// the structured arrays). `feed-flow.ts` appends RESUME_COVERAGE_FLOOR
// alongside RESUME_SCOPE_CLOSURE on the single-record path only (D10).
// Parsing a disposition line back into a verdict belongs to sibling T3 (the
// `lore handoff` coverage-check verb, the SOLE parser of this grammar, D9).

/**
 * The resume ticket's lower-bound declaration
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D3, D4) —
 * states that every item the ticket printed (each `KD<n>`/`NS<n>` line) must
 * be dispositioned before the session ends. Deliberately a SEPARATE exported
 * constant from {@link RESUME_SCOPE_CLOSURE}, never merged into one string:
 * the two constrain OPPOSITE directions (upper bound: do not exceed scope;
 * lower bound: account for every item), and merging them would make the
 * absence of either half undetectable by a single identity assertion —
 * exactly the measured failure mode ("one direction present, the other
 * absent") this spec exists to close (D3).
 *
 * @invariant States the ACCOUNTING obligation only (`done` or
 *   `deferred:<reason>` — {@link RESUME_DISPOSITION_DONE} /
 *   {@link RESUME_DISPOSITION_DEFERRED_PREFIX}), never a completion
 *   obligation (D5) — a ticket whose items are all legitimately out of this
 *   session's scope still closes cleanly once every item is deferred.
 * @invariant Asserted by AC-RC-3 via `===` identity against this constant,
 *   never a remembered substring (D7) — and via a distinctness assertion
 *   against {@link RESUME_SCOPE_CLOSURE} proving the two never collapse into
 *   one string.
 */
export const RESUME_COVERAGE_FLOOR =
  "COVERAGE FLOOR: every item printed above (each KD<n> and NS<n> line) must be dispositioned — done, or deferred:<reason> — before this session ends. None may go unmentioned.";

/**
 * Item-id prefix for one `extra.key_decisions[]` entry (`KD<n>`, 1-based,
 * array order) — spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * D1. Exported as a named constant, never inlined at a call site, so the
 * render path (`renderHandoffContent`, this module) and the coverage-check
 * verb (sibling T3, the sole parser of this tag format, D9) cannot drift on
 * the prefix literal — the same "binary parses a format the binary emitted,
 * no second implementation to drift" discipline D8 states for the grammar as
 * a whole.
 */
export const RESUME_ITEM_ID_PREFIX_KEY_DECISION = "KD";

/**
 * Item-id prefix for one `extra.next_steps[]` entry (`NS<n>`, 1-based, array
 * order) — spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D1.
 * See {@link RESUME_ITEM_ID_PREFIX_KEY_DECISION}'s doc for why this is a
 * named export rather than an inlined literal.
 */
export const RESUME_ITEM_ID_PREFIX_NEXT_STEP = "NS";

/**
 * Formats one ordinal item id from a prefix constant and a 1-based array
 * index — the ONE place `${prefix}${oneBasedIndex}` is written, so
 * {@link RESUME_ITEM_ID_PREFIX_KEY_DECISION} and
 * {@link RESUME_ITEM_ID_PREFIX_NEXT_STEP} combine with an index identically
 * everywhere they are used (render path, coverage verb, this module's own
 * tests) — spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D1.
 * Pure — no IO, no wall-clock reads.
 *
 * @param prefix - {@link RESUME_ITEM_ID_PREFIX_KEY_DECISION} or
 *   {@link RESUME_ITEM_ID_PREFIX_NEXT_STEP}.
 * @param oneBasedIndex - The item's 1-based position in its source array.
 * @returns The tag string.
 * @example
 * formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 1); // => "KD1"
 */
export function formatResumeItemId(prefix: string, oneBasedIndex: number): string {
  return `${prefix}${oneBasedIndex}`;
}

/**
 * The disposition-line marker literal a consumer's per-item accounting is
 * tagged with — modeled directly on the `**[DOC_SYNC]**` shape
 * `assets/hooks/stop-doc-sync.mjs` already uses, which this harness has
 * measured effective at blocking a turn on an unmet per-turn obligation
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the, "Precedent
 * for the enforcement shape"). A disposition line is expected to read
 * `${RESUME_DISPOSITION_MARKER} <item-id>: <disposition>` — but this module
 * does not itself write or parse that grammar; it only names the marker so
 * the coverage-check verb (sibling T3, the SOLE parser of this grammar, D9)
 * and this module's own tests key off one literal rather than a hand-typed
 * copy that can drift from what a consumer is actually told to write.
 */
export const RESUME_DISPOSITION_MARKER = "**[RESUME_DISPOSITION]**";

/**
 * The "fully handled" disposition token
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D5) — paired
 * with {@link RESUME_DISPOSITION_DEFERRED_PREFIX} as the two accepted
 * dispositions. A disposition line reads
 * `${RESUME_DISPOSITION_MARKER} <item-id>: ${RESUME_DISPOSITION_DONE}`.
 */
export const RESUME_DISPOSITION_DONE = "done";

/**
 * The "explicitly out of scope for this session" disposition token prefix
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D5) — a
 * consumer appends its own free-text reason after the colon
 * (`deferred:<reason>`). Requiring a reason, rather than accepting a bare
 * `deferred`, costs one line and leaves the reason visible in the
 * transcript — which is what lets the coverage gate arm unconditionally
 * without becoming noise: a ticket whose items are all legitimately out of
 * this session's scope still closes cleanly once every item carries its own
 * deferral reason (D5). A disposition line reads
 * `${RESUME_DISPOSITION_MARKER} <item-id>: ${RESUME_DISPOSITION_DEFERRED_PREFIX}<reason>`.
 */
export const RESUME_DISPOSITION_DEFERRED_PREFIX = "deferred:";

/**
 * Pure cardinality-line renderer
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D2, AC-RC-2) —
 * the line stating how many items the ticket carries, computed from the two
 * SSOT array lengths rather than derived from prose. Sits between the
 * ticket's header and its first item line (D2 — a lost-in-middle truncation
 * of later content cannot strip a line this early). Pure so AC-RC-2 can
 * assert identity against this function's own output without constructing a
 * whole ticket, and referentially transparent: the same two lengths always
 * produce the same string.
 *
 * @param keyDecisionsCount - `extra.key_decisions.length`. `0` is a normal
 *   input (e.g. a `degraded` handoff, see {@link DEGRADED_HANDOFF_MARKER}
 *   above) with no special-cased branch — degraded handoffs are counted by
 *   actual array length, same as any other (spec Out-of-scope).
 * @param nextStepsCount - `extra.next_steps.length`.
 * @returns The cardinality line.
 * @example
 * renderResumeCoverageCardinalityLine(4, 6);
 * // => "SCOPE: 4 decisions + 6 next steps = 10 items to account for"
 * @example
 * renderResumeCoverageCardinalityLine(0, 1);
 * // => "SCOPE: 0 decisions + 1 next steps = 1 items to account for"
 */
export function renderResumeCoverageCardinalityLine(
  keyDecisionsCount: number,
  nextStepsCount: number,
): string {
  const total = keyDecisionsCount + nextStepsCount;
  return `SCOPE: ${keyDecisionsCount} decisions + ${nextStepsCount} next steps = ${total} items to account for`;
}

/**
 * The three source categories a status report must distinguish whenever it
 * mixes corpus-global injected state with narrower context
 * (spec-context-provenance-injected-corpus-global-state-and-a D4, sibling
 * T4's FEED governance rule update). Exported as tokens — not prose — so
 * the governance-rule AC (AC-CP-5) can iterate and assert each is named,
 * rather than accept a paraphrase that silently drops one.
 */
export const SOURCE_CATEGORY_TOKENS: readonly string[] = [
  "pasted ticket",
  "session-start injection",
  "this-turn query",
];

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
 * @invariant `scope_declaration` is REQUIRED and unconditional — it is the
 *   ONE field present on EVERY call regardless of `seatScoped` or budget
 *   (spec-context-provenance-injected-corpus-global-state-and-a D1). There
 *   is no narrower shape to accommodate: `buildBootstrapInjection` has no
 *   short-circuit, so every payload it can possibly return — including the
 *   over-budget-and-still-intact case — validates against this schema. An
 *   earlier draft added a degenerate short-circuit that DID produce a
 *   narrower shape this schema had to special-case around (a documented
 *   reject-gap); it was removed on measurement (see that function's own
 *   doc), and this schema was restored to a truthful, gap-free contract.
 */
export const bootstrapInjectionSchema = z.object({
  scope_declaration: z.string(),
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
 * accepted rather than worked around. This is the ONLY accepted gap on this
 * type — spec-context-provenance-injected-corpus-global-state-and-a D1's
 * `scope_declaration` field introduces no second one: `buildBootstrapInjection`
 * has no short-circuit, so it never returns a shape narrower than this type
 * describes.
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
 *  0. `scope_declaration` (the leading key, spec-context-provenance-injected-corpus-global-state-and-a
 *     D1) is ALWAYS set to `BOOTSTRAP_SCOPE_DECLARATION` — before
 *     `resume_hint` itself, unconditionally, on every call. It participates
 *     in the char-budget measurement in step 6 below exactly like every
 *     other field, but is NEVER a candidate for that step's drop loop and
 *     NEVER mid-sliced. There is deliberately NO short-circuit for a small
 *     `budgets.charBudget`: an earlier draft of this spec short-circuited to
 *     a minimal `{scope_declaration, omitted, budget_exceeded}` payload
 *     whenever the declaration alone approached the budget, discarding
 *     every other field to buy the declaration's survival. That was removed
 *     on measurement — it is the exact "sacrifice content to fit the
 *     budget" behavior SPEC-080(bootstrap-injection)'s own char-budget rule
 *     (step 6) forbids, merely at field granularity instead of character
 *     granularity, and it fired on ANY `charBudget` below the declaration's
 *     length regardless of how small the actual report was. The correct,
 *     current behavior is: the declaration rides through steps 1-6
 *     unchanged, and step 6's existing exhaust-then-flag fallback handles
 *     an unmeetable budget the same way it always has.
 *  0.5. `resume_hint` is included ONLY when `seatScoped` is `true`
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
 * // Ordinary session (default) — resume_hint key is entirely absent;
 * // scope_declaration leads (spec-context-provenance-injected-corpus-global-state-and-a D1).
 * const { payload, json } = buildBootstrapInjection(report, {
 *   maxActivePlans: 5, maxHandoffs: 3, maxPendingSlugs: 3, charBudget: 8000,
 * });
 * Object.keys(payload);
 * // => ["scope_declaration","my_claims","active_sessions","armed_gates","root",
 * //     "pending_reviews","active_plans","latest_handoffs","corpus","omitted"]
 * @example
 * // Seat-scoped session — resume_hint retained immediately after scope_declaration.
 * const seatResult = buildBootstrapInjection(report, budgets, true);
 * Object.keys(seatResult.payload);
 * // => ["scope_declaration","resume_hint","my_claims","active_sessions","armed_gates","root",
 * //     "pending_reviews","active_plans","latest_handoffs","corpus","omitted"]
 * @example
 * // Unmeetable budget (e.g. a single oversized field, both droppable arrays
 * // empty) — SPEC-080(bootstrap-injection)'s existing rule: payload returned
 * // INTACT (every field, including scope_declaration, still present) with
 * // budget_exceeded: true. No field is ever dropped to buy this outcome.
 * const overBudget = buildBootstrapInjection(report, { ...budgets, charBudget: 10 });
 * overBudget.payload.budget_exceeded; // => true
 * overBudget.payload.scope_declaration; // => BOOTSTRAP_SCOPE_DECLARATION (unsliced)
 * Object.keys(overBudget.payload); // => same 10 keys as the ordinary example above
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
  // reason: `scope_declaration` is unconditionally the FIRST key assigned
  // below (spec-context-provenance-injected-corpus-global-state-and-a D1) —
  // it must lead even `resume_hint`, since it is the boundary a consumer
  // reading top-down must meet before any data, including the seat-scoped
  // resume pointer.
  //
  // reason: `resume_hint` is the FIRST key assigned after the declaration,
  // only when `seatScoped` — conditionally spreading it in BEFORE the rest
  // of the literal preserves its contract position after `scope_declaration`
  // when present, while an ordinary session's payload continues at
  // `my_claims` with the key entirely absent (never present-as-null) —
  // spec-session-start-handoff-neutrality D1, D2.
  const payload: Record<string, unknown> = {
    scope_declaration: BOOTSTRAP_SCOPE_DECLARATION,
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
