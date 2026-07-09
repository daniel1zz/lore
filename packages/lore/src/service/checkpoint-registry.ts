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
 * lists render identically). `plan-promote` and `task-claim` are a later slice's
 * addition — see the module invariant below.
 *
 * @invariant Every `check` and `feed` function reachable through `checkpointRegistry`
 *   is a PURE function of its `GateContext` argument — no store, no IO, no
 *   `bun:sqlite`, no randomness, no wall-clock reads. Same `GateContext` in ⇒ same
 *   result out, always. All store/IO (resolving a parent doc, reading a rule doc's
 *   markdown, counting a spec's declared acceptance criteria) stays in `gate.ts` —
 *   this module only consumes data the adapter already fetched.
 * @invariant `checkpointRegistry` is intentionally PARTIAL — `GateCheckpoint` names
 *   all four checkpoints the IoC vertical slice will eventually cover, but this module
 *   only populates `spec-create` and `spec-promote` so far. Callers MUST branch on
 *   `checkpointRegistry[cp] !== undefined` (or use `requireCheckpoint`-style lookups
 *   only where compile-time-known to already be populated) rather than assuming every
 *   `GateCheckpoint` has an entry.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§5.1/§11.
 */

import {
  parentLegal,
  specKindValid,
  hasSkeleton,
  type PredicateResult,
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
): Array<{ ok: false; reason: string }> {
  return results.filter((r): r is { ok: false; reason: string } => !r.ok);
}

/**
 * spec-create's three predicates (`parentLegal` / `specKindValid` / `hasSkeleton`,
 * `gate-predicates.ts`), lifted unchanged (same order, same inputs) from `gate.ts`'s
 * former inline `runSpecCreateGate` checks array.
 */
function checkSpecCreate(ctx: GateContext): PredicateResult[] {
  const parent =
    ctx.parentType !== undefined && ctx.parentType !== null ? { type: ctx.parentType } : null;
  return [parentLegal(parent), specKindValid(ctx.specKind), hasSkeleton(ctx.content ?? "")];
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
    missing: selectFailures(failures).map((f) => f.reason),
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
  if (count > 0) {
    return [{ ok: true }];
  }
  return [{ ok: false, reason: NO_ACCEPTANCE_CRITERIA_REASON }];
}

/**
 * spec-promote's feeding message — identical text to `gate.ts`'s former inline
 * stderr message (trailing newline included), so the refactor is byte-for-byte
 * behavior-preserving on this path.
 */
function feedSpecPromote(ctx: GateContext, _failures: PredicateResult[]): string {
  return (
    `Error: spec "${ctx.specIdOrSlug ?? "unknown"}" has no structured acceptance criteria — ` +
    "add via `lore ac add`.\n"
  );
}

/**
 * The gate checkpoint registry — partial over `GateCheckpoint` (see module invariant).
 * `spec-create` and `spec-promote` are populated here; `plan-promote` and `task-claim`
 * are a later slice's addition.
 */
export const checkpointRegistry: Partial<Record<GateCheckpoint, CheckpointDef>> = {
  "spec-create": { id: "spec-create", check: checkSpecCreate, feed: feedSpecCreate },
  "spec-promote": { id: "spec-promote", check: checkSpecPromote, feed: feedSpecPromote },
};
