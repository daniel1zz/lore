/**
 * Root-cause fingerprints of failed milestone findings (BR-1379; reference: Sentry error grouping by fingerprint).
 *
 * Purpose: give every failed finding a stable identity so a batch files ONE issue per root cause and links it to
 *   every plan that shares it, never one per plan and dimension.
 * Public surface: {@link FailedFinding}, {@link RootCause}, {@link rootCauseOf}, {@link issueTitleOf},
 *   {@link FINGERPRINT_TITLE_TAG}, {@link fingerprintTag}.
 * Invariants:
 *   - Fingerprint = SHA-256 of `<dimension>|<cause key>`. Cause key by dimension: `regression` -> the sorted set of
 *     failing test files attributed to the plan ("main red: <files>", one fingerprint for a failing main suite);
 *     `snapshot_accuracy` -> the sorted set of contradicted rule ids; every other dimension (and a regression the
 *     suite did not measure) -> the sorted cited symbols/paths plus the normalised summary.
 *   - The causes come from the MEASURED `causes` stored on the review, never from the judge's prose, whenever the
 *     dimension has a measured cause.
 *   - The issue title starts with the dimension id (plan close covers a failed dimension by finding it in an open
 *     linked issue's title) and ends with `[fp:<12 hex>]` so an open issue can be found from titles alone; the full
 *     fingerprint is in the body.
 * Side-effect class: pure.
 */

import { createHash } from "node:crypto";
import type { MilestoneDimension, ReviewCauses } from "@lore/core";

/** One failed dimension of one plan's stored review, as the filing sees it. */
export interface FailedFinding {
  readonly plan: string;
  readonly dimension: MilestoneDimension;
  readonly reason: string;
  readonly reference: string;
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

const PATH_OR_SYMBOL = /`([^`]+)`|((?:[\w.-]+\/)+[\w.-]+)|\b([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$.]*)\b/g;

/** Cited symbols and paths in a finding's text: backticked tokens, slash paths and dotted names; sorted, unique. */
function citedTokens(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PATH_OR_SYMBOL)) {
    const token = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (token !== "") found.add(token);
  }
  return [...found].sort();
}

/** Lower-case summary with ids, hashes and numbers removed so a cosmetic difference does not split a cause. */
function normaliseSummary(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/\b[0-9a-f]{7,}\b/g, "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function digest(dimension: MilestoneDimension, key: string): { fingerprint: string; short: string } {
  const fingerprint = createHash("sha256").update(`${dimension}|${key}`).digest("hex");
  return { fingerprint, short: fingerprint.slice(0, 12) };
}

/**
 * The root cause of one failed finding.
 *
 * @param finding - a failed dimension with its review's measured causes
 * @example
 * rootCauseOf({ plan: "p", dimension: "regression", reason: "x", reference: "", reviewSlug: "r",
 *   causes: { regression_files: ["b.test.ts", "a.test.ts"] } }).label; // => "main red: a.test.ts, b.test.ts"
 */
export function rootCauseOf(finding: FailedFinding): RootCause {
  const { dimension } = finding;
  const files = finding.causes?.regression_files;
  if (dimension === "regression" && files !== undefined && files.length > 0) {
    const sorted = [...new Set(files)].sort();
    return { dimension, ...digest(dimension, `files:${sorted.join(",")}`), label: `main red: ${sorted.join(", ")}` };
  }
  const rules = finding.causes?.contradicted_rules;
  if (dimension === "snapshot_accuracy" && rules !== undefined && rules.length > 0) {
    const sorted = [...new Set(rules)].sort();
    return { dimension, ...digest(dimension, `rules:${sorted.join(",")}`), label: `contradicted rules: ${sorted.join(", ")}` };
  }
  const cited = citedTokens(`${finding.reason}\n${finding.reference}`);
  const summary = normaliseSummary(finding.reason);
  return { dimension, ...digest(dimension, `cited:${cited.join(",")}|summary:${summary}`), label: summary.slice(0, 80) };
}

/** The issue title of a root cause: `<dimension>: <label> [fp:<12 hex>]`. */
export function issueTitleOf(cause: RootCause): string {
  return `${cause.dimension}: ${cause.label.slice(0, 120)} ${fingerprintTag(cause.short)}`;
}
