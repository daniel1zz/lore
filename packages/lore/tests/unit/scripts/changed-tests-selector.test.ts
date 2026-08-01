/**
 * Unit suite for the `bun run test:changed` selector core
 * (`spec-two-runner-changed-test-selection-deterministic-test`, AC-TC-1).
 *
 * Every case here drives `selectAffectedTests` (and friends) with an injected
 * synthetic `FileMap` — no git, no real filesystem walk, no subprocess. This
 * is deliberate: `scripts/changed-tests.ts` factors the pure graph-build +
 * selection algorithm apart from the CLI shell (git/fs/spawn) specifically so
 * this suite can pin the algorithm's behaviour without depending on repo
 * state or process spawning (see that file's module header, "Side-effect
 * class").
 *
 * Import note: `scripts/changed-tests.ts` lives OUTSIDE
 * `packages/lore/tsconfig.tests.json`'s `rootDir` ("."). A static `import`
 * of a repo-root `scripts/` file from here pulls it into that tsconfig's
 * program and fails with TS6059 ("File is not under rootDir") — the SAME
 * constraint documented in `packages/lore/tests/unit/distribution/
 * platform-map.test.ts`. This file follows that established pattern:
 * `import()` with a runtime-COMPUTED (non-literal) specifier, resolved once
 * in `beforeAll`, with structural type mirrors declared locally instead of
 * imported.
 *
 * Coverage (>=6 cases required by AC-TC-1):
 *   1. HAPPY — the actual incident shape: a changed `packages/core/src`
 *      file reaches a `.bun.test.ts` file transitively through an
 *      intermediate `packages/lore/src` service file (the exact shape that
 *      broke `plan-close-cascade.bun.test.ts` while `vitest --changed`
 *      stayed green).
 *   2. NEGATIVE — an unrelated test file, reachable from nothing changed,
 *      is never selected.
 *   3. HAPPY — a changed test file is always selected directly, reason
 *      `changed-test`.
 *   4. HAPPY — a `.bun.test.ts` binary-consumer (spawns `dist/lore`) is
 *      selected whenever ANY `packages/{lore,core}/src` file changes, even
 *      with zero import relationship.
 *   5. HAPPY — the `@lore/core` alias resolves through `AliasMap` and
 *      participates in the same transitive BFS as relative imports.
 *   6. BOUNDARY — a changed source file with zero reachable tests produces
 *      an empty selection AND the loud zero-selection warning (never a
 *      silent 0).
 *   7. STATE — precedence: a file that is BOTH a changed test AND a
 *      binary-consumer keeps reason `changed-test` (highest precedence).
 *   8. ERROR — `parseArgs` rejects an unknown flag and a second positional
 *      argument rather than silently ignoring them.
 *   9. REGRESSION — `formatAccounting` always prints both runner count
 *      lines, even when both are zero (never omits a runner's line).
 *
 * `classifyBinaryConsumer` / `isBinaryConsumerCandidate` (task
 * `task-test-changed-cannot-see-the-whole-integration-cli-tier-the`, AC-1/
 * AC-4): the binary-consumer predicate widened from `.bun.test.ts`-only to
 * ANY `*.test.ts`/`*.test.tsx` file, and now tells apart a "compiled"
 * (`dist/lore`/`LORE_BIN`) spawn from a "source" (`INDEX_TS`) spawn so the
 * step-4 pre-build gate (AC-2) can key on the compiled case only. Covered in
 * a dedicated describe block below:
 *   - HAPPY: a vitest `.test.ts` spawning the entry SOURCE via `INDEX_TS` IS
 *     a candidate, kind `"source"` — the exact incident shape
 *     (`verify.test.ts` never imports the changed module, it subprocess-
 *     spawns `bun run <INDEX_TS>`).
 *   - REGRESSION: a `.bun.test.ts` spawning the COMPILED binary (`dist/lore`)
 *     is still a candidate, kind `"compiled"` (pre-existing behaviour, must
 *     not regress).
 *   - NEGATIVE: a plain test file with no spawn marker at all is not a
 *     candidate.
 *   - BOUNDARY: a non-test `.ts` SOURCE file containing the marker string
 *     is NOT a candidate — `isTestFile` gates entry regardless of content.
 *   - STATE (design-choice, asserted either way): a marker appearing only
 *     inside a comment still counts — this regex scan is no more
 *     comment-aware than the import-specifier scan above it, and this suite
 *     pins that as a deliberate, tested choice rather than an accident.
 *   - AC-2: `selectAffectedTests` + `formatAccounting` together prove the
 *     build-first decision is carried on the selection data and observable
 *     from `--list`-shaped output — a selection with only source-kind
 *     binary-consumers prints `build-first: no`; one with >=1 compiled-kind
 *     prints `build-first: yes`.
 *
 * `classifyTreeScanningOracle` / `isChangedFileInTreeScanScope` (rule (d),
 * task `task-test-changed-s-fourth-invisible-edge-a-tree-scanning`): a test
 * that judges files via a RUNTIME FILESYSTEM SCAN (never an import edge) is
 * invisible to rules (a)-(c) exactly like a binary-consumer's subprocess
 * spawn is invisible to import tracing — the incident measured TWICE in one
 * day against the real `scripts/tests/check-test-budgets.test.ts`. Covered in
 * dedicated describe blocks below:
 *   - `classifyTreeScanningOracle`: HAPPY for both real oracle shapes (the
 *     REAL `check-test-budgets.test.ts` content -> `"packages-test-tree"`;
 *     the REAL `check-no-nul-bytes.test.ts` content, which additionally
 *     imports `hasTextSourceExtension` -> `"repo-tracked-text-source"`);
 *     NEGATIVE for a non-test file with the marker (isTestFile gates
 *     regardless of content, mirroring `classifyBinaryConsumer`'s own
 *     BOUNDARY case) and for a test file that calls `main(dir)` WITH an
 *     argument only (an injected-fixture suite, not a real-tree scan);
 *     STATE (design choice, mirroring the binary-consumer marker's own
 *     comment-insensitivity): a marker inside a comment still counts.
 *   - `isChangedFileInTreeScanScope`: HAPPY for both scopes; BOUNDARY —
 *     a `packages/`-prefixed NON-test file does not match
 *     `"packages-test-tree"` (test-file-ness is still required, not just the
 *     prefix); NEGATIVE — a non-text-source extension does not match
 *     `"repo-tracked-text-source"`.
 *   - `selectAffectedTests` end-to-end: HAPPY — the INCIDENT CONTROL itself
 *     (load-bearing per the task's own Oracle): a changed
 *     `packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts`
 *     (real path, the exact file the incident touched) selects the REAL
 *     `check-test-budgets.test.ts` content as `tree-scan-oracle`; HAPPY —
 *     `check-no-nul-bytes.test.ts` is selected on a changed file OUTSIDE the
 *     traced universe entirely (e.g. a `docs/*.md` path not present in
 *     `fileMap` at all), proving rule (d) consults the FULL raw
 *     `changedFiles` list, not just `knownChanged`; NEGATIVE — a changed
 *     file matching NEITHER oracle's scope (a `.png` asset) selects neither;
 *     BOUNDARY (per-oracle scoping, not a blanket trigger) — a changed
 *     `.md` file selects ONLY `check-no-nul-bytes.test.ts` and explicitly
 *     NOT `check-test-budgets.test.ts` (which only judges `packages/**`
 *     test files); STATE (precedence) — a tree-scanning oracle that is
 *     ITSELF the changed file keeps reason `changed-test` (highest
 *     precedence), never `tree-scan-oracle`; REGRESSION (precedence) — a
 *     file matching BOTH the binary-consumer marker and a tree-scan-oracle
 *     shape keeps reason `binary-consumer` (rule (c) precedes rule (d)).
 *
 * scripts/ universe widening (task
 * task-test-changed-s-file-universe-is-packages-not-the-repo-the): the
 * selector's file universe was `packages/*` only — `loadFileMap` (private,
 * unexported — the IO shell, not the pure core the rest of this suite drives
 * via an injected `FileMap`) never walked `scripts/`, so a changed
 * `scripts/tests/*.test.ts` went unselected even under rule (a), the
 * simplest rule this script has. Proving the widened walk actually reaches
 * disk requires the REAL CLI subprocess against a REAL (throwaway, isolated)
 * git fixture — never a synthetic in-process `FileMap`, which would assume
 * the walk instead of proving it. Two dedicated `describe` blocks at the end
 * of this file:
 *   - rule (a) HAPPY: a changed `scripts/tests/*.test.ts` selects itself,
 *     reason `changed-test`.
 *   - rule (b) HAPPY: a source-ONLY change (the test file untouched) still
 *     selects the test via the widened map's `scripts/` -> `scripts/tests/`
 *     import edge, reason `transitive` — asserted directly rather than
 *     assumed to "fall out" of the widening.
 *   - NEGATIVE: a `scripts/` source file with no test importing it (mirrors
 *     `scripts/build.ts`) selects nothing spurious — loud `WARNING:` AND exit
 *     1 via the loud-zero rule below, never a crash, never a
 *     select-everything fallback.
 *   - BOUNDARY/REGRESSION: against the REAL repo tree, no `.bun.test.ts`
 *     file exists under `scripts/` today — runner assignment for
 *     `scripts/tests/*.test.ts` stays filename-derived (`isBunTestFile`),
 *     never a hardcoded scripts-is-always-vitest special case.
 *
 * Loud-zero rule (task
 * `task-test-changed-selects-nothing-for-any-scripts-change-and`,
 * `isLoudZero`): a NON-EMPTY changed-file set that selects zero tests must
 * never again exit 0 — the ONE legitimate silent zero-selection is a
 * genuinely EMPTY changed-file set. Covered at two levels:
 *   - Pure (`describe("...isLoudZero...")`): HAPPY (the canonical shape),
 *     NEGATIVE (false whenever something WAS selected), BOUNDARY/CONTROL
 *     (false when nothing changed at all), STATE (the existing
 *     `zeroSelectionWarning` implies `isLoudZero` — a strict subset
 *     relationship), REGRESSION (an ordinary non-empty transitive selection
 *     stays `isLoudZero === false`).
 *   - End-to-end, same fixture-repo pattern as the scripts/-universe suite
 *     above (real CLI subprocess, isolated git fixture): the existing
 *     `scripts/build.ts` NEGATIVE case now additionally asserts exit 1 +
 *     `FAIL:` + a controlled (non-killed) process; BOUNDARY (AC-4) mutates a
 *     repo-root `README.md` — traced by NEITHER rule, so `WARNING:` does
 *     NOT fire (not graph-known) but `FAIL:`/exit 1 still do (ERROR
 *     dimension: the failure is a clean `return 1`, not an exception — both
 *     assert `signal` is `null`); CONTROL (AC-2) runs with zero mutations at
 *     all (exit 0, fully silent); REGRESSION (AC-3) mutates the fixture's new
 *     `packages/lore/src/service/some-service.ts`, proving an ordinary
 *     `packages/lore/src/**` change keeps selecting its transitive test
 *     unaffected by either the scripts/ widening or the loud-zero rule.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// ─────────────────────────────────────────────────────────────────────────
// Structural mirrors of scripts/changed-tests.ts's exported shapes (see
// module-level import note above — not imported directly).
// ─────────────────────────────────────────────────────────────────────────

type FileMap = ReadonlyMap<string, string>;
type AliasMap = Readonly<Record<string, string>>;
type SelectionReason = "changed-test" | "transitive" | "binary-consumer" | "tree-scan-oracle";
type TestRunner = "vitest" | "bun";
type BinaryConsumerKind = "compiled" | "source";
type TreeScanScope = "packages-test-tree" | "repo-tracked-text-source";
interface SelectedFile {
  path: string;
  reason: SelectionReason;
  runner: TestRunner;
  binaryConsumerKind?: BinaryConsumerKind;
}
interface SelectionResult {
  selected: readonly SelectedFile[];
  zeroSelectionWarning: boolean;
  changedFiles: readonly string[];
}
interface ImportGraph {
  forward: ReadonlyMap<string, ReadonlySet<string>>;
  reverse: ReadonlyMap<string, ReadonlySet<string>>;
}
interface ChangedTestsCliArgs {
  list: boolean;
  base: string | undefined;
}
interface ChangedTestsErrorInstance extends Error {
  code: "cli" | "git" | "graph" | "runner";
  context?: Record<string, unknown>;
}

type ExtractImportSpecifiersFn = (content: string) => string[];
type ResolveImportSpecifierFn = (specifier: string, fromFile: string, fileMap: FileMap, aliasMap: AliasMap) => string | undefined;
type BuildImportGraphFn = (fileMap: FileMap, aliasMap: AliasMap) => ImportGraph;
type IsTestFileFn = (path: string) => boolean;
type IsBunTestFileFn = (path: string) => boolean;
type ClassifyBinaryConsumerFn = (path: string, content: string) => BinaryConsumerKind | undefined;
type IsBinaryConsumerCandidateFn = (path: string, content: string) => boolean;
type ClassifyTreeScanningOracleFn = (path: string, content: string) => TreeScanScope | undefined;
type ChangedFileMatchesTreeScanScopeFn = (changedPath: string, scope: TreeScanScope) => boolean;
type SelectAffectedTestsFn = (params: { changedFiles: readonly string[]; fileMap: FileMap; aliasMap: AliasMap }) => SelectionResult;
type FormatAccountingFn = (selection: SelectionResult) => string;
type IsLoudZeroFn = (selection: SelectionResult) => boolean;
type ParseArgsFn = (argv: readonly string[]) => ChangedTestsCliArgs;
type ChangedTestsErrorCtor = new (
  code: "cli" | "git" | "graph" | "runner",
  message: string,
  context?: Record<string, unknown>,
) => ChangedTestsErrorInstance;

// packages/lore/tests/unit/scripts/changed-tests-selector.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const CHANGED_TESTS_SPECIFIER = pathToFileURL(join(REPO_ROOT, "scripts", "changed-tests.ts")).href;
/** Real file path (not a `file://` URL) — used to spawn the CLI shell as a subprocess for the scripts/-universe end-to-end controls below, as opposed to `CHANGED_TESTS_SPECIFIER`'s in-process `import()` of the pure algorithm exports. */
const CHANGED_TESTS_SCRIPT = join(REPO_ROOT, "scripts", "changed-tests.ts");

