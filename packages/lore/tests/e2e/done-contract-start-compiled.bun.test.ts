// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-start-compiled.bun.test.ts — `lore start` creates the worktree on the contract base, installs, claims and prints
 * the contract (spec-done-contract-compiled-at-approve-task-kinds-write-sets), observed through the `lore` command tree
 * (`runLoreInProcess`, the function the binary's entry calls) on a throwaway repository and corpus.
 *
 * Each test name starts with `AC-DCS1-<n>:` (with the colon), so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10.
 *
 *   Task "lore start creates the worktree on the contract base, installs, claims and prints the contract":
 *     AC-DCS1-13  start branches from the contract base (integration branch when declared), installs, claims, prints the contract
 *     AC-DCS1-14  start checks the lease first and leaves nothing behind; claim refuses what has no claim or no own branch
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the repository's own `.lore/` is never touched.
 * A second run is another `CLAUDE_CODE_SESSION_ID`, which the in-process runner registers as its own run.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let fixture: DoneContractFixture;
let scratch = "";
let sequence = 0;
let planMain = "";
let planInteg = "";
let integTip = "";
let mainTip = "";
const INTEG = "dcs1-start-integ";

const sessionEnv = (session: string): Record<string, string> => ({ CLAUDE_CODE_SESSION_ID: session });

beforeAll(async () => {
  fixture = await makeDoneContractFixture();
  patchLoreConfig(fixture.dir, { workflow: { gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } } } });
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  scratch = mkdtempSync(join(tmpdir(), "dcs1-start-"));
  // The integration branch is one commit ahead of main (a task before this one already landed on it).
  const side = join(scratch, "integ-side");
  // declaring the branch creates it at main's tip (AC-DCS2-10); the earlier task's commit is then made on it
  planInteg = await fixture.createPlan("Start plan with integration branch", INTEG);
  fixture.git(["worktree", "add", "-q", side, INTEG]);
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: side });
  execFileSync("git", ["config", "user.name", "fixture"], { cwd: side });
  writeFileSync(join(side, "earlier-task.txt"), "earlier task\n");
  execFileSync("git", ["add", "-A"], { cwd: side });
  execFileSync("git", ["commit", "-q", "-m", "earlier task"], { cwd: side });
  fixture.git(["worktree", "remove", side]);
  integTip = fixture.git(["rev-parse", INTEG]);
  mainTip = fixture.git(["rev-parse", "main"]);
  planMain = await fixture.createPlan("Start plan on main");
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

async function loreIn(cwd: string, args: readonly string[], session = "start-orchestrator"): Promise<Out> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, ...sessionEnv(session), HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

interface ClaimShape {
  readonly branch?: string;
  readonly worktree?: string;
  readonly write_set?: readonly string[];
}

const claimOf = async (slug: string): Promise<ClaimShape | undefined> => (await fixture.readTask(slug)).extra["claim"] as ClaimShape | undefined;

const worktreeList = (): string => fixture.git(["worktree", "list", "--porcelain"]);
const branchList = (): string => fixture.git(["branch", "--list", "--format=%(refname:short)"]);
const worktreePathOf = (slug: string): string => join(fixture.dir, ".claude", "worktrees", slug);

