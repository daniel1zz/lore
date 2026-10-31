/**
 * AC-CC-2 of spec-a-criterion-s-stamped-pass-carries-to-the-assessed-head: a change to a run-wide
 * configuration file selects every test, with the reason `run-config`, in BOTH selector modes (working
 * tree and `selectForCommit`). The setup file is read from the fixture's vitest config, so renaming it
 * in the config moves the rule to the new file.
 *
 * @spawns-external git builds throwaway fixture repositories and reads their commits
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadFileMap, loadVitestConfigSources, RUN_CONFIG_PATTERNS, selectAffectedTests, selectForCommit } from "../changed-tests";

const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} exited ${String(result.status)}: ${result.stderr}`);
  return result.stdout.trim();
}

const VITEST_CONFIG = (setup: string) => `export default { test: { setupFiles: ["${setup}"], environment: "node" } };\n`;
const TESTS = ["packages/a/tests/one.test.ts", "packages/a/tests/two.test.ts", "scripts/tests/three.test.ts", "packages/a/tests/four.bun.test.ts"];
const BASE_TREE: Record<string, string> = {
  "package.json": "{}\n",
  "bun.lock": "lock\n",
  "bunfig.toml": "[test]\n",
  "vitest.config.ts": VITEST_CONFIG("scripts/setup-a.ts"),
  "vitest.node-files.ts": "export const NODE = [];\n",
  "tsconfig.json": "{}\n",
  "packages/a/tsconfig.json": "{}\n",
  "scripts/test-file.ts": "export {};\n",
  "scripts/run-tests.ts": "export {};\n",
  "scripts/setup-a.ts": 'import "./setup-helper";\n',
  "scripts/setup-helper.ts": "export {};\n",
  "scripts/setup-b.ts": "export {};\n",
  "docs/vitest-notes.md": "notes\n",
  "packages/a/src/lib.ts": "export const lib = 1;\n",
  ...Object.fromEntries(TESTS.map((t) => [t, "export {};\n"])),
};

function writeTree(root: string, tree: Record<string, string>): void {
  for (const [path, content] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** A repo with BASE_TREE at c0 and `edited` applied on top at c1 (the working tree is left at c1, clean). */
function buildRepo(edited: Record<string, string>): { root: string; c1: string } {
  const root = mkdtempSync(join(tmpdir(), "changed-tests-run-config-"));
  fixtureRoots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "commit.gpgsign", "false");
  writeTree(root, BASE_TREE);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "c0");
  writeTree(root, edited);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "c1");
  return { root, c1: git(root, "rev-parse", "HEAD") };
}

function bothModes(root: string, c1: string, changed: string[]) {
  const workingTree = selectAffectedTests({
    changedFiles: changed,
    fileMap: loadFileMap(root),
    aliasMap: {},
    vitestConfigSources: loadVitestConfigSources(root),
  });
  const commit = selectForCommit({ repoRoot: root, commit: c1, changedPaths: changed });
  return { workingTree, commit };
}

function expectEveryTestRunConfig(root: string, c1: string, changed: string[]): void {
  for (const [mode, selection] of Object.entries(bothModes(root, c1, changed))) {
    expect(selection.selected.map((f) => f.path), mode).toEqual([...TESTS].sort());
    expect(selection.selected.every((f) => f.reason === "run-config"), mode).toBe(true);
  }
}

describe("AC-CC-2: run-wide configuration selects every test", () => {
  const cases: [string, string][] = [
    ["package.json", '{"name":"x"}\n'],
    ["bun.lock", "lock2\n"],
    ["bunfig.toml", "[test]\nx=1\n"],
    ["vitest.config.ts", VITEST_CONFIG("scripts/setup-a.ts") + "// edited\n"],
    ["vitest.node-files.ts", "export const NODE = ['x'];\n"],
    ["packages/a/tsconfig.json", '{"x":1}\n'],
    ["tsconfig.json", '{"x":1}\n'],
    ["scripts/test-file.ts", "export const x = 1;\n"],
    ["scripts/run-tests.ts", "export const x = 1;\n"],
    ["scripts/setup-a.ts", 'import "./setup-helper";\nexport const x = 1;\n'],
    ["scripts/setup-helper.ts", "export const x = 1;\n"],
  ];
  for (const [file, content] of cases) {
    it(`${file} alone selects every test (both modes)`, () => {
      const { root, c1 } = buildRepo({ [file]: content });
      expectEveryTestRunConfig(root, c1, [file]);
    });
  }

  it("renaming the setup file in the config makes the new one count and the old one not", () => {
    const { root, c1 } = buildRepo({ "vitest.config.ts": VITEST_CONFIG("scripts/setup-b.ts") });
    expectEveryTestRunConfig(root, c1, ["scripts/setup-b.ts"]);
    for (const [mode, selection] of Object.entries(bothModes(root, c1, ["scripts/setup-a.ts"]))) {
      expect(selection.selected, mode).toEqual([]);
    }
  });

  it("an unrelated config-looking file selects nothing by this rule", () => {
    const { root, c1 } = buildRepo({ "docs/vitest-notes.md": "edited\n" });
    for (const [mode, selection] of Object.entries(bothModes(root, c1, ["docs/vitest-notes.md"]))) {
      expect(selection.selected, mode).toEqual([]);
      expect(selection.runConfig?.hits, mode).toEqual([]);
    }
  });

  it("the fixed list is one exported constant naming every file of the spec", () => {
    for (const name of ["package.json", "bun.lock", "bunfig.toml", "scripts/test-file.ts", "scripts/run-tests.ts"]) {
      expect(RUN_CONFIG_PATTERNS).toContain(name);
    }
    expect(RUN_CONFIG_PATTERNS.some((p) => p.includes("tsconfig"))).toBe(true);
    expect(RUN_CONFIG_PATTERNS.some((p) => p.startsWith("vitest"))).toBe(true);
  });

  it("a config that cannot be parsed names itself and counts any change under the directories it references", () => {
    const { root, c1 } = buildRepo({
      "vitest.config.ts": 'const f = () => ["scripts/setup-a.ts"];\nexport default { test: { setupFiles: f(), globalSetup: ["scripts/global.ts"] } };\n',
      "scripts/other.ts": "export const o = 1;\n",
    });
    for (const [mode, selection] of Object.entries(bothModes(root, c1, ["scripts/other.ts"]))) {
      expect(selection.selected.length, mode).toBe(TESTS.length);
      expect(selection.runConfig?.unparseable, mode).toEqual(["vitest.config.ts"]);
    }
  });
});
