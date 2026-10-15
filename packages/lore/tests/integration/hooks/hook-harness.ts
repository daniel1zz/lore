/**
 * hook-harness.ts — test helper: runs the turn-state hooks as child processes against a
 * throwaway state base + throwaway git repo. Never touches ~/.claude or this repo's .lore.
 * Side-effect class: IO (tmp dirs, subprocesses).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOKS_DIR = resolve(__dirname, "../../../../../assets/hooks");

export interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function runHook(hook: string, payload: Record<string, unknown>, stateBase: string): HookRun {
  const r = spawnSync("node", [join(HOOKS_DIR, hook)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: stateBase },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function makeGitRepo(): string {
  const dir = makeTmpDir("turn-repo-");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  return dir;
}

export function currentTurnDir(stateBase: string, sessionId: string): string {
  const sessionDir = join(stateBase, "sessions", sessionId);
  const id = readFileSync(join(sessionDir, "current-turn.id"), "utf8").trim();
  return join(sessionDir, id);
}

export function readJsonl(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
