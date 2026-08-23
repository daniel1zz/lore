/**
 * `check-ac-state-renderers` — SPEC-143 component C8: a TWO-RULE textual site scan that
 * refuses the NEXT re-derivation of AC coverage state, not merely today's.
 *
 * ## Why a scan and not a test (AC-CT-7's own argument)
 *
 * A test asserting "the badge renders correctly" pins today's call sites. The measured
 * failure mode is a NEW one: `packages/core/src/acceptance.ts::deriveAcCoverageState`'s
 * JSDoc has claimed to be "the SINGLE precedence implementation this codebase uses"
 * since SPEC-070, and that claim was FALSE — `outline-service.ts::acCoveragePrefix`
 * re-derived its own three-glyph verdict from raw `fact.fail > 0`. Fixing that one site
 * fixes the corpus once; this scan is what keeps it fixed.
 *
 * ## Public surface
 *
 * - {@link RULE_NAMES} — the two rule names `--rule` accepts.
 * - {@link scanTree} — the whole scan over one tree root; pure apart from `fs` reads.
 * - {@link findNamedFunctionRegions} / {@link blankStringLiteralsPreservingLines} —
 *   exported for direct unit testing of the two hardest textual steps.
 * - {@link main} — argv → exit code. `repoRootOverride` is the test seam.
 *
 * ## Exit contract (AC-CT-7, and DELIBERATELY not `check-plan-membership-sites.ts`'s)
 *
 * - **0** — clean.
 * - **1** — at least one violation. Every violation names BOTH the offending function
 *   and the repo-relative file.
 * - **EXACTLY 2** — the scan itself could not complete (a missing scan root, an empty
 *   walk, an unterminated block comment, a degenerate imported alphabet, a bad
 *   `--rule` name, an empty repo-root override). ⛔ Never conflated with 1: "no verdict"
 *   and "a bad verdict" are different facts and must not print the same code.
 *   This is `check-anchor-coverage.ts`'s 1/2 shape, NOT
 *   `check-plan-membership-sites.ts`'s 3/4 — AC-CT-7 pins the former.
 *
 * ## RULE 1 — `fact-field-read` (owned by AC-CT-7)
 *
 * Refuse a read of `.fail` / `.pass` off an `AcCoverageFact` outside
 * `packages/core/src/acceptance.ts`.
 *
 * ⛔ THE HONEST STATEMENT OF WHAT IS ACTUALLY DECIDABLE HERE, because the gap matters:
 * "off an `AcCoverageFact`" is a TYPE fact and this is a TEXTUAL scan. The decidable
 * approximation is a CONJUNCTION of (a) the file names `AcCoverageFact` in code — a
 * type-only import counts — and (b) a `.fail` / `.pass` member read occurs in that
 * file's code. That over-matches on a file which both consumes `AcCoverageFact`
 * somewhere AND reads `.fail`/`.pass` off an unrelated receiver, and every such site is
 * carried in {@link RULE_1_ALLOWLIST} with a reason that says exactly that. A
 * receiver-type-inference narrowing was measured and REJECTED: it silently exonerated
 * `commands/ac.ts::coverageBadge`, whose `fact` binding comes from
 * `AcListResult["coverage"]` — an indexed-access type that never spells
 * `AcCoverageFact` — i.e. it turned the single most prominent real read site into a
 * false negative. An over-match carried by a written waiver is visible; a false
 * negative is not.
 *
 * ## RULE 2 — `glyph-projection` (owned and asserted by AC-CT-1)
 *
 * Refuse a SECOND state-to-glyph projection: any function outside
 * `packages/core/src/acceptance.ts` satisfying BOTH
 *   (i) it names `AcCoverageFact` or `AcCoverageState` in its signature or a local type
 *       annotation, AND
 *   (ii) it yields a glyph from {@link AC_COVERAGE_GLYPH_ALPHABET} by one of FOUR
 *       enumerated forms — {@link GlyphYieldForm}.
 *
 * ⛔ The CONJUNCTION is the mechanism, and neither half may be dropped: measured on
 * this repository 2026-08-19 (SPEC-143 R2), condition (ii) alone matches 15 unrelated
 * sources that render those characters for other reasons and condition (i) alone
 * matches 17 that legitimately consume the state names. Either alone needs a
 * 13-plus-entry allowlist, which dilutes the rule to nothing.
 *
 * ⛔ The four forms are the CLOSED definition of a violation. A fifth shape (dynamic
 * construction, re-export) is out of scope BY CONSTRUCTION, not by omission — SPEC-143
 * R8 removed an earlier duty to "report unenumerated forms" as unimplementable, since
 * recognising an unenumerated form is the same act as enumerating it.
 *
 * ⛔ THE ALPHABET IS IMPORTED, NEVER RE-LISTED (SPEC-143 R9). A scan holding its own
 * copy of the glyphs silently guards a STALE alphabet the moment the projection changes
 * one — this spec's own guarded-vs-guardian drift reproduced inside the guard. The
 * import below is the entire reason `AC_COVERAGE_GLYPH_ALPHABET` is a derived export
 * rather than a hand-written array.
 *
 * ## Side-effect class
 *
 * Reads the filesystem (directory walk + file reads) and writes to stdout/stderr;
 * mutates nothing. Every textual helper is pure.
 *
 * @spec_ref spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-7, AC-CT-1 (C8, C4)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AC_COVERAGE_GLYPH_ALPHABET } from "@lore/core";
import { isScannableSourceFile, stripCommentsPreservingLines } from "./check-plan-membership-sites.js";

const SCRIPT_NAME = "check-ac-state-renderers";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The repo-relative directories walked. Broader than
 * `check-plan-membership-sites.ts`'s two roots on purpose: a second projection added in
 * a script or in the dashboard's non-`.tsx` library code would be exactly as harmful as
 * one added in a service. `.tsx` is excluded by {@link isScannableSourceFile}, which
 * also excludes `*.test.ts` / `*.bun.test.ts` / `*.d.ts` and any `tests/` segment.
 */
