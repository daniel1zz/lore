/**
 * turn-review-harness.ts — test helpers shared by the stop-turn-review suites
 * (stop-turn-review.test.ts, stop-turn-review-drift-budget.test.ts, turn-start-snapshot.test.ts).
 * Everything runs in throwaway git repos + a throwaway session-state base; never this repo's
 * .lore and never ~/.claude. Side-effect class: IO (tmp dirs, subprocesses).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, makeGitRepo, makeTmpDir, runHook, type HookRun } from "./hook-harness";

export const STOP_HOOK = "stop-turn-review.mjs";

export interface TurnFixture {
  repo: string;
  base: string;
  sid: string;
}

/** A throwaway git repo + state base with one committed seed file; the turn is NOT started yet. */
export function makeFixture(sid: string, seed: Record<string, string> = { "README.txt": "seed\n" }): TurnFixture {
  const repo = makeGitRepo();
  for (const [rel, text] of Object.entries(seed)) writeRepoFile(repo, rel, text);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "seed");
  return { repo, base: makeTmpDir("turn-state-"), sid };
}

export function writeRepoFile(repo: string, rel: string, text: string): string {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return abs;
}

/** `n` distinct lines, so a diff counts exactly n added lines. */
export function numberedLines(n: number, tag = "line"): string {
  return Array.from({ length: n }, (_, i) => `${tag} ${i}\n`).join("");
}

export function startTurn(f: TurnFixture): HookRun {
  return runHook("user-prompt-turn-start.mjs", { session_id: f.sid, cwd: f.repo, hook_event_name: "UserPromptSubmit", prompt: "x" }, f.base);
}

/** The PostToolUse record an Edit/Write leaves; `agentId` set = made inside a subagent. */
export function markEdit(f: TurnFixture, absPath: string, agentId?: string): HookRun {
  const payload: Record<string, unknown> = { session_id: f.sid, cwd: f.repo, tool_name: "Edit", tool_input: { file_path: absPath } };
  if (agentId) { payload.agent_id = agentId; payload.agent_type = "lore-implementer"; }
  return runHook("post-edit-mark.mjs", payload, f.base);
}

export function stopTurn(f: TurnFixture, extra: Record<string, unknown> = {}): HookRun {
  return runHook(STOP_HOOK, { session_id: f.sid, cwd: f.repo, hook_event_name: "Stop", stop_hook_active: false, ...extra }, f.base);
}

/** Writes `.lore/config.yaml` (replacing it) carrying workflow.turn_end.main_session_source_edits. */
export function writeTurnEndSetting(repo: string, value: string): void {
  writeRepoFile(repo, ".lore/config.yaml", `project:\n  name: t\n  author: owner\nworkflow:\n  turn_end:\n    main_session_source_edits: ${value}\n`);
}

/** Appends a workflow block that switches the four service-layer gates off (placeholder spec content). */
export function disableGates(repo: string): void {
  appendFileSync(join(repo, ".lore", "config.yaml"), [
    "workflow:", "  gates:",
    "    spec-create:", "      enabled: false",
    "    spec-promote:", "      enabled: false",
    "    plan-promote:", "      enabled: false",
    "    task-claim:", "      enabled: false", "",
  ].join("\n"));
}

export function runLore(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("lore", args, { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** `lore init` + a spec anchoring `anchors`; returns the spec slug. */
export function initLoreWithAnchoredSpec(repo: string, anchors: string[]): string {
  const init = runLore(repo, ["init"]);
  if (init.status !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  disableGates(repo);
  const args = ["create", "spec", "--title", "Anchored fixture spec", "--kind", "feature", "--no-ai", "--content", "## Overview\n\nBody.", "--json"];
  for (const a of anchors) args.push("--code-anchor", a);
  const created = runLore(repo, args);
  if (created.status !== 0) throw new Error(`lore create spec failed: ${created.stderr}${created.stdout}`);
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

export interface StopBlock { decision: string; reason: string }
export function parseBlock(r: HookRun): StopBlock {
  return JSON.parse(r.stdout) as StopBlock;
}
