/**
 * session-start-freshness.test.ts — SPEC-076 §C6 / AC-076-7.
 *
 * Behavioral test for the SessionStart hook's Phase F cache-first
 * asset-freshness advisory (`assets/hooks/session-start-resume.mjs`). Every
 * case spawns the REAL checked-in hook file as a `node` subprocess against
 * throwaway mkdtemp directories + a PATH-stubbed `lore` binary — never the
 * repo's own working tree or its live `.lore/` corpus (CLAUDE.md's "never
 * write to the repo's own .lore/ from tests" rule; mirrors
 * `session-seat-injection.test.ts`'s established fixture pattern).
 *
 * Every fixture cwd is deliberately a PLAIN directory (no `.git`, no
 * `.lore/`) unless a test explicitly needs Phase C/D/E behavior (the
 * REGRESSION case below) — this isolates Phase F's own child-process count
 * from Phase D's unconditional `git rev-parse` probes and Phase E's
 * `.lore/`-gated `lore bootstrap` spawn, so "0 lore invocations logged"
 * unambiguously proves Phase F itself spawned nothing.
 *
 * Coverage:
 *   HAPPY:      fresh (<24h) cache with status="sync" → 0 advisory bytes,
 *               0 `lore` child processes
 *   NEGATIVE:   fresh cache with status="stale" → EXACTLY ONE advisory line;
 *               LORE_SETUP_NO_CHECK=1 suppresses the advisory (and the
 *               background refresh) regardless of cache state, including
 *               when the cache is entirely absent
 *   BOUNDARY:   missing cache → hook exits without waiting (<100ms) while a
 *               REAL detached child process (R2 oracle — a genuine OS
 *               subprocess spawn, not a mocked call) refreshes the cache in
 *               the background; an on-disk-but-EXPIRED (>24h) cache is
 *               treated identically to a missing one
 *   ERROR:      corrupted cache JSON → silence (no advisory), no crash,
 *               exit 0
 *   STATE:      a stale cache with NO `stale_counts` field still renders a
 *               single valid advisory line (optional-field fallback); a
 *               missing→refreshed→sync cache is OBSERVABLE by a second hook
 *               invocation (the state actually changed on disk between runs)
 *   REGRESSION: the advisory composes AFTER the pre-existing bootstrap block
 *               (Phase F never reorders earlier phases) when both fire in
 *               the same session
 *
 * SPEC-076 T8b addition (`setup.check_reminder` config-knob wiring, see
 * `reminder_enabled` cases below):
 *   NEGATIVE:   a fresh stale cache with `reminder_enabled: false` (written
 *               by `setup-check.ts::resolveCheckReminderEnabled` when the
 *               team's `setup.check_reminder` config resolves to false)
 *               injects 0 advisory bytes and spawns 0 `lore` child processes
 *               — same silence as the pre-existing sync-cache HAPPY case,
 *               but for a STALE cache under the config-suppressed path.
 *   STATE:      a fresh stale cache with `reminder_enabled: true` (explicit,
 *               present) renders the advisory identically to an ABSENT
 *               field — proves the hook's `!== false` check treats explicit
 *               `true` and omission the same way (fail-open is about the
 *               VALUE `false`, not mere field presence).
 *
 * @spec_ref AC-076-7
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// packages/lore/tests/unit/hooks/session-start-freshness.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "session-start-resume.mjs");

if (!existsSync(HOOK_PATH)) {
  throw new Error(`test fixture bug: resolved HOOK_PATH does not exist: ${HOOK_PATH}`);
}

/** Must stay byte-identical to the hook's own `SETUP_CHECK_CACHE_FILENAME` literal (SPEC-076 §C6). */
const CACHE_FILENAME = ".lore-setup-check.json";

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

/**
 * Writes an executable `lore` stub that logs every invocation (one line per
 * call, full argv) and, on `setup --check ... --claude-dir <dir>`, writes a
 * fresh `status:"sync"` cache file into that dir — this IS the R2
 * real-subprocess refresh oracle: a genuine child process, not a mocked
 * `spawn` call, produces the observable side effect.
 */
