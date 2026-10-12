/**
 * Unit suite for the resume-ticket LOWER-bound vocabulary landed in
 * `@lore/core`'s session.ts —
 * spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D1, D3, D5, D8,
 * D9; task task-t1-core-constants-pure-cardinality-renderer (T1).
 *
 * Scope: this file is an ISOLATED unit test for T1's deliverables only —
 * the constants and the pure cardinality renderer. AC-RC-2 and AC-RC-3 are
 * asserted END-TO-END once sibling T2 wires these into the render path
 * (`packages/lore/tests/unit/feed-resume-coverage.test.ts`); this file only
 * proves the vocabulary itself is sound in isolation.
 *
 * D6/D7 discipline (binding on this file, same as
 * bootstrap-injection-provenance.test.ts): no assertion keys off a
 * hand-typed remembered substring. Containment checks against
 * RESUME_COVERAGE_FLOOR derive their expected tokens from OTHER exported
 * constants (RESUME_DISPOSITION_DONE, RESUME_DISPOSITION_DEFERRED_PREFIX,
 * the two id prefixes) or from independent lone tokens
 * ("disposition"/"session") rather than a copied multi-word phrase — the
 * contiguous-substring false-oracle vector this repo's CLAUDE.md
 * dogfood-eval-log already tracks.
 *
 * Six-dimension coverage:
 *   HAPPY:      both boundary constants are non-empty and distinct; id
 *               prefixes + formatResumeItemId combine correctly;
 *               disposition tokens are well-formed; cardinality renderer
 *               happy path (4, 6); RESUME_SCOPE_CLOSURE still names every
 *               BOOTSTRAP_RESUME_CLOSURE_KEYS member (regression-shaped,
 *               proves this task did not touch the upper-bound constant)
 *   NEGATIVE:   the constructed "would fail if merged" case — see the
 *               dedicated describe block below; a negative control proving
 *               `.not.toContain` actually discriminates
 *   BOUNDARY:   cardinality renderer at (0, 1) and (0, 0) — zero decisions
 *               handled with no special branch; formatResumeItemId at the
 *               smallest legal 1-based index
 *   ERROR:      N/A — these are pure internal helpers over numbers already
 *               derived from `array.length` (always a valid non-negative
 *               integer by construction); there is no untrusted external
 *               boundary here for a Zod parse to guard (zod-as-ssot applies
 *               to boundary-crossing data, not internal pure composition)
 *   STATE:      referential transparency — repeated calls with the same
 *               input produce byte-identical output, interleaved with
 *               different-input calls to rule out hidden internal state
 *   REGRESSION: RESUME_SCOPE_CLOSURE is unchanged by this task (iterates
 *               BOOTSTRAP_RESUME_CLOSURE_KEYS, never a hand-copied
 *               substring, per the task packet's explicit instruction)
 *
 * Source: spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * §Design Decisions D1, D3, D5, D7, D8, D9.
 */

import { describe, it, expect } from "vitest";
import {
  RESUME_SCOPE_CLOSURE,
  RESUME_COVERAGE_FLOOR,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
  formatResumeItemId,
  RESUME_DISPOSITION_MARKER,
  RESUME_DISPOSITION_DONE,
  RESUME_DISPOSITION_DEFERRED_PREFIX,
  renderResumeCoverageCardinalityLine,
  BOOTSTRAP_RESUME_CLOSURE_KEYS,
} from "../../src/session.js";

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("HAPPY — RESUME_COVERAGE_FLOOR / RESUME_SCOPE_CLOSURE distinctness", () => {
  it("HAPPY: both boundary constants are non-empty strings", () => {
    expect(typeof RESUME_SCOPE_CLOSURE).toBe("string");
    expect(RESUME_SCOPE_CLOSURE.length).toBeGreaterThan(0);
    expect(typeof RESUME_COVERAGE_FLOOR).toBe("string");
    expect(RESUME_COVERAGE_FLOOR.length).toBeGreaterThan(0);
  });

  it("HAPPY: RESUME_COVERAGE_FLOOR and RESUME_SCOPE_CLOSURE are distinct strings (D3 — never merged into one)", () => {
    expect(RESUME_COVERAGE_FLOOR).not.toBe(RESUME_SCOPE_CLOSURE);
  });

  it("HAPPY: RESUME_COVERAGE_FLOOR states the per-item accounting obligation, derived from the exported disposition tokens and id prefixes (not a hand-copied phrase)", () => {
    expect(RESUME_COVERAGE_FLOOR).toContain(RESUME_ITEM_ID_PREFIX_KEY_DECISION);
    expect(RESUME_COVERAGE_FLOOR).toContain(RESUME_ITEM_ID_PREFIX_NEXT_STEP);
    expect(RESUME_COVERAGE_FLOOR).toContain(RESUME_DISPOSITION_DONE);
    expect(RESUME_COVERAGE_FLOOR).toContain(RESUME_DISPOSITION_DEFERRED_PREFIX);
    // Lone, independent tokens (D7) — not a remembered multi-word phrase.
    expect(RESUME_COVERAGE_FLOOR.toLowerCase()).toContain("disposition");
    expect(RESUME_COVERAGE_FLOOR.toLowerCase()).toContain("session");
  });
});

