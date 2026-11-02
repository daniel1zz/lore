// @reads assets/**
// @spawns packages/lore/src/index.ts -- the main-guard fixture runs the lore entry point as a child process
// @spawns-external git builds a throwaway git repository the test runs against
// @spawns-external sh the main-guard fixture resolves the real git path through sh
// @spawns-external sleep an occupant process that keeps a worktree busy
/**
 * done-worktree-cleanup-compiled.bun.test.ts — AC-WS-3 (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a;
 * D1, D3, D5; BR-1079): `lore done` removes its claim-recorded worktree through the SAME test as `lore worktree check`.
 *
 * The compiled `dist/lore` on a THROWAWAY git repo + corpus (`mkdtemp` + `lore init`, cwd and HOME inside it). ⛔ Never
 * touches this repo's own `.lore/`. Hermetic session ids: each call names its own CLAUDE_CODE_SESSION_ID; inherited
 * CLAUDE_* / LORE_* / ANTHROPIC* variables are dropped.
 *
 * Fixture: each case has its OWN task + `agent-<id>` worktree + branch; the worktree's own commit is merged into main and
 * its last commit is seconds old (a 30-minute quiet window would have kept it — time is never consulted, D5).
 *
 * Coverage: HAPPY (run ended -> removed) / NEGATIVE (run open -> kept run-not-ended; another live session -> kept
 *   foreign-live-session) / BOUNDARY (done exits 0 either way) / REGRESSION (no `recent-activity` anywhere; no
 *   LORE_WORKTREE_QUIET_MINUTES knob)
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
import { FIXTURE_DONE_CONTRACT_CONFIG, landCodeTask } from "../helpers/landed-code-task";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { templatedFieldsArgs } from "../helpers/templated-create";

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly out: string;
}

interface Case {
  readonly slug: string;
  readonly path: string;
  readonly branch: string;
}

let parent = "";
let repo = "";
/** The spec every fixture task is governed by (an ad-hoc task has no plan, so it names its spec). */
let spec = "";

function envFor(session: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(CLAUDE|LORE|ANTHROPIC)/.test(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: parent, GIT_TERMINAL_PROMPT: "0", CLAUDE_CODE_SESSION_ID: session, ...extra };
}

function exec(cmd: string[], cwd: string, session: string, extra: Record<string, string> = {}): Run {
  const proc = Bun.spawnSync(cmd, { cwd, env: envFor(session, extra) });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { status: proc.exitCode ?? -1, stdout, stderr, out: `${stdout}${stderr}` };
}

async function lore(args: string[], session: string, extra: Record<string, string> = {}): Promise<Run> {
  const result = await runLoreInProcess(args, { cwd: repo, home: parent, env: envFor(session, extra) });
  return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr, out: `${result.stdout}${result.stderr}` };
}
const git = (cwd: string, ...args: string[]): Run => exec(["git", ...args], cwd, "git-0");

function mustOk(run: Run, what: string): Run {
  if (run.status !== 0) throw new Error(`fixture step failed (${what}): exit ${run.status}\n${run.out}`);
  return run;
}

/** Task claimed from a fresh `agent-<agent>` worktree (own commit merged into main, evidence recorded, tree clean). */
async function makeCase(agent: string, session: string, claimValue: "path" | "branch" = "path"): Promise<Case> {
  const branch = `agent-${agent}`;
  const path = join(parent, branch);
  // an approved code task claimed on its own branch (the dispatch protocol claims with `--worktree "$(git branch --show-current)"`,
  // i.e. the BRANCH name, CL-1), landed on main with the landing record, and holding a runner pass for each oracle of its stored
  // contract: the state `lore done` judges by the contract compiled at approve
  const landed = await landCodeTask(
    {
      dir: repo,
      git: (args) => mustOk(git(repo, ...args), `git ${args.join(" ")}`).stdout.trim(),
      lore: async (args, as) => {
        const run = await lore([...args], as);
        return { exitCode: run.status, stdout: run.stdout, stderr: run.stderr };
      },
    },
    { title: `Done cleanup ${agent}`, branch, worktree: path, claimValue, session, spec },
  );
  return { slug: landed.slug, path, branch };
}

async function registerAgentRun(session: string, agent: string): Promise<void> {
  mustOk(await lore(["run", "register", "--harness", "claude-code", "--session", session], session), `register ${session}`);
  mustOk(await lore(["run", "register", "--harness", "claude-code", "--session", session, "--agent-id", agent, "--agent-type", "implementer"], session), `register ${session}:${agent}`);
}

