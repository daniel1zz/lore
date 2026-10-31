/**
 * Known defects: the plan's own record of the GitHub issues it was accepted with (BR-1421, BR-1372, BR-1379).
 *
 * Purpose: a plan whose milestone review fails closes "accepted with known defects" once every failed dimension has an
 *   open GitHub issue recorded for it. That record is a fact ABOUT the plan, not work, so it lives on the plan itself
 *   as `extra.known_defects`; no corpus document carries it and no link type names it.
 * Public surface: {@link knownDefectEntrySchema}, {@link KnownDefectEntry}, {@link KNOWN_DEFECTS_FIELD},
 *   {@link judgeKnownDefectsExtra}, {@link readKnownDefects}, {@link knownDefectKey}, {@link appendKnownDefects},
 *   {@link partitionKnownDefectsAtClose} (BR-1510: which entries a closing plan keeps).
 * Invariants:
 *   - `extra.known_defects` is an array of `{repo_id, number, dimension, fingerprint}`; `dimension` is one of the
 *     milestone review dimensions; the triple (repo_id, number, dimension) is unique within the array.
 *   - Only a plan carries the field; any other document type refuses it, naming `extra.known_defects`.
 *   - {@link appendKnownDefects} is idempotent by key: an entry whose key is already present is not added twice.
 * Side-effect class: pure.
 *
 * @spec_ref spec-a-plan-s-known-defects-are-its-own-record-of-github-issues (AC-KD-1, D1, D2)
 */

import { z } from "zod";
import type { LoreError } from "./errors.js";
import { MILESTONE_DIMENSIONS, type MilestoneDimension } from "./milestone-review.js";

/** The `extra` key a plan stores its known defects under. */
export const KNOWN_DEFECTS_FIELD = "known_defects";

/** One failed dimension of the plan, filed as one GitHub issue. `repo_id` is GitHub's numeric repository id. */
export const knownDefectEntrySchema = z.object({
  repo_id: z.number().int().positive(),
  number: z.number().int().positive(),
  dimension: z.enum(MILESTONE_DIMENSIONS),
  fingerprint: z.string().min(1),
  /**
   * A RECORD ONLY: `lore assess --accept-gate` flags the known defect once the decision log holds the human accept (BR-1500,
   * "recorded on the plan"). No reader gives it any authority (#538): a gate is accepted only when the decision log holds an
   * effective human accept for it, so a flag planted by a direct write of `extra` closes nothing.
   */
  gate_accepted: z.literal(true).optional(),
});
export type KnownDefectEntry = z.infer<typeof knownDefectEntrySchema>;

/** The uniqueness key of an entry: `<repo_id>#<number>/<dimension>`. */
export function knownDefectKey(entry: Pick<KnownDefectEntry, "repo_id" | "number" | "dimension">): string {
  return `${String(entry.repo_id)}#${String(entry.number)}/${entry.dimension}`;
}

/**
 * Judges the `extra.known_defects` of an `extra` bag about to be written to a document of `docType`.
 *
 * @param docType - type of the document being created or patched
 * @param extra - the `extra` bag the write carries (`undefined` = nothing to judge)
 * @returns a VALIDATION_ERROR naming `extra.known_defects` (and the offending entry), or `undefined` when acceptable
 */
export function judgeKnownDefectsExtra(docType: string, extra: Record<string, unknown> | undefined): LoreError | undefined {
  if (extra === undefined) return undefined;
  if (!(KNOWN_DEFECTS_FIELD in extra)) return undefined;
  const value = extra[KNOWN_DEFECTS_FIELD];
  const refuse = (message: string): LoreError => ({ code: "VALIDATION_ERROR", field: `extra.${KNOWN_DEFECTS_FIELD}`, message, value });
  if (docType !== "plan") {
    return refuse(`extra.known_defects is allowed only on a plan (a ${docType} does not record known defects)`);
  }
  if (!Array.isArray(value)) return refuse("extra.known_defects must be an array of {repo_id, number, dimension, fingerprint}");
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const parsed = knownDefectEntrySchema.safeParse(entry);
    if (!parsed.success) {
      return refuse(
        `extra.known_defects[${String(index)}] ${JSON.stringify(entry)} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} (dimension must be one of ${MILESTONE_DIMENSIONS.join(", ")})`,
      );
    }
    const key = knownDefectKey(parsed.data);
    if (seen.has(key)) return refuse(`extra.known_defects[${String(index)}] duplicates ${key}`);
    seen.add(key);
  }
  return undefined;
}

