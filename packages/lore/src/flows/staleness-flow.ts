/**
 * Staleness-probe surface-neutral orchestration flow (SPEC-044 §Design Decisions D6, D9,
 * D11, D14). CLI (`lore review --staleness`) calls
 * these functions instead of re-implementing the fresh-escalate query or the
 * `lore invalidate` repair-command rendering. Mirrors `calibration-hook.ts`'s shape: a
 * NARROW injected dependency bundle (`StalenessFlowDeps`), never the full `App` — `App`
 * (`app.ts`) top-level-imports `bun:sqlite`, and this module must stay resolvable by
 * vitest (its own test file, `staleness-escalation.test.ts`/`staleness-visibility.test.ts`,
 * lives under `tests/unit/service/`, not a `.bun.test.ts`) — a narrow bundle keeps it
 * testable with plain fakes, no real store, no bun:sqlite pull-in, mirroring
 * `calibration-hook.ts`'s documented precedent (`packages/lore/src/adapters/cli/CLAUDE.md`).
 *
 * Public surface:
 *   listFreshStalenessEscalates(deps) — the SINGLE derivation site for "which
 *     knowledge/adr docs currently have a fresh (doc_version-matching) stale_candidate
 *     escalate as their latest kind='staleness' judgment" — consumed by `--list`,
 *     `lore status`'s open_stale_candidates count, and `lore bootstrap`'s corpus summary
 *     (D14 — one derivation site, no second query re-implementing this filter).
 *   renderStalenessRepairCommand(deps, doc, judgment) — D6's `lore invalidate <slug>
 *     --reason "..."` (+ `--superseded-by <ref>` when it resolves) for one escalate result.
 *   renderSupersededCandidateNudge(deps, judgedDocSlug, supersededCandidate) — D11's
 *     `lore invalidate <old> --superseded-by <X>` byproduct nudge on a REGULAR review
 *     judgment (note-not-command when `<old>` doesn't resolve).
 *
 * @invariant Both render* functions NEVER print a broken `lore invalidate` command
 *   naming an unresolvable ref — D6 omits `--superseded-by` and adds a note instead
 *   (the base command, naming the ALWAYS-valid probed doc, still renders); D11 degrades
 *   the WHOLE nudge to a note (its unresolvable ref IS the primary invalidation target,
 *   unlike D6's always-valid probed-doc target) — never a broken command in either case.
 * @invariant `listFreshStalenessEscalates`'s freshness check is purely version-based
 *   (`judgment.doc_version === doc.version`), no wall-clock read — an edit OR an
 *   invalidation (both bump `doc.version`: `CorpusService.set` / `ValidityService.invalidate`)
 *   naturally drops a doc off this list without any time-based logic here.
 *
 * Side-effect class: IO (delegates entirely to the injected `StalenessFlowDeps`)
 * Source: SPEC-044 §Design Decisions D6, D9, D11, D14
 */

import { clipTextToBudget, ok } from "@lore/core";
import type { DocId, DocRecord, DocType, LoreError, Result, ReviewJudgment, SupersededCandidate } from "@lore/core";
import type { App } from "../app.js";

/**
 * Narrow injected dependency bundle — mirrors `calibration-hook.ts`'s `CalibrationHookDeps`
 * (never the full `App`; see module header). Every public function in this module takes
 * `StalenessFlowDeps` directly, so a test can construct one from plain fakes with no real
 * store — {@link buildStalenessFlowDeps} is a convenience binder for real callers only.
 */
export interface StalenessFlowDeps {
  /** Bind to `(type) => app.corpusService.listFull({type}).then(r => r.ok ? ok(r.value.docs) : r)`. */
  listByType: (type: DocType) => Promise<Result<DocRecord[], LoreError>>;
  /** Bind to `(docId) => app.judgmentService.latestFor(docId, "staleness")`. */
  latestStalenessJudgment: (docId: DocId) => Promise<Result<ReviewJudgment | null, LoreError>>;
  /** Bind to `(idOrSlug) => app.corpusService.get(idOrSlug).then(r => r.ok ? ok({slug: r.value.doc.slug}) : r)`. */
  resolveSlug: (idOrSlug: string) => Promise<Result<{ slug: string }, LoreError>>;
}

