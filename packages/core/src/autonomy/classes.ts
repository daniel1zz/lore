/**
 * Operation-class registry and factor mapping tables for the autonomy decision function.
 *
 * Purpose: single source of truth for WHICH operations exist, their importance tier,
 *   declared recoverability path, auto threshold and prior confidence, and for how
 *   measured-fact categories map to the numeric factors R, B, E, J.
 * Public surface: OPERATION_CLASS_REGISTRY, RECOVERABILITY_SCORE, BLAST_SCORE,
 *   EVIDENCE_SCORE, JUDGE_SCORE, BEYOND_OWN_SESSION_BLAST, and the derived types.
 * Invariants: data only, immutable (`as const` / readonly); numbers are STARTING POINTS
 *   governed as data (AC-AU-9) — tightened by outcomes, loosened only by the human.
 *   ⛔ OPERATION_CLASS_REGISTRY and WORKTREE_REMOVE_REGENERABLE_PATTERNS are the SEED of the governed record
 *   (thresholds.ts / lore's AutonomyThresholdService), not the live values: a service-layer reader takes them from
 *   DecisionService.governed(), never from these constants (the record may have been tightened since).
 *   The C factor (confidence from outcomes) is NOT computed here: the caller passes it
 *   as a number; AU-T8 will compute it. `priorConfidence` is the value a caller uses
 *   before any outcomes exist — decide() never substitutes it for an absent C.
 * Side-effect class: pure (no Node builtin, browser-safe, importable from the barrel).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore (Scope tables),
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D1-D3.
 */

/** What could be lost beyond recovery if the operation is wrong (spec R table keys). */
export const RECOVERABILITY_SCORE = {
  reversible: 1.0,
  "loss-free-by-proof": 0.9,
  "irreversible-local": 0.2,
  "irreversible-external": 0,
} as const;
export type Recoverability = keyof typeof RECOVERABILITY_SCORE;

/** Blast radius from run/claim/worktree/session facts (spec B table). */
export const BLAST_SCORE = {
  "own-or-ended-run": 1.0,
  "unprovable-owner-made-recoverable": 0.9,
  "calling-session": 0.9,
  "shared-live-state": 0.6,
  "other-live-actor": 0.2,
  "outside-machine": 0,
} as const;
export type BlastRadius = keyof typeof BLAST_SCORE;

/** Blast categories that reach past the calling session (hard rule with irreversible-local). */
export const BEYOND_OWN_SESSION_BLAST: readonly BlastRadius[] = [
  "shared-live-state",
  "other-live-actor",
  "outside-machine",
];

/** How the safety predicate was established (spec E table). */
export const EVIDENCE_SCORE = {
  "lore-evaluated": 1.0,
  "runner-attested": 0.8,
  "self-report": 0.1,
  none: 0,
} as const;
export type EvidenceBasis = keyof typeof EVIDENCE_SCORE;

/** Worst current-version LLM review decision (spec J table). Optional factor. */
export const JUDGE_SCORE = {
  approve: 1.0,
  escalate: 0.4,
  reject: 0,
} as const;
export type JudgeDecision = keyof typeof JUDGE_SCORE;

/** A class whose every instance goes to the human; carries no score parameters. */
export type HumanAlwaysClass = {
  readonly tier: "human-always";
  readonly usesJudge: boolean;
};

/** A class decided by score: auto iff min(required factors [+J]) >= threshold. */
export type NormalClass = {
  readonly tier: "normal";
  /** The recoverability path the class declares; measured facts may only be WORSE, never better. */
  readonly declaredRecoverability: Recoverability;
  /** Auto iff score >= threshold. */
  readonly threshold: number;
  /** Starting C for a caller with no outcomes yet (AU-T8 replaces it with measured C). */
  readonly priorConfidence: number;
  /** Whether this class asks for an LLM review; absent J is left out of the minimum either way. */
  readonly usesJudge: boolean;
};

/**
 * A class whose every instance is recorded with verdict `milestone`: never auto-applied, never escalated, so no
 * pending human decision exists for it. The milestone review resolves it (BR-1370). Carries no score parameters.
 */
export type MilestoneClass = {
  readonly tier: "milestone";
  readonly usesJudge: boolean;
};

export type OperationClass = HumanAlwaysClass | MilestoneClass | NormalClass;

/** Registry shape: class id -> class. Injected into decide() so tests and later phases can substitute. */
export type OperationClassRegistry = Readonly<Record<string, OperationClass>>;

const human: HumanAlwaysClass = { tier: "human-always", usesJudge: false };
const milestone: MilestoneClass = { tier: "milestone", usesJudge: false };

function normal(declaredRecoverability: Recoverability, threshold: number, priorConfidence: number): NormalClass {
  return { tier: "normal", declaredRecoverability, threshold, priorConfidence, usesJudge: false };
}

/**
 * Seeded class table. The human-always set is EXACTLY {governance-loosen, push-force, archive-ref-prune} (BR-1370):
 * a force push, a pruned archive ref and a loosened governance value cannot be taken back (one-way doors).
 * reason: override-judgment and ac-exempt are `milestone` classes: a Wilson bound over their 0.5
 * prior never reached the auto threshold, so they escalated forever; they now record a `milestone` decision that the
 * milestone review resolves, with no pending human decision. `report-issue` is not a class: it never asked decide().
 */
export const OPERATION_CLASS_REGISTRY: OperationClassRegistry = {
  "stash-drop": normal("loss-free-by-proof", 0.8, 0.95),
  "worktree-remove": normal("loss-free-by-proof", 0.8, 0.97),
  "process-reap": normal("loss-free-by-proof", 0.85, 0.97),
  "override-judgment": milestone,
  "ac-exempt": milestone,
  "verify-new-command": normal("reversible", 0.8, 0.95),
  "run-end-stale": normal("reversible", 0.8, 0.97),
  "governance-loosen": human,
  "push-force": human,
  "archive-ref-prune": human,
};

/**
 * The worktree-remove class's declared regenerable set: gitignore-style patterns for ignored paths that regenerate
 * from tracked sources or the build, so removing them loses nothing (AC-AU-11, rule (b) of the ignored-file rule).
 * Syntax: a trailing `/` matches a directory (and everything under it); a pattern without an inner `/` matches at
 * any depth; otherwise it is anchored at the worktree root; `*` stays inside one path segment, `**` crosses them.
 *
 * reason: SEED DATA of the governed record (AU-T9): the live set is read from DecisionService.governed(); loosening it
 * is `governance-loosen`, human only. Editing this seed changes only a corpus seeded AFTER the edit — and a git diff
 * here is a visible governance change; do not add a path just to make a worktree pass.
 * Source: task AU-T13; spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-11.
 * dist-npm/ added 2026-10-18 by user approval (governance-loosen): the output of `bun run build:npm`.
 * .scratch/ added 2026-10-19 by user approval (governance-loosen, AskUserQuestion "加入清单"): the implementer's
 * worktree-local temp dir (lore-implementer.md). Loss-free because evidence content worth keeping is copied into
 * evidence rows (output tails), never left only in .scratch/. Task AU-T28.
 */
export const WORKTREE_REMOVE_REGENERABLE_PATTERNS: readonly string[] = [
  "node_modules/",
  "dist/",
  "dist-npm/",
  ".scratch/",
  ".turbo/",
  "coverage/",
  "*.tsbuildinfo",
  "packages/*/dist/",
  "**/*.gen.ts",
  "packages/lore/src/generated/**",
];
