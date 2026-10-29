// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-finish-compiled.bun.test.ts — `lore finish` runs every contract oracle itself, reports every unmet item at once
 * and keeps the claim, marked finished (spec-done-contract-compiled-at-approve-task-kinds-write-sets), observed through the
 * `lore` command tree (`runLoreInProcess`, the function the binary's entry calls) on a throwaway repository and corpus.
 *
 * Holds the criteria of the tasks before and including the one that owns the newest block, so it passes whole at every task's
 * tip. Each test name starts with `AC-DCS1-<n>:` (with the colon), so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10.
 *
 *   Task "lore finish runs every contract oracle, reports all unmet items and keeps the claim":
 *     AC-DCS1-15  finish runs every oracle at the commit it read, records attested rows in one write, keeps the claim finished
 *     AC-DCS1-16  finish reports ALL unmet items; refusals run nothing; the one write is a compare-and-swap; release of an
 *                 uninspectable worktree is refused
 *     AC-DCS1-17  finish --red records runner-produced reds only
 *     AC-DCS1-18  a finished claim keeps its lease only while the branch tip equals the finished commit (the part that needs
 *                 `lore land` to fold a branch is covered by the land task's own file)
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the repository's own `.lore/` is never touched.
 * A second run is another `CLAUDE_CODE_SESSION_ID`, which the in-process runner registers as its own run.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { installShippedGuard } from "../integration/support/main-guard-repo";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

type DoneContractConfig = { install: string; typecheck: string; test_file: string };

/** Commands the fixture contract runs; each prints a runner summary so a run records a real attested pass. */
const PASS_CONFIG: DoneContractConfig = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" };
const AC_COMMAND = "echo fx1";
const TYPECHECK = "echo typecheck-ok";
// reason: a red run must carry a recognised runner summary reporting at least one failed test (BR-1077).
const FAILED_SUMMARY = 'printf " Test Files  1 failed (1)\\n      Tests  1 failed (1)\\n"';
const RED_COMMAND = `sh -c '${FAILED_SUMMARY}; exit 1'`;
const MISSING_RUNNER_COMMAND = "no-such-runner-dcs1-finish";

let fixture: DoneContractFixture;
let scratch = "";
let sequence = 0;

const sessionEnv = (session: string): Record<string, string> => ({ CLAUDE_CODE_SESSION_ID: session });

beforeAll(async () => {
  fixture = await makeDoneContractFixture();
  fixture.setDoneContractConfig(PASS_CONFIG);
  patchLoreConfig(fixture.dir, {
    workflow: {
      gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } },
      integrate: { floor_command: "true" },
    },
  });
  // reason: the criteria below are declared while the spec is still a draft, so no decision is needed to add them.
  await fixture.mustRun(["ac", "add", fixture.spec, "AC-FX-RED", "--statement", "A criterion that is red before the work.", "--mode", "script", "--oracle", "test", "--command", RED_COMMAND]);
  await fixture.mustRun(["ac", "add", fixture.spec, "AC-FX-MISSING", "--statement", "A criterion whose runner does not exist.", "--mode", "script", "--oracle", "test", "--command", MISSING_RUNNER_COMMAND]);
  await fixture.mustRun(["ac", "add", fixture.spec, "AC-FX-NOSUMMARY", "--statement", "A criterion that exits 1 and prints no test summary.", "--mode", "script", "--oracle", "test", "--command", "sh -c 'exit 1'"]);
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  mkdirSync(join(fixture.dir, "tests"), { recursive: true });
  for (const file of [...ANCHORED, "tests/untouched.test.ts"]) writeFileSync(join(fixture.dir, file), "// seed\n");
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", "seed test files"]);
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs1-fin-guard-")), "hooks"));
  fixture.git(["checkout", "-q", "--detach", "main"]);
  scratch = mkdtempSync(join(tmpdir(), "dcs1-fin-"));
});

afterAll(() => {
  fixture.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

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

function addWorktree(label: string, branchOf = "main"): Tree {
  sequence += 1;
  const branch = `dcs1-fin-${label}-${sequence}`;
  const path = join(scratch, `${label}-${sequence}`);
  fixture.git(["worktree", "add", "-q", "-b", branch, path, branchOf]);
  return { branch, path };
}

const gitIn = (tree: Tree, args: string[]): string => execFileSync("git", args, { cwd: tree.path, encoding: "utf8" }).trim();

function commitIn(tree: Tree, files: Readonly<Record<string, string>>): string {
  gitIn(tree, ["config", "user.email", "fixture@example.invalid"]);
  gitIn(tree, ["config", "user.name", "fixture"]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(tree.path, path)), { recursive: true });
    writeFileSync(join(tree.path, path), content);
  }
  gitIn(tree, ["add", "-A"]);
  sequence += 1;
  gitIn(tree, ["commit", "-q", "-m", `work ${sequence}`]);
  return gitIn(tree, ["rev-parse", "HEAD"]);
}

