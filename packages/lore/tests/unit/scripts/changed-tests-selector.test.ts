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
 */

import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ─────────────────────────────────────────────────────────────────────────
// Structural mirrors of scripts/changed-tests.ts's exported shapes (see
// module-level import note above — not imported directly).
// ─────────────────────────────────────────────────────────────────────────

type FileMap = ReadonlyMap<string, string>;
type AliasMap = Readonly<Record<string, string>>;
type SelectionReason = "changed-test" | "transitive" | "binary-consumer";
type TestRunner = "vitest" | "bun";
interface SelectedFile {
  path: string;
  reason: SelectionReason;
  runner: TestRunner;
}
interface SelectionResult {
  selected: readonly SelectedFile[];
  zeroSelectionWarning: boolean;
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
type SelectAffectedTestsFn = (params: { changedFiles: readonly string[]; fileMap: FileMap; aliasMap: AliasMap }) => SelectionResult;
type FormatAccountingFn = (selection: SelectionResult) => string;
type ParseArgsFn = (argv: readonly string[]) => ChangedTestsCliArgs;
type ChangedTestsErrorCtor = new (
  code: "cli" | "git" | "graph" | "runner",
  message: string,
  context?: Record<string, unknown>,
) => ChangedTestsErrorInstance;

// packages/lore/tests/unit/scripts/changed-tests-selector.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const CHANGED_TESTS_SPECIFIER = pathToFileURL(join(REPO_ROOT, "scripts", "changed-tests.ts")).href;

let extractImportSpecifiers: ExtractImportSpecifiersFn;
let resolveImportSpecifier: ResolveImportSpecifierFn;
let buildImportGraph: BuildImportGraphFn;
let isTestFile: IsTestFileFn;
let isBunTestFile: IsBunTestFileFn;
let selectAffectedTests: SelectAffectedTestsFn;
let formatAccounting: FormatAccountingFn;
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
      { path: "packages/lore/tests/e2e/cli-binary.bun.test.ts", reason: "binary-consumer", runner: "bun" },
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

  it("6. BOUNDARY: a changed source file with zero reachable tests selects nothing AND raises the loud zero-selection warning", () => {
    const fileMap: FileMap = new Map([["packages/lore/src/orphan/no-tests.ts", "export const O = 1;"]]);

    const result = selectAffectedTests({
      changedFiles: ["packages/lore/src/orphan/no-tests.ts"],
      fileMap,
      aliasMap: ALIAS_MAP,
    });

    expect(result.selected).toEqual([]);
    expect(result.zeroSelectionWarning).toBe(true);
    expect(formatAccounting(result)).toMatch(/WARNING:/);
  });

  it("7. STATE: a file that is both a changed test AND a binary-consumer keeps reason changed-test (highest precedence)", () => {
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
      { path: "packages/lore/tests/e2e/cli-binary.bun.test.ts", reason: "changed-test", runner: "bun" },
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
  it("REGRESSION: always prints both runner count lines, even when both are zero", () => {
    const output = formatAccounting({ selected: [], zeroSelectionWarning: false });
    expect(output).toMatch(/vitest: selected 0/);
    expect(output).toMatch(/bun: selected 0/);
    expect(output).not.toMatch(/WARNING:/);
  });

  it("HAPPY: prints a reason tag per selected file", () => {
    const output = formatAccounting({
      selected: [
        { path: "packages/lore/tests/unit/a.test.ts", reason: "changed-test", runner: "vitest" },
        { path: "packages/lore/tests/unit/b.bun.test.ts", reason: "transitive", runner: "bun" },
      ],
      zeroSelectionWarning: false,
    });
    expect(output).toMatch(/vitest: selected 1/);
    expect(output).toMatch(/bun: selected 1/);
    expect(output).toMatch(/a\.test\.ts \(changed-test\)/);
    expect(output).toMatch(/b\.bun\.test\.ts \(transitive\)/);
  });
});
