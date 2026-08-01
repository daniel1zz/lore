#!/usr/bin/env bun
/**
 * Two-runner changed-test selector (`bun run test:changed`) — SPEC
 * `spec-two-runner-changed-test-selection-deterministic-test`.
 *
 * This repo splits tests across two runners by a hard file-naming convention:
 * `.bun.test.ts` under `bun test` (needs `bun:sqlite`), everything else under
 * `vitest`. The de-facto worktree regression command, `bunx vitest run
 * --changed <base>`, is STRUCTURALLY BLIND to every `.bun.test.ts` file —
 * vitest's own dependency graph never loads them, so a change whose only
 * consumers live bun-side sweeps green while broken (incident: T1's M3
 * schema change broke `plan-close-cascade.bun.test.ts`; `vitest --changed`
 * showed green; the break surfaced only in the main-checkout full-suite run —
 * retro `knowledge-full-system-spec-compliance-audit-2026-07-27-85-11-1`,
 * follow-up lesson 2).
 *
 * This script replaces that ad-hoc habit with one deterministic command that
 * selects and runs affected tests across BOTH runners via a reverse-dependency
 * BFS over a regex-scanned static import graph, with loud, mandatory
 * selection accounting (never a silent partial sweep).
 *
 * ## Algorithm
 *
 *   1. Changed set: `git diff --name-only <base>...HEAD` unioned with
 *      uncommitted changes (`git status --porcelain`). Default base: `main`
 *      via `git merge-base main HEAD` (correct under a worktree checkout,
 *      where `main` itself may be checked out elsewhere) — an explicit
 *      `<base>` argument overrides this and is diffed against directly.
 *   2. Import graph: every `packages/*\/src/**\/*.ts(x)` file, every
 *      `packages/*\/tests/**\/*.ts` file, AND every `scripts/**\/*.ts` file
 *      (flat — `scripts/` has no `src`/`tests` split of its own;
 *      `scripts/tests/` is walked as part of the same `scripts/` tree) is
 *      regex-scanned for static `import ... from "..."` / `export ... from
 *      "..."` specifiers (see `extractImportSpecifiers`). `scripts/` was
 *      ADDED to this universe (previously `packages/*` only) because it
 *      hosts this repo's OWN deterministic gates — the test-budget ledger,
 *      AC-ref integrity, and this very selector — and a changed
 *      `scripts/tests/*.test.ts` file went unselected under the narrower
 *      universe even though rule (a), "changed test files", is the simplest
 *      rule this script has (task
 *      `task-test-changed-s-file-universe-is-packages-not-the-repo-the`).
 *      Relative specifiers resolve against the importing file's directory
 *      with this repo's `.js`-import→`.ts`-file convention; the workspace
 *      aliases `@lore/core` / `@lore/core/node` resolve via
 *      `packages/core/package.json`'s `exports` map. Dynamic `import(...)`
 *      and any other non-literal specifier are IGNORED BY DESIGN — a regex
 *      scan cannot evaluate expressions, and this repo does not use dynamic
 *      imports for cross-module wiring. A `scripts/*.ts` file with no
 *      reverse-dependent test (most of them — `scripts/build.ts`,
 *      `scripts/platform-map.ts`, ...) selects nothing when it alone
 *      changes; this is the SAME D3 zero-selection-warning path every other
 *      untested source file already takes (step 5/6 — the accounting prints
 *      `WARNING:` because the file was graph-known, AND the run now exits
 *      non-zero via the loud-zero rule, step 6) — never a crash, never a
 *      silent select-everything fallback, and NOT a scripts/-specific
 *      special case.
 *   3. Selection = union of:
 *      (a) changed test files themselves (`changed-test`);
 *      (b) test files whose transitive reverse-dependency closure reaches
 *          >=1 changed source file (`transitive`);
 *      (c) binary-consumers — ANY `*.test.ts` / `*.test.tsx` file (not only
 *          `.bun.test.ts`) whose OWN content spawns this repo's CLI entry as
 *          a subprocess, included whenever ANY `packages/lore/src/**` or
 *          `packages/core/src/**` file changed (`binary-consumer`). Two
 *          distinct spawn shapes exist in this repo and are told apart by
 *          marker (`classifyBinaryConsumer`): a "compiled" spawn (`dist/lore`
 *          / `LORE_BIN` marker) runs the built binary; a "source" spawn
 *          (`INDEX_TS` marker — every `tests/integration/cli/*.test.ts` file
 *          spawns `bun run <INDEX_TS>` where `INDEX_TS` resolves to
 *          `src/index.ts`) runs the entry source directly. Both spawn a
 *          subprocess, so import tracing cannot see through to either — only
 *          the COMPILED kind additionally gates the step-4 pre-build (a
 *          source-entry spawn always runs current source, never a stale
 *          artifact). Pretending either kind were reachable by import tracing
 *          would silently rebuild the exact blind spot this script exists to
 *          close.
 *   4. Execution: selected vitest files run via one `bunx vitest run <files>`;
 *      selected bun files run via `cd packages/lore && bun test <files>`. If
 *      >=1 COMPILED binary-consumer was selected (as opposed to a source-only
 *      one — see step 3(c)), `bun run build` runs FIRST (a stale compiled
 *      `dist/lore` is a known false-oracle vector); this decision is carried
 *      on the selection data (`SelectedFile.binaryConsumerKind`), never
 *      re-derived by re-reading files at execution time. `--list` prints the
 *      selection and accounting — including the build-first decision, so it
 *      is observable without actually running anything — without executing
 *      any runner.
 *   5. Accounting is mandatory, not optional: a `selected N` line per runner
 *      plus a reason tag per selected file, always printed — a changed,
 *      graph-known source file that selects zero tests additionally prints a
 *      `WARNING:` line, and the loud-zero rule (step 6) prints a `FAIL:`
 *      line naming every unselected changed path whenever it fires.
 *   6. Loud zero (`isLoudZero`, task
 *      `task-test-changed-selects-nothing-for-any-scripts-change-and`): the
 *      ONE legitimate silent zero-selection is a genuinely EMPTY changed-file
 *      set (nothing changed at all). Any other zero-selection outcome —
 *      including a changed file OUTSIDE the traced universe entirely (a
 *      repo-root config file, or a future directory nobody thought to widen
 *      `loadFileMap` for) — is loud, not silent: `runCli` returns exit code 1
 *      for it, in BOTH `--list` and executing mode, so `--list`'s output AND
 *      exit code both distinguish "nothing changed" from "N files changed, 0
 *      selected" — they must never render alike. Before this rule, a
 *      worktree agent whose entire slice lived in an untraced directory got
 *      exit 0 with zero files selected and had measured nothing (the exact
 *      incident this task fixes; the `scripts/` tracing gap that TRIGGERED
 *      it is closed separately by step 2's universe widening — this rule is
 *      the backstop for the NEXT untraced directory nobody thought of).
 *
 * Exit code is non-zero iff any executed runner fails, a git/import-graph
 * resolution step fails (missing `packages/core/package.json` exports,
 * unreachable git ref, etc.), OR the loud-zero condition above fires — never
 * a silent partial result and never a silent zero-selection unless truly
 * nothing changed.
 *
 * Usage:
 *   bun scripts/changed-tests.ts                # diff against merge-base(main, HEAD)
 *   bun scripts/changed-tests.ts --list          # print selection only, run nothing
 *   bun scripts/changed-tests.ts --list HEAD     # diff against an explicit ref
 *   bun scripts/changed-tests.ts <base>          # diff against an explicit ref and run
 *
 * Side-effect class: the CLI entrypoint (`main`, below `import.meta.main`) is
 * IO — spawns `git`, reads the working tree, spawns `vitest`/`bun test`/`bun
 * run build`. Every other exported symbol above it is PURE (operates only on
 * an injected file map / alias map / changed-file list), which is what makes
 * `packages/lore/tests/unit/scripts/changed-tests-selector.test.ts` able to
 * unit-test the selection algorithm with zero git dependency.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join as osJoin } from "node:path";
import { posix } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

/** Typed error for every git/graph/runner resolution failure this script can hit — never a bare `throw new Error`. */
export class ChangedTestsError extends Error {
  constructor(
    public readonly code: "cli" | "git" | "graph" | "runner",
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

/** Why a file was selected — precedence `changed-test` > `binary-consumer` > `transitive` (see `selectAffectedTests`). */
export type SelectionReason = "changed-test" | "transitive" | "binary-consumer";
/** Which runner executes this file, derived solely from the `.bun.test.ts` naming convention (`isBunTestFile`). */
export type TestRunner = "vitest" | "bun";

/** Which CLI-entry shape a binary-consumer test spawns — see `classifyBinaryConsumer`. Only the `"compiled"` kind needs a fresh `dist/lore` before running (step 4's pre-build gate). */
export type BinaryConsumerKind = "compiled" | "source";

/**
 * One file in the final selection, with its runner and the reason it was
 * included. `binaryConsumerKind` is set whenever this file's own content
 * matches a binary-consumer marker (`classifyBinaryConsumer`), REGARDLESS of
 * `reason` — a file can be selected as `changed-test` or `transitive` and
 * still itself be a binary-consumer that needs the pre-build gate (AC-2: the
 * kind is computed once here, in the selection data, never re-derived later
 * by re-reading files at execution time).
 */
export interface SelectedFile {
  readonly path: string;
  readonly reason: SelectionReason;
  readonly runner: TestRunner;
  readonly binaryConsumerKind?: BinaryConsumerKind;
}

/** The full output of `selectAffectedTests` — the selection plus the mandatory zero-selection signal. */
export interface SelectionResult {
  readonly selected: readonly SelectedFile[];
  /** True iff >=1 changed, graph-known file selected zero tests — the "never silent" signal (D3). */
  readonly zeroSelectionWarning: boolean;
  /**
   * The full changed-file list exactly as given to `selectAffectedTests` —
   * unlike `selected`/`zeroSelectionWarning`, this counts EVERY changed path,
   * including ones outside the traced universe entirely (not even present in
   * `fileMap` — e.g. a repo-root config file, or a future directory nobody
   * thought to widen `loadFileMap` for). This is the SSOT for the loud-zero
   * decision (`isLoudZero`, task
   * `task-test-changed-selects-nothing-for-any-scripts-change-and`): an EMPTY
   * list here is the ONE legitimate silent zero-selection state (nothing
   * changed at all); anything else combined with `selected.length === 0` is
   * not, regardless of whether any of those files were graph-known.
   */
  readonly changedFiles: readonly string[];
}

const FROM_IMPORT_RE = /\b(?:import|export)\b[^;'"()]*?\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;

/**
 * Regex-scan one file's content for static `import ... from "..."` /
 * `export ... from "..."` / bare `import "..."` specifiers. Dynamic
 * `import(...)` and any specifier built from an expression are invisible to
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

/** Matches a test file that spawns the COMPILED binary — `LORE_BIN`/`dist/lore` are this repo's established constant name / path for that spawn target (see e.g. `tests/e2e/libsql-lazy-load.test.ts`, `tests/integration/cli/slugify-compiled.bun.test.ts`). */
const COMPILED_BINARY_MARKER_RE = /dist\/lore|LORE_BIN/;
/**
 * Matches a test file that spawns the entry SOURCE directly (`bun run
 * <INDEX_TS>`, where `INDEX_TS` resolves to `packages/lore/src/index.ts` —
 * every `tests/integration/cli/*.test.ts` file, and ~40 more across the
 * suite, declare `const INDEX_TS = join(..., "src", "index.ts")` and spawn
 * via that identifier, never a literal path string). Keyed on the identifier
 * rather than a `src/index.ts` path substring on purpose: a literal-path scan
 * would also match unrelated prose like "packages/core/src/index.ts" (e.g.
 * `tests/unit/core/barrel-isolation.test.ts`'s doc comment) which spawns
 * nothing at all.
 */
const SOURCE_ENTRY_MARKER_RE = /\bINDEX_TS\b/;

/**
 * Classify `path`/`content` as one of two binary-consumer kinds, or neither.
 * A binary-consumer is ANY test file (`isTestFile` — not only
 * `.bun.test.ts`) whose OWN content spawns this repo's CLI entry as a
 * subprocess: there is no import edge for the reverse-dependency walk to
 * traverse through a subprocess call (D2 — a dependency-closure escape import
 * tracing cannot see through). Both kinds are escape-hatch candidates for
 * SELECTION; only `"compiled"` additionally forces the step-4 pre-build gate
 * (a "source" spawn runs `bun run <INDEX_TS>` against current source
 * directly — never a stale artifact, so no build is needed first). A marker
 * occurring only inside a comment still counts: neither this scan nor the
 * import-specifier scan above it is comment-aware, and a regex cannot
 * evaluate "is this line executable" any more than it can evaluate a dynamic
 * `import()` expression (see module header, step 2).
 */
export function classifyBinaryConsumer(path: string, content: string): BinaryConsumerKind | undefined {
  if (!isTestFile(path)) return undefined;
  if (COMPILED_BINARY_MARKER_RE.test(content)) return "compiled";
  if (SOURCE_ENTRY_MARKER_RE.test(content)) return "source";
  return undefined;
}

/** `true` iff `path`/`content` is a binary-consumer candidate of EITHER kind (see `classifyBinaryConsumer`) — the boolean gate rule (c) uses to decide inclusion. */
export function isBinaryConsumerCandidate(path: string, content: string): boolean {
  return classifyBinaryConsumer(path, content) !== undefined;
}

/**
 * Rule (c)'s trigger stays scoped to `packages/{lore,core}/src/` ON PURPOSE —
 * the binary-consumer escape hatch (subprocess spawns of the CLI entry) is a
 * property of THOSE two packages' source, not of `scripts/`. Widening the
 * file UNIVERSE (see `loadFileMap`) to include `scripts/**\/*.ts` does not
 * change this trigger's prefix; it only grows the CANDIDATE pool the trigger
 * scans over (any `scripts/tests/*.test.ts` that itself matched a
 * binary-consumer marker would now be eligible too — none do today, see the
 * `changed-tests-selector.test.ts` scripts/-universe coverage).
 */
const LORE_OR_CORE_SRC_PREFIX_RE = /^packages\/(?:lore|core)\/src\//;

/**
 * Core selection algorithm (D1/D2/D3). Pure — takes the changed-file list and
 * a full file map (source + test) and returns the union selection with a
 * reason tag per file, plus the zero-selection warning flag. See module
 * header §Algorithm step 3 for the precedence rule: `changed-test` >
 * `binary-consumer` > `transitive` (a changed test file's reason is always
 * "changed-test" even if it also happens to be a binary-consumer or
 * transitively reachable).
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

  // (a) changed-test direct inclusion — highest precedence.
  for (const file of knownChanged) {
    if (isTestFile(file)) reasonByPath.set(file, "changed-test");
  }

  // (c) binary-consumers — escape the import graph entirely; triggered by
  // ANY changed file under packages/{lore,core}/src/, not by reachability.
  const triggersBinaryConsumers = changedFiles.some((f) => LORE_OR_CORE_SRC_PREFIX_RE.test(f));
  if (triggersBinaryConsumers) {
    for (const [path, content] of fileMap) {
      if (isBinaryConsumerCandidate(path, content) && reasonByPath.get(path) !== "changed-test") {
        reasonByPath.set(path, "binary-consumer");
      }
    }
  }

  // (b) transitive — reverse-dependency BFS from every known-changed file.
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

  // Attach binaryConsumerKind to EVERY selected file (not only ones selected
  // BECAUSE of rule (c)) — a file selected as changed-test or transitive can
  // still itself spawn the CLI entry and therefore still needs the step-4
  // pre-build gate when its kind is "compiled" (AC-2: computed once here from
  // the in-memory fileMap already scanned above, never re-derived by
  // re-reading files later at execution time).
  const selected: SelectedFile[] = [...reasonByPath.entries()]
    .map(([path, reason]) => {
      const runner: TestRunner = isBunTestFile(path) ? "bun" : "vitest";
      // Invariant: every `path` here came FROM `fileMap` (knownChanged is
      // `fileMap.has`-filtered; rule (c) iterates `fileMap` directly; the BFS
      // below walks edges built only from `fileMap` keys) — `.get` cannot
      // miss. Non-null assertion, not a silent fallback (mirrors
      // `buildImportGraph`'s established `forward.get(file)!` convention
      // above).
      const binaryConsumerKind = classifyBinaryConsumer(path, fileMap.get(path)!);
      return binaryConsumerKind === undefined
        ? { path, reason, runner }
        : { path, reason, runner, binaryConsumerKind };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    selected,
    zeroSelectionWarning: knownChanged.length > 0 && selected.length === 0,
    changedFiles,
  };
}

/**
 * The "loud zero" predicate (requirement 2 of
 * `task-test-changed-selects-nothing-for-any-scripts-change-and`): true iff
 * the changed-file set was NON-EMPTY yet nothing was selected overall. The
 * single legitimate silent zero-selection is the reverse — a genuinely empty
 * changed-file set (`selection.changedFiles.length === 0`, the CONTROL case:
 * nothing changed at all).
 *
 * This condition is a strict SUPERSET of `zeroSelectionWarning`: every
 * graph-known-zero-selection case (`zeroSelectionWarning === true`) also has
 * `changedFiles.length > 0` and `selected.length === 0`, so it is also a loud
 * zero. It additionally covers a changed file OUTSIDE the traced universe
 * entirely — a directory `loadFileMap` never learned to walk — which
 * `zeroSelectionWarning` alone cannot see (it only looks at graph-known
 * files via `knownChanged`). `runCli` uses this predicate to decide the exit
 * code in BOTH `--list` and executing mode — never only one of them, since a
 * hollow `--list` preview is exactly as misleading as a hollow executing run.
 */
export function isLoudZero(selection: SelectionResult): boolean {
  return selection.changedFiles.length > 0 && selection.selected.length === 0;
}

/**
 * Render the mandatory accounting block: per-runner `selected N` line, a
 * reason tag per selected file, the build-first decision (AC-2/AC-5 —
 * printed here so it is observable from `--list` output alone, without
 * actually executing anything), and the zero-selection warning when it
 * applies (D3 — never silent).
 */
export function formatAccounting(selection: SelectionResult): string {
  const vitestFiles = selection.selected.filter((f) => f.runner === "vitest");
  const bunFiles = selection.selected.filter((f) => f.runner === "bun");
  const compiledBinaryConsumers = selection.selected.filter((f) => f.binaryConsumerKind === "compiled");

  const lines: string[] = [];
  lines.push(`vitest: selected ${vitestFiles.length}`);
  for (const f of vitestFiles) lines.push(`  [vitest] ${f.path} (${f.reason})`);
  lines.push(`bun: selected ${bunFiles.length}`);
  for (const f of bunFiles) lines.push(`  [bun] ${f.path} (${f.reason})`);
  lines.push(
    compiledBinaryConsumers.length > 0
      ? `build-first: yes (${compiledBinaryConsumers.length} compiled binary-consumer file(s) selected)`
      : "build-first: no",
  );

  if (selection.zeroSelectionWarning) {
    lines.push(
      "WARNING: 0 tests selected despite >=1 changed source/test file reachable in the import graph " +
        "— selection may be incomplete (verify import-graph coverage before trusting a green run)",
    );
  }

  // D3' — the loud-zero rule (requirement 2 of
  // task-test-changed-selects-nothing-for-any-scripts-change-and): this block
  // is what makes AC-3's "0 selected because nothing changed" render
  // differently from "0 selected although N files changed" — the former
  // never reaches here (isLoudZero requires changedFiles.length > 0), the
  // latter always does. Lists every changed path since, when selected.length
  // is 0, ALL of them are unselected by definition — never a diff to compute.
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
function loadFileMap(repoRoot: string): FileMap {
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
function loadCoreAliasMap(repoRoot: string): AliasMap {
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

function runVitest(repoRoot: string, files: readonly string[]): number {
  const result = spawnSync("bunx", ["vitest", "run", ...files], { cwd: repoRoot, stdio: "inherit" });
  if (result.error) {
    throw new ChangedTestsError("runner", `bunx vitest run failed to spawn: ${result.error.message}`, { files });
  }
  return result.status ?? 1;
}

function runBunTest(repoRoot: string, files: readonly string[]): number {
  const loreRelDir = "packages/lore";
  const relFiles = files.map((f) => posix.relative(loreRelDir, f));
  const result = spawnSync("bun", ["test", "--timeout", "30000", ...relFiles], {
    cwd: osJoin(repoRoot, loreRelDir),
    stdio: "inherit",
  });
  if (result.error) {
    throw new ChangedTestsError("runner", `bun test failed to spawn: ${result.error.message}`, { files });
  }
  return result.status ?? 1;
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
  // AC-2: keyed on the COMPILED kind only — a source-entry spawn (`bun run
  // <INDEX_TS>`) always runs current source and never needs a fresh
  // `dist/lore` first. Read from the selection data computed once in
  // `selectAffectedTests`, never re-derived by re-reading files here.
  const hasCompiledBinaryConsumer = selection.selected.some((f) => f.binaryConsumerKind === "compiled");

  if (hasCompiledBinaryConsumer) {
    console.log("changed-tests: >=1 compiled binary-consumer selected — running `bun run build` first");
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
