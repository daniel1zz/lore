/**
 * Root-cause fingerprints of failed milestone findings (BR-1379; reference: Sentry error grouping by fingerprint).
 *
 * Purpose: give every failed finding a stable identity so a batch files ONE issue per root cause and links it to
 *   every plan that shares it, never one per plan and dimension.
 * Public surface: {@link FailedFinding}, {@link RootCause}, {@link rootCauseOf}, {@link splitFindingByFile},
 *   {@link rootCausesOf}, {@link failingCausesOf}, {@link issueTitleOf}, {@link FINGERPRINT_TITLE_TAG}, {@link fingerprintTag}.
 * Invariants:
 *   - Fingerprint = SHA-256 of `<dimension>|<cause key>`. Cause key by dimension: `regression` charged with files ->
 *     `file:<repo path>` for ONE file, independent of the plan and of every other file (BR-1513; label `main red: <path>`),
 *     so a plan charged with several files has several causes ({@link splitFindingByFile}, {@link rootCausesOf});
 *     `snapshot_accuracy` -> the sorted set of contradicted rule ids; every other dimension (and a regression the
 *     selection did not charge files for) -> the sorted, unique STRUCTURED cites the judge named (AC ids, rule ids, paths,
 *     symbols), never the finding's wording; no cite is a VALIDATION_ERROR (the plan is re-reviewed).
 *   - The causes come from the MEASURED `causes` stored on the review, never from the judge's prose, whenever the
 *     dimension has a measured cause.
 *   - The issue title starts with the dimension id (plan close covers a failed dimension by finding it in an open
 *     linked issue's title) and ends with `[fp:<12 hex>]` so an open issue can be found from titles alone; the full
 *     fingerprint is in the body.
 * Side-effect class: pure.
 */

import { createHash } from "node:crypto";
import type { LoreError, MilestoneDimension, MilestoneReview, ReviewCauses, Result } from "@lore/core";
import { err, ok } from "@lore/core";

/** One failed dimension of one plan's stored review, as the filing sees it. */
export interface FailedFinding {
  readonly plan: string;
  readonly dimension: MilestoneDimension;
  readonly reason: string;
  readonly reference: string;
  /** The judge's structured cites (AC ids, rule ids, paths, symbols); absent on a review stored before they existed. */
  readonly cites?: readonly string[] | undefined;
  readonly reviewSlug: string;
  /** The review's measured root causes; absent on a review stored before grouping existed. */
  readonly causes?: ReviewCauses | undefined;
}

/** The identity of a finding's root cause. */
export interface RootCause {
  readonly dimension: MilestoneDimension;
  /** SHA-256 hex of `<dimension>|<cause key>`. */
  readonly fingerprint: string;
  /** First 12 hex characters: the tag carried in the issue title. */
  readonly short: string;
  /** Human label of the cause (`main red: a.test.ts, b.test.ts`, `contradicted rules: BR-1`, ...). */
  readonly label: string;
}

/** The title tag that makes an open issue findable by fingerprint: `[fp:<12 hex>]`. */
export function fingerprintTag(short: string): string {
  return `[fp:${short}]`;
}

/** Marker of the tag inside a title (`[fp:`), exported so the issue search and the title builder agree. */
export const FINGERPRINT_TITLE_TAG = "[fp:";

/** The finding's cites, trimmed, de-duplicated and sorted so order and spacing never split a cause. */
function normalisedCites(cites: readonly string[] | undefined): string[] {
  return [...new Set((cites ?? []).map((c) => c.trim()).filter((c) => c !== ""))].sort();
}

function digest(dimension: MilestoneDimension, key: string): { fingerprint: string; short: string } {
  const fingerprint = createHash("sha256").update(`${dimension}|${key}`).digest("hex");
  return { fingerprint, short: fingerprint.slice(0, 12) };
}

/**
 * The root cause of one failed finding. A regression finding is one cause per FILE: a finding that carries several
 * charged files is split first ({@link splitFindingByFile}); handing this function several files is a caller defect.
 *
 * @param finding - a failed dimension with its review's measured causes (a regression finding carries at most one file)
 * @returns the cause, or a VALIDATION_ERROR when a regression finding still carries more than one charged file
 * @example
 * rootCauseOf({ plan: "p", dimension: "regression", reason: "x", reference: "", reviewSlug: "r",
 *   causes: { regression_files: ["a.test.ts"] } }); // ok, label "main red: a.test.ts", key "file:a.test.ts"
 */
