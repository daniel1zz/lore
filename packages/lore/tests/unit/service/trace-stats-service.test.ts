/**
 * @spec_ref SPEC-102 hardening (T4 item 3) — deny_retry_gap complexity fix
 *
 * `computeDenyRetryGap` (trace-stats-service.ts) originally ran
 * `auditEntries.some(...)` INSIDE the per-deny loop — O(denies *
 * auditEntries), unbounded by the CLI's `--since` default (Unix epoch, so
 * `auditEntries` grows with the corpus's entire audit history on every
 * `lore trace stats` call). The fix pre-groups audit entries by
 * `(checkpoint, actor)` into a max-timestamp map ONCE — O(denies +
 * auditEntries). This file proves the refactor is BEHAVIOR-PRESERVING by
 * EQUALITY against an independent reference implementation of the ORIGINAL
 * per-deny-scan algorithm, not by inspection.
 *
 * Six-dimension coverage:
 *   HAPPY:      matches the reference on a fixture with >=2 denies and
 *               >=1 matching retry-success (the exact scenario the task
 *               specifies), across two different checkpoints/actors.
 *   NEGATIVE:   an unmapped checkpoint (no entry in
 *               CHECKPOINT_SUCCESS_ACTIONS) always reports
 *               retried_success: 0, matching the reference.
 *   BOUNDARY:   an audit success at the EXACT deny timestamp does not
 *               count — both implementations use strict `>`.
 *   ERROR:      n/a — a pure function over already-fetched arrays, no
 *               Result-returning IO to fail.
 *   STATE:      the SAME actor's audit success is scoped per-checkpoint
 *               (an action valid for one checkpoint does not leak into a
 *               different checkpoint's retry count for that actor).
 *   REGRESSION: empty denies/audit fixtures both return an empty array.
 */

import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@lore/core";
import { computeDenyRetryGap } from "../../../src/service/trace-stats-service.js";
import type { TraceGateDenyEvent } from "../../../src/store/store-interface.js";

/**
 * Mirrors trace-stats-service.ts's module-private `CHECKPOINT_SUCCESS_ACTIONS`
 * table — duplicated here ONLY so {@link referenceComputeDenyRetryGap} (the
 * reference oracle) has zero code sharing with the production module under
 * test. Never imported from production code.
 */
const CHECKPOINT_SUCCESS_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  "spec-create": ["create"],
  "spec-promote": ["approve"],
  "plan-promote": ["approve"],
  "task-claim": ["claim"],
  "phase-claim": ["claim"],
  "plan-close": ["approve", "archive"],
};

interface DenyRetryGap {
  checkpoint: string;
  denies: number;
  retried_success: number;
}

/**
 * The PRE-REFACTOR reference implementation (SPEC-102 T3 as originally
 * landed) — `auditEntries.some(...)` run INSIDE the per-deny loop, O(denies
 * * auditEntries). The ground truth `computeDenyRetryGap`'s O(n+m) rewrite
 * must match EXACTLY, deny-for-deny, checkpoint-for-checkpoint.
 */
function referenceComputeDenyRetryGap(
  denies: readonly TraceGateDenyEvent[],
  auditEntries: readonly AuditEntry[],
): DenyRetryGap[] {
  const byCheckpoint = new Map<string, { denies: number; retried: number }>();

  for (const deny of denies) {
    const bucket = byCheckpoint.get(deny.checkpoint) ?? { denies: 0, retried: 0 };
    bucket.denies += 1;

    const successActions = CHECKPOINT_SUCCESS_ACTIONS[deny.checkpoint] ?? [];
    const hasRetry = auditEntries.some(
      (entry) =>
        entry.actor === deny.actor &&
        entry.timestamp > deny.ts &&
        successActions.includes(entry.action),
    );
    if (hasRetry) bucket.retried += 1;

    byCheckpoint.set(deny.checkpoint, bucket);
  }

  return [...byCheckpoint.entries()].map(([checkpoint, bucket]) => ({
    checkpoint,
    denies: bucket.denies,
    retried_success: bucket.retried,
  }));
}

function makeDeny(checkpoint: string, actor: string, ts: string): TraceGateDenyEvent {
  return { ts, actor, checkpoint };
}

function makeAuditEntry(actor: string, action: string, timestamp: string): AuditEntry {
  return { timestamp, actor, session_id: "s1", action };
}

