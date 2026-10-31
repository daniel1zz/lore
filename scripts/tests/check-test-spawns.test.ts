// @spawns scripts/check-test-spawns.ts -- the CLI cases run the real check over fixture projects and over this repository
// @spawns scripts/run-chain.ts -- the chain membership is asserted from `run-chain.ts --floor --list` / `--plan-close --list`
// @spawns-external git builds the throwaway repository the :changed cases diff
/**
 * AC-SC-2 oracle (task-s2-check-test-spawns-refuses-an-undeclared-spawn-at, standards AS-24 / AS-17):
 * `check:test-spawns` refuses a test file that spawns a process, directly or through its static imports,
 * without an `@spawns` / `@spawns-external` declaration.
 *
 * Coverage: HAPPY (declared spawns pass; a repository with no spawn passes), NEGATIVE (each spawn API, a helper, a
 * two-level helper chain, a spawning module under scripts/, `lore` from PATH without `@spawns dist/lore`, each exits
 * exactly 1 naming file + call site), BOUNDARY (comment / string / regex mentions and a production-source spawn are not
 * spawns; a declaration below the first code line does not count), ERROR (a malformed `@spawns-external`; no test
 * file at all exits 2), STATE (`:changed` selects changed tests plus tests whose closure holds a changed non-production
 * module), REGRESSION (floor and plan-close chain membership; this repository is clean).
 * False greens guarded: a self-only scan misses the helper case; a one-level scan misses the two-level chain; a check
 * missing from the floor list fails the membership case.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { findSpawnViolations, formatViolation, parseSpawnDeclarations, scanSpawnSites, selectChangedTests, SpawnCheckError } from "../check-test-spawns";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = join(REPO_ROOT, "scripts", "check-test-spawns.ts");
const RUN_CHAIN = join(REPO_ROOT, "scripts", "run-chain.ts");
const TEST_PATH = "packages/demo/tests/unit/subject.test.ts";
const HELPER_A = "packages/demo/tests/helpers/helper-a.ts";
const HELPER_B = "packages/demo/tests/helpers/helper-b.ts";

const SPAWN_SYNC_SOURCE = 'import { spawnSync } from "node:child_process";\nexport const run = () => spawnSync("echo", ["hi"]);\n';
const TEST_BODY = 'import { it } from "vitest";\nit("x", () => {});\n';

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "check-test-spawns-"));
  cleanups.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function runCheck(root: string, extraArgs: string[] = [], cwd: string = REPO_ROOT): { status: number | null; output: string } {
  const r = spawnSync("bun", [CHECK, "--root", root, ...extraArgs], { cwd, encoding: "utf8" });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

function violationsOf(files: Record<string, string>): ReturnType<typeof findSpawnViolations> {
  return findSpawnViolations(new Map(Object.entries(files)));
}

describe("a test that spawns in its own source", () => {
  const cases: Array<[string, string, string]> = [
    ["spawnSync", SPAWN_SYNC_SOURCE, "spawnSync"],
    ["spawn", 'import { spawn } from "node:child_process";\nspawn("echo");\n', "spawn"],
    ["exec", 'import { exec } from "child_process";\nexec("echo hi");\n', "exec"],
    ["execSync", 'import { execSync } from "node:child_process";\nexecSync("echo hi");\n', "execSync"],
    ["execFile", 'import { execFile } from "node:child_process";\nexecFile("echo", []);\n', "execFile"],
    ["execFileSync", 'import { execFileSync } from "node:child_process";\nexecFileSync("echo");\n', "execFileSync"],
    ["fork", 'import { fork } from "node:child_process";\nfork("./child.js");\n', "fork"],
    ["aliased import", 'import { spawnSync as run } from "node:child_process";\nrun("echo");\n', "spawnSync"],
    ["namespace import", 'import * as cp from "node:child_process";\ncp.execSync("echo");\n', "execSync"],
    ["default import", 'import cp from "node:child_process";\ncp.spawnSync("echo");\n', "spawnSync"],
    ["require destructure", 'const { execFileSync } = require("node:child_process");\nexecFileSync("echo");\n', "execFileSync"],
    ["require member", 'require("child_process").execSync("echo");\n', "execSync"],
    ["dynamic import", 'const { spawnSync } = await import("node:child_process");\nspawnSync("echo");\n', "spawnSync"],
    ["Bun.spawn", 'Bun.spawn(["echo", "hi"]);\n', "Bun.spawn"],
    ["Bun.spawnSync", 'Bun.spawnSync(["echo", "hi"]);\n', "Bun.spawnSync"],
    ["Bun.$", "await Bun.$`echo hi`;\n", "Bun.$"],
    ["$ from bun", 'import { $ } from "bun";\nawait $`echo hi`;\n', "Bun.$"],
    ["execa", 'import { execa } from "execa";\nawait execa("echo", ["hi"]);\n', "execa"],
  ];
  it.each(cases)("%s is refused without a declaration", (_label, source, api) => {
    const violations = violationsOf({ [TEST_PATH]: `${TEST_BODY}${source}` });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ testFile: TEST_PATH, missing: "any-declaration", site: { file: TEST_PATH, api } });
    expect(formatViolation(violations[0]!)).toContain(`${TEST_PATH}: undeclared spawn at ${TEST_PATH}:`);
  });

  it("CLI: exits exactly 1 and names the file and the call site", () => {
    const root = writeProject({ [TEST_PATH]: `${TEST_BODY}${SPAWN_SYNC_SOURCE}` });
    const r = runCheck(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain(`${TEST_PATH}: undeclared spawn at ${TEST_PATH}:4 (spawnSync)`);
  });

  it("CLI: the same file passes with `@spawns <repo path>` or with `@spawns-external <program> <reason>`", () => {
    for (const header of ["// @spawns packages/lore/src/index.ts\n", "// @spawns-external git builds a fixture repository\n", "/**\n * @spawns-external ps reads the process table\n */\n"]) {
      const root = writeProject({ [TEST_PATH]: `${header}${TEST_BODY}${SPAWN_SYNC_SOURCE}` });
      const r = runCheck(root);
      expect({ header, status: r.status, output: r.output }).toMatchObject({ header, status: 0 });
    }
  });
});

