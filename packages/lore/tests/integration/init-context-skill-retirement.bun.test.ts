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
 * `skills/lore-init-context/SKILL.md` at all — for EVERY call, including a
 * truly fresh one, since that port is a pure function of `assets/`'s file
 * tree with zero knowledge of a given target's install history.
 *
 * ⛔ Fixture strategy, REVISED from this suite's original RED-phase design
 * (empirically proven inconsistent — see below): the original plan was
 * "install ONCE against the CURRENT (pre-retirement) real `assets/` tree...
 * then converge a SECOND time and assert the file is gone" using ONLY
 * `lore setup`'s real installer for both calls. That is unsatisfiable the
 * moment the retirement fix and this test run from the SAME worktree/binary:
 * `RealAssetSource.load()` is a pure, target-agnostic function, so a
 * "fresh" call and a "converge" call against an UNCHANGED `assets/` tree
 * necessarily see the IDENTICAL payload — there is no in-process way for
 * call 1 to write the file and call 2 to see it as absent-from-payload
 * without something on disk changing in between (confirmed empirically: a
 * naive `freshInstall` + `freshInstall` never once wrote the file, since
 * it's excluded from the very first call). The scenario this suite genuinely
 * needs to model — "a machine that has `lore-init-context` installed by an
 * OLDER, pre-retirement `lore` release, now upgrades and converges" —
 * inherently spans TWO DIFFERENT BINARY VERSIONS, which a single `bun test`
 * process running ONE binary cannot literally reproduce by calling the
 * installer twice.
 *
 * `seedPriorSkillInstall` (below) resolves this the same way any migration
 * test seeds a "before" state it cannot organically produce with current
 * code: `freshInstall` runs the REAL, CURRENT installer first (so every
 * OTHER file — the sibling managed file the NEGATIVE case checks, the
 * manifest's own shape — is genuinely what `lore setup` produces), then this
 * helper reads that REAL manifest back, appends ONE additional entry (same
 * `setupEntrySchema` shape every other entry uses, computed the identical
 * way `SetupService` computes it — sha256 of the actual bytes written) and
 * writes the skill file itself — reproducing exactly what an OLDER release's
 * install would have additionally left on disk, without hand-rolling an
 * unrelated manifest shape from scratch.
 *
 * Coverage dimensions:
 *   HAPPY:      a fresh install, from a target with NO prior state, never
 *               writes `skills/lore-init-context/SKILL.md` — confirms the
 *               retirement is effective from the very first install, not
 *               only on a converge over a previously-seeded target.
 *   BOUNDARY:   the true case — a SECOND converge run over a target seeded
 *               with a simulated prior (pre-retirement) install must remove
 *               the file.
 *   STATE:      the `--dry-run --json` plan explicitly lists the skill file
 *               under `data.plan.removals` once seeded.
 *   NEGATIVE:   the same converge run does NOT remove a sibling managed file
 *               (`agents/lore-implementer.md`) — proves this isn't a
 *               blanket "wipe everything" regression.
 *   ERROR:      n/a beyond the shared CLI-usage mutex already covered by
 *               `setup-converge-diverged.bun.test.ts`'s own ERROR dimension
 *               for this same command surface.
 *   REGRESSION: `bun scripts/embed-assets-manifest.mjs --check` still exits
 *               0 in THIS worktree — proves this suite's own presence
 *               doesn't itself desynchronize the embedded manifest (the
 *               paired implement task regenerates it after adding the
 *               exclusion; this suite never edits `assets/` itself).
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore AC-CTX-6, D10
 */

import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const MANIFEST_FILENAME = ".lore-setup-manifest.json";

/**
 * Simulates "this target already has `lore-init-context` installed by an
 * OLDER, pre-retirement `lore` release" — see this module's header for why a
 * real double-`freshInstall` cannot organically produce this state once the
 * retirement fix and this test share one binary. MUST run AFTER a real
 * `freshInstall` against the SAME `targetDir` (this reads that install's
 * genuine `.lore-setup-manifest.json` and appends to it, rather than
 * fabricating the whole manifest shape from nothing).
 *
 * @param targetDir - The `--claude-dir` target `freshInstall` already ran against.
 */
function seedPriorSkillInstall(targetDir: string): void {
  const skillDir = join(targetDir, "skills", "lore-init-context");
  mkdirSync(skillDir, { recursive: true });
  const content = "# Context Layer Initialization\n\n(simulated pre-retirement install fixture)\n";
  writeFileSync(join(skillDir, "SKILL.md"), content);

  const manifestPath = join(targetDir, MANIFEST_FILENAME);
  const manifestRaw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as { entries: Array<Record<string, unknown>> };
  manifest.entries.push({
    path: SKILL_RELATIVE_PATH,
    kind: "skill",
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    written_at: new Date(0).toISOString(),
    ownership: "managed",
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// ─── HAPPY (retirement effective from a clean install) ─────────────────────

describe("init-context skill retirement — HAPPY", () => {
  it("a fresh install, from a target with no prior state, never writes skills/lore-init-context/SKILL.md", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-happy-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);

    expect(existsSync(join(targetDir, SKILL_RELATIVE_PATH))).toBe(false);
  });
});

// ─── BOUNDARY (the retirement case) ────────────────────────────────────────

describe("init-context skill retirement — BOUNDARY", () => {
  it("a converge run over a target seeded with a simulated prior install removes skills/lore-init-context/SKILL.md", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-boundary-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);
    seedPriorSkillInstall(targetDir);
    expect(existsSync(join(targetDir, SKILL_RELATIVE_PATH))).toBe(true); // sanity: the seed really landed before the converge

    runSetup(["--claude-dir", targetDir, "--yes"], scratch);

    expect(existsSync(join(targetDir, SKILL_RELATIVE_PATH))).toBe(false);
  });

  it("the whole skills/lore-init-context/ directory is pruned once its only file is removed", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-boundary-dir-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);
    seedPriorSkillInstall(targetDir);

    runSetup(["--claude-dir", targetDir, "--yes"], scratch);

    expect(existsSync(join(targetDir, "skills", "lore-init-context"))).toBe(false);
  });
});

// ─── STATE (dry-run plan) ───────────────────────────────────────────────────

describe("init-context skill retirement — STATE (dry-run removals plan)", () => {
  it("`--dry-run --json`'s plan.removals lists skills/lore-init-context/SKILL.md once seeded", () => {
    const scratch = makeScratchDir("lore-init-context-retirement-state-");
    const targetDir = join(scratch, ".claude");
    freshInstall(scratch, targetDir);
    seedPriorSkillInstall(targetDir);

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
    // reason: the script imports the TS expander (spec-lore-owned-agent-context-is-generated-from-templates-and D6); its shebang and the build run it under bun.
    const proc = Bun.spawnSync([process.execPath, join(REPO_ROOT, "scripts", "embed-assets-manifest.mjs"), "--check"], {
      cwd: REPO_ROOT,
    });
    expect(proc.exitCode).toBe(0);
  });
});