export const SCAN_ROOTS = [
  "packages/core/src",
  "packages/lore/src",
  "packages/dashboard/src",
  "scripts",
] as const;

/** The one file that OWNS both the derivation and the projection; exempt from both rules. */
export const PROJECTION_SSOT_FILE = "packages/core/src/acceptance.ts";

/** Generated-code suffixes skipped by the walk — see the `reason:` note at its call site. */
const GENERATED_FILE_SUFFIXES = [".gen.ts", ".generated.ts"] as const;

/** The type names whose presence anchors both rules to AC coverage facts. */
const TYPE_ANCHOR_PATTERN = /\bAcCoverage(?:Fact|State)\b/;

export const RULE_NAMES = ["fact-field-read", "glyph-projection"] as const;
export type RuleName = (typeof RULE_NAMES)[number];

/** The four ENUMERATED glyph-yielding forms of RULE 2 condition (ii) — a closed set. */
export type GlyphYieldForm =
  | "bare-string-literal"
  | "string-literal-union-return-type"
  | "template-literal-static-part"
  | "indexed-object-or-array-literal";

/** One allowlist waiver. `functions` narrows the waiver so a NEW offender still reddens. */
interface AllowlistEntry {
  /** Repo-relative POSIX path. */
  readonly file: string;
  /**
   * When present, ONLY violations attributed to these function names are waived — a new
   * function in the same file is still a violation. Absent means the whole file.
   */
  readonly functions?: readonly string[];
  /** ⛔ Must name a mechanically checkable fact, never "this is fine". */
  readonly reason: string;
}

/**
 * RULE 1 waivers. Each entry exists because the file consumes `AcCoverageFact`
 * SOMEWHERE and also contains a `.fail`/`.pass` read — see this module's header for why
 * that conjunction is the only decidable approximation of "off an `AcCoverageFact`".
 *
 * ⛔ Every entry is function-scoped, so the waiver cannot silently cover the NEXT read
 * added to the same file. That is the difference between an allowlist and a hole.
 */
