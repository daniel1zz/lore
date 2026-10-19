// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-defect-clusters-round-2-part-a-sessions-seats-setup-init D3 — AC-DC2-3
 *   (BR-975, BR-846, BR-848): install, check and flag validation agree about retired
 *   files (tracked by the ledger, no longer shipped) and unreadable ledgers.
 *
 * Every case runs the REAL CLI against a fresh mkdtemp `--claude-dir` (never the real
 * `~/.claude`). The ledger is seeded with a path X the payload never ships:
 *   - X is "retired". The SIMPLEST GREEN-BUT-BROKEN fixtures (an unedited retired file;
 *     a retired file already gone from disk) pass even with the old unconditional
 *     removal, so the fixtures here use an EDITED, PRESENT file.
 *
 * A `claude` shim on PATH exits 0 so MCP registration succeeds and a clean converge exits 0.
 */

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SPEC = "spec-defect-clusters-round-2-part-a-sessions-seats-setup-init";
const MANIFEST = ".lore-setup-manifest.json";
const X = "skills/retired-x/SKILL.md";
const CONTENT_A = "retired file as lore wrote it\n";
const CONTENT_B = "retired file edited by the user\n";

const BUN_BIN = Bun.which("bun") ?? (() => { throw new Error("bun not found"); })();
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

interface RunResult { stdout: string; stderr: string; exitCode: number }

