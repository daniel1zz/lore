/**
 * RED-phase e2e for the PostToolUse CLAUDE.md guard hook (AC-CTX-5, task
 * `task-skill-test-red-hook-trip-and-skill-retirement-integration`; paired
 * implementation task `task-skill-implement-guard-hook-asset-registration-
 * skill`, not yet landed as of this file's authoring — confirmed empirically
 * below: `assets/hooks/claude-md-guard.sh` does not exist on disk).
 *
 * bun test (not vitest): shells out to the REAL `assets/hooks/claude-md-
 * guard.sh` script (`sh <script>`, PostToolUse-style stdin JSON piped in),
 * mirroring `gate-hooks.bun.test.ts`'s shim-spawn harness (`Bun.spawnSync`
 * with `stdin: Buffer.from(JSON.stringify(payload))`) and `pre-push-claude-
 * md-trip.bun.test.ts`'s throwaway-fixture-repo discipline. ⛔ Never touches
 * the repo's own `.lore/` corpus — every fixture lives under its own
 * `mkdtempSync` directory.
 *
 * Design per spec-context-verb-family-two-zone-claude-md-anatomy-lore D11:
 * the hook is a distributed PostToolUse asset that fires on Edit/Write tool
 * calls whose `tool_input.file_path` basename is a configured memory
 * filename, delegates the ACTUAL over-ceiling measurement to `lore status
 * --check-claude-md` (config-only, never loads the corpus DB — see
 * `commands/status.ts`'s own module doc), and is fail-open by construction:
 * no `.lore/` at the target cwd, or no resolvable `lore` binary, both allow
 * silently. "Zero numbers" (D11) means every budget literal (300/30720/200/
 * 16384) lives ONLY in `@lore/core`'s `contextConfigSchema` defaults — this
 * hook script must never hardcode a ceiling itself, it just relays `lore
 * status --check-claude-md`'s own exit code and text.
 *
 * PostToolUse hook payload shape (Claude Code hooks protocol, same `{tool_
 * name, tool_input, cwd}` envelope `lore-gate-g1-spec-create.sh` reads):
 * `tool_name` is `"Edit"` or `"Write"`, `tool_input.file_path` is the
 * absolute path just edited/written, `cwd` is the session's ambient cwd
 * (here, always set to the fixture repo root — the file being edited always
 * lives directly under it, so no `cd`-prefix-style resolution is needed).
 *
 * Coverage dimensions:
 *   HAPPY:      a within-ceiling CLAUDE.md edit in a clean fixture exits 0.
 *   BOUNDARY:   the true RED case — an over-ceiling CLAUDE.md (tight config-
 *               declared ceiling, never a numeric literal in the hook
 *               itself) under a `.lore/`-bearing fixture. EXPECTED (spec'd,
 *               future) behavior: exit non-zero, output names the violation.
 *               ACTUAL (today, hook file doesn't exist): `sh` on a missing
 *               path fails, and even once the file exists but is unwired,
 *               this assertion fails — RED by design.
 *   NEGATIVE:   `tool_input.file_path` basename is NOT a configured memory
 *               filename (e.g. `notes.txt`) → exits 0 fast, even under the
 *               SAME over-ceiling-config fixture (never reaches `lore status
 *               --check-claude-md` at all).
 *   ERROR:      no `.lore/` directory at all (fail-open preamble) + the SAME
 *               over-ceiling CLAUDE.md → exits 0.
 *   STATE:      `.lore/` present but the `lore` binary is unresolvable
 *               (PATH stripped) + the SAME over-ceiling CLAUDE.md → exits 0
 *               (fail-open — this shim must never itself become the reason
 *               a normal Edit/Write tool call is blocked when its own
 *               dependency is unavailable).
 *   REGRESSION: the grep-pin — the hook script source contains no digit-run
 *               ≥2 outside comment lines (the "zero numbers" D11 invariant),
 *               proven non-vacuous by a synthetic fixture carrying a literal
 *               ceiling number that DOES trip the same check.
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore AC-CTX-5, D11
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface HookPayload {
  readonly tool_name: string;
  readonly tool_input: Record<string, unknown>;
  readonly cwd: string;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/integration/ → packages/lore/ → packages/ → repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const HOOK_PATH = join(PROJECT_ROOT, "assets", "hooks", "claude-md-guard.sh");
const DIST_DIR = join(PROJECT_ROOT, "dist");

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Spawns the guard hook with a PostToolUse-style payload piped to stdin. `lore` resolves via PATH unless `extraEnv.PATH` overrides it. */
function runHook(payload: HookPayload, extraEnv: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync(["sh", HOOK_PATH], {
    stdin: Buffer.from(JSON.stringify(payload)),
    env: {
      ...process.env,
      HOME: payload.cwd,
      PATH: `${DIST_DIR}:${process.env["PATH"] ?? ""}`,
      ...extraEnv,
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lore-claude-md-guard-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Writes `.lore/config.yaml` with a config-declared root ceiling — the config is the ONLY place a number appears, never the hook. */
function writeLoreConfig(dir: string, maxLines: number): void {
  const loreDir = join(dir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(
    join(loreDir, "config.yaml"),
    `project:\n  name: fixture\n  author: fixture\ncontext:\n  memory_files:\n    root:\n      max_lines: ${maxLines}\n      max_bytes: 1000000\n`,
  );
}

/** Writes a within-ceiling CLAUDE.md (a handful of short lines, always under any ceiling used below). */
function writeWithinCeilingClaudeMd(dir: string): string {
  const target = join(dir, "CLAUDE.md");
  writeFileSync(target, "# Title\n\nA couple of short lines.\n");
  return target;
}

/** Writes a CLAUDE.md with `lineCount` lines — paired with a config ceiling well below it to force a breach. */
function writeOverCeilingClaudeMd(dir: string, lineCount: number): string {
  const target = join(dir, "CLAUDE.md");
  const lines = Array.from({ length: lineCount }, (_, i) => `line ${i} of filler content`);
  writeFileSync(target, `${lines.join("\n")}\n`);
  return target;
}

function editPayload(cwd: string, filePath: string, toolName: "Edit" | "Write" = "Edit"): HookPayload {
  return { tool_name: toolName, tool_input: { file_path: filePath }, cwd };
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("claude-md-guard hook trip (AC-CTX-5)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("fixture");
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("guard hook script exists at assets/hooks/claude-md-guard.sh — RED today: the paired implement task has not landed it yet", () => {
    expect(existsSync(HOOK_PATH)).toBe(true);
  });

  it("HAPPY: a within-ceiling CLAUDE.md Edit in a clean .lore/-bearing fixture exits 0", () => {
    writeLoreConfig(tmpDir, 300);
    const filePath = writeWithinCeilingClaudeMd(tmpDir);

    const result = runHook(editPayload(tmpDir, filePath));

    expect(result.exitCode).toBe(0);
  });

  it("BOUNDARY (RED — the trip case): an over-ceiling CLAUDE.md under a tight config-declared ceiling must exit non-zero and name the violation — FAILS today because the hook file doesn't exist yet", () => {
    writeLoreConfig(tmpDir, 3);
    const filePath = writeOverCeilingClaudeMd(tmpDir, 20);

    const result = runHook(editPayload(tmpDir, filePath));
    const combined = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).not.toBe(0);
    expect(combined).toMatch(/CLAUDE\.md/i);
    expect(combined.toLowerCase()).toMatch(/budget|ceiling|exceed|breach|lines/);
  });

  it("NEGATIVE: file_path basename is not a configured memory filename → exits 0 fast, even under the SAME over-ceiling-config fixture", () => {
    writeLoreConfig(tmpDir, 3);
    writeOverCeilingClaudeMd(tmpDir, 20); // present on disk but NOT the edited file
    const otherFile = join(tmpDir, "notes.txt");
    writeFileSync(otherFile, "irrelevant file, not a memory filename\n");

    const result = runHook(editPayload(tmpDir, otherFile));

    expect(result.exitCode).toBe(0);
  });

  it("ERROR (fail-open, positive control): no .lore/ directory at all + an over-ceiling CLAUDE.md still exits 0", () => {
    const filePath = writeOverCeilingClaudeMd(tmpDir, 500);

    const result = runHook(editPayload(tmpDir, filePath));

    expect(result.exitCode).toBe(0);
  });

  it("STATE (fail-open, positive control): .lore/ present but the lore binary is unresolvable (PATH stripped) + an over-ceiling CLAUDE.md still exits 0", () => {
    writeLoreConfig(tmpDir, 3);
    const filePath = writeOverCeilingClaudeMd(tmpDir, 20);

    const result = runHook(editPayload(tmpDir, filePath), { PATH: "" });

    expect(result.exitCode).toBe(0);
  });

  it("REGRESSION (grep-pin): the hook script source contains zero digit-runs of length >= 2 outside comment lines — budget numbers live ONLY in config, never in this shim", () => {
    const content = readFileSync(HOOK_PATH, "utf8");
    const codeLines = content
      .split("\n")
      .filter((line) => !/^\s*#/.test(line)); // drop full-line comments (shebang/header/inline notes)

    const digitRunViolations = codeLines.filter((line) => /\d{2,}/.test(line));

    expect(digitRunViolations).toEqual([]);
  });

  it("REGRESSION control: the digit-run grep-pin assertion is not vacuously true — a synthetic fixture carrying a literal ceiling number IS flagged", () => {
    const syntheticContent = "#!/usr/bin/env bash\nMAX_LINES=300\nif [ \"$LINES\" -gt \"$MAX_LINES\" ]; then exit 1; fi\n";
    const codeLines = syntheticContent
      .split("\n")
      .filter((line) => !/^\s*#/.test(line));
    const digitRunViolations = codeLines.filter((line) => /\d{2,}/.test(line));

    expect(digitRunViolations.length).toBeGreaterThan(0);
  });
});
