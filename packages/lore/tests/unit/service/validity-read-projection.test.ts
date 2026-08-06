/**
 * Six-dimension tests for the PURE read-surface validity projection in
 * `service/validity-service.ts` — `projectValidityStatus` / `selectLiveDocs` /
 * `withValidityStatus` / `withPreGatedLiveStatus`.
 *
 * These four helpers are the DATA half of SPEC-043 D3
 * (task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in): before them,
 * validity existed as a write path plus ONE human render site, so every list-shaped
 * read surface either forgot the default exclusion or emitted records with no
 * validity-bearing field at all. Pure functions, zero store — the CLI-level
 * end-to-end contract lives in `tests/integration/cli/list-validity-visibility.test.ts`.
 *
 * Dimension mapping:
 *   HAPPY:      an invalidated carrier projects `invalidated: true` carrying
 *               `superseded_by` + `reason`; a live one projects `invalidated: false`
 *   NEGATIVE:   a live record NEVER carries retraction detail fields, and a
 *               FUTURE-dated `invalid_at` reads as live (with no detail leakage)
 *   BOUNDARY:   `invalid_at === checked_at` flips to invalidated (SSOT boundary);
 *               empty input arrays return empty arrays, never undefined
 *   ERROR:      a MALFORMED `extra.validity` is flagged `metadata_unreadable`
 *               instead of silently reading as an ordinary live doc
 *   STATE:      SearchHit-shaped (hoisted `validity`) and DocRecord-shaped
 *               (`extra.validity`) carriers project identically; a
 *               supersede-then-undo shape reports live again
 *   REGRESSION: the helpers never mutate their inputs; `checked_at` is the
 *               INJECTED instant (never a fresh wall-clock read); `validity_status`
 *               is ABSENT-vs-`invalidated:false` distinguishable
 *
 * @spec_ref SPEC-043 §Design Decisions D3;
 *   task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in AC-1, AC-6
 */

import { describe, it, expect } from "vitest";
import {
  projectValidityStatus,
  selectLiveDocs,
  withPreGatedLiveStatus,
  withValidityStatus,
} from "../../../src/service/validity-service.js";
import type { ValidityCarrier } from "@lore/core";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const NOW = "2026-08-06T12:00:00.000Z";
const EARLIER = "2026-08-01T00:00:00.000Z";
const LATER = "2026-09-01T00:00:00.000Z";
const SUCCESSOR_ID = "01KZAAAAAAAAAAAAAAAAAAAAAA";

function liveDoc(slug: string): ValidityCarrier & { slug: string } {
  return { slug, extra: { plan_id: "01KZPLAN" } };
}

