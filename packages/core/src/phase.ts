/**
 * Phase execution model — pure schemas + write-time invariants for the `phase`
 * doc type (SPEC-056). Pure, browser-safe module: no IO, no Date.now()/
 * Math.random() calls.
 *
 * Public surface:
 *   - PHASE_KINDS / PhaseKind — the descriptive taxonomy for `extra.kind` on a
 *     phase doc (mirrors `spec-kind.ts`'s SPEC_KINDS shape).
 *   - checklistItemSchema / ChecklistItem — one local oracle-bound gate item
 *     (`bind` is a `script | manual` discriminated union — SPEC-056 §Public
 *     Interface).
 *   - trackItemSchema / TrackItem — one informational work-log entry.
 *   - phaseExtraSchema / PhaseExtra — the full `extra` shape for a phase doc.
 *   - assertScopeFreeze(prev, next, evidence) — pure write-time invariant: a
 *     `plan.extra.ac_scope`-style AC-id array may never DROP an id that
 *     already has recorded evidence referencing it (SPEC-056 §Design
 *     Decisions D4).
 *   - acScopeArraySchema / MAX_AC_SCOPE_IDS — the `extra.ac_scope` array shape
 *     shared by the phase tier (here) and the task tier (`taskExtraSchema`,
 *     `schemas.ts`), where an EMPTY array is valid and distinct from absence.
 *   - extractDeclaredAcScope(doc) — tolerant reader keeping absent (`undefined`)
 *     distinguishable from explicitly-un-declared (`[]`).
 *   - computeAcScopeEdit(prev, op, ids, evidence) / AcScopeEditOp — the SINGLE
 *     `ac_scope` edit computation for BOTH doc tiers, and the one production
 *     call site of `assertScopeFreeze` (spec-declared-scope-attestation-
 *     contract-task-owned-ac-scope §Contract Details).
 *
 * Invariants:
 *   - No IO, no wall-clock reads — every caller supplies its own time/IDs.
 *   - `checklistItemSchema.checked` is manual-bind-only (enforced via
 *     superRefine) — a script-bound item's completion signal is `result`,
 *     never `checked`.
 *   - `checklistItemSchema.dropped`, when present, always carries
 *     `{by, at, reason}` — "required-on-drop" is enforced by the field's own
 *     object shape (all three sub-fields required, no partial drop record).
 *   - `checked` being VOIDED by a statement edit (SPEC-056 §Public Interface)
 *     is a WRITE-TIME service invariant, not a schema-level one — this schema
 *     only describes what a valid checklist item item looks like at rest;
 *     `PhaseChecklistService` (a later task in this plan) is the sole writer
 *     responsible for clearing `checked` when `statement` changes.
 *   - `assertScopeFreeze` compares AC ids by exact string equality only — no
 *     normalization. Any prev-id absent from `next` AND referenced by at
 *     least one `evidence[].ac_ref` blocks the edit; a purely additive edit
 *     (every prev id retained) is always allowed regardless of evidence.
 *
 * @invariant `phaseExtraSchema`/`checklistItemSchema`/`trackItemSchema` were
 *   ORIGINALLY defined here as standalone, PASSTHROUGH-shaped Zod schemas
 *   deliberately NOT wired into `schemas.ts` (T1's own declared anchors —
 *   `phase.ts` / `phase-completion.ts` / `schemas.ts` only — excluded
 *   `types.ts`/`doc-type-rules.ts`, so wiring then would have failed
 *   `bun run typecheck` at `corpus-service.ts`'s `DOC_TYPE_ROLE_MAP[data.type]`
 *   lookup). **UPDATE (SPEC-056 T4, PhaseWorkflowService rename task)**: the
 *   doc type is now REGISTERED — `types.ts` DocType gained `"phase"` (+
 *   `DOC_TYPE_ROLE_MAP.phase = "plan"`), `doc-type-rules.ts` gained
 *   `PARENT_TYPE_CONTRACT.phase = ["plan"]`, and `schemas.ts`'s
 *   `docTypeSchema`/`createDocInputSchema` superRefine now dispatch to
 *   `phaseExtraSchema` (mirroring the `task` branch: parent_id + extra.plan_id
 *   required). `CorpusService`/CLI/MCP still do NOT expose `lore create phase`
 *   — direct construction stays `store.insert(...)` (raw) until the CLI/MCP
 *   surfaces task in this same plan wires it; this update only makes the TYPE
 *   itself real (so services can compare `doc.type === "phase"` without a
 *   `TS2367` cast), not a new create-path.
 *
 * Side-effect class: pure
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Public Interface, §Design Decisions D1, D4, D6.
 */

