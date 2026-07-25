/**
 * @spec_ref SPEC-076 §C3 (five-state classification, `--check` CLI contract),
 *   §C6 (`SetupCheckCache` shape) — task
 *   task-skill-implement-t4-lore-setup-check-read-only-projection, AC-076-2.
 *
 * Integration tests for `lore setup --check` (read-only asset-freshness
 * projection). Spawns the REAL CLI via subprocess (`bun run <index.ts> setup
 * --check ...`), same pattern as `tests/integration/cli/setup.test.ts` — the
 * AC explicitly requires reachability THROUGH the registered command (real
 * `RealAssetSource`/embedded-manifest wiring), not just unit coverage of
 * `../../src/adapters/cli/setup-check.ts`'s pieces.
 *
 * SAFETY — every mutating step (the initial `lore setup --yes` convergence
 * that seeds each scenario's target dir) sets the CHILD process's `PATH: ""`
 * (mirrors `cli/setup.test.ts`'s own "never let a subprocess reach the real
 * `claude` CLI on PATH" convention) via an absolute, pre-resolved `bun`
 * binary path (`Bun.which("bun")`) — an empty `PATH` would otherwise also
 * make the child unable to locate a bare `"bun"` command. Every scenario
 * targets a fresh `mkdtemp` `--claude-dir` — never the real `~/.claude`
 * (project CLAUDE.md's 2026-07-07 pollution-incident hard rule).
 *
 * Coverage:
 *   HAPPY:      a fresh `--yes` converge followed by `--check` exits 0,
 *               `--json`'s `files` buckets are all empty, and the check
 *               cache file exists with `status: "sync"`.
 *   NEGATIVE:   mutating ONE managed file's on-disk bytes flips `--check` to
 *               exit 3 with `--json`'s `files.diverged` containing EXACTLY
 *               that one path; `--check --uninstall` / `--check --dry-run` /
 *               `--check --project` each exit 2, naming the rejected
 *               combination (never a silent global-only check for the
 *               `--project` case — SPEC-076 Scope-Alt).
 *   BOUNDARY:   `--check` against a target directory that was NEVER
 *               installed classifies every managed entry as `missing`
 *               (install-equivalent, SPEC-076 §C3), exit 3.
 *   ERROR:      a corrupted installed manifest (unparsable JSON) fails LOUD
 *               (`VALIDATION_ERROR`, exit 4) rather than being silently
 *               treated as a fresh target.
 *   STATE:      running `--check` twice in a row leaves the setup manifest's
 *               and a managed file's mtimes COMPLETELY unchanged — the check
 *               cache file is the sole write exception (SPEC-076 Invariant
 *               I4 / D-PLAN-4).
 *   REGRESSION: the `--json` payload's `files` object carries exactly the
 *               four documented buckets (`outdated`/`diverged`/`missing`/
 *               `orphaned` — no `sync` list leaking into the wire shape).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/** Resolves the `bun` binary's absolute path once — a named function (not an inline `if`-throw) so its `string` return type narrows correctly for every closure below that captures it (a top-level `const` narrowed only by a sibling `if` does NOT propagate into later function bodies). */
function resolveBunBin(): string {
  const resolved = Bun.which("bun");
  if (resolved === null) {
    throw new Error("setup-check.bun.test.ts: could not resolve the `bun` binary via Bun.which — is Bun installed?");
  }
  return resolved;
}
const BUN_BIN = resolveBunBin();

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns `bun run <INDEX_TS> setup ...args` in `cwd`. `PATH` defaults to `""`
 * (forces `claude` ENOENT deterministically during a seeding `--yes` install
 * — see file header) unless overridden.
 */
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

// ─── Fixture cleanup ────────────────────────────────────────────────────────

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

/** Converges a fresh `--claude-dir` via a real `--yes` install. `PATH=""` makes MCP registration fail (exit 1) — file writes still land. */
function seedConvergedTarget(scratch: string, targetDir: string): void {
  const install = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
  if (install.exitCode !== 1) {
    throw new Error(
      `seedConvergedTarget: expected the seeding install to exit 1 (files written, MCP registration ` +
        `fails under PATH=""), got ${install.exitCode}.\nstdout: ${install.stdout}\nstderr: ${install.stderr}`,
    );
  }
  if (!existsSync(join(targetDir, "agents", "lore-implementer.md"))) {
    throw new Error("seedConvergedTarget: expected agents/lore-implementer.md to exist after seeding install");
  }
}

