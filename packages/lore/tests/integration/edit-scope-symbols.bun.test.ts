// @spawns packages/lore/src/index.ts
// @spawns assets/hooks/pre-edit-anchor-gate.mjs
/**
 * Edit-time anchor gate, symbol scope (task-skill-fix-the-edit-time-gate-locks-whole-files-so-disjoint).
 *
 * Two live claims on one hotspot file must not serialise when their edits are disjoint: an anchor is `path` (whole file),
 * `dir/` (the files its holder really touched) or `path#Symbol` (one top-level symbol), and the pre-edit hook works out
 * which top-level symbols an Edit touches from the position of old_string. A shell write (`sed -i`, `>`, `tee`, python
 * `open(..., "w")`) by a helper goes through the same decision.
 *
 * Real hook process, real `lore` CLI (a PATH wrapper around `bun run packages/lore/src/index.ts`), a throwaway git repo
 * with its own `lore init` corpus and linked worktrees. Never touches the repo's own `.lore/` or the real PATH `lore`.
 *
 * Coverage:
 *   AC-ESS-1 HAPPY     A holds `app.ts#wireIssueCloseOnArchive`; B edits a different function: allowed, declared as a symbol anchor
 *   AC-ESS-2 NEGATIVE  B's edit inside A's symbol is denied, naming A; nothing written
 *   AC-ESS-3 NEGATIVE  a whole-file hold denies any edit (Edit and Write)
 *   AC-ESS-4 HAPPY     a directory anchor holds only the files its holder touched (declared, or changed in its worktree)
 *   AC-ESS-5 NEGATIVE  `sed -i` through the Bash hook on a file A holds is denied naming A; on an unclaimed file it auto-declares
 *   BOUNDARY           in-anchor symbol edit writes nothing; a non-writing command and the main session are never governed
 *   REGRESSION         `path#Symbol` anchors are accepted by the task-anchor grammar and rejected when malformed
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { anchorsOverlap, normalizeFileAnchors } from "@lore/core";
import { sessionActorFor, sessionIdOfActor } from "../helpers/session-actor";
import { registerRun, runLore } from "./cli/support/claim-run-fixture.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const REPO_ROOT = resolve(__dirname, "../../../..");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-edit-anchor-gate.mjs");

const SESSION = "ess-sess";
const AGENT_A = "agentA";
const AGENT_B = "agentB";
const RUN_A = `cc:${SESSION}:${AGENT_A}`;
const RUN_B = `cc:${SESSION}:${AGENT_B}`;
const ACTOR_A = sessionActorFor("agent:ess-a");
const ACTOR_B = sessionActorFor("agent:ess-b");

const APP_TS = [
  'import { helper } from "./helper";',
  "",
  "/** Closes the issue when its task archives. */",
  "export function wireIssueCloseOnArchive() {",
  '  return helper("close-original");',
  "}",
  "",
  "export function buildIssueIntake() {",
  '  return helper("intake-original");',
  "}",
  "",
  "export function otherFn() {",
  '  return helper("other-original");',
  "}",
  "",
].join("\n");

interface Fixture {
  readonly base: string;
  readonly repo: string;
  readonly wtA: string;
  readonly wtB: string;
  readonly taskA: string;
  readonly taskB: string;
  readonly stateBase: string;
  readonly wrapperBin: string;
}

