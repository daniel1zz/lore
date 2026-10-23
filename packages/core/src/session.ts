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
 *   - readySessionSchema / ReadySession — one derived session grouping (SPEC-042 D1).
 *     `stale` (optional, present-iff-true) is NEVER set by `deriveSessions` itself —
 *     only `SessionService.bootstrap`'s post-processing sets it, over an
 *     unbounded-ttl call (task-active-sessions-derives-only-over-active-plans-tasks-with
 *     Required #2; see that schema field's own JSDoc and `session-service.ts`'s
 *     `bootstrap()` for the full rationale)
 *   - deriveSessions(tasks, nowIso, ttlMinutes) — groups FRESH (per the PASSED-IN
 *     ttl) claims by `(by, machine, worktree, session_id)`; the pure computation
 *     behind both `lore ready`'s per-plan `sessions[]` (called with the real
 *     ttl, unchanged) and `lore bootstrap`'s corpus-wide `active_sessions`
 *     (called with an unbounded ttl, then post-processed — see above).
 *     `session_id` joined the key in
 *     task-two-concurrent-orchestrators-both-resolve-to-agent-main: `by` is a
 *     PROXY for the session instance, and two concurrently-live sessions in one
 *     checkout legitimately share it (this project's own discipline gives every
 *     main-checkout run the name `agent:main-orchestrator`), so the pre-fix triple reported ONE
 *     session where two existed — and the `noAnchorOverlap` mutex, reading the
 *     same proxy, permitted an overlap it exists to refuse
 *   - deriveLastActivityAt(plan, tasks) — max `updated_at` across a plan and its
 *     child tasks; populates each `bootstrap.active_plans[]` entry's required
 *     `last_activity_at` (SPEC-069 §Design Decisions D6, D7)
 *   - buildBootstrapInjection({report, seat}, budgets) —
 *     spec-session-start-injection-carries-only-the-session-s-own: the SOLE
 *     owner of injection selection + the char-budget flag. The session-start
 *     payload carries ONLY the seat's own open items — unfinished claims
 *     recorded for the seat (`seat_claims`, from `SessionService.seatClaims`)
 *     plus the seat plan's `resume_hint` — and the call returns
 *     `{payload: null, json: ""}` when there are none (main checkout, or a seat
 *     with neither). Corpus-global report fields are pull-only (`lore
 *     bootstrap`, `lore ready <plan>`, `lore pending`) and never enter the
 *     payload. Supersedes SPEC-080's tier-1 projection (count caps, omitted
 *     ledger, append-unknown rule) and spec-session-start-handoff-neutrality's
 *     `seatScoped` argument; those specs stay unedited execution records.
 *   - bootstrapInjectionSchema / BootstrapInjection / bootstrapSeatClaimSchema —
 *     the projection's OWN `.strict()` Zod schema (never a patch on
 *     `bootstrapReportSchema`); an unlisted key fails loudly.
 *   - BOOTSTRAP_INJECTED_KEYS — the CLOSED allowlist of injectable keys (D4).
 *     BOOTSTRAP_CORPUS_GLOBAL_KEYS — the pull-only full-report fields.
 *     BOOTSTRAP_RESUME_CLOSURE_KEYS — those plus `resume_hint`/`my_claims`
 *     (D8); `RESUME_SCOPE_CLOSURE` derives its field list from it.
 *   - BOOTSTRAP_SCOPE_DECLARATION — the payload's leading self-description (this
 *     worktree's items only; corpus-wide state not included). BOOTSTRAP_FRAMING_LINE
 *     — the boundary line `lore governance bootstrap-framing` prints. Both
 *     asserted by CONTENT, not only identity (AC-SI-1(g)).
 *     SOURCE_CATEGORY_TOKENS — the three source categories (pasted ticket /
 *     session-start injection / this-turn query) a status report must
 *     distinguish (D4, sibling T4).
 *   - RESUME_SCOPE_CLOSURE — the resume ticket's scope-closure block (D3,
 *     sibling T3), naming every `BOOTSTRAP_RESUME_CLOSURE_KEYS` member as
 *     outside a ticket's scope.
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
 *     path only (D10 — never on the `multi_actor` branch). No verb parses a
 *     disposition line any more (the `lore handoff coverage-check` verb was removed).
 *   - hasDeferralDestination(reason) / RESUME_DISPOSITION_MISSING_DESTINATION_STDERR_PREFIX
 *     — spec-resume-coverage-floor-the-satisfaction-boundaries-a S4 (Overview
 *     Hole 3): a deferral REASON (S1) is not itself a DESTINATION — the
 *     predicate recognizes an issue reference or a corpus slug inside the
 *     reason text, and the prefix was the removed coverage-check verb's distinct
 *     stderr refusal for a reason that names neither. MANDATORY exports per
 *     that spec's Scope section (SPEC-112 D7/D9: the verb composes from
 *     exports, never inline literals) — see the constants' own doc comments,
 *     just above `renderResumeCoverageCardinalityLine`, below.
 *   - sessionStartMarkerFilename(sessionId) / isSameSessionAuthorship(record,
 *     currentActor, sessionStartIso) — task-verifying-a-handoff-you-just-authored-arms-the-coverage
 *     D1/D2: narrows WHEN the resume-ticket coverage floor above arms.
 *     Measured 2026-08-01: a session that authors a handoff and then runs
 *     `lore feed session-resume` on it PURELY TO VERIFY the ticket a human
 *     will paste was arming the floor against itself, demanding disposition
 *     of the very next-steps it was explicitly handing off. `isSameSessionAuthorship`
 *     answers "was `record` plausibly authored during the CURRENTLY-arming
 *     session" from two INDEPENDENTLY-required facts — `record.by ===
 *     currentActor` (identity) AND `record.at >= sessionStartIso` (a REAL
 *     stored session-start timestamp, never a "created recently" heuristic
 *     window) — never from identity alone (a lone actor-identity predicate
 *     was measured insufficient: a stable orchestrator actor persists across
 *     many LATER, LEGITIMATE resumes of its own past handoffs, which must
 *     still arm). `sessionStartIso` is supplied by the CALLER
 *     (`packages/lore/src/flows/feed-flow.ts::buildResumeFeed`), which reads
 *     it from a marker `assets/hooks/session-start-marker.mjs` (a NEW
 *     SessionStart hook, registered in `distribution-hooks.ts`) writes ONCE
 *     per session into `os.tmpdir()`, keyed by
 *     `CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID` — no stored session-start
 *     fact existed anywhere in this codebase before this task (measured: a
 *     "session" was previously DERIVED-never-stored, SPEC-042 D1, and the
 *     one genuine session boundary that DOES exist — the Claude Code
 *     transcript's own per-entry timestamps — is reachable only from the
 *     Stop-hook's own process, `commands/handoff.ts`, out of this task's
 *     anchors). This module stays pure/browser-safe: `sessionStartMarkerFilename`
 *     is a plain string transform, and `isSameSessionAuthorship` takes the
 *     marker's already-read value as a parameter — neither touches `fs`/`os`.
 *
 * Invariants:
 *   - No IO, no wall-clock reads, no randomness — `renderHandoffContent` is deterministic:
 *     the same `HandoffExtra` always renders the same Markdown string.
 *   - `handoffExtraSchema`'s nested caps (`judgment` ≤300 chars, `output_tail` ≤2000 chars)
 *     bound document growth the same way `evidenceEntrySchema.output_tail` (≤`CAPTURE_TAIL_CHARS`,
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
 *   - `isSameSessionAuthorship` (task-verifying-a-handoff-you-just-authored-arms-the-coverage
 *     D2, Q2 fail-safe) returns `false` (arm) whenever `sessionStartIso` is
 *     `undefined` — an UNKNOWN session boundary NEVER reads as "same
 *     session". This is the ONE precondition-absent branch in this whole
 *     module that a caller must not silently upgrade to "match".
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
 * cross-process state), D9 (this module only names the disposition tokens; the coverage-check verb that parsed them was removed), D10 (the floor
 * binds on the single-record resume-ticket path only — `feed-flow.ts`'s
 * job, not this module's);
 * task-verifying-a-handoff-you-just-authored-arms-the-coverage §Candidate
 * predicates (2), §Oracle (same-session authorship, fail-safe direction).
 */

import { z } from "zod";
import { baselineTreeSchema } from "./baseline.js";
import { ChangeSourceSchema, type ChangeSource, type SessionTrail } from "./session-trail.js";
import { extractHeldClaim, isClaimStale } from "./task-workflow.js";
import type { DocId, DocRecord } from "./types.js";

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
 * (tighter than `evidenceEntrySchema.output_tail`'s `CAPTURE_TAIL_CHARS` — a handoff is a pointer
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
 * One entry of a handoff's merged changed-file view (session-trail D16): a path, every distinct change
 * source the session trail recorded for it (empty when only the author named it), and whether the author
 * typed it into `modified_files`. One entry per path, however many sources or turns touched it.
 */
export const handoffChangedFileSchema = z.object({
  path: z.string().min(1),
  sources: z.array(ChangeSourceSchema),
  named_by_author: z.boolean(),
});
export type HandoffChangedFile = z.infer<typeof handoffChangedFileSchema>;

/**
 * A part of the session trail the handoff could not list files for: a removed part, or a turn / helper /
 * whole trail that was not measured. Rendered as such, never as "no change" (plan invariant I7).
 */
export const handoffTrailGapSchema = z.object({
  kind: z.enum(["removed", "unmeasured"]),
  subject: z.string().min(1),
  detail: z.string().min(1),
});
export type HandoffTrailGap = z.infer<typeof handoffTrailGapSchema>;

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
  changed_files: z.array(handoffChangedFileSchema).optional(),
  changed_files_measured: z.boolean().optional(),
  trail_gaps: z.array(handoffTrailGapSchema).optional(),
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

function formatChangeSource(source: ChangeSource): string {
  switch (source.kind) {
    case "run":
      return `run ${source.run}`;
    case "vcs":
      return "vcs";
    case "unknown":
      return "source unknown";
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function renderChangedFilesSection(extra: HandoffExtra): string[] {
  const files = extra.changed_files ?? [];
  const gaps = extra.trail_gaps ?? [];
  const out: string[] = ["## Changed Files", ""];
  if (extra.changed_files_measured === false) {
    const why = gaps.find((g) => g.kind === "unmeasured" && g.subject === "trail");
    out.push(`changed files: not measured${why !== undefined ? ` (${why.detail})` : ""}`);
    if (files.length > 0) out.push("", "Files named by the author:");
  }
  if (files.length > 0) {
    for (const f of files) {
      const labels = f.sources.map(formatChangeSource);
      if (f.named_by_author) labels.push("named by author");
      out.push(`- ${f.path} (${labels.join("; ")})`);
    }
  } else if (extra.changed_files_measured !== false) {
    out.push("(none recorded in the session trail)");
  }
  const shownGaps = gaps.filter((g) => !(g.kind === "unmeasured" && g.subject === "trail"));
  if (shownGaps.length > 0) {
    out.push("", "Trail gaps:");
    for (const g of shownGaps) out.push(`- ${g.kind === "removed" ? "removed" : "not measured"}: ${g.subject} — ${g.detail}`);
  }
  return out;
}

/** The three handoff fields the session trail fills (D16). */
export interface HandoffChangedFiles {
  readonly changed_files: HandoffChangedFile[];
  readonly changed_files_measured: boolean;
  readonly trail_gaps: HandoffTrailGap[];
}

/**
 * Merge a session trail with the files the author typed into one changed-file view (D16). Pure.
 *
 * @param trail - the caller's session trail, or `null` when it could not be read.
 * @param authorFiles - `modified_files` exactly as typed (BR-343: matched by exact string).
 * @param unmeasuredReason - why there is no trail; used only when `trail` is `null`.
 * @returns trail files in first-seen order (one entry per path, every distinct source), then author-only
 *   files; `changed_files_measured` is false only when there is no trail. Removed parts and unmeasured turns
 *   or helpers become `trail_gaps`, never silence.
 * @example
 * mergeTrailIntoChangedFiles(null, ["a.ts"], "no attested run").changed_files_measured // => false
 */
export function mergeTrailIntoChangedFiles(
  trail: SessionTrail | null,
  authorFiles: readonly string[],
  unmeasuredReason: string,
): HandoffChangedFiles {
  const sourcesByPath = new Map<string, Map<string, ChangeSource>>();
  const gaps: HandoffTrailGap[] = [];
  const note = (path: string, source: ChangeSource): void => {
    const known = sourcesByPath.get(path) ?? new Map<string, ChangeSource>();
    known.set(JSON.stringify(source), source);
    sourcesByPath.set(path, known);
  };

  if (trail === null) {
    gaps.push({ kind: "unmeasured", subject: "trail", detail: unmeasuredReason });
  } else {
    if (trail.removed !== null) {
      gaps.push({
        kind: "removed",
        subject: `session ${trail.session}`,
        detail: `earlier part removed on ${trail.removed.removed_at}`,
      });
    }
    for (const turn of trail.turns) {
      if (turn.changes.measured) {
        for (const change of turn.changes.value) note(change.path, change.source);
      } else {
        gaps.push({ kind: "unmeasured", subject: `turn ${turn.turn}`, detail: turn.changes.reason });
      }
    }
    for (const helper of trail.helpers) {
      if (helper.changes === undefined) {
        gaps.push({ kind: "unmeasured", subject: `helper ${helper.run}`, detail: "no end measurement recorded" });
      } else if (helper.changes.measured) {
        for (const change of helper.changes.value.files) note(change.path, change.source);
      } else {
        gaps.push({ kind: "unmeasured", subject: `helper ${helper.run}`, detail: helper.changes.reason });
      }
    }
  }

  const authored = new Set(authorFiles);
  const changed_files: HandoffChangedFile[] = [...sourcesByPath].map(([path, sources]) => ({
    path,
    sources: [...sources.values()],
    named_by_author: authored.has(path),
  }));
  for (const path of authored) {
    if (!sourcesByPath.has(path)) changed_files.push({ path, sources: [], named_by_author: true });
  }
  return { changed_files, changed_files_measured: trail !== null, trail_gaps: gaps };
}

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

  if (extra.changed_files !== undefined || extra.changed_files_measured !== undefined) {
    // reason: session-trail D16 — once the merged view exists it is the ONE list rendered; `modified_files`
    // stays stored exactly as typed (BR-343) but is not shown a second time.
    lines.push(...renderChangedFilesSection(extra));
  } else {
    lines.push("## Modified Files");
    lines.push("");
    lines.push(
      extra.modified_files.length > 0 ? extra.modified_files.map((f) => `- ${f}`).join("\n") : "(none)",
    );
  }
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

/**
 * `{tree, id, slug, title}` pointer to a baseline tree root (the architecture tree's root in
 * {@link bootstrapReportSchema}`.architecture`). `id` makes it addressable without a slug lookup.
 */
export const bootstrapTreeRootSchema = z.object({
  tree: baselineTreeSchema,
  id: z.string(),
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
 * `(by, machine, worktree, session_id)` (SPEC-042 D1, extended by
 * task-two-concurrent-orchestrators-both-resolve-to-agent-main). An absent
 * `machine`/`worktree`/`session_id` is a valid, stable grouping key equal to
 * itself — legacy machine-less claims by one actor group into ONE session,
 * distinguishable from captured values only by the field's absence (review S7).
 *
 * @invariant A row with NO `session_id` is a row whose session instance was
 *   never measured — it may therefore aggregate SEVERAL real sessions that
 *   happened to share `(by, machine, worktree)`. That is exactly the collapse
 *   that let an orchestrator read a too-short `active_sessions` and remove a
 *   live agent's worktree. Absence here is not a claim of solitude; a consumer
 *   deciding anything destructive off this list must treat a `session_id`-less
 *   row as "unknown cardinality", never as "exactly one session".
 * @invariant `stale` is NEVER set by {@link deriveSessions} itself — that
 *   function's own staleness filter (below) still `continue`s past a stale
 *   claim entirely, unchanged, so `TaskWorkflowService.ready`'s plan-scoped
 *   `sessions[]` (the SAME function, SAME call shape) stays byte-identical to
 *   before this field existed. `stale` is populated ONLY by
 *   `SessionService.bootstrap`'s corpus-wide `active_sessions`, which calls
 *   `deriveSessions` with an unbounded ttl (so nothing is filtered out) and
 *   then marks a returned group `stale: true` when its OWN freshest signal
 *   (`newest_at`) has, separately, aged past the real ttl — Required #2's
 *   recorded decision, task-active-sessions-derives-only-over-active-plans-tasks-with
 *   (see that file's `bootstrap()` JSDoc for the full rationale). Present-iff-true
 *   (never `false`), the same convention `seat_unresolved` already uses.
 */
export const readySessionSchema = z.object({
  by: z.string(),
  machine: z.string().optional(),
  worktree: z.string().optional(),
  /**
   * The group's captured session instance (`TaskClaim.session_id`) — present iff
   * every member claim recorded one (they all recorded the SAME one, by
   * construction of the grouping key). Absent ⇒ not measured, see the schema's
   * own invariant above.
   */
  session_id: z.string().optional(),
  /** Distinct `branch` values across this session's member claims, insertion order. */
  branches: z.array(z.string()),
  /** Task slugs this session currently holds a fresh claim on, insertion order. */
  task_slugs: z.array(z.string()),
  /** The most recent `claim.at` among this session's member claims. */
  newest_at: z.string(),
  /**
   * `true` iff this group's OWN freshest claim activity (`newest_at`) has
   * itself aged past the consumer's ttl — i.e. even the most recently active
   * member of this session looks stale by the timestamp alone. Staleness is
   * NOT death (task doc "Second half"): a consumer must read this as
   * "no fresher activity signal recorded for this claimant", never as
   * grounds alone for a destructive action. Absent (never `false`) for any
   * group that is NOT stale — present-iff-true.
   */
  stale: z.boolean().optional(),
  /**
   * Where another session can message this session's MAIN run (`uds:<absolute path>`), or `null` when none is
   * recorded (BR-1363, BR-1360). Always present: `null` is the measured "no address", never an omitted field.
   * It is the address of the main run of the session the claims' runs belong to, so a subagent's claim shows
   * the same address as its main run's.
   */
  message_address: z.string().nullable(),
});

/** Derived TypeScript type for one session grouping (SPEC-042 D1). */
export type ReadySession = z.infer<typeof readySessionSchema>;

/**
 * Groups `tasks`' FRESH (non-stale) claims into sessions by the composite key
 * `(by, machine, worktree, session_id)` (SPEC-042 D1 +
 * task-two-concurrent-orchestrators-both-resolve-to-agent-main §Required fix 2).
 * Pure — no IO, no wall-clock reads; staleness is computed against the
 * caller-supplied `nowIso`/`ttlMinutes`, the same D10 time-seam discipline
 * `evaluateReadiness` (task-workflow.ts) uses.
 *
 * `session_id` is in the key because `by` is a proxy for "which session", not
 * the fact: two concurrently-live sessions in one checkout legitimately share an
 * actor string (this project's own discipline mandates one), and the pre-fix
 * `(by, machine, worktree)` triple was byte-identical for them — one row where
 * two sessions existed.
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
 * @param staleByTask - Optional run-aware staleness the caller already resolved per task id (BR-1058:
 *   an `orphaned_dirty` claim never ages out, a clean ended-run claim is stale at once). A task with an
 *   entry uses it; a task without one falls back to TTL-only `isClaimStale`.
 * @param messageAddressByRun - Optional lookup `claim.harness_run -> the address of that run's session's MAIN
 *   run` (null = none recorded), built by the caller from the run registry (BR-1363). The session's
 *   `message_address` is the first non-null address among its member claims; a claim whose run is absent from
 *   the lookup (or an absent lookup) contributes none, so the field is `null`, never a guess. Joined by run id
 *   only: never by `parentRunId` (the hook registers subagents without a parent), `session_id` or a name.
 * @returns One `ReadySession` per distinct `(by, machine, worktree, session_id)`
 *   key present among `tasks`' fresh claims, in first-seen order.
 *
 * @example
 * deriveSessions(
 *   [taskA, taskB], // taskA: claim{by:"agent:t1", machine:"hostA", worktree:"/w1"}
 *                    // taskB: claim{by:"agent:t2", machine:"hostA", worktree:"/w2"}
 *   "2026-07-11T10:00:00.000Z", 120,
 * );
 * // => two sessions — same machine, distinct worktree still discriminates (D1)
 *
 * @example
 * deriveSessions(
 *   [taskA, taskB], // both: claim{by:"agent:main-orchestrator", machine:"mbp"}
 *                    // taskA session_id "3de02220", taskB session_id "7ab19c04"
 *   "2026-08-03T10:00:00.000Z", 120,
 * );
 * // => TWO sessions — identical by/machine/(absent)worktree, distinct session
 * //    instance (the observed two-orchestrator case; ONE row before the fix)
 */
export function deriveSessions(
  tasks: DocRecord[],
  nowIso: string,
  ttlMinutes: number,
  staleByTask?: ReadonlyMap<DocId, boolean>,
  messageAddressByRun?: ReadonlyMap<string, string | null>,
): ReadySession[] {
  interface MutableGroup {
    by: string;
    machine?: string;
    worktree?: string;
    session_id?: string;
    branches: string[];
    branchSeen: Set<string>;
    task_slugs: string[];
    newest_at: string;
    message_address: string | null;
  }

  const groups = new Map<string, MutableGroup>();
  const order: string[] = [];

  for (const task of tasks) {
    const claim = extractHeldClaim(task);
    if (claim === undefined) continue;
    if (staleByTask?.get(task.id) ?? isClaimStale(claim, nowIso, ttlMinutes)) continue;

    // reason: `null` is used as the absent-field placeholder (never a legal
    // machine/worktree/session_id value) so JSON.stringify produces a stable,
    // distinct key per (by, machine, worktree, session_id) tuple — including the
    // "all absent" case, which must equal itself across different tasks/claims
    // (review S7). `session_id` is the fourth component because `by` alone is a
    // proxy for the session, not the session
    // (task-two-concurrent-orchestrators-both-resolve-to-agent-main): two live
    // sessions sharing one mandated actor string produced ONE row here.
    const key = JSON.stringify([
      claim.by,
      claim.machine ?? null,
      claim.worktree ?? null,
      claim.session_id ?? null,
    ]);

    let group = groups.get(key);
    if (group === undefined) {
      group = {
        by: claim.by,
        ...(claim.machine !== undefined ? { machine: claim.machine } : {}),
        ...(claim.worktree !== undefined ? { worktree: claim.worktree } : {}),
        ...(claim.session_id !== undefined ? { session_id: claim.session_id } : {}),
        branches: [],
        branchSeen: new Set<string>(),
        task_slugs: [],
        newest_at: claim.at,
        message_address: null,
      };
      groups.set(key, group);
      order.push(key);
    }

    if (claim.branch !== undefined && !group.branchSeen.has(claim.branch)) {
      group.branchSeen.add(claim.branch);
      group.branches.push(claim.branch);
    }
    group.task_slugs.push(task.slug);
    if (group.message_address === null && claim.harness_run != null) {
      group.message_address = messageAddressByRun?.get(claim.harness_run) ?? null;
    }
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
      ...(g.session_id !== undefined ? { session_id: g.session_id } : {}),
      branches: g.branches,
      task_slugs: g.task_slugs,
      newest_at: g.newest_at,
      message_address: g.message_address,
    };
  });
}

/**
 * The ONE definition of an "active plan": a plan whose status is neither `archived` nor
 * `deprecated` (so draft, in-review and approved plans are all active).
 *
 * Bootstrap's `active_plans` loop and the HTTP list filter `GET /api/docs?type=plan&active=true`
 * both call this, so the two surfaces cannot disagree. Pure and browser-safe (no Node import).
 *
 * @param plan - Anything carrying the plan's `status` (a `DocRecord` or `DocSummary`).
 * @returns true when the plan is still in play.
 * @example
 * isActivePlan({ status: "approved" }); // => true
 * isActivePlan({ status: "archived" }); // => false
 */
export function isActivePlan(plan: { readonly status: DocRecord["status"] }): boolean {
  return plan.status !== "archived" && plan.status !== "deprecated";
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

/**
 * Root memory-file health block carried by `lore bootstrap --json` as the OPTIONAL
 * `memory_file_health` field (spec-claude-md-root-section-structure-check-and-adoption-mode,
 * D7/D8; AC-STR-5). Computed ADAPTER-side by `adapters/cli/memory-file-health.ts`
 * (SessionService has no filesystem) and spliced beside `sessionService.bootstrap`.
 *
 * @invariant Declared on the SCHEMA, not only the TS literal: a plain `z.object`
 *   silently STRIPS unrecognised keys on `.parse()`, so omitting it here would make
 *   the field vanish at any downstream `bootstrapReportSchema.parse`.
 * @invariant Present iff the root file has >= 1 deterministic finding of any kind (limits are always
 *   enforced: there is no adoption mode); ABSENT (never `null`) otherwise — an absent field means
 *   "clean", so it must never be emitted as a placeholder.
 */
export const memoryFileHealthSchema = z.object({
  /** Missing required root H2 names, in contract order. */
  missing: z.array(z.string()),
  /** True iff a `section_order` finding exists for the root file. */
  out_of_order: z.boolean(),
  /** Distinct kinds of the root file's deterministic findings. */
  finding_kinds: z.array(z.string()),
  finding_count: z.number().int().min(1),
});

/** Derived TypeScript type for {@link memoryFileHealthSchema}. */
export type MemoryFileHealth = z.infer<typeof memoryFileHealthSchema>;

export const bootstrapReportSchema = z.object({
  root: bootstrapRootSchema.nullable(),
  /**
   * The strategy document (first PRD, created_at ASC). Present ONLY when a baseline root exists —
   * then `root` is the baseline root and this names the PRD. ABSENT (not null) otherwise, so a
   * no-baseline corpus's report stays byte-identical (AC-BLS3-3).
   */
  strategy: bootstrapRootSchema.optional(),
  /**
   * The ARCHITECTURE tree's root (oldest live baseline with `tree: architecture`, `node: root`),
   * so a session can find the current-state architecture from the session-start overview.
   * Always present: `null` is the explicit "this corpus has no architecture root" (never omitted,
   * so absence is distinguishable from an unreported field). `root` is unchanged (business root).
   */
  architecture: bootstrapTreeRootSchema.nullable(),
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
  /** Optional root memory-file health — see {@link memoryFileHealthSchema}. Attached by the CLI adapter, never by SessionService. */
  memory_file_health: memoryFileHealthSchema.optional(),
});

/** Derived TypeScript type for the S1 bootstrap pointer-set. */
export type BootstrapReport = z.infer<typeof bootstrapReportSchema>;

// ─── Bootstrap Injection Key Sets (spec-session-start-injection-carries-only-the-session-s-own D4, D8) ───

/**
 * The CLOSED allowlist of keys the session-start injection may carry
 * (D4 — reverses SPEC-080 D8's append-unknown rule: the default is silence, a
 * new report field is never auto-injected). Exported so tests can assert every
 * payload key is a member and none is a {@link BOOTSTRAP_CORPUS_GLOBAL_KEYS}
 * member.
 */
export const BOOTSTRAP_INJECTED_KEYS: ReadonlySet<string> = new Set([
  "scope_declaration",
  "resume_hint",
  "seat_claims",
  "budget_exceeded",
]);

/**
 * The full-report fields that are PULL-ONLY (D8) — corpus-global state a
 * session fetches on demand with `lore bootstrap` / `lore ready <plan>` /
 * `lore pending`, never injected at session start. Replaces the retired injected-keys constant, whose name claimed these were injected.
 */
export const BOOTSTRAP_CORPUS_GLOBAL_KEYS: ReadonlySet<string> = new Set([
  "root",
  "active_plans",
  "pending_reviews",
  "armed_gates",
  "latest_handoffs",
  "corpus",
  "active_sessions",
  "archive_candidates",
  "strategy",
  "architecture",
]);

/**
 * {@link BOOTSTRAP_CORPUS_GLOBAL_KEYS} plus `resume_hint` and `my_claims` (D8):
 * every full-report field a pasted resume ticket's scope does NOT cover.
 * {@link RESUME_SCOPE_CLOSURE} derives its field list from this set, so the
 * shipped ticket wording keeps naming every report field.
 */
export const BOOTSTRAP_RESUME_CLOSURE_KEYS: ReadonlySet<string> = new Set([
  ...BOOTSTRAP_CORPUS_GLOBAL_KEYS,
  "resume_hint",
  "my_claims",
]);

// ─── Scope Constants (spec-session-start-injection-carries-only-the-session-s-own) ───
//
// The injection no longer carries corpus-global state, so its self-description
// changes with it: it declares that it holds ONLY this worktree's own open
// items and that everything wider must be pulled. Asserted by CONTENT on the
// exported constants (AC-SI-1(g)) — identity alone would let a stale
// corpus-global wording pass.

/**
 * The text carried as the injection payload's FIRST key (`scope_declaration`,
 * {@link buildBootstrapInjection}). Declares that the payload holds ONLY the
 * open items of the worktree this session sits in (unfinished claims recorded
 * for its branch; that plan's newest handoff) and that corpus-wide state is NOT
 * included and must be pulled.
 *
 * @invariant Contains `this worktree` and `not included`; contains neither
 *   `corpus-global` nor `every plan`; never implies the claimed run has died —
 *   a live second session in the same seat sees a FRESH claim.
 * @invariant Participates in the char budget like every field, is never
 *   sliced; an unmeetable budget returns the payload INTACT with
 *   `budget_exceeded: true`.
 */
export const BOOTSTRAP_SCOPE_DECLARATION =
  "SCOPE: this payload holds ONLY the open items of this worktree: unfinished claims recorded for its branch " +
  "and, when the branch names a plan, that plan's newest handoff. " +
  "Corpus-wide state (other plans, other sessions, the review queue) is not included — pull it when you need it. " +
  "A claim listed here may belong to a session that is still running in this worktree.";

/**
 * The one-line boundary `lore governance bootstrap-framing` prints alongside
 * a non-empty payload — emitted BINARY-side so it ships with every `lore`
 * upgrade and cannot diverge from an independently-updated hook copy. Exported
 * so the CLI command and tests assert stdout by `===` identity.
 *
 * @invariant Names the pull commands `lore bootstrap`, `lore ready <plan>`,
 *   `lore pending`; contains no `corpus-global` wording.
 */
export const BOOTSTRAP_FRAMING_LINE =
  "Lore session-start payload below lists only this worktree's own open items. " +
  "For anything wider, pull it on demand: lore bootstrap, lore ready <plan>, lore pending.";

/**
 * The resume ticket's scope-closure boundary block (`lore feed
 * session-resume`) — spec-context-provenance-injected-corpus-global-state-and-a
 * D3. States that the ticket's scope is exactly the plan / modified files /
 * next steps it printed, and names every full-report bootstrap field — drawn
 * from {@link BOOTSTRAP_RESUME_CLOSURE_KEYS} itself, NEVER a hand-copied field
 * list that can drift out of sync — as OUTSIDE that scope.
 *
 * @invariant Field names are joined in the set's own (insertion) iteration
 *   order — deterministic; this module still performs no IO, no
 *   wall-clock reads, no randomness.
 * @invariant A newly added full-report field is named here only once it is
 *   added to {@link BOOTSTRAP_CORPUS_GLOBAL_KEYS} (or the two extra members
 *   of {@link BOOTSTRAP_RESUME_CLOSURE_KEYS}); no manual edit of this string.
 */
export const RESUME_SCOPE_CLOSURE =
  "SCOPE CLOSURE: this ticket's scope is exactly the plan, modified files, and next steps printed above. " +
  `It is NOT any of the bootstrap report fields (pull those on demand with lore bootstrap): ${Array.from(BOOTSTRAP_RESUME_CLOSURE_KEYS).join(", ")}.`;

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
// No verb parses a disposition line any more (the `lore handoff coverage-check` verb was removed).

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
 * render path (`renderHandoffContent`, this module) and its tests cannot drift on
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
 * the retired `assets/hooks/stop-doc-sync.mjs` used (its successor
 * `assets/hooks/stop-turn-review.mjs` keeps the block channel), which this
 * harness measured effective at blocking a turn on an unmet per-turn obligation
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the, "Precedent
 * for the enforcement shape"). A disposition line is expected to read
 * `${RESUME_DISPOSITION_MARKER} <item-id>: <disposition>` — but this module
 * does not itself write or parse that grammar; it only names the marker so
 * this module's own tests key off one literal rather than a hand-typed
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

// ─── S4: Deferral Destination (spec-resume-coverage-floor-the-satisfaction-boundaries-a S4, Overview Hole 3) ───
//
// S1 (above) made a deferral carry a REASON. It did not make the reason
// carry a DESTINATION, so `deferred:out of scope for this session` closes
// an item and the deferred work enters no queue. Measured 2026-08-25 over
// this corpus's own 139 handoff docs (`extra.handoff.next_steps`): 696
// next-step items, 458 of them (65.8%) bare prose that parks nothing
// anywhere. The two constants below close that hole.

/**
 * Recognizes an issue reference inside a deferral reason (S4) — either a
 * bare `#<digits>` mention or a `/issues/<digits>` URL path segment (GitHub's
 * and most trackers' issue-URL shape). Matched ANYWHERE in the reason text,
 * not anchored, so `"...tracked, see issue #42"` still counts. Module-private
 * — only {@link hasDeferralDestination}'s combined predicate is exported,
 * since a caller composing the two patterns independently would be a second
 * implementation of "what counts as a destination" (SPEC-112 D7/D9's own
 * discipline: the grammar lives in exactly one place).
 */
