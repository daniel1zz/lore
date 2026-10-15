/** AC-TE-2 (snapshot half): turn start records a working-tree tree id via a temporary index. */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { currentTurnDir, git, makeGitRepo, makeTmpDir, runHook } from "./hook-harness";

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