import { z } from "zod";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import { SCRIPT_ORACLES } from "./acceptance.js";
import { evidenceEntrySchema, taskClaimSchema } from "./task-workflow.js";
import type { EvidenceEntry } from "./task-workflow.js";
import type { DocRecord } from "./types.js";

// ─── Phase Kind Taxonomy ────────────────────────────────────────────────────

/**
 * Descriptive taxonomy for `phase.extra.kind` — mirrors `spec-kind.ts`'s
 * `SPEC_KINDS` shape (a plain `as const` tuple, no cross-validation with any
 * other enum).
 */
export const PHASE_KINDS = ["backend", "frontend", "fullstack", "infra", "docs"] as const;

/** Derived TypeScript union for {@link PHASE_KINDS}. */
export type PhaseKind = (typeof PHASE_KINDS)[number];

// ─── Checklist Item Schema ──────────────────────────────────────────────────

/**
 * `checklistItemSchema.bind` — a checklist item is bound EITHER to a script
 * oracle (reuses {@link SCRIPT_ORACLES}, the same enum `acceptance.ts` uses
 * for script-mode acceptance criteria) OR to a manual self-attestation gate.
 * Compiler-enforced OCP: a future `browser` variant is one new discriminated
 * member, and every exhaustive `switch (item.bind.kind)` site breaks loud
 * (SPEC-056 §Public Interface).
 */
export const checklistItemBindSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("script"),
    oracle: z.enum(SCRIPT_ORACLES),
    command: z.string().min(1),
  }),
  z.object({ kind: z.literal("manual") }),
]);

/** Derived TypeScript union for {@link ChecklistItem.bind}. */
export type ChecklistItemBind = z.infer<typeof checklistItemBindSchema>;

/**
 * One local, oracle-bound checklist gate item on a phase doc.
 *
 * @invariant `result` is script-bound-only in practice (pre-joined by the
 *   caller from evidence, same division of labor `phase-completion.ts`'s
 *   `computePhaseCompletion` documents for `coverage`) — absent means "not
 *   yet run".
 * @invariant `checked` is manual-bind-only — a `script`-bound item carrying
 *   `checked` fails this schema's superRefine.
 * @invariant `dropped`, when present, always carries the full
 *   `{by, at, reason}` triple — required-on-drop, enforced by the field's own
 *   object shape (no partial drop record is representable).
 *
 * @example
 * checklistItemSchema.parse({
 *   id: "CHK-1",
 *   statement: "manual smoke test passes",
 *   bind: { kind: "manual" },
 *   checked: { by: "alice", at: "2026-07-19T10:00:00.000Z" },
 * });
 *
 * @example
 * checklistItemSchema.parse({
 *   id: "CHK-2",
 *   statement: "unit suite green",
 *   bind: { kind: "script", oracle: "test", command: "bun test" },
 *   result: "pass",
 * });
 */
export const checklistItemSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    bind: checklistItemBindSchema,
    /** Script-bound items only — pre-joined by the caller; absent = not yet run. */
    result: z.enum(["pass", "fail"]).optional(),
    /** Manual-bound items only — self-attestation marker (see superRefine below). */
    checked: z.object({ by: z.string().min(1), at: z.string() }).optional(),
    /** Either bind kind — required-on-drop (all three sub-fields mandatory). */
    dropped: z
      .object({ by: z.string().min(1), at: z.string(), reason: z.string().min(1) })
      .optional(),
  })
  .superRefine((data, ctx) => {
    // reason: `checked` is a manual-only self-attestation marker — a
    // script-bound item's completion signal is `result` (SPEC-056 §Public
    // Interface, "Manual checked:{by,at} voided by statement edit").
    if (data.checked !== undefined && data.bind.kind !== "manual") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checklist item 'checked' is manual-bind-only",
        path: ["checked"],
      });
    }
  });

/** Derived TypeScript type for one phase checklist item. */
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

// ─── Track Item Schema ──────────────────────────────────────────────────────

/**
 * One informational work-log entry on a phase doc's `extra.track` array.
 * Deliberately distinct from `verification_evidence` (append-only, oracle-
 * attested) — track entries are mutable, human-authored notes with no oracle
 * binding (SPEC-056 §Perspective Tensions Resolved: "folding poisons the P2
 * trust boundary").
 *
 * @example
 * trackItemSchema.parse({
 *   id: "TRK-1",
 *   note: "displaced claim from task-migration; original holder notified",
 *   by: "alice",
 *   at: "2026-07-19T10:00:00.000Z",
 * });
 */
