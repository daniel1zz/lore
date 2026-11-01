// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-write-set-compiled.bun.test.ts — a claim declares its write set; overlap, oracle additions and edit-time
 * declarations use it (spec-done-contract-compiled-at-approve-task-kinds-write-sets), observed through the `lore` command tree
 * (`runLoreInProcess`, the function the binary's entry calls) on a throwaway repository and corpus.
 *
 * Holds the criteria of the tasks before and including the one that owns the newest block, so it passes whole at every task's
 * tip. Each test name starts with `AC-DCS1-<n>:` (with the colon), so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10.
 *
 *   Task "a claim declares its write set; overlap, oracle additions and edit-time declares use it":
 *     AC-DCS1-10  `lore claim --write-set`; the claim gate and the ready report judge overlap on write sets
 *     AC-DCS1-11  the write set's changed test files add oracles; the contract's oracles never shrink
 *     AC-DCS1-12  `lore anchor declare` extends the claim write set, never the task anchors
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the repository's own `.lore/` is never touched.
 * A second run (a sibling's holder) is another `CLAUDE_CODE_SESSION_ID`, which the in-process runner registers as its own run.
 * A task is landed through the real `lore integrate` on a real branch in a real linked worktree.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { installShippedGuard } from "../integration/support/main-guard-repo";
import { landWithoutIntegrate } from "../helpers/done-contract-land";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

/** Commands the fixture contract runs; each prints a runner summary so a capture records a real attested run. */
const FIXTURE_CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" } as const;
const AC_COMMAND = "echo fx1";
const TYPECHECK = "echo typecheck-ok";
// reason: a captured red run must carry a recognised runner summary reporting at least one failed test (BR-1077).
const RED_COMMAND = "sh -c 'printf \" Test Files  1 failed (1)\\n      Tests  1 failed (1)\\n\"; exit 1'";

/** Environment naming another run: the in-process runner registers `cc:<session>` as its own agent run. */
const sessionEnv = (session: string): Record<string, string> => ({ CLAUDE_CODE_SESSION_ID: session });

let fixture: DoneContractFixture;
let worktreeRoot = "";
let sequence = 0;

beforeAll(async () => {
  fixture = await makeDoneContractFixture();
  fixture.setDoneContractConfig(FIXTURE_CONFIG);
  // reason: the task-claim gate stays ON (it is the subject of AC-DCS1-10); the gates that are not this file's subject are off.
  patchLoreConfig(fixture.dir, {
    workflow: {
      gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } },
      integrate: { floor_command: "true" },
    },
  });
  // reason: the task-claim gate requires an approved ancestor spec (BR-104); approving one needs a live cited rule.
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  // reason: the anchored test files exist on main, so a landed tree always holds every contract test file (floor missing-oracle-file).
  mkdirSync(join(fixture.dir, "tests"), { recursive: true });
  for (const file of [...ANCHORED, "tests/untouched.test.ts", "tests/outside.test.ts", "tests/q-1.test.ts"]) writeFileSync(join(fixture.dir, file), "// seed\n");
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", "seed test files"]);
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs1-ws-guard-")), "hooks"));
  fixture.git(["checkout", "-q", "--detach", "main"]);
  worktreeRoot = mkdtempSync(join(tmpdir(), "dcs1-ws-wt-"));
});

afterAll(() => {
  fixture.dispose();
  rmSync(worktreeRoot, { recursive: true, force: true });
});

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

/** One lore call with an explicit working directory and optional extra environment (another run). */
async function loreIn(cwd: string, args: readonly string[], extraEnv: Record<string, string> = {}): Promise<Out> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, ...extraEnv, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

interface Tree {
  readonly branch: string;
  readonly path: string;
}

/** A linked worktree on a fresh branch off main. */
function addWorktree(label: string): Tree {
  sequence += 1;
  const branch = `dcs1-ws-${label}-${sequence}`;
  const path = join(worktreeRoot, `${label}-${sequence}`);
  fixture.git(["worktree", "add", "-q", "-b", branch, path, "main"]);
  return { branch, path };
}

