// @reads assets/**
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
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

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
  const result = await runLoreInProcess(args, { cwd: repo, env: envFor(session, extra) });
  return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr, out: `${result.stdout}${result.stderr}` };
}
const git = (cwd: string, ...args: string[]): Run => exec(["git", ...args], cwd, "git-0");

function mustOk(run: Run, what: string): Run {
  if (run.status !== 0) throw new Error(`fixture step failed (${what}): exit ${run.status}\n${run.out}`);
  return run;
}

/** Task claimed from a fresh `agent-<agent>` worktree (own commit merged into main, evidence recorded, tree clean). */
async function makeCase(agent: string, session: string): Promise<Case> {
  const branch = `agent-${agent}`;
  const path = join(parent, branch);
  const created = mustOk(
    await lore(["create", "task", "--adhoc", "--title", `Done cleanup ${agent}`, "--content", "Throwaway task.", "--no-ai", "--ac-scope", "", "--json"], session),
    `create ${agent}`,
  );
  const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
  mustOk(git(repo, "worktree", "add", "-q", "-b", branch, path), `worktree add ${agent}`);
  mustOk(await lore(["claim", slug, "--worktree", path], session), `claim ${agent}`);
  writeFileSync(join(path, `${agent}.txt`), `${agent}\n`);
  mustOk(git(path, "add", "-A"), `add ${agent}`);
  mustOk(git(path, "commit", "-q", "-m", `own commit ${agent}`), `commit ${agent}`);
  mustOk(git(repo, "merge", "-q", "--no-edit", branch), `merge ${agent}`);
  mustOk(await lore(["evidence", slug, "--oracle", "test", "--command", "echo 1 passed", "--result", "pass", "--capture"], session), `evidence ${agent}`);
  return { slug, path, branch };
}

async function registerAgentRun(session: string, agent: string): Promise<void> {
  mustOk(await lore(["run", "register", "--harness", "claude-code", "--session", session], session), `register ${session}`);
  mustOk(await lore(["run", "register", "--harness", "claude-code", "--session", session, "--agent-id", agent, "--agent-type", "implementer"], session), `register ${session}:${agent}`);
}

const done = async (c: Case, session: string, extra: Record<string, string> = {}): Promise<Run> =>
  await lore(["done", c.slug, "--declare-no-new-tests", "fixture: throwaway task"], session, extra);

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
  mustOk(await lore(["create", "prd", "--title", "Root", "--content", "Root PRD.", "--no-ai", "--json"], "init-0"), "create prd");
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
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toBe(`worktree: removed ${c.path}`);
    expect(existsSync(c.path)).toBe(false);
    expect(branchExists(c.branch)).toBe(false);
  });

  it("NEGATIVE: the same with the run still open -> exit 0, `worktree: kept` with run-not-ended, the worktree remains", async () => {
    await registerAgentRun("S1", "BBB");
    const c = await makeCase("BBB", "S1");
    const r = await done(c, "S1");
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toBe(`worktree: kept ${c.path}: run-not-ended`);
    expect(existsSync(c.path)).toBe(true);
    expect(branchExists(c.branch)).toBe(true);
  });

  it("NEGATIVE: another session's stopped agent while that session is live -> kept foreign-live-session", async () => {
    await registerAgentRun("S5", "CCC");
    const c = await makeCase("CCC", "S6"); // the task is claimed (and done) by S6; the worktree's agent belongs to S5
    mustOk(await lore(["run", "end", "cc:S5:CCC", "--reason", "agent stopped"], "S5"), "end CCC");
    const r = await done(c, "S6"); // S5's main run (cc:S5) is open
    expect(r.status).toBe(0);
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

  it("REGRESSION: no output line contains `recent-activity`, and the retired quiet-window env var changes nothing", async () => {
    await registerAgentRun("S7", "DDD");
    const c = await makeCase("DDD", "S7");
    mustOk(await lore(["run", "end", "cc:S7:DDD", "--reason", "agent stopped"], "S7"), "end DDD");
    const r = await done(c, "S7", { LORE_WORKTREE_QUIET_MINUTES: "9999" });
    expect(r.status).toBe(0);
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