/**
 * Convenience binder — builds a {@link StalenessFlowDeps} bundle from a wired `App`, the
 * ONE definition site every adapter (CLI `review`/`status`/`bootstrap`) calls instead of each
 * re-implementing the same three-line adaptation. `import type { App }` is erased at
 * compile time (proven vitest-safe by the pre-existing `routes.ts` → this pattern —
 * `routes.test.ts` is a vitest suite that already transitively resolves an `import type
 * { App } from "../app.js"` inside `validity-state.ts` without ever touching
 * `bun:sqlite`), so this export does not compromise this module's own vitest-testability.
 *
 * @param app - A wired `App` instance (CLI adapter only)
 * @example
 * const deps = buildStalenessFlowDeps(app);
 * const result = await listFreshStalenessEscalates(deps);
 */
export function buildStalenessFlowDeps(app: App): StalenessFlowDeps {
  return {
    listByType: (type) => app.corpusService.listFull({ type }).then((r) => (r.ok ? ok(r.value.docs) : r)),
    latestStalenessJudgment: (docId) => app.judgmentService.latestFor(docId, "staleness"),
    resolveSlug: (idOrSlug) => app.corpusService.get(idOrSlug).then((r) => (r.ok ? ok({ slug: r.value.doc.slug }) : r)),
  };
}

/** Doc types eligible for staleness probing (D1) — mirrors `@lore/core`'s internal set. */
const STALENESS_ELIGIBLE_TYPES: readonly DocType[] = ["knowledge", "adr"];

/** One doc whose latest `kind="staleness"` judgment is a fresh (non-stale) escalate. */
export interface StalenessEscalateEntry {
  doc: DocRecord;
  judgment: ReviewJudgment;
}

/**
 * The single derivation site for "which docs currently have an OPEN stale-candidate
 * flag" (D14). A doc qualifies iff its latest `kind="staleness"` judgment (if any) has
 * `decision === "escalate"` AND that judgment's `doc_version` matches the doc's CURRENT
 * version — freshness, exactly `lore pending`'s `isFreshEscalation` precedent applied to
 * the staleness judgment kind.
 *
 * @param deps - See {@link StalenessFlowDeps}
 * @returns Result<StalenessEscalateEntry[], LoreError> — `[]` when nothing qualifies
 * @example
 * const result = await listFreshStalenessEscalates(deps);
 * if (result.ok) console.log(`${result.value.length} open stale candidate(s)`);
 */
export async function listFreshStalenessEscalates(
  deps: StalenessFlowDeps,
): Promise<Result<StalenessEscalateEntry[], LoreError>> {
  const entries: StalenessEscalateEntry[] = [];
  for (const type of STALENESS_ELIGIBLE_TYPES) {
    const listResult = await deps.listByType(type);
    if (!listResult.ok) return listResult;
    for (const doc of listResult.value) {
      const judgmentResult = await deps.latestStalenessJudgment(doc.id);
      if (!judgmentResult.ok) return judgmentResult;
      const judgment = judgmentResult.value;
      if (judgment === null) continue;
      if (judgment.decision !== "escalate") continue;
      if (judgment.doc_version !== doc.version) continue;
      entries.push({ doc, judgment });
    }
  }
  return ok(entries);
}

/** Resolves an id-or-slug ref to its current slug, or `undefined` when it does not resolve. */
async function resolveRefToSlug(deps: StalenessFlowDeps, ref: string): Promise<string | undefined> {
  const result = await deps.resolveSlug(ref);
  return result.ok ? result.value.slug : undefined;
}

/** Result of {@link renderStalenessRepairCommand} — `command` is ALWAYS present (D6). */
export interface StalenessRepairRendering {
  command: string;
  /** Present iff the judge nominated a `superseded_candidate.ref` that did NOT resolve. */
  unresolvedNote?: string;
}

/** Character budget for the `--reason` value embedded in the D6 repair command. */
const REPAIR_REASON_MAX_CHARS = 100;

/**
 * D6 — the literal `lore invalidate` repair command for one fresh `stale_candidate`
 * escalate result. The PRIMARY target is always the probed document itself (its own
 * `doc.slug` — always a valid, already-resolved reference), so the base command is
 * ALWAYS rendered; `--superseded-by <ref>` is appended only when the judge's
 * `superseded_candidate.ref` resolves in the corpus, else an `unresolvedNote` is
 * returned alongside the (still-valid) base command — never a broken command.
 *
 * @param deps - See {@link StalenessFlowDeps}
 * @param doc - The probed document (`{slug}` suffices)
 * @param judgment - The persisted staleness judgment (`decision === "escalate"`)
 * @example
 * const rendering = await renderStalenessRepairCommand(deps, doc, judgment);
 * // { command: 'lore invalidate knowledge-old-fact --reason "no longer accurate"' }
 * // or, with a resolved successor:
 * // { command: '... --superseded-by knowledge-new-fact' }
 */
