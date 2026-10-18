/**
 * decide(class, subject, facts) — the ONE pure autonomy decision function.
 *
 * Purpose: turn lore-measured facts about an operation into auto | escalate | refuse.
 * Public surface: decide, autonomyFactsSchema, AutonomyFacts, AutonomyDecision, AutonomyVerdict.
 * Invariants:
 *   - Hard rules run BEFORE any score: human-always tier -> escalate; R = irreversible-external
 *     -> escalate; R = irreversible-local with blast radius beyond the own session -> escalate.
 *     A hard-rule escalation reports score 0 (its effective authority) and names the rule in `reasons`.
 *   - Otherwise score = min over the class's required factors R, B, E, C (+ J when present);
 *     auto iff score >= threshold. A weighted mean is deliberately NOT used (weakest link).
 *   - A REQUIRED factor the caller did not measure scores 0. J is optional: absent -> left out
 *     of the minimum; present -> can only lower the score.
 *   - refuse ONLY for an invariant violation: unknown class, empty subject, malformed facts.
 *     It is a returned verdict, never a throw; the caller maps it to exit 4 and records nothing as auto.
 *   - C (confidence from outcomes) arrives from the caller as a number in [0,1]; AU-T8 computes it.
 *     decide() never substitutes the registry's prior for an absent C.
 * Side-effect class: pure — no IO, no clock, no input mutation, no Node builtin.
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-1;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D1-D3.
 */
import { z } from "zod";
import {
  BEYOND_OWN_SESSION_BLAST,
  BLAST_SCORE,
  EVIDENCE_SCORE,
  JUDGE_SCORE,
  OPERATION_CLASS_REGISTRY,
  RECOVERABILITY_SCORE,
  type OperationClassRegistry,
  type Recoverability,
} from "./classes.js";

const enumKeys = <T extends object>(table: T) => Object.keys(table) as [keyof T & string, ...(keyof T & string)[]];

/**
 * Measured facts. Every field is optional because ABSENT means "not measured" (-> 0 for
 * required factors); `.strict()` makes a mistyped key a refusal rather than a silent 0.
 */
export const autonomyFactsSchema = z
  .object({
    recoverability: z.enum(enumKeys(RECOVERABILITY_SCORE)).optional(),
    blast: z.enum(enumKeys(BLAST_SCORE)).optional(),
    evidence: z.enum(enumKeys(EVIDENCE_SCORE)).optional(),
    /** C from outcome calibration, supplied by the caller; finite number in [0,1]. */
    confidence: z.number().min(0).max(1).optional(),
    judge: z.enum(enumKeys(JUDGE_SCORE)).optional(),
  })
  .strict();
export type AutonomyFacts = z.infer<typeof autonomyFactsSchema>;

export type AutonomyVerdict = "auto" | "escalate" | "refuse";

/** Numeric factor values actually used; J is present only when it entered the minimum. */
export type AutonomyFactorScores = {
  R: number;
  B: number;
  E: number;
  C: number;
  J?: number;
};

export type AutonomyDecision = {
  readonly verdict: AutonomyVerdict;
  readonly class: string;
  readonly subject: string;
  readonly score: number;
  /** null for human-always classes and refusals (no threshold applies). */
  readonly threshold: number | null;
  readonly factors: AutonomyFactorScores;
  readonly reasons: readonly string[];
};

const ZERO_FACTORS: AutonomyFactorScores = { R: 0, B: 0, E: 0, C: 0 };

function refuse(classId: string, subject: string, reason: string): AutonomyDecision {
  return { verdict: "refuse", class: classId, subject, score: 0, threshold: null, factors: { ...ZERO_FACTORS }, reasons: [reason] };
}

// reason: worse-of, because the class's declared path is a ceiling and a measured loss path must win
// — see AC-AU-1 hard rules; do not "simplify" to either side alone.
function worseRecoverability(declared: Recoverability, measured: Recoverability): Recoverability {
  return RECOVERABILITY_SCORE[measured] < RECOVERABILITY_SCORE[declared] ? measured : declared;
}