const done = async (c: Case, session: string, extra: Record<string, string> = {}): Promise<Run> =>
  await lore(["done", c.slug], session, extra);

const worktreeLine = (run: Run): string => /^worktree:.*$/m.exec(run.stdout)?.[0] ?? "";
const branchExists = (branch: string): boolean => git(repo, "branch", "--list", branch).stdout.trim() !== "";

beforeAll(async () => {
  parent = realpathSync(mkdtempSync(join(tmpdir(), "lore-done-wtc-")));
  repo = join(parent, "repo");
  mkdirSync(repo);
  mustOk(git(repo, "init", "-q", "-b", "main"), "git init");
  mustOk(git(repo, "config", "user.email", "t@example.com"), "git config email");
  mustOk(git(repo, "config", "user.name", "tester"), "git config name");
  writeFileSync(join(repo, "README.md"), "base\n");
  mustOk(git(repo, "add", "-A"), "git add");
  mustOk(git(repo, "commit", "-q", "-m", "base"), "git commit");
  mustOk(await lore(["init"], "init-0"), "lore init");
  // approve compiles the contract of each fixture task from these three commands (a code task needs all of them)
  appendFileSync(join(repo, ".git", "info", "exclude"), ".claude/\n");
  // reason: the claim gate wants an approved spec and a spec approval wants a review judgment; neither is this file's subject.
  patchLoreConfig(repo, {
    workflow: {
      done_contract: { ...FIXTURE_DONE_CONTRACT_CONFIG },
      gates: { "task-claim": { enabled: false } },
      review: { judgment_required_types: [] },
    },
  });
  // reason: `lore init` arms state binding (AC-CT-3); evidence captured on a dirty tree is unbound and refused by `lore done`.
  mustOk(git(repo, "add", "-A"), "git add corpus");
  mustOk(git(repo, "commit", "-q", "-m", "lore corpus"), "git commit corpus");
  mustOk(await lore(["create", "prd", "--title", "Root", ...templatedFieldsArgs("prd"), "--no-ai", "--json"], "init-0"), "create prd");
  const createdSpec = mustOk(await lore(["create", "spec", "--title", "Cleanup spec", "--kind", "tech", ...templatedFieldsArgs("spec", { kind: "tech" }), "--no-ai", "--json"], "init-0"), "create spec");
  spec = (JSON.parse(createdSpec.stdout) as { data: { slug: string } }).data.slug;
}, 300_000);

afterAll(() => {
  if (parent !== "") rmSync(parent, { recursive: true, force: true });
});

