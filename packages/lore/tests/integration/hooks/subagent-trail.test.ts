/**
 * @spec_ref AC-ST-2
 *
 * subagent-trail.mjs (SubagentStop) measures an isolated helper's changes in its own working
 * copy (spec-session-trail-a-session-local-record-of-what-each-run-4, Design > Helper measurement).
 * Isolation (I1): throwaway git repos + mkdtemp state bases + CLAUDE_STATE_BASE_OVERRIDE.
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, makeGitRepo, makeTmpDir, runHook } from "./hook-harness";

const SESSION = "S1";
const AGENT = "A1";
const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

interface Fixture {
  main: string;
  worktree: string;
  stateBase: string;
}

/** Main repo with src/a.ts, a linked worktree whose helper committed src/b.ts and wrote untracked src/c.ts. */
function makeFixture(): Fixture {
  const main = makeGitRepo();
  cleanup.push(main);
  git(main, "symbolic-ref", "HEAD", "refs/heads/main");
  mkdirSync(join(main, "src"));
  writeFileSync(join(main, "src/a.ts"), "export const a = 1;\n");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "init");
  const worktree = join(makeTmpDir("helper-wt-"), "wt");
  cleanup.push(join(worktree, ".."));
  git(main, "worktree", "add", "-q", "-b", "helper", worktree);
  writeFileSync(join(worktree, "src/b.ts"), "export const b = 1;\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "helper commit");
  writeFileSync(join(worktree, "src/c.ts"), "export const c = 1;\n"); // shell-made, untracked
  writeFileSync(join(main, "outside.ts"), "export const o = 1;\n"); // outside the worktree
  const stateBase = makeTmpDir("trail-state-");
  cleanup.push(stateBase);
  return { main, worktree, stateBase };
}

function start(f: Fixture): void {
  const r = runHook("session-trail-start.mjs", { hook_event_name: "SubagentStart", session_id: SESSION, agent_id: AGENT }, f.stateBase);
  expect(r.status).toBe(0);
}

function stop(f: Fixture, cwd: string) {
  return runHook("subagent-trail.mjs", { hook_event_name: "SubagentStop", session_id: SESSION, agent_id: AGENT, agent_type: "implementer", cwd, stop_hook_active: false }, f.stateBase);
}

function record(f: Fixture): any {
  return JSON.parse(readFileSync(join(f.stateBase, "sessions", SESSION, "helpers", `${AGENT}.json`), "utf8"));
}

function expectSilent(r: { status: number | null; stdout: string; stderr: string }): void {
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe("");
}

const RUN = `cc:${SESSION}:${AGENT}`;

describe("AC-ST-2 subagent-trail SubagentStop measurement", () => {
  it("HAPPY: an isolated helper records its committed and untracked files, not files outside the worktree", () => {
    const f = makeFixture();
    start(f);
    expectSilent(stop(f, f.worktree));
    const rec = record(f);
    expect(rec.isolated).toBe(true);
    expect(rec.end_count).toBe(1);
    expect(rec.working_copy).toBeTruthy();
    expect(rec.changes.measured).toBe(true);
    expect(rec.changes.value.base).toBe(git(f.main, "rev-parse", "main"));
    expect(rec.changes.value.files).toEqual([
      { path: "src/b.ts", status: "A", lines: 1, source: { kind: "run", run: RUN } },
      { path: "src/c.ts", status: "A", lines: 1, source: { kind: "run", run: RUN } },
    ]);
  });

  it("STATE: firing twice keeps only the second measurement and end_count 2", () => {
    const f = makeFixture();
    start(f);
    stop(f, f.worktree);
    const first = record(f);
    writeFileSync(join(f.worktree, "src/d.ts"), "export const d = 1;\n");
    expectSilent(stop(f, f.worktree));
    const second = record(f);
    expect(second.end_count).toBe(2);
    expect(second.started_at).toBe(first.started_at);
    expect(second.changes.value.files.map((x: any) => x.path)).toEqual(["src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(existsSync(join(f.stateBase, "sessions", SESSION, "helpers", `${AGENT}.judged.json`))).toBe(false);
  });

  it("NEGATIVE: a helper whose cwd is the main checkout records measured:false not isolated", () => {
    const f = makeFixture();
    start(f);
    expectSilent(stop(f, f.main));
    const rec = record(f);
    expect(rec.isolated).toBe(false);
    expect(rec.changes).toEqual({ measured: false, reason: "not isolated" });
    expect(rec.end_count).toBe(1);
  });

  it("ERROR: a helper whose worktree was removed records measured:false with a reason", () => {
    const f = makeFixture();
    start(f);
    git(f.main, "worktree", "remove", "--force", f.worktree);
    expectSilent(stop(f, f.worktree));
    const rec = record(f);
    expect(rec.changes.measured).toBe(false);
    expect(rec.changes.reason).toMatch(/\S/);
    expect(rec.end_count).toBe(1);
  });

  it("REGRESSION: after the main checkout merges the helper branch, the second end still records src/b.ts (stored base reused)", () => {
    const f = makeFixture();
    start(f);
    stop(f, f.worktree);
    const baseAtFirstEnd = record(f).changes.value.base;
    git(f.main, "merge", "-q", "--no-ff", "-m", "merge helper", "helper");
    expectSilent(stop(f, f.worktree));
    const rec = record(f);
    expect(rec.end_count).toBe(2);
    expect(rec.changes.value.base).toBe(baseAtFirstEnd);
    expect(rec.changes.value.files.map((x: any) => x.path)).toContain("src/b.ts");
  });

  it("REGRESSION: a failed end between two measured ends keeps the end-1 base for end 3 after a merge", () => {
    const f = makeFixture();
    start(f);
    stop(f, f.worktree);
    const baseAtFirstEnd = record(f).changes.value.base;
    const hidden = `${f.worktree}-hidden`;
    renameSync(f.worktree, hidden);
    expectSilent(stop(f, f.worktree));
    const failed = record(f);
    expect(failed.end_count).toBe(2);
    expect(failed.changes.measured).toBe(false);
    expect(failed.base).toBe(baseAtFirstEnd);
    renameSync(hidden, f.worktree);
    git(f.main, "merge", "-q", "--no-ff", "-m", "merge helper", "helper");
    expectSilent(stop(f, f.worktree));
    const third = record(f);
    expect(third.end_count).toBe(3);
    expect(third.changes.value.base).toBe(baseAtFirstEnd);
    expect(third.changes.value.files.map((x: any) => x.path)).toContain("src/b.ts");
  });

  it("BOUNDARY: payloads that cannot be recorded exit 0 with empty output and write nothing", () => {
    const f = makeFixture();
    const noSession = runHook("subagent-trail.mjs", { hook_event_name: "SubagentStop", agent_id: AGENT, cwd: f.worktree }, f.stateBase);
    expectSilent(noSession);
    const noAgent = runHook("subagent-trail.mjs", { hook_event_name: "SubagentStop", session_id: SESSION, cwd: f.worktree }, f.stateBase);
    expectSilent(noAgent);
    expect(existsSync(join(f.stateBase, "sessions"))).toBe(false);
  });

  it("STATE: an end without a SubagentStart record still creates the record at end_count 1", () => {
    const f = makeFixture();
    expectSilent(stop(f, f.worktree));
    const rec = record(f);
    expect(rec.run).toBe(RUN);
    expect(rec.end_count).toBe(1);
    expect(rec.changes.measured).toBe(true);
  });
});