export const RULE_1_ALLOWLIST: readonly AllowlistEntry[] = [
  {
    file: "packages/lore/src/adapters/cli/commands/ac.ts",
    functions: ["coverageBadge"],
    reason:
      "REAL AcCoverageFact reads, but COUNT DISPLAY only: the precedence decision is already made by " +
      "`const state = deriveAcCoverageState(fact)` on the function's third line, and every `fact.pass` / " +
      "`fact.fail` afterwards is interpolated into the `(pass/fail)` suffix of an already-chosen badge. " +
      "Measured 2026-08-23 with this allowlist emptied: 8 reads, at ac.ts:1056/1060/1065/1068 (two per line, the " +
      "`(pass/fail)` suffix). Checkable: `grep -n 'fact.fail >\\|fact.pass >' packages/lore/src/adapters/cli/commands/ac.ts` " +
      "→ zero hits, i.e. no branch in the file reads either field.",
  },
  {
    file: "packages/lore/src/ai/assess-template.ts",
    functions: ["renderCoverageCell", "renderFactsSection"],
    reason:
      "REAL AcCoverageFact reads, but COUNT DISPLAY only: `renderCoverageCell` renders the literal string " +
      '`"N pass, M fail"` for the assess prompt and `renderFactsSection` renders one markdown table row per ' +
      "fact. Neither branches on the values, and neither produces a glyph (which is why RULE 2 does not fire " +
      "on them either). Measured 2026-08-23 with this allowlist emptied: 6 reads, at assess-template.ts:604/605 " +
      "(two each) and :833 (two). Checkable: `grep -n 'fact.fail >\\|fact.pass >' packages/lore/src/ai/assess-template.ts` " +
      "→ zero hits.",
  },
  {
    file: "packages/core/src/evidence-panel.ts",
    functions: ["deriveEvidenceTallyStatus", "summarizeForAdjudicationBar"],
    reason:
      "NOT AcCoverageFact reads at all — this is the over-match RULE 1's textual approximation is known to " +
      "produce. The receiver is an `EvidenceResultTally` (`tallyEvidenceResults`' four-bucket count), " +
      "declared at the parameter `tally: EvidenceResultTally` of `deriveEvidenceTallyStatus`; the file also " +
      "consumes `AcCoverageFact` in four unrelated signatures, which is what puts it in scope. Checkable: " +
      "every `.fail`/`.pass` in this file has the receiver name `tally`, and `tally` is never annotated " +
      "`AcCoverageFact` anywhere in it. Measured 2026-08-23 with this allowlist emptied: 6 reads, at " +
      "evidence-panel.ts:850/851/896/897/920/921. Checkable: `grep -n '\\.\\(fail\\|pass\\)\\b' " +
      "packages/core/src/evidence-panel.ts` — every hit is `tally.`-prefixed.",
  },
  {
    file: "packages/lore/src/service/phase-workflow-service.ts",
    functions: ["buildDeclaredPhaseScorecard"],
    reason:
      "NOT an AcCoverageFact read — same over-match as evidence-panel.ts. The receiver is the " +
      "`tallyEvidenceResults(allEvidence)` result three lines above the read; the file's `AcCoverageFact` " +
      "reference is the unrelated `ac_coverage: AcCoverageFact[]` field of its scorecard interface. " +
      "Measured 2026-08-23 with this allowlist emptied: 2 reads, at phase-workflow-service.ts:449/450. " +
      "Checkable: both are `tally.pass` / `tally.fail` inside an `evidence:` object literal.",
  },
];

/**
 * RULE 2 waivers. EMPTY BY DESIGN and measured so: with `acCoveragePrefix` delegating to
 * `projectAcCoverageGlyph`, the two-condition conjunction matches nothing in the tree.
 *
 * ⛔ An entry added here is a declaration that a SECOND state-to-glyph projection is
 * permitted to exist, which is the exact property SPEC-143 AC-CT-1 exists to refuse.
 * Prefer deleting the projection.
 */
export const RULE_2_ALLOWLIST: readonly AllowlistEntry[] = [];

/** A scan that could not complete — always exit 2, never 1. */
export class AcStateRendererScanError extends Error {
  constructor(
    readonly reasonCode:
      | "missing-scan-root"
      | "empty-walk"
      | "unreadable-file"
      | "degenerate-alphabet"
      | "bad-rule-name"
      | "empty-repo-root-override",
    message: string,
  ) {
    super(message);
    this.name = "AcStateRendererScanError";
  }
}

/** One finding. Both `functionName` and `file` are printed — AC-CT-1/AC-CT-7 pin both. */
export interface RendererViolation {
  readonly rule: RuleName;
  readonly file: string;
  readonly functionName: string;
  readonly line: number;
  readonly detail: string;
}

// ─── Textual passes ─────────────────────────────────────────────────────────

/**
 * Blanks the CONTENT of single- and double-quoted string literals and the STATIC parts
 * of template literals, preserving length and line count, while KEEPING `${…}`
 * interpolation bodies intact because those are code.
 *
 * ⛔ Why this exists alongside `stripCommentsPreservingLines` rather than inside it:
 * that function deliberately keeps string content (its own rule R2 matches a string),
 * and this scan needs BOTH views of the same file — the string-preserving one to find
 * glyph literals, and this string-blanked one to brace-balance function bodies and to
 * test type-annotation positions without a `"AcCoverageFact"` string masquerading as
 * one. Two views, same offsets, so a match found in one is locatable in the other.
 *
 * ⛔ Keeping `${…}` is load-bearing, not an optimisation: `` `${fact.pass}/${fact.fail}` ``
 * is a real RULE 1 read, and blanking template bodies wholesale would have made every
 * interpolated read in `commands/ac.ts` and `assess-template.ts` invisible.
 *
 * @param source - one file's text, ALREADY comment-blanked.
 * @returns the same text and length with string/static-template content blanked.
 * @example
 * blankStringLiteralsPreservingLines('const a = "✘";') // => 'const a = " ";'
 */