interface Row {
  readonly oracle: string;
  readonly command: string;
  readonly result: string;
  readonly ac_ref?: string;
  readonly capture_source?: string;
  readonly attestation?: { runner: string; head_sha?: string; exit_code: number };
}

interface ClaimShape {
  readonly branch?: string;
  readonly harness_run?: string | null;
  readonly finished_at?: string;
  readonly finished_commit?: string;
  readonly write_set?: readonly string[];
}

async function rowsOf(slug: string): Promise<Row[]> {
  return ((await fixture.readTask(slug)).extra["verification_evidence"] ?? []) as Row[];
}

async function claimOf(slug: string): Promise<ClaimShape | undefined> {
  return (await fixture.readTask(slug)).extra["claim"] as ClaimShape | undefined;
}

interface ContractShape {
  readonly oracles: readonly { id: string; command?: string }[];
  readonly added_oracles: readonly { id: string; command?: string }[];
}

async function contractOf(slug: string): Promise<ContractShape> {
  return (await fixture.readTask(slug)).extra["done_contract"] as ContractShape;
}

/** Creates and approves a code task (optionally with a red waiver); returns its slug. */
async function approvedTask(plan: string, anchors: readonly string[], title: string, acScope: readonly string[], waiver?: string): Promise<string> {
  const slug = await fixture.createTask({ plan, kind: "code", title, anchors, acScope });
  await fixture.mustRun(waiver === undefined ? ["approve", slug] : ["approve", slug, "--red-waiver", waiver]);
  return slug;
}

async function claimOn(slug: string, tree: Tree, session: string, extra: readonly string[] = []): Promise<void> {
  const out = await loreIn(fixture.dir, ["claim", slug, "--worktree", tree.branch, ...extra], sessionEnv(session));
  expect(out.exitCode, out.text).toBe(0);
}

async function redIn(tree: Tree, slug: string, session: string): Promise<void> {
  const out = await loreIn(tree.path, ["evidence", slug, "--oracle", "test", "--command", RED_COMMAND, "--result", "expected-fail", "--capture"], sessionEnv(session));
  if (out.exitCode !== 0) throw new Error(`capture red failed: ${out.text}`);
}

/** Rewrites the branch recorded on a task's stored claim, through the store (the CLI refuses to create a shared branch). */
async function recordClaimBranchThroughStore(slug: string, branch: string): Promise<void> {
  const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const found = await app.corpusService.get(slug);
    if (!found.ok) throw new Error(`seed: ${slug} not found: ${JSON.stringify(found.error)}`);
    const doc = found.value.doc;
    const claim = doc.extra["claim"] as Record<string, unknown> | undefined;
    if (claim === undefined) throw new Error(`seed: ${slug} holds no claim to rewrite`);
    const updated = await app.corpusService.writeDoc({
      doc,
      patch: { extra: { ...doc.extra, claim: { ...claim, branch } } },
      action: "update",
      changeSummary: `fixture: claim records branch ${branch}`,
      auditAction: "update",
      auditDetails: { operation: "fixture-shared-branch" },
      lock: "none",
      by: String(claim["by"]),
      now: new Date().toISOString(),
    });
    if (!updated.ok) throw new Error(`seed: claim rewrite failed: ${JSON.stringify(updated.error)}`);
  } finally {
    app.close();
  }
}

const finishIn = (tree: Tree, slug: string, session: string, extra: readonly string[] = []): Promise<Out> =>
  loreIn(tree.path, ["finish", slug, ...extra], sessionEnv(session));

function useConfig(config: DoneContractConfig): void {
  fixture.setDoneContractConfig(config);
}

const ANCHORED = ["tests/x-1.test.ts", "tests/x-2.test.ts", "tests/x-3.test.ts"] as const;
const ONE_ANCHORED = ["tests/x-1.test.ts"] as const;
const ADDED_FILE = "tests/extra/new.test.ts";

