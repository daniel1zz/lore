/**
 * @spec_ref spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (AC-WS-4; D1, D2; BR-1070, BR-1079)
 * @task task-single-worktree-removal-test-used-by-the-hook-lore-done
 *
 * The git-safety hook DELEGATES occupancy and ownership to `lore worktree check` — it spawns
 * `lore worktree check <path> --session <payload session_id> --json`, blocks on keep / not-measured naming EACH reason
 * (foreign-live-session included), passes on removable, and runs no process scan of its own (spy: a stub `lsof` on PATH
 * records any spawn, and a `LORE_GIT_SAFETY_PROC_DIR` pointing at a directory with a foreign cwd link is ignored).
 *
 * HAPPY:      removable passes through with the documented argv
 * NEGATIVE:   foreign-live-session / run-not-ended / open-claim / process-inside / unmerged-commits blocks, each named;
 *             several reasons are ALL named
 * ERROR:      unknown verdict, missing reasons, a verdict that is keep with an empty reason list
 * STATE:      the payload session id travels as `--session`; absent -> no `--session` flag
 * REGRESSION: no lsof spawn, no /proc read (the scan exists once, in lore)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-bash-git-safety-gate.mjs");

let base = "";
let repo = "";
let stubDir = "";
let wt = "";
let wtReal = "";
let fakeProc = "";

function runGit(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function checkJson(data: Record<string, unknown>): string {
  return JSON.stringify({
    ok: true,
    data: { path: wtReal, verdict: "removable", reasons: [], owner: null, occupancy: null, processes: [], ...data },
  });
}

function runHook(opts: { check: string; sessionId?: string | null }): { code: number; stderr: string; loreArgs: string; lsofSpawned: boolean } {
  writeFileSync(join(stubDir, "lore.out"), opts.check);
  writeFileSync(join(stubDir, "lore.args"), "");
  writeFileSync(join(stubDir, "lsof.spawned"), "");
  const payload: Record<string, unknown> = { cwd: repo, tool_input: { command: `git worktree remove ${wt}` } };
  if (opts.sessionId !== null) payload["session_id"] = opts.sessionId ?? "S-caller";
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      PATH: [stubDir, ...(process.env["PATH"] ?? "").split(delimiter)].join(delimiter),
      HOME: process.env["HOME"] ?? base,
      STUB_DIR: stubDir,
      // reason: the retired test seam — if the hook still read /proc it would find this foreign cwd link and block.
      LORE_GIT_SAFETY_PROC_DIR: fakeProc,
    },
  });
  return {
    code: r.status ?? -1,
    stderr: r.stderr ?? "",
    loreArgs: readFileSync(join(stubDir, "lore.args"), "utf8"),
    lsofSpawned: readFileSync(join(stubDir, "lsof.spawned"), "utf8") !== "",
  };
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "gsg-check-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  runGit(["init", "-q", "-b", "main"], repo);
  runGit(["config", "user.email", "t@t"], repo);
  runGit(["config", "user.name", "t"], repo);
  writeFileSync(join(repo, "f.txt"), "v1\n");
  runGit(["add", "."], repo);
  runGit(["commit", "-qm", "init"], repo);
  runGit(["branch", "merged-branch"], repo);
  wt = join(base, "wt-clean-merged");
  runGit(["worktree", "add", "-q", wt, "merged-branch"], repo);
  wtReal = realpathSync(wt);

  fakeProc = join(base, "fake-proc");
  mkdirSync(join(fakeProc, "9001"), { recursive: true });
  symlinkSync(wtReal, join(fakeProc, "9001", "cwd"));

  stubDir = join(base, "stubs");
  mkdirSync(stubDir);
  writeFileSync(join(stubDir, "lore"), '#!/bin/sh\necho "$@" >> "$STUB_DIR/lore.args"\ncat "$STUB_DIR/lore.out"\n');
  // Spy: a hook that still scans processes would spawn this and leave a mark.
  writeFileSync(join(stubDir, "lsof"), '#!/bin/sh\necho spawned >> "$STUB_DIR/lsof.spawned"\necho p1\n');
  chmodSync(join(stubDir, "lore"), 0o755);
  chmodSync(join(stubDir, "lsof"), 0o755);
}, 60_000);

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

describe("AC-WS-4 git-safety hook delegates to `lore worktree check`", () => {
  it("HAPPY: spawns `lore worktree check <path> --session <payload session_id> --json` and passes on removable", () => {
    const r = runHook({ check: checkJson({}), sessionId: "S-payload-7" });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.loreArgs.trim()).toBe(`worktree check ${wt} --session S-payload-7 --json`);
  });

  it("STATE: a payload without a session id passes no --session flag (lore falls back to its environment)", () => {
    const r = runHook({ check: checkJson({}), sessionId: null });
    expect(r.code).toBe(0);
    expect(r.loreArgs.trim()).toBe(`worktree check ${wt} --json`);
  });

  it("NEGATIVE: foreign-live-session blocks, naming the owning run and its session", () => {
    const r = runHook({
      check: checkJson({
        verdict: "keep",
        reasons: ["foreign-live-session"],
        owner: { run_id: "cc:S2:agentx", session: "S2", mine: false, session_ended: false },
      }),
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cc:S2:agentx");
    expect(r.stderr).toContain("S2");
    expect(r.stderr).toMatch(/still live/);
  });

  it("NEGATIVE: every reason lore lists is named, not just the first", () => {
    const r = runHook({
      check: checkJson({
        verdict: "keep",
        reasons: ["run-not-ended", "process-inside", "foreign-live-session", "locked"],
        owner: { run_id: "cc:S2:agentx", session: "S2", mine: false, session_ended: false },
        occupancy: { worktree: wtReal, agent_run: { id: "cc:S2:agentx", ended: false, parent_ended: false }, open_claims: [], occupied: true },
        processes: [{ pid: 777, command: "vim" }],
      }),
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('lore run end cc:S2:agentx --reason "<why>"');
    expect(r.stderr).toContain("process 777 (vim)");
    expect(r.stderr).toContain("another session");
    expect(r.stderr).toContain("locked");
  });

  it("NEGATIVE: an unknown reason token is still printed verbatim and blocks", () => {
    const r = runHook({ check: checkJson({ verdict: "keep", reasons: ["some-future-reason"] }) });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("some-future-reason");
  });

  it("ERROR: not-measured blocks naming the clause; keep with no reason still blocks", () => {
    const nm = runHook({ check: checkJson({ verdict: "not-measured", reasons: ["owner-not-measured: run not registered"] }) });
    expect(nm.code).toBe(2);
    expect(nm.stderr).toContain("owner-not-measured: run not registered");
    const empty = runHook({ check: checkJson({ verdict: "keep", reasons: [] }) });
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain("without a reason");
  });

  it("ERROR: a verdict outside the documented three, or a reasons list of non-strings, is unreadable -> blocked", () => {
    expect(runHook({ check: checkJson({ verdict: "yes" }) }).code).toBe(2);
    expect(runHook({ check: checkJson({ reasons: [1, 2] }) }).code).toBe(2);
    expect(runHook({ check: checkJson({ processes: [{ pid: "x", command: "y" }] }) }).code).toBe(2);
  }, 60_000);

  it("REGRESSION: the hook runs no lsof and reads no /proc itself (the scan exists once, in lore)", () => {
    const passing = runHook({ check: checkJson({}) });
    expect(passing.code).toBe(0); // a /proc read would have found the foreign cwd link in fakeProc and blocked
    expect(passing.lsofSpawned).toBe(false);
    const blocked = runHook({ check: checkJson({ verdict: "keep", reasons: ["locked"] }) });
    expect(blocked.lsofSpawned).toBe(false);
    expect(existsSync(join(stubDir, "lsof"))).toBe(true);
  });

  it("REGRESSION: the hook source contains no process-scan code at all", () => {
    const source = readFileSync(HOOK, "utf8");
    expect(source).not.toMatch(/lsof|readlinkSync|LORE_GIT_SAFETY_PROC_DIR|\/proc/);
  });
});
