/**
 * Unit tests for `GateEnforcer` (`gate-enforcer.ts`) — the service-layer gate
 * checkpoint runner (retro follow-up item 8, "[arch] defense-in-depth"). Pure
 * decision logic only — `enforce()` takes a `LoreConfig | undefined` (stored at
 * construction) and a pre-fetched `GateContext`, no store, no IO — hence vitest,
 * not `.bun.test`.
 *
 * `GateEnforcer` reuses `checkpointRegistry` (`checkpoint-registry.ts`) and
 * `resolveGateEnabled` (`@lore/core`) UNCHANGED — this file proves the reuse (same
 * predicates, same config precedence), never re-derives predicate logic.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref retro follow-up item 8
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GateEnforcer, describeBypassBoundaryNote } from "../../../src/service/gate-enforcer.js";
import type { LoreConfig } from "@lore/core";

describe("GateEnforcer", () => {
  describe("enforce — default config (undefined, all checkpoints enabled)", () => {
    // HAPPY
    it("spec-create: returns ok(undefined) when every predicate passes", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: null,
        specKind: "feature",
        content: "## Overview\n\nBody.",
      });
      expect(result).toEqual({ ok: true, value: undefined });
    });

    // NEGATIVE
    it("spec-create: returns err(VALIDATION_ERROR) with a joined-reasons message when blocked", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: null,
        specKind: "feature",
        content: "no heading here",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect((result.error as { field?: string }).field).toBe("gate:spec-create");
        // reason: SPEC-049 D1 — the discriminator line is still the message's FIRST
        // line (byte-identical prefix, REGRESSION), but the message now grows a
        // `\n\n`-separated feeding-pack block below it (see the dedicated
        // "embeds the feeding pack" describe block below for full pack-content
        // coverage) — so this stays a `toContain` on the prefix, not a `toBe`.
        const message = (result.error as { message?: string }).message ?? "";
        expect(message.startsWith('Gate "spec-create" blocked: MISSING_SKELETON')).toBe(true);
        expect((result.error as { value?: unknown }).value).toEqual(["MISSING_SKELETON"]);
      }
    });

    // NEGATIVE — multiple simultaneous predicate failures joined into one message
    it("spec-create: joins MULTIPLE failing reasons with a comma", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: "task", // any parent is refused for a spec (BR-2)
        specKind: "bogus", // invalid spec_kind
        content: "no heading",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const message = (result.error as { message?: string }).message ?? "";
        expect(message).toContain("a spec takes no parent");
        expect(message).toContain("INVALID_SPEC_KIND");
        expect(message).toContain("MISSING_SKELETON");
      }
    });

    // BOUNDARY — vacuous pass: plan-promote/task-claim with no spec-tier ancestor
    it("plan-promote: returns ok(undefined) vacuously when hasSpecParent is false", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("plan-promote", { hasSpecParent: false });
      expect(result).toEqual({ ok: true, value: undefined });
    });

    // NEGATIVE
    it("task-claim: returns err(VALIDATION_ERROR) when the ancestor spec is not approved", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("task-claim", {
        hasSpecParent: true,
        parentSpec: { type: "spec", status: "draft", extra: {}, deleted_at: null },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as { field?: string }).field).toBe("gate:task-claim");
      }
    });

    // HAPPY
    it("task-claim: returns ok(undefined) when the ancestor spec is approved", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("task-claim", {
        hasSpecParent: true,
        parentSpec: { type: "spec", status: "approved", extra: {}, deleted_at: null },
      });
      expect(result).toEqual({ ok: true, value: undefined });
    });
  });

  describe("enforce — STATE: per-checkpoint config disable (resolveGateEnabled reuse)", () => {
    // STATE
    it("a checkpoint explicitly disabled via workflow.gates.<cp>.enabled=false always passes", () => {
      const config = {
        project: { name: "x", author: "y" },
        workflow: {
          claim_ttl_minutes: 120,
          gates: { "spec-create": { enabled: false } },
        },
      } as unknown as LoreConfig;
      const enforcer = new GateEnforcer(config);

      const result = enforcer.enforce("spec-create", {
        parentType: "task", // would otherwise fail INVALID_PARENT_TYPE
        content: "",
      });
      expect(result).toEqual({ ok: true, value: undefined });
    });

    // STATE — disabling ONE checkpoint does not disable the others (config precedence
    // is per-checkpoint, mirrors resolveGateEnabled's own contract).
    it("disabling spec-create leaves task-claim gated normally", () => {
      const config = {
        project: { name: "x", author: "y" },
        workflow: {
          claim_ttl_minutes: 120,
          gates: { "spec-create": { enabled: false } },
        },
      } as unknown as LoreConfig;
      const enforcer = new GateEnforcer(config);

      const result = enforcer.enforce("task-claim", {
        hasSpecParent: true,
        parentSpec: { type: "spec", status: "draft", extra: {}, deleted_at: null },
      });
      expect(result.ok).toBe(false);
    });

    // REGRESSION — absence of the whole config, or an explicit enabled:true, both mean
    // "enabled" (resolveGateEnabled's own backward-compat contract, reused unchanged).
    it("workflow.gates.<cp>.enabled=true (explicit) still gates normally", () => {
      const config = {
        project: { name: "x", author: "y" },
        workflow: {
          claim_ttl_minutes: 120,
          gates: { "spec-create": { enabled: true } },
        },
      } as unknown as LoreConfig;
      const enforcer = new GateEnforcer(config);

      const result = enforcer.enforce("spec-create", { parentType: "task", content: "" });
      expect(result.ok).toBe(false);
    });
  });

  // ERROR — an unregistered checkpoint is a programmer-invariant violation (all four
  // GateCheckpoint members are always registered in checkpointRegistry — this can only
  // fire via an artificial cast past the compile-time-known checkpoint union), and
  // throws rather than silently passing — mirrors gate.ts's identical
  // requireCheckpoint "can't happen in production" internal-invariant pattern.
  describe("enforce — ERROR (programmer-invariant violation)", () => {
    it("throws for a checkpoint id absent from checkpointRegistry", () => {
      const enforcer = new GateEnforcer(undefined);
      expect(() =>
        enforcer.enforce(
          "not-a-real-checkpoint" as unknown as Parameters<typeof enforcer.enforce>[0],
          {},
        ),
      ).toThrow(/not registered/);
    });
  });

  // SPEC-049 D1 — a blocked verdict now embeds the SAME feeding pack `lore gate
  // <checkpoint>` would print for the identical `ctx` (`checkpointDef.feed`, the
  // pure callback both callers share). One `it` per checkpoint, covering the
  // pack's checkpoint-specific content; `field`/`value` stay byte-identical
  // (REGRESSION) across every case here.
  describe("enforce — embeds the feeding pack on a blocked verdict (SPEC-049 D1)", () => {
    // NEGATIVE + REGRESSION (field/value unchanged)
    it("spec-create: message carries the pack's [source: ...] provenance header and missing list", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: null,
        specKind: "feature",
        content: "no heading here",
        ruleSource: "knowledge-write-spec-rules",
        ruleMarkdown: "## Rule\n\nEvery spec needs a heading.",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as { field?: string }).field).toBe("gate:spec-create");
      expect((result.error as { value?: unknown }).value).toEqual(["MISSING_SKELETON"]);
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain('Gate "spec-create" blocked: MISSING_SKELETON');
      expect(message).toContain("[source: knowledge-write-spec-rules, trust: team-authored]");
      expect(message).toContain("Missing:");
      expect(message).toContain("MISSING_SKELETON");
      expect(message).toContain("Every spec needs a heading.");
      // No trailing newline left over from the feed callback's own text.
      expect(message.endsWith("\n")).toBe(false);
    });

    // NEGATIVE — spec-promote's pack names the exact recovery command.
    it("spec-promote: message contains the `lore ac add` recovery hint", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-promote", {
        acceptanceCriteriaCount: 0,
        specIdOrSlug: "spec-no-ac",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // reason: task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080 —
      // the base AC-count check is now `acCountMeetsFloor`, which (like every OTHER
      // spec-promote sub-predicate: acQuantifiable, oracleCoverage) carries an
      // explicit `field` sub-discriminator (`AC_COUNT_FIELD`), so the composed field
      // gains the `:acceptance-criteria-count` suffix per this module's OWN
      // documented "field sub-discriminator" convention (see `enforce()`'s header
      // comment above `fieldSuffix`) — no longer the bare `"gate:spec-promote"` a
      // field-less inline check produced pre-fix.
      expect((result.error as { field?: string }).field).toBe("gate:spec-promote:acceptance-criteria-count");
      expect((result.error as { value?: unknown }).value).toEqual(["NO_ACCEPTANCE_CRITERIA"]);
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain('Gate "spec-promote" blocked: NO_ACCEPTANCE_CRITERIA');
      expect(message).toContain("spec-no-ac");
      expect(message).toContain("lore ac add");
      expect(message.endsWith("\n")).toBe(false);
    });

    // NEGATIVE — plan-promote's pack names the ancestor spec pointer (slug/title/status).
    it("plan-promote: message contains the parent spec pointer line", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("plan-promote", {
        hasSpecParent: true,
        parentSpec: { type: "spec", status: "draft", extra: {}, deleted_at: null },
        parentSpecPointer: { slug: "spec-parent", title: "The Parent Spec", status: "draft" },
        targetIdOrSlug: "plan-x",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as { field?: string }).field).toBe("gate:plan-promote");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain('Gate "plan-promote" blocked:');
      expect(message).toContain("spec-parent");
      expect(message).toContain("The Parent Spec");
      expect(message).toContain("status: draft");
      expect(message).toContain("must be");
      expect(message.endsWith("\n")).toBe(false);
    });

    // NEGATIVE — task-claim / upstream-approval branch (no anchor conflict): still
    // names the ancestor spec pointer, mirroring plan-promote's pack shape.
    it("task-claim (upstream-approval failure): message contains the parent spec pointer line", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("task-claim", {
        hasSpecParent: true,
        parentSpec: { type: "spec", status: "draft", extra: {}, deleted_at: null },
        parentSpecPointer: { slug: "spec-parent", title: "The Parent Spec", status: "draft" },
        candidateBy: "agent:solo",
        candidateAnchors: [],
        siblingClaims: [],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as { field?: string }).field).toBe("gate:task-claim");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain('Gate "task-claim" blocked:');
      expect(message).toContain("spec-parent");
      expect(message).toContain("The Parent Spec");
      expect(message.endsWith("\n")).toBe(false);
    });

    // NEGATIVE — the headline scenario SPEC-049 exists to fix: an anchor-overlap
    // denial's message must name the conflicting sibling task's slug, its holder,
    // and a literal copy-pasteable `lore release <slug> --force`
    // recovery command — none of which the pre-SPEC-049 bare discriminator
    // (`Gate "task-claim" blocked: ANCHOR_OVERLAP`) carried.
    it("task-claim (anchor-overlap): message names the conflicting sibling, its holder, and the literal recovery command", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("task-claim", {
        hasSpecParent: false,
        candidateBy: "agent:new-claimant",
        candidateAnchors: ["src/service/foo.ts"],
        siblingClaims: [
          {
            slug: "task-sibling-in-flight",
            title: "Sibling task already claimed",
            by: "agent:sibling-holder",
            at: "2026-07-17T00:00:00.000Z",
            stale: false,
            anchors: ["src/service/foo.ts"],
          },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // field carries the SPEC-042 D5 anchor-overlap sub-discriminator, unchanged.
      expect((result.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
      expect((result.error as { value?: unknown }).value).toEqual(["ANCHOR_OVERLAP"]);
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain('Gate "task-claim" blocked: ANCHOR_OVERLAP');
      expect(message).toContain("task-sibling-in-flight");
      expect(message).toContain("agent:sibling-holder");
      expect(message).toContain(
        "lore release task-sibling-in-flight --force",
      );
      expect(message.endsWith("\n")).toBe(false);
    });
  });

  // task-lore-gate-bypass-honored-by-lore-gate-subcommands-but — Design Decision
  // Option B (module header): `LORE_GATE_BYPASS=1` never changes whether `enforce()`
  // blocks; it only annotates an already-blocked message. Pure-function coverage for
  // `describeBypassBoundaryNote` (no env mutation needed — it takes `env` as an
  // explicit parameter), plus `enforce()`-level coverage using the REAL
  // `process.env` (its one actual call site).
  describe("describeBypassBoundaryNote (pure formatter)", () => {
    // HAPPY
    it("returns the boundary note naming both LORE_GATE_BYPASS and the config knob when env var is exactly \"1\"", () => {
      const note = describeBypassBoundaryNote("spec-create", { LORE_GATE_BYPASS: "1" });
      expect(note).toContain("LORE_GATE_BYPASS");
      expect(note).toContain("workflow.gates.spec-create.enabled: false");
      expect(note).toContain("lore gate spec-create");
      expect(note.startsWith("\n\n")).toBe(true);
    });

    // NEGATIVE / REGRESSION (AC-4) — variable absent entirely.
    it("returns empty string when the variable is absent from env", () => {
      expect(describeBypassBoundaryNote("task-claim", {})).toBe("");
    });

    // BOUNDARY — a value that is not exactly "1" (mirrors gate.ts's own `=== "1"`
    // check) must NOT trigger the note.
    it("returns empty string for a truthy-looking but non-\"1\" value", () => {
      expect(describeBypassBoundaryNote("plan-promote", { LORE_GATE_BYPASS: "true" })).toBe("");
      expect(describeBypassBoundaryNote("plan-promote", { LORE_GATE_BYPASS: "0" })).toBe("");
      expect(describeBypassBoundaryNote("plan-promote", { LORE_GATE_BYPASS: "" })).toBe("");
    });

    // STATE — the checkpoint id is threaded into BOTH the `lore gate <checkpoint>`
    // reference and the `workflow.gates.<checkpoint>.enabled` config key, per
    // checkpoint (not a hardcoded example).
    it("names the SPECIFIC checkpoint passed in, not a fixed example", () => {
      const note = describeBypassBoundaryNote("task-claim", { LORE_GATE_BYPASS: "1" });
      expect(note).toContain("lore gate task-claim");
      expect(note).toContain("workflow.gates.task-claim.enabled: false");
      expect(note).not.toContain("spec-create");
    });
  });

  describe("enforce — LORE_GATE_BYPASS write-path boundary note wiring (real process.env)", () => {
    const ENV_VAR = "LORE_GATE_BYPASS";
    let original: string | undefined;

    beforeEach(() => {
      original = process.env[ENV_VAR];
      delete process.env[ENV_VAR];
    });

    afterEach(() => {
      if (original === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = original;
    });

    // REGRESSION (AC-4) — variable unset: message byte-identical to the pre-task
    // NEGATIVE test above (same input, same assertions), no note appended.
    it("variable unset: blocked message is unchanged, no note appended", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: null,
        specKind: "feature",
        content: "no heading here",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const message = (result.error as { message?: string }).message ?? "";
      expect(message.startsWith('Gate "spec-create" blocked: MISSING_SKELETON')).toBe(true);
      expect(message).not.toContain("LORE_GATE_BYPASS");
    });

    // NEGATIVE + AC-1 + AC-2 — variable set to "1": enforce() STILL returns
    // err (never silently passes), and the message grows the boundary note with
    // two independent lone tokens.
    it("variable set to \"1\": enforce() still blocks, message grows the boundary note", () => {
      process.env[ENV_VAR] = "1";
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: null,
        specKind: "feature",
        content: "no heading here",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as { code?: string }).code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("gate:spec-create");
      expect((result.error as { value?: unknown }).value).toEqual(["MISSING_SKELETON"]);
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("MISSING_SKELETON");
      expect(message).toContain("LORE_GATE_BYPASS");
      expect(message).toContain("workflow.gates.spec-create.enabled: false");
    });

    // STATE — a PASSING checkpoint with the variable set: no message exists at all
    // to annotate (ok result), so nothing changes — proves the note is wired ONLY
    // into the blocked branch, never touches the pass branch.
    it("variable set to \"1\" but checkpoint PASSES: result unaffected (ok(undefined), same as unset)", () => {
      process.env[ENV_VAR] = "1";
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: null,
        specKind: "feature",
        content: "## Overview\n\nBody.",
      });
      expect(result).toEqual({ ok: true, value: undefined });
    });

    // STATE (AC-5) — precedence: a config-disabled checkpoint short-circuits to
    // ok(undefined) BEFORE the predicates (and therefore before the boundary-note
    // branch) ever run, so the env var being ALSO set changes nothing.
    it("variable set to \"1\" AND checkpoint disabled by config: still passes vacuously, unaffected by the env var", () => {
      process.env[ENV_VAR] = "1";
      const config = {
        project: { name: "x", author: "y" },
        workflow: { claim_ttl_minutes: 120, gates: { "spec-create": { enabled: false } } },
      } as unknown as LoreConfig;
      const enforcer = new GateEnforcer(config);
      const result = enforcer.enforce("spec-create", {
        parentType: "task", // would otherwise fail INVALID_PARENT_TYPE
        content: "",
      });
      expect(result).toEqual({ ok: true, value: undefined });
    });
  });
});
