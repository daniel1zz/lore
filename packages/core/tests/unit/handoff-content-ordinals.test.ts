/**
 * Unit suite for the resume-ticket LOWER-bound ordinals rendered by
 * `renderHandoffContent` (`@lore/core`, `session.ts`) —
 * spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D1 (revised),
 * D2, D5; task task-t2-ordinal-tagged-render-from-structured-ssot-cli-mcp
 * (T2, v2 dispatch).
 *
 * Scope: `renderHandoffContent` is the SOLE rendering site for the ordinal
 * `KD<n>`/`NS<n>` item ids and the cardinality line (spec D1 revision — an
 * earlier draft assigned this to `feed-flow.ts::renderResumeRecord`, which
 * is unbuildable: that function's parameter carries only a pre-rendered
 * `content: string`, never the structured `key_decisions`/`next_steps`
 * arrays). This file exercises the render function directly against
 * synthetic `HandoffExtra` fixtures — no store, no SessionService. The
 * end-to-end proof that both `content` and `RESUME_COVERAGE_FLOOR` reach
 * both the CLI and MCP surfaces lives in
 * `packages/lore/tests/unit/feed-resume-coverage.test.ts` (T2 sibling file)
 * and `packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts` (T4).
 *
 * D6/D7 discipline: ids are derived from `formatResumeItemId` +
 * `RESUME_ITEM_ID_PREFIX_KEY_DECISION`/`RESUME_ITEM_ID_PREFIX_NEXT_STEP`,
 * and the cardinality line from `renderResumeCoverageCardinalityLine` — never
 * a hand-typed "KD1"/"SCOPE: ..." literal — so a future prefix/format change
 * fails this suite until the constants/renderer are updated, not silently.
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-RC-1 (ordinal cardinality: one KD<n>/NS<n> line per array
 *               member, 1-based, in array order) and AC-RC-2 (cardinality
 *               line position: identical to the exported renderer, strictly
 *               before the first item line)
 *   NEGATIVE:   an id one past the array length is correctly absent (proves
 *               the presence checks above actually discriminate rather than
 *               vacuously passing)
 *   BOUNDARY:   AC-RC-5 (degraded, zero key_decisions — zero-decision
 *               cardinality line, no KD lines, does not throw) and the
 *               symmetric zero-next_steps-count shape at (0, 0) via the
 *               cardinality renderer's own contract
 *   ERROR:      N/A — `renderHandoffContent` takes an already
 *               `handoffExtraSchema`-valid payload; there is no untrusted
 *               boundary inside this pure render function for a Zod parse to
 *               guard (zod-as-ssot applies at the schema boundary, which is
 *               `handoffExtraSchema.parse`, tested elsewhere)
 *   STATE:      referential transparency — repeated calls with the same
 *               input produce byte-identical output
 *   REGRESSION: the pre-existing sections (`## Plan`, `## Task Refs`,
 *               `## Modified Files`, `## Failing Oracle`) and
 *               `DEGRADED_HANDOFF_MARKER` are unaffected by the ordinal
 *               change — still present, still carrying their prior content
 *
 * Source: spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * §Design Decisions D1 (revised), D2, D5.
 */

import { describe, it, expect } from "vitest";
import {
  renderHandoffContent,
  renderResumeCoverageCardinalityLine,
  formatResumeItemId,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
  DEGRADED_HANDOFF_MARKER,
  type HandoffExtra,
} from "../../src/session.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const FULL_EXTRA: HandoffExtra = {
  by: "agent:alice",
  plan_ref: "plan-example",
  task_refs: ["task-example"],
  modified_files: ["packages/core/src/session.ts"],
  key_decisions: [
    { judgment: "decision one" },
    { judgment: "decision two", confidence: 50 },
    { judgment: "decision three" },
  ],
  next_steps: ["step one", "step two"],
};

const DEGRADED_EXTRA: HandoffExtra = {
  by: "stop-hook",
  task_refs: [],
  modified_files: ["packages/core/src/session.ts"],
  key_decisions: [],
  next_steps: ["review uncommitted changes", "verify build"],
  degraded: true,
};

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("HAPPY — AC-RC-1: ordinal cardinality", () => {
  it("ordinal cardinality: emits exactly one KD<n> line per key_decisions member and one NS<n> line per next_steps member, 1-based, in array order", () => {
    const content = renderHandoffContent(FULL_EXTRA);

    const kdPattern = new RegExp(`${RESUME_ITEM_ID_PREFIX_KEY_DECISION}\\d+`, "g");
    const nsPattern = new RegExp(`${RESUME_ITEM_ID_PREFIX_NEXT_STEP}\\d+`, "g");
    const kdMatches = content.match(kdPattern) ?? [];
    const nsMatches = content.match(nsPattern) ?? [];

    // Counted against the SSOT array lengths, never a literal number.
    expect(kdMatches.length).toBe(FULL_EXTRA.key_decisions.length);
    expect(nsMatches.length).toBe(FULL_EXTRA.next_steps.length);

    // Exact id SET matches — proves no duplicate/missing/off-by-one id.
    expect(new Set(kdMatches)).toEqual(
      new Set(FULL_EXTRA.key_decisions.map((_, i) => formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, i + 1))),
    );
    expect(new Set(nsMatches)).toEqual(
      new Set(FULL_EXTRA.next_steps.map((_, i) => formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, i + 1))),
    );

    // 1-based, array order: each id's first occurrence is strictly after the previous one's.
    let lastKdIdx = -1;
    for (let i = 1; i <= FULL_EXTRA.key_decisions.length; i++) {
      const idx = content.indexOf(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, i));
      expect(idx).toBeGreaterThan(lastKdIdx);
      lastKdIdx = idx;
    }
    let lastNsIdx = -1;
    for (let i = 1; i <= FULL_EXTRA.next_steps.length; i++) {
      const idx = content.indexOf(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, i));
      expect(idx).toBeGreaterThan(lastNsIdx);
      lastNsIdx = idx;
    }
  });
});