export function blankStringLiteralsPreservingLines(source: string): string {
  const out = source.split("");
  const blank = (index: number): void => {
    if (out[index] !== "\n") out[index] = " ";
  };

  /** `"template"` frames push/pop as `${` … `}` nest. */
  type Frame = { kind: "template"; braceDepth: number };
  const templateStack: Frame[] = [];
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < source.length; index++) {
    const char = source[index] as string;

    if (quote !== null) {
      if (char === "\\") {
        blank(index);
        if (index + 1 < source.length) {
          blank(index + 1);
          index++;
        }
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      // reason: an unescaped raw newline cannot occur inside a '…' / "…" literal, so a
      // mis-detected quote self-heals at the line break instead of blanking the rest of
      // the file.
      if (char === "\n") {
        quote = null;
        continue;
      }
      blank(index);
      continue;
    }

    const frame = templateStack.length > 0 ? (templateStack[templateStack.length - 1] as Frame) : undefined;
    const inTemplateStaticPart = frame !== undefined && frame.braceDepth === 0;

    if (inTemplateStaticPart) {
      if (char === "\\") {
        blank(index);
        if (index + 1 < source.length) {
          blank(index + 1);
          index++;
        }
        continue;
      }
      if (char === "$" && source[index + 1] === "{") {
        frame.braceDepth = 1;
        index++;
        continue;
      }
      if (char === "`") {
        templateStack.pop();
        continue;
      }
      blank(index);
      continue;
    }

    // Code position — either the module body or a `${…}` interpolation.
    if (char === "`") {
      templateStack.push({ kind: "template", braceDepth: 0 });
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (frame !== undefined) {
      if (char === "{") frame.braceDepth += 1;
      else if (char === "}") {
        frame.braceDepth -= 1;
        if (frame.braceDepth === 0) continue;
      }
    }
  }

  return out.join("");
}

// ─── Function regions ───────────────────────────────────────────────────────

/**
 * One named function's extent in a file, as byte offsets into the ORIGINAL source (both
 * textual views share those offsets).
 */
export interface FunctionRegion {
  readonly name: string;
  /** Offset of the header keyword / binding name. */
  readonly start: number;
  /** Offset just past the header, where the body (or expression) begins. */
  readonly bodyStart: number;
  /** Offset just past the region. */
  readonly end: number;
  readonly line: number;
}

/** `function foo` / `export async function foo` / `function* foo`. */
const DECLARATION_HEADER = /(?:^|[\s;{}()=,])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g;
/** `const foo = (…) =>` / `let foo: T = function (…)`. */
const BINDING_HEADER = /(?:^|[\s;{}])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$][\w$]*\s*)?(?=\()/g;
/** An indented class method / object method: `  private foo(…) {`. */
const METHOD_HEADER = /^[ \t]+(?:(?:public|private|protected|static|readonly|async|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?(?=\()/gm;

/**
 * Identifiers {@link METHOD_HEADER} would otherwise read as method names. Control-flow
 * keywords are followed by `(` exactly like a method is.
 */
const NON_METHOD_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "do",
  "return",
  "typeof",
  "new",
  "function",
  "else",
  "try",
  "await",
  "yield",
  "case",
  "delete",
  "void",
  "in",
  "of",
  "import",
  "export",
  "throw",
  "constructor",
]);

/** How far past a header the body brace is searched before giving up. */
const HEADER_SCAN_BUDGET = 4000;

/**
 * Finds every NAMED function region in a file, so a violation can be attributed to a
 * function and RULE 2's conjunction can be evaluated per function rather than per file.
 *
 * ⛔ Anonymous callbacks are deliberately NOT regions: `criteria.flatMap((c) => {…})`
 * must stay part of its enclosing named function, or a glyph rendered in a callback
 * would be attributed to "nothing" and escape RULE 2's conjunction.
 *
 * @param codeOnly - the file with comments AND string content blanked (offsets intact).
 * @returns regions in ascending `start` order; overlapping (nested) regions are kept.
 * @throws {AcStateRendererScanError} never — an unresolvable header is skipped, which
 *   can only cost attribution precision, never soundness at the file level.
 * @example
 * findNamedFunctionRegions("function f() {\n  return 1;\n}\n")[0]?.name // => "f"
 */
export function findNamedFunctionRegions(codeOnly: string): FunctionRegion[] {
  const lineStarts = buildLineStarts(codeOnly);
  const headers: Array<{ name: string; start: number; afterName: number }> = [];

  for (const pattern of [DECLARATION_HEADER, BINDING_HEADER]) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(codeOnly); match !== null; match = pattern.exec(codeOnly)) {
      const name = match[1];
      if (name === undefined) continue;
      const nameOffset = codeOnly.indexOf(name, match.index);
      if (nameOffset < 0) continue;
      headers.push({ name, start: match.index, afterName: nameOffset + name.length });
    }
  }
  METHOD_HEADER.lastIndex = 0;
  for (let match = METHOD_HEADER.exec(codeOnly); match !== null; match = METHOD_HEADER.exec(codeOnly)) {
    const name = match[1];
    if (name === undefined || NON_METHOD_KEYWORDS.has(name)) continue;
    headers.push({ name, start: match.index, afterName: match.index + match[0].length });
  }

  headers.sort((a, b) => a.start - b.start);

  const regions: FunctionRegion[] = [];
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index] as { name: string; start: number; afterName: number };
    const nextHeaderStart = headers[index + 1]?.start ?? codeOnly.length;
    const resolved = resolveBody(codeOnly, header.afterName, Math.min(nextHeaderStart + HEADER_SCAN_BUDGET, codeOnly.length));
    if (resolved === null) continue;
    regions.push({
      name: header.name,
      start: header.start,
      bodyStart: resolved.bodyStart,
      end: resolved.end,
      line: offsetToLine(lineStarts, header.start),
    });
  }
  return regions;
}