/** Commits `files` (path -> content) on the branch of `tree`. */
function commitIn(tree: Tree, files: Readonly<Record<string, string>>): void {
  const git = (args: string[]): string => execFileSync("git", args, { cwd: tree.path, encoding: "utf8" }).trim();
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["config", "user.name", "fixture"]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(tree.path, path)), { recursive: true });
    writeFileSync(join(tree.path, path), content);
  }
  git(["add", "-A"]);
  sequence += 1;
  git(["commit", "-q", "-m", `work ${sequence}`]);
}

/** Creates and approves a code task; returns its slug. */
async function approvedTask(plan: string, anchors: readonly string[], title: string, acScope: readonly string[] = []): Promise<string> {
  const slug = await fixture.createTask({ plan, kind: "code", title, anchors, acScope });
  await fixture.mustRun(["approve", slug]);
  return slug;
}

interface ClaimShape {
  readonly write_set?: readonly string[];
  readonly branch?: string;
  readonly harness_run?: string | null;
}

async function claimOf(slug: string): Promise<ClaimShape | undefined> {
  return (await fixture.readTask(slug)).extra["claim"] as ClaimShape | undefined;
}

async function anchorsOf(slug: string): Promise<unknown> {
  return (await fixture.readTask(slug)).extra["file_anchors"];
}

interface ContractShape {
  readonly oracles: readonly { id: string; command?: string }[];
  readonly added_oracles: readonly { id: string; command?: string }[];
}

async function contractOf(slug: string): Promise<ContractShape> {
  return (await fixture.readTask(slug)).extra["done_contract"] as ContractShape;
}

interface ConflictShape {
  readonly task_slug: string;
  readonly holder: string;
  readonly paths: readonly string[];
}

/** The anchor conflicts the ready report lists for a plan. */
async function readyConflicts(plan: string): Promise<ConflictShape[]> {
  const out = await fixture.mustRun(["ready", plan, "--json"]);
  const parsed = JSON.parse(out) as { data: { ready: { anchor_conflicts: ConflictShape[] } } };
  return parsed.data.ready.anchor_conflicts;
}

async function capturePassIn(cwd: string, slug: string, command: string, extra: readonly string[] = []): Promise<void> {
  const out = await loreIn(cwd, ["evidence", slug, "--oracle", "test", "--command", command, "--result", "pass", "--capture", ...extra]);
  if (out.exitCode !== 0) throw new Error(`capture pass failed for ${command}: ${out.stderr}${out.stdout}`);
}

async function captureRedIn(cwd: string, slug: string): Promise<void> {
  const out = await loreIn(cwd, ["evidence", slug, "--oracle", "test", "--command", RED_COMMAND, "--result", "expected-fail", "--capture"]);
  if (out.exitCode !== 0) throw new Error(`capture red failed: ${out.stderr}${out.stdout}`);
}

/** A runner-attested pass of the whole-file run of `file` (the command the fixture's template gives). */
function passFile(slug: string, file: string): Promise<void> {
  return capturePassIn(fixture.dir, slug, `echo Ran 1 tests in ${file}`);
}

/**
 * Lands the branch the way a landing leaves it (a merge commit on main and the landing record), without `lore integrate`:
 * integrate runs the contract oracles and records attested rows, which would put the evidence into the very state the
 * done floors under test are about. Integrate's own behaviour is tested in `done-contract-integrate-compiled.bun.test.ts`.
 */
async function integrate(branch: string): Promise<void> {
  await landWithoutIntegrate(fixture, branch);
}

const ANCHORED = ["tests/x-1.test.ts", "tests/x-2.test.ts", "tests/x-3.test.ts"] as const;
const EXPECTED_ORACLES = [
  { id: "ac:AC-FX-1", command: AC_COMMAND },
  ...ANCHORED.map((file) => ({ id: `test:${file}`, command: `echo Ran 1 tests in ${file}` })),
  { id: "typecheck", command: TYPECHECK },
];
const ADDED_FILE = "tests/extra/new.test.ts";
const WRITE_SET = ["tests/x-1.test.ts", "tests/x-2.test.ts", "tests/extra/", "tests/untouched.test.ts"] as const;

