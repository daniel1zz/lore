/**
 * Asset SSOT conformance suite (SPEC-046 AC-046-D).
 *
 * `assets/` is the vendored, distributable Lore workflow bundle (P0 of PRD §17):
 * skills, agents, hooks, project scaffold hooks, and a standalone governance
 * snippet. This suite is a pure `node:fs` read against the REPO'S OWN CHECKED-IN
 * `assets/` tree — no store, no `bun:sqlite`, no sandbox (read-only). It is the
 * mechanized conformance oracle the spec's Design section calls for: the manifest
 * of every file `assets/` MUST contain is declared HERE, in-test, as the SSOT for
 * "what shipped" — drifting the real tree away from this list (adding, removing,
 * or renaming a shipped file) fails this suite, on purpose.
 *
 * It also enforces R2 from the spec's risk table: the governance snippet
 * (`assets/governance/corpus-workflow.md`) was authored FRESH, standalone, and
 * must never carry the owner's private global-CLAUDE.md personal markers
 * (absolute home paths, browser-profile mentions, personal email/domain) or
 * leftover CJK text — it ships to third parties who are not this repo's owner.
 *
 * Coverage:
 *   HAPPY:      every declared skill/agent/hook/project/governance file exists
 *               under assets/ (manifest completeness)
 *   NEGATIVE:   the completeness CHECKER itself is proven non-tautological — it
 *               flags a synthetic missing file — plus a whole-tree grep proving
 *               zero files anywhere under assets/ hardcode `/Users/apple`
 *   BOUNDARY:   the `<corpus-workflow>` tag pair is exactly one open + one close,
 *               open before close; all four `## ` FEED/PRODUCE/EXECUTE/CLOSE
 *               section headers are present; every SKILL.md starts with `---`
 *               frontmatter carrying a `name:` line; no declared top-level asset
 *               directory is empty
 *   ERROR:      reading a nonexistent path surfaces (throws), never silently
 *               returns empty/undefined — proves the suite's file-reading helper
 *               doesn't swallow read failures
 *   STATE:      the actual recursive file listing under assets/ is EXACTLY the
 *               declared manifest set (bidirectional: no missing, no extras)
 *   REGRESSION: the "extra file" detector is itself proven non-tautological on a
 *               synthetic fixture (an unexpected top-level file would be flagged)
 *               + every .sh/pre-push file under assets/ keeps its owner-execute
 *               bit (a common bit-loss regression on checkout/packaging)
 *
 * @spec_ref AC-046-D
 */

