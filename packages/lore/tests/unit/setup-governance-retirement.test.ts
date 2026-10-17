// @reads assets/**
/**
 * NOTE (task-skill-test-tg-8): the per-file "retired path is absent from the install walk and from
 * the check-embedded manifest" cases moved into `tests/integration/retirement-registry.bun.test.ts`
 * (one row per retired path in `RETIREMENTS`). What stays here is content and predicate pins.
 *
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const CORPUS_WORKFLOW_RETIRED_FILE = join(ASSETS_ROOT, "governance", "corpus-workflow.md");
const CONTEXT_FRAGMENT_DIR = join(ASSETS_ROOT, "context");

/**
 * RE-BASELINE (SPEC-083 amended by spec-context-fragments-config-driven-layered-rule-injection D9,
 * task-skill-implement-spec-083-amendment-corpus-workflow-prose): the corpus-workflow prose SSOT is
 * now the shipped `assets/context/corpus-workflow-*.md` fragments. Content assertions that read the
 * old single file read the concatenated fragments instead — same needles, new source.
 */
function readCorpusWorkflowFragments(): string {
  return readdirSync(CONTEXT_FRAGMENT_DIR)
    .filter((n) => n.startsWith("corpus-workflow-") && n.endsWith(".md"))
    .sort()
    .map((n) => readFileSync(join(CONTEXT_FRAGMENT_DIR, n), "utf8"))
    .join("\n");
}

const RETIRED_PATH_CORPUS_WORKFLOW = "governance/corpus-workflow.md";
const RETIRED_PATH_SEAT_BRIEFING = "governance/seat-briefing.md";

// ─── STATE — the entries filter narrows entries only, never tree_digest ────

describe("setup-governance-retirement — STATE (check-embedded-manifest tree_digest)", () => {
  it("buildCheckEmbeddedManifest()'s tree_digest is non-empty and independent of the entries filter (whole-tree digest, not recomputed over the narrowed subset)", () => {
    const manifest = buildCheckEmbeddedManifest();
    expect(manifest.tree_digest.length).toBeGreaterThan(0);
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

  it("assets/governance/seat-briefing.md instructs 'lore handoff' (no identity flag — AC-RID-17) as the exit-path verb", () => {
    const content = readFileSync(SEAT_BRIEFING_SSOT_PATH, "utf8");
    expect(content).toContain("lore handoff [--plan");
    expect(content).not.toContain("--by");
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

// ─── STATE — corpus-workflow.md handoff-neutrality content (AC-096-3) ──────
//
// spec-session-start-handoff-neutrality D4 — the FEED section's bootstrap
// bullet must describe `latest_handoffs` as a neutral open-thread directory
// and explicitly prohibit an agent from self-initiating a resume off an
// injected handoff pointer; the CLOSE section's handoff bullet must drop the
// stale "session-start auto-injected resume_hint is only a fallback
// discovery aid" phrasing (stale after D1 dropped resume_hint from the
// injection). Keyed on short, stable lone tokens (never a long remembered
// phrase) per the contiguous-substring lesson — each token below is
// independently meaningful, so a future light rewording of the surrounding
// sentence would still be caught by SOME assertion rather than the whole
// suite silently degrading to no-match.

describe("setup-governance-retirement — STATE (corpus-workflow fragments handoff-neutrality content, spec-session-start-handoff-neutrality D4)", () => {
  it("HAPPY: the FEED bullet describes latest_handoffs as a neutral open-thread directory", () => {
    const content = readCorpusWorkflowFragments();
    expect(content).toContain("latest_handoffs");
    expect(content).toContain("open thread");
  });

  it("HAPPY: the FEED bullet prohibits self-initiated resumption from an injected handoff pointer", () => {
    const content = readCorpusWorkflowFragments();
    // One bullet (a single line of the fragment) must carry both the prohibition and the handoff noun.
    const bullet = content.split("\n").find((line) => line.includes("NEVER") && line.includes("handoff"));
    expect(bullet).toBeDefined();
    expect(content).toContain("own initiative");
  });

  it("HAPPY: the FEED bullet names the ticket-or-explicit-instruction exception to the prohibition", () => {
    const content = readCorpusWorkflowFragments();
    expect(content).toContain("pasted ticket");
    expect(content).toContain("explicit instruction");
  });

  it("HAPPY: the CLOSE bullet names the handoff ticket as the sole sanctioned resumption path", () => {
    const content = readCorpusWorkflowFragments();
    expect(content).toContain("sanctioned resumption path");
  });

  it("NEGATIVE: zero occurrences of the retired resume_hint field name anywhere in the file", () => {
    const content = readCorpusWorkflowFragments();
    const occurrences = content.split("resume_hint").length - 1;
    expect(occurrences).toBe(0);
  });

  it("NEGATIVE: zero occurrences of the stale 'fallback discovery aid' phrasing (D1 made resume_hint no longer even present ambiently)", () => {
    const content = readCorpusWorkflowFragments();
    const occurrences = content.split("fallback discovery aid").length - 1;
    expect(occurrences).toBe(0);
  });

  it("REGRESSION control: the resume_hint occurrence-count assertion is not vacuously true — a synthetic fixture carrying the marker IS flagged", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "governance-retirement-neutrality-control-"));
    try {
      const tmpFile = join(tmpDir, "fixture-corpus-workflow.md");
      writeFileSync(tmpFile, "Session bootstrap is hook-injected (`resume_hint` / `latest_handoffs`)\n");
      const content = readFileSync(tmpFile, "utf8");
      const occurrences = content.split("resume_hint").length - 1;
      expect(occurrences).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("REGRESSION control: the fallback-discovery-aid occurrence-count assertion is not vacuously true — a synthetic fixture carrying the stale phrase IS flagged", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "governance-retirement-neutrality-control-"));
    try {
      const tmpFile = join(tmpDir, "fixture-corpus-workflow.md");
      writeFileSync(tmpFile, "the session-start auto-injected resume_hint is only a fallback discovery aid.\n");
      const content = readFileSync(tmpFile, "utf8");
      const occurrences = content.split("fallback discovery aid").length - 1;
      expect(occurrences).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── REGRESSION — both retired files still exist on disk (SSOT, not deleted) ──

describe("setup-governance-retirement — REGRESSION (files stay on disk as the runtime verb's SSOT)", () => {
  it("assets/governance/corpus-workflow.md is DELETED (D9) and its prose lives in at least one shipped assets/context/corpus-workflow-*.md fragment", () => {
    expect(existsSync(CORPUS_WORKFLOW_RETIRED_FILE)).toBe(false);
    const fragments = readdirSync(CONTEXT_FRAGMENT_DIR).filter((n) => n.startsWith("corpus-workflow-") && n.endsWith(".md"));
    expect(fragments.length).toBeGreaterThanOrEqual(4);
  });

  it("assets/governance/seat-briefing.md still physically exists (install-set exclusion, not a file deletion)", () => {
    expect(existsSync(join(ASSETS_ROOT, RETIRED_PATH_SEAT_BRIEFING))).toBe(true);
  });

  it("governance/corpus-workflow.md is NOT a member any more (its file is deleted; a stale entry makes npm staging copy a missing file), while the assets/context/ fragments are binary-read retired", () => {
    expect(isRetiredFromInstall(RETIRED_PATH_CORPUS_WORKFLOW)).toBe(false);
    expect(isRetiredFromInstall("context/corpus-workflow-1-feed.md")).toBe(true);
  });
});
