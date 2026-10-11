/**
 * RED suite (TDD-Role: red, paired-impl "T5 plan-close predicate") for
 * SPEC-080 §C4 / AC-080-5 — `lore status` must SURFACE currently-exempt plans
 * (count + slugs) rather than repeat the SPEC-069 `attestation_exempt` mistake,
 * which the spec calls out by name: "the SPEC-069 field is proven structurally
 * invisible today: zero status/doctor/dashboard surfacing; that miss is not
 * repeated" (§C4). Neither the data field nor the render helper exists yet.
 *
 * `commands/status.ts` itself is NOT vitest-reachable — it statically imports
 * `../loader.js`, which is bun-only (isolates `bun:sqlite` from vitest-reachable
 * modules; see this repo's `packages/lore/src/store/CLAUDE.md`). This suite
 * therefore targets the two layers that ARE vitest-reachable and that the
 * `commands/status.ts` text renderer would consume, mirroring how `--check-drift`
 * splits its own logic into a pure `flows/drift-flow.ts` (vitest-tested) that the
 * CLI file (`bun`-only, untested-by-vitest) merely calls into:
 *
 *   1. DATA layer — `CorpusService.status()` (already vitest-reachable via
 *      InMemoryStore, see `attestation-floor.test.ts`'s identical harness shape)
 *      is expected to gain a NEW `exempt_plans: Array<{slug: string}>` field,
 *      following the EXACT precedent already on `CorpusStatus` —
 *      `invalidated_feeding_source_warnings: string[]`'s own JSDoc: "Empty when
 *      nothing is invalidated (never omitted — always a fact, not absent data)".
 *      `exempt_plans` is proposed to follow the identical convention: always an
 *      array, `[]` when there are zero exemptions, never `undefined`.
 *
 *   2. RENDER layer — a NEW pure helper `renderExemptPlansSection`, proposed at
 *      `packages/lore/src/flows/status-prd-sync-flow.ts` (mirrors this
 *      directory's existing pure-flow modules: `drift-flow.ts`,
 *      `staleness-flow.ts`, `blueprint-flow.ts` — all plain vitest-tested TS,
 *      zero bun:sqlite reachability), consumed by `commands/status.ts`'s text
 *      renderer the same way it already consumes `renderDriftRepairHint`. This
 *      is the layer AC-080-5's "zero-exemption text output is byte-stable vs
 *      pre-change baseline" claim is actually about — the pre-change baseline
 *      today never prints an "Exempt plans" section at all, so a `[]` input
 *      producing `[]` lines (nothing appended) IS byte-stability.
 *
 * Neither `exempt_plans` nor `status-prd-sync-flow.ts` exists yet — every
 * assertion below is expected to fail for a MISSING-IMPLEMENTATION reason (an
 * `undefined`/empty read where a populated value is expected, or a module
 * resolution failure), not a logic bug in this suite.
 *
 * Coverage dimensions: HAPPY / BOUNDARY / REGRESSION.
 *
 * Source: spec-080-prd-as-outline-contract-structured-outline-domain §C4,
 *   §Acceptance Criteria AC-080-5; `CorpusStatus.invalidated_feeding_source_
 *   warnings` (`packages/lore/src/service/corpus-service.ts`) as the direct
 *   structural precedent this suite extends.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Narrow, untyped read of the AS-YET-UNDECLARED `exempt_plans` field —
 *  `CorpusStatus` (the real TS interface) does not have this member yet, so this
 *  reads it through an `unknown` cast rather than importing a type that would
 *  make the whole file fail to typecheck before it even runs. Runtime-wise this
 *  is exactly what `commands/status.ts`'s eventual renderer will read. */
function readExemptPlans(status: unknown): Array<{ slug: string }> {
  const value = (status as { exempt_plans?: Array<{ slug: string }> }).exempt_plans;
  return value ?? [];
}

