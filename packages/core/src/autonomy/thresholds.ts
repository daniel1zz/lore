/**
 * Governed thresholds — the shape, seed and change classification of the ONE governed autonomy record.
 *
 * Purpose: class tiers, thresholds, priors and the worktree-remove regenerable patterns are GOVERNED DATA (ADR D8):
 *   one record, written only through lore. This module owns what that record IS (schema), what it is seeded from
 *   (the code table in classes.ts) and whether a proposed change tightens or loosens it. Storage, hashing and the
 *   integrity chain live in the lore package (service/autonomy-threshold-service.ts).
 * Public surface: governedThresholdsSchema, GovernedThresholds, seedGovernedThresholds, registryOf,
 *   diffGovernedThresholds, ThresholdChange, applyClassEdit, retireClass, ClassEdit.
 * Invariants:
 *   - A change is `loosened` when it lets an operation reach `auto` more easily or lets more ignored data count as
 *     regenerable: lower threshold, higher prior confidence, higher declared recoverability, a tier moved toward
 *     milestone (human-always -> normal -> milestone), a judge turned off, a class or a regenerable pattern ADDED
 *     (a new automatic path), a human-always class RETIRED (its human gate disappears). Everything else that
 *     differs is `tightened`. Loosening is `governance-loosen` (human-always); tightening applies with an auto record.
 *   - The seed is a COPY of the code table: mutating the result never mutates the registry constants.
 * Side-effect class: pure (no IO, no Node builtin, browser-safe).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-9;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D8.
 */
import { z } from "zod";
import {
  OPERATION_CLASS_REGISTRY,
  RECOVERABILITY_SCORE,
  WORKTREE_REMOVE_REGENERABLE_PATTERNS,
  type OperationClass,
  type OperationClassRegistry,
} from "./classes.js";

type RecoverabilityKey = keyof typeof RECOVERABILITY_SCORE;
const recoverabilitySchema = z.enum(Object.keys(RECOVERABILITY_SCORE) as [RecoverabilityKey, ...RecoverabilityKey[]]);

const humanAlwaysClassSchema = z.object({ tier: z.literal("human-always"), usesJudge: z.boolean() }).strict();
const milestoneClassSchema = z.object({ tier: z.literal("milestone"), usesJudge: z.boolean() }).strict();
const normalClassSchema = z
  .object({
    tier: z.literal("normal"),
    declaredRecoverability: recoverabilitySchema,
    threshold: z.number().min(0).max(1),
    priorConfidence: z.number().min(0).max(1),
    usesJudge: z.boolean(),
  })
  .strict();

/** The stored record. `version` is the record schema version, not a write counter. */
export const governedThresholdsSchema = z
  .object({
    version: z.literal(1),
    classes: z.record(z.string().min(1), z.discriminatedUnion("tier", [humanAlwaysClassSchema, milestoneClassSchema, normalClassSchema])),
    worktreeRemoveRegenerable: z.array(z.string().min(1)),
  })
  .strict();
export type GovernedThresholds = z.infer<typeof governedThresholdsSchema>;

/** The record as the code table seeds it (a deep copy). */
export function seedGovernedThresholds(): GovernedThresholds {
  const classes: Record<string, OperationClass> = {};
  for (const [id, operationClass] of Object.entries(OPERATION_CLASS_REGISTRY)) classes[id] = { ...operationClass };
  return { version: 1, classes, worktreeRemoveRegenerable: [...WORKTREE_REMOVE_REGENERABLE_PATTERNS] };
}

/** The registry decide() takes, from a record. */
export function registryOf(record: GovernedThresholds): OperationClassRegistry {
  // reason: a corpus seeded before a class joined the code table has a stored record without it; decide() would then refuse
  // the class as unknown. A code-table class the record lacks is decided as the table declares it (the record still wins
  // wherever it names the class). retireClass already refuses to retire a class the table still has, so nothing is undone.
  const missing = Object.entries(OPERATION_CLASS_REGISTRY).filter(([id]) => !Object.hasOwn(record.classes, id));
  return missing.length === 0 ? record.classes : { ...Object.fromEntries(missing), ...record.classes };
}

/**
 * How hard a tier binds: a move to a higher value is a tightening, to a lower one a loosening.
 * reason: `milestone` is the LOOSEST tier — the guarded action applies at once and only a record is left for review —
 * so moving a class to it (from normal or human-always) is a loosening and escalates as governance-loosen.
 */
const TIER_STRICTNESS: Readonly<Record<OperationClass["tier"], number>> = { milestone: 0, normal: 1, "human-always": 2 };

export interface ThresholdChange {
  /** Human-readable lines, one per loosening edit. Non-empty -> the whole change is a loosening. */
  readonly loosened: readonly string[];
  readonly tightened: readonly string[];
}