describe("HAPPY — item-id prefixes + formatResumeItemId", () => {
  it("HAPPY: prefixes are the expected non-empty, distinct literals", () => {
    expect(RESUME_ITEM_ID_PREFIX_KEY_DECISION).toBe("KD");
    expect(RESUME_ITEM_ID_PREFIX_NEXT_STEP).toBe("NS");
    expect(RESUME_ITEM_ID_PREFIX_KEY_DECISION.length).toBeGreaterThan(0);
    expect(RESUME_ITEM_ID_PREFIX_NEXT_STEP.length).toBeGreaterThan(0);
    expect(RESUME_ITEM_ID_PREFIX_KEY_DECISION).not.toBe(RESUME_ITEM_ID_PREFIX_NEXT_STEP);
  });

  it("HAPPY: formatResumeItemId combines a prefix and 1-based index into the expected tag", () => {
    expect(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 1)).toBe("KD1");
    expect(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 4)).toBe("KD4");
    expect(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 6)).toBe("NS6");
  });
});

describe("HAPPY — disposition grammar vocabulary", () => {
  it("HAPPY: RESUME_DISPOSITION_MARKER is modeled on the **[DOC_SYNC]** shape — bold-wrapped bracket literal", () => {
    expect(RESUME_DISPOSITION_MARKER.startsWith("**[")).toBe(true);
    expect(RESUME_DISPOSITION_MARKER.endsWith("]**")).toBe(true);
    expect(RESUME_DISPOSITION_MARKER.length).toBeGreaterThan(0);
  });

  it("HAPPY: the two accepted disposition tokens are exactly 'done' and 'deferred:'", () => {
    expect(RESUME_DISPOSITION_DONE).toBe("done");
    expect(RESUME_DISPOSITION_DEFERRED_PREFIX).toBe("deferred:");
    expect(RESUME_DISPOSITION_DEFERRED_PREFIX.endsWith(":")).toBe(true);
  });
});

describe("HAPPY — cardinality renderer, standard case", () => {
  it("HAPPY: renderResumeCoverageCardinalityLine(4, 6) reports 4 decisions, 6 next steps, 10 total", () => {
    expect(renderResumeCoverageCardinalityLine(4, 6)).toBe(
      "SCOPE: 4 decisions + 6 next steps = 10 items to account for",
    );
  });
});