function retractedDoc(
  slug: string,
  overrides: Record<string, unknown> = {},
): ValidityCarrier & { slug: string } {
  return {
    slug,
    extra: {
      plan_id: "01KZPLAN",
      validity: {
        invalid_at: EARLIER,
        invalidated_by: SUCCESSOR_ID,
        reason: "retracted by probe",
        ...overrides,
      },
    },
  };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("projectValidityStatus — HAPPY", () => {
  it("projects an invalidated doc with its superseded_by and reason", () => {
    const status = projectValidityStatus(retractedDoc("task-dead"), NOW);

    expect(status.invalidated).toBe(true);
    expect(status.checked_at).toBe(NOW);
    expect(status.invalid_at).toBe(EARLIER);
    expect(status.superseded_by).toBe(SUCCESSOR_ID);
    expect(status.reason).toBe("retracted by probe");
  });

  it("projects a live doc as invalidated:false, stamped with the checked instant", () => {
    const status = projectValidityStatus(liveDoc("task-live"), NOW);

    expect(status.invalidated).toBe(false);
    expect(status.checked_at).toBe(NOW);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("projectValidityStatus — NEGATIVE", () => {
  it("a live doc carries NO retraction detail fields at all", () => {
    const status = projectValidityStatus(liveDoc("task-live"), NOW);

    expect(status.invalid_at).toBeUndefined();
    expect(status.superseded_by).toBeUndefined();
    expect(status.reason).toBeUndefined();
    expect(status.metadata_unreadable).toBeUndefined();
  });

  it("a FUTURE-dated invalid_at reads as live and leaks no detail fields", () => {
    // reason: `isInvalidated` is bi-temporal — a doc scheduled to expire later is
    // live NOW. A half-populated payload here (invalid_at present, invalidated
    // false) is exactly the ambiguity a consumer would misread as a retraction.
    const status = projectValidityStatus(retractedDoc("task-future", { invalid_at: LATER }), NOW);

    expect(status.invalidated).toBe(false);
    expect(status.invalid_at).toBeUndefined();
    expect(status.superseded_by).toBeUndefined();
    expect(status.reason).toBeUndefined();
  });

  it("selectLiveDocs drops invalidated docs and keeps live ones, preserving order", () => {
    const docs = [liveDoc("a"), retractedDoc("b"), liveDoc("c")];

    expect(selectLiveDocs(docs, NOW).map((d) => d.slug)).toEqual(["a", "c"]);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("projection — BOUNDARY", () => {
  it("invalid_at exactly equal to checked_at counts as invalidated", () => {
    const status = projectValidityStatus(retractedDoc("task-edge", { invalid_at: NOW }), NOW);

    expect(status.invalidated).toBe(true);
    expect(status.invalid_at).toBe(NOW);
  });

  it("one millisecond before the invalid_at instant still reads as live", () => {
    const justBefore = "2026-08-06T11:59:59.999Z";
    const status = projectValidityStatus(retractedDoc("task-edge", { invalid_at: NOW }), justBefore);

    expect(status.invalidated).toBe(false);
    expect(status.checked_at).toBe(justBefore);
  });

  it("empty inputs return empty arrays from every array helper", () => {
    expect(selectLiveDocs([], NOW)).toEqual([]);
    expect(withValidityStatus([], NOW)).toEqual([]);
    expect(withPreGatedLiveStatus([], NOW)).toEqual([]);
  });

  it("an invalidated doc with NO successor and NO reason still reports invalidated", () => {
    const bare: ValidityCarrier = { extra: { validity: { invalid_at: EARLIER } } };
    const status = projectValidityStatus(bare, NOW);

    expect(status.invalidated).toBe(true);
    expect(status.invalid_at).toBe(EARLIER);
    expect(status.superseded_by).toBeUndefined();
    expect(status.reason).toBeUndefined();
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("projectValidityStatus — ERROR", () => {
  it("flags a MALFORMED extra.validity as metadata_unreadable instead of silently reading live", () => {
    // reason: `extractValidity` returns undefined for BOTH "absent" and
    // "present but unparseable", so without this flag a corrupted row is
    // indistinguishable from a doc that was never invalidated.
    const corrupted: ValidityCarrier = { extra: { validity: "not-an-object" } };
    const status = projectValidityStatus(corrupted, NOW);

    expect(status.metadata_unreadable).toBe(true);
    expect(status.invalidated).toBe(false);
  });

  it("an invalid_at that violates validitySchema's ordering rule is unreadable, not live-by-omission", () => {
    const badOrdering: ValidityCarrier = {
      extra: { validity: { valid_at: LATER, invalid_at: EARLIER } },
    };
    const status = projectValidityStatus(badOrdering, NOW);

    expect(status.metadata_unreadable).toBe(true);
  });

  it("a doc with NO extra at all is live and NOT flagged unreadable", () => {
    const status = projectValidityStatus({}, NOW);

    expect(status.invalidated).toBe(false);
    expect(status.metadata_unreadable).toBeUndefined();
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("projection — STATE", () => {
  it("a SearchHit-shaped carrier (hoisted validity) projects identically to a DocRecord-shaped one", () => {
    const nested = projectValidityStatus(retractedDoc("nested"), NOW);
    const hoisted = projectValidityStatus(
      { validity: { invalid_at: EARLIER, invalidated_by: SUCCESSOR_ID, reason: "retracted by probe" } },
      NOW,
    );

    expect(hoisted.invalidated).toBe(nested.invalidated);
    expect(hoisted.invalid_at).toBe(nested.invalid_at);
    expect(hoisted.superseded_by).toBe(nested.superseded_by);
    expect(hoisted.reason).toBe(nested.reason);
  });

  it("an undone invalidation (valid_at kept, invalid_at cleared) reports live again", () => {
    // reason: ValidityService.invalidate --undo clears invalid_at/invalidated_by/
    // reason while KEEPING valid_at — the projection must follow the same rule.
    const undone: ValidityCarrier = { extra: { validity: { valid_at: EARLIER } } };
    const status = projectValidityStatus(undone, NOW);

    expect(status.invalidated).toBe(false);
    expect(status.superseded_by).toBeUndefined();
  });

  it("withValidityStatus attaches a per-record verdict across a mixed batch", () => {
    const attached = withValidityStatus([liveDoc("a"), retractedDoc("b")], NOW);

    expect(attached[0]?.validity_status.invalidated).toBe(false);
    expect(attached[1]?.validity_status.invalidated).toBe(true);
    expect(attached[1]?.validity_status.superseded_by).toBe(SUCCESSOR_ID);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("projection — REGRESSION", () => {
  it("never mutates its inputs", () => {
    const docs = [liveDoc("a"), retractedDoc("b")];
    const snapshot = JSON.stringify(docs);

    selectLiveDocs(docs, NOW);
    withValidityStatus(docs, NOW);
    withPreGatedLiveStatus(docs, NOW);

    expect(JSON.stringify(docs)).toBe(snapshot);
    expect(Object.keys(docs[0] ?? {})).not.toContain("validity_status");
  });

  it("checked_at is the INJECTED instant, never a fresh wall-clock read", () => {
    const pinned = "2020-01-01T00:00:00.000Z";
    const attached = withValidityStatus([liveDoc("a")], pinned);

    expect(attached[0]?.validity_status.checked_at).toBe(pinned);
    expect(withPreGatedLiveStatus([liveDoc("b")], pinned)[0]?.validity_status.checked_at).toBe(pinned);
  });

  it("ABSENT validity_status and PRESENT-with-invalidated:false are distinguishable values", () => {
    // reason: the whole defect was that "not probed" and "probed, live" were the
    // same observation. A consumer must be able to tell them apart structurally.
    const unprobed = liveDoc("a");
    const probed = withValidityStatus([liveDoc("a")], NOW)[0];

    expect("validity_status" in unprobed).toBe(false);
    expect(probed?.validity_status).toEqual({ invalidated: false, checked_at: NOW });
  });

  it("withPreGatedLiveStatus stamps a live verdict without inventing detail fields", () => {
    const summaryShaped = { id: "01KZ", slug: "knowledge-x", title: "X" };
    const stamped = withPreGatedLiveStatus([summaryShaped], NOW);

    expect(stamped[0]?.validity_status).toEqual({ invalidated: false, checked_at: NOW });
    expect(stamped[0]?.slug).toBe("knowledge-x");
  });
});