/** Classifies every difference between two records. Equal records -> both lists empty. */
export function diffGovernedThresholds(before: GovernedThresholds, after: GovernedThresholds): ThresholdChange {
  const loosened: string[] = [];
  const tightened: string[] = [];
  const ids = new Set([...Object.keys(before.classes), ...Object.keys(after.classes)]);
  for (const id of [...ids].sort()) {
    const was = before.classes[id];
    const now = after.classes[id];
    if (was === undefined && now !== undefined) {
      (now.tier === "human-always" ? tightened : loosened).push(`${id}: class added (${now.tier})`);
      continue;
    }
    if (was !== undefined && now === undefined) {
      // reason: retiring a human-always class drops a human gate (loosening); retiring any other class only makes decide() refuse it.
      (was.tier === "human-always" ? loosened : tightened).push(`${id}: class removed (decide() will refuse it)`);
      continue;
    }
    if (was === undefined || now === undefined) continue;
    if (was.tier !== now.tier) (TIER_STRICTNESS[now.tier] > TIER_STRICTNESS[was.tier] ? tightened : loosened).push(`${id}.tier: ${was.tier} -> ${now.tier}`);
    if (was.usesJudge !== now.usesJudge) (now.usesJudge ? tightened : loosened).push(`${id}.usesJudge: ${was.usesJudge} -> ${now.usesJudge}`);
    if (was.tier !== "normal" || now.tier !== "normal") continue;
    if (now.threshold !== was.threshold) (now.threshold > was.threshold ? tightened : loosened).push(`${id}.threshold: ${was.threshold} -> ${now.threshold}`);
    if (now.priorConfidence !== was.priorConfidence) {
      (now.priorConfidence < was.priorConfidence ? tightened : loosened).push(`${id}.priorConfidence: ${was.priorConfidence} -> ${now.priorConfidence}`);
    }
    if (now.declaredRecoverability !== was.declaredRecoverability) {
      const lower = RECOVERABILITY_SCORE[now.declaredRecoverability] < RECOVERABILITY_SCORE[was.declaredRecoverability];
      (lower ? tightened : loosened).push(`${id}.declaredRecoverability: ${was.declaredRecoverability} -> ${now.declaredRecoverability}`);
    }
  }
  const wasPatterns = new Set(before.worktreeRemoveRegenerable);
  const nowPatterns = new Set(after.worktreeRemoveRegenerable);
  for (const pattern of nowPatterns) if (!wasPatterns.has(pattern)) loosened.push(`worktreeRemoveRegenerable: + ${pattern}`);
  for (const pattern of wasPatterns) if (!nowPatterns.has(pattern)) tightened.push(`worktreeRemoveRegenerable: - ${pattern}`);
  return { loosened, tightened };
}

/**
 * Removes class `classId` from `record` (returns a NEW record) — for a class the code table no longer has.
 *
 * @returns a message when the class is unknown in the record, or when `codeTable` still defines it (a live class is
 *   edited with {@link applyClassEdit}, never retired). The change itself is classified by {@link diffGovernedThresholds}:
 *   retiring a human-always class is a loosening.
 */
export function retireClass(
  record: GovernedThresholds,
  classId: string,
  codeTable: OperationClassRegistry = OPERATION_CLASS_REGISTRY,
): { readonly ok: true; readonly record: GovernedThresholds } | { readonly ok: false; readonly message: string } {
  if (!Object.hasOwn(record.classes, classId)) return { ok: false, message: `unknown class "${classId}" (known: ${Object.keys(record.classes).join(", ")})` };
  if (Object.hasOwn(codeTable, classId)) return { ok: false, message: `class "${classId}" is still in the code class table: edit it with --tier/--threshold, retire only a class the table no longer has` };
  const { [classId]: _retired, ...rest } = record.classes;
  return { ok: true, record: { ...record, classes: rest } };
}

/** Fields `lore autonomy set` may edit on one class. */
export interface ClassEdit {
  readonly tier?: "normal" | "human-always" | "milestone";
  readonly threshold?: number;
  readonly priorConfidence?: number;
  readonly declaredRecoverability?: RecoverabilityKey;
  readonly usesJudge?: boolean;
}

/**
 * Applies `edit` to `record`'s class `classId` and returns a NEW record (input untouched), or a message naming why
 * the edit cannot apply: unknown class, a normal-only field on a human-always class, or a value out of range.
 */
export function applyClassEdit(
  record: GovernedThresholds,
  classId: string,
  edit: ClassEdit,
): { readonly ok: true; readonly record: GovernedThresholds } | { readonly ok: false; readonly message: string } {
  const current = Object.hasOwn(record.classes, classId) ? record.classes[classId] : undefined;
  if (current === undefined) return { ok: false, message: `unknown class "${classId}" (known: ${Object.keys(record.classes).join(", ")})` };
  const tier = edit.tier ?? current.tier;
  const usesJudge = edit.usesJudge ?? current.usesJudge;
  let next: OperationClass;
  if (tier === "human-always") {
    if (edit.threshold !== undefined || edit.priorConfidence !== undefined || edit.declaredRecoverability !== undefined) {
      return { ok: false, message: `class "${classId}" would be human-always: threshold, prior and recoverability do not apply to it` };
    }
    next = { tier: "human-always", usesJudge };
  } else if (tier === "milestone") {
    if (edit.threshold !== undefined || edit.priorConfidence !== undefined || edit.declaredRecoverability !== undefined) {
      return { ok: false, message: `class "${classId}" would be milestone: threshold, prior and recoverability do not apply to it` };
    }
    next = { tier: "milestone", usesJudge };
  } else {
    const base = current.tier === "normal" ? current : undefined;
    const threshold = edit.threshold ?? base?.threshold;
    const priorConfidence = edit.priorConfidence ?? base?.priorConfidence;
    const declaredRecoverability = edit.declaredRecoverability ?? base?.declaredRecoverability;
    if (threshold === undefined || priorConfidence === undefined || declaredRecoverability === undefined) {
      return { ok: false, message: `class "${classId}" is ${current.tier}; turning it normal needs threshold, prior and recoverability all given` };
    }
    next = { tier: "normal", threshold, priorConfidence, declaredRecoverability, usesJudge };
  }
  const candidate = { ...record, classes: { ...record.classes, [classId]: next } };
  const checked = governedThresholdsSchema.safeParse(candidate);
  if (!checked.success) return { ok: false, message: checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, record: checked.data };
}
