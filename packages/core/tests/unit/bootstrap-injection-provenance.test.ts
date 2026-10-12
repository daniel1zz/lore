/**
 * Surviving cases of the context-provenance constants suite
 * (spec-context-provenance-injected-corpus-global-state-and-a, AC-CP-*).
 *
 * The cases that asserted the old corpus-global `scope_declaration` wording,
 * the retired `buildBootstrapInjection(report, budgets, seatScoped)` projection
 * (leading-key order, count-cap ledger, budget short-circuit boundary,
 * schema round-trip, purity, field-order regression) were DELETED when the
 * injection became seat-only — spec-session-start-injection-carries-only-the-session-s-own D10;
 * their replacements live in `bootstrap-seat-injection.test.ts` (AC-SI-1).
 * Only the constants that are still exported unchanged remain here.
 */

import { describe, it, expect } from "vitest";
import {
  BOOTSTRAP_FRAMING_LINE,
  RESUME_SCOPE_CLOSURE,
  SOURCE_CATEGORY_TOKENS,
  BOOTSTRAP_RESUME_CLOSURE_KEYS,
} from "../../src/session.js";

describe("HAPPY — sibling-consumed constants (T2/T3/T4) are exported and well-formed", () => {
  it("HAPPY: BOOTSTRAP_FRAMING_LINE is a non-empty single-line string for T2's binary-side stdout", () => {
    expect(typeof BOOTSTRAP_FRAMING_LINE).toBe("string");
    expect(BOOTSTRAP_FRAMING_LINE.length).toBeGreaterThan(0);
    expect(BOOTSTRAP_FRAMING_LINE).not.toContain("\n");
  });

  it("HAPPY: RESUME_SCOPE_CLOSURE names every BOOTSTRAP_RESUME_CLOSURE_KEYS member for T3's scope-closure block", () => {
    expect(BOOTSTRAP_RESUME_CLOSURE_KEYS.size).toBeGreaterThan(0);
    for (const key of BOOTSTRAP_RESUME_CLOSURE_KEYS) {
      expect(RESUME_SCOPE_CLOSURE).toContain(key);
    }
  });

  it("HAPPY: SOURCE_CATEGORY_TOKENS carries exactly the three source categories for T4's governance rule", () => {
    expect(SOURCE_CATEGORY_TOKENS).toEqual(["pasted ticket", "session-start injection", "this-turn query"]);
  });
});
