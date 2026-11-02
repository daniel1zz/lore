// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @reads assets/context
// @reads assets/context/*.md
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-land-compiled.bun.test.ts — `lore land` folds a finished task into the plan integration branch, or integrates,
 * archives and cleans, and lands the branch once no open code task is unfolded
 * (spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-7 to AC-DCS2-10 and AC-DCS2-19;
 * spec-done-contract-compiled-at-approve-task-kinds-write-sets AC-DCS1-18, the folded case), observed through the `lore` command
 * tree (`runLoreInProcess`, the function the binary's entry calls) on a throwaway repository and corpus with REAL branches,
 * worktrees, finished claims and a real integration worktree. The repository's own `.lore/` is never touched.
 *
 * Each test name starts with `AC-<id>:` (with the colon), so `-t 'AC-DCS2-1:'` never matches AC-DCS2-10.
 *
 *   Task "lore land folds into the integration branch or integrates, archives, cleans and resumes":
 *     AC-DCS2-7   a plan without an integration branch: contract met, integrate, archive, one summary; a second run changes nothing
 *     AC-DCS2-8   a plan with one: fast-forward else merge, a conflict names the files, a folded entry, two simultaneous lands
 *     AC-DCS2-9   a failed step keeps the earlier one in the log, names the next command, resumes, and is idempotent
 *     AC-DCS2-10  `lore plan integration-branch` creates the branch at main's tip, reuses one there, refuses another commit and a bad name
 *     AC-DCS2-19  the branch lands when no open code task is unfolded (three plans), `lore land <branch>`, readiness of a check task
 *     AC-DCS1-18  (folded case) a finished claim stops counting in overlap once its commit is folded into the base
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository, the shipped main-ref guard installed. The oracle
 * commands are `echo` scripts that print a runner summary, so a finish and an integrate record real attested passes.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { installShippedGuard } from "../integration/support/main-guard-repo";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const PASS_CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" };

/** The one run that claims, finishes and lands every task of a test (lore done refuses a task held by another run's fresh claim). */
const OWNER = "dcs2-land-owner";

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
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs2-land-guard-")), "hooks"));
  fixture.git(["checkout", "-q", "--detach", "main"]);
  scratch = mkdtempSync(join(tmpdir(), "dcs2-land-"));
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

async function loreIn(cwd: string, args: readonly string[], session = OWNER, extraEnv: Record<string, string> = {}): Promise<Out> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, ...sessionEnv(session), ...extraEnv, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

const land = (target: string, session = OWNER): Promise<Out> => loreIn(fixture.dir, ["land", target], session);

interface Tree {
  readonly branch: string;
  readonly path: string;
}

function addWorktree(label: string, from = "main"): Tree {
  sequence += 1;
  const branch = `dcs2-land-${label}-${sequence}`;
  const path = join(scratch, `${label}-${sequence}`);
  fixture.git(["worktree", "add", "-q", "-b", branch, path, from]);
  return { branch, path };
}

const gitIn = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function commitIn(tree: Tree, files: Readonly<Record<string, string>>): string {
  gitIn(tree.path, ["config", "user.email", "fixture@example.invalid"]);
  gitIn(tree.path, ["config", "user.name", "fixture"]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(tree.path, path)), { recursive: true });
    writeFileSync(join(tree.path, path), content);
  }
  gitIn(tree.path, ["add", "-A"]);
  sequence += 1;
  gitIn(tree.path, ["commit", "-q", "-m", `work ${sequence}`]);
  return gitIn(tree.path, ["rev-parse", "HEAD"]);
}

const refOf = (ref: string): string => fixture.git(["rev-parse", `refs/heads/${ref}`]);
const mainTip = (): string => refOf("main");
const isAncestor = (commit: string, of: string): boolean => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, of], { cwd: fixture.dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const parentsOf = (commit: string): string[] => fixture.git(["rev-list", "--parents", "-n", "1", commit]).split(" ").slice(1);

interface LogEntry {
  readonly kind: string;
  readonly tip?: string;
  readonly fold_commit?: string;
  readonly landing_commit?: string;
}

async function logOf(slug: string): Promise<LogEntry[]> {
  return ((await fixture.readTask(slug)).extra["execution_log"] ?? []) as LogEntry[];
}

interface Row {
  readonly command: string;
  readonly result: string;
  readonly attestation?: { head_sha?: string; recorded_at_landing?: string };
}

async function rowsOf(slug: string): Promise<Row[]> {
  return ((await fixture.readTask(slug)).extra["verification_evidence"] ?? []) as Row[];
}

async function statusOf(slug: string): Promise<string> {
  return (await fixture.readTask(slug)).status;
}

interface Finished {
  readonly slug: string;
  readonly tree: Tree;
  readonly tip: string;
}

/** A code task approved (red waived), claimed on a fresh worktree cut from `from`, with its work committed; finished unless `finish` is false. */
async function codeTask(
  plan: string,
  label: string,
  opts: { from?: string; finish?: boolean; work?: Readonly<Record<string, string>>; anchors?: readonly string[]; session?: string } = {},
): Promise<Finished> {
  const session = opts.session ?? OWNER;
  const anchors = opts.anchors ?? [`tests/${label}.test.ts`];
  const slug = await fixture.createTask({ plan, kind: "code", title: `Land ${label}`, anchors, acScope: ["AC-FX-1"] });
  await fixture.mustRun(["approve", slug, "--red-waiver", "the red run is not the subject of this test"]);
  const tree = addWorktree(label, opts.from ?? "main");
  const claimed = await loreIn(fixture.dir, ["claim", slug, "--worktree", tree.branch], session);
  expect(claimed.exitCode, claimed.text).toBe(0);
  const tip = commitIn(tree, opts.work ?? { [anchors[0] as string]: `// ${label}\n`, [`src/${label}.ts`]: `export const ${label} = 1;\n` });
  if (opts.finish !== false) {
    const finished = await loreIn(tree.path, ["finish", slug], session);
    expect(finished.exitCode, finished.text).toBe(0);
  }
  return { slug, tree, tip };
}

/**
 * Moves main one commit on, by plumbing, as another landing would (the update carries the marker the main-ref guard accepts). With
 * `file` the commit also writes that file; without it the commit has main's own tree.
 */
function advanceMain(file?: { readonly path: string; readonly content: string }): string {
  const base = mainTip();
  const index = join(scratch, `advance-index-${(sequence += 1)}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  execFileSync("git", ["read-tree", base], { cwd: fixture.dir, env });
  if (file !== undefined) {
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: fixture.dir, input: file.content, encoding: "utf8" }).trim();
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${blob},${file.path}`], { cwd: fixture.dir, env });
  }
  const tree = execFileSync("git", ["write-tree"], { cwd: fixture.dir, env, encoding: "utf8" }).trim();
  const moved = fixture.git(["-c", "user.email=f@example.invalid", "-c", "user.name=f", "commit-tree", tree, "-p", base, "-m", "main moves on"]);
  execFileSync("git", ["update-ref", "refs/heads/main", moved, base], { cwd: fixture.dir, env: { ...process.env, LORE_INTEGRATE: "1" } });
  fixture.git(["checkout", "-q", "--detach", "main"]);
  return moved;
}

