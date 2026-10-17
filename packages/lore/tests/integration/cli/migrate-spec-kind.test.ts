// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore migrate spec-kind` CLI subcommand.
 * Runs the real CLI via subprocess against an isolated temp SQLite DB.
 * Mirrors migrate-phases.test.ts structurally.
 *
 * `spec` docs require a `parent_id` (createDocInputSchema superRefine,
 * PARENT_TYPE_CONTRACT.spec = ["prd"]) — every spec fixture here is created
 * under a fresh `prd` via `--parent <prd-slug>`.
 *
 * Coverage:
 *   HAPPY:      empty corpus → 0 touched (exits 0); tech-signal-titled spec → touched=1
 *   IDEMPOTENT: second run on already-migrated corpus reports 0 touched
 *   ERROR:      --dry-run reports the candidate but performs no write (subsequent
 *               non-dry-run still sees it) — mirrors AC-PHASE-10.CLI.E2's shape
 *   BOUNDARY:   mixed corpus of matching/non-matching specs → correct counts
 *   STATE:      after apply, `lore get <slug> --json` shows the new extra.spec_kind
 *
 * @spec_ref SPEC-032 §3.4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync, appendFileSync } from "fs";
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

/** Create a root PRD and return its slug (specs require a prd parent). */
function createPrd(title: string, cwd: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], cwd);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  const slugM = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = slugM?.[1];
  if (!slug) throw new Error(`Could not extract prd slug from: ${r.stdout}`);
  return slug;
}

