// @spawns packages/lore/src/index.ts
// @spawns assets/hooks/pre-bash-git-safety-gate.mjs
/**
 * AC-AU-4 oracle — `lore stash prune [--apply]` makes stashes recoverable, then lore (never the agent) drops them.
 *
 * Throwaway repo + throwaway corpus (mkdtemp, `git init`, `lore init`), never the repo's own `.lore/` or stash
 * stack. Runs are inserted straight into the corpus store so "live" / "ended" are exact facts, not timing.
 *
 * Halves (spec AC-AU-4): (1) content in main -> archived + dropped, stash list shorter by one, archive ref
 * resolves to the same commit; (2) stash of a live run -> archived and dropped, no escalation (BR-1370); (3) archive write failure
 * (read-only refs dir) -> nothing dropped, exit 1; (4) restore: `git stash store` from the archive ref brings the
 * stash back byte-identical (tracked and untracked trees); (5) the git-safety hook still refuses an agent-typed
 * `git stash drop` (exit 2). Plus: dry run changes nothing; an ended run's stash is dropped.
 *
 * Exit codes asserted: 0 = ran (dropped / kept / escalated are outcomes, not failures); 1 = archive or drop failure.
 *
 * @spec_ref AC-AU-4
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { RunId } from "@lore/core";
import { actedStore } from "../live-invocation.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-bash-git-safety-gate.mjs");

let repo = "";
let dbPath = "";
let counter = 0;

function git(args: string[]): string {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: repo,
    env: { ...process.env, HOME: repo, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

function stashShas(): string[] {
  const out = git(["stash", "list", "--format=%H"]);
  return out === "" ? [] : out.split("\n");
}

/** Creates a stash "On <branch>: ..." holding a tracked edit and an untracked file, then returns to main. */
function makeStash(branch: string, trackedContent: string): string {
  counter += 1;
  if (branch !== "main") git(["checkout", "-q", "-b", branch, "main"]);
  writeFileSync(join(repo, "tracked.txt"), trackedContent);
  writeFileSync(join(repo, `untracked-${counter}.txt`), `untracked ${counter}\n`);
  git(["stash", "push", "-u", "-m", `wip ${counter}`]);
  const sha = git(["rev-parse", "stash@{0}"]);
  git(["checkout", "-q", "main"]);
  if (branch !== "main") git(["branch", "-q", "-D", branch]);
  return sha;
}

async function registerRun(agentId: string, ended: boolean): Promise<void> {
  const store = actedStore(new SQLiteStore(dbPath));
  try {
    const id = `cc:sess-${agentId}:${agentId}` as RunId;
    const inserted = await store.insertRun({
      id,
      kind: "subagent",
      harness: "claude-code",
      sessionRef: `sess-${agentId}`,
      agentRef: agentId,
      agentType: "implementer",
      parentRunId: `cc:sess-${agentId}` as RunId,
      branch: null,
      composition: { schemaVersion: 1, fragments: [] },
      registeredAt: "2026-10-01T00:00:00.000Z",
      messageAddress: null,
    });
    if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
    if (ended) {
      const endedRun = await store.endRun(id, "2026-10-01T01:00:00.000Z", "test");
      if (!endedRun.ok) throw new Error(`endRun failed: ${JSON.stringify(endedRun.error)}`);
    }
  } finally {
    store.close();
  }
}

function archiveRef(sha: string): string {
  return `refs/lore/archive/stash/${sha}`;
}

function archiveResolves(sha: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--verify", "-q", `${archiveRef(sha)}^{commit}`], { cwd: repo, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === sha;
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-au4-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "tracked.txt"), "base\n");
  git(["add", "tracked.txt"]);
  git(["commit", "-q", "-m", "base"]);
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  appendFileSync(join(repo, ".git", "info", "exclude"), ".lore/\n");
  dbPath = join(repo, ".lore", "lore.db");
});

afterEach(() => {
  // leave the stack empty and the refs dir writable so each test starts clean
  const refsDir = join(repo, ".git", "refs", "lore", "archive", "stash");
  if (existsSync(refsDir)) chmodSync(refsDir, 0o755);
  while (stashShas().length > 0) git(["stash", "drop", "-q", "stash@{0}"]);
  // throwaway repo only (spawnSync, never the agent's Bash tool): undo what a popped stash left behind
  git(["reset", "-q", "--hard"]);
  git(["clean", "-fdq"]);
});

