#!/usr/bin/env bun
/**
 * Changed-test selector (`bun run test:changed`) — AC-TG-7 of
 * `spec-test-governance-guards-that-refuse-bad-tests-declared`; baseline rule AS-24.
 *
 * Purpose: from the files a change touches, select the test files that can be affected, run them
 * under the one runner (vitest on the Bun runtime; files listed in `vitest.node-files.ts` under
 * Node), and print the selection with a reason per file. Never a silent partial sweep.
 *
 * ## Selection = static imports UNION declared inputs, nothing else
 *
 *   1. Changed set: `git diff --name-only <base>...HEAD` unioned with uncommitted changes
 *      (`git status --porcelain`). Default base: `git merge-base main HEAD`.
 *   2. `changed-test`: a changed `*.test.ts(x)` file selects itself.
 *   3. `transitive`: reverse-dependency BFS over the static import graph of every
 *      `packages/*\/src`, `packages/*\/tests` and `scripts/` `.ts(x)` file. The graph is built by
 *      `extractImportSpecifiers`, a regex scan for `import ... from`, `export ... from`, bare
 *      `import "x"` and `import("x")` with a LITERAL specifier. A computed specifier is invisible.
 *      Measured 2026-10-17 on this tree: `packages/lore/src/index.ts` reaches every CLI command
 *      only through literal `import("./commands/x.js")` calls, so the scan MUST follow them (the
 *      previous scan ignored them, which made every closure computed from the CLI entry empty).
 *   4. `declared-read` / `declared-spawn`: a test that depends on a repository file it does not
 *      import says so in its leading comment block (format and rationale: scripts/test-declared-inputs.ts):
 *
 *          // @reads packages/lore/assets/**     selected when a changed file matches the glob
 *          // @spawns dist/lore                  selected when a changed file is in the spawned
 *          //                                    program's source closure (see below)
 *
 *      `@spawns <path>` names a program or script the test starts as a child process. A source file
 *      (`packages/lore/src/index.ts`, `scripts/x.ts`) selects the test on a change to that file or to
 *      anything in its static import closure. `dist/lore` stands for the compiled binary: its closure
 *      is `COMPILED_BINARY_INPUTS` (the entries scripts/build.ts compiles plus the directories it
 *      embeds), and a selection containing such a test is run after `bun run build`.
 *      A test that declares nothing is selected only through steps 2 and 3. There is no content-marker
 *      heuristic: the former `binary-consumer` rule (any `INDEX_TS` / `dist/lore` mention selected on
 *      ANY change under packages/{lore,core}/src) and the whole-tree-scanner rule (bare `main()` and
 *      `hooks/pre-push` content markers) are removed; both are replaced by declarations the run-time check
 *      enforces (scripts/test-read-recorder.ts fails a test whose reads or spawns are undeclared).
 *   5. Accounting is mandatory: a `selected N` line per runner, a reason per file, the build-first
 *      decision, a `WARNING:` for a graph-known changed file that selected nothing.
 *   6. Loud zero (`isLoudZero`): the ONE legitimate silent zero-selection is a genuinely empty changed
 *      set. Any other zero-selection outcome (including a changed file outside the traced universe)
 *      exits 1 in both `--list` and executing mode.
 *
 * Vitest's own graph (`vitest list --filesOnly --changed <ref>`, a list-only form that exists in 3.2.6) was
 * measured and NOT adopted for selection: it resolves the graph by transforming candidate tests (a
 * list over a ~450-file diff had not finished after 300 s, while this regex scan answers in seconds),
 * and it sees neither declared reads nor spawns, so this scan would still be needed for those. One
 * parser (this regex scan) feeds both the import graph and the `@spawns` closure.
 *
 * Exit code is non-zero iff an executed runner fails, a git/graph/declaration step fails, or the
 * loud-zero condition fires.
 *
 * Usage:
 *   bun scripts/changed-tests.ts                # diff against merge-base(main, HEAD)
 *   bun scripts/changed-tests.ts --list          # print selection only, run nothing
 *   bun scripts/changed-tests.ts --list HEAD     # diff against an explicit ref
 *   bun scripts/changed-tests.ts <base>          # diff against an explicit ref and run
 *
 * Side-effect class: `runCli` is IO (git, disk, subprocesses). Every other exported symbol is PURE
 * (operates on an injected file map / alias map / changed-file list) so the selection algorithm is
 * unit-testable with no git (scripts/tests/changed-tests-declared-inputs.test.ts,
 * packages/lore/tests/unit/scripts/changed-tests-selector.test.ts).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join as osJoin } from "node:path";
import { posix } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { COMPILED_BINARY_INPUTS, DeclaredInputsError, matchesAnyPattern, parseDeclaredInputs, type DeclaredInputs } from "./test-declared-inputs.js";
import { NODE_PROJECT_FILES } from "../vitest.node-files.js";

/** Typed error for every git/graph/runner resolution failure this script can hit — never a bare `throw new Error`. */
export class ChangedTestsError extends Error {
  constructor(
    public readonly code: "cli" | "git" | "graph" | "runner" | "declaration",
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChangedTestsError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pure core: import graph + selection algorithm (unit-tested without git)
// ─────────────────────────────────────────────────────────────────────────

/** Repo-relative (posix, forward-slash) file path → file content. Injected in tests; loaded from disk by `loadFileMap` in the CLI. */
export type FileMap = ReadonlyMap<string, string>;

/** Bare-specifier alias → the repo-relative file path it resolves to (e.g. `"@lore/core"` → `"packages/core/src/index.ts"`). */
export type AliasMap = Readonly<Record<string, string>>;

/** Forward (file → files it imports) and reverse (file → files that import it) edges over the resolved import graph. */
export interface ImportGraph {
  readonly forward: ReadonlyMap<string, ReadonlySet<string>>;
  readonly reverse: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Runtime SSOT for the selection-reason vocabulary; {@link SelectionReason} is derived from it.
 * Consumers that must recognise every reason at runtime read this array instead of transcribing the
 * union. Array order is enumeration order only; precedence lives in `selectAffectedTests`
 * (`changed-test` > `declared-spawn` > `declared-read` > `transitive`).
 */
export const SELECTION_REASONS = ["changed-test", "transitive", "declared-read", "declared-spawn"] as const;

/** Why a file was selected — derived from {@link SELECTION_REASONS}. */
export type SelectionReason = (typeof SELECTION_REASONS)[number];

/**
 * Type guard narrowing an untrusted string to {@link SelectionReason}: proof a scraped tag is a REAL
 * member of the vocabulary, not merely shaped like one (a regex built from `SELECTION_REASONS.join("|")`
 * alone cannot fail against an unknown tag).
 */
export function isSelectionReason(value: string): value is SelectionReason {
  return (SELECTION_REASONS as readonly string[]).includes(value);
}

/** Which runner executes this file, derived solely from the `.bun.test.ts` naming convention (`isBunTestFile`). */
export type TestRunner = "vitest" | "bun";

/**
 * One file in the final selection. `needsCompiledBinary` is set whenever the test declares
 * `@spawns dist/lore`, REGARDLESS of `reason`: a changed or transitively selected test that starts
 * the binary still needs a fresh build first. Computed once here, never re-derived at execution time.
 */
export interface SelectedFile {
  readonly path: string;
  readonly reason: SelectionReason;
  readonly runner: TestRunner;
  readonly needsCompiledBinary?: true;
}

/** The full output of `selectAffectedTests` — the selection plus the mandatory zero-selection signal. */
export interface SelectionResult {
  readonly selected: readonly SelectedFile[];
  /** True iff >=1 changed, graph-known file selected zero tests — the "never silent" signal. */
  readonly zeroSelectionWarning: boolean;
  /**
   * The full changed-file list exactly as given — including paths outside the traced universe. SSOT
   * for the loud-zero decision (`isLoudZero`): an EMPTY list is the one legitimate silent zero.
   */
  readonly changedFiles: readonly string[];
}

const FROM_IMPORT_RE = /\b(?:import|export)\b[^;'"()]*?\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;
// reason: the CLI entry reaches every command only through literal `import("./commands/x.js")` calls
// (measured 2026-10-17, packages/lore/src/index.ts and adapters/cli/index.ts); a scan that ignores them
// computes an empty closure for `@spawns` and misses real transitive tests. A COMPUTED specifier stays invisible.
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(?:\/\*[^*]*\*\/\s*)?["']([^"']+)["']\s*\)/g;

/**
 * Regex-scan one file's content for static `import ... from "..."` /
 * `export ... from "..."` / bare `import "..."` / `import("...")` specifiers
 * with a LITERAL string. A specifier built from an expression is invisible to
 * this scan by design (see module header).
 */
export function extractImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  for (const match of content.matchAll(FROM_IMPORT_RE)) {
    if (match[1]) specifiers.add(match[1]);
  }
  for (const match of content.matchAll(BARE_IMPORT_RE)) {
    if (match[1]) specifiers.add(match[1]);
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_RE)) {
    if (match[1]) specifiers.add(match[1]);
  }
  return [...specifiers];
}

/** Resolve a relative specifier (`"./foo"` / `"../bar.js"`) against the importing file's directory, applying this repo's `.js`-import→`.ts`-file convention. Returns `undefined` if no candidate exists in `fileMap`. */
function resolveRelativeSpecifier(specifier: string, fromFile: string, fileMap: FileMap): string | undefined {
  const fromDir = posix.dirname(fromFile);
  const raw = posix.normalize(posix.join(fromDir, specifier));

  const candidates: string[] = [];
  if (/\.tsx?$/.test(raw)) {
    candidates.push(raw);
  } else if (raw.endsWith(".jsx")) {
    candidates.push(raw.replace(/\.jsx$/, ".tsx"));
  } else if (raw.endsWith(".js")) {
    candidates.push(raw.replace(/\.js$/, ".ts"), raw.replace(/\.js$/, ".tsx"));
  } else {
    candidates.push(`${raw}.ts`, `${raw}.tsx`, `${raw}/index.ts`, `${raw}/index.tsx`);
  }
  return candidates.find((c) => fileMap.has(c));
}

/**
 * Resolve one import specifier from `fromFile` to a repo-relative path
 * present in `fileMap` — relative specifiers via directory-relative
 * resolution, `aliasMap`-listed bare specifiers (`@lore/core`,
 * `@lore/core/node`) via exact-match lookup. Any other bare specifier (an
 * external package, a Node builtin) resolves to `undefined` — it is outside
 * this repo's own import graph by definition.
 */
export function resolveImportSpecifier(
  specifier: string,
  fromFile: string,
  fileMap: FileMap,
  aliasMap: AliasMap,
): string | undefined {
  if (specifier.startsWith(".")) {
    return resolveRelativeSpecifier(specifier, fromFile, fileMap);
  }
  const aliasTarget = aliasMap[specifier];
  if (aliasTarget !== undefined && fileMap.has(aliasTarget)) {
    return aliasTarget;
  }
  return undefined;
}

/** Build the resolved forward/reverse import graph over every file in `fileMap`. Pure — no IO. */
export function buildImportGraph(fileMap: FileMap, aliasMap: AliasMap): ImportGraph {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const file of fileMap.keys()) {
    forward.set(file, new Set());
  }