function makeLoreStub(logPath: string): string {
  const stubDir = mkScratchDir("freshness-lore-stub-");
  const stubPath = join(stubDir, "lore");
  writeFileSync(
    stubPath,
    `#!/bin/bash
printf '%s\\n' "$*" >> "${logPath}"
if [ "$1" = "setup" ] && [ "$2" = "--check" ]; then
  dir=""
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--claude-dir" ]; then dir="$arg"; fi
    prev="$arg"
  done
  cat > "$dir/${CACHE_FILENAME}" <<JSON
{"checked_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","binary_version":"9.9.9-stub","status":"sync"}
JSON
  echo '{"ok":true,"data":{"summary":"sync"}}'
  exit 0
fi
if [ "$1" = "bootstrap" ]; then
  echo '{"ok":true,"data":{"stub":true}}'
fi
exit 0
`,
  );
  chmodSync(stubPath, 0o755);
  return stubDir;
}

interface RunOpts {
  cwd: string;
  extraEnv?: Record<string, string>;
}

interface RunResult {
  result: ReturnType<typeof spawnSync>;
  elapsedMs: number;
}

function runHook({ cwd, extraEnv = {} }: RunOpts): RunResult {
  const stateBase = mkScratchDir("freshness-state-");
  const t0 = performance.now();
  const result = spawnSync("node", [HOOK_PATH], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      CLAUDE_SESSION_ID: `freshness-test-${Math.random().toString(36).slice(2)}`,
      CLAUDE_STATE_BASE_OVERRIDE: stateBase,
      ...extraEnv,
    },
  });
  const elapsedMs = performance.now() - t0;
  return { result, elapsedMs };
}

function parseAdditionalContext(stdout: string): string {
  const parsed = JSON.parse(stdout);
  return parsed?.hookSpecificOutput?.additionalContext ?? "";
}

function readLogLines(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").split("\n").filter((l) => l.length > 0);
}

function isoMinusMs(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function writeCache(cachePath: string, cache: Record<string, unknown>): void {
  writeFileSync(cachePath, JSON.stringify(cache));
}

/** Synchronous sleep (main-thread `Atomics.wait` is permitted in Node, unlike browsers) — used ONLY to poll for a real detached child's on-disk output, bounded by each caller's own deadline. */
function sleepSyncMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Polls `cachePath` until it exists AND parses as JSON, returning the parsed
 * value. A bare `existsSync` check races with the REAL detached child's
 * write (the stub's `cat > file <<HEREDOC` truncates the file before its
 * content lands) — this waits for a genuinely complete write instead of
 * treating file-creation as file-completion. Bounded by `timeoutMs`; a
 * timeout is a real test failure (thrown), never a silently-passed check.
 */
function pollForValidCacheJson(cachePath: string, timeoutMs = 5000): unknown {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(cachePath)) {
      try {
        return JSON.parse(readFileSync(cachePath, "utf8"));
      } catch {
        // Still mid-write — keep polling rather than failing on a partial read.
      }
    }
    sleepSyncMs(25);
  }
  throw new Error(`pollForValidCacheJson: timed out waiting for valid JSON at ${cachePath}`);
}

/** Plain (non-git, no .lore/) cwd + claude-dir + logging `lore` stub — the shared shape every Phase F test needs. */
function setupFixture(): {
  cwd: string;
  claudeDir: string;
  cachePath: string;
  logPath: string;
  stubDir: string;
} {
  const cwd = mkScratchDir("freshness-cwd-");
  const claudeDir = mkScratchDir("freshness-claude-dir-");
  const logPath = join(mkScratchDir("freshness-log-"), "lore-calls.log");
  const stubDir = makeLoreStub(logPath);
  return { cwd, claudeDir, cachePath: join(claudeDir, CACHE_FILENAME), logPath, stubDir };
}

// ─── HAPPY — fresh + sync → silent, zero spawns ───────────────────────────────

describe("session-start-freshness — HAPPY", () => {
  it("fresh (<24h) cache with status=sync injects 0 advisory bytes and spawns 0 lore child processes", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    writeCache(cachePath, { checked_at: isoMinusMs(60_000), binary_version: "1.2.3", status: "sync" });

    const { result } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    expect(parseAdditionalContext(result.stdout as string)).toBe("");
    expect(readLogLines(logPath)).toHaveLength(0);
  });
});

