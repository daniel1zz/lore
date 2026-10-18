// @reads packages/lore/tests/fixtures/design-necessity/review-prompt-v1-v3-frozen.json
/**
 * Review judge prompt v4 (design necessity): v4 is the current version, its assembled prompt for a
 * spec, a plan and an ADR carries the design_necessity rule (four item classes + end-state test), and
 * the v1/v2/v3 builders still produce the bytes recorded in `review-prompt-v1-v3-frozen.json`
 * (snapshotted from the builders BEFORE v4 existed).
 *
 * Side-effect class: reads one fixture file; no IO otherwise.
 *
 * Six-dimension coverage:
 *   HAPPY:      v4 is current and registered; every doc kind gets the rule
 *   NEGATIVE:   v1-v3 prompts do not mention design_necessity
 *   BOUNDARY:   v4 differs from v3 ONLY by the added rule text (removing it restores v3 bytes)
 *   ERROR:      an unknown version key is absent from the registry
 *   STATE:      registry keys are exactly v1..v4
 *   REGRESSION: v1-v3 byte-identical to the frozen snapshot for spec, plan, adr
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

const FROZEN = JSON.parse(
  readFileSync(new URL("../../fixtures/design-necessity/review-prompt-v1-v3-frozen.json", import.meta.url), "utf8"),
) as Record<string, string>;

const KINDS = ["spec", "plan", "adr"] as const;

function render(version: string, kind: (typeof KINDS)[number]): string {
  return REVIEW_TEMPLATES[version]!(FROZEN_BUNDLES[kind], FROZEN_CHECKS, FROZEN_BUDGETS, FROZEN_NOW).prompt;
}

describe("review prompt v4", () => {
  it("STATE: the current version is v4 and the registry holds exactly v1..v4", () => {
    expect(REVIEW_PROMPT_VERSION).toBe("v4");
    expect(Object.keys(REVIEW_TEMPLATES).sort()).toEqual(["v1", "v2", "v3", "v4"]);
    expect(typeof REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]).toBe("function");
  });

  it("ERROR: an unknown version key is not registered", () => {
    expect(REVIEW_TEMPLATES["v5"]).toBeUndefined();
  });

  it.each(KINDS)("HAPPY: the v4 prompt for a %s carries the design_necessity rule", (kind) => {
    const prompt = render("v4", kind);
    expect(prompt).toContain("design_necessity");
    expect(prompt).toContain("stopgap or temporary seam");
    expect(prompt).toContain("guard check, scanner or ledger");
    expect(prompt).toContain("silent fallback");
    expect(prompt).toContain("phased or transitional migration");
    expect(prompt).toContain("end-state design");
    expect(prompt).toContain('decision "reject"');
    expect(prompt).toContain("is not a finding");
  });

  it.each(["v1", "v2", "v3"])("NEGATIVE: the %s prompt does not mention design_necessity", (version) => {
    for (const kind of KINDS) expect(render(version, kind)).not.toContain("design_necessity");
  });

  it.each(KINDS)("BOUNDARY: v4 for a %s is v3 plus exactly one added RULES block", (kind) => {
    const v3 = render("v3", kind);
    const v4 = render("v4", kind);
    expect(v4.length).toBeGreaterThan(v3.length);
    const start = v4.indexOf("- DESIGN NECESSITY");
    expect(start).toBeGreaterThan(-1);
    // the rule block is the final RULES entry: everything before it equals v3
    expect(v4.slice(0, start)).toBe(v3);
  });

  it.each(["v1", "v2", "v3"])("REGRESSION: %s output is byte-identical to the frozen snapshot", (version) => {
    for (const kind of KINDS) {
      expect(render(version, kind)).toBe(FROZEN[`${version}:${kind}`]);
    }
  });
});