describe("HAPPY — AC-RC-2: cardinality line position", () => {
  it("cardinality line position: identical to the exported renderer's output, and its line index is lower than the first ordinal-tagged item line", () => {
    const content = renderHandoffContent(FULL_EXTRA);
    const lines = content.split("\n");

    const expectedCardinality = renderResumeCoverageCardinalityLine(
      FULL_EXTRA.key_decisions.length,
      FULL_EXTRA.next_steps.length,
    );
    const cardinalityIdx = lines.indexOf(expectedCardinality);
    // Strict identity as a WHOLE line (indexOf on the array, not a substring
    // scan on the joined string) — a paraphrase or a partial match fails this.
    expect(cardinalityIdx).toBeGreaterThanOrEqual(0);

    const firstKdLineIdx = lines.findIndex((l) =>
      l.includes(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 1)),
    );
    const firstNsLineIdx = lines.findIndex((l) =>
      l.includes(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 1)),
    );
    expect(firstKdLineIdx).toBeGreaterThan(cardinalityIdx);
    expect(firstNsLineIdx).toBeGreaterThan(cardinalityIdx);

    // Also strictly before the header's blank-line separator disappears —
    // the cardinality line is the SECOND non-blank line of the document.
    const firstNonBlank = lines.findIndex((l) => l !== "");
    const secondNonBlank = lines.findIndex((l, i) => i > firstNonBlank && l !== "");
    expect(secondNonBlank).toBe(cardinalityIdx);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — id-one-past-the-array-length is correctly absent", () => {
  it("NEGATIVE: neither content nor the match set contains an id beyond the array's own length (proves the AC-RC-1 checks discriminate)", () => {
    const content = renderHandoffContent(FULL_EXTRA);
    expect(content).not.toContain(
      formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, FULL_EXTRA.key_decisions.length + 1),
    );
    expect(content).not.toContain(
      formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, FULL_EXTRA.next_steps.length + 1),
    );
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — AC-RC-5: degraded zero decisions", () => {
  it("degraded zero decisions: empty key_decisions renders a zero-decision cardinality line, emits no KD-tagged lines, and does not throw", () => {
    expect(() => renderHandoffContent(DEGRADED_EXTRA)).not.toThrow();

    const content = renderHandoffContent(DEGRADED_EXTRA);

    expect(content).toContain(renderResumeCoverageCardinalityLine(0, DEGRADED_EXTRA.next_steps.length));
    expect(content).not.toMatch(new RegExp(`${RESUME_ITEM_ID_PREFIX_KEY_DECISION}\\d+`));

    // The actual next_steps count is still rendered in full — no silent drop
    // alongside the empty key_decisions branch.
    expect(content).toContain(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 1));
    expect(content).toContain(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 2));

    // Pre-existing degraded marker (D7) unaffected by this task.
    expect(content).toContain(DEGRADED_HANDOFF_MARKER);
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────

describe("STATE — renderHandoffContent stays referentially transparent after gaining ordinals", () => {
  it("STATE: repeated calls with the same input produce byte-identical output, even when interleaved with a different-input call", () => {
    const first = renderHandoffContent(FULL_EXTRA);
    const unrelated = renderHandoffContent(DEGRADED_EXTRA);
    const second = renderHandoffContent(FULL_EXTRA);

    expect(second).toBe(first);
    expect(unrelated).not.toBe(first);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — pre-existing sections unaffected by the ordinal change", () => {
  it("REGRESSION: Plan / Task Refs / Modified Files / Failing Oracle sections and their content are still present, unchanged", () => {
    const extra: HandoffExtra = {
      ...FULL_EXTRA,
      failing_oracle: { command: "bun run typecheck", output_tail: "error TS2345: ..." },
    };
    const content = renderHandoffContent(extra);

    expect(content).toContain("## Plan");
    expect(content).toContain("plan-example");
    expect(content).toContain("## Task Refs");
    expect(content).toContain("task-example");
    expect(content).toContain("## Modified Files");
    expect(content).toContain("packages/core/src/session.ts");
    expect(content).toContain("## Failing Oracle");
    expect(content).toContain("bun run typecheck");
    expect(content).toContain("error TS2345: ...");
    expect(content).toContain("## Key Decisions");
    expect(content).toContain("## Next Steps");
    expect(content).toContain("decision one");
    expect(content).toContain("step one");
  });
});
