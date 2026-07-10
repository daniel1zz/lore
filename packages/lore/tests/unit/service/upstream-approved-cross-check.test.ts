/**
 * Cross-check: `evaluateReadiness` (`@lore/core`, task-workflow.ts) and
 * `upstreamApproved` (`../../../src/service/gate-predicates.ts`) each express
 * "is this upstream spec approved enough" independently — one as a read-side
 * readiness advisory, the other as a write-path gate. Both now import the same
 * `UPSTREAM_APPROVED_STATUSES` constant from `@lore/core` instead of each
 * hardcoding their own copy of `new Set(["approved"])`. This file pins that
 * both call sites still agree, driven off the exact same status matrix, so a
 * future edit to one that forgets the other fails a test instead of silently
 * reintroducing the drift the constant was extracted to prevent.
 *
 * Pure functions only — no store, no IO, no bun:sqlite — hence vitest.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      "approved" clears both evaluateReadiness's upstream_unapproved
 *               advisory and upstreamApproved's gate
 *   NEGATIVE:   "active" fails both — the deliberately-excluded status
 *   BOUNDARY:   every other DocStatus ("draft", "in-review", "archived",
 *               "deprecated") fails both, exhausting the DocStatus union
 *   ERROR:      n/a — pure functions with no Result channel on the readiness
 *               side; upstreamApproved's error reason is asserted directly
 *   STATE:      n/a — no persisted/mutable state in either function under test
 *   REGRESSION: UPSTREAM_APPROVED_STATUSES itself contains exactly "approved"
 *               and nothing else — pins the SSOT's content, not just its
 *               presence
 *
 * @spec_ref SPEC-032 §3.4 (upstream_unapproved advisory); IoC vertical-slice
 *   tech-spec §4.1/§11 (upstreamApproved gate predicate)
 */

import { describe, it, expect } from "vitest";
import { evaluateReadiness, UPSTREAM_APPROVED_STATUSES } from "@lore/core";
import type { DocId, DocRecord, DocStatus, LinkRecord } from "@lore/core";
import { upstreamApproved } from "../../../src/service/gate-predicates.js";

const NOW = "2026-07-10T10:00:00.000Z";

function makeTask(): DocRecord {
  const id: DocId = "01HTASKAAAAAAAAAAAAAAAAAAA";
  return {
    id,
    slug: "task-cross-check-fixture",
    type: "task",
    role: "plan",
    title: "Cross-check fixture task",
    status: "draft",
    priority: "medium",
    content: "Task body",
    parent_id: "01HPLANAAAAAAAAAAAAAAAAAAA",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA" },
  } as DocRecord;
}

const NO_LINKS: LinkRecord[] = [];
const NO_BLOCKERS = new Map();

describe("UPSTREAM_APPROVED_STATUSES cross-check", () => {
  // REGRESSION
  it("pins the SSOT to exactly {'approved'} — nothing more, nothing less", () => {
    expect(UPSTREAM_APPROVED_STATUSES.has("approved")).toBe(true);
    expect(UPSTREAM_APPROVED_STATUSES.has("active")).toBe(false);
    expect(UPSTREAM_APPROVED_STATUSES.has("draft")).toBe(false);
    expect(UPSTREAM_APPROVED_STATUSES.has("in-review")).toBe(false);
    expect(UPSTREAM_APPROVED_STATUSES.has("archived")).toBe(false);
    expect(UPSTREAM_APPROVED_STATUSES.has("deprecated")).toBe(false);
    expect(UPSTREAM_APPROVED_STATUSES.size).toBe(1);
  });

  // HAPPY
  it("'approved' clears both evaluateReadiness and upstreamApproved", () => {
    const records = evaluateReadiness([makeTask()], NO_LINKS, NO_BLOCKERS, NOW, 120, "approved");
    expect(records[0]?.upstream_unapproved).toBeUndefined();

    expect(
      upstreamApproved({ type: "spec", status: "approved", deleted_at: null }, "spec"),
    ).toEqual({ ok: true });
  });

  // NEGATIVE — the deliberately-excluded status
  it("'active' fails both — flagged unapproved by readiness, rejected by the gate", () => {
    const records = evaluateReadiness([makeTask()], NO_LINKS, NO_BLOCKERS, NOW, 120, "active");
    expect(records[0]?.upstream_unapproved).toBe(true);

    expect(
      upstreamApproved({ type: "spec", status: "active", deleted_at: null }, "spec"),
    ).toEqual({ ok: false, reason: "UPSTREAM_NOT_APPROVED" });
  });

  // BOUNDARY — exhaust the remaining DocStatus union members
  const REMAINING_STATUSES: DocStatus[] = ["draft", "in-review", "archived", "deprecated"];
  it.each(REMAINING_STATUSES)(
    "'%s' fails both evaluateReadiness and upstreamApproved",
    (status) => {
      const records = evaluateReadiness([makeTask()], NO_LINKS, NO_BLOCKERS, NOW, 120, status);
      expect(records[0]?.upstream_unapproved).toBe(true);

      expect(upstreamApproved({ type: "spec", status, deleted_at: null }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
    },
  );
});
