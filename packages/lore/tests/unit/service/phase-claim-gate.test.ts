/**
 * RED suite (TDD-Role: red, paired-impl task
 * task-skill-implement-phaseworkflowservice-rename-checkpoint-conf) for the
 * `phase-claim` gate checkpoint — SPEC-056 §Design Decisions D2/D7's rename of
 * the SPEC-042 `task-claim` anchor-overlap checkpoint onto phase docs. Covers
 * AC-P-3 (spec-spec-056-phase-execution-model-phase-doc-type-computed-comp).
 *
 * Two RED techniques are combined here:
 *
 *  1. IMPORT, NEVER COPY (plan invariant R4) — this file starts with a bare
 *     side-effect `import` of the SPEC-042 fixture file itself
 *     (`claim-anchor-gate.test.ts`, found via
 *     `grep -rl "anchor-overlap\|anchorOverlap\|noAnchorOverlap"
 *     packages/lore/tests`). Vitest collects a test file by executing its
 *     module and capturing every `describe`/`it` call made DURING that
 *     execution — importing another `.test.ts` file re-executes its top-level
 *     code, so the SAME suite registers (and runs) a second time, nested
 *     under THIS file's collection run, with zero hand-copied assertions.
 *     See this file's CONTRACT NOTE §1 for exactly what this proves (and does
 *     NOT prove).
 *
 *  2. Computed-specifier dynamic import for not-yet-existing symbols (see
 *     `knowledge-spec-058-execution-learnings-init-seeding-yaml-trap-co` §2,
 *     this repo's documented technique for RED tasks paired with a concurrent
 *     implement task in a separate worktree): TypeScript only performs static
 *     module/export resolution against `import()` calls whose argument is a
 *     STRING LITERAL. A computed specifier (built via `.join("/")`, or an
 *     `as unknown as GateCheckpoint` cast on a plain string for an
 *     ALREADY-EXISTING module whose type union is missing one member) skips
 *     that static check, so `bun run typecheck` stays green both before and
 *     after the paired task lands, with zero edits to this file either way.
 *     At runtime today, `checkpointRegistry["phase-claim"]` is `undefined`
 *     (no such entry yet) and `resolveGateEnabled(config, "phase-claim")`
 *     resolves with NO alias fallback — both genuinely fail, which is the RED
 *     mode this task's AC calls for.
 *
 * CONTRACT NOTE (this file is the authoritative shape the paired implement
 * task must satisfy — resolves every ambiguity SPEC-056 §Design Decisions
 * D2/D7 leaves open; per this plan's stated convention, T1's
 * `phase-completion.test.ts`/`phase-scope-freeze.test.ts` CONTRACT NOTEs are
 * the precedent this one follows):
 *
 *   §1 What the side-effect import proves (and doesn't): importing
 *      `claim-anchor-gate.test.ts` re-runs ITS OWN cases, which construct and
 *      operate on `type: "task"` docs via `TaskWorkflowService` — it is a
 *      REGRESSION harness proving the phase-claim rename does not disturb
 *      pre-existing task-doc anchor-overlap behavior (partial coverage toward
 *      AC-P-6's "task-era suites pass"), NOT a demonstration of phase-doc
 *      behavior. The fixture file exports nothing (verified: zero `export`
 *      statements) and is outside this task's declared anchors, so it cannot
 *      be refactored into a parameterized/reusable form from here — the
 *      phase-doc-targeted assertions below are freshly authored, mirroring
 *      the fixture's SCENARIO SHAPES (HAPPY / NEGATIVE / BOUNDARY / STATE)
 *      one-for-one, but exercising `checkpointRegistry["phase-claim"]` and (in
 *      the paired file, `phase-workflow-service.test.ts`) a real
 *      `PhaseWorkflowService.claim()` call against phase docs.
 *
 *   §2 `GateContext` (and `SiblingClaimInfo`, `ANCHOR_OVERLAP_FIELD`) are
 *      CHECKPOINT- AND DOC-TYPE-AGNOSTIC by construction — no field encodes
 *      "task" vs "phase" or "task-claim" vs "phase-claim" (verified by
 *      reading `checkpoint-registry.ts`'s `GateContext` interface and
 *      `gate-predicates.ts`'s `noAnchorOverlap`/`ANCHOR_OVERLAP_FIELD`). This
 *      means the pure predicate LOGIC backing `task-claim`'s anchor-overlap
 *      check needs no doc-type-specific rewrite for `phase-claim` — the
 *      expected implementation is `checkpointRegistry["phase-claim"]` pointing
 *      at the SAME (possibly renamed) predicate function `"task-claim"`
 *      currently uses, registered under the new key. This file's pure-layer
 *      assertions below are therefore expected to start passing with a
 *      ONE-LINE registry addition, not a reimplementation.
 *
 *   §3 Field discriminator: a blocked service-layer `PhaseWorkflowService.
 *      claim()` call is expected to carry `field: "gate:phase-claim:anchor-
 *      overlap"` (GateEnforcer.enforce's existing `gate:<checkpoint>:<field>`
 *      composition, unchanged — only the checkpoint id segment changes from
 *      "task-claim" to "phase-claim"). Asserted end-to-end in
 *      `phase-workflow-service.test.ts` (this file only reaches the PURE
 *      layer, whose `failures[].field` is the checkpoint-agnostic
 *      `ANCHOR_OVERLAP_FIELD` constant, i.e. the bare string `"anchor-
 *      overlap"` — see §2).
 *
 *   §4 Config alias (D7, "the ONE dual-read site"): `resolveGateEnabled`
 *      (`@lore/core`, ALREADY EXISTS — this file imports it statically, no
 *      computed-import needed for this half) is expected to become
 *      alias-aware specifically for `checkpoint === "phase-claim"`: when
 *      `workflow.gates."phase-claim"` is ABSENT but the legacy
 *      `workflow.gates."task-claim"` key IS present, it reads the legacy
 *      value AND logs a deprecation notice via `console.warn` EXACTLY ONCE
 *      PER PROCESS (a module-level `warned` flag, not per-call) — chosen as
 *      THE dual-read site D7 names ("do not scatter alias logic across
 *      callers") so `GateEnforcer.isEnabled`/`.enforce()` and any future
 *      direct caller inherit the alias for free, with zero call-site changes.
 *      This is a deliberate, narrow relaxation of `resolveGateEnabled`'s
 *      otherwise side-effect-free contract — the same class of exception this
 *      codebase already accepts for other deprecation/notice surfaces
 *      (Chesterton's-fence-safe: the alternative, threading a warning
 *      collector through every one of `resolveGateEnabled`'s ~6 unrelated
 *      call sites, is the "scattered" shape D7 explicitly rejects). An
 *      EXPLICIT `workflow.gates."phase-claim"` entry always wins outright and
 *      never triggers the warning, even when a legacy `"task-claim"` entry is
 *      ALSO present (canonical-key-present ⇒ alias branch never consulted).
 *      Test-isolation assumption: vitest's default `isolate: true` (fork pool)
 *      gives this FILE its own module registry, so "once per process" is
 *      observable as "once across this file's full run" — cross-file warning
 *      state is out of scope here.
 *
 *   §5 Phase docs are constructed via raw `store.insert(...)` (InMemoryStore),
 *      never `CorpusService.create` — `type: "phase"` is not wired into
 *      `schemas.ts`'s `docTypeSchema`/`createDocInputSchema` yet (see
 *      `phase.ts`'s own module-header invariant, T1) and `DocType` (`types.ts`)
 *      does not include `"phase"` yet, so every raw phase `DocRecord` literal
 *      below casts `type: "phase" as unknown as DocType`. This mirrors
 *      `phase-scope-freeze.test.ts`'s documented fixture-construction choice
 *      (T1 precedent) for the identical reason.
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Design Decisions D2, D5 (inherited from SPEC-042), D7; §Acceptance
 *   Criteria AC-P-3.
 */

