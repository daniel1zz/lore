// @spawns packages/lore/src/index.ts
/**
 * PRODUCTION WIRING oracle for AC-OX-10 (spec-oracle-executability-a-runner-s-
 * discovery-refusal-is-not-a §D8, task-wire-allow-missing-path-and-the-
 * unredeemed-declaration) — the D8 `--allow-missing-path` escape and the
 * `unredeemed_allow_missing_path_count` status field are ALREADY implemented
 * and unit-tested at the SERVICE layer (`AcService.addCriterion`/`setCriterion`
 * + `countUnredeemedAllowMissingPath`, task-promote-the-oracle-file-existence-
 * primitives-into-lore). What this file proves is that a REAL `lore ac add`/
 * `lore status --json` invocation actually reaches that mechanism — asserting
 * the service method exists is exactly the false-green this AC exists to
 * prevent (its own wording), so this file NEVER imports `AcService` or
 * `commands/ac.ts`/`commands/status.ts` directly. It only spawns the CLI.
 *
 * SUBPROCESS TARGET: `bun run <PACKAGE_ROOT>/src/index.ts` — the SOURCE entry
 * — never the bare `lore` binary and never `dist/lore`. The global `lore`
 * symlink points at the MAIN checkout's `dist/`, which does not carry this
 * worktree's diff; a compiled `dist/lore` inside this worktree would ALSO be
 * stale unless freshly rebuilt. Spawning the source entry is the only way
 * this oracle measures the code actually changed in this diff, with zero
 * build step. Mirrors `cli-ac-set.test.ts`'s proven subprocess pattern (same
 * underlying reason: `commands/ac.ts`/`commands/status.ts` transitively
 * import `loader.ts` → `app.ts` → `bun:sqlite`, which vitest cannot resolve
 * as a direct import — confirmed empirically by that file's own header).
 *
 * Uses a throwaway `mkdtemp` + `lore init` corpus for every test — NEVER this
 * repo's own `.lore/` (project CLAUDE.md's standing rule; canonical pattern:
 * `packages/dashboard/tests/e2e/global-setup.ts`).
 *
 * Coverage — ONE `it`, titled to include `live-cli-wiring` so the governing
 * AC's pinned oracle command (`-t live-cli-wiring`) selects exactly this case
 * (AC-OX-10):
 *   1. `lore ac add <spec> <id> --mode script --oracle test --command <cmd
 *      naming a nonexistent test path>` → REFUSED at the CLI (exit 4), stderr
 *      names both `--allow-missing-path` and the missing token.
 *   2. The SAME call plus `--allow-missing-path "<non-empty reason>"` →
 *      SUCCEEDS (exit 0).
 *   3. The SAME call (a fresh id) plus `--allow-missing-path ""` (explicitly
 *      EMPTY reason) → still REFUSED (exit 4) — an empty string is not a
 *      reason, D8's own contract.
 *   4. `lore status --json` → `unredeemed_allow_missing_path_count` is present
 *      as a NUMBER field and is >= 1 (step 2's declared path still does not
 *      exist on disk).
 *
 * RED-FIRST verification note (recorded in the task's evidence log, not
 * re-derived here): unwiring EITHER call site — dropping the
 * `buildDeclarePathOpts(...)` third argument from `commands/ac.ts`'s
 * `addCriterion` call, OR dropping `unredeemed_allow_missing_path_count` from
 * `commands/status.ts`'s JSON payload — makes this exact test fail (step 1's
 * exit-4 expectation, or step 4's field-presence expectation, respectively).
 *
 * @spec_ref spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §D8 AC-OX-10
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir (mirrors cli-ac-set.test.ts). */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-ac-allow-missing-path-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

describe("PRODUCTION WIRING — lore ac add --allow-missing-path + lore status --json unredeemed count (AC-OX-10)", () => {
  // 5 CLI spawns (prd/spec create + 3× ac add + status) — declares its budget
  // per spec-a-test-case-s-timeout-budget-must-be-declared-when-its D1.
  it(
    "live-cli-wiring: refuses a nonexistent test path, accepts it with a non-empty reason, refuses an empty reason, and lore status --json reports the unredeemed count",
    { timeout: 60_000 },
    () => {
      const prd = runLore(
        ["create", "prd", "--title", "AC-OX-10 PRD", "--content", "root", "--no-ai"],
        tmpDir,
      );
      if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);
      const prdSlug = extractSlug(prd.stdout);

      const spec = runLore(
        [
          "create",
          "spec",
          "--title",
          "AC-OX-10 Spec",
          "--content",
          "## Overview/Goal\nbody",
          "--no-ai",
        ],
        tmpDir,
      );
      if (spec.exitCode !== 0) throw new Error(`create spec failed: ${spec.stderr}`);
      const specSlug = extractSlug(spec.stdout);

      const NONEXISTENT_COMMAND = "bunx vitest run this-file-does-not-exist-anywhere.test.ts";

      // ── 1. Bare `ac add` naming a nonexistent test path — REFUSED at the CLI ──
      const refused = runLore(
        [
          "ac",
          "add",
          specSlug,
          "AC-1",
          "--statement",
          "A red-first AC naming a test not yet written.",
          "--mode",
          "script",
          "--oracle",
          "test",
          "--command",
          NONEXISTENT_COMMAND,
        ],
        tmpDir,
      );
      expect(refused.exitCode).toBe(4);
      expect(refused.stderr).toMatch(/--allow-missing-path/);
      expect(refused.stderr).toMatch(/this-file-does-not-exist-anywhere\.test\.ts/);

      // ── 2. The SAME call plus a non-empty --allow-missing-path reason — SUCCEEDS ──
      const accepted = runLore(
        [
          "ac",
          "add",
          specSlug,
          "AC-1",
          "--statement",
          "A red-first AC naming a test not yet written.",
          "--mode",
          "script",
          "--oracle",
          "test",
          "--command",
          NONEXISTENT_COMMAND,
          "--allow-missing-path",
          "red-first AC — test authored in a follow-up commit",
        ],
        tmpDir,
      );
      expect(accepted.exitCode).toBe(0);

      // ── 3. The SAME call (a fresh id — AC-1 already exists) plus an
      //      EXPLICITLY EMPTY --allow-missing-path reason — still REFUSED.
      //      D8's own contract: an empty/whitespace-only/absent reason is
      //      refused whenever a declared path is genuinely missing. ──
      const refusedEmptyReason = runLore(
        [
          "ac",
          "add",
          specSlug,
          "AC-2",
          "--statement",
          "A second red-first AC, declared with an empty reason.",
          "--mode",
          "script",
          "--oracle",
          "test",
          "--command",
          NONEXISTENT_COMMAND,
          "--allow-missing-path",
          "",
        ],
        tmpDir,
      );
      expect(refusedEmptyReason.exitCode).toBe(4);
      expect(refusedEmptyReason.stderr).toMatch(/--allow-missing-path/);

      // ── 4. `lore status --json` surfaces the unredeemed-declaration count
      //      as a field — AC-1's declared path (step 2) still does not exist ──
      const status = runLore(["status", "--json"], tmpDir);
      expect(status.exitCode).toBe(0);
      const parsed = JSON.parse(status.stdout) as {
        data: { unredeemed_allow_missing_path_count: unknown };
      };
      expect(typeof parsed.data.unredeemed_allow_missing_path_count).toBe("number");
      expect(parsed.data.unredeemed_allow_missing_path_count).toBeGreaterThanOrEqual(1);
    },
  );
});