export async function renderStalenessRepairCommand(
  deps: StalenessFlowDeps,
  doc: { slug: string },
  judgment: ReviewJudgment,
): Promise<StalenessRepairRendering> {
  const firstReason = judgment.reasons[0]?.finding ?? "flagged stale by an AI staleness probe";
  const reason = clipTextToBudget(firstReason, REPAIR_REASON_MAX_CHARS);
  const command = `lore invalidate ${doc.slug} --reason "${reason}"`;

  const ref = judgment.superseded_candidate?.ref;
  if (ref === undefined) return { command };

  const resolvedSlug = await resolveRefToSlug(deps, ref);
  if (resolvedSlug === undefined) {
    return {
      command,
      unresolvedNote:
        `AI probe nominated "${ref}" as this document's replacement, but it could not be ` +
        `resolved in the corpus — no --superseded-by was appended.`,
    };
  }
  return { command: `${command} --superseded-by ${resolvedSlug}` };
}

/**
 * Result of {@link renderSupersededCandidateNudge} — a discriminated union (unlike D6's
 * always-a-command shape) because D11's `ref` IS the primary invalidation target: an
 * unresolvable ref means there is nothing valid to build a command around at all.
 */
export type SupersededCandidateNudge =
  | { resolved: true; command: string }
  | { resolved: false; note: string };

/**
 * D11 — the invalidate nudge byproduct on a REGULAR (non-staleness) review judgment: when
 * the SPEC-034 judge, while judging `judgedDocSlug`, believes it supersedes an older
 * document (`supersededCandidate.ref`), render `lore invalidate <old> --superseded-by
 * <judgedDocSlug>`. `ref` is the primary target here (opposite direction from D6) — an
 * unresolvable ref degrades the WHOLE nudge to a plain note, never a broken command
 * naming a document that doesn't exist.
 *
 * @param deps - See {@link StalenessFlowDeps}
 * @param judgedDocSlug - Slug of the document under review (the believed successor)
 * @param supersededCandidate - `judgment.superseded_candidate` (`{ref, reason}`)
 * @example
 * const nudge = await renderSupersededCandidateNudge(deps, "adr-new-decision", { ref: "adr-old-decision", reason: "..." });
 * // { resolved: true, command: "lore invalidate adr-old-decision --superseded-by adr-new-decision" }
 */
export async function renderSupersededCandidateNudge(
  deps: StalenessFlowDeps,
  judgedDocSlug: string,
  supersededCandidate: SupersededCandidate,
): Promise<SupersededCandidateNudge> {
  const resolvedSlug = await resolveRefToSlug(deps, supersededCandidate.ref);
  if (resolvedSlug === undefined) {
    return {
      resolved: false,
      note:
        `AI review nominated "${supersededCandidate.ref}" as superseded by this document, ` +
        `but it could not be resolved in the corpus.`,
    };
  }
  return { resolved: true, command: `lore invalidate ${resolvedSlug} --superseded-by ${judgedDocSlug}` };
}

// ─── D9 — Shared `--json` Probe Payload Construction ────────────────────────
//
// Lives here (not duplicated per caller) so
// AC-SP-7's "payload deep-equals CLI --json" oracle is trivially true BY CONSTRUCTION —
// both callers invoke the exact same function, never two independently-maintained
// JSON-shaping implementations that could silently drift apart.

/**
 * Structural shape of one `StalenessProbeOutcome` (mirrors
 * `service/staleness-probe-service.ts`'s exported type — re-declared narrowly here so
 * this module never imports a concrete service class, only the data shape it needs).
 */
export interface StalenessProbeOutcomeLike {
  doc: { id: string; slug: string };
  candidate: { priority: number; in_degree: number; age_days: number };
  result: { ok: true; judgment: ReviewJudgment } | { ok: false; error: LoreError };
}