/**
 * Resolves one header's parameter list and body extent.
 *
 * @param codeOnly - string-blanked source.
 * @param afterName - offset just past the function name.
 * @param scanLimit - hard stop, so a malformed header cannot walk the whole file.
 * @returns body span, or `null` when no parameter list or body could be located.
 */
function resolveBody(codeOnly: string, afterName: number, scanLimit: number): { bodyStart: number; end: number } | null {
  let index = afterName;
  // Skip a generic parameter list before `(`.
  while (index < scanLimit && codeOnly[index] !== "(") {
    const char = codeOnly[index] as string;
    if (char === "{" || char === ";" || char === "\n") {
      if (char !== "\n") return null;
    }
    index++;
  }
  if (index >= scanLimit || codeOnly[index] !== "(") return null;

  let parenDepth = 0;
  for (; index < scanLimit; index++) {
    const char = codeOnly[index] as string;
    if (char === "(") parenDepth++;
    else if (char === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        index++;
        break;
      }
    }
  }
  if (parenDepth !== 0) return null;

  let depth = 0;
  let firstBraceAtDepthZero = -1;
  let semicolonAtDepthZero = -1;
  for (; index < scanLimit; index++) {
    const char = codeOnly[index] as string;
    if (depth === 0 && char === "{") {
      if (restOfLineIsBlank(codeOnly, index + 1)) {
        return { bodyStart: index, end: matchBrace(codeOnly, index) };
      }
      if (firstBraceAtDepthZero < 0) firstBraceAtDepthZero = index;
    }
    if (depth === 0 && char === ";" && firstBraceAtDepthZero < 0) {
      semicolonAtDepthZero = index;
      break;
    }
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
  }

  if (firstBraceAtDepthZero >= 0) {
    return { bodyStart: firstBraceAtDepthZero, end: matchBrace(codeOnly, firstBraceAtDepthZero) };
  }
  if (semicolonAtDepthZero >= 0) return { bodyStart: afterName, end: semicolonAtDepthZero + 1 };
  return null;
}

/** True when only whitespace remains on the line starting at `from`. */
function restOfLineIsBlank(codeOnly: string, from: number): boolean {
  for (let index = from; index < codeOnly.length; index++) {
    const char = codeOnly[index] as string;
    if (char === "\n") return true;
    if (char !== " " && char !== "\t" && char !== "\r") return false;
  }
  return true;
}

