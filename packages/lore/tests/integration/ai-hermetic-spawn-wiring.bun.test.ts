// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-HJ-1
 *
 * SPEC-030 AC-HJ-1: hermetic judge spawn — cwd/env/flag wiring, end-to-end.
 *
 * `hermetic-spawn.ts`'s pure logic is unit-tested directly under vitest
 * (tests/unit/ai/hermetic-spawn.test.ts). That suite proves the FUNCTION is correct in
 * isolation but cannot prove `claude-cli-provider.ts` actually WIRES `buildHermeticSpawnSpec`'s
 * output into the real `Bun.spawn` call. This file is that wiring proof: a stub binary
 * literally named `claude` (so `isClaudeCliCommand` recognizes it and the isolation flag
 * path activates) reports its OWN observed cwd, env, and argv back to the test — the exact
 * three things `buildHermeticSpawnSpec` controls.
 *
 * Strategy:
 *   - Stub binary named `claude` (matching the real CLI's basename) on PATH, so the
 *     `command: claude` config entry resolves through `isClaudeCliCommand` exactly the way
 *     the real `claude` binary would, without depending on a real installed CLI/network/auth
 *     (verifying the real `claude --setting-sources` behavior itself is out of scope here —
 *     that was verified manually by the implementer against the live binary; see
 *     hermetic-spawn.ts's module header).
 *   - The stub echoes `PWD:<cwd>`, one `ENVVAR:<KEY>=<VALUE>` line per env var whose key
 *     matches `^CLAUDE`, and one `ARG:<value>` line per argv entry it received — all to
 *     stdout, which becomes the created doc's content (same capture mechanism every other
 *     AI integration test in this suite relies on).
 *   - The harness's OWN spawned `lore` process is given `CLAUDECODE=1` plus a
 *     `CLAUDE_CODE_SESSION_ID` env var (mirroring what a live Claude Code session sets on
 *     ITS child processes) — this is `lore`'s own `process.env`, i.e. exactly what
 *     `ClaudeCliProvider.generate` reads as `sourceEnv` before sanitizing it for the
 *     judge subprocess it spawns next.
 *
 * Assertions:
 *   - Stub's reported $PWD is NOT the project directory (proves neutral cwd, not the
 *     inherited project/host cwd).
 *   - Stub sees NO `CLAUDE*`-prefixed env vars (proves the denylist sanitization reached
 *     the real spawned child, not just the pure function in isolation).
 *   - Stub's argv includes `--setting-sources` immediately followed by an empty-string arg
 *     (proves the isolation flag was actually injected into the real Bun.spawn args, not
 *     just documented as a pure-function contract).
 *
 * Six-dimension note: this is a single END-TO-END WIRING proof, not a full six-dimension
 * matrix — the pure logic's HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION dimensions are
 * already covered by tests/unit/ai/hermetic-spawn.test.ts. This test's own dimension is
 * REGRESSION-class (a safety net against the wiring silently reverting to inherited
 * cwd/env, e.g. if a future refactor re-inlines Bun.spawn params instead of calling
 * buildHermeticSpawnSpec) with a STATE-ish flavor (asserting facts about the spawned
 * subprocess's runtime environment/config, not a return value).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

// reason: each test spawns `bun init` + `bun index.ts create` subprocesses, each with
// ~1-2s bun startup overhead; generous margin keeps this from flaking under load.
const TEST_TIMEOUT_MS = 15_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run the lore CLI in the given cwd with an optional extra PATH prefix, injecting
 * CLAUDECODE=1 + CLAUDE_CODE_SESSION_ID into the SPAWNED lore process's own env —
 * mirroring how a live Claude Code session sets these on its child processes. This is
 * the env that `ClaudeCliProvider.generate` reads as `process.env` (i.e. `sourceEnv`)
 * before sanitizing it for the judge subprocess it spawns next.
 */
function runLoreAsIfInsideClaudeCode(args: string[], cwd: string, extraPath?: string): RunResult {
  const basePath = process.env["PATH"] ?? "";
  const fullPath = extraPath ? `${extraPath}:${basePath}` : basePath;
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      PATH: fullPath,
      EDITOR: "/usr/bin/true",
      // Simulate a live Claude Code session's env, exactly the signals hermetic-spawn.ts
      // documents stripping (SPEC-024's own agent-surface-detection vars).
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "host-session-should-not-leak-into-judge",
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Run the lore CLI with a clean (non-Claude-Code-simulated) env, for plain commands like init/get. */
function runLorePlain(args: string[], cwd: string, extraPath?: string): RunResult {
  const basePath = process.env["PATH"] ?? "";
  const fullPath = extraPath ? `${extraPath}:${basePath}` : basePath;
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, PATH: fullPath, EDITOR: "/usr/bin/true" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-ai-hermetic-wiring-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/** Write a config.yaml whose provider `command` is literally "claude" (matches the real CLI's basename). */
function writeClaudeStubConfig(projectDir: string): void {
  const config = [
    "project:",
    "  name: ai-hermetic-wiring-test",
    "  author: tester",
    "ai:",
    "  provider: claude-cli",
    "  providers:",
    "    claude-cli:",
    "      command: claude",
    "      args: []",
    "      timeout_ms: 5000",
    "  templates: {}",
    "  telemetry: false",
  ].join("\n");
  const loreDir = join(projectDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), config + "\n", "utf8");
}

/**
 * Write a stub binary literally named "claude" that reports its own cwd, any CLAUDE*-
 * prefixed env vars it can see, and its full argv — all to stdout so the harness can
 * capture them via the created doc's content field.
 */
function makeClaudeStub(): { binDir: string; binName: string } {
  const binName = "claude";
  const binDir = makeTempDir("stub-bin");
  const binPath = join(binDir, binName);
  const script = [
    "#!/bin/sh",
    'echo "PWD:$PWD"',
    // reason: grep exits 1 when there are no matches; `|| true` keeps the script running
    // (no `set -e` is used, but being explicit here avoids relying on that).
    "env | grep -E '^CLAUDE' | sed 's/^/ENVVAR:/' || true",
    'for a in "$@"; do',
    '  echo "ARG:$a"',
    "done",
    "exit 0",
    "",
  ].join("\n");
  writeFileSync(binPath, script, { mode: 0o755 });
  return { binDir, binName };
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;
let stubBinDir: string | undefined;

beforeEach(() => {
  tmpDir = makeTempDir("project");
  stubBinDir = undefined;
  const initResult = runLorePlain(["init"], tmpDir);
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed: ${initResult.stderr}`);
  }
});

afterEach(() => {
  cleanupDir(tmpDir);
  if (stubBinDir) cleanupDir(stubBinDir);
});

// ─── AC-HJ-1: hermetic judge spawn — cwd/env/flag wiring ────────────────────

describe("SPEC-030 AC-HJ-1: hermetic judge spawn — cwd/env/flag wiring", () => {
  it("judge subprocess runs with a neutral cwd, no CLAUDE*-prefixed env, and the --setting-sources isolation flag", () => {
    const { binDir } = makeClaudeStub();
    stubBinDir = binDir;
    writeClaudeStubConfig(tmpDir);

    const createResult = runLoreAsIfInsideClaudeCode(
      ["create", "prd", "--title", "Hermetic Wiring PRD", "--ai"],
      tmpDir,
      binDir,
    );
    expect(createResult.exitCode).toBe(0);

    const slugMatch = createResult.stdout.match(/prd-[\w-]+/);
    if (!slugMatch) throw new Error(`No slug in create output: ${createResult.stdout}`);

    const getResult = runLorePlain(["get", slugMatch[0]], tmpDir, binDir);
    expect(getResult.exitCode).toBe(0);
    const content = getResult.stdout;

    // ── cwd: the stub's $PWD must NOT be the project directory ──
    const pwdLine = content.split("\n").find((l) => l.startsWith("PWD:"));
    expect(pwdLine).toBeDefined();
    const stubPwd = pwdLine!.slice("PWD:".length).trim();
    expect(stubPwd).not.toBe(tmpDir);
    // Categorically different from the project dir — the project dir is a specific
    // per-test subdirectory; the neutral cwd is the OS tmp ROOT, never that subdirectory.
    expect(stubPwd).not.toContain("lore-ai-hermetic-wiring-project");

    // ── env: no CLAUDE*-prefixed vars must reach the stub ──
    const envVarLines = content.split("\n").filter((l) => l.startsWith("ENVVAR:"));
    expect(envVarLines).toEqual([]);
    expect(content).not.toContain("CLAUDECODE");
    expect(content).not.toContain("host-session-should-not-leak-into-judge");

    // ── flag: argv must include --setting-sources followed by an empty-string arg ──
    const argLines = content
      .split("\n")
      .filter((l) => l.startsWith("ARG:"))
      .map((l) => l.slice("ARG:".length));
    const flagIndex = argLines.indexOf("--setting-sources");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(argLines[flagIndex + 1]).toBe("");
  }, TEST_TIMEOUT_MS);
});