export const trackItemSchema = z.object({
  id: z.string().min(1),
  note: z.string().min(1),
  by: z.string().min(1),
  at: z.string(),
});

/** Derived TypeScript type for one phase track entry. */
export type TrackItem = z.infer<typeof trackItemSchema>;

// ─── Declared AC Scope (shared task + phase tier) ───────────────────────────

/**
 * Upper bound on a declared `ac_scope` array, for BOTH the task and phase
 * tiers. Derived from `specAcceptanceCriteriaSchema`'s own `.max(50)`
 * (`acceptance.ts`): a scope is a SUBSET of one spec's declared criteria, so it
 * can never legitimately exceed the number of criteria that spec may declare.
 * Bounded-growth defense, same rationale as `phaseExtraSchema.checklist`'s 100
 * and `taskExtraSchema.verification_evidence`'s 50.
 */
export const MAX_AC_SCOPE_IDS = 50;

/**
 * The `extra.ac_scope` array shape shared by `phaseExtraSchema` (here) and
 * `taskExtraSchema` (`schemas.ts`, which imports this) — the declared subset of
 * the governing spec's AC ids a task/phase claims.
 *
 * @invariant An EMPTY array is VALID and semantically distinct from an absent
 *   field: absent means nobody ever declared a scope, empty means an author
 *   declared that this doc claims nothing. This is why it is NOT
 *   `planAcScopeSchema` (`schemas.ts`), whose `.min(1)` forbids empty — the
 *   plan tier has no un-declaration verb, the task/phase tier does
 *   (`lore scope rm` of the final id, spec-declared-scope-attestation-contract-
 *   task-owned-ac-scope §Contract Details).
 * @invariant Ids are stored VERBATIM — no trimming, no case folding, no
 *   AC-id-format regex. `assertScopeFreeze` and every downstream
 *   intersection compare by exact string equality, so normalising here would
 *   silently change which stored ids an evidence `ac_ref` matches. Only the
 *   empty string is rejected (a shape error, not a normalisation).
 * @invariant Cross-entity membership (every id actually declared on the
 *   governing spec) is deliberately NOT checked here or at the writer — the
 *   refusal belongs to the READ side (`lore verify`'s declared-scope
 *   intersection), which is where an id that names nothing is actionable.
 */
export const acScopeArraySchema = z.array(z.string().min(1)).max(MAX_AC_SCOPE_IDS);

// ─── Phase Extra Schema ─────────────────────────────────────────────────────

/**
 * `phase.extra` — the full extra-field shape for a `phase` doc (SPEC-056).
 * Mirrors `taskExtraSchema` (`schemas.ts`) for the claim/evidence/anchor
 * fields it absorbs (SPEC-025/042 mechanics), and `planExtraSchema`'s
 * `ac_scope` shape for the contract projection.
 *
 * @invariant `plan_id` is required, mirroring `taskExtraSchema.plan_id` — a
 *   phase's parent is always a plan (SPEC-056 §Design Decisions D1).
 * @invariant `checklist`/`track` are capped defensively (100/200 entries) —
 *   same bounded-growth rationale as `taskExtraSchema.verification_evidence`'s
 *   50-entry cap.
 * @invariant `migrated_from`/`migrated_to`/`legacy_phase` are populated ONLY
 *   by `PhaseMigrationService`'s one-shot sweep (SPEC-056 §Design Decisions
 *   D6) — never authored directly by a CLI/MCP write path.
 * @invariant This schema is NOT yet wired into `schemas.ts`'s
 *   `createDocInputSchema` dispatch — see this module's header invariant for
 *   why (typecheck blast radius outside this task's anchors).
 *
 * Source: SPEC-056 §Design Decisions D1, D6; §Public Interface
 */
export const phaseExtraSchema = z
  .object({
    plan_id: z.string().min(1),
    /** Descriptive taxonomy — see {@link PHASE_KINDS}. */
    kind: z.enum(PHASE_KINDS).optional(),
    assignee: z.string().optional(),
    /**
     * Contract projection — the subset of the parent spec's AC ids this phase
     * claims. See {@link acScopeArraySchema} (shared with `taskExtraSchema`)
     * for why an EMPTY array is valid and distinct from absence.
     */
    ac_scope: acScopeArraySchema.optional(),
    /** Local oracle-bound gate items. */
    checklist: z.array(checklistItemSchema).max(100).optional(),
    /** Informational work log — mutable, non-attested (see {@link trackItemSchema}). */
    track: z.array(trackItemSchema).max(200).optional(),
    /** Advisory execution lease — same shape/ownership as `taskExtraSchema.claim`. */
    claim: taskClaimSchema.optional(),
    /** Append-only oracle verification log — same shape/ownership as `taskExtraSchema.verification_evidence`. */
    verification_evidence: z.array(evidenceEntrySchema).max(50).optional(),
    /** Declared file/directory scopes — same shape/ownership as `taskExtraSchema.file_anchors`. */
    file_anchors: z.array(z.string()).optional(),
    /** Migration provenance (SPEC-056 D6) — the source task ids this phase was merged from. */
    migrated_from: z.array(z.string().min(1)).optional(),
    /** Migration provenance (SPEC-056 D6) — set on the SOURCE task doc, naming the phase it merged into. */
    migrated_to: z.string().min(1).optional(),
    /** Migration provenance (SPEC-056 D6) — the plan's former singular `extra.phase` grouping fallback. */
    legacy_phase: z.string().optional(),
  })
  .passthrough();

