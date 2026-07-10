/**
 * Session layer — bootstrap pointer-set + lossless handoff schemas (SPEC-041 S1+S2).
 * Pure, browser-safe module: no IO, no Date.now()/Math.random() calls — every field
 * that depends on wall-clock time (staleness, ages) is computed by the SERVICE layer
 * (`packages/lore/src/service/session-service.ts`) and handed in as plain data.
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
 *
 * Source: SPEC-041 §3 D2, D3.
 */

import { z } from "zod";

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

/** One non-terminal plan's pointer + task readiness snapshot. */
export const bootstrapActivePlanSchema = z.object({
  slug: z.string(),
  title: z.string(),
  task_counts: bootstrapTaskCountsSchema,
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
export const bootstrapReportSchema = z.object({
  root: bootstrapRootSchema.nullable(),
  active_plans: z.array(bootstrapActivePlanSchema),
  pending_reviews: bootstrapPendingReviewsSchema,
  my_claims: z.array(bootstrapMyClaimSchema),
  armed_gates: z.array(bootstrapArmedGateSchema),
  latest_handoffs: z.array(bootstrapLatestHandoffSchema),
  resume_hint: bootstrapResumeHintSchema.nullable(),
  corpus: bootstrapCorpusStatsSchema,
});

/** Derived TypeScript type for the S1 bootstrap pointer-set. */
export type BootstrapReport = z.infer<typeof bootstrapReportSchema>;