import { describe, it, expect, vi } from "vitest";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  type GateContext,
  type GateCheckpoint,
} from "../../../src/service/checkpoint-registry.js";
import { ANCHOR_OVERLAP_FIELD, type SiblingClaimInfo } from "../../../src/service/gate-predicates.js";
import { resolveGateEnabled } from "@lore/core";
import type { LoreConfig } from "@lore/core";

// ─── §1 — SPEC-042 fixture, imported (never copied, plan invariant R4) ────────
// Bare side-effect import: re-registers and re-runs claim-anchor-gate.test.ts's
// full describe/it tree (against task docs) as part of collecting THIS file —
// a regression harness, not a phase-doc test. See module header CONTRACT NOTE §1.
import "./claim-anchor-gate.test.js";

// reason: GateCheckpoint does not have a "phase-claim" member yet (checkpoint-
// registry.ts's union still lists only "task-claim") — this is the exact
// "computed/cast specifier for a not-yet-existing member" RED technique #2
// from the module header, applied to an existing union type instead of an
// existing module path. Forward-compatible: once "phase-claim" is a real
// GateCheckpoint member, this cast still compiles with zero edits.
const PHASE_CLAIM = "phase-claim" as unknown as GateCheckpoint;

// ─── §2 — Pure checkpointRegistry["phase-claim"] (missing today) ──────────────