/** Offset just past the `}` matching the `{` at `open`; end-of-file when unbalanced. */
function matchBrace(codeOnly: string, open: number): number {
  let depth = 0;
  for (let index = open; index < codeOnly.length; index++) {
    const char = codeOnly[index] as string;
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return codeOnly.length;
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function offsetToLine(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((lineStarts[mid] as number) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

// ─── RULE 1 ─────────────────────────────────────────────────────────────────

/** A `.fail` / `.pass` (or `?.fail` / `?.pass`) member read. Never `attested_pass`. */
const FACT_FIELD_READ = /(?:\?\.|\.)\s*(fail|pass)\b/g;

/**
 * RULE 1 findings for one file.
 *
 * @param relPath - repo-relative POSIX path.
 * @param codeOnly - comments AND string content blanked. ⛔ The string-blanked view is
 *   deliberate: `"…fact.fail…"` inside a doc-example STRING is not a read, while
 *   `` `${fact.fail}` `` IS one and survives because
 *   {@link blankStringLiteralsPreservingLines} keeps `${…}` bodies.
 * @param regions - {@link findNamedFunctionRegions} output for `codeOnly`.
 */
function collectFactFieldReads(
  relPath: string,
  codeOnly: string,
  regions: readonly FunctionRegion[],
): RendererViolation[] {
  if (!TYPE_ANCHOR_PATTERN.test(codeOnly)) return [];
  const lineStarts = buildLineStarts(codeOnly);
  const violations: RendererViolation[] = [];
  FACT_FIELD_READ.lastIndex = 0;
  for (let match = FACT_FIELD_READ.exec(codeOnly); match !== null; match = FACT_FIELD_READ.exec(codeOnly)) {
    const field = match[1] as string;
    violations.push({
      rule: "fact-field-read",
      file: relPath,
      functionName: enclosingFunctionName(regions, match.index),
      line: offsetToLine(lineStarts, match.index),
      detail: `reads \`.${field}\` in a file that consumes \`AcCoverageFact\` — derive the verdict from \`deriveAcCoverageState(fact)\` instead`,
    });
  }
  return violations;
}

/**
 * The INNERMOST region containing `offset`, or a marker when the read sits at module
 * scope. ⛔ Never returns `""` — a violation with no attribution would satisfy neither
 * AC's "naming it" clause.
 */
function enclosingFunctionName(regions: readonly FunctionRegion[], offset: number): string {
  let best: FunctionRegion | undefined;
  for (const region of regions) {
    if (offset < region.start || offset >= region.end) continue;
    if (best === undefined || region.end - region.start < best.end - best.start) best = region;
  }
  return best?.name ?? "(module scope)";
}

// ─── RULE 2 ─────────────────────────────────────────────────────────────────

const QUOTED_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const TEMPLATE_LITERAL = /`(?:[^`\\]|\\.)*`/gs;
const INTERPOLATION = /\$\{[^}]*\}/g;
const TYPE_ANNOTATION_POSITION = /:[^;=]{0,240}?\bAcCoverage(?:Fact|State)\b|\b(?:as|satisfies)\s+AcCoverage(?:Fact|State)\b/;
const INLINE_INDEXED_LITERAL = /(\{[^{}]*\}|\[[^[\]]*\])\s*\[/g;
const LITERAL_BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(\{[^{}]*\}|\[[^[\]]*\])/g;

function containsGlyph(text: string): boolean {
  return AC_COVERAGE_GLYPH_ALPHABET.some((glyph) => text.includes(glyph));
}

/**
 * Which of the FOUR enumerated forms (if any) yields a glyph inside `regionText`.
 *
 * @param regionText - the region sliced from the STRING-PRESERVING view.
 * @param signatureText - the region's header slice, for the return-type form.
 * @returns the first matching form, or `null` — a shape outside the four is out of the
 *   rule's scope by construction (SPEC-143 R7/R8).
 */
export function detectGlyphYieldForm(regionText: string, signatureText: string): GlyphYieldForm | null {
  QUOTED_LITERAL.lastIndex = 0;
  const signatureLiterals = signatureText.match(QUOTED_LITERAL) ?? [];
  if (signatureLiterals.some(containsGlyph)) return "string-literal-union-return-type";

  QUOTED_LITERAL.lastIndex = 0;
  const literals = regionText.match(QUOTED_LITERAL) ?? [];
  if (literals.some(containsGlyph)) return "bare-string-literal";

  TEMPLATE_LITERAL.lastIndex = 0;
  const templates = regionText.match(TEMPLATE_LITERAL) ?? [];
  if (templates.some((template) => containsGlyph(template.replace(INTERPOLATION, "")))) {
    return "template-literal-static-part";
  }

  INLINE_INDEXED_LITERAL.lastIndex = 0;
  for (let match = INLINE_INDEXED_LITERAL.exec(regionText); match !== null; match = INLINE_INDEXED_LITERAL.exec(regionText)) {
    if (containsGlyph(match[1] as string)) return "indexed-object-or-array-literal";
  }
  LITERAL_BINDING.lastIndex = 0;
  for (let match = LITERAL_BINDING.exec(regionText); match !== null; match = LITERAL_BINDING.exec(regionText)) {
    const name = match[1] as string;
    if (!containsGlyph(match[2] as string)) continue;
    if (new RegExp(`\\b${name}\\s*\\[`).test(regionText)) return "indexed-object-or-array-literal";
  }
  return null;
}

/**
 * RULE 2 findings for one file — the two-condition conjunction, evaluated per region.
 *
 * @param codeOnly - for condition (i): a `"AcCoverageFact"` STRING must not read as a
 *   type annotation.
 * @param codeWithStrings - for condition (ii): the glyph literals must survive.
 */
function collectGlyphProjections(
  relPath: string,
  codeOnly: string,
  codeWithStrings: string,
  regions: readonly FunctionRegion[],
): RendererViolation[] {
  const violations: RendererViolation[] = [];
  for (const region of regions) {
    const namesFactType = TYPE_ANNOTATION_POSITION.test(codeOnly.slice(region.start, region.end));
    if (!namesFactType) continue;
    const form = detectGlyphYieldForm(
      codeWithStrings.slice(region.start, region.end),
      codeWithStrings.slice(region.start, region.bodyStart),
    );
    if (form === null) continue;
    violations.push({
      rule: "glyph-projection",
      file: relPath,
      functionName: region.name,
      line: region.line,
      detail:
        `is a SECOND state-to-glyph projection: it names \`AcCoverageFact\`/\`AcCoverageState\` in a type ` +
        `position AND yields a glyph from \`projectAcCoverageGlyph\`'s alphabet as a ${form}. ` +
        `Delegate to \`projectAcCoverageGlyph(deriveAcCoverageState(fact))\` (${PROJECTION_SSOT_FILE}).`,
    });
  }
  return violations;
}