async function waitFor(path: string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${path}`);
}

/** A test-file template whose oracle announces itself and waits for a marker file, so a test can act while it runs. */
function waitingConfig(tag: string): { config: DoneContractConfig; ready: string; go: string } {
  const ready = join(scratch, `${tag}-ready`);
  const go = join(scratch, `${tag}-go`);
  const template = `sh -c 'touch ${ready}; while [ ! -f ${go} ]; do sleep 0.1; done; echo Ran 1 tests in "$0"' {file}`;
  return { config: { ...PASS_CONFIG, test_file: template }, ready, go };
}

describe("AC-DCS1-15: finish runs every oracle at the commit it read and keeps the claim, marked finished", () => {
  it("AC-DCS1-15: runs every contract and added oracle itself, records attested rows stamped with the head in one write, keeps the claim finished, prints lore land", async () => {
    useConfig(PASS_CONFIG);
    const plan = await fixture.createPlan("Finish happy plan");
    const slug = await approvedTask(plan, ANCHORED, "Finish happy", ["AC-FX-1"]);
    const tree = addWorktree("happy");
    await claimOn(slug, tree, "dcs1-fin-happy", ["--write-set", "tests/extra/"]);
    const head = commitIn(tree, { [ADDED_FILE]: "// a new test of the write set\n", "src/work.ts": "export const work = 1;\n" });
    await redIn(tree, slug, "dcs1-fin-happy");
    const before = await fixture.readTask(slug);
    const rowsBefore = await rowsOf(slug);

    const out = await finishIn(tree, slug, "dcs1-fin-happy");
    expect(out.exitCode, out.text).toBe(0);
    expect(out.stdout).toContain(`lore land ${slug}`);
    expect(out.stdout).not.toContain("lore integrate");

    const after = await fixture.readTask(slug);
    expect(after.status).toBe(before.status);
    const newRows = (await rowsOf(slug)).slice(rowsBefore.length);
    const expected = [
      { oracle: "test", command: AC_COMMAND, ac_ref: "AC-FX-1" },
      ...ANCHORED.map((file) => ({ oracle: "test", command: `echo Ran 1 tests in ${file}` })),
      { oracle: "tsc", command: TYPECHECK },
      { oracle: "test", command: `echo Ran 1 tests in ${ADDED_FILE}` },
    ];
    expect(newRows.length).toBe(expected.length);
    for (const want of expected) {
      const row = newRows.find((candidate) => candidate.command === want.command);
      expect(row, `row for ${want.command}`).toBeDefined();
      expect(row?.oracle).toBe(want.oracle);
      expect(row?.result).toBe("pass");
      expect(row?.capture_source).toBe("runner");
      expect(row?.attestation?.runner).toBe("lore-cli");
      expect(row?.attestation?.head_sha).toBe(head);
      if ("ac_ref" in want) expect(row?.ac_ref).toBe(want.ac_ref);
    }
    // the added oracle is persisted in the same write, and the contract's own oracles are untouched
    const contract = await contractOf(slug);
    expect(contract.added_oracles.map((oracle) => oracle.id)).toEqual([`test:${ADDED_FILE}`]);
    expect(contract.oracles.length).toBe(5);
    // the claim is kept, marked finished at the commit the oracles ran on
    const claim = await claimOf(slug);
    expect(claim?.finished_commit).toBe(head);
    expect(typeof claim?.finished_at).toBe("string");
    expect(after.status).not.toBe("archived");
  });

  it("AC-DCS1-15: the finished mark tracks the branch tip; a later commit leaves the claim unfinished in effect and a second finish binds to the new commit", async () => {
    useConfig(PASS_CONFIG);
    const plan = await fixture.createPlan("Finish again plan");
    const slug = await approvedTask(plan, ONE_ANCHORED, "Finish again", ["AC-FX-1"]);
    const tree = addWorktree("again");
    await claimOn(slug, tree, "dcs1-fin-again");
    const first = commitIn(tree, { "src/a.ts": "export const a = 1;\n" });
    await redIn(tree, slug, "dcs1-fin-again");
    expect((await finishIn(tree, slug, "dcs1-fin-again")).exitCode).toBe(0);
    expect((await claimOf(slug))?.finished_commit).toBe(first);
    const second = commitIn(tree, { "src/b.ts": "export const b = 1;\n" });
    const again = await finishIn(tree, slug, "dcs1-fin-again");
    expect(again.exitCode, again.text).toBe(0);
    expect((await claimOf(slug))?.finished_commit).toBe(second);
    const heads = (await rowsOf(slug)).map((row) => row.attestation?.head_sha).filter((sha) => sha !== undefined);
    expect(new Set(heads)).toEqual(new Set([first, second]));
  });
});

describe("AC-DCS1-16: finish reports every unmet item at once and refuses before it runs anything", () => {
  it("AC-DCS1-16: two failing oracles and a missing red run all appear in one output, every oracle ran, the claim is not finished (exit 4)", async () => {
    const marker = join(scratch, "all-ran");
    useConfig({
      install: "echo install-ok",
      typecheck: "sh -c 'echo type-error; exit 1'",
      test_file: `sh -c '${FAILED_SUMMARY}; touch ${marker}; exit 1' x {file}`,
    });
    const plan = await fixture.createPlan("Finish unmet plan");
    const slug = await approvedTask(plan, ONE_ANCHORED, "Finish unmet", ["AC-FX-1"]);
    const tree = addWorktree("unmet");
    await claimOn(slug, tree, "dcs1-fin-unmet");
    commitIn(tree, { "src/c.ts": "export const c = 1;\n" });
    const rowsBefore = (await rowsOf(slug)).length;

    const out = await finishIn(tree, slug, "dcs1-fin-unmet");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("typecheck");
    expect(out.text).toContain("test:tests/x-1.test.ts");
    expect(out.text).toContain("red-first");
    // every oracle ran even after one failed: the test oracle ran (marker), and the AC oracle's pass is recorded
    expect(existsSync(marker)).toBe(true);
    const newRows = (await rowsOf(slug)).slice(rowsBefore);
    expect(newRows.find((row) => row.ac_ref === "AC-FX-1")?.result).toBe("pass");
    // only a proven red is recorded as a fail (BR-1077): the test file's failing summary is, the typecheck's bare exit 1 is not,
    // because any recorded fail row would satisfy the red-first floor
    expect(newRows.filter((row) => row.result === "fail").map((row) => row.oracle)).toEqual(["test"]);
    expect(newRows.some((row) => row.oracle === "tsc")).toBe(false);
    expect((await claimOf(slug))?.finished_commit).toBeUndefined();
  });

  it("AC-DCS1-16: an AC superseded after approve is refused as ac-superseded pointing at the correction (exit 4)", async () => {
    useConfig(PASS_CONFIG);
    // reason: the superseding spec stays a draft, so the supersede needs no decision; the claim gate that demands an approved spec is off for this scenario.
    const spec2 = (await fixture.mustRun(["create", "spec", "--title", "Supersede one", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"])).match(/Slug:\s+(\S+)/)?.[1] ?? "";
    const spec3 = (await fixture.mustRun(["create", "spec", "--title", "Supersede two", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"])).match(/Slug:\s+(\S+)/)?.[1] ?? "";
    await fixture.mustRun(["ac", "add", spec2, "AC-SA-1", "--statement", "Soon superseded.", "--mode", "script", "--oracle", "test", "--command", "echo sa1"]);
    await fixture.mustRun(["ac", "add", spec3, "AC-SB-1", "--statement", "The correction.", "--mode", "script", "--oracle", "test", "--command", "echo sb1"]);
    const plan = (await fixture.mustRun(["create", "plan", "--title", "Superseded plan", "--parent", spec2, "--content", "## Plan\n\nBody.\n", "--no-ai"])).match(/Slug:\s+(\S+)/)?.[1] ?? "";
    const slug = await approvedTask(plan, ONE_ANCHORED, "Finish superseded", ["AC-SA-1"]);
    patchLoreConfig(fixture.dir, { workflow: { gates: { "task-claim": { enabled: false } } } });
    const tree = addWorktree("sup");
    await claimOn(slug, tree, "dcs1-fin-sup");
    patchLoreConfig(fixture.dir, { workflow: { gates: { "task-claim": { enabled: true } } } });
    await fixture.mustRun(["ac", "supersede", spec2, "AC-SA-1", "--by", `${spec3}:AC-SB-1`, "--reason", "Replaced by the correction."]);
    commitIn(tree, { "src/d.ts": "export const d = 1;\n" });
    await redIn(tree, slug, "dcs1-fin-sup");

    const out = await finishIn(tree, slug, "dcs1-fin-sup");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("ac-superseded");
    expect(out.text).toContain("AC-SA-1");
    expect(out.text).toContain(`${spec3}:AC-SB-1`);
    expect((await claimOf(slug))?.finished_commit).toBeUndefined();
  });

  it("AC-DCS1-16: a dirty worktree (an untracked file included) is refused as dirty-worktree naming the paths; nothing ran, nothing recorded", async () => {
    const marker = join(scratch, "dirty-ran");
    useConfig({ ...PASS_CONFIG, test_file: `sh -c 'touch ${marker}; echo Ran 1 tests in "$0"' {file}` });
    const plan = await fixture.createPlan("Finish dirty plan");
    const slug = await approvedTask(plan, ONE_ANCHORED, "Finish dirty", ["AC-FX-1"]);
    const tree = addWorktree("dirty");
    await claimOn(slug, tree, "dcs1-fin-dirty");
    commitIn(tree, { "src/e.ts": "export const e = 1;\n" });
    await redIn(tree, slug, "dcs1-fin-dirty");
    writeFileSync(join(tree.path, "stray-untracked.txt"), "left behind\n");
    const rowsBefore = (await rowsOf(slug)).length;
    const out = await finishIn(tree, slug, "dcs1-fin-dirty");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("dirty-worktree");
    expect(out.text).toContain("stray-untracked.txt");
    expect(existsSync(marker)).toBe(false);
    expect((await rowsOf(slug)).length).toBe(rowsBefore);
  });

  it("AC-DCS1-16: a cwd outside the claim worktree is not-in-claim-worktree; a task with no claim by the caller run is no-claim naming lore start", async () => {
    useConfig(PASS_CONFIG);
    const plan = await fixture.createPlan("Finish refusals plan");
    const slug = await approvedTask(plan, ONE_ANCHORED, "Finish refusals", ["AC-FX-1"]);
    const tree = addWorktree("refuse");
    await claimOn(slug, tree, "dcs1-fin-refuse");
    commitIn(tree, { "src/f.ts": "export const f = 1;\n" });
    const rowsBefore = (await rowsOf(slug)).length;

    const outside = await loreIn(fixture.dir, ["finish", slug], sessionEnv("dcs1-fin-refuse"));
    expect(outside.exitCode, outside.text).toBe(4);
    expect(outside.text).toContain("not-in-claim-worktree");

    const stranger = await finishIn(tree, slug, "dcs1-fin-stranger");
    expect(stranger.exitCode, stranger.text).toBe(4);
    expect(stranger.text).toContain("no-claim");
    expect(stranger.text).toContain("lore start");

    const unclaimed = await approvedTask(plan, ["tests/x-2.test.ts"], "Finish unclaimed", ["AC-FX-1"]);
    const none = await finishIn(tree, unclaimed, "dcs1-fin-refuse");
    expect(none.exitCode, none.text).toBe(4);
    expect(none.text).toContain("no-claim");
    expect((await rowsOf(slug)).length).toBe(rowsBefore);
  });

  it("AC-DCS1-16: a claim whose branch is the plan integration branch, or one another live claim records, is refused as shared-branch", async () => {
    useConfig(PASS_CONFIG);
    fixture.git(["branch", "dcs1-fin-int", "main"]);
    const integrationPlan = await fixture.createPlan("Finish integration plan", "dcs1-fin-int");
    const onIntegration = await approvedTask(integrationPlan, ONE_ANCHORED, "Finish on the integration branch", ["AC-FX-1"]);
    const integrationTree: Tree = { branch: "dcs1-fin-int", path: join(scratch, "int-wt") };
    fixture.git(["worktree", "add", "-q", integrationTree.path, "dcs1-fin-int"]);
    await claimOn(onIntegration, integrationTree, "dcs1-fin-shared-a");
    const refusedIntegration = await finishIn(integrationTree, onIntegration, "dcs1-fin-shared-a");
    expect(refusedIntegration.exitCode, refusedIntegration.text).toBe(4);
    expect(refusedIntegration.text).toContain("shared-branch");

    const plan = await fixture.createPlan("Finish shared plan");
    const first = await approvedTask(plan, ["tests/x-2.test.ts"], "Finish shared one", ["AC-FX-1"]);
    const second = await approvedTask(await fixture.createPlan("Finish shared plan two"), ["tests/x-3.test.ts"], "Finish shared two", ["AC-FX-1"]);
    const tree = addWorktree("shared");
    await claimOn(first, tree, "dcs1-fin-shared-b");
    // reason: `lore claim` itself refuses a code claim on a branch another live claim records (shared-branch, AC-DCS1-14), so the CLI
    // can no longer build this state. The second task is claimed on its own branch, then its stored claim is made to record the
    // first task's branch through the store: finish's own refusal is asserted unchanged.
    await claimOn(second, addWorktree("shared-other"), "dcs1-fin-shared-c");
    await recordClaimBranchThroughStore(second, tree.branch);
    commitIn(tree, { "src/g.ts": "export const g = 1;\n" });
    const rowsBefore = (await rowsOf(first)).length;
    const out = await finishIn(tree, first, "dcs1-fin-shared-b");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("shared-branch");
    expect(out.text).toContain(second);
    expect((await rowsOf(first)).length).toBe(rowsBefore);
  });

  it("AC-DCS1-16: the one write is a compare-and-swap: a write-set declaration during the run, or a commit during the run, exits 5 and records nothing", async () => {
    const declaring = waitingConfig("declare");
    useConfig(declaring.config);
    const plan = await fixture.createPlan("Finish race plan");
    const slug = await approvedTask(plan, ONE_ANCHORED, "Finish race declare", ["AC-FX-1"]);
    const tree = addWorktree("race-declare");
    await claimOn(slug, tree, "dcs1-fin-race");
    commitIn(tree, { "src/h.ts": "export const h = 1;\n" });
    await redIn(tree, slug, "dcs1-fin-race");
    const rowsBefore = (await rowsOf(slug)).length;
    const pending = finishIn(tree, slug, "dcs1-fin-race");
    await waitFor(declaring.ready);
    const declared = await loreIn(fixture.dir, ["anchor", "declare", slug, "src/declared-during-run.ts", "--worktree", tree.path], sessionEnv("dcs1-fin-race"));
    expect(declared.exitCode, declared.text).toBe(0);
    writeFileSync(declaring.go, "go\n");
    const lost = await pending;
    expect(lost.exitCode, lost.text).toBe(5);
    expect((await rowsOf(slug)).length).toBe(rowsBefore);
    expect((await claimOf(slug))?.finished_commit).toBeUndefined();

    const committing = waitingConfig("commit");
    useConfig(committing.config);
    const plan2 = await fixture.createPlan("Finish race plan two");
    const slug2 = await approvedTask(plan2, ["tests/x-2.test.ts"], "Finish race commit", ["AC-FX-1"]);
    const tree2 = addWorktree("race-commit");
    await claimOn(slug2, tree2, "dcs1-fin-race2");
    commitIn(tree2, { "src/i.ts": "export const i = 1;\n" });
    await redIn(tree2, slug2, "dcs1-fin-race2");
    const rowsBefore2 = (await rowsOf(slug2)).length;
    const pending2 = finishIn(tree2, slug2, "dcs1-fin-race2");
    await waitFor(committing.ready);
    commitIn(tree2, { "src/j.ts": "export const j = 1;\n" });
    writeFileSync(committing.go, "go\n");
    const moved = await pending2;
    expect(moved.exitCode, moved.text).toBe(5);
    expect((await rowsOf(slug2)).length).toBe(rowsBefore2);
    expect((await claimOf(slug2))?.finished_commit).toBeUndefined();
  });

  it("AC-DCS1-16: lore release of a claim whose recorded worktree cannot be inspected is refused as worktree-uninspectable and the claim stays; a vanished worktree releases", async () => {
    useConfig(PASS_CONFIG);
    const plan = await fixture.createPlan("Finish release plan");
    const broken = await approvedTask(plan, ["tests/x-2.test.ts"], "Release broken worktree", ["AC-FX-1"]);
    const brokenTree = addWorktree("release-broken");
    const claimedBroken = await loreIn(fixture.dir, ["claim", broken, "--worktree", brokenTree.path], sessionEnv("dcs1-fin-rel-a"));
    expect(claimedBroken.exitCode, claimedBroken.text).toBe(0);
    // the worktree's git metadata is unreadable: its .git pointer names a directory that is not there
    writeFileSync(join(brokenTree.path, ".git"), `gitdir: ${join(scratch, "no-such-gitdir")}\n`);
    const refused = await loreIn(fixture.dir, ["release", broken], sessionEnv("dcs1-fin-rel-a"));
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("worktree-uninspectable");
    expect(await claimOf(broken)).toBeDefined();

    const vanished = await approvedTask(plan, ["tests/x-3.test.ts"], "Release vanished worktree", ["AC-FX-1"]);
    const vanishedTree = addWorktree("release-gone");
    const claimedGone = await loreIn(fixture.dir, ["claim", vanished, "--worktree", vanishedTree.path], sessionEnv("dcs1-fin-rel-b"));
    expect(claimedGone.exitCode, claimedGone.text).toBe(0);
    rmSync(vanishedTree.path, { recursive: true, force: true });
    const released = await loreIn(fixture.dir, ["release", vanished], sessionEnv("dcs1-fin-rel-b"));
    expect(released.exitCode, released.text).toBe(0);
    expect(await claimOf(vanished)).toBeUndefined();
  });
});

describe("AC-DCS1-17: finish --red records runner-produced reds only", () => {
  it("AC-DCS1-17: --red records an expected-fail row per red AC oracle when each summary shows a failed test (exit 0) and does not mark the claim finished", async () => {
    useConfig(PASS_CONFIG);
    const plan = await fixture.createPlan("Red stage plan");
    const slug = await approvedTask(plan, ONE_ANCHORED, "Red stage", ["AC-FX-RED"]);
    const tree = addWorktree("red");
    await claimOn(slug, tree, "dcs1-fin-red");
    commitIn(tree, { "tests/x-1.test.ts": "// the failing test, committed first\n" });
    const rowsBefore = (await rowsOf(slug)).length;
    const out = await finishIn(tree, slug, "dcs1-fin-red", ["--red"]);
    expect(out.exitCode, out.text).toBe(0);
    const newRows = (await rowsOf(slug)).slice(rowsBefore);
    expect(newRows.length).toBe(1);
    expect(newRows[0]?.result).toBe("expected-fail");
    expect(newRows[0]?.ac_ref).toBe("AC-FX-RED");
    expect(newRows[0]?.attestation?.runner).toBe("lore-cli");
    expect(newRows[0]?.capture_source).toBe("runner");
    expect((await claimOf(slug))?.finished_commit).toBeUndefined();
  });

  it("AC-DCS1-17: an oracle that passes is red-unexpected-pass naming it, and a run exiting 127 is never recorded as red (exit 4, nothing recorded)", async () => {
    useConfig(PASS_CONFIG);
    const plan = await fixture.createPlan("Red refusals plan");
    const passing = await approvedTask(plan, ONE_ANCHORED, "Red passes", ["AC-FX-1"]);
    const passingTree = addWorktree("red-pass");
    await claimOn(passing, passingTree, "dcs1-fin-redp");
    commitIn(passingTree, { "src/k.ts": "export const k = 1;\n" });
    const passingBefore = (await rowsOf(passing)).length;
    const unexpected = await finishIn(passingTree, passing, "dcs1-fin-redp", ["--red"]);
    expect(unexpected.exitCode, unexpected.text).toBe(4);
    expect(unexpected.text).toContain("red-unexpected-pass");
    expect(unexpected.text).toContain("ac:AC-FX-1");
    expect((await rowsOf(passing)).length).toBe(passingBefore);

    const missing = await approvedTask(plan, ["tests/x-2.test.ts"], "Red missing runner", ["AC-FX-MISSING"]);
    const missingTree = addWorktree("red-missing");
    await claimOn(missing, missingTree, "dcs1-fin-redm");
    commitIn(missingTree, { "src/l.ts": "export const l = 1;\n" });
    const missingBefore = (await rowsOf(missing)).length;
    const notRunnable = await finishIn(missingTree, missing, "dcs1-fin-redm", ["--red"]);
    expect(notRunnable.exitCode, notRunnable.text).toBe(4);
    expect(notRunnable.text).toContain("ac:AC-FX-MISSING");
    expect(notRunnable.text).toMatch(/127|not runnable|not found/);
    expect((await rowsOf(missing)).length).toBe(missingBefore);

    // a command that exits 1 but prints no runner summary proves no failed test, so it is no red either
    const silent = await approvedTask(plan, ["tests/x-3.test.ts"], "Red without a summary", ["AC-FX-NOSUMMARY"]);
    const silentTree = addWorktree("red-silent");
    await claimOn(silent, silentTree, "dcs1-fin-reds");
    commitIn(silentTree, { "src/n.ts": "export const n = 1;\n" });
    const silentBefore = (await rowsOf(silent)).length;
    const noSummary = await finishIn(silentTree, silent, "dcs1-fin-reds", ["--red"]);
    expect(noSummary.exitCode, noSummary.text).toBe(4);
    expect(noSummary.text).toContain("ac:AC-FX-NOSUMMARY");
    expect((await rowsOf(silent)).length).toBe(silentBefore);
  });

  it("AC-DCS1-17: --red on a code task with red_required false, and on a check task, is red-not-required naming the reason and records nothing", async () => {
    useConfig(PASS_CONFIG);
    const plan = await fixture.createPlan("Red not required plan");
    const waived = await approvedTask(plan, ONE_ANCHORED, "Red waived", ["AC-FX-RED"], "the change adds no test");
    const tree = addWorktree("red-waived");
    await claimOn(waived, tree, "dcs1-fin-redw");
    commitIn(tree, { "src/m.ts": "export const m = 1;\n" });
    const waivedBefore = (await rowsOf(waived)).length;
    const refused = await finishIn(tree, waived, "dcs1-fin-redw", ["--red"]);
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("red-not-required");
    expect(refused.text).toContain("the change adds no test");
    expect((await rowsOf(waived)).length).toBe(waivedBefore);

    const check = await fixture.createTask({ plan, kind: "check", title: "Red check task", acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", check]);
    const checkBefore = (await rowsOf(check)).length;
    const checkRefused = await loreIn(fixture.dir, ["finish", check, "--red"], sessionEnv("dcs1-fin-redc"));
    expect(checkRefused.exitCode, checkRefused.text).toBe(4);
    expect(checkRefused.text).toContain("red-not-required");
    expect((await rowsOf(check)).length).toBe(checkBefore);
  });
});

describe("AC-DCS1-18: a finished claim keeps its lease only while the branch tip equals the finished commit", () => {
  /** A finished claim on a fresh branch; returns what the cases below act on. */
  async function finishedTask(label: string, session: string): Promise<{ slug: string; tree: Tree; plan: string; head: string }> {
    useConfig(PASS_CONFIG);
    const plan = await fixture.createPlan(`Finished ${label} plan`);
    const slug = await approvedTask(plan, ONE_ANCHORED, `Finished ${label}`, ["AC-FX-1"]);
    const tree = addWorktree(label);
    await claimOn(slug, tree, session);
    const head = commitIn(tree, { [`src/${label}.ts`]: `export const ${label} = 1;\n` });
    await redIn(tree, slug, session);
    const finished = await finishIn(tree, slug, session);
    expect(finished.exitCode, finished.text).toBe(0);
    return { slug, tree, plan, head };
  }

  it("AC-DCS1-18: another run's claim exits 5 CLAIM_CONFLICT naming finished and lore done, even when the lease is older than its ttl; --steal takes it", async () => {
    const { slug } = await finishedTask("conflict", "dcs1-fin-own-a");
    const young = await loreIn(fixture.dir, ["claim", slug], sessionEnv("dcs1-fin-other-a"));
    expect(young.exitCode, young.text).toBe(5);
    expect(young.text).toContain("finished");
    expect(young.text).toContain("lore done");

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 3 * 60 * 60 * 1000));
      const old = await loreIn(fixture.dir, ["claim", slug], sessionEnv("dcs1-fin-other-a"));
      expect(old.exitCode, old.text).toBe(5);
      expect(old.text).toContain("finished");
    } finally {
      vi.useRealTimers();
    }
    const stolen = await loreIn(fixture.dir, ["claim", slug, "--steal"], sessionEnv("dcs1-fin-other-a"));
    expect(stolen.exitCode, stolen.text).toBe(0);
  });

  it("AC-DCS1-18: a later commit makes the claim ordinary again: another run's claim of the stale lease succeeds", async () => {
    const { slug, tree } = await finishedTask("moved", "dcs1-fin-own-b");
    commitIn(tree, { "src/after-finish.ts": "export const after = 1;\n" });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 3 * 60 * 60 * 1000));
      const taken = await loreIn(fixture.dir, ["claim", slug], sessionEnv("dcs1-fin-other-b"));
      expect(taken.exitCode, taken.text).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC-DCS1-18: lore run end keeps a finished claim open and releases the unfinished clean claim of the same run", async () => {
    const session = "dcs1-fin-own-c";
    const { slug } = await finishedTask("runend", session);
    const plan = await fixture.createPlan("Unfinished control plan");
    const control = await approvedTask(plan, ["tests/x-2.test.ts"], "Unfinished control", ["AC-FX-1"]);
    const controlTree = addWorktree("runend-control");
    await claimOn(control, controlTree, session);
    commitIn(controlTree, { "src/control.ts": "export const control = 1;\n" });
    const ended = await loreIn(fixture.dir, ["run", "end", `cc:${session}`, "--reason", "agent stopped"], sessionEnv(session));
    expect(ended.exitCode, ended.text).toBe(0);
    expect(await claimOf(slug)).toBeDefined();
    expect((await claimOf(slug))?.finished_commit).toBeDefined();
    expect(await claimOf(control)).toBeUndefined();
    // the holder run has ended, yet another run still cannot take the finished claim without --steal
    const blocked = await loreIn(fixture.dir, ["claim", slug], sessionEnv("dcs1-fin-other-c"));
    expect(blocked.exitCode, blocked.text).toBe(5);
  });

  it("AC-DCS1-18: a finished claim still blocks an overlapping sibling claim until its commit is folded into the base (exit 4 anchor-overlap)", async () => {
    const { slug, plan } = await finishedTask("overlap", "dcs1-fin-own-d");
    const sibling = await approvedTask(plan, ONE_ANCHORED, "Overlapping sibling", ["AC-FX-1"]);
    const siblingTree = addWorktree("overlap-sibling");
    const blocked = await loreIn(fixture.dir, ["claim", sibling, "--worktree", siblingTree.branch], sessionEnv("dcs1-fin-other-d"));
    expect(blocked.exitCode, blocked.text).toBe(4);
    expect(blocked.text).toContain("anchor-overlap");
    void slug;
  });
});
