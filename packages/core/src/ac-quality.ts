/**
 * Deterministic (zero-LLM) lint for acceptance-criterion quantifiability. Pure,
 * browser-safe module: no IO, no Date.now()/Math.random(), no AI/provider import,
 * no wall-clock reads — mirrors `acceptance.ts`/`review-checks.ts`'s "pure fact
 * computation, rendering is the caller's job" split.
 *
 * Public surface:
 *   - AC_ABSTRACT_WORDS — curated wordlist of subjective/abstract quality claims
 *     (en + zh) that read as unverifiable prose unless paired with a measurable
 *     anchor.
 *   - AcQualityFinding — one lint finding: {ac_id, word, severity, message}.
 *   - lintStatement(text) — the shared per-statement lint PRIMITIVE (SPEC-059):
 *     scans ANY free-text string for an `AC_ABSTRACT_WORDS` member with no
 *     accompanying measurable token, returning a `block` finding per offending
 *     word with `ac_id: ""` (the caller stamps the real id — see its own JSDoc).
 *     `lintAcQuantifiability` (below) delegates to it per-criterion; so does
 *     `RequirementService.addRequirement`
 *     (`packages/lore/src/service/requirement-service.ts`) at the PRD-requirement
 *     layer one tier up — one wordlist, one measurable-token heuristic, reused
 *     rather than re-implemented at each write site.
 *   - lintAcQuantifiability(criteria) — thin per-criterion map over
 *     `lintStatement`: skips `script`-mode criteria (oracle-bound by
 *     construction) and applies the `ai`-mode rubric escape hatch, then stamps
 *     each finding's `ac_id` from the owning criterion. Kept BEHAVIOR-IDENTICAL
 *     to its pre-SPEC-059 direct implementation (regression-frozen — same
 *     fixtures, same output, SPEC-059 AC-RQ-2).
 *
 * Invariants:
 *   - Referentially transparent: same input in → same `AcQualityFinding[]` out,
 *     always. No hidden state, no side effects.
 *   - `verify.mode === "script"` criteria are NEVER blocked by this lint — an
 *     oracle command is already bound, so the AC is measurable by construction
 *     (SPEC AC-Quantifiability Gate §Design). `verify.mode === "ai"` criteria are
 *     blocked only when BOTH the statement and the rubric lack a measurable
 *     token — the rubric is allowed to carry the threshold instead of the
 *     statement.
 *   - Never throws on malformed input: a missing/non-string/empty `statement`,
 *     or an empty `criteria` array, both degrade to "no findings for that
 *     criterion" rather than throwing.
 *   - Findings are returned in stable order: criteria array order, then — within
 *     one statement — the order the offending words first appear in the
 *     statement text (not `AC_ABSTRACT_WORDS` declaration order).
 *   - ASCII wordlist entries match case-insensitively on a `\b`-delimited word
 *     boundary (so "class" never matches inside "classifier", and "fast" never
 *     matches inside "breakfast"/"faster"). CJK entries have no regex word-
 *     boundary concept in a Unicode-unaware engine, so they match as a plain
 *     case-sensitive substring — the intended, documented behavior for this list
 *     (see module design note above).
 *
 * Side-effect class: pure
 *
 * Source: SPEC AC-Quantifiability Gate (design-time standardization enforcement),
 * §Scope, §Acceptance Criteria AC-ACQ-1/2/6/7, §Design
 */

import type { AcceptanceCriterion } from "./acceptance.js";

// ─── Abstract Quality Wordlist ──────────────────────────────────────────────

/**
 * Curated list of subjective/abstract quality words that, on their own, assert
 * a quality claim with no measurable meaning ("it should be fast", "the UI is
 * clean"). Includes English single- and multi-word forms plus a parallel
 * Chinese set. Order here is the wordlist's own canonical order — NOT the order
 * findings are emitted in (see `lintAcQuantifiability`'s stable-order invariant
 * above, which sorts by position-of-first-occurrence in the statement instead).
 */
export const AC_ABSTRACT_WORDS: readonly string[] = [
  "fast",
  "slow",
  "clean",
  "simple",
  "robust",
  "modern",
  "elegant",
  "intuitive",
  "seamless",
  "scalable",
  "performant",
  "efficient",
  "secure",
  "quick",
  "snappy",
  "lightweight",
  "user-friendly",
  "good",
  "better",
  "best",
  "optimal",
  "nice",
  "high-quality",
  "high quality",
  "快",
  "简洁",
  "优雅",
  "现代化",
  "高质量",
  "健壮",
  "好用",
  "高效",
  "流畅",
];