let extractImportSpecifiers: ExtractImportSpecifiersFn;
let resolveImportSpecifier: ResolveImportSpecifierFn;
let buildImportGraph: BuildImportGraphFn;
let isTestFile: IsTestFileFn;
let isBunTestFile: IsBunTestFileFn;
let classifyBinaryConsumer: ClassifyBinaryConsumerFn;
let isBinaryConsumerCandidate: IsBinaryConsumerCandidateFn;
let classifyTreeScanningOracle: ClassifyTreeScanningOracleFn;
let isChangedFileInTreeScanScope: ChangedFileMatchesTreeScanScopeFn;
let selectAffectedTests: SelectAffectedTestsFn;
let formatAccounting: FormatAccountingFn;
let isLoudZero: IsLoudZeroFn;
let parseArgs: ParseArgsFn;
let ChangedTestsError: ChangedTestsErrorCtor;

beforeAll(async () => {
  const mod = await import(/* @vite-ignore */ CHANGED_TESTS_SPECIFIER);
  extractImportSpecifiers = mod.extractImportSpecifiers;
  resolveImportSpecifier = mod.resolveImportSpecifier;
  buildImportGraph = mod.buildImportGraph;
  isTestFile = mod.isTestFile;
  isBunTestFile = mod.isBunTestFile;
  classifyBinaryConsumer = mod.classifyBinaryConsumer;
  isBinaryConsumerCandidate = mod.isBinaryConsumerCandidate;
  classifyTreeScanningOracle = mod.classifyTreeScanningOracle;
  isChangedFileInTreeScanScope = mod.isChangedFileInTreeScanScope;
  selectAffectedTests = mod.selectAffectedTests;
  formatAccounting = mod.formatAccounting;
  isLoudZero = mod.isLoudZero;
  parseArgs = mod.parseArgs;
  ChangedTestsError = mod.ChangedTestsError;
});

