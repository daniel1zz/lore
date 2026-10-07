/**
 * RED tests for the pure root/module H2 structure checks
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, AC-STR-1;
 * task-skill-test-structure-check-cli-adoption-surface-red).
 *
 * `packages/lore/src/service/claude-md-structure.ts` does not exist at the
 * authoring base, so this file is RED with an import-resolution failure.
 * Expectations come from the spec's Public Interface / Definitions / D5, not
 * from any implementation.
 *
 * Covered dimensions: HAPPY / NEGATIVE (H3, lowercase, fenced) / BOUNDARY
 * (setext, indented code, empty-vs-H3 body) / STATE (mode-free purity).
 *
 * @spec_ref AC-STR-1
 */

import { describe, it, expect } from "vitest";
import {
  parseH2Headings,
  checkRootStructure,
  checkModuleStructure,
} from "../../../src/service/claude-md-structure.js";

// The spec's ROOT_REQUIRED_SECTIONS, spelled out literally so a wrong constant
// in core cannot make these tests tautological.
const ROOT = [
  "What This Is",
  "Commands",
  "Architecture",
  "Module Index",
  "Finding Live Project State",
] as const;

const file = (content: string, role: "root" | "module" = "root", path = "CLAUDE.md") => ({
  path,
  role,
  content,
});

/** Build a root file: each section gets one real body line. */
const rootBody = (sections: readonly string[]): string =>
  sections.map((s) => `## ${s}\n\nbody of ${s}\n`).join("\n");

describe("parseH2Headings", () => {
  it("returns text and 1-based line for each '## ' heading", () => {
    const hs = parseH2Headings("# Title\n\n## Alpha\ntext\n## Beta\n");
    expect(hs).toEqual([
      { text: "Alpha", line: 3 },
      { text: "Beta", line: 5 },
    ]);
  });

  it("does not return H3 or H1 headings", () => {
    const hs = parseH2Headings("# One\n### Three\n#### Four\n## Two\n");
    expect(hs.map((h) => h.text)).toEqual(["Two"]);
  });

  it("skips headings inside ``` fences", () => {
    const hs = parseH2Headings("## A\n```\n## Fake\n```\n## B\n");
    expect(hs.map((h) => h.text)).toEqual(["A", "B"]);
  });

  it("skips headings inside ~~~ fences", () => {
    const hs = parseH2Headings("## A\n~~~\n## Fake\n~~~\n## B\n");
    expect(hs.map((h) => h.text)).toEqual(["A", "B"]);
  });

  it("trims surrounding whitespace but preserves case", () => {
    const hs = parseH2Headings("##   Commands   \n");
    expect(hs.map((h) => h.text)).toEqual(["Commands"]);
  });
});