/** Sets the contract commands, then creates and approves a task of `kind`; the install command is copied into its contract. */
async function approvedTask(plan: string, kind: "code" | "check" | "corpus", install = "echo install-ok"): Promise<string> {
  fixture.setDoneContractConfig({ install, typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" });
  sequence += 1;
  const slug = await fixture.createTask({ plan, kind, title: `Start ${kind} task ${sequence}`, acScope: kind === "corpus" ? [] : ["AC-FX-1"] });
  await fixture.mustRun(kind === "code" ? ["approve", slug, "--red-waiver", "fixture: the start tests add no test"] : ["approve", slug]);
  return slug;
}

/** Leaves an approved task with no kind and no contract (the shape of a task approved before kinds), through the service layer: approve now refuses it. */
async function stripKindAndContractThroughStore(slug: string): Promise<void> {
  const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const found = await app.corpusService.get(slug);
    if (!found.ok) throw new Error(`seed: ${slug} not found: ${JSON.stringify(found.error)}`);
    const doc = found.value.doc;
    const { kind: _kind, done_contract: _contract, ...rest } = doc.extra as Record<string, unknown>;
    const written = await app.corpusService.writeDoc({
      doc,
      patch: { extra: rest },
      action: "update",
      changeSummary: "fixture: a task approved before kinds existed",
      auditAction: "update",
      auditDetails: { operation: "fixture-kindless" },
      lock: "none",
      by: doc.created_by,
      now: new Date().toISOString(),
    });
    if (!written.ok) throw new Error(`seed: strip failed: ${JSON.stringify(written.error)}`);
  } finally {
    app.close();
  }
}

const startFrom = (cwd: string, slug: string, session: string, extra: readonly string[] = []): Promise<Out> => loreIn(cwd, ["start", slug, ...extra], session);

describe("lore start creates the worktree on the contract base, installs, claims and prints the contract", () => {
  it("AC-DCS1-13: start branches from the contract base, runs the install, claims with worktree and write set, prints the contract", async () => {
    const marker = join(scratch, "install-marker-main");
    const slug = await approvedTask(planMain, "code", `sh -c 'echo ran > ${marker}'`);
    const before = worktreeList();
    const out = await startFrom(fixture.dir, slug, "start-s13a", ["--write-set", "tests/x-1.test.ts", "--write-set", "src/"]);
    expect(out.exitCode, out.text).toBe(0);

    const path = worktreePathOf(slug);
    expect(existsSync(path)).toBe(true);
    expect(worktreeList()).not.toBe(before);
    expect(execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: path, encoding: "utf8" }).trim()).toBe(`task/${slug}`);
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf8" }).trim()).toBe(mainTip);
    // The install ran in the worktree, shown by the marker it wrote.
    expect(readFileSync(marker, "utf8").trim()).toBe("ran");

    const claim = await claimOf(slug);
    expect(claim?.branch).toBe(`task/${slug}`);
    expect(realpathSync(claim?.worktree ?? "/nonexistent")).toBe(realpathSync(path));
    expect([...(claim?.write_set ?? [])].sort()).toEqual(["src/", "tests/x-1.test.ts"]);

    // The printed contract is the stored one: oracles, red requirement, base and landing route.
    const stored = (await fixture.readTask(slug)).extra["done_contract"] as { oracles: { id: string }[]; red_required: boolean; base_branch: string; landing_route: string };
    for (const oracle of stored.oracles) expect(out.stdout).toContain(oracle.id);
    expect(out.stdout).toContain("ac:AC-FX-1");
    expect(out.stdout).toContain("typecheck");
    expect(stored.red_required).toBe(false);
    expect(out.stdout).toMatch(/no \(waived/);
    expect(out.stdout).toContain(`on ${stored.base_branch}`);
    expect(out.stdout).toContain(stored.landing_route);
    expect(out.stdout).toContain(path);
  });

  it("AC-DCS1-13: with an integration branch declared, the worktree is cut at that branch's tip, not at main", async () => {
    const marker = join(scratch, "install-marker-integ");
    const slug = await approvedTask(planInteg, "code", `sh -c 'echo ran > ${marker}'`);
    const out = await startFrom(fixture.dir, slug, "start-s13b");
    expect(out.exitCode, out.text).toBe(0);
    const path = worktreePathOf(slug);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf8" }).trim();
    expect(integTip).not.toBe(mainTip);
    expect(head).toBe(integTip);
    expect(head).not.toBe(mainTip);
    expect(existsSync(join(path, "earlier-task.txt"))).toBe(true);
    expect(readFileSync(marker, "utf8").trim()).toBe("ran");
    const stored = (await fixture.readTask(slug)).extra["done_contract"] as { base_branch: string; landing_route: string };
    expect(stored.base_branch).toBe(INTEG);
    expect(out.stdout).toContain(`on ${INTEG}`);
    expect(out.stdout).toContain("integration-branch");
    // BR-1353 as modified: the claim of a worktree whose extra commits are all on the integration branch was accepted.
    expect((await claimOf(slug))?.branch).toBe(`task/${slug}`);
  });

  it("AC-DCS1-13: a start from a linked worktree of the repository still creates the worktree under the shared checkout", async () => {
    const slug = await approvedTask(planMain, "code");
    const other = join(scratch, "elsewhere");
    fixture.git(["worktree", "add", "-q", "--detach", other, "main"]);
    const out = await startFrom(other, slug, "start-s13c");
    expect(out.exitCode, out.text).toBe(0);
    expect(existsSync(worktreePathOf(slug))).toBe(true);
    fixture.git(["worktree", "remove", other]);
  });

  it("AC-DCS1-14: a task held by a fresh claim of another run exits 5 naming the holder, before any worktree is made", async () => {
    const slug = await approvedTask(planMain, "code");
    const first = await startFrom(fixture.dir, slug, "start-s14-holder");
    expect(first.exitCode, first.text).toBe(0);
    const before = worktreeList();
    const branchesBefore = branchList();
    // The default worktree already exists too: the lease is checked FIRST, so this is 5, not worktree-exists (4).
    const second = await startFrom(fixture.dir, slug, "start-s14-other");
    expect(second.exitCode, second.text).toBe(5);
    expect(second.text).toContain("is claimed by");
    expect(second.text).toContain("start-s14-holder");
    expect(worktreeList()).toBe(before);
    expect(branchList()).toBe(branchesBefore);
    expect(existsSync(worktreePathOf(slug))).toBe(true);
  });

  it("AC-DCS1-14: a task that is not approved exits 4 not-approved naming lore approve, creating nothing", async () => {
    fixture.setDoneContractConfig({ install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" });
    const slug = await fixture.createTask({ plan: planMain, kind: "code", title: "Start draft task", acScope: ["AC-FX-1"] });
    const before = worktreeList();
    const branchesBefore = branchList();
    const out = await startFrom(fixture.dir, slug, "start-s14-draft");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("not-approved");
    expect(out.text).toContain("lore approve");
    expect(worktreeList()).toBe(before);
    expect(branchList()).toBe(branchesBefore);
    expect(await claimOf(slug)).toBeUndefined();
  });

  it("AC-DCS1-14: a check task and a corpus task exit 4 use-finish naming lore finish, creating nothing", async () => {
    for (const kind of ["check", "corpus"] as const) {
      const slug = await approvedTask(planMain, kind);
      const before = worktreeList();
      const branchesBefore = branchList();
      const out = await startFrom(fixture.dir, slug, `start-s14-${kind}`);
      expect(out.exitCode, out.text).toBe(4);
      expect(out.text).toContain("use-finish");
      expect(out.text).toContain("lore finish");
      expect(worktreeList()).toBe(before);
      expect(branchList()).toBe(branchesBefore);
      expect(await claimOf(slug)).toBeUndefined();
    }
  });

  it("AC-DCS1-14: a default worktree path that exists exits 4 worktree-exists naming it and removes nothing", async () => {
    const slug = await approvedTask(planMain, "code");
    const path = worktreePathOf(slug);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "keep.txt"), "keep me\n");
    const before = worktreeList();
    const branchesBefore = branchList();
    const out = await startFrom(fixture.dir, slug, "start-s14-path");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("worktree-exists");
    expect(out.text).toContain(path);
    expect(readFileSync(join(path, "keep.txt"), "utf8")).toBe("keep me\n");
    expect(worktreeList()).toBe(before);
    expect(branchList()).toBe(branchesBefore);
    expect(await claimOf(slug)).toBeUndefined();
  });

  it("AC-DCS1-14: a default branch that exists exits 4 worktree-exists naming it and keeps the branch", async () => {
    const slug = await approvedTask(planMain, "code");
    fixture.git(["branch", `task/${slug}`, "main"]);
    const before = worktreeList();
    const out = await startFrom(fixture.dir, slug, "start-s14-branch");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("worktree-exists");
    expect(out.text).toContain(`task/${slug}`);
    expect(branchList()).toContain(`task/${slug}`);
    expect(worktreeList()).toBe(before);
    expect(existsSync(worktreePathOf(slug))).toBe(false);
    expect(await claimOf(slug)).toBeUndefined();
  });

  it("AC-DCS1-14: a default worktree path git does not ignore exits 4 worktree-path-not-ignored naming the path", async () => {
    const slug = await approvedTask(planMain, "code");
    const exclude = join(fixture.dir, ".git", "info", "exclude");
    const original = readFileSync(exclude, "utf8");
    writeFileSync(exclude, original.replace(".claude/\n", ""));
    try {
      const before = worktreeList();
      const branchesBefore = branchList();
      const out = await startFrom(fixture.dir, slug, "start-s14-ignored");
      expect(out.exitCode, out.text).toBe(4);
      expect(out.text).toContain("worktree-path-not-ignored");
      expect(out.text).toContain(worktreePathOf(slug));
      expect(worktreeList()).toBe(before);
      expect(branchList()).toBe(branchesBefore);
      expect(existsSync(worktreePathOf(slug))).toBe(false);
      expect(await claimOf(slug)).toBeUndefined();
    } finally {
      writeFileSync(exclude, original);
    }
  });

  it("AC-DCS1-14: an install that fails exits 4 install-failed, removes the worktree and the branch it created and stores no claim", async () => {
    for (const plan of [planMain, planInteg]) {
      const slug = await approvedTask(plan, "code", "sh -c 'echo broken-install >&2; exit 3'");
      const before = worktreeList();
      const branchesBefore = branchList();
      const versionBefore = (await fixture.readTask(slug)).version;
      const out = await startFrom(fixture.dir, slug, "start-s14-install");
      expect(out.exitCode, out.text).toBe(4);
      expect(out.text).toContain("install-failed");
      expect(out.text).toContain("broken-install");
      expect(existsSync(worktreePathOf(slug))).toBe(false);
      expect(branchList()).not.toContain(`task/${slug}`);
      expect(worktreeList()).toBe(before);
      expect(branchList()).toBe(branchesBefore);
      expect(await claimOf(slug)).toBeUndefined();
      expect((await fixture.readTask(slug)).version).toBe(versionBefore);
    }
  });

  it("AC-DCS1-14: lore claim of a code task without --worktree exits 4 work-needs-branch (an unanchored task included)", async () => {
    const slug = await approvedTask(planMain, "code");
    const out = await loreIn(fixture.dir, ["claim", slug], "start-s14-nobranch");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("work-needs-branch");
    expect(await claimOf(slug)).toBeUndefined();
  });

  it("AC-DCS1-14: lore claim of a check or corpus task exits 4 kind-has-no-claim naming lore finish", async () => {
    for (const kind of ["check", "corpus"] as const) {
      const slug = await approvedTask(planMain, kind);
      const out = await loreIn(fixture.dir, ["claim", slug], `start-s14-claim-${kind}`);
      expect(out.exitCode, out.text).toBe(4);
      expect(out.text).toContain("kind-has-no-claim");
      expect(out.text).toContain("lore finish");
      expect(await claimOf(slug)).toBeUndefined();
    }
  });

  it("AC-DCS1-14: a code claim on the plan's integration branch, or on a branch another live claim records, exits 4 shared-branch", async () => {
    const onIntegration = await approvedTask(planInteg, "code");
    const integOut = await loreIn(fixture.dir, ["claim", onIntegration, "--branch", INTEG, "--worktree", INTEG], "start-s14-shared-integ");
    expect(integOut.exitCode, integOut.text).toBe(4);
    expect(integOut.text).toContain("shared-branch");
    expect(await claimOf(onIntegration)).toBeUndefined();

    const holder = await approvedTask(planMain, "code");
    const started = await startFrom(fixture.dir, holder, "start-s14-shared-holder");
    expect(started.exitCode, started.text).toBe(0);
    const other = await approvedTask(planMain, "code");
    const sharedOut = await loreIn(fixture.dir, ["claim", other, "--branch", `task/${holder}`, "--worktree", `task/${holder}`], "start-s14-shared-other");
    expect(sharedOut.exitCode, sharedOut.text).toBe(4);
    expect(sharedOut.text).toContain("shared-branch");
    expect(sharedOut.text).toContain(holder);
    expect(await claimOf(other)).toBeUndefined();
  });

  it("AC-DCS1-14: a task without a kind is refused by claim and by start as kind-missing, naming lore migrate done-contract", async () => {
    // A task approved before kinds existed: no kind, no contract (the migration's own fixture shape).
    const slug = await approvedTask(planMain, "code");
    await stripKindAndContractThroughStore(slug);
    const before = worktreeList();
    const branchesBefore = branchList();
    const started = await startFrom(fixture.dir, slug, "start-s14-kindless");
    expect(started.exitCode, started.text).toBe(4);
    expect(started.text).toContain("kind-missing");
    expect(started.text).toContain("lore migrate done-contract");
    expect(worktreeList()).toBe(before);
    expect(branchList()).toBe(branchesBefore);

    // Neither an unanchored task with a worktree nor one with no worktree is claimed: the old anchor-based rule is gone.
    const tree = join(scratch, "kindless-wt");
    fixture.git(["worktree", "add", "-q", "-b", "dcs1-kindless", tree, "main"]);
    for (const extra of [[], ["--worktree", tree]] as const) {
      const claimed = await loreIn(fixture.dir, ["claim", slug, ...extra], "start-s14-kindless");
      expect(claimed.exitCode, claimed.text).toBe(4);
      expect(claimed.text).toContain("kind-missing");
      expect(claimed.text).toContain("lore migrate done-contract");
    }
    expect(await claimOf(slug)).toBeUndefined();
  });

  it("AC-DCS1-14: a first claim from a worktree whose extra commits are all on the integration branch exits 0; one commit on neither exits 4 first-claim-off-main", async () => {
    const ok = await approvedTask(planInteg, "code");
    const okPath = join(scratch, "claim-ok");
    fixture.git(["worktree", "add", "-q", "-b", "dcs1-claim-ok", okPath, INTEG]);
    const accepted = await loreIn(fixture.dir, ["claim", ok, "--worktree", okPath], "start-s14-offmain-ok");
    expect(accepted.exitCode, accepted.text).toBe(0);

    const bad = await approvedTask(planInteg, "code");
    const badPath = join(scratch, "claim-bad");
    fixture.git(["worktree", "add", "-q", "-b", "dcs1-claim-bad", badPath, INTEG]);
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: badPath });
    execFileSync("git", ["config", "user.name", "fixture"], { cwd: badPath });
    writeFileSync(join(badPath, "stray.txt"), "a commit on neither main nor the integration branch\n");
    execFileSync("git", ["add", "-A"], { cwd: badPath });
    execFileSync("git", ["commit", "-q", "-m", "stray"], { cwd: badPath });
    const refused = await loreIn(fixture.dir, ["claim", bad, "--worktree", badPath], "start-s14-offmain-bad");
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("gate:task-claim:first-claim-off-main");
    expect(await claimOf(bad)).toBeUndefined();
  });
});