  for (const [file, content] of fileMap) {
    for (const specifier of extractImportSpecifiers(content)) {
      const resolved = resolveImportSpecifier(specifier, file, fileMap, aliasMap);
      if (resolved === undefined || resolved === file) continue;
      forward.get(file)!.add(resolved);
      if (!reverse.has(resolved)) reverse.set(resolved, new Set());
      reverse.get(resolved)!.add(file);
    }
  }

  return { forward, reverse };
}

/** `true` iff `path` is a test file under this repo's `*.test.ts` / `*.test.tsx` naming convention (covers `.bun.test.ts` too — it ends in `.test.ts`). */
export function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

/** `true` iff `path` follows the `.bun.test.ts` bun-runner naming convention. */
export function isBunTestFile(path: string): boolean {
  return /\.bun\.test\.ts$/.test(path);
}

/** Parse a test file's declarations, naming the file when one is malformed (never a bare parser error). */
function declarationsOf(path: string, content: string): DeclaredInputs {
  try {
    return parseDeclaredInputs(content);
  } catch (error) {
    if (error instanceof DeclaredInputsError) {
      throw new ChangedTestsError("declaration", `${path}: ${error.message}`, { file: path, line: error.context.line });
    }
    throw error;
  }
}

/** `entries` plus everything they statically import, transitively (forward closure over `graph`). */
function forwardClosure(entries: Iterable<string>, graph: ImportGraph): Set<string> {
  const seen = new Set<string>(entries);
  const queue = [...seen];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependency of graph.forward.get(current) ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      queue.push(dependency);
    }
  }
  return seen;
}