const DEFERRAL_ISSUE_REFERENCE_PATTERN = /#\d+|\/issues\/\d+(?:[/?#]|$)/;

/**
 * Recognizes a corpus slug inside a deferral reason (S4) — one of the six
 * `DocRecord` type prefixes (`prd|spec|adr|plan|task|knowledge`) followed by
 * `-` and a lowercase kebab tail, the SAME `{type}-{kebab-title}` shape
 * `DocRecord.slug` uses everywhere else in this codebase. Matched as a
 * substring, not anchored, so `"...tracked in task-some-filed-thing"` still
 * counts. Module-private for the same reason
 * {@link DEFERRAL_ISSUE_REFERENCE_PATTERN} is.
 *
 * @invariant GRAMMAR ONLY (S4's recorded known false pass) — this pattern
 *   matches the SHAPE of a slug, never resolves it against the corpus, so a
 *   slug-shaped string naming no real document satisfies it. Resolution
 *   would give this pure module store IO and a network dependency it must
 *   not have (this module's own header: "no IO").
 */
const DEFERRAL_CORPUS_SLUG_PATTERN = /\b(?:prd|spec|adr|plan|task|knowledge)-[a-z0-9]+(?:-[a-z0-9]+)*/;

/**
 * S4's destination predicate — true iff `reason` (already S1-non-empty, per
 * the caller's own check) names WHERE the deferred work went: an issue
 * reference or a corpus slug. A reason alone is not a destination —
 * `deferred:out of scope for this session` satisfies S1 and fails this
 * predicate, which is exactly Hole 3's measured propagation vector (see this
 * section's own header comment for the 458/696 measurement).
 *
 * Exported so `packages/lore/src/adapters/cli/commands/handoff.ts` — the
 * SOLE parser of this grammar (D9) — composes from this export rather than
 * typing the grammar a second time (SPEC-112 D7/D9); that verb's own call
 * site is pinned to read literally `!hasDeferralDestination(`
 * (task-a-deferral-reason-with-no-destination-must-not-close-its's own
 * falsifier). Pure — no IO, no wall-clock reads, browser-safe (this module's
 * own header: no Node builtin in the default barrel — pure string/regex work
 * only here).
 *
 * @param reason - The trimmed text following `RESUME_DISPOSITION_DEFERRED_PREFIX`.
 * @returns `true` iff `reason` carries a recognized destination token.
 * @example
 * hasDeferralDestination("out of scope for this session"); // => false — reason, no destination
 * @example
 * hasDeferralDestination("out of scope, see issue #5"); // => true — issue reference
 * @example
 * hasDeferralDestination("tracked in task-some-filed-thing"); // => true — corpus slug
 */