describe("checkRootStructure", () => {
  it("HAPPY: all five H2 in order -> 0 deterministic findings", () => {
    const r = checkRootStructure(file(rootBody(ROOT)), ROOT);
    expect(r.deterministic).toEqual([]);
  });

  it("HAPPY: all five H2 in order -> 0 advisory findings", () => {
    const r = checkRootStructure(file(rootBody(ROOT)), ROOT);
    expect(r.advisory).toEqual([]);
  });

  it("missing '## Commands' -> exactly one section_missing referencing 'Commands'", () => {
    const sections = ROOT.filter((s) => s !== "Commands");
    const r = checkRootStructure(file(rootBody(sections)), ROOT);
    expect(r.deterministic).toHaveLength(1);
    expect(r.deterministic[0]?.kind).toBe("section_missing");
    expect(r.deterministic[0]?.reference).toBe("Commands");
  });

  it("missing a DIFFERENT section ('Module Index') names that section, not Commands (defeats hardcoded return)", () => {
    const sections = ROOT.filter((s) => s !== "Module Index");
    const r = checkRootStructure(file(rootBody(sections)), ROOT);
    expect(r.deterministic.map((f) => [f.kind, f.reference])).toEqual([
      ["section_missing", "Module Index"],
    ]);
  });

  it("two missing sections -> two section_missing findings with exact names", () => {
    const sections = ROOT.filter((s) => s !== "Commands" && s !== "Architecture");
    const r = checkRootStructure(file(rootBody(sections)), ROOT);
    expect(r.deterministic.map((f) => f.reference).sort()).toEqual(["Architecture", "Commands"]);
  });

  it("empty file -> five section_missing findings", () => {
    const r = checkRootStructure(file(""), ROOT);
    expect(r.deterministic.filter((f) => f.kind === "section_missing")).toHaveLength(5);
  });

  it("finding names the file path", () => {
    const sections = ROOT.filter((s) => s !== "Commands");
    const r = checkRootStructure(file(rootBody(sections), "root", "AGENTS.md"), ROOT);
    expect(r.deterministic[0]?.path).toBe("AGENTS.md");
  });

  it("'Commands' placed after 'Architecture' -> one section_order finding", () => {
    const order = ["What This Is", "Architecture", "Commands", "Module Index", "Finding Live Project State"];
    const r = checkRootStructure(file(rootBody(order)), ROOT);
    expect(r.deterministic.map((f) => f.kind)).toEqual(["section_order"]);
  });

  it("'## Commands' twice -> section_duplicate", () => {
    const body = rootBody(ROOT) + "\n## Commands\n\nagain\n";
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic.map((f) => f.kind)).toContain("section_duplicate");
  });

  it("'### Commands' instead of '## Commands' -> section_missing (H2 only)", () => {
    const body = rootBody(ROOT).replace("## Commands", "### Commands");
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic.map((f) => [f.kind, f.reference])).toEqual([["section_missing", "Commands"]]);
  });

  it("'## commands' (lowercase) instead of '## Commands' -> section_missing (case-sensitive)", () => {
    const body = rootBody(ROOT).replace("## Commands", "## commands");
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic.map((f) => [f.kind, f.reference])).toEqual([["section_missing", "Commands"]]);
  });

  it("'#### Commands' does not satisfy 'Commands' (falsifier: #{2,} match)", () => {
    const body = rootBody(ROOT).replace("## Commands", "#### Commands");
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic.map((f) => f.reference)).toEqual(["Commands"]);
  });

  it("setext H2 ('Commands' underlined with '---') COUNTS as Commands (CommonMark)", () => {
    const body = rootBody(ROOT).replace("## Commands\n", "Commands\n---\n");
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic).toEqual([]);
  });

  it("'## Commands' inside a ``` fence does NOT count", () => {
    const body = rootBody(ROOT).replace("## Commands\n\nbody of Commands\n", "```\n## Commands\n```\n");
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic.map((f) => [f.kind, f.reference])).toEqual([["section_missing", "Commands"]]);
  });

  it("'## Commands' inside an indented code block does NOT count", () => {
    const body = rootBody(ROOT).replace("## Commands\n", "text before\n\n    ## Commands\n\n");
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic.map((f) => [f.kind, f.reference])).toEqual([["section_missing", "Commands"]]);
  });

  it("extra '## North Star' -> advisory section_extra and 0 deterministic", () => {
    const body = rootBody(ROOT) + "\n## North Star\n\nwhy\n";
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic).toEqual([]);
    expect(r.advisory.map((f) => f.kind)).toEqual(["section_extra"]);
  });

  it("required section with only blanks and an HTML comment body -> advisory section_empty", () => {
    const body = rootBody(ROOT).replace("body of Commands", "<!-- fill me -->\n\n");
    const r = checkRootStructure(file(body), ROOT);
    expect(r.deterministic).toEqual([]);
    expect(r.advisory.map((f) => f.kind)).toEqual(["section_empty"]);
  });

  it("required section whose body is an H3 only is NOT empty (H3 counts as content)", () => {
    const body = rootBody(ROOT).replace("body of Commands", "### Sub\n");
    const r = checkRootStructure(file(body), ROOT);
    expect(r.advisory.map((f) => f.kind)).not.toContain("section_empty");
  });

  it("is mode-free: result never contains a 'downgraded' finding", () => {
    const sections = ROOT.filter((s) => s !== "Commands");
    const r = checkRootStructure(file(rootBody(sections)), ROOT);
    expect(r.advisory.map((f) => f.kind)).not.toContain("downgraded");
  });

  it("honours the `required` parameter (custom list, not the baked-in five)", () => {
    const r = checkRootStructure(file("## Alpha\nx\n"), ["Alpha", "Beta"]);
    expect(r.deterministic.map((f) => [f.kind, f.reference])).toEqual([["section_missing", "Beta"]]);
  });

  it("signature: accepts exactly (file, required)", () => {
    expect(checkRootStructure.length).toBe(2);
  });
});

describe("checkModuleStructure", () => {
  const MODULE = ["Purpose"] as const;

  it("module file with '## Purpose' -> no findings", () => {
    const r = checkModuleStructure(file("## Purpose\n\nx\n", "module", "src/CLAUDE.md"), MODULE);
    expect(r).toEqual([]);
  });

  it("module file without '## Purpose' -> advisory module_section_missing", () => {
    const r = checkModuleStructure(file("## Other\n\nx\n", "module", "src/CLAUDE.md"), MODULE);
    expect(r.map((f) => f.kind)).toEqual(["module_section_missing"]);
  });

  it("module '### Purpose' does not satisfy Purpose", () => {
    const r = checkModuleStructure(file("### Purpose\nx\n", "module", "src/CLAUDE.md"), MODULE);
    expect(r.map((f) => f.kind)).toEqual(["module_section_missing"]);
  });

  it("module '## purpose' (lowercase) does not satisfy Purpose", () => {
    const r = checkModuleStructure(file("## purpose\nx\n", "module", "src/CLAUDE.md"), MODULE);
    expect(r.map((f) => f.kind)).toEqual(["module_section_missing"]);
  });

  it("module check on an empty file yields exactly one advisory finding", () => {
    const r = checkModuleStructure(file("", "module", "src/CLAUDE.md"), MODULE);
    expect(r).toHaveLength(1);
  });

  it("signature: accepts exactly (file, required)", () => {
    expect(checkModuleStructure.length).toBe(2);
  });
});