async function makePlan(
  cs: CorpusService,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<DocRecord> {
  return mustCreate(cs, { type: "plan", title, content: "## Plan\n\nbody", extra } as CreateDocInput);
}

// ─── AC-080-5: >= 1 exempt plan → status lists count + slugs ─────────────────

describe("CorpusService.status().exempt_plans — HAPPY: surfaces a plan carrying a valid prd_sync_exempt", () => {
  it("lists exactly the exempt plan's slug when one plan is exempt and one is not", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const exemptPlan = await makePlan(corpusService, "Exempt plan", {
      prd_sync_exempt: {
        reason: "pure refactor, no domain narrative impact",
        by: "agent:t5r",
        at: "2026-07-26T00:00:00.000Z",
      },
    });
    await makePlan(corpusService, "Ordinary plan (not exempt)");

    const statusResult = await corpusService.status();

    expect(statusResult.ok).toBe(true);
    if (statusResult.ok) {
      const exemptPlans = readExemptPlans(statusResult.value);
      expect(exemptPlans.length).toBe(1);
      expect(exemptPlans.some((p) => p.slug === exemptPlan.slug)).toBe(true);
    }
  });

  it("counts multiple exempt plans (count, not just presence)", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const exemptExtra = {
      prd_sync_exempt: { reason: "narrow scope, no narrative change", by: "agent:t5r", at: "2026-07-26T00:00:00.000Z" },
    };
    const planA = await makePlan(corpusService, "Exempt plan A", exemptExtra);
    const planB = await makePlan(corpusService, "Exempt plan B", exemptExtra);

    const statusResult = await corpusService.status();

    expect(statusResult.ok).toBe(true);
    if (statusResult.ok) {
      const exemptPlans = readExemptPlans(statusResult.value);
      expect(exemptPlans.length).toBe(2);
      const slugs = exemptPlans.map((p) => p.slug);
      expect(slugs).toContain(planA.slug);
      expect(slugs).toContain(planB.slug);
    }
  });
});

// ─── REGRESSION: zero exemptions → the field is present but empty, never omitted ──

describe("CorpusService.status().exempt_plans — REGRESSION: zero exemptions is an empty array, not an absent field", () => {
  it("returns an empty exempt_plans array when no plan declares prd_sync_exempt", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await makePlan(corpusService, "Never-exempt plan");

    const statusResult = await corpusService.status();

    expect(statusResult.ok).toBe(true);
    if (statusResult.ok) {
      expect(readExemptPlans(statusResult.value)).toEqual([]);
    }
  });

  it("returns an empty exempt_plans array on a totally empty corpus", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const statusResult = await corpusService.status();

    expect(statusResult.ok).toBe(true);
    if (statusResult.ok) {
      expect(readExemptPlans(statusResult.value)).toEqual([]);
    }
  });
});

// ─── RENDER layer: the pure text-projection helper (see module JSDoc §2) ─────

describe("renderExemptPlansSection — render-layer contract for commands/status.ts's text output", () => {
  it("renders one line per exempt plan slug plus a count, when >= 1 exemption exists", async () => {
    const mod = (await import("../../../src/flows/status-prd-sync-flow.js")) as {
      renderExemptPlansSection: (plans: ReadonlyArray<{ slug: string }>) => string[];
    };
    const lines = mod.renderExemptPlansSection([{ slug: "plan-a" }, { slug: "plan-b" }]);
    const rendered = lines.join("\n");

    expect(rendered).toContain("plan-a");
    expect(rendered).toContain("plan-b");
    expect(rendered).toMatch(/2/);
  });

  it("renders NO lines at all for zero exemptions (byte-stable vs the pre-change baseline, which never printed this section)", async () => {
    const mod = (await import("../../../src/flows/status-prd-sync-flow.js")) as {
      renderExemptPlansSection: (plans: ReadonlyArray<{ slug: string }>) => string[];
    };
    const lines = mod.renderExemptPlansSection([]);

    expect(lines).toEqual([]);
  });
});