export function hasDeferralDestination(reason: string): boolean {
  return DEFERRAL_ISSUE_REFERENCE_PATTERN.test(reason) || DEFERRAL_CORPUS_SLUG_PATTERN.test(reason);
}

/**
 * The stderr presentation prefix for S4's own refusal — "a deferral reason
 * naming no destination" — DISTINCT from S1's bare-deferral prefix
 * (`UNDISPOSITIONED_ITEM_STDERR_PREFIX`, local to `handoff.ts`, see that
 * constant's own doc) on purpose: "no reason given" (S1) and "a reason that
 * parks the work nowhere" (S4) are different operator mistakes with
 * different fixes, and this repo's own first corpus property forbids a
 * verdict that is not injective — a shared prefix would make the two
 * indistinguishable to a consumer parsing stderr.
 *
 * Exported (unlike the two prefixes it is distinct from, which stay local
 * presentation literals in `handoff.ts`) because the Scope section of
 * spec-resume-coverage-floor-the-satisfaction-boundaries-a S4 makes it
 * MANDATORY — the verb must compose the destination grammar AND this prefix
 * from `@lore/core` exports, never inline literals (SPEC-112 D7/D9).
 *
 * @invariant AC-RCS-4 front (b) asserts the stderr the verb ACTUALLY EMITS
 *   `startsWith` this constant AND that this constant is not byte-equal to
 *   the bare-deferral prefix — both conjuncts, since a constants-only
 *   comparison cannot catch a verb that mis-routes a destination failure
 *   through the OTHER prefix.
 */