describe("AC-WS-3 lore done removes its worktree through the single removal test (compiled)", () => {
  it("HAPPY: implementer run ended, merged, clean, last commit seconds old -> removed, worktree and branch gone", async () => {
    await registerAgentRun("S1", "AAA");
    const c = await makeCase("AAA", "S1");
    mustOk(await lore(["run", "end", "cc:S1:AAA", "--reason", "agent stopped"], "S1"), "end AAA");
    const r = await done(c, "S1");
    expect(r.status, r.out).toBe(0);
    expect(worktreeLine(r)).toBe(`worktree: removed ${c.path}`);
    expect(existsSync(c.path)).toBe(false);
    expect(branchExists(c.branch)).toBe(false);
  });

  it("NEGATIVE: the same with the run still open -> exit 0, `worktree: kept` with run-not-ended, the worktree remains", async () => {
    await registerAgentRun("S1", "BBB");
    const c = await makeCase("BBB", "S1");
    const r = await done(c, "S1");
    expect(r.status, r.out).toBe(0);
    expect(worktreeLine(r)).toBe(`worktree: kept ${c.path}: run-not-ended`);
    expect(existsSync(c.path)).toBe(true);
    expect(branchExists(c.branch)).toBe(true);
  });

  it("NEGATIVE: another session's stopped agent while that session is live -> kept foreign-live-session", async () => {
    await registerAgentRun("S5", "CCC");
    const c = await makeCase("CCC", "S6"); // the task is claimed (and done) by S6; the worktree's agent belongs to S5
    mustOk(await lore(["run", "end", "cc:S5:CCC", "--reason", "agent stopped"], "S5"), "end CCC");
    const r = await done(c, "S6"); // S5's main run (cc:S5) is open
    expect(r.status, r.out).toBe(0);
    expect(worktreeLine(r)).toBe(`worktree: kept ${c.path}: foreign-live-session`);
    expect(existsSync(c.path)).toBe(true);
  });

  it("STATE: once the owner session ends, a second done-style pass (worktree sweep --apply) removes it", async () => {
    mustOk(await lore(["run", "end", "cc:S5", "--reason", "session over"], "S5"), "end S5 main");
    const c = { path: join(parent, "agent-CCC"), branch: "agent-CCC" };
    const swept = await lore(["worktree", "sweep", "--apply", "--json"], "S6");
    expect(swept.status).toBe(0);
    expect(existsSync(c.path)).toBe(false);
    expect(branchExists(c.branch)).toBe(false);
  });

  it("BRANCH CLAIM (a): the claim records the branch name; clean+merged+unoccupied+run ended -> removed, path named, exit 0", async () => {
    await registerAgentRun("S10", "FFF");
    const c = await makeCase("FFF", "S10", "branch");
    mustOk(await lore(["run", "end", "cc:S10:FFF", "--reason", "agent stopped"], "S10"), "end FFF");
    const r = await done(c, "S10");
    expect(r.status, r.out).toBe(0);
    expect(worktreeLine(r)).toBe(`worktree: removed ${c.path}`);
    expect(existsSync(c.path)).toBe(false);
    expect(branchExists(c.branch)).toBe(false);
  });

  it("BRANCH CLAIM (b): resolves, but a live process has its cwd inside -> kept with the removal test's reason, exit 0", async () => {
    await registerAgentRun("S11", "GGG");
    const c = await makeCase("GGG", "S11", "branch");
    mustOk(await lore(["run", "end", "cc:S11:GGG", "--reason", "agent stopped"], "S11"), "end GGG");
    const occupant = Bun.spawn(["sleep", "120"], { cwd: c.path, env: envFor("S11") });
    try {
      const r = await done(c, "S11");
      expect(r.status, r.out).toBe(0);
      expect(worktreeLine(r)).toBe(`worktree: kept ${c.path}: process-inside`);
      expect(existsSync(c.path)).toBe(true);
      expect(branchExists(c.branch)).toBe(true);
    } finally {
      occupant.kill();
      await occupant.exited;
    }
  });

  it("BRANCH CLAIM (c): neither a path nor a branch resolves -> gone, naming both lookups, exit 0", async () => {
    await registerAgentRun("S12", "HHH");
    const c = await makeCase("HHH", "S12", "branch");
    mustOk(git(repo, "worktree", "remove", c.path), "remove HHH worktree");
    mustOk(git(repo, "branch", "-d", c.branch), "delete HHH branch");
    const r = await done(c, "S12");
    expect(r.status, r.out).toBe(0);
    expect(worktreeLine(r)).toBe(`worktree: gone ${c.branch}: ${c.branch} is not an absolute path; no worktree has branch ${c.branch}`);
  });

  it("BRANCH CLAIM sweep: an archived task's branch-claimed worktree is removed by `worktree sweep --apply` once the run ends", async () => {
    await registerAgentRun("S13", "III");
    const c = await makeCase("III", "S13", "branch");
    const kept = await done(c, "S13");
    expect(kept.status).toBe(0);
    expect(worktreeLine(kept)).toBe(`worktree: kept ${c.path}: run-not-ended`);
    mustOk(await lore(["run", "end", "cc:S13:III", "--reason", "agent stopped"], "S13"), "end III");
    const swept = await lore(["worktree", "sweep", "--apply", "--json"], "S13");
    expect(swept.status).toBe(0);
    expect(existsSync(c.path)).toBe(false);
    expect(branchExists(c.branch)).toBe(false);
  });

  it("REGRESSION: no output line contains `recent-activity`, and the retired quiet-window env var changes nothing", async () => {
    await registerAgentRun("S7", "DDD");
    const c = await makeCase("DDD", "S7");
    mustOk(await lore(["run", "end", "cc:S7:DDD", "--reason", "agent stopped"], "S7"), "end DDD");
    const r = await done(c, "S7", { LORE_WORKTREE_QUIET_MINUTES: "9999" });
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain("recent-activity");
    expect(worktreeLine(r)).toBe(`worktree: removed ${c.path}`);
  });

  it("REGRESSION: every `worktree:` line printed across the suite avoids time wording", async () => {
    await registerAgentRun("S8", "EEE");
    const c = await makeCase("EEE", "S8");
    const r = await done(c, "S8");
    expect(r.out).not.toMatch(/recent-activity|quiet|minute|reflog/i);
  });
});
