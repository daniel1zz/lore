// @reads packages/core/src/autonomy/**
/**
 * AC-AU-1 oracle — decide() applies hard rules, then the weakest-link score over
 * measured factors; an unmeasured REQUIRED factor scores 0; an absent OPTIONAL J is
 * left out of the minimum.
 *
 * Spec: spec-autonomy-phase-1-decision-function-human-channel-lore (AC-AU-1).
 * Written RED-FIRST (src/autonomy/decide.ts absent when this file was authored).
 *
 * Halves (1)-(6) and (4b) are each a named table row with EXACT verdict and score
 * asserted. Custom registries are injected (decide's 4th parameter) so threshold 0.5
 * and J-capable classes can be exercised without touching the seeded class table.
 */
import { describe, it, expect } from "vitest";
import {
  decide,
  OPERATION_CLASS_REGISTRY,
  type OperationClassRegistry,
  type AutonomyFacts,
} from "../../src/autonomy/index.js";
import * as barrel from "../../src/index.js";

const ALL_ONE: AutonomyFacts = {
  recoverability: "reversible",
  blast: "own-or-ended-run",
  evidence: "lore-evaluated",
  confidence: 1,
};

const TEST_REGISTRY: OperationClassRegistry = {
  "human-class": { tier: "human-always", usesJudge: false },
  "ext-class": { tier: "normal", declaredRecoverability: "reversible", threshold: 0.5, priorConfidence: 1, usesJudge: false },
  "plain-class": { tier: "normal", declaredRecoverability: "reversible", threshold: 0.5, priorConfidence: 1, usesJudge: false },
  "judged-class": { tier: "normal", declaredRecoverability: "reversible", threshold: 0.2, priorConfidence: 1, usesJudge: true },
};

describe("AC-AU-1 decide(): mandatory halves", () => {
  it("AC-AU-1 (1) all factors 1.0 on a human-always class -> escalate", () => {
    const d = decide("human-class", "s1", ALL_ONE, TEST_REGISTRY);
    expect(d.verdict).toBe("escalate");
    expect(d.score).toBe(0);
    expect(d.reasons.join(" ")).toMatch(/human-always/);
  });

  it("AC-AU-1 (2) irreversible-external with every other factor 1.0 -> escalate", () => {
    const d = decide("ext-class", "s2", { ...ALL_ONE, recoverability: "irreversible-external" }, TEST_REGISTRY);
    expect(d.verdict).toBe("escalate");
    expect(d.score).toBe(0);
    expect(d.reasons.join(" ")).toMatch(/irreversible-external/);
  });

  it("AC-AU-1 (3) weighted mean would pass (0.8 >= 0.5) but min fails: R=0.2 others 1.0 threshold 0.5 -> escalate", () => {
    const d = decide("plain-class", "s3", { ...ALL_ONE, recoverability: "irreversible-local" }, TEST_REGISTRY);
    expect((0.2 + 1 + 1 + 1) / 4).toBeGreaterThanOrEqual(0.5); // the mean WOULD pass
    expect(d.factors.R).toBe(0.2);
    expect(d.score).toBe(0.2);
    expect(d.verdict).toBe("escalate");
  });

  it("AC-AU-1 (4) J absent vs J=1.0 -> identical score; J below the others lowers the score to exactly J", () => {
    const absent = decide("judged-class", "s4", ALL_ONE, TEST_REGISTRY);
    const high = decide("judged-class", "s4", { ...ALL_ONE, judge: "approve" }, TEST_REGISTRY);
    const low = decide("judged-class", "s4", { ...ALL_ONE, judge: "escalate" }, TEST_REGISTRY); // escalate maps to 0.4
    expect(absent.score).toBe(1);
    expect(high.score).toBe(absent.score);
    expect(high.verdict).toBe("auto");
    expect(low.score).toBe(0.4);
    expect(low.factors.J).toBe(0.4);
    expect(absent.factors.J).toBeUndefined();
    // reject maps to 0 and can only lower
    const rej = decide("judged-class", "s4", { ...ALL_ONE, judge: "reject" }, TEST_REGISTRY);
    expect(rej.score).toBe(0);
    expect(rej.verdict).toBe("escalate");
  });

  it("AC-AU-1 (4) the min rule: a single factor at 0.3 among 1.0s yields score exactly 0.3", () => {
    const d = decide("plain-class", "s4-min", { ...ALL_ONE, confidence: 0.3 }, TEST_REGISTRY);
    expect(d.score).toBe(0.3);
  });

  it("AC-AU-1 (4b) class without J and all required factors 1.0 -> auto (absent optional J is not unmeasured)", () => {
    const d = decide("plain-class", "s4b", ALL_ONE, TEST_REGISTRY);
    expect(d.verdict).toBe("auto");
    expect(d.score).toBe(1);
    expect(d.factors.J).toBeUndefined();
  });

  it("AC-AU-1 (5) B unmeasured -> score 0 -> escalate", () => {
    const { blast: _omitted, ...withoutBlast } = ALL_ONE;
    const d = decide("plain-class", "s5", withoutBlast, TEST_REGISTRY);
    expect(d.factors.B).toBe(0);
    expect(d.score).toBe(0);
    expect(d.verdict).toBe("escalate");
  });

  it("AC-AU-1 (6) control: every factor at or above threshold on a normal class -> auto", () => {
    const d = decide("plain-class", "s6", ALL_ONE, TEST_REGISTRY);
    expect(d.verdict).toBe("auto");
    expect(d.score).toBe(1);
    // boundary: score exactly equal to threshold is auto
    const edge = decide("plain-class", "s6-edge", { ...ALL_ONE, confidence: 0.5 }, TEST_REGISTRY);
    expect(edge.score).toBe(0.5);
    expect(edge.verdict).toBe("auto");
    const below = decide("plain-class", "s6-below", { ...ALL_ONE, confidence: 0.49 }, TEST_REGISTRY);
    expect(below.verdict).toBe("escalate");
  });
});

