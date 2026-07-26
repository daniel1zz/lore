/**
 * AC-083-2 — SPEC-083 D3 retirement pins: the MACHINE install asset set
 * yields zero `governance/corpus-workflow.md` entries while
 * `governance/seat-briefing.md` remains, and the session-start hook's
 * SOURCE contains zero `corpus-workflow` occurrences while spawning the
 * `governance` verb (SPEC-083 D2). A pure `node:fs` + `RealAssetSource`
 * suite — `RealAssetSource` imports only `node:crypto`/`node:fs`/`node:path`
 * plus `@lore/core` (no `bun:sqlite`), so it is vitest-resolvable directly,
 * same as its own sibling `real-setup-ports.test.ts`.
 *
 * Coverage:
 *   HAPPY:      RealAssetSource.load() against the real repo assets/ tree
 *               yields zero corpus-workflow.md entries and exactly one
 *               seat-briefing.md entry (still installed, unaffected)
 *   NEGATIVE:   the exclusion is NOT a blanket "drop everything under
 *               governance/" bug — at least one governance-kind file
 *               (seat-briefing.md) still survives the walk
 *   BOUNDARY:   the excluded path is matched by its EXACT relative name
 *               (`governance/corpus-workflow.md`), not a bare filename
 *               substring — a synthetic `governance/nested/corpus-workflow.md`
 *               fixture (different relative path) is NOT excluded, proving
 *               the exclusion isn't an overly broad `.includes("corpus-workflow")`
 *               check that could accidentally swallow an unrelated file
 *   ERROR:      (no new error path — RealAssetSource's existing STORE_ERROR
 *               behavior on an unreadable directory is unchanged by this
 *               task and already covered by real-setup-ports.test.ts)
 *   STATE:      the hook source's `corpus-workflow` occurrence count is
 *               EXACTLY zero (not "fewer than before") and its `governance`
 *               verb spawn argument is asserted as a literal array element,
 *               not a loose substring match
 *   REGRESSION: the retired file still physically EXISTS under
 *               assets/governance/ (SPEC-083 D3 — it stays as the runtime
 *               verb's SSOT, only its INSTALLATION is retired) — proves this
 *               suite is testing an install-set exclusion, not an accidental
 *               file deletion
 *
 * @spec_ref SPEC-083 §Acceptance Criteria AC-083-2
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { RealAssetSource } from "../../src/adapters/real-asset-source.js";

// packages/lore/tests/unit/setup-governance-retirement.test.ts -> repo root is 4 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");
const SESSION_START_HOOK_PATH = join(ASSETS_ROOT, "hooks", "session-start-resume.mjs");

const RETIRED_PATH = "governance/corpus-workflow.md";
const SURVIVING_PATH = "governance/seat-briefing.md";

// ─── HAPPY — RealAssetSource.load() excludes corpus-workflow.md, keeps seat-briefing.md ─

describe("setup-governance-retirement — HAPPY (RealAssetSource install set)", () => {
  it("RealAssetSource.load() against the real repo assets/ tree yields zero governance/corpus-workflow.md entries", async () => {
    const source = new RealAssetSource(ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.files.map((f) => f.path);
    expect(paths).not.toContain(RETIRED_PATH);
  });

  it("RealAssetSource.load() still yields exactly one governance/seat-briefing.md entry", async () => {
    const source = new RealAssetSource(ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const matches = result.value.files.filter((f) => f.path === SURVIVING_PATH);
    expect(matches.length).toBe(1);
    expect(matches[0]?.kind).toBe("governance");
  });
});

// ─── NEGATIVE — exclusion is scoped, not a blanket governance/ wipe ────────

describe("setup-governance-retirement — NEGATIVE", () => {
  it("at least one governance-kind file still survives the walk (not a blanket exclusion)", async () => {
    const source = new RealAssetSource(ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const governanceFiles = result.value.files.filter((f) => f.kind === "governance");
    expect(governanceFiles.length).toBeGreaterThan(0);
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
});

// ─── STATE — hook source: zero corpus-workflow occurrences, spawns governance ──

describe("setup-governance-retirement — STATE (session-start-resume.mjs hook source)", () => {
  it("the hook source contains ZERO 'corpus-workflow' occurrences", () => {
    const content = readFileSync(SESSION_START_HOOK_PATH, "utf8");
    const occurrences = content.split("corpus-workflow").length - 1;
    expect(occurrences).toBe(0);
  });

  it("the hook spawns the 'governance' verb as a literal argv element", () => {
    const content = readFileSync(SESSION_START_HOOK_PATH, "utf8");
    expect(content).toContain("spawnSync('lore', ['governance'");
  });

  it("REGRESSION control: the occurrence-count assertion is not vacuously true — a synthetic fixture carrying the marker IS flagged", () => {
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
});

// ─── REGRESSION — the retired file still exists on disk (SSOT, not deleted) ──

describe("setup-governance-retirement — REGRESSION (file stays on disk as the runtime verb's SSOT)", () => {
  it("assets/governance/corpus-workflow.md still physically exists (install-set exclusion, not a file deletion)", () => {
    expect(existsSync(join(ASSETS_ROOT, RETIRED_PATH))).toBe(true);
  });
});
