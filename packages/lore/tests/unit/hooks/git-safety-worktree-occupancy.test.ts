/**
 * @spec_ref spec-worktree-removal-is-decided-by-who-is-inside-not-by-how (AC-WL-3; D1-D6; BR-1070)
 * @spec_ref spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (AC-WS-4: stub moved to the check JSON shape)
 *
 * The REAL git-safety hook against a REAL throwaway repo holding a clean, merged linked worktree whose last
 * commit is seconds old. `lore` is a stub executable first on PATH that answers `lore worktree check ... --json`, so
 * each occupancy signal is scripted; nothing here reads or writes a lore corpus.
 *
 * RE-BASELINE (task-single-worktree-removal-test-used-by-the-hook-lore-done, AC-WS-5): the hook no longer scans processes
 * (lore owns the scan, tested in worktree-check-sweep-compiled.bun.test.ts and the process-scan port tests), so the old
 * lsof / /proc cases became check-JSON cases (`process-inside`) and the lore-spawn contract changed to `worktree check`.
 *
 * HAPPY:      (a) nobody inside -> `git worktree remove` passes through with no block, however recent the commit
 * NEGATIVE:   (b) live agent run, (c) process inside, (d) open claim -> blocked, each naming its way out
 * ERROR:      (e) lore missing / exits 1, (e2) lore exits 0 with non-JSON
 * REGRESSION: (h) dirty / unmerged keep today's refusal texts; --force on an unoccupied worktree keeps the SAFE text
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-bash-git-safety-gate.mjs");
const HOOK_SESSION = "S-hook-1";

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

function checkJson(data: Record<string, unknown>): string {
  return JSON.stringify({
    ok: true,
    data: { path: wtReal, verdict: "removable", reasons: [], owner: null, occupancy: null, processes: [], ...data },
  });
}

const REMOVABLE = checkJson({});

interface Scenario {
  lore?: { out: string; exit?: number } | "missing";
  command?: string;
}

function runHook(s: Scenario): { code: number; stderr: string; loreArgs: string } {
  const lore = s.lore ?? { out: REMOVABLE };
  if (lore !== "missing") {
    writeFileSync(join(stubDir, "lore.out"), lore.out);
    writeFileSync(join(stubDir, "lore.exit"), String(lore.exit ?? 0));
  }
  writeFileSync(join(stubDir, "lore.args"), "");
  // reason: "missing" must be MISSING from PATH — never a developer's installed lore.
  const pathDirs = [stubDir];
  if (lore === "missing") {
    const only = mkdtempSync(join(base, "bin-"));
    for (const tool of ["git", "ps", "cat"]) symlinkSync(which(tool), join(only, tool));
    pathDirs.length = 0;
    pathDirs.push(only);
  } else {
    pathDirs.push(...(process.env["PATH"] ?? "").split(delimiter));
  }
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      cwd: repo,
      session_id: HOOK_SESSION,
      tool_input: { command: s.command ?? `git worktree remove ${wt}` },
    }),
    encoding: "utf8",
    env: { PATH: pathDirs.join(delimiter), HOME: process.env["HOME"] ?? base, STUB_DIR: stubDir },
  });
  const args = spawnSync("cat", [join(stubDir, "lore.args")], { encoding: "utf8" }).stdout;
  return { code: r.status ?? -1, stderr: r.stderr ?? "", loreArgs: args };
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
  chmodSync(join(stubDir, "lore"), 0o755);
}, 60_000);

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

describe("AC-WL-3 git-safety hook — worktree removal decided by lore's one removal test", () => {
  it("(a) clean + merged + last commit seconds old + lore says removable: passes through with no block", () => {
    const r = runHook({});
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.loreArgs.trim()).toBe(`worktree check ${wt} --session ${HOOK_SESSION} --json`);
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
      lore: {
        out: checkJson({
          verdict: "keep",
          reasons: ["run-not-ended"],
          occupancy: { worktree: wtReal, agent_run: { id: "cc:S1:abc123", ended: false, parent_ended: false }, open_claims: [], occupied: true },
        }),
      },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cc:S1:abc123");
    expect(r.stderr).toContain('lore run end cc:S1:abc123 --reason "<why>"');
  });

  it("(c) a process inside: blocked, naming pid and command", () => {
    const r = runHook({
      lore: { out: checkJson({ verdict: "keep", reasons: ["process-inside"], processes: [{ pid: 4242, command: "sleep" }] }) },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("4242");
    expect(r.stderr).toContain("sleep");
  });

  it("(d) an open claim whose run is alive, or that names no run: blocked, naming the task", () => {
    const live = runHook({
      lore: {
        out: checkJson({
          verdict: "keep",
          reasons: ["open-claim"],
          occupancy: { worktree: wtReal, agent_run: null, open_claims: [{ task_slug: "task-live-one", run_id: "cc:S2", run_ended: false }], occupied: true },
        }),
      },
    });
    expect(live.code).toBe(2);
    expect(live.stderr).toContain("task-live-one");
    const noRun = runHook({
      lore: {
        out: checkJson({
          verdict: "keep",
          reasons: ["open-claim"],
          occupancy: { worktree: wtReal, agent_run: null, open_claims: [{ task_slug: "task-no-run", run_id: null, run_ended: null }], occupied: true },
        }),
      },
    });
    expect(noRun.code).toBe(2);
    expect(noRun.stderr).toContain("task-no-run");
  });

  it("(e) lore missing from PATH, or exiting 1: blocked, the removal test named as unreadable", () => {
    const missing = runHook({ lore: "missing" });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("cannot read lore's removal test");
    const failing = runHook({ lore: { out: "", exit: 1 } });
    expect(failing.code).toBe(2);
    expect(failing.stderr).toContain("cannot read lore's removal test");
  });

  it("(e2) lore exiting 0 with output that is not the documented JSON: blocked as unreadable", () => {
    for (const out of ["all good\n", "{}\n", JSON.stringify({ ok: true, data: { verdict: "maybe", reasons: [], processes: [] } })]) {
      const r = runHook({ lore: { out } });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("cannot read lore's removal test");
    }
  });

  it("(e3) a not-measured verdict blocks, naming the unmeasured clause", () => {
    const r = runHook({
      lore: { out: checkJson({ verdict: "not-measured", reasons: ["processes-not-measured: lsof is not installed and /proc is not readable"] }) },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("processes-not-measured");
  });

  it("(h) a DIRTY worktree keeps today's refusal text, without consulting lore", () => {
    const dirty = join(base, "wt-dirty");
    runGit(["worktree", "add", "-q", "--detach", dirty, runGit(["rev-parse", "main"], repo)], repo);
    writeFileSync(join(dirty, "scratch.txt"), "wip\n");
    const r = runHook({ command: `git worktree remove ${dirty}` });
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
    expect(r.stderr).toContain("is NOT merged into main — removing loses these commit(s):");
    expect(r.stderr).toContain("unmerged work");
    expect(r.loreArgs).toBe("");
  });

  it("(h) --force on a clean, merged, removable worktree keeps the SAFE assessment, still blocked, with no minutes wording", () => {
    const r = runHook({ command: `git worktree remove --force ${wt}` });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("— SAFE.");
    expect(r.stderr).toContain("--force is only needed for untracked leftovers");
    expect(r.stderr).not.toMatch(/minute/);
  });

  it("(h) --force on an OCCUPIED worktree is refused with the occupancy reason, not the SAFE text", () => {
    const r = runHook({
      command: `git worktree remove --force ${wt}`,
      lore: {
        out: checkJson({
          verdict: "keep",
          reasons: ["run-not-ended"],
          occupancy: { worktree: wtReal, agent_run: { id: "cc:S1:abc123", ended: false, parent_ended: false }, open_claims: [], occupied: true },
        }),
      },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cc:S1:abc123");
    expect(r.stderr).not.toContain("— SAFE.");
  });

  it("REGRESSION: no reflog or elapsed-time wording survives on the passing path or in refusals", () => {
    const refused = runHook({
      lore: {
        out: checkJson({
          verdict: "keep",
          reasons: ["run-not-ended"],
          occupancy: { worktree: wtReal, agent_run: { id: "cc:S1:abc123", ended: false, parent_ended: false }, open_claims: [], occupied: true },
        }),
      },
    });
    expect(refused.stderr).not.toMatch(/liveness window|minute\(s\)|reflog/);
  });
});