describe("AC-AU-1 decide(): mapping tables and the other hard rule", () => {
  it.each([
    ["reversible", 1],
    ["loss-free-by-proof", 0.9],
    ["irreversible-local", 0.2],
    ["irreversible-external", 0],
  ] as const)("R %s -> %s", (recoverability, expected) => {
    const d = decide("plain-class", "r", { ...ALL_ONE, recoverability }, TEST_REGISTRY);
    expect(d.factors.R).toBe(expected);
  });

  it.each([
    ["own-or-ended-run", 1],
    ["unprovable-owner-made-recoverable", 0.9],
    ["calling-session", 0.9],
    ["shared-live-state", 0.6],
    ["other-live-actor", 0.2],
    ["outside-machine", 0],
  ] as const)("B %s -> %s", (blast, expected) => {
    const d = decide("plain-class", "b", { ...ALL_ONE, blast }, TEST_REGISTRY);
    expect(d.factors.B).toBe(expected);
  });

  it.each([
    ["lore-evaluated", 1],
    ["runner-attested", 0.8],
    ["self-report", 0.1],
    ["none", 0],
  ] as const)("E %s -> %s", (evidence, expected) => {
    const d = decide("plain-class", "e", { ...ALL_ONE, evidence }, TEST_REGISTRY);
    expect(d.factors.E).toBe(expected);
  });

  it("irreversible-local with blast radius beyond own session -> escalate even with threshold 0 (hard rule)", () => {
    const reg: OperationClassRegistry = {
      loose: { tier: "normal", declaredRecoverability: "reversible", threshold: 0, priorConfidence: 1, usesJudge: false },
    };
    for (const blast of ["shared-live-state", "other-live-actor", "outside-machine"] as const) {
      const d = decide("loose", "h", { ...ALL_ONE, recoverability: "irreversible-local", blast }, reg);
      expect(d.verdict).toBe("escalate");
      expect(d.score).toBe(0);
      expect(d.reasons.join(" ")).toMatch(/irreversible-local/);
    }
    // within own session the hard rule does not fire: threshold 0 -> auto by score
    const own = decide("loose", "h", { ...ALL_ONE, recoverability: "irreversible-local", blast: "calling-session" }, reg);
    expect(own.verdict).toBe("auto");
  });

  it("measured recoverability worse than the class's declared path wins; better is clamped to declared", () => {
    const reg: OperationClassRegistry = {
      proof: { tier: "normal", declaredRecoverability: "loss-free-by-proof", threshold: 0.5, priorConfidence: 1, usesJudge: false },
    };
    expect(decide("proof", "x", { ...ALL_ONE, recoverability: "reversible" }, reg).factors.R).toBe(0.9);
    expect(decide("proof", "x", { ...ALL_ONE, recoverability: "irreversible-local" }, reg).factors.R).toBe(0.2);
  });

  it("J is ignored (and said so) for a class that does not use a judge", () => {
    const d = decide("plain-class", "j", { ...ALL_ONE, judge: "reject" }, TEST_REGISTRY);
    expect(d.verdict).toBe("auto");
    expect(d.factors.J).toBeUndefined();
    expect(d.reasons.join(" ")).toMatch(/judge/i);
  });
});