// ─── NEGATIVE — stale advisory + hard kill-switch ─────────────────────────────

describe("session-start-freshness — NEGATIVE", () => {
  it("fresh cache with status=stale injects EXACTLY ONE advisory line naming `lore setup`, and spawns 0 lore child processes", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    writeCache(cachePath, {
      checked_at: isoMinusMs(60_000),
      binary_version: "1.2.3",
      status: "stale",
      stale_counts: { outdated: 2, diverged: 1, missing: 0 },
    });

    const { result } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    const lines = ctx.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("⚠ lore assets outdated");
    expect(lines[0]).toContain("lore setup");
    expect(readLogLines(logPath)).toHaveLength(0);
  });

  it("LORE_SETUP_NO_CHECK=1 suppresses the advisory AND the background refresh even with a fresh stale cache present", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    writeCache(cachePath, { checked_at: isoMinusMs(60_000), binary_version: "1.2.3", status: "stale" });

    const { result } = runHook({
      cwd,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
        LORE_SETUP_NO_CHECK: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(parseAdditionalContext(result.stdout as string)).toBe("");
    expect(readLogLines(logPath)).toHaveLength(0);
  });

  it("LORE_SETUP_NO_CHECK=1 also suppresses the background refresh when the cache is entirely missing", () => {
    const { cwd, claudeDir, logPath, stubDir } = setupFixture();
    // No cache file written at all.

    const { result } = runHook({
      cwd,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
        LORE_SETUP_NO_CHECK: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(parseAdditionalContext(result.stdout as string)).toBe("");
    expect(readLogLines(logPath)).toHaveLength(0);
  });
});

// ─── reminder_enabled (SPEC-076 T8b) — config-knob suppression + fail-open ────

describe("session-start-freshness — reminder_enabled (SPEC-076 T8b)", () => {
  it("NEGATIVE: fresh stale cache with reminder_enabled:false injects 0 advisory bytes and spawns 0 lore child processes", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    writeCache(cachePath, {
      checked_at: isoMinusMs(60_000),
      binary_version: "1.2.3",
      status: "stale",
      stale_counts: { outdated: 2, diverged: 1, missing: 0 },
      reminder_enabled: false,
    });

    const { result } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    expect(parseAdditionalContext(result.stdout as string)).toBe("");
    expect(readLogLines(logPath)).toHaveLength(0);
  });

  it("STATE: fresh stale cache with reminder_enabled:true renders the advisory identically to an absent field", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    writeCache(cachePath, {
      checked_at: isoMinusMs(60_000),
      binary_version: "1.2.3",
      status: "stale",
      stale_counts: { outdated: 2, diverged: 1, missing: 0 },
      reminder_enabled: true,
    });

    const { result } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    const lines = ctx.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("⚠ lore assets outdated");
    expect(lines[0]).toContain("lore setup");
    expect(readLogLines(logPath)).toHaveLength(0);
  });
});

// ─── BOUNDARY — non-blocking exit + real detached refresh (R2 oracle) ─────────

describe("session-start-freshness — BOUNDARY (R2 real-subprocess oracle)", () => {
  it("missing cache: hook exits without waiting (<100ms), a REAL detached child later writes a valid cache file", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    expect(existsSync(cachePath)).toBe(false);

    const { result, elapsedMs } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    expect(parseAdditionalContext(result.stdout as string)).toBe("");
    expect(elapsedMs).toBeLessThan(100);

    // Poll for the REAL detached child's on-disk output (genuine OS process,
    // not awaited by the hook) — bounded, never an unbounded wait.
    const written = pollForValidCacheJson(cachePath) as Record<string, unknown>;
    expect(written.status).toBe("sync");
    expect(typeof written.binary_version).toBe("string");
    expect(typeof written.checked_at).toBe("string");

    const calls = readLogLines(logPath);
    expect(calls.some((l) => l.startsWith("setup --check"))).toBe(true);
  });

  it("on-disk cache older than 24h is treated identically to a missing cache (spawns a refresh, injects nothing)", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    writeCache(cachePath, {
      checked_at: isoMinusMs(25 * 60 * 60 * 1000), // 25h old — past the 24h TTL
      binary_version: "1.2.3",
      status: "sync",
    });

    const { result, elapsedMs } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    expect(parseAdditionalContext(result.stdout as string)).toBe("");
    expect(elapsedMs).toBeLessThan(100);

    const deadline = Date.now() + 5000;
    while (readLogLines(logPath).length === 0 && Date.now() < deadline) {
      sleepSyncMs(25);
    }
    const calls = readLogLines(logPath);
    expect(calls.some((l) => l.startsWith("setup --check"))).toBe(true);
  });
});

