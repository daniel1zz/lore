/**
 * @spec_ref spec-worktree-removal-is-decided-by-who-is-inside-not-by-how (AC-WL-3; D1-D6; BR-1070)
 *
 * The REAL git-safety hook against a REAL throwaway repo holding a clean, merged linked worktree whose last
 * commit is seconds old. `lore` and `lsof` are stub executables first on PATH, so each occupancy signal is
 * scripted; nothing here reads or writes a lore corpus.
 *
 * HAPPY:      (a) nobody inside -> `git worktree remove` passes through with no block, however recent the commit
 * NEGATIVE:   (b) live agent run, (c) foreign process inside, (d) open claim -> blocked, each naming its way out
 * ERROR:      (e) lore missing / exits 1, (e2) lore exits 0 with non-JSON, (f) no lsof and no /proc -> blocked
 * STATE:      (g) the hook's own ancestry standing inside does not count; parent-ended run passes
 * REGRESSION: (h) dirty / unmerged keep today's refusal texts; --force on an unoccupied worktree keeps the SAFE text
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function runGit(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function which(name: string): string {
  const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${name} not found on PATH`);
  return r.stdout.trim();
}

const UNOCCUPIED = JSON.stringify({ ok: true, data: { worktree: "/x", agent_run: null, open_claims: [], occupied: false } });

interface Scenario {
  lore?: { out: string; exit?: number } | "missing";
  lsof?: { out: string; exit?: number } | "missing";
  procDir?: string;
  command?: string;
  cwd?: string;
}

function runHook(s: Scenario): { code: number; stderr: string; loreArgs: string } {
  const lore = s.lore ?? { out: UNOCCUPIED };
  const lsof = s.lsof ?? { out: "p1\nn/\n" };
  if (lore !== "missing") {
    writeFileSync(join(stubDir, "lore.out"), lore.out);
    writeFileSync(join(stubDir, "lore.exit"), String(lore.exit ?? 0));
  }
  if (lsof !== "missing") {
    writeFileSync(join(stubDir, "lsof.out"), lsof.out);
    writeFileSync(join(stubDir, "lsof.exit"), String(lsof.exit ?? 0));
  }
  writeFileSync(join(stubDir, "lore.args"), "");
  // reason: "missing" must be MISSING from PATH, so the child gets a PATH of only the stub dir's wanted stubs plus
  // git/ps symlinks — never the real /usr/sbin/lsof or a developer's installed lore.
  const pathDirs = [stubDir];
  if (lore === "missing" || lsof === "missing") {
    const only = mkdtempSync(join(base, "bin-"));
    // cat + sed: the stub scripts themselves use them.
    for (const tool of ["git", "ps", "cat", "sed"]) symlinkSync(which(tool), join(only, tool));
    if (lore !== "missing") symlinkSync(join(stubDir, "lore"), join(only, "lore"));
    if (lsof !== "missing") symlinkSync(join(stubDir, "lsof"), join(only, "lsof"));
    pathDirs.length = 0;
    pathDirs.push(only);
  } else {
    pathDirs.push(...(process.env["PATH"] ?? "").split(delimiter));
  }
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: s.cwd ?? repo, tool_input: { command: s.command ?? `git worktree remove ${wt}` } }),
    encoding: "utf8",
    env: {
      PATH: pathDirs.join(delimiter),
      HOME: process.env["HOME"] ?? base,
      STUB_DIR: stubDir,
      ...(s.procDir === undefined ? {} : { LORE_GIT_SAFETY_PROC_DIR: s.procDir }),
    },
  });
  const args = spawnSync("cat", [join(stubDir, "lore.args")], { encoding: "utf8" }).stdout;
  return { code: r.status ?? -1, stderr: r.stderr ?? "", loreArgs: args };
}

function occupancyJson(data: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, data: { worktree: wtReal, agent_run: null, open_claims: [], occupied: false, ...data } });
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "gsg-occupancy-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  runGit(["init", "-q", "-b", "main"], repo);
  runGit(["config", "user.email", "t@t"], repo);
  runGit(["config", "user.name", "t"], repo);
  writeFileSync(join(repo, "f.txt"), "v1\n");
  runGit(["add", "."], repo);
  runGit(["commit", "-qm", "init"], repo);
  runGit(["branch", "merged-branch"], repo);
  runGit(["checkout", "-q", "-b", "unmerged-branch"], repo);
  writeFileSync(join(repo, "g.txt"), "x\n");
  runGit(["add", "."], repo);
  runGit(["commit", "-qm", "unmerged work"], repo);
  runGit(["checkout", "-q", "main"], repo);
  wt = join(base, "wt-clean-merged");
  runGit(["worktree", "add", "-q", wt, "merged-branch"], repo);
  wtReal = realpathSync(wt);

  stubDir = join(base, "stubs");
  mkdirSync(stubDir);
  writeFileSync(
    join(stubDir, "lore"),
    '#!/bin/sh\necho "$@" >> "$STUB_DIR/lore.args"\ncat "$STUB_DIR/lore.out"\nexit "$(cat "$STUB_DIR/lore.exit")"\n',
  );
  writeFileSync(
    join(stubDir, "lsof"),
    '#!/bin/sh\nsed "s/@HOOK@/$PPID/g" "$STUB_DIR/lsof.out"\nexit "$(cat "$STUB_DIR/lsof.exit")"\n',
  );
  chmodSync(join(stubDir, "lore"), 0o755);
  chmodSync(join(stubDir, "lsof"), 0o755);
}, 60_000);

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

describe("AC-WL-3 git-safety hook — worktree removal decided by occupancy", () => {
  it("(a) clean + merged + last commit seconds old + nobody inside: passes through with no block", () => {
    const r = runHook({ lsof: { out: `p1\nn/\np77\nn${join(base, "elsewhere")}\n` } });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.loreArgs.trim()).toBe(`run occupancy --worktree ${wt} --json`);
  });

  it("(a) a DETACHED-HEAD clean + merged worktree passes the same way", () => {
    const wtDetached = join(base, "wt-detached");
    runGit(["worktree", "add", "-q", "--detach", wtDetached, runGit(["rev-parse", "main"], repo)], repo);
    const r = runHook({ command: `git worktree remove ${wtDetached}` });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("(b) the owning agent run has no end: blocked, naming the run id and `lore run end`", () => {
    const r = runHook({
      lore: { out: occupancyJson({ agent_run: { id: "cc:S1:abc123", ended: false, parent_ended: false }, occupied: true }) },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cc:S1:abc123");
    expect(r.stderr).toContain('lore run end cc:S1:abc123 --reason "<why>"');
  });

  it("(b) a run that ended, or is open under a parent that ended, does not block", () => {
    const ended = occupancyJson({ agent_run: { id: "cc:S1:abc123", ended: true, parent_ended: false } });
    const orphaned = occupancyJson({ agent_run: { id: "cc:S1:abc123", ended: false, parent_ended: true } });
    expect(runHook({ lore: { out: ended } }).code).toBe(0);
    expect(runHook({ lore: { out: orphaned } }).code).toBe(0);
  });

  it("(c) a foreign process whose cwd is under the worktree: blocked, naming pid and command", async () => {
    const child = spawn("sleep", ["30"], { cwd: wt, stdio: "ignore" });
    try {
      expect(child.pid).toBeDefined();
      const r = runHook({ lsof: { out: `p${child.pid}\nn${wtReal}\n` } });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(String(child.pid));
      expect(r.stderr).toContain("sleep");
    } finally {
      child.kill();
    }
  });

  it("(c) a process in a SIBLING directory sharing the worktree's name prefix does not count", () => {
    const r = runHook({ lsof: { out: `p4242\nn${wtReal}-sibling/sub\n` } });
    expect(r.code).toBe(0);
  });

  it("(d) an open claim whose run is alive, or that names no run: blocked, naming the task", () => {
    const live = runHook({
      lore: { out: occupancyJson({ open_claims: [{ task_slug: "task-live-one", run_id: "cc:S2", run_ended: false }], occupied: true }) },
    });
    expect(live.code).toBe(2);
    expect(live.stderr).toContain("task-live-one");
    const noRun = runHook({
      lore: { out: occupancyJson({ open_claims: [{ task_slug: "task-no-run", run_id: null, run_ended: null }], occupied: true }) },
    });
    expect(noRun.code).toBe(2);
    expect(noRun.stderr).toContain("task-no-run");
    const gone = runHook({
      lore: { out: occupancyJson({ open_claims: [{ task_slug: "task-gone", run_id: "cc:S3", run_ended: true }] }) },
    });
    expect(gone.code).toBe(0);
  });

  it("(e) lore missing from PATH, or exiting 1: blocked, the owning-run signal named as not measurable", () => {
    const missing = runHook({ lore: "missing" });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("cannot measure the owning run");
    const failing = runHook({ lore: { out: "", exit: 1 } });
    expect(failing.code).toBe(2);
    expect(failing.stderr).toContain("cannot measure the owning run");
  });

  it("(e2) lore exiting 0 with output that is not the documented JSON: blocked as not measurable", () => {
    for (const out of ["all good\n", "{}\n", JSON.stringify({ ok: true, data: { occupied: "no" } })]) {
      const r = runHook({ lore: { out } });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("cannot measure the owning run");
    }
  });

  it("(f) lsof missing and no /proc: blocked, the process signal named as not measurable", () => {
    const r = runHook({ lsof: "missing", procDir: join(base, "no-such-proc") });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cannot measure processes inside");
  });

  it("(f) lsof failing without any listing: blocked as not measurable", () => {
    const r = runHook({ lsof: { out: "", exit: 1 } });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cannot measure processes inside");
  });

  it("(f) /proc fallback when lsof is absent: a foreign cwd link inside blocks, an empty /proc passes", () => {
    const proc = join(base, "fake-proc");
    mkdirSync(join(proc, "9001"), { recursive: true });
    symlinkSync(wtReal, join(proc, "9001", "cwd"));
    const blocked = runHook({ lsof: "missing", procDir: proc });
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain("9001");
    const empty = join(base, "empty-proc");
    mkdirSync(empty);
    expect(runHook({ lsof: "missing", procDir: empty }).code).toBe(0);
  });

  it("(g) the hook's own pid standing in the worktree does not count", () => {
    const r = runHook({ lsof: { out: `p@HOOK@\nn${wtReal}\n` } });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("(g) the hook's parent (the process that launched it) standing in the worktree does not count either", () => {
    const r = runHook({ lsof: { out: `p${process.pid}\nn${wtReal}\n` } });
    expect(r.code).toBe(0);
  });

  it("(h) a DIRTY worktree keeps today's refusal text, without consulting occupancy", () => {
    const dirty = join(base, "wt-dirty");
    runGit(["worktree", "add", "-q", "--detach", dirty, runGit(["rev-parse", "main"], repo)], repo);
    writeFileSync(join(dirty, "scratch.txt"), "wip\n");
    const r = runHook({ command: `git worktree remove ${dirty}`, lore: { out: UNOCCUPIED } });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "Assessment: WORKTREE HAS 1 UNCOMMITTED change(s) — git itself refuses this without --force, but treat as UNSAFE:",
    );
    expect(r.loreArgs).toBe("");
  });

  it("(h) an UNMERGED worktree keeps today's refusal text", () => {
    const unmerged = join(base, "wt-unmerged");
    runGit(["worktree", "add", "-q", unmerged, "unmerged-branch"], repo);
    const r = runHook({ command: `git worktree remove ${unmerged}` });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('is NOT merged into main — removing loses these commit(s):');
    expect(r.stderr).toContain("unmerged work");
    expect(r.loreArgs).toBe("");
  });

  it("(h) --force on a clean, merged, unoccupied worktree keeps the SAFE assessment, still blocked, with no minutes wording", () => {
    const r = runHook({ command: `git worktree remove --force ${wt}` });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("— SAFE.");
    expect(r.stderr).toContain("--force is only needed for untracked leftovers");
    expect(r.stderr).not.toMatch(/minute/);
  });

  it("(h) --force on an OCCUPIED worktree is refused with the occupancy reason, not the SAFE text", () => {
    const r = runHook({
      command: `git worktree remove --force ${wt}`,
      lore: { out: occupancyJson({ agent_run: { id: "cc:S1:abc123", ended: false, parent_ended: false }, occupied: true }) },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cc:S1:abc123");
    expect(r.stderr).not.toContain("— SAFE.");
  });

  it("REGRESSION: no reflog or elapsed-time wording survives on the passing path or in refusals", () => {
    const refused = runHook({
      lore: { out: occupancyJson({ agent_run: { id: "cc:S1:abc123", ended: false, parent_ended: false }, occupied: true }) },
    });
    expect(refused.stderr).not.toMatch(/liveness window|minute\(s\)|reflog/);
  });
});
