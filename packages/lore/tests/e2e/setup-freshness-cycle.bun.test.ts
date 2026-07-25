/**
 * @spec_ref SPEC-076 §C3 (five-state classification, `--check` CLI contract,
 *   digest-equality short-circuit), §C7 (`lore setup --yes` IS the converge
 *   verb) — task task-skill-test-t9-compiled-binary-e2e-freshness-cycle,
 *   AC-076-10.
 *
 * Compiled-binary end-to-end cycle: spawns the COMPILED `dist/lore` binary
 * directly (`Bun.spawnSync([LORE_BIN, ...])`), never `bun run src/index.ts` —
 * mirrors `tests/integration/cli/slugify-compiled.bun.test.ts`'s AC-068-10
 * precedent and `tests/integration/gate-hooks.bun.test.ts`'s compiled-binary
 * harness. Every OTHER SPEC-076 integration suite
 * (`setup-check.bun.test.ts`, `setup-converge-diverged.bun.test.ts`, ...)
 * spawns `bun run <index.ts> setup ...` from SOURCE — none of them exercise
 * the actual artifact a real install runs. This is the first and only one
 * that does, closing the same "compiled binary never independently verified"
 * gap AC-068-10 closed for `slugify` (SPEC-068's own hotfix precedent:
 * dev-mode-only coverage missed a `/$bunfs/` resolution defect that ONLY
 * reproduced from the compiled artifact).
 *
 * Freshness guard (SPEC-061 lesson — a stale `dist/lore` is a false oracle:
 * it would silently validate PRE-change compiled logic against CURRENT
 * source): `beforeAll` calls `assertFreshBinary`, throwing loud before any
 * test body runs if `dist/lore` is missing or older than the newest `.ts`
 * source under `packages/{lore,core}/src` — run `bun run build` (repo root)
 * first.
 *
 * Digest short-circuit nuance (carried over verbatim from
 * `setup-check.bun.test.ts`'s own documented precondition — see that file's
 * NEGATIVE-scenario comment for the full derivation): `--check`'s
 * `planUpdate` call short-circuits to "sync" whenever the installed
 * manifest's `assets_digest` (stamped at the LAST successful converge)
 * equals the CURRENTLY-RUNNING binary's embedded `tree_digest` — a
 * whole-tree equality check against a STORED value, never a live
 * recomputation of on-disk bytes. Since this suite's seeding install and its
 * own `--check` calls are the SAME build, that stamped `assets_digest`
 * trivially still matches after we hand-edit a file on disk. The mutation
 * scenario therefore strips `assets_digest` from the on-disk manifest FIRST
 * (representing "no full converge has re-verified this target since the
 * out-of-band edit"), the realistic precondition under which `--check` is
 * expected to fall through to full per-entry classification.
 * `SetupService.install`'s own converge decision does NOT depend on this
 * field — it always classifies fresh, so the force-diverged converge
 * scenario needs no such workaround.
 *
 * SAFETY — every mutating run (`--yes`) sets the CHILD process's `PATH: ""`
 * (mirrors `setup-check.bun.test.ts`/`setup-converge-diverged.bun.test.ts`'s
 * own "never let a subprocess reach the real `claude` CLI on PATH"
 * convention — an empty `PATH` also makes the child unable to locate a bare
 * `"bun"` command, irrelevant here since we spawn the compiled binary
 * directly, no `bun run` wrapper). Every scenario targets a fresh `mkdtemp`
 * `--claude-dir` — NEVER the real `~/.claude` (project CLAUDE.md's
 * 2026-07-07 pollution-incident hard rule); the repo's own `.lore/` corpus
 * is never touched at all (`setup` targets a Claude Code config directory,
 * unrelated to any corpus).
 *
 * Coverage:
 *   HAPPY:      a fresh `--yes` converge against a throwaway `--claude-dir`
 *               followed by `--check` exits 0, `--json`'s `files` buckets
 *               are all empty.
 *   NEGATIVE:   mutating ONE managed file's on-disk bytes (after stripping
 *               the stamped `assets_digest`, see above) flips `--check` to
 *               exit 3, `--json`'s `files.diverged` containing EXACTLY that
 *               one path — and no other bucket.
 *   STATE:      `lore setup --yes --force-diverged` over that SAME diverged
 *               file restores its sha256 to the embedded target, leaves a
 *               backup of the user's edited version under `.lore-backups`,
 *               and a FOLLOW-UP `--check` exits 0 again (files buckets all
 *               empty) — closing the full cycle the AC describes.
 *   BOUNDARY:   `--check` against a target directory that was NEVER
 *               installed (no manifest at all) classifies every managed
 *               entry as `missing` (install-equivalent, SPEC-076 §C3),
 *               exit 3 — through the compiled binary, not just source mode.
 *   ERROR:      a corrupted installed manifest (unparsable JSON) fails LOUD
 *               (`VALIDATION_ERROR`, exit 4) through the compiled binary too
 *               — re-runs `setup-check.bun.test.ts` AC-076-2.E1's own
 *               assertion end-to-end against the real artifact.
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors tests/integration/gate-hooks.bun.test.ts's own REPO_ROOT derivation
// (tests/e2e/ and tests/integration/ are sibling dirs at the same depth).
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const REPO_ASSETS_ROOT = join(REPO_ROOT, "assets");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the COMPILED `dist/lore setup ...args` directly. `PATH` defaults to `""` (forces `claude` MCP-registration ENOENT deterministically on any `--yes` run) unless overridden. */
function runSetup(args: string[], cwd: string, envOverrides: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: "", ...envOverrides },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
      /* best-effort cleanup */
    }
  }
});

