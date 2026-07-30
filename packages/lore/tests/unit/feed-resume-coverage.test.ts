/**
 * Unit suite for the resume-ticket LOWER-bound floor as wired into
 * `renderResumeFeed` (`packages/lore/src/flows/feed-flow.ts`) —
 * spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D1 (revised),
 * D3, D10; task task-t2-ordinal-tagged-render-from-structured-ssot-cli-mcp
 * (T2, v2 dispatch).
 *
 * Scope: the ordinal `KD<n>`/`NS<n>` lines and the per-record cardinality
 * line are rendered by `@lore/core`'s `renderHandoffContent` — the SSOT
 * projection point (spec D1 revision) — and reach this module ALREADY baked
 * into `ResumeHandoffRecord.content`. This file's job is narrower: prove
 * `renderResumeFeed` (a) appends `RESUME_COVERAGE_FLOOR` alongside the
 * pre-existing `RESUME_SCOPE_CLOSURE` on the single-record path (AC-RC-3),
 * (b) contains no second rendering implementation of its own — no item-id
 * prefix, no traversal of the underlying decision/step arrays (AC-RC-6), and
 * (c) withholds the floor on the `multi_actor` branch while still carrying
 * the (already-baked-in) ordinals and per-record cardinality lines
 * (AC-RC-11). Exercises the PURE render function directly against synthetic
 * `ResumeResult` fixtures — no store, no App, no MCP/CLI wrapper (same
 * convention as `flows/feed-flow-resume-closure.test.ts`).
 *
 * D6/D7 discipline: every expected id/cardinality-line string is derived from
 * the exported constants/renderer (`formatResumeItemId`,
 * `renderResumeCoverageCardinalityLine`, the id-prefix constants) or from
 * `renderHandoffContent` itself — never a hand-typed "KD1"/"SCOPE: ..."
 * literal.
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-RC-3 (both boundary constants present by identity,
 *               proven distinct) and AC-RC-11's positive half (multi-actor
 *               carries ordinals + per-record cardinality, no floor)
 *   NEGATIVE:   AC-RC-6 (the source file contains no item-id prefix and no
 *               array-traversal identifier — a text-level proof there is no
 *               second rendering implementation beside `renderHandoffContent`)
 *   BOUNDARY:   AC-RC-11's control half — the SAME fixture rendered as a
 *               single record DOES carry the floor, so the multi-actor
 *               negative cannot pass vacuously
 *   ERROR:      N/A — `renderResumeFeed` takes an already-shaped
 *               `ResumeResult`; no untrusted external boundary in this pure
 *               render function
 *   STATE:      `RESUME_SCOPE_CLOSURE` stays the trailing block on the
 *               single-record path (the floor is inserted BEFORE it, not
 *               after) — the pre-existing
 *               `cli-feed-task-start.bun.test.ts` `endsWith` regression
 *               depends on this ordering, so it is pinned here too
 *   REGRESSION: the pre-existing `"(no handoff recorded)"` byte-exact
 *               fallback carries neither boundary constant (mirrors
 *               `flows/feed-flow-resume-closure.test.ts`'s own BOUNDARY case)
 *
 * @spec_ref spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 *   §Design Decisions D1 (revised), D3, D10; AC-RC-3, AC-RC-6, AC-RC-11
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESUME_SCOPE_CLOSURE,
  RESUME_COVERAGE_FLOOR,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
  formatResumeItemId,
  renderResumeCoverageCardinalityLine,
  renderHandoffContent,
  type HandoffExtra,
} from "@lore/core";
import { renderResumeFeed } from "../../src/flows/feed-flow.js";
import type { ResumeHandoffRecord, ResumeResult } from "../../src/service/session-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/lore/tests/unit/ -> ../../src/flows/feed-flow.ts
const FEED_FLOW_SOURCE_PATH = resolve(__dirname, "../../src/flows/feed-flow.ts");
const feedFlowSource = readFileSync(FEED_FLOW_SOURCE_PATH, "utf-8");

// ─── Fixtures ───────────────────────────────────────────────────────────────
// `content` is produced by the REAL `renderHandoffContent` (never hand-typed)
// so these fixtures reflect exactly what `SessionService.buildResumeRecord`
// would attach in production.

const ALICE_EXTRA: HandoffExtra = {
  by: "agent:alice",
  plan_ref: "plan-example",
  task_refs: [],
  modified_files: [],
  key_decisions: [{ judgment: "chose X over Y" }, { judgment: "picked Z", confidence: 80 }],
  next_steps: ["wire the thing", "verify the thing"],
};

const BOB_EXTRA: HandoffExtra = {
  by: "agent:bob",
  task_refs: [],
  modified_files: [],
  key_decisions: [],
  next_steps: ["review uncommitted changes"],
};

const RECORD: ResumeHandoffRecord = {
  handoff_slug: "knowledge-handoff-agent-alice-1",
  plan_slug: "plan-example",
  by: ALICE_EXTRA.by,
  at: "2026-07-30T00:00:00.000Z",
  age_minutes: 5,
  ttl_warning: false,
  degraded: false,
  content: renderHandoffContent(ALICE_EXTRA),
};

const OTHER_RECORD: ResumeHandoffRecord = {
  handoff_slug: "knowledge-handoff-agent-bob-1",
  plan_slug: "plan-example",
  by: BOB_EXTRA.by,
  at: "2026-07-30T00:00:00.000Z",
  age_minutes: 3,
  ttl_warning: false,
  degraded: false,
  content: renderHandoffContent(BOB_EXTRA),
};

const FOUND_SINGLE: ResumeResult = { found: true, handoff: RECORD, multi_actor: false, readiness: null };
const FOUND_MULTI: ResumeResult = {
  found: true,
  handoffs: [RECORD, OTHER_RECORD],
  multi_actor: true,
  readiness: null,
};
const NOT_FOUND: ResumeResult = { found: false, multi_actor: false, readiness: null };

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("HAPPY — AC-RC-3: both bounds", () => {
  it('both bounds: the rendered ticket contains both RESUME_SCOPE_CLOSURE and RESUME_COVERAGE_FLOOR by identity, and the two are distinct strings', () => {
    const feed = renderResumeFeed(FOUND_SINGLE);

    expect(feed.includes(RESUME_SCOPE_CLOSURE)).toBe(true);
    expect(feed.includes(RESUME_COVERAGE_FLOOR)).toBe(true);
    // Separate assertion (not a single combined check) — a merged
    // single-string implementation would make one of the two above
    // vacuously true via substring containment of the other; this proves
    // they are independently authored, distinct values.
    expect(RESUME_SCOPE_CLOSURE).not.toBe(RESUME_COVERAGE_FLOOR);
    expect(RESUME_SCOPE_CLOSURE.includes(RESUME_COVERAGE_FLOOR)).toBe(false);
    expect(RESUME_COVERAGE_FLOOR.includes(RESUME_SCOPE_CLOSURE)).toBe(false);
  });
});

describe("HAPPY — AC-RC-11: multi-actor no floor (positive half)", () => {
  it("multi-actor no floor: carries ordinal tags and a per-record cardinality line for EACH record, but NOT RESUME_COVERAGE_FLOOR", () => {
    const feed = renderResumeFeed(FOUND_MULTI);

    // Ordinals — already baked into each record's `content` by
    // `renderHandoffContent`; this asserts they survive the join unmodified.
    expect(feed).toContain(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 1));
    expect(feed).toContain(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 2));
    expect(feed).toContain(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 1));

    // One cardinality line PER RECORD (Alice: 2 decisions + 2 steps; Bob: 0 + 1).
    expect(feed).toContain(
      renderResumeCoverageCardinalityLine(ALICE_EXTRA.key_decisions.length, ALICE_EXTRA.next_steps.length),
    );
    expect(feed).toContain(
      renderResumeCoverageCardinalityLine(BOB_EXTRA.key_decisions.length, BOB_EXTRA.next_steps.length),
    );

    // The floor is NOT emitted on the multi-actor branch (D10).
    expect(feed).not.toContain(RESUME_COVERAGE_FLOOR);
    // The upper-bound closure is unaffected by this task — still present.
    expect(feed).toContain(RESUME_SCOPE_CLOSURE);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — AC-RC-6: no item rendering in consumer", () => {
  it("no item rendering in consumer: feed-flow.ts has zero occurrences of the item-id prefix constant names and zero traversal of the underlying decision/step arrays", () => {
    expect(feedFlowSource).not.toContain("RESUME_ITEM_ID_PREFIX_KEY_DECISION");
    expect(feedFlowSource).not.toContain("RESUME_ITEM_ID_PREFIX_NEXT_STEP");
    expect(feedFlowSource).not.toContain("key_decisions");
    expect(feedFlowSource).not.toContain("next_steps");
  });

  it("control: the file IS non-empty and DOES reference RESUME_COVERAGE_FLOOR — an unread/empty file must not pass the checks above vacuously", () => {
    expect(feedFlowSource.length).toBeGreaterThan(0);
    expect(feedFlowSource).toContain("RESUME_COVERAGE_FLOOR");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — AC-RC-11: multi-actor no floor (control half)", () => {
  it("control: the SAME fixture rendered as a single record DOES contain RESUME_COVERAGE_FLOOR — the multi-actor negative above cannot pass vacuously", () => {
    const feed = renderResumeFeed(FOUND_SINGLE);
    expect(feed).toContain(RESUME_COVERAGE_FLOOR);
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────

describe("STATE — RESUME_SCOPE_CLOSURE stays the trailing block on the single-record path", () => {
  it("STATE: RESUME_COVERAGE_FLOOR is inserted BEFORE RESUME_SCOPE_CLOSURE, never after — the closure remains the final segment", () => {
    const feed = renderResumeFeed(FOUND_SINGLE);

    expect(feed.endsWith(RESUME_SCOPE_CLOSURE)).toBe(true);
    const floorIdx = feed.indexOf(RESUME_COVERAGE_FLOOR);
    const closureIdx = feed.indexOf(RESUME_SCOPE_CLOSURE);
    expect(floorIdx).toBeGreaterThanOrEqual(0);
    expect(closureIdx).toBeGreaterThan(floorIdx);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — no-ticket fallback carries neither boundary constant", () => {
  it("REGRESSION: found: false -> exact '(no handoff recorded)', neither RESUME_SCOPE_CLOSURE nor RESUME_COVERAGE_FLOOR appended", () => {
    const feed = renderResumeFeed(NOT_FOUND);

    expect(feed).toBe("(no handoff recorded)");
    expect(feed).not.toContain(RESUME_SCOPE_CLOSURE);
    expect(feed).not.toContain(RESUME_COVERAGE_FLOOR);
  });
});
