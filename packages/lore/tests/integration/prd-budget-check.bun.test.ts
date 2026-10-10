/**
 * RED-phase TDD tests for `lore status --check-prd-budget` (SPEC-080 C3, paired
 * implementation task T4). The flag does NOT exist yet on `lore status` — no source
 * change has landed for it in this worktree.
 *
 * Current failure mode (before impl), confirmed empirically against this worktree's
 * `src/index.ts` before writing this file:
 *   `lore status --check-prd-budget` → SPEC-051/073's strict-flag seam rejects the
 *   undeclared flag BEFORE `status.ts`'s run handler is ever reached:
 *     stderr: "Error: Unknown option: --check-prd-budget"
 *     exit code: 2
 *   This is uniform across EVERY corpus state (compliant, over-budget, with/without
 *   --check-tree) — every scenario below therefore fails on the SAME discriminator
 *   (exit 2, not the spec'd 0/3), which is the intended RED signal for this file.
 *
 * Fixture-seeding notes:
 *   - `prd.extra.outline[]` has no CLI writer yet (T3's `lore outline set` verb is a
 *     sibling task, not landed here) — outline entries are seeded by direct SQLite
 *     UPDATE against `.lore/lore.db`'s `extra` column, mirroring the established
 *     precedent in `tests/integration/cli/migrate-phases.test.ts` (injectLegacyPhase).
 *   - `CorpusService.set`'s content patch runs every string through
 *     `canonicaliseBody` (`@lore/core`'s `text-normalise.ts`): trims both ends, then
 *     appends EXACTLY one trailing "\n". A content-file of N non-whitespace chars is
 *     therefore stored as N+1 chars. Every char-count fixture below accounts for this
 *     (write N-1 filler chars to land on a stored length of exactly N) — confirmed
 *     empirically against this worktree (`"ABCDEF"` → stored `"ABCDEF\n"`).
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref AC-080-1 AC-080-10 (SPEC-080 C3, C1)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface CreatedDoc {
  readonly id: string;
  readonly slug: string;
}

// ─── Path setup (mirrors tests/integration/cli-check-tree.bun.test.ts) ─────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run `bun run src/index.ts ...args` in `cwd`. HOME is overridden to isolate global config. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-prd-budget-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function initCorpus(tmpDir: string): void {
  const r = runLore(["init"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`init failed: ${r.stderr}`);
}

/** Create a doc, return {id, slug} parsed from `--json` output (`data.id`/`data.slug`). */
function createDoc(
  tmpDir: string,
  type: string,
  title: string,
  content: string,
  extraArgs: string[] = [],
): CreatedDoc {
  const r = runLore(
    ["create", type, "--title", title, "--no-ai", "--content", content, "--json", ...extraArgs],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create ${type} failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { data?: { id?: string; slug?: string } };
  if (!parsed.data?.id || !parsed.data?.slug) {
    throw new Error(`could not extract id/slug from: ${r.stdout}`);
  }
  return { id: parsed.data.id, slug: parsed.data.slug };
}

function createPrd(tmpDir: string, title: string, content = "A compliant root PRD body."): CreatedDoc {
  return createDoc(tmpDir, "prd", title, content);
}

function createSpec(
  tmpDir: string,
  title: string,
  parentSlug: string,
  // reason: the spec-create gate's hasSkeleton predicate (gate-predicates.ts) requires
  // at least one `## ` level-2 heading line — a bare "spec body" string trips
  // MISSING_SKELETON before this helper's caller ever reaches the budget-check assertion.
  content = "## Overview\nspec body",
): CreatedDoc {
  return createDoc(tmpDir, "spec", title, content, []);
}

/**
 * Set a doc's content via `--content-file` to a body of EXACTLY `targetStoredChars`
 * chars AFTER `canonicaliseBody`'s trim+single-trailing-newline normalisation — i.e.
 * writes `targetStoredChars - 1` filler chars to the file (canonicaliseBody appends
 * the +1 newline on the way into the store).
 */
function setContentToExactLength(tmpDir: string, slug: string, targetStoredChars: number): void {
  if (targetStoredChars < 1) throw new Error("targetStoredChars must be >= 1");
  const filePath = join(tmpDir, "big-content.txt");
  writeFileSync(filePath, "x".repeat(targetStoredChars - 1));
  const r = runLore(["set", slug, "--content-file", filePath], tmpDir);
  if (r.exitCode !== 0) throw new Error(`set --content-file failed: ${r.stderr}`);
}

/** Merge `patch` into a doc's `extra` JSON column via direct SQLite write (no CLI
 * writer exists yet for `prd.extra.outline[]` — see file header). */
function injectExtra(tmpDir: string, docId: string, patch: Record<string, unknown>): void {
  const dbPath = join(tmpDir, ".lore", "lore.db");
  const db = new Database(dbPath, { readwrite: true });
  try {
    const row = db.query("SELECT extra FROM docs WHERE id = ?").get(docId) as { extra: string } | undefined;
    if (!row) throw new Error(`injectExtra: doc not found: ${docId}`);
    const existing = JSON.parse(row.extra || "{}") as Record<string, unknown>;
    const merged = { ...existing, ...patch };
    db.run("UPDATE docs SET extra = ? WHERE id = ?", [JSON.stringify(merged), docId]);
  } finally {
    db.close();
  }
}

function writeBlueprintRequiringSpec(tmpDir: string, prdSlug: string): void {
  const yaml = [
    "version: 1",
    "root:",
    "  type: prd",
    `  slug: ${prdSlug}`,
    "  children:",
    "    - type: spec",
    "      min: 1",
  ].join("\n");
  writeFileSync(join(tmpDir, "lore.tree.yaml"), yaml + "\n");
}

// ─── Discriminator — documents the pre-implementation failure mode itself ──

describe("lore status --check-prd-budget: discriminator (flag does not exist yet)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("discriminator");
    initCorpus(tmpDir);
    createPrd(tmpDir, "Discriminator PRD");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("is a declared flag (SPEC-051/073 strict seam) — never the exit-2 Unknown-option RED baseline it started as", () => {
    const result = runLore(["status", "--check-prd-budget"], tmpDir);
    expect(result.exitCode).not.toBe(2);
    expect(result.stderr).not.toMatch(/Unknown option/);
  });
});

