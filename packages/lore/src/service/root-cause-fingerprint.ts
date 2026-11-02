/**
 * Root-cause fingerprints of failed milestone findings (BR-1379; reference: Sentry error grouping by fingerprint).
 *
 * Purpose: give every failed finding a stable identity so a batch files ONE issue per root cause and links it to
 *   every plan that shares it, never one per plan and dimension.
 * Public surface: {@link FailedFinding}, {@link RootCause}, {@link rootCauseOf}, {@link splitFindingByFile},
 *   {@link rootCausesOf}, {@link failingCausesOf}, {@link judgedCausesOf}, {@link issueTitleOf}, {@link FINGERPRINT_TITLE_TAG}, {@link fingerprintTag}.
 * Invariants:
 *   - Fingerprint = SHA-256 of `<dimension>|<cause key>`. Cause key by dimension: `regression` charged with files ->
 *     `file:<repo path>` for ONE file, independent of the plan and of every other file (BR-1513; label `main red: <path>`),
 *     so a plan charged with several files has several causes ({@link splitFindingByFile}, {@link rootCausesOf});
 *     `snapshot_accuracy` -> the sorted set of contradicted rule ids; a judged dimension whose review recorded `causes.judged`
 *     (BR-1552, #629) -> ONE cause per recorded entry, keyed by unit input hashes (`unit:<path>:<hash>`, `cross-file:<hash>`,
 *     `plan:<hash>`, `criterion:<spec>:<ac>:<hash>`), never by cites, wording, model or template, so the same code and spec keep
 *     the same cause ({@link splitFindingByFile} splits a judged finding per entry); every other dimension (and a regression the
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
import type { JudgedCause, JudgeUnitRecord, LoreError, MilestoneDimension, MilestoneReview, ReviewCauses, Result } from "@lore/core";
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
  /** The failing units of a judged cause with their input hashes (BR-1552 S6); absent on a cites-, file- or rule-keyed cause. */
  readonly units?: readonly { readonly id: string; readonly input_sha256: string }[];
  /** The changed files the call-level verdict cited, on a cross-file cause. */
  readonly cited_files?: readonly string[];
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
  const judged = finding.causes?.judged?.[dimension];
  if (judged !== undefined && judged.length > 0) {
    const [entry] = judged;
    // reason: like BR-1513, the identity is ONE recorded cause; several entries must be split first ({@link splitFindingByFile}).
    if (entry === undefined || judged.length !== 1) {
      return err({
        code: "VALIDATION_ERROR",
        field: "causes.judged",
        message: `the ${dimension} finding of ${finding.reviewSlug} carries ${String(judged.length)} root causes; a root cause is one unit, so the finding must be split first`,
        rule: "BR-1552",
      });
    }
    return ok({
      dimension,
      ...digest(dimension, entry.key),
      label: entry.label,
      ...(entry.units.length > 0 ? { units: entry.units } : {}),
      ...(entry.cited_files !== undefined ? { cited_files: entry.cited_files } : {}),
    });
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
 * Splits a finding into one finding per root cause: a regression per charged file (BR-1513), a judged dimension per recorded
 * unit cause (BR-1552); any other finding is returned as is.
 *
 * @param finding - a failed finding
 * @returns one finding per distinct charged file (sorted by path) or per distinct recorded judged cause (recorded order), each
 *   carrying only its own; `[finding]` when nothing was recorded for the dimension (a not-measured regression stays cites-keyed)
 */
export function splitFindingByFile(finding: FailedFinding): FailedFinding[] {
  const judged = finding.causes?.judged?.[finding.dimension];
  if (finding.causes !== undefined && judged !== undefined && judged.length > 0) {
    const { causes } = finding;
    const distinct = [...new Map(judged.map((entry) => [entry.key, entry])).values()];
    return distinct.map((entry) => ({ ...finding, causes: { ...causes, judged: { ...causes.judged, [finding.dimension]: [entry] } } }));
  }
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

/** What {@link judgedCausesOf} reads of one review. */
export interface JudgedCausesInput {
  /** The review's final dimensions. */
  readonly dimensions: Readonly<Record<MilestoneDimension, { readonly verdict: string; readonly reason: string; readonly cites?: readonly string[] | undefined }>>;
  /** The dimensions as the judge answered them, before the measured rules: a plan-level cause is recorded only for a verdict that is still the judge's. */
  readonly judgedDimensions: Readonly<Partial<Record<MilestoneDimension, { readonly verdict: string; readonly reason: string }>>>;
  /** The call-level security and concurrency_safety verdicts before the per-file units were folded in. */
  readonly callLevel: Readonly<Record<"security" | "concurrency_safety", { readonly verdict: string; readonly cites?: readonly string[] | undefined; readonly reason: string }>>;
  /** Every unit of the review (`judgment.units`). */
  readonly units: readonly JudgeUnitRecord[];
  /** The AI criteria verdicts (`judgment.ai_criteria`). */
  readonly aiCriteria: readonly { readonly spec: string; readonly ac: string; readonly verdict: string; readonly reason: string }[];
  /** The reviewed spec; absent when the plan has none. */
  readonly spec?: { readonly slug: string; readonly version: number };
}

function summaryOf(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, 80);
}

function citesPath(cite: string, path: string): boolean {
  return cite === path || cite.startsWith(`${path}:`) || cite.startsWith(`${path}#`);
}

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The root causes of the judged dimensions of one review, keyed by the recorded unit input hashes (BR-1552, #629): the model,
 * the template, the judge's cites and its wording never enter a key.
 *
 * - `security` / `concurrency_safety`: one `unit:<path>:<sha256 of the file unit input>` cause per failing file unit, plus one
 *   `cross-file:<sha256 of every changed file's (path, input hash) pairs>` cause when the call-level verdict fails and cites a
 *   changed file whose own unit passes, or when no file unit fails.
 * - `spec_conformance` / `design_necessity`: `plan:<sha256 of spec slug@version and the (path, input hash) pairs>`.
 * - `correctness_vs_acs`: `criterion:<spec>:<ac>:<sha256 of the criterion unit input>` per failing AI criterion; failing script
 *   criteria keep a `cites:` cause.
 *
 * @param input - the review's dimensions, call-level verdicts and recorded units
 * @returns the causes by dimension; a dimension that did not fail on the judge's own verdict, or whose units carry no input hash
 *   (a review stored before BR-1552), has no entry and stays cites-keyed
 */
export function judgedCausesOf(input: JudgedCausesInput): Record<string, JudgedCause[]> {
  const out: Record<string, JudgedCause[]> = {};
  const files = input.units.filter((u) => u.kind === "file").sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pairs: { id: string; input_sha256: string }[] = [];
  for (const u of files) if (u.input_sha256 !== undefined) pairs.push({ id: u.id, input_sha256: u.input_sha256 });
  const hashed = pairs.length === files.length;
  const pairText = pairs.map((p) => `${p.id}\u0000${p.input_sha256}`).join("\n");
  const hashOf = (id: string): string => pairs.find((p) => p.id === id)?.input_sha256 ?? "";
  const stillJudged = (d: MilestoneDimension): boolean =>
    input.dimensions[d].verdict === "fail" && input.judgedDimensions[d]?.verdict === "fail" && input.judgedDimensions[d]?.reason === input.dimensions[d].reason;

  if (hashed) {
    for (const d of ["security", "concurrency_safety"] as const) {
      if (input.dimensions[d].verdict !== "fail") continue;
      const causes: JudgedCause[] = [];
      const failing = files.filter((u) => u.verdicts[d] === "fail");
      for (const u of failing) causes.push({ key: `unit:${u.id}:${hashOf(u.id)}`, label: u.id, units: [{ id: u.id, input_sha256: hashOf(u.id) }] });
      const call = input.callLevel[d];
      if (call.verdict === "fail") {
        const cites = call.cites ?? [];
        const passingCited = files.filter((u) => u.verdicts[d] !== "fail" && cites.some((c) => citesPath(c, u.id))).map((u) => u.id);
        if (failing.length === 0 || passingCited.length > 0) {
          const cited = failing.length === 0 ? files.filter((u) => cites.some((c) => citesPath(c, u.id))).map((u) => u.id) : passingCited;
          causes.push({ key: `cross-file:${sha256Of(pairText)}`, label: `cross-file: ${summaryOf(call.reason)}`, units: pairs, cited_files: cited });
        }
      }
      if (causes.length > 0) out[d] = causes;
    }
    const specRef = input.spec === undefined ? "none@0" : `${input.spec.slug}@${String(input.spec.version)}`;
    for (const d of ["spec_conformance", "design_necessity"] as const) {
      if (!stillJudged(d)) continue;
      out[d] = [{ key: `plan:${sha256Of(`${specRef}\n${pairText}`)}`, label: summaryOf(input.dimensions[d].reason), units: pairs }];
    }
  }
  if (input.dimensions.correctness_vs_acs.verdict === "fail") {
    const causes: JudgedCause[] = [];
    const failingIds = new Set<string>();
    for (const c of input.aiCriteria) {
      if (c.verdict !== "fail") continue;
      const id = `${c.spec}:${c.ac}`;
      const unit = input.units.find((u) => u.kind === "criterion" && u.id === id);
      if (unit?.input_sha256 === undefined) continue;
      failingIds.add(id);
      causes.push({ key: `criterion:${id}:${unit.input_sha256}`, label: `${id}: ${summaryOf(c.reason)}`, units: [{ id, input_sha256: unit.input_sha256 }] });
    }
    if (causes.length > 0) {
      const rest = normalisedCites(input.dimensions.correctness_vs_acs.cites).filter((c) => !failingIds.has(c));
      if (rest.length > 0) causes.push({ key: `cites:${rest.join(",")}`, label: summaryOf(input.dimensions.correctness_vs_acs.reason), units: [] });
      out["correctness_vs_acs"] = causes;
    }
  }
  return out;
}
