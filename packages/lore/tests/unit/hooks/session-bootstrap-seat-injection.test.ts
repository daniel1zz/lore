// @spawns assets/hooks/session-start-resume.mjs
/**
 * session-bootstrap-seat-injection.test.ts —
 * spec-session-start-injection-carries-only-the-session-s-own D2, D6, D11, D12;
 * AC-SI-3 (a)-(f).
 *
 * Phase E of `assets/hooks/session-start-resume.mjs` after the injection became
 * seat-only: `lore bootstrap --injection` exit 0 with EMPTY stdout means "this
 * seat has nothing to inject" — no fence, no framing line, no degradation entry,
 * and the governance `bootstrap-framing` spawn never happens. A linked-worktree
 * seat spawns `--seat-branch <branch> --seat-worktree <realpath of the
 * worktree's top level>` (both required together by the binary); the main
 * checkout passes neither.
 *
 * Every case runs the REAL checked-in hook as a `node` subprocess against
 * mkdtemp directories and a PATH-stubbed `lore` that logs its argv. Never the
 * repo's own `.lore/`.
 *
 * Coverage:
 *   HAPPY:      (a) empty stdout -> no fence/framing/degradation, framing not spawned;
 *               (b) non-empty -> framing line then json fence
 *   ERROR:      (c) non-zero exit still degrades
 *   BOUNDARY:   (d) over INJECTION_BACKSTOP_CAP drops the block with a degradation entry
 *   STATE:      (e) subdirectory of a linked worktree -> argv carries both seat flags
 *               equal to the realpath of the top level; main checkout carries neither
 *   NEGATIVE:   (f) hook source contains no 'hook-injected'
 *
 * @spec_ref AC-SI-3
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync, realpathSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { BOOTSTRAP_FRAMING_LINE } from "@lore/core";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "session-start-resume.mjs");

if (!existsSync(HOOK_PATH)) {
  throw new Error(`test fixture bug: resolved HOOK_PATH does not exist: ${HOOK_PATH}`);
}

const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf8");

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
  }
});

function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function initGitRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "seat-si@example.invalid"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Seat SI"], { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "seat-si fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, stdio: "pipe" });
}

interface StubOptions {
  /** stdout of `bootstrap` (omitted -> exit-0-and-empty shape). */
  bootstrapStdout?: string;
  bootstrapExitCode?: number;
  framingStdout?: string;
}

/** `lore` stub logging `<cwd>\t<argv>` for every invocation to the returned logPath. */
function makeLoreStub(opts: StubOptions = {}): { stubDir: string; logPath: string } {
  const { bootstrapStdout, bootstrapExitCode = 0, framingStdout } = opts;
  const stubDir = mkScratchDir("si-lore-stub-");
  const logPath = join(stubDir, "calls.log");
  let bootstrapEmit = "";
  if (bootstrapStdout !== undefined) {
    const f = join(stubDir, "bootstrap-stdout.txt");
    writeFileSync(f, bootstrapStdout);
    bootstrapEmit = `cat "${f}"`;
  }
  let framingEmit = "";
  if (framingStdout !== undefined) {
    const f = join(stubDir, "framing-stdout.txt");
    writeFileSync(f, framingStdout);
    framingEmit = `cat "${f}"`;
  }
  const stubPath = join(stubDir, "lore");
  writeFileSync(
    stubPath,
    `#!/bin/bash
printf '%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
if [ "$1" = "bootstrap" ]; then
  ${bootstrapEmit}
  exit ${bootstrapExitCode}
fi
if [ "$1" = "governance" ] && [ "$2" = "bootstrap-framing" ]; then
  ${framingEmit}
  exit 0
fi
exit 0
`,
  );
  chmodSync(stubPath, 0o755);
  return { stubDir, logPath };
}

function runHook(cwd: string, stubDir: string) {
  const stateBase = mkScratchDir("si-state-");
  const claudeDir = mkScratchDir("si-claude-dir-");
  return spawnSync("node", [HOOK_PATH], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: `si-test-${Math.random().toString(36).slice(2)}`,
      CLAUDE_STATE_BASE_OVERRIDE: stateBase,
      CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
    },
  });
}

function ctxOf(stdout: string): string {
  return JSON.parse(stdout)?.hookSpecificOutput?.additionalContext ?? "";
}

function loggedArgv(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("\t")[1] ?? "");
}

/** Plain (non-git) cwd with a `.lore` marker: main-checkout shape for Phase E. */
function mkLoreCwd(): string {
  const cwd = mkScratchDir("si-cwd-");
  mkdirSync(join(cwd, ".lore"));
  return cwd;
}