/**
 * The files a test depends on through ONE `@spawns` declaration: the matching source files plus
 * their static import closure, and the pattern itself (a spawned non-TS file such as `hooks/pre-push`
 * is matched against the changed list directly). `dist/lore` expands to {@link COMPILED_BINARY_INPUTS}.
 */
function spawnDependencies(pattern: string, fileMap: FileMap, graph: ImportGraph): { files: Set<string>; globs: string[] } {
  if (pattern === COMPILED_BINARY_INPUTS.declaration) {
    const entries = COMPILED_BINARY_INPUTS.entries.filter((entry) => fileMap.has(entry));
    return { files: forwardClosure(entries, graph), globs: [...COMPILED_BINARY_INPUTS.embeddedGlobs] };
  }
  const sources = [...fileMap.keys()].filter((file) => matchesAnyPattern(file, [pattern]));
  return { files: forwardClosure(sources, graph), globs: [pattern] };
}

/**
 * Core selection algorithm. Pure. Selection = changed tests, plus tests whose static import closure
 * reaches a changed file, plus tests whose declarations (`@reads` globs, `@spawns` closures) cover a
 * changed file. A test that declares nothing is selected only by the first two. See the module header.
 * @throws ChangedTestsError("declaration") when a test file's declaration block is malformed.
 */