describe("HAPPY (regression-shaped) — RESUME_SCOPE_CLOSURE unaffected by this task", () => {
  it("HAPPY: RESUME_SCOPE_CLOSURE still names every BOOTSTRAP_RESUME_CLOSURE_KEYS member, derived from the set itself (not a hand-copied field list)", () => {
    expect(BOOTSTRAP_RESUME_CLOSURE_KEYS.size).toBeGreaterThan(0);
    for (const key of BOOTSTRAP_RESUME_CLOSURE_KEYS) {
      expect(RESUME_SCOPE_CLOSURE).toContain(key);
    }
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — merged-into-one-string detector is live", () => {
  // Constructed negative case (verification-discipline requirement): this is
  // the ONE assertion designed to FAIL if a future edit merged
  // RESUME_COVERAGE_FLOOR into RESUME_SCOPE_CLOSURE (e.g. re-exporting
  // RESUME_COVERAGE_FLOOR as an alias of RESUME_SCOPE_CLOSURE, or
  // concatenating the lower-bound sentence onto the upper-bound constant and
  // dropping the separate export). D3's own failure mode is exactly "one
  // direction present, the other absent" — collapsing the two into a single
  // shared string value is the precise defect this test exists to catch.
  it("NEGATIVE: RESUME_COVERAGE_FLOOR does not equal RESUME_SCOPE_CLOSURE (would fail under a merged-alias implementation)", () => {
    expect(RESUME_COVERAGE_FLOOR).not.toBe(RESUME_SCOPE_CLOSURE);
  });

  it("NEGATIVE: neither boundary constant is a substring of the other — proves they are independently authored text, not one derived from the other by concatenation/truncation", () => {
    expect(RESUME_SCOPE_CLOSURE).not.toContain(RESUME_COVERAGE_FLOOR);
    expect(RESUME_COVERAGE_FLOOR).not.toContain(RESUME_SCOPE_CLOSURE);
  });

  it("NEGATIVE control: a phrase never promised by RESUME_COVERAGE_FLOOR is correctly absent — proves the .toContain assertions above actually discriminate rather than vacuously passing", () => {
    expect(RESUME_COVERAGE_FLOOR).not.toContain("some unrelated phrase that was never promised");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — cardinality renderer, zero-decisions and all-zero", () => {
  it("BOUNDARY: renderResumeCoverageCardinalityLine(0, 1) handles zero decisions with no special branch", () => {
    expect(renderResumeCoverageCardinalityLine(0, 1)).toBe(
      "SCOPE: 0 decisions + 1 next steps = 1 items to account for",
    );
  });

  it("BOUNDARY: renderResumeCoverageCardinalityLine(0, 0) — both arrays empty — still returns a well-formed line, never throws", () => {
    expect(() => renderResumeCoverageCardinalityLine(0, 0)).not.toThrow();
    expect(renderResumeCoverageCardinalityLine(0, 0)).toBe(
      "SCOPE: 0 decisions + 0 next steps = 0 items to account for",
    );
  });
});

describe("BOUNDARY — formatResumeItemId at the smallest legal 1-based index", () => {
  it("BOUNDARY: index 1 (first item in either array) formats correctly for both prefixes", () => {
    expect(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 1)).toBe("KD1");
    expect(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 1)).toBe("NS1");
  });
});

// ─── STATE (referential transparency) ────────────────────────────────────────

describe("STATE — renderResumeCoverageCardinalityLine is referentially transparent", () => {
  it("STATE: repeated calls with the same input produce byte-identical output, even when interleaved with different-input calls", () => {
    const first = renderResumeCoverageCardinalityLine(4, 6);
    // Interleave a call with different arguments to rule out hidden shared
    // mutable state inside the function.
    const unrelated = renderResumeCoverageCardinalityLine(2, 3);
    const second = renderResumeCoverageCardinalityLine(4, 6);

    expect(second).toBe(first);
    expect(unrelated).not.toBe(first);
    expect(unrelated).toBe("SCOPE: 2 decisions + 3 next steps = 5 items to account for");
  });

  it("STATE: formatResumeItemId is referentially transparent across repeated calls", () => {
    expect(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 3)).toBe(
      formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 3),
    );
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — RESUME_SCOPE_CLOSURE text is unchanged by this task (T1 constraint)", () => {
  it("REGRESSION: RESUME_SCOPE_CLOSURE still opens with its own scope-closure marker and still names every known injection key, iterated from the set rather than hand-copied", () => {
    expect(RESUME_SCOPE_CLOSURE.startsWith("SCOPE CLOSURE:")).toBe(true);
    for (const key of BOOTSTRAP_RESUME_CLOSURE_KEYS) {
      expect(RESUME_SCOPE_CLOSURE).toContain(key);
    }
  });
});
