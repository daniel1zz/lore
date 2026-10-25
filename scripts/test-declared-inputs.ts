/**
 * Declared test inputs (task-skill-implement-tg-13, AC-TG-7): the ONE parser and the ONE glob matcher
 * shared by the change selector (scripts/changed-tests.ts) and the run-time read recorder
 * (scripts/test-read-recorder.ts).
 *
 * Purpose: a test that depends on a repository file it does NOT statically import says so in its
 * leading comment block, one declaration per line:
 *
 *     // @reads packages/lore/assets/**              files the test reads (any fs call, in-process)
 *     // @spawns dist/lore                           programs/scripts the test starts as child processes
 *
 * Why a leading comment and not an exported const: the selector must learn a test's inputs WITHOUT
 * executing it, and a comment is parsed by the same cheap static scan the import graph already uses;
 * it needs no import edge, no runtime symbol, and no change to the test's own exports. Why only the
 * leading block: template-string fixtures inside a test (the selector's own tests embed sample
 * declarations) must not be read as declarations of the file that contains them.
 *
 * Public surface: parseDeclaredInputs, globToRegExp, matchesAnyPattern, COMPILED_BINARY_INPUTS,
 * DeclaredInputsError. Side-effect class: pure.
 * Invariants: patterns are repo-relative posix paths with `**` (any depth), `*` (one segment part),
 * `?` (one character); no absolute paths, no `..`.
 */

import { leadingCommentLines } from "../packages/lore/src/service/leading-comment.js";

/** Typed failure for a malformed declaration; `context` names the offending line. */
export class DeclaredInputsError extends Error {
  constructor(
    public readonly reason: "absolute-pattern" | "parent-segment" | "empty-pattern",
    message: string,
    public readonly context: { readonly line: string; readonly pattern: string },
  ) {
    super(message);
    this.name = "DeclaredInputsError";
  }
}

/** The two declaration kinds a test can make. */
export interface DeclaredInputs {
  /** Repo-relative globs of files the test reads in-process. */
  readonly reads: readonly string[];
  /** Repo-relative globs of programs/scripts the test starts as child processes. */
  readonly spawns: readonly string[];
}

const DECLARATION_LINE_RE = /^\s*(?:\/\/|\*|\/\*\*?)\s*@(reads|spawns)\s+(\S+)/;

/**
 * What `@spawns dist/lore` depends on. The binary is compiled from the CLI entry by scripts/build.ts,
 * which also embeds `assets/` and the dashboard bundle: so a test that starts it is affected by the
 * static closure of those two entry files plus every file under the embedded directories. This is the
 * narrowing of the old "any change under packages/{lore,core}/src selects every binary consumer" rule:
 * a change outside this closure (a test file, an unrelated script) no longer selects them.
 */
export const COMPILED_BINARY_INPUTS = {
  /** The declaration that names the compiled binary. */
  declaration: "dist/lore",
  /** Source files whose static import closure the binary is built from. */
  entries: ["packages/lore/src/index.ts", "scripts/build.ts"],
  /**
   * Run-time coverage only: a test that starts the binary may also check it is fresh by statting these
   * source trees (tests/integration/helpers/assert-fresh-binary.ts does, in 84 test files). The recorder
   * cannot compute an import closure, so it treats reads under these globs as covered by the
   * `@spawns dist/lore` declaration; SELECTION still uses the precise closure of `entries`.
   */
  buildInputReadGlobs: ["packages/lore/src/**", "packages/core/src/**", "scripts/build.ts"],
  /** Directories whose content build.ts embeds without importing it. */
  embeddedGlobs: [
    "assets/**",
    "scripts/*.mjs",
    "packages/dashboard/src/**",
    "packages/dashboard/vite.config.ts",
    "packages/dashboard/package.json",
  ],
} as const;

function validatePattern(pattern: string, line: string): void {
  if (pattern.length === 0) throw new DeclaredInputsError("empty-pattern", "empty declaration pattern", { line, pattern });
  if (pattern.startsWith("/")) {
    throw new DeclaredInputsError("absolute-pattern", `declaration pattern must be repo-relative, got "${pattern}"`, { line, pattern });
  }
  if (pattern.split("/").includes("..")) {
    throw new DeclaredInputsError("parent-segment", `declaration pattern must not contain "..": "${pattern}"`, { line, pattern });
  }
}

/**
 * Parse the declarations in the leading comment block of a test file's source. Scans from the top
 * through blank lines, `//` lines, a shebang and block comments; stops at the first code line.
 * @throws DeclaredInputsError for an absolute pattern, a `..` segment, or an empty pattern.
 */
export function parseDeclaredInputs(content: string): DeclaredInputs {
  const reads: string[] = [];
  const spawns: string[] = [];
  // The boundary rule (where the leading comment region ends) is shared with the defect report's context
  // attachment: it lives in packages/lore so the compiled binary ships it.
  for (const line of leadingCommentLines(content)) {
    const match = DECLARATION_LINE_RE.exec(line);
    if (match === null) continue;
    const pattern = match[2]!;
    validatePattern(pattern, line);
    (match[1] === "reads" ? reads : spawns).push(pattern);
  }
  return { reads, spawns };
}

/** Compile a declaration glob to an anchored RegExp: `**` any depth, `*` within a segment, `?` one char. */
export function globToRegExp(glob: string): RegExp {
  // `dir/**` also matches `dir` itself: a test that lists a directory reads the directory entry.
  const directoryTree = glob.endsWith("/**");
  const body = directoryTree ? glob.slice(0, -3) : glob;
  let source = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "*" && body[i + 1] === "*") {
      const slashAfter = body[i + 2] === "/";
      source += slashAfter ? "(?:.*/)?" : ".*";
      i += slashAfter ? 2 : 1;
    } else if (ch === "*") {
      source += "[^/]*";
    } else if (ch === "?") {
      source += "[^/]";
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}${directoryTree ? "(?:/.*)?" : ""}$`);
}

/** `true` iff `path` (repo-relative posix) matches at least one of `patterns`. */
export function matchesAnyPattern(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}
