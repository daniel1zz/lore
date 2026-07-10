/**
 * Tests for SessionService.resume (SPEC-041 S2 resume read path).
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      newest-wins-by-plan selection; direct --handoff targeting skips
 *               derivation entirely (opts.by/opts.plan ignored).
 *   STATE:      age/TTL-warning computation via the injected `now` seam; actor
 *               isolation (`--by` filters before selection); multi-actor surfacing
 *               (`multi_actor: true`, newest-per-actor `handoffs[]`) vs the
 *               single-actor shape (`handoff` singular, `handoffs` absent).
 *   BOUNDARY:   `output_tail` at the 2000-char cap round-trips losslessly through
 *               `renderHandoffContent`; 2001 chars is rejected at write time.
 *   ERROR:      `resume({plan: "nonexistent-slug"})` errors (bad input) — contrast
 *               with a valid plan/corpus with zero handoffs, which is `found: false`.
 *   NEGATIVE:   empty corpus / handoff-less plan → `found: false`, never an error.
 *
 * @spec_ref SPEC-041 §4 AC-SL-5 AC-SL-11
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import type { CreateDocInput } from "@lore/core";

function makeServices(handoffTtlMinutes = 10080) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });
  return { store, corpusService, sessionService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput) {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("SessionService.resume — HAPPY: newest-wins by plan", () => {
  it("returns the newer of two same-actor/same-plan handoffs, ordered by a pinned created_at", async () => {
    const { store, corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { type: "plan", title: "Plan R1", content: "# Plan" } as CreateDocInput);

    const older = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["first"],
    });
    if (!older.ok) throw new Error(JSON.stringify(older.error));
    const pinned = await store.update(older.value.id, { created_at: "2020-01-01T00:00:00.000Z" });
    if (!pinned.ok) throw new Error(JSON.stringify(pinned.error));

    const newer = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["second"],
    });
    if (!newer.ok) throw new Error(JSON.stringify(newer.error));

    const result = await sessionService.resume({ plan: plan.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.found).toBe(true);
    expect(result.value.multi_actor).toBe(false);
    expect(result.value.handoff?.handoff_slug).toBe(newer.value.slug);
  });
});

describe("SessionService.resume — HAPPY: direct --handoff targeting skips derivation", () => {
  it("returns exactly the targeted (older) handoff even though a newer one exists elsewhere, ignoring opts.by/opts.plan", async () => {
    const { corpusService, sessionService } = makeServices();
    const planA = await mustCreate(corpusService, { type: "plan", title: "Plan A", content: "# Plan" } as CreateDocInput);
    const planB = await mustCreate(corpusService, { type: "plan", title: "Plan B", content: "# Plan" } as CreateDocInput);

    const target = await sessionService.writeHandoff({
      by: "author-one",
      plan_ref: planA.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["target"],
    });
    if (!target.ok) throw new Error(JSON.stringify(target.error));

    const other = await sessionService.writeHandoff({
      by: "author-two",
      plan_ref: planB.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["other"],
    });
    if (!other.ok) throw new Error(JSON.stringify(other.error));
    void other;

    // opts.by does NOT match the targeted handoff's author, and opts.plan points
    // elsewhere — both must be ignored for direct targeting.
    const result = await sessionService.resume({ handoff: target.value.slug, by: "author-two", plan: planB.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.found).toBe(true);
    expect(result.value.handoff?.handoff_slug).toBe(target.value.slug);
    expect(result.value.handoff?.by).toBe("author-one");
  });
});

describe("SessionService.resume — STATE: age + TTL warning", () => {
  it("a handoff older than handoffTtlMinutes gets ttl_warning: true with a matching age_minutes", async () => {
    const { store, sessionService } = makeServices(1); // 1-minute TTL

    const written = await sessionService.writeHandoff({
      by: "alice",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["review"],
    });
    if (!written.ok) throw new Error(JSON.stringify(written.error));

    const pinnedCreatedAt = "2026-01-01T00:00:00.000Z";
    const patched = await store.update(written.value.id, { created_at: pinnedCreatedAt });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    const nowIso = "2026-01-01T00:05:00.000Z"; // 5 minutes later, TTL is 1 minute
    const result = await sessionService.resume({ handoff: written.value.slug }, () => nowIso);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handoff?.ttl_warning).toBe(true);
    expect(result.value.handoff?.age_minutes).toBe(5);
  });

  it("a fresh handoff (age well under TTL) gets ttl_warning: false", async () => {
    const { store, sessionService } = makeServices(10080);

    const written = await sessionService.writeHandoff({
      by: "alice",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["review"],
    });
    if (!written.ok) throw new Error(JSON.stringify(written.error));

    const pinnedCreatedAt = "2026-01-01T00:00:00.000Z";
    const patched = await store.update(written.value.id, { created_at: pinnedCreatedAt });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    const nowIso = "2026-01-01T00:00:30.000Z"; // 30 seconds later
    const result = await sessionService.resume({ handoff: written.value.slug }, () => nowIso);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handoff?.ttl_warning).toBe(false);
  });
});

describe("SessionService.resume — BOUNDARY: output_tail cap round-trip", () => {
  it("output_tail at exactly the 2000-char cap round-trips losslessly through content", async () => {
    const { sessionService } = makeServices();
    const tail = "y".repeat(2000);

    const written = await sessionService.writeHandoff({
      by: "alice",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      failing_oracle: { command: "x", output_tail: tail },
      next_steps: ["fix it"],
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const result = await sessionService.resume({ handoff: written.value.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handoff?.content.includes(tail)).toBe(true);
  });

  it("output_tail at 2001 chars is rejected at write time", async () => {
    const { sessionService } = makeServices();
    const result = await sessionService.writeHandoff({
      by: "alice",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      failing_oracle: { command: "x", output_tail: "y".repeat(2001) },
      next_steps: ["fix it"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("SessionService.resume — NEGATIVE/ERROR: not-found vs bad-input", () => {
  it("resume({}) on a corpus with zero handoff docs → found: false (not an error)", async () => {
    const { sessionService } = makeServices();
    const result = await sessionService.resume({});
    expect(result).toEqual({ ok: true, value: { found: false, multi_actor: false, readiness: null } });
  });

  it("resume({plan}) on a valid plan with no handoffs → found: false (not an error)", async () => {
    const { corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { type: "plan", title: "Empty Plan", content: "# Plan" } as CreateDocInput);

    const result = await sessionService.resume({ plan: plan.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.found).toBe(false);
    expect(result.value.multi_actor).toBe(false);
    expect(result.value.readiness).toBeNull();
  });

  it("resume({plan: 'nonexistent-slug'}) → err (bad input, distinct from 'no data yet')", async () => {
    const { sessionService } = makeServices();
    const result = await sessionService.resume({ plan: "plan-does-not-exist" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

describe("SessionService.resume — STATE: actor isolation", () => {
  it("resume({plan, by: 'alice'}) returns only alice's handoff, never bob's, regardless of recency", async () => {
    const { corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { type: "plan", title: "Shared Plan", content: "# Plan" } as CreateDocInput);

    const aliceHandoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["alice step"],
    });
    if (!aliceHandoff.ok) throw new Error(JSON.stringify(aliceHandoff.error));

    // bob writes AFTER alice — bob's is newer by wall clock.
    const bobHandoff = await sessionService.writeHandoff({
      by: "bob",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["bob step"],
    });
    if (!bobHandoff.ok) throw new Error(JSON.stringify(bobHandoff.error));

    const result = await sessionService.resume({ plan: plan.slug, by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.multi_actor).toBe(false);
    expect(result.value.handoff?.handoff_slug).toBe(aliceHandoff.value.slug);
    expect(result.value.handoff?.by).toBe("alice");
  });
});

describe("SessionService.resume — STATE: multi-actor surfacing", () => {
  it("resume({plan}) with by omitted and >1 actor → multi_actor: true, handoffs[] one per actor, handoff undefined", async () => {
    const { corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { type: "plan", title: "Multi Plan", content: "# Plan" } as CreateDocInput);

    const aliceHandoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["alice step"],
    });
    if (!aliceHandoff.ok) throw new Error(JSON.stringify(aliceHandoff.error));

    const bobHandoff = await sessionService.writeHandoff({
      by: "bob",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["bob step"],
    });
    if (!bobHandoff.ok) throw new Error(JSON.stringify(bobHandoff.error));

    const result = await sessionService.resume({ plan: plan.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.multi_actor).toBe(true);
    expect(result.value.handoff).toBeUndefined();
    expect(result.value.handoffs).toBeDefined();
    expect(result.value.handoffs).toHaveLength(2);
    const slugs = result.value.handoffs?.map((h) => h.handoff_slug).sort();
    expect(slugs).toEqual([aliceHandoff.value.slug, bobHandoff.value.slug].sort());
  });

  it("single-actor case: multi_actor: false, handoff (singular) present, handoffs (plural) absent", async () => {
    const { corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { type: "plan", title: "Single Actor Plan", content: "# Plan" } as CreateDocInput);

    const aliceHandoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["only alice"],
    });
    if (!aliceHandoff.ok) throw new Error(JSON.stringify(aliceHandoff.error));

    const result = await sessionService.resume({ plan: plan.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.multi_actor).toBe(false);
    expect(result.value.handoff?.handoff_slug).toBe(aliceHandoff.value.slug);
    expect(result.value.handoffs).toBeUndefined();
  });
});
