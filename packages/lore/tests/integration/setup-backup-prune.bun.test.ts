/**
 * RED fs-touching scenarios for `.lore-backups/` pruning (SPEC-076 §C5, task
 * T7 "mergeSettings orphan pruning + backup prune keep-5"). Written BEFORE
 * the implementation exists — `SetupService.install()` today NEVER touches
 * `.lore-backups/` contents beyond writing NEW backups into it (see
 * `packages/lore/src/service/setup-service.ts` — no read/list/removal of the
 * directory's existing run-subdirectories anywhere in `install()`). Every
 * scenario below pre-seeds `.lore-backups/<run-timestamp>/` directories
 * directly on a REAL mkdtemp filesystem (independent of whatever chain of
 * historical installs would have produced them for real — the "given N run
 * directories already exist" precondition is what matters, not how they got
 * there), then calls the PUBLIC `SetupService.install()` API once and
 * inspects `.lore-backups/` afterwards.
 *
 * Expected behavior (T7's own task description, SPEC-076 §C5): "backup
 * hygiene: `.lore-backups/` is pruned on every install run (keep the most
 * recent N=5 runs)" — `pruneBackups(keep=5)` runs during `install()` AFTER
 * successful writes, sorts run-subdirectories by NAME (their ISO8601
 * `written_at` timestamp — lexicographic order === chronological order for
 * that format, same property `SetupService.uninstall` already relies on when
 * deriving a backup path from `entry.written_at`), removes the oldest beyond
 * `keep`, and — SAFETY — never removes a subdirectory whose name does not
 * parse as a run timestamp (a foreign/manually-created directory a user
 * dropped inside `.lore-backups/` for their own reasons).
 *
 * Run directory names use REAL `Date#toISOString()` format (colon-bearing,
 * e.g. "2026-01-01T00:00:00.000Z") — this is EXACTLY what `SetupService`'s
 * own `defaultNow()` produces and what every genuine backup run directory is
 * actually named on disk (see `install()`'s `nowIso` usage), not an
 * arbitrary test-local naming scheme.
 *
 * bun test (not vitest) per this task's own AC script contract
 * (AC-076-8: `cd packages/lore && bun test tests/integration/setup-backup-prune.bun.test.ts`).
 *
 * ⛔ Every fixture is a `mkdtempSync` scratch directory — never the real
 * `~/.claude` (project CLAUDE.md hard rule; mirrors `real-setup-ports.test.ts`).
 *
 * @spec_ref SPEC-076 §C5 (task-skill-test-t7r-orphan-backup-pruning-red-test-scenarios), AC-076-8
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ok } from "@lore/core";
import type { AssetPayload, LoreError, Result } from "@lore/core";

import { SetupService, type AssetSource, type McpAddOutcome, type McpRegistrar } from "../../src/service/setup-service.js";
import { RealSetupFsReader, RealSetupFsWriter } from "../../src/adapters/real-setup-fs.js";

const BACKUPS_DIRNAME = ".lore-backups";
const KEEP = 5;

// ─── Fakes (AssetSource / McpRegistrar) — real fs only for SetupFsReader/Writer ──

/** Always returns the SAME single fresh file — enough to give `install()` at least one successful write. */
class SingleFreshFileAssetSource implements AssetSource {
  async load(): Promise<Result<AssetPayload, LoreError>> {
    return ok({
      files: [
        {
          path: "skills/foo/SKILL.md",
          kind: "skill",
          content: "fresh skill content",
          sha256: "unused-recomputed-by-service",
        },
      ],
    });
  }
}

class OkMcpRegistrar implements McpRegistrar {
  async add(): Promise<Result<McpAddOutcome, LoreError>> {
    return ok("added");
  }
  async remove(): Promise<Result<void, LoreError>> {
    return ok(undefined);
  }
}

// ─── Scratch dir + backup-run-dir seeding helpers ──────────────────────────

const scratchDirs: string[] = [];

function makeScratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "setup-backup-prune-"));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** Seeds `<targetDir>/.lore-backups/<runName>/some-file.mjs` with dummy content — mimics a genuine prior backup run. */
function seedBackupRun(targetDir: string, runName: string): void {
  const runDir = join(targetDir, BACKUPS_DIRNAME, runName);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "some-hook.mjs"), `backed up content for run ${runName}`);
}

function listBackupRunDirs(targetDir: string): string[] {
  try {
    return readdirSync(join(targetDir, BACKUPS_DIRNAME)).sort();
  } catch {
    return [];
  }
}

