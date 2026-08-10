/**
 * Terminal rendering for `lore assess`'s human-readable summary (SPEC-026 §8.3,
 * SPEC-040 §T3 D3). Extracted from `commands/assess.ts` into its own module so it can
 * be unit-tested directly under vitest — `commands/assess.ts` transitively imports
 * `loader.ts` (`bun:sqlite`), which vitest cannot resolve, but this module imports only
 * `@lore/core` and `./utils.js` (both vitest-safe).
 *
 * Public surface:
 *   - formatAssessmentSummary(result) — verdict + AC score table + gaps +
 *     recommendations + judge metadata (legacy shape, byte-identical when no SPEC-040
 *     typed fields are present) PLUS, additively, dimension scores / typed gaps /
 *     typed recommendations / rubric warnings tables when present on the result, PLUS
 *     (task-assess-templates-5-binds-the-projected-renderer-while-two) a presence-guarded
 *     `Reproducible: yes|no` line next to the Judge line when `judgment.reproducible` is
 *     recorded — absent when the field is absent, never inferred.
 *   - computeGitDiffMaxBuffer(maxDiffChars) — sizes `spawnSync`'s `maxBuffer` for the
 *     `git diff` acquisition call against the EFFECTIVE `ai.assess.max_diff_chars`
 *     budget (task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1).
 *   - formatGitDiffEnobufsMessage(range, maxBufferBytes, maxDiffChars) — the
 *     ENOBUFS-specific refusal message naming this call site's own buffer ceiling
 *     instead of blaming git.
 *   - computeCaptureSourceDistribution(bundle) / formatCaptureSourceLine(dist,
 *     attestedRatio) (task-raise-the-evidence-tail-guard-s-predicate-to-its-
 *     own, AC-FR-5, G4) — the corpus-wide-for-this-plan runner-vs-self-report
 *     evidence tally, and its one-line human render printed alongside the
 *     pre-existing `attested_evidence_ratio`. Moved here (not left inline in
 *     `commands/assess.ts`) for the SAME reason every other export in this
 *     module was extracted: `commands/assess.ts` transitively imports
 *     `loader.ts` (`bun:sqlite`), unreachable from vitest, and AC-FR-5's own
 *     oracle is a vitest file.
 *
 * Invariants:
 *   - No IO, no wall-clock reads — pure string assembly over an already-computed
 *     AssessmentResult (mirrors `renderAssessmentContent`'s determinism contract).
 *   - Every SPEC-040 block is additive and presence-guarded: a legacy-only
 *     AssessmentResult (no dimension_scores/typed_gaps/typed_recommendations/
 *     rubric_warning) renders BYTE-IDENTICALLY to the pre-SPEC-040 shape
 *     (regression-protected, mirrors `@lore/core`'s renderAssessmentContent).
 *   - Dimension score confidence is explicitly labeled "self-reported, uncalibrated" —
 *     never presented as a calibrated probability (same wording as
 *     `renderAssessmentContent`'s Dimension Scores table header).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §8.3; SPEC-040 §T3 D3, AC-ADF-13;
 * task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1;
 * task-raise-the-evidence-tail-guard-s-predicate-to-its-own AC-FR-5
 */

import { extractEvidence, type AssessmentResult, type PlanBundle } from "@lore/core";
import { formatTable } from "./utils.js";

/**
 * Corpus-wide-for-this-plan `capture_source` distribution (task-raise-the-
 * evidence-tail-guard-s-predicate-to-its-own, AC-FR-5, G4) — every evidence
 * entry across `bundle.tasks`, bucketed into `"runner"` vs everything else
 * (an ABSENT `capture_source` on a legacy row reads as self-report, never as
 * "unknown, therefore fine" — the same convention this repo's `capture_source`
 * invariant applies everywhere else it is consumed). Computed directly from
 * the ALREADY-loaded `PlanBundle` — deterministic, zero additional AI call,
 * zero additional store read.
 *
 * @param bundle - The plan bundle already fetched for this assessment run.
 * @returns `{runnerCount, selfReportCount, ratio}` — `ratio` is
 *   `runnerCount / (runnerCount + selfReportCount)`, `0` when there is no
 *   evidence at all (never `NaN`), mirroring `attested_evidence_ratio`'s own
 *   documented zero-evidence convention.
 */