describe("a test that spawns through its imports", () => {
  it("a one-level helper is flagged, naming the helper's call site and the chain", () => {
    const root = writeProject({ [TEST_PATH]: `import { run } from "../helpers/helper-a";\n${TEST_BODY}`, [HELPER_A]: SPAWN_SYNC_SOURCE });
    const r = runCheck(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain(`${TEST_PATH}: undeclared spawn at ${HELPER_A}:2 (spawnSync)`);
    expect(r.output).toContain(`via ${TEST_PATH} -> ${HELPER_A}`);
  });

  it("a two-level helper chain (test -> A -> B, B spawns) is flagged", () => {
    const violations = violationsOf({
      [TEST_PATH]: `import { a } from "../helpers/helper-a";\n${TEST_BODY}`,
      [HELPER_A]: 'import { run } from "./helper-b";\nexport const a = run;\n',
      [HELPER_B]: SPAWN_SYNC_SOURCE,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ testFile: TEST_PATH, chain: [TEST_PATH, HELPER_A, HELPER_B], site: { file: HELPER_B } });
  });

  it("a spawning module under scripts/ is flagged", () => {
    const violations = violationsOf({
      [TEST_PATH]: `import { run } from "../../../../scripts/gate";\n${TEST_BODY}`,
      "scripts/gate.ts": SPAWN_SYNC_SOURCE,
    });
    expect(violations.map((v) => [v.testFile, v.site.file])).toEqual([[TEST_PATH, "scripts/gate.ts"]]);
  });

  it("the helper itself is not a test file: only the importing test is reported, and a declaration on the test clears it", () => {
    const files = { [TEST_PATH]: `// @spawns-external echo fixture\nimport { run } from "../helpers/helper-a";\n${TEST_BODY}`, [HELPER_A]: SPAWN_SYNC_SOURCE };
    expect(violationsOf(files)).toEqual([]);
    expect(violationsOf({ ...files, [TEST_PATH]: files[TEST_PATH]!.replace(/^\/\/.*\n/, "") }).map((v) => v.testFile)).toEqual([TEST_PATH]);
  });

  it("an import that cycles back does not loop", () => {
    const violations = violationsOf({
      [TEST_PATH]: `import "../helpers/helper-a";\n${TEST_BODY}`,
      [HELPER_A]: 'import "./helper-b";\n',
      [HELPER_B]: `import "./helper-a";\n${SPAWN_SYNC_SOURCE}`,
    });
    expect(violations).toHaveLength(1);
  });
});

describe("lore from PATH spawns dist/lore", () => {
  const loreSources = [
    'import { spawnSync } from "node:child_process";\nspawnSync("lore", ["list"]);\n',
    "await Bun.$`lore list`;\n",
    'Bun.spawnSync(["lore", "list"]);\n',
  ];
  it.each(loreSources)("needs `@spawns dist/lore`; another declaration is not enough (%#)", (source) => {
    const withExternal = violationsOf({ [TEST_PATH]: `// @spawns-external git unrelated\n${TEST_BODY}${source}` });
    expect(withExternal).toHaveLength(1);
    expect(withExternal[0]).toMatchObject({ missing: "dist-lore", site: { loreFromPath: true } });
    expect(formatViolation(withExternal[0]!)).toContain("@spawns dist/lore");
    expect(violationsOf({ [TEST_PATH]: `// @spawns dist/lore\n${TEST_BODY}${source}` })).toEqual([]);
  });

  it("a `lore` spawned through a helper is attributed to the helper's call site", () => {
    const violations = violationsOf({
      [TEST_PATH]: `// @spawns packages/lore/src/index.ts\nimport "../helpers/helper-a";\n${TEST_BODY}`,
      [HELPER_A]: 'import { spawnSync } from "node:child_process";\nspawnSync("lore", []);\n',
    });
    expect(violations).toMatchObject([{ missing: "dist-lore", site: { file: HELPER_A, line: 2 } }]);
  });

  it("a spawn of another program is not a lore spawn", () => {
    const sites = scanSpawnSites('import { spawnSync } from "node:child_process";\nspawnSync("git", ["lore"]);\nspawnSync("loreish");\n');
    expect(sites.map((s) => s.loreFromPath)).toEqual([false, false]);
  });
});

describe("what is not a spawn", () => {
  it("a comment, a string, a template fixture and a regex mention are ignored", () => {
    const source = [
      'import { spawnSync } from "node:child_process";',
      '// spawnSync("echo") is only mentioned here',
      '/* spawnSync("echo") */',
      'const fixture = `import { spawnSync } from "node:child_process"; spawnSync("echo");`;',
      "const text = 'spawnSync(\"echo\")';",
      "const found = /[\"']spawnSync\\(/.test(text);",
      "export const value = fixture.length + Number(found);",
    ].join("\n");
    expect(scanSpawnSites(source)).toEqual([]);
    expect(violationsOf({ [TEST_PATH]: `${TEST_BODY}${source}` })).toEqual([]);
  });

  it("RegExp.exec and a user-defined exec are not child_process exec without the import", () => {
    expect(scanSpawnSites("const m = /a/.exec('a');\nfunction exec() {}\nexec();\n")).toEqual([]);
  });

  it("a spawn in production source (packages/<pkg>/src) is outside the graph", () => {
    const root = writeProject({
      [TEST_PATH]: `import { run } from "../../src/spawner";\n${TEST_BODY}`,
      "packages/demo/src/spawner.ts": SPAWN_SYNC_SOURCE,
    });
    const r = runCheck(root);
    expect(r.status).toBe(0);
  });

  it("a declaration below the first code line is not a declaration", () => {
    const violations = violationsOf({ [TEST_PATH]: `${TEST_BODY}// @spawns-external git too late\n${SPAWN_SYNC_SOURCE}` });
    expect(violations).toHaveLength(1);
  });
});

describe("declaration parsing and fail-loud cases", () => {
  it("parseSpawnDeclarations reads @spawns and @spawns-external from the leading block only", () => {
    const parsed = parseSpawnDeclarations("// @spawns dist/lore\n// @spawns-external git builds fixtures, then reads them\nconst x = 1;\n// @spawns-external ps late\n");
    expect(parsed).toEqual({ spawns: ["dist/lore"], external: [{ program: "git", reason: "builds fixtures, then reads them" }] });
  });

  it("`@spawns-external` without a reason or a program is a violation, never a silent pass", () => {
    for (const header of ["// @spawns-external git\n", "// @spawns-external\n"]) {
      const violations = violationsOf({ [TEST_PATH]: `${header}${TEST_BODY}${SPAWN_SYNC_SOURCE}` });
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ missing: "malformed-declaration" });
    }
  });

  it("a project with no test file exits 2 instead of passing", () => {
    expect(() => findSpawnViolations(new Map([[HELPER_A, SPAWN_SYNC_SOURCE]]))).toThrow(SpawnCheckError);
    const root = writeProject({ [HELPER_A]: SPAWN_SYNC_SOURCE });
    expect(runCheck(root).status).toBe(2);
  });

  it("an unknown argument exits 2", () => {
    expect(runCheck(writeProject({ [TEST_PATH]: TEST_BODY }), ["--nope"]).status).toBe(2);
  });
});

