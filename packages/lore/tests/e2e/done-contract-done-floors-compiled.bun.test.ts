// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @spawns-external sh excludes the linked-worktree directory from the fixture repository
// @spawns-external git builds, reads and prunes the fixture repository
/**
 * done-contract-done-floors-compiled.bun.test.ts — `lore done`, plan close and `lore archive --apply` judge a task by the
 * contract stored at approve (spec-done-contract-compiled-at-approve-task-kinds-write-sets), observed through the `lore`
 * command tree (`runLoreInProcess`, the function the binary's entry calls) on throwaway repositories and corpora.
 *
 * Holds the criteria of the tasks before and including the one that owns the newest block, so it passes whole at every task's
 * tip. Each test name starts with `AC-DCS1-<n>:` (with the colon).
 *
 *   Task "lore done and plan close read the stored contract; retire --declare-no-new-tests and lore red-first":
 *     AC-DCS1-6  the retired surfaces are gone
 *     AC-DCS1-7  done judges by the stored contract in the fixed floor order, with the evidence rule of AC-DCS1-27 and the
 *                landed-tree evaluation of AC-DCS1-30 (their cases are named AC-DCS1-7 here; the integrate task owns the
 *                AC-DCS1-27 and AC-DCS1-30 blocks that run after integrate records its rows)
 *     AC-DCS1-8  plan close and archive --apply apply the same floors
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the repository's own `.lore/` is never touched.
 * A task is landed through the real `lore integrate` on a real branch in a real linked worktree, so the landing record, the
 * landed tree and the evidence heads are measured by git, never faked.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store";
import { actedStore } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { installShippedGuard } from "../integration/support/main-guard-repo";
import { landWithoutIntegrate } from "../helpers/done-contract-land";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });

/** Commands the fixture contract runs; each prints a runner summary so a capture records a real attested run. */
const FIXTURE_CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" } as const;
const AC_COMMAND = "echo fx1";
const TYPECHECK = "echo typecheck-ok";
// reason: a captured red run must carry a recognised runner summary reporting at least one failed test (BR-1077).
const RED_COMMAND = "sh -c 'printf \" Test Files  1 failed (1)\\n      Tests  1 failed (1)\\n\"; exit 1'";
/** Test files that exist on main at the start of every scenario, so a branch can delete them. */
const SEED_FILES = ["tests/seed-removed.test.ts", "tests/seed-elsewhere.test.ts"] as const;

let fixture: DoneContractFixture;
let sequence = 0;
let worktreeRoot = "";

beforeAll(async () => {
  fixture = await makeDoneContractFixture({ seedDoneContractConfig: false });
  fixture.setDoneContractConfig(FIXTURE_CONFIG);
  // reason: the claim gate wants an approved spec, the plan-close gate wants approved plans and the integrate floor runs a
  // project command; none of those is this file's subject.
  patchLoreConfig(fixture.dir, {
    workflow: {
      gates: { "task-claim": { enabled: false }, "plan-close": { enabled: false }, "plan-promote": { enabled: false } },
      integrate: { floor_command: "true" },
    },
  });
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  mkdirSync(join(fixture.dir, "tests"), { recursive: true });
  for (const file of SEED_FILES) writeFileSync(join(fixture.dir, file), "// seed\n");
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", "seed test files"]);
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs1-guard-")), "hooks"));
  fixture.git(["checkout", "-q", "--detach", "main"]);
  worktreeRoot = mkdtempSync(join(tmpdir(), "dcs1-wt-"));
});

afterAll(() => {
  fixture.dispose();
  rmSync(worktreeRoot, { recursive: true, force: true });
});

/** One lore call with an explicit working directory (a linked worktree records ITS head) and optional extra environment. */
async function loreIn(
  cwd: string,
  args: readonly string[],
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; text: string }> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, ...extraEnv, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

interface Built {
  readonly slug: string;
  readonly plan: string;
  readonly branch: string;
  readonly worktree: string;
  /** The anchored test file the task commits. */
  readonly file: string;
}

interface BuildOptions {
  readonly plan?: string;
  readonly anchors?: readonly string[];
  readonly acScope?: readonly string[];
  readonly redWaiver?: string;
  /** Files committed on the branch (path -> content), the task's work. Default: the anchored test file. */
  readonly files?: Readonly<Record<string, string>>;
  /** Deletions committed on the branch. */
  readonly deletes?: readonly string[];
}

let sharedPlan: string | undefined;

/**
 * One plan for every task whose test is not about the plan: each task anchors its own files, so tasks of one plan never
 * overlap, and the plan is built once instead of once per test (a `lore create plan` costs a corpus write each).
 */
