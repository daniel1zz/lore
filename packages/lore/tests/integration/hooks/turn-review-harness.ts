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

/**
 * Runs the Stop hook and removes the shared-checkout finding (BR-1349) from its block.
 *
 * reason: the suites using this helper test the OTHER findings (source edits, anchor drift, CLAUDE.md budget) and
 * leave their edits uncommitted in the fixture repo, which the shared-checkout check rightly reports. Dropping that
 * one finding keeps each suite about its own subject; the check itself is covered by
 * `dj-turn-end-no-helper-review.bun.test.ts`, which spawns the hook directly. A block with no other finding left
 * becomes the empty stdout the hook prints when nothing is wrong.
 */
export function stopTurn(f: TurnFixture, extra: Record<string, unknown> = {}): HookRun {
  const run = runHook(STOP_HOOK, { session_id: f.sid, cwd: f.repo, hook_event_name: "Stop", stop_hook_active: false, ...extra }, f.base);
  return { ...run, stdout: withoutSharedCheckoutFinding(run.stdout) };
}

function withoutSharedCheckoutFinding(stdout: string): string {
  if (stdout === "") return stdout;
  const parsed = JSON.parse(stdout) as { decision?: string; reason?: string };
  if (parsed.decision !== "block" || typeof parsed.reason !== "string") return stdout;
  const lines = parsed.reason.split("\n");
  const first = lines.findIndex((l) => /^\d+\. /.test(l));
  const tail = lines.findIndex((l, i) => i > first && (l === "" && lines[i + 1]?.startsWith("Not measured:") || l === "</turn-end-review>"));
  const sections: string[][] = [];
  for (const line of lines.slice(first, tail)) {
    if (/^\d+\. /.test(line)) sections.push([line]);
    else sections[sections.length - 1]!.push(line);
  }
  const kept = sections.filter((section) => !section[0]!.includes("Shared checkout has "));
  if (kept.length === sections.length) return stdout;
  if (kept.length === 0) {
    // reason: with the shared-checkout finding gone the hook would have printed no block; its source-edit
    // not-measured reasons then reach the user as a systemMessage, which is rebuilt from the block's own
    // "Not measured:" line.
    const notMeasured = lines.find((l) => l.startsWith("Not measured:")) ?? "";
    const notes = notMeasured.slice("Not measured:".length).split("; ").map((r) => r.trim()).filter((r) => r.startsWith("source-edit finding not measured"));
    return notes.length === 0 ? "" : JSON.stringify({ systemMessage: notes.map((r) => `Turn-end review: ${r}; no verdict.`).join("\n") });
  }
  const renumbered = kept.map((section, i) => [section[0]!.replace(/^\d+\./, `${i + 1}.`), ...section.slice(1)].join("\n"));
  const rebuilt = [
    "<turn-end-review>",
    `Turn-end review: ${kept.length} finding${kept.length === 1 ? "" : "s"}. Resolve ${kept.length === 1 ? "it" : "all of them"}, then finish.`,
    "",
    ...renumbered,
    ...lines.slice(tail),
  ].join("\n");
  return JSON.stringify({ decision: "block", reason: rebuilt });
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