afterAll(() => {
  if (repo.startsWith(tmpdir())) rmSync(repo, { recursive: true, force: true });
});

describe("AC-AU-4 lore stash prune", () => {
  it("(1) a stash whose content is in main is archived then dropped; the archive ref resolves to the same commit", () => {
    const sha = makeStash("main", "from-main\n");
    git(["checkout", "-q", "main"]);
    writeFileSync(join(repo, "tracked.txt"), "from-main\n");
    git(["commit", "-q", "-am", "main gets the same blob"]);
    // the untracked file is not in main, so containment is reported partial while the drop is still safe (archived)
    expect(stashShas()).toEqual([sha]);

    const dry = runLore(["stash", "prune"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain(sha);
    expect(dry.stdout).toMatch(/tracked in main: yes/);
    expect(stashShas()).toEqual([sha]); // a dry run changes nothing
    expect(archiveResolves(sha)).toBe(false);

    const applied = runLore(["stash", "prune", "--apply"]);
    expect(applied.exitCode).toBe(0);
    expect(stashShas()).toEqual([]); // shorter by one
    expect(archiveResolves(sha)).toBe(true); // same commit
    expect(applied.stdout).toContain(archiveRef(sha));
    expect(applied.stdout).toMatch(/dropped 1, kept 0, escalated 0/);
  }, { timeout: 60_000 });

  it("(2) an archived stash is dropped whether its owner run is LIVE or ENDED (BR-1370: the archive makes it recoverable); nothing escalates", async () => {
    await registerRun("liveagent", false);
    await registerRun("doneagent", true);
    const liveSha = makeStash("worktree-agent-liveagent", "live work\n");
    const endedSha = makeStash("worktree-agent-doneagent", "ended work\n");

    const result = runLore(["stash", "prune", "--apply"]);
    expect(result.exitCode).toBe(0);
    expect(stashShas()).toEqual([]);
    expect(result.stdout).toMatch(/dropped 2, kept 0, escalated 0/);
    expect(archiveResolves(liveSha)).toBe(true); // archived first, so still recoverable
    expect(archiveResolves(endedSha)).toBe(true);
  }, { timeout: 60_000 });

  it("(3) an archive write failure drops nothing and exits 1", () => {
    const sha = makeStash("main", "unarchivable\n");
    const refsDir = join(repo, ".git", "refs", "lore", "archive", "stash");
    mkdirSync(refsDir, { recursive: true });
    chmodSync(refsDir, 0o555);
    const result = runLore(["stash", "prune", "--apply"]);
    expect(result.exitCode).toBe(1);
    expect(stashShas()).toEqual([sha]);
    expect(result.stderr).toMatch(/archive/i);
    chmodSync(refsDir, 0o755);
    expect(archiveResolves(sha)).toBe(false);
  });

  it("(4) restore: git stash store from the archive ref brings the stash back byte-identical", () => {
    const sha = makeStash("main", "precious\n");
    const trackedBefore = git(["rev-parse", `${sha}^{tree}`]);
    const untrackedBefore = git(["rev-parse", `${sha}^3^{tree}`]);
    const bytesBefore = git(["show", `${sha}:tracked.txt`]);

    expect(runLore(["stash", "prune", "--apply"]).exitCode).toBe(0);
    expect(stashShas()).toEqual([]);

    git(["stash", "store", "-m", "restored", archiveRef(sha)]);
    const [restored] = stashShas();
    expect(restored).toBe(sha);
    expect(git(["rev-parse", `${sha}^{tree}`])).toBe(trackedBefore);
    expect(git(["rev-parse", `${sha}^3^{tree}`])).toBe(untrackedBefore);
    expect(git(["show", `${sha}:tracked.txt`])).toBe(bytesBefore);
    git(["stash", "pop", "-q"]);
    expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("precious\n");
  }, { timeout: 60_000 });

  it("(5) the git-safety hook still refuses an agent-typed `git stash drop` (exit 2)", () => {
    const r = spawnSync("node", [HOOK], {
      input: JSON.stringify({ cwd: repo, tool_input: { command: "git stash drop stash@{0}" } }),
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });

  it("control: with no stashes, prune exits 0 and reports zero everywhere", () => {
    const result = runLore(["stash", "prune", "--apply"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/dropped 0, kept 0, escalated 0/);
  });
});