async function sharedPlanSlug(): Promise<string> {
  sharedPlan ??= await newPlan("Shared floors plan");
  return sharedPlan;
}

async function newPlan(title: string): Promise<string> {
  return fixture.createPlan(`${title} ${(sequence += 1)}`);
}

/** Creates, approves and claims a code task on a fresh branch in a linked worktree, and commits its work there. */
async function buildBranchTask(options: BuildOptions = {}): Promise<Built> {
  sequence += 1;
  const planSlug = options.plan ?? (await sharedPlanSlug());
  const file = `tests/c-${sequence}.test.ts`;
  const anchors = options.anchors ?? [file];
  const slug = await fixture.createTask({ plan: planSlug, kind: "code", title: `Floors task ${sequence}`, anchors, acScope: options.acScope ?? ["AC-FX-1"] });
  await fixture.mustRun(["approve", slug, ...(options.redWaiver !== undefined ? ["--red-waiver", options.redWaiver] : [])]);
  const branch = `dcs1-branch-${sequence}`;
  const worktree = join(worktreeRoot, `wt-${sequence}`);
  fixture.git(["worktree", "add", "-q", "-b", branch, worktree, "main"]);
  const claimed = await fixture.run(["claim", slug, "--worktree", branch]);
  if (claimed.exitCode !== 0) throw new Error(`claim failed: ${claimed.stderr}${claimed.stdout}`);
  const built: Built = { slug, plan: planSlug, branch, worktree, file };
  commitIn(built, options.files ?? { [file]: "// test\n" }, options.deletes ?? []);
  return built;
}

function wtGit(built: Built, args: string[]): string {
  return execFileSync("git", args, { cwd: built.worktree, encoding: "utf8" }).trim();
}

/** Commits `files` and `deletes` on the task's branch in its worktree. */
function commitIn(built: Built, files: Readonly<Record<string, string>>, deletes: readonly string[] = []): void {
  wtGit(built, ["config", "user.email", "fixture@example.invalid"]);
  wtGit(built, ["config", "user.name", "fixture"]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(built.worktree, path)), { recursive: true });
    writeFileSync(join(built.worktree, path), content);
  }
  for (const path of deletes) wtGit(built, ["rm", "-q", path]);
  wtGit(built, ["add", "-A"]);
  wtGit(built, ["commit", "-q", "-m", `work ${sequence}`]);
}

/** A runner-attested pass of `command` taken inside the task's worktree (its head is the branch tip). */
async function capturePassIn(cwd: string, slug: string, command: string, extra: readonly string[] = []): Promise<void> {
  const out = await loreIn(cwd, ["evidence", slug, "--oracle", "test", "--command", command, "--result", "pass", "--capture", ...extra]);
  if (out.exitCode !== 0) throw new Error(`capture pass failed for ${command}: ${out.stderr}${out.stdout}`);
}

async function captureRedIn(cwd: string, slug: string): Promise<void> {
  const out = await loreIn(cwd, ["evidence", slug, "--oracle", "test", "--command", RED_COMMAND, "--result", "expected-fail", "--capture"]);
  if (out.exitCode !== 0) throw new Error(`capture red failed: ${out.stderr}${out.stdout}`);
}

type Skippable = "red" | "ac" | "file" | "typecheck";

/**
 * Records the evidence of the standard contract (red run, the AC, the anchored test file, typecheck) from `cwd`: the task's
 * worktree by default (the rows then run on the branch tip), or the shared checkout once the branch has landed (the rows then
 * run on a commit whose tree is the landed tree).
 */
async function recordStandard(built: Built, skip: readonly Skippable[] = [], cwd: string = built.worktree): Promise<void> {
  if (!skip.includes("red")) await captureRedIn(cwd, built.slug);
  if (!skip.includes("ac")) await capturePassIn(cwd, built.slug, AC_COMMAND, ["--ac", "AC-FX-1"]);
  if (!skip.includes("file")) await capturePassIn(cwd, built.slug, `echo Ran 1 tests in ${built.file}`);
  if (!skip.includes("typecheck")) await capturePassIn(cwd, built.slug, TYPECHECK);
}

/**
 * Lands the branch on main the way a landing leaves it (a merge commit and the landing record), without `lore integrate`:
 * integrate runs the contract oracles and records attested rows, which would put the evidence into the very state the done
 * floors under test are about. Integrate's own behaviour is tested in `done-contract-integrate-compiled.bun.test.ts`.
 */
async function integrate(built: Built): Promise<void> {
  await landWithoutIntegrate(fixture, built.branch);
}

/**
 * A landed standard task whose evidence was recorded AFTER the landing, at the shared checkout (a commit whose tree is the
 * landed tree). `lore integrate` archives a task whose floors are all met at the landing, so a test of `lore done` itself
 * records its rows after it.
 */
