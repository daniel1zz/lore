/**
 * Gate checkpoint registry (IoC vertical-slice tech-spec §5.1) — the pure decision
 * layer `lore gate` dispatches through. Each `CheckpointDef` bundles one checkpoint's
 * deterministic predicate checks (`check`) and its failure feeding-pack renderer
 * (`feed`) behind a single lookup key (`GateCheckpoint`), so the CLI adapter
 * (`../adapters/cli/commands/gate.ts`) no longer inlines the decision logic per
 * subcommand — it builds a `GateContext` from whatever store/IO reads it needs, then
 * dispatches through `checkpointRegistry`.
 *
 * This module lifts `spec-create` and `spec-promote`'s decision logic UNCHANGED out of
 * `gate.ts`'s former inline `runSpecCreateGate` / `runSpecPromoteGate` bodies — same
 * predicates (`gate-predicates.ts`), same feeding-pack assembly (`gate-feeding.ts`),
 * same aggregate "any failure blocks" rule, same predicate ORDER (so `missing` reason
 * lists render identically). `plan-promote` and `task-claim` are the two "commit-time
 * cross-tier gates" this module adds on top of that: both gate a downstream doc
 * (a plan being promoted / a task being claimed) against its ancestor spec's
 * approval + AC status, reusing `upstreamApproved` / `upstreamHasAcceptanceCriteria`
 * from `gate-predicates.ts` unchanged.
 *
 * @invariant Every `check` and `feed` function reachable through `checkpointRegistry`
 *   is a PURE function of its `GateContext` argument — no store, no IO, no
 *   `bun:sqlite`, no randomness, no wall-clock reads. Same `GateContext` in ⇒ same
 *   result out, always. All store/IO (resolving a parent doc, reading a rule doc's
 *   markdown, counting a spec's declared acceptance criteria, walking a plan/task's
 *   ancestor-spec chain via `CorpusService.getPlanBundle`) stays in `gate.ts` — this
 *   module only consumes data the adapter already fetched.
 * @invariant `checkpointRegistry` now covers all four `GateCheckpoint` members. It
 *   remains typed `Partial<Record<...>>` (not `Record<...>`) so a FUTURE checkpoint
 *   addition doesn't have to touch this type — callers still SHOULD branch on
 *   `checkpointRegistry[cp] !== undefined` (or use `requireCheckpoint`-style lookups
 *   only where compile-time-known to already be populated) rather than assuming the
 *   partiality can never return.
 * @invariant `plan-promote` encodes "no spec-tier ancestor ⇒ PASS" via
 *   `ctx.hasSpecParent === false` short-circuiting `check()` to an empty
 *   `PredicateResult[]` BEFORE its predicate runs — `isCheckpointBlocked([])` is
 *   vacuously `false` (see that function's own doc). This covers a plan parented
 *   directly under a `prd` (no spec in the chain at all) and a top-level, unparented
 *   plan identically: there is no upstream spec edge to gate against, so the write is
 *   never blocked by this checkpoint. Do NOT call `upstreamApproved(undefined, "spec")`
 *   for this case — that predicate treats a missing upstream as a FAILURE
 *   (`UPSTREAM_MISSING`), which is the correct behavior when a spec parent WAS
 *   expected but didn't resolve, not when no spec tier exists in the chain at all.
 * @invariant `task-claim` (SPEC-042 §Design Decisions D5, reviews S1+T2) does
 *   NOT apply that same short-circuit to its `noAnchorOverlap` predicate — ONLY
 *   `upstreamApproved` is gated by `ctx.hasSpecParent === true`. `noAnchorOverlap`
 *   runs for EVERY task whose plan bundle resolved, spec ancestor or not (a
 *   top-level/prd-parented plan is the common case where orchestrator discipline
 *   was previously the ONLY protection). The original draft short-circuited BOTH
 *   predicates identically to `plan-promote`'s shape — that was a hole two
 *   independent adversarial-review lenses (schema-seams and testability) each
 *   flagged separately; see AC-S3-3's "plan with NO spec ancestor + fresh foreign
 *   overlap → still blocked" regression scenario.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§5.1/§11; SPEC-042 §Design Decisions D5.
 */