describe("computeDenyRetryGap — O(n+m) pre-grouping refactor (SPEC-102 hardening T4 item 3)", () => {
  it("HAPPY: matches the pre-refactor per-deny scan exactly on a fixture with >=2 denies and >=1 matching retry", () => {
    const denies: TraceGateDenyEvent[] = [
      makeDeny("task-claim", "agent:a", "2026-07-28T00:00:00.000Z"), // retried via a later "claim"
      makeDeny("task-claim", "agent:b", "2026-07-28T00:10:00.000Z"), // never retried
      makeDeny("spec-promote", "agent:a", "2026-07-28T00:20:00.000Z"), // retried via a later "approve"
    ];
    const auditEntries: AuditEntry[] = [
      makeAuditEntry("agent:a", "claim", "2026-07-28T00:05:00.000Z"),
      makeAuditEntry("agent:b", "create", "2026-07-28T00:11:00.000Z"), // wrong action for task-claim
      makeAuditEntry("agent:a", "approve", "2026-07-28T00:30:00.000Z"),
      makeAuditEntry("agent:c", "claim", "2026-07-28T00:40:00.000Z"), // different actor, no matching deny
    ];

    const expected = referenceComputeDenyRetryGap(denies, auditEntries);
    const actual = computeDenyRetryGap(denies, auditEntries);

    expect(actual).toEqual(expected);
    // Sanity: the fixture actually exercises a MIX of retried/unretried denies —
    // an equality check against a reference that also always returned zeros
    // would pass vacuously and prove nothing.
    expect(expected).toEqual([
      { checkpoint: "task-claim", denies: 2, retried_success: 1 },
      { checkpoint: "spec-promote", denies: 1, retried_success: 1 },
    ]);
  });

  it("BOUNDARY: an audit success at the EXACT deny timestamp does not count (strictly-after semantics)", () => {
    const denies: TraceGateDenyEvent[] = [makeDeny("task-claim", "agent:a", "2026-07-28T00:00:00.000Z")];
    const auditEntries: AuditEntry[] = [makeAuditEntry("agent:a", "claim", "2026-07-28T00:00:00.000Z")];

    expect(computeDenyRetryGap(denies, auditEntries)).toEqual(
      referenceComputeDenyRetryGap(denies, auditEntries),
    );
    expect(computeDenyRetryGap(denies, auditEntries)).toEqual([
      { checkpoint: "task-claim", denies: 1, retried_success: 0 },
    ]);
  });

  it("NEGATIVE: an unmapped checkpoint always reports retried_success 0, matching the reference", () => {
    const denies: TraceGateDenyEvent[] = [
      makeDeny("unknown-checkpoint", "agent:a", "2026-07-28T00:00:00.000Z"),
    ];
    const auditEntries: AuditEntry[] = [makeAuditEntry("agent:a", "create", "2026-07-28T00:05:00.000Z")];

    expect(computeDenyRetryGap(denies, auditEntries)).toEqual(
      referenceComputeDenyRetryGap(denies, auditEntries),
    );
    expect(computeDenyRetryGap(denies, auditEntries)).toEqual([
      { checkpoint: "unknown-checkpoint", denies: 1, retried_success: 0 },
    ]);
  });

  it("STATE: a success action valid for one checkpoint does not leak into a different checkpoint's retry count for the same actor", () => {
    // "approve" is a success action for BOTH spec-promote and plan-promote —
    // an actor's approve must only satisfy retries for denies at the
    // checkpoint it actually maps to via CHECKPOINT_SUCCESS_ACTIONS, i.e. it
    // legitimately satisfies both here, but a checkpoint with NO overlapping
    // success action (task-claim) must stay unretried for the SAME actor.
    const denies: TraceGateDenyEvent[] = [
      makeDeny("spec-promote", "agent:a", "2026-07-28T00:00:00.000Z"),
      makeDeny("task-claim", "agent:a", "2026-07-28T00:00:00.000Z"),
    ];
    const auditEntries: AuditEntry[] = [makeAuditEntry("agent:a", "approve", "2026-07-28T00:05:00.000Z")];

    const expected = referenceComputeDenyRetryGap(denies, auditEntries);
    expect(computeDenyRetryGap(denies, auditEntries)).toEqual(expected);
    expect(expected).toEqual([
      { checkpoint: "spec-promote", denies: 1, retried_success: 1 },
      { checkpoint: "task-claim", denies: 1, retried_success: 0 },
    ]);
  });

  it("REGRESSION: empty denies/audit fixtures both return an empty array", () => {
    expect(computeDenyRetryGap([], [])).toEqual(referenceComputeDenyRetryGap([], []));
    expect(computeDenyRetryGap([], [])).toEqual([]);
  });
});