async function landedStandard(options: BuildOptions & { skip?: readonly Skippable[] } = {}): Promise<Built> {
  const built = await buildBranchTask(options);
  await integrate(built);
  await recordStandard(built, options.skip ?? [], fixture.dir);
  return built;
}

async function statusOf(slug: string): Promise<string> {
  return (await fixture.readTask(slug)).status;
}

/** A run's stderr without the fixture config's deprecation advisory (a line about `workflow.gates`, not about the command). */
function commandStderr(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.startsWith("lore: workflow.gates."))
    .join("\n")
    .trim();
}

/** Runs `lore done` and checks the refusal: exit 4, the floor named, the task still open. */
async function expectFloor(slug: string, floor: string, ...needles: string[]): Promise<string> {
  const before = await fixture.readTask(slug);
  const out = await fixture.run(["done", slug]);
  const text = `${out.stdout}\n${out.stderr}`;
  expect(out.exitCode, text).toBe(4);
  expect(text).toContain(`[floor: ${floor}]`);
  for (const needle of needles) expect(text, needle).toContain(needle);
  const after = await fixture.readTask(slug);
  expect(after.status).toBe(before.status);
  expect(after.version).toBe(before.version);
  return text;
}

describe("AC-DCS1-6: the retired surfaces are gone", () => {
  it("AC-DCS1-6: lore done --declare-no-new-tests and lore approve --declare-no-new-tests exit 2 with the generic unknown-option message and write nothing", async () => {
    const built = await landedStandard({ skip: ["red"] });
    const before = await fixture.readTask(built.slug);
    const reason = "adds no test";

    const retired = await fixture.run(["done", built.slug, "--declare-no-new-tests", reason]);
    const generic = await fixture.run(["done", built.slug, "--no-such-flag-xyz", reason]);
    expect(retired.exitCode, retired.stderr).toBe(2);
    expect(generic.exitCode, generic.stderr).toBe(2);
    expect(retired.stderr).toContain("--declare-no-new-tests");
    // The same message as any unknown option, with only the flag's name different.
    expect(commandStderr(retired.stderr).split("--declare-no-new-tests").join("<flag>")).toBe(commandStderr(generic.stderr).split("--no-such-flag-xyz").join("<flag>"));
    expect(retired.stdout).toBe("");

    const draft = await fixture.createTask({ plan: await sharedPlanSlug(), kind: "code", title: "Approve retired flag" });
    const approveBefore = await fixture.readTask(draft);
    const approve = await fixture.run(["approve", draft, "--declare-no-new-tests", reason]);
    const approveGeneric = await fixture.run(["approve", draft, "--no-such-flag-xyz", reason]);
    expect(approve.exitCode, approve.stderr).toBe(2);
    expect(commandStderr(approve.stderr).split("--declare-no-new-tests").join("<flag>")).toBe(commandStderr(approveGeneric.stderr).split("--no-such-flag-xyz").join("<flag>"));
    expect(approveGeneric.exitCode, approveGeneric.stderr).toBe(2);

    // Nothing was written by any of the four refused calls.
    expect(await fixture.readTask(built.slug)).toEqual(before);
    expect(await fixture.readTask(draft)).toEqual(approveBefore);
    expect(approveBefore.status).toBe("draft");
  });

  it("AC-DCS1-6: lore red-first <task> exits 1 with the unknown-command message, the same as lore nosuchcmd", async () => {
    const slug = await fixture.createTask({ plan: await sharedPlanSlug(), kind: "code", title: "Red-first retired" });
    const before = await fixture.readTask(slug);
    const retired = await fixture.run(["red-first", slug]);
    const unknown = await fixture.run(["nosuchcmd", slug]);
    expect(retired.exitCode, retired.stderr).toBe(1);
    expect(unknown.exitCode, unknown.stderr).toBe(1);
    expect(commandStderr(retired.stderr).split("red-first").join("<cmd>")).toBe(commandStderr(unknown.stderr).split("nosuchcmd").join("<cmd>"));
    // The old writer would have set extra.red_first; nothing was written.
    expect(await fixture.readTask(slug)).toEqual(before);
    expect(before.extra["red_first"]).toBeUndefined();
  });

  it("AC-DCS1-6: a task archived earlier with the old flag keeps its stored no_new_tests_reason", async () => {
    const slug = await fixture.createTask({ plan: await sharedPlanSlug(), kind: "code", title: "Archived with the old flag" });
    const task = await fixture.readTask(slug);
    const store = actedStore(new SQLiteStore(join(fixture.dir, ".lore", "lore.db")));
    try {
      const appended = await store.appendAuditEntry({
        timestamp: new Date().toISOString(),
        actor: "agent:history",
        session_id: "dcs1-history",
        action: "update",
        doc_id: task.id as never,
        details: { by: "agent:history", status_from: "active", status_to: "archived", done: true, no_new_tests_reason: "legacy reason kept", no_new_tests_declared: true },
      });
      expect(appended.ok).toBe(true);
    } finally {
      store.close();
    }
    const audit = await fixture.run(["audit", slug, "--json"]);
    expect(audit.exitCode, audit.stderr).toBe(0);
    expect(audit.stdout).toContain("legacy reason kept");
    expect(audit.stdout).toContain("no_new_tests_declared");
  });
});

