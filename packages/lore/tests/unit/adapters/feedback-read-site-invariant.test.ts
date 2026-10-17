// @reads packages/core/src/**
// @reads packages/lore/packages/lore/src
// @reads packages/lore/src/**
// @reads packages/lore/tests/packages/lore/src
// @reads packages/lore/tests/unit/adapters/packages/lore/src
// @reads packages/lore/tests/unit/packages/lore/src
// @reads packages/packages/lore/src
/**
 * @spec_ref spec-out-of-box-reporting-channel-report-issue-self-provisions
 *   (plan invariant 1, plan-implementation-out-of-box-reporting-channel-self-provision:
 *   "No new config-read site. resolveFeedbackUpstreamCfg (report-issue-wiring.ts) stays the
 *   ONLY place feedback.upstream is read." — no formal AC-OOB-N id exists for this structural
 *   invariant; it was previously "verified by diff" only, per task
 *   task-mechanical-oracle-for-the-single-read-site-invariant-on. This file promotes it to a
 *   mechanical, diff-independent oracle.)
 *
 * Ground truth at authoring time (repo-wide, excluding test files):
 *   packages/lore/src/adapters/cli/report-issue-wiring.ts:135
 *     `return config?.feedback?.upstream;` inside `resolveFeedbackUpstreamCfg`
 *   — the ONLY dot-notation property read of `.feedback` anywhere in
 *   packages/lore/src/** or packages/core/src/**. Every other consumer (e.g.
 *   adapters/mcp/tools.ts calling `resolveFeedbackUpstreamCfg(getConfig?.())`) goes through the
 *   exported accessor. Deliberately OUT of scope for this scan: the bracket-notation
 *   `config["feedback"]` / `existingFeedback?.["upstream"]` idempotency check inside
 *   `provisionFeedbackUpstream` (same file, WRITE path) — that is the self-provisioning
 *   writer's own "is it already configured" guard before a merge-write, a different concern
 *   from the SSOT "who reads this field to decide behaviour" invariant this test guards, and
 *   the plan invariant's own "exactly ONE direct read" ground truth already excludes it.
 *
 * Method: read every `.ts` source file (excluding `.test.ts`/`.spec.ts`/`.bun.test.ts`/`.d.ts`)
 * under packages/lore/src and packages/core/src from disk via node:fs, strip comments and
 * string/template literals (preserving line numbers), then regex-scan for a dot-notation
 * `.feedback` property read. Comments/prose mentioning "feedback.upstream" (e.g.
 * `` `feedback.upstream.corpus_path` `` inside error-message strings or JSDoc) are NOT preceded
 * by a literal `.` before the word "feedback" in this codebase, so they do not match even
 * without stripping — proven by the synthetic + real-source tests below. Stripping is still
 * applied defensively, so a FUTURE comment that pastes a realistic-looking code example (this
 * codebase's JSDoc `@example` blocks routinely do) cannot silently become a false violation.
 *
 * Runner: vitest (pure fs/path read of source TEXT — no `bun:sqlite`, no subprocess/grep).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Walks up from this test file until a directory contains BOTH scan roots, never a hardcoded level count. */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "packages", "lore", "src")) && existsSync(join(dir, "packages", "core", "src"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `feedback-read-site-invariant scan: could not locate repo root (packages/lore/src + ` +
          `packages/core/src) walking up from ${startDir}`,
      );
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(__dirname);
const SCAN_ROOTS = [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")];

const PERMITTED_FILE = "packages/lore/src/adapters/cli/report-issue-wiring.ts";
const PERMITTED_FUNCTION = "resolveFeedbackUpstreamCfg";

/** Excludes test files even though none currently live under src/ — defensive, not load-bearing today. */
function isScannableSourceFile(fileName: string): boolean {
  return fileName.endsWith(".ts") && !fileName.endsWith(".d.ts") && !/\.(test|spec|bun\.test)\.ts$/.test(fileName);
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (st.isFile() && isScannableSourceFile(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Replaces every non-newline character in `match` with a space, so removed comment/string
 * regions vanish from the regex scan below while every line's 1-based line number stays
 * unchanged (needed for accurate `file:line` reporting).
 */
function blank(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

/**
 * Matches (in order, so a `//`/`/*` marker INSIDE a string is consumed as part of the string,
 * never mistaken for a comment start): double-quoted strings, single-quoted strings, backtick
 * template literals (may legitimately span multiple lines), `//` line comments, `/* *\/` block
 * comments.
 */
const STRIP_PATTERN = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

export function stripCommentsAndStrings(content: string): string {
  return content.replace(STRIP_PATTERN, blank);
}

/**
 * Dot-notation property read of `.feedback` (e.g. `config?.feedback?.upstream`,
 * `config.feedback.upstream`, or even a bare `config.feedback` reference) — deliberately NOT
 * matching bracket notation (`config["feedback"]`), which is the self-provisioning writer's own
 * idempotency-check shape, out of scope per this file's header.
 */
const FEEDBACK_DOT_READ_PATTERN = /\.feedback\b/;

/** A stricter shape check used only to pin the PERMITTED site's exact code — not the scan gate itself. */
const FEEDBACK_UPSTREAM_CHAIN_PATTERN = /\.feedback\s*\??\s*\.\s*upstream\b/;

export interface FeedbackReadHit {
  line: number;
  text: string;
}

/** Pure: scans a single file's already-read content string. Directly unit-testable with synthetic fixtures. */
export function findFeedbackUpstreamReadsInContent(content: string): FeedbackReadHit[] {
  const stripped = stripCommentsAndStrings(content);
  const strippedLines = stripped.split("\n");
  const originalLines = content.split("\n");
  const hits: FeedbackReadHit[] = [];
  strippedLines.forEach((strippedLine, idx) => {
    if (FEEDBACK_DOT_READ_PATTERN.test(strippedLine)) {
      hits.push({ line: idx + 1, text: originalLines[idx]!.trim() });
    }
  });
  return hits;
}

export interface FeedbackReadSite extends FeedbackReadHit {
  file: string; // relative to repo root, forward-slash
}

/** Walks the REAL repo's two scan roots and aggregates every hit with a repo-relative path. */
export function scanRepoForFeedbackUpstreamReads(): FeedbackReadSite[] {
  const sites: FeedbackReadSite[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsFiles(root)) {
      const content = readFileSync(file, "utf8");
      const relPath = relative(REPO_ROOT, file).split("\\").join("/");
      for (const hit of findFeedbackUpstreamReadsInContent(content)) {
        sites.push({ file: relPath, ...hit });
      }
    }
  }
  return sites;
}

function formatSites(sites: FeedbackReadSite[]): string {
  if (sites.length === 0) return "(none)";
  return sites.map((s) => `  ${s.file}:${s.line}: ${s.text}`).join("\n");
}

describe("plan invariant 1: resolveFeedbackUpstreamCfg is the sole config.feedback read site", () => {
  it("scanner sanity check: walks a non-trivial number of real source files (not scanning an empty tree)", () => {
    let fileCount = 0;
    for (const root of SCAN_ROOTS) fileCount += walkTsFiles(root).length;
    expect(fileCount).toBeGreaterThan(50);
  });

  it("permitted site still exists: at least one real read site is found (a refactor-away of report-issue-wiring.ts must NOT silently present as zero violations)", () => {
    const sites = scanRepoForFeedbackUpstreamReads();
    expect(sites.length, `expected >=1 read site, found 0. This means resolveFeedbackUpstreamCfg's own read either moved, was removed, or the scanner is broken — NOT that the invariant is satisfied.`).toBeGreaterThanOrEqual(1);
  });

  it("exactly one direct config.feedback read site exists across packages/lore/src and packages/core/src", () => {
    const sites = scanRepoForFeedbackUpstreamReads();
    const violations = sites.filter((s) => s.file !== PERMITTED_FILE);
    expect(
      violations,
      `found direct config.feedback read site(s) OUTSIDE the permitted file ` +
        `(${PERMITTED_FILE}). Every consumer must go through resolveFeedbackUpstreamCfg instead ` +
        `of reading config.feedback.upstream directly. Offending site(s):\n${formatSites(violations)}\n\n` +
        `All read sites found:\n${formatSites(sites)}`,
    ).toEqual([]);
    expect(
      sites.length,
      `expected exactly 1 total read site (the permitted one), found ${sites.length}:\n${formatSites(sites)}`,
    ).toBe(1);
  });

  it("the permitted site is inside resolveFeedbackUpstreamCfg and has the expected `config?.feedback?.upstream` shape", () => {
    const sites = scanRepoForFeedbackUpstreamReads();
    const permitted = sites.find((s) => s.file === PERMITTED_FILE);
    expect(permitted, `permitted site not found among: ${formatSites(sites)}`).toBeDefined();
    expect(FEEDBACK_UPSTREAM_CHAIN_PATTERN.test(permitted!.text)).toBe(true);

    // Confirm the hit line actually sits inside `resolveFeedbackUpstreamCfg`'s body, not merely
    // somewhere else in the same file (defends against the function being emptied out while an
    // unrelated `.feedback` read is added elsewhere in this same file).
    const fullPath = join(REPO_ROOT, PERMITTED_FILE);
    const lines = readFileSync(fullPath, "utf8").split("\n");
    const fnSignaturePattern = new RegExp(`export function ${PERMITTED_FUNCTION}\\(`);
    const fnLineIndex = lines.findIndex((l) => fnSignaturePattern.test(l));
    expect(fnLineIndex, `could not find 'export function ${PERMITTED_FUNCTION}(' in ${PERMITTED_FILE}`).toBeGreaterThanOrEqual(0);
    const fnStartLine = fnLineIndex + 1; // 1-based
    expect(permitted!.line).toBeGreaterThanOrEqual(fnStartLine);
    expect(permitted!.line).toBeLessThanOrEqual(fnStartLine + 10); // generous window, function body is a few lines
  });
});

describe("scanner correctness (synthetic fixtures — permanent, committed negative control)", () => {
  it("stripCommentsAndStrings blanks a // line comment but preserves line count", () => {
    const src = `const a = 1;\n// config.feedback.upstream mentioned here\nconst b = 2;\n`;
    const stripped = stripCommentsAndStrings(src);
    expect(stripped.split("\n").length).toBe(src.split("\n").length);
    expect(stripped).not.toContain("feedback");
  });

  it("stripCommentsAndStrings blanks a /* */ block comment (incl. JSDoc @example) but preserves line count", () => {
    const src = [
      "/**",
      " * @example",
      " *   const x = config.feedback.upstream; // looks like real code, but it's prose",
      " */",
      "const real = 1;",
      "",
    ].join("\n");
    const stripped = stripCommentsAndStrings(src);
    expect(stripped.split("\n").length).toBe(src.split("\n").length);
    expect(stripped).not.toContain("feedback");
  });

  it("stripCommentsAndStrings blanks string/template literal contents but preserves line count", () => {
    const src = `const msg = "feedback.upstream.corpus_path is required";\nconst tpl = \`feedback.upstream\`;\n`;
    const stripped = stripCommentsAndStrings(src);
    expect(stripped.split("\n").length).toBe(src.split("\n").length);
    expect(stripped).not.toContain("feedback");
  });

  it("findFeedbackUpstreamReadsInContent does NOT flag prose mentions of feedback.upstream inside comments/strings", () => {
    const src = [
      "/**",
      " * Narrows a parsed LoreConfig's optional `feedback.upstream` section.",
      " * See also `feedback.upstream.corpus_path` and `feedback.upstream.root_prd`.",
      " */",
      "export function example(config: unknown) {",
      '  const msg = "feedback.upstream is not configured";',
      "  return msg;",
      "}",
      "",
    ].join("\n");
    expect(findFeedbackUpstreamReadsInContent(src)).toEqual([]);
  });

  it("findFeedbackUpstreamReadsInContent DOES flag a real `.feedback?.upstream` read, at the correct line", () => {
    const src = ["export function example(config) {", "  return config?.feedback?.upstream;", "}", ""].join("\n");
    const hits = findFeedbackUpstreamReadsInContent(src);
    expect(hits).toEqual([{ line: 2, text: "return config?.feedback?.upstream;" }]);
  });

  it("NEGATIVE CONTROL: findFeedbackUpstreamReadsInContent detects a SECOND, independent read site distinct from the first", () => {
    // Simulates exactly the failure mode this whole test file exists to catch: a second
    // consumer bypassing resolveFeedbackUpstreamCfg and reading config.feedback.upstream
    // directly. This is the scanner's OWN mechanical proof that it does not pass vacuously —
    // it is permanently exercised on every run, independent of the one-off manual repo-edit
    // negative control performed (and reverted) while authoring this file.
    const src = [
      "export function siteOne(config) {",
      "  return config?.feedback?.upstream;",
      "}",
      "",
      "export function siteTwo(config) {",
      "  // a second, illegitimate direct read",
      "  return config.feedback.upstream;",
      "}",
      "",
    ].join("\n");
    const hits = findFeedbackUpstreamReadsInContent(src);
    expect(hits.map((h) => h.line)).toEqual([2, 7]);
    expect(hits.length).not.toBe(1); // exactly the shape that would fail the real invariant test above
  });

  it("findFeedbackUpstreamReadsInContent does NOT flag bracket-notation config['feedback'] access (write-path idempotency check, out of scope)", () => {
    const src = [
      "export function provisionFeedbackUpstream(root, candidate) {",
      '  const existingFeedback = typeof config["feedback"] === "object" ? config["feedback"] : undefined;',
      '  if (existingFeedback?.["upstream"] !== undefined) return ok(undefined);',
      "  const nextConfig = { ...config, feedback: { ...(existingFeedback ?? {}), upstream: candidate } };",
      "  return ok(undefined);",
      "}",
      "",
    ].join("\n");
    expect(findFeedbackUpstreamReadsInContent(src)).toEqual([]);
  });
});