import {
  anchorsOverlap,
  extractClaim,
  extractFileAnchors,
  isClaimStale,
  lintAcQuantifiability,
  type AcceptanceCriterion,
  type DocRecord,
} from "@lore/core";
import {
  parentLegal,
  specKindValid,
  hasSkeleton,
  upstreamApproved,
  upstreamHasAcceptanceCriteria,
  noAnchorOverlap,
  acQuantifiable,
  ANCHOR_OVERLAP_FIELD,
  AC_QUANTIFIABLE_FIELD,
  type PredicateResult,
  type SiblingClaimInfo,
} from "./gate-predicates.js";
import { buildFeedingPack, renderFeedingPack } from "./gate-feeding.js";

/**
 * The four IoC vertical-slice gate checkpoints (tech-spec §5.1). Not every member has
 * a `checkpointRegistry` entry yet — see this module's second invariant.
 */
export type GateCheckpoint = "spec-create" | "spec-promote" | "plan-promote" | "task-claim";

/**
 * Pre-fetched, checkpoint-agnostic input to a `CheckpointDef`'s `check` / `feed`
 * callbacks. A single `GateContext` shape is shared across all four `GateCheckpoint`s
 * (tech-spec §5.1 design contract) — every field is optional because a given
 * checkpoint's `check`/`feed` only ever reads the subset it declares in its own JSDoc.
 * Fields are grouped by the checkpoint (and callback) that consumes them.
 */
export interface GateContext {
  // -- spec-create: check() --
  /** Candidate parent doc's `type`, or `null` when no parent resolved (missing/unresolvable). */
  readonly parentType?: string | null;
  /** Candidate `extra.spec_kind`, or `undefined` when the caller omitted it. */
  readonly specKind?: string;
  /** Candidate spec body markdown. */
  readonly content?: string;

  // -- spec-create: feed() --
  /** Slug (or descriptive placeholder) of the rule doc `ruleMarkdown` was sourced from. */
  readonly ruleSource?: string;
  /** Rule doc's markdown body, already resolved (MDX-spliced) by the caller. */
  readonly ruleMarkdown?: string;
  /** Resolved parent doc's markdown body, when a parent doc was found. */
  readonly parentMarkdown?: string;

  // -- spec-promote: check() + feed() --
  /** Count of `spec.extra.acceptance_criteria` entries already declared on the target spec. */
  readonly acceptanceCriteriaCount?: number;
  /** Target spec's id/slug, as the caller supplied it — used only in `feed()`'s message. */
  readonly specIdOrSlug?: string;

  // -- spec-create / spec-promote: check() + feed() (AC-Quantifiability Gate spec) --
  /**
   * The candidate/target spec's own declared acceptance criteria — `resolvedExtra
   * .acceptance_criteria` (spec-create) or the target doc's existing/patched
   * `extra.acceptance_criteria` (spec-promote), already schema-validated by the
   * caller (`specAcceptanceCriteriaSchema.safeParse`). `undefined` means "none
   * declared / failed validation", which `acQuantifiable`'s vacuous-pass semantics
   * treat identically to an empty array — never a second error path here.
   */
  readonly acceptanceCriteria?: AcceptanceCriterion[];
  /**
   * `workflow.gates.<checkpoint>.ac_quantifiable.enabled` resolved by the CALLER
   * (mirrors `anchorOverlapEnabled`'s per-predicate config-knob shape) — `false`
   * skips `acQuantifiable` entirely, leaving every other predicate on the same
   * checkpoint untouched. Absent means enabled (same default philosophy as every
   * other gate config knob).
   */
  readonly acQuantifiableEnabled?: boolean;