/** A plan declaring an integration branch (created by the declaration itself, AC-DCS2-10). */
async function planWithBranch(title: string, branch: string): Promise<string> {
  return fixture.createPlan(title, branch);
}

// ───────────────────────────── AC-DCS2-7 ─────────────────────────────

describe("AC-DCS2-7: land finishes a landing in one command for a plan without an integration branch", () => {
  it("AC-DCS2-7: an unmet contract exits 4 naming every unmet item before anything moves", async () => {
    const plan = await fixture.createPlan("Land unmet plan");
    const unfinished = await codeTask(plan, "unmet-a", { finish: false });
    const mainBefore = mainTip();
    const taskBefore = await fixture.readTask(unfinished.slug);

    const out = await land(unfinished.slug);
    expect(out.exitCode, out.text).toBe(4);
    for (const item of ["ac:AC-FX-1", "test:tests/unmet-a.test.ts", "typecheck"]) expect(out.text).toContain(item);
    expect(mainTip()).toBe(mainBefore);
    expect(await fixture.readTask(unfinished.slug)).toEqual(taskBefore);
  });

  it("AC-DCS2-7: land integrates the branch, archives the task, logs the landing and prints one summary; a second run changes nothing", async () => {
    const plan = await fixture.createPlan("Land main plan");
    const task = await codeTask(plan, "main-a");
    const other = await codeTask(plan, "main-b");
    const mainBefore = mainTip();
    expect(isAncestor(task.tip, mainBefore)).toBe(false);

    const out = await land(task.slug);
    expect(out.exitCode, out.text).toBe(0);
    const merged = mainTip();
    expect(merged).not.toBe(mainBefore);
    expect(isAncestor(task.tip, merged), "main contains the branch tip").toBe(true);
    expect(await statusOf(task.slug)).toBe("archived");
    expect(out.stdout).toContain(`land: landed ${task.tree.branch} on main`);
    const landed = (await logOf(task.slug)).filter((entry) => entry.kind === "landed");
    expect(landed.length).toBe(1);
    expect(landed[0]?.tip).toBe(task.tip);
    expect(landed[0]?.landing_commit).toBe(merged);
    const bound = (await rowsOf(task.slug)).filter((row) => row.attestation?.recorded_at_landing === merged);
    expect(bound.length).toBeGreaterThan(0);
    for (const row of bound) expect(row.attestation?.head_sha).toBe(merged);
    // the worktree and the branch of the archived task are removed (lore done's cleanup, BR-1079); the other task's are not
    expect(existsSync(task.tree.path), "worktree removed").toBe(false);
    expect(fixture.git(["branch", "--list", task.tree.branch]), `branch removed: ${out.text}`).toBe("");
    expect(existsSync(other.tree.path)).toBe(true);
    // the other task of the plan was on its own branch: untouched
    expect(await statusOf(other.slug)).toBe("approved");

    const versionBefore = (await fixture.readTask(task.slug)).version;
    const again = await land(task.slug);
    expect(again.exitCode, again.text).toBe(0);
    expect(mainTip()).toBe(merged);
    expect((await fixture.readTask(task.slug)).version).toBe(versionBefore);
    expect((await logOf(task.slug)).filter((entry) => entry.kind === "landed").length).toBe(1);
  });

  it("AC-DCS2-7: the done walk of a plain `lore integrate` removes the landed task's branch and worktree itself (no second delete)", async () => {
    const plan = await fixture.createPlan("Land done cleanup plan");
    const task = await codeTask(plan, "cleanup-a");
    const out = await loreIn(fixture.dir, ["integrate", task.tree.branch]);
    expect(out.exitCode, out.text).toBe(0);
    expect(await statusOf(task.slug)).toBe("archived");
    expect(existsSync(task.tree.path), "worktree removed").toBe(false);
    expect(fixture.git(["branch", "--list", task.tree.branch]), `branch removed: ${out.text}`).toBe("");
  });

  it("AC-DCS2-7: a check task and an unknown name are refused with exit 4 / 3, nothing moves", async () => {
    const plan = await fixture.createPlan("Land refused plan");
    const check = await fixture.createTask({ plan, kind: "check", title: "Land check", acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", check]);
    const mainBefore = mainTip();
    const refused = await land(check);
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("lore finish");
    const unknown = await land("no-such-task-or-branch-dcs2");
    expect(unknown.exitCode, unknown.text).not.toBe(0);
    expect(mainTip()).toBe(mainBefore);
  });
});

// ───────────────────────────── AC-DCS2-8 ─────────────────────────────

describe("AC-DCS2-8: land folds a task into the plan integration branch", () => {
  it("AC-DCS2-8: fast-forward when the branch is an ancestor of the tip, a merge when it is not; each fold logs the tip and the fold commit; the task stays approved", async () => {
    const branch = "integration/p8";
    const plan = await planWithBranch("Land fold plan", branch);
    const t0 = refOf(branch);
    const a = await codeTask(plan, "fold-a", { from: branch });
    const b = await codeTask(plan, "fold-b", { from: branch });
    // a third open code task nobody folds keeps the branch from landing (AC-DCS2-19), so these folds are only folds
    await codeTask(plan, "fold-open", { from: branch, finish: false });
    const mainBefore = mainTip();

    const first = await land(a.slug);
    expect(first.exitCode, first.text).toBe(0);
    expect(refOf(branch), "a fast-forward fold leaves the branch at the tip").toBe(a.tip);
    expect(parentsOf(refOf(branch))).toEqual([t0]);
    expect(await logOf(a.slug)).toEqual([expect.objectContaining({ kind: "folded", tip: a.tip, fold_commit: a.tip })]);
    expect(await statusOf(a.slug)).toBe("approved");

    const second = await land(b.slug);
    expect(second.exitCode, second.text).toBe(0);
    const head = refOf(branch);
    expect(parentsOf(head), "a merge fold has two parents").toEqual([a.tip, b.tip]);
    expect(await logOf(b.slug)).toEqual([expect.objectContaining({ kind: "folded", tip: b.tip, fold_commit: head })]);
    expect(await statusOf(b.slug)).toBe("approved");
    // main never moves on a fold
    expect(mainTip()).toBe(mainBefore);

    // landing a task that is already folded exits 0 and changes nothing
    const versionBefore = (await fixture.readTask(a.slug)).version;
    const again = await land(a.slug);
    expect(again.exitCode, again.text).toBe(0);
    expect(refOf(branch)).toBe(head);
    expect((await fixture.readTask(a.slug)).version).toBe(versionBefore);
    expect((await logOf(a.slug)).filter((entry) => entry.kind === "folded").length).toBe(1);
  });

  it("AC-DCS2-8: an unmet contract exits 4 naming the items before the fold; the branch is unchanged", async () => {
    const branch = "integration/p8-unmet";
    const plan = await planWithBranch("Land fold unmet plan", branch);
    const unfinished = await codeTask(plan, "fold-unmet", { from: branch, finish: false });
    const before = refOf(branch);
    const out = await land(unfinished.slug);
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("typecheck");
    expect(out.text).toContain("ac:AC-FX-1");
    expect(refOf(branch)).toBe(before);
    expect(await logOf(unfinished.slug)).toEqual([]);
  });

  it("AC-DCS2-8: a merge conflict exits 4 naming the conflicting files and leaves the branch unchanged", async () => {
    const branch = "integration/p8-conflict";
    const plan = await planWithBranch("Land fold conflict plan", branch);
    const d = await codeTask(plan, "fold-d", { from: branch, work: { "tests/fold-d.test.ts": "// d\n", "src/shared.ts": "export const x = 'd';\n" } });
    const e = await codeTask(plan, "fold-e", { from: branch, work: { "tests/fold-e.test.ts": "// e\n", "src/shared.ts": "export const x = 'e';\n" } });
    expect((await land(d.slug)).exitCode).toBe(0);
    const head = refOf(branch);

    const out = await land(e.slug);
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("src/shared.ts");
    expect(refOf(branch)).toBe(head);
    expect(await logOf(e.slug)).toEqual([]);
  });

  it("AC-DCS2-8: a branch ref that moved during the fold exits 75 fold-raced and changes nothing; the next land folds", async () => {
    const branch = "integration/p8-raced";
    const plan = await planWithBranch("Land fold raced plan", branch);
    const a = await codeTask(plan, "raced-a", { from: branch });
    await codeTask(plan, "raced-open", { from: branch, finish: false });
    const head = refOf(branch);
    // a `git` first on PATH that moves the branch right before the fold's compare-and-swap, once (another writer winning the race)
    const bin = join(scratch, `race-bin-${(sequence += 1)}`);
    mkdirSync(bin, { recursive: true });
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const rival = fixture.git(["-c", "user.email=f@example.invalid", "-c", "user.name=f", "commit-tree", `${head}^{tree}`, "-p", head, "-m", "rival"]);
    const once = join(bin, "done");
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nif [ "$1" = "update-ref" ] && [ "$2" = "refs/heads/${branch}" ] && [ ! -f "${once}" ]; then touch "${once}"; "${realGit}" update-ref "$2" ${rival}; fi\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
    const raced = await loreIn(fixture.dir, ["land", a.slug], OWNER, { PATH: `${bin}:${process.env["PATH"] ?? ""}` });
    expect(raced.exitCode, raced.text).toBe(75);
    expect(raced.text).toContain("fold-raced");
    expect(refOf(branch), "the rival's head stands").toBe(rival);
    expect(await logOf(a.slug)).toEqual([]);

    const resumed = await land(a.slug);
    expect(resumed.exitCode, resumed.text).toBe(0);
    expect(isAncestor(a.tip, refOf(branch))).toBe(true);
    expect((await logOf(a.slug)).filter((entry) => entry.kind === "folded").length).toBe(1);
  });

  it("AC-DCS2-8: two simultaneous lands of two tasks both fold, one after the other, with no lost fold", async () => {
    const branch = "integration/p8-race";
    const plan = await planWithBranch("Land fold race plan", branch);
    const x = await codeTask(plan, "race-x", { from: branch });
    const y = await codeTask(plan, "race-y", { from: branch });

    const [outX, outY] = await Promise.all([land(x.slug), land(y.slug)]);
    expect(outX.exitCode, outX.text).toBe(0);
    expect(outY.exitCode, outY.text).toBe(0);
    const head = refOf(branch);
    expect(isAncestor(x.tip, head)).toBe(true);
    expect(isAncestor(y.tip, head)).toBe(true);
    const foldX = (await logOf(x.slug)).find((entry) => entry.kind === "folded");
    const foldY = (await logOf(y.slug)).find((entry) => entry.kind === "folded");
    expect(foldX?.tip).toBe(x.tip);
    expect(foldY?.tip).toBe(y.tip);
    // serialized in ticket order: the first fold fast-forwarded to its own tip, the second merged on top of it
    const folds = [foldX, foldY].sort((p, q) => (p?.fold_commit === p?.tip ? -1 : 1) - (q?.fold_commit === q?.tip ? -1 : 1));
    expect(folds[0]?.fold_commit).toBe(folds[0]?.tip);
    expect(folds[1]?.fold_commit).toBe(head);
    expect(parentsOf(head)).toContain(folds[0]?.tip as string);
  });
});

// ───────────────────────────── AC-DCS2-9 ─────────────────────────────

describe("AC-DCS2-9: land resumes after a failed step and is idempotent", () => {
  it("AC-DCS2-9: an integrate that refuses after the fold exits 4 naming the next command, keeps the folded entry; the resume lands and a third run changes nothing", async () => {
    const branch = "integration/p9";
    const plan = await planWithBranch("Land resume plan", branch);
    const a = await codeTask(plan, "resume-a", { from: branch, work: { "tests/resume-a.test.ts": "// a\n", "src/resume.ts": "export const side = 'branch';\n" } });
    // main moves on with a conflicting change to the same file (what another landing would leave)
    const moved = advanceMain({ path: "src/resume.ts", content: "export const side = 'main';\n" });

    const failed = await land(a.slug);
    expect(failed.exitCode, failed.text).toBe(4);
    expect(failed.text).toContain(`lore land ${a.slug}`);
    expect(mainTip()).toBe(moved);
    // the earlier step stays recorded: the fold was not rolled back
    expect(refOf(branch)).toBe(a.tip);
    expect(await logOf(a.slug)).toEqual([expect.objectContaining({ kind: "folded", tip: a.tip })]);
    expect(await statusOf(a.slug)).toBe("approved");

    // the cause is fixed on the integration branch (main merged in, the conflict resolved): the resume lands
    const fixer = addWorktree("resume-fix", branch);
    gitIn(fixer.path, ["config", "user.email", "fixture@example.invalid"]);
    gitIn(fixer.path, ["config", "user.name", "fixture"]);
    try {
      gitIn(fixer.path, ["merge", "-q", "--no-ff", "-m", "merge main", "main"]);
    } catch {
      writeFileSync(join(fixer.path, "src/resume.ts"), "export const side = 'resolved';\n");
      gitIn(fixer.path, ["add", "-A"]);
      gitIn(fixer.path, ["commit", "-q", "-m", "merge main, resolved"]);
    }
    const fixedHead = refOf(fixer.branch);
    fixture.git(["branch", "-f", branch, fixedHead]);
    const foldedVersion = (await fixture.readTask(a.slug)).version;

    const resumed = await land(a.slug);
    expect(resumed.exitCode, resumed.text).toBe(0);
    expect(refOf(branch), "the resume does not fold again").toBe(fixedHead);
    expect(isAncestor(a.tip, mainTip())).toBe(true);
    expect(await statusOf(a.slug)).toBe("archived");
    expect((await logOf(a.slug)).filter((entry) => entry.kind === "folded").length).toBe(1);
    expect((await fixture.readTask(a.slug)).version).toBeGreaterThan(foldedVersion);

    const landedMain = mainTip();
    const versionAfter = (await fixture.readTask(a.slug)).version;
    const third = await land(a.slug);
    expect(third.exitCode, third.text).toBe(0);
    expect(mainTip()).toBe(landedMain);
    expect(refOf(branch)).toBe(fixedHead);
    expect((await fixture.readTask(a.slug)).version).toBe(versionAfter);
  });
});

describe("AC-DCS2-9: a task whose anchored test file the landed tree lacks is refused and never archived", () => {
  // CHANGED (BR-1547, AC-DCF-1; T1 on main). OLD assertion: the task anchors a test file its branch never creates; finish exits 0,
  // the integrate lands the branch, then `lore done` refuses (oracle-file-missing), so land exits 4 AFTER the landing, keeps the
  // landed entry, and a second run resumes at the done step without integrating again. WHY it changed: approve now refuses an
  // absent undeclared test anchor, so the fixture declares it with --creates; a declared-but-absent file is then refused already
  // by `lore finish` (exit 4, test-file-absent), and so land refuses (exit 4, land-contract-unmet) BEFORE anything moves. NEW
  // assertion: finish exits 4 naming test-file-absent; land exits 4 with land-contract-unmet; main does not move, no landed entry
  // is written, the task stays approved, and a second land changes nothing. The post-integrate resume branch is no longer reachable through a missing test file.
  it("AC-DCS2-9: land of a task whose --creates test file is absent exits 4 naming test-file-absent; main, the log and the task stay unchanged; a second run changes nothing", async () => {
    const plan = await fixture.createPlan("Land resume main plan");
    const x = await codeTask(plan, "resume-main", { finish: false, work: { "src/resume-main.ts": "export const resumeMain = 1;\n" } });
    const mainBefore = mainTip();

    // finish names the absent file and does not mark the claim finished (it records the measurable rows, so the task is not compared
    // byte for byte before it); land, which needs a finished claim, then refuses before anything moves
    const finished = await loreIn(x.tree.path, ["finish", x.slug], OWNER);
    expect(finished.exitCode, finished.text).toBe(4);
    expect(finished.text).toContain("test-file-absent");
    expect(finished.text).toContain("tests/resume-main.test.ts");
    const taskAfterFinish = await fixture.readTask(x.slug);

    const refused = await land(x.slug);
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("land-contract-unmet");
    expect(refused.text).toContain("tests/resume-main.test.ts");
    expect(mainTip()).toBe(mainBefore);
    expect(isAncestor(x.tip, mainTip()), "nothing landed").toBe(false);
    expect((await logOf(x.slug)).filter((entry) => entry.kind === "landed").length).toBe(0);
    expect(await statusOf(x.slug)).toBe("approved");
    expect(await fixture.readTask(x.slug)).toEqual(taskAfterFinish);

    const again = await land(x.slug);
    expect(again.exitCode, again.text).toBe(4);
    expect(again.text).toContain("land-contract-unmet");
    expect(mainTip()).toBe(mainBefore);
    expect(await statusOf(x.slug)).toBe("approved");
    expect(await fixture.readTask(x.slug)).toEqual(taskAfterFinish);
  });
});

// ───────────────────────────── AC-DCS2-10 ─────────────────────────────

describe("AC-DCS2-10: lore plan integration-branch creates the declared branch at main's tip", () => {
  const planWithoutBranch = (title: string): Promise<string> => fixture.createPlan(title);

  it("AC-DCS2-10: an absent branch is created at the tip of main (exit 0); an existing one at that tip is reused unchanged", async () => {
    // main must have moved past an older commit, so a branch created at a stale commit would differ
    advanceMain();
    const plan = await planWithoutBranch("Branch create plan");
    const declared = await fixture.run(["plan", "integration-branch", plan, "integration/p10-new"]);
    expect(declared.exitCode, declared.stderr).toBe(0);
    expect(refOf("integration/p10-new")).toBe(mainTip());
    expect(fixture.git(["rev-parse", "main~1"])).not.toBe(refOf("integration/p10-new"));

    const again = await fixture.run(["plan", "integration-branch", plan, "integration/p10-new"]);
    expect(again.exitCode, again.stderr).toBe(0);
    expect(refOf("integration/p10-new")).toBe(mainTip());
    const reuse = await planWithoutBranch("Branch reuse plan");
    const reused = await fixture.run(["plan", "integration-branch", reuse, "integration/p10-new"]);
    expect(reused.exitCode, reused.stderr).toBe(0);
    expect(refOf("integration/p10-new")).toBe(mainTip());
  });

  it("AC-DCS2-10: a branch at a different commit is refused with integration-branch-exists naming both commits; nothing changes", async () => {
    const plan = await planWithoutBranch("Branch different plan");
    const older = mainTip();
    advanceMain();
    fixture.git(["branch", "integration/p10-old", older]);
    const refused = await fixture.run(["plan", "integration-branch", plan, "integration/p10-old"]);
    expect(refused.exitCode, refused.stderr).toBe(4);
    expect(refused.stderr).toContain("integration-branch-exists");
    expect(refused.stderr).toContain(older.slice(0, 12));
    expect(refused.stderr).toContain(mainTip().slice(0, 12));
    expect(refOf("integration/p10-old")).toBe(older);
    // the declaration was not written either: the plan's approve-time base is still main
    const shown = JSON.parse(await fixture.mustRun(["get", plan, "--json"])) as { data: { doc?: { extra: Record<string, unknown> }; extra?: Record<string, unknown> } };
    const extra = shown.data.doc?.extra ?? shown.data.extra ?? {};
    expect(extra["integration_branch"]).toBeUndefined();
  });

  it("AC-DCS2-10: an invalid branch name is refused with exit 4 and creates nothing", async () => {
    const plan = await planWithoutBranch("Branch invalid plan");
    const branchesBefore = fixture.git(["branch", "--list"]);
    for (const bad of ["bad..name", "trailing/", "has space", "tilde~1"]) {
      const refused = await fixture.run(["plan", "integration-branch", plan, bad]);
      expect(refused.exitCode, `${bad}: ${refused.stderr}`).toBe(4);
    }
    expect(fixture.git(["branch", "--list"])).toBe(branchesBefore);
  });
});

// ───────────────────────────── AC-DCS2-19 ─────────────────────────────

interface ReadyRow {
  readonly task: { readonly slug: string };
  readonly ready: boolean;
  readonly unmet_blockers: readonly { slug: string }[];
  readonly met_on_integration?: readonly { slug: string }[];
}

async function readyRow(plan: string, slug: string): Promise<ReadyRow> {
  const payload = JSON.parse(await fixture.mustRun(["ready", plan, "--json"])) as { data: { ready: { records: ReadyRow[] } } };
  const row = payload.data.ready.records.find((record) => record.task.slug === slug);
  if (row === undefined) throw new Error(`task ${slug} absent from ready output`);
  return row;
}

describe("AC-DCS2-19: land integrates the branch once no open code task of the plan is unfolded", () => {
  it("AC-DCS2-19: (a) code tasks A and B plus an open check task C: land A leaves main unchanged, land B lands the branch; C is not ready until then", async () => {
    const branch = "integration/p19a";
    const plan = await planWithBranch("Land trigger plan a", branch);
    const a = await codeTask(plan, "a19", { from: branch });
    const b = await codeTask(plan, "b19", { from: branch });
    const c = await fixture.createTask({ plan, kind: "check", title: "Land check c19", acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", c]);
    const corpus = await fixture.createTask({ plan, kind: "corpus", title: "Land corpus d19" });
    await fixture.mustRun(["approve", corpus]);
    await fixture.mustRun(["link", a.slug, c, "--type", "blocks"]);
    await fixture.mustRun(["link", b.slug, c, "--type", "blocks"]);
    await fixture.mustRun(["link", a.slug, corpus, "--type", "blocks"]);
    const mainBefore = mainTip();

    const first = await land(a.slug);
    expect(first.exitCode, first.text).toBe(0);
    expect(mainTip(), "land A leaves main unchanged").toBe(mainBefore);
    const second = await land(b.slug);
    expect(second.exitCode, second.text).toBe(0);
    const merged = mainTip();
    expect(merged).not.toBe(mainBefore);
    expect(isAncestor(a.tip, merged)).toBe(true);
    expect(isAncestor(b.tip, merged)).toBe(true);
    expect(await statusOf(a.slug)).toBe("archived");
    expect(await statusOf(b.slug)).toBe("archived");
    // the check and corpus tasks never gate the landing and stay open
    expect(await statusOf(c)).toBe("approved");
    expect(await statusOf(corpus)).toBe("approved");
    // now that the work is on main, C is ready; finishing it on main archives it
    const ready = await readyRow(plan, c);
    expect(ready.ready).toBe(true);
    const finished = await loreIn(fixture.dir, ["finish", c]);
    expect(finished.exitCode, finished.text).toBe(0);
    expect(await statusOf(c)).toBe("archived");
  });

  it("AC-DCS2-19: (a) a check task blocked by two folded code tasks is not ready before the branch landed (BR-1313)", async () => {
    const branch = "integration/p19a2";
    const plan = await planWithBranch("Land readiness plan", branch);
    const a = await codeTask(plan, "ra19", { from: branch });
    const b = await codeTask(plan, "rb19", { from: branch });
    const gate = await codeTask(plan, "rc19", { from: branch, finish: false });
    const c = await fixture.createTask({ plan, kind: "check", title: "Land check rc19", acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", c]);
    await fixture.mustRun(["link", a.slug, c, "--type", "blocks"]);
    await fixture.mustRun(["link", b.slug, c, "--type", "blocks"]);
    const mainBefore = mainTip();
    expect((await land(a.slug)).exitCode).toBe(0);
    expect((await land(b.slug)).exitCode).toBe(0);
    // `gate` is an open code task nobody folded, so the branch has not landed
    expect(mainTip()).toBe(mainBefore);
    const row = await readyRow(plan, c);
    expect(row.ready, "a code blocker counts as met for a check task only when its work is on main").toBe(false);
    expect(row.unmet_blockers.map((blocker) => blocker.slug).sort()).toEqual([a.slug, b.slug].sort());
    expect(row.met_on_integration).toBeUndefined();
    void gate;
  });

  it("AC-DCS2-19: (b) with a third code task unfolded, land A and land B leave main unchanged and A and B approved", async () => {
    const branch = "integration/p19b";
    const plan = await planWithBranch("Land trigger plan b", branch);
    const a = await codeTask(plan, "a19b", { from: branch });
    const b = await codeTask(plan, "b19b", { from: branch });
    const c = await codeTask(plan, "c19b", { from: branch, finish: false });
    const mainBefore = mainTip();
    expect((await land(a.slug)).exitCode).toBe(0);
    const second = await land(b.slug);
    expect(second.exitCode, second.text).toBe(0);
    expect(second.text).toContain(c.slug);
    expect(mainTip()).toBe(mainBefore);
    expect(await statusOf(a.slug)).toBe("approved");
    expect(await statusOf(b.slug)).toBe("approved");
  });

  it("AC-DCS2-19: (c) code tasks A, B and C all landed in turn: land C integrates the branch and archives all three", async () => {
    const branch = "integration/p19c";
    const plan = await planWithBranch("Land trigger plan c", branch);
    const tasks = [await codeTask(plan, "a19c", { from: branch }), await codeTask(plan, "b19c", { from: branch }), await codeTask(plan, "c19c", { from: branch })];
    const mainBefore = mainTip();
    expect((await land((tasks[0] as Finished).slug)).exitCode).toBe(0);
    expect((await land((tasks[1] as Finished).slug)).exitCode).toBe(0);
    expect(mainTip()).toBe(mainBefore);
    const last = await land((tasks[2] as Finished).slug);
    expect(last.exitCode, last.text).toBe(0);
    const merged = mainTip();
    expect(merged).not.toBe(mainBefore);
    for (const task of tasks) {
      expect(isAncestor(task.tip, merged)).toBe(true);
      expect(await statusOf(task.slug)).toBe("archived");
      expect(existsSync(task.tree.path), "worktree removed").toBe(false);
      expect(fixture.git(["branch", "--list", task.tree.branch]), "branch removed").toBe("");
    }
  });

  it("AC-DCS2-19: lore land <integration-branch> integrates the branch itself, also when it is already in main", async () => {
    const branch = "integration/p19d";
    const plan = await planWithBranch("Land branch plan", branch);
    const a = await codeTask(plan, "a19d", { from: branch });
    // AC-DCF-5 (BR-1551): with an open code task unfolded the branch is never integrated, not even by naming it; that is asserted in
    // the AC-DCF-5 test below. Here the only task folds, which lands the branch; naming the landed branch again is idempotent.
    expect((await land(a.slug)).exitCode).toBe(0);
    const merged = mainTip();
    expect(isAncestor(a.tip, merged)).toBe(true);
    expect(await statusOf(a.slug)).toBe("archived");

    const out = await land(branch);
    expect(out.exitCode, out.text).toBe(0);
    expect(mainTip()).toBe(merged);

    const again = await land(branch);
    expect(again.exitCode, again.text).toBe(0);
    expect(mainTip()).toBe(merged);
    const absent = await land("integration/no-such-branch-dcs2");
    expect(absent.exitCode, absent.text).not.toBe(0);
  });
});

// ───────────────────────────── AC-DCF-5 ─────────────────────────────

describe("AC-DCF-5: a waiting integration branch names each unfolded task; only a fold or a reasoned deprecation clears it", () => {
  it("AC-DCF-5: land T2 waits and names T3 with its unmet cause and the clearing commands; the branch never integrates while T3 is open; a reasoned deprecation clears it and the landing names T3 deprecated, not landed", async () => {
    const branch = "integration/dcf5";
    const plan = await planWithBranch("Waiting branch plan", branch);
    const t1 = await codeTask(plan, "t1dcf5", { from: branch });
    const t2 = await codeTask(plan, "t2dcf5", { from: branch });
    const t3 = await codeTask(plan, "t3dcf5", { from: branch, finish: false });
    const mainBefore = mainTip();

    // T3 is unfinishable: finish refuses (exit 4) because its oracles cannot pass.
    expect((await land(t1.slug)).exitCode).toBe(0);
    const waiting = await land(t2.slug);
    expect(waiting.exitCode, waiting.text).toBe(0);
    expect(mainTip(), "main is unchanged while T3 is open").toBe(mainBefore);
    expect(waiting.text, "the waiting output names T3").toContain(t3.slug);
    expect(waiting.text, "with its unmet cause").toMatch(/not finished|unmet|no runner-attested pass/);
    expect(waiting.text).toContain(`lore finish ${t3.slug}`);
    expect(waiting.text).toContain("lore set");
    expect(waiting.text).toContain("--correction");
    expect(waiting.text).toContain(`lore set ${t3.slug} --status deprecated --reason`);

    // naming the branch does not integrate it either
    const refused = await land(branch);
    expect(refused.exitCode, refused.text).not.toBe(0);
    expect(refused.text).toContain(t3.slug);
    expect(mainTip(), "main is unchanged: an open code task is unfolded").toBe(mainBefore);

    // deprecating without a reason is a usage error; the task stays open
    const bare = await fixture.run(["set", t3.slug, "--status", "deprecated"]);
    expect(bare.exitCode, `${bare.stdout}\n${bare.stderr}`).toBe(2);
    expect(await statusOf(t3.slug)).toBe("approved");

    // a non-empty reason deprecates it, which clears the wait
    const deprecated = await fixture.run(["set", t3.slug, "--status", "deprecated", "--reason", "T3 cannot finish; its work moves to another plan"]);
    expect(deprecated.exitCode, `${deprecated.stdout}\n${deprecated.stderr}`).toBe(0);
    expect(await statusOf(t3.slug)).toBe("deprecated");

    const landed = await land(branch);
    expect(landed.exitCode, landed.text).toBe(0);
    const merged = mainTip();
    expect(merged).not.toBe(mainBefore);
    for (const task of [t1, t2]) {
      expect(isAncestor(task.tip, merged)).toBe(true);
      expect(await statusOf(task.slug)).toBe("archived");
    }
    expect(isAncestor(t3.tip, merged), "T3 was not landed").toBe(false);
    expect(landed.text).toMatch(new RegExp(`${t3.slug}[^\\n]*deprecated[^\\n]*not landed`));
  });
});

// ───────────────────────────── AC-DCS1-18 (folded case) ─────────────────────────────

describe("AC-DCS1-18: a finished claim stops counting in overlap once its commit is folded into the base", () => {
  it("AC-DCS1-18: lore run end keeps a finished claim open (landing it later still works) and releases the unfinished clean claim of the same run", async () => {
    const session = "dcs2-land-runend";
    const plan = await fixture.createPlan("Land run end plan");
    const finished = await codeTask(plan, "end-a", { session });
    const control = await codeTask(plan, "end-b", { session, finish: false });
    const ended = await loreIn(fixture.dir, ["run", "end", `cc:${session}`, "--reason", "agent stopped"], session);
    expect(ended.exitCode, ended.text).toBe(0);
    const claimOf = async (slug: string): Promise<{ finished_commit?: string } | undefined> => (await fixture.readTask(slug)).extra["claim"] as { finished_commit?: string } | undefined;
    expect((await claimOf(finished.slug))?.finished_commit, "the finished claim stays open").toBe(finished.tip);
    expect(await claimOf(control.slug), "the unfinished clean claim of the same run is released").toBeUndefined();
    // the finished hand-over is what `lore land` closes, by another run, after the holder's run ended
    const landed = await land(finished.slug, "dcs2-land-closer");
    expect(landed.exitCode, landed.text).toBe(0);
    expect(await statusOf(finished.slug)).toBe("archived");
  });

  it("AC-DCS1-18: an unfolded finished claim blocks an overlapping claim (exit 4); once lore land folded it, the same claim exits 0", async () => {
    const branch = "integration/p18";
    const plan = await planWithBranch("Land overlap plan", branch);
    const first = await codeTask(plan, "ov18", { from: branch, anchors: ["tests/ov18-shared.test.ts"], work: { "tests/ov18-shared.test.ts": "// ov\n" } });
    const sibling = await fixture.createTask({ plan, kind: "code", title: "Land overlapping sibling", anchors: ["tests/ov18-shared.test.ts"], acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", sibling, "--red-waiver", "the red run is not the subject of this test"]);
    const siblingTree = addWorktree("ov18-sibling", branch);

    const blocked = await loreIn(fixture.dir, ["claim", sibling, "--worktree", siblingTree.branch], "dcs2-land-other");
    expect(blocked.exitCode, blocked.text).toBe(4);
    expect(blocked.text).toContain("anchor-overlap");

    const folded = await land(first.slug);
    expect(folded.exitCode, folded.text).toBe(0);
    expect(isAncestor(first.tip, refOf(branch))).toBe(true);
    const claimed = await loreIn(fixture.dir, ["claim", sibling, "--worktree", siblingTree.branch], "dcs2-land-other");
    expect(claimed.exitCode, claimed.text).toBe(0);
    expect(existsSync(siblingTree.path)).toBe(true);
  });
});

// ───────────────────────────── AC-DCS1-18 (same-session takeover of a finished claim, issue #645) ─────────────────────────────

describe("AC-DCS1-18: a finished claim of an ended run is taken over by a run of the holder's own session", () => {
  const agentRun = (session: string, agent: string): string => `cc:${session}:${agent}`;

  /** A code task claimed and finished by the helper run `cc:<session>:<agent>` (registered first), on its own worktree. */
  async function finishedByHelper(label: string, session: string, agent: string): Promise<Finished> {
    const registered = await loreIn(fixture.dir, ["run", "register", "--harness", "claude-code", "--session", session, "--agent-id", agent, "--agent-type", "implementer"], session);
    expect(registered.exitCode, registered.text).toBe(0);
    const env = { LORE_HARNESS_RUN: agentRun(session, agent) };
    const plan = await fixture.createPlan(`Takeover ${label} plan`);
    const slug = await fixture.createTask({ plan, kind: "code", title: `Takeover ${label}`, anchors: [`tests/${label}.test.ts`], acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", slug, "--red-waiver", "the red run is not the subject of this test"]);
    const tree = addWorktree(label);
    const claimed = await loreIn(fixture.dir, ["claim", slug, "--worktree", tree.branch], session, env);
    expect(claimed.exitCode, claimed.text).toBe(0);
    const tip = commitIn(tree, { [`tests/${label}.test.ts`]: `// ${label}\n`, [`src/${label}.ts`]: `export const ${label} = 1;\n` });
    const finished = await loreIn(tree.path, ["finish", slug], session, env);
    expect(finished.exitCode, finished.text).toBe(0);
    return { slug, tree, tip };
  }

  const claimBy = (task: Finished, session: string): Promise<Out> => loreIn(fixture.dir, ["claim", task.slug, "--worktree", task.tree.branch], session);

  async function claimRows(slug: string): Promise<number> {
    const out = await fixture.mustRun(["audit", slug, "--action", "claim", "--json"]);
    const parsed = JSON.parse(out) as { data: unknown };
    const rows = Array.isArray(parsed.data) ? parsed.data : ((parsed.data as { entries?: unknown[] }).entries ?? []);
    return rows.length;
  }

  const claimOf = async (slug: string): Promise<{ finished_commit?: string; harness_run?: string } | undefined> =>
    (await fixture.readTask(slug)).extra["claim"] as { finished_commit?: string; harness_run?: string } | undefined;

  it("AC-DCS1-18: while the holder run is live, a run of its own session is refused with exit 5 and nothing is written", async () => {
    const task = await finishedByHelper("tk-live", "tk-live-s", "impl");
    const rowsBefore = await claimRows(task.slug);
    const refused = await claimBy(task, "tk-live-s");
    expect(refused.exitCode, refused.text).toBe(5);
    expect(await claimRows(task.slug)).toBe(rowsBefore);
    expect((await claimOf(task.slug))?.harness_run).toBe(agentRun("tk-live-s", "impl"));
  });

  it("AC-DCS1-18: once the holder run ended, a run of ANOTHER session is still refused with exit 5", async () => {
    const task = await finishedByHelper("tk-other", "tk-other-s", "impl");
    const ended = await loreIn(fixture.dir, ["run", "end", agentRun("tk-other-s", "impl"), "--reason", "helper stopped"], "tk-other-s");
    expect(ended.exitCode, ended.text).toBe(0);
    const rowsBefore = await claimRows(task.slug);
    const refused = await claimBy(task, "tk-other-stranger");
    expect(refused.exitCode, refused.text).toBe(5);
    expect(await claimRows(task.slug)).toBe(rowsBefore);
    expect((await claimOf(task.slug))?.harness_run).toBe(agentRun("tk-other-s", "impl"));
  });

  it("AC-DCS1-18: once the holder run ended, a run of the same session takes the claim (exit 0, one audit row, finished_commit kept)", async () => {
    const task = await finishedByHelper("tk-same", "tk-same-s", "impl");
    const ended = await loreIn(fixture.dir, ["run", "end", agentRun("tk-same-s", "impl"), "--reason", "helper stopped"], "tk-same-s");
    expect(ended.exitCode, ended.text).toBe(0);
    const rowsBefore = await claimRows(task.slug);
    const taken = await claimBy(task, "tk-same-s");
    expect(taken.exitCode, taken.text).toBe(0);
    expect(taken.text).toContain(agentRun("tk-same-s", "impl"));
    expect(await claimRows(task.slug)).toBe(rowsBefore + 1);
    const claim = await claimOf(task.slug);
    expect(claim?.harness_run).toBe("cc:tk-same-s");
    expect(claim?.finished_commit, "the finished mark is kept: an unchanged tip still counts as finished").toBe(task.tip);
    // the new holder is live, so a stranger is refused by the live holder
    const stranger = await claimBy(task, "tk-same-stranger");
    expect(stranger.exitCode, stranger.text).toBe(5);
  });
});