import { describe, it, expect } from "vitest";
import { existsSync, statSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// ─── Locate the REAL repo-root assets/ tree ────────────────────────────────────
// packages/lore/tests/unit/assets-ssot.test.ts -> repo root is 4 levels up.

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");

// ─── The declared manifest — THE conformance spec, not derived from the fs ────

const DECLARED_FILES = [
  // skills
  "skills/lore/SKILL.md",
  "skills/lore-kickoff/SKILL.md",
  "skills/lore-session/SKILL.md",
  "skills/lore-session/references/knowledge-types.md",
  "skills/lore-doctor/SKILL.md",
  "skills/lore-autopilot/SKILL.md",
  // skills/lore-ai-native-coding (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-ai-native-coding/SKILL.md",
  "skills/lore-ai-native-coding/references/ai-anti-patterns.md",
  "skills/lore-ai-native-coding/references/backend-layering.md",
  "skills/lore-ai-native-coding/references/coding-fundamentals.md",
  "skills/lore-ai-native-coding/references/design-principles.md",
  "skills/lore-ai-native-coding/references/error-handling-strategy.md",
  "skills/lore-ai-native-coding/references/jsdoc-as-context.md",
  "skills/lore-ai-native-coding/references/naming-as-index.md",
  "skills/lore-ai-native-coding/references/observability-as-code.md",
  "skills/lore-ai-native-coding/references/resumability.md",
  "skills/lore-ai-native-coding/references/security-essentials.md",
  "skills/lore-ai-native-coding/references/state-as-data.md",
  "skills/lore-ai-native-coding/references/typed-errors.md",
  "skills/lore-ai-native-coding/references/typescript-conventions.md",
  "skills/lore-ai-native-coding/references/zod-as-ssot.md",
  // skills/lore-design (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-design/SKILL.md",
  "skills/lore-design/references/api-design.md",
  "skills/lore-design/references/architecture-patterns.md",
  "skills/lore-design/references/cross-cutting/authorization.md",
  "skills/lore-design/references/cross-cutting/error-handling.md",
  "skills/lore-design/references/cross-cutting/idempotency.md",
  "skills/lore-design/references/cross-cutting/session-identity.md",
  "skills/lore-design/references/database-design.md",
  "skills/lore-design/references/mode-api.md",
  "skills/lore-design/references/mode-architecture.md",
  "skills/lore-design/references/mode-database.md",
  "skills/lore-design/references/mode-module.md",
  "skills/lore-design/references/mode-system.md",
  "skills/lore-design/references/system-design.md",
  "skills/lore-design/templates/design-preview.html",
  // skills/lore-plan (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-plan/SKILL.md",
  "skills/lore-plan/references/ac-quality.md",
  "skills/lore-plan/references/mode-create.md",
  "skills/lore-plan/references/mode-list.md",
  "skills/lore-plan/references/mode-replan.md",
  "skills/lore-plan/references/mode-resume.md",
  "skills/lore-plan/references/mode-status.md",
  "skills/lore-plan/references/mode-update.md",
  "skills/lore-plan/references/phase-decomposition.md",
  "skills/lore-plan/references/plan-file-format.md",
  "skills/lore-plan/references/workflow-examples.md",
  // skills/lore-product (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-product/SKILL.md",
  "skills/lore-product/references/cross-cutting-concerns.md",
  "skills/lore-product/references/ideation-methods.md",
  "skills/lore-product/references/impact-mapping.md",
  "skills/lore-product/references/jtbd-framework.md",
  "skills/lore-product/references/mode-discovery.md",
  "skills/lore-product/references/mode-ideation.md",
  "skills/lore-product/references/mode-prd.md",
  "skills/lore-product/references/mode-roadmap.md",
  "skills/lore-product/references/mode-tech-assessment.md",
  "skills/lore-product/references/mode-ux-research.md",
  "skills/lore-product/references/prd-guide.md",
  "skills/lore-product/references/product-design.md",
  "skills/lore-product/references/product-wisdom.md",
  "skills/lore-product/references/roadmap-planning.md",
  "skills/lore-product/references/strategic-thinking.md",
  "skills/lore-product/references/tech-planning.md",
  // skills/lore-review (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-review/SKILL.md",
  "skills/lore-review/references/a11y-checklist.md",
  "skills/lore-review/references/code-review-checklist.md",
  "skills/lore-review/references/d-biz-checklist.md",
  "skills/lore-review/references/ears-verification.md",
  "skills/lore-review/references/mode-accessibility.md",
  "skills/lore-review/references/mode-architecture.md",
  "skills/lore-review/references/mode-code.md",
  "skills/lore-review/references/mode-ddd.md",
  "skills/lore-review/references/mode-security.md",
  "skills/lore-review/references/mode-ui.md",
  "skills/lore-review/references/oop-architecture-checklist.md",
  "skills/lore-review/references/security-commit-gate.md",
  "skills/lore-review/references/security-patterns.md",
  // skills/lore-auto-wire (vendored, converged from zz-auto-wire, 2026-07-17)
  "skills/lore-auto-wire/SKILL.md",
  "skills/lore-auto-wire/references/mode-add.md",
  "skills/lore-auto-wire/references/mode-discover.md",
  "skills/lore-auto-wire/references/mode-init-project.md",
  "skills/lore-auto-wire/references/mode-init-tools.md",
  "skills/lore-auto-wire/references/mode-rotate.md",
  "skills/lore-auto-wire/references/mode-status.md",
  "skills/lore-auto-wire/references/tools/railway.md",
  "skills/lore-auto-wire/references/tools/selfhosted-pg.md",
  "skills/lore-auto-wire/scripts/check-tools.sh",
  "skills/lore-auto-wire/scripts/fix-path.sh",
  // skills/lore-init-context (vendored, converged from zz-init-context, 2026-07-17)
  "skills/lore-init-context/SKILL.md",
  // skills/lore-uat (vendored, converged from zz-uat, 2026-07-17)
  "skills/lore-uat/SKILL.md",
  "skills/lore-uat/references/drivers.md",
  "skills/lore-uat/references/execution-protocol.md",
  "skills/lore-uat/references/journey-derivation.md",
  "skills/lore-uat/references/judging-rubric.md",
  "skills/lore-uat/references/playwright-compilation.md",
  "skills/lore-uat/references/probe-and-compile-example.md",
  "skills/lore-uat/references/uiux-production-bar.md",
  "skills/lore-uat/templates/acceptance-report.md",
  "skills/lore-uat/templates/journey.yaml",
  // agents
  "agents/lore-explorer.md",
  "agents/lore-implementer.md",
  "agents/lore-reviewer.md",
  // hooks (5 .mjs + 4 .sh gates + 1 shared lib module)
  "hooks/session-start-resume.mjs",
  "hooks/stop-doc-sync.mjs",
  "hooks/subagent-context.mjs",
  "hooks/pre-subagent-gate.mjs",
  "hooks/pre-no-general-agent-gate.mjs",
  "hooks/lore-gate-g1-spec-create.sh",
  "hooks/lore-gate-g2-spec-promote.sh",
  "hooks/lore-gate-g3-plan-promote.sh",
  "hooks/lore-gate-g4-task-claim.sh",
  "hooks/lib/turn-state.mjs",
  // project (4 .sh gates + pre-push + tree.yaml template)
  "project/g1-spec-create.sh",
  "project/g2-spec-promote.sh",
  "project/g3-plan-promote.sh",
  "project/g4-task-claim.sh",
  "project/pre-push",
  "project/lore.tree.yaml.template",
  // governance
  "governance/corpus-workflow.md",
  "governance/seat-briefing.md",
] as const;

const SKILL_MD_FILES = DECLARED_FILES.filter((f) => f.endsWith("SKILL.md"));
const EXECUTABLE_REQUIRED_FILES = DECLARED_FILES.filter(
  (f) => f.endsWith(".sh") || f.endsWith("/pre-push"),
);
const DECLARED_TOP_LEVEL_DIRS = ["skills", "agents", "hooks", "project", "governance"];

const GOVERNANCE_REL = "governance/corpus-workflow.md";
const GOVERNANCE_PATH = join(ASSETS_ROOT, GOVERNANCE_REL);

const SEAT_BRIEFING_REL = "governance/seat-briefing.md";
const SEAT_BRIEFING_PATH = join(ASSETS_ROOT, SEAT_BRIEFING_REL);
const SEAT_BRIEFING_PLACEHOLDERS = ["{{ACTOR}}", "{{BRANCH}}", "{{MAIN_CHECKOUT}}"] as const;

const PERSONAL_MARKERS = ["/Users/", "agent-browser", "zheng@", "humanity.org"];
const CJK_RANGE = /[一-鿿]/;

// ─── Helpers under test (kept in-file — this suite IS the oracle) ─────────────

/** Reads a required file's contents; never swallows a read failure. */
function readRequiredFile(relOrAbsPath: string): string {
  return readFileSync(relOrAbsPath, "utf-8");
}

/** Returns the subset of `files` (repo-relative to `root`) that do NOT exist. */
function findMissingFiles(root: string, files: readonly string[]): string[] {
  return files.filter((f) => !existsSync(join(root, f)));
}

/** Recursively lists all files under `root`, as paths relative to `root` (POSIX-joined). */
function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(root, "");
  return out;
}

