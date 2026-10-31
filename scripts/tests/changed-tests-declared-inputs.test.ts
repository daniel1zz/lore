// @spawns scripts/changed-tests.ts -- the CLI fixtures below run the real selector as a child process
// @reads scripts/test-read-aliases.ts
// @reads scripts/test-recorded-fs.ts
// @reads scripts/test-recorded-fs-promises.ts
// @reads scripts/test-recorded-child-process.ts
/**
 * AC-TG-7 oracle (task-skill-implement-tg-13, spec-test-governance-guards-that-refuse-bad-tests-declared,
 * baseline rule AS-24): declared test inputs drive the change selector, and the run-time check refuses
 * a test that reads or spawns a repository file it did not declare.
 *
 * Coverage: HAPPY (declared read / glob / spawn selects), NEGATIVE (a test that declares nothing is
 * not selected for a file it merely reads; a closure-external change does not select a binary spawner),
 * BOUNDARY (glob covers a directory entry; `**` depth), ERROR (undeclared read and undeclared spawn fail
 * the run naming test and path; a malformed declaration is refused), STATE (reason precedence, build-first),
 * REGRESSION (no `tree-scan-oracle` / `binary-consumer` reason exists).
 * Fixtures: pure `selectAffectedTests` over an injected file map; the real CLI over a throwaway git
 * repository; the real recorder over a throwaway vitest project (its own checkout root via
 * LORE_TEST_READS_ROOT).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatAccounting,
  SELECTION_REASONS,
  selectAffectedTests,
  type FileMap,
} from "../changed-tests";
import { globToRegExp, matchesAnyPattern, parseDeclaredInputs } from "../test-declared-inputs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHANGED_TESTS_SCRIPT = join(REPO_ROOT, "scripts", "changed-tests.ts");
const ALIASES = join(REPO_ROOT, "scripts", "test-read-aliases.ts");
const RECORDER = join(REPO_ROOT, "scripts", "test-read-recorder.ts");
const ALIAS_MAP = { "@lore/core": "packages/core/src/index.ts", "@lore/core/node": "packages/core/src/node.ts" };

function fileMapOf(entries: Record<string, string>): FileMap {
  return new Map(Object.entries(entries));
}

function select(changedFiles: string[], entries: Record<string, string>) {
  return selectAffectedTests({ changedFiles, fileMap: fileMapOf(entries), aliasMap: ALIAS_MAP });
}

function reasonsOf(changedFiles: string[], entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(select(changedFiles, entries).selected.map((f) => [f.path, f.reason]));
}

const FIXTURE_TREE: Record<string, string> = {
  "packages/lore/src/lib.ts": "export const V = 1;\n",
  "packages/lore/src/index.ts": 'export async function main() { return import("./cmd.js"); }\n',
  "packages/lore/src/cmd.ts": 'import { V } from "./lib.js";\nexport default V;\n',
  "packages/lore/src/unrelated.ts": "export const U = 1;\n",
  "scripts/build.ts": "export const BUILD = 1;\n",
  "scripts/tool.ts": 'import { V } from "../packages/lore/src/lib.js";\nexport const T = V;\n',
  "packages/lore/tests/reads-file.test.ts": '// @reads assets/data.json\nimport { it } from "vitest";\nit("x", () => {});\n',
  "packages/lore/tests/reads-glob.test.ts": '// @reads assets/**\nimport { it } from "vitest";\nit("x", () => {});\n',
  "packages/lore/tests/reads-docs.test.ts": '// @reads docs/**\nimport { it } from "vitest";\nit("x", () => {});\n',
  "packages/lore/tests/declares-nothing.test.ts": 'import { it } from "vitest";\nit("reads assets/data.json without saying so", () => {});\n',
  "packages/lore/tests/imports-lib.test.ts": 'import { V } from "../src/lib.js";\nimport { it } from "vitest";\nit("x", () => { void V; });\n',
  "packages/lore/tests/spawns-tool.test.ts": '// @spawns scripts/tool.ts\nimport { it } from "vitest";\nit("x", () => {});\n',
  "packages/lore/tests/spawns-binary.test.ts": '// @spawns dist/lore\nimport { it } from "vitest";\nit("x", () => {});\n',
};

describe("AC-TG-7: selection by declared inputs (pure selector, injected file map)", () => {
  it("AC-TG-7 HAPPY: a changed non-imported file selects exactly the tests that declare it or a glob covering it (plus the binary, which embeds assets/)", () => {
    expect(reasonsOf(["assets/data.json"], FIXTURE_TREE)).toEqual({
      "packages/lore/tests/reads-file.test.ts": "declared-read",
      "packages/lore/tests/reads-glob.test.ts": "declared-read",
      "packages/lore/tests/spawns-binary.test.ts": "declared-spawn",
    });
    expect(reasonsOf(["docs/guide.md"], FIXTURE_TREE)).toEqual({ "packages/lore/tests/reads-docs.test.ts": "declared-read" });
  });

  it("AC-TG-7 NEGATIVE: a test that declares nothing is not selected for a file it reads without declaring", () => {
    const selected = Object.keys(reasonsOf(["assets/data.json"], FIXTURE_TREE));
    expect(selected).not.toContain("packages/lore/tests/declares-nothing.test.ts");
  });

  it("AC-TG-7 NEGATIVE: a changed file outside every declared glob selects no declarer", () => {
    expect(select(["README.md"], FIXTURE_TREE).selected).toEqual([]);
  });

  it("AC-TG-7 HAPPY: a test declaring nothing is selected through its static import, with reason transitive", () => {
    expect(reasonsOf(["packages/lore/src/lib.ts"], FIXTURE_TREE)["packages/lore/tests/imports-lib.test.ts"]).toBe("transitive");
  });

  it("AC-TG-7 HAPPY: @spawns of a script selects the test on a change anywhere in the script's static import closure", () => {
    const reasons = reasonsOf(["packages/lore/src/lib.ts"], FIXTURE_TREE);
    expect(reasons["packages/lore/tests/spawns-tool.test.ts"]).toBe("declared-spawn");
    expect(Object.keys(reasonsOf(["scripts/build.ts"], FIXTURE_TREE))).not.toContain("packages/lore/tests/spawns-tool.test.ts");
  });

  it("AC-TG-7 HAPPY: @spawns dist/lore follows the entry's literal import() closure and requests a build first", () => {
    const selection = select(["packages/lore/src/cmd.ts"], FIXTURE_TREE);
    const binary = selection.selected.find((f) => f.path === "packages/lore/tests/spawns-binary.test.ts");
    expect(binary).toMatchObject({ reason: "declared-spawn", needsCompiledBinary: true });
    expect(formatAccounting(selection)).toContain("build-first: yes (1 selected test(s) declare @spawns dist/lore)");
  });

  it("AC-TG-7 NEGATIVE: a src file outside the binary's closure no longer selects binary spawners (narrowing of the old any-change rule)", () => {
    const selection = select(["packages/lore/src/unrelated.ts"], FIXTURE_TREE);
    expect(selection.selected.map((f) => f.path)).not.toContain("packages/lore/tests/spawns-binary.test.ts");
    expect(formatAccounting(selection)).toContain("build-first: no");
  });

  it("AC-TG-7 STATE: a changed test keeps reason changed-test even when it also declares the changed file's glob", () => {
    expect(reasonsOf(["packages/lore/tests/reads-glob.test.ts", "assets/data.json"], FIXTURE_TREE)["packages/lore/tests/reads-glob.test.ts"]).toBe(
      "changed-test",
    );
  });

  it("AC-TG-7 REGRESSION: no tree-scan-oracle (or binary-consumer) selection reason exists, and no selection ever carries one", () => {
    expect([...SELECTION_REASONS].sort()).toEqual(["changed-test", "declared-read", "declared-spawn", "run-config", "transitive"]);
    const everything = select(
      ["assets/data.json", "packages/lore/src/lib.ts", "packages/lore/src/cmd.ts", "docs/a.md", "hooks/pre-push"],
      FIXTURE_TREE,
    );
    for (const f of everything.selected) expect(SELECTION_REASONS).toContain(f.reason);
  });

  it("AC-TG-7 REGRESSION: a former content marker (bare main(), hooks/pre-push, INDEX_TS, dist/lore) in a test body selects nothing by itself", () => {
    const tree = {
      "packages/lore/tests/old-style.test.ts": 'const INDEX_TS = "x"; main(); // hooks/pre-push dist/lore\n',
      "packages/lore/src/lib.ts": "export const V = 1;\n",
    };
    expect(select(["packages/lore/src/lib.ts", "hooks/pre-push", "docs/a.md"], tree).selected).toEqual([]);
  });

  it("AC-TG-7 ERROR: a malformed declaration (absolute path, parent segment) is refused naming the file", () => {
    expect(() => select(["x.md"], { "packages/lore/tests/bad.test.ts": "// @reads /etc/passwd\n" })).toThrow(/bad\.test\.ts.*repo-relative/);
    expect(() => select(["x.md"], { "packages/lore/tests/bad2.test.ts": "// @reads ../outside/**\n" })).toThrow(/bad2\.test\.ts.*\.\./);
  });
});

describe("AC-TG-7: declaration parser and glob matcher", () => {
  it("AC-TG-7 HAPPY: reads and spawns lines are parsed from the leading comment block, trailing reason text ignored", () => {
    const parsed = parseDeclaredInputs("// @reads a/**/*.json -- why\n/**\n * @spawns dist/lore\n */\nimport x from 'y';\n// @reads not/counted\n");
    expect(parsed).toEqual({ reads: ["a/**/*.json"], spawns: ["dist/lore"] });
  });

  it("AC-TG-7 BOUNDARY: a declaration inside a template string further down the file is not a declaration of that file", () => {
    expect(parseDeclaredInputs('import x from "y";\nconst fixture = `\n// @reads docs/**\n`;\n')).toEqual({ reads: [], spawns: [] });
  });

  it("AC-TG-7 BOUNDARY: `dir/**` covers the directory itself, any depth below it, and nothing outside", () => {
    expect(globToRegExp("assets/**").test("assets")).toBe(true);
    expect(globToRegExp("assets/**").test("assets/a/b/c.txt")).toBe(true);
    expect(globToRegExp("assets/**").test("assets2/x")).toBe(false);
    expect(matchesAnyPattern("scripts/a.mjs", ["scripts/*.mjs"])).toBe(true);
    expect(matchesAnyPattern("scripts/sub/a.mjs", ["scripts/*.mjs"])).toBe(false);
    expect(matchesAnyPattern("x/y/z.json", ["**/z.json"])).toBe(true);
  });
});