describe("AC-DCS1-7: done judges by the stored contract in the fixed floor order", () => {
  it("AC-DCS1-7: a landed task with every contract oracle passed and a red run archives (exit 0), releases its claim, and never changes the stored red_required", async () => {
    const built = await landedStandard();
    const contractBefore = (await fixture.readTask(built.slug)).extra["done_contract"] as { red_required: boolean };
    expect(contractBefore.red_required).toBe(true);
    expect((await fixture.readTask(built.slug)).extra["claim"]).toBeDefined();

    const out = await fixture.run(["done", built.slug]);
    expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(0);
    const task = await fixture.readTask(built.slug);
    expect(task.status).toBe("archived");
    expect(task.extra["claim"]).toBeUndefined();
    expect((task.extra["done_contract"] as { red_required: boolean }).red_required).toBe(true);
    // The retired no-new-tests record is never written again.
    const audit = await fixture.run(["audit", built.slug, "--json"]);
    expect(audit.stdout).not.toContain("no_new_tests");
  });

  it("AC-DCS1-7: floor not-landed first: a branch with unlanded commits exits 4 [floor: not-landed] even when everything else is missing too", async () => {
    const built = await buildBranchTask();
    const text = await expectFloor(built.slug, "not-landed", built.branch);
    expect(text).not.toContain("[floor: attested-pass]");
  });

  it("AC-DCS1-7: floor missing-oracle-file before attested-pass: a contract test file absent from the landed tree that the task did not delete refuses oracle-file-missing naming the path", async () => {
    // The anchored file is never committed by the branch, and is on no main commit either.
    const missing = "tests/never-written.test.ts";
    const built = await buildBranchTask({ anchors: [missing], files: { "other.txt": "x\n" } });
    await integrate(built);
    const text = await expectFloor(built.slug, "missing-oracle-file", missing, "oracle-file-missing");
    expect(text).not.toContain("[floor: attested-pass]");
  });

  it("AC-DCS1-7: floor attested-pass: a landed task with no runner-attested pass at all exits 4 [floor: attested-pass]", async () => {
    const built = await buildBranchTask();
    await integrate(built);
    await expectFloor(built.slug, "attested-pass");
  });

  it("AC-DCS1-7: floor latest-attested-fail: a criterion whose latest runner result is a fail refuses even with a passing row recorded before", async () => {
    const built = await buildBranchTask();
    await recordStandard(built);
    const failed = await loreIn(built.worktree, ["evidence", built.slug, "--oracle", "test", "--command", RED_COMMAND, "--result", "fail", "--capture", "--ac", "AC-FX-1"]);
    expect(failed.exitCode, failed.text).toBe(0);
    await integrate(built);
    await expectFloor(built.slug, "latest-attested-fail", "AC-FX-1");
  });

  it("AC-DCS1-7: floor red-first: red_required true with no runner-produced red row exits 4 [floor: red-first]; a hand-typed red row does not count", async () => {
    const built = await buildBranchTask();
    await recordStandard(built, ["red"]);
    await integrate(built);
    await expectFloor(built.slug, "red-first");
    const typed = await fixture.run(["evidence", built.slug, "--oracle", "test", "--command", "echo hand-typed", "--result", "expected-fail", "--output-tail", "typed by hand"]);
    expect(typed.exitCode, typed.stderr).toBe(0);
    await expectFloor(built.slug, "red-first");
  });

  it("AC-DCS1-7: red_required false (the approve-time waiver) is accepted without a red run, and done leaves the waiver as stored", async () => {
    const built = await buildBranchTask({ redWaiver: "adds no new behaviour" });
    await recordStandard(built, ["red"]);
    await integrate(built);
    const out = await fixture.run(["done", built.slug]);
    expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(0);
    const contract = (await fixture.readTask(built.slug)).extra["done_contract"] as { red_required: boolean; red_waiver_reason?: string };
    expect(contract.red_required).toBe(false);
    expect(contract.red_waiver_reason).toBe("adds no new behaviour");
  });

  it("AC-DCS1-7: a task that fails both the red run and a whole-file run is refused naming only red-first", async () => {
    const built = await buildBranchTask();
    await recordStandard(built, ["red", "file"]);
    await integrate(built);
    const text = await expectFloor(built.slug, "red-first");
    expect(text).not.toContain("[floor: unfiltered-test-file]");
    expect(text).not.toContain("[floor: contract-oracles]");
  });

  it("AC-DCS1-7: floor unfiltered-test-file: a contract test file with no attested whole-file pass exits 4 [floor: unfiltered-test-file] naming the file", async () => {
    const built = await buildBranchTask();
    await recordStandard(built, ["file"]);
    // A run of ANOTHER file is not the contract's command for this one and does not count.
    await capturePassIn(built.worktree, built.slug, "echo Ran 1 tests in tests/some-other.test.ts");
    await integrate(built);
    await expectFloor(built.slug, "unfiltered-test-file", built.file);
  });

  it("AC-DCS1-7: floor contract-oracles: a missing typecheck pass exits 4 [floor: contract-oracles] naming the oracle, after the red run and the whole-file runs are met", async () => {
    const built = await buildBranchTask();
    await recordStandard(built, ["typecheck"]);
    await integrate(built);
    await expectFloor(built.slug, "contract-oracles", "typecheck");
  });

  it("AC-DCS1-7: the ac oracle is judged by the CURRENT live command of its AC, not the command copied at approve", async () => {
    const built = await landedStandard();
    // The AC's command is rewritten after approve; the pass recorded with the old command no longer proves it.
    await fixture.mustRun(["ac", "set", fixture.spec, "AC-FX-1", "--command", "echo fx1-rewritten"]);
    try {
      await expectFloor(built.slug, "contract-oracles", "AC-FX-1");
      await capturePassIn(fixture.dir, built.slug, "echo fx1-rewritten", ["--ac", "AC-FX-1"]);
      // The new row ran at the shared checkout's head, whose tree is the landed tree, so it counts.
      const out = await fixture.run(["done", built.slug]);
      expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(0);
      expect(await statusOf(built.slug)).toBe("archived");
    } finally {
      await fixture.mustRun(["ac", "set", fixture.spec, "AC-FX-1", "--command", AC_COMMAND]);
    }
  });

  it("AC-DCS1-7: the contract wins over the live fields in both directions (anchor removed after approve still demands the file run; an AC added to the scope after approve is not demanded)", async () => {
    const built = await buildBranchTask();
    await recordStandard(built, ["file"]);
    await integrate(built);
    // Direction 1: the live anchors no longer name the test file, the stored contract still does.
    await fixture.mustRun(["anchor", "rm", built.slug, built.file]);
    await expectFloor(built.slug, "unfiltered-test-file", built.file);
    // Direction 2: a live scope id the contract never held adds no demand.
    await fixture.mustRun(["scope", "add", built.slug, "AC-FX-AI"]);
    await capturePassIn(fixture.dir, built.slug, `echo Ran 1 tests in ${built.file}`);
    const out = await fixture.run(["done", built.slug]);
    expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(0);
    expect(await statusOf(built.slug)).toBe("archived");
  });

  it("AC-DCS1-7: floor foreign-claim is last: a fresh claim of another run refuses [floor: foreign-claim] after every other floor is met", async () => {
    const built = await landedStandard();
    const before = await fixture.readTask(built.slug);
    const out = await loreIn(fixture.dir, ["done", built.slug], { LORE_HARNESS_RUN: "cc:another-run", CLAUDE_CODE_SESSION_ID: "another-session" });
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("[floor: foreign-claim]");
    expect(await fixture.readTask(built.slug)).toEqual(before);
  });

  it("AC-DCS1-7: a task that never ran finish is judged by the same floors: a draft task holding no contract is refused, never judged by its fields", async () => {
    const slug = await fixture.createTask({ plan: await sharedPlanSlug(), kind: "code", title: "Draft never approved", acScope: [] });
    await capturePassIn(fixture.dir, slug, TYPECHECK);
    const out = await fixture.run(["done", slug]);
    expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(4);
    expect(`${out.stdout}${out.stderr}`).toContain("done contract");
    expect(`${out.stdout}${out.stderr}`).toContain("lore approve");
    expect((await fixture.readTask(slug)).status).toBe("draft");
  });
});

