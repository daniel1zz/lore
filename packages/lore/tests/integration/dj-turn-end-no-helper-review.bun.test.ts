// @spawns dist/lore -- the turn-review harness runs `lore` from PATH
// @spawns assets/hooks/stop-turn-review.mjs
// @spawns assets/hooks/user-prompt-turn-start.mjs
// @spawns assets/hooks/post-edit-mark.mjs
// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/helper-scope-review.ts
/**
 * @spec_ref AC-DJ-4
 *
 * BR-1349: the turn-end review does not run a per-helper review. At Stop the hook runs ONE
 * `git status --porcelain` on the shared checkout and raises every changed or untracked, not-ignored
 * path as a finding in its single block. Cost is O(1) in the number of helpers.
 *
 * Fixture: throwaway git repo + throwaway session-state base; `lore` is a PATH stub that records each
 * argv. Never this repo's `.lore/`.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE: a hook that keeps the review but skips it when the trail is large
 * passes the 3000-helper case only by size; the 2-helper case asserts zero spawns as well.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git } from "./hooks/hook-harness";
import { makeFixture, markEdit, numberedLines, startTurn, writeRepoFile, writeTurnEndSetting, type TurnFixture } from "./hooks/turn-review-harness";

const REPO_ROOT = join(__dirname, "../../../..");
const STOP_HOOK_PATH = join(REPO_ROOT, "assets/hooks/stop-turn-review.mjs");
const LORE_ENTRY = join(REPO_ROOT, "packages/lore/src/index.ts");
const HELPER_REVIEW_FILE = join(REPO_ROOT, "packages/lore/src/service/helper-scope-review.ts");

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

const STUB_SOURCE = `#!/usr/bin/env node
require('node:fs').appendFileSync(require('node:path').join(__dirname, 'calls.log'), JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write(JSON.stringify({ ok: true, data: { helpers: [], findings: [] } }));
`;

interface Stub { binDir: string; calls(): string[][] }

function makeLoreStub(): Stub {
  const binDir = mkdtempSync(join(tmpdir(), "dj4-stub-"));
  cleanup.push(binDir);
  writeFileSync(join(binDir, "lore"), STUB_SOURCE);
  chmodSync(join(binDir, "lore"), 0o755);
  const callsFile = join(binDir, "calls.log");
  return {
    binDir,
    calls: () => (existsSync(callsFile) ? readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []),
  };
}

/** `count` helper records, each with an unjudged end, as SubagentStop leaves them. */
function writeHelpers(f: TurnFixture, count: number): string {
  const dir = join(f.base, "sessions", f.sid, "helpers");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(
      join(dir, `A${i}.json`),
      JSON.stringify({ run: `cc:${f.sid}:A${i}`, started_at: "2026-01-01T00:00:00.000Z", ended_at: "2026-01-01T00:01:00.000Z", end_count: 1, changes: { measured: false, reason: "not isolated" } }),
    );
  }
  return dir;
}

function setup(helperCount: number): { f: TurnFixture; stub: Stub; helpers: string } {
  const f = makeFixture("DJ4");
  const stub = makeLoreStub();
  cleanup.push(f.repo, f.base);
  const helpers = writeHelpers(f, helperCount);
  startTurn(f);
  return { f, stub, helpers };
}

function stop(f: TurnFixture, stub: Stub): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [STOP_HOOK_PATH], {
    input: JSON.stringify({ session_id: f.sid, cwd: f.repo, hook_event_name: "Stop", stop_hook_active: false }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: f.base, PATH: `${stub.binDir}:${process.env.PATH ?? ""}` },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const reviewCalls = (stub: Stub): string[][] => stub.calls().filter((argv) => argv.includes("trail-review"));
const judgedFiles = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith(".judged.json"));

describe("AC-DJ-4 BR-1349 turn end: no helper review, one shared-checkout check", () => {
  it("AC-DJ-4 (1) a clean shared checkout with 3000 unjudged helpers exits 0 silently, spawns no trail-review, writes no judged file", () => {
    const { f, stub, helpers } = setup(3000);
    const r = stop(f, stub);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(reviewCalls(stub)).toHaveLength(0);
    expect(stub.calls()).toHaveLength(0);
    expect(judgedFiles(helpers)).toEqual([]);
  });

  it("AC-DJ-4 (1) the same with 2 helpers: zero spawns, so the result does not depend on trail size", () => {
    const { f, stub, helpers } = setup(2);
    const r = stop(f, stub);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(reviewCalls(stub)).toHaveLength(0);
    expect(judgedFiles(helpers)).toEqual([]);
  });

  it("AC-DJ-4 (2) an untracked not-ignored src/x.ts blocks once, naming src/x.ts and BR-1349", () => {
    const { f, stub } = setup(3000);
    writeRepoFile(f.repo, "src/x.ts", numberedLines(2));
    const r = stop(f, stub);
    expect(r.status).toBe(0);
    const block = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(block.decision).toBe("block");
    expect(block.reason).toContain("src/x.ts");
    expect(block.reason).toContain("BR-1349");
    expect(block.reason.match(/<turn-end-review>/g)).toHaveLength(1);
    expect(reviewCalls(stub)).toHaveLength(0);
  });

  it("AC-DJ-4 (2) a modified tracked file is a finding too; a git-ignored file is not", () => {
    const { f, stub } = setup(2);
    writeRepoFile(f.repo, ".gitignore", "ignored.log\n");
    git(f.repo, "add", ".gitignore");
    git(f.repo, "commit", "-qm", "ignore");
    startTurn(f);
    writeRepoFile(f.repo, "ignored.log", "noise\n");
    writeRepoFile(f.repo, "README.txt", "changed\n");
    const block = JSON.parse(stop(f, stub).stdout) as { reason: string };
    expect(block.reason).toContain("README.txt");
    expect(block.reason).not.toContain("ignored.log");
  });

  it("AC-DJ-4 (2) a path the main-session source-edit finding already lists is not listed again", () => {
    const { f, stub } = setup(2);
    writeTurnEndSetting(f.repo, "block");
    git(f.repo, "add", "-A");
    git(f.repo, "commit", "-qm", "cfg");
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "src/big.ts", numberedLines(10)));
    const block = JSON.parse(stop(f, stub).stdout) as { reason: string };
    expect(block.reason).toContain("Main-session source edits");
    expect(block.reason.split("src/big.ts")).toHaveLength(2); // exactly one mention
    expect(block.reason).not.toContain("BR-1349");
  });

  it("AC-DJ-4 (3) `lore session trail-review` exits exactly 2 as an unknown subcommand", () => {
    const home = mkdtempSync(join(tmpdir(), "dj4-home-"));
    cleanup.push(home);
    const r = spawnSync("bun", ["run", LORE_ENTRY, "session", "trail-review"], { cwd: home, encoding: "utf8", env: { ...process.env, HOME: home } });
    expect(r.status).toBe(2);
  });

  it("AC-DJ-4 (4) helper-scope-review.ts no longer exists", () => {
    expect(existsSync(HELPER_REVIEW_FILE)).toBe(false);
  });
});
