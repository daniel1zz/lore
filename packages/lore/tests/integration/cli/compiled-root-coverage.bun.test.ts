// @spawns dist/lore
/**
 * The COMPILED `dist/lore` runs ROOT coverage (`lore baseline coverage <root>`): it lists the checkout's runnable
 * commands STATICALLY, so a command declared by no leaf makes the root incomplete (exit exactly 1, naming the
 * command and its `lore baseline map <leaf> --command "<cmd>"` fix).
 *
 * Before the fix the list came from dynamically IMPORTING the analysed checkout's registry and command modules; a
 * `bun build --compile` executable cannot resolve a checkout's bare imports, so the compiled binary exited 4 with
 * `site census: command-unresolved ... Cannot find package 'citty'`. Tests of the source CLI never saw it.
 *
 * The compiled binary (built from the current sources by the global setup, freshness asserted) runs against a throwaway mini checkout whose registry
 * imports the bare package `citty` (unresolvable from the fixture, exactly like a real checkout seen by the compiled
 * binary): the regression trigger. The repo's own `.lore/` is never touched.
 *
 * Dimensions: HAPPY (control: every command declared -> exit 0), NEGATIVE (undeclared command -> exit 1, named, with
 * its fix), REGRESSION (no output carries `command-unresolved` / `Cannot find package`), ERROR (a registry entry
 * that is not a static import -> loud, never a shorter list).
 *
 * @spec_ref spec-baseline-coverage-cannot-silently-regress-one-program#AC-BCR-4
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertFreshBinary } from "../helpers/assert-fresh-binary";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 600_000 });

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const SESSION_ID = "c0a7ed06-aaaa-bbbb-cccc-222222222222";
const CLI = "packages/lore/src/adapters/cli";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let scratch: string[] = [];

function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: SESSION_ID };
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): string {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function write(dir: string, rel: string, content: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

interface Fixture {
  readonly dir: string;
  readonly root: string;
  readonly leaf: string;
}

/** A mini lore checkout (registry importing bare `citty`) plus a one-leaf baseline tree declaring `alpha`. */
function buildFixture(registry: string): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bcr-compiled-")));
  scratch.push(dir);
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  write(dir, "package.json", JSON.stringify({ name: "bcr-compiled-fixture", private: true }));
  write(dir, `${CLI}/index.ts`, registry);
  write(dir, `${CLI}/lib/result.ts`, `export const err = (e: { code: string }) => ({ ok: false as const, code: e.code });\n`);
  write(
    dir,
    `${CLI}/commands/alpha.ts`,
    `import { err } from "../lib/result.js";\nexport default { run() { return err({ code: "ALPHA_BAD" }); } };\n`,
  );
  write(
    dir,
    `${CLI}/commands/gamma.ts`,
    `const add = { run() { return 0; } };\nexport default { subCommands: { add } };\n`,
  );
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "bcr@example.invalid"]);
  git(["config", "user.name", "bcr test"]);
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"], dir);
  const prd = slugOf(mustRun(["create", "prd", "--title", "BCR PRD", "--content", "root", "--no-ai"], dir));
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BCR Root"], dir));
  const branch = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "br", "--title", "BCR Branch"], dir));
  const leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "la", "--title", "BCR Leaf"], dir));
  const ruleOut = mustRun(["rule", "add", leaf, "--statement", "alpha refusal holds", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "e"], dir);
  const ruleId = (ruleOut.match(/BR-\d+/) ?? [])[0];
  if (ruleId === undefined) throw new Error(`no rule id in: ${ruleOut}`);
  mustRun(["baseline", "map", leaf, "--command", "alpha"], dir);
  // the rule is declared where alpha's refusal is written (BR-1344): the tree, never the corpus, says which rule a site enforces
  write(
    dir,
    `${CLI}/commands/alpha.ts`,
    `import { err } from "../lib/result.js";\nexport default { run() { return err({ code: "ALPHA_BAD", rule: "${ruleId}" }); } };\n`,
  );
  return { dir, root, leaf };
}

// The registry imports the bare package `citty` (unresolvable from the fixture, like any checkout seen by the compiled
// binary): importing this file at runtime fails, reading it statically does not.
const REGISTRY = `import "citty";
export const COMMAND_LOADERS = {
  alpha: () => import("./commands/alpha.js"),
  gamma: () => import("./commands/gamma.js"),
};
`;

beforeAll(() => {
  // reason: dist/lore is built once from the current sources by the test global setup (scripts/test-global-setup.ts);
  // a test never rewrites it. The guard fails loud if the artifact is absent or older than the sources.
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

describe("compiled dist/lore: root coverage lists runnable commands statically", () => {
  it("an undeclared runnable command -> exit exactly 1, names the command and its --command fix", () => {
    const fx = buildFixture(REGISTRY);
    const r = runLore(["baseline", "coverage", fx.root], fx.dir);
    expect(r.stdout + r.stderr).not.toContain("command-unresolved");
    expect(r.stdout + r.stderr).not.toContain("Cannot find package");
    expect(r.exitCode, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("undeclared   gamma add");
    expect(r.stdout).toContain('lore baseline map <leaf> --command "gamma add"');
    expect(r.stdout).not.toMatch(/undeclared\s+alpha\b/);
  });

  it("control: declaring the command on a leaf (hyphen spelling) -> exit 0", () => {
    const fx = buildFixture(REGISTRY);
    mustRun(["baseline", "map", fx.leaf, "--command", "gamma-add"], fx.dir);
    const r = runLore(["baseline", "coverage", fx.root], fx.dir);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain("undeclared");
  });

  it("a registry entry that is not a static import is a loud error, never a shorter list", () => {
    const fx = buildFixture(REGISTRY);
    write(fx.dir, `${CLI}/index.ts`, `import "citty";\nconst load = (n: string) => import(\`./commands/\${n}.js\`);\nexport const COMMAND_LOADERS = {\n  alpha: () => load("alpha"),\n  gamma: () => load("gamma"),\n};\n`);
    const r = runLore(["baseline", "coverage", fx.root], fx.dir);
    expect(r.exitCode).not.toBe(0);
    expect(r.exitCode).not.toBe(1);
    expect(r.stdout + r.stderr).toContain("command-unresolved");
    expect(r.stdout + r.stderr).toContain("loader does not statically import a command module");
  });
});