describe("AC-DCS1-7: evidence binds to the code (the rule AC-DCS1-27 states)", () => {
  it("AC-DCS1-7: a row recorded on a tree that differs from the landed tree exits 4 [floor: attested-pass] with the cause evidence-stale naming the changed paths", async () => {
    const built = await buildBranchTask();
    await recordStandard(built);
    // A commit after the rows: the landed tree is no longer the tree the rows ran on.
    commitIn(built, { "after-the-run.txt": "changed after the evidence\n" });
    await integrate(built);
    await expectFloor(built.slug, "attested-pass", "evidence-stale", "after-the-run.txt");
  });

  it("AC-DCS1-7: a row whose commit git cannot read exits 4 [floor: attested-pass] with the cause evidence-unmeasurable, never a pass", async () => {
    const built = await buildBranchTask();
    commitIn(built, { "doomed.txt": "this commit disappears\n" });
    await recordStandard(built);
    // The commit the rows ran on is dropped and its object pruned; the branch lands without it.
    wtGit(built, ["reset", "-q", "--hard", "HEAD~1"]);
    execFileSync("git", ["reflog", "expire", "--expire=now", "--all"], { cwd: fixture.dir });
    execFileSync("git", ["prune", "--expire=now"], { cwd: fixture.dir });
    await integrate(built);
    await expectFloor(built.slug, "attested-pass", "evidence-unmeasurable");
  });

  it("AC-DCS1-7: a task with no landing record exits 4 [floor: attested-pass] with the cause evidence-unmeasurable even when it holds attested passes", async () => {
    const slug = await fixture.createTask({ plan: await sharedPlanSlug(), kind: "code", title: "Never landed", anchors: [], acScope: [] });
    await fixture.mustRun(["approve", slug, "--red-waiver", "nothing to run red"]);
    await capturePassIn(fixture.dir, slug, TYPECHECK);
    await expectFloor(slug, "attested-pass", "evidence-unmeasurable");
  });

  it("AC-DCS1-7: B need not be an ancestor of L: rows taken on a later commit with the same tree count", async () => {
    const built = await buildBranchTask();
    await integrate(built);
    // A later commit whose tree is the landed tree (empty commit): the rows are taken there, none on the branch.
    fixture.git(["commit", "-q", "--allow-empty", "-m", "same tree, later commit"]);
    for (const [command, extra] of [[RED_COMMAND, []], [AC_COMMAND, ["--ac", "AC-FX-1"]], [`echo Ran 1 tests in ${built.file}`, []], [TYPECHECK, []]] as const) {
      if (command === RED_COMMAND) await captureRedIn(fixture.dir, built.slug);
      else await capturePassIn(fixture.dir, built.slug, command, extra);
    }
    const out = await fixture.run(["done", built.slug]);
    expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(0);
    expect(await statusOf(built.slug)).toBe("archived");
    fixture.git(["checkout", "-q", "--detach", "main"]);
  });

  it("AC-DCS1-7: a re-claim voids nothing: rows recorded before the latest claim still count", async () => {
    const built = await landedStandard();
    // A fix-up claim of the same task on a new branch cut from main, after the rows were recorded.
    const branch = `dcs1-fixup-${sequence}`;
    const worktree = join(worktreeRoot, `fixup-${sequence}`);
    fixture.git(["worktree", "add", "-q", "-b", branch, worktree, "main"]);
    const reclaimed = await fixture.run(["claim", built.slug, "--worktree", branch]);
    expect(reclaimed.exitCode, reclaimed.stderr).toBe(0);
    const out = await fixture.run(["done", built.slug]);
    expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(0);
    expect(await statusOf(built.slug)).toBe("archived");
  });
});

