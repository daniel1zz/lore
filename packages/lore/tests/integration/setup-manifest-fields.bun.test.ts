// @spawns packages/lore/src/index.ts
/**
 * @spec_ref SPEC-076 §C4 (manifest version fields: `binary_version` /
 *   `installed_at` / `assets_digest`, per-entry `ownership`), §C3
 *   (check-cache invalidation, digest short-circuit interaction) — task
 *   task-skill-implement-t5-converge-hardening-diverged-skip-force, AC-076-6.
 *
 * Integration tests for `lore setup`'s manifest version-field stamping.
 * Spawns the REAL CLI via subprocess (`bun run <index.ts> setup ...`), same
 * pattern as `tests/integration/setup-check.bun.test.ts` — the AC requires
 * reachability through the registered command (real `RealAssetSource` +
 * embedded-manifest wiring), not just unit coverage of `SetupService`'s
 * pieces (already covered by `tests/unit/service/setup-service.test.ts`'s
 * in-memory-fake suite).
 *
 * SAFETY — every mutating run sets the CHILD process's `PATH: ""` (mirrors
 * `setup-check.bun.test.ts`'s own convention) via an absolute, pre-resolved
 * `bun` binary path — never lets a subprocess reach the real `claude` CLI on
 * PATH. Every scenario targets a fresh `mkdtemp` `--claude-dir` — never the
 * real `~/.claude` (2026-07-07 pollution-incident hard rule).
 *
 * Coverage:
 *   HAPPY:      a fresh `--yes` converge stamps `binary_version` (matches
 *               the running binary's embedded `LORE_BINARY_VERSION`),
 *               `assets_digest` (matches the embedded `tree_digest`), and an
 *               ISO-8601-parseable `installed_at`; a managed-kind entry
 *               carries `ownership: "managed"`.
 *   NEGATIVE:   a manifest missing `installed_at` (simulating a legacy
 *               pre-SPEC-076 manifest) gets it stamped on the VERY NEXT
 *               converge even when nothing else changed (one-time
 *               migration write, never silently left absent).
 *   BOUNDARY:   `assets_digest` is OMITTED (not merely stale) when a
 *               converge leaves ≥1 diverged file un-repaired — stamping a
 *               "fully synced" digest while a known divergence remains would
 *               let a later `--check`'s digest short-circuit wrongly report
 *               full sync.
 *   ERROR:      a corrupted existing manifest (unparsable JSON) still fails
 *               loud (`VALIDATION_ERROR`) — the pre-existing error path is
 *               unperturbed by this task's manifest-construction changes.
 *   STATE:      two consecutive no-op `--yes` converges — the second fires
 *               ZERO underlying file writes (manifest + a managed file's
 *               mtimes unchanged) and `installed_at` stays byte-identical
 *               across both runs (I2's general form, extended to cover the
 *               new version fields — a naive unconditional `nowIso` stamp
 *               would break this).
 *   REGRESSION: the three new top-level fields never bleed into a per-entry
 *               row's own shape (`entries[].keys` stays exactly
 *               `path/kind/sha256/written_at/ownership`).
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EMBEDDED_ASSETS_MANIFEST, LORE_BINARY_VERSION } from "../../src/generated/assets-manifest.js";

// ─── Path / spawn setup (mirrors setup-check.bun.test.ts) ─────────────────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

function resolveBunBin(): string {
  const resolved = Bun.which("bun");
  if (resolved === null) {
    throw new Error(
      "setup-manifest-fields.bun.test.ts: could not resolve the `bun` binary via Bun.which — is Bun installed?",
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

const MANIFEST_FILENAME = ".lore-setup-manifest.json";
/** A single managed file's POSIX-relative path — same watched entry `setup-check.bun.test.ts` uses. */
const WATCHED_MANAGED_FILE = "agents/lore-implementer.md";

interface ManifestEntry {
  path: string;
  kind: string;
  sha256: string;
  written_at: string;
  ownership?: string;
}

interface Manifest {
  version: string;
  claude_dir: string;
  entries: ManifestEntry[];
  binary_version?: string;
  installed_at?: string;
  assets_digest?: string;
}

function readManifest(targetDir: string): Manifest {
  return JSON.parse(readFileSync(join(targetDir, MANIFEST_FILENAME), "utf8")) as Manifest;
}