export function selectAffectedTests(params: {
  readonly changedFiles: readonly string[];
  readonly fileMap: FileMap;
  readonly aliasMap: AliasMap;
}): SelectionResult {
  const { changedFiles, fileMap, aliasMap } = params;
  const graph = buildImportGraph(fileMap, aliasMap);
  const knownChanged = changedFiles.filter((f) => fileMap.has(f));

  const reasonByPath = new Map<string, SelectionReason>();
  const needsBinary = new Set<string>();
  const dependencyCache = new Map<string, { files: Set<string>; globs: string[] }>();
  const dependenciesOf = (pattern: string) => {
    const cached = dependencyCache.get(pattern) ?? spawnDependencies(pattern, fileMap, graph);
    dependencyCache.set(pattern, cached);
    return cached;
  };

  for (const file of knownChanged) {
    if (isTestFile(file)) reasonByPath.set(file, "changed-test");
  }

  // declared inputs — escape the import graph; matched against the FULL raw changed list because a
  // declared read may name a file outside the traced universe (a doc, an asset, a hook).
  for (const [path, content] of fileMap) {
    if (!isTestFile(path)) continue;
    const declared = declarationsOf(path, content);
    if (declared.spawns.includes(COMPILED_BINARY_INPUTS.declaration)) needsBinary.add(path);
    if (reasonByPath.has(path)) continue;
    const spawnHit = declared.spawns.some((pattern) => {
      const { files, globs } = dependenciesOf(pattern);
      return changedFiles.some((changed) => files.has(changed) || matchesAnyPattern(changed, globs));
    });
    if (spawnHit) {
      reasonByPath.set(path, "declared-spawn");
    } else if (changedFiles.some((changed) => matchesAnyPattern(changed, declared.reads))) {
      reasonByPath.set(path, "declared-read");
    }
  }

  // transitive — reverse-dependency BFS from every known-changed file.
  const visited = new Set<string>(knownChanged);
  const queue = [...knownChanged];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = graph.reverse.get(current);
    if (!dependents) continue;
    for (const dependent of dependents) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      queue.push(dependent);
      if (isTestFile(dependent) && !reasonByPath.has(dependent)) {
        reasonByPath.set(dependent, "transitive");
      }
    }
  }

  const selected: SelectedFile[] = [...reasonByPath.entries()]
    .map(([path, reason]): SelectedFile => {
      const runner: TestRunner = isBunTestFile(path) ? "bun" : "vitest";
      return needsBinary.has(path) ? { path, reason, runner, needsCompiledBinary: true } : { path, reason, runner };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    selected,
    zeroSelectionWarning: knownChanged.length > 0 && selected.length === 0,
    changedFiles,
  };
}