const MANIFEST_FILENAME = ".lore-setup-manifest.json";
const CHECK_CACHE_FILENAME = ".lore-setup-check.json";
/** A single managed file's POSIX-relative path — mirrors `EmbeddedAssetEntry.path`'s own POSIX-separator convention (never `node:path.join`, which would emit backslashes on Windows). */
const WATCHED_MANAGED_FILE = "agents/lore-implementer.md";

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("lore setup --check — HAPPY", () => {
  it("AC-076-2.H1: a fresh converged install checks sync (exit 0), --json files are all empty, cache written status=sync", () => {
    const scratch = makeScratchDir("lore-setup-check-happy-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    const check = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(check.exitCode).toBe(0);

    const payload = JSON.parse(check.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.data.summary).toBe("sync");
    expect(payload.data.files.outdated).toEqual([]);
    expect(payload.data.files.diverged).toEqual([]);
    expect(payload.data.files.missing).toEqual([]);
    expect(typeof payload.data.binary_version).toBe("string");
    expect(payload.data.binary_version.length).toBeGreaterThan(0);

    const cachePath = join(targetDir, CHECK_CACHE_FILENAME);
    expect(existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(cache.status).toBe("sync");
    expect(typeof cache.checked_at).toBe("string");
    expect(typeof cache.binary_version).toBe("string");
    expect(cache.stale_counts).toBeUndefined();
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("lore setup --check — NEGATIVE", () => {
  it("AC-076-2.N1: mutating one managed file's bytes flips --check to exit 3, --json lists exactly that path under files.diverged", () => {
    const scratch = makeScratchDir("lore-setup-check-diverged-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    const mutatedFullPath = join(targetDir, WATCHED_MANAGED_FILE);
    writeFileSync(mutatedFullPath, "MUTATED BYTES — not the embedded content, this is a user-made edit\n");

    const check = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(check.exitCode).toBe(3);

    const payload = JSON.parse(check.stdout);
    expect(payload.data.summary).toBe("stale");
    expect(payload.data.files.diverged).toEqual([WATCHED_MANAGED_FILE]);
    expect(payload.data.files.outdated).toEqual([]);
    expect(payload.data.files.missing).toEqual([]);

    const cache = JSON.parse(readFileSync(join(targetDir, CHECK_CACHE_FILENAME), "utf8"));
    expect(cache.status).toBe("stale");
    expect(cache.stale_counts).toEqual({ outdated: 0, diverged: 1, missing: 0 });
  });

  it("AC-076-2.N2: --check + --uninstall exits 2, naming --uninstall", () => {
    const scratch = makeScratchDir("lore-setup-check-mutex-uninstall-");
    const result = runSetup(["--check", "--uninstall"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--uninstall");
  });

  it("AC-076-2.N3: --check + --dry-run exits 2, naming --dry-run", () => {
    const scratch = makeScratchDir("lore-setup-check-mutex-dryrun-");
    const result = runSetup(["--check", "--dry-run"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--dry-run");
  });

  it("AC-076-2.N4: --check + --project exits 2, naming the unsupported combination (Scope-Alt, never a silent global-only check)", () => {
    const scratch = makeScratchDir("lore-setup-check-mutex-project-");
    const result = runSetup(["--check", "--project"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--project");
    expect(result.stderr.toLowerCase()).toContain("not supported");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("lore setup --check — BOUNDARY", () => {
  it("AC-076-2.B1: --check against a NEVER-installed target classifies every managed entry as missing (exit 3)", () => {
    const scratch = makeScratchDir("lore-setup-check-empty-");
    const targetDir = join(scratch, ".claude"); // deliberately never seeded

    const result = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(result.exitCode).toBe(3);

    const payload = JSON.parse(result.stdout);
    expect(payload.data.summary).toBe("stale");
    expect(payload.data.files.missing.length).toBeGreaterThan(0);
    expect(payload.data.files.diverged).toEqual([]);
    expect(payload.data.files.outdated).toEqual([]);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("lore setup --check — ERROR", () => {
  it("AC-076-2.E1: a corrupted installed manifest fails LOUD (VALIDATION_ERROR, exit 4), never silently treated as fresh", () => {
    const scratch = makeScratchDir("lore-setup-check-corrupt-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    writeFileSync(join(targetDir, MANIFEST_FILENAME), "{ this is not valid json");

    const result = runSetup(["--check", "--claude-dir", targetDir], scratch);
    expect(result.exitCode).toBe(4);
    expect(result.stderr.toLowerCase()).toContain("manifest");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("lore setup --check — STATE (zero-write invariant)", () => {
  it("AC-076-2.S1: running --check twice leaves the manifest and a managed file's mtimes unchanged — the cache file is the sole write exception", () => {
    const scratch = makeScratchDir("lore-setup-check-zerowrite-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    const manifestPath = join(targetDir, MANIFEST_FILENAME);
    const watchedFile = join(targetDir, WATCHED_MANAGED_FILE);
    const manifestMtimeBefore = statSync(manifestPath).mtimeMs;
    const fileMtimeBefore = statSync(watchedFile).mtimeMs;

    const first = runSetup(["--check", "--claude-dir", targetDir], scratch);
    expect(first.exitCode).toBe(0);
    const second = runSetup(["--check", "--claude-dir", targetDir], scratch);
    expect(second.exitCode).toBe(0);

    expect(statSync(manifestPath).mtimeMs).toBe(manifestMtimeBefore);
    expect(statSync(watchedFile).mtimeMs).toBe(fileMtimeBefore);
    // The check cache file itself is the documented sole write exception — it must exist,
    // but its own mtime is deliberately NOT asserted unchanged (it IS rewritten every run).
    expect(existsSync(join(targetDir, CHECK_CACHE_FILENAME))).toBe(true);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("lore setup --check — REGRESSION", () => {
  it("AC-076-2.R1: --json's files object carries exactly the four documented buckets (no leaked sync list)", () => {
    const scratch = makeScratchDir("lore-setup-check-shape-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    const result = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    const payload = JSON.parse(result.stdout);

    expect(Object.keys(payload.data.files).sort()).toEqual(["diverged", "missing", "orphaned", "outdated"]);
    // `installed_binary_version`/`installed_at` are OPTIONAL (absent when the installed
    // manifest doesn't carry them, e.g. before SPEC-076 T5's manifest-field-population lands)
    // — this run's manifest has neither, so only the three always-present keys show up.
    expect(Object.keys(payload.data).sort()).toEqual(["binary_version", "files", "summary"]);
  });
});