/** Derived TypeScript type for a phase doc's `extra` field. */
export type PhaseExtra = z.infer<typeof phaseExtraSchema>;

// ─── Scope Freeze Invariant (SPEC-056 §Design Decisions D4) ────────────────

/**
 * Write-time invariant guarding a phase's `ac_scope` array: an AC id that
 * already has recorded evidence referencing it (`evidence[].ac_ref`) may
 * never be removed from the scope — doing so would silently discard the
 * contract projection an oracle run has already attested against.
 *
 * A purely additive edit (every id in `prev` retained in `next`, zero or
 * more new ids appended) is always allowed, regardless of evidence. Removing
 * an id with NO evidence referencing it is also allowed — this invariant
 * guards evidenced ids specifically, never "any shrink" (SPEC-056 §Public
 * Interface CONTRACT NOTE).
 *
 * @invariant Compares ids by exact string equality — no normalization.
 * @invariant `evidence` entries with no `ac_ref` at all never block any
 *   removal (only entries whose `ac_ref` matches a removed id count).
 * @invariant A REPLACE (simultaneous remove-and-add) that removes an
 *   evidenced id is still blocked — the addition never offsets the removal.
 *
 * @param prev - The phase's current `ac_scope` array.
 * @param next - The proposed new `ac_scope` array.
 * @param evidence - The phase's recorded `verification_evidence` entries.
 * @returns `ok(undefined)` when the edit is allowed; `err(VALIDATION_ERROR)`
 *   naming the blocked id(s) otherwise.
 *
 * @example
 * assertScopeFreeze(["AC-1", "AC-2"], ["AC-2"], [evidenceFor("AC-1")]);
 * // => err({ code: "VALIDATION_ERROR", ... }) — AC-1 has evidence, cannot be dropped
 *
 * @example
 * assertScopeFreeze(["AC-1", "AC-2"], ["AC-1", "AC-2", "AC-3"], [evidenceFor("AC-1")]);
 * // => ok(undefined) — purely additive, nothing removed
 */
export function assertScopeFreeze(
  prev: string[],
  next: string[],
  evidence: EvidenceEntry[],
): Result<void, LoreError> {
  const nextSet = new Set(next);
  const evidencedIds = new Set(
    evidence
      .map((entry) => entry.ac_ref)
      .filter((ref): ref is string => ref !== undefined),
  );

  const removedEvidenced = prev.filter(
    (id) => !nextSet.has(id) && evidencedIds.has(id),
  );

  if (removedEvidenced.length > 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "ac_scope",
      message: `cannot remove ac_scope id(s) with recorded evidence: ${removedEvidenced.join(", ")}`,
      value: removedEvidenced,
    });
  }

  return ok(undefined);
}

// ─── Declared-Scope Edit (the single ac_scope mutation site, both tiers) ─────

/**
 * Reads a task's or phase's DECLARED `ac_scope`, preserving the
 * absent-vs-empty distinction the contract rests on.
 *
 * `extra` is untyped storage, so a malformed value degrades to `undefined`
 * ("nobody declared a readable scope") rather than throwing — the same
 * extract-and-tolerate shape as `extractEvidence`/`extractClaim`
 * (`task-workflow.ts`) and `extractFileAnchors` (`file-anchors.ts`). It lives
 * HERE, beside {@link assertScopeFreeze} and {@link acScopeArraySchema},
 * because the whole scope contract — shape, invariant, reader — is one unit
 * serving both doc tiers.
 *
 * @param doc - a `task` or `phase` DocRecord
 * @returns the declared ids; `[]` when an author explicitly un-declared the
 *   scope; `undefined` when the field is absent or unreadable
 *
 * @example
 * extractDeclaredAcScope(taskWithNoScope);      // => undefined
 * extractDeclaredAcScope(taskWithEmptyScope);   // => []
 * extractDeclaredAcScope(taskScopingTwoIds);    // => ["AC-1", "AC-2"]
 */