/** A task anchored on three test files whose claim declares `WRITE_SET`; the branch changes two anchored files and more. */
async function fixUpTask(label: string, session: string): Promise<{ slug: string; plan: string; tree: Tree }> {
  const plan = await fixture.createPlan(`Fix-up plan ${label}`);
  const slug = await approvedTask(plan, ANCHORED, `Fix-up ${label}`, ["AC-FX-1"]);
  const tree = addWorktree(label);
  const flags = WRITE_SET.flatMap((entry) => ["--write-set", entry]);
  const claimed = await loreIn(fixture.dir, ["claim", slug, "--worktree", tree.branch, ...flags], sessionEnv(session));
  expect(claimed.exitCode, claimed.text).toBe(0);
  // reason: the content names the scenario, so a file an earlier scenario landed on main still changes on this branch.
  commitIn(tree, {
    "tests/x-1.test.ts": `// one ${label}\n`,
    "tests/x-2.test.ts": `// two ${label}\n`,
    [ADDED_FILE]: `// extra test under a directory entry ${label}\n`,
    "tests/extra/notes.md": `not a test file ${label}\n`,
    "tests/outside.test.ts": `// changed, but outside the write set ${label}\n`,
    "src/other.ts": `export const other = "${label}";\n`,
  });
  return { slug, plan, tree };
}

describe("AC-DCS1-10: a claim declares its write set and overlap is judged on write sets", () => {
  it("AC-DCS1-10: a claim whose write set avoids the sibling's path exits 0 and records it; a write set holding it, and no write set, exit 4 naming the sibling, its run and the path; lore ready agrees", async () => {
    const plan = await fixture.createPlan("Overlap plan");
    const sibling = await approvedTask(plan, ["src/call-scope.ts"], "Sibling holding call-scope");
    const target = await approvedTask(plan, ["src/call-scope.ts", "tests/t-a.test.ts", "tests/t-b.test.ts"], "Target anchoring call-scope");
    const siblingTree = addWorktree("sib");
    const targetTree = addWorktree("target");
    const siblingSession = "dcs1-ws-sibling-session";
    const targetSession = "dcs1-ws-target-session";

    const siblingClaim = await loreIn(fixture.dir, ["claim", sibling, "--worktree", siblingTree.branch], sessionEnv(siblingSession));
    expect(siblingClaim.exitCode, siblingClaim.text).toBe(0);

    // Refused: a write set that includes the sibling's path, and no write set (every approved anchor is the write set).
    const before = await fixture.readTask(target);
    const refusedCases: readonly (readonly string[])[] = [["--write-set", "src/call-scope.ts", "--write-set", "tests/t-a.test.ts"], []];
    for (const flags of refusedCases) {
      const refused = await loreIn(fixture.dir, ["claim", target, "--worktree", targetTree.branch, ...flags], sessionEnv(targetSession));
      expect(refused.exitCode, refused.text).toBe(4);
      expect(refused.text).toContain("gate:task-claim:anchor-overlap");
      expect(refused.text).toContain(sibling);
      expect(refused.text).toContain(`cc:${siblingSession}`);
      expect(refused.text).toContain("src/call-scope.ts");
      const after = await fixture.readTask(target);
      expect(after.version).toBe(before.version);
      expect(after.extra["claim"]).toBeUndefined();
    }
    // The ready report names the same conflict for the unclaimed target: its write set is its approved anchors.
    const refusedReport = await readyConflicts(plan);
    const forTarget = refusedReport.filter((conflict) => conflict.task_slug === target);
    expect(forTarget.length).toBe(1);
    expect(forTarget[0]!.paths).toContain("src/call-scope.ts");

    // Accepted: two test files only. The claim records them, and the ready report lists no conflict at all.
    const accepted = await loreIn(
      fixture.dir,
      ["claim", target, "--worktree", targetTree.branch, "--write-set", "tests/t-a.test.ts", "--write-set", "tests/t-b.test.ts"],
      sessionEnv(targetSession),
    );
    expect(accepted.exitCode, accepted.text).toBe(0);
    expect((await claimOf(target))?.write_set).toEqual(["tests/t-a.test.ts", "tests/t-b.test.ts"]);
    expect(await readyConflicts(plan)).toEqual([]);
    // The write set judges overlap only: the task's approved anchors are unchanged.
    expect(await anchorsOf(target)).toEqual(["src/call-scope.ts", "tests/t-a.test.ts", "tests/t-b.test.ts"]);

    // A second claim on the same task is governed by the lease (BR-1040), never by the overlap gate.
    const otherRun = await loreIn(fixture.dir, ["claim", target, "--worktree", targetTree.branch, "--write-set", "tests/t-a.test.ts"], sessionEnv("dcs1-ws-intruder-session"));
    expect(otherRun.exitCode, otherRun.text).toBe(5);
    const refreshed = await loreIn(fixture.dir, ["claim", target, "--worktree", targetTree.branch, "--write-set", "tests/t-b.test.ts"], sessionEnv(targetSession));
    expect(refreshed.exitCode, refreshed.text).toBe(0);
    expect((await claimOf(target))?.write_set).toEqual(["tests/t-b.test.ts"]);
  });

  it("AC-DCS1-10: two ad-hoc tasks whose write sets overlap still conflict, and disjoint ones do not", async () => {
    const adhoc = async (title: string): Promise<string> => {
      const created = await fixture.mustRun(["create", "task", "--title", title, "--adhoc", "--kind", "code", "--ac-scope", "", "--content", "x", "--no-ai"]);
      const slug = created.match(/Slug:\s+(\S+)/)?.[1];
      if (slug === undefined) throw new Error(`no slug in ${created}`);
      return slug;
    };
    const first = await adhoc("Adhoc overlap A");
    const second = await adhoc("Adhoc overlap B");
    const firstTree = addWorktree("adhoc-a");
    const secondTree = addWorktree("adhoc-b");

    const held = await loreIn(fixture.dir, ["claim", first, "--worktree", firstTree.branch, "--write-set", "shared/adhoc.ts"], sessionEnv("dcs1-ws-adhoc-a"));
    expect(held.exitCode, held.text).toBe(0);
    const clash = await loreIn(fixture.dir, ["claim", second, "--worktree", secondTree.branch, "--write-set", "shared/adhoc.ts"], sessionEnv("dcs1-ws-adhoc-b"));
    expect(clash.exitCode, clash.text).toBe(4);
    expect(clash.text).toContain("gate:task-claim:anchor-overlap");
    expect(clash.text).toContain(first);
    expect((await fixture.readTask(second)).extra["claim"]).toBeUndefined();

    const disjoint = await loreIn(fixture.dir, ["claim", second, "--worktree", secondTree.branch, "--write-set", "other/adhoc.ts"], sessionEnv("dcs1-ws-adhoc-b"));
    expect(disjoint.exitCode, disjoint.text).toBe(0);
  });
});

