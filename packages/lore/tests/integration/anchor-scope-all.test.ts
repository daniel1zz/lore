// @spawns packages/lore/src/index.ts
/**
 * `lore anchor scope --all` (spec-a-helper-s-shell-write-whose-target-cannot-be-read-is, BR-1493).
 *
 * Real CLI, throwaway git repo with its own `lore init` corpus and two linked worktrees; two claims are recorded for
 * two DIFFERENT working copies. Never touches the repo's own `.lore/`.
 *
 *   AC-USW-3 HAPPY       --all lists both claims with task, anchors, holder run and working copy
 *   AC-USW-3 NEGATIVE    without --all the output lists only the named working copy; neither --all nor --worktree is refused
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { sessionActorFor } from "../helpers/session-actor";
import { registerRun, runLore } from "./cli/support/claim-run-fixture.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const RUN_A = "cc:usw3-sess:agentA";
const RUN_B = "cc:usw3-sess:agentB";
const ACTOR_A = sessionActorFor("agent:usw3-a");
const ACTOR_B = sessionActorFor("agent:usw3-b");

let base: string;
let repo: string;
let wtA: string;
let wtB: string;
let taskA: string;
let taskB: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function mustLore(args: string[], cwd: string, run?: string, actor?: string): string {
  const r = runLore(args, cwd, run, actor);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface ScopeData {
  working_copy: string | null;
  claims: { task: string; anchors: string[]; holder_run: string | null; working_copy?: string | null }[];
  not_measured: string[];
}

function scopeJson(args: string[]): ScopeData {
  return (JSON.parse(mustLore(["anchor", "scope", ...args, "--json"], repo, RUN_B, ACTOR_B)) as { data: ScopeData }).data;
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "usw3-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "usw3@example.invalid");
  git(repo, "config", "user.name", "usw3 test");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  mustLore(["init"], repo);
  patchLoreConfig(repo, ["workflow:", "  gates:", "    task-claim:", "      enabled: false", ""].join("\n"));
  const prd = slugOf(mustLore(["create", "prd", "--title", "USW3 PRD", "--content", "root", "--no-ai"], repo));
  const plan = slugOf(mustLore(["create", "plan", "--title", "USW3 Plan", "--parent", prd, "--content", "x", "--no-ai"], repo));
  const newTask = (title: string, anchor: string): string =>
    slugOf(mustLore(["create", "task", "--title", title, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai", "--anchor", anchor], repo));
  taskA = newTask("USW3 Task A", "src/a.ts");
  taskB = newTask("USW3 Task B", "src/b.ts");
  wtA = join(base, "wt-a");
  wtB = join(base, "wt-b");
  git(repo, "worktree", "add", "-q", "-b", "usw3-a", wtA);
  git(repo, "worktree", "add", "-q", "-b", "usw3-b", wtB);
  registerRun(repo, RUN_A);
  registerRun(repo, RUN_B);
  mustLore(["claim", taskA, "--worktree", wtA], wtA, RUN_A, ACTOR_A);
  mustLore(["claim", taskB, "--worktree", wtB], wtB, RUN_B, ACTOR_B);
});

afterAll(() => {
  if (base !== undefined) rmSync(base, { recursive: true, force: true });
});

describe("lore anchor scope --all", () => {
  it("AC-USW-3: --all lists the claims of two different working copies with task, anchors, holder run and working copy", () => {
    const data = scopeJson(["--all"]);
    const a = data.claims.find((c) => c.task === taskA);
    const b = data.claims.find((c) => c.task === taskB);
    expect(a?.anchors).toEqual(["src/a.ts"]);
    expect(a?.holder_run).toBe(RUN_A);
    expect(a?.working_copy).toBe(wtA);
    expect(b?.anchors).toEqual(["src/b.ts"]);
    expect(b?.holder_run).toBe(RUN_B);
    expect(b?.working_copy).toBe(wtB);
  });

  it("AC-USW-3 (NEGATIVE): --all together with --worktree is refused as conflicting (exit 2)", () => {
    const refused = runLore(["anchor", "scope", "--all", "--worktree", wtB, "--json"], repo, RUN_B, ACTOR_B);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("--all");
    expect(refused.stderr).toContain("--worktree");
  });

  it("AC-USW-3 (NEGATIVE): without --all only the named working copy's claim is listed; neither flag is refused", () => {
    const data = scopeJson(["--worktree", wtB]);
    expect(data.claims.map((c) => c.task)).toEqual([taskB]);
    const refused = runLore(["anchor", "scope", "--json"], repo, RUN_B, ACTOR_B);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("--worktree");
  });
});
