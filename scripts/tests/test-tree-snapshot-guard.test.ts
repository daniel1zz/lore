// @reads scripts/tree-snapshot-guard.ts
// @reads scripts/test-isolation-ledger.json
// @reads scripts/test-global-setup.ts
// @spawns scripts/tree-snapshot-guard.ts
// @reads scripts/private-tree-run.ts
// @spawns scripts/private-tree-run.ts
/**
 * AC-TG-3 (spec-test-governance-guards-that-refuse-bad-tests-declared): a runner invocation whose tests
 * create or modify any file in the repository tree fails with exit code 1 and names each path, unless
 * scripts/test-isolation-ledger.json lists that path with a reason; a run that writes only under mkdtemp passes.
 * The end-to-end cases run a REAL vitest invocation over a fixture git repository whose globalSetup is the
 * guard, and read the exit code; the unit cases cover the snapshot/compare functions directly.
 * Coverage: HAPPY (mkdtemp-only run exits 0) / NEGATIVE (untracked create, tracked modify, tracked delete exit 1
 * naming each path) / BOUNDARY (gitignored write ignored; dirty-before file rewritten is caught; same bytes
 * rewritten is not a change) / ERROR (malformed or reason-less ledger, missing ledger) / STATE (ledger row
 * excuses exactly its path; stale row fails) / REGRESSION (the real ledger is valid; the real global setup wires the guard).
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nearestNodeModules } from "../private-tree-run";
import {
  IsolationLedgerError,
  TreeWrittenDuringRunError,
  assertRepoTreeUnchanged,
  readIsolationLedger,
  snapshotRepoTree,
} from "../tree-snapshot-guard";

const REPO = join(fileURLToPath(import.meta.url), "..", "..", "..");
const GUARD_MODULE = join(REPO, "scripts", "tree-snapshot-guard.ts");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

/** A throwaway git repo with one tracked file, one ignored dir, and a (possibly empty) ledger. */
function fixtureRepo(ledger: unknown = []): string {
  const root = mkdtempSync(join(tmpdir(), "tree-guard-fixture-"));
  made.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  // reason: node_modules is a symlink here (the fixture borrows this checkout's vitest), so the pattern has no trailing slash.
  writeFileSync(join(root, ".gitignore"), "ignored/\nnode_modules\n");
  symlinkSync(nearestNodeModules(REPO), join(root, "node_modules"));
  writeFileSync(join(root, "tracked.txt"), "one\n");
  writeFileSync(join(root, "ledger.json"), JSON.stringify(ledger));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

const ledgerPathOf = (root: string): string => join(root, "ledger.json");
function check(root: string, before: ReturnType<typeof snapshotRepoTree>): void {
  assertRepoTreeUnchanged(before, root, readIsolationLedger(ledgerPathOf(root)), ledgerPathOf(root));
}

describe("AC-TG-3 repo-tree snapshot guard (functions)", () => {
  it("AC-TG-3 HAPPY: an untouched tree passes, and writes under mkdtemp elsewhere do not count", () => {
    const root = fixtureRepo();
    const before = snapshotRepoTree(root);
    const elsewhere = mkdtempSync(join(tmpdir(), "tree-guard-elsewhere-"));
    made.push(elsewhere);
    writeFileSync(join(elsewhere, "x"), "x");
    expect(() => check(root, before)).not.toThrow();
  });

  it("AC-TG-3 NEGATIVE: a created untracked file is named", () => {
    const root = fixtureRepo();
    const before = snapshotRepoTree(root);
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "new.txt"), "n");
    expect(() => check(root, before)).toThrow(TreeWrittenDuringRunError);
    expect(() => check(root, before)).toThrow(/sub\/new\.txt/);
  });

  it("AC-TG-3 NEGATIVE: a modified tracked file and a deleted tracked file are both named", () => {
    const root = fixtureRepo();
    writeFileSync(join(root, "other.txt"), "o\n");
    git(root, "add", "other.txt");
    git(root, "commit", "-q", "-m", "other");
    const before = snapshotRepoTree(root);
    writeFileSync(join(root, "tracked.txt"), "changed\n");
    rmSync(join(root, "other.txt"));
    let message = "";
    try {
      check(root, before);
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    expect(message).toContain("tracked.txt");
    expect(message).toContain("other.txt");
  });

  it("AC-TG-3 BOUNDARY: a write under a gitignored directory is not a tree write", () => {
    const root = fixtureRepo();
    const before = snapshotRepoTree(root);
    mkdirSync(join(root, "ignored"));
    writeFileSync(join(root, "ignored", "build.out"), "b");
    expect(() => check(root, before)).not.toThrow();
  });

  it("AC-TG-3 BOUNDARY: a file already dirty before the run that is rewritten during it is caught; untouched dirty files pass", () => {
    const root = fixtureRepo();
    writeFileSync(join(root, "tracked.txt"), "dirty before\n");
    const before = snapshotRepoTree(root);
    expect(() => check(root, before)).not.toThrow();
    writeFileSync(join(root, "tracked.txt"), "dirty before AND rewritten\n");
    expect(() => check(root, before)).toThrow(/tracked\.txt/);
  });

  it("AC-TG-3 BOUNDARY: rewriting identical bytes is not a change, reverting a dirty file is", () => {
    const root = fixtureRepo();
    writeFileSync(join(root, "tracked.txt"), "dirty\n");
    const before = snapshotRepoTree(root);
    writeFileSync(join(root, "tracked.txt"), "dirty\n");
    expect(() => check(root, before)).not.toThrow();
    writeFileSync(join(root, "tracked.txt"), "one\n");
    expect(() => check(root, before)).toThrow(/tracked\.txt/);
  });

  it("AC-TG-3 STATE: a ledger row excuses exactly its own path", () => {
    const root = fixtureRepo([{ path: "tracked.txt", rule: "no-repo-writes", reason: "fixture writer", bound_ac: "AC-TG-3" }]);
    const before = snapshotRepoTree(root);
    writeFileSync(join(root, "tracked.txt"), "changed\n");
    expect(() => check(root, before)).not.toThrow();
    writeFileSync(join(root, "stray.txt"), "s");
    expect(() => check(root, before)).toThrow(/stray\.txt/);
    expect(() => check(root, before)).not.toThrow(/tracked\.txt/);
  });

  it("AC-TG-3 STATE: a ledger row whose path no longer exists is stale and fails", () => {
    const root = fixtureRepo([{ path: "gone.txt", rule: "no-repo-writes", reason: "was a writer once", bound_ac: "AC-TG-3" }]);
    const before = snapshotRepoTree(root);
    expect(() => check(root, before)).toThrow(IsolationLedgerError);
    expect(() => check(root, before)).toThrow(/gone\.txt/);
  });

  it("AC-TG-3 ERROR: a ledger row without a reason, malformed JSON and a missing ledger all fail loud", () => {
    const root = fixtureRepo([{ path: "tracked.txt", rule: "r", reason: "", bound_ac: "AC-TG-3" }]);
    expect(() => readIsolationLedger(ledgerPathOf(root))).toThrow(IsolationLedgerError);
    writeFileSync(ledgerPathOf(root), "{not json");
    expect(() => readIsolationLedger(ledgerPathOf(root))).toThrow(/not valid JSON/);
    expect(() => readIsolationLedger(join(root, "absent.json"))).toThrow(/does not exist/);
  });

  it("AC-TG-3 ERROR: snapshotting a directory that is not a git work tree fails loud", () => {
    const dir = mkdtempSync(join(tmpdir(), "tree-guard-nogit-"));
    made.push(dir);
    expect(() => snapshotRepoTree(dir)).toThrow(/git status failed/);
  });

  it("AC-TG-3 REGRESSION: the real ledger parses and every row carries a reason; the real global setup wires the guard", () => {
    const rows = readIsolationLedger(join(REPO, "scripts", "test-isolation-ledger.json"));
    for (const row of rows) expect(row.reason.length).toBeGreaterThan(0);
    expect(readFileSync(join(REPO, "scripts", "test-global-setup.ts"), "utf8")).toContain("assertRepoTreeUnchanged");
  });
});

