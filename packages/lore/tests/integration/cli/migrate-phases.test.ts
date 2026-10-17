// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore migrate phases` CLI subcommand.
 * Runs the real CLI via subprocess against an isolated temp SQLite DB.
 *
 * IMPORTANT: `lore set` does not expose an `--extra-json` flag, so injecting legacy
 * `extra.phase` strings into plan rows requires direct SQLite manipulation via
 * `bun --eval`. This is the only way to create the pre-migration state via integration
 * tests. The manipulation is minimal (one UPDATE) and mirrors what would exist in a
 * real corpus authored before SPEC-023 landed.
 *
 * Coverage:
 *   HAPPY:    empty corpus → 0 touched (exits 0)
 *   HAPPY:    corpus with legacy extra.phase plan → touched=1, skipped=0
 *   HAPPY:    idempotent — second run reports 0 touched
 *   ERROR:    --dry-run reports count without writing
 *   BOUNDARY: mixed corpus counts touched/skipped correctly
 *   STATE:    after migration, lore get shows legacy_phase set, extra.phase gone
 *
 * @spec_ref AC-PHASE-10 SPEC-023 §4 §8 Q2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Path setup ───────────────────────────────────────────────────────────────

// From packages/lore/tests/integration/cli/ → ../../../ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── Types ───────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Inject a legacy `extra.phase` string directly into a plan row via `bun --eval`.
 * This is necessary because `lore set` does not expose an `--extra-json` flag.
 * The script uses `bun:sqlite` to write directly to .lore/lore.db.
 *
 * @param planId - The ULID of the plan to inject into
 * @param phaseValue - The legacy phase string (e.g., "Track A")
 * @param dbDir - The tmpDir containing .lore/lore.db
 */
function injectLegacyPhase(planId: string, phaseValue: string, dbDir: string): void {
  const dbPath = join(dbDir, ".lore", "lore.db");
  // Use JSON.stringify to safely embed phaseValue (handles special characters)
  const script = `
    import Database from "bun:sqlite";
    const db = new Database(${JSON.stringify(dbPath)}, { readwrite: true });
    const row = db.query("SELECT extra FROM docs WHERE id = ?").get(${JSON.stringify(planId)});
    if (!row) { process.stderr.write("Plan not found: ${planId}\\n"); process.exit(1); }
    const extra = JSON.parse(row.extra || "{}");
    extra.phase = ${JSON.stringify(phaseValue)};
    db.run("UPDATE docs SET extra = ? WHERE id = ?", [JSON.stringify(extra), ${JSON.stringify(planId)}]);
    db.close();
    process.stdout.write("ok\\n");
  `;
  const result = spawnSync("bun", ["--eval", script], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`injectLegacyPhase failed: ${result.stderr}`);
  }
}