describe("AC-DCS1-11: the write set's changed test files add oracles; the oracle set never shrinks", () => {
  it("AC-DCS1-11: lore release persists exactly the changed declared test file as an added oracle, keeps every contract oracle, and lore done demands a whole-file pass of each", async () => {
    const { slug, tree } = await fixUpTask("release", "dcs1-ws-release-session");

    // Before the release: nothing is persisted yet (the additions are written WITH the release).
    expect((await contractOf(slug)).added_oracles).toEqual([]);
    const released = await loreIn(fixture.dir, ["release", slug], sessionEnv("dcs1-ws-release-session"));
    expect(released.exitCode, released.text).toBe(0);
    expect(await claimOf(slug)).toBeUndefined();

    // Read back from the task after the release: the contract's oracles are exactly the approve-time ones (a write set that
    // replaced them would be a pass-only false green); the single addition is the changed unanchored file under the directory
    // entry. The declared-but-untouched file, the changed file outside the write set and the non-test file add nothing.
    const contract = await contractOf(slug);
    expect(contract.oracles).toEqual(EXPECTED_ORACLES);
    expect(contract.added_oracles).toEqual([{ id: `test:${ADDED_FILE}`, command: `echo Ran 1 tests in ${ADDED_FILE}` }]);

    await integrate(tree.branch);
    // The release made the additions durable: reading them again after the landing still gives the same answer.
    expect((await contractOf(slug)).added_oracles.map((oracle) => oracle.id)).toEqual([`test:${ADDED_FILE}`]);

    await captureRedIn(fixture.dir, slug);
    await capturePassIn(fixture.dir, slug, AC_COMMAND, ["--ac", "AC-FX-1"]);
    await capturePassIn(fixture.dir, slug, TYPECHECK);
    await passFile(slug, "tests/x-1.test.ts");
    await passFile(slug, "tests/x-2.test.ts");

    // The third anchored file is shown executed too (the write set did not drop it), and so is the added file.
    const missingTwo = await loreIn(fixture.dir, ["done", slug]);
    expect(missingTwo.exitCode, missingTwo.text).toBe(4);
    expect(missingTwo.text).toContain("[floor: unfiltered-test-file]");
    expect(missingTwo.text).toContain("tests/x-3.test.ts");
    expect(missingTwo.text).toContain(ADDED_FILE);
    expect(missingTwo.text).not.toContain("tests/untouched.test.ts");
    expect(missingTwo.text).not.toContain("tests/outside.test.ts");

    await passFile(slug, "tests/x-3.test.ts");
    const missingAdded = await loreIn(fixture.dir, ["done", slug]);
    expect(missingAdded.exitCode, missingAdded.text).toBe(4);
    expect(missingAdded.text).toContain("[floor: unfiltered-test-file]");
    expect(missingAdded.text).toContain(ADDED_FILE);
    expect(missingAdded.text).not.toContain("tests/x-3.test.ts");
    expect((await fixture.readTask(slug)).status).not.toBe("archived");

    await passFile(slug, ADDED_FILE);
    const finished = await loreIn(fixture.dir, ["done", slug]);
    expect(finished.exitCode, finished.text).toBe(0);
    expect((await fixture.readTask(slug)).status).toBe("archived");
  });

  it("AC-DCS1-11: a run end that releases the claim persists the same additions", async () => {
    const session = "dcs1-ws-runend-session";
    const { slug } = await fixUpTask("runend", session);
    expect((await contractOf(slug)).added_oracles).toEqual([]);

    const ended = await loreIn(fixture.dir, ["run", "end", `cc:${session}`, "--reason", "dcs1 write-set run end"]);
    expect(ended.exitCode, ended.text).toBe(0);
    expect(await claimOf(slug)).toBeUndefined();

    const contract = await contractOf(slug);
    expect(contract.oracles).toEqual(EXPECTED_ORACLES);
    expect(contract.added_oracles).toEqual([{ id: `test:${ADDED_FILE}`, command: `echo Ran 1 tests in ${ADDED_FILE}` }]);
  });

  it("AC-DCS1-11: lore done derives the additions again while the claim exists, and a claim declaring nothing changed adds nothing", async () => {
    const session = "dcs1-ws-held-session";
    const { slug, tree } = await fixUpTask("held", session);
    await integrate(tree.branch);
    await captureRedIn(fixture.dir, slug);
    await capturePassIn(fixture.dir, slug, AC_COMMAND, ["--ac", "AC-FX-1"]);
    await capturePassIn(fixture.dir, slug, TYPECHECK);
    for (const file of ANCHORED) await passFile(slug, file);

    // The claim is still held and nothing was persisted, yet done sees the addition.
    expect(await claimOf(slug)).toBeDefined();
    expect((await contractOf(slug)).added_oracles).toEqual([]);
    const refused = await loreIn(fixture.dir, ["done", slug], sessionEnv(session));
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("[floor: unfiltered-test-file]");
    expect(refused.text).toContain(ADDED_FILE);

    // Control: a claim whose declared test files the branch never touched adds nothing.
    const plan = await fixture.createPlan("Untouched plan");
    const quiet = await approvedTask(plan, ["tests/q-1.test.ts"], "Quiet task", ["AC-FX-1"]);
    const quietTree = addWorktree("quiet");
    const quietClaim = await loreIn(fixture.dir, ["claim", quiet, "--worktree", quietTree.branch, "--write-set", "tests/q-1.test.ts", "--write-set", "tests/q-2.test.ts"], sessionEnv("dcs1-ws-quiet-session"));
    expect(quietClaim.exitCode, quietClaim.text).toBe(0);
    commitIn(quietTree, { "src/quiet.ts": "export const quiet = 1;\n" });
    const quietRelease = await loreIn(fixture.dir, ["release", quiet], sessionEnv("dcs1-ws-quiet-session"));
    expect(quietRelease.exitCode, quietRelease.text).toBe(0);
    expect((await contractOf(quiet)).added_oracles).toEqual([]);
  });
});