function writeManifest(targetDir: string, manifest: Manifest): void {
  writeFileSync(join(targetDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Fresh `--yes` converge into a never-before-installed `targetDir`. Setup registers no MCP server, so the install exits 0 (task-skill-implement-lore-setup-registers-no-tool-server-and). */
function freshInstall(scratch: string, targetDir: string): void {
  const install = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
  if (install.exitCode !== 0) {
    throw new Error(
      `freshInstall: expected the seeding install to exit 0 (task-skill-implement-lore-setup-registers-no-tool-server-and: setup registers no MCP server), got ${install.exitCode}.\nstdout: ${install.stdout}\nstderr: ${install.stderr}`,
    );
  }
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("lore setup — manifest version fields (SPEC-076 §C4) — HAPPY", () => {
  it("AC-076-6.H1: a fresh converge stamps binary_version/assets_digest/installed_at matching the running binary's embedded values", () => {
    const scratch = makeScratchDir("lore-setup-manifest-fields-happy-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const manifest = readManifest(targetDir);
    expect(manifest.binary_version).toBe(LORE_BINARY_VERSION);
    expect(manifest.assets_digest).toBe(EMBEDDED_ASSETS_MANIFEST.tree_digest);
    expect(typeof manifest.installed_at).toBe("string");
    expect(Number.isNaN(Date.parse(manifest.installed_at as string))).toBe(false);
  });

  it("AC-076-6.H2: a managed-ownership entry carries ownership: 'managed'", () => {
    const scratch = makeScratchDir("lore-setup-manifest-fields-ownership-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const manifest = readManifest(targetDir);
    const entry = manifest.entries.find((e) => e.path === WATCHED_MANAGED_FILE);
    expect(entry).toBeDefined();
    expect(entry?.ownership).toBe("managed");
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("lore setup — manifest version fields — NEGATIVE", () => {
  it("AC-076-6.N1: a legacy manifest missing installed_at gets it stamped on the very next converge, even with nothing else to write", () => {
    const scratch = makeScratchDir("lore-setup-manifest-fields-legacy-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const manifest = readManifest(targetDir);
    delete manifest.installed_at;
    writeManifest(targetDir, manifest);

    const converge = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
    expect(converge.exitCode).toBe(0); // task-skill-implement-lore-setup-registers-no-tool-server-and: no MCP leg any more

    const after = readManifest(targetDir);
    expect(typeof after.installed_at).toBe("string");
    expect(Number.isNaN(Date.parse(after.installed_at as string))).toBe(false);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("lore setup — manifest version fields — BOUNDARY", () => {
  it("AC-076-6.B1: assets_digest is OMITTED when a converge leaves a diverged file un-repaired", () => {
    const scratch = makeScratchDir("lore-setup-manifest-fields-diverged-omit-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);
    expect(readManifest(targetDir).assets_digest).toBe(EMBEDDED_ASSETS_MANIFEST.tree_digest);

    writeFileSync(join(targetDir, WATCHED_MANAGED_FILE), "MUTATED BYTES — a user edit, not the embedded content\n");

    // No --force-diverged: the mutated file is skipped-by-default (AC-076-3), so this
    // converge does NOT achieve a fully-synced state.
    const converge = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
    expect(converge.exitCode).toBe(0); // task-skill-implement-lore-setup-registers-no-tool-server-and: no MCP leg any more

    const manifest = readManifest(targetDir);
    expect(manifest.assets_digest).toBeUndefined();
    // binary_version/installed_at are unconditional — still present even though
    // assets_digest was withheld.
    expect(manifest.binary_version).toBe(LORE_BINARY_VERSION);
    expect(typeof manifest.installed_at).toBe("string");
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("lore setup — manifest version fields — ERROR", () => {
  it("AC-076-6.E1: a corrupted existing manifest still fails LOUD (VALIDATION_ERROR), unperturbed by the new manifest-construction fields", () => {
    const scratch = makeScratchDir("lore-setup-manifest-fields-corrupt-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    writeFileSync(join(targetDir, MANIFEST_FILENAME), "{ this is not valid json");

    const result = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
    expect(result.exitCode).toBe(4);
    expect(result.stderr.toLowerCase()).toContain("manifest");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("lore setup — manifest version fields — STATE (zero-write invariant, I2 extended)", () => {
  it("AC-076-6.S1 / I2: two consecutive no-op converges — the second fires zero underlying file writes and installed_at stays byte-identical", () => {
    const scratch = makeScratchDir("lore-setup-manifest-fields-zerowrite-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const manifestPath = join(targetDir, MANIFEST_FILENAME);
    const watchedFile = join(targetDir, WATCHED_MANAGED_FILE);
    const manifestMtimeBefore = statSync(manifestPath).mtimeMs;
    const fileMtimeBefore = statSync(watchedFile).mtimeMs;
    const installedAtBefore = readManifest(targetDir).installed_at;

    const second = runSetup(["--claude-dir", targetDir, "--yes", "--json"], scratch);
    expect(second.exitCode).toBe(0); // task-skill-implement-lore-setup-registers-no-tool-server-and: no MCP leg any more

    const payload = JSON.parse(second.stdout) as { data: { written: unknown[]; skipped: string[] } };
    expect(payload.data.written).toEqual([]);
    expect(payload.data.skipped.length).toBeGreaterThan(0);

    expect(statSync(manifestPath).mtimeMs).toBe(manifestMtimeBefore);
    expect(statSync(watchedFile).mtimeMs).toBe(fileMtimeBefore);
    expect(readManifest(targetDir).installed_at).toBe(installedAtBefore);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("lore setup — manifest version fields — REGRESSION", () => {
  it("AC-076-6.R1: the three new top-level fields never bleed into a per-entry row's own shape", () => {
    const scratch = makeScratchDir("lore-setup-manifest-fields-shape-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const manifest = readManifest(targetDir);
    expect(manifest.entries.length).toBeGreaterThan(0);
    for (const entry of manifest.entries) {
      const keys = Object.keys(entry).sort();
      // ownership is optional (mcp/legacy edge cases could omit it) but every entry this
      // fresh install produces DOES carry it — assert the exact five-key shape.
      expect(keys).toEqual(["kind", "ownership", "path", "sha256", "written_at"]);
    }
  });
});