export function computeCaptureSourceDistribution(
  bundle: PlanBundle,
): { runnerCount: number; selfReportCount: number; ratio: number } {
  let runnerCount = 0;
  let selfReportCount = 0;
  for (const task of bundle.tasks) {
    for (const entry of extractEvidence(task)) {
      if (entry.capture_source === "runner") {
        runnerCount += 1;
      } else {
        selfReportCount += 1;
      }
    }
  }
  const total = runnerCount + selfReportCount;
  return { runnerCount, selfReportCount, ratio: total === 0 ? 0 : runnerCount / total };
}

/**
 * One-line human render of {@link computeCaptureSourceDistribution}'s result,
 * printed ALONGSIDE `result.facts.regression.attested_evidence_ratio` (the
 * pre-existing attested ratio `lore assess` already prints/emits) — AC-FR-5's
 * own "beside the attested ratio it already prints" requirement.
 *
 * @param distribution - {@link computeCaptureSourceDistribution}'s return value.
 * @param attestedRatio - `result.facts?.regression.attested_evidence_ratio`,
 *   `undefined` for a legacy pre-SPEC-040 result (additive, never thrown).
 */
export function formatCaptureSourceLine(
  distribution: { runnerCount: number; selfReportCount: number; ratio: number },
  attestedRatio: number | undefined,
): string {
  return (
    `Evidence trust: capture_source ${distribution.runnerCount} runner / ` +
    `${distribution.selfReportCount} self-report (ratio ${distribution.ratio.toFixed(2)})` +
    (attestedRatio !== undefined ? `, attested_evidence_ratio ${attestedRatio.toFixed(2)}` : "")
  );
}

/**
 * Worst-case UTF-8 bytes per JS string length unit, used to size `spawnSync`'s
 * `maxBuffer` against a character budget (`ai.assess.max_diff_chars`).
 *
 * `max_diff_chars` is compared against `diffText.length` — a JS string's UTF-16 code
 * unit count — but `maxBuffer` caps raw BYTES read off the child's stdout pipe, before
 * any decoding happens. A single Unicode code point can take up to 4 bytes in UTF-8
 * (the canonical worst case, U+10000-U+10FFFF); a code point in that range also costs 2
 * UTF-16 code units (a surrogate pair), i.e. 2 bytes/unit, while a 3-byte-UTF-8 BMP code
 * point (e.g. most CJK ideographs, U+0800-U+FFFF) costs exactly 1 UTF-16 unit, i.e. 3
 * bytes/unit -- the actual worst ratio per length-unit. Using the canonical "4 bytes per
 * UTF-8 code point" figure is therefore a deliberately conservative over-estimate in
 * every case: it can only make the buffer LARGER than the tightest possible bound,
 * never smaller, which is what AC-1 requires ("the smallest value that cannot truncate
 * BELOW" the configured budget -- erring large is safe, erring small silently
 * reintroduces the bug this fix closes).
 */
const UTF8_WORST_CASE_BYTES_PER_CHAR = 4;

