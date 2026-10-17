// @reads assets/governance/claude-md-contract.md
/**
 * RED-phase contract-parity suite for
 * `spec-claude-md-root-section-structure-check-and-adoption-mode` AC-STR-7
 * (task `task-skill-test-contract-section-parity-real-binary-pre-push`).
 *
 * The distributed contract (`assets/governance/claude-md-contract.md`, served
 * by `lore governance claude-md`) tells consumers which root H2 sections a
 * CLAUDE.md needs. The deterministic check enforces `ROOT_REQUIRED_SECTIONS`
 * from `@lore/core`. These two MUST be the same list, in the same order, or
 * the prose promises something the gate does not check (or vice versa).
 *
 * Pure `node:fs` read; no subprocess, no store.
 *
 * Coverage:
 *   HAPPY:      numbered list in the contract == ROOT_REQUIRED_SECTIONS, in order;
 *               "must contain" / "in this order" wording; "Adoption Mode" heading.
 *   NEGATIVE:   the retired "exactly these headings" wording is gone.
 *   BOUNDARY:   the list is parsed from the root-section block only (the eviction
 *               "How to evict" numbered list must not leak in); length is exact.
 *   REGRESSION: parser self-check proves the extractor reads a differing list.
 *
 * @spec_ref AC-STR-7
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as core from "@lore/core";

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const CONTRACT = readFileSync(join(REPO_ROOT, "assets", "governance", "claude-md-contract.md"), "utf8");

/** Looked up dynamically: a missing export must surface as an assertion failure, not a transform error. */
function exportedRootSections(): readonly string[] | undefined {
  const value = (core as Record<string, unknown>)["ROOT_REQUIRED_SECTIONS"];
  return Array.isArray(value) ? (value as readonly string[]) : undefined;
}

/** Body of the `## Root CLAUDE.md ...` section (up to the next H2). */
function rootSectionBody(markdown: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^## Root CLAUDE\.md/.test(l));
  if (start === -1) throw new Error("contract has no '## Root CLAUDE.md' section");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Names from top-level numbered items written as `N. **Name** ...`. */
function numberedSectionNames(body: string): string[] {
  const names: string[] = [];
  for (const line of body.split("\n")) {
    const m = /^\d+\.\s+\*\*(.+?)\*\*/.exec(line);
    if (m?.[1] !== undefined) names.push(m[1].trim());
  }
  return names;
}

describe("claude-md contract: root section list parity with ROOT_REQUIRED_SECTIONS", () => {
  it("@lore/core exports ROOT_REQUIRED_SECTIONS as a non-empty list", () => {
    expect(exportedRootSections()?.length ?? 0).toBeGreaterThan(0);
  });

  it("the contract's numbered root-section list equals ROOT_REQUIRED_SECTIONS exactly and in order", () => {
    const sections = exportedRootSections();
    expect(sections).toBeDefined();
    expect(numberedSectionNames(rootSectionBody(CONTRACT))).toEqual([...(sections ?? [])]);
  });

  it("the contract's numbered root list has exactly five entries (eviction list does not leak in)", () => {
    expect(numberedSectionNames(rootSectionBody(CONTRACT))).toHaveLength(5);
  });

  it("the contract states that a root file 'must contain' the sections", () => {
    expect(CONTRACT).toMatch(/must contain/i);
  });

  it("the contract states the sections come 'in this order'", () => {
    expect(CONTRACT).toMatch(/in this order/i);
  });

  it("the contract has an 'Adoption Mode' heading", () => {
    expect(CONTRACT).toMatch(/^#{2,3} .*Adoption Mode/m);
  });

  it("the Adoption Mode section names both modes, enforce and warn", () => {
    const idx = CONTRACT.search(/^#{2,3} .*Adoption Mode/m);
    const tail = idx === -1 ? "" : CONTRACT.slice(idx);
    expect(/enforce/.test(tail) && /warn/.test(tail)).toBe(true);
  });

  it("the contract no longer says 'exactly these headings'", () => {
    expect(CONTRACT).not.toMatch(/exactly these headings/i);
  });

  it("REGRESSION (parser self-check): the extractor reads a differing list, so the parity test is not vacuous", () => {
    const fake = "## Root CLAUDE.md — x\n\n1. **Alpha** — a\n2. **Beta** — b\n\n## Next\n1. **Gamma** — c\n";
    expect(numberedSectionNames(rootSectionBody(fake))).toEqual(["Alpha", "Beta"]);
  });
});
