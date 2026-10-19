// @spawns assets/hooks/pre-helper-write-scope-gate.mjs
/**
 * AC-HWS: an isolated helper's Write/Edit/NotebookEdit outside its own worktree is refused before it
 * happens. Real hook process, real stdin payload, throwaway git repo + linked worktree + state base.
 * Exit codes come from spawnSync().status (never through a pipe).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, makeGitRepo, makeTmpDir } from "./hook-harness";

const HOOK = resolve(__dirname, "../../../../../assets/hooks/pre-helper-write-scope-gate.mjs");
const SESSION = "S1";
const AGENT = "A1";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

interface Fixture {
  main: string;
  worktree: string;
  other: string; // a second linked worktree (another helper's)
  scratchpad: string; // stands in for the orchestrator's session scratchpad
  stateBase: string;
}

function makeFixture(): Fixture {
  const main = makeGitRepo();
  cleanup.push(main);
  writeFileSync(join(main, "a.ts"), "export const a = 1;\n");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "init");
  const holder = makeTmpDir("hws-wt-");
  cleanup.push(holder);
  const worktree = join(holder, "wt");
  const other = join(holder, "other");
  git(main, "worktree", "add", "-q", "-b", "helper", worktree);
  git(main, "worktree", "add", "-q", "-b", "helper2", other);
  const scratchpad = makeTmpDir("claude-scratchpad-"); // deliberately NOT tmp.*
  cleanup.push(scratchpad);
  const stateBase = makeTmpDir("hws-state-");
  cleanup.push(stateBase);
  return { main, worktree, other, scratchpad, stateBase };
}

function run(f: Fixture, payload: Record<string, unknown>, env: Record<string, string> = {}) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: f.stateBase, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function helperCall(f: Fixture, tool: string, path: string, extra: Record<string, unknown> = {}) {
  const field = tool === "NotebookEdit" ? "notebook_path" : "file_path";
  return {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    agent_id: AGENT,
    cwd: f.worktree,
    tool_name: tool,
    tool_input: { [field]: path },
    ...extra,
  };
}

describe("AC-HWS isolated helper write scope", () => {
  it("HAPPY: Write to <worktree>/.scratch/x is allowed", () => {
    const f = makeFixture();
    const r = run(f, helperCall(f, "Write", join(f.worktree, ".scratch", "x")));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("HAPPY: Edit of a worktree source file is allowed (relative path resolves against cwd)", () => {
    const f = makeFixture();
    expect(run(f, helperCall(f, "Edit", join(f.worktree, "a.ts"))).status).toBe(0);
    expect(run(f, helperCall(f, "Edit", "a.ts")).status).toBe(0);
  });

  it("NEGATIVE: Write to the orchestrator's session scratchpad is refused, naming target, worktree and allowed locations", () => {
    const f = makeFixture();
    const target = join(f.scratchpad, "impl.patch");
    const r = run(f, helperCall(f, "Write", target));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(realpathSync(f.scratchpad));
    expect(r.stderr).toContain(realpathSync(f.worktree));
    expect(r.stderr).toContain(".scratch");
    expect(r.stderr).toContain("mktemp -d");
  });

  it("HAPPY: Write under os.tmpdir()/tmp.ABC/ is allowed", () => {
    const f = makeFixture();
    expect(run(f, helperCall(f, "Write", join(tmpdir(), "tmp.ABC", "x"))).status).toBe(0);
  });

  it("HAPPY: with a run-root TMPDIR set, tmp.* under that root is allowed and under the default tmp root is refused", () => {
    const f = makeFixture();
    const root = mkdtempSync(join(f.scratchpad, "runroot-"));
    expect(run(f, helperCall(f, "Write", join(root, "tmp.XYZ", "x")), { TMPDIR: root }).status).toBe(0);
    expect(run(f, helperCall(f, "Write", join(tmpdir(), "tmp.XYZ", "x")), { TMPDIR: root }).status).toBe(2);
  });

  it("NEGATIVE: a non-tmp.* directory, and bare tmp.* itself as a file name outside a dir, are refused", () => {
    const f = makeFixture();
    expect(run(f, helperCall(f, "Write", join(tmpdir(), "notmktemp", "x"))).status).toBe(2);
    expect(run(f, helperCall(f, "Write", join(tmpdir(), "x"))).status).toBe(2);
  });

  it("NEGATIVE: Edit of a file in another worktree is refused", () => {
    const f = makeFixture();
    const r = run(f, helperCall(f, "Edit", join(f.other, "a.ts")));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(realpathSync(f.other));
  });

  it("NEGATIVE: Edit of the main checkout is refused", () => {
    const f = makeFixture();
    expect(run(f, helperCall(f, "Edit", join(f.main, "a.ts"))).status).toBe(2);
  });

  it("NEGATIVE: NotebookEdit and MultiEdit outside the worktree are refused", () => {
    const f = makeFixture();
    expect(run(f, helperCall(f, "NotebookEdit", join(f.scratchpad, "n.ipynb"))).status).toBe(2);
    expect(run(f, helperCall(f, "MultiEdit", join(f.scratchpad, "m.ts"))).status).toBe(2);
    expect(run(f, helperCall(f, "NotebookEdit", join(f.worktree, "n.ipynb"))).status).toBe(0);
  });

  it("BOUNDARY: a `..` hop out of the worktree is refused", () => {
    const f = makeFixture();
    expect(run(f, helperCall(f, "Write", join(f.worktree, "..", "other", "a.ts"))).status).toBe(2);
    expect(run(f, helperCall(f, "Write", join(f.worktree, "..", "..", "x"))).status).toBe(2);
  });

  it("BOUNDARY: a symlink inside the worktree pointing outside does not escape the check", () => {
    const f = makeFixture();
    symlinkSync(f.scratchpad, join(f.worktree, "link"));
    expect(run(f, helperCall(f, "Write", join(f.worktree, "link", "x"))).status).toBe(2);
  });

  it("BOUNDARY: a sibling directory sharing the worktree path as a prefix is refused", () => {
    const f = makeFixture();
    mkdirSync(`${f.worktree}-evil`);
    expect(run(f, helperCall(f, "Write", join(`${f.worktree}-evil`, "x"))).status).toBe(2);
  });

  it("STATE: the main (non-helper) session is not affected, even writing outside any worktree", () => {
    const f = makeFixture();
    const payload = helperCall(f, "Write", join(f.scratchpad, "x"));
    delete (payload as Record<string, unknown>).agent_id;
    expect(run(f, payload).status).toBe(0);
  });

  it("STATE: a helper that shares the main checkout (not isolated) is not affected", () => {
    const f = makeFixture();
    const payload = helperCall(f, "Write", join(f.scratchpad, "x"), { cwd: f.main });
    expect(run(f, payload).status).toBe(0);
  });

  it("STATE: the trail's recorded working_copy wins over a drifted cwd", () => {
    const f = makeFixture();
    const helpers = join(f.stateBase, "sessions", SESSION, "helpers");
    mkdirSync(helpers, { recursive: true });
    writeFileSync(
      join(helpers, `${AGENT}.json`),
      JSON.stringify({ run: `cc:${SESSION}:${AGENT}`, started_at: "2026-01-01T00:00:00.000Z", end_count: 1, working_copy: f.worktree }),
    );
    // cwd drifted into the main checkout; the recorded copy still identifies the isolated helper
    const r = run(f, helperCall(f, "Write", join(f.main, "a.ts"), { cwd: f.main }));
    expect(r.status).toBe(2);
  });

  it("ERROR: isolated helper whose worktree root cannot be resolved is refused loud, not allowed", () => {
    const f = makeFixture();
    // a bare-ish case: cwd is inside the worktree's .git admin dir -> git dir != common dir, but no toplevel
    const gitAdmin = git(f.worktree, "rev-parse", "--absolute-git-dir");
    const r = run(f, helperCall(f, "Write", join(f.scratchpad, "x"), { cwd: gitAdmin }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("could not be resolved");
  });

  it("ERROR: malformed stdin and non-object payloads do not crash or block", () => {
    const f = makeFixture();
    for (const input of ["not json", "[]", "null", ""]) {
      const r = spawnSync("node", [HOOK], { input, encoding: "utf8", env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: f.stateBase } });
      expect(r.status).toBe(0);
    }
  });

  it("ERROR: a helper payload with no usable target path is left to the tool", () => {
    const f = makeFixture();
    const payload = { ...helperCall(f, "Write", ""), tool_input: {} };
    expect(run(f, payload).status).toBe(0);
  });

  it("REGRESSION: tools the hook does not govern (Read, Bash) pass even for an outside path", () => {
    const f = makeFixture();
    expect(run(f, helperCall(f, "Read", join(f.scratchpad, "x"))).status).toBe(0);
    expect(run(f, { ...helperCall(f, "Bash", ""), tool_input: { command: `echo hi > ${join(f.scratchpad, "x")}` } }).status).toBe(0);
  });
});
