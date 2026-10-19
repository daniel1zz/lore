// @spawns packages/lore/src/index.ts
// @spawns assets/hooks/pre-edit-anchor-gate.mjs
/**
 * Edit-time anchor gate (task-skill-design-implementers-declare-out-of-anchor-files): a helper's Write/Edit
 * outside the anchors of its claimed task is declared (`lore anchor declare`, the task-claim gate's overlap
 * predicate) or denied BEFORE it happens.
 *
 * Real hook process, real `lore` CLI (a PATH wrapper around `bun run packages/lore/src/index.ts`), a throwaway git
 * repo with its own `lore init` corpus and linked worktrees, two live claims held by two registered helper runs.
 * Never touches the repo's own `.lore/` or the real PATH `lore`.
 *
 * Coverage:
 *   AC-EAG-a HAPPY      an edit inside the anchors (dir anchor and file anchor) is allowed and writes nothing
 *   AC-EAG-b HAPPY      an edit to a free out-of-anchor path is allowed; the path is now an anchor (one version, the helper's run)
 *   AC-EAG-c NEGATIVE   a path anchored by the other live claim is denied naming that claim and task, exit 4 from lore; nothing written
 *   AC-EAG-d BOUNDARY  a git-ignored path is allowed and writes nothing
 *   AC-EAG-e NEGATIVE   no claim in the working copy -> denied naming `lore claim`
 *   AC-EAG-f ERROR      lore unavailable -> denied (fail-closed)
 *   REGRESSION          the main session (no agent_id) and a target outside the working copy are never governed
 *   STATE               declaring is idempotent: the second edit of the declared path writes nothing more
 *   AC-EAG-g HAPPY      claim writes <worktree>/.lore-scope.json (ignored, worktree stays clean); the hook decides in-anchor
 *                       and ignored paths from it with NO lore on PATH; declare / rm / release keep it current
 *   AC-EAG-h NEGATIVE   a missing, corrupt or other-schema scope file is never an allow: the hook asks lore (allow in-anchor),
 *                       and with lore unavailable denies; the scope file itself cannot be edited by a helper
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { sessionActorFor, sessionIdOfActor } from "../helpers/session-actor";
import { registerRun, runLore } from "./cli/support/claim-run-fixture.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const REPO_ROOT = resolve(__dirname, "../../../..");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-edit-anchor-gate.mjs");

const SESSION = "eag-sess";
const AGENT_A = "agentA";
const AGENT_B = "agentB";
const RUN_A = `cc:${SESSION}:${AGENT_A}`;
const RUN_B = `cc:${SESSION}:${AGENT_B}`;
const ACTOR_A = sessionActorFor("agent:eag-a");
const ACTOR_B = sessionActorFor("agent:eag-b");

interface Fixture {
  readonly base: string;
  readonly repo: string;
  readonly wtA: string;
  readonly wtB: string;
  readonly wtNone: string;
  readonly taskA: string;
  readonly taskB: string;
  readonly stateBase: string;
  readonly wrapperBin: string;
  readonly bareBin: string;
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

/** The binary named `lore` on the hook's PATH: this worktree's source, run under bun. */
function writeLoreWrapper(dir: string): void {
  const file = join(dir, "lore");
  // EAG_LORE_BIN: measure with the compiled binary (`bun run build` -> dist/lore) instead of the bun source entry.
  const compiled = process.env["EAG_LORE_BIN"];
  writeFileSync(file, `#!/bin/sh\nexec ${compiled !== undefined ? JSON.stringify(compiled) : `bun run ${JSON.stringify(ENTRY)}`} "$@"\n`);
  chmodSync(file, 0o755);
}

function which(name: string): string {
  return execFileSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).trim();
}

