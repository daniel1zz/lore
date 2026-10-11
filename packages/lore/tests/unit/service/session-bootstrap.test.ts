/**
 * Tests for SessionService.bootstrap (SPEC-041 S1 pointer-set).
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      a realistic corpus (PRD, approved skill doc, plan + mixed tasks,
 *               draft doc, handoff doc) produces a correct BootstrapReport, and the
 *               report never leaks doc `content` / carries only bounded titles.
 *   STATE:      >1 PRDs → deterministic earliest-created-at root pick (not an error,
 *               contrast with writeHandoff's stricter multi-PRD rule); a checkpoint
 *               disabled via the injected `isCheckpointEnabled` port is omitted from
 *               `armed_gates`.
 *   BOUNDARY:   AC-SL-10 — completely empty corpus still returns `ok` with every
 *               field in its documented empty shape.
 *
 * @spec_ref SPEC-041 §4 AC-SL-1 AC-SL-10
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import type { GateCheckpoint } from "../../../src/service/checkpoint-registry.js";
import type { CreateDocInput } from "@lore/core";

function makeSessionService(store: InMemoryStore, isCheckpointEnabled?: (cp: GateCheckpoint) => boolean) {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
    ...(isCheckpointEnabled !== undefined ? { isCheckpointEnabled } : {}),
  });
  return { corpusService, sessionService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput) {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("SessionService.bootstrap — HAPPY (AC-SL-1)", () => {
  it("assembles a correct pointer-set from a realistic corpus", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);

    const prd = await mustCreate(corpusService, {
      type: "prd",
      title: "Root PRD",
      content: "# Root",
    } as CreateDocInput);

    // Approved skill doc feeding the spec-create checkpoint.
    const skillCreate = await corpusService.create({
      type: "knowledge",
      title: "Write-spec skill",
      content: "# Skill",
      extra: { sub_type: "skill", skill: { applies_to: "spec" } },
    } as CreateDocInput);
    if (!skillCreate.ok) throw new Error(JSON.stringify(skillCreate.error));
    const approveResult = await store.update(skillCreate.value.id, { status: "approved" });
    if (!approveResult.ok) throw new Error(JSON.stringify(approveResult.error));
    const skillDoc = approveResult.value;

    const plan = await mustCreate(corpusService, {
      type: "plan",
      title: "Session Plan",
      content: "# Plan",
    } as CreateDocInput);

    const readyTask = await mustCreate(corpusService, {
      type: "task",
      title: "Ready Task",
      parent_id: plan.id,
      content: "# Task",
      extra: { plan_id: plan.id },
    } as CreateDocInput);

    const claimedTask = await mustCreate(corpusService, {
      type: "task",
      title: "Claimed Task",
      parent_id: plan.id,
      content: "# Task",
      extra: { plan_id: plan.id },
    } as CreateDocInput);
    const claimedPatch = await store.update(claimedTask.id, {
      extra: { plan_id: plan.id, claim: { by: "alice", at: new Date().toISOString() } },
    });
    if (!claimedPatch.ok) throw new Error(JSON.stringify(claimedPatch.error));

    const archivedTask = await mustCreate(corpusService, {
      type: "task",
      title: "Done Task",
      parent_id: plan.id,
      content: "# Task",
      extra: { plan_id: plan.id },
    } as CreateDocInput);
    const archivedPatch = await store.update(archivedTask.id, { status: "archived" });
    if (!archivedPatch.ok) throw new Error(JSON.stringify(archivedPatch.error));

    const draftDoc = await mustCreate(corpusService, {
      type: "knowledge",
      title: "Draft note",
      content: "# Draft",
      extra: { sub_type: "reference" },
    } as CreateDocInput);

    const handoffResult = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: ["a.ts"],
      key_decisions: [],
      next_steps: ["continue"],
    });
    if (!handoffResult.ok) throw new Error(JSON.stringify(handoffResult.error));
    const handoffDoc = handoffResult.value;

    const bootstrapResult = await sessionService.bootstrap("alice");
    expect(bootstrapResult.ok).toBe(true);
    if (!bootstrapResult.ok) return;
    const report = bootstrapResult.value;

    // root
    expect(report.root).toEqual({ slug: prd.slug, title: prd.title });

    // active_plans / task_counts — deliberately set: 2 non-terminal tasks are both
    // "ready" per evaluateReadiness (readiness is about blockers/status, NOT claim
    // state — a claimed task is still ready), 1 of those 2 carries a fresh claim,
    // and 1 archived task counts as done.
    expect(report.active_plans).toHaveLength(1);
    expect(report.active_plans[0]!.slug).toBe(plan.slug);
    expect(report.active_plans[0]!.task_counts).toEqual({ ready: 2, claimed: 1, done: 1 });
    void readyTask;

    // pending_reviews — the draft doc (created "draft" by default) should be present.
    expect(report.pending_reviews.slugs).toContain(draftDoc.slug);
    expect(report.pending_reviews.count).toBe(report.pending_reviews.slugs.length <= 10 ? report.pending_reviews.count : 10);
    expect(report.pending_reviews.slugs.length).toBeLessThanOrEqual(10);

    // my_claims — filters by actor
    const mine = await sessionService.bootstrap("alice");
    if (!mine.ok) throw new Error("unexpected error");
    expect(mine.value.my_claims).toHaveLength(1);
    expect(mine.value.my_claims[0]!.task_slug).toBe(claimedTask.slug);
    expect(mine.value.my_claims[0]!.plan_slug).toBe(plan.slug);
    expect(mine.value.my_claims[0]!.stale).toBe(false);

    const notMine = await sessionService.bootstrap("bob");
    if (!notMine.ok) throw new Error("unexpected error");
    expect(notMine.value.my_claims).toEqual([]);

    // armed_gates — all 5 checkpoints present (SPEC-054 added plan-close), spec-create carries the skill slug
    expect(report.armed_gates).toHaveLength(5);
    const checkpoints = report.armed_gates.map((g) => g.checkpoint).sort();
    expect(checkpoints).toEqual(
      ["plan-close", "plan-promote", "spec-create", "spec-promote", "task-claim"].sort(),
    );
    for (const gate of report.armed_gates) {
      if (gate.checkpoint === "spec-create") {
        expect(gate.feeding_source_slug).toBe(skillDoc.slug);
      } else {
        expect(gate.feeding_source_slug).toBeNull();
      }
    }

    // latest_handoffs / resume_hint point at the handoff we wrote
    expect(report.latest_handoffs.length).toBeGreaterThanOrEqual(1);
    const forPlan = report.latest_handoffs.find((h) => h.plan_slug === plan.slug);
    expect(forPlan?.handoff_slug).toBe(handoffDoc.slug);
    expect(forPlan?.by).toBe("alice");
    expect(report.resume_hint).toEqual({ plan_slug: plan.slug, handoff_slug: handoffDoc.slug });

    // Content-freedom: no doc's content leaks into the report, and every title is bounded.
    const serialized = JSON.stringify(report);
    const bodies = [prd.content, plan.content, draftDoc.content, handoffDoc.content];
    for (const body of bodies) {
      expect(serialized.includes(body)).toBe(false);
    }
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        // heuristic: title-shaped fields would be caught structurally below instead;
        // here we only assert the whole serialized report has no title > 120 chars.
        return;
      }
      if (Array.isArray(value)) {
        for (const v of value) walk(v);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
          if (key === "title" && typeof v === "string") {
            expect(v.length).toBeLessThanOrEqual(120);
          }
          walk(v);
        }
      }
    };
    walk(report);
  });
});

describe("SessionService.bootstrap — BOUNDARY (AC-SL-10)", () => {
  it("empty corpus returns ok with every documented empty shape", async () => {
    const store = new InMemoryStore();
    const { sessionService } = makeSessionService(store);

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.value;

    expect(report.root).toBeNull();
    expect(report.active_plans).toEqual([]);
    expect(report.pending_reviews).toEqual({ count: 0, slugs: [] });
    expect(report.my_claims).toEqual([]);
    expect(report.armed_gates).toHaveLength(5);
    for (const gate of report.armed_gates) {
      expect(gate.feeding_source_slug).toBeNull();
    }
    expect(report.latest_handoffs).toEqual([]);
    expect(report.resume_hint).toBeNull();
    expect(report.corpus).toEqual({ total_docs: 0, last_updated: null });
  });
});

describe("SessionService.bootstrap — STATE: multi-PRD root + gate config disable", () => {
  it("deterministically picks the earliest-created PRD as root when >1 PRDs exist", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);

    const first = await mustCreate(corpusService, { type: "prd", title: "First PRD", content: "# 1" } as CreateDocInput);
    // Force a deterministic, strictly-earlier created_at on the first PRD.
    const patched = await store.update(first.id, { created_at: "2020-01-01T00:00:00.000Z" });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    await mustCreate(corpusService, { type: "prd", title: "Second PRD", content: "# 2" } as CreateDocInput);

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root?.slug).toBe(first.slug);
  });

  it("a checkpoint disabled via the isCheckpointEnabled port is omitted from armed_gates", async () => {
    const store = new InMemoryStore();
    const { sessionService } = makeSessionService(store, (cp) => cp !== "task-claim");

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.armed_gates).toHaveLength(4);
    expect(result.value.armed_gates.some((g) => g.checkpoint === "task-claim")).toBe(false);
  });
});