export const RESUME_DISPOSITION_MISSING_DESTINATION_STDERR_PREFIX =
  "Deferral reason names no destination for resume ticket item: ";

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

// ─── Same-Session Authorship (task-verifying-a-handoff-you-just-authored-arms-the-coverage D1, D2) ───
//
// The coverage floor above (RESUME_COVERAGE_FLOOR et al.) is correct for a
// CONSUMED handoff — a genuinely different, later session catching up on
// someone else's (or its own past) ticket. Measured 2026-08-01: it also armed
// against the WRITING session, the moment that session ran `lore feed
// session-resume` purely to VERIFY the ticket it had just authored is
// consumable — charging the author with the very next-steps it was
// explicitly handing off. These two functions are the narrowing predicate
// `feed-flow.ts::buildResumeFeed` uses to withhold the floor for that one
// case, and ONLY that case.

/**
 * Filesystem-safe filename for one session's start-time marker
 * (task-verifying-a-handoff-you-just-authored-arms-the-coverage D1) —
 * written by the `assets/hooks/session-start-marker.mjs` SessionStart hook
 * (idempotent: first write for a given session id wins, never overwritten)
 * and read by `feed-flow.ts::buildResumeFeed` to learn when the
 * CURRENTLY-arming session began. Pure string transform — the marker's
 * actual location (`os.tmpdir()`) and all file IO are each caller's own job,
 * kept out of this browser-safe module.
 *
 * @invariant The hook script (a standalone installed `.mjs` file with no
 *   `@lore/core` import — every hook in this repo's registered set is
 *   self-contained, `packages/core/src/distribution-hooks.ts`'s own module
 *   doc) cannot import this function directly. Its own copy of the SAME
 *   one-line sanitizing transform is a DELIBERATE literal duplicate —
 *   mirrors the precedent `assets/hooks/session-start-resume.mjs` documents
 *   for `SETUP_CHECK_CACHE_FILENAME` ("that module owns the write side, this
 *   hook only ever reads it, and the two live in physically separate
 *   deployable artifacts with no shared import surface"). Reviewed together,
 *   never independently re-derived.
 * @param sessionId - Raw `CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID` env value.
 * @returns A bare filename (never a path) — non-`[A-Za-z0-9._-]` characters
 *   replaced with `-` so an unexpected session-id shape can never escape the
 *   intended directory or collide with an unrelated file.
 * @example
 * sessionStartMarkerFilename("3de02220-5d69-4b5a-ac23-d66e14c0261b");
 * // => "lore-session-start-3de02220-5d69-4b5a-ac23-d66e14c0261b.json"
 */
