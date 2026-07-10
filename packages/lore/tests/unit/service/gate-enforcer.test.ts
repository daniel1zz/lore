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

import { describe, it, expect } from "vitest";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { LoreConfig } from "@lore/core";

describe("GateEnforcer", () => {
  describe("enforce — default config (undefined, all checkpoints enabled)", () => {
    // HAPPY
    it("spec-create: returns ok(undefined) when every predicate passes", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: "prd",
        specKind: "feature",
        content: "## Overview\n\nBody.",
      });
      expect(result).toEqual({ ok: true, value: undefined });
    });

    // NEGATIVE
    it("spec-create: returns err(VALIDATION_ERROR) with a joined-reasons message when blocked", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: "prd",
        specKind: "feature",
        content: "no heading here",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect((result.error as { field?: string }).field).toBe("gate:spec-create");
        expect((result.error as { message?: string }).message).toBe(
          'Gate "spec-create" blocked: MISSING_SKELETON',
        );
        expect((result.error as { value?: unknown }).value).toEqual(["MISSING_SKELETON"]);
      }
    });

    // NEGATIVE — multiple simultaneous predicate failures joined into one message
    it("spec-create: joins MULTIPLE failing reasons with a comma", () => {
      const enforcer = new GateEnforcer(undefined);
      const result = enforcer.enforce("spec-create", {
        parentType: "task", // illegal parent type for spec
        specKind: "bogus", // invalid spec_kind
        content: "no heading",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const message = (result.error as { message?: string }).message ?? "";
        expect(message).toContain("INVALID_PARENT_TYPE");
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
});
