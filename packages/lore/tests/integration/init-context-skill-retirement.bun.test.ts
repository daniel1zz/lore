/**
 * RED-phase e2e for the `lore-init-context` skill retirement (AC-CTX-6, task
 * `task-skill-test-red-hook-trip-and-skill-retirement-integration`; paired
 * implementation task `task-skill-implement-guard-hook-asset-registration-
 * skill`, not yet landed as of this file's authoring — confirmed empirically
 * below: `assets/skills/lore-init-context/SKILL.md` is NOT yet a member of
 * `RETIRED_FROM_INSTALL_PATHS`, real-asset-source.ts).
 *
 * bun test (not vitest): spawns the REAL CLI from source (`bun run
 * <index.ts> setup ...`), same harness as `setup-converge-diverged.bun.
 * test.ts` — reachability through the registered command with the real
 * `RealAssetSource`/embedded-manifest wiring, never `dist/lore` (no build
 * step needed for this suite; the compiled binary is unrelated to whether
 * `lore-init-context` is excluded from the asset walk, which is a pure
 * TS-level exclusion set). SAFETY: every mutating run sets the child
 * process's `PATH: ""` (never lets a subprocess reach a real `claude` CLI on
 * PATH — mirrors the precedent's safety note) and every scenario targets a
 * fresh `mkdtemp` `--claude-dir`, never the real `~/.claude`.
 *
 * Mechanism under test: `SetupService.install()`'s orphan-pruning (SPEC-076
 * §C5 T7, `setup-service.ts` module doc) computes `removals` as "tracked in
 * the on-disk manifest but absent from the CURRENT asset payload" — this is
 * a GENERAL mechanism over every `SetupEntryKind`, not hooks-specific (see
 * `stripMcpEntries`'s doc comment: "that pure function's `removals`
 * computation is... tracked in `current` but absent from `payload`"). Once
 * `lore-init-context` is added to `RETIRED_FROM_INSTALL_PATHS`
 * (`real-asset-source.ts`), `RealAssetSource.load()` stops yielding
 * `skills/lore-init-context/SKILL.md` at all, so a SECOND converge run over
 * a target that has it from a PRIOR install classifies it as an orphan and
 * removes it. Fixture strategy: install ONCE against the CURRENT (pre-
 * retirement) real `assets/` tree — this simulates "a previously-installed
 * lore-init-context skill" using the actual on-disk shape `lore setup`
 * itself produces (real manifest, real file), not a hand-rolled synthetic
 * shape that could drift from what the installer actually writes — then
 * converge a SECOND time and assert the file is gone.
 *
 * Coverage dimensions:
 *   HAPPY:      fixture-sanity control — a fresh install DOES write
 *               `skills/lore-init-context/SKILL.md` today (proves the
 *               fixture itself is real, not accidentally already retired).
 *   BOUNDARY:   the true RED case — a SECOND converge run over that target
 *               must remove the file. FAILS today (retirement not wired).
 *   STATE:      the `--dry-run --json` plan explicitly lists the skill file
 *               under `data.plan.removals` once installed. FAILS today
 *               (payload still yields it, so the removals plan is empty).
 *   NEGATIVE:   the same converge run does NOT remove a sibling managed file
 *               (`agents/lore-implementer.md`) — proves this isn't a
 *               blanket "wipe everything" regression once retirement DOES
 *               land; passes both before and after.
 *   ERROR:      n/a beyond the shared CLI-usage mutex already covered by
 *               `setup-converge-diverged.bun.test.ts`'s own ERROR dimension
 *               for this same command surface.
 *   REGRESSION: `node scripts/embed-assets-manifest.mjs --check` still exits
 *               0 in THIS worktree — proves this suite's own presence
 *               doesn't itself desynchronize the embedded manifest (the
 *               paired implement task regenerates it after adding the
 *               exclusion; this suite never edits `assets/` itself).
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore AC-CTX-6, D10
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Path / spawn setup (mirrors setup-converge-diverged.bun.test.ts) ──────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
// packages/lore/ -> repo root is 2 levels up.
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");

const SKILL_RELATIVE_PATH = join("skills", "lore-init-context", "SKILL.md");
const SIBLING_MANAGED_FILE = join("agents", "lore-implementer.md");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function resolveBunBin(): string {
  const resolved = Bun.which("bun");
  if (resolved === null) {
    throw new Error(
      "init-context-skill-retirement.bun.test.ts: could not resolve the `bun` binary via Bun.which — is Bun installed?",
    );
  }
  return resolved;
}
const BUN_BIN = resolveBunBin();

function runSetup(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: "" },
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
      // best-effort
    }
  }
});

/** Fresh `--yes` converge into a never-before-installed `targetDir`, simulating "a previously-installed lore-init-context skill" via the REAL installer. `PATH=""` makes MCP registration fail (exit 1) — file writes still land, mirroring `setup-converge-diverged.bun.test.ts`'s `freshInstall`. */
function freshInstall(scratch: string, targetDir: string): void {
  const install = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
  if (install.exitCode !== 1) {
    throw new Error(
      `freshInstall: expected the seeding install to exit 1 (files written, MCP registration fails under ` +
        `PATH=""), got ${install.exitCode}.\nstdout: ${install.stdout}\nstderr: ${install.stderr}`,
    );
  }
}

