/**
 * AC-SC-1 of spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach: the selector's commit
 * mode selects from a commit's TREE (git objects), covers .tsx tests and tsconfig `paths` aliases,
 * names alias imports that resolve to nothing, and reads deleted paths through the landing's parent.
 *
 * The replay case runs against this repository's REAL history (the five landings of
 * plan-documents-that-need-a-parent-are-refused-without-one-ad). Fixture cases build throwaway git
 * repositories under the OS temp directory; this repository's working tree is never read.
 *
 * @spawns-external git reads real commits and builds throwaway fixture repositories
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  buildAliasRulesFromConfigs,
  ChangedTestsError,
  formatCommitAccounting,
  runCommitCli,
  selectForCommit,
  stripJsonComments,
  type GitBytesSpawn,
} from "../changed-tests";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} exited ${String(result.status)}: ${result.stderr}`);
  return result.stdout.trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Replay: the plan whose five landings turned 12 test files red
// ─────────────────────────────────────────────────────────────────────────

const LANDINGS = ["68970cfc", "6c45104c", "e80f8168", "d4a1c43e", "adddb382"] as const;
const BROKEN_FILES_COMMIT = "0fbe25df";
const FRAGMENT_VARIABLES_TEST = "packages/lore/tests/unit/context-fragments/fragment-variables.test.ts";

describe("AC-SC-1 replay: the real history selects every broken file", () => {
  it("selects all 12 test files the plan turned red, LibraryPageBody.test.tsx included, at the tree of the last landing", () => {
    for (const commit of [...LANDINGS, BROKEN_FILES_COMMIT]) {
      expect(git(REPO_ROOT, "cat-file", "-t", commit), `${commit} must exist in this clone (full history required)`).toBe("commit");
    }
    const changedPaths = [...new Set(LANDINGS.flatMap((c) => git(REPO_ROOT, "diff", "--name-only", `${c}^1`, c).split("\n").filter(Boolean)))];
    const brokenTests = git(REPO_ROOT, "diff", "--name-only", `${BROKEN_FILES_COMMIT}^1`, BROKEN_FILES_COMMIT)
      .split("\n")
      .filter((p) => p.length > 0 && !p.endsWith(".md"));
    expect(brokenTests).toHaveLength(11);
    expect(brokenTests).toContain("packages/dashboard/tests/component/LibraryPageBody.test.tsx");
    const expected = [...brokenTests, FRAGMENT_VARIABLES_TEST].sort();

    const started = Date.now();
    const selection = selectForCommit({
      repoRoot: REPO_ROOT,
      commit: "adddb382",
      changedPaths,
      landingParents: LANDINGS.map((c) => `${c}^1`),
    });
    const elapsedMs = Date.now() - started;
    console.log(`AC-SC-1 replay: ${selection.selected.length} selected from ${changedPaths.length} changed paths in ${elapsedMs} ms`);

    const selectedPaths = selection.selected.map((f) => f.path);
    const missing = expected.filter((p) => !selectedPaths.includes(p));
    expect(missing, `broken files the selector missed:\n${missing.join("\n")}`).toEqual([]);
    expect(selectedPaths).toContain("packages/dashboard/tests/component/LibraryPageBody.test.tsx");

    const accounting = formatCommitAccounting(selection);
    expect(accounting).toMatch(/^vitest: selected \d+$/m);
    expect(accounting).toMatch(/^bun: selected \d+$/m);
    for (const file of selection.selected) expect(accounting).toContain(`${file.path} (${file.reason})`);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────
// Fixture repositories
// ─────────────────────────────────────────────────────────────────────────

const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

type Tree = Readonly<Record<string, string>>;

/** A throwaway repo whose commits each hold exactly the given tree; returns the root and the commit shas. */
function buildRepo(trees: readonly Tree[]): { root: string; commits: string[] } {
  const root = mkdtempSync(join(tmpdir(), "changed-tests-commit-mode-"));
  fixtureRoots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "commit.gpgsign", "false");
  const commits: string[] = [];
  for (const tree of trees) {
    git(root, "rm", "-rq", "--ignore-unmatch", "--cached", ".");
    for (const [path, content] of Object.entries(tree)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    git(root, "add", "-A", "--", ...Object.keys(tree));
    git(root, "commit", "-q", "--allow-empty", "-m", `c${commits.length}`);
    commits.push(git(root, "rev-parse", "HEAD"));
  }
  return { root, commits };
}

