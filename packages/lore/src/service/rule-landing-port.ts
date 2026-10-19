/**
 * Module: rule-landing-port — the contract between `CorpusService` and the writer of a spec's rule change set.
 *
 * Purpose: plan close and spec deprecation must land / abandon a change set, but services never import each other.
 *   `CorpusService` depends on THIS port; `RuleChangeService` implements it; `app.ts` composes them.
 * Public surface: {@link RuleChangeLandingPort}, {@link RuleApplyOutcome}, {@link RuleApplyOpts}.
 * Invariants:
 *   - Types only: no runtime code, no imports beyond `@lore/core` types.
 *   - `apply` is idempotent: a second call over the same state returns `kind: "noop"` and writes nothing.
 * Side-effect class: pure (type declarations).
 * Source: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (D2, D3, Edge cases).
 */

import type { DocRecord, DocStatus, LoreError, Result } from "@lore/core";

/** Options of {@link RuleChangeLandingPort.apply}. */
export interface RuleApplyOpts {
  /** Acting identity; omitted → the write-context / environment chain. */
  by?: string;
}

/** One leaf the apply wrote: exactly one version per touched leaf. */
export interface RuleApplyLeafWrite {
  /** Slug of the leaf. */
  leaf: string;
  /** The leaf's version after the write. */
  version: number;
  /** Rule ids the write added, rewrote or retired on this leaf. */
  rules: string[];
}

/** What `apply` did. */
export type RuleApplyOutcome =
  /** The change set landed in the tree. */
  | { kind: "applied"; spec: string; leaves: RuleApplyLeafWrite[] }
  /** Nothing to do: no change set, or every entry already landed / was already retired as never landed. */
  | { kind: "noop"; spec: string; reason: "no-changes" | "already-applied" | "already-abandoned" }
  /** The spec is deprecated: its still-proposed ids were retired "never landed: <spec>". */
  | { kind: "abandoned"; spec: string; leaves: RuleApplyLeafWrite[] };

/**
 * One baseline leaf's share of an abandonment: the leaf as read, and the patch that retires the spec's still-proposed
 * ids on it. A plan only — nothing is written until the corpus commits it with the spec's own deprecation.
 */
export interface AbandonedLeafPlan {
  /** The leaf as read; its `version` is the CAS base of the write. */
  leaf: DocRecord;
  /** The leaf's `extra` after the retirements. */
  extra: Record<string, unknown>;
  /** The leaf's status after the write (a contract edit resets an approved leaf). */
  status: DocStatus;
  /** The version row's change summary. */
  summary: string;
  /** The audit row's details (operation, spec, rule ids). */
  details: Record<string, unknown>;
  /** Rule ids the write retires on this leaf. */
  rules: string[];
}

/** The leaf writes that retire a spec's proposed ids "never landed"; empty when there is nothing to retire. */
export interface AbandonmentPlan {
  spec: string;
  leaves: AbandonedLeafPlan[];
}

/** The one writer from a change set to the tree (D3). */
export interface RuleChangeLandingPort {
  /**
   * Land the change set of `specRef` iff every criterion citing a changed id has a runner-attested pass; for a
   * deprecated spec, retire its proposed ids instead. A refusal is `VALIDATION_ERROR` naming the criteria.
   */
  apply(specRef: string, opts?: RuleApplyOpts): Promise<Result<RuleApplyOutcome, LoreError>>;

  /**
   * Plan, without writing, the retirement of `specRef`'s still-proposed ids "never landed: <spec>" (BR-1307).
   * The corpus commits the plan in the SAME transaction as the spec's move to `deprecated`, so both land or neither
   * does. An `err` (the plan cannot be made, or a leaf is not writable from here) refuses the deprecation.
   */
  planAbandonment(specRef: string, opts?: RuleApplyOpts): Promise<Result<AbandonmentPlan, LoreError>>;
}