// ─── Scenario 1: whole-doc breach (AC-080-1) ───────────────────────────────

describe("lore status --check-prd-budget: whole-doc budget (24000-char cap)", () => {
  let tmpDir: string;
  let prd: CreatedDoc;

  beforeEach(() => {
    tmpDir = makeTempDir("whole-doc");
    initCorpus(tmpDir);
    prd = createPrd(tmpDir, "Whole Doc Budget PRD");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 3 and names the whole-doc breach when the rendered body is 24001 chars", () => {
    setContentToExactLength(tmpDir, prd.slug, 24001);
    const result = runLore(["status", "--check-prd-budget"], tmpDir);
    expect(result.exitCode).toBe(3);
    const output = (result.stdout + result.stderr).toLowerCase();
    expect(output).toMatch(/whole.?doc|24,?000|24,?001|budget/);
  });

  it("exits 0 when the rendered body is exactly 24000 chars (boundary)", () => {
    setContentToExactLength(tmpDir, prd.slug, 24000);
    const result = runLore(["status", "--check-prd-budget"], tmpDir);
    expect(result.exitCode).toBe(0);
  });
});

// ─── Scenario 2: compliant fixture — exit 0 AND runtime < 1000ms (QA-3 pin) ─

describe("lore status --check-prd-budget: compliant fixture latency (QA-3, < 1000ms)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("latency");
    initCorpus(tmpDir);
    createPrd(tmpDir, "Compliant Latency PRD", "A small, fully compliant PRD body.");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 0 on a compliant fixture and completes in under 1000ms", () => {
    const start = Date.now();
    const result = runLore(["status", "--check-prd-budget"], tmpDir);
    const elapsedMs = Date.now() - start;
    expect(result.exitCode).toBe(0);
    expect(elapsedMs).toBeLessThan(1000);
  });
});

// ─── Scenario 3: composition — --check-tree inconsistency + budget breach ──