describe("AC-DCS1-7: the contract is evaluated against the landed tree (the rule AC-DCS1-30 states)", () => {
  it("AC-DCS1-7: a test file the landing deleted leaves the oracle set with a recorded reason, a done line and a Removed oracles section; the task is judged on the rest", async () => {
    const removed = SEED_FILES[0];
    const built = await buildBranchTask({ anchors: [removed], files: { "unrelated.txt": "x\n" }, deletes: [removed] });
    await integrate(built);
    await recordStandard(built, ["file"], fixture.dir);
    const out = await fixture.run(["done", built.slug]);
    expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(0);
    expect(out.stdout).toContain(removed);
    expect(out.stdout).toMatch(/removed/i);
    const task = await fixture.readTask(built.slug);
    const contract = task.extra["done_contract"] as { oracles: Array<{ id: string }>; removed_oracles?: Array<{ id: string; path: string; reason: string; landed_commit: string }> };
    // The contract oracle list is never shortened.
    expect(contract.oracles.map((o) => o.id)).toContain(`test:${removed}`);
    expect(contract.removed_oracles).toHaveLength(1);
    const entry = contract.removed_oracles![0]!;
    expect(entry.id).toBe(`test:${removed}`);
    expect(entry.path).toBe(removed);
    expect(entry.reason.length).toBeGreaterThan(0);
    expect(entry.landed_commit).toBe((task.extra["landing"] as { landing_commit: string }).landing_commit);
    const shown = await fixture.mustRun(["get", built.slug]);
    expect(shown).toContain("Removed oracles");
    expect(shown).toContain(removed);
  });

  it("AC-DCS1-7: a test file absent from the landed tree that the diff did NOT delete refuses only the task that anchors it, exit 4 oracle-file-missing naming the path", async () => {
    const gone = SEED_FILES[1];
    // Two tasks cut from the same main: one deletes the file and lands first, the other never touched it.
    // reason: both anchor the same file, so they live in plans of their own (tasks of one plan may not overlap on an anchor).
    const deleter = await buildBranchTask({ plan: await newPlan("Deleter plan"), anchors: [gone], files: { "deleter.txt": "x\n" }, deletes: [gone] });
    const bystander = await buildBranchTask({ plan: await newPlan("Bystander plan"), anchors: [gone], files: { "bystander.txt": "x\n" } });
    // The bystander's claim is released so the deleter's change of the file it anchors is not held (BR-1346); its branch
    // still lands afterwards, and its claim history still names it.
    await fixture.mustRun(["release", bystander.slug]);
    await integrate(deleter);
    await recordStandard(deleter, ["file"], fixture.dir);
    await integrate(bystander);
    await recordStandard(bystander, ["file"], fixture.dir);

    const fine = await fixture.run(["done", deleter.slug]);
    expect(fine.exitCode, `${fine.stdout}${fine.stderr}`).toBe(0);
    await expectFloor(bystander.slug, "missing-oracle-file", gone, "oracle-file-missing");
    const stillOpen = await fixture.readTask(bystander.slug);
    expect((stillOpen.extra["done_contract"] as { removed_oracles?: unknown[] }).removed_oracles).toBeUndefined();
  });
});