let fx: Fixture;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function mustLore(args: string[], cwd: string, run?: string, actor?: string): string {
  const r = runLore(args, cwd, run, actor);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function buildFixture(): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "ess-")));
  const repo = join(base, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "ess@example.invalid");
  git(repo, "config", "user.name", "ess test");
  writeFileSync(join(repo, ".gitignore"), ".scratch/\nLibrary/\n");
  const files: Record<string, string> = {
    "src/app.ts": APP_TS,
    "src/helper.ts": "export const helper = (s: string) => s;\n",
    "src/whole.ts": "export const w = 1;\n",
    "held/touched.ts": "export const t = 1;\n",
    "held/untouched.ts": "export const u = 1;\n",
    "held/dirty.ts": "export const d = 1;\n",
    "bonly/b.ts": "export const b = 1;\n",
    "free/unclaimed.ts": "export const f = 1;\n",
    "free/redir.ts": "export const r = 1;\n",
    "free/tee.ts": "export const e = 1;\n",
    "free/py.ts": "export const p = 1;\n",
    "docs/notes.md": "# notes\n",
  };
  for (const [f, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), content);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");

  mustLore(["init"], repo);
  appendFileSync(join(repo, ".lore", "config.yaml"), ["workflow:", "  gates:", "    task-claim:", "      enabled: false", ""].join("\n"));
  const prd = slugOf(mustLore(["create", "prd", "--title", "ESS PRD", "--content", "root", "--no-ai"], repo));
  const plan = slugOf(mustLore(["create", "plan", "--title", "ESS Plan", "--parent", prd, "--content", "x", "--no-ai"], repo));
  const newTask = (title: string, anchors: string[]): string =>
    slugOf(
      mustLore(
        ["create", "task", "--title", title, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai", ...anchors.flatMap((a) => ["--anchor", a])],
        repo,
      ),
    );
  const taskA = newTask("ESS Task A", ["src/app.ts#wireIssueCloseOnArchive", "src/whole.ts", "held/"]);
  const taskB = newTask("ESS Task B", ["src/app.ts#buildIssueIntake", "bonly/b.ts"]);

  const wtA = join(base, "wt-a");
  const wtB = join(base, "wt-b");
  git(repo, "worktree", "add", "-q", "-b", "ess-a", wtA);
  git(repo, "worktree", "add", "-q", "-b", "ess-b", wtB);

  registerRun(repo, RUN_A);
  registerRun(repo, RUN_B);
  mustLore(["claim", taskA, "--worktree", wtA], wtA, RUN_A, ACTOR_A);
  mustLore(["claim", taskB, "--worktree", wtB], wtB, RUN_B, ACTOR_B);

  const stateBase = join(base, "state");
  mkdirSync(stateBase);
  const wrapperBin = join(base, "bin-with-lore");
  mkdirSync(wrapperBin);
  const wrapper = join(wrapperBin, "lore");
  writeFileSync(wrapper, `#!/bin/sh\nexec bun run ${JSON.stringify(ENTRY)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  return { base, repo, wtA, wtB, taskA, taskB, stateBase, wrapperBin };
}

interface HookResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly ms: number;
}

interface HookCall {
  readonly cwd: string;
  readonly tool: "Edit" | "Write" | "MultiEdit" | "Bash";
  readonly input: Record<string, unknown>;
  readonly agent?: string | null;
  readonly actor?: string;
}

function runHook(call: HookCall): HookResult {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const name of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_GATE_BYPASS"]) delete env[name];
  env["HOME"] = fx.base;
  env["CLAUDECODE"] = "1";
  env["CLAUDE_STATE_BASE_OVERRIDE"] = fx.stateBase;
  env["CLAUDE_CODE_SESSION_ID"] = sessionIdOfActor(call.actor ?? ACTOR_B);
  env["PATH"] = `${fx.wrapperBin}:${process.env["PATH"] ?? ""}`;
  const payload: Record<string, unknown> = {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd: call.cwd,
    tool_name: call.tool,
    tool_input: call.input,
  };
  if (call.agent !== null) payload["agent_id"] = call.agent ?? AGENT_B;
  const startedAt = performance.now();
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8", env });
  return { status: r.status, stderr: r.stderr, ms: Math.round(performance.now() - startedAt) };
}

/** B's Edit of `file` (relative to B's worktree) replacing `oldString`. */
function editAsB(file: string, oldString: string, agent: string | null = AGENT_B): HookResult {
  return runHook({ cwd: fx.wtB, tool: "Edit", agent, input: { file_path: join(fx.wtB, file), old_string: oldString, new_string: `${oldString} // edited` } });
}

function bashAsB(command: string, agent: string | null = AGENT_B): HookResult {
  return runHook({ cwd: fx.wtB, tool: "Bash", agent, input: { command } });
}

function anchorsOf(slug: string): string[] {
  const db = new Database(join(fx.repo, ".lore", "lore.db"), { readonly: true });
  try {
    const doc = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string } | null;
    if (doc === null) throw new Error(`no doc ${slug}`);
    return (JSON.parse(doc.extra) as { file_anchors?: string[] }).file_anchors ?? [];
  } finally {
    db.close();
  }
}

beforeAll(() => {
  fx = buildFixture();
});

afterAll(() => {
  if (fx !== undefined) rmSync(fx.base, { recursive: true, force: true });
});