/**
 * The "loud zero" predicate: true iff the changed-file set was NON-EMPTY yet nothing was selected.
 * The single legitimate silent zero is a genuinely empty changed set. A strict superset of
 * `zeroSelectionWarning` (it also covers a changed file outside the traced universe). `runCli` uses
 * it for the exit code in BOTH `--list` and executing mode.
 */
export function isLoudZero(selection: SelectionResult): boolean {
  return selection.changedFiles.length > 0 && selection.selected.length === 0;
}

/**
 * Render the mandatory accounting block: per-runner `selected N` line, a reason tag per selected
 * file, the build-first decision (observable from `--list` alone), the zero-selection warning, and
 * the loud-zero FAIL block when it applies.
 */
export function formatAccounting(selection: SelectionResult): string {
  const vitestFiles = selection.selected.filter((f) => f.runner === "vitest");
  const bunFiles = selection.selected.filter((f) => f.runner === "bun");
  const compiledBinaryTests = selection.selected.filter((f) => f.needsCompiledBinary === true);

  const lines: string[] = [];
  lines.push(`vitest: selected ${vitestFiles.length}`);
  for (const f of vitestFiles) lines.push(`  [vitest] ${f.path} (${f.reason})`);
  lines.push(`bun: selected ${bunFiles.length}`);
  for (const f of bunFiles) lines.push(`  [bun] ${f.path} (${f.reason})`);
  lines.push(
    compiledBinaryTests.length > 0
      ? `build-first: yes (${compiledBinaryTests.length} selected test(s) declare @spawns ${COMPILED_BINARY_INPUTS.declaration})`
      : "build-first: no",
  );

  if (selection.zeroSelectionWarning) {
    lines.push(
      "WARNING: 0 tests selected despite >=1 changed source/test file reachable in the import graph " +
        "— selection may be incomplete (verify import-graph coverage before trusting a green run)",
    );
  }

  if (isLoudZero(selection)) {
    lines.push(
      `FAIL: 0 tests selected despite ${selection.changedFiles.length} changed file(s) — refusing to report ` +
        "this as a passing run. Unselected changed path(s):",
    );
    for (const f of selection.changedFiles) lines.push(`  ${f}`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// CLI shell: argv parsing, git, disk IO, subprocess execution
// ─────────────────────────────────────────────────────────────────────────

/** Parsed result of `parseArgs` — `base` is `undefined` iff the caller wants the default `merge-base main HEAD` computation. */
export interface ChangedTestsCliArgs {
  readonly list: boolean;
  readonly base: string | undefined;
}

/** Parse this script's argv (excluding the `bun`/script-path prefix). Pure. */
export function parseArgs(argv: readonly string[]): ChangedTestsCliArgs {
  let list = false;
  let base: string | undefined;

  for (const arg of argv) {
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new ChangedTestsError("cli", `unknown flag: ${arg}`, { arg });
    }
    if (base !== undefined) {
      throw new ChangedTestsError("cli", `unexpected extra positional argument: ${arg}`, { arg });
    }
    base = arg;
  }

  return { list, base };
}

function runGit(args: readonly string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) {
    throw new ChangedTestsError("git", `git ${args.join(" ")} failed to spawn: ${result.error.message}`, { args, cwd });
  }
  if (result.status !== 0) {
    throw new ChangedTestsError("git", `git ${args.join(" ")} exited ${String(result.status)}: ${result.stderr}`, {
      args,
      cwd,
      status: result.status,
      stderr: result.stderr,
    });
  }
  return result.stdout;
}

function getRepoRoot(cwd: string): string {
  return runGit(["rev-parse", "--show-toplevel"], cwd).trim();
}

function resolveBaseRef(repoRoot: string, base: string | undefined): string {
  if (base !== undefined) return base;
  return runGit(["merge-base", "main", "HEAD"], repoRoot).trim();
}

/** `git status --porcelain` line format: 2-char status + space + path, or `<path> -> <newPath>` for renames — extract the (new, for renames) path. */
function parsePorcelainPath(line: string): string {
  const body = line.slice(3);
  const arrowIdx = body.indexOf(" -> ");
  return arrowIdx === -1 ? body : body.slice(arrowIdx + 4);
}

function getChangedFiles(repoRoot: string, baseRef: string): string[] {
  const diffOut = runGit(["diff", "--name-only", `${baseRef}...HEAD`], repoRoot);
  const diffFiles = diffOut
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // reason: plain `--porcelain` collapses a brand-new, fully-untracked directory to
  // ONE line naming the directory itself (not its files) — a freshly-added test file
  // living in a freshly-added directory would be invisible to the changed set, which
  // is exactly the "silent partial" this script exists to prevent (module header D3).
  // `--untracked-files=all` forces per-file listing regardless of directory novelty.
  // reason: `parsePorcelainPath` assumes the UNTRIMMED 3-char status-prefix
  // format (` M path`, `?? path`, ...) — trimming BEFORE slicing shifts a
  // leading-space ` M`/` D`/` A` (modified-in-worktree, not staged) line's
  // fixed offset by one, truncating the path's first character (e.g.
  // "packages/lore/src/adapters/cli/utils.ts" -> corrupted, silently missing
  // `fileMap.has()` and dropped from the changed-set — no error, no
  // WARNING, since `zeroSelectionWarning` only fires when nothing else was
  // selected either). Filter blank lines on the RAW line (an empty string's
  // `.length` is 0 either way) and slice on the RAW line — never trim first.
  const statusOut = runGit(["status", "--porcelain", "--untracked-files=all"], repoRoot);
  const statusFiles = statusOut
    .split("\n")
    .filter((l) => l.length > 0)
    .map(parsePorcelainPath);

  return [...new Set([...diffFiles, ...statusFiles])];
}

/** Recursively collect repo-relative posix paths under `dir` (relative to `repoRoot`) whose basename matches `matches`. Skips `node_modules` and dotfile directories. */
function walkDir(repoRoot: string, dir: string, matches: (relPath: string) => boolean, out: string[]): void {
  const entries = readdirSync(osJoin(repoRoot, dir), { withFileTypes: true });
  for (const entry of entries) {
    const relPath = posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walkDir(repoRoot, relPath, matches, out);
      continue;
    }
    if (entry.isFile() && matches(relPath)) out.push(relPath);
  }
}

