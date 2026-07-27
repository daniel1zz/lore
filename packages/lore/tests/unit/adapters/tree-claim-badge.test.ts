/**
 * Unit tests for `formatWorkflowBadge` (adapters/cli/utils.ts) — the `lore tree` /
 * `lore list --type task` claim/evidence badge renderer. SPEC-042 §Design
 * Decisions D7 adds `@branch` when `task.extra.claim.branch` is present; this
 * suite pins that addition and REGRESSION-guards the pre-existing stale suffix
 * and evidence-count rendering (both must stay byte-identical).
 *
 * Scope: pure-function unit test — `formatWorkflowBadge` reads `doc.extra`
 * directly and does no store IO, so this is vitest-reachable (no bun:sqlite).
 *
 * Coverage:
 *   HAPPY:      claim with branch → `claimed:by@branch`; claim without branch →
 *               `claimed:by` (unchanged pre-SPEC-042 shape)
 *   NEGATIVE:   malformed claim (fails taskClaimSchema) → no claim segment rendered
 *   BOUNDARY:   no claim and no evidence → "" (empty string, no brackets at all)
 *   ERROR:      non-object `extra.claim` (e.g. a bare string) does not throw —
 *               degrades to no claim segment, same as the NEGATIVE case
 *   STATE:      claim + evidence together render both segments in one bracket
 *   REGRESSION: stale suffix (" (stale)") and evidence counts (✔n / ✘n) render
 *               identically to the pre-SPEC-042 shape, with and without branch;
 *               `expected-fail`/`inconclusive` last-result never renders green
 *               (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree
 *               §M1, AC-WH-1 — T6)
 *
 * @spec_ref SPEC-042 §Design Decisions D7; §Acceptance Criteria AC-S3-9;
 *   spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1 AC-WH-1
 */

import { describe, it, expect } from "vitest";
import { formatWorkflowBadge } from "../../../src/adapters/cli/utils.js";
import type { DocRecord } from "@lore/core";

const NOW_ISO = "2026-07-11T12:00:00.000Z";
const TTL_MINUTES = 120;

/** Minimal task DocRecord fixture — only `extra` varies across tests. */
function makeTask(extra: Record<string, unknown>): DocRecord {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "task-fixture",
    type: "task",
    role: "plan",
    title: "Fixture Task",
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    created_by: "tester",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("formatWorkflowBadge — HAPPY", () => {
  it("claim with branch present → claimed:by@branch", () => {
    const doc = makeTask({ claim: { by: "alice", at: NOW_ISO, branch: "wt-a" } });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [claimed:alice@wt-a]");
  });

  it("claim without branch → claimed:by (no @, unchanged pre-SPEC-042 shape)", () => {
    const doc = makeTask({ claim: { by: "alice", at: NOW_ISO } });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [claimed:alice]");
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("formatWorkflowBadge — NEGATIVE", () => {
  it("malformed claim (missing required `by`) → no claim segment, no throw", () => {
    const doc = makeTask({ claim: { at: NOW_ISO, branch: "wt-a" } });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe("");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("formatWorkflowBadge — BOUNDARY", () => {
  it("no claim and no evidence → empty string (no brackets)", () => {
    const doc = makeTask({});
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe("");
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("formatWorkflowBadge — ERROR", () => {
  it("non-object extra.claim (a bare string) does not throw — degrades to no claim segment", () => {
    const doc = makeTask({ claim: "not-an-object" });
    expect(() => formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).not.toThrow();
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe("");
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("formatWorkflowBadge — STATE", () => {
  it("claim (with branch) + evidence together render both segments in one bracket", () => {
    const doc = makeTask({
      claim: { by: "bob", at: NOW_ISO, branch: "wt-b" },
      verification_evidence: [
        { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: NOW_ISO, recorded_by: "bob" },
      ],
    });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [claimed:bob@wt-b ✔1]");
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("formatWorkflowBadge — REGRESSION (stale suffix + evidence counts unchanged)", () => {
  it("stale claim without branch → ' (stale)' suffix unchanged", () => {
    const staleAt = "2026-07-11T00:00:00.000Z"; // 12h before NOW_ISO, TTL is 120min
    const doc = makeTask({ claim: { by: "carol", at: staleAt } });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [claimed:carol (stale)]");
  });

  it("stale claim WITH branch → branch renders before the stale suffix", () => {
    const staleAt = "2026-07-11T00:00:00.000Z";
    const doc = makeTask({ claim: { by: "carol", at: staleAt, branch: "wt-c" } });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [claimed:carol@wt-c (stale)]");
  });

  it("failing evidence renders ✘n unchanged", () => {
    const doc = makeTask({
      verification_evidence: [
        { oracle: "tsc", command: "bun run typecheck", result: "fail", recorded_at: NOW_ISO, recorded_by: "dave" },
        { oracle: "test", command: "bun test", result: "fail", recorded_at: NOW_ISO, recorded_by: "dave" },
      ],
    });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [✘2]");
  });

  it("passing evidence renders ✔n unchanged", () => {
    const doc = makeTask({
      verification_evidence: [
        { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: NOW_ISO, recorded_by: "dave" },
      ],
    });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [✔1]");
  });
});

// ─── REGRESSION — AC-WH-1: expected-fail/inconclusive last result never counted as green ──

describe("formatWorkflowBadge — AC-WH-1 (expected-fail/inconclusive never render as green ✔)", () => {
  it("last evidence result 'expected-fail' → ⚑R<n>, never ✔<n>", () => {
    const doc = makeTask({
      verification_evidence: [
        { oracle: "test", command: "bunx vitest run foo", result: "expected-fail", recorded_at: NOW_ISO, recorded_by: "erin" },
      ],
    });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [⚑R1]");
  });

  it("last evidence result 'inconclusive' → ⚑?<n>, never ✔<n>", () => {
    const doc = makeTask({
      verification_evidence: [
        { oracle: "test", command: "bunx vitest run foo", result: "inconclusive", recorded_at: NOW_ISO, recorded_by: "erin" },
      ],
    });
    expect(formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES)).toBe(" [⚑?1]");
  });

  it("all four result values render four DISTINCT, never-mutually-equal badge strings", () => {
    const resultToBadge = (result: "pass" | "fail" | "expected-fail" | "inconclusive"): string => {
      const doc = makeTask({
        verification_evidence: [
          { oracle: "test", command: "bunx vitest run foo", result, recorded_at: NOW_ISO, recorded_by: "erin" },
        ],
      });
      return formatWorkflowBadge(doc, NOW_ISO, TTL_MINUTES);
    };
    const badges = {
      pass: resultToBadge("pass"),
      fail: resultToBadge("fail"),
      expectedFail: resultToBadge("expected-fail"),
      inconclusive: resultToBadge("inconclusive"),
    };
    expect(badges.pass).toBe(" [✔1]");
    expect(badges.fail).toBe(" [✘1]");
    // Never equal to the green pass badge — the AC-WH-1 invariant this task fixes.
    expect(badges.expectedFail).not.toBe(badges.pass);
    expect(badges.inconclusive).not.toBe(badges.pass);
    // And distinct from each other + from fail, so no two states collapse together.
    const values = Object.values(badges);
    expect(new Set(values).size).toBe(values.length);
  });
});
