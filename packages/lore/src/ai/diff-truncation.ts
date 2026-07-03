/**
 * File-boundary-aware truncation for the `lore assess` diff prompt section (SPEC-028).
 *
 * The pre-existing `truncateSection` helper (`@lore/core`) does a blind tail cut of a
 * unified diff — it can slice a file's hunk in half and, worse, silently drops whichever
 * files happen to sort last, regardless of relevance. `truncateDiffByFile` replaces that
 * for the diff section only: it splits the diff into whole-file chunks and keeps files in
 * priority order — production source (`src/`) first, then tests, then everything else —
 * never cutting a kept file mid-body.
 *
 * Public surface:
 *   - truncateDiffByFile(diffText, maxChars) — the truncation entry point
 *   - classifyDiffFilePriority(filePath) — exported for test/inspection reuse
 *   - DiffFilePriority, TruncateDiffResult — result types
 *
 * Invariants:
 *   - No IO, no Date.now()/Math.random() — pure function of its two inputs.
 *   - When `diffText.length <= maxChars`, the returned `text` is byte-identical to
 *     `diffText` (AC-AE-4 no-op guarantee). The fast-path check runs BEFORE any parsing,
 *     so a within-budget diff is never re-tokenized or reformatted.
 *   - A kept file chunk is never cut mid-body: a file is either included whole or fully
 *     omitted — EXCEPT the single-file-exceeds-whole-budget fallback (AC-AE-2), which
 *     performs one labeled head-truncation of that highest-priority file and omits every
 *     other file (there is no room left for anything else).
 *   - Priority ordering (source > test > other) is a stable sort keyed on each file's
 *     original position in the diff — re-running with the same input always yields the
 *     same keep/omit set (STATE dimension, AC-AE-5).
 *
 * Error handling (documented choice — AC-AE-5 ERROR dimension): a diff with no
 * recognizable `diff --git a/... b/...` file headers is NOT rejected. It is treated as a
 * single opaque chunk (`filePath = "(unparsed diff)"`, priority `"other"`) and still goes
 * through the same budget/truncation rules. This is a deliberate PASSTHROUGH, not a
 * silent-fallback anti-pattern: by the time this function runs, the diff text has already
 * been successfully read by the CLI layer (`git diff` / `--diff-file`) — failing loud here
 * would abort the entire `assess` run over a cosmetic parse miss on an advisory,
 * best-effort prompt section. The degraded parse stays visible to the caller: the
 * placeholder path is a real string in `omittedFiles` / `headTruncatedFile`, so downstream
 * `judgment.truncated` records `"diff:(unparsed diff)"` instead of silently reporting
 * nothing.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-028 AC-AE-2, AC-AE-4, AC-AE-5
 */

/** Priority bucket used to decide which files survive truncation first. */
export type DiffFilePriority = "source" | "test" | "other";

/** One file's slice of a unified diff, with its classified priority and original position. */
interface DiffFileChunk {
  readonly filePath: string;
  readonly priority: DiffFilePriority;
  readonly text: string;
  readonly originalIndex: number;
}

/** Result of {@link truncateDiffByFile}. */
export interface TruncateDiffResult {
  /** The (possibly truncated) diff text to embed in the judge prompt. */
  text: string;
  /** True iff any truncation occurred — a whole-file drop and/or the head-truncation fallback. */
  truncated: boolean;
  /** File paths fully dropped from the prompt. Never includes a partially-shown file — see `headTruncatedFile`. */
  omittedFiles: string[];
  /**
   * Set only when the single highest-priority file alone exceeds `maxChars` and had to be
   * head-truncated (AC-AE-2 fallback). `keptChars`/`totalChars` describe that one file's
   * own diff-chunk length, not the whole diff.
   */
  headTruncatedFile?: { filePath: string; keptChars: number; totalChars: number };
}

const TEST_PATH_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)(tests?|__tests__)(\/|$))/i;
const SOURCE_PATH_PATTERN = /(^|\/)src\//;
const FILE_HEADER_PATTERN = /^diff --git a\/(.*) b\/(.*)$/;

/**
 * Classify a file path into a truncation-priority bucket. Test-ness is checked BEFORE
 * source-ness because this repo (and most TS projects) co-locates `*.test.ts` files inside
 * `src/` — a file under `src/` that is ALSO a test file must rank as "test", not "source".
 *
 * @param filePath - File path as it appears in the diff (post-change / `b/` side)
 * @returns "source" for production code under `src/`, "test" for test files, else "other"
 *
 * @example
 * classifyDiffFilePriority("packages/core/src/assessment.ts") // "source"
 * classifyDiffFilePriority("packages/core/src/assessment.test.ts") // "test"
 * classifyDiffFilePriority("docs/requirements/spec/SPEC-028.md") // "other"
 */
export function classifyDiffFilePriority(filePath: string): DiffFilePriority {
  if (TEST_PATH_PATTERN.test(filePath)) return "test";
  if (SOURCE_PATH_PATTERN.test(filePath)) return "source";
  return "other";
}