/** Create a plan and return its ULID (from --json output). */
function createPlanWithId(title: string, cwd: string): { planId: string; planSlug: string } {
  const r = runLore(
    ["create", "plan", "--title", title, "--no-ai", "--content", "body", "--json"],
    cwd,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  // `lore create --json` returns { ok: true, data: { id, slug, ... } } — doc directly under data.
  const parsed = JSON.parse(r.stdout) as { data?: { id?: string; slug?: string } };
  const planId = parsed.data?.id;
  const planSlug = parsed.data?.slug;
  if (!planId || !planSlug) throw new Error(`Could not extract plan id/slug from: ${r.stdout}`);
  return { planId, planSlug };
}

/** Create a plan WITHOUT legacy extra.phase (clean state, returns slug). */
function createCleanPlan(title: string, cwd: string): string {
  const r = runLore(["create", "plan", "--title", title, "--no-ai", "--content", "body"], cwd);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const slugM = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = slugM?.[1];
  if (!slug) throw new Error("Could not extract plan slug");
  return slug;
}

/** Create a plan and inject legacy extra.phase via direct SQLite write. */
function createLegacyPlan(title: string, phaseValue: string, cwd: string): { planId: string; planSlug: string } {
  const { planId, planSlug } = createPlanWithId(title, cwd);
  injectLegacyPhase(planId, phaseValue, cwd);
  return { planId, planSlug };
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-migrate-phases-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    /* ignore */
  }
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("lore migrate phases — HAPPY", () => {
  it("AC-PHASE-10.CLI.H1: exit 0 on empty corpus (0 touched, 0 skipped)", () => {
    const result = runLore(["migrate", "phases"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Plans touched");
    expect(result.stdout).toMatch(/Plans touched:\s+0/);
    expect(result.stdout).toMatch(/Plans skipped:\s+0/);
  });

  it("AC-PHASE-10.CLI.H2: touches plan with legacy extra.phase string (touched=1, skipped=0)", () => {
    createLegacyPlan("Legacy Plan A", "Track A", tmpDir);

    const result = runLore(["migrate", "phases"], tmpDir);

    expect(result.exitCode).toBe(0);
    // Spec AC-PHASE-10: one plan with legacy phase string should be touched.
    expect(result.stdout).toMatch(/Plans touched:\s+1/);
    expect(result.stdout).toMatch(/Plans skipped:\s+0/);
  });

  it("AC-PHASE-10.CLI.H3: --json output has touched/skipped/dryRun fields", () => {
    createLegacyPlan("JSON Legacy Plan", "Track X", tmpDir);

    const result = runLore(["migrate", "phases", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: { touched?: number; skipped?: number; dryRun?: boolean };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.touched).toBe(1);
    expect(parsed.data?.skipped).toBe(0);
    expect(parsed.data?.dryRun).toBe(false);
  });

  it("AC-PHASE-10.CLI.H4: plans without legacy extra.phase field are skipped", () => {
    createCleanPlan("Clean Plan 1", tmpDir);
    createCleanPlan("Clean Plan 2", tmpDir);

    const result = runLore(["migrate", "phases", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: { touched?: number; skipped?: number };
    };
    expect(parsed.data?.touched).toBe(0);
    expect(parsed.data?.skipped).toBe(2);
  });
});

// ─── IDEMPOTENT ──────────────────────────────────────────────────────────────

describe("lore migrate phases — IDEMPOTENT", () => {
  it("AC-PHASE-10.CLI.I1: second run on already-migrated corpus reports 0 touched", () => {
    createLegacyPlan("Legacy Plan", "Some Track", tmpDir);

    // First run
    const firstRun = runLore(["migrate", "phases", "--json"], tmpDir);
    expect(firstRun.exitCode).toBe(0);
    const firstParsed = JSON.parse(firstRun.stdout) as { data?: { touched?: number } };
    expect(firstParsed.data?.touched).toBe(1);

    // Second run — must be a no-op (idempotent)
    const secondRun = runLore(["migrate", "phases", "--json"], tmpDir);
    expect(secondRun.exitCode).toBe(0);
    const secondParsed = JSON.parse(secondRun.stdout) as { data?: { touched?: number; skipped?: number } };

    // Spec AC-PHASE-10: idempotent — rerunning is a no-op on already-migrated rows.
    expect(secondParsed.data?.touched).toBe(0);
    expect(secondParsed.data?.skipped).toBe(1);
  });
});

// ─── ERROR: dry-run does NOT write ──────────────────────────────────────────

describe("lore migrate phases --dry-run — ERROR path", () => {
  it("AC-PHASE-10.CLI.E1: --dry-run exits 0 and reports touched count (human-readable)", () => {
    createLegacyPlan("DryRun Plan", "Track Dry", tmpDir);

    const result = runLore(["migrate", "phases", "--dry-run"], tmpDir);

    expect(result.exitCode).toBe(0);
    // Spec: dryRun label appears in output, touched count is accurate.
    expect(result.stdout).toMatch(/dry.run/i);
    expect(result.stdout).toMatch(/Plans touched:\s+1/);
  });

  it("AC-PHASE-10.CLI.E2: --dry-run does NOT write; subsequent non-dry run still sees 1 to migrate", () => {
    createLegacyPlan("DryRun Plan 2", "Track Wet", tmpDir);

    // Dry run first
    const dryResult = runLore(["migrate", "phases", "--dry-run", "--json"], tmpDir);
    expect(dryResult.exitCode).toBe(0);
    const dryParsed = JSON.parse(dryResult.stdout) as { data?: { touched?: number; dryRun?: boolean } };
    expect(dryParsed.data?.dryRun).toBe(true);
    expect(dryParsed.data?.touched).toBe(1);

    // CRITICAL: because dry-run did NOT write, the actual migration still touches 1 row.
    // If dryRun had accidentally written, the second run would report 0 touched (already migrated).
    const wetResult = runLore(["migrate", "phases", "--json"], tmpDir);
    expect(wetResult.exitCode).toBe(0);
    const wetParsed = JSON.parse(wetResult.stdout) as { data?: { touched?: number; dryRun?: boolean } };
    expect(wetParsed.data?.dryRun).toBe(false);
    // Must be 1 (not 0) — dryRun left the data unchanged.
    expect(wetParsed.data?.touched).toBe(1);
  });
});

// ─── BOUNDARY: mixed corpus ──────────────────────────────────────────────────

describe("lore migrate phases — BOUNDARY (mixed corpus)", () => {
  it("AC-PHASE-10.CLI.B1: mixed corpus counts touched and skipped correctly", () => {
    createLegacyPlan("Legacy 1", "Track A", tmpDir);
    createLegacyPlan("Legacy 2", "Track B", tmpDir);
    createCleanPlan("Clean 1", tmpDir);
    createCleanPlan("Clean 2", tmpDir);
    createCleanPlan("Clean 3", tmpDir);

    const result = runLore(["migrate", "phases", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data?: { touched?: number; skipped?: number } };
    // 2 legacy plans → touched=2; 3 clean plans → skipped=3
    expect(parsed.data?.touched).toBe(2);
    expect(parsed.data?.skipped).toBe(3);
  });
});

// ─── STATE: after migration, plan no longer has singular extra.phase ──────────

describe("lore migrate phases — STATE verification", () => {
  it("AC-PHASE-10.CLI.S1: after migration, lore get shows legacy_phase set, extra.phase gone", () => {
    const { planId, planSlug } = createLegacyPlan("State Plan", "My Legacy Track", tmpDir);

    // Verify the legacy field is present BEFORE migration
    const beforeGet = runLore(["get", planSlug, "--json"], tmpDir);
    expect(beforeGet.exitCode).toBe(0);
    const beforeDoc = JSON.parse(beforeGet.stdout) as {
      data?: { doc?: { extra?: Record<string, unknown> } };
    };
    expect(beforeDoc.data?.doc?.extra?.["phase"]).toBe("My Legacy Track");

    // Run migration
    const migrateResult = runLore(["migrate", "phases"], tmpDir);
    expect(migrateResult.exitCode).toBe(0);

    // AFTER migration: extra.phase must be GONE, extra.legacy_phase must be SET
    const afterGet = runLore(["get", planSlug, "--json"], tmpDir);
    expect(afterGet.exitCode).toBe(0);
    const afterDoc = JSON.parse(afterGet.stdout) as {
      data?: { doc?: { extra?: Record<string, unknown> } };
    };

    // Spec AC-PHASE-10: singular phase field removed after migration.
    expect(afterDoc.data?.doc?.extra?.["phase"]).toBeUndefined();
    // Spec AC-PHASE-10: legacy_phase holds the original value.
    expect(afterDoc.data?.doc?.extra?.["legacy_phase"]).toBe("My Legacy Track");

    void planId; // used by injectLegacyPhase
  });
});