/**
 * Decide whether an operation may run unattended.
 *
 * @param classId - operation class id (a key of `registry`); unknown -> refuse
 * @param subject - the object operated on (e.g. a stash ref, task slug); non-empty
 * @param facts - measured facts; unknown shape -> refuse (typed `unknown` so callers cannot skip validation)
 * @param registry - injectable for tests and later governed-data phases; defaults to the seeded table
 * @returns a decision with exact verdict, score, factor values and human-readable reasons
 * @example
 * decide("stash-drop", "stash@{3}", {
 *   recoverability: "loss-free-by-proof", blast: "own-or-ended-run",
 *   evidence: "lore-evaluated", confidence: 0.95,
 * }); // -> { verdict: "auto", score: 0.9, ... }
 */
export function decide(
  classId: string,
  subject: string,
  facts: unknown,
  registry: OperationClassRegistry = OPERATION_CLASS_REGISTRY,
): AutonomyDecision {
  const operationClass = Object.hasOwn(registry, classId) ? registry[classId] : undefined;
  if (operationClass === undefined) return refuse(classId, subject, `unknown class "${classId}"`);
  if (subject.length === 0) return refuse(classId, subject, "subject must be non-empty");

  const parsed = autonomyFactsSchema.safeParse(facts);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return refuse(classId, subject, `malformed facts at "${issue?.path.join(".") ?? ""}": ${issue?.message ?? "invalid"}`);
  }
  const measured = parsed.data;

  if (operationClass.tier === "human-always") {
    return {
      verdict: "escalate", class: classId, subject, score: 0, threshold: null, factors: { ...ZERO_FACTORS },
      reasons: [`class "${classId}" is human-always: every instance goes to the human`],
    };
  }

  const recoverability =
    measured.recoverability === undefined
      ? undefined
      : worseRecoverability(operationClass.declaredRecoverability, measured.recoverability);
  const factors: AutonomyFactorScores = {
    R: recoverability === undefined ? 0 : RECOVERABILITY_SCORE[recoverability],
    B: measured.blast === undefined ? 0 : BLAST_SCORE[measured.blast],
    E: measured.evidence === undefined ? 0 : EVIDENCE_SCORE[measured.evidence],
    C: measured.confidence ?? 0,
  };
  const reasons: string[] = [];
  const unmeasured = (["R", "B", "E", "C"] as const).filter((key) => {
    const fact = { R: recoverability, B: measured.blast, E: measured.evidence, C: measured.confidence }[key];
    return fact === undefined;
  });
  if (unmeasured.length > 0) reasons.push(`unmeasured required factor(s) score 0: ${unmeasured.join(", ")}`);

  if (measured.judge !== undefined) {
    if (operationClass.usesJudge) factors.J = JUDGE_SCORE[measured.judge];
    else reasons.push(`judge fact ignored: class "${classId}" does not use a judge`);
  }

  // Hard rules precede the score (AC-AU-1).
  if (recoverability === "irreversible-external") {
    return { verdict: "escalate", class: classId, subject, score: 0, threshold: operationClass.threshold, factors,
      reasons: [...reasons, "hard rule: irreversible-external always escalates"] };
  }
  if (
    recoverability === "irreversible-local" &&
    measured.blast !== undefined &&
    BEYOND_OWN_SESSION_BLAST.includes(measured.blast)
  ) {
    return { verdict: "escalate", class: classId, subject, score: 0, threshold: operationClass.threshold, factors,
      reasons: [...reasons, `hard rule: irreversible-local with blast radius beyond own session (${measured.blast}) escalates`] };
  }

  const score = Math.min(...Object.values(factors));
  const auto = score >= operationClass.threshold;
  reasons.push(`score ${score} (min of ${Object.keys(factors).join(",")}) ${auto ? ">=" : "<"} threshold ${operationClass.threshold}`);
  return { verdict: auto ? "auto" : "escalate", class: classId, subject, score, threshold: operationClass.threshold, factors, reasons };
}