const PRIORITY_RANK: Record<DiffFilePriority, number> = { source: 0, test: 1, other: 2 };

/**
 * Split a unified diff into per-file chunks, preserving each file's original relative
 * order. Falls back to a single opaque "(unparsed diff)" chunk when no `diff --git`
 * headers are found (see module header's documented ERROR-handling choice).
 */
function parseDiffIntoChunks(diffText: string): DiffFileChunk[] {
  const lines = diffText.split("\n");
  const headerIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (FILE_HEADER_PATTERN.test(lines[i] as string)) headerIndices.push(i);
  }

  if (headerIndices.length === 0) {
    return [{ filePath: "(unparsed diff)", priority: "other", text: diffText, originalIndex: 0 }];
  }

  const chunks: DiffFileChunk[] = [];
  for (let i = 0; i < headerIndices.length; i++) {
    const start = headerIndices[i] as number;
    const end = i + 1 < headerIndices.length ? (headerIndices[i + 1] as number) : lines.length;
    const chunkLines = lines.slice(start, end);
    const match = FILE_HEADER_PATTERN.exec(lines[start] as string);
    // reason: use the post-change ("b/") path as the canonical identity — matches how most
    // static-analysis tooling attributes a diff hunk (new/renamed-to name), and is stable
    // for additions/modifications/deletions alike since `git diff --git` headers always
    // carry real a/b paths (the /dev/null placeholder only appears in the --- / +++ lines).
    const filePath = (match?.[2] ?? "(unknown)").trim();
    chunks.push({ filePath, priority: classifyDiffFilePriority(filePath), text: chunkLines.join("\n"), originalIndex: i });
  }
  return chunks;
}

/**
 * Truncate a unified diff to `maxChars`, preferring whole files in priority order
 * (production source, then tests, then everything else) over a blind tail cut. See the
 * module header for the no-op and single-huge-file fallback rules.
 *
 * @param diffText - Raw unified diff text (already read by the CLI layer)
 * @param maxChars - Character budget (`ai.assess.max_diff_chars`)
 * @returns {@link TruncateDiffResult}
 *
 * @example
 * const result = truncateDiffByFile(diffText, 24000);
 * // result.truncated === false when diffText.length <= 24000 (byte-identical text)
 */
export function truncateDiffByFile(diffText: string, maxChars: number): TruncateDiffResult {
  if (diffText.length <= maxChars) {
    return { text: diffText, truncated: false, omittedFiles: [] };
  }

  const chunks = parseDiffIntoChunks(diffText);
  const sorted = [...chunks].sort((a, b) => {
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return rankDiff !== 0 ? rankDiff : a.originalIndex - b.originalIndex;
  });

  const top = sorted[0] as DiffFileChunk;
  if (top.text.length > maxChars) {
    const label =
      `\n[... TRUNCATED: showing head of "${top.filePath}" only — ${top.text.length} total chars for ` +
      `this file alone exceed the ${maxChars}-char diff budget; ${chunks.length - 1} other file(s) omitted entirely ...]`;
    const contentBudget = Math.max(0, maxChars - label.length);
    let text = `${top.text.slice(0, contentBudget)}${label}`;
    // reason: on a pathologically small budget (smaller than the label itself), the
    // `Math.max(0, ...)` floor above still leaves `text` longer than maxChars because the
    // label is always appended in full — this hard clamp is the final safety net that
    // guarantees the "never exceed maxChars" contract even in that regime, at the cost of
    // truncating the label's own text in that rare case.
    if (text.length > maxChars) text = text.slice(0, maxChars);
    const omittedFiles = chunks.filter((c) => c.filePath !== top.filePath).map((c) => c.filePath);
    return {
      text,
      truncated: true,
      omittedFiles,
      headTruncatedFile: { filePath: top.filePath, keptChars: contentBudget, totalChars: top.text.length },
    };
  }

  // reason: the final text re-joins kept chunks with "\n" (one separator per gap between
  // kept chunks) — the greedy walk below must reserve that separator cost as it goes, or a
  // tightly-packed selection can overshoot maxChars by (keptCount - 1) characters.
  const keptIndices = new Set<number>();
  let remaining = maxChars;
  let keptCount = 0;
  for (const chunk of sorted) {
    const joinCost = keptCount > 0 ? 1 : 0;
    const cost = chunk.text.length + joinCost;
    if (cost <= remaining) {
      keptIndices.add(chunk.originalIndex);
      remaining -= cost;
      keptCount++;
    }
  }

  const omittedFiles = chunks.filter((c) => !keptIndices.has(c.originalIndex)).map((c) => c.filePath);
  const text = chunks
    .filter((c) => keptIndices.has(c.originalIndex))
    .map((c) => c.text)
    .join("\n");

  return { text, truncated: omittedFiles.length > 0, omittedFiles };
}