export function extractDeclaredAcScope(doc: DocRecord): string[] | undefined {
  const raw = doc.extra["ac_scope"];
  if (raw === undefined) return undefined;
  const parsed = acScopeArraySchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** The two incremental `lore scope` mutations — read-merge-write, never replace. */
export type AcScopeEditOp = "add" | "rm";

/**
 * Set UNION preserving `prev`'s order: appends each `id` exactly once, skipping
 * ids `prev` already holds AND repeats within `ids` itself. Kept separate from
 * {@link computeAcScopeEdit} so the "union" and "difference" halves read
 * symmetrically at the one call site.
 */
function appendNewIds(prev: string[], ids: string[]): string[] {
  const seen = new Set(prev);
  const next = [...prev];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

/** Set DIFFERENCE preserving `prev`'s order. An id absent from `prev` is simply not there to remove. */
function removeIds(prev: string[], ids: string[]): string[] {
  const removing = new Set(ids);
  return prev.filter((id) => !removing.has(id));
}

/**
 * Computes the new `ac_scope` array for one incremental edit and enforces every
 * invariant that guards it. This is the SINGLE place an `ac_scope` array is
 * edited — `TaskWorkflowService.addAcScope`/`removeAcScope` and
 * `PhaseWorkflowService.addAcScope`/`removeAcScope` both delegate here, so the
 * two tiers cannot drift (spec-declared-scope-attestation-contract-task-owned-
 * ac-scope §Contract Details: "`assertScopeFreeze` is wired HERE — it is the
 * single place a scope array is edited, for tasks and phases alike").
 *
 * @invariant `add` is a set UNION that PRESERVES existing order and appends
 *   only genuinely-new ids — re-adding a declared id is a no-op, never a
 *   duplicate.
 * @invariant `rm` yields an EMPTY array when the last id is removed, never an
 *   absent field. Callers must write `[]` through verbatim.
 * @invariant {@link assertScopeFreeze} runs on BOTH ops, not just `rm` — one
 *   unconditional call site is what makes "no evidenced id can be dropped"
 *   checkable by grep rather than by trusting each verb. (An `add` can never
 *   trip it: a union removes nothing.)
 * @invariant An empty `ids` argument is a LOUD error, not a silent no-op write
 *   — a caller that computed an empty candidate list has a bug, and a
 *   version-bumping write that changes nothing would hide it.
 *
 * @param prev - the doc's current declared ids (`[]` for an absent scope —
 *   {@link extractDeclaredAcScope}`(doc) ?? []`)
 * @param op - `"add"` (union) or `"rm"` (difference)
 * @param ids - the candidate ids to add/remove, verbatim from the caller
 * @param evidence - the doc's recorded `verification_evidence` entries, read
 *   via `extractEvidence` — supplies the `ac_ref`s the freeze invariant guards
 * @returns the array to store, or `err(VALIDATION_ERROR)` naming `ac_scope`
 *
 * @example
 * computeAcScopeEdit(["AC-1"], "add", ["AC-1", "AC-2"], []); // => ok(["AC-1", "AC-2"])
 * computeAcScopeEdit(["AC-1"], "rm", ["AC-1"], []);          // => ok([])
 * computeAcScopeEdit(["AC-1"], "rm", ["AC-1"], [evidenceFor("AC-1")]); // => err(...)
 */
export function computeAcScopeEdit(
  prev: string[],
  op: AcScopeEditOp,
  ids: string[],
  evidence: EvidenceEntry[],
): Result<string[], LoreError> {
  if (ids.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "ac_scope",
      message: `no ac_scope id supplied to ${op} — name at least one acceptance-criterion id`,
      value: ids,
    });
  }

  const malformed = ids.filter((id) => id.trim() === "");
  if (malformed.length > 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "ac_scope",
      message: `ac_scope id must be a non-empty string — received ${malformed.length} blank id(s)`,
      value: ids,
    });
  }

  const next = op === "add" ? appendNewIds(prev, ids) : removeIds(prev, ids);

  const shapeResult = acScopeArraySchema.safeParse(next);
  if (!shapeResult.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "ac_scope",
      message: `ac_scope would hold ${next.length} ids, exceeding the ${MAX_AC_SCOPE_IDS}-id cap (a scope is a subset of one spec's declared criteria)`,
      value: next.length,
    });
  }

  const freezeResult = assertScopeFreeze(prev, next, evidence);
  if (!freezeResult.ok) return freezeResult;

  return ok(next);
}