  // -- plan-promote / task-claim: check() --
  /**
   * Whether the checkpoint's plan (the plan itself, for `plan-promote`; the task's
   * parent plan, for `task-claim`) has a spec-typed ancestor at all — i.e. whether
   * `CorpusService.getPlanBundle`'s `spec` field is populated. `false` means the plan
   * is parented directly under a `prd`, or has no parent at all: there is no upstream
   * spec edge to gate, so `check()` returns `[]` (PASS) without inspecting
   * `parentSpec` (see this module's third invariant above).
   */
  readonly hasSpecParent?: boolean;
  /**
   * The resolved ancestor spec's `{type, status, extra, deleted_at}`, present iff
   * `hasSpecParent` is `true`. Shaped to satisfy BOTH `upstreamApproved`
   * (`{type, status, deleted_at}`) and `upstreamHasAcceptanceCriteria` (`{extra}`)
   * without the caller building two separate projections of the same doc.
   * `deleted_at` (SPEC-... soft-deleted-upstream fix) is threaded straight from
   * `CorpusService.getPlanBundle`'s `DocRecord` — `softDelete` never touches
   * `status`, so a soft-deleted `approved` spec would otherwise silently keep
   * passing `upstreamApproved` forever; `deleted_at` is what lets that predicate
   * tell the two apart.
   */
  readonly parentSpec?: {
    type: string;
    status: string;
    extra: Record<string, unknown>;
    deleted_at: string | null;
  };

  // -- plan-promote / task-claim: feed() --
  /**
   * Pointer to the resolved ancestor spec for the feeding-pack message — slug/title/
   * status only, never the spec's full content (pointers-not-dump, mirroring
   * `gate-feeding.ts`'s module invariant). Present whenever `parentSpec` is.
   */
  readonly parentSpecPointer?: { slug: string; title: string; status: string };
  /** Target plan/task's id/slug, as the caller supplied it — used only in `feed()`'s message. */
  readonly targetIdOrSlug?: string;

  // -- task-claim: check() + feed() (SPEC-042 §Design Decisions D5) --
  /** The actor attempting the claim — populated UNCONDITIONALLY (see this module's fourth invariant). */
  readonly candidateBy?: string;
  /** The target task's own declared (normalized) `file_anchors` — populated UNCONDITIONALLY. */
  readonly candidateAnchors?: string[];
  /**
   * Every OTHER task in the same plan holding a claim (fresh or stale — staleness
   * is precomputed HERE by the caller from the SAME `nowIso` the target claim's
   * own conflict check uses, D5 seam pinning) — populated UNCONDITIONALLY
   * whenever a plan bundle resolved, regardless of `hasSpecParent` (fourth
   * module invariant).
   */
  readonly siblingClaims?: SiblingClaimInfo[];
  /**
   * `workflow.gates."task-claim".anchor_overlap.enabled` resolved by the CALLER
   * (SPEC-042 D6) — `false` skips `noAnchorOverlap` entirely, leaving
   * `upstreamApproved` untouched. Absent means enabled (same default philosophy
   * as every other gate config knob).
   */
  readonly anchorOverlapEnabled?: boolean;
}

/**
 * One gate checkpoint's pure decision logic: the deterministic predicate checks to
 * run, and how to render the feeding-pack text when at least one of them fails.
 */
export interface CheckpointDef {
  /** This checkpoint's key — always matches the `checkpointRegistry` map key it's registered under. */
  readonly id: GateCheckpoint;
  /**
   * Runs every deterministic predicate for this checkpoint against `ctx`, returning
   * ALL results (passes and failures) in a fixed order. PURE — see module invariant.
   */
  readonly check: (ctx: GateContext) => PredicateResult[];
  /**
   * Renders the feeding-pack text to print when this checkpoint is blocked.
   * `failures` is expected to be the failing subset of some `check(ctx)` call
   * (see `selectFailures`) — implementations tolerate an unfiltered array too
   * (they re-filter internally), so passing the full `check(ctx)` result is safe.
   */
  readonly feed: (ctx: GateContext, failures: PredicateResult[]) => string;
}