// ─── Tree walk ──────────────────────────────────────────────────────────────

function walkSourceFiles(treeRoot: string, absDir: string, out: string[]): void {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      walkSourceFiles(treeRoot, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relative(treeRoot, abs).split(sep).join("/");
    if (!isScannableSourceFile(rel)) continue;
    // reason: GENERATED code is exempt from these conventions AND makes the scan's own
    // file count non-reproducible — measured 2026-08-23: `packages/dashboard/src/
    // routeTree.gen.ts` is gitignored and only exists after `@tanstack/router-cli
    // generate` has run, so the same tree scanned 362 files before a dashboard prebuild
    // and 363 after. `isScannableSourceFile` (check-plan-membership-sites.ts) excludes a
    // `generated/` DIRECTORY but not a `*.gen.ts` FILE, and widening the shared helper
    // would change the other oracle's scope too, so the exclusion lives here.
    if (GENERATED_FILE_SUFFIXES.some((suffix) => rel.endsWith(suffix))) continue;
    out.push(rel);
  }
}

function isWaived(allowlist: readonly AllowlistEntry[], violation: RendererViolation): boolean {
  return allowlist.some(
    (entry) =>
      entry.file === violation.file &&
      (entry.functions === undefined || entry.functions.includes(violation.functionName)),
  );
}

/**
 * Runs the selected rules over one tree.
 *
 * @param treeRoot - absolute path to the tree to walk (the real repo, or a mirror).
 * @param rules - which rules to run; no `--rule` flag means both.
 * @returns violations plus the file count, so a vacuous scan is distinguishable from a
 *   clean one.
 * @throws {AcStateRendererScanError} when the scan cannot complete — a missing scan
 *   root, an empty walk, an unreadable file, or a degenerate imported alphabet.
 */
