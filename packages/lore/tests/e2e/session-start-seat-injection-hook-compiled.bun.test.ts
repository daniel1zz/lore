// @spawns assets/hooks/session-start-resume.mjs
// @spawns dist/lore
/**
 * @spec_ref spec-session-start-injection-carries-only-the-session-s-own — AC-SI-12.
 *
 * Live wiring, hook -> binary -> seatClaims: the REAL `assets/hooks/session-start-resume.mjs`
 * run with the compiled `dist/lore` on PATH, inside a throwaway git repo that has a
 * linked worktree and a `mkdtemp` + `lore init` corpus.
 *   - a task claimed with `--worktree <linked worktree ABSOLUTE PATH>`; the hook run from a
 *     SUBDIRECTORY of that worktree emits a bootstrap json fence whose seat_claims names the task
 *   - the same hook run in the main checkout emits no fence and no degradation entry
 *
 * Never touches the repo's own `.lore/`. Run `bun run build` first; `assertFreshBinary`
 * fails loud on a stale `dist/lore`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "session-start-resume.mjs");

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function runLore(args: string[], cwd: string, home: string): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd, env: { ...process.env, HOME: home, CLAUDECODE: "1" } });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string, home: string): string {
  const r = runLore(args, cwd, home);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}`);
  return r.stdout;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
}

function runHook(cwd: string, binDir: string, scratch: string): string {
  const proc = Bun.spawnSync(["node", HOOK_PATH], {
    cwd,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: scratch,
      CLAUDE_SESSION_ID: "si-e2e-session",
      CLAUDE_STATE_BASE_OVERRIDE: join(scratch, "state"),
      CLAUDE_AGENTS_DIR_OVERRIDE: join(scratch, "claude", "agents"),
      LORE_SETUP_NO_CHECK: "1",
    },
  });
  expect(proc.exitCode).toBe(0);
  const parsed = JSON.parse(proc.stdout.toString()) as { hookSpecificOutput?: { additionalContext?: string } };
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

describe("AC-SI-12: real session-start hook -> compiled dist/lore -> seat claims", () => {
  let scratch: string;
  let mainRepo: string;
  let worktree: string;
  let subdir: string;
  let binDir: string;
  let taskSlug: string;

  beforeAll(() => {
    assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "lore-si-hook-e2e-")));
    expect(scratch.startsWith(REPO_ROOT)).toBe(false);

    binDir = join(scratch, "bin");
    mkdirSync(binDir);
    symlinkSync(LORE_BIN, join(binDir, "lore"));

    mainRepo = join(scratch, "main");
    mkdirSync(mainRepo);
    git(["init", "-q", "-b", "main"], mainRepo);
    git(["config", "user.email", "si-e2e@example.invalid"], mainRepo);
    git(["config", "user.name", "SI E2E"], mainRepo);
    writeFileSync(join(mainRepo, "README.md"), "si e2e\n");
    git(["add", "."], mainRepo);
    git(["commit", "-q", "-m", "init"], mainRepo);

    mustRun(["init"], mainRepo, scratch);
    const prd = parseSlug(mustRun(["create", "prd", "--title", "Seat PRD", "--content", "r", "--no-ai"], mainRepo, scratch));
    const plan = parseSlug(
      mustRun(["create", "plan", "--title", "Seat Plan", "--parent", prd, "--content", "x", "--no-ai"], mainRepo, scratch),
    );
    taskSlug = parseSlug(
      mustRun(
        ["create", "task", "--title", "Seat hook task", "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"],
        mainRepo,
        scratch,
      ),
    );

    worktree = join(scratch, "linked-wt");
    git(["worktree", "add", "-q", "-b", "feat/si-hook", worktree], mainRepo);
    mustRun(["claim", taskSlug, "--worktree", worktree], mainRepo, scratch);

    subdir = join(worktree, "pkg", "deep");
    mkdirSync(subdir, { recursive: true });
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("from a subdirectory of the linked worktree: a json fence whose seat_claims names the claimed task", () => {
    const ctx = runHook(subdir, binDir, scratch);
    const fence = ctx.match(/```json\n([\s\S]*?)\n```/);
    expect(fence).not.toBeNull();
    const payload = JSON.parse(fence![1]!) as { seat_claims: Array<{ task_slug: string }> };
    expect(payload.seat_claims.map((c) => c.task_slug)).toEqual([taskSlug]);
    expect(ctx).not.toContain("Degradation Report");
  });

  it("from the main checkout: no bootstrap fence and no degradation entry", () => {
    const ctx = runHook(mainRepo, binDir, scratch);
    expect(ctx).not.toContain("```json");
    expect(ctx).not.toContain("Degradation Report");
    expect(ctx).not.toContain("lore bootstrap");
  });
});