describe("lore start inside a linked worktree adopts it (AC-DCF-4, BR-1550, issue #623)", () => {
  /** A linked worktree on its own branch cut at `from`, outside the repository (the shape a harness gives an isolated subagent). */
  const linkedWorktree = (name: string, from: string): string => {
    const path = join(scratch, name);
    fixture.git(["worktree", "add", "-q", "-b", `dcf4-${name}`, path, from]);
    return path;
  };
  const worktreeCount = (): number => worktreeList().split("\n").filter((line) => line.startsWith("worktree ")).length;

  it("AC-DCF-4: a clean linked worktree holding the base tip is adopted: exit 0, no new worktree, install run there, claim names it, contract printed", async () => {
    const marker = join(scratch, "install-marker-adopt");
    const slug = await approvedTask(planMain, "code", `sh -c 'echo "$PWD" > ${marker}'`);
    const path = linkedWorktree("adopt-ok", "main");
    const countBefore = worktreeCount();
    const out = await startFrom(path, slug, "start-dcf4-ok", ["--write-set", "src/"]);
    expect(out.exitCode, out.text).toBe(0);
    expect(worktreeCount()).toBe(countBefore);
    expect(existsSync(worktreePathOf(slug))).toBe(false);
    expect(branchList()).not.toContain(`task/${slug}`);
    expect(realpathSync(readFileSync(marker, "utf8").trim())).toBe(realpathSync(path));
    const claim = await claimOf(slug);
    expect(claim?.branch).toBe("dcf4-adopt-ok");
    expect(realpathSync(claim?.worktree ?? "/nonexistent")).toBe(realpathSync(path));
    expect(out.stdout).toContain("ac:AC-FX-1");
    expect(out.stdout).toContain("typecheck");
    expect(out.stdout).toContain(path);
  });

  it("AC-DCF-4: a dirty linked worktree exits 4 worktree-dirty, writing no claim and creating nothing", async () => {
    const slug = await approvedTask(planMain, "code");
    const path = linkedWorktree("adopt-dirty", "main");
    writeFileSync(join(path, "stray.txt"), "uncommitted\n");
    const countBefore = worktreeCount();
    const out = await startFrom(path, slug, "start-dcf4-dirty");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("worktree-dirty");
    expect(worktreeCount()).toBe(countBefore);
    expect(await claimOf(slug)).toBeUndefined();
  });

  it("AC-DCF-4: a linked worktree whose HEAD lacks the base tip exits 4 base-behind naming git merge --ff-only, writing no claim", async () => {
    const slug = await approvedTask(planInteg, "code");
    const path = linkedWorktree("adopt-behind", "main");
    const countBefore = worktreeCount();
    const out = await startFrom(path, slug, "start-dcf4-behind");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("base-behind");
    expect(out.text).toContain("git merge --ff-only");
    expect(worktreeCount()).toBe(countBefore);
    expect(await claimOf(slug)).toBeUndefined();
    // After the fast-forward the same start adopts it.
    execFileSync("git", ["merge", "--ff-only", "-q", INTEG], { cwd: path });
    const again = await startFrom(path, slug, "start-dcf4-behind");
    expect(again.exitCode, again.text).toBe(0);
    expect(worktreeCount()).toBe(countBefore);
  });

  it("AC-DCF-4: a linked worktree another fresh claim holds exits 5 CLAIM_CONFLICT naming the holder, writing no claim", async () => {
    const holderTask = await approvedTask(planMain, "code");
    const path = linkedWorktree("adopt-held", "main");
    const held = await startFrom(path, holderTask, "start-dcf4-holder");
    expect(held.exitCode, held.text).toBe(0);
    const other = await approvedTask(planMain, "code");
    const countBefore = worktreeCount();
    const out = await startFrom(path, other, "start-dcf4-intruder");
    expect(out.exitCode, out.text).toBe(5);
    expect(out.text).toContain("is claimed by");
    expect(worktreeCount()).toBe(countBefore);
    expect(await claimOf(other)).toBeUndefined();
  });

  it("AC-DCF-4: run from the shared checkout, start still creates the task worktree under .claude/worktrees", async () => {
    const slug = await approvedTask(planMain, "code");
    const countBefore = worktreeCount();
    const out = await startFrom(fixture.dir, slug, "start-dcf4-shared");
    expect(out.exitCode, out.text).toBe(0);
    expect(worktreeCount()).toBe(countBefore + 1);
    expect(existsSync(worktreePathOf(slug))).toBe(true);
    expect((await claimOf(slug))?.branch).toBe(`task/${slug}`);
  });
});