/**
 * The "block iff any predicate failed" aggregate rule (IoC vertical-slice tech-spec
 * §4.1 INV1) — the one place both `lore gate`'s adapter code and this module's tests
 * apply it, so it can never drift between a checkpoint's `check` output and the
 * exit-code decision built on top of it.
 *
 * @param results - The full output of some `CheckpointDef.check(ctx)` call.
 * @returns `true` when at least one result is `{ok: false}`; `false` otherwise
 *   (including the empty-array case — vacuously not blocked).
 * @example
 * isCheckpointBlocked([{ok: true}, {ok: false, reason: "X"}]); // => true
 * isCheckpointBlocked([{ok: true}]);                            // => false
 */
export function isCheckpointBlocked(results: PredicateResult[]): boolean {
  return results.some((r) => !r.ok);
}

/**
 * Narrows `results` to only its failing entries, preserving order — the `failures`
 * shape a `CheckpointDef.feed` expects.
 *
 * @example
 * selectFailures([{ok: true}, {ok: false, reason: "X"}]); // => [{ok: false, reason: "X"}]
 */
export function selectFailures(
  results: PredicateResult[],
): Array<{ ok: false; reason: string; field?: string }> {
  return results.filter((r): r is { ok: false; reason: string; field?: string } => !r.ok);
}

/**
 * spec-create's three predicates (`parentLegal` / `specKindValid` / `hasSkeleton`,
 * `gate-predicates.ts`), lifted unchanged (same order, same inputs) from `gate.ts`'s
 * former inline `runSpecCreateGate` checks array.
 */
function checkSpecCreate(ctx: GateContext): PredicateResult[] {
  const parent =
    ctx.parentType !== undefined && ctx.parentType !== null ? { type: ctx.parentType } : null;
  const results = [parentLegal(parent), specKindValid(ctx.specKind), hasSkeleton(ctx.content ?? "")];
  if (ctx.acQuantifiableEnabled !== false) {
    results.push(acQuantifiable(ctx.acceptanceCriteria));
  }
  return results;
}

/**
 * Renders the per-AC detail lines for an `acQuantifiable` predicate failure — one
 * `AcQualityFinding.message` per offending `block` finding (already names the AC id,
 * the offending word, and the fix — see `lintAcQuantifiability`'s own JSDoc). Returns
 * `[]` when the predicate didn't fail (so callers can unconditionally spread the
 * result into a `missing` list with no extra branching). Shared by `feedSpecCreate`
 * and `feedSpecPromote` — both checkpoints render the SAME per-AC detail shape.
 */
function acQuantifiableDetailLines(ctx: GateContext, failures: PredicateResult[]): string[] {
  const failed = failures.some((f) => !f.ok && f.field === AC_QUANTIFIABLE_FIELD);
  if (!failed) {
    return [];
  }
  return lintAcQuantifiability(ctx.acceptanceCriteria ?? [])
    .filter((finding) => finding.severity === "block")
    .map((finding) => finding.message);
}

/**
 * spec-create's feeding-pack renderer — a thin `buildFeedingPack` + `renderFeedingPack`
 * pipe (both already pure); this function adds no IO, it only supplies the pre-fetched
 * `ctx` fields those functions expect, mirroring `gate.ts`'s former inline assembly.
 */
function feedSpecCreate(ctx: GateContext, failures: PredicateResult[]): string {
  const pack = buildFeedingPack({
    ruleSource: ctx.ruleSource ?? "unknown",
    ruleMarkdown: ctx.ruleMarkdown ?? "",
    ...(ctx.parentMarkdown !== undefined ? { parentMarkdown: ctx.parentMarkdown } : {}),
    missing: [...selectFailures(failures).map((f) => f.reason), ...acQuantifiableDetailLines(ctx, failures)],
  });
  return renderFeedingPack(pack);
}

/** Machine-readable reason code for spec-promote's single predicate. */
const NO_ACCEPTANCE_CRITERIA_REASON = "NO_ACCEPTANCE_CRITERIA";

/**
 * spec-promote's single predicate: at least one structured acceptance criterion must
 * already be declared on the target spec (`ctx.acceptanceCriteriaCount`, counted by
 * `gate.ts` via `AcService.listCriteria` before this is called — that count IS the
 * only thing that can fail this gate, per `gate.ts`'s module header).
 */