describe("AC-AU-1 decide(): refuse only for invariant violations", () => {
  it("unknown class -> refuse", () => {
    const d = decide("no-such-class", "u", ALL_ONE, TEST_REGISTRY);
    expect(d.verdict).toBe("refuse");
    expect(d.reasons.join(" ")).toMatch(/unknown class/);
  });

  it.each([
    ["confidence above 1", { ...ALL_ONE, confidence: 1.5 }],
    ["confidence negative", { ...ALL_ONE, confidence: -0.1 }],
    ["confidence NaN", { ...ALL_ONE, confidence: Number.NaN }],
    ["unknown blast category", { ...ALL_ONE, blast: "somewhere" }],
    ["unknown key (typo)", { ...ALL_ONE, blasst: "own-or-ended-run" }],
    ["facts is null", null],
    ["facts is a string", "all good"],
  ])("malformed facts (%s) -> refuse, never auto", (_name, facts) => {
    const d = decide("plain-class", "m", facts, TEST_REGISTRY);
    expect(d.verdict).toBe("refuse");
    expect(d.score).toBe(0);
  });

  it("empty subject -> refuse", () => {
    expect(decide("plain-class", "", ALL_ONE, TEST_REGISTRY).verdict).toBe("refuse");
  });

  it("an empty facts object is NOT malformed: every required factor unmeasured -> score 0 -> escalate", () => {
    const d = decide("plain-class", "empty", {}, TEST_REGISTRY);
    expect(d.verdict).toBe("escalate");
    expect(d.score).toBe(0);
    expect(d.factors).toEqual({ R: 0, B: 0, E: 0, C: 0 });
  });

  it("is pure: same input, same output; input facts not mutated", () => {
    const facts = { ...ALL_ONE };
    const snapshot = JSON.stringify(facts);
    expect(decide("plain-class", "p", facts, TEST_REGISTRY)).toEqual(decide("plain-class", "p", facts, TEST_REGISTRY));
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});

describe("AC-AU-1 seeded registry (spec class table)", () => {
  it("every human-always class and every normal class from the spec table is present with its threshold and prior", () => {
    const r: OperationClassRegistry = OPERATION_CLASS_REGISTRY;
    for (const id of ["governance-loosen", "push-force", "archive-ref-prune"]) {
      expect(r[id]?.tier).toBe("human-always");
    }
    for (const id of ["override-judgment", "override-attestation", "ac-exempt"]) {
      expect(r[id]?.tier).toBe("milestone");
    }
    expect(r["report-issue"]).toBeUndefined();
    const normal: Array<[string, string, number, number]> = [
      ["stash-drop", "loss-free-by-proof", 0.8, 0.95],
      ["worktree-remove", "loss-free-by-proof", 0.8, 0.97],
      ["process-reap", "loss-free-by-proof", 0.85, 0.97],
      ["verify-new-command", "reversible", 0.8, 0.95],
      ["run-end-stale", "reversible", 0.8, 0.97],
    ];
    for (const [id, path, threshold, prior] of normal) {
      const c = r[id];
      expect(c?.tier).toBe("normal");
      if (c?.tier === "normal") {
        expect(c.declaredRecoverability).toBe(path);
        expect(c.threshold).toBe(threshold);
        expect(c.priorConfidence).toBe(prior);
        expect(c.usesJudge).toBe(false);
      }
    }
    expect(Object.keys(r)).toHaveLength(11);
  });

  it("stash-drop with measured stash facts -> auto at 0.9; override-judgment (milestone class) -> milestone", () => {
    const stash = decide("stash-drop", "stash@{3}", {
      recoverability: "loss-free-by-proof", blast: "own-or-ended-run", evidence: "lore-evaluated", confidence: 0.95,
    });
    expect(stash.verdict).toBe("auto");
    expect(stash.score).toBe(0.9);
    const ov = decide("override-judgment", "task-x", {
      recoverability: "reversible", blast: "calling-session", evidence: "lore-evaluated", confidence: 0.5,
    });
    expect(ov.verdict).toBe("milestone");
    expect(ov.threshold).toBeNull();
  });

  it("human-always seeded classes escalate even with every factor 1.0", () => {
    for (const id of ["governance-loosen", "push-force", "archive-ref-prune"]) {
      expect(decide(id, "s", ALL_ONE).verdict).toBe("escalate");
    }
  });

  it("report-issue is not a class: it never asks decide(), so an attempt is refused", () => {
    expect(decide("report-issue", "s", ALL_ONE).verdict).toBe("refuse");
  });

  it("milestone classes answer milestone even with every factor 1.0 (never auto, never escalate)", () => {
    for (const id of ["override-judgment", "override-attestation", "ac-exempt"]) {
      expect(decide(id, "s", ALL_ONE).verdict).toBe("milestone");
    }
  });

  it("is exported from the @lore/core default barrel", () => {
    expect(barrel.decide).toBe(decide);
    expect(barrel.OPERATION_CLASS_REGISTRY).toBe(OPERATION_CLASS_REGISTRY);
  });
});