/** How a fixture run is launched: straight from the real tree, or through the private-tree launcher (TG-46). */
type Launch = "direct" | "isolated";
const PRIVATE_TREE_CLI = join(REPO, "scripts", "private-tree-run.ts");

/**
 * Writes the fixture's harness (guard globalSetup, vitest config, test) and commits it. Every path inside the
 * harness is derived from the file's OWN location, so the same files work from the real fixture root and from
 * a private copy of it.
 */
function prepareFixture(root: string, testBody: string): void {
  writeFileSync(
    join(root, "guard-setup.ts"),
    `import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertRepoTreeUnchanged, readIsolationLedger, snapshotRepoTree } from ${JSON.stringify(GUARD_MODULE)};
export default function setup() {
  const root = dirname(fileURLToPath(import.meta.url));
  const ledgerPath = root + "/ledger.json";
  const before = snapshotRepoTree(root);
  return () => assertRepoTreeUnchanged(before, root, readIsolationLedger(ledgerPath), ledgerPath);
}
`,
  );
  // reason: same Bun-runtime zod workaround as vitest.shared.ts (adr-tg-1); the guard module imports zod.
  writeFileSync(
    join(root, "vitest.config.mjs"),
    `import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
export default { test: { server: { deps: { inline: ["zod"] } }, globalSetup: ["./guard-setup.ts"], include: ["fixture.test.mjs"], root: dirname(fileURLToPath(import.meta.url)) } };\n`,
  );
  writeFileSync(join(root, "fixture.test.mjs"), testBody);
  // reason: the harness files must not appear as tree writes, so commit them before the run.
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "harness");
}