// ─── Findings ────────────────────────────────────────────────────────────────

/**
 * One AC-quantifiability lint finding. `severity: "block"` is the only outcome
 * this pure lint currently emits (a script-bound AC is skipped entirely rather
 * than downgraded to `"warn"` — SPEC §Design); `"warn"` is reserved for a
 * later, gate-adjacent "weak verify binding" check that is out of scope here.
 */
export interface AcQualityFinding {
  ac_id: string;
  word: string;
  severity: "block" | "warn";
  message: string;
}

// ─── Measurable-token recognition ───────────────────────────────────────────

const DIGIT_RUN = /\d/;
const COMPARISON_OPERATOR = /<=|>=|≤|≥|<|>|=/;
const PERCENTILE_MARKER = /p\d{2,3}/i;

/**
 * Unit-ish tokens that anchor an otherwise-abstract claim to something
 * measurable (a duration, a fraction, a data size, a throughput rate, a pixel
 * dimension). Each is `\b`-delimited so e.g. `ms` doesn't fire inside
 * "milliseconds" being spelled some other way, and bare `s` doesn't fire
 * inside ordinary words.
 */
const UNIT_TOKEN = /\b(ms|s|MB|KB|GB|rps|px)\b|req\/s|%/i;

/**
 * True iff `statement` carries at least one measurable anchor: a digit run, a
 * comparison operator, a percentile marker (`P95`, `p50`, ...), or a unit-ish
 * token (`ms`, `%`, `MB`, `req/s`, ...). Used both directly on an AC's
 * `statement` and — for `verify.mode === "ai"` — on its `rubric`, since either
 * can carry the threshold (SPEC §Design).
 */
function hasMeasurableToken(text: string): boolean {
  return (
    DIGIT_RUN.test(text) ||
    COMPARISON_OPERATOR.test(text) ||
    PERCENTILE_MARKER.test(text) ||
    UNIT_TOKEN.test(text)
  );
}

// ─── Abstract-word matching ──────────────────────────────────────────────────

