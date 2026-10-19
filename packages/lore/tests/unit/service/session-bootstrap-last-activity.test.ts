/**
 * Tests for `deriveLastActivityAt` (core pure fn) + its wiring into
 * `SessionService.bootstrap`'s required `active_plans[].last_activity_at`
 * (SPEC-069 F3, §Design Decisions D6/D7). Uses InMemoryStore for the
 * service-level section — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      SessionService.bootstrap populates last_activity_at with the
 *               known max of the seeded fixture docs.
 *   BOUNDARY:   deriveLastActivityAt totality — zero tasks returns
 *               plan.updated_at; a task newer than the plan wins; the plan
 *               itself newest wins; a tie (equal ISO strings) resolves to
 *               that shared value.
 *   NEGATIVE:   bootstrapReportSchema.parse throws (fail-loud) on an
 *               active_plans entry missing last_activity_at — the required-
 *               field Zod-strip trap this AC exists to prevent (D7).
 *
 * @spec_ref SPEC-069 AC-069-6
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { deriveLastActivityAt, bootstrapReportSchema, type BootstrapReport } from "@lore/core";
import type { DocRecord, CreateDocInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { actedStore } from "../../live-invocation.js";

/** Minimal valid DocRecord fixture — every field the schema/derivation touches is real. */
function makeDoc(overrides: Partial<DocRecord> & { updated_at: string }): DocRecord {
  return {
    id: overrides.id ?? "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    slug: overrides.slug ?? "plan-fixture",
    type: overrides.type ?? "plan",
    role: overrides.role ?? "plan",
    title: overrides.title ?? "Fixture Plan",
    status: overrides.status ?? "active",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "# Fixture",
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.created_at ?? "2026-07-01T00:00:00.000Z",
    updated_at: overrides.updated_at,
    created_by: overrides.created_by ?? "alice",
    version: overrides.version ?? 1,
    deleted_at: overrides.deleted_at ?? null,
    tags: overrides.tags ?? [],
    extra: overrides.extra ?? {},
  };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput) {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("deriveLastActivityAt — BOUNDARY (AC-069-6)", () => {
  it("zero tasks: returns plan.updated_at (totality)", () => {
    const plan = makeDoc({ updated_at: "2026-07-20T00:00:00.000Z" });
    expect(deriveLastActivityAt(plan, [])).toBe("2026-07-20T00:00:00.000Z");
  });

  it("a task newer than the plan wins", () => {
    const plan = makeDoc({ updated_at: "2026-07-20T00:00:00.000Z" });
    const task = makeDoc({
      id: "01HZZZZZZZZZZZZZZZZZZZZZZ1",
      slug: "task-fixture",
      type: "task",
      role: "plan",
      updated_at: "2026-07-23T00:00:00.000Z",
    });
    expect(deriveLastActivityAt(plan, [task])).toBe("2026-07-23T00:00:00.000Z");
  });

  it("the plan itself being the newest wins over an older task", () => {
    const plan = makeDoc({ updated_at: "2026-07-23T00:00:00.000Z" });
    const task = makeDoc({
      id: "01HZZZZZZZZZZZZZZZZZZZZZZ1",
      slug: "task-fixture",
      type: "task",
      role: "plan",
      updated_at: "2026-07-01T00:00:00.000Z",
    });
    expect(deriveLastActivityAt(plan, [task])).toBe("2026-07-23T00:00:00.000Z");
  });

  it("a tie (plan and task share the exact same updated_at) resolves to that shared value", () => {
    const shared = "2026-07-22T12:00:00.000Z";
    const plan = makeDoc({ updated_at: shared });
    const task = makeDoc({
      id: "01HZZZZZZZZZZZZZZZZZZZZZZ1",
      slug: "task-fixture",
      type: "task",
      role: "plan",
      updated_at: shared,
    });
    expect(deriveLastActivityAt(plan, [task])).toBe(shared);
  });

  it("the max is taken over MULTIPLE tasks, not just the first/last", () => {
    const plan = makeDoc({ updated_at: "2026-07-10T00:00:00.000Z" });
    const taskA = makeDoc({
      id: "01HZZZZZZZZZZZZZZZZZZZZZZ1",
      slug: "task-a",
      type: "task",
      role: "plan",
      updated_at: "2026-07-15T00:00:00.000Z",
    });
    const taskB = makeDoc({
      id: "01HZZZZZZZZZZZZZZZZZZZZZZ2",
      slug: "task-b",
      type: "task",
      role: "plan",
      updated_at: "2026-07-23T00:00:00.000Z",
    });
    const taskC = makeDoc({
      id: "01HZZZZZZZZZZZZZZZZZZZZZZ3",
      slug: "task-c",
      type: "task",
      role: "plan",
      updated_at: "2026-07-12T00:00:00.000Z",
    });
    expect(deriveLastActivityAt(plan, [taskA, taskB, taskC])).toBe("2026-07-23T00:00:00.000Z");
  });
});

describe("SessionService.bootstrap — active_plans[].last_activity_at (HAPPY, AC-069-6)", () => {
  it("every active_plans entry carries last_activity_at equal to the known max of the seeded docs", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const sessionService = new SessionService(store, {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10080,
      createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
    });

    const plan = await mustCreate(corpusService, {
      type: "plan",
      title: "Activity Plan",
      content: "# Plan",
    } as CreateDocInput);

    const task = await mustCreate(corpusService, {
      type: "task",
      title: "Activity Task",
      parent_id: plan.id,
      content: "# Task",
      extra: { plan_id: plan.id },
    } as CreateDocInput);

    // Bump the task strictly past both docs' creation-time updated_at so the
    // known max is unambiguous and NOT just "whichever was created last".
    // reason: far-future timestamp — must beat the REAL wall clock at whatever
    // instant this test actually runs, not just the doc-creation instant.
    const bumped = "2030-01-01T00:00:00.000Z";
    const bumpResult = await store.update(task.id, { updated_at: bumped });
    if (!bumpResult.ok) throw new Error(JSON.stringify(bumpResult.error));
    expect(bumpResult.value.updated_at).toBe(bumped);

    const bootstrapResult = await sessionService.bootstrap("alice");
    expect(bootstrapResult.ok).toBe(true);
    if (!bootstrapResult.ok) return;

    expect(bootstrapResult.value.active_plans).toHaveLength(1);
    expect(bootstrapResult.value.active_plans[0]!.last_activity_at).toBe(bumped);
  });

  it("a plan with zero tasks reports the plan's own updated_at (totality, no tasks in the corpus at all)", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const sessionService = new SessionService(store, {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10080,
      createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
    });

    const plan = await mustCreate(corpusService, {
      type: "plan",
      title: "Childless Plan",
      content: "# Plan",
    } as CreateDocInput);

    const bootstrapResult = await sessionService.bootstrap("alice");
    expect(bootstrapResult.ok).toBe(true);
    if (!bootstrapResult.ok) return;

    expect(bootstrapResult.value.active_plans).toHaveLength(1);
    expect(bootstrapResult.value.active_plans[0]!.last_activity_at).toBe(plan.updated_at);
  });
});