export function rootCauseOf(finding: FailedFinding): Result<RootCause, LoreError> {
  const { dimension } = finding;
  const files = finding.causes?.regression_files;
  if (dimension === "regression" && files !== undefined && files.length > 0) {
    const unique = [...new Set(files)];
    const [file] = unique;
    // reason: BR-1513 — the identity is ONE file. A finding with several files has no single identity, and keying it by their
    // set is the defect this rule removed (#556: one still-red file re-filed under every new set), so it fails loud.
    if (file === undefined || unique.length !== 1) {
      return err({
        code: "VALIDATION_ERROR",
        field: "causes.regression_files",
        message: `the regression finding of ${finding.reviewSlug} carries ${String(unique.length)} files; a root cause is one file, so the finding must be split by file first`,
        rule: "BR-1513",
      });
    }
    return ok({ dimension, ...digest(dimension, `file:${file}`), label: `main red: ${file}` });
  }
  const rules = finding.causes?.contradicted_rules;
  if (dimension === "snapshot_accuracy" && rules !== undefined && rules.length > 0) {
    const sorted = [...new Set(rules)].sort();
    return ok({ dimension, ...digest(dimension, `rules:${sorted.join(",")}`), label: `contradicted rules: ${sorted.join(", ")}` });
  }
  const cites = normalisedCites(finding.cites);
  if (cites.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "cites",
      message: `the stored review ${finding.reviewSlug} failed ${dimension} without any cite (AC id, rule id, file path or symbol); a judge-text finding is never fingerprinted by its wording, so the plan needs a new review`,
      rule: "BR-1379",
    });
  }
  // reason: the title label is the finding's ORIGINAL summary (#346) but the fingerprint never reads it: wording changes
  // on every re-review and split one defect into several issues (#405; Sentry: grouping key is not the display title).
  const display = finding.reason.replace(/\s+/g, " ").trim().slice(0, 80);
  return ok({ dimension, ...digest(dimension, `cites:${cites.join(",")}`), label: display });
}

/**
 * Splits a regression finding into one finding per charged file (BR-1513); any other finding is returned as is.
 *
 * @param finding - a failed finding
 * @returns one finding per distinct charged file, sorted by path, each carrying only its own file; `[finding]` when the
 *   finding is not a regression or no file was charged to it (a not-measured regression stays cites-keyed)
 */
export function splitFindingByFile(finding: FailedFinding): FailedFinding[] {
  const files = finding.causes?.regression_files;
  if (finding.dimension !== "regression" || files === undefined || files.length === 0) return [finding];
  return [...new Set(files)].sort().map((file) => ({ ...finding, causes: { ...finding.causes, regression_files: [file] } }));
}

/**
 * Every root cause of one failed finding: one per charged file for a regression, one otherwise.
 *
 * @returns the causes in {@link splitFindingByFile} order, or the first VALIDATION_ERROR (a cause that cannot be identified)
 */
export function rootCausesOf(finding: FailedFinding): Result<RootCause[], LoreError> {
  const causes: RootCause[] = [];
  for (const part of splitFindingByFile(finding)) {
    const cause = rootCauseOf(part);
    if (!cause.ok) return cause;
    causes.push(cause.value);
  }
  return ok(causes);
}

/**
 * The root causes a stored review's failing `dimension` has today: the one list close, coverage and acceptance all read.
 *
 * @param planSlug - the plan under review (finding identity input; no fingerprint reads it)
 * @param reviewSlug - the stored review's slug
 * @param review - the stored review
 * @param dimension - the dimension to read
 * @returns the causes; the first VALIDATION_ERROR when one cannot be identified
 */
export function failingCausesOf(planSlug: string, reviewSlug: string, review: Pick<MilestoneReview, "dimensions" | "causes">, dimension: MilestoneDimension): Result<RootCause[], LoreError> {
  const judgment = review.dimensions[dimension];
  return rootCausesOf({ plan: planSlug, dimension, reason: judgment.reason, reference: judgment.reference, cites: judgment.cites, reviewSlug, causes: review.causes });
}

/** The issue title of a root cause: `<dimension>: <label> [fp:<12 hex>]`. */
export function issueTitleOf(cause: RootCause): string {
  return `${cause.dimension}: ${cause.label.slice(0, 120)} ${fingerprintTag(cause.short)}`;
}