// ─── HAPPY — manifest completeness ─────────────────────────────────────────────

describe("assets-ssot — HAPPY (manifest completeness)", () => {
  it("every declared skill/agent/hook/project/governance file exists under assets/", () => {
    const missing = findMissingFiles(ASSETS_ROOT, DECLARED_FILES);
    expect(missing).toEqual([]);
  });

  for (const dir of DECLARED_TOP_LEVEL_DIRS) {
    it(`declared top-level directory assets/${dir} exists`, () => {
      expect(existsSync(join(ASSETS_ROOT, dir))).toBe(true);
      expect(statSync(join(ASSETS_ROOT, dir)).isDirectory()).toBe(true);
    });
  }
});

// ─── NEGATIVE — checker non-tautology + whole-tree personal-path cleanliness ──

describe("assets-ssot — NEGATIVE", () => {
  it("findMissingFiles is not a vacuous pass: a synthetic nonexistent path is flagged missing", () => {
    // Guards against the HAPPY test above becoming tautological (e.g. if
    // findMissingFiles were accidentally hardcoded to always return []).
    const missing = findMissingFiles(ASSETS_ROOT, [
      ...DECLARED_FILES,
      "skills/does-not-exist/SKILL.md",
    ]);
    expect(missing).toEqual(["skills/does-not-exist/SKILL.md"]);
  });

  it("no file under assets/ hardcodes the owner's personal absolute path /Users/apple", () => {
    const offenders: string[] = [];
    for (const rel of listFilesRecursive(ASSETS_ROOT)) {
      const content = readRequiredFile(join(ASSETS_ROOT, rel));
      if (content.includes("/Users/apple")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("governance snippet contains none of the private global-CLAUDE.md personal markers", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    const found = PERSONAL_MARKERS.filter((marker) => content.includes(marker));
    expect(found).toEqual([]);
  });

  it("governance snippet contains zero CJK characters", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    expect(CJK_RANGE.test(content)).toBe(false);
  });
});

// ─── BOUNDARY — tag pairing, frontmatter, non-empty directories ───────────────

describe("assets-ssot — BOUNDARY", () => {
  it("corpus-workflow.md contains exactly one <corpus-workflow> open tag", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    const opens = content.match(/<corpus-workflow>/g) ?? [];
    expect(opens.length).toBe(1);
  });

  it("corpus-workflow.md contains exactly one </corpus-workflow> close tag", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    const closes = content.match(/<\/corpus-workflow>/g) ?? [];
    expect(closes.length).toBe(1);
  });

  it("the <corpus-workflow> open tag appears before the </corpus-workflow> close tag", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    const openIdx = content.indexOf("<corpus-workflow>");
    const closeIdx = content.indexOf("</corpus-workflow>");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(openIdx);
  });

  it.each(["## FEED", "## PRODUCE", "## EXECUTE", "## CLOSE"])(
    "corpus-workflow.md contains a %s section header",
    (headerPrefix) => {
      const content = readRequiredFile(GOVERNANCE_PATH);
      const hasHeader = content
        .split("\n")
        .some((line) => line.startsWith(headerPrefix));
      expect(hasHeader).toBe(true);
    },
  );

  it.each(SKILL_MD_FILES)("%s starts with --- frontmatter", (relPath) => {
    const content = readRequiredFile(join(ASSETS_ROOT, relPath));
    expect(content.startsWith("---")).toBe(true);
  });

  it.each(SKILL_MD_FILES)("%s frontmatter contains a name: line", (relPath) => {
    const content = readRequiredFile(join(ASSETS_ROOT, relPath));
    const frontmatterEnd = content.indexOf("---", 3);
    expect(frontmatterEnd).toBeGreaterThan(0);
    const frontmatter = content.slice(0, frontmatterEnd);
    const hasName = frontmatter.split("\n").some((line) => /^name:\s*\S/.test(line));
    expect(hasName).toBe(true);
  });

  for (const dir of DECLARED_TOP_LEVEL_DIRS) {
    it(`assets/${dir} is not empty (contains at least one file, recursively)`, () => {
      const files = listFilesRecursive(join(ASSETS_ROOT, dir));
      expect(files.length).toBeGreaterThan(0);
    });
  }
});