/**
 * Sizes `spawnSync`'s `maxBuffer` (bytes) for `lore assess --diff`'s `git diff`
 * acquisition call against the EFFECTIVE `ai.assess.max_diff_chars` budget (config
 * default or override -- callers must pass `app.aiProviderService.assessMaxDiffChars`,
 * never the hardcoded schema default, so the buffer tracks a live config edit).
 *
 * Node's own default (1 MiB) is an arbitrary constant unrelated to this command's
 * diff-size budget -- an ordinary multi-task-plan diff can exceed it. Sizing the buffer
 * against `max_diff_chars` instead of a bigger arbitrary constant is deliberate: any
 * diff text beyond that budget is truncated by file (`truncateDiffByFile`,
 * `../../ai/diff-truncation.js`) before it reaches the judge prompt anyway, so a buffer
 * bigger than "enough to prove the diff exceeds budget" buys nothing.
 *
 * @param maxDiffChars - Effective `ai.assess.max_diff_chars` value (chars, i.e. JS
 *   string length units).
 * @returns Buffer size in bytes -- the smallest value that cannot truncate a diff BELOW
 *   `maxDiffChars` characters (see {@link UTF8_WORST_CASE_BYTES_PER_CHAR}).
 */
export function computeGitDiffMaxBuffer(maxDiffChars: number): number {
  return maxDiffChars * UTF8_WORST_CASE_BYTES_PER_CHAR;
}

/**
 * Renders the ENOBUFS-specific refusal message for `lore assess --diff`'s `git diff`
 * spawn, naming this call site's own buffer ceiling instead of blaming git. The
 * pre-fix message rendered as `git diff <range> failed: spawnSync ENOBUFS` -- an
 * operator reading it goes looking at git, when the failure is entirely this call
 * site's `maxBuffer` sizing (task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1).
 * The generic `git diff <range> failed: <reason>` message stays unchanged for every
 * OTHER spawn error (non-zero exit, ENOENT, ...) -- this function is invoked ONLY on a
 * confirmed `error.code === "ENOBUFS"`.
 *
 * @param range - The `--diff` git range argument, verbatim (for the operator to re-run).
 * @param maxBufferBytes - The `maxBuffer` value that was exceeded (from
 *   {@link computeGitDiffMaxBuffer}).
 * @param maxDiffChars - The effective `ai.assess.max_diff_chars` the buffer was sized
 *   from, so the operator knows which knob to raise.
 * @returns A single-line message, WITHOUT a trailing newline (caller appends one, same
 *   convention as `formatError`).
 */
export function formatGitDiffEnobufsMessage(range: string, maxBufferBytes: number, maxDiffChars: number): string {
  return (
    `Error: git diff ${range} produced more output than this command's buffer allows ` +
    `(${String(maxBufferBytes)} bytes, sized from ai.assess.max_diff_chars=${String(maxDiffChars)}). ` +
    `This is not a git failure -- it is this call site's own buffer ceiling. Narrow the ` +
    `range with --diff, or raise ai.assess.max_diff_chars in .lore/config.yaml (the ` +
    `buffer scales with it).`
  );
}

