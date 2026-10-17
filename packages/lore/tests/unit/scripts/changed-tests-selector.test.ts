// @reads packages/lore/tests/unit/assets/pre-push-parity.test.ts
/**
 * Unit suite for the `bun run test:changed` selector core (AC-TC-1 of
 * `spec-two-runner-changed-test-selection-deterministic-test`, reshaped by AC-TG-7 of
 * `spec-test-governance-guards-that-refuse-bad-tests-declared`).
 *
 * Every case drives `selectAffectedTests` (and friends) with an injected synthetic `FileMap` — no git,
 * no real filesystem walk, no subprocess — except the fixture-repo CLI blocks at the end, which run the
 * real script against a throwaway git repository (they prove `loadFileMap` really walks `scripts/`).
 * The declared-input rules (`@reads` / `@spawns`) and the run-time check have their own oracle:
 * `scripts/tests/changed-tests-declared-inputs.test.ts`. The former content-marker rules (binary
 * consumers, tree-scanning oracles) no longer exist and their cases were removed with them.
 *
 * Import note: `scripts/changed-tests.ts` lives OUTSIDE `packages/lore/tsconfig.tests.json`'s `rootDir`,
 * so a static import fails with TS6059 (same constraint as `tests/unit/distribution/platform-map.test.ts`);
 * this file loads it with `import()` of a runtime-COMPUTED specifier and mirrors the shapes locally.
 *
 * Coverage: HAPPY (transitive incident shape, alias BFS, changed test), NEGATIVE (unrelated test not
 * selected), BOUNDARY (zero-selection warning, loud zero, literal dynamic import edges), STATE (reason
 * tags), ERROR (`parseArgs` rejections), REGRESSION (accounting always prints both runner lines; the
 * scripts/ universe is walked; runner assignment stays filename-derived).
 */
// @reads scripts/**
// @reads packages/core/package.json
// @spawns scripts/changed-tests.ts

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
type SelectionReason = "changed-test" | "transitive" | "declared-read" | "declared-spawn";
type TestRunner = "vitest" | "bun";
interface SelectedFile {
  path: string;
  reason: SelectionReason;
  runner: TestRunner;
  needsCompiledBinary?: true;
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
  code: "cli" | "git" | "graph" | "runner" | "declaration";
  context?: Record<string, unknown>;
}

type ExtractImportSpecifiersFn = (content: string) => string[];
type ResolveImportSpecifierFn = (specifier: string, fromFile: string, fileMap: FileMap, aliasMap: AliasMap) => string | undefined;
type BuildImportGraphFn = (fileMap: FileMap, aliasMap: AliasMap) => ImportGraph;
type IsTestFileFn = (path: string) => boolean;
type IsBunTestFileFn = (path: string) => boolean;
type SelectAffectedTestsFn = (params: { changedFiles: readonly string[]; fileMap: FileMap; aliasMap: AliasMap }) => SelectionResult;
type FormatAccountingFn = (selection: SelectionResult) => string;
type IsLoudZeroFn = (selection: SelectionResult) => boolean;
type ParseArgsFn = (argv: readonly string[]) => ChangedTestsCliArgs;
type ChangedTestsErrorCtor = new (
  code: "cli" | "git" | "graph" | "runner" | "declaration",
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

  it("BOUNDARY: a literal dynamic import() is an edge (the CLI reaches every command that way); a computed one is not", () => {
    const fileMap: FileMap = new Map([
      ["packages/lore/src/dynamic.ts", 'export async function load() { return import("./other.js"); }'],
      ["packages/lore/src/other.ts", "export const OTHER = 1;"],
      ["packages/lore/src/computed.ts", "export async function load(n: string) { return import(`./${n}.js`); }"],
      ["packages/lore/tests/unit/dynamic.test.ts", 'import { load } from "../../src/dynamic.js";'],
      ["packages/lore/tests/unit/computed.test.ts", 'import { load } from "../../src/computed.js";'],
    ]);

    const graph = buildImportGraph(fileMap, ALIAS_MAP);
    expect(graph.forward.get("packages/lore/src/dynamic.ts")?.has("packages/lore/src/other.ts")).toBe(true);
    expect(graph.forward.get("packages/lore/src/computed.ts")?.size).toBe(0);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/other.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });
    expect(result.selected).toEqual([
      { path: "packages/lore/tests/unit/dynamic.test.ts", reason: "transitive", runner: "vitest" },
    ]);
  });
});

describe("changed-tests selector — extractImportSpecifiers", () => {
  it("HAPPY: extracts specifiers from multiline import and export-from statements, follows a literal dynamic import()", () => {
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
    expect(specifiers).toContain("./never-seen.js");
    expect(extractImportSpecifiers("const n = 'x'; import(`./${n}.js`); import(n);")).toEqual([]);
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
