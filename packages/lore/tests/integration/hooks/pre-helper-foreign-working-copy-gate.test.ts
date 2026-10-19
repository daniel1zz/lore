// @spawns assets/hooks/pre-helper-foreign-working-copy-gate.mjs
// @spawns assets/hooks/session-trail-start.mjs
// @spawns assets/hooks/subagent-trail.mjs
/**
 * AC-HFW (BR-1092): an isolated helper's Write/Edit/MultiEdit/NotebookEdit whose canonical target lies
 * inside a git working copy other than the helper's own is refused before it happens. Writes outside any
 * working copy (scratchpad, tmp) are not this hook's concern. Real hook processes, real stdin payloads,
 * throwaway git repos + linked worktrees + state base. Exit codes come from spawnSync().status.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, makeGitRepo, makeTmpDir, runHook } from "./hook-harness";

const HOOK = resolve(__dirname, "../../../../../assets/hooks/pre-helper-foreign-working-copy-gate.mjs");
const SESSION = "S1";
const AGENT = "A1";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

interface Fixture {
  main: string; // the shared checkout
  worktree: string; // the helper's own worktree
  other: string; // another helper's worktree of the same repo
  foreign: string; // a different repo's working copy
  scratchpad: string; // stands in for the orchestrator's session scratchpad (in no working copy)
  stateBase: string;
}

function makeFixture(): Fixture {
  const main = makeGitRepo();
  cleanup.push(main);
  writeFileSync(join(main, "a.ts"), "export const a = 1;\n");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "init");
  const holder = makeTmpDir("hfw-wt-");
  cleanup.push(holder);
  const worktree = join(holder, "wt");
  const other = join(holder, "other");
  git(main, "worktree", "add", "-q", "-b", "helper", worktree);
  git(main, "worktree", "add", "-q", "-b", "helper2", other);
  const foreign = makeGitRepo();
  cleanup.push(foreign);
  const scratchpad = makeTmpDir("claude-scratchpad-");
  cleanup.push(scratchpad);
  const stateBase = makeTmpDir("hfw-state-");
  cleanup.push(stateBase);
  return { main, worktree, other, foreign, scratchpad, stateBase };
}

/** SubagentStart through the real trail hook: records the helper's working_copy in the trail. */
function startHelper(f: Fixture, cwd = f.worktree): void {
  const r = runHook("session-trail-start.mjs", { hook_event_name: "SubagentStart", session_id: SESSION, agent_id: AGENT, cwd }, f.stateBase);
  expect(r.status).toBe(0);
}

function run(f: Fixture, payload: Record<string, unknown>) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: f.stateBase },
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