describe("lore status --check-tree --check-prd-budget: composition (single exit 3, both sections printed)", () => {
  let tmpDir: string;
  let prd: CreatedDoc;

  beforeEach(() => {
    tmpDir = makeTempDir("composition");
    initCorpus(tmpDir);
    prd = createPrd(tmpDir, "Composition PRD");
    // Tree: blueprint requires >=1 spec child — corpus has none → INCONSISTENT.
    writeBlueprintRequiringSpec(tmpDir, prd.slug);
    // Budget: push the body over the 24000-char whole-doc cap → BREACH.
    setContentToExactLength(tmpDir, prd.slug, 24001);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 3 once, printing BOTH the tree-inconsistency and the budget-breach sections", () => {
    const result = runLore(["status", "--check-tree", "--check-prd-budget"], tmpDir);
    expect(result.exitCode).toBe(3);
    const output = (result.stdout + result.stderr).toLowerCase();
    // Tree section signal (mirrors cli-check-tree.bun.test.ts's own drift-signal regex).
    expect(output).toMatch(/missing|inconsistent|drift|expect|required|mismatch/);
    // Budget section signal.
    expect(output).toMatch(/whole.?doc|24,?000|24,?001|budget/);
  });

  it("a tree-only inconsistency (no budget breach) exits 3 for the tree reason alone — discriminator", () => {
    // Same tmpDir/prd, but roll content back to compliant so ONLY tree drift remains.
    setContentToExactLength(tmpDir, prd.slug, 100);
    const result = runLore(["status", "--check-tree", "--check-prd-budget"], tmpDir);
    expect(result.exitCode).toBe(3);
    const output = (result.stdout + result.stderr).toLowerCase();
    expect(output).not.toMatch(/whole.?doc budget|24,?000-char/);
  });
});

// ─── Scenario 4/5: detail-link invariants (AC-080-10) — "-t detail-link" addressable ──

describe("lore status --check-prd-budget detail-link invariants (AC-080-10)", () => {
  let tmpDir: string;
  let prd: CreatedDoc;

  beforeEach(() => {
    tmpDir = makeTempDir("detail-link");
    initCorpus(tmpDir);
    prd = createPrd(tmpDir, "Detail Link PRD");
  });

  afterEach(() => cleanupDir(tmpDir));

  // RE-BASELINE (Baseline slice 3b, D7 / AC-BLS3B-8): the outline detail-link check is retired (the outline is
  // read-only history, BR-694). Old assertion: exit 3 naming the entry; new: exit 0, no finding. The test names
  // keep "detail-link" so AC-BLS3-12's `-t detail-link` selector still matches (the orchestrator retires that criterion).
  it("detail-link: retired — an outline entry declaring zero rel=\"detail\" links is no longer a finding (exit 0)", () => {
    const landingSpec = createSpec(tmpDir, "Landing Spec Only", prd.slug);
    injectExtra(tmpDir, prd.id, {
      outline: [
        {
          section: "distribution",
          title: "Distribution",
          tier: "domain",
          direction: "short bounded summary",
          decision_pointers: [],
          constraints: [],
          // Deliberately zero rel="detail" links — only a landing-spec link exists.
          links: [{ slug: landingSpec.slug, rel: "landing-spec" }],
        },
      ],
    });

    const result = runLore(["status", "--check-prd-budget"], tmpDir);
    expect(result.exitCode).toBe(0);
    const output = (result.stdout + result.stderr).toLowerCase();
    expect(output).not.toContain("distribution");
  });

  // RE-BASELINE (same reason): old assertion exit 3; new exit 0.
  it("detail-link: retired — a rel=\"detail\" link to a soft-deleted doc is no longer a finding (exit 0)", () => {
    const detailTarget = createSpec(tmpDir, "Detail Target Doc", prd.slug);
    const del = runLore(["delete", detailTarget.slug, "--confirm"], tmpDir);
    if (del.exitCode !== 0) throw new Error(`delete failed: ${del.stderr}`);

    injectExtra(tmpDir, prd.id, {
      outline: [
        {
          section: "feedback-loop",
          title: "Feedback Loop",
          tier: "domain",
          direction: "short bounded summary",
          decision_pointers: [],
          constraints: [],
          links: [{ slug: detailTarget.slug, rel: "detail" }],
        },
      ],
    });

    const result = runLore(["status", "--check-prd-budget"], tmpDir);
    expect(result.exitCode).toBe(0);
  });

  it("detail-link: exits 0 when every outline entry declares >=1 rel=\"detail\" link resolving to an existing non-deleted doc", () => {
    const detailTarget = createSpec(tmpDir, "Valid Detail Target", prd.slug);
    injectExtra(tmpDir, prd.id, {
      outline: [
        {
          section: "distribution",
          title: "Distribution",
          tier: "domain",
          direction: "short bounded summary",
          decision_pointers: [],
          constraints: [],
          links: [{ slug: detailTarget.slug, rel: "detail" }],
        },
      ],
    });

    const result = runLore(["status", "--check-prd-budget"], tmpDir);
    expect(result.exitCode).toBe(0);
  });
});