const MANIFEST_FILENAME = ".lore-setup-manifest.json";
const WATCHED_MANAGED_FILE = "agents/lore-implementer.md";
const MUTATED_BYTES = "MUTATED BYTES — not the embedded content, this is a user-made edit (T9 e2e)\n";

/** Fresh `--yes` converge into a never-before-installed `targetDir`. MCP registration fails under `PATH=""` (exit 1) — file writes still land. */
function freshInstall(scratch: string, targetDir: string): void {
  const install = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
  if (install.exitCode !== 1) {
    throw new Error(
      `freshInstall: expected the seeding install to exit 1 (files written, MCP registration fails under ` +
        `PATH=""), got ${install.exitCode}.\nstdout: ${install.stdout}\nstderr: ${install.stderr}`,
    );
  }
  if (!existsSync(join(targetDir, WATCHED_MANAGED_FILE))) {
    throw new Error(`freshInstall: expected ${WATCHED_MANAGED_FILE} to exist after seeding install`);
  }
}

/** Strips the stamped `assets_digest` from the installed manifest — see file header's "Digest short-circuit nuance". */
function stripAssetsDigest(targetDir: string): void {
  const manifestPath = join(targetDir, MANIFEST_FILENAME);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  delete manifest["assets_digest"];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

interface SetupCheckPayload {
  ok: boolean;
  data: {
    summary: "sync" | "stale";
    files: { outdated: string[]; diverged: string[]; missing: string[]; orphaned: string[] };
  };
}

// ─── Freshness guard (SPEC-061 lesson) ─────────────────────────────────────

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("AC-076-10: compiled dist/lore setup-freshness cycle — HAPPY", () => {
  it("a fresh --yes converge against a throwaway --claude-dir reports sync (--check exit 0, all buckets empty)", () => {
    const scratch = makeScratchDir("lore-e2e-freshness-happy-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const check = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(check.exitCode).toBe(0);

    const payload = JSON.parse(check.stdout) as SetupCheckPayload;
    expect(payload.data.summary).toBe("sync");
    expect(payload.data.files.outdated).toEqual([]);
    expect(payload.data.files.diverged).toEqual([]);
    expect(payload.data.files.missing).toEqual([]);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("AC-076-10: compiled dist/lore setup-freshness cycle — NEGATIVE", () => {
  it("mutating one managed file's bytes flips --check to exit 3, --json lists exactly that path under files.diverged", () => {
    const scratch = makeScratchDir("lore-e2e-freshness-diverged-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);
    stripAssetsDigest(targetDir);

    const mutatedFullPath = join(targetDir, WATCHED_MANAGED_FILE);
    writeFileSync(mutatedFullPath, MUTATED_BYTES);

    const check = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(check.exitCode).toBe(3);

    const payload = JSON.parse(check.stdout) as SetupCheckPayload;
    expect(payload.data.summary).toBe("stale");
    expect(payload.data.files.diverged).toEqual([WATCHED_MANAGED_FILE]);
    expect(payload.data.files.outdated).toEqual([]);
    expect(payload.data.files.missing).toEqual([]);
  });
});

// ─── STATE (full cycle closure) ─────────────────────────────────────────────

describe("AC-076-10: compiled dist/lore setup-freshness cycle — STATE", () => {
  it("lore setup --yes --force-diverged restores the diverged file's sha256 and a follow-up --check exits 0 again", () => {
    const scratch = makeScratchDir("lore-e2e-freshness-force-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);
    stripAssetsDigest(targetDir);

    const mutatedFullPath = join(targetDir, WATCHED_MANAGED_FILE);
    writeFileSync(mutatedFullPath, MUTATED_BYTES);

    // Confirm the pre-force state really is diverged (exit 3) before forcing —
    // otherwise a no-op force-diverged run could vacuously "pass" this test.
    const preForceCheck = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(preForceCheck.exitCode).toBe(3);
    const preForcePayload = JSON.parse(preForceCheck.stdout) as SetupCheckPayload;
    expect(preForcePayload.data.files.diverged).toEqual([WATCHED_MANAGED_FILE]);

    const expectedSha = sha256OfFile(join(REPO_ASSETS_ROOT, WATCHED_MANAGED_FILE));
    const force = runSetup(["--claude-dir", targetDir, "--yes", "--force-diverged", "--json"], scratch);
    expect(force.exitCode).toBe(1); // MCP registration still fails under PATH=""

    // Bytes restored to the embedded target — never left at the mutated value.
    expect(sha256OfFile(mutatedFullPath)).toBe(expectedSha);
    expect(readFileSync(mutatedFullPath, "utf8")).not.toBe(MUTATED_BYTES);

    const forcePayload = JSON.parse(force.stdout) as { data: { skippedDiverged: string[]; backups: string[] } };
    expect(forcePayload.data.skippedDiverged).toEqual([]);
    expect(forcePayload.data.backups).toContain(WATCHED_MANAGED_FILE);
    expect(existsSync(join(targetDir, ".lore-backups"))).toBe(true);

    // Full cycle closure — --check reports sync again, all buckets empty.
    const postForceCheck = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(postForceCheck.exitCode).toBe(0);
    const postForcePayload = JSON.parse(postForceCheck.stdout) as SetupCheckPayload;
    expect(postForcePayload.data.summary).toBe("sync");
    expect(postForcePayload.data.files.diverged).toEqual([]);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("AC-076-10: compiled dist/lore setup-freshness cycle — BOUNDARY", () => {
  it("--check against a NEVER-installed target classifies every managed entry as missing (exit 3)", () => {
    const scratch = makeScratchDir("lore-e2e-freshness-neverinstalled-");
    const targetDir = join(scratch, ".claude"); // deliberately never seeded

    const check = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(check.exitCode).toBe(3);

    const payload = JSON.parse(check.stdout) as SetupCheckPayload;
    expect(payload.data.summary).toBe("stale");
    expect(payload.data.files.missing.length).toBeGreaterThan(0);
    expect(payload.data.files.diverged).toEqual([]);
    expect(payload.data.files.outdated).toEqual([]);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("AC-076-10: compiled dist/lore setup-freshness cycle — ERROR", () => {
  it("a corrupted installed manifest fails LOUD through the compiled binary (VALIDATION_ERROR, exit 4), never silently treated as fresh", () => {
    const scratch = makeScratchDir("lore-e2e-freshness-corrupt-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    writeFileSync(join(targetDir, MANIFEST_FILENAME), "{ this is not valid json");

    const check = runSetup(["--check", "--claude-dir", targetDir], scratch);
    expect(check.exitCode).toBe(4);
    expect(check.stderr.toLowerCase()).toContain("manifest");
  });
});
