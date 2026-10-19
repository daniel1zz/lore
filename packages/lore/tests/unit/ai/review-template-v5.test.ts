// @reads packages/lore/tests/fixtures/design-necessity/review-prompt-v1-v3-frozen.json
// @reads packages/lore/tests/fixtures/design-necessity/review-prompt-v4-frozen.json
/**
 * Review judge prompt v5 (refined design-necessity rule): v5 is the current version; its prompt for a
 * spec, a plan and an ADR carries the four NON-findings, the four FINDINGS and the classify-first
 * instruction; v1-v4 builders still produce the bytes recorded in the two frozen snapshots
 * (v4 snapshotted from the builder BEFORE v5 was added).
 *
 * Side-effect class: reads two fixture files; no IO otherwise.
 *
 * Six-dimension coverage:
 *   HAPPY:      v5 is current and registered; every doc kind gets the refined rule
 *   NEGATIVE:   v1-v4 prompts do not carry the v5-only classification wording
 *   BOUNDARY:   v5 = v3 bytes + exactly one RULES block, which is not the v4 block
 *   ERROR:      an unknown version key is absent from the registry
 *   STATE:      registry keys are exactly v1..v5
 *   REGRESSION: v1-v4 byte-identical to the frozen snapshots for spec, plan, adr
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { REVIEW_TEMPLATES, REVIEW_PROMPT_VERSION } from "../../../src/ai/review-template.js";
import {
  FROZEN_BUNDLES,
  FROZEN_BUDGETS,
  FROZEN_CHECKS,
  FROZEN_NOW,
} from "../../fixtures/design-necessity/frozen-bundles.js";

function loadFrozen(name: string): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`../../fixtures/design-necessity/${name}`, import.meta.url), "utf8")) as Record<
    string,
    string
  >;
}
const FROZEN = { ...loadFrozen("review-prompt-v1-v3-frozen.json"), ...loadFrozen("review-prompt-v4-frozen.json") };

const KINDS = ["spec", "plan", "adr"] as const;

function render(version: string, kind: (typeof KINDS)[number]): string {
  return REVIEW_TEMPLATES[version]!(FROZEN_BUNDLES[kind], FROZEN_CHECKS, FROZEN_BUDGETS, FROZEN_NOW).prompt;
}

describe("review prompt v5", () => {
  it("STATE: v5 stays registered (frozen) and the registry holds exactly v1..v6", () => {
    expect(REVIEW_PROMPT_VERSION).not.toBe("v5");
    expect(Object.keys(REVIEW_TEMPLATES).sort()).toEqual(["v1", "v2", "v3", "v4", "v5", "v6"]);
    expect(typeof REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]).toBe("function");
  });

  it("ERROR: an unknown version key is not registered", () => {
    expect(REVIEW_TEMPLATES["v7"]).toBeUndefined();
  });

  it.each(KINDS)("HAPPY: the v5 prompt for a %s lists the four non-findings", (kind) => {
    const prompt = render("v5", kind);
    expect(prompt).toContain("design_necessity");
    expect(prompt).toContain("NOT findings");
    expect(prompt).toContain("product semantics a user relies on");
    expect(prompt).toContain("interface or port contract");
    expect(prompt).toContain("validation of outside input at the boundary");
    expect(prompt).toContain("what an acceptance test needs to be safe and meaningful when the design is violated");
  });

  it.each(KINDS)("HAPPY: the v5 prompt for a %s lists the four findings", (kind) => {
    const prompt = render("v5", kind);
    expect(prompt).toContain("FINDINGS");
    expect(prompt).toContain("whose only purpose is catching a violation of the document's OWN invariant");
    expect(prompt).toContain("stopgap or temporary seam");
    expect(prompt).toContain("silent fallback for a missing required input");
    expect(prompt).toContain("transitional or phased state");
    expect(prompt).toContain("skip/compat/legacy mode");
    expect(prompt).toContain("ratchet");
  });

  it.each(KINDS)("HAPPY: the v5 prompt for a %s requires explicit classification before the decision", (kind) => {
    const prompt = render("v5", kind);
    expect(prompt).toContain("FIRST list every candidate item");
    expect(prompt).toContain("classify each");
    expect(prompt).toContain("Only then decide");
    expect(prompt).toContain("end-state alternative");
    expect(prompt).toContain('you MUST return decision "reject"');
    expect(prompt).toContain('MUST contain NO entry with dimension "design_necessity"');
  });

  it.each(["v1", "v2", "v3", "v4"])("NEGATIVE: the %s prompt has no v5 classification wording", (version) => {
    for (const kind of KINDS) {
      expect(render(version, kind)).not.toContain("FIRST list every candidate item");
      expect(render(version, kind)).not.toContain("NOT findings");
    }
  });

  it.each(KINDS)("BOUNDARY: v5 for a %s is v3 plus exactly one added RULES block that is not v4's", (kind) => {
    const v3 = render("v3", kind);
    const v4 = render("v4", kind);
    const v5 = render("v5", kind);
    const start = v5.indexOf("- DESIGN NECESSITY");
    expect(start).toBeGreaterThan(-1);
    expect(v5.slice(0, start)).toBe(v3);
    expect(v5.slice(start)).not.toBe(v4.slice(start));
    expect(v5.indexOf("- DESIGN NECESSITY", start + 1)).toBe(-1);
  });

  it.each(["v1", "v2", "v3", "v4"])("REGRESSION: %s output is byte-identical to the frozen snapshot", (version) => {
    for (const kind of KINDS) {
      expect(render(version, kind)).toBe(FROZEN[`${version}:${kind}`]);
    }
  });
});