function buildFixture(): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "eag-")));
  const repo = join(base, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "eag@example.invalid");
  git(repo, "config", "user.name", "eag test");
  // `Library/` is what macOS tooling creates under the HOME the fixture CLI runs with (HOME = cwd). The scope file is
  // deliberately NOT listed: lore must make git ignore it itself (info/exclude).
  writeFileSync(join(repo, ".gitignore"), ".scratch/\nLibrary/\n");
  for (const f of ["src/a/a.ts", "src/b/b.ts", "shared/x.ts", "own/one.ts", "free/old.ts"]) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), "export const v = 1;\n");
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");

  mustLore(["init"], repo);
  // Pre-flight claim gates are not under test (the declare command runs the overlap predicate itself).
  patchLoreConfig(repo, ["workflow:", "  gates:", "    task-claim:", "      enabled: false", ""].join("\n"));
  const prd = slugOf(mustLore(["create", "prd", "--title", "EAG PRD", "--content", "root", "--no-ai"], repo));
  const plan = slugOf(mustLore(["create", "plan", "--title", "EAG Plan", "--parent", prd, "--content", "x", "--no-ai"], repo));
  const newTask = (title: string, anchors: string[]): string =>
    slugOf(
      mustLore(
        ["create", "task", "--title", title, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai", ...anchors.flatMap((a) => ["--anchor", a])],
        repo,
      ),
    );
  const taskA = newTask("EAG Task A", ["src/a/", "own/one.ts"]);
  const taskB = newTask("EAG Task B", ["src/b/", "shared/x.ts"]);

  const wtA = join(base, "wt-a");
  const wtB = join(base, "wt-b");
  const wtNone = join(base, "wt-none");
  git(repo, "worktree", "add", "-q", "-b", "eag-a", wtA);
  git(repo, "worktree", "add", "-q", "-b", "eag-b", wtB);
  git(repo, "worktree", "add", "-q", "-b", "eag-none", wtNone);

  registerRun(repo, RUN_A);
  registerRun(repo, RUN_B);
  mustLore(["claim", taskA, "--worktree", wtA], wtA, RUN_A, ACTOR_A);
  mustLore(["claim", taskB, "--worktree", wtB], wtB, RUN_B, ACTOR_B);

  const stateBase = join(base, "state");
  mkdirSync(stateBase);
  const wrapperBin = join(base, "bin-with-lore");
  mkdirSync(wrapperBin);
  writeLoreWrapper(wrapperBin);
  // A PATH holding only node and git: `lore` is genuinely unavailable (AC-EAG-f).
  const bareBin = join(base, "bin-bare");
  mkdirSync(bareBin);
  symlinkSync(which("node"), join(bareBin, "node"));
  symlinkSync(which("git"), join(bareBin, "git"));
  return { base, repo, wtA, wtB, wtNone, taskA, taskB, stateBase, wrapperBin, bareBin };
}

interface HookResult {
  readonly status: number | null;
  readonly stderr: string;
}

/** Runs the real hook as helper `agent` of the session, editing `target` from `cwd`. */
function runHook(opts: { cwd: string; target: string; agent?: string | null; actor?: string; tool?: string; path?: string }): HookResult {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const name of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_GATE_BYPASS"]) delete env[name];
  env["HOME"] = fx.base;
  env["CLAUDECODE"] = "1";
  env["CLAUDE_STATE_BASE_OVERRIDE"] = fx.stateBase;
  env["CLAUDE_CODE_SESSION_ID"] = sessionIdOfActor(opts.actor ?? ACTOR_A);
  env["PATH"] = opts.path ?? `${fx.wrapperBin}:${process.env["PATH"] ?? ""}`;
  const tool = opts.tool ?? "Edit";
  const payload: Record<string, unknown> = {
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd: opts.cwd,
    tool_name: tool,
    tool_input: { [tool === "NotebookEdit" ? "notebook_path" : "file_path"]: opts.target },
  };
  if (opts.agent !== null) payload["agent_id"] = opts.agent ?? AGENT_A;
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8", env });
  return { status: r.status, stderr: r.stderr };
}

interface TaskState {
  readonly version: number;
  readonly anchors: string[];
  readonly versionRows: number;
}

