// @spawns packages/lore/src/index.ts
// @reads assets/agents/lore-implementer.md
/**
 * @spec_ref SPEC-076 §C3 (five-state classification, diverged-skip-by-default
 *   D2), §C7 (`lore setup --yes` IS the converge verb) — task
 *   task-skill-implement-t5-converge-hardening-diverged-skip-force,
 *   AC-076-3.
 *
 * Integration tests for `lore setup`'s converge-semantics hardening: a
 * managed file the user has hand-edited since the last converge is, by
 * default, left byte-unchanged (never silently overwritten) and reported
 * with a literal repair command; `--force-diverged` opts into the
 * pre-SPEC-076 backup-then-overwrite behavior instead. Spawns the REAL CLI
 * via subprocess (`bun run <index.ts> setup ...`), same pattern as
 * `tests/integration/setup-check.bun.test.ts` and
 * `tests/integration/setup-manifest-fields.bun.test.ts` — reachability
 * through the registered command with the real `RealAssetSource`/embedded-
 * manifest wiring, not just unit coverage of `SetupService`'s pieces
 * (already covered by `tests/unit/service/setup-service.test.ts`'s
 * in-memory-fake suite, where a fake payload's paths never coincide with the
 * real embedded manifest — see `setup-service.ts`'s
 * `classifyManagedDivergence` doc for why that's a deliberate, harmless
 * no-op there).
 *
 * SAFETY — every mutating run sets the CHILD process's `PATH: ""` — never
 * lets a subprocess reach the real `claude` CLI on PATH. Every scenario
 * targets a fresh `mkdtemp` `--claude-dir` — never the real `~/.claude`
 * (2026-07-07 pollution-incident hard rule).
 *
 * Coverage:
 *   HAPPY:      re-running `--yes` over a user-modified managed file leaves
 *               its bytes byte-unchanged, exit 0/1 (file work succeeds
 *               regardless of the unrelated MCP-under-PATH="" failure), and
 *               stdout lists the path plus a literal
 *               `lore setup --yes --force-diverged` repair line; `--json`'s
 *               receipt carries the path under `skippedDiverged`;
 *               `--force-diverged` then restores the file's sha256 to the
 *               embedded target AND leaves a backup of the user's version
 *               under `.lore-backups`.
 *   NEGATIVE:   `--check --force-diverged` is rejected (exit 2, naming
 *               `--force-diverged`) — a read-only projection has no
 *               write-time override to make.
 *   BOUNDARY:   a FRESH install (no prior manifest) with a payload that
 *               happens to already exist on disk with DIFFERING bytes is
 *               NOT treated as "diverged" — D3, the concept doesn't exist
 *               pre-first-install; it's backed up and overwritten exactly
 *               like before SPEC-076.
 *   ERROR:      n/a beyond the shared CLI-usage mutex above — the
 *               divergence classifier itself cannot throw from real fs
 *               probing (already covered structurally by
 *               `plan-update.test.ts`'s own ERROR dimension).
 *   STATE:      re-running `--yes` a SECOND time (still no `--force-diverged`)
 *               over the SAME still-diverged file reports it skipped again,
 *               identically — the skip is stable, not a one-shot fluke.
 *   REGRESSION: a diverged file among otherwise-untouched managed files does
 *               NOT cause any OTHER (non-diverged) managed file to be
 *               skipped or reported.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Path / spawn setup (mirrors setup-check.bun.test.ts / setup-manifest-fields.bun.test.ts) ──

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
/** The repo's `assets/` SSOT root — `RealAssetSource`'s dev-mode source of truth. */
const REPO_ASSETS_ROOT = join(PACKAGE_ROOT, "..", "..", "assets");

function resolveBunBin(): string {
  const resolved = Bun.which("bun");
  if (resolved === null) {
    throw new Error(
      "setup-converge-diverged.bun.test.ts: could not resolve the `bun` binary via Bun.which — is Bun installed?",
    );
  }
  return resolved;
}
const BUN_BIN = resolveBunBin();

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runSetup(args: string[], cwd: string, envOverrides: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: "", ...envOverrides },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

const scratchDirs: string[] = [];

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
});