function launchArgv(root: string, launch: Launch): { cmd: string; args: string[]; cwd: string } {
  const vitest = ["bunx", "--bun", "vitest", "run", "--config", "vitest.config.mjs"];
  // reason: the direct run starts in REPO so bunx finds vitest; the isolated run starts in a copy of `root`, where the config is local.
  if (launch === "direct") return { cmd: "bunx", args: ["--bun", "vitest", "run", "--config", join(root, "vitest.config.mjs")], cwd: REPO };
  return { cmd: "bun", args: [PRIVATE_TREE_CLI, "--root", root, "--", ...vitest], cwd: REPO };
}

/** A real vitest invocation over `root`; the globalSetup is the guard exactly as test-global-setup.ts wires it. */
function runFixtureVitest(root: string, testBody: string, launch: Launch = "direct"): { status: number | null; output: string } {
  prepareFixture(root, testBody);
  const { cmd, args, cwd } = launchArgv(root, launch);
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120_000, env: { ...process.env, LORE_TEST_RUN_ACTIVE: "1" } });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

/** Test bodies address files by `HERE`, the directory holding the test file, so they follow a private copy. */
const FIXTURE_TEST = (body: string): string =>
  `import { it } from "vitest";\nimport { writeFileSync, mkdtempSync } from "node:fs";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\nimport { fileURLToPath } from "node:url";\nconst HERE = fileURLToPath(new URL(".", import.meta.url));\nit("w", () => { ${body} });\n`;

const LAUNCHES: readonly Launch[] = ["direct", "isolated"];

