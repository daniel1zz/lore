// @spawns assets/hooks/session-trail-start.mjs
// @spawns assets/hooks/subagent-trail.mjs
/**
 * @spec_ref AC-ST-2
 *
 * AU-T26: an isolated helper that merges main into its branch is charged only with what ITS commits
 * and uncommitted edits changed, never with what main brought in (spec session-trail D6 keeps the
 * stored base; the merged-in side is subtracted from the measured files).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, makeGitRepo, makeTmpDir, runHook } from "./hook-harness";

const SESSION = "S1";
const AGENT = "A1";
const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

interface Fixture { main: string; worktree: string; stateBase: string }

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
  const stateBase = makeTmpDir("trail-state-");
  cleanup.push(stateBase);
  return { main, worktree, stateBase };
}

function stop(f: Fixture): void {
  const r = runHook("subagent-trail.mjs", { hook_event_name: "SubagentStop", session_id: SESSION, agent_id: AGENT, agent_type: "implementer", cwd: f.worktree, stop_hook_active: false }, f.stateBase);
  expect(r.status).toBe(0);
}

function paths(f: Fixture): string[] {
  const rec = JSON.parse(readFileSync(join(f.stateBase, "sessions", SESSION, "helpers", `${AGENT}.json`), "utf8"));
  expect(rec.changes.measured).toBe(true);
  return rec.changes.value.files.map((x: { path: string }) => x.path).sort();
}

function commitOn(dir: string, file: string, body: string, msg: string): void {
  writeFileSync(join(dir, file), body);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", msg);
}

describe("AU-T26 helper changes exclude commits merged in from main", () => {
  it("AU-T26 HAPPY: helper commits A, merges a main that changed B -> only A is charged", () => {
    const f = makeFixture();
    commitOn(f.worktree, "src/helperA.ts", "export const A = 1;\n", "helper A");
    stop(f); // first measured end fixes the base
    commitOn(f.main, "src/mainB.ts", "export const B = 1;\n", "main B");
    git(f.worktree, "merge", "-q", "--no-ff", "-m", "merge main", "main");
    stop(f);
    expect(paths(f)).toEqual(["src/helperA.ts"]);
  });

  it("AU-T26 CONTROL: the helper's own change to a file main also changed still counts", () => {
    const f = makeFixture();
    commitOn(f.worktree, "src/own.ts", "export const own = 1;\n", "helper own");
    stop(f);
    commitOn(f.main, "src/mainB.ts", "export const B = 1;\n", "main B");
    commitOn(f.main, "src/a.ts", "export const a = 2;\n", "main a");
    git(f.worktree, "merge", "-q", "--no-ff", "-m", "merge main", "main");
    commitOn(f.worktree, "src/mainB.ts", "export const B = 1;\nexport const own = 2;\n", "helper edits B");
    writeFileSync(join(f.worktree, "src/untracked.ts"), "x\n");
    stop(f);
    expect(paths(f)).toEqual(["src/mainB.ts", "src/own.ts", "src/untracked.ts"]);
  });

  it("AU-T26 STATE: merging main twice still charges only the helper's own files", () => {
    const f = makeFixture();
    commitOn(f.worktree, "src/helperA.ts", "export const A = 1;\n", "helper A");
    stop(f);
    commitOn(f.main, "src/mainB.ts", "b\n", "main B");
    git(f.worktree, "merge", "-q", "--no-ff", "-m", "merge main 1", "main");
    commitOn(f.worktree, "src/helperA2.ts", "a2\n", "helper A2");
    commitOn(f.main, "src/mainC.ts", "c\n", "main C");
    git(f.worktree, "merge", "-q", "--no-ff", "-m", "merge main 2", "main");
    stop(f);
    expect(paths(f)).toEqual(["src/helperA.ts", "src/helperA2.ts"]);
  });

  it("AU-T26 BOUNDARY: a conflict hand-resolved in the merge is the helper's own change", () => {
    const f = makeFixture();
    commitOn(f.worktree, "src/a.ts", "export const a = 'helper';\n", "helper a");
    stop(f);
    commitOn(f.main, "src/a.ts", "export const a = 'main';\n", "main a");
    commitOn(f.main, "src/mainB.ts", "b\n", "main B");
    try { git(f.worktree, "merge", "-q", "--no-ff", "-m", "merge main", "main"); } catch { /* conflict expected */ }
    writeFileSync(join(f.worktree, "src/a.ts"), "export const a = 'resolved';\n");
    git(f.worktree, "add", "-A");
    git(f.worktree, "commit", "-qm", "merge main");
    stop(f);
    expect(paths(f)).toEqual(["src/a.ts"]);
  });
});