describe("AC-TG-7: test:changed CLI in a fixture git repository", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function buildRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "changed-tests-declared-"));
    dirs.push(dir);
    const files: Record<string, string> = {
      "packages/core/package.json": JSON.stringify({ name: "@lore/core", exports: { ".": "./src/index.ts", "./node": "./src/node.ts" } }),
      "assets/data.json": "{}\n",
      "notes/undeclared.md": "# n\n",
      ...FIXTURE_TREE,
    };
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content, "utf8");
    }
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync("git", ["-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-q", "-m", "base"], { cwd: dir });
    return dir;
  }

  function list(dir: string): { stdout: string; status: number } {
    const result = spawnSync("bun", ["run", CHANGED_TESTS_SCRIPT, "--list", "HEAD"], { cwd: dir, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return { stdout: result.stdout ?? "", status: result.status ?? 1 };
  }

  it("AC-TG-7 HAPPY: editing a non-imported file lists exactly its declarers, tagged declared-read, and never tree-scan-oracle", () => {
    const dir = buildRepo();
    writeFileSync(join(dir, "assets", "data.json"), '{"changed":true}\n', "utf8");
    const { stdout, status } = list(dir);
    expect(status).toBe(0);
    expect(stdout).toContain("[vitest] packages/lore/tests/reads-file.test.ts (declared-read)");
    expect(stdout).toContain("[vitest] packages/lore/tests/reads-glob.test.ts (declared-read)");
    expect(stdout).toContain("vitest: selected 3");
    expect(stdout).toContain("[vitest] packages/lore/tests/spawns-binary.test.ts (declared-spawn)");
    expect(stdout).not.toContain("declares-nothing");
    expect(stdout).not.toContain("tree-scan-oracle");
  });

  it("AC-TG-7 HAPPY: a change inside the binary's closure selects the binary spawner and announces build-first", () => {
    const dir = buildRepo();
    writeFileSync(join(dir, "packages", "lore", "src", "cmd.ts"), "export default 2;\n", "utf8");
    const { stdout } = list(dir);
    expect(stdout).toContain("(declared-spawn)");
    expect(stdout).toContain("build-first: yes (1 selected test(s) declare @spawns dist/lore)");
  });

  it("AC-TG-7 ERROR: a change touching only files nobody declares exits non-zero (loud zero), it does not select by guesswork", () => {
    const dir = buildRepo();
    writeFileSync(join(dir, "notes", "undeclared.md"), "# changed\n", "utf8");
    const { stdout, status } = list(dir);
    expect(stdout).toContain("vitest: selected 0");
    expect(status).toBe(1);
  });
});

