/**
 * Context attachment for a defect report: the test file the repro command names, its `@spec_ref` lines and,
 * for the upstream repository itself, its header.
 *
 * Purpose: bring the one fact a reporter may not have read (#362: "red by design" lived in the named test's header)
 * into the report (spec spec-defect-reports-carry-their-own-context-a-checked-repro "Context attachment", BR-1380).
 *
 * Public surface: `findNamedTestFile`, `buildReportContext`, `CONTEXT_HEADER_MAX_LINES`.
 * Invariants:
 *   - The test file is read only when its realpath stays under the project root's realpath (no symlink escape).
 *   - `@spec_ref` lines are attached verbatim, always; the header only when `sameRepository` (D3, D8).
 *   - Nothing attached from a named test file => the text says so; no test file named => `undefined`.
 *   - The attached text is passed through `redactHomeInText`.
 * Side-effect class: IO (one file read, realpath/stat); no throws (an unreadable file is "not a test file").
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { leadingCommentLines } from "./leading-comment.js";
import { redactHomeInText } from "./redact-home.js";

/** Header lines attached for the upstream repository itself. */
export const CONTEXT_HEADER_MAX_LINES = 40;

const TEST_FILE_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SPEC_REF_LINE = /@spec_ref\b/;

/** A test file that passed every check: its project-relative path and its text. */
export interface NamedTestFile {
  readonly relativePath: string;
  readonly content: string;
}

/** Strips one pair of matching surrounding quotes from a command word. */
function unquote(word: string): string {
  const first = word[0];
  if (word.length >= 2 && (first === "'" || first === '"') && word.endsWith(first)) return word.slice(1, -1);
  return word;
}

/**
 * Finds the test file a repro command names.
 *
 * @param command - the repro command (one line)
 * @param projectRoot - the reporting project's root
 * @returns the first word after the program that is an existing regular file under `projectRoot` (realpath
 *   included) named `*.test|spec.[cm]?[jt]sx?`; `undefined` when there is none
 */
export function findNamedTestFile(command: string, projectRoot: string): NamedTestFile | undefined {
  let realRoot: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    // reason: a project root that cannot be resolved has no readable test file; the report simply carries no context.
    return undefined;
  }
  const words = command.trim().split(/\s+/).slice(1).map(unquote);
  for (const word of words) {
    if (!TEST_FILE_NAME.test(word)) continue;
    try {
      const real = realpathSync(resolve(projectRoot, word));
      if (!real.startsWith(realRoot + sep)) continue;
      if (!statSync(real).isFile()) continue;
      return { relativePath: relative(realRoot, real).split(sep).join("/"), content: readFileSync(real, "utf8") };
    } catch {
      // reason: a word that is not an existing readable file is not the test file; try the next word.
      continue;
    }
  }
  return undefined;
}

/** Fence longer than any backtick run in `text`, so attached text cannot close its own block. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function fenced(label: string, lines: readonly string[]): string[] {
  const fence = fenceFor(lines.join("\n"));
  return [label, fence, ...lines, fence];
}

/**
 * Builds the `**Context:**` section text for a report.
 *
 * @param input.command - the report's repro command
 * @param input.projectRoot - the reporting project's root
 * @param input.home - the invocation's home folder, reduced to `~` in the attached text
 * @param input.sameRepository - `true` iff the reporting project is the upstream repository (header allowed)
 * @returns the section text starting with `**Context:**`, or `undefined` when the command names no test file
 */
export function buildReportContext(input: {
  readonly command: string;
  readonly projectRoot: string;
  readonly home: string;
  readonly sameRepository: boolean;
}): string | undefined {
  const file = findNamedTestFile(input.command, input.projectRoot);
  if (file === undefined) return undefined;
  const header = leadingCommentLines(file.content);
  while (header.length > 0 && header[header.length - 1]!.trim() === "") header.pop();
  const specRefs = header.filter((line) => SPEC_REF_LINE.test(line));
  const parts: string[] = [];
  if (specRefs.length > 0) parts.push(...fenced("@spec_ref lines:", specRefs));
  if (input.sameRepository && header.length > 0) {
    const shown = header.slice(0, CONTEXT_HEADER_MAX_LINES);
    const hidden = header.length - shown.length;
    parts.push(...fenced("Header:", hidden > 0 ? [...shown, `… ${String(hidden)} more lines`] : shown));
  }
  const text =
    parts.length === 0
      ? `**Context:** nothing to attach from ${file.relativePath}`
      : [`**Context:** ${file.relativePath}`, ...parts].join("\n");
  return redactHomeInText(text, input.home);
}