function checkSpecPromote(ctx: GateContext): PredicateResult[] {
  const count = ctx.acceptanceCriteriaCount ?? 0;
  const results: PredicateResult[] =
    count > 0 ? [{ ok: true }] : [{ ok: false, reason: NO_ACCEPTANCE_CRITERIA_REASON }];
  if (ctx.acQuantifiableEnabled !== false) {
    results.push(acQuantifiable(ctx.acceptanceCriteria));
  }
  return results;
}

/**
 * spec-promote's feeding message. The base "no structured acceptance criteria"
 * text is identical to `gate.ts`'s former inline stderr message (trailing newline
 * included) whenever that's the only failure — byte-for-byte behavior-preserving on
 * that path. When `acQuantifiable` also (or instead) failed, appends the per-AC
 * detail lines (`acQuantifiableDetailLines`) naming every offending AC id, its
 * abstract word, and the fix.
 */
function feedSpecPromote(ctx: GateContext, failures: PredicateResult[]): string {
  const base = `Error: spec "${ctx.specIdOrSlug ?? "unknown"}" has no structured acceptance criteria — add via \`lore ac add\`.\n`;
  const acLines = acQuantifiableDetailLines(ctx, failures);
  const noAcceptanceCriteriaFailed = failures.some((f) => !f.ok && f.reason === NO_ACCEPTANCE_CRITERIA_REASON);

  if (acLines.length === 0) {
    return noAcceptanceCriteriaFailed
      ? base
      : "Error: spec has an unquantified acceptance criterion.\n";
  }

  const acBlock = acLines.map((line) => `- ${line}`).join("\n");
  return noAcceptanceCriteriaFailed
    ? `${base}\nAlso:\n${acBlock}\n`
    : `Error: spec "${ctx.specIdOrSlug ?? "unknown"}" has an unquantified acceptance criterion:\n${acBlock}\n`;
}

/**
 * `plan-promote`'s two predicates: `upstreamApproved` (the ancestor spec must be
 * `approved`) then `upstreamHasAcceptanceCriteria` (it must declare ≥1 structured AC).
 * Both run — this returns ALL results (module contract), not just the first failure —
 * matching `checkSpecCreate`'s "run every predicate, don't short-circuit on the first
 * failure" shape. `ctx.hasSpecParent === false` (or absent) short-circuits to `[]`
 * BEFORE either predicate runs (third module invariant — no spec tier ⇒ vacuous pass).
 */
function checkPlanPromote(ctx: GateContext): PredicateResult[] {
  if (ctx.hasSpecParent !== true) {
    return [];
  }
  return [upstreamApproved(ctx.parentSpec, "spec"), upstreamHasAcceptanceCriteria(ctx.parentSpec)];
}

/**
 * `task-claim`'s predicates (SPEC-042 §Design Decisions D5): `noAnchorOverlap`
 * runs UNCONDITIONALLY (subject only to `ctx.anchorOverlapEnabled`, D6's
 * per-predicate config knob) — NOT gated by `hasSpecParent`, unlike
 * `upstreamApproved`, which keeps the "no spec tier ⇒ vacuous pass"
 * short-circuit `checkPlanPromote` also uses. See this module's fourth
 * invariant for why these two predicates deliberately do NOT share one
 * short-circuit.
 */
function checkTaskClaim(ctx: GateContext): PredicateResult[] {
  const results: PredicateResult[] = [];
  if (ctx.anchorOverlapEnabled !== false) {
    results.push(noAnchorOverlap(ctx.candidateBy, ctx.candidateAnchors, ctx.siblingClaims));
  }
  if (ctx.hasSpecParent === true) {
    results.push(upstreamApproved(ctx.parentSpec, "spec"));
  }
  return results;
}

/**
 * Renders a pointers-not-dump feeding pack for a `plan-promote` / `task-claim`
 * failure: a `[source: corpus <slug>, trust: team-authored]` header (via
 * `buildFeedingPack`/`renderFeedingPack`, same provenance convention every other
 * checkpoint's feed uses), the machine-readable `missing` reasons, and one line
 * naming the ancestor spec's slug/title/status — never the spec's full markdown body.
 * Shared by both checkpoints (identical shape, only the `Required:` sentence differs)
 * to avoid duplicating the `buildFeedingPack` plumbing twice.
 */