export function scanTree(
  treeRoot: string,
  rules: readonly RuleName[],
): { violations: RendererViolation[]; scannedFiles: number } {
  const distinctGlyphs = new Set(AC_COVERAGE_GLYPH_ALPHABET);
  if (distinctGlyphs.size !== AC_COVERAGE_GLYPH_ALPHABET.length || distinctGlyphs.size === 0) {
    throw new AcStateRendererScanError(
      "degenerate-alphabet",
      `the glyph alphabet imported from ${PROJECTION_SSOT_FILE} has ${AC_COVERAGE_GLYPH_ALPHABET.length} ` +
        `entr(ies) collapsing to ${distinctGlyphs.size} distinct glyph(s) — RULE 2 cannot discriminate a ` +
        "second projection against a non-injective alphabet, so no verdict is measurable",
    );
  }

  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = join(treeRoot, root);
    let isDirectory = false;
    try {
      isDirectory = statSync(absRoot).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      throw new AcStateRendererScanError(
        "missing-scan-root",
        `scan root "${root}" is absent from the tree at ${treeRoot} — the scan cannot complete, and a ` +
          "partial walk would render as a clean verdict",
      );
    }
    walkSourceFiles(treeRoot, absRoot, files);
  }
  if (files.length === 0) {
    throw new AcStateRendererScanError(
      "empty-walk",
      `walked ${SCAN_ROOTS.length} scan root(s) under ${treeRoot} and found zero scannable source files`,
    );
  }

  const violations: RendererViolation[] = [];
  for (const relPath of files.sort()) {
    if (relPath === PROJECTION_SSOT_FILE) continue;
    let source: string;
    try {
      source = readFileSync(join(treeRoot, relPath), "utf8");
    } catch (error) {
      throw new AcStateRendererScanError(
        "unreadable-file",
        `could not read ${relPath} under ${treeRoot}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let codeWithStrings: string;
    try {
      codeWithStrings = stripCommentsPreservingLines(source);
    } catch (error) {
      throw new AcStateRendererScanError(
        "unreadable-file",
        `comment strip failed on ${relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const codeOnly = blankStringLiteralsPreservingLines(codeWithStrings);
    const regions = findNamedFunctionRegions(codeOnly);

    if (rules.includes("fact-field-read")) {
      for (const violation of collectFactFieldReads(relPath, codeOnly, regions)) {
        if (!isWaived(RULE_1_ALLOWLIST, violation)) violations.push(violation);
      }
    }
    if (rules.includes("glyph-projection")) {
      for (const violation of collectGlyphProjections(relPath, codeOnly, codeWithStrings, regions)) {
        if (!isWaived(RULE_2_ALLOWLIST, violation)) violations.push(violation);
      }
    }
  }
  return { violations, scannedFiles: files.length };
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Parses `--rule <name>`; absent means BOTH rules (AC-CT-7).
 *
 * @throws {AcStateRendererScanError} on an unknown or missing rule name — a typo must
 *   never silently select "both" and read as green.
 */
export function parseRuleSelection(argv: readonly string[]): RuleName[] {
  const flagIndex = argv.findIndex((arg) => arg === "--rule" || arg.startsWith("--rule="));
  if (flagIndex < 0) return [...RULE_NAMES];
  const raw = (argv[flagIndex] as string).startsWith("--rule=")
    ? (argv[flagIndex] as string).slice("--rule=".length)
    : argv[flagIndex + 1];
  if (raw === undefined || raw.length === 0) {
    throw new AcStateRendererScanError("bad-rule-name", `--rule needs a name; one of ${RULE_NAMES.join(" | ")}`);
  }
  const matched = RULE_NAMES.find((name) => name === raw);
  if (matched === undefined) {
    throw new AcStateRendererScanError("bad-rule-name", `unknown --rule "${raw}"; one of ${RULE_NAMES.join(" | ")}`);
  }
  return [matched];
}

/**
 * argv → exit code.
 *
 * @param argv - process args after the script path.
 * @param repoRootOverride - the tree to scan; the test seam behind
 *   `LORE_AC_STATE_RENDERERS_REPO_ROOT`. ⛔ Never set by production callers.
 * @returns 0 clean, 1 violations, 2 scan could not complete.
 */
export function main(argv: readonly string[], repoRootOverride?: string): number {
  let rules: RuleName[];
  try {
    rules = parseRuleSelection(argv);
  } catch (error) {
    reportScanFailure(error);
    return 2;
  }

  const treeRoot = repoRootOverride !== undefined ? resolve(repoRootOverride) : REPO_ROOT;
  let result: { violations: RendererViolation[]; scannedFiles: number };
  try {
    result = scanTree(treeRoot, rules);
  } catch (error) {
    reportScanFailure(error);
    return 2;
  }

  if (result.violations.length > 0) {
    console.error(`${SCRIPT_NAME}: ${result.violations.length} violation(s) in ${treeRoot}`);
    for (const violation of result.violations) {
      console.error(`  [${violation.rule}] ${violation.file}:${violation.line} ${violation.functionName}() — ${violation.detail}`);
    }
    console.error(
      `${SCRIPT_NAME}: rule(s) run: ${rules.join(", ")}; ${result.scannedFiles} file(s) scanned. ` +
        "Fix the site, or add a written-reason allowlist entry that says which blind spot it widens.",
    );
    return 1;
  }

  console.log(
    `${SCRIPT_NAME}: OK — rule(s) ${rules.join(", ")} over ${result.scannedFiles} file(s) in ` +
      `${SCAN_ROOTS.length} scan root(s); 0 violation(s) ` +
      `(${RULE_1_ALLOWLIST.length} rule-1 / ${RULE_2_ALLOWLIST.length} rule-2 written-reason waiver(s)).`,
  );
  return 0;
}

/** Every fatal path prints the SCRIPT's own name, so an exit 2 is attributable to it. */
function reportScanFailure(error: unknown): void {
  if (error instanceof AcStateRendererScanError) {
    console.error(`${SCRIPT_NAME}: scan could not complete (${error.reasonCode}) — ${error.message}`);
    return;
  }
  console.error(`${SCRIPT_NAME}: scan could not complete — ${error instanceof Error ? error.message : String(error)}`);
}

if (import.meta.main) {
  // `LORE_AC_STATE_RENDERERS_REPO_ROOT` wires `main`'s `repoRootOverride` seam to this
  // real entrypoint, mirroring `check-anchor-coverage.ts`'s
  // `LORE_ANCHOR_COVERAGE_REPO_ROOT`. ⛔ Never set by production callers — production
  // always scans THIS script's own repo. It exists because this oracle's own suite
  // (`packages/lore/tests/unit/scripts/check-ac-state-renderers.test.ts`) must point it
  // at a throwaway mkdtemp MIRROR carrying a deliberately-violating fixture, which must
  // never be written into the live tree. Validated rather than trusted: a set-but-empty
  // value would silently resolve the scan roots against the process cwd and every
  // fixture-tree assertion would then measure the real repo.
  const rawRepoRoot = process.env["LORE_AC_STATE_RENDERERS_REPO_ROOT"];
  if (rawRepoRoot !== undefined && rawRepoRoot.trim().length === 0) {
    console.error(
      `${SCRIPT_NAME}: LORE_AC_STATE_RENDERERS_REPO_ROOT is set but empty — unset it, or point it at a real directory.`,
    );
    process.exit(2);
  }
  process.exit(main(process.argv.slice(2), rawRepoRoot));
}