/** Create a spec under the given prd parent and return its slug. */
function createSpec(title: string, parentSlug: string, content: string, cwd: string): string {
  const r = runLore(
    ["create", "spec", "--title", title,"--no-ai", "--content", content],
    cwd,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  const slugM = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = slugM?.[1];
  if (!slug) throw new Error(`Could not extract spec slug from: ${r.stdout}`);
  return slug;
}

/**
 * Disables all four `lore gate` service-layer checkpoints for this fixture's corpus
 * (retro follow-up item 8 test-fallout reconciliation — GateEnforcer is now wired ON
 * by default in every production `createApp`, which every subprocess-spawned `lore`
 * command in this file goes through). None of this file's ACs exercise spec-create
 * gating — every `createSpec` call here passes filler content ("n/a" or a one-line
 * sentence, never a `## ` heading) purely to exercise `SpecKindService`'s
 * title-signal heuristic, which is orthogonal to spec-create's skeleton predicate.
 * Mirrors the config shape `tests/integration/gate-config-disable.bun.test.ts`
 * establishes (`workflow.gates.<checkpoint>.enabled`, `@lore/core::resolveGateEnabled`).
 */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let prdSlug: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-migrate-spec-kind-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
  disableAllGates(tmpDir);
  prdSlug = createPrd("Root PRD", tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("lore migrate spec-kind — HAPPY", () => {
  it("exit 0 on corpus with no specs (0 touched, 0 skipped)", () => {
    const result = runLore(["migrate", "spec-kind"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Specs touched:\s+0/);
    expect(result.stdout).toMatch(/Specs skipped:\s+0/);
  });

  it("a spec with a tech-signal title is flagged: touched=1 with a candidates array entry", () => {
    const specSlug = createSpec("Corpus Architecture Overview", prdSlug, "n/a", tmpDir);

    const result = runLore(["migrate", "spec-kind", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: {
        touched?: number;
        skipped?: number;
        candidates?: Array<{ slug?: string; to?: string; matchedIn?: string }>;
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.touched).toBe(1);
    expect(parsed.data?.skipped).toBe(0);
    expect(parsed.data?.candidates).toHaveLength(1);
    expect(parsed.data?.candidates?.[0]?.slug).toBe(specSlug);
    expect(parsed.data?.candidates?.[0]?.to).toBe("tech");
    expect(parsed.data?.candidates?.[0]?.matchedIn).toBe("title");
  });

  it("human-readable output lists the Candidates section with slug/title/from-to/signal", () => {
    createSpec("Dashboard Visual Redesign", prdSlug, "n/a", tmpDir);

    const result = runLore(["migrate", "spec-kind"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Candidates:");
    expect(result.stdout).toContain("feature → design");
  });
});

// ─── IDEMPOTENT ──────────────────────────────────────────────────────────────

describe("lore migrate spec-kind — IDEMPOTENT", () => {
  it("second run on already-migrated corpus reports 0 touched", () => {
    createSpec("Service Layer Architecture", prdSlug, "n/a", tmpDir);

    const firstRun = runLore(["migrate", "spec-kind", "--json"], tmpDir);
    expect(firstRun.exitCode).toBe(0);
    const firstParsed = JSON.parse(firstRun.stdout) as { data?: { touched?: number } };
    expect(firstParsed.data?.touched).toBe(1);

    const secondRun = runLore(["migrate", "spec-kind", "--json"], tmpDir);
    expect(secondRun.exitCode).toBe(0);
    const secondParsed = JSON.parse(secondRun.stdout) as {
      data?: { touched?: number; skipped?: number };
    };
    expect(secondParsed.data?.touched).toBe(0);
    expect(secondParsed.data?.skipped).toBe(1);
  });
});

// ─── ERROR: dry-run does NOT write ──────────────────────────────────────────

describe("lore migrate spec-kind --dry-run — ERROR path", () => {
  it("--dry-run reports the candidate but performs no write; subsequent non-dry-run still sees it", () => {
    createSpec("Storage Adapter Overview", prdSlug, "n/a", tmpDir);

    // Dry run first
    const dryResult = runLore(["migrate", "spec-kind", "--dry-run", "--json"], tmpDir);
    expect(dryResult.exitCode).toBe(0);
    const dryParsed = JSON.parse(dryResult.stdout) as {
      data?: { touched?: number; dryRun?: boolean };
    };
    expect(dryParsed.data?.dryRun).toBe(true);
    expect(dryParsed.data?.touched).toBe(1);

    // CRITICAL: because dry-run did NOT write, the actual migration still touches 1 row.
    // If dryRun had accidentally written, the second run would report 0 touched.
    const wetResult = runLore(["migrate", "spec-kind", "--json"], tmpDir);
    expect(wetResult.exitCode).toBe(0);
    const wetParsed = JSON.parse(wetResult.stdout) as {
      data?: { touched?: number; dryRun?: boolean };
    };
    expect(wetParsed.data?.dryRun).toBe(false);
    expect(wetParsed.data?.touched).toBe(1);
  });
});

// ─── BOUNDARY: mixed corpus ──────────────────────────────────────────────────

describe("lore migrate spec-kind — BOUNDARY (mixed corpus)", () => {
  it("mixed corpus of matching/non-matching specs counts touched and skipped correctly", () => {
    createSpec("Storage Migration Schema", prdSlug, "n/a", tmpDir); // tech candidate
    createSpec("Component Prototype", prdSlug, "n/a", tmpDir); // design candidate
    createSpec("Quarterly Roadmap Review", prdSlug, "Upcoming feature priorities.", tmpDir); // no signal
    createSpec("Onboarding Guide", prdSlug, "How to join the team.", tmpDir); // no signal

    const result = runLore(["migrate", "spec-kind", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data?: { touched?: number; skipped?: number } };
    expect(parsed.data?.touched).toBe(2);
    expect(parsed.data?.skipped).toBe(2);
  });
});

// ─── STATE: after apply, extra.spec_kind reflects the new value ────────────

describe("lore migrate spec-kind — STATE verification", () => {
  it("after apply, `lore get <slug> --json` shows the new extra.spec_kind value", () => {
    const specSlug = createSpec("Data Migration Architecture", prdSlug, "n/a", tmpDir);

    // Verify BEFORE migration: still the defaulted "feature" kind.
    const beforeGet = runLore(["get", specSlug, "--json"], tmpDir);
    expect(beforeGet.exitCode).toBe(0);
    const beforeDoc = JSON.parse(beforeGet.stdout) as {
      data?: { doc?: { extra?: Record<string, unknown> } };
    };
    expect(beforeDoc.data?.doc?.extra?.["spec_kind"]).toBe("feature");

    const migrateResult = runLore(["migrate", "spec-kind"], tmpDir);
    expect(migrateResult.exitCode).toBe(0);

    const afterGet = runLore(["get", specSlug, "--json"], tmpDir);
    expect(afterGet.exitCode).toBe(0);
    const afterDoc = JSON.parse(afterGet.stdout) as {
      data?: { doc?: { extra?: Record<string, unknown> } };
    };
    expect(afterDoc.data?.doc?.extra?.["spec_kind"]).toBe("tech");
  });
});
