/**
 * Root-cause fingerprints of failed milestone findings (BR-1379; reference: Sentry error grouping by fingerprint).
 *
 * Purpose: give every failed finding a stable identity so a batch files ONE issue per root cause and links it to
 *   every plan that shares it, never one per plan and dimension.
 * Public surface: {@link FailedFinding}, {@link RootCause}, {@link rootCauseOf}, {@link issueTitleOf},
 *   {@link FINGERPRINT_TITLE_TAG}, {@link fingerprintTag}.
 * Invariants:
 *   - Fingerprint = SHA-256 of `<dimension>|<cause key>`. Cause key by dimension: `regression` -> the sorted set of
 *     ALL failing test files of the suite run (an attributed regression without that set is an error, never a fallback) ("main red: <files>", one fingerprint for a failing main suite);
 *     `snapshot_accuracy` -> the sorted set of contradicted rule ids; every other dimension (and a regression the
 *     suite did not measure) -> the sorted, unique STRUCTURED cites the judge named (AC ids, rule ids, paths, symbols),
 *     never the finding's wording; no cite is a VALIDATION_ERROR (the plan is re-reviewed).
 *   - The causes come from the MEASURED `causes` stored on the review, never from the judge's prose, whenever the
 *     dimension has a measured cause.
 *   - The issue title starts with the dimension id (plan close covers a failed dimension by finding it in an open
 *     linked issue's title) and ends with `[fp:<12 hex>]` so an open issue can be found from titles alone; the full
 *     fingerprint is in the body.
 * Side-effect class: pure.
 */

import { createHash } from "node:crypto";
import type { LoreError, MilestoneDimension, ReviewCauses, Result } from "@lore/core";
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
 * The root cause of one failed finding.
 *
 * @param finding - a failed dimension with its review's measured causes
 * @returns the cause, or a VALIDATION_ERROR when a measured failed regression lacks `suite_failing_files`
 * @example
 * rootCauseOf({ plan: "p", dimension: "regression", reason: "x", reference: "", reviewSlug: "r",
 *   causes: { regression_files: ["a.test.ts"], suite_failing_files: ["b.test.ts", "a.test.ts"] } }); // ok, label // => "main red: a.test.ts, b.test.ts"
 */
export function rootCauseOf(finding: FailedFinding): Result<RootCause, LoreError> {
  const { dimension } = finding;
  // reason: the suite run's WHOLE failing set is the cause (#345). A failed regression finding that has a measured
  // attribution (regression_files) but no suite_failing_files has no honest identity: the attributed subset would split
  // one run into several issues, so it fails loud instead of falling back (repo rule: no silent fallback).
  if (dimension === "regression" && finding.causes?.regression_files !== undefined && finding.causes.regression_files.length > 0) {
    const files = finding.causes.suite_failing_files;
    if (files === undefined || files.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "causes.suite_failing_files",
        message: `the stored review ${finding.reviewSlug} failed regression on a measured suite run but lacks suite_failing_files; it cannot be filed as one main-red issue`,
        rule: "BR-1379",
      });
    }
    const sorted = [...new Set(files)].sort();
    return ok({ dimension, ...digest(dimension, `files:${sorted.join(",")}`), label: `main red: ${sorted.join(", ")}` });
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

/** The issue title of a root cause: `<dimension>: <label> [fp:<12 hex>]`. */
export function issueTitleOf(cause: RootCause): string {
  return `${cause.dimension}: ${cause.label.slice(0, 120)} ${fingerprintTag(cause.short)}`;
}