/** Load every `packages/*\/src/**\/*.ts(x)` file, every `packages/*\/tests/**\/*.ts` file, and every `scripts/**\/*.ts` file (flat — no src/tests split there; `scripts/tests/` falls out of the same walk) under `repoRoot` into a `FileMap`, keyed by repo-relative posix path. */
export function loadFileMap(repoRoot: string): FileMap {
  const files: string[] = [];
  const packagesDir = osJoin(repoRoot, "packages");
  for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const srcDir = posix.join("packages", pkg.name, "src");
    const testsDir = posix.join("packages", pkg.name, "tests");
    if (existsSync(osJoin(repoRoot, srcDir))) {
      walkDir(repoRoot, srcDir, (p) => /\.tsx?$/.test(p), files);
    }
    if (existsSync(osJoin(repoRoot, testsDir))) {
      walkDir(repoRoot, testsDir, (p) => /\.ts$/.test(p), files);
    }
  }

  // reason: scripts/ hosts this repo's OWN deterministic gates (test-budget
  // ledger, AC-ref integrity, this selector) plus its vitest suite
  // (scripts/tests/*.test.ts) — omitted from the original packages/*-only
  // universe, which left a changed scripts/tests/*.test.ts unselected even
  // under rule (a) ("changed test files") and left every scripts/*.ts source
  // file unreachable for rule (b) reverse-dependency tracing (task
  // task-test-changed-s-file-universe-is-packages-not-the-repo-the). Walked
  // flat, `.ts` only — no `.tsx` file exists under scripts/ today (asserted
  // in packages/lore/tests/unit/scripts/changed-tests-selector.test.ts) —
  // because scripts/ has no src/tests split of its own; `walkDir`'s existing
  // node_modules/dotdir skip applies identically to this call.
  const scriptsDir = "scripts";
  if (existsSync(osJoin(repoRoot, scriptsDir))) {
    walkDir(repoRoot, scriptsDir, (p) => /\.ts$/.test(p), files);
  }

  const contents = new Map<string, string>();
  for (const f of files) {
    contents.set(f, readFileSync(osJoin(repoRoot, f), "utf8"));
  }
  return contents;
}

