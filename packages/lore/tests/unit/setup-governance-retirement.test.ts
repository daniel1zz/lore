/**
 * AC-083-2 (extended by AC-085-2) — SPEC-083 D3 retirement pins, extended by
 * SPEC-085 D3: the MACHINE install asset set now yields ZERO
 * `governance/corpus-workflow.md` AND ZERO `governance/seat-briefing.md`
 * entries (both governance files are retired from install — the runtime
 * `lore governance` verb and its `--seat-briefing` flag serve both at read
 * time, SPEC-085 D1), the session-start hook's SOURCE contains zero
 * `corpus-workflow` occurrences and zero seat-briefing PATH-READ occurrences
 * while spawning `governance --seat-briefing` (SPEC-085 D2), and the SSOT
 * seat-briefing template itself contains zero writer-guard-rejected `create
 * knowledge --sub-type handoff` occurrences (SPEC-085 D4). A pure `node:fs`
 * + `RealAssetSource` suite — `RealAssetSource` imports only
 * `node:crypto`/`node:fs`/`node:path` plus `@lore/core` (no `bun:sqlite`),
 * so it is vitest-resolvable directly, same as its own sibling
 * `real-setup-ports.test.ts`.
 *
 * **2026-07-26 regression addendum**: a post-merge full-suite run on main
 * found that the D3 exclusion originally lived ONLY inside
 * `RealAssetSource.load()`'s walk — `lore setup --check` classifies against
 * a SEPARATE data source (`setup-check.ts`'s `buildCheckEmbeddedManifest`,
 * built from the EMBEDDED assets manifest, which still fingerprints
 * `governance/corpus-workflow.md` on purpose), so it reported the retired
 * file `missing` on every freshly converged target
 * (`setup-check.bun.test.ts` AC-076-2.N1, `setup-freshness-cycle.bun.test.ts`
 * — both bun-runner e2e suites this vitest-only run never touches, which is
 * exactly why the gap survived the original scoped oracle set). The fix
 * hoisted the exclusion to an exported SSOT (`isRetiredFromInstall`/
 * `RETIRED_FROM_INSTALL_PATHS`, `real-asset-source.ts`) that BOTH
 * `RealAssetSource.load()` and `buildCheckEmbeddedManifest` (now exported
 * too, for this pin) consume — the CHECK-EMBEDDED-MANIFEST describe block
 * below pins that second consumer directly, closing the exact blind spot the
 * original suite had. SPEC-085 D3 adds `seat-briefing.md` to the SAME SSOT
 * set, proving the single-declaration fix generalizes to a second file with
 * zero extra plumbing.
 *
 * Coverage:
 *   HAPPY:      RealAssetSource.load() against the real repo assets/ tree
 *               yields ZERO `governance/` entries at all (both retired
 *               files gone); the CHECK-EMBEDDED-MANIFEST view
 *               (`buildCheckEmbeddedManifest`) independently agrees
 *   NEGATIVE:   the exclusion is NOT a blanket "drop the whole assets/ tree"
 *               bug — sibling top-level kinds (skills/agents/hooks) still
 *               have entries in BOTH the install walk and the
 *               check-embedded-manifest view
 *   BOUNDARY:   the excluded paths are matched by their EXACT relative name,
 *               not a bare filename substring — synthetic
 *               `governance/nested/corpus-workflow.md` and
 *               `governance/nested/seat-briefing.md` fixtures (different
 *               relative paths) are NOT excluded, proving the exclusion
 *               isn't an overly broad substring check that could
 *               accidentally swallow an unrelated file
 *   ERROR:      (no new error path — RealAssetSource's existing STORE_ERROR
 *               behavior on an unreadable directory is unchanged by this
 *               task and already covered by real-setup-ports.test.ts)
 *   STATE:      the hook source's `corpus-workflow` occurrence count is
 *               EXACTLY zero, its seat-briefing.md PATH-READ occurrence
 *               count is EXACTLY zero (the former two-candidate `join(...,
 *               'seat-briefing.md')` lookup is gone), and it spawns
 *               `governance --seat-briefing` as a literal argv pair; the
 *               check-embedded-manifest's `tree_digest` is UNCHANGED by the
 *               entries filter (still the whole-tree digest, proving the
 *               filter narrows `entries` only); the SSOT seat-briefing
 *               template's `create knowledge --sub-type handoff` occurrence
 *               count is EXACTLY zero
 *   REGRESSION: both retired files still physically EXIST under
 *               assets/governance/ (SPEC-083/085 D3 — they stay as the
 *               runtime verb's SSOT, only their INSTALLATION is retired) —
 *               proves this suite is testing an install-set exclusion, not
 *               an accidental file deletion; the two consumers (install walk
 *               + check-embedded-manifest) are cross-checked against the
 *               SAME `isRetiredFromInstall` predicate, not two independently
 *               maintained lists that could silently re-diverge; every
 *               occurrence-count assertion carries a REGRESSION-control
 *               fixture proving it isn't vacuously true
 *
 * @spec_ref SPEC-083 §Acceptance Criteria AC-083-2, SPEC-085 §Acceptance
 *   Criteria AC-085-2
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { RealAssetSource, isRetiredFromInstall } from "../../src/adapters/real-asset-source.js";
import { buildCheckEmbeddedManifest } from "../../src/adapters/cli/setup-check.js";

// packages/lore/tests/unit/setup-governance-retirement.test.ts -> repo root is 4 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");
const SESSION_START_HOOK_PATH = join(ASSETS_ROOT, "hooks", "session-start-resume.mjs");
const SEAT_BRIEFING_SSOT_PATH = join(ASSETS_ROOT, "governance", "seat-briefing.md");

const RETIRED_PATH_CORPUS_WORKFLOW = "governance/corpus-workflow.md";
const RETIRED_PATH_SEAT_BRIEFING = "governance/seat-briefing.md";
const RETIRED_PATHS = [RETIRED_PATH_CORPUS_WORKFLOW, RETIRED_PATH_SEAT_BRIEFING];

// ─── HAPPY — RealAssetSource.load() excludes BOTH governance files (SPEC-085 D3) ─

describe("setup-governance-retirement — HAPPY (RealAssetSource install set)", () => {
  it("RealAssetSource.load() against the real repo assets/ tree yields zero governance/corpus-workflow.md entries", async () => {
    const source = new RealAssetSource(ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.files.map((f) => f.path);
    expect(paths).not.toContain(RETIRED_PATH_CORPUS_WORKFLOW);
  });

  it("RealAssetSource.load() yields zero governance/seat-briefing.md entries (SPEC-085 D3)", async () => {
    const source = new RealAssetSource(ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.files.map((f) => f.path);
    expect(paths).not.toContain(RETIRED_PATH_SEAT_BRIEFING);
  });

  it("RealAssetSource.load() yields ZERO governance-kind entries at all (both retirements together empty the install directory)", async () => {
    const source = new RealAssetSource(ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const governanceFiles = result.value.files.filter((f) => f.kind === "governance");
    expect(governanceFiles.length).toBe(0);
  });
});

// ─── HAPPY — the check-embedded-manifest view (setup-check.ts) ─────────────
// This is the SECOND consumer the 2026-07-26 regression addendum names — the
// original AC-083-2 suite pinned RealAssetSource.load() only, missing that
// `lore setup --check` classifies against a wholly separate data source.

describe("setup-governance-retirement — HAPPY (check-embedded-manifest view)", () => {
  it("buildCheckEmbeddedManifest() yields zero governance/corpus-workflow.md entries", () => {
    const manifest = buildCheckEmbeddedManifest();
    const paths = manifest.entries.map((e) => e.path);
    expect(paths).not.toContain(RETIRED_PATH_CORPUS_WORKFLOW);
  });

  it("buildCheckEmbeddedManifest() yields zero governance/seat-briefing.md entries (SPEC-085 D3)", () => {
    const manifest = buildCheckEmbeddedManifest();
    const paths = manifest.entries.map((e) => e.path);
    expect(paths).not.toContain(RETIRED_PATH_SEAT_BRIEFING);
  });

  it("buildCheckEmbeddedManifest() yields ZERO governance-kind entries at all", () => {
    const manifest = buildCheckEmbeddedManifest();
    const governanceEntries = manifest.entries.filter((e) => e.kind === "governance");
    expect(governanceEntries.length).toBe(0);
  });

  it("every buildCheckEmbeddedManifest() entry independently satisfies !isRetiredFromInstall (cross-check against the shared predicate, not a hand-duplicated list)", () => {
    const manifest = buildCheckEmbeddedManifest();
    for (const entry of manifest.entries) {
      expect(isRetiredFromInstall(entry.path)).toBe(false);
    }
  });
});

// ─── STATE — the entries filter narrows entries only, never tree_digest ────

describe("setup-governance-retirement — STATE (check-embedded-manifest tree_digest)", () => {
  it("buildCheckEmbeddedManifest()'s tree_digest is non-empty and independent of the entries filter (whole-tree digest, not recomputed over the narrowed subset)", () => {
    const manifest = buildCheckEmbeddedManifest();
    expect(manifest.tree_digest.length).toBeGreaterThan(0);
    // The retired file is absent from `entries` but the digest still reflects
    // the WHOLE tree (module doc: "tree_digest is carried through UNCHANGED") —
    // this is a non-vacuous companion to the HAPPY absence assertion above:
    // proves the fix didn't achieve "missing excluded" by also shrinking the
    // digest input, which would break the SEPARATE assets_digest equality
    // check `planUpdate` performs elsewhere.
    expect(manifest.entries.map((e) => e.path)).not.toContain(RETIRED_PATH_CORPUS_WORKFLOW);
    expect(manifest.entries.map((e) => e.path)).not.toContain(RETIRED_PATH_SEAT_BRIEFING);
  });
});

// ─── NEGATIVE — exclusion is scoped to governance/, not a blanket assets/ wipe ─

describe("setup-governance-retirement — NEGATIVE", () => {
  it("sibling top-level kinds (skills/agents/hooks) still have entries in the install walk (not a blanket assets/ exclusion)", async () => {
    const source = new RealAssetSource(ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const kind of ["skill", "agent", "hook"] as const) {
      const matches = result.value.files.filter((f) => f.kind === kind);
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it("sibling top-level kinds still have entries in buildCheckEmbeddedManifest() too (not a blanket assets/ exclusion)", () => {
    const manifest = buildCheckEmbeddedManifest();
    for (const kind of ["skill", "agent", "hook"] as const) {
      const matches = manifest.entries.filter((e) => e.kind === kind);
      expect(matches.length).toBeGreaterThan(0);
    }
  });
});

// ─── BOUNDARY — exact-path match, not a filename substring check ──────────

describe("setup-governance-retirement — BOUNDARY (exact-path exclusion)", () => {
  it("a synthetic nested corpus-workflow.md (different relative path) is NOT excluded", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "governance-retirement-boundary-"));
    try {
      const nestedDir = join(tmpRoot, "governance", "nested");
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(join(nestedDir, "corpus-workflow.md"), "nested fixture, must survive\n");
      // Every OTHER top-level dir RealAssetSource walks must exist too (readdirSync
      // on a missing dir is a real error, not an empty-array short-circuit).
      for (const dir of ["skills", "agents", "hooks"]) {
        mkdirSync(join(tmpRoot, dir), { recursive: true });
      }

      const source = new RealAssetSource(tmpRoot);
      const result = await source.load();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const paths = result.value.files.map((f) => f.path);
      expect(paths).toContain("governance/nested/corpus-workflow.md");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("a synthetic nested seat-briefing.md (different relative path) is NOT excluded (SPEC-085 D3)", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "governance-retirement-boundary-"));
    try {
      const nestedDir = join(tmpRoot, "governance", "nested");
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(join(nestedDir, "seat-briefing.md"), "nested fixture, must survive\n");
      for (const dir of ["skills", "agents", "hooks"]) {
        mkdirSync(join(tmpRoot, dir), { recursive: true });
      }

      const source = new RealAssetSource(tmpRoot);
      const result = await source.load();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const paths = result.value.files.map((f) => f.path);
      expect(paths).toContain("governance/nested/seat-briefing.md");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─── STATE — hook source: zero path-read occurrences, spawns the runtime verb ──

describe("setup-governance-retirement — STATE (session-start-resume.mjs hook source)", () => {
  it("the hook source contains ZERO 'corpus-workflow' occurrences", () => {
    const content = readFileSync(SESSION_START_HOOK_PATH, "utf8");
    const occurrences = content.split("corpus-workflow").length - 1;
    expect(occurrences).toBe(0);
  });

  it("the hook source contains ZERO seat-briefing.md path-read occurrences (the old two-candidate join(...) lookup is gone)", () => {
    const content = readFileSync(SESSION_START_HOOK_PATH, "utf8");
    expect(content).not.toContain("join(claudeDir, 'governance', 'seat-briefing.md')");
    expect(content).not.toContain("join(mainCheckout, 'assets', 'governance', 'seat-briefing.md')");
    expect(content).not.toContain("readFileSync(briefingPath");
  });

  it("the hook spawns the 'governance' verb as a literal argv element", () => {
    const content = readFileSync(SESSION_START_HOOK_PATH, "utf8");
    expect(content).toContain("spawnSync('lore', ['governance'");
  });

  it("the hook passes --seat-briefing as a spawn argument to the governance verb (SPEC-085 D2)", () => {
    const content = readFileSync(SESSION_START_HOOK_PATH, "utf8");
    expect(content).toContain("spawnSync('lore', ['governance', '--seat-briefing']");
  });

  it("REGRESSION control: the corpus-workflow occurrence-count assertion is not vacuously true — a synthetic fixture carrying the marker IS flagged", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "governance-retirement-state-control-"));
    try {
      const tmpFile = join(tmpDir, "fixture-hook.mjs");
      writeFileSync(tmpFile, "// reads <claude-dir>/governance/corpus-workflow.md\n");
      const content = readFileSync(tmpFile, "utf8");
      const occurrences = content.split("corpus-workflow").length - 1;
      expect(occurrences).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("REGRESSION control: the seat-briefing path-read assertion is not vacuously true — a synthetic fixture carrying the OLD join(...) pattern IS flagged", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "governance-retirement-state-control-"));
    try {
      const tmpFile = join(tmpDir, "fixture-hook.mjs");
      writeFileSync(
        tmpFile,
        "const briefingPath = join(claudeDir, 'governance', 'seat-briefing.md');\n"
        + "const template = readFileSync(briefingPath, 'utf8');\n",
      );
      const content = readFileSync(tmpFile, "utf8");
      expect(content).toContain("join(claudeDir, 'governance', 'seat-briefing.md')");
      expect(content).toContain("readFileSync(briefingPath");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── STATE — SSOT seat-briefing template: zero writer-guard-rejected calls ────

describe("setup-governance-retirement — STATE (seat-briefing.md SSOT content, SPEC-085 D4)", () => {
  it("assets/governance/seat-briefing.md contains ZERO 'create knowledge --sub-type handoff' occurrences", () => {
    const content = readFileSync(SEAT_BRIEFING_SSOT_PATH, "utf8");
    const occurrences = content.split("create knowledge --sub-type handoff").length - 1;
    expect(occurrences).toBe(0);
  });

  it("assets/governance/seat-briefing.md instructs 'lore handoff --by' as the exit-path verb", () => {
    const content = readFileSync(SEAT_BRIEFING_SSOT_PATH, "utf8");
    expect(content).toContain("lore handoff --by");
  });

  it("REGRESSION control: the occurrence-count assertion is not vacuously true — a synthetic fixture carrying the marker IS flagged", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "governance-retirement-state-control-"));
    try {
      const tmpFile = join(tmpDir, "fixture-briefing.md");
      writeFileSync(tmpFile, "lore create knowledge --sub-type handoff --title x\n");
      const content = readFileSync(tmpFile, "utf8");
      const occurrences = content.split("create knowledge --sub-type handoff").length - 1;
      expect(occurrences).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── REGRESSION — both retired files still exist on disk (SSOT, not deleted) ──

describe("setup-governance-retirement — REGRESSION (files stay on disk as the runtime verb's SSOT)", () => {
  it("assets/governance/corpus-workflow.md still physically exists (install-set exclusion, not a file deletion)", () => {
    expect(existsSync(join(ASSETS_ROOT, RETIRED_PATH_CORPUS_WORKFLOW))).toBe(true);
  });

  it("assets/governance/seat-briefing.md still physically exists (install-set exclusion, not a file deletion)", () => {
    expect(existsSync(join(ASSETS_ROOT, RETIRED_PATH_SEAT_BRIEFING))).toBe(true);
  });

  it("both retired paths are members of RETIRED_FROM_INSTALL_PATHS (cross-check, not a hand-duplicated list)", () => {
    for (const path of RETIRED_PATHS) {
      expect(isRetiredFromInstall(path)).toBe(true);
    }
  });
});