// ─── HAPPY (fixture sanity) ─────────────────────────────────────────────────

describe("init-context skill retirement — HAPPY (fixture sanity)", () => {
  it("a fresh install writes skills/lore-init-context/SKILL.md today — the fixture genuinely simulates a prior, not-yet-retired install", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-happy-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    expect(existsSync(join(targetDir, SKILL_RELATIVE_PATH))).toBe(true);
  });
});

// ─── BOUNDARY (RED — the retirement case) ──────────────────────────────────

describe("init-context skill retirement — BOUNDARY (RED)", () => {
  it("a SECOND converge run over a previously-installed target removes skills/lore-init-context/SKILL.md — FAILS today because lore-init-context is not yet in RETIRED_FROM_INSTALL_PATHS", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-boundary-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);
    expect(existsSync(join(targetDir, SKILL_RELATIVE_PATH))).toBe(true); // sanity: it's really there before the converge

    runSetup(["--claude-dir", targetDir, "--yes"], scratch);

    expect(existsSync(join(targetDir, SKILL_RELATIVE_PATH))).toBe(false);
  });

  it("the whole skills/lore-init-context/ directory is pruned once its only file is removed — FAILS today (directory survives, still populated)", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-boundary-dir-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    runSetup(["--claude-dir", targetDir, "--yes"], scratch);

    expect(existsSync(join(targetDir, "skills", "lore-init-context"))).toBe(false);
  });
});

// ─── STATE (RED — the dry-run plan) ────────────────────────────────────────

describe("init-context skill retirement — STATE (RED, dry-run removals plan)", () => {
  it("`--dry-run --json`'s plan.removals lists skills/lore-init-context/SKILL.md once installed — FAILS today (payload still yields it, so removals is empty)", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-state-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    const dryRun = runSetup(["--claude-dir", targetDir, "--dry-run", "--json"], scratch);
    expect(dryRun.exitCode).toBe(0);

    const payload = JSON.parse(dryRun.stdout) as { data: { plan: { removals: string[] } } };
    // AssetFile.path (and therefore InstallPlan.removals) is always POSIX-joined
    // (real-asset-source.ts's own invariant) — this suite only runs on POSIX
    // (macOS/Linux) CI/dev machines, where node:path's `join` already produces
    // `/`-separated output, so SKILL_RELATIVE_PATH needs no extra normalization.
    expect(payload.data.plan.removals).toContain(SKILL_RELATIVE_PATH);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("init-context skill retirement — NEGATIVE", () => {
  it("the same converge run does NOT remove a sibling managed file (agents/lore-implementer.md) — not a blanket wipe", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-negative-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);
    expect(existsSync(join(targetDir, SIBLING_MANAGED_FILE))).toBe(true);

    runSetup(["--claude-dir", targetDir, "--yes"], scratch);

    expect(existsSync(join(targetDir, SIBLING_MANAGED_FILE))).toBe(true);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("init-context skill retirement — REGRESSION", () => {
  it("node scripts/embed-assets-manifest.mjs --check still exits 0 in this worktree (this suite never edits assets/, so the embedded manifest stays fresh)", () => {
    const proc = Bun.spawnSync(["node", join(REPO_ROOT, "scripts", "embed-assets-manifest.mjs"), "--check"], {
      cwd: REPO_ROOT,
    });
    expect(proc.exitCode).toBe(0);
  });
});