/** `true` iff every character of `word` is within the ASCII range. */
function isAsciiWord(word: string): boolean {
  return /^[\x00-\x7f]*$/.test(word);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds the earliest match index of `word` inside `statement`, or `-1` if
 * absent. ASCII words match case-insensitively on a `\b`-delimited boundary
 * (rejecting substring hits inside a larger word, e.g. "fast" inside
 * "breakfast"); non-ASCII (CJK) words match as a plain substring, since `\b`
 * has no meaning for characters the regex engine doesn't classify as `\w`.
 */
function findWordIndex(statement: string, word: string): number {
  if (isAsciiWord(word)) {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
    const match = pattern.exec(statement);
    return match ? match.index : -1;
  }
  return statement.indexOf(word);
}

/**
 * Scans `statement` for every `AC_ABSTRACT_WORDS` member present, returning the
 * matched words ordered by where they FIRST appear in `statement` (stable,
 * left-to-right reading order) — not by `AC_ABSTRACT_WORDS`' own declaration
 * order.
 */
function findAbstractWordMatches(statement: string): string[] {
  const hits: { word: string; index: number }[] = [];
  for (const word of AC_ABSTRACT_WORDS) {
    const index = findWordIndex(statement, word);
    if (index >= 0) {
      hits.push({ word, index });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits.map((hit) => hit.word);
}

// ─── Shared per-statement primitive (SPEC-059) ─────────────────────────────

/**
 * Lints ANY free-text string for unquantified abstract quality claims — the
 * shared per-statement PRIMITIVE both {@link lintAcQuantifiability} (AC layer)
 * and `RequirementService.addRequirement` (PRD-requirement layer, one tier up)
 * delegate to. Scans `text` for every {@link AC_ABSTRACT_WORDS} member; each hit
 * with no accompanying measurable token (digit run, comparison operator,
 * percentile marker, or unit-ish token — see {@link hasMeasurableToken})
 * escalates to a `block` finding.
 *
 * Every returned finding carries `ac_id: ""` — this primitive has no notion of
 * "which criterion/requirement" the text belongs to; the caller stamps the real
 * id onto each finding it keeps (see {@link lintAcQuantifiability}'s
 * `ac_id: criterion.id` reassignment below, or `RequirementService`'s
 * `R-id: <word> → ...` message construction).
 *
 * @param text - Free-text statement to lint (an AC's `statement`, a
 *   requirement's `statement`, or any equivalent prose claim)
 * @returns Zero or more {@link AcQualityFinding}s (`ac_id: ""`), in
 *   first-occurrence word order. Never throws — a non-string/empty `text`
 *   yields no findings.
 *
 * @example
 * lintStatement("the dashboard loads fast");
 * // => [{ ac_id: "", word: "fast", severity: "block", message: "..." }]
 *
 * @example
 * lintStatement("the dashboard P95 load < 200ms");
 * // => []
 */
export function lintStatement(text: string): AcQualityFinding[] {
  const statement = typeof text === "string" ? text : "";
  if (statement.length === 0) {
    return [];
  }

  const matches = findAbstractWordMatches(statement);
  if (matches.length === 0) {
    return [];
  }

  if (hasMeasurableToken(statement)) {
    return [];
  }

  return matches.map((word) => ({
    ac_id: "",
    word,
    severity: "block" as const,
    message: `abstract word "${word}" has no measurable anchor — add a threshold (e.g. "P95 < 200ms"), bind a script oracle, or restate measurably`,
  }));
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Lints a spec's declared acceptance criteria for unquantified abstract quality
 * claims — the deterministic (zero-LLM) heart of the AC-Quantifiability Gate.
 * Thin per-criterion map over {@link lintStatement} (SPEC-059): skips
 * `script`-mode criteria (oracle-bound by construction) and criteria whose
 * `ai`-mode rubric independently carries a measurable token, BEFORE delegating
 * the statement text to `lintStatement`, then re-stamps `ac_id` and the
 * criterion-scoped message onto each surviving finding.
 *
 * For each criterion, scans `statement` for any {@link AC_ABSTRACT_WORDS}
 * member. A hit is escalated to a `block` finding UNLESS one of:
 *   - `verify.mode === "script"` — an oracle command is already bound, so the
 *     AC is measurable by construction, regardless of its prose.
 *   - `statement` itself carries a measurable token (digit run, comparison
 *     operator, percentile marker, or unit-ish token) — the abstract word is
 *     then read as color commentary alongside a real threshold, not a bare
 *     unverifiable claim.
 *   - `verify.mode === "ai"` AND its `rubric` carries a measurable token — the
 *     rubric is allowed to carry the threshold instead of the statement.
 *
 * `verify.mode === "human"` never gets the rubric escape hatch (there is no
 * rubric field to check) — a `human`-mode AC with an abstract word and no
 * measurable token in the statement is always blocked.
 *
 * @param criteria - Declared acceptance criteria (typically a spec's
 *   `extra.acceptance_criteria`)
 * @returns Zero or more {@link AcQualityFinding}s, in criteria order, then
 *   first-occurrence word order within each statement. Never throws — a
 *   missing/empty `statement` or an empty `criteria` array both yield no
 *   findings for that criterion.
 *
 * @example
 * lintAcQuantifiability([
 *   { id: "AC-1", statement: "the dashboard loads fast", verify: { mode: "human" } },
 * ]);
 * // => [{ ac_id: "AC-1", word: "fast", severity: "block", message: "..." }]
 *
 * @example
 * lintAcQuantifiability([
 *   { id: "AC-2", statement: "the dashboard P95 load < 200ms", verify: { mode: "human" } },
 * ]);
 * // => []
 */
export function lintAcQuantifiability(criteria: AcceptanceCriterion[]): AcQualityFinding[] {
  const findings: AcQualityFinding[] = [];

  for (const criterion of criteria) {
    if (criterion === null || criterion === undefined) {
      continue;
    }
    const statement = typeof criterion.statement === "string" ? criterion.statement : "";
    if (statement.length === 0) {
      continue;
    }

    // Oracle-bound by construction — never a block from the wordlist. Checked
    // BEFORE delegating to lintStatement so a script-mode AC never even runs
    // the wordlist scan (byte-identical short-circuit to the pre-SPEC-059 code).
    if (criterion.verify?.mode === "script") {
      continue;
    }

    if (criterion.verify?.mode === "ai" && hasMeasurableToken(criterion.verify.rubric ?? "")) {
      continue;
    }

    for (const finding of lintStatement(statement)) {
      findings.push({
        ...finding,
        ac_id: criterion.id,
        message: `${criterion.id}: ${finding.message}`,
      });
    }
  }

  return findings;
}