describe("AC-DCS1-12: edit-time declarations extend the claim write set, not the task anchors", () => {
  it("AC-DCS1-12: a free path is appended to the write set only, sixty free paths leave file_anchors unchanged, a held path is refused naming the holder, and anchor scope reports the write set", async () => {
    const plan = await fixture.createPlan("Declare plan");
    const holder = await approvedTask(plan, ["src/held-by-sibling.ts"], "Holds a path");
    const declarer = await approvedTask(plan, ["src/declarer-anchor.ts"], "Declares paths");
    const holderTree = addWorktree("holder");
    const declarerTree = addWorktree("declarer");
    const holderClaim = await loreIn(fixture.dir, ["claim", holder, "--worktree", holderTree.branch], sessionEnv("dcs1-ws-holder-session"));
    expect(holderClaim.exitCode, holderClaim.text).toBe(0);
    const declarerClaim = await loreIn(fixture.dir, ["claim", declarer, "--worktree", declarerTree.branch], sessionEnv("dcs1-ws-declarer-session"));
    expect(declarerClaim.exitCode, declarerClaim.text).toBe(0);
    const anchorsBefore = await anchorsOf(declarer);
    expect(anchorsBefore).toEqual(["src/declarer-anchor.ts"]);

    const declare = (path: string): Promise<Out> =>
      loreIn(fixture.dir, ["anchor", "declare", declarer, path, "--worktree", declarerTree.path], sessionEnv("dcs1-ws-declarer-session"));

    // A path another live claim holds: exit 4 naming the holder task, nothing written.
    const versionBefore = (await fixture.readTask(declarer)).version;
    const refused = await declare("src/held-by-sibling.ts");
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain(holder);
    expect((await fixture.readTask(declarer)).version).toBe(versionBefore);
    expect((await claimOf(declarer))?.write_set).toBeUndefined();

    // A free path: appended to the claim write set (with the approved anchors it already had), not to file_anchors.
    const free = await declare("src/free-0.ts");
    expect(free.exitCode, free.text).toBe(0);
    expect((await claimOf(declarer))?.write_set).toEqual(["src/declarer-anchor.ts", "src/free-0.ts"]);
    expect(await anchorsOf(declarer)).toEqual(anchorsBefore);

    // Sixty free paths in one claim: the 50-anchor cap bounds approved anchors only.
    for (let index = 1; index <= 60; index += 1) {
      const out = await declare(`src/free-${index}.ts`);
      expect(out.exitCode, `declare ${index}: ${out.text}`).toBe(0);
    }
    expect(await anchorsOf(declarer)).toEqual(anchorsBefore);
    const writeSet = (await claimOf(declarer))?.write_set ?? [];
    expect(writeSet.length).toBe(62);
    expect(writeSet).toContain("src/free-60.ts");

    // `lore anchor scope --json` reports each claim's write set, for the working copy and for the whole project.
    const scoped = await loreIn(fixture.dir, ["anchor", "scope", "--worktree", declarerTree.path, "--json"]);
    expect(scoped.exitCode, scoped.text).toBe(0);
    const scopedClaims = (JSON.parse(scoped.stdout) as { data: { claims: { task: string; write_set: string[] }[] } }).data.claims;
    const own = scopedClaims.find((claim) => claim.task === declarer);
    expect(own?.write_set).toEqual(writeSet);
    const everything = await loreIn(fixture.dir, ["anchor", "scope", "--all", "--json"]);
    expect(everything.exitCode, everything.text).toBe(0);
    const allClaims = (JSON.parse(everything.stdout) as { data: { claims: { task: string; write_set: string[] }[] } }).data.claims;
    expect(allClaims.find((claim) => claim.task === declarer)?.write_set).toEqual(writeSet);
    expect(allClaims.find((claim) => claim.task === holder)?.write_set).toEqual(["src/held-by-sibling.ts"]);
  });
});