const PackageExportsSchema = z.object({
  exports: z.record(z.string(), z.string()).optional(),
});

/** Derive the `@lore/core` / `@lore/core/node` alias map from `packages/core/package.json`'s `exports` field — the SSOT for what those bare specifiers resolve to, rather than hardcoding the target paths here. */
export function loadCoreAliasMap(repoRoot: string): AliasMap {
  const pkgJsonPath = osJoin(repoRoot, "packages/core/package.json");
  const raw = readFileSync(pkgJsonPath, "utf8");
  const parsed = PackageExportsSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ChangedTestsError("graph", "packages/core/package.json failed exports-field validation", {
      issues: parsed.error.issues,
    });
  }

  const mainExport = parsed.data.exports?.["."];
  const nodeExport = parsed.data.exports?.["./node"];
  if (mainExport === undefined || nodeExport === undefined) {
    throw new ChangedTestsError(
      "graph",
      'packages/core/package.json is missing a "." or "./node" exports entry — required to resolve the @lore/core alias',
      { exports: parsed.data.exports },
    );
  }

  return {
    "@lore/core": posix.normalize(posix.join("packages/core", mainExport)),
    "@lore/core/node": posix.normalize(posix.join("packages/core", nodeExport)),
  };
}

/** Spawns `bunx [--bun] vitest run [-c <config>] <files>` from the repo root; returns the exit code. */
function spawnVitest(repoRoot: string, files: readonly string[], node: boolean): number {
  if (files.length === 0) return 0;
  const args = node ? ["vitest", "run", "-c", "vitest.node.config.ts", ...files] : ["--bun", "vitest", "run", ...files];
  const result = spawnSync("bunx", args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) {
    throw new ChangedTestsError("runner", `bunx ${args.join(" ")} failed to spawn: ${result.error.message}`, { files });
  }
  return result.status ?? 1;
}

/**
 * One runner (task-skill-implement-tg-23): every selected file runs under vitest on the Bun runtime,
 * except the files `vitest.node-files.ts` lists by name, which run under Node. The `vitest` / `bun`
 * labels in the accounting are kept (they still mean "vitest-named" / "`.bun.test.ts`-named" files).
 */