describe("task anchors accept `path#Symbol` (task-skill-fix-the-edit-time-gate-locks-whole-files-so-disjoint)", () => {
  it("REGRESSION: normalizes `path#Symbol`, keeps two symbols of one file, rejects a malformed symbol and a directory symbol", () => {
    const ok = normalizeFileAnchors(["./src/app.ts#Foo", "src/app.ts#Bar", "src/app.ts#Foo"]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toEqual(["src/app.ts#Foo", "src/app.ts#Bar"]);
    expect(normalizeFileAnchors(["src/app.ts#not-an-id"]).ok).toBe(false);
    expect(normalizeFileAnchors(["src/dir/#Foo"]).ok).toBe(false);
    expect(normalizeFileAnchors(["../x.ts#Foo"]).ok).toBe(false);
  });

  it("BOUNDARY: symbol overlap is per symbol; a whole-file anchor overlaps every symbol of its file; a directory overlaps the files under it", () => {
    expect(anchorsOverlap(["a.ts#F"], ["a.ts#G"]).overlaps).toBe(false);
    expect(anchorsOverlap(["a.ts#F"], ["a.ts#F"]).overlaps).toBe(true);
    expect(anchorsOverlap(["a.ts#F"], ["a.ts"]).overlaps).toBe(true);
    expect(anchorsOverlap(["a.ts"], ["a.ts#G"]).overlaps).toBe(true);
    expect(anchorsOverlap(["a.ts#F"], ["b.ts#F"]).overlaps).toBe(false);
    expect(anchorsOverlap(["src/"], ["src/a.ts#F"]).overlaps).toBe(true);
  });
});

describe("symbol-scoped holds through the pre-edit hook", () => {
  it("AC-ESS-1: A holds app.ts#wireIssueCloseOnArchive; B edits a different function -> allowed, declared as a symbol anchor", () => {
    const beforeA = anchorsOf(fx.taskA);
    const r = editAsB("src/app.ts", 'return helper("other-original");');
    expect(r.status, r.stderr).toBe(0);
    expect(anchorsOf(fx.taskB)).toContain("src/app.ts#otherFn");
    expect(anchorsOf(fx.taskB)).not.toContain("src/app.ts");
    expect(anchorsOf(fx.taskA)).toEqual(beforeA);
  });

  it("AC-ESS-1 (BOUNDARY): B's edit inside the symbol B already holds is allowed and writes nothing", () => {
    const before = anchorsOf(fx.taskB);
    const r = editAsB("src/app.ts", 'return helper("intake-original");');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
    expect(anchorsOf(fx.taskB)).toEqual(before);
  });

  it("AC-ESS-2: B's edit inside A's symbol is denied, naming A; nothing is written", () => {
    const before = anchorsOf(fx.taskB);
    const r = editAsB("src/app.ts", 'return helper("close-original");');
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(fx.taskA);
    expect(anchorsOf(fx.taskB)).toEqual(before);
  });

  it("AC-ESS-2 (BOUNDARY): an edit spanning two symbols is denied when either one is held by A", () => {
    const r = editAsB("src/app.ts", ['  return helper("other-original");', "}", "", "export function wireIssueCloseOnArchive() {"].join("\n"));
    // old_string text above is not in the file: an unlocatable old_string must fall back to the whole file, which A's symbol hold also blocks.
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(fx.taskA);
  });

  it("AC-ESS-3: a whole-file hold denies any edit (Edit and Write), naming the holder", () => {
    const edit = editAsB("src/whole.ts", "export const w = 1;");
    expect(edit.status, edit.stderr).toBe(2);
    expect(edit.stderr).toContain(fx.taskA);
    const write = runHook({ cwd: fx.wtB, tool: "Write", input: { file_path: join(fx.wtB, "src/whole.ts"), content: "x\n" } });
    expect(write.status, write.stderr).toBe(2);
    expect(write.stderr).toContain(fx.taskA);
  });

  it("AC-ESS-3 (BOUNDARY): a Write touches the whole file, so it is denied on a file where A holds one symbol", () => {
    const write = runHook({ cwd: fx.wtB, tool: "Write", input: { file_path: join(fx.wtB, "src/app.ts"), content: APP_TS } });
    expect(write.status, write.stderr).toBe(2);
    expect(write.stderr).toContain(fx.taskA);
  });
});

describe("a directory anchor holds only the files its holder touched", () => {
  it("AC-ESS-4: A holds held/; B edits held/untouched.ts, which A never touched -> allowed and declared on B", () => {
    const r = editAsB("held/untouched.ts", "export const u = 1;");
    expect(r.status, r.stderr).toBe(0);
    expect(anchorsOf(fx.taskB)).toContain("held/untouched.ts#u");
  });

  it("AC-ESS-4: once A declares held/touched.ts (its first edit), B's edit of it is denied naming A", () => {
    const first = runHook({
      cwd: fx.wtA,
      tool: "Edit",
      agent: AGENT_A,
      actor: ACTOR_A,
      input: { file_path: join(fx.wtA, "held/touched.ts"), old_string: "export const t = 1;", new_string: "export const t = 2;" },
    });
    expect(first.status, first.stderr).toBe(0);
    expect(anchorsOf(fx.taskA)).toContain("held/touched.ts#t");
    const r = editAsB("held/touched.ts", "export const t = 1;");
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(fx.taskA);
  });

  it("AC-ESS-4: a file A changed in its worktree without declaring it (a shell write) is touched too: B's edit is denied", () => {
    writeFileSync(join(fx.wtA, "held/dirty.ts"), "export const d = 99;\n");
    const r = editAsB("held/dirty.ts", "export const d = 1;");
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(fx.taskA);
  });
});

describe("shell writes through the Bash hook", () => {
  it("AC-ESS-5: `sed -i` on a file A holds is denied, naming A", () => {
    const r = bashAsB("sed -i 's/x/y/' src/whole.ts");
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(fx.taskA);
  });

  it("AC-ESS-5: the same command on an unclaimed file auto-declares it onto B and runs", () => {
    const r = bashAsB("sed -i 's/x/y/' free/unclaimed.ts");
    expect(r.status, r.stderr).toBe(0);
    expect(anchorsOf(fx.taskB)).toContain("free/unclaimed.ts");
  });

  it("a `>` redirect, `tee` and python `open(..., 'w')` are read the same way (declare on free, deny on held)", () => {
    expect(bashAsB("echo hi > free/redir.ts").status).toBe(0);
    expect(anchorsOf(fx.taskB)).toContain("free/redir.ts");
    expect(bashAsB("echo hi | tee free/tee.ts").status).toBe(0);
    expect(anchorsOf(fx.taskB)).toContain("free/tee.ts");
    expect(bashAsB(`python3 -c "open('free/py.ts','w').write('x')"`).status).toBe(0);
    expect(anchorsOf(fx.taskB)).toContain("free/py.ts");
    const held = bashAsB("echo hi > src/whole.ts");
    expect(held.status, held.stderr).toBe(2);
    expect(held.stderr).toContain(fx.taskA);
    const heldTee = bashAsB("cat x | tee -a src/whole.ts");
    expect(heldTee.status, heldTee.stderr).toBe(2);
    const heldPy = bashAsB(`python3 -c "open('src/whole.ts', 'w').write('x')"`);
    expect(heldPy.status, heldPy.stderr).toBe(2);
  });

  it("a `cd` earlier in the chain moves the target: `cd src && sed -i ... whole.ts` is denied", () => {
    const r = bashAsB("cd src && sed -i 's/x/y/' whole.ts");
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(fx.taskA);
  });

  it("NEGATIVE control: a command that writes no repo file, a git-ignored target, an outside-worktree target and the main session are never refused", () => {
    expect(bashAsB("git status --short && ls src").status).toBe(0);
    expect(bashAsB("echo hi > .scratch/out.txt").status).toBe(0);
    expect(bashAsB(`echo hi > ${join(fx.base, "elsewhere.txt")}`).status).toBe(0);
    expect(bashAsB("sed -i 's/x/y/' src/whole.ts", null).status).toBe(0);
  });

  it("a target that cannot be read from the text is not refused (the turn-end review is the backstop)", () => {
    expect(bashAsB('sed -i "s/x/y/" "$(pick_file)"').status).toBe(0);
  });
});

describe("latency of the in-anchor path", () => {
  it("reports the hook's wall time for an in-anchor file edit and an in-anchor symbol edit", () => {
    const fileMs: number[] = [];
    const symbolMs: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const file = runHook({ cwd: fx.wtB, tool: "Edit", input: { file_path: join(fx.wtB, "bonly/b.ts"), old_string: "export const b = 1;", new_string: "x" } });
      expect(file.status, file.stderr).toBe(0);
      fileMs.push(file.ms);
      const symbol = editAsB("src/app.ts", 'return helper("intake-original");');
      expect(symbol.status, symbol.stderr).toBe(0);
      symbolMs.push(symbol.ms);
    }
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
    console.info(`[latency] in-anchor file edit ms: ${fileMs.join(", ")} (median ${median(fileMs)}); in-anchor symbol edit ms: ${symbolMs.join(", ")} (median ${median(symbolMs)})`);
  });
});