function feedUpstreamSpecCheckpoint(
  ctx: GateContext,
  failures: PredicateResult[],
  requirementSentence: string,
): string {
  const pointer = ctx.parentSpecPointer;
  const ruleMarkdown =
    pointer !== undefined
      ? `Parent spec: ${pointer.slug} — "${pointer.title}" (status: ${pointer.status}). ${requirementSentence}`
      : `(no ancestor spec resolved). ${requirementSentence}`;
  const pack = buildFeedingPack({
    ruleSource: pointer !== undefined ? `corpus ${pointer.slug}` : "corpus (unresolved)",
    ruleMarkdown,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/** `plan-promote`'s feeding message — human-readable requirement + machine-readable `missing` reasons. */
function feedPlanPromote(ctx: GateContext, failures: PredicateResult[]): string {
  return feedUpstreamSpecCheckpoint(
    ctx,
    failures,
    'Required for plan-promote: the ancestor spec must be "approved" and declare ' +
      "at least one structured acceptance criterion (`lore ac add`).",
  );
}

/**
 * Renders the anchor-overlap-specific feeding pack (SPEC-042 §Design Decisions
 * D5, review U6) — names the conflicting sibling task's slug, holder, staleness
 * age is implicit (only FRESH siblings can conflict, by construction of
 * `noAnchorOverlap`), the overlapping path pairs, AND a literal copy-pasteable
 * recovery command. Pointers only — never the sibling task's body content.
 */
function feedAnchorOverlap(ctx: GateContext, failures: PredicateResult[]): string {
  const candidateAnchors = ctx.candidateAnchors ?? [];
  let conflictLine = "(no specific conflicting sibling could be identified)";
  for (const sibling of ctx.siblingClaims ?? []) {
    if (sibling.stale) continue;
    if (sibling.by === ctx.candidateBy) continue;
    if (sibling.anchors.length === 0) continue;
    const overlap = anchorsOverlap(candidateAnchors, sibling.anchors);
    if (overlap.overlaps) {
      const pathsStr = overlap.pairs.map(([a, b]) => `${a} × ${b}`).join(", ");
      conflictLine =
        `Conflicting task: ${sibling.slug} — "${sibling.title}" — held by ${sibling.by}. ` +
        `Overlapping paths: ${pathsStr}. ` +
        `Recovery: \`lore release ${sibling.slug} --by ${sibling.by} --force\``;
      break;
    }
  }
  const pack = buildFeedingPack({
    ruleSource: "corpus (sibling task claims)",
    ruleMarkdown:
      "Required for task-claim: declared file_anchors must not overlap a FRESH claim held " +
      `by a different actor on another task in the same plan. ${conflictLine}`,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/**
 * `task-claim`'s feeding message — dispatches to {@link feedAnchorOverlap} when
 * the anchor-overlap predicate failed (SPEC-042 D5 — its own dedicated,
 * conflict-detail-bearing message), else falls back to the pre-existing
 * upstream-spec-approval message (unchanged from before SPEC-042).
 */
function feedTaskClaim(ctx: GateContext, failures: PredicateResult[]): string {
  const anchorFailed = failures.some((f) => !f.ok && f.field === ANCHOR_OVERLAP_FIELD);
  if (anchorFailed) {
    return feedAnchorOverlap(ctx, failures);
  }
  return feedUpstreamSpecCheckpoint(
    ctx,
    failures,
    'Required for task-claim: the ancestor spec must be "approved".',
  );
}

/**
 * Builds the `hasSpecParent` / `parentSpec` / `parentSpecPointer` trio `plan-promote`
 * and `task-claim` both consume, from an optional resolved ancestor spec `DocRecord`
 * (`CorpusService.getPlanBundle`'s `.spec` field — `undefined` when the plan has no
 * spec-tier ancestor). SSOT relocated here (retro follow-up item 8, defense-in-depth)
 * from the CLI adapter's former local `gate.ts::buildUpstreamSpecContext` so BOTH the
 * CLI (`lore gate plan-promote`/`task-claim`) and the service-layer `GateEnforcer`
 * (real `corpusService.create`/`reviewService.approve`/`taskWorkflowService.claim`
 * callers — MCP, HTTP, direct-service) build the identical ctx shape from the
 * identical resolved-spec input, rather than two independently-maintained copies.
 * `gate.ts` now imports this function instead of defining its own.
 *
 * `spec.deleted_at` is threaded straight into `parentSpec.deleted_at`, even when
 * non-`null` — `getPlanBundle` populates `.spec` regardless of soft-delete state
 * (a soft-deleted upstream still IS a spec-tier ancestor; only `upstreamApproved`'s
 * pure predicate decides whether that's disqualifying, via the `UPSTREAM_DELETED`
 * reason). This function must never itself treat a deleted spec as "no spec
 * parent" — that would wrongly fall through to `hasSpecParent: false`'s vacuous
 * pass instead of blocking the gate.
 *
 * @param spec - The resolved ancestor spec, or `undefined` when `getPlanBundle` found
 *   none (prd-parented or unparented plan).
 */
export function buildUpstreamSpecContext(spec: DocRecord | undefined): GateContext {
  if (spec === undefined) {
    return { hasSpecParent: false };
  }
  return {
    hasSpecParent: true,
    parentSpec: {
      type: spec.type,
      status: spec.status,
      extra: spec.extra,
      deleted_at: spec.deleted_at,
    },
    parentSpecPointer: { slug: spec.slug, title: spec.title, status: spec.status },
  };
}

/**
 * Builds the `candidateBy` / `candidateAnchors` / `siblingClaims` trio
 * `task-claim`'s `noAnchorOverlap` predicate consumes (SPEC-042 §Design
 * Decisions D5) — co-located with {@link buildUpstreamSpecContext} per the
 * same "SSOT ctx-builder both `lore gate task-claim` and the service-layer
 * `GateEnforcer` caller build from" rationale. Populated from a plan bundle's
 * `tasks[]` (`CorpusService.getPlanBundle`, already includes every sibling —
 * zero extra IO), UNCONDITIONALLY (never gated by whether a spec ancestor
 * resolved — see this module's fourth invariant).
 *
 * `siblingClaims[].stale` is precomputed HERE from the caller-supplied
 * `nowIso` + `ttlMinutes` — the SAME values `_claimImpl`'s own target-claim
 * conflict check uses within one `claim()` call, so this builder (and the
 * `GateEnforcer.enforce` it feeds) never reads a wall clock itself.
 *
 * @param candidateBy - The actor attempting the claim.
 * @param candidateTask - The task being claimed.
 * @param siblingTasks - The candidate task's plan siblings (bundle.tasks,
 *   including `candidateTask` itself — filtered out below).
 * @param nowIso - Caller-supplied current time (D10 — never Date.now() here).
 * @param ttlMinutes - Claim TTL in minutes, forwarded to `isClaimStale`.
 */
export function buildAnchorGateContext(
  candidateBy: string,
  candidateTask: DocRecord,
  siblingTasks: DocRecord[],
  nowIso: string,
  ttlMinutes: number,
): Pick<GateContext, "candidateBy" | "candidateAnchors" | "siblingClaims"> {
  const candidateAnchors = extractFileAnchors(candidateTask);
  const siblingClaims: SiblingClaimInfo[] = [];
  for (const sibling of siblingTasks) {
    if (sibling.id === candidateTask.id) continue;
    const claim = extractClaim(sibling);
    if (claim === undefined) continue;
    siblingClaims.push({
      slug: sibling.slug,
      title: sibling.title,
      by: claim.by,
      at: claim.at,
      stale: isClaimStale(claim, nowIso, ttlMinutes),
      anchors: extractFileAnchors(sibling),
    });
  }
  return { candidateBy, candidateAnchors, siblingClaims };
}

/**
 * The gate checkpoint registry — see module invariants for why this stays
 * `Partial<Record<...>>` even though all four `GateCheckpoint` members are now
 * populated.
 */
export const checkpointRegistry: Partial<Record<GateCheckpoint, CheckpointDef>> = {
  "spec-create": { id: "spec-create", check: checkSpecCreate, feed: feedSpecCreate },
  "spec-promote": { id: "spec-promote", check: checkSpecPromote, feed: feedSpecPromote },
  "plan-promote": { id: "plan-promote", check: checkPlanPromote, feed: feedPlanPromote },
  "task-claim": { id: "task-claim", check: checkTaskClaim, feed: feedTaskClaim },
};

// ─── Armed Gates (SPEC-041 §3 bootstrap; SPEC-043 §Design Decisions D8) ────

/** All four checkpoints, in the fixed order both `SessionService.bootstrap` and
 *  `CorpusService.status`'s SPEC-043 warning render/scan them. */
export const ALL_GATE_CHECKPOINTS: readonly GateCheckpoint[] = [
  "spec-create",
  "spec-promote",
  "plan-promote",
  "task-claim",
];

/**
 * checkpoint → discoverable feeding-skill scope (`knowledgeExtraSchema.skill.applies_to`).
 * A LOCAL mirror of `flows/feed-flow.ts::CHECKPOINT_PRODUCED_TYPE` — services must not
 * import from `flows/`/`adapters/` (composition lives in app.ts), so this module cannot
 * import that map directly. Only `"spec-create"` has a discoverable feeding SKILL wired
 * in production today; the other three checkpoints source their feeding message from
 * the TARGET doc's resolved ancestor spec, not a skill-doc lookup, so they have no
 * single corpus-wide "the feeding source" this computation could point at.
 */
export const CHECKPOINT_APPLIES_TO: Partial<Record<GateCheckpoint, string>> = {
  "spec-create": "spec",
};

/** One enabled gate checkpoint + its discoverable feeding-skill source slug, when one exists. */
export interface ArmedGate {
  checkpoint: GateCheckpoint;
  feeding_source_slug: string | null;
}

/**
 * Computes the enabled gate checkpoints + each's discoverable feeding-skill source
 * slug — the SSOT derivation shared by `SessionService.bootstrap` (`armed_gates[]`,
 * SPEC-041 §3) and `CorpusService.status`'s invalidated-feeding-source warning
 * (SPEC-043 D8) — so "which gates are armed / what feeds them" is never independently
 * re-derived a second time (the 2026-07-11 gate-ctx SSOT-drift incident class). Pure
 * over already-fetched `approvedSkillDocs` — no store IO of its own.
 *
 * @param approvedSkillDocs - Every APPROVED `knowledge/skill` doc's `{slug, updated_at,
 *   appliesTo}` (appliesTo undefined when `extra.skill.applies_to` is absent/malformed).
 * @param isCheckpointEnabled - Per-checkpoint enablement predicate — `GateEnforcer
 *   .isEnabled.bind(gateEnforcer)` in production; defaults callers may pass `() => true`.
 * @returns One {@link ArmedGate} per ENABLED checkpoint, in {@link ALL_GATE_CHECKPOINTS} order.
 */
export function computeArmedGates(
  approvedSkillDocs: ReadonlyArray<{ slug: string; updated_at: string; appliesTo: string | undefined }>,
  isCheckpointEnabled: (checkpoint: GateCheckpoint) => boolean,
): ArmedGate[] {
  const armedGates: ArmedGate[] = [];
  for (const checkpoint of ALL_GATE_CHECKPOINTS) {
    if (!isCheckpointEnabled(checkpoint)) continue;
    const appliesTo = CHECKPOINT_APPLIES_TO[checkpoint];
    let feedingSourceSlug: string | null = null;
    if (appliesTo !== undefined) {
      const matches = approvedSkillDocs.filter((d) => d.appliesTo === appliesTo);
      const latest =
        matches.length > 0 ? matches.reduce((n, d) => (d.updated_at > n.updated_at ? d : n)) : undefined;
      feedingSourceSlug = latest?.slug ?? null;
    }
    armedGates.push({ checkpoint, feeding_source_slug: feedingSourceSlug });
  }
  return armedGates;
}
