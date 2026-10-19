/**
 * Scenarios for `ResolutionProjector` — the one-way projection of a resolution state onto a GitHub
 * `resolution:<state>` label (spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope entry
 * `ResolutionProjector`; AC-GI-4).
 *
 * Contract this file pins:
 *   - `resolutionToLabel(state: IssueResolution): string` — pure, `resolution:<state>`.
 *   - `labelToResolution(label: string): IssueResolution | undefined` — pure inverse; `undefined` on anything that
 *     isn't a real member (defensive, never throws).
 *   - `ResolutionLabelPort` — the ONE injected write capability (`setLabel(ref, label)`); the projector never imports
 *     a concrete GitHub client.
 *   - `ResolutionProjector` — `new ResolutionProjector(port)`, then `project(resolution, ref)`. Write-only: it never
 *     reads a label back (Per-Field Authority table, "read back as truth: never").
 *
 * Scenarios:
 *   1. All 9 resolution states round-trip through the label unchanged.
 *   2. rejected/wontfix/superseded collide on GitHub's `state_reason: not_planned` but stay distinguishable via the label.
 *   4. A hand-edited label never overrides the corpus value — write-only, corpus always wins.
 *
 * ⛔ Scenarios 3 (`lore issue resolve` calls the injected projector) and 5 (a projection failure still lets the corpus
 * verdict land) are RETIRED with their subject: `lore issue resolve` no longer writes the corpus or computes a
 * resolution; it writes only GitHub (spec-github-owns-issue-report-state-no-mirror-task-work-carries D6, GS-T6), and
 * its live behaviour — including the exit kind of a partial GitHub failure — is pinned end to end by
 * `tests/integration/cli/issue-resolve-github-owned.bun.test.ts` (AC-GS-6).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * @spec_ref AC-GI-4 — spec-the-defect-channel-reaches-no-machine-but-its-own-github
 */

import { describe, expect, it, vi } from "vitest";
import { ok, ISSUE_RESOLUTION_MEMBERS, type IssueResolution } from "@lore/core";

import {
  resolutionToLabel,
  labelToResolution,
  ResolutionProjector,
  type GithubIssueRef,
  type ResolutionLabelPort,
} from "../../../src/service/resolution-projector.js";

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 1 — HAPPY / BOUNDARY / NEGATIVE: pure 9-state round trip
// ═══════════════════════════════════════════════════════════════════════════