export function sessionStartMarkerFilename(sessionId: string): string {
  return `lore-session-start-${sessionId.replace(/[^A-Za-z0-9._-]/g, "-")}.json`;
}

/**
 * Answers whether `record` (a resolved resume-ticket handoff) was plausibly
 * authored DURING the currently-arming session
 * (task-verifying-a-handoff-you-just-authored-arms-the-coverage D1) — the
 * predicate `feed-flow.ts::buildResumeFeed` uses to decide whether to
 * withhold `RESUME_COVERAGE_FLOOR` from a rendered resume feed.
 *
 * TWO independently-required facts must both hold, or this returns `false`
 * (arm) — the ADR's own "Q1 Proxy" review rejected identity ALONE
 * (predicate (1)): a stable orchestrator actor persists across many
 * sessions, so matching on `by` alone would ALSO suppress arming for a
 * legitimate LATER session resuming its own past ticket.
 *   1. Identity — `record.by === currentActor`.
 *   2. Session boundary — `record.at >= sessionStartIso`: the handoff could
 *      only have been written AFTER the currently-arming session began. A
 *      genuinely EARLIER session's handoff necessarily predates its
 *      successor's own start marker, so this comparison alone tells the two
 *      apart WITHOUT any wall-clock "created recently" threshold (a
 *      threshold was explicitly rejected — a long session would eventually
 *      see its OWN just-written ticket age out of any fixed window and
 *      re-arm against itself, which is the exact false-obligation failure
 *      this predicate exists to close).
 *
 * @invariant Fail-safe (Q2 review): `sessionStartIso === undefined` (no
 *   marker could be read — missing `CLAUDE_CODE_SESSION_ID`, the hook never
 *   fired, or an unreadable/corrupt marker file) ALWAYS returns `false`
 *   (arm) — checked FIRST, before identity, so an unknown boundary can never
 *   be short-circuited into a match by an identity coincidence.
 * @invariant Lexicographic ISO-8601 string comparison (`>=`), the same
 *   convention {@link deriveLastActivityAt} already uses in this module —
 *   both timestamps are `Date.toISOString()` output, which compares
 *   correctly as plain strings without `Date` parsing.
 * @param record - `by` (author actor) and `at` (created_at, ISO 8601) from
 *   the resolved `ResumeHandoffRecord`.
 * @param currentActor - The CURRENT `lore feed session-resume` invocation's
 *   resolved actor identity.
 * @param sessionStartIso - The currently-arming session's start-marker
 *   timestamp (ISO 8601), or `undefined` when no session-start fact could be
 *   established.
 * @returns `true` only when both the identity and session-boundary facts hold.
 * @example
 * isSameSessionAuthorship(
 *   { by: "agent:main-orchestrator", at: "2026-08-01T10:05:00.000Z" },
 *   "agent:main-orchestrator",
 *   "2026-08-01T10:00:00.000Z", // this session started BEFORE the handoff was written
 * ); // => true — verifying my own just-authored ticket
 * @example
 * isSameSessionAuthorship(
 *   { by: "agent:main-orchestrator", at: "2026-07-30T10:05:00.000Z" },
 *   "agent:main-orchestrator",
 *   "2026-08-01T09:00:00.000Z", // this (new) session started AFTER the handoff was written
 * ); // => false — a genuinely earlier session's ticket; arms (CONTROL)
 * @example
 * isSameSessionAuthorship(
 *   { by: "agent:main-orchestrator", at: "2026-08-01T10:05:00.000Z" },
 *   "agent:main-orchestrator",
 *   undefined, // no session-start fact available
 * ); // => false — unknown boundary, fail-safe arms (Q2)
 */