describe("AC-DCS1-7: an ac oracle resolves across the plan's parent spec and every spec it implements", () => {
  /** A second spec with one script criterion, linked to `planSlug` with `implements`. */
  async function implementedSpec(planSlug: string, acId: string, command: string): Promise<string> {
    const spec = (await fixture.mustRun(["create", "spec", "--title", `Implemented ${acId} ${(sequence += 1)}`, "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"])).match(/Slug:\s+(\S+)/)![1]!;
    await fixture.mustRun(["ac", "add", spec, acId, "--statement", "Implemented criterion.", "--mode", "script", "--oracle", "test", "--command", command]);
    await fixture.mustRun(["link", planSlug, spec, "--type", "implements"]);
    return spec;
  }

  /** Lands a task scoped to `acId`, then records every oracle except the AC (whose command the caller records or withholds). */
  async function landedForAc(planSlug: string, acId: string): Promise<Built> {
    const built = await buildBranchTask({ plan: planSlug, acScope: [acId] });
    await integrate(built);
    await recordStandard(built, ["ac"], fixture.dir);
    return built;
  }

  it("AC-DCS1-7: an AC declared only by an implements-linked spec resolves there: its live command is judged, and the task archives", async () => {
    const planSlug = await newPlan("Implements plan");
    await implementedSpec(planSlug, "AC-IMPL-1", "echo impl1");
    const built = await landedForAc(planSlug, "AC-IMPL-1");
    await expectFloor(built.slug, "contract-oracles", "AC-IMPL-1", "echo impl1");
    await capturePassIn(fixture.dir, built.slug, "echo impl1");
    const out = await fixture.run(["done", built.slug]);
    expect(out.exitCode, `${out.stdout}${out.stderr}`).toBe(0);
    expect(await statusOf(built.slug)).toBe("archived");
  });

  it("AC-DCS1-7: an AC declared by two specs of the plan is refused with the cause ac-oracle-ambiguous naming both specs", async () => {
    const planSlug = await newPlan("Ambiguous plan");
    const other = await implementedSpec(planSlug, "AC-FX-1", "echo fx1-other");
    const built = await landedForAc(planSlug, "AC-FX-1");
    await capturePassIn(fixture.dir, built.slug, AC_COMMAND, ["--ac", "AC-FX-1"]);
    await expectFloor(built.slug, "contract-oracles", "ac-oracle-ambiguous", fixture.spec, other);
  });

  it("AC-DCS1-7: an AC declared by no spec of the plan is refused with the unresolved cause naming the criterion", async () => {
    const planSlug = await newPlan("Absent plan");
    const spec = await implementedSpec(planSlug, "AC-GONE-9", "echo gone9");
    const built = await landedForAc(planSlug, "AC-GONE-9");
    await fixture.mustRun(["ac", "rm", spec, "AC-GONE-9"]);
    await expectFloor(built.slug, "contract-oracles", "AC-GONE-9", "no governing spec declares this criterion");
  });
});

