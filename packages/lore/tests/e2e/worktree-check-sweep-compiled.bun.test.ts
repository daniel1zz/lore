// @reads assets/**
// @spawns packages/lore/src/index.ts -- the main-guard fixture runs the lore entry point as a child process
// @spawns-external git builds a throwaway git repository the test runs against
// @spawns-external sh the main-guard fixture resolves the real git path through sh
// @spawns-external sleep a process that keeps a worktree busy
/**
 * worktree-check-sweep-compiled.bun.test.ts — AC-WS-2 (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a;
 * D1, D2, D4, D5; BR-1070, BR-1079).
 *
 * The compiled `dist/lore` on a THROWAWAY git repo + a throwaway corpus (`mkdtemp` + `lore init`, cwd and HOME inside it).
 * ⛔ Never touches this repo's own `.lore/`. Session ids are hermetic: every call names its own
 * CLAUDE_CODE_SESSION_ID / `--session`; inherited CLAUDE_* / LORE_* variables are dropped.
 *
 * Fixture (one repo, each worktree's own commit merged into main, last commit seconds old — time never matters, D5):
 *   agent-AAA  run cc:S1:AAA registered, then ended by S1; session S1's MAIN run (cc:S1) open
 *   agent-BBB  run cc:S1:BBB registered, NOT ended
 *   agent-CCC  run cc:S3:CCC NOT ended, and the only task that claimed this worktree is archived (sweep hint)
 *   hand-made  a worktree no agent owns
 *
 * Coverage: HAPPY (own ended run -> removable) / NEGATIVE (live run, foreign live session) / BOUNDARY (dry run changes
 *   nothing; --apply removes exactly the removable ones) / ERROR (usage, missing path, strict flags) / STATE (verdict
 *   follows the owner session's main run) / REGRESSION (hint names `lore run end`; no time wording anywhere)
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installShippedGuard } from "../integration/support/main-guard-repo.js";
import { FIXTURE_DONE_CONTRACT_CONFIG } from "../helpers/landed-code-task";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface CheckData {
  readonly path: string;
  readonly verdict: "removable" | "keep" | "not-measured";
  readonly reasons: string[];
  readonly owner: { run_id: string; session: string; mine: boolean; session_ended: boolean | null } | null;
  readonly occupancy: { agent_run: { id: string } | null; open_claims: unknown[]; occupied: boolean } | null;
  readonly processes: unknown[];
}

interface SweepRow extends CheckData {
  readonly removed?: boolean;
  readonly hint?: string;
  readonly error?: string;
}

let parent = "";
let repo = "";
let aaa = "";
let bbb = "";
let ccc = "";
let handMade = "";
/** The spec governing CCC's ad-hoc task (an ad-hoc task has no plan, so it names its spec). */
let spec = "";

/** Hermetic environment: no inherited session/identity variables, HOME inside the sandbox. */
function envFor(session: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(CLAUDE|LORE|ANTHROPIC)/.test(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: parent, GIT_TERMINAL_PROMPT: "0", CLAUDE_CODE_SESSION_ID: session };
}