/**
 * The valid entries of a plan's `extra.known_defects`, in stored order; `[]` when absent or not an array. A malformed
 * element is skipped (the write path refuses a malformed record, so malformed data is hand-edited and must never abort
 * a read already underway).
 *
 * @param extra - a document's `extra`
 */
export function readKnownDefects(extra: unknown): KnownDefectEntry[] {
  if (extra === null || typeof extra !== "object") return [];
  const raw = (extra as Record<string, unknown>)[KNOWN_DEFECTS_FIELD];
  if (!Array.isArray(raw)) return [];
  const entries: KnownDefectEntry[] = [];
  for (const element of raw) {
    const parsed = knownDefectEntrySchema.safeParse(element);
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}

/** What the closing review says about one dimension, as {@link partitionKnownDefectsAtClose} reads it. */
export interface ClosingDimensionFacts {
  readonly verdict: "pass" | "fail" | "not-measured" | "na";
  /** The root-cause fingerprints the review's failing finding of this dimension has; empty unless `verdict` is `fail`. */
  readonly failingFingerprints: readonly string[];
}

/** A known defect the closing review no longer has the cause of, with the verdict that detaches it. */
export interface DetachedKnownDefect {
  readonly entry: KnownDefectEntry;
  /** The closing review's verdict for the entry's dimension (`pass`, or `fail` with another cause). */
  readonly verdict: "pass" | "fail";
}

/** Result of {@link partitionKnownDefectsAtClose}. */
export interface KnownDefectsAtClose {
  readonly kept: readonly KnownDefectEntry[];
  readonly detached: readonly DetachedKnownDefect[];
}

/**
 * Splits a closing plan's known defects by its closing review (BR-1510).
 *
 * An entry is detached only when the review MEASURED its dimension and no longer has its cause: the verdict is `pass`,
 * or `fail` with a set of fingerprints that does not include the entry's. It is kept when its fingerprint is a failing
 * cause, when the dimension is `not-measured` or `na`, when the review has no fact for the dimension, or when it is a
 * gate accepted with `--accept-gate` (`acceptedGates`; a regression only while its file is still red): not measured is never read as fixed.
 *
 * @param entries - the plan's known defects, in stored order
 * @param facts - the closing review's verdict and failing fingerprints per dimension
 * @param acceptedGates - the gate dimensions the plan accepted for this review (`acceptedGatesOf`)
 * @returns the kept entries and the detached ones, each in stored order
 */
export function partitionKnownDefectsAtClose(
  entries: readonly KnownDefectEntry[],
  facts: Readonly<Partial<Record<MilestoneDimension, ClosingDimensionFacts>>>,
  acceptedGates: readonly MilestoneDimension[],
): KnownDefectsAtClose {
  const kept: KnownDefectEntry[] = [];
  const detached: DetachedKnownDefect[] = [];
  for (const entry of entries) {
    const fact = facts[entry.dimension];
    // reason: BR-1513 — a REGRESSION is accepted file by file, so an accepted regression gate shields an entry only while its file
    // is still red: the entry of a file that is no longer red is detached even though the gate stays accepted. Every other
    // gate keeps its entries as before (one cause per gate).
    const staleUnderAcceptedGate =
      entry.dimension === "regression" &&
      fact !== undefined &&
      fact.verdict === "fail" &&
      fact.failingFingerprints.length > 0 &&
      !fact.failingFingerprints.includes(entry.fingerprint);
    if (fact === undefined || (acceptedGates.includes(entry.dimension) && !staleUnderAcceptedGate)) {
      kept.push(entry);
      continue;
    }
    if (fact.verdict === "pass") {
      detached.push({ entry, verdict: "pass" });
    } else if (fact.verdict === "fail" && !fact.failingFingerprints.includes(entry.fingerprint)) {
      detached.push({ entry, verdict: "fail" });
    } else {
      kept.push(entry);
    }
  }
  return { kept, detached };
}

/**
 * `existing` plus every `additions` entry whose key is not yet present (idempotent by key).
 *
 * @param existing - the entries already recorded
 * @param additions - the entries to record
 * @returns the merged list, or `existing` itself (same reference) when nothing is new
 */
export function appendKnownDefects(existing: readonly KnownDefectEntry[], additions: readonly KnownDefectEntry[]): readonly KnownDefectEntry[] {
  const keys = new Set(existing.map(knownDefectKey));
  const fresh: KnownDefectEntry[] = [];
  for (const entry of additions) {
    const key = knownDefectKey(entry);
    if (keys.has(key)) continue;
    keys.add(key);
    fresh.push(entry);
  }
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}