describe("AC-DCS1-8: plan close and archive --apply judge each member by the same stored-contract floors", () => {
  /** Approves the plan (so it can be closed) and returns the slug. */
  async function closablePlan(): Promise<string> {
    const planSlug = await newPlan("Closable plan");
    await fixture.mustRun(["set", planSlug, "--status", "approved"]);
    return planSlug;
  }

  /** A landed standard task with its claim released: plan close never touches a freshly claimed member (BR-1072). */
  async function landedReleased(options: BuildOptions & { skip?: readonly Skippable[] }): Promise<Built> {
    const built = await landedStandard(options);
    await fixture.mustRun(["release", built.slug]);
    return built;
  }

  it("AC-DCS1-8: plan close archives the member that meets its contract and skips the one with no red run, naming red-first in the Cascade skipped line and in --json", async () => {
    const planSlug = await closablePlan();
    const met = await landedReleased({ plan: planSlug });
    const unmet = await landedReleased({ plan: planSlug, skip: ["red"] });
    const openBefore = await fixture.readTask(unmet.slug);
    const closed = await fixture.run(["set", planSlug, "--status", "archived"]);
    expect(closed.exitCode, `${closed.stdout}${closed.stderr}`).toBe(0);
    expect(closed.stdout).toContain(`Cascade archived: ${met.slug}`);
    expect(closed.stdout).toContain(`Cascade skipped: ${unmet.slug} (red-first)`);
    expect(await statusOf(met.slug)).toBe("archived");
    // Read back unchanged: skipped means untouched.
    const open = await fixture.readTask(unmet.slug);
    expect(open.status).not.toBe("archived");
    expect(open.version).toBe(openBefore.version);
  });

  it("AC-DCS1-8: the --json of the plan close carries the floor of each skipped member", async () => {
    const planSlug = await closablePlan();
    const unmet = await landedReleased({ plan: planSlug, skip: ["red"] });
    const closed = await fixture.run(["set", planSlug, "--status", "archived", "--json"]);
    expect(closed.exitCode, `${closed.stdout}${closed.stderr}`).toBe(0);
    const payload = JSON.parse(closed.stdout) as { data: { cascade?: { skipped: Array<{ slug: string; floor?: string }> } } };
    const skipped = payload.data.cascade?.skipped ?? [];
    expect(skipped.map((s) => [s.slug, s.floor])).toEqual([[unmet.slug, "red-first"]]);
  });

  it("AC-DCS1-8: a member whose contract oracle was never passed is skipped with contract-oracles, not archived", async () => {
    const planSlug = await closablePlan();
    const unmet = await landedReleased({ plan: planSlug, skip: ["typecheck"] });
    const closed = await fixture.run(["set", planSlug, "--status", "archived"]);
    expect(closed.exitCode, `${closed.stdout}${closed.stderr}`).toBe(0);
    expect(closed.stdout).toContain(`Cascade skipped: ${unmet.slug} (contract-oracles)`);
    expect(await statusOf(unmet.slug)).toBe("approved");
  });

  it("AC-DCS1-8: lore archive --apply archives a straggler once its contract is met and skips the ones that still miss a floor", async () => {
    const planSlug = await closablePlan();
    const late = await landedReleased({ plan: planSlug, skip: ["red"] });
    const never = await landedReleased({ plan: planSlug, skip: ["red"] });
    const closed = await fixture.run(["set", planSlug, "--status", "archived"]);
    expect(closed.exitCode, `${closed.stdout}${closed.stderr}`).toBe(0);
    expect(closed.stdout).toContain(`Cascade skipped: ${late.slug} (red-first)`);
    // One straggler gets its red run afterwards; the other stays without.
    await captureRedIn(fixture.dir, late.slug);

    const applied = await fixture.run(["archive", "--apply"]);
    expect(applied.exitCode, `${applied.stdout}${applied.stderr}`).toBe(0);
    expect(applied.stdout).toContain(`[OK] ${late.slug}`);
    expect(applied.stdout).toContain(`[SKIPPED] ${never.slug} — refused by red-first`);
    expect(await statusOf(late.slug)).toBe("archived");
    expect(await statusOf(never.slug)).toBe("approved");

    const json = await fixture.run(["archive", "--apply", "--json"]);
    expect(json.exitCode, json.stderr).toBe(0);
    expect(json.stdout).toContain('"floor": "red-first"');
  });
});