describe("bootstrapReportSchema.parse — NEGATIVE fail-loud (AC-069-6, D7)", () => {
  it("throws when an active_plans entry is missing last_activity_at", () => {
    const report = {
      root: null,
      active_plans: [
        {
          slug: "plan-fixture",
          title: "Fixture Plan",
          task_counts: { ready: 0, claimed: 0, done: 0 },
          // last_activity_at deliberately omitted
        },
      ],
      pending_reviews: { count: 0, slugs: [] },
      my_claims: [],
      armed_gates: [],
      latest_handoffs: [],
      resume_hint: null,
      corpus: { total_docs: 0, last_updated: null },
      active_sessions: [],
      archive_candidates: 0,
    };

    expect(() => bootstrapReportSchema.parse(report)).toThrow();
  });

  it("round-trips cleanly when last_activity_at IS present (REGRESSION control)", () => {
    const report: BootstrapReport = {
      root: null,
      architecture: null,
      active_plans: [
        {
          slug: "plan-fixture",
          title: "Fixture Plan",
          task_counts: { ready: 0, claimed: 0, done: 0 },
          last_activity_at: "2026-07-23T00:00:00.000Z",
        },
      ],
      pending_reviews: { count: 0, slugs: [] },
      my_claims: [],
      armed_gates: [],
      latest_handoffs: [],
      resume_hint: null,
      corpus: { total_docs: 0, last_updated: null },
      active_sessions: [],
      archive_candidates: 0,
    };

    const parsed = bootstrapReportSchema.parse(report);
    expect(parsed.active_plans[0]!.last_activity_at).toBe("2026-07-23T00:00:00.000Z");
  });
});
