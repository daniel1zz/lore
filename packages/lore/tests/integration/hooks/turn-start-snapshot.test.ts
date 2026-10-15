/** AC-TE-2 (snapshot half): turn start records a working-tree tree id via a temporary index. */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { currentTurnDir, git, makeGitRepo, makeTmpDir, runHook } from "./hook-harness";
import { makeFixture, markEdit, numberedLines, parseBlock, startTurn, stopTurn, writeRepoFile, writeTurnEndSetting } from "./turn-review-harness";

const SNAPSHOT = "turn-start-snapshot.json";
const start = (base: string, sid: string, cwd: string) =>
  runHook("user-prompt-turn-start.mjs", { session_id: sid, cwd, hook_event_name: "UserPromptSubmit", prompt: "x" }, base);
const readSnapshot = (base: string, sid: string) =>
  JSON.parse(readFileSync(join(currentTurnDir(base, sid), SNAPSHOT), "utf8"));

describe("AC-TE-2 turn-start working-tree snapshot", () => {
  it("AC-TE-2 records a tree id with uncommitted + untracked changes, real index untouched, no ref", () => {
    const repo = makeGitRepo(); const base = makeTmpDir("turn-state-");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git(repo, "add", "a.txt"); git(repo, "commit", "-qm", "init");
    writeFileSync(join(repo, "a.txt"), "two\n");        // uncommitted earlier change
    writeFileSync(join(repo, "new.txt"), "fresh\n");    // untracked
    const indexBefore = readFileSync(join(repo, ".git", "index"));
    const refsBefore = git(repo, "for-each-ref");

    const r = start(base, "s1", repo);
    expect(r.status).toBe(0);
    const snap = readSnapshot(base, "s1");
    expect(snap.tree).toMatch(/^[0-9a-f]{40}([0-9a-f]{24})?$/);
    expect(Number.isInteger(snap.durationMs) && snap.durationMs >= 0).toBe(true);
    expect(git(repo, "show", `${snap.tree}:a.txt`)).toBe("two");
    expect(git(repo, "show", `${snap.tree}:new.txt`)).toBe("fresh");
    expect(readFileSync(join(repo, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(git(repo, "for-each-ref")).toBe(refsBefore);
  });

  it("AC-TE-2 records tree null with a reason (unmeasured) outside a git repo", () => {
    const dir = makeTmpDir("not-a-repo-"); const base = makeTmpDir("turn-state-");
    const r = start(base, "s2", dir);
    expect(r.status).toBe(0);
    const snap = readSnapshot(base, "s2");
    expect(snap.tree).toBeNull();
    expect(typeof snap.reason).toBe("string");
    expect(snap.reason.length).toBeGreaterThan(0);
  });

  it("AC-TE-2 still opens the turn (current-turn.id) when the snapshot is absent", () => {
    const dir = makeTmpDir("not-a-repo-"); const base = makeTmpDir("turn-state-");
    start(base, "s3", dir);
    expect(existsSync(currentTurnDir(base, "s3"))).toBe(true);
  });
});

describe("AC-TE-7 findings are measured against the turn-start snapshot", () => {
  /** A 50-line uncommitted .ts change left by an EARLIER turn, setting on; the next turn is not started yet. */
  function afterEarlierTurn(sid: string) {
    const f = makeFixture(sid);
    writeTurnEndSetting(f.repo, "block");
    writeRepoFile(f.repo, "src/earlier.ts", numberedLines(50, "earlier"));
    return f;
  }

  it("AC-TE-7 records a tree id and leaves the real index byte-identical", () => {
    const f = afterEarlierTurn("u1");
    const indexBefore = readFileSync(join(f.repo, ".git", "index"));
    expect(startTurn(f).status).toBe(0);
    expect(readSnapshot(f.base, f.sid).tree).toMatch(/^[0-9a-f]{40}([0-9a-f]{24})?$/);
    expect(readFileSync(join(f.repo, ".git", "index")).equals(indexBefore)).toBe(true);
  });

  it("AC-TE-7 a following turn that edits nothing produces no finding (the earlier 50 lines are not re-reported)", () => {
    const f = afterEarlierTurn("u2");
    startTurn(f);
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-7 a following turn adding 50 lines to another .ts yields exactly one finding naming only that file", () => {
    const f = afterEarlierTurn("u3");
    startTurn(f);
    markEdit(f, join(f.repo, "src", "earlier.ts")); // touched again but unchanged this turn
    markEdit(f, writeRepoFile(f.repo, "src/another.ts", numberedLines(50, "another")));
    const r = stopTurn(f);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    const { reason } = parseBlock(r);
    expect(reason).toContain("src/another.ts");
    expect(reason).not.toContain("earlier.ts");
  });
});