describe("AC-HFW isolated helper foreign working copy gate", () => {
  it("HAPPY: Write to <worktree>/.scratch/x and Edit of a worktree file are allowed (relative path too)", () => {
    const f = makeFixture();
    startHelper(f);
    for (const [tool, p] of [["Write", join(f.worktree, ".scratch", "x")], ["Edit", join(f.worktree, "a.ts")], ["Edit", "a.ts"]] as const) {
      const r = run(f, helperCall(f, tool, p));
      expect(r.status, `${tool} ${p}`).toBe(0);
      expect(r.stderr).toBe("");
    }
  });

  it("HAPPY: writes into the session scratchpad or a tmp dir (in no working copy) are allowed by this hook", () => {
    const f = makeFixture();
    startHelper(f);
    expect(run(f, helperCall(f, "Write", join(f.scratchpad, "impl.patch"))).status).toBe(0);
    expect(run(f, helperCall(f, "Write", join(tmpdir(), "tmp.ABC", "x"))).status).toBe(0);
    expect(run(f, helperCall(f, "Write", join(tmpdir(), "not-mktemp", "x"))).status).toBe(0);
  });

  it("NEGATIVE: a write into the shared checkout is refused, naming target, own worktree and the foreign working copy", () => {
    const f = makeFixture();
    startHelper(f);
    const r = run(f, helperCall(f, "Write", join(f.main, "src", "new.ts")));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(realpathSync(f.main));
    expect(r.stderr).toContain(realpathSync(f.worktree));
    expect(r.stderr).toContain("BR-1092");
  });

  it("NEGATIVE: Edit of a file in another worktree is refused", () => {
    const f = makeFixture();
    startHelper(f);
    const r = run(f, helperCall(f, "Edit", join(f.other, "a.ts")));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(realpathSync(f.other));
  });

  it("NEGATIVE: a write into another repo's working copy is refused", () => {
    const f = makeFixture();
    startHelper(f);
    expect(run(f, helperCall(f, "Write", join(f.foreign, "x"))).status).toBe(2);
  });

  it("NEGATIVE: NotebookEdit and MultiEdit into a foreign working copy are refused; into the own worktree allowed", () => {
    const f = makeFixture();
    startHelper(f);
    expect(run(f, helperCall(f, "NotebookEdit", join(f.main, "n.ipynb"))).status).toBe(2);
    expect(run(f, helperCall(f, "MultiEdit", join(f.main, "a.ts"))).status).toBe(2);
    expect(run(f, helperCall(f, "NotebookEdit", join(f.worktree, "n.ipynb"))).status).toBe(0);
  });

  it("STATE: a helper whose shell cwd drifted into the shared checkout and writes there is refused (trail working_copy)", () => {
    const f = makeFixture();
    startHelper(f);
    const r = run(f, helperCall(f, "Write", join(f.main, "a.ts"), { cwd: f.main }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(realpathSync(f.main));
  });

  it("STATE: SubagentStop with a drifted cwd does not overwrite the working_copy recorded at start", () => {
    const f = makeFixture();
    startHelper(f);
    const r = runHook("subagent-trail.mjs", { hook_event_name: "SubagentStop", session_id: SESSION, agent_id: AGENT, cwd: f.main }, f.stateBase);
    expect(r.status).toBe(0);
    const rec = JSON.parse(readFileSync(join(f.stateBase, "sessions", SESSION, "helpers", `${AGENT}.json`), "utf8"));
    expect(rec.working_copy).toBe(f.worktree);
  });

  it("STATE: the main (non-helper) session is not affected, even writing into another working copy", () => {
    const f = makeFixture();
    const payload = helperCall(f, "Write", join(f.main, "x"));
    delete (payload as Record<string, unknown>).agent_id;
    expect(run(f, payload).status).toBe(0);
  });

  it("STATE: a helper that shares the shared checkout (not isolated) is not affected", () => {
    const f = makeFixture();
    expect(run(f, helperCall(f, "Write", join(f.foreign, "x"), { cwd: f.main })).status).toBe(0);
  });

  it("BOUNDARY: a `..` hop out of the worktree into another working copy is refused", () => {
    const f = makeFixture();
    startHelper(f);
    expect(run(f, helperCall(f, "Write", join(f.worktree, "..", "other", "a.ts"))).status).toBe(2);
  });

  it("BOUNDARY: a symlink inside the worktree pointing into the shared checkout does not escape the check", () => {
    const f = makeFixture();
    startHelper(f);
    symlinkSync(f.main, join(f.worktree, "link"));
    expect(run(f, helperCall(f, "Write", join(f.worktree, "link", "x"))).status).toBe(2);
  });

  it("BOUNDARY: a sibling directory sharing the worktree path as a prefix (in no working copy) is not a foreign working copy", () => {
    const f = makeFixture();
    startHelper(f);
    mkdirSync(`${f.worktree}-evil`);
    expect(run(f, helperCall(f, "Write", join(`${f.worktree}-evil`, "x"))).status).toBe(0);
  });

  it("ERROR: isolated helper whose worktree root cannot be resolved is refused loud, not allowed", () => {
    const f = makeFixture();
    const gitAdmin = git(f.worktree, "rev-parse", "--absolute-git-dir");
    const r = run(f, helperCall(f, "Write", join(f.main, "x"), { cwd: gitAdmin }));
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
    expect(run(f, { ...helperCall(f, "Write", ""), tool_input: {} }).status).toBe(0);
  });

  it("REGRESSION: tools the hook does not govern (Read, Bash) pass even for a foreign path", () => {
    const f = makeFixture();
    startHelper(f);
    expect(run(f, helperCall(f, "Read", join(f.main, "a.ts"))).status).toBe(0);
    expect(run(f, { ...helperCall(f, "Bash", ""), tool_input: { command: `echo hi > ${join(f.main, "x")}` } }).status).toBe(0);
  });
});