const scratch: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    try {
      chmodSync(join(dir, MANIFEST), 0o600);
    } catch { /* not a claude dir, or already gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

let shimDir: string | undefined;
afterAll(() => {
  if (shimDir !== undefined) rmSync(shimDir, { recursive: true, force: true });
});
function pathWithClaudeShim(): string {
  if (shimDir === undefined) {
    shimDir = mkdtempSync(join(tmpdir(), "dc2-claude-shim-"));
    const shim = join(shimDir, "claude");
    writeFileSync(shim, "#!/bin/sh\nexit 0\n");
    chmodSync(shim, 0o755);
  }
  return shimDir;
}

function lore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: pathWithClaudeShim() },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

/** A converged target whose ledger additionally tracks X (sha A), with X on disk as `disk` (or absent). */
function targetTrackingRetired(disk: string | null): { cwd: string; dir: string } {
  const cwd = tmp("dc2-cwd-");
  const dir = tmp("dc2-claude-");
  const seed = lore(["--claude-dir", dir, "--yes"], cwd);
  if (seed.exitCode !== 0) throw new Error(`seed install failed (${seed.exitCode}): ${seed.stdout}\n${seed.stderr}`);

  const manifestPath = join(dir, MANIFEST);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { entries: unknown[]; assets_digest?: string };
  manifest.entries.push({ path: X, kind: "skill", sha256: sha(CONTENT_A), written_at: "2026-01-01T00:00:00.000Z" });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (disk !== null) {
    mkdirSync(dirname(join(dir, X)), { recursive: true });
    writeFileSync(join(dir, X), disk);
  }
  return { cwd, dir };
}

function backupFiles(dir: string): string[] {
  const root = join(dir, ".lore-backups");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(current, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out;
}

describe(`${SPEC}#AC-DC2-3`, () => {
  it(`${SPEC}#AC-DC2-3 (a) an edited retired file is kept and listed as skipped (diverged)`, () => {
    const { cwd, dir } = targetTrackingRetired(CONTENT_B);

    const run = lore(["--claude-dir", dir, "--yes", "--json"], cwd);

    expect(run.exitCode).toBe(0);
    expect(readFileSync(join(dir, X), "utf8")).toBe(CONTENT_B);
    const receipt = (JSON.parse(run.stdout) as { data: { skippedDiverged: string[]; removed: string[] } }).data;
    expect(receipt.skippedDiverged).toContain(X);
    expect(receipt.removed).not.toContain(X);
  }, 120_000);

  it(`${SPEC}#AC-DC2-3 (a) --force-diverged backs the edited retired file up, removes it, and lists it under Removed:`, () => {
    const { cwd, dir } = targetTrackingRetired(CONTENT_B);

    const run = lore(["--claude-dir", dir, "--yes", "--force-diverged"], cwd);

    expect(run.exitCode).toBe(0);
    expect(existsSync(join(dir, X))).toBe(false);
    const backup = backupFiles(dir).find((rel) => rel.endsWith(`/${X}`));
    expect(backup).toBeDefined();
    expect(readFileSync(join(dir, ".lore-backups", backup as string), "utf8")).toBe(CONTENT_B);
    const removedSection = run.stdout.split("Removed:")[1] ?? "";
    expect(removedSection.split("\n\n")[0]).toContain(X);
  }, 120_000);

  it(`${SPEC}#AC-DC2-3 (a) STATE: a second converge still keeps the edited retired file`, () => {
    const { cwd, dir } = targetTrackingRetired(CONTENT_B);
    lore(["--claude-dir", dir, "--yes"], cwd);

    const again = lore(["--claude-dir", dir, "--yes", "--json"], cwd);

    expect(again.exitCode).toBe(0);
    expect(readFileSync(join(dir, X), "utf8")).toBe(CONTENT_B);
    expect((JSON.parse(again.stdout) as { data: { skippedDiverged: string[] } }).data.skippedDiverged).toContain(X);
  }, 120_000);

  it(`${SPEC}#AC-DC2-3 (a) REGRESSION: an unedited retired file is still removed`, () => {
    const { cwd, dir } = targetTrackingRetired(CONTENT_A);

    const run = lore(["--claude-dir", dir, "--yes", "--json"], cwd);

    expect(run.exitCode).toBe(0);
    expect(existsSync(join(dir, X))).toBe(false);
    expect((JSON.parse(run.stdout) as { data: { removed: string[] } }).data.removed).toEqual([X]);
  }, 120_000);

  it(`${SPEC}#AC-DC2-3 (b) --check reports an unedited retired file as retired and the summary stale`, () => {
    const { cwd, dir } = targetTrackingRetired(CONTENT_A);

    const check = lore(["--claude-dir", dir, "--check", "--json"], cwd);

    expect(check.exitCode).toBe(3);
    const data = (JSON.parse(check.stdout) as { data: { summary: string; files: { retired: string[] } } }).data;
    expect(data.files.retired).toEqual([X]);
    expect(data.summary).toBe("stale");
  }, 120_000);

  it(`${SPEC}#AC-DC2-3 (b) BOUNDARY: a retired path already absent from disk leaves --check in sync`, () => {
    const { cwd, dir } = targetTrackingRetired(null);

    const check = lore(["--claude-dir", dir, "--check", "--json"], cwd);

    // Exit code deliberately not asserted: a clean asset check lets the GitHub-channel probe
    // (unreachable in this sandbox) decide the exit.
    const data = (JSON.parse(check.stdout) as { data: { summary: string; files: { retired: string[] } } }).data;
    expect(data.files.retired).toEqual([]);
    expect(data.summary).toBe("sync");
  }, 120_000);

  it(`${SPEC}#AC-DC2-3 (c) --force-diverged with --dry-run, --uninstall or --project exits 2 naming both flags`, () => {
    const cwd = tmp("dc2-cwd-");
    const dir = tmp("dc2-claude-");
    const combos: Array<{ args: string[]; other: string }> = [
      { args: ["--claude-dir", dir, "--dry-run", "--force-diverged"], other: "--dry-run" },
      { args: ["--claude-dir", dir, "--uninstall", "--force-diverged", "--yes"], other: "--uninstall" },
      { args: ["--project", "--force-diverged", "--yes"], other: "--project" },
    ];
    for (const { args, other } of combos) {
      const run = lore(args, cwd);
      expect(run.exitCode, `${args.join(" ")}\n${run.stderr}`).toBe(2);
      expect(run.stderr).toContain("--force-diverged");
      expect(run.stderr).toContain(other);
    }
  }, 120_000);

  it(`${SPEC}#AC-DC2-3 (d) an unreadable manifest exits 1 naming it; a deleted manifest is a fresh target (exit 3)`, () => {
    const { cwd, dir } = targetTrackingRetired(CONTENT_A);
    const manifestPath = join(dir, MANIFEST);

    chmodSync(manifestPath, 0o000);
    const unreadable = lore(["--claude-dir", dir, "--check"], cwd);
    chmodSync(manifestPath, 0o600);
    expect(unreadable.exitCode).toBe(1);
    expect(unreadable.stderr).toContain(manifestPath);

    // Deleted manifest = a fresh target: nothing installed, so every shipped file is missing.
    const emptyDir = tmp("dc2-claude-fresh-");
    const fresh = lore(["--claude-dir", emptyDir, "--check"], cwd);
    expect(fresh.exitCode).toBe(3);
    expect(fresh.stderr).not.toContain(MANIFEST);
  }, 120_000);
});