const BASE_TSCONFIG = `{
  // comments and trailing commas are legal in tsconfig
  "compilerOptions": { "strict": true, "paths": { "@lore/core": ["./packages/core/src/index.ts"], }, },
}`;
const DASHBOARD_TSCONFIG = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    /* a child's paths REPLACES the base's */
    "paths": { "@/*": ["./src/*"], "@lore/core": ["../core/src/index.ts"] },
    "baseUrl": "."
  }
}`;
const CORE_INDEX = "export const core = 1;\n";
const TSX_TEST = `import { render } from "@testing-library/react";
import { Widget } from "@/components/Widget";
it("renders", () => { render(Widget); });
`;
const DASHBOARD_TREE: Tree = {
  "tsconfig.base.json": BASE_TSCONFIG,
  "packages/core/src/index.ts": CORE_INDEX,
  "packages/dashboard/tsconfig.json": DASHBOARD_TSCONFIG,
  "packages/dashboard/src/components/Widget.tsx": "export const Widget = 1;\n",
  "packages/dashboard/src/components/Other.tsx": "export const Other = 1;\n",
  "packages/dashboard/tests/component/Widget.test.tsx": TSX_TEST,
};

describe("AC-SC-1 fixtures: .tsx tests and tsconfig path aliases", () => {
  it("selects a .tsx test importing a changed source through the `@/` tsconfig alias", () => {
    const { root, commits } = buildRepo([DASHBOARD_TREE]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/dashboard/src/components/Widget.tsx"] });
    expect(selection.selected.map((f) => [f.path, f.reason])).toEqual([["packages/dashboard/tests/component/Widget.test.tsx", "transitive"]]);
  });

  it("does not select that test for a change it cannot reach (the alias is not a catch-all)", () => {
    const { root, commits } = buildRepo([DASHBOARD_TREE]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/dashboard/src/components/Other.tsx"] });
    expect(selection.selected).toEqual([]);
  });

  it("resolves `@lore/core` for a package through the tsconfig it extends and overrides", () => {
    const tree: Tree = {
      ...DASHBOARD_TREE,
      "packages/dashboard/tests/unit/core.test.ts": 'import { core } from "@lore/core";\nit("x", () => core);\n',
    };
    const { root, commits } = buildRepo([tree]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/core/src/index.ts"] });
    expect(selection.selected.map((f) => f.path)).toEqual(["packages/dashboard/tests/unit/core.test.ts"]);
  });

  it("counts and names an alias import that resolves to no file, without changing the selection", () => {
    const tree: Tree = {
      ...DASHBOARD_TREE,
      "packages/dashboard/tests/component/Ghost.test.tsx": 'import { Ghost } from "@/components/Ghost";\nit("g", () => Ghost);\n',
    };
    const { root, commits } = buildRepo([tree]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/dashboard/src/components/Widget.tsx"] });
    expect(selection.unresolvedAliases).toEqual([{ from: "packages/dashboard/tests/component/Ghost.test.tsx", specifier: "@/components/Ghost" }]);
    expect(selection.selected.map((f) => f.path)).toEqual(["packages/dashboard/tests/component/Widget.test.tsx"]);
    const accounting = formatCommitAccounting(selection);
    expect(accounting).toContain("alias imports resolving to no file: 1");
    expect(accounting).toContain("packages/dashboard/tests/component/Ghost.test.tsx -> @/components/Ghost");
  });

  it("an external package whose name merely resembles nothing in `paths` is not an unresolved alias", () => {
    const { root, commits } = buildRepo([DASHBOARD_TREE]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/dashboard/src/components/Widget.tsx"] });
    expect(selection.unresolvedAliases).toEqual([]);
  });

  it("selects an alias-reaching test that sits in a package whose tsconfig lacks the alias only when the rule applies to that package", () => {
    const tree: Tree = {
      ...DASHBOARD_TREE,
      "packages/other/tsconfig.json": '{ "extends": "../../tsconfig.base.json" }',
      "packages/other/src/x.ts": "export const x = 1;\n",
      "packages/other/tests/unit/alias.test.ts": 'import { Widget } from "@/components/Widget";\nit("x", () => Widget);\n',
    };
    const { root, commits } = buildRepo([tree]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/dashboard/src/components/Widget.tsx"] });
    // `@/*` belongs to the dashboard only; packages/other does not get it, so its test is not selected and is not "unresolved" either.
    expect(selection.selected.map((f) => f.path)).toEqual(["packages/dashboard/tests/component/Widget.test.tsx"]);
    expect(selection.unresolvedAliases).toEqual([]);
  });
});

describe("AC-SC-1 fixtures: the commit tree, never the working tree", () => {
  it("selects from the committed imports although the working tree differs (edit, new test, deleted source)", () => {
    const { root, commits } = buildRepo([DASHBOARD_TREE]);
    // working tree: the committed test no longer imports Widget, a brand-new test does, and Widget.tsx is gone
    writeFileSync(join(root, "packages/dashboard/tests/component/Widget.test.tsx"), "it('x', () => 1);\n");
    writeFileSync(join(root, "packages/dashboard/tests/component/Working.test.tsx"), TSX_TEST);
    rmSync(join(root, "packages/dashboard/src/components/Widget.tsx"));
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/dashboard/src/components/Widget.tsx"] });
    expect(selection.selected.map((f) => f.path)).toEqual(["packages/dashboard/tests/component/Widget.test.tsx"]);
    expect(selection.unknownPaths).toEqual([]);
  });

  it("selects at an older commit from that commit's files even when HEAD has moved on", () => {
    const later: Tree = { ...DASHBOARD_TREE, "packages/dashboard/tests/component/Later.test.tsx": TSX_TEST };
    const { root, commits } = buildRepo([DASHBOARD_TREE, later]);
    const atFirst = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/dashboard/src/components/Widget.tsx"] });
    const atSecond = selectForCommit({ repoRoot: root, commit: commits[1]!, changedPaths: ["packages/dashboard/src/components/Widget.tsx"] });
    expect(atFirst.selected).toHaveLength(1);
    expect(atSecond.selected).toHaveLength(2);
    expect(atFirst.commit).toBe(commits[0]);
  });
});

describe("AC-SC-1 fixtures: paths a landing deleted are read through its parent", () => {
  const PARENT: Tree = {
    ...DASHBOARD_TREE,
    "packages/dashboard/src/components/Gone.tsx": "export const Gone = 1;\n",
    "packages/dashboard/tests/component/UsesGone.test.tsx": 'import { Gone } from "@/components/Gone";\nit("x", () => Gone);\n',
    "packages/dashboard/tests/component/Removed.test.tsx": 'import { Gone } from "@/components/Gone";\nit("y", () => Gone);\n',
  };
  const LANDED: Tree = {
    ...DASHBOARD_TREE,
    // UsesGone.test.tsx survives the landing (it no longer imports Gone); Removed.test.tsx was deleted by it
    "packages/dashboard/tests/component/UsesGone.test.tsx": "it('x', () => 1);\n",
  };

  it("selects the surviving test that imported a deleted source at the parent, and names a deleted test as removed, not run", () => {
    const { root, commits } = buildRepo([PARENT, LANDED]);
    const selection = selectForCommit({
      repoRoot: root,
      commit: commits[1]!,
      changedPaths: [
        "packages/dashboard/src/components/Gone.tsx",
        "packages/dashboard/tests/component/UsesGone.test.tsx",
        "packages/dashboard/tests/component/Removed.test.tsx",
      ],
      landingParents: [commits[0]!],
    });
    expect(selection.selected.map((f) => f.path)).toEqual(["packages/dashboard/tests/component/UsesGone.test.tsx"]);
    expect(selection.removedTests.map((f) => f.path)).toEqual(["packages/dashboard/tests/component/Removed.test.tsx"]);
    expect(selection.unknownPaths).toEqual([]);
    expect(formatCommitAccounting(selection)).toContain("packages/dashboard/tests/component/Removed.test.tsx (changed-test)");
  });

  it("a deleted source selects the still-present test that imported it at the parent (not nothing)", () => {
    const parent: Tree = { ...PARENT };
    const landed: Tree = { ...PARENT };
    delete (landed as Record<string, string>)["packages/dashboard/src/components/Gone.tsx"];
    const { root, commits } = buildRepo([parent, landed]);
    const selection = selectForCommit({
      repoRoot: root,
      commit: commits[1]!,
      changedPaths: ["packages/dashboard/src/components/Gone.tsx"],
      landingParents: [commits[0]!],
    });
    expect(selection.selected.map((f) => f.path)).toEqual([
      "packages/dashboard/tests/component/Removed.test.tsx",
      "packages/dashboard/tests/component/UsesGone.test.tsx",
    ]);
    expect(selection.removedTests).toEqual([]);
  });

  it("without the landing's parent, a deleted path is named unknown instead of silently dropped", () => {
    const { root, commits } = buildRepo([PARENT, LANDED]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[1]!, changedPaths: ["packages/dashboard/src/components/Gone.tsx"] });
    expect(selection.selected).toEqual([]);
    expect(selection.unknownPaths).toEqual(["packages/dashboard/src/components/Gone.tsx"]);
    expect(formatCommitAccounting(selection)).toContain("changed paths in no tree: 1");
  });

  it("a path in neither the commit nor any parent stays unknown even when parents are given", () => {
    const { root, commits } = buildRepo([PARENT, LANDED]);
    const selection = selectForCommit({
      repoRoot: root,
      commit: commits[1]!,
      changedPaths: ["packages/dashboard/src/never-existed.ts"],
      landingParents: [commits[0]!],
    });
    expect(selection.unknownPaths).toEqual(["packages/dashboard/src/never-existed.ts"]);
  });
});

describe("AC-SC-1 fixtures: declarations and accounting", () => {
  it("names a test whose declaration block is malformed instead of throwing, and still selects the others", () => {
    const tree: Tree = {
      ...DASHBOARD_TREE,
      "packages/dashboard/tests/unit/bad.test.ts": "// @reads /absolute/path\nit('x', () => 1);\n",
    };
    const { root, commits } = buildRepo([tree]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["packages/dashboard/src/components/Widget.tsx"] });
    expect(selection.unparseable.map((f) => f.path)).toEqual(["packages/dashboard/tests/unit/bad.test.ts"]);
    expect(selection.selected.map((f) => f.path)).toEqual(["packages/dashboard/tests/component/Widget.test.tsx"]);
    expect(formatCommitAccounting(selection)).toContain("unparseable test files: 1");
  });

  it("selects a test through @reads at the commit and flags build-first for @spawns dist/lore", () => {
    const tree: Tree = {
      ...DASHBOARD_TREE,
      "assets/note.md": "x\n",
      "packages/lore/tests/unit/reads.test.ts": "// @reads assets/**\nit('r', () => 1);\n",
      "packages/lore/tests/unit/spawns.test.ts": "// @spawns dist/lore\nit('s', () => 1);\n",
      "packages/lore/src/index.ts": "export const main = 1;\n",
    };
    const { root, commits } = buildRepo([tree]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["assets/note.md", "packages/lore/src/index.ts"] });
    expect(selection.selected.map((f) => [f.path, f.reason, f.needsCompiledBinary === true])).toEqual([
      ["packages/lore/tests/unit/reads.test.ts", "declared-read", false],
      ["packages/lore/tests/unit/spawns.test.ts", "declared-spawn", true],
    ]);
    expect(formatCommitAccounting(selection)).toContain("build-first: yes");
  });

  it("an empty selection is stated as zero, not as a failure line", () => {
    const { root, commits } = buildRepo([DASHBOARD_TREE]);
    const selection = selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["docs/readme.md"] });
    expect(selection.unknownPaths).toEqual(["docs/readme.md"]);
    const accounting = formatCommitAccounting(selection);
    expect(accounting).toContain("selected total: 0");
    expect(accounting).not.toContain("FAIL:");
  });
});

describe("AC-SC-1 CLI: --at <commit> --paths-from <file>", () => {
  it("prints the commit accounting for the paths in the file", () => {
    const { root, commits } = buildRepo([DASHBOARD_TREE]);
    const pathsFile = join(root, ".git", "paths.txt");
    writeFileSync(pathsFile, "packages/dashboard/src/components/Widget.tsx\n\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(runCommitCli(["--at", commits[0]!, "--paths-from", pathsFile], root)).toBe(0);
      const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(printed).toContain("[vitest] packages/dashboard/tests/component/Widget.test.tsx (transitive)");
      expect(printed).toContain(`commit: ${commits[0]}`);
    } finally {
      log.mockRestore();
    }
  });

  it("refuses a missing --paths-from and an unknown flag", () => {
    expect(() => runCommitCli(["--at", "HEAD"], REPO_ROOT)).toThrow(ChangedTestsError);
    expect(() => runCommitCli(["--at", "HEAD", "--paths-from", "x", "--bogus", "y"], REPO_ROOT)).toThrow(/unknown or misplaced/);
  });
});

describe("AC-SC-1 internals: tsconfig reading and lost git answers", () => {
  it("strips comments and trailing commas but leaves `//` and `/*` inside strings alone", () => {
    const parsed = JSON.parse(stripJsonComments('{ "a": "http://x/*y*/", /* c */ "b": [1, 2,], // tail\n }')) as unknown;
    expect(parsed).toEqual({ a: "http://x/*y*/", b: [1, 2] });
  });

  it("resolves paths against baseUrl, a child's paths replace the base's, and a package scope wins over the root", () => {
    const rules = buildAliasRulesFromConfigs(
      new Map([
        ["tsconfig.base.json", BASE_TSCONFIG],
        ["tsconfig.json", '{ "extends": "./tsconfig.base.json" }'],
        ["packages/dashboard/tsconfig.json", DASHBOARD_TSCONFIG],
        ["packages/dashboard/tsconfig.tests.json", '{ "extends": "./tsconfig.json" }'],
      ]),
    );
    expect(rules).toContainEqual({ scope: "", pattern: "@lore/core", targets: ["packages/core/src/index.ts"] });
    expect(rules).toContainEqual({ scope: "packages/dashboard", pattern: "@/*", targets: ["packages/dashboard/src/*"] });
    expect(rules).toContainEqual({ scope: "packages/dashboard", pattern: "@lore/core", targets: ["packages/core/src/index.ts"] });
    expect(rules.filter((r) => r.scope === "packages/dashboard")).toHaveLength(2);
  });

  it("fails loud on an unreadable extends target and on an invalid tsconfig", () => {
    expect(() => buildAliasRulesFromConfigs(new Map([["tsconfig.json", '{ "extends": "./missing.json" }']]))).toThrow(ChangedTestsError);
    expect(() => buildAliasRulesFromConfigs(new Map([["tsconfig.json", "{ not json"]]))).toThrow(/not valid JSONC/);
    expect(() => buildAliasRulesFromConfigs(new Map([["tsconfig.json", '{ "extends": "@tsconfig/node20" }']]))).toThrow(/only relative extends/);
  });

  it("a git answer that is empty, short or mismatched throws instead of selecting from nothing", () => {
    const { root, commits } = buildRepo([DASHBOARD_TREE]);
    const real = (args: readonly string[], input?: Buffer) => spawnSync("git", [...args], { cwd: root, input, maxBuffer: 1 << 28 });
    const lostListing: GitBytesSpawn = (args, _cwd, input) => (args[0] === "ls-tree" ? { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } : real(args, input));
    expect(() => selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["a.ts"], spawn: lostListing })).toThrow(/listed no files/);
    const shortBatch: GitBytesSpawn = (args, _cwd, input) =>
      args[0] === "cat-file" ? { status: 0, stdout: Buffer.from("deadbeef blob 3\nabc\n"), stderr: Buffer.alloc(0) } : real(args, input);
    expect(() => selectForCommit({ repoRoot: root, commit: commits[0]!, changedPaths: ["a.ts"], spawn: shortBatch })).toThrow(ChangedTestsError);
    expect(() => selectForCommit({ repoRoot: root, commit: "no-such-rev", changedPaths: [] })).toThrow(ChangedTestsError);
  });
});