/** One `--json` `probes[]` entry (D9's payload shape) built from a probe outcome. */
export async function buildStalenessProbeJsonEntry(
  deps: StalenessFlowDeps,
  outcome: StalenessProbeOutcomeLike,
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    doc: { id: outcome.doc.id, slug: outcome.doc.slug },
    priority: outcome.candidate.priority,
    in_degree: outcome.candidate.in_degree,
    age_days: outcome.candidate.age_days,
  };

  if (!outcome.result.ok) {
    return { ...base, error: outcome.result.error };
  }

  const judgment = outcome.result.judgment;
  const entry: Record<string, unknown> = {
    ...base,
    decision: judgment.decision,
    confidence: judgment.confidence,
    reasons: judgment.reasons.map((r) => r.finding),
    blocking_questions: judgment.blocking_questions,
  };

  if (judgment.decision === "escalate") {
    const repair = await renderStalenessRepairCommand(deps, { slug: outcome.doc.slug }, judgment);
    entry["repair_command"] = repair.command;
    if (repair.unresolvedNote !== undefined) entry["unresolved_supersede_note"] = repair.unresolvedNote;
  }

  return entry;
}

/** Structural shape of a `StalenessBatchResult` (mirrors `staleness-probe-service.ts`'s export). */
export interface StalenessBatchResultLike {
  probes: StalenessProbeOutcomeLike[];
  total_candidates: number;
  excluded_by_limit: number;
  skipped: { invalidated: number; too_young: number };
}

/** Full `--json` payload shape for both batch and single-doc staleness probe results. */
export interface StalenessProbeJsonPayload {
  probes: Record<string, unknown>[];
  skipped: { invalidated: number; too_young: number };
  total_candidates: number;
  excluded_by_limit: number;
}

/**
 * The FULL `--json` batch payload (D9): `{probes, skipped, total_candidates,
 * excluded_by_limit}` — the SAME shape `lore review --staleness --json` prints under
 * `data` and `lore_staleness_probe` returns verbatim (AC-SP-7).
 */
export async function buildStalenessBatchJsonPayload(
  deps: StalenessFlowDeps,
  batch: StalenessBatchResultLike,
): Promise<StalenessProbeJsonPayload> {
  const probes = await Promise.all(batch.probes.map((o) => buildStalenessProbeJsonEntry(deps, o)));
  return {
    probes,
    skipped: batch.skipped,
    total_candidates: batch.total_candidates,
    excluded_by_limit: batch.excluded_by_limit,
  };
}

/**
 * The single-doc probe `--json` payload — the SAME `{probes, skipped,
 * total_candidates, excluded_by_limit}` shape as the batch payload, just always exactly
 * one `probes[]` entry (`skipped` all-zero, `total_candidates`/`excluded_by_limit` fixed
 * at `1`/`0`) — a single-doc probe bypasses the selection/limit machinery entirely, so
 * there is nothing to count there. One shape for both modes keeps CLI `lore review <doc>
 * --staleness --json` byte-identical across modes
 * (AC-SP-7), never two independently-authored envelopes.
 */
export async function buildStalenessSingleJsonPayload(
  deps: StalenessFlowDeps,
  outcome: StalenessProbeOutcomeLike,
): Promise<StalenessProbeJsonPayload> {
  const entry = await buildStalenessProbeJsonEntry(deps, outcome);
  return {
    probes: [entry],
    skipped: { invalidated: 0, too_young: 0 },
    total_candidates: 1,
    excluded_by_limit: 0,
  };
}

/** `--list` payload shape — a pure read, structurally distinct from the probe shapes above (no candidate/limit machinery ran). */
export interface StalenessListJsonPayload {
  docs: Array<{ id: string; slug: string; title: string; confidence: number; blocking_questions: string[] }>;
  total: number;
}

/**
 * The `--list` payload — `{docs, total}` — built directly from
 * {@link listFreshStalenessEscalates}'s result, the shape CLI `--list --json`
 * returns verbatim (AC-SP-7).
 */
export function buildStalenessListJsonPayload(entries: StalenessEscalateEntry[]): StalenessListJsonPayload {
  return {
    docs: entries.map((e) => ({
      id: e.doc.id,
      slug: e.doc.slug,
      title: e.doc.title,
      confidence: e.judgment.confidence,
      blocking_questions: e.judgment.blocking_questions,
    })),
    total: entries.length,
  };
}