describe("AC-TG-7: run-time check fails an undeclared read or spawn naming the test and the path", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A throwaway vitest project that uses the REAL recorder (aliases + setup file) with its own repository root. */
  function runProject(testSource: string, extraFiles: Record<string, string> = {}, trackedPaths: readonly string[] = []): { status: number; output: string } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "declared-inputs-run-")));
    dirs.push(dir);
    const vitestPackageJson = createRequire(import.meta.url).resolve("vitest/package.json");
    symlinkSync(dirname(dirname(vitestPackageJson)), join(dir, "node_modules"), "dir");
    const files: Record<string, string> = {
      "vitest.config.ts": [
        `import { readRecorderAliases } from ${JSON.stringify(ALIASES)};`,
        `export default { resolve: { alias: readRecorderAliases(${JSON.stringify(REPO_ROOT)}) }, test: { include: ["probe.test.ts"], setupFiles: [${JSON.stringify(RECORDER)}] } };`,
        "",
      ].join("\n"),
      "data/input.txt": "hello\n",
      "tools/child.js": "console.log('child ran');\n",
      "tools/helper.js": "require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'data', 'input.txt'), 'utf8');\n",
      "probe.test.ts": testSource,
      ...extraFiles,
    };
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content, "utf8");
    }
    // reason: the recorder asks git which undeclared reads are ignored (task-skill-fix-tg-34), so the fixture is a repository.
    expect(spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
    if (trackedPaths.length > 0) {
      expect(spawnSync("git", ["add", "-f", ...trackedPaths], { cwd: dir, encoding: "utf8" }).status).toBe(0);
    }
    const result = spawnSync("bun", ["--bun", join(dir, "node_modules", "vitest", "vitest.mjs"), "run"], {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LORE_TEST_READS_ROOT: dir, LORE_TEST_READS_REPORT: "" },
    });
    return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }

  const READ_BODY = [
    'import { readFileSync } from "node:fs";',
    'import { it } from "vitest";',
    'it("reads the data file", () => { readFileSync("data/input.txt", "utf8"); });',
    "",
  ].join("\n");

  it("AC-TG-7 ERROR: reading a repository file without declaring it fails the run, naming the test and the path", () => {
    const { status, output } = runProject(READ_BODY);
    expect(status).not.toBe(0);
    expect(output).toContain('test "reads the data file"');
    expect(output).toContain("@reads data/input.txt");
  });

  it("AC-TG-7 HAPPY: the same read passes when declared exactly, and when a glob covers it", () => {
    expect(runProject(`// @reads data/input.txt\n${READ_BODY}`).status).toBe(0);
    expect(runProject(`// @reads data/**\n${READ_BODY}`).status).toBe(0);
  });

  it("AC-TG-7 ERROR: the check also sees fs/promises and fs.promises reads, and a read made at module load", () => {
    const promises = runProject(
      ['import { readFile } from "node:fs/promises";', 'import { it } from "vitest";', 'it("async read", async () => { await readFile("data/input.txt", "utf8"); });', ""].join("\n"),
    );
    expect(promises.status).not.toBe(0);
    expect(promises.output).toContain("@reads data/input.txt");
    const atLoad = runProject(
      ['import { readFileSync } from "node:fs";', 'import { it } from "vitest";', 'const loaded = readFileSync("data/input.txt", "utf8");', 'it("uses it", () => { void loaded; });', ""].join("\n"),
    );
    expect(atLoad.status).not.toBe(0);
    expect(atLoad.output).toContain("<module load>");
    expect(atLoad.output).toContain("@reads data/input.txt");
  });

  it("AC-TG-7 ERROR (child process, in-process mechanism): starting a repository script without @spawns fails the run naming the script", () => {
    const body = [
      'import { spawnSync } from "node:child_process";',
      'import { it } from "vitest";',
      'it("starts the child", () => { spawnSync(process.execPath, ["tools/child.js"]); });',
      "",
    ].join("\n");
    const undeclared = runProject(body);
    expect(undeclared.status).not.toBe(0);
    expect(undeclared.output).toContain('test "starts the child"');
    expect(undeclared.output).toContain("@spawns tools/child.js");
    expect(runProject(`// @spawns tools/child.js\n${body}`).status).toBe(0);
  });

  it("AC-TG-7 STATE (documented limit, not coverage): a file read by the CHILD itself is not seen; only the spawn is checked", () => {
    const body = [
      'import { spawnSync } from "node:child_process";',
      'import { it } from "vitest";',
      'it("child reads data", () => { spawnSync(process.execPath, ["tools/helper.js"]); });',
      "",
    ].join("\n");
    // helper.js reads data/input.txt; declaring only the spawn passes, which is exactly the stated limitation:
    // the author must add `// @reads data/input.txt` for what the child reads.
    expect(runProject(`// @spawns tools/helper.js\n${body}`).status).toBe(0);
  });

  it("AC-TG-7 BOUNDARY: reads outside the repository root (a temp directory) and of node_modules are not blamed on the test", () => {
    const body = [
      'import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      'import { it } from "vitest";',
      'it("temp only", () => { const d = mkdtempSync(join(tmpdir(), "x-")); writeFileSync(join(d, "f"), "1"); readFileSync(join(d, "f"), "utf8"); rmSync(d, { recursive: true }); });',
      "",
    ].join("\n");
    expect(runProject(body).status).toBe(0);
  });

  const READ_IGNORED_BODY = [
    'import { readFileSync } from "node:fs";',
    'import { it } from "vitest";',
    'it("reads the ignored file", () => { readFileSync("scratch/x.db", "utf8"); });',
    "",
  ].join("\n");

  it("AC-TG-7 (task-skill-fix-tg-34) HAPPY: a read of a git-ignored path (file under an ignored directory) is not an undeclared input", () => {
    const { status, output } = runProject(READ_IGNORED_BODY, { ".gitignore": "scratch/\n", "scratch/x.db": "1\n" });
    expect(output).not.toContain("@reads");
    expect(status).toBe(0);
  });

  it("AC-TG-7 (task-skill-fix-tg-34) BOUNDARY: a directory holding only ignored files is ignored; one holding a visible file, and a missing path, are not", () => {
    const dirBody = [
      'import { readdirSync } from "node:fs";',
      'import { it } from "vitest";',
      'it("lists the dir", () => { readdirSync("scratch"); });',
      "",
    ].join("\n");
    expect(runProject(dirBody, { ".gitignore": "*.db\n", "scratch/x.db": "1\n" }).status).toBe(0);
    const visible = runProject(dirBody, { ".gitignore": "*.db\n", "scratch/x.db": "1\n", "scratch/y.txt": "2\n" });
    expect(visible.status).not.toBe(0);
    expect(visible.output).toContain("@reads scratch");
    const missing = runProject(READ_IGNORED_BODY.replaceAll("readFileSync", "existsSync"));
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("@reads scratch/x.db");
  });

  it("AC-TG-7 (task-skill-fix-tg-34) ERROR: a tracked file still fails even when a .gitignore pattern matches it, and an untracked non-ignored one fails too", () => {
    const tracked = runProject(READ_IGNORED_BODY, { ".gitignore": "scratch/\n", "scratch/x.db": "1\n" }, ["scratch/x.db"]);
    expect(tracked.status).not.toBe(0);
    expect(tracked.output).toContain("@reads scratch/x.db");
    const untracked = runProject(READ_IGNORED_BODY, { "scratch/x.db": "1\n" });
    expect(untracked.status).not.toBe(0);
    expect(untracked.output).toContain("@reads scratch/x.db");
  });
});