describe("checkpointRegistry['phase-claim'] — noAnchorOverlap on phase docs (SPEC-056 D2/D7 rename)", () => {
  const overlappingSibling: SiblingClaimInfo = {
    slug: "phase-one",
    title: "Phase One",
    by: "agent:p1",
    at: "2026-07-19T09:00:00.000Z",
    stale: false,
    anchors: ["src/a/"],
  };

  it("registry gains a 'phase-claim' entry (missing today — the rename itself)", () => {
    const def = checkpointRegistry[PHASE_CLAIM];
    expect(def).toBeDefined();
  });

  // HAPPY — distinct-actor overlapping claim is blocked
  it("blocks a distinct-actor overlapping claim (bare predicate field 'anchor-overlap')", () => {
    const def = checkpointRegistry[PHASE_CLAIM]!;
    const ctx: GateContext = {
      candidateBy: "agent:p2",
      candidateAnchors: ["src/a"],
      siblingClaims: [overlappingSibling],
      hasSpecParent: false,
    };
    const results = def.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    const failures = selectFailures(results);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.field).toBe(ANCHOR_OVERLAP_FIELD);
    expect(failures[0]?.reason).toBe("ANCHOR_OVERLAP");
  });

  // NEGATIVE — AC-P-3 explicit requirement: same-actor overlap must NOT be
  // rejected, mirroring claim-anchor-gate.test.ts's identical task-doc case.
  // reason: task-two-concurrent-orchestrators-both-resolve-to-agent-main narrowed
  // the exemption from "same `by`" (a proxy two live sessions share) to "same `by`
  // AND the same CAPTURED session instance". AC-P-3's intent — a solo actor holding
  // two overlapping phases does not block itself — is unchanged and still holds at
  // this PURE layer, which is where AC-P-3 is stated; it now requires the fact
  // rather than the proxy. ⚠ `PhaseWorkflowService.claim` does not yet CAPTURE a
  // session id (that file is outside this task's declared anchors), so at the
  // SERVICE layer a same-actor phase overlap currently lands in the not-measured
  // refusal below — see claim-anchor-toctou.test.ts's phase case.
  it("NEGATIVE: a sibling claim held by the SAME actor in the SAME measured session is never rejected", () => {
    const def = checkpointRegistry[PHASE_CLAIM]!;
    const ctx: GateContext = {
      candidateBy: "agent:p1",
      candidateSessionId: "3de02220",
      candidateAnchors: ["src/a"],
      siblingClaims: [{ ...overlappingSibling, session_id: "3de02220" }], // also by agent:p1
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  // NEGATIVE — the same pair with the session instance unmeasured on one side is
  // REFUSED with its own reason (the control proving the case above is not a
  // blanket permit for every same-actor phase overlap).
  it("NEGATIVE: a SAME-actor phase overlap with no recorded session is refused as not-measured", () => {
    const def = checkpointRegistry[PHASE_CLAIM]!;
    const ctx: GateContext = {
      candidateBy: "agent:p1",
      candidateSessionId: "3de02220",
      candidateAnchors: ["src/a"],
      siblingClaims: [overlappingSibling], // same actor, no session_id recorded
      hasSpecParent: false,
    };
    const failures = selectFailures(def.check(ctx));
    expect(isCheckpointBlocked(def.check(ctx))).toBe(true);
    expect(failures[0]?.reason).toBe("ANCHOR_OVERLAP_SESSION_UNMEASURED");
  });

  // BOUNDARY — either side anchor-less → vacuous pass (mirrors fixture)
  it("candidate with no anchors → vacuous pass regardless of sibling claims", () => {
    const def = checkpointRegistry[PHASE_CLAIM]!;
    const ctx: GateContext = {
      candidateBy: "agent:p2",
      candidateAnchors: [],
      siblingClaims: [overlappingSibling],
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  // BOUNDARY — disjoint anchors → pass
  it("disjoint anchors (no segment overlap) → pass", () => {
    const def = checkpointRegistry[PHASE_CLAIM]!;
    const ctx: GateContext = {
      candidateBy: "agent:p2",
      candidateAnchors: ["src/b"],
      siblingClaims: [overlappingSibling], // declares src/a/
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  // STATE — stale foreign claim never blocks
  it("a STALE sibling claim never blocks, even with overlapping anchors", () => {
    const def = checkpointRegistry[PHASE_CLAIM]!;
    const ctx: GateContext = {
      candidateBy: "agent:p2",
      candidateAnchors: ["src/a"],
      siblingClaims: [{ ...overlappingSibling, stale: true }],
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  // REGRESSION — AC-S3-3 equivalent: runs unconditionally, no upstream-spec
  // short-circuit hole, carried forward from SPEC-042 onto the new key.
  it("runs UNCONDITIONALLY when hasSpecParent is false — no short-circuit hole", () => {
    const def = checkpointRegistry[PHASE_CLAIM]!;
    const ctx: GateContext = {
      candidateBy: "agent:p2",
      candidateAnchors: ["src/a"],
      siblingClaims: [overlappingSibling],
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(true);
  });

  // REGRESSION — discriminator separation: upstream-approval failure alone
  // carries no field (base "gate:phase-claim" applies, service layer only).
  it("upstream-approval failure alone carries NO field (base checkpoint field applies)", () => {
    const def = checkpointRegistry[PHASE_CLAIM]!;
    const ctx: GateContext = {
      candidateBy: "agent:p2",
      candidateAnchors: [], // no anchors declared — noAnchorOverlap vacuously passes
      siblingClaims: [],
      hasSpecParent: true,
      parentSpec: { type: "spec", status: "draft", extra: {}, deleted_at: null },
    };
    const results = def.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    const failures = selectFailures(results);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.field).toBeUndefined();
  });
});

// ─── §4 — Config alias: workflow.gates."task-claim" → "phase-claim" (D7) ──────

describe("resolveGateEnabled config alias — 'task-claim' legacy key honored for 'phase-claim' (SPEC-056 D7)", () => {
  function legacyOnlyDisabledConfig(): LoreConfig {
    return {
      project: { name: "x", author: "y" },
      workflow: {
        claim_ttl_minutes: 120,
        gates: { "task-claim": { enabled: false } },
      },
    } as unknown as LoreConfig;
  }

  function canonicalDisabledConfig(): LoreConfig {
    return {
      project: { name: "x", author: "y" },
      workflow: {
        claim_ttl_minutes: 120,
        gates: { "phase-claim": { enabled: false } },
      },
    } as unknown as LoreConfig;
  }

  function bothKeysPresentConfig(): LoreConfig {
    return {
      project: { name: "x", author: "y" },
      workflow: {
        claim_ttl_minutes: 120,
        // canonical key present and ENABLED; legacy key present and DISABLED —
        // the canonical key must win outright, never falling through to the
        // legacy value (§4 CONTRACT NOTE: "canonical-key-present ⇒ alias
        // branch never consulted").
        gates: { "phase-claim": { enabled: true }, "task-claim": { enabled: false } },
      },
    } as unknown as LoreConfig;
  }

  it("a legacy-only 'task-claim'.enabled=false is honored for the 'phase-claim' checkpoint (alias fallback)", () => {
    // Today: resolveGateEnabled has no phase-claim alias branch, so a
    // 'phase-claim' lookup finds no key at all and resolves the true default —
    // genuinely RED (expected false, actual true) until the alias lands.
    expect(resolveGateEnabled(legacyOnlyDisabledConfig(), "phase-claim")).toBe(false);
  });

  it("an explicit canonical 'phase-claim' key always wins over a present legacy key", () => {
    expect(resolveGateEnabled(canonicalDisabledConfig(), "phase-claim")).toBe(false);
    expect(resolveGateEnabled(bothKeysPresentConfig(), "phase-claim")).toBe(true);
  });

  it("no config / no gates map / neither key present → default enabled (true), unaffected by the alias", () => {
    expect(resolveGateEnabled(undefined, "phase-claim")).toBe(true);
    expect(
      resolveGateEnabled({ project: { name: "x", author: "y" } } as unknown as LoreConfig, "phase-claim"),
    ).toBe(true);
  });

  it("emits EXACTLY ONE console.warn deprecation notice across repeated legacy-alias resolutions in this process", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const config = legacyOnlyDisabledConfig();
      resolveGateEnabled(config, "phase-claim");
      resolveGateEnabled(config, "phase-claim");
      resolveGateEnabled(config, "phase-claim");
      // Today: zero alias-deprecation warnings are ever emitted (the branch
      // doesn't exist) — genuinely RED (expected 1, actual 0).
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("an explicit canonical key never triggers the deprecation warning, even alongside a legacy key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      resolveGateEnabled(bothKeysPresentConfig(), "phase-claim");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