describe("AC-TG-3 repo-tree snapshot guard (real vitest invocation, exit code)", () => {
  it.each(LAUNCHES)("AC-TG-3 HAPPY (%s): a run that writes only under mkdtemp exits 0", (launch) => {
    const root = fixtureRepo();
    const run = runFixtureVitest(root, FIXTURE_TEST(`writeFileSync(join(mkdtempSync(join(tmpdir(), "ok-")), "f"), "x");`), launch);
    expect(run.output).toContain("1 passed");
    expect(run.status, run.output).toBe(0);
  }, 150_000);

  it.each(LAUNCHES)("AC-TG-3 NEGATIVE (%s): a run whose test creates a file in the tree exits 1 and names the path", (launch) => {
    const root = fixtureRepo();
    const run = runFixtureVitest(root, FIXTURE_TEST(`writeFileSync(join(HERE, "leaked-by-test.txt"), "x");`), launch);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toContain("leaked-by-test.txt");
  }, 150_000);

  it.each(LAUNCHES)("AC-TG-3 NEGATIVE (%s): a run whose test rewrites a tracked file exits 1 and names it", (launch) => {
    const root = fixtureRepo();
    const run = runFixtureVitest(root, FIXTURE_TEST(`writeFileSync(join(HERE, "tracked.txt"), "rewritten by the test\\n");`), launch);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toContain("tracked.txt");
  }, 150_000);

  it.each(LAUNCHES)("AC-TG-3 STATE (%s): the same write exits 0 once the ledger lists the path with a reason", (launch) => {
    const root = fixtureRepo([{ path: "leaked-by-test.txt", rule: "no-repo-writes", reason: "fixture writer", bound_ac: "AC-TG-3" }]);
    const run = runFixtureVitest(root, FIXTURE_TEST(`writeFileSync(join(HERE, "leaked-by-test.txt"), "x");`), launch);
    expect(run.output).toContain("1 passed");
    expect(run.status, run.output).toBe(0);
  }, 150_000);
});

/**
 * Runs a passing fixture test and, WHILE it runs (after the guard took its start snapshot, before the run ends),
 * has this driver process, which is not a child of the run, edit `tracked.txt` in the REAL fixture tree.
 * The handshake is two FIFOs, so no sleep or poll decides when the edit happens; each blocking read is bounded.
 */
function runWithConcurrentEdit(launch: Launch): Promise<{ status: number | null; output: string }> {
  const root = fixtureRepo();
  const sync = mkdtempSync(join(tmpdir(), "tree-guard-sync-"));
  made.push(sync);
  const started = join(sync, "started");
  const go = join(sync, "go");
  for (const fifo of [started, go]) spawnSync("mkfifo", [fifo]);
  const handshake =
    `import { spawnSync } from "node:child_process";\n` +
    `spawnSync("sh", ["-c", "echo up > ${started}"], { timeout: 100000 });\n` +
    `spawnSync("cat", ["${go}"], { timeout: 100000 });\n`;
  prepareFixture(root, handshake + FIXTURE_TEST(`writeFileSync(join(mkdtempSync(join(tmpdir(), "ok-")), "f"), "x");`));
  const { cmd, args, cwd } = launchArgv(root, launch);
  const child = spawn(cmd, args, { cwd, env: { ...process.env, LORE_TEST_RUN_ACTIVE: "1" } });
  let output = "";
  child.stdout.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr.on("data", (d: Buffer) => (output += d.toString()));
  const done = new Promise<{ status: number | null; output: string }>((resolveRun) => {
    child.on("close", (status) => resolveRun({ status, output }));
  });
  if (spawnSync("cat", [started], { timeout: 100_000 }).status !== 0) {
    child.kill();
    return done.then((r) => ({ status: -1, output: `fixture never reached its handshake\n${r.output}` }));
  }
  writeFileSync(join(root, "tracked.txt"), "edited by another session, not by the run\n");
  spawnSync("sh", ["-c", `echo go > ${go}`], { timeout: 100_000 });
  return done;
}

describe("TG-46 a concurrent edit by a process outside the run is not the run's write", () => {
  it("BASELINE: run straight from the shared tree, the guard blames the run for the other process's edit (the defect)", async () => {
    const run = await runWithConcurrentEdit("direct");
    expect(run.output).toContain("1 passed");
    expect(run.status, run.output).toBe(1);
    expect(run.output).toContain("tracked.txt");
  }, 150_000);

  it("AC-TG-46 HAPPY: run through the private-tree launcher, the same concurrent edit leaves exit 0", async () => {
    const run = await runWithConcurrentEdit("isolated");
    expect(run.output).toContain("1 passed");
    expect(run.status, run.output).toBe(0);
  }, 150_000);
});