/** 7 real-ISO8601-shaped, ascending run-directory names ("oldest" first). */
const SEVEN_RUNS = [
  "2026-01-01T00:00:00.000Z",
  "2026-01-02T00:00:00.000Z",
  "2026-01-03T00:00:00.000Z",
  "2026-01-04T00:00:00.000Z",
  "2026-01-05T00:00:00.000Z",
  "2026-01-06T00:00:00.000Z",
  "2026-01-07T00:00:00.000Z",
];

async function runInstallOnce(targetDir: string): Promise<void> {
  const service = new SetupService(
    new SingleFreshFileAssetSource(),
    new RealSetupFsReader(),
    new RealSetupFsWriter(),
    new OkMcpRegistrar(),
  );
  const result = await service.install(
    { targetDir, binPath: "/usr/local/bin/lore" },
    () => "2026-01-08T00:00:00.000Z", // this run's OWN timestamp — distinct from every seeded run
  );
  expect(result.ok).toBe(true);
}

// ─── SCENARIO 5 — 7 run dirs, keep=5, exactly the 2 oldest are removed ─────

describe("SetupService.install() — .lore-backups pruning, 7 pre-existing runs (SPEC-076 §C5, AC-076-8)", () => {
  it("prunes to exactly 5 run directories, removing the 2 OLDEST by timestamp name", async () => {
    const targetDir = makeScratchDir();
    for (const runName of SEVEN_RUNS) {
      seedBackupRun(targetDir, runName);
    }
    expect(listBackupRunDirs(targetDir)).toHaveLength(7);

    await runInstallOnce(targetDir);

    const remaining = listBackupRunDirs(targetDir);
    expect(remaining).toHaveLength(KEEP);
    // The 2 OLDEST (lexicographically-first, since ISO8601 sorts chronologically) must be gone.
    expect(remaining).not.toContain(SEVEN_RUNS[0]);
    expect(remaining).not.toContain(SEVEN_RUNS[1]);
    // The 5 newest of the ORIGINAL seeded set must all still be present.
    for (const survivor of SEVEN_RUNS.slice(2)) {
      expect(remaining).toContain(survivor);
    }
  });
});

// ─── SCENARIO 6 — 5 or fewer run dirs: prune removes nothing (BOUNDARY) ────

describe("SetupService.install() — .lore-backups pruning, exactly 5 pre-existing runs (BOUNDARY)", () => {
  it("removes nothing when the run-directory count is already at or below keep=5", async () => {
    const targetDir = makeScratchDir();
    const fiveRuns = SEVEN_RUNS.slice(0, 5);
    for (const runName of fiveRuns) {
      seedBackupRun(targetDir, runName);
    }
    expect(listBackupRunDirs(targetDir)).toHaveLength(5);

    await runInstallOnce(targetDir);

    const remaining = listBackupRunDirs(targetDir);
    expect(remaining).toEqual([...fiveRuns].sort());
  });
});

// ─── SCENARIO 7 — a non-timestamp-named foreign dir is NEVER pruned (NEGATIVE/safety) ──

describe("SetupService.install() — .lore-backups pruning never touches a non-conforming directory name (NEGATIVE/safety)", () => {
  it("prunes conforming run dirs down to keep=5 while leaving a foreign, non-timestamp-named directory completely untouched", async () => {
    const targetDir = makeScratchDir();
    const sixRuns = SEVEN_RUNS.slice(0, 6); // 6 conforming runs — 1 over the keep=5 limit
    for (const runName of sixRuns) {
      seedBackupRun(targetDir, runName);
    }
    const foreignDirName = "my-manual-notes"; // does NOT parse as an ISO8601 run timestamp
    const foreignDir = join(targetDir, BACKUPS_DIRNAME, foreignDirName);
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(join(foreignDir, "readme.txt"), "do not touch — not a lore run directory");

    expect(listBackupRunDirs(targetDir)).toHaveLength(7); // 6 conforming + 1 foreign

    await runInstallOnce(targetDir);

    const remaining = listBackupRunDirs(targetDir);
    // The foreign directory must survive, UNCONDITIONALLY, regardless of the keep=5 count.
    expect(remaining).toContain(foreignDirName);
    expect(readFileSync(join(foreignDir, "readme.txt"), "utf8")).toBe(
      "do not touch — not a lore run directory",
    );
    // Conforming runs are pruned down to keep=5 (the oldest of the 6, SEVEN_RUNS[0], is removed) —
    // total on disk is therefore keep(5) + the surviving foreign dir(1) = 6.
    expect(remaining).toHaveLength(KEEP + 1);
    expect(remaining).not.toContain(SEVEN_RUNS[0]);
  });
});