export function isSameSessionAuthorship(
  record: { readonly by: string; readonly at: string },
  currentActor: string,
  sessionStartIso: string | undefined,
): boolean {
  if (sessionStartIso === undefined) return false;
  if (record.by !== currentActor) return false;
  return record.at >= sessionStartIso;
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
 * One unfinished claim recorded for the seat (a linked worktree) this session
 * sits in — structurally identical to {@link bootstrapMyClaimSchema} (the
 * full report's `my_claims` row) but a SEPARATE schema on purpose: `my_claims`
 * is keyed on the claiming ACTOR (a pre-run-identity key, structurally empty
 * at session start), `seat_claims` on the claim's recorded WORKTREE
 * (spec-session-start-injection-carries-only-the-session-s-own D1, D3).
 */
export const bootstrapSeatClaimSchema = z.object({
  task_slug: z.string(),
  plan_slug: z.string(),
  claimed_at: z.string(),
  stale: z.boolean(),
});

/** Derived TypeScript type for one seat claim. */
export type BootstrapSeatClaim = z.infer<typeof bootstrapSeatClaimSchema>;

/**
 * The projection's OWN Zod schema (spec-session-start-injection-carries-only-the-session-s-own
 * §Module Boundary) — deliberately NOT a patch on {@link bootstrapReportSchema}:
 * the injection carries ONLY the seat's own open items, never a corpus-global
 * field.
 *
 * @invariant `.strict()` — an unlisted key (`my_claims`, `pending_reviews`, a
 *   future report field) fails `.parse()` loudly instead of being stripped or
 *   auto-injected (D4: the SPEC-080 D8 append-unknown rule is REVERSED; adding
 *   an injected field is a deliberate spec decision that lands here AND in
 *   {@link BOOTSTRAP_INJECTED_KEYS}).
 * @invariant `scope_declaration` is REQUIRED and always first; `resume_hint`
 *   is present iff the seat's branch resolved to a plan AND that plan has a
 *   newest handoff; `budget_exceeded` is present-iff-true.
 */
export const bootstrapInjectionSchema = z
  .object({
    scope_declaration: z.string(),
    resume_hint: bootstrapResumeHintSchema.optional(),
    seat_claims: z.array(bootstrapSeatClaimSchema),
    /** Present (`true`) iff the compact payload still exceeds `charBudget`. Absent (never `false`) otherwise. */
    budget_exceeded: z.literal(true).optional(),
  })
  .strict();

/** Derived TypeScript type for the seat-only tier-1 injection payload. */
export type BootstrapInjection = z.infer<typeof bootstrapInjectionSchema>;

/**
 * Budget knob for {@link buildBootstrapInjection}. Plain interface, not
 * Zod-derived — assembled by a trusted caller (`resolveBootstrapInjectionBudgets`
 * in `config.ts`) and handed to a pure function. The retired count caps
 * (`maxActivePlans`/`maxHandoffs`/`maxPendingSlugs`) served fields that are no
 * longer injected and are gone from this shape.
 */
export interface BootstrapInjectionBudgets {
  /** Compact-serialized length ceiling; exceeding it SETS `budget_exceeded`, never slices. */
  charBudget: number;
}

/**
 * The seat signal {@link buildBootstrapInjection} consumes — assembled by the
 * CLI adapter, which holds every half of it: the `--seat-branch` /
 * `--seat-worktree` pair, whether `SessionService.bootstrap` resolved the
 * branch to a live plan (`planResolved`), and `SessionService.seatClaims`'s
 * result (`claims`). `null` at the call site means "main checkout".
 */
export interface BootstrapInjectionSeat {
  readonly branch: string;
  readonly worktree: string;
  /** `true` iff the seat's branch resolved to a live plan (`report.seat_unresolved !== true`). */
  readonly planResolved: boolean;
  /** The seat's unfinished claims (`SessionService.seatClaims`), verbatim. */
  readonly claims: readonly BootstrapSeatClaim[];
}

/** Input of {@link buildBootstrapInjection}. */
export interface BootstrapInjectionInput {
  readonly report: BootstrapReport;
  /** `null` ⇔ the session is in the main checkout (nothing is injected). */
  readonly seat: BootstrapInjectionSeat | null;
}

/** Return shape of {@link buildBootstrapInjection}. */
export interface BootstrapInjectionResult {
  /** `null` ⇔ there is nothing personal to inject. */
  readonly payload: BootstrapInjection | null;
  /** Compact (no-whitespace) JSON of `payload`; `""` ⇔ `payload === null`. */
  readonly json: string;
}

/**
 * Projects a full `BootstrapReport` plus the seat signal down to the small
 * payload the SessionStart hook injects — ONLY the seat's own open items
 * (spec-session-start-injection-carries-only-the-session-s-own D1). Pure — no
 * IO, no wall-clock reads, no randomness; the SOLE owner of injection
 * selection and the char-budget flag.
 *
 * Trigger predicate (the ONE place it is decided):
 * `seat !== null && (seat.claims.length > 0 || (seat.planResolved && report.resume_hint !== null))`.
 * Anything else returns `{payload: null, json: ""}` — a main-checkout session,
 * or a seat with neither an unfinished claim nor a resumable plan, is handed
 * nothing. A seat whose branch names no plan (e.g. a harness
 * `worktree-agent-*` branch) still gets its claims but never a resume pointer
 * (BR-326).
 *
 * Output key order: `scope_declaration`, [`resume_hint`], `seat_claims`,
 * [`budget_exceeded`]. `budget_exceeded: true` is set when the compact JSON
 * exceeds `budgets.charBudget`; the payload is then returned INTACT — nothing
 * is dropped or sliced (every field is already minimal, so there is nothing
 * droppable).
 *
 * @param input - The full report and the seat signal (`null` ⇔ main checkout).
 * @param budgets - `{charBudget}` (default 8000 via `resolveBootstrapInjectionBudgets`).
 * @returns `{payload, json}` — both empty/null when there is nothing to inject.
 * @example
 * buildBootstrapInjection({ report, seat: null }, { charBudget: 8000 });
 * // => { payload: null, json: "" }
 * @example
 * buildBootstrapInjection(
 *   { report, seat: { branch: "feat-x", worktree: "/w", planResolved: false, claims: [claim] } },
 *   { charBudget: 8000 },
 * );
 * // => payload keys: ["scope_declaration", "seat_claims"]
 */
export function buildBootstrapInjection(
  input: BootstrapInjectionInput,
  budgets: BootstrapInjectionBudgets,
): BootstrapInjectionResult {
  const { report, seat } = input;
  if (seat === null) return { payload: null, json: "" };

  const resumeHint = seat.planResolved ? report.resume_hint : null;
  if (seat.claims.length === 0 && resumeHint === null) return { payload: null, json: "" };

  const payload: BootstrapInjection = {
    scope_declaration: BOOTSTRAP_SCOPE_DECLARATION,
    ...(resumeHint === null ? {} : { resume_hint: resumeHint }),
    seat_claims: [...seat.claims],
  };

  const json = JSON.stringify(payload);
  if (json.length <= budgets.charBudget) return { payload, json };

  // reason: nothing is droppable — the char-budget rule forbids a mid-JSON
  // slice (SPEC-080 §Projection Contract, carried forward), so the payload is
  // returned intact and the anomaly is signaled instead of hidden.
  const flagged: BootstrapInjection = { ...payload, budget_exceeded: true };
  return { payload: flagged, json: JSON.stringify(flagged) };
}