const ALIAS_MAP: AliasMap = {
  "@lore/core": "packages/core/src/index.ts",
  "@lore/core/node": "packages/core/src/node.ts",
};

describe("changed-tests selector — isTestFile / isBunTestFile", () => {
  it("HAPPY: recognises .test.ts and .bun.test.ts as test files", () => {
    expect(isTestFile("packages/lore/tests/unit/foo.test.ts")).toBe(true);
    expect(isTestFile("packages/lore/tests/unit/foo.bun.test.ts")).toBe(true);
    expect(isTestFile("packages/lore/src/foo.ts")).toBe(false);
  });

  it("HAPPY: only .bun.test.ts is a bun test file", () => {
    expect(isBunTestFile("packages/lore/tests/unit/foo.bun.test.ts")).toBe(true);
    expect(isBunTestFile("packages/lore/tests/unit/foo.test.ts")).toBe(false);
  });
});

describe("changed-tests selector — classifyBinaryConsumer / isBinaryConsumerCandidate (AC-1/AC-4)", () => {
  it("HAPPY: a vitest .test.ts spawning the entry SOURCE via the INDEX_TS marker IS a candidate, kind 'source' — the exact incident shape", () => {
    const path = "packages/lore/tests/integration/cli/verify.test.ts";
    const content = [
      'import { spawnSync } from "child_process";',
      'const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");',
      'const result = spawnSync("bun", ["run", INDEX_TS, "verify", planId]);',
    ].join("\n");

    expect(classifyBinaryConsumer(path, content)).toBe("source");
    expect(isBinaryConsumerCandidate(path, content)).toBe(true);
  });

  it("REGRESSION: a .bun.test.ts spawning the COMPILED binary (dist/lore) is still a candidate, kind 'compiled'", () => {
    const path = "packages/lore/tests/e2e/cli-binary.bun.test.ts";
    const content = 'const LORE_BIN = join(REPO_ROOT, "dist", "lore");\nBun.spawnSync([LORE_BIN, "init"]);';

    expect(classifyBinaryConsumer(path, content)).toBe("compiled");
    expect(isBinaryConsumerCandidate(path, content)).toBe(true);
  });

  it("REGRESSION: a .bun.test.ts spawning via the LORE_BIN identifier alone (no literal 'dist/lore' substring) is still a candidate, kind 'compiled'", () => {
    const path = "packages/lore/tests/e2e/other-binary.bun.test.ts";
    const content = 'const proc = Bun.spawnSync([LORE_BIN, "status"]);';

    expect(classifyBinaryConsumer(path, content)).toBe("compiled");
  });

  it("NEGATIVE: a plain test file with no spawn marker at all is not a candidate", () => {
    const path = "packages/lore/tests/unit/service/corpus-service.test.ts";
    const content = 'import { CorpusService } from "../../../src/service/corpus-service.js";\nexpect(1).toBe(1);';

    expect(classifyBinaryConsumer(path, content)).toBeUndefined();
    expect(isBinaryConsumerCandidate(path, content)).toBe(false);
  });

  it("BOUNDARY: a non-test .ts SOURCE file containing the marker string is NOT a candidate — isTestFile gates entry regardless of content", () => {
    const path = "packages/lore/src/adapters/cli/build-info.ts";
    const content = 'export const BIN_PATH = "dist/lore";\nexport const INDEX_TS = "src/index.ts";';

    expect(isTestFile(path)).toBe(false);
    expect(classifyBinaryConsumer(path, content)).toBeUndefined();
    expect(isBinaryConsumerCandidate(path, content)).toBe(false);
  });

  it("STATE (design choice, asserted either way): a marker appearing only inside a comment still counts — this scan is not comment-aware, matching the pre-existing import-specifier scan's own limitation", () => {
    const path = "packages/lore/tests/unit/scripts/doc-comment-only.test.ts";
    const content = "// this test used to spawn INDEX_TS directly but no longer does\nexpect(1).toBe(1);";

    expect(classifyBinaryConsumer(path, content)).toBe("source");
  });

  it("HAPPY: the COMPILED marker takes precedence when a file's content matches both markers", () => {
    const path = "packages/lore/tests/integration/cli/both-markers.test.ts";
    const content = 'const INDEX_TS = "src/index.ts";\nconst LORE_BIN = "dist/lore";';

    expect(classifyBinaryConsumer(path, content)).toBe("compiled");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Rule (d): tree-scanning oracles (task
// task-test-changed-s-fourth-invisible-edge-a-tree-scanning) — a test that
// judges files via a RUNTIME FILESYSTEM SCAN, invisible to import tracing
// exactly like a binary-consumer's subprocess spawn (rule (c)) is invisible
// to it. `check-test-budgets.test.ts` and `check-no-nul-bytes.test.ts` are
// the two known REAL production instances, verified empirically (see this
// task's own `lore get`): the content snippets below mirror each REAL file's
// actual shape (a bare `main()` call proving an unmocked real-tree run; the
// no-nul-bytes test additionally imports `hasTextSourceExtension`), never a
// hardcoded filename check.
//
// ⛔ Self-referential note (measured post-merge, not hypothetical): THIS
// FILE is itself a third match for `BARE_MAIN_INVOCATION_RE` +
// `REPO_TRACKED_TEXT_SOURCE_MARKER_RE` (`scripts/changed-tests.ts`'s own
// doc comment for those markers has the full account) — the fixture strings
// below happen to contain a literal bare `main()` substring and, in several
// places, the literal identifier `hasTextSourceExtension`, so this whole
// file classifies as `"repo-tracked-text-source"` and gets selected
// alongside the two real oracles on nearly any tracked text-source change.
// Known and accepted (over-selection is the safe direction, AC-2) — not a
// defect in this suite, and not something a future edit here should try to
// "clean up" by rewording the fixture strings to dodge the markers.
// ─────────────────────────────────────────────────────────────────────────

describe("changed-tests selector — classifyTreeScanningOracle (rule (d))", () => {
  it("HAPPY: the REAL check-test-budgets.test.ts shape (bare main(), no hasTextSourceExtension import) classifies as packages-test-tree", () => {
    const path = "scripts/tests/check-test-budgets.test.ts";
    const content = [
      'import { main } from "../check-test-budgets.js";',
      'describe("check-test-budgets ledger: main() — real repo tree, task Acceptance Criterion #1", () => {',
      '  it("exits 0 against THIS checkout\'s real test tree", () => {',
      "    const exitCode = main();",
      "    expect(exitCode).toBe(0);",
      "  });",
      "});",
    ].join("\n");

    expect(classifyTreeScanningOracle(path, content)).toBe("packages-test-tree");
  });

  it("HAPPY: the REAL check-no-nul-bytes.test.ts shape (bare main() AND an hasTextSourceExtension import) classifies as repo-tracked-text-source", () => {
    const path = "scripts/tests/check-no-nul-bytes.test.ts";
    const content = [
      'import { hasTextSourceExtension, main } from "../check-no-nul-bytes.js";',
      'describe("check-no-nul-bytes: hasTextSourceExtension / hasNoExtension", () => {',
      '  it("HAPPY: a .ts file matches", () => { expect(hasTextSourceExtension("a.ts")).toBe(true); });',
      "});",
      'describe("check-no-nul-bytes: real repo tree (task oracle)", () => {',
      '  it("HAPPY: exits 0 against THIS checkout\'s own git-tracked tree", () => {',
      "    expect(main()).toBe(0);",
      "  });",
      "});",
    ].join("\n");

    expect(classifyTreeScanningOracle(path, content)).toBe("repo-tracked-text-source");
  });

  it("NEGATIVE: a non-test SOURCE file containing both markers is NOT classified — isTestFile gates entry regardless of content, mirroring classifyBinaryConsumer's own boundary case", () => {
    const path = "scripts/check-test-budgets.ts";
    const content = 'export function main(repoRoot = REPO_ROOT) { return 0; }\nfunction hasTextSourceExtension(p) { return true; }\n// main()';

    expect(isTestFile(path)).toBe(false);
    expect(classifyTreeScanningOracle(path, content)).toBeUndefined();
  });

  it("NEGATIVE: a test file whose ONLY main(...) calls pass an argument (an injected-fixture suite, not a real-tree scan) is NOT classified", () => {
    const path = "scripts/tests/check-test-budgets.test.ts";
    const content = [
      'import { main } from "../check-test-budgets.js";',
      'describe("check-test-budgets ledger: loadLedgerFromDisk", () => {',
      '  it("HAPPY: reads a real ledger file from disk at the conventional path", () => {',
      "    const ledger = main(tmpDir);", // arity-1 call, never bare main()
      "    expect(ledger).toBeDefined();",
      "  });",
      "});",
    ].join("\n");

    expect(classifyTreeScanningOracle(path, content)).toBeUndefined();
  });

  it("NEGATIVE: an ordinary test file with neither marker is not classified", () => {
    const path = "packages/lore/tests/unit/service/corpus-service.test.ts";
    const content = 'import { CorpusService } from "../../../src/service/corpus-service.js";\nexpect(1).toBe(1);';

    expect(classifyTreeScanningOracle(path, content)).toBeUndefined();
  });

  it("STATE (design choice, mirroring classifyBinaryConsumer's own comment-insensitivity): a bare main() appearing only inside a comment still counts — this scan is no more comment-aware than the rest of this file's regex scans", () => {
    const path = "scripts/tests/comment-only.test.ts";
    const content = "// this test used to call main() directly but no longer does\nexpect(1).toBe(1);";

    expect(classifyTreeScanningOracle(path, content)).toBe("packages-test-tree");
  });
});

describe("changed-tests selector — isChangedFileInTreeScanScope (rule (d))", () => {
  it("HAPPY: a packages/**/*.test.ts changed path matches packages-test-tree", () => {
    expect(isChangedFileInTreeScanScope("packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts", "packages-test-tree")).toBe(true);
  });

  it("BOUNDARY: a packages/-prefixed NON-test file does not match packages-test-tree — the prefix alone is not enough, test-file-ness is still required", () => {
    expect(isChangedFileInTreeScanScope("packages/lore/src/service/corpus-service.ts", "packages-test-tree")).toBe(false);
  });

  it("NEGATIVE: a scripts/tests/*.test.ts changed path does NOT match packages-test-tree — scanRepoTree's own scan root is packages/ ONLY, excluding scripts/tests/ by design", () => {
    expect(isChangedFileInTreeScanScope("scripts/tests/check-test-budgets.test.ts", "packages-test-tree")).toBe(false);
  });

  it("HAPPY: any tracked text-source extension (e.g. .md, .json) matches repo-tracked-text-source, regardless of directory or test-file-ness", () => {
    expect(isChangedFileInTreeScanScope("docs/some-doc.md", "repo-tracked-text-source")).toBe(true);
    expect(isChangedFileInTreeScanScope("scripts/test-budget-ledger.json", "repo-tracked-text-source")).toBe(true);
  });

  it("NEGATIVE: a non-allowlisted (binary asset) extension does not match repo-tracked-text-source", () => {
    expect(isChangedFileInTreeScanScope("packages/dashboard/public/favicon.png", "repo-tracked-text-source")).toBe(false);
  });
});

describe("changed-tests selector — resolveImportSpecifier", () => {
  const fileMap: FileMap = new Map([
    ["packages/lore/src/service/corpus-service.ts", ""],
    ["packages/core/src/schemas.ts", ""],
    ["packages/core/src/index.ts", ""],
  ]);

  it("HAPPY: resolves a relative .js specifier to the co-located .ts file", () => {
    const resolved = resolveImportSpecifier(
      "../../../core/src/schemas.js",
      "packages/lore/src/service/corpus-service.ts",
      fileMap,
      ALIAS_MAP,
    );
    expect(resolved).toBe("packages/core/src/schemas.ts");
  });

  it("HAPPY: resolves the @lore/core alias via AliasMap", () => {
    const resolved = resolveImportSpecifier("@lore/core", "packages/lore/src/service/corpus-service.ts", fileMap, ALIAS_MAP);
    expect(resolved).toBe("packages/core/src/index.ts");
  });

  it("NEGATIVE: an external bare specifier (not relative, not aliased) resolves to undefined", () => {
    const resolved = resolveImportSpecifier("zod", "packages/lore/src/service/corpus-service.ts", fileMap, ALIAS_MAP);
    expect(resolved).toBeUndefined();
  });

  it("NEGATIVE: a relative specifier with no matching file in the map resolves to undefined", () => {
    const resolved = resolveImportSpecifier(
      "../does-not-exist.js",
      "packages/lore/src/service/corpus-service.ts",
      fileMap,
      ALIAS_MAP,
    );
    expect(resolved).toBeUndefined();
  });
});

describe("changed-tests selector — selectAffectedTests", () => {
  it("1. HAPPY: incident shape — core schema change reaches a .bun.test.ts transitively through a service file", () => {
    const fileMap: FileMap = new Map([
      ["packages/core/src/schemas.ts", "export const AttestationExemptKind = 1;"],
      [
        "packages/lore/src/service/corpus-service.ts",
        'import { AttestationExemptKind } from "../../../core/src/schemas.js";\nexport const CorpusService = AttestationExemptKind;',
      ],
      [
        "packages/lore/tests/unit/store/plan-close-cascade.bun.test.ts",
        'import { CorpusService } from "../../../src/service/corpus-service.js";\n// bun:sqlite fixture regression',
      ],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/core/src/schemas.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      {
        path: "packages/lore/tests/unit/store/plan-close-cascade.bun.test.ts",
        reason: "transitive",
        runner: "bun",
      },
    ]);
    expect(result.zeroSelectionWarning).toBe(false);
  });

  it("2. NEGATIVE: an unrelated test file (no import path to the changed file) is not selected", () => {
    const fileMap: FileMap = new Map([
      ["packages/core/src/schemas.ts", "export const A = 1;"],
      [
        "packages/lore/src/service/corpus-service.ts",
        'import { A } from "../../../core/src/schemas.js";\nexport const B = A;',
      ],
      [
        "packages/lore/tests/unit/store/plan-close-cascade.bun.test.ts",
        'import { B } from "../../../src/service/corpus-service.js";',
      ],
      ["packages/lore/src/other/unrelated-module.ts", "export const Z = 1;"],
      [
        "packages/lore/tests/unit/other/unrelated.bun.test.ts",
        'import { Z } from "../../../src/other/unrelated-module.js";',
      ],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/core/src/schemas.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    const selectedPaths = result.selected.map((f) => f.path);
    expect(selectedPaths).toContain("packages/lore/tests/unit/store/plan-close-cascade.bun.test.ts");
    expect(selectedPaths).not.toContain("packages/lore/tests/unit/other/unrelated.bun.test.ts");
  });

  it("3. HAPPY: a changed test file is selected directly, reason changed-test", () => {
    const fileMap: FileMap = new Map([
      ["packages/lore/tests/unit/direct/direct.test.ts", "import { describe } from \"vitest\";"],
      ["packages/lore/src/unrelated.ts", "export const U = 1;"],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/tests/unit/direct/direct.test.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      { path: "packages/lore/tests/unit/direct/direct.test.ts", reason: "changed-test", runner: "vitest" },
    ]);
  });

  it("4. HAPPY: a binary-consumer .bun.test.ts is selected on ANY packages/lore/src or packages/core/src change, with zero import relationship", () => {
    const fileMap: FileMap = new Map([
      ["packages/lore/src/index.ts", "export const ENTRY = 1;"],
      [
        "packages/lore/tests/e2e/cli-binary.bun.test.ts",
        'const bin = "dist/lore";\n// spawns the compiled binary — no static import of src/index.ts',
      ],
      ["packages/lore/tests/unit/other/unrelated.bun.test.ts", "// no spawn marker here, no import relation"],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/index.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      {
        path: "packages/lore/tests/e2e/cli-binary.bun.test.ts",
        reason: "binary-consumer",
        runner: "bun",
        binaryConsumerKind: "compiled",
      },
    ]);

    // a packages/core/src change ALSO triggers binary-consumer inclusion (not just packages/lore/src).
    const resultFromCore = selectAffectedTests({
      changedFiles: ["packages/core/src/schemas.ts"],
      fileMap: new Map([
        ["packages/core/src/schemas.ts", "export const X = 1;"],
        ["packages/lore/tests/e2e/cli-binary.bun.test.ts", 'const bin = "LORE_BIN";'],
      ]),
      aliasMap: ALIAS_MAP,
    });
    expect(resultFromCore.selected.map((f) => f.path)).toContain("packages/lore/tests/e2e/cli-binary.bun.test.ts");
  });

  it("4b. HAPPY (AC-1/AC-5 incident shape): a vitest .test.ts source-entry spawner (INDEX_TS marker) is selected as binary-consumer, kind 'source', with zero import relationship — the exact verify.test.ts shape that was previously invisible", () => {
    const fileMap: FileMap = new Map([
      ["packages/lore/src/service/verify-runner-service.ts", "export const VERIFY = 1;"],
      [
        "packages/lore/tests/integration/cli/verify.test.ts",
        [
          'import { spawnSync } from "child_process";',
          'const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");',
          '// never imports verify-runner-service.ts — reaches it by subprocess spawn',
          'spawnSync("bun", ["run", INDEX_TS, "verify", planId]);',
        ].join("\n"),
      ],
      ["packages/lore/tests/unit/other/unrelated.test.ts", "// no spawn marker here, no import relation"],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/service/verify-runner-service.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      {
        path: "packages/lore/tests/integration/cli/verify.test.ts",
        reason: "binary-consumer",
        runner: "vitest",
        binaryConsumerKind: "source",
      },
    ]);
  });

  it("5. HAPPY: @lore/core alias resolution participates in the transitive BFS", () => {
    const fileMap: FileMap = new Map([
      ["packages/core/src/index.ts", "export const X = 1;"],
      [
        "packages/lore/src/service/alias-consumer.ts",
        'import { X } from "@lore/core";\nexport const W = X;',
      ],
      [
        "packages/lore/tests/unit/alias/alias.test.ts",
        'import { W } from "../../../src/service/alias-consumer.js";',
      ],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/core/src/index.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      { path: "packages/lore/tests/unit/alias/alias.test.ts", reason: "transitive", runner: "vitest" },
    ]);
  });

  it("6. BOUNDARY: a changed source file with zero reachable tests selects nothing AND raises the loud zero-selection warning AND the loud-zero rule (isLoudZero, requirement 2)", () => {
    const fileMap: FileMap = new Map([["packages/lore/src/orphan/no-tests.ts", "export const O = 1;"]]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/orphan/no-tests.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([]);
    expect(result.zeroSelectionWarning).toBe(true);
    expect(formatAccounting(result)).toMatch(/WARNING:/);
    // requirement 2: a graph-known zero-selection is ALSO a loud zero — the
    // FAIL block must render alongside (not instead of) the pre-existing WARNING.
    expect(isLoudZero(result)).toBe(true);
    expect(formatAccounting(result)).toMatch(/FAIL: 0 tests selected despite 1 changed file\(s\)/);
    expect(formatAccounting(result)).toContain("  packages/lore/src/orphan/no-tests.ts");
  });

  it("7. STATE: a file that is both a changed test AND a binary-consumer keeps reason changed-test (highest precedence), but STILL carries its binaryConsumerKind (AC-2 — the build-first decision must not depend on WHY a file was selected)", () => {
    const fileMap: FileMap = new Map([
      ["packages/lore/src/index.ts", "export const ENTRY = 1;"],
      [
        "packages/lore/tests/e2e/cli-binary.bun.test.ts",
        'const bin = "dist/lore";\n// this file is itself the changed file too',
      ],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/index.ts", "packages/lore/tests/e2e/cli-binary.bun.test.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      {
        path: "packages/lore/tests/e2e/cli-binary.bun.test.ts",
        reason: "changed-test",
        runner: "bun",
        binaryConsumerKind: "compiled",
      },
    ]);
  });

  it("REGRESSION: unresolved dynamic import() is ignored by design (no edge, no throw)", () => {
    const fileMap: FileMap = new Map([
      ["packages/lore/src/dynamic.ts", 'export async function load() { return import("./other.js"); }'],
      ["packages/lore/src/other.ts", "export const OTHER = 1;"],
      [
        "packages/lore/tests/unit/dynamic.test.ts",
        'import { load } from "../../src/dynamic.js";',
      ],
    ]);

    const graph = buildImportGraph(fileMap, ALIAS_MAP);
    // dynamic.ts's forward edges must NOT include other.ts (regex requires a literal "from" clause).
    expect(graph.forward.get("packages/lore/src/dynamic.ts")?.has("packages/lore/src/other.ts")).toBe(false);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/other.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });
    // other.ts changing does NOT transitively select dynamic.test.ts, since the
    // import() call is invisible to the static regex scan (documented limitation).
    expect(result.selected).toEqual([]);
  });

  // ─── rule (d): tree-scanning oracles ──────────────────────────────────
  // Content mirrors each REAL oracle test's actual shape — see
  // classifyTreeScanningOracle's own describe block above for why these two
  // specific snippets (bare main(), plus hasTextSourceExtension for the
  // wider scope) are what earns membership, not the filenames themselves.

  const CHECK_TEST_BUDGETS_TEST_CONTENT = [
    'import { main } from "../check-test-budgets.js";',
    'describe("check-test-budgets ledger: main() — real repo tree, task Acceptance Criterion #1", () => {',
    '  it("exits 0 against THIS checkout\'s real test tree", () => {',
    "    const exitCode = main();",
    "    expect(exitCode).toBe(0);",
    "  });",
    "});",
  ].join("\n");

  const CHECK_NO_NUL_BYTES_TEST_CONTENT = [
    'import { hasTextSourceExtension, main } from "../check-no-nul-bytes.js";',
    'describe("check-no-nul-bytes: hasTextSourceExtension / hasNoExtension", () => {',
    '  it("HAPPY: a .ts file matches", () => { expect(hasTextSourceExtension("a.ts")).toBe(true); });',
    "});",
    'describe("check-no-nul-bytes: real repo tree (task oracle)", () => {',
    '  it("HAPPY: exits 0 against THIS checkout\'s own git-tracked tree", () => {',
    "    expect(main()).toBe(0);",
    "  });",
    "});",
  ].join("\n");

  it("8. HAPPY (INCIDENT CONTROL, load-bearing per the task's own Oracle): a changed packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts — the REAL path the incident touched — selects check-test-budgets.test.ts as tree-scan-oracle", () => {
    const fileMap: FileMap = new Map([
      [
        "packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts",
        'import { describe, it } from "vitest";\n// unrelated content — the incident shape does not require any import relationship',
      ],
      ["scripts/tests/check-test-budgets.test.ts", CHECK_TEST_BUDGETS_TEST_CONTENT],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      {
        path: "packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts",
        reason: "changed-test",
        runner: "vitest",
      },
      { path: "scripts/tests/check-test-budgets.test.ts", reason: "tree-scan-oracle", runner: "vitest" },
    ]);
  });

  it("9. HAPPY: check-no-nul-bytes.test.ts is selected on a changed file OUTSIDE the traced universe entirely (not present in fileMap at all) — proves rule (d) consults the FULL raw changedFiles list, not just knownChanged", () => {
    const fileMap: FileMap = new Map([["scripts/tests/check-no-nul-bytes.test.ts", CHECK_NO_NUL_BYTES_TEST_CONTENT]]);

    const result = selectAffectedTests({
      changedFiles: ["docs/some-doc.md"], // not a key in fileMap at all
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      { path: "scripts/tests/check-no-nul-bytes.test.ts", reason: "tree-scan-oracle", runner: "vitest" },
    ]);
  });

  it("10. NEGATIVE: a changed file matching NEITHER oracle's scope (a non-allowlisted binary asset) selects neither tree-scanning oracle", () => {
    const fileMap: FileMap = new Map([
      ["scripts/tests/check-test-budgets.test.ts", CHECK_TEST_BUDGETS_TEST_CONTENT],
      ["scripts/tests/check-no-nul-bytes.test.ts", CHECK_NO_NUL_BYTES_TEST_CONTENT],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/dashboard/public/favicon.png"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([]);
    expect(result.zeroSelectionWarning).toBe(false); // favicon.png is not graph-known (not in fileMap) — no WARNING, matching the established BOUNDARY convention
  });

  it("11. BOUNDARY (per-oracle scoping, NOT a blanket 'always select these'): a changed .md file selects ONLY check-no-nul-bytes.test.ts, explicitly NOT check-test-budgets.test.ts (which only judges packages/** test files)", () => {
    const fileMap: FileMap = new Map([
      ["scripts/tests/check-test-budgets.test.ts", CHECK_TEST_BUDGETS_TEST_CONTENT],
      ["scripts/tests/check-no-nul-bytes.test.ts", CHECK_NO_NUL_BYTES_TEST_CONTENT],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["docs/some-doc.md"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    const selectedPaths = result.selected.map((f) => f.path);
    expect(selectedPaths).toEqual(["scripts/tests/check-no-nul-bytes.test.ts"]);
    expect(selectedPaths).not.toContain("scripts/tests/check-test-budgets.test.ts");
  });

  it("12. STATE (precedence): a tree-scanning oracle that is ITSELF the changed file keeps reason changed-test, never tree-scan-oracle", () => {
    const fileMap: FileMap = new Map([["scripts/tests/check-test-budgets.test.ts", CHECK_TEST_BUDGETS_TEST_CONTENT]]);

    const result = selectAffectedTests({
      changedFiles: ["scripts/tests/check-test-budgets.test.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      { path: "scripts/tests/check-test-budgets.test.ts", reason: "changed-test", runner: "vitest" },
    ]);
  });

  it("13. REGRESSION (precedence): a file matching BOTH the binary-consumer marker and a tree-scan-oracle shape keeps reason binary-consumer — rule (c) precedes rule (d)", () => {
    const fileMap: FileMap = new Map([
      ["packages/lore/src/index.ts", "export const ENTRY = 1;"],
      [
        "scripts/tests/both-rules.test.ts",
        `const bin = "dist/lore";\n${CHECK_TEST_BUDGETS_TEST_CONTENT}`, // both a binary-consumer marker AND a bare main() call
      ],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/index.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([
      {
        path: "scripts/tests/both-rules.test.ts",
        reason: "binary-consumer",
        runner: "vitest",
        binaryConsumerKind: "compiled",
      },
    ]);
  });
});

describe("changed-tests selector — extractImportSpecifiers", () => {
  it("HAPPY: extracts specifiers from multiline import and export-from statements, ignores dynamic import()", () => {
    const content = [
      "import {",
      "  Foo,",
      "  Bar,",
      '} from "@lore/core";',
      'export type { Baz } from "./baz.js";',
      'import "./side-effect.js";',
      'const lazy = import("./never-seen.js");',
    ].join("\n");

    const specifiers = extractImportSpecifiers(content);
    expect(specifiers).toContain("@lore/core");
    expect(specifiers).toContain("./baz.js");
    expect(specifiers).toContain("./side-effect.js");
    expect(specifiers).not.toContain("./never-seen.js");
  });
});

describe("changed-tests selector — parseArgs", () => {
  it("HAPPY: no args defaults to { list: false, base: undefined }", () => {
    expect(parseArgs([])).toEqual({ list: false, base: undefined });
  });

  it("HAPPY: --list sets list=true", () => {
    expect(parseArgs(["--list"])).toEqual({ list: true, base: undefined });
  });

  it("HAPPY: a bare positional sets base", () => {
    expect(parseArgs(["--list", "HEAD"])).toEqual({ list: true, base: "HEAD" });
  });

  it("ERROR: an unknown flag throws a ChangedTestsError, not a silent ignore", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(ChangedTestsError);
  });

  it("ERROR: a second positional argument throws rather than silently overwriting the base", () => {
    expect(() => parseArgs(["main", "HEAD"])).toThrow(ChangedTestsError);
  });
});

describe("changed-tests selector — formatAccounting", () => {
  it("REGRESSION/CONTROL: always prints both runner count lines even when both are zero, and — since changedFiles is empty here (the ONE legitimate silent zero) — prints neither WARNING nor FAIL", () => {
    const output = formatAccounting({ selected: [], zeroSelectionWarning: false, changedFiles: [] });
    expect(output).toMatch(/vitest: selected 0/);
    expect(output).toMatch(/bun: selected 0/);
    expect(output).not.toMatch(/WARNING:/);
    expect(output).not.toMatch(/FAIL:/);
  });

  it("HAPPY: prints a reason tag per selected file", () => {
    const output = formatAccounting({
      selected: [
        { path: "packages/lore/tests/unit/a.test.ts", reason: "changed-test", runner: "vitest" },
        { path: "packages/lore/tests/unit/b.bun.test.ts", reason: "transitive", runner: "bun" },
      ],
      zeroSelectionWarning: false,
      changedFiles: ["packages/lore/tests/unit/a.test.ts"],
    });
    expect(output).toMatch(/vitest: selected 1/);
    expect(output).toMatch(/bun: selected 1/);
    expect(output).toMatch(/a\.test\.ts \(changed-test\)/);
    expect(output).toMatch(/b\.bun\.test\.ts \(transitive\)/);
    // requirement 2: a NON-empty selection is never a loud zero, regardless of changedFiles.
    expect(output).not.toMatch(/FAIL:/);
  });

  it("AC-2/AC-5: build-first is observable and reads 'no' when the selection contains ONLY source-kind binary-consumers (no compiled spawner present)", () => {
    const output = formatAccounting({
      selected: [
        {
          path: "packages/lore/tests/integration/cli/verify.test.ts",
          reason: "binary-consumer",
          runner: "vitest",
          binaryConsumerKind: "source",
        },
      ],
      zeroSelectionWarning: false,
      changedFiles: ["packages/lore/src/service/verify-runner-service.ts"],
    });
    expect(output).toMatch(/^build-first: no$/m);
  });

  it("AC-2/AC-5: build-first is observable and reads 'yes' (with a count) when >=1 compiled-kind binary-consumer is selected, even alongside source-kind ones", () => {
    const output = formatAccounting({
      selected: [
        {
          path: "packages/lore/tests/integration/cli/verify.test.ts",
          reason: "binary-consumer",
          runner: "vitest",
          binaryConsumerKind: "source",
        },
        {
          path: "packages/lore/tests/e2e/cli-binary.bun.test.ts",
          reason: "binary-consumer",
          runner: "bun",
          binaryConsumerKind: "compiled",
        },
      ],
      zeroSelectionWarning: false,
      changedFiles: ["packages/lore/src/index.ts"],
    });
    expect(output).toMatch(/^build-first: yes \(1 compiled binary-consumer file\(s\) selected\)$/m);
  });
});

describe("changed-tests selector — isLoudZero (loud-zero rule, requirement 2 of task-test-changed-selects-nothing-for-any-scripts-change-and)", () => {
  it("HAPPY: true for the canonical shape — >=1 changed file, zero selected", () => {
    expect(isLoudZero({ selected: [], zeroSelectionWarning: false, changedFiles: ["scripts/build.ts"] })).toBe(true);
  });

  it("NEGATIVE: false whenever >=1 file WAS selected, regardless of how many files changed", () => {
    const selected = [{ path: "packages/lore/tests/unit/a.test.ts", reason: "changed-test" as const, runner: "vitest" as const }];
    expect(isLoudZero({ selected, zeroSelectionWarning: false, changedFiles: ["packages/lore/tests/unit/a.test.ts"] })).toBe(false);
  });

  it("BOUNDARY/CONTROL: false when changedFiles is genuinely empty — the ONE legitimate silent zero, even though selected is also empty", () => {
    expect(isLoudZero({ selected: [], zeroSelectionWarning: false, changedFiles: [] })).toBe(false);
  });

  it("STATE: zeroSelectionWarning=true implies isLoudZero=true (subset invariant) — a graph-known zero-selection is ALWAYS also a loud zero", () => {
    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/orphan/state-invariant.ts"],
      fileMap: new Map([["packages/lore/src/orphan/state-invariant.ts", "export const O = 1;"]]),
      aliasMap: ALIAS_MAP,
    });
    expect(result.zeroSelectionWarning).toBe(true);
    expect(isLoudZero(result)).toBe(true);
  });

  it("REGRESSION: an ordinary transitive HAPPY selection (packages/core/src -> packages/lore/src -> .bun.test.ts, the incident shape from case 1) stays isLoudZero=false — widening the predicate must not retroactively flag an established non-empty selection", () => {
    const fileMap: FileMap = new Map([
      ["packages/core/src/schemas.ts", "export const AttestationExemptKind = 1;"],
      [
        "packages/lore/src/service/corpus-service.ts",
        'import { AttestationExemptKind } from "../../../core/src/schemas.js";\nexport const CorpusService = AttestationExemptKind;',
      ],
      [
        "packages/lore/tests/unit/store/plan-close-cascade.bun.test.ts",
        'import { CorpusService } from "../../../src/service/corpus-service.js";\n// bun:sqlite fixture regression',
      ],
    ]);
    const result = selectAffectedTests({ changedFiles: ["packages/core/src/schemas.ts"], fileMap, aliasMap: ALIAS_MAP });
    expect(result.selected.length).toBeGreaterThan(0);
    expect(isLoudZero(result)).toBe(false);
  });
});

describe("changed-tests selector — end-to-end incident control (AC-5): selectAffectedTests + formatAccounting together over the real verify.test.ts shape", () => {
  it("a change to verify-runner-service.ts selects verify.test.ts as binary-consumer/source, and the printed accounting shows build-first: no for that selection alone", () => {
    const fileMap: FileMap = new Map([
      ["packages/lore/src/service/verify-runner-service.ts", "export const VERIFY = 1;"],
      [
        "packages/lore/tests/integration/cli/verify.test.ts",
        [
          'import { spawnSync } from "child_process";',
          'const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");',
          'spawnSync("bun", ["run", INDEX_TS, "verify", planId]);',
        ].join("\n"),
      ],
    ]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/service/verify-runner-service.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });
    const output = formatAccounting(result);

    expect(result.selected.map((f) => f.path)).toContain("packages/lore/tests/integration/cli/verify.test.ts");
    expect(output).toContain("packages/lore/tests/integration/cli/verify.test.ts (binary-consumer)");
    expect(output).toMatch(/^build-first: no$/m);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// scripts/ universe widening (task
// task-test-changed-s-file-universe-is-packages-not-the-repo-the): the
// selector's file UNIVERSE was `packages/*` only — `loadFileMap` never
// walked `scripts/`, so a changed `scripts/tests/*.test.ts` went unselected
// even under rule (a) ("changed test files"), the simplest rule this script
// has. `loadFileMap` is a private, unexported function (deliberately — it is
// the IO shell, not the pure core the rest of this suite drives via an
// injected FileMap), so the ONLY way to prove the widened universe actually
// reaches disk is to run the REAL CLI subprocess against a REAL (throwaway,
// isolated) git repo — never this repo's own working tree, and never a
// synthetic in-process FileMap, which would just assume the walk instead of
// proving it.
// ─────────────────────────────────────────────────────────────────────────

describe("changed-tests selector — scripts/ universe widening: end-to-end via real CLI subprocess + isolated git fixture", () => {
  interface RunResult {
    readonly stdout: string;
    readonly exitCode: number;
    /** `spawnSync`'s `signal` field — non-null iff the process was killed rather than returning normally. Asserted null in the loud-zero cases below to prove the new exit-1 path is a controlled `return`, not a crash. */
    readonly signal: NodeJS.Signals | null;
  }

  /** Spawns the REAL `scripts/changed-tests.ts` with `cwd` pointed at the fixture repo — explicit `maxBuffer` per this repo's spawnSync-truncation discipline (project CLAUDE.md), even though every payload here is small. */
  function runChangedTests(args: readonly string[], cwd: string): RunResult {
    const result = spawnSync("bun", ["run", CHANGED_TESTS_SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: result.stdout ?? "", exitCode: result.status ?? 1, signal: result.signal };
  }

  /**
   * Builds an isolated throwaway git repo mirroring just enough of the real
   * repo's shape for `loadFileMap`/`loadCoreAliasMap` to succeed:
   * `packages/core/package.json` (an `exports` field only —
   * `loadCoreAliasMap` never needs the alias TARGETS to exist on disk), a
   * `scripts/` source file with a `scripts/tests/` sibling importing it
   * directly (mirrors the real `scripts/check-test-budgets.ts` /
   * `scripts/tests/check-test-budgets.test.ts` pair), a `scripts/` source
   * file with NO test at all (mirrors the real `scripts/build.ts` — the
   * "most scripts/ files have no test" case), a `packages/lore/src` /
   * `packages/lore/tests` transitive pair (for the REGRESSION control, AC-3
   * of `task-test-changed-selects-nothing-for-any-scripts-change-and` — an
   * ordinary `packages/lore/src/**` change must keep selecting its existing
   * transitive set unaffected by the scripts/ widening or the loud-zero
   * rule), and a repo-root `README.md` traced by NEITHER rule (for the
   * BOUNDARY control, AC-4 — a changed file entirely outside the traced
   * universe). Returns the repo dir and the base commit's sha so each test
   * can mutate a file UNCOMMITTED and rely on `git status --porcelain` to
   * surface it as changed — an explicit `<base>` sha sidesteps
   * `resolveBaseRef`'s `merge-base main HEAD` default, which would fail here
   * (the fixture repo has no `main` branch).
   */
  function buildFixtureRepo(): { dir: string; baseSha: string } {
    const dir = mkdtempSync(join(tmpdir(), "changed-tests-scripts-universe-"));

    mkdirSync(join(dir, "packages", "core"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "core", "package.json"),
      JSON.stringify({ name: "@lore/core", exports: { ".": "./src/index.ts", "./node": "./src/node.ts" } }),
      "utf8",
    );

    mkdirSync(join(dir, "scripts", "tests"), { recursive: true });
    writeFileSync(join(dir, "scripts", "check-test-budgets.ts"), "export const SCAN_THRESHOLD = 1;\n", "utf8");
    writeFileSync(
      join(dir, "scripts", "tests", "check-test-budgets.test.ts"),
      [
        'import { describe, it, expect } from "vitest";',
        'import { SCAN_THRESHOLD } from "../check-test-budgets.js";',
        'describe("fixture", () => {',
        '  it("noop", () => { expect(SCAN_THRESHOLD).toBe(1); });',
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    // mirrors the real scripts/build.ts — a scripts/ source file with NO test importing it.
    writeFileSync(join(dir, "scripts", "build.ts"), "export const BUILD_MARKER = 1;\n", "utf8");

    // packages/lore/src -> packages/lore/tests transitive pair (AC-3 REGRESSION control below).
    mkdirSync(join(dir, "packages", "lore", "src", "service"), { recursive: true });
    mkdirSync(join(dir, "packages", "lore", "tests", "unit"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "lore", "src", "service", "some-service.ts"),
      "export const SOME_VALUE = 1;\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "packages", "lore", "tests", "unit", "some-service.test.ts"),
      [
        'import { describe, it, expect } from "vitest";',
        'import { SOME_VALUE } from "../../src/service/some-service.js";',
        'describe("fixture", () => {',
        '  it("noop", () => { expect(SOME_VALUE).toBe(1); });',
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    // a repo-root file traced by NEITHER rule — not under packages/*/src,
    // packages/*/tests, or scripts/** (AC-4 BOUNDARY control below).
    writeFileSync(join(dir, "README.md"), "# fixture\n", "utf8");

    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync(
      "git",
      ["-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-q", "-m", "base"],
      { cwd: dir },
    );
    const baseSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();

    return { dir, baseSha };
  }

  let fixture: { dir: string; baseSha: string };

  beforeEach(() => {
    fixture = buildFixtureRepo();
  });

  afterEach(() => {
    rmSync(fixture.dir, { recursive: true, force: true });
  });

  it("rule (a) HAPPY: a changed scripts/tests/*.test.ts is selected as changed-test, independent of any import edge", () => {
    const testFile = join(fixture.dir, "scripts", "tests", "check-test-budgets.test.ts");
    writeFileSync(testFile, `${readFileSync(testFile, "utf8")}\n// rule (a) mutation\n`, "utf8");

    const result = runChangedTests(["--list", fixture.baseSha], fixture.dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/scripts\/tests\/check-test-budgets\.test\.ts \(changed-test\)/);
    expect(result.stdout).toMatch(/vitest: selected 1/);
  });

  it("rule (b) HAPPY: a source-only change (scripts/check-test-budgets.ts, test file untouched) still selects the test transitively — proves the widened map's scripts/ -> scripts/tests/ import edges are actually FOLLOWED, not merely assumed to fall out", () => {
    const sourceFile = join(fixture.dir, "scripts", "check-test-budgets.ts");
    writeFileSync(sourceFile, `${readFileSync(sourceFile, "utf8")}\n// rule (b) mutation, source only\n`, "utf8");

    const result = runChangedTests(["--list", fixture.baseSha], fixture.dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/scripts\/tests\/check-test-budgets\.test\.ts \(transitive\)/);
    expect(result.stdout).toMatch(/vitest: selected 1/);
  });

  it("NEGATIVE: a scripts/ source file with no test (scripts/build.ts) selects nothing spurious — WARNING (graph-known) AND exit 1 via the loud-zero rule (requirement 2), never a crash, never a select-everything fallback", () => {
    const noTestFile = join(fixture.dir, "scripts", "build.ts");
    writeFileSync(noTestFile, `${readFileSync(noTestFile, "utf8")}\n// negative control mutation\n`, "utf8");

    const result = runChangedTests(["--list", fixture.baseSha], fixture.dir);

    // requirement 2: a genuinely zero selection over a non-empty changed set
    // is no longer reported as success, even under --list.
    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeNull(); // a controlled `return 1`, not a crash/kill
    expect(result.stdout).toMatch(/vitest: selected 0/);
    expect(result.stdout).toMatch(/bun: selected 0/);
    expect(result.stdout).toMatch(/WARNING:/);
    expect(result.stdout).toMatch(/FAIL: 0 tests selected despite 1 changed file\(s\)/);
    expect(result.stdout).toContain("  scripts/build.ts");
    expect(result.stdout).not.toMatch(/check-test-budgets\.test\.ts/);
  });

  it("BOUNDARY (AC-4): a changed file in a directory traced by NEITHER rule (README.md — outside packages/*/src, packages/*/tests, and scripts/**) produces the loud-zero outcome, not a green run — exit 1, FAIL names the path; UNLIKE the graph-known scripts/build.ts case above, no WARNING fires since the file is not even in fileMap", () => {
    const readme = join(fixture.dir, "README.md");
    writeFileSync(readme, `${readFileSync(readme, "utf8")}\n<!-- untraced mutation -->\n`, "utf8");

    const result = runChangedTests(["--list", fixture.baseSha], fixture.dir);

    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toMatch(/vitest: selected 0/);
    expect(result.stdout).toMatch(/bun: selected 0/);
    expect(result.stdout).not.toMatch(/WARNING:/);
    expect(result.stdout).toMatch(/FAIL: 0 tests selected despite 1 changed file\(s\)/);
    expect(result.stdout).toContain("  README.md");
  });

  it("CONTROL (AC-2): genuinely no changed files still exits 0 and selects nothing, silently — the ONE legitimate zero-selection state, not to be confused with the loud-zero cases above", () => {
    // no mutation at all: base === HEAD and the working tree is clean, so
    // both the diff and the porcelain status are empty.
    const result = runChangedTests(["--list", fixture.baseSha], fixture.dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/vitest: selected 0/);
    expect(result.stdout).toMatch(/bun: selected 0/);
    expect(result.stdout).not.toMatch(/WARNING:/);
    expect(result.stdout).not.toMatch(/FAIL:/);
  });

  it("REGRESSION (AC-3): an ordinary packages/lore/src/** change still selects its existing transitive set, unaffected by the scripts/ universe widening or the loud-zero rule added alongside it", () => {
    const serviceFile = join(fixture.dir, "packages", "lore", "src", "service", "some-service.ts");
    writeFileSync(serviceFile, `${readFileSync(serviceFile, "utf8")}\n// regression mutation\n`, "utf8");

    const result = runChangedTests(["--list", fixture.baseSha], fixture.dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/packages\/lore\/tests\/unit\/some-service\.test\.ts \(transitive\)/);
    expect(result.stdout).toMatch(/vitest: selected 1/);
    expect(result.stdout).not.toMatch(/WARNING:/);
    expect(result.stdout).not.toMatch(/FAIL:/);
  });
});

describe("changed-tests selector — scripts/ runner-assignment stays filename-derived (no .bun.test.ts under scripts/ today)", () => {
  it("BOUNDARY/REGRESSION: asserts, against the REAL repo tree, that no .bun.test.ts file exists under scripts/ — runner assignment for scripts/tests/*.test.ts falls out of isBunTestFile's existing filename check, never a hardcoded scripts-is-always-vitest special case", () => {
    const scriptsDir = join(REPO_ROOT, "scripts");
    const allPaths: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          walk(join(dir, entry.name));
          continue;
        }
        allPaths.push(join(dir, entry.name));
      }
    };
    walk(scriptsDir);

    const bunTestFiles = allPaths.filter((p) => isBunTestFile(p));
    expect(bunTestFiles).toEqual([]);

    // the assumption that DOES hold today: every scripts/tests/*.test.ts is a plain vitest file,
    // via the SAME isBunTestFile check every packages/* test file goes through — not a special case.
    const scriptsTestFiles = allPaths.filter((p) => isTestFile(p) && p.includes(`${join("scripts", "tests")}`));
    expect(scriptsTestFiles.length).toBeGreaterThan(0);
    for (const p of scriptsTestFiles) {
      expect(isBunTestFile(p)).toBe(false);
    }
  });
});