function runSelected(repoRoot: string, files: readonly string[]): number {
  const nodeFiles = files.filter((f) => Object.hasOwn(NODE_PROJECT_FILES, f));
  const bunFiles = files.filter((f) => !Object.hasOwn(NODE_PROJECT_FILES, f));
  const bunCode = spawnVitest(repoRoot, bunFiles, false);
  const nodeCode = spawnVitest(repoRoot, nodeFiles, true);
  return bunCode !== 0 ? bunCode : nodeCode;
}

function runVitest(repoRoot: string, files: readonly string[]): number {
  return runSelected(repoRoot, files);
}

function runBunTest(repoRoot: string, files: readonly string[]): number {
  return runSelected(repoRoot, files);
}

function runBuild(repoRoot: string): number {
  const result = spawnSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
  if (result.error) {
    throw new ChangedTestsError("runner", `bun run build failed to spawn: ${result.error.message}`);
  }
  return result.status ?? 1;
}

/** CLI entrypoint — orchestrates git → graph → selection → accounting → (optionally) execution. Returns the process exit code. */
export function runCli(argv: readonly string[], cwd: string): number {
  const args = parseArgs(argv);
  const repoRoot = getRepoRoot(cwd);
  const baseRef = resolveBaseRef(repoRoot, args.base);
  const changedFiles = getChangedFiles(repoRoot, baseRef);
  const fileMap = loadFileMap(repoRoot);
  const aliasMap = loadCoreAliasMap(repoRoot);

  const selection = selectAffectedTests({ changedFiles, fileMap, aliasMap });
  console.log(formatAccounting(selection));

  // requirement 2 (task-test-changed-selects-nothing-for-any-scripts-change-and):
  // a non-empty changed-file set that selected zero tests must never exit 0 —
  // checked BEFORE the --list early-return so a hollow preview fails exactly
  // as loud as a hollow executing run (both consult the same predicate, over
  // the same selection data — no separate re-derivation).
  if (isLoudZero(selection)) {
    console.error(
      `changed-tests: 0 tests selected across ${changedFiles.length} changed file(s) — exiting non-zero ` +
        "instead of a hollow success (see the FAIL block above for the unselected path(s)).",
    );
    return 1;
  }

  if (args.list) return 0;

  const vitestFiles = selection.selected.filter((f) => f.runner === "vitest").map((f) => f.path);
  const bunFiles = selection.selected.filter((f) => f.runner === "bun").map((f) => f.path);
  // The build-first decision is read from the selection data (`needsCompiledBinary`), computed once in
  // `selectAffectedTests` from the tests' `@spawns dist/lore` declarations.
  const hasCompiledBinaryConsumer = selection.selected.some((f) => f.needsCompiledBinary === true);

  if (hasCompiledBinaryConsumer) {
    console.log("changed-tests: >=1 selected test declares @spawns dist/lore — running `bun run build` first");
    const buildStatus = runBuild(repoRoot);
    if (buildStatus !== 0) {
      console.error(`changed-tests: bun run build failed (exit ${buildStatus})`);
      return buildStatus;
    }
  }

  let exitCode = 0;
  if (vitestFiles.length > 0) {
    const status = runVitest(repoRoot, vitestFiles);
    if (status !== 0) exitCode = status;
  }
  if (bunFiles.length > 0) {
    const status = runBunTest(repoRoot, bunFiles);
    if (status !== 0 && exitCode === 0) exitCode = status;
  }
  return exitCode;
}

if (import.meta.main) {
  try {
    process.exit(runCli(process.argv.slice(2), process.cwd()));
  } catch (e) {
    if (e instanceof ChangedTestsError) {
      console.error(`changed-tests: [${e.code}] ${e.message}`);
      if (e.context) console.error(JSON.stringify(e.context));
    } else {
      console.error(e instanceof Error ? e.message : String(e));
    }
    process.exit(1);
  }
}