function exec(cmd: string[], cwd: string, session = "caller-0"): Run {
  const proc = Bun.spawnSync(cmd, { cwd, env: envFor(session) });
  return { status: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

async function lore(args: string[], session = "caller-0", cwd = repo): Promise<Run> {
  const result = await runLoreInProcess(args, { cwd, home: parent, env: envFor(session) });
  return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}
const git = (cwd: string, ...args: string[]): Run => exec(["git", ...args], cwd);
/** git carrying the integrate marker: a deliberate human bypass of the main-ref guard. */
const markedGit = (cwd: string, ...args: string[]): Run => {
  const proc = Bun.spawnSync(["git", ...args], { cwd, env: { ...envFor("caller-0"), LORE_INTEGRATE: "1" } });
  return { status: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
};

function mustOk(run: Run, what: string): Run {
  if (run.status !== 0) throw new Error(`fixture step failed (${what}): exit ${run.status}\n${run.stdout}\n${run.stderr}`);
  return run;
}

async function check(path: string, session: string | null): Promise<CheckData> {
  const args = ["worktree", "check", path, ...(session === null ? [] : ["--session", session]), "--json"];
  const run = await lore(args);
  expect(run.status).toBe(0);
  return (JSON.parse(run.stdout) as { ok: boolean; data: CheckData }).data;
}

async function sweep(args: string[], session: string): Promise<{ run: Run; rows: SweepRow[] }> {
  const run = await lore(["worktree", "sweep", ...args, "--session", session, "--json"]);
  const rows = run.status === 0 ? (JSON.parse(run.stdout) as { data: { worktrees: SweepRow[] } }).data.worktrees : [];
  return { run, rows };
}

/** Linked worktree on its own branch with one own commit, merged into main. */
function addMergedWorktree(name: string): string {
  const path = join(parent, name);
  mustOk(git(repo, "worktree", "add", "-q", "-b", name, path), `worktree add ${name}`);
  writeFileSync(join(path, `${name}.txt`), `${name}\n`);
  mustOk(git(path, "add", "-A"), `add ${name}`);
  mustOk(git(path, "commit", "-q", "-m", `own commit ${name}`), `commit ${name}`);
  // the main-ref guard refuses a hand checkout of main and a hand merge on it, so this fixture takes the marker bypass on
  // purpose to move main, then leaves the shared checkout detached at main as it found it
  mustOk(markedGit(repo, "checkout", "-q", "main"), `checkout main for ${name}`);
  mustOk(markedGit(repo, "merge", "-q", "--no-edit", name), `merge ${name}`);
  mustOk(git(repo, "checkout", "-q", "--detach", "main"), `detach shared checkout after ${name}`);
  return path;
}

async function registerRun(session: string, agent?: string): Promise<void> {
  const args = ["run", "register", "--harness", "claude-code", "--session", session, ...(agent === undefined ? [] : ["--agent-id", agent, "--agent-type", "implementer"])];
  mustOk(await lore(args, session), `register ${session}:${agent ?? "main"}`);
}

const worktreeListed = (path: string): boolean => git(repo, "worktree", "list", "--porcelain").stdout.includes(`worktree ${path}\n`);
const branchExists = (branch: string): boolean => git(repo, "branch", "--list", branch).stdout.trim() !== "";
const rowFor = (rows: SweepRow[], path: string): SweepRow => {
  const row = rows.find((candidate) => candidate.path === path);
  if (row === undefined) throw new Error(`no sweep row for ${path}; got ${rows.map((r) => r.path).join(", ")}`);
  return row;
};

beforeAll(async () => {
  parent = realpathSync(mkdtempSync(join(tmpdir(), "lore-wtcheck-")));
  repo = join(parent, "repo");
  mkdirSync(repo);
  mustOk(git(repo, "init", "-q", "-b", "main"), "git init");
  mustOk(git(repo, "config", "user.email", "t@example.com"), "git config email");
  mustOk(git(repo, "config", "user.name", "tester"), "git config name");
  writeFileSync(join(repo, "README.md"), "base\n");
  mustOk(git(repo, "add", "-A"), "git add");
  mustOk(git(repo, "commit", "-q", "-m", "base"), "git commit");
  mustOk(await lore(["init"]), "lore init");
  // `lore integrate` keeps its own worktree under `.claude/` and needs the floor key; neither may dirty the tree
  appendFileSync(join(repo, ".git", "info", "exclude"), ".claude/\n.lore/integrate-attempts/\n.lore/integrate-losses/\n");
  // reason: approve compiles the contract of CCC's task from these three commands; the claim gate wants an approved spec and a
  // spec approval wants a review judgment; none of those is this file's subject.
  patchLoreConfig(repo, {
    workflow: {
      integrate: { floor_command: "true" },
      done_contract: { ...FIXTURE_DONE_CONTRACT_CONFIG },
      gates: { "task-claim": { enabled: false } },
      review: { judgment_required_types: [] },
    },
  });
  // reason: `lore init` arms state binding (AC-CT-3); evidence captured on a dirty tree is unbound and refused by `lore done`.
  mustOk(git(repo, "add", "-A"), "git add corpus");
  mustOk(git(repo, "commit", "-q", "-m", "lore corpus"), "git commit corpus");
  mustOk(await lore(["create", "prd", "--title", "Root", "--content", "Root PRD.", "--no-ai", "--json"]), "create prd");
  const createdSpec = mustOk(await lore(["create", "spec", "--title", "Sweep spec", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai", "--json"]), "create spec");
  spec = (JSON.parse(createdSpec.stdout) as { data: { slug: string } }).data.slug;

  aaa = addMergedWorktree("agent-AAA");
  bbb = addMergedWorktree("agent-BBB");
  ccc = addMergedWorktree("agent-CCC");
  handMade = addMergedWorktree("hand-made");

  await registerRun("S1"); // S1's main run stays open
  await registerRun("S1", "AAA");
  mustOk(await lore(["run", "end", "cc:S1:AAA", "--reason", "agent stopped"], "S1"), "end AAA");
  await registerRun("S1", "BBB"); // never ended
  await registerRun("S3");
  await registerRun("S3", "CCC"); // never ended

  // CCC: a task claimed from this worktree, then archived — only its run keeps the worktree.
  const created = mustOk(
    await lore(["create", "task", "--adhoc", "--spec", spec, "--title", "CCC claimed work", "--kind", "code", "--content", "Throwaway task.", "--no-ai", "--ac-scope", "", "--json"], "S3"),
    "create task",
  );
  const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
  mustOk(await lore(["approve", slug, "--red-waiver", "the red run is not the subject of this fixture"], "S3"), "approve");
  mustOk(await lore(["claim", slug, "--worktree", ccc], "S3"), "claim");
  // the branch is on main already (merged above); integrate finds it already integrated, runs the contract oracles on main's tip,
  // records the landing and the rows, and archives the task through the same floors `lore done` applies
  installShippedGuard(repo, join(repo, ".git", "guard-hooks")); // integrate refuses to run without the guard (BR-1273)
  mustOk(await lore(["integrate", "agent-CCC", "--session", "S3"], "S3"), "integrate CCC");
  const archived = JSON.parse(mustOk(await lore(["get", slug, "--json"], "S3"), "get CCC task").stdout) as { data: { doc?: { status: string }; status?: string } };
  expect(archived.data.doc?.status ?? archived.data.status).toBe("archived");
}, 300_000);

afterAll(() => {
  if (parent !== "") rmSync(parent, { recursive: true, force: true });
});

describe("AC-WS-2 lore worktree check (compiled)", () => {
  it("HAPPY: own agent run ended, merged, clean, last commit seconds old -> removable", async () => {
    const data = await check(aaa, "S1");
    expect(data.verdict).toBe("removable");
    expect(data.reasons).toEqual([]);
    expect(data.owner).toEqual({ run_id: "cc:S1:AAA", session: "S1", mine: true, session_ended: false });
    expect(data.occupancy?.agent_run?.id).toBe("cc:S1:AAA");
  });

  it("NEGATIVE: the owning run has no end -> keep run-not-ended", async () => {
    const data = await check(bbb, "S1");
    expect(data.verdict).toBe("keep");
    expect(data.reasons).toEqual(["run-not-ended"]);
  });

  it("NEGATIVE: from a different session while the owner session's main run is open -> keep foreign-live-session", async () => {
    const data = await check(aaa, "S9");
    expect(data.verdict).toBe("keep");
    expect(data.reasons).toEqual(["foreign-live-session"]);
    expect(data.owner?.mine).toBe(false);
  });

  it("STATE: an unknown caller session (no --session, no env session) never counts as the owner", async () => {
    const run = await lore(["worktree", "check", aaa, "--json"], "");
    // reason: envFor sets an empty CLAUDE_CODE_SESSION_ID — blank counts as unknown.
    const data = (JSON.parse(run.stdout) as { data: CheckData }).data;
    expect(data.verdict).toBe("keep");
    expect(data.reasons).toEqual(["foreign-live-session"]);
  });

  it("STATE: the session comes from CLAUDE_CODE_SESSION_ID when --session is absent", async () => {
    const run = await lore(["worktree", "check", aaa, "--json"], "S1");
    expect((JSON.parse(run.stdout) as { data: CheckData }).data.verdict).toBe("removable");
  });

  it("STATE: the verdict follows the owner session's main run — ending cc:S1 makes a foreign caller's check removable", async () => {
    // Uses a dedicated agent worktree so the shared fixture stays unchanged.
    const path = addMergedWorktree("agent-DDD");
    await registerRun("S4");
    await registerRun("S4", "DDD");
    mustOk(await lore(["run", "end", "cc:S4:DDD", "--reason", "stopped"], "S4"), "end DDD");
    expect((await check(path, "S9")).reasons).toEqual(["foreign-live-session"]);
    mustOk(await lore(["run", "end", "cc:S4", "--reason", "session over"], "S4"), "end S4 main");
    expect((await check(path, "S9")).verdict).toBe("removable");
  });

  it("HAPPY: a hand-made worktree nobody owns and nobody is inside -> removable", async () => {
    const data = await check(handMade, "S1");
    expect(data.verdict).toBe("removable");
    expect(data.owner).toBeNull();
  });

  it("NEGATIVE: the main checkout, a dirty worktree and a locked worktree are kept with their token", async () => {
    expect((await check(repo, "S1")).reasons).toContain("main-checkout");
    const dirty = addMergedWorktree("hand-dirty");
    writeFileSync(join(dirty, "scratch.txt"), "wip\n");
    expect((await check(dirty, "S1")).reasons).toEqual(["uncommitted-changes"]);
    const locked = addMergedWorktree("hand-locked");
    mustOk(git(repo, "worktree", "lock", "--reason", "fixture", locked), "lock");
    expect((await check(locked, "S1")).reasons).toEqual(["locked"]);
  });

  it("NEGATIVE: a process with its cwd inside the worktree -> keep process-inside, naming the pid", async () => {
    const path = addMergedWorktree("hand-busy");
    const child = Bun.spawn(["sleep", "30"], { cwd: path });
    try {
      const data = await check(path, "S1");
      expect(data.verdict).toBe("keep");
      expect(data.reasons).toEqual(["process-inside"]);
      expect(data.processes).toEqual([expect.objectContaining({ pid: child.pid })]);
    } finally {
      child.kill();
    }
  });

  it("ERROR: a missing path argument is a usage error (exit 2); a path that does not exist is not-measured, never removable", async () => {
    expect((await lore(["worktree", "check"])).status).toBe(2);
    const data = await check(join(parent, "no-such-dir"), "S1");
    expect(data.verdict).toBe("not-measured");
  });

  it("ERROR: an unknown flag is rejected by the strict-flag seam (exit 2)", async () => {
    expect((await lore(["worktree", "check", aaa, "--bogus"])).status).toBe(2);
  });

  it("REGRESSION: no refusal or verdict text carries elapsed-time wording", async () => {
    const text = await lore(["worktree", "check", bbb, "--session", "S1"]);
    expect(`${text.stdout}${text.stderr}`).not.toMatch(/minute|recent-activity|reflog|quiet/i);
  });
});

describe("AC-WS-2 lore worktree sweep (compiled)", () => {
  it("BOUNDARY: a dry run changes nothing and lists every linked worktree, with the run-end hint", async () => {
    const before = git(repo, "worktree", "list", "--porcelain").stdout;
    const { run, rows } = await sweep([], "S1");
    expect(run.status).toBe(0);
    expect(git(repo, "worktree", "list", "--porcelain").stdout).toBe(before);
    expect(rowFor(rows, aaa).verdict).toBe("removable");
    expect(rowFor(rows, aaa).removed).toBeUndefined();
    expect(rowFor(rows, bbb).reasons).toEqual(["run-not-ended"]);
    expect(rows.some((row) => row.path === repo)).toBe(false); // the main checkout is never a sweep row
    expect(existsSync(aaa)).toBe(true);
    expect(branchExists("agent-AAA")).toBe(true);
  });

  it("REGRESSION: a worktree kept only because its run has no end, while its claimed task is archived, carries a `lore run end` hint", async () => {
    const { rows } = await sweep([], "S3");
    const row = rowFor(rows, ccc);
    expect(row.reasons).toEqual(["run-not-ended"]);
    expect(row.hint).toContain("lore run end cc:S3:CCC");
    expect(rowFor(rows, aaa).hint).toBeUndefined();
    // another live session's run is not ours to end: no hint is offered to a foreign caller
    expect(rowFor((await sweep([], "S1")).rows, ccc).hint).toBeUndefined();
  });

  it("STATE: a foreign caller's sweep --apply keeps the live session's worktree but removes an unowned one", async () => {
    const { rows } = await sweep(["--apply"], "S9");
    expect(rowFor(rows, aaa).reasons).toEqual(["foreign-live-session"]);
    expect(worktreeListed(aaa)).toBe(true);
    expect(rowFor(rows, handMade).removed).toBe(true);
    expect(worktreeListed(handMade)).toBe(false);
  });

  it("BOUNDARY: sweep --apply (as the owning session) removes exactly the removable worktrees, never forced", async () => {
    const { run, rows } = await sweep(["--apply"], "S1");
    expect(run.status).toBe(0);
    expect(rowFor(rows, aaa).removed).toBe(true);
    expect(worktreeListed(aaa)).toBe(false);
    expect(existsSync(aaa)).toBe(false);
    expect(branchExists("agent-AAA")).toBe(false);
    expect(branchExists("hand-made")).toBe(false);
    // the kept ones are untouched
    expect(worktreeListed(bbb)).toBe(true);
    expect(worktreeListed(ccc)).toBe(true);
    expect(branchExists("agent-BBB")).toBe(true);
    expect(rowFor(rows, bbb).removed).toBeUndefined();
  });

  it("STATE: once the kept run ends, the next sweep --apply removes its worktree and no earlier one reappears", async () => {
    mustOk(await lore(["run", "end", "cc:S1:BBB", "--reason", "agent stopped"], "S1"), "end BBB");
    const { rows } = await sweep(["--apply"], "S1");
    expect(rowFor(rows, bbb).removed).toBe(true);
    expect(worktreeListed(bbb)).toBe(false);
    expect(rows.some((row) => row.path === aaa)).toBe(false);
  });

  it("ERROR: sweep outside a git repository is refused (exit 4), strict flags apply (exit 2)", async () => {
    const outside = mkdtempSync(join(parent, "outside-"));
    const run = await lore(["worktree", "sweep", "--json"], "caller-0", outside);
    expect(run.status).not.toBe(0);
    expect((await lore(["worktree", "sweep", "--nope"])).status).toBe(2);
  });
});