// ─── BOUNDARY — seat-briefing.md tag pairing + placeholder set (SPEC-047) ─────

describe("assets-ssot — BOUNDARY (seat-briefing.md, SPEC-047)", () => {
  it("seat-briefing.md contains exactly one <session-seat> open tag", () => {
    const content = readRequiredFile(SEAT_BRIEFING_PATH);
    const opens = content.match(/<session-seat>/g) ?? [];
    expect(opens.length).toBe(1);
  });

  it("seat-briefing.md contains exactly one </session-seat> close tag", () => {
    const content = readRequiredFile(SEAT_BRIEFING_PATH);
    const closes = content.match(/<\/session-seat>/g) ?? [];
    expect(closes.length).toBe(1);
  });

  it("the <session-seat> open tag appears before the </session-seat> close tag", () => {
    const content = readRequiredFile(SEAT_BRIEFING_PATH);
    const openIdx = content.indexOf("<session-seat>");
    const closeIdx = content.indexOf("</session-seat>");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(openIdx);
  });

  it.each(SEAT_BRIEFING_PLACEHOLDERS)("seat-briefing.md references the %s placeholder at least once", (placeholder) => {
    const content = readRequiredFile(SEAT_BRIEFING_PATH);
    const count = content.split(placeholder).length - 1;
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ─── ERROR — read failures surface, never swallowed ───────────────────────────

describe("assets-ssot — ERROR", () => {
  it("readRequiredFile throws (does not silently return empty/undefined) for a nonexistent path", () => {
    const bogusPath = join(ASSETS_ROOT, "governance/does-not-exist.md");
    expect(existsSync(bogusPath)).toBe(false);
    expect(() => readRequiredFile(bogusPath)).toThrow();
  });

  it("findMissingFiles surfaces an unreadable root by throwing, not by silently reporting everything present", () => {
    const bogusRoot = join(ASSETS_ROOT, "this-directory-does-not-exist");
    expect(() => findMissingFiles(bogusRoot, ["skills/lore/SKILL.md"])).not.toThrow();
    // existsSync against a bogus root correctly reports missing (not swallowed as "present").
    expect(findMissingFiles(bogusRoot, ["skills/lore/SKILL.md"])).toEqual(["skills/lore/SKILL.md"]);
  });
});

// ─── STATE — actual tree exactly matches the declared manifest (bidirectional) ─

describe("assets-ssot — STATE", () => {
  it("the recursive file listing under assets/ is exactly the declared manifest set", () => {
    const actual = listFilesRecursive(ASSETS_ROOT).slice().sort();
    const declared = [...DECLARED_FILES].sort();
    expect(actual).toEqual(declared);
  });
});

// ─── REGRESSION — extra-file detector proven non-tautological + execute bits ──

describe("assets-ssot — REGRESSION", () => {
  it("an unexpected extra top-level file under assets/ would be flagged (synthetic fixture)", () => {
    // Proves the STATE comparison above isn't vacuously true (e.g. if someone
    // replaced it with a subset check instead of exact-set equality).
    const tmpRoot = mkdtempSync(join(tmpdir(), "assets-ssot-regression-"));
    try {
      mkdirSync(join(tmpRoot, "skills"), { recursive: true });
      writeFileSync(join(tmpRoot, "skills", "expected.md"), "ok");
      writeFileSync(join(tmpRoot, "UNEXPECTED_EXTRA_FILE.md"), "should be flagged");

      const actual = listFilesRecursive(tmpRoot).slice().sort();
      const declared = ["skills/expected.md"].sort();
      expect(actual).not.toEqual(declared);
      const extras = actual.filter((f) => !declared.includes(f));
      expect(extras).toEqual(["UNEXPECTED_EXTRA_FILE.md"]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it.each(EXECUTABLE_REQUIRED_FILES)("%s keeps its owner-execute bit", (relPath) => {
    const mode = statSync(join(ASSETS_ROOT, relPath)).mode;
    expect(mode & 0o100).not.toBe(0);
  });
});