describe("session-bootstrap-seat-injection — HAPPY", () => {
  it("(a) exit 0 + empty stdout: no fence, no framing line, NO degradation entry, governance bootstrap-framing NOT spawned", () => {
    const cwd = mkLoreCwd();
    const { stubDir, logPath } = makeLoreStub({ framingStdout: BOOTSTRAP_FRAMING_LINE });

    const result = runHook(cwd, stubDir);

    expect(result.status).toBe(0);
    const ctx = ctxOf(result.stdout as string);
    expect(ctx).not.toContain("```");
    expect(ctx).not.toContain(BOOTSTRAP_FRAMING_LINE);
    expect(ctx).not.toContain("Degradation Report");
    expect(ctx).not.toContain("lore bootstrap");
    const argv = loggedArgv(logPath);
    expect(argv.some((a) => a.startsWith("bootstrap --injection"))).toBe(true);
    expect(argv.some((a) => a.startsWith("governance bootstrap-framing"))).toBe(false);
  });

  it("(b) non-empty payload: framing line, then the json fence (unchanged rendering)", () => {
    const cwd = mkLoreCwd();
    const payload = '{"scope_declaration":"x","seat_claims":[]}';
    const { stubDir } = makeLoreStub({ bootstrapStdout: payload, framingStdout: BOOTSTRAP_FRAMING_LINE });

    const result = runHook(cwd, stubDir);

    expect(result.status).toBe(0);
    const ctx = ctxOf(result.stdout as string);
    expect(ctx).toContain(`${BOOTSTRAP_FRAMING_LINE}\n\n\`\`\`json\n${payload}\n\`\`\``);
    expect(ctx).not.toContain("Degradation Report");
  });
});

describe("session-bootstrap-seat-injection — ERROR", () => {
  it("(c) non-zero exit still yields a 'lore bootstrap' degradation entry", () => {
    const cwd = mkLoreCwd();
    const { stubDir } = makeLoreStub({ bootstrapStdout: '{"ok":true}', bootstrapExitCode: 2 });

    const result = runHook(cwd, stubDir);

    expect(result.status).toBe(0);
    const ctx = ctxOf(result.stdout as string);
    expect(ctx).not.toContain("```");
    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("lore bootstrap failed (exit 2)");
  });
});

describe("session-bootstrap-seat-injection — BOUNDARY", () => {
  it("(d) payload over INJECTION_BACKSTOP_CAP drops the whole block with a degradation entry", () => {
    const cwd = mkLoreCwd();
    const oversized = "x".repeat(12005);
    const { stubDir } = makeLoreStub({ bootstrapStdout: oversized, framingStdout: BOOTSTRAP_FRAMING_LINE });

    const result = runHook(cwd, stubDir);

    expect(result.status).toBe(0);
    const ctx = ctxOf(result.stdout as string);
    expect(ctx).not.toContain("```");
    expect(ctx).not.toContain(BOOTSTRAP_FRAMING_LINE);
    expect(ctx).toContain("Degradation Report");
    expect(ctx).toContain("chars dropped whole: session-start output");
  });
});

describe("session-bootstrap-seat-injection — STATE (seat flags)", () => {
  it("(e) from a SUBDIRECTORY of a linked worktree the argv carries --seat-branch and --seat-worktree = realpath of the top level; the main checkout carries neither", () => {
    const mainRepo = mkScratchDir("si-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));
    const worktreeDir = join(mkScratchDir("si-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/seat-x", worktreeDir], { cwd: mainRepo, stdio: "pipe" });
    const sub = join(worktreeDir, "pkg", "deep");
    mkdirSync(sub, { recursive: true });
    const topLevelReal = realpathSync(
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: sub, encoding: "utf8" }).trim(),
    );

    const seat = makeLoreStub({ bootstrapStdout: '{"seat_claims":[]}' });
    expect(runHook(sub, seat.stubDir).status).toBe(0);
    const seatCall = loggedArgv(seat.logPath).find((a) => a.startsWith("bootstrap"));
    expect(seatCall).toBe(`bootstrap --injection --seat-branch feat/seat-x --seat-worktree ${topLevelReal}`);

    const main = makeLoreStub({ bootstrapStdout: '{"seat_claims":[]}' });
    expect(runHook(mainRepo, main.stubDir).status).toBe(0);
    const mainCall = loggedArgv(main.logPath).find((a) => a.startsWith("bootstrap"));
    expect(mainCall).toBe("bootstrap --injection");
  }, 60_000);
});

describe("session-bootstrap-seat-injection — NEGATIVE", () => {
  it("(f) the hook source no longer calls the bootstrap 'hook-injected'", () => {
    expect(HOOK_SOURCE).not.toMatch(/hook-injected/i);
  });
});
