/**
 * Six-dimension pure-function tests for `renewClaimForEvidence` (SPEC-069 §Design
 * Decisions D4/D5, closes window W3 — a session still producing evidence is alive;
 * TTL takeover should only ever hit an actually-dead session).
 *
 * Dimension mapping:
 *   HAPPY:      same-holder FRESH claim -> renewed, `at` becomes `nowIso`,
 *               branch/machine/worktree preserved verbatim
 *   NEGATIVE:   foreign holder -> null (untouched, no implicit acquisition)
 *   BOUNDARY:   same-holder STALE claim -> STILL renewed (staleness is irrelevant
 *               to the same-holder match — the defining behavior this fn adds
 *               over a naive isClaimStale-gated refresh)
 *   ERROR:      N/A — pure total function, no fallible IO
 *   STATE:      absent claim (undefined) -> null
 *   REGRESSION: input claim object is never mutated (toStrictEqual snapshot
 *               before/after the call)
 *
 * @spec_ref AC-069-3
 */

import { describe, it, expect } from "vitest";
import { renewClaimForEvidence, type TaskClaim } from "@lore/core";

const FRESH: TaskClaim = {
  by: "alice",
  at: "2026-07-23T10:00:00.000Z",
  branch: "feat/x",
  machine: "alices-mbp",
  worktree: "/repo/.worktrees/t1",
};

const STALE: TaskClaim = {
  by: "alice",
  at: "2026-01-01T00:00:00.000Z", // far in the past relative to any TTL
};

const NOW_ISO = "2026-07-23T12:00:00.000Z";

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — same-holder fresh claim renews (AC-069-3)", () => {
  it("returns a renewed claim with at === nowIso when actor matches the fresh holder", () => {
    const result = renewClaimForEvidence(FRESH, "alice", NOW_ISO);
    expect(result).not.toBeNull();
    expect(result?.at).toBe(NOW_ISO);
    expect(result?.by).toBe("alice");
  });

  it("preserves branch/machine/worktree verbatim from the original claim", () => {
    const result = renewClaimForEvidence(FRESH, "alice", NOW_ISO);
    expect(result).toMatchObject({
      branch: "feat/x",
      machine: "alices-mbp",
      worktree: "/repo/.worktrees/t1",
    });
  });

  it("returns a NEW object, not the same reference as the input claim", () => {
    const result = renewClaimForEvidence(FRESH, "alice", NOW_ISO);
    expect(result).not.toBe(FRESH);
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — foreign holder leaves the claim untouched (AC-069-3)", () => {
  it("returns null when the evidence recorder is not the claim holder", () => {
    const result = renewClaimForEvidence(FRESH, "bob", NOW_ISO);
    expect(result).toBeNull();
  });

  it("returns null for a foreign actor against a stale claim too (no implicit takeover)", () => {
    const result = renewClaimForEvidence(STALE, "bob", NOW_ISO);
    expect(result).toBeNull();
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — same-holder STALE claim still renews (AC-069-3, D5)", () => {
  it("renews even when the claim's age would exceed any reasonable TTL — staleness is irrelevant to the same-holder match", () => {
    const result = renewClaimForEvidence(STALE, "alice", NOW_ISO);
    expect(result).not.toBeNull();
    expect(result?.at).toBe(NOW_ISO);
    expect(result?.by).toBe("alice");
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — absent claim (AC-069-3)", () => {
  it("returns null when there is no claim to renew", () => {
    const result = renewClaimForEvidence(undefined, "alice", NOW_ISO);
    expect(result).toBeNull();
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — input claim is never mutated (AC-069-3)", () => {
  it("leaves the original FRESH claim object byte-identical after a same-holder renewal call", () => {
    const before = { ...FRESH };
    renewClaimForEvidence(FRESH, "alice", NOW_ISO);
    expect(FRESH).toStrictEqual(before);
  });

  it("leaves the original claim object byte-identical after a foreign-holder no-op call", () => {
    const before = { ...FRESH };
    renewClaimForEvidence(FRESH, "bob", NOW_ISO);
    expect(FRESH).toStrictEqual(before);
  });

  it("leaves the STALE claim object byte-identical after a same-holder renewal call", () => {
    const before = { ...STALE };
    renewClaimForEvidence(STALE, "alice", NOW_ISO);
    expect(STALE).toStrictEqual(before);
  });
});