// ─── ERROR — corrupted cache JSON → silence, never a crash ────────────────────

describe("session-start-freshness — ERROR", () => {
  it("corrupted cache JSON: silence (no advisory), no crash, exit 0", () => {
    const { cwd, claudeDir, cachePath, stubDir } = setupFixture();
    writeFileSync(cachePath, "{ this is not valid json ][");

    const { result } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(parseAdditionalContext(result.stdout as string)).toBe("");
  });

  it("cache JSON that parses but doesn't match SetupCheckCache's shape: silence, no crash, exit 0", () => {
    const { cwd, claudeDir, cachePath, stubDir } = setupFixture();
    writeCache(cachePath, { not_the_expected: "shape" });

    const { result } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    expect(parseAdditionalContext(result.stdout as string)).toBe("");
  });
});

// ─── STATE — optional-field fallback + missing→refreshed→sync transition ─────

describe("session-start-freshness — STATE", () => {
  it("a stale cache with NO stale_counts field still renders a single valid advisory line (optional-field fallback)", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    writeCache(cachePath, { checked_at: isoMinusMs(60_000), binary_version: "4.5.6", status: "stale" });

    const { result } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    const lines = ctx.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("binary 4.5.6");
    expect(readLogLines(logPath)).toHaveLength(0);
  });

  it("a missing cache, once refreshed by the detached child, is OBSERVABLE by a second hook invocation as fresh+sync", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();

    const first = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });
    expect(first.result.status).toBe(0);
    expect(parseAdditionalContext(first.result.stdout as string)).toBe("");

    pollForValidCacheJson(cachePath);

    const second = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });
    expect(second.result.status).toBe(0);
    // The cache the first run's background refresh wrote is now fresh+sync —
    // the second invocation reads REAL state that did not exist at the start
    // of the first, proving the state genuinely changed on disk.
    expect(parseAdditionalContext(second.result.stdout as string)).toBe("");

    // Exactly one refresh was fired (the second run found a fresh cache and
    // did not re-trigger).
    expect(readLogLines(logPath).filter((l) => l.startsWith("setup --check"))).toHaveLength(1);
  });
});

// ─── REGRESSION — advisory composes AFTER pre-existing phases, never reorders ─

describe("session-start-freshness — REGRESSION", () => {
  it("the advisory block appears AFTER the pre-existing lore-bootstrap block when both fire in the same session", () => {
    const { cwd, claudeDir, cachePath, logPath, stubDir } = setupFixture();
    mkdirSync(join(cwd, ".lore"));
    writeCache(cachePath, { checked_at: isoMinusMs(60_000), binary_version: "1.2.3", status: "stale" });

    const { result } = runHook({
      cwd,
      extraEnv: { PATH: `${stubDir}:${process.env.PATH}`, CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents") },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout as string);
    const bootstrapIdx = ctx.indexOf("Lore Bootstrap");
    const advisoryIdx = ctx.indexOf("⚠ lore assets outdated");
    expect(bootstrapIdx).toBeGreaterThanOrEqual(0);
    expect(advisoryIdx).toBeGreaterThan(bootstrapIdx);

    // Phase F itself still fired zero refresh spawns (cache was fresh) —
    // only the pre-existing Phase E `bootstrap` call is in the log.
    const calls = readLogLines(logPath);
    expect(calls.some((l) => l.startsWith("bootstrap"))).toBe(true);
    expect(calls.some((l) => l.startsWith("setup --check"))).toBe(false);
  });
});