/** Fresh `--yes` converge into a never-before-installed `targetDir`. `PATH=""` makes MCP registration fail (exit 1) — file writes still land. */
function freshInstall(scratch: string, targetDir: string): void {
  const install = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
  if (install.exitCode !== 1) {
    throw new Error(
      `freshInstall: expected the seeding install to exit 1 (files written, MCP registration fails under ` +
        `PATH=""), got ${install.exitCode}.\nstdout: ${install.stdout}\nstderr: ${install.stderr}`,
    );
  }
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const WATCHED_MANAGED_FILE = "agents/lore-implementer.md";
const MUTATED_BYTES = "MUTATED BYTES — not the embedded content, this is a user-made edit\n";

/** Recursively lists every `.lore-backups/<run>/...` file path (POSIX-relative to the run dir) across ALL run dirs. */
function listAllBackupFiles(targetDir: string): string[] {
  const backupsRoot = join(targetDir, ".lore-backups");
  if (!existsSync(backupsRoot)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(backupsRoot, "");
  return out;
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("lore setup --yes — converge diverged-skip default — HAPPY", () => {
  it("AC-076-3.H1: a user-modified managed file survives a plain `--yes` re-run byte-unchanged, and is reported with a literal repair command", () => {
    const scratch = makeScratchDir("lore-setup-diverged-happy-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const mutatedFullPath = join(targetDir, WATCHED_MANAGED_FILE);
    writeFileSync(mutatedFullPath, MUTATED_BYTES);
    const mutatedShaBefore = sha256OfFile(mutatedFullPath);

    const converge = runSetup(["--claude-dir", targetDir, "--yes", "--json"], scratch);
    // File work succeeds; MCP registration still fails under PATH="" — same exit-1 bucket
    // every other mutating scenario in this suite family observes.
    expect(converge.exitCode).toBe(1);

    // Bytes are byte-unchanged — never silently overwritten.
    expect(readFileSync(mutatedFullPath, "utf8")).toBe(MUTATED_BYTES);
    expect(sha256OfFile(mutatedFullPath)).toBe(mutatedShaBefore);

    const payload = JSON.parse(converge.stdout) as { data: { skippedDiverged: string[] } };
    expect(payload.data.skippedDiverged).toEqual([WATCHED_MANAGED_FILE]);
  });

  it("AC-076-3.H2: --json is the machine-readable half; the same scenario's non-JSON stdout names the path and the literal repair command", () => {
    const scratch = makeScratchDir("lore-setup-diverged-happy-text-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    writeFileSync(join(targetDir, WATCHED_MANAGED_FILE), MUTATED_BYTES);

    const converge = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
    expect(converge.exitCode).toBe(1);
    expect(converge.stdout).toContain(WATCHED_MANAGED_FILE);
    expect(converge.stdout).toContain("lore setup --yes --force-diverged");
  });

  it("AC-076-3.H3: --force-diverged restores the file's sha256 to the embedded target and leaves a backup of the user's version", () => {
    const scratch = makeScratchDir("lore-setup-diverged-force-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const mutatedFullPath = join(targetDir, WATCHED_MANAGED_FILE);
    writeFileSync(mutatedFullPath, MUTATED_BYTES);

    const expectedSha = sha256OfFile(join(REPO_ASSETS_ROOT, WATCHED_MANAGED_FILE));

    const converge = runSetup(["--claude-dir", targetDir, "--yes", "--force-diverged", "--json"], scratch);
    expect(converge.exitCode).toBe(1); // MCP still fails under PATH=""

    expect(sha256OfFile(mutatedFullPath)).toBe(expectedSha);

    const payload = JSON.parse(converge.stdout) as { data: { skippedDiverged: string[]; backups: string[] } };
    expect(payload.data.skippedDiverged).toEqual([]);
    expect(payload.data.backups).toContain(WATCHED_MANAGED_FILE);

    const backupFiles = listAllBackupFiles(targetDir);
    const backupContents = backupFiles.map((relPath) => readFileSync(join(targetDir, ".lore-backups", relPath), "utf8"));
    expect(backupContents).toContain(MUTATED_BYTES);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("lore setup — converge diverged-skip default — NEGATIVE", () => {
  it("AC-076-3.N1: --check + --force-diverged is rejected, exit 2, naming --force-diverged", () => {
    const scratch = makeScratchDir("lore-setup-diverged-mutex-");
    const result = runSetup(["--check", "--force-diverged"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--force-diverged");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("lore setup — converge diverged-skip default — BOUNDARY", () => {
  it("AC-076-3.B1: a FRESH install (no prior manifest) has no 'diverged' concept — differing on-disk bytes are backed up and overwritten, not skipped", () => {
    const scratch = makeScratchDir("lore-setup-diverged-fresh-boundary-");
    const targetDir = join(scratch, ".claude");

    // Simulate a target dir that already has SOME content at a would-be managed path,
    // predating any lore-managed install (no manifest exists yet at all).
    const preexistingDir = join(targetDir, "agents");
    const preexistingFile = join(preexistingDir, "lore-implementer.md");
    mkdirSync(preexistingDir, { recursive: true });
    writeFileSync(preexistingFile, "pre-existing foreign content, never installed by lore\n");

    const expectedSha = sha256OfFile(join(REPO_ASSETS_ROOT, WATCHED_MANAGED_FILE));

    const install = runSetup(["--claude-dir", targetDir, "--yes", "--json"], scratch);
    expect(install.exitCode).toBe(1); // MCP still fails under PATH=""

    // D3: no "diverged" concept on a fresh install — the differing pre-existing file is
    // backed up (foreign content preserved) and overwritten with the target bytes, exactly
    // like pre-SPEC-076 behavior.
    expect(sha256OfFile(preexistingFile)).toBe(expectedSha);

    const payload = JSON.parse(install.stdout) as { data: { skippedDiverged: string[]; backups: string[] } };
    expect(payload.data.skippedDiverged).toEqual([]);
    expect(payload.data.backups).toContain(WATCHED_MANAGED_FILE);
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("lore setup — converge diverged-skip default — STATE", () => {
  it("AC-076-3.S1: re-running --yes a second time over the SAME still-diverged file reports it skipped again, identically", () => {
    const scratch = makeScratchDir("lore-setup-diverged-state-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const mutatedFullPath = join(targetDir, WATCHED_MANAGED_FILE);
    writeFileSync(mutatedFullPath, MUTATED_BYTES);

    const first = runSetup(["--claude-dir", targetDir, "--yes", "--json"], scratch);
    expect(first.exitCode).toBe(1);
    const firstPayload = JSON.parse(first.stdout) as { data: { skippedDiverged: string[] } };
    expect(firstPayload.data.skippedDiverged).toEqual([WATCHED_MANAGED_FILE]);

    const second = runSetup(["--claude-dir", targetDir, "--yes", "--json"], scratch);
    expect(second.exitCode).toBe(1);
    const secondPayload = JSON.parse(second.stdout) as { data: { skippedDiverged: string[] } };
    expect(secondPayload.data.skippedDiverged).toEqual([WATCHED_MANAGED_FILE]);

    // The file itself is STILL untouched across both re-runs.
    expect(readFileSync(mutatedFullPath, "utf8")).toBe(MUTATED_BYTES);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("lore setup — converge diverged-skip default — REGRESSION", () => {
  it("AC-076-3.R1: a diverged file among otherwise-untouched managed files does not cause any OTHER file to be skipped or reported", () => {
    const scratch = makeScratchDir("lore-setup-diverged-regression-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    writeFileSync(join(targetDir, WATCHED_MANAGED_FILE), MUTATED_BYTES);

    const converge = runSetup(["--claude-dir", targetDir, "--yes", "--json"], scratch);
    expect(converge.exitCode).toBe(1);

    const payload = JSON.parse(converge.stdout) as {
      data: { skippedDiverged: string[]; skipped: string[]; written: unknown[] };
    };
    expect(payload.data.skippedDiverged).toEqual([WATCHED_MANAGED_FILE]);
    // Every OTHER managed file is byte-identical to the target (a plain, unaffected skip).
    expect(payload.data.skipped).not.toContain(WATCHED_MANAGED_FILE);
    expect(payload.data.skipped.length).toBeGreaterThan(0);
    // Nothing was (re)written this run beyond settings.json's own idempotent merge state.
    expect(payload.data.written).toEqual([]);
  });
});