describe("resolutionToLabel / labelToResolution — AC-GI-4 scenario 1 (pure round trip)", () => {
  it("HAPPY: ISSUE_RESOLUTION_MEMBERS is the 9-state vocabulary this scenario iterates (sampling power)", () => {
    expect(ISSUE_RESOLUTION_MEMBERS.length).toBe(9);
  });

  it("HAPPY: all 9 states round-trip through the label unchanged — 9 for 9", () => {
    let roundTripped = 0;
    for (const state of ISSUE_RESOLUTION_MEMBERS) {
      const label = resolutionToLabel(state);
      const recovered = labelToResolution(label);
      expect(recovered).toBe(state);
      roundTripped += 1;
    }
    expect(roundTripped).toBe(9);
  });

  it("BOUNDARY: the label is exactly the documented `resolution:<state>` shape, not merely a decodable one", () => {
    expect(resolutionToLabel("fixed")).toBe("resolution:fixed");
    expect(resolutionToLabel("open")).toBe("resolution:open");
    for (const state of ISSUE_RESOLUTION_MEMBERS) {
      expect(resolutionToLabel(state)).toBe(`resolution:${state}`);
    }
  });

  it("BOUNDARY: no two of the 9 states collide on the same label (bijective, a precondition of round-tripping)", () => {
    const labels = ISSUE_RESOLUTION_MEMBERS.map(resolutionToLabel);
    expect(new Set(labels).size).toBe(9);
  });

  it("NEGATIVE: a label naming no real resolution state decodes to undefined, never a guess", () => {
    expect(labelToResolution("resolution:not-a-real-state")).toBeUndefined();
    expect(labelToResolution("not-even-the-right-prefix")).toBeUndefined();
    expect(labelToResolution("")).toBeUndefined();
  });

  it("NEGATIVE: decoding is case-sensitive and whitespace-sensitive — no silent normalisation", () => {
    expect(labelToResolution("Resolution:fixed")).toBeUndefined();
    expect(labelToResolution("resolution: fixed")).toBeUndefined();
    expect(labelToResolution(" resolution:fixed")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 2 — the state_reason collision the label exists to route around
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-4 scenario 2 — rejected/wontfix/superseded collide on GitHub's state_reason, the label does not", () => {
  /**
   * GitHub's `state_reason` maps `rejected`, `wontfix`, and `superseded` onto the SAME value, `not_planned`. This
   * block proves the ONE thing that makes the collision survivable: the label still distinguishes all three.
   */
  const collidingStates: readonly IssueResolution[] = ["rejected", "wontfix", "superseded"];

  it("STATE: the three colliding states produce three PAIRWISE-DISTINCT labels", () => {
    const labels = collidingStates.map(resolutionToLabel);
    expect(new Set(labels).size).toBe(3);
  });

  it("STATE: each colliding state's label decodes back to exactly the state that produced it — never one of the other two", () => {
    for (const state of collidingStates) {
      const decoded = labelToResolution(resolutionToLabel(state));
      expect(decoded).toBe(state);
      for (const other of collidingStates) {
        if (other !== state) expect(decoded).not.toBe(other);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 4 — write-only: the corpus value always overwrites a hand-edited label
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-4 scenario 4 — a hand-edited label never overrides the corpus-derived resolution", () => {
  const ref: GithubIssueRef = { repo: "acme/widget", issueNumber: 42 };

  /** A `ResolutionLabelPort` double that remembers whatever was last written. */
  function makeStatefulPort(initialHandEditedLabel: string): {
    port: ResolutionLabelPort;
    currentLabel: () => string;
    setLabelSpy: ReturnType<typeof vi.fn>;
  } {
    let currentLabel = initialHandEditedLabel;
    const setLabelSpy = vi.fn(async (_ref: GithubIssueRef, label: string) => {
      currentLabel = label;
      return ok(undefined);
    });
    return { port: { setLabel: setLabelSpy }, currentLabel: () => currentLabel, setLabelSpy };
  }

  it("STATE: project() overwrites a pre-existing, disagreeing (hand-edited) label with the corpus value", async () => {
    const handEdited = resolutionToLabel("duplicate");
    const { port, currentLabel, setLabelSpy } = makeStatefulPort(handEdited);
    const projector = new ResolutionProjector(port);

    const result = await projector.project("wontfix", ref);

    expect(result.ok).toBe(true);
    expect(setLabelSpy).toHaveBeenCalledTimes(1);
    expect(currentLabel()).toBe(resolutionToLabel("wontfix"));
    expect(currentLabel()).not.toBe(handEdited);
  });

  it("STATE: the write is IDENTICAL regardless of what was previously on the label — no merge, no preservation", async () => {
    const corpusResolution: IssueResolution = "adopted";
    const fixtureA = makeStatefulPort(resolutionToLabel("open"));
    const fixtureB = makeStatefulPort(resolutionToLabel("superseded"));

    await new ResolutionProjector(fixtureA.port).project(corpusResolution, ref);
    await new ResolutionProjector(fixtureB.port).project(corpusResolution, ref);

    expect(fixtureA.currentLabel()).toBe(resolutionToLabel(corpusResolution));
    expect(fixtureB.currentLabel()).toBe(resolutionToLabel(corpusResolution));
    expect(fixtureA.currentLabel()).toBe(fixtureB.currentLabel());
  });

  it("REGRESSION: a hand-edited label's decode never equals a disagreeing corpus value — no path makes them coincide", () => {
    // `resolution-projector.ts` is write-only (Per-Field Authority: "read back as truth: never"). This pins the
    // negative directly: decoding a hand-edited label that disagrees with the corpus value must NEVER equal that
    // corpus value, because nothing in this module offers a path that would make them coincide by construction.
    const corpusResolution: IssueResolution = "resolving";
    const handEditedLabel = resolutionToLabel("closed");
    expect(labelToResolution(handEditedLabel)).not.toBe(corpusResolution);
    expect(labelToResolution(handEditedLabel)).toBe("closed");
  });
});