function taskState(slug: string): TaskState {
  const db = new Database(join(fx.repo, ".lore", "lore.db"), { readonly: true });
  try {
    const doc = db.query("SELECT id, version, extra FROM docs WHERE slug = ?").get(slug) as { id: string; version: number; extra: string } | null;
    if (doc === null) throw new Error(`no doc ${slug}`);
    const rows = db.query("SELECT COUNT(*) AS n FROM versions WHERE doc_id = ?").get(doc.id) as { n: number };
    const anchors = (JSON.parse(doc.extra) as { file_anchors?: string[] }).file_anchors ?? [];
    return { version: doc.version, anchors, versionRows: rows.n };
  } finally {
    db.close();
  }
}

/** The newest version row of `slug`, non-body columns. */
function latestVersionRow(slug: string): Record<string, unknown> {
  const db = new Database(join(fx.repo, ".lore", "lore.db"), { readonly: true });
  try {
    const doc = db.query("SELECT id FROM docs WHERE slug = ?").get(slug) as { id: string };
    const row = db.query("SELECT * FROM versions WHERE doc_id = ? ORDER BY version DESC LIMIT 1").get(doc.id) as Record<string, unknown>;
    const { extra: _extra, content: _content, ...columns } = row;
    return columns;
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

describe("edit-time anchor gate (task-skill-design-implementers-declare-out-of-anchor-files)", () => {
  it("AC-EAG-a: an edit inside the anchors (directory anchor, file anchor) is allowed and writes nothing", () => {
    const before = taskState(fx.taskA);
    const elapsedMs: number[] = [];
    for (const target of [join(fx.wtA, "src/a/a.ts"), join(fx.wtA, "src/a/deep/new.ts"), join(fx.wtA, "own/one.ts"), "src/a/a.ts"]) {
      const startedAt = performance.now();
      const r = runHook({ cwd: fx.wtA, target });
      elapsedMs.push(Math.round(performance.now() - startedAt));
      expect(r.status, `${target}: ${r.stderr}`).toBe(0);
      expect(r.stderr).toBe("");
    }
    // Measured latency of the in-anchor fast path (scope file + one `git check-ignore`, no lore process), reported not asserted.
    console.info(`[latency] in-anchor edit through the hook, ms per call: ${elapsedMs.join(", ")}`);
    expect(taskState(fx.taskA)).toEqual(before);
  });

  it("AC-EAG-b: an edit to a free out-of-anchor path is allowed and the path becomes an anchor (one version, the helper's run)", () => {
    const before = taskState(fx.taskA);
    const r = runHook({ cwd: fx.wtA, target: join(fx.wtA, "free/old.ts") });
    expect(r.status, r.stderr).toBe(0);
    const after = taskState(fx.taskA);
    expect(after.anchors).toContain("free/old.ts");
    expect(after.anchors).toEqual(expect.arrayContaining(before.anchors));
    expect(after.version).toBe(before.version + 1);
    expect(after.versionRows).toBe(before.versionRows + 1);
    const row = latestVersionRow(fx.taskA);
    expect(row["created_by"]).toBe(ACTOR_A);
    expect(JSON.stringify(row)).toContain(RUN_A);
  });

  it("AC-EAG-b (STATE): editing the declared path again writes nothing more", () => {
    const before = taskState(fx.taskA);
    expect(before.anchors).toContain("free/old.ts");
    const r = runHook({ cwd: fx.wtA, target: join(fx.wtA, "free/old.ts") });
    expect(r.status, r.stderr).toBe(0);
    expect(taskState(fx.taskA)).toEqual(before);
  });

  it("AC-EAG-c: a path anchored by the other live claim is denied, naming that claim and task; nothing is written", () => {
    const beforeA = taskState(fx.taskA);
    const beforeB = taskState(fx.taskB);
    const r = runHook({ cwd: fx.wtA, target: join(fx.wtA, "shared/x.ts") });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(fx.taskB);
    expect(r.stderr).toContain("exit 4");
    expect(r.stderr).toContain("shared/x.ts");
    expect(taskState(fx.taskA)).toEqual(beforeA);
    expect(taskState(fx.taskB)).toEqual(beforeB);
  });

  it("AC-EAG-c: `lore anchor declare` itself exits 4 naming the holding task and writes nothing (the verb the hook calls)", () => {
    const before = taskState(fx.taskA);
    const r = runLore(["anchor", "declare", fx.taskA, "shared/x.ts", "--worktree", fx.wtA], fx.wtA, RUN_A, ACTOR_A);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain(fx.taskB);
    expect(taskState(fx.taskA)).toEqual(before);
  });

  it("AC-EAG-d: a git-ignored path is allowed and writes nothing", () => {
    const before = taskState(fx.taskA);
    const r = runHook({ cwd: fx.wtA, target: join(fx.wtA, ".scratch/notes.md") });
    expect(r.status, r.stderr).toBe(0);
    expect(taskState(fx.taskA)).toEqual(before);
  });

  it("AC-EAG-e: no open claim in the working copy -> denied, naming `lore claim`", () => {
    const r = runHook({ cwd: fx.wtNone, target: join(fx.wtNone, "src/a/a.ts"), agent: "agentNone" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("lore claim");
  });

  it("AC-EAG-f: lore unavailable -> denied with the reason (fail-closed), nothing written", () => {
    const before = taskState(fx.taskA);
    const r = runHook({ cwd: fx.wtA, target: join(fx.wtA, "free/other.ts"), path: fx.bareBin });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/lore/);
    expect(r.stderr).toMatch(/could not run|ENOENT/);
    expect(taskState(fx.taskA)).toEqual(before);
  });

  it("REGRESSION: the main session (no agent_id) is never governed, even for another claim's path", () => {
    const r = runHook({ cwd: fx.wtA, target: join(fx.wtA, "shared/x.ts"), agent: null });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("REGRESSION: a target outside the helper's working copy is not this hook's concern; NotebookEdit and Write are governed like Edit", () => {
    expect(runHook({ cwd: fx.wtA, target: join(fx.base, "elsewhere.txt") }).status).toBe(0);
    expect(runHook({ cwd: fx.wtA, target: join(fx.wtA, "shared/x.ts"), tool: "Write" }).status).toBe(2);
    expect(runHook({ cwd: fx.wtA, target: join(fx.wtA, "shared/x.ts"), tool: "NotebookEdit" }).status).toBe(2);
  }, 120_000);

  it("AC-EAG-c (symmetry): helper B is denied helper A's declared path, naming task A", () => {
    const r = runHook({ cwd: fx.wtB, target: join(fx.wtB, "free/old.ts"), agent: AGENT_B, actor: ACTOR_B });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain(fx.taskA);
  });

  describe("scope file (AC-EAG-g, AC-EAG-h)", () => {
    const scopeFileOf = (wt: string): string => join(wt, ".lore-scope.json");
    const readScope = (wt: string): { schema: number; claims: { task: string; anchors: string[]; holder_run: string | null }[] } =>
      JSON.parse(readFileSync(scopeFileOf(wt), "utf8")) as never;
    const asB = (target: string, path?: string): HookResult =>
      runHook({ cwd: fx.wtB, target, agent: AGENT_B, actor: ACTOR_B, ...(path !== undefined ? { path } : {}) });

    it("AC-EAG-g: `lore claim` wrote the file in the claiming worktree, git ignores it and the worktree is clean", () => {
      const scope = readScope(fx.wtA);
      expect(scope.schema).toBe(1);
      expect(scope.claims.map((c) => c.task)).toEqual([fx.taskA]);
      expect(scope.claims[0]!.holder_run).toBe(RUN_A);
      expect(scope.claims[0]!.anchors).toEqual(expect.arrayContaining(["src/a/", "own/one.ts"]));
      expect(git(fx.wtA, "check-ignore", "-q", ".lore-scope.json")).toBe("");
      expect(git(fx.wtA, "status", "--porcelain")).toBe("");
    });

    it("AC-EAG-g: in-anchor and git-ignored paths are decided from the file with NO lore on PATH", () => {
      for (const target of [join(fx.wtA, "src/a/a.ts"), join(fx.wtA, "own/one.ts"), join(fx.wtA, ".scratch/x.md")]) {
        const r = runHook({ cwd: fx.wtA, target, path: fx.bareBin });
        expect(r.status, `${target}: ${r.stderr}`).toBe(0);
      }
      // an out-of-anchor path still needs lore: unavailable -> denied
      expect(runHook({ cwd: fx.wtA, target: join(fx.wtA, "free/never.ts"), path: fx.bareBin }).status).toBe(2);
    });

    it("AC-EAG-g: the file lists the path declared in AC-EAG-b, so the declared path is also decided without lore", () => {
      expect(readScope(fx.wtA).claims[0]!.anchors).toContain("free/old.ts");
      expect(runHook({ cwd: fx.wtA, target: join(fx.wtA, "free/old.ts"), path: fx.bareBin }).status).toBe(0);
    });

    it("AC-EAG-g: `lore anchor rm` removes the path from the file at once (a removed path is not allowed from a stale file)", () => {
      const rm = runLore(["anchor", "rm", fx.taskA, "free/old.ts"], fx.wtA, RUN_A, ACTOR_A);
      expect(rm.exitCode, rm.stderr).toBe(0);
      expect(readScope(fx.wtA).claims[0]!.anchors).not.toContain("free/old.ts");
      expect(runHook({ cwd: fx.wtA, target: join(fx.wtA, "free/old.ts"), path: fx.bareBin }).status).toBe(2);
    }, 120_000);

    it("AC-EAG-h: a missing scope file (claim made before the file existed) falls back to the lore read: in-anchor allowed, no lore -> denied", () => {
      const aside = `${scopeFileOf(fx.wtB)}.aside`;
      renameSync(scopeFileOf(fx.wtB), aside);
      try {
        const startedAt = performance.now();
        expect(asB(join(fx.wtB, "src/b/b.ts")).status).toBe(0);
        console.info(`[latency] in-anchor edit with NO scope file (lore anchor scope fallback), ms: ${Math.round(performance.now() - startedAt)}`);
        const noLore = asB(join(fx.wtB, "src/b/b.ts"), fx.bareBin);
        expect(noLore.status).toBe(2);
        expect(noLore.stderr).toMatch(/lore/);
      } finally {
        renameSync(aside, scopeFileOf(fx.wtB));
      }
    }, 120_000);

    it("AC-EAG-h: a corrupt, other-schema or foreign-copy scope file is not trusted: the lore read decides, and without lore the edit is denied", () => {
      const good = readFileSync(scopeFileOf(fx.wtB), "utf8");
      try {
        for (const bad of ["{not json", JSON.stringify({ ...JSON.parse(good), schema: 99 }), JSON.stringify({ ...JSON.parse(good), working_copy: fx.wtA })]) {
          writeFileSync(scopeFileOf(fx.wtB), bad);
          expect(asB(join(fx.wtB, "src/b/b.ts")).status, bad).toBe(0);
          expect(asB(join(fx.wtB, "src/b/b.ts"), fx.bareBin).status, bad).toBe(2);
        }
      } finally {
        writeFileSync(scopeFileOf(fx.wtB), good);
      }
    }, 120_000);

    it("AC-EAG-h: a helper cannot edit the scope file (git ignores it, so it would otherwise pass as ignored)", () => {
      const before = readFileSync(scopeFileOf(fx.wtA), "utf8");
      const r = runHook({ cwd: fx.wtA, target: scopeFileOf(fx.wtA) });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(".lore-scope.json");
      expect(readFileSync(scopeFileOf(fx.wtA), "utf8")).toBe(before);
    });

    it("AC-EAG-g (STATE): `lore release` of the last claim deletes the file (derived state, see scope-file-cleanup); the hook then denies naming `lore claim`", () => {
      expect(existsSync(scopeFileOf(fx.wtB))).toBe(true);
      const released = runLore(["release", fx.taskB], fx.wtB, RUN_B, ACTOR_B);
      expect(released.exitCode, released.stderr).toBe(0);
      expect(existsSync(scopeFileOf(fx.wtB))).toBe(false);
      const r = asB(join(fx.wtB, "src/b/b.ts"));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("lore claim");
    }, 120_000);
  });
});
