/**
 * AC-CRIT-8 — the SessionStart hook keeps its CONCATENATED additionalContext
 * under Claude Code's 10,000-char per-hook-output cap in a linked-worktree seat.
 *
 * Contract (spec-close-the-eight-verified-critical-defects-no-judge-listing F6):
 *   - total (seat briefing + bootstrap framing + fence + ...) >= 10000: the
 *     bootstrap fence is dropped WHOLE (SPEC-080 forbids clipping), the seat
 *     briefing is emitted byte-identical to its unbudgeted rendering, the
 *     existing `lore bootstrap` degradation entry is recorded, length < 10000;
 *   - total fits: the fence is present, unchanged, no degradation;
 *   - the seat briefing alone reaches the cap: emitted whole, a cap-exceeded
 *     degradation is recorded (never a cut).
 *
 * Runs the SHIPPED asset `assets/hooks/session-start-resume.mjs` (never
 * ~/.claude/hooks) as a node subprocess in a real linked git worktree under
 * mkdtemp, with a PATH-stubbed `lore` (deterministic payload sizes). State dirs
 * point at mkdtemp; the repo's own `.lore/` is never touched.
 *
 * @spec_ref AC-CRIT-8
 */

import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "session-start-resume.mjs");
const HOOK_CAP = 10_000;
const BRANCH = "worktree-agent-cap-fixture";
const ACTOR = "agent:worktree-agent-cap-fixture";
const FRAMING = "BOOTSTRAP-FRAMING-LINE-FIXTURE: the block below is this seat's own scope.";
const PER_TEST_TIMEOUT_MS = 60_000;

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** Main checkout with a `.lore/` marker plus a linked worktree on BRANCH. */
function makeWorktreeSeat(): { main: string; worktree: string } {
  const base = scratch("cap-repo-");
  const main = join(base, "main");
  mkdirSync(join(main, ".lore"), { recursive: true });
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "cap@example.invalid");
  git(main, "config", "user.name", "Cap Fixture");
  writeFileSync(join(main, "README.md"), "cap fixture\n");
  git(main, "add", "README.md");
  git(main, "commit", "-q", "-m", "init");
  const worktree = join(base, "wt");
  git(main, "worktree", "add", "-q", "-b", BRANCH, worktree);
  return { main, worktree: realpathSync(worktree) };
}

/** The seat-briefing template carries the placeholders the hook substitutes. */
function briefingTemplate(size: number): string {
  const head = "SEAT-BRIEFING {{ACTOR}} on {{BRANCH}} from {{MAIN_CHECKOUT}}\n";
  return head + "s".repeat(Math.max(0, size - head.length));
}

/** Independent rendering of the unbudgeted seat block (what the hook must emit untouched). */
function renderSeat(template: string, main: string): string {
  return template.split("{{ACTOR}}").join(ACTOR).split("{{BRANCH}}").join(BRANCH).split("{{MAIN_CHECKOUT}}").join(main);
}

function makeLoreStub(seatTemplate: string, payload: string): string {
  const dir = scratch("cap-stub-");
  writeFileSync(join(dir, "seat.txt"), seatTemplate);
  writeFileSync(join(dir, "payload.txt"), payload);
  writeFileSync(join(dir, "framing.txt"), FRAMING);
  const stub = join(dir, "lore");
  writeFileSync(
    stub,
    `#!/bin/bash
if [ "$1" = "governance" ] && [ "$2" = "--seat-briefing" ]; then cat "${join(dir, "seat.txt")}"; exit 0; fi
if [ "$1" = "governance" ] && [ "$2" = "bootstrap-framing" ]; then cat "${join(dir, "framing.txt")}"; exit 0; fi
if [ "$1" = "bootstrap" ]; then cat "${join(dir, "payload.txt")}"; exit 0; fi
exit 0
`,
  );
  chmodSync(stub, 0o755);
  return dir;
}

function runHook(seatSize: number, payload: string): { ctx: string; main: string; seat: string } {
  if (!existsSync(HOOK_PATH)) throw new Error(`shipped hook missing: ${HOOK_PATH}`);
  const { main, worktree } = makeWorktreeSeat();
  const template = briefingTemplate(seatSize);
  const stubDir = makeLoreStub(template, payload);
  const state = scratch("cap-state-");
  const claudeDir = scratch("cap-claude-");
  const r = spawnSync("node", [HOOK_PATH], {
    cwd: worktree,
    encoding: "utf8",
    timeout: 30_000,
    input: JSON.stringify({ session_id: "cap-fixture-session", hook_event_name: "SessionStart", source: "startup" }),
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      CLAUDE_STATE_BASE_OVERRIDE: state,
      CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      LORE_SETUP_NO_CHECK: "1",
    },
  });
  expect(r.status).toBe(0);
  const ctx = JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext ?? "";
  return { ctx, main: realpathSync(main), seat: renderSeat(template, realpathSync(main)) };
}

describe("AC-CRIT-8 SessionStart worktree seat: concatenated output under the 10,000-char hook cap", () => {
  it("total >= 10000: fence dropped whole, seat briefing byte-identical, bootstrap degradation recorded, length < 10000", () => {
    const payload = JSON.stringify({ scope_declaration: "x", filler: "p".repeat(4500) });
    const { ctx, seat } = runHook(6000, payload);

    // Precondition: the unbudgeted concatenation really is over the cap.
    expect(seat.length + FRAMING.length + payload.length).toBeGreaterThanOrEqual(HOOK_CAP);

    expect(ctx.length).toBeLessThan(HOOK_CAP);
    expect(ctx.startsWith(seat)).toBe(true); // seat briefing byte-identical, never cut
    expect(ctx).not.toContain("```json");
    expect(ctx).not.toContain(payload.slice(0, 40));
    expect(ctx).not.toContain(FRAMING);
    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("**lore bootstrap**");
    expect(ctx).toContain("dropped whole");
  }, PER_TEST_TIMEOUT_MS);

  it("total fits: the framing line and json fence are present unchanged, no degradation", () => {
    const payload = JSON.stringify({ scope_declaration: "x", filler: "p".repeat(1500) });
    const { ctx, seat } = runHook(3000, payload);

    expect(ctx.length).toBeLessThan(HOOK_CAP);
    expect(ctx).toBe(`${seat}\n\n${FRAMING}\n\n\`\`\`json\n${payload}\n\`\`\``);
    expect(ctx).not.toContain("Degradation Report");
  }, PER_TEST_TIMEOUT_MS);

  it("seat briefing alone >= 10000: emitted whole (never clipped) and a cap-exceeded degradation is recorded", () => {
    const payload = JSON.stringify({ scope_declaration: "x", filler: "p".repeat(500) });
    const { ctx, seat } = runHook(10_500, payload);

    expect(seat.length).toBeGreaterThanOrEqual(HOOK_CAP);
    expect(ctx.startsWith(seat)).toBe(true); // whole seat block, not one char cut
    expect(ctx).not.toContain("```json");
    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("**session-start output**");
    expect(ctx).toContain("never clipped");
  }, PER_TEST_TIMEOUT_MS);
});