describe(":changed form", () => {
  const files = {
    [TEST_PATH]: `import { a } from "../helpers/helper-a";\n${TEST_BODY}`,
    [HELPER_A]: 'import { run } from "./helper-b";\nexport const a = run;\n',
    [HELPER_B]: "export const run = () => 1;\n",
    "packages/demo/tests/unit/other.test.ts": TEST_BODY,
    "packages/demo/src/prod.ts": "export const p = 1;\n",
  };

  it("selects changed test files plus every test whose closure holds a changed non-production module", () => {
    const map = new Map(Object.entries(files));
    expect(selectChangedTests(map, [HELPER_B])).toEqual([TEST_PATH]);
    expect(selectChangedTests(map, ["packages/demo/tests/unit/other.test.ts"])).toEqual(["packages/demo/tests/unit/other.test.ts"]);
    expect(selectChangedTests(map, ["packages/demo/src/prod.ts", "README.md"])).toEqual([]);
  });

  function git(cwd: string, ...args: string[]): void {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  }

  function fixtureRepo(): string {
    const root = writeProject(files);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@example.com");
    git(root, "config", "user.name", "t");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "work");
    return root;
  }

  function commitAll(root: string): void {
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "work");
  }

  it("a changed helper deep in a test's closure makes that test checked; an unrelated violating test is not", () => {
    const root = fixtureRepo();
    // an old, unrelated violating test exists on main and is untouched by the branch
    writeFileSync(join(root, "packages/demo/tests/unit/old.test.ts"), `${TEST_BODY}${SPAWN_SYNC_SOURCE}`);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "old");
    git(root, "branch", "-f", "main", "HEAD");
    writeFileSync(join(root, HELPER_B), SPAWN_SYNC_SOURCE);
    commitAll(root);
    const r = runCheck(root, ["--changed"], root);
    expect(r.status).toBe(1);
    expect(r.output).toContain(`${TEST_PATH}: undeclared spawn at ${HELPER_B}:2`);
    expect(r.output).not.toContain("old.test.ts");
  });

  it("a changed test that spawns without a declaration is refused; a branch touching only production source passes", () => {
    const root = fixtureRepo();
    writeFileSync(join(root, "packages/demo/tests/unit/other.test.ts"), `${TEST_BODY}${SPAWN_SYNC_SOURCE}`);
    commitAll(root);
    expect(runCheck(root, ["--changed"], root).status).toBe(1);
    git(root, "checkout", "-q", "main");
    git(root, "checkout", "-q", "-b", "prod-only");
    writeFileSync(join(root, "packages/demo/src/prod.ts"), SPAWN_SYNC_SOURCE);
    commitAll(root);
    const r = runCheck(root, ["--changed"], root);
    expect(r.status).toBe(0);
    expect(r.output).toContain("nothing to check");
  });
});

describe("chain membership and this repository", () => {
  it("check:test-spawns:changed is a step of the integrate floor", () => {
    const r = spawnSync("bun", [RUN_CHAIN, "--floor", "--list"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")).toContain("test-spawns:changed");
  });

  it("check:test-spawns is a step of the plan-close chain, and the full check is not on the floor", () => {
    const planClose = spawnSync("bun", [RUN_CHAIN, "--plan-close", "--list"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(planClose.status).toBe(0);
    expect(planClose.stdout.split("\n")).toContain("check:test-spawns");
    const floor = spawnSync("bun", [RUN_CHAIN, "--floor", "--list"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(floor.stdout.split("\n")).not.toContain("check:test-spawns");
  });

  it("every test file in this repository that spawns declares it (exit 0)", () => {
    const r = spawnSync("bun", [CHECK], { cwd: REPO_ROOT, encoding: "utf8" });
    expect({ status: r.status, output: `${r.stdout}${r.stderr}`.slice(-1500) }).toMatchObject({ status: 0 });
  });
});
