// @reads assets/governance/DOES-NOT-EXIST.md
// @reads assets/governance/claude-md-contract.md
/**
 * Contract-prose content pins (spec-claude-md-governance-content-dimension-checks-wire-the,
 * AC-CONTRACT-1) — the RED half of a paired red/green task
 * (task-skill-implement-contract-prose-rules-section-reworded).
 *
 * This suite is a pure `node:fs` read against the repo's own checked-in
 * `assets/governance/claude-md-contract.md` — the DISTRIBUTED SSOT
 * `lore governance claude-md` prints verbatim to consumers (see
 * `packages/lore/tests/e2e/governance-claude-md-compiled.bun.test.ts` for the
 * byte-identity half of AC-CONTRACT-1's oracle chain, and
 * `packages/lore/tests/unit/assets-ssot.test.ts` for the manifest-membership
 * half). It pins the three prose additions this task lands by STABLE
 * LITERAL substrings, never by paraphrase — a future edit that keeps the
 * intent but drifts the wording would (correctly) need to update this file
 * too, but a silent regression (the addition quietly disappearing) cannot.
 *
 * Written RED-FIRST: at authoring time `assets/governance/claude-md-contract.md`
 * contains none of the three additions below — every HAPPY case in this file
 * is expected to fail until the paired asset edit lands (recorded via
 * `lore evidence ... --result expected-fail` before that edit was made).
 *
 * Coverage:
 *   HAPPY:      the `.claude/rules/` section, the reworded reflow clause, and
 *               the eviction-stub/Index-Entry-Contract binding are all present,
 *               each pinned by a literal substring.
 *   NEGATIVE:   a positive control (a heading known to already exist) proves
 *               `toContain` genuinely reads file content; a fabricated string
 *               proves the same check can fail (not a tautological pass).
 *   BOUNDARY:   the `### How to evict` heading anchor is well-formed (present,
 *               as an exact heading line) BEFORE scanning the section between
 *               it and the next heading for the eviction-stub binding text —
 *               this is also what gives this suite discriminating power over
 *               the AC's own declared falsifier (mutating that exact heading).
 *   ERROR:      reading a nonexistent asset path throws (proves the read
 *               helper doesn't silently swallow a missing file into "").
 *   STATE:      the embedded assets manifest's sha256 for
 *               `governance/claude-md-contract.md` equals the sha256 of the
 *               file's actual on-disk bytes — proves the manifest was
 *               regenerated in the SAME change that edited the asset (task
 *               requirement: "regenerate the assets manifest in this same
 *               task"), the one property nothing else in this repo checks
 *               for this specific file.
 *   REGRESSION: the pre-existing sections and the three OTHER "never the fix"
 *               bullets (raise the ceiling, record in another module's file,
 *               disable the check) remain present verbatim — the edit is
 *               additive plus one targeted reword, never a wholesale rewrite.
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @ac_ref AC-CONTRACT-1
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMBEDDED_ASSETS_MANIFEST } from "../../../src/generated/assets-manifest.js";

// ─── Locate the REAL repo-root asset ───────────────────────────────────────
// packages/lore/tests/unit/assets/claude-md-contract-content.test.ts -> repo
// root is 5 levels up (same convention as the sibling pre-push-parity.test.ts
// and init-context-contract.test.ts in this same directory).

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const CONTRACT_REL = "governance/claude-md-contract.md";
const CONTRACT_PATH = join(REPO_ROOT, "assets", CONTRACT_REL);

function readContract(): string {
  return readFileSync(CONTRACT_PATH, "utf8");
}

describe("claude-md contract asset — three prose additions (AC-CONTRACT-1)", () => {
  it("NEGATIVE (positive control): a heading known to already exist is actually read", () => {
    const content = readContract();
    expect(content).toContain("## The Eviction Rule");
  });

  it("NEGATIVE: a fabricated string is NOT present (the toContain oracle can fail)", () => {
    const content = readContract();
    expect(content).not.toContain("this exact sentence was never written into the contract");
  });

  it("ERROR: reading a nonexistent asset path throws, never silently returns empty", () => {
    const bogusPath = join(REPO_ROOT, "assets", "governance", "DOES-NOT-EXIST.md");
    expect(() => readFileSync(bogusPath, "utf8")).toThrow();
  });

  describe("addition 1 — `.claude/rules/` section", () => {
    it("HAPPY: a dedicated Path-Scoped Rules section exists", () => {
      const content = readContract();
      expect(content).toContain("## Path-Scoped Rules");
    });

    it("HAPPY: rule files live at `.claude/rules/*.md`, one topic per file", () => {
      const content = readContract();
      expect(content).toContain(".claude/rules/*.md");
    });

    it("HAPPY: `paths:` frontmatter scopes a rule to load only on matching files", () => {
      const content = readContract();
      expect(content).toContain("`paths:` YAML frontmatter");
    });

    it("HAPPY: a rule with no `paths:` loads every session at CLAUDE.md's priority", () => {
      const content = readContract();
      expect(content).toContain("loads every session");
    });

    it("HAPPY: `~/.claude/rules/` is named as the user-level equivalent", () => {
      const content = readContract();
      expect(content).toContain("`~/.claude/rules/`");
    });

    it("HAPPY: rules vs. skills are distinguished (resident/path-triggered vs. invocation-loaded)", () => {
      const content = readContract();
      expect(content).toContain("a rule is resident");
      expect(content).toContain("loads only on invocation");
    });

    it("HAPPY: moving a block to rules/ is an eviction ONLY if the destination is budgeted", () => {
      const content = readContract();
      expect(content).toContain("counts as an eviction");
    });
  });

  describe("addition 2 — reworded reflow clause", () => {
    it("HAPPY: the ceiling-gaming prohibition is line-count specific, not a blanket reflow ban", () => {
      const content = readContract();
      expect(content).toContain("reported LINE COUNT");
    });

    it("HAPPY: bytes are named as the binding ceiling that splitting does not reduce", () => {
      const content = readContract();
      expect(content).toContain("binding ceiling");
    });

    it("HAPPY: the advisory line_length signal is named and distinguished from the prohibition", () => {
      const content = readContract();
      expect(content).toContain("advisory `line_length` signal");
    });

    it("HAPPY: readability shortening (move content elsewhere) is distinguished from ceiling-gaming (reflow in place)", () => {
      const content = readContract();
      expect(content).toContain("content elsewhere is fine");
    });
  });

  describe("addition 3 — eviction stubs bound to the Index-Entry Contract", () => {
    it("BOUNDARY: the `### How to evict` heading anchor is well-formed before scanning its section", () => {
      const content = readContract();
      const headingIdx = content.indexOf("### How to evict\n");
      expect(headingIdx).toBeGreaterThanOrEqual(0);
      const nextHeadingIdx = content.indexOf("\n### ", headingIdx + 1);
      expect(nextHeadingIdx).toBeGreaterThan(headingIdx);
    });

    it("HAPPY: the How-to-evict section states the stub IS an index entry", () => {
      const content = readContract();
      const headingIdx = content.indexOf("### How to evict\n");
      expect(headingIdx).toBeGreaterThanOrEqual(0);
      const nextHeadingIdx = content.indexOf("\n### ", headingIdx + 1);
      expect(nextHeadingIdx).toBeGreaterThan(headingIdx);
      const section = content.slice(headingIdx, nextHeadingIdx);
      expect(section).toContain("stub IS an index");
      expect(section).toContain("Index-Entry Contract");
    });

    it("HAPPY: the Index-Entry Contract section binds eviction stubs back to itself", () => {
      const content = readContract();
      const contractHeadingIdx = content.indexOf("## Index-Entry Contract\n");
      expect(contractHeadingIdx).toBeGreaterThanOrEqual(0);
      const nextHeadingIdx = content.indexOf("\n## ", contractHeadingIdx + 1);
      expect(nextHeadingIdx).toBeGreaterThan(contractHeadingIdx);
      const section = content.slice(contractHeadingIdx, nextHeadingIdx);
      expect(section).toContain("eviction stub");
      expect(section).toContain("not an exception");
    });
  });

  describe("STATE — the embedded assets manifest was regenerated for this file", () => {
    it("the manifest sha256 for governance/claude-md-contract.md equals the sha256 of its on-disk bytes", () => {
      const entry = EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === CONTRACT_REL);
      expect(entry).toBeDefined();
      const onDisk = createHash("sha256").update(readFileSync(CONTRACT_PATH)).digest("hex");
      expect((entry as { sha256: string }).sha256).toBe(onDisk);
    });
  });

  describe("REGRESSION — pre-existing sections and the other three never-the-fix bullets survive", () => {
    it("Target vs Ceiling section still present", () => {
      const content = readContract();
      expect(content).toContain("## Target vs Ceiling — read this first");
    });

    it("Enforcement section still present", () => {
      const content = readContract();
      expect(content).toContain("## Enforcement");
    });

    it("'Do not raise the ceiling or the floor' bullet still present verbatim", () => {
      const content = readContract();
      expect(content).toContain("raise the ceiling");
    });

    it("'Do not record the fact in another module's file' bullet still present verbatim", () => {
      const content = readContract();
      expect(content).toContain("another module's file");
    });

    it("'Do not disable the check for the file you are editing' bullet still present verbatim", () => {
      const content = readContract();
      expect(content).toContain("disable the check");
    });
  });
});

describe("claude-md contract asset — Content Tiers rule (tier 1 = rule only, tier 2 = why)", () => {
  const content = readContract();

  describe("HAPPY — the Content Tiers section and its tier-1 admission rule", () => {
    it("the Content Tiers heading exists and precedes `What Goes In vs What Stays Out`", () => {
      const tiersIdx = content.indexOf("## Content Tiers — what every session pays for");
      const goesInIdx = content.indexOf("## What Goes In vs What Stays Out");
      expect(tiersIdx).toBeGreaterThanOrEqual(0);
      expect(goesInIdx).toBeGreaterThanOrEqual(0);
      expect(tiersIdx).toBeLessThan(goesInIdx);
    });

    it("a line belongs on tier 1 only when ALL three conditions hold", () => {
      expect(content).toContain("ALL three hold");
    });

    it("a tier-1 line states the rule and may keep one short scope-setting reason clause", () => {
      const flat = content.replace(/\s+/g, " ");
      expect(flat).toContain("one short reason clause");
      expect(flat).toContain("never reasoning");
      expect(flat).toContain("follow the `lore-context-optimizer` skill");
    });
  });

  describe("HAPPY — the three new What-Goes-In rows route to tier 2 / the module's own file", () => {
    it.each([
      { category: "Design intent and rationale", home: "OUT — tier 2 (corpus ADR, module CLAUDE.md)" },
      { category: "Mechanism walkthroughs", home: "OUT — tier 2 (module CLAUDE.md or corpus reference)" },
      { category: "Module-local facts", home: "OUT — that module's own CLAUDE.md" },
    ])("row `$category` is present with its home `$home`", ({ category, home }) => {
      const row = content.split("\n").find((line) => line.startsWith(`| ${category} |`));
      expect(row).toBeDefined();
      expect(row).toContain(home);
    });
  });

  describe("HAPPY — root section 3 and the module taxonomy follow the tier rule", () => {
    it("root section 3 Architecture is one-line invariants; design intent is tier 2", () => {
      const idx = content.indexOf("3. **Architecture**");
      expect(idx).toBeGreaterThanOrEqual(0);
      const section = content.slice(idx, content.indexOf("4. **Module Index**", idx));
      const flat = section.replace(/\s+/g, " ");
      expect(flat).toContain("scope-setting reason clause");
      expect(flat).toContain("history are tier 2");
    });

    it("the module taxonomy applies the Content Tiers rule one level down", () => {
      expect(content).toContain("applies one level down");
    });
  });

  describe("NEGATIVE — the retired wording is gone", () => {
    it("root section 3 no longer asks for design intent and the why inline", () => {
      expect(content).not.toContain("design intent and the *why* behind key decisions, not a");
    });

    it("the absolute 'states the rule, never the reasoning' wording is gone", () => {
      expect(content.replace(/\s+/g, " ")).not.toContain("states the rule, never the reasoning");
    });
  });
});
