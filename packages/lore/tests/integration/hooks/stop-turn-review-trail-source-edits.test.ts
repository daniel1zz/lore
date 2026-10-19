// @spawns assets/hooks/post-edit-mark.mjs
// @spawns assets/hooks/stop-turn-review.mjs
// @spawns assets/hooks/user-prompt-turn-start.mjs
/**
 * @spec_ref AC-ST-4
 *
 * The BR-1089 source-edit finding reads the turn's attribution (changes.json): main-session and
 * unknown-source changes count, vcs never, a shared working copy lists unknown files without
 * counting them, and unmeasured attribution gives no verdict but says so (spec Design > Consumers,
 * D13, D14). Throwaway git repos + mkdtemp state bases only; the setup commits are dated in the past
 * so only commits made during a test are the session's own.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentTurnDir, makeGitRepo, makeTmpDir } from "./hook-harness";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import {
  initLoreWithAnchoredSpec, markEdit, numberedLines, parseBlock, startTurn, stopTurn, writeRepoFile, writeTurnEndSetting,
  type TurnFixture,
} from "./turn-review-harness";

const PAST = "2020-01-01T00:00:00Z";
const SID = "S4";
const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function must(cwd: string, args: string[], date?: string): string {
  const env = date ? { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : process.env;
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
const past = (repo: string, message: string) => { must(repo, ["add", "-A"]); must(repo, ["commit", "-qm", message], PAST); };

/** Repo with a 12-line src/e.ts, the setting `value` committed, session.json written; turn NOT started. */
function fixture(setting: string | null = "block"): TurnFixture {
  const repo = makeGitRepo();
  cleanup.push(repo);
  must(repo, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  writeRepoFile(repo, "src/e.ts", numberedLines(12, "orig"));
  if (setting !== null) writeTurnEndSetting(repo, setting);
  past(repo, "seed");
  const base = makeTmpDir("trail-state-");
  cleanup.push(base);
  mkdirSync(join(base, "sessions", SID), { recursive: true });
  writeFileSync(join(base, "sessions", SID, "session.json"), JSON.stringify({ started_at: "2021-01-01T00:00:00.000Z" }));
  return { repo, base, sid: SID };
}

/** A shell-style rewrite of 10 of the 12 lines (no edit record). */
const sed10 = (f: TurnFixture) => writeRepoFile(f.repo, "src/e.ts", numberedLines(10, "sed") + "orig 10\norig 11\n");

function readChanges(f: TurnFixture) {
  return JSON.parse(readFileSync(join(currentTurnDir(f.base, f.sid), "changes.json"), "utf8"));
}
function breakStartHead(f: TurnFixture): void {
  const file = join(currentTurnDir(f.base, f.sid), "turn-start-snapshot.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), head: "0".repeat(40), reflog_len: 99 }));
}

describe("AC-ST-4 source-edit finding over attributed changes", () => {
  it("AC-ST-4 sed on 10 lines of src/e.ts -> one block naming src/e.ts and source unknown", () => {
    const f = fixture();
    startTurn(f);
    sed10(f);
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    const block = parseBlock(r);
    expect(block.decision).toBe("block");
    expect(block.reason).toContain("src/e.ts");
    expect(block.reason).toContain("source unknown");
  });

  it("AC-ST-4 sed then commit -> the same finding", () => {
    const f = fixture();
    startTurn(f);
    sed10(f);
    must(f.repo, ["add", "-A"]);
    must(f.repo, ["commit", "-qm", "sed"]);
    const block = parseBlock(stopTurn(f));
    expect(block.reason).toContain("src/e.ts");
    expect(block.reason).toContain("source unknown");
  });

  it("AC-ST-4 an Edit by the main session is counted and labelled as the main session", () => {
    const f = fixture();
    startTurn(f);
    markEdit(f, sed10(f));
    const block = parseBlock(stopTurn(f));
    expect(block.reason).toContain("src/e.ts");
    expect(block.reason).toContain("main session");
    expect(block.reason).not.toContain("source unknown");
  });

  it("AC-ST-4 a helper's Edit is never counted for the main session", () => {
    const f = fixture();
    startTurn(f);
    markEdit(f, sed10(f), "AG1");
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-ST-4 merging a 200-line branch -> exit 0, empty stdout (vcs never counts)", () => {
    const f = fixture();
    must(f.repo, ["checkout", "-qb", "big"]);
    writeRepoFile(f.repo, "src/big.ts", numberedLines(200, "big"));
    past(f.repo, "big work");
    must(f.repo, ["checkout", "-q", "main"]);
    writeRepoFile(f.repo, "src/m.ts", "export const m = 1;\n");
    past(f.repo, "main work");
    startTurn(f);
    must(f.repo, ["merge", "--no-ff", "-q", "big", "-m", "merge big"]);
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(readChanges(f).changes.value).toEqual([expect.objectContaining({ path: "src/big.ts", source: { kind: "vcs" } })]);
  }, 60_000);

  it("AC-ST-4 the same sed while a non-isolated helper record is open -> the file is listed as not counted, no block", () => {
    const f = fixture();
    startTurn(f);
    mkdirSync(join(f.base, "sessions", SID, "helpers"), { recursive: true });
    writeFileSync(join(f.base, "sessions", SID, "helpers", "H1.json"), JSON.stringify({ run: `cc:${SID}:H1`, started_at: "2021-06-01T00:00:00.000Z", end_count: 0 }));
    sed10(f);
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toContain("src/e.ts");
    expect(out.systemMessage).toContain("not counted");
    expect(readChanges(f).shared_working_copy).toBe(true);
  });

  it("AC-ST-4 attribution unmeasured -> no block; stdout JSON with no decision and a systemMessage naming the source-edit finding as not measured, plus one stderr line", () => {
    const f = fixture();
    startTurn(f);
    breakStartHead(f);
    sed10(f);
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toContain("source-edit");
    expect(out.systemMessage).toContain("not measured");
    const lines = r.stderr.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not measured");
    expect(lines[0]).toContain("source-edit");
  });

  it("AC-ST-4 attribution unmeasured together with another finding -> one block whose reason also names the source-edit finding as not measured", () => {
    const f = fixture(null);
    writeRepoFile(f.repo, "src/anchored.ts", "export const a = 1;\n");
    past(f.repo, "anchored file");
    initLoreWithAnchoredSpec(f.repo, ["src/anchored.ts"]);
    patchLoreConfig(f.repo, "workflow:\n  turn_end:\n    main_session_source_edits: block\n");
    must(f.repo, ["add", "-A"]);
    must(f.repo, ["commit", "-qm", "lore project"], PAST);
    startTurn(f);
    breakStartHead(f);
    sed10(f);
    rmSync(join(f.repo, "src", "anchored.ts"));
    const r = stopTurn(f);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    const block = parseBlock(r);
    expect(block.decision).toBe("block");
    expect(block.reason).toContain("src/anchored.ts");
    expect(block.reason).toContain("source-edit");
    expect(block.reason).toContain("not measured");
  });

  it("AC-ST-4 setting off -> exit 0, empty stdout, even for a 10-line sed", () => {
    const f = fixture("off");
    startTurn(f);
    sed10(f);
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-ST-4 setting off and attribution unmeasured -> still silent on stdout", () => {
    const f = fixture("off");
    startTurn(f);
    breakStartHead(f);
    sed10(f);
    expect(stopTurn(f).stdout).toBe("");
  });

  it("AC-ST-4 a turn already continuing from a block stays silent but still refreshes changes.json", () => {
    const f = fixture();
    startTurn(f);
    sed10(f);
    const r = stopTurn(f, { stop_hook_active: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    expect(readChanges(f).changes.value).toEqual([expect.objectContaining({ path: "src/e.ts", source: { kind: "unknown" } })]);
  });

  it("AC-ST-4 three changed lines or fewer stay under the allowance even when the source is unknown", () => {
    const f = fixture();
    startTurn(f);
    writeRepoFile(f.repo, "src/e.ts", numberedLines(12, "orig").replace("orig 0", "tiny 0"));
    const r = stopTurn(f);
    expect(r.stdout).toBe("");
  });
});