/** Human-readable verdict + AC score table rendering for terminal output. */
export function formatAssessmentSummary(result: AssessmentResult): string {
  const lines: string[] = [];
  // SPEC-067 D4: overall_score is omitted at 100% task-truncation coverage (verdict
  // "inconclusive") — render an explicit placeholder rather than interpolating `undefined`.
  const scoreLabel = result.overall_score !== undefined ? `${result.overall_score}/100` : "N/A (fully truncated)";
  lines.push(`Verdict: ${result.verdict} (score: ${scoreLabel})`);
  lines.push("");

  if (result.ac_scores.length > 0) {
    lines.push(
      formatTable(
        ["AC", "Score", "Reasoning"],
        result.ac_scores.map((ac) => [ac.ac_id, String(ac.score), ac.reasoning]),
      ),
    );
    lines.push("");
  }

  if (result.gaps.length > 0) {
    lines.push("Gaps:");
    for (const g of result.gaps) lines.push(`  - ${g}`);
    lines.push("");
  }

  if (result.recommendations.length > 0) {
    lines.push("Recommendations:");
    for (const r of result.recommendations) lines.push(`  - ${r}`);
    lines.push("");
  }

  // reason: every block below is additive-only (SPEC-040 §T3 D3) — guarded by presence
  // of its own optional field, so a legacy AssessmentResult with none of these fields
  // set renders byte-identically to the pre-SPEC-040 shape (REGRESSION-tested).
  if (result.dimension_scores && Object.keys(result.dimension_scores).length > 0) {
    lines.push("Dimension Scores (confidence: self-reported, uncalibrated):");
    lines.push(
      formatTable(
        ["Dimension", "Score", "Confidence", "Based On", "Reasoning"],
        Object.entries(result.dimension_scores).map(([dimension, entry]) => [
          dimension,
          String(entry.score),
          String(entry.confidence),
          entry.based_on,
          entry.reasoning,
        ]),
      ),
    );
    lines.push("");
  }

  if (result.typed_gaps && result.typed_gaps.length > 0) {
    lines.push("Typed Gaps:");
    lines.push(
      formatTable(
        ["Dimension", "Severity", "AC Ref", "Statement"],
        result.typed_gaps.map((gap) => [gap.dimension, gap.severity, gap.ac_ref ?? "—", gap.statement]),
      ),
    );
    lines.push("");
  }

  if (result.typed_recommendations && result.typed_recommendations.length > 0) {
    lines.push("Typed Recommendations:");
    lines.push(
      formatTable(
        ["Target", "Action", "Rationale"],
        result.typed_recommendations.map((rec) => [rec.target, rec.action, rec.rationale]),
      ),
    );
    lines.push("");
  }

  // reason: task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3 — previously
  // absent from this terminal render entirely (`result.unverifiable[]` was persisted but
  // only core's `renderAssessmentContent` rendered it) — additive and presence-guarded,
  // same contract as every other SPEC-040 block above. This is where a reader sees the AC
  // #3 "not scored" wording `forceScopeFidelityUnverifiable` (ai-provider-service.ts)
  // forces into `unverifiable[]`, not just in the persisted Markdown doc.
  if (result.unverifiable && result.unverifiable.length > 0) {
    lines.push("Unverifiable:");
    for (const u of result.unverifiable) lines.push(`  - ${u.material}: ${u.reason}`);
    lines.push("");
  }

  if (result.rubric_warning && result.rubric_warning.length > 0) {
    lines.push("Rubric Warnings:");
    for (const w of result.rubric_warning) lines.push(`  - ${w}`);
    lines.push("");
  }

  lines.push(
    `Judge: ${result.judgment.provider} (prompt v${result.judgment.prompt_version}, ` +
      `${result.judgment.duration_ms}ms, retried: ${result.judgment.retried}` +
      (result.judgment.truncated.length > 0 ? `, truncated: ${result.judgment.truncated.join(", ")}` : "") +
      `)`,
  );

  // reason: additive-only (task-assess-templates-5-binds-the-projected-renderer-while-two)
  // — presence-guarded like every other SPEC-040/067 judgment field (legacy result renders
  // byte-identically). `judgment.reproducible` is a genuine three-state field (true / false
  // / absent-means-"not recorded", never coerced) — see @lore/core's judgmentSchema JSDoc
  // for the full contract. Rendered right next to the "Judge:" line since that is where
  // prompt_version (the field this qualifies) is shown.
  if (result.judgment.reproducible !== undefined) {
    lines.push(
      `Reproducible: ${
        result.judgment.reproducible
          ? "yes (this prompt_version's rendering is guaranteed byte-identical)"
          : "no (this prompt_version's rendering is NOT guaranteed byte-identical across runs)"
      }`,
    );
  }

  // SPEC-067 D4: additive-only — absent on every pre-SPEC-067 assessment and every run
  // below the truncation-cap threshold.
  if (result.judgment.overall_confidence !== undefined) {
    lines.push(
      `Overall confidence: ${result.judgment.overall_confidence}` +
        (result.judgment.degraded_by_truncation ? " (degraded by truncation)" : ""),
    );
  }

  return lines.join("\n");
}
