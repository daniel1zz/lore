/**
 * Six-dimension tests for ValidityService.invalidate + CorpusService's D10
 * knowledge/adr writer guard (SPEC-043 §Design Decisions D2, D10), plus the
 * `task` eligibility widening from task-a-task-cannot-be-retracted-supersedes-
 * emits-a-repair (Defect 2). Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      invalidate writes invalid_at/reason, preserves sibling extra keys,
 *               bumps version, audits with details.version; supersededBy resolves a
 *               slug to a ULID; ADR convergence (superseded/deprecated); undo clears
 *               invalid_at/invalidated_by/reason; a TASK target is now eligible —
 *               extra.validity is set while doc.status is left UNTOUCHED (D5)
 *   NEGATIVE:   future invalid_at rejected at the service seam; undo on a
 *               never-invalidated doc; malformed validity rejected with the REAL
 *               issue (not a misleading generic message), both via `set` and via ADR
 *               `create`
 *   BOUNDARY:   re-invalidating keeps the ORIGINAL invalid_at while refreshing
 *               reason/invalidated_by (first signal wins); retracting an
 *               already-archived task surfaces `task_already_terminal`; retracting a
 *               task claimed by a DIFFERENT actor surfaces `task_claim_holder` — both
 *               NAMED, non-blocking (task-a-task-cannot-be-retracted... AC6)
 *   ERROR:      nonexistent target → DOC_NOT_FOUND; unresolvable supersededBy →
 *               DOC_NOT_FOUND naming the bad ref; a target OUTSIDE knowledge/adr/task
 *               (e.g. plan) → VALIDATION_ERROR naming all three allowed types
 *   STATE:      partial-failure recovery — a forced link-write failure still commits
 *               the doc half; re-running the SAME invalidate call repairs the
 *               missing link (idempotent)
 *   REGRESSION: a legacy doc with no validity round-trips `set`/`get` untouched (no
 *               phantom validity key introduced); D10 guard rejects a `set` patch
 *               that changes extra.validity, naming `lore invalidate`, while an
 *               identical (unchanged) validity patch is NOT rejected; undo on a task
 *               clears invalid_at exactly like a knowledge doc
 *
 * @spec_ref SPEC-043 AC-MH-2, AC-MH-3, AC-MH-4, AC-MH-10;
 *   task-a-task-cannot-be-retracted-supersedes-emits-a-repair
 */

import { describe, it, expect, vi } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ValidityService, type StalenessCalibrationPort } from "../../../src/service/validity-service.js";
import { err, ok } from "@lore/core";
import type { CreateDocInput, DocRecord, LinkRecord, LoreError, ReviewJudgment, Result } from "@lore/core";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const validityService = new ValidityService(store);
  return { store, corpusService, validityService };
}

async function createKnowledge(
  cs: CorpusService,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<DocRecord> {
  const result = await cs.create({
    type: "knowledge",
    title,
    content: "body",
    extra: { sub_type: "ideation", ...extra },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create knowledge doc: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createAdr(
  cs: CorpusService,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<DocRecord> {
  const result = await cs.create({
    type: "adr",
    title,
    content: "body",
    extra: { decision_status: "accepted", ...extra },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create adr doc: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPlan(cs: CorpusService, title = "Test Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Test Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** Wraps InMemoryStore, forcing `addLink` to fail its first N invocations (D2 partial-failure recipe). */
class FlakyLinkStore extends InMemoryStore {
  private addLinkCallCount = 0;
  constructor(private readonly failFirstN: number) {
    super();
  }
  override async addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
    this.addLinkCallCount += 1;
    if (this.addLinkCallCount <= this.failFirstN) {
      return err({ code: "STORE_ERROR", message: "forced addLink failure (test)" });
    }
    return super.addLink(link);
  }
}

// ─── HAPPY — invalidate ─────────────────────────────────────────────────────

describe("HAPPY — ValidityService.invalidate", () => {
  it("writes invalid_at/reason, preserves sibling extra keys, bumps version, audits with details.version", async () => {
    const { corpusService, validityService, store } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1", { sub_type: "retro" });
    const nowIso = "2026-06-01T00:00:00.000Z";

    const result = await validityService.invalidate(k1.id, { by: "alice", reason: "obsolete" }, () => nowIso);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.doc.extra["validity"]).toMatchObject({ invalid_at: nowIso, reason: "obsolete" });
    // sibling extra key preserved verbatim
    expect(result.value.doc.extra["sub_type"]).toBe("retro");
    expect(result.value.doc.version).toBe(k1.version + 1);

    const auditResult = await store.queryAudit({ doc_id: k1.id, action: "invalidate" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value.length).toBe(1);
    expect(auditResult.value[0]?.details?.["version"]).toBe(k1.version + 1);
  });

  it("resolves a slug-supplied supersededBy to its ULID (never persists the raw slug)", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1 old");
    const k2 = await createKnowledge(corpusService, "K2 new");

    const result = await validityService.invalidate(k1.id, { by: "alice", supersededBy: k2.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validity = result.value.doc.extra["validity"] as { invalidated_by?: string };
    expect(validity.invalidated_by).toBe(k2.id);
    expect(validity.invalidated_by).not.toBe(k2.slug);
  });

  it("ADR convergence WITH supersededBy: superseded + superseded_by + supersedes link", async () => {
    const { corpusService, validityService, store } = makeServices();
    const a1 = await createAdr(corpusService, "A1 old");
    const a2 = await createAdr(corpusService, "A2 new");

    const result = await validityService.invalidate(a1.id, { by: "alice", supersededBy: a2.slug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc.extra["decision_status"]).toBe("superseded");
    expect(result.value.doc.extra["superseded_by"]).toBe(a2.id);

    const linksResult = await store.findLinks(a2.id, "out");
    expect(linksResult.ok).toBe(true);
    if (!linksResult.ok) return;
    expect(linksResult.value.some((l) => l.link_type === "supersedes" && l.to_id === a1.id)).toBe(true);
  });

  it("ADR convergence WITHOUT supersededBy: deprecated, no link", async () => {
    const { corpusService, validityService, store } = makeServices();
    const a3 = await createAdr(corpusService, "A3");

    const result = await validityService.invalidate(a3.id, { by: "alice", reason: "no longer relevant" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc.extra["decision_status"]).toBe("deprecated");
    expect(result.value.doc.extra["superseded_by"]).toBeUndefined();

    const allLinksResult = await store.findLinks(a3.id, "in");
    expect(allLinksResult.ok).toBe(true);
    if (!allLinksResult.ok) return;
    expect(allLinksResult.value.some((l) => l.link_type === "supersedes")).toBe(false);
  });

  // Fix2 (decision_status/invalidated_by consistency, MINOR): a reason-only
  // re-invalidate call must NOT flip decision_status to "deprecated" while
  // invalidated_by is still "first signal wins"-preserved at a prior call's
  // successor — that combination made the persisted document self-contradict
  // (banner says "superseded by X", decision_status says "deprecated").
  it("ADR convergence stays consistent across calls: call2 (reason-only) keeps decision_status='superseded' set by call1's supersededBy", async () => {
    const { corpusService, validityService } = makeServices();
    const a1 = await createAdr(corpusService, "A1 old");
    const a2 = await createAdr(corpusService, "A2 new");

    const call1 = await validityService.invalidate(a1.id, { by: "alice", supersededBy: a2.slug });
    expect(call1.ok).toBe(true);
    if (!call1.ok) return;
    expect(call1.value.doc.extra["decision_status"]).toBe("superseded");
    expect(call1.value.doc.extra["superseded_by"]).toBe(a2.id);

    const call2 = await validityService.invalidate(a1.id, { by: "bob", reason: "confirmed still stale" });
    expect(call2.ok).toBe(true);
    if (!call2.ok) return;

    // The banner (lore get / export-docs / feed) renders off extra.validity.invalidated_by
    // alone — it must stay in lockstep with decision_status, never contradict it.
    const validity = call2.value.doc.extra["validity"] as Record<string, unknown> | undefined;
    expect(validity?.["invalidated_by"]).toBe(a2.id);
    expect(call2.value.doc.extra["decision_status"]).toBe("superseded");
    expect(call2.value.doc.extra["superseded_by"]).toBe(a2.id);
  });

  it("undo clears invalid_at/invalidated_by/reason and bumps version", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    const invalidated = await validityService.invalidate(k1.id, { by: "alice", reason: "obsolete" });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;

    const undone = await validityService.invalidate(k1.id, { by: "alice", undo: true });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const validity = undone.value.doc.extra["validity"] as Record<string, unknown> | undefined;
    expect(validity?.["invalid_at"]).toBeUndefined();
    expect(validity?.["invalidated_by"]).toBeUndefined();
    expect(validity?.["reason"]).toBeUndefined();
    expect(undone.value.doc.version).toBe(invalidated.value.doc.version + 1);
  });

  it("undo on an ADR keeps decision_status='superseded' AND surfaces decision_status_unchanged", async () => {
    const { corpusService, validityService } = makeServices();
    const a1 = await createAdr(corpusService, "A1");
    const a2 = await createAdr(corpusService, "A2");
    const invalidated = await validityService.invalidate(a1.id, { by: "alice", supersededBy: a2.slug });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;

    const undone = await validityService.invalidate(a1.id, { by: "alice", undo: true });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.value.doc.extra["decision_status"]).toBe("superseded");
    expect(undone.value.decision_status_unchanged).toBe("superseded");
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — ValidityService.invalidate", () => {
  it("rejects a future invalid_at at the service seam", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    const nowIso = "2026-06-01T00:00:00.000Z";
    const futureInvalidAt = "2026-12-01T00:00:00.000Z";

    const result = await validityService.invalidate(
      k1.id,
      { by: "alice", invalidAt: futureInvalidAt },
      () => nowIso,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("invalid_at");
  });

  it("undo on a never-invalidated doc → VALIDATION_ERROR", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");

    const result = await validityService.invalidate(k1.id, { by: "alice", undo: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── BOUNDARY — first signal wins ───────────────────────────────────────────

describe("BOUNDARY — re-invalidate keeps ORIGINAL invalid_at, refreshes reason/invalidated_by", () => {
  it("first signal wins for invalid_at; reason/invalidated_by refresh on re-invalidate", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    const succ1 = await createKnowledge(corpusService, "Successor 1");
    const succ2 = await createKnowledge(corpusService, "Successor 2");
    const firstNow = "2026-06-01T00:00:00.000Z";
    const secondNow = "2026-07-01T00:00:00.000Z";

    const first = await validityService.invalidate(
      k1.id,
      { by: "alice", supersededBy: succ1.slug, reason: "first" },
      () => firstNow,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await validityService.invalidate(
      k1.id,
      { by: "bob", supersededBy: succ2.slug, reason: "second" },
      () => secondNow,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const validity = second.value.doc.extra["validity"] as Record<string, unknown>;
    expect(validity["invalid_at"]).toBe(firstNow); // original wins
    expect(validity["reason"]).toBe("second"); // refreshed
    expect(validity["invalidated_by"]).toBe(succ2.id); // refreshed
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR — ValidityService.invalidate", () => {
  it("nonexistent target → DOC_NOT_FOUND", async () => {
    const { validityService } = makeServices();
    const result = await validityService.invalidate("01HNONEXISTENTID0000000000", { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("unresolvable supersededBy → DOC_NOT_FOUND naming the bad ref", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    const result = await validityService.invalidate(k1.id, {
      by: "alice",
      supersededBy: "knowledge-does-not-exist",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
    if (result.error.code !== "DOC_NOT_FOUND") return;
    expect(result.error.id).toBe("knowledge-does-not-exist");
  });

  // reason: `task` became a THIRD eligible type (task-a-task-cannot-be-
  // retracted-supersedes-emits-a-repair, Defect 2) — this negative case now
  // targets a `plan`, which stays genuinely ineligible, rather than a task.
  it("target OUTSIDE knowledge/adr/task (e.g. plan) → VALIDATION_ERROR naming all allowed types", async () => {
    const { corpusService, validityService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await validityService.invalidate(planId, { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toMatch(/knowledge/);
    expect(result.error.message).toMatch(/adr/);
    expect(result.error.message).toMatch(/task/);
  });
});

// ─── Defect 2 — task retraction (task-a-task-cannot-be-retracted-supersedes-
// emits-a-repair): ValidityService.invalidate now accepts `task` ────────────

describe("HAPPY — ValidityService.invalidate on a task (Defect 2)", () => {
  it("invalidates a draft task: extra.validity is set, doc.status is left UNTOUCHED (D5)", async () => {
    const { corpusService, validityService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Wrong task");
    const replacementId = await createTask(corpusService, planId, "Correct task");

    const result = await validityService.invalidate(taskId, {
      by: "alice",
      supersededBy: replacementId,
      reason: "diagnosed backwards",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.doc.extra["validity"]).toMatchObject({
      invalidated_by: replacementId,
      reason: "diagnosed backwards",
    });
    // D5 — retraction never touches the workflow lifecycle field.
    expect(result.value.doc.status).toBe("draft");
    // No ADR-only side effect leaks onto a task.
    expect(result.value.doc.extra["decision_status"]).toBeUndefined();
  });

  it("undo on a task clears invalid_at/invalidated_by/reason exactly like a knowledge doc", async () => {
    const { corpusService, validityService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const invalidated = await validityService.invalidate(taskId, { by: "alice", reason: "wrong" });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;

    const undone = await validityService.invalidate(taskId, { by: "alice", undo: true });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const validity = undone.value.doc.extra["validity"] as Record<string, unknown> | undefined;
    expect(validity?.["invalid_at"]).toBeUndefined();
    expect(undone.value.doc.status).toBe("draft");
  });
});

// ─── BOUNDARY (AC6) — named, non-blocking outcomes ─────────────────────────

describe("BOUNDARY — retracting an already-terminal task / a task claimed by another actor (AC6)", () => {
  it("retracting an already-archived task surfaces task_already_terminal and still succeeds", async () => {
    const { corpusService, validityService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // Force the task straight to archived (bypassing the normal done() walk —
    // this test only cares about ValidityService's read of the prior status).
    const before = await store.find(taskId);
    if (!before.ok || before.value === null) throw new Error("setup failed");
    const forced = await store.update(taskId, { status: "archived", version: before.value.version + 1 }, {
      expected_version: before.value.version,
    });
    if (!forced.ok) throw new Error("setup failed");

    const result = await validityService.invalidate(taskId, { by: "alice", reason: "retracted after close" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task_already_terminal).toBe("archived");
    // Retraction still applies — never blocked by terminal status (D5).
    expect(result.value.doc.extra["validity"]).toMatchObject({ invalid_at: expect.any(String) });
    // Status itself is untouched by the retraction.
    expect(result.value.doc.status).toBe("archived");
  });

  it("retracting a task carrying a claim held by a DIFFERENT actor surfaces task_claim_holder and still succeeds", async () => {
    const { corpusService, validityService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const before = await store.find(taskId);
    if (!before.ok || before.value === null) throw new Error("setup failed");
    const claimed = await store.update(
      taskId,
      { extra: { ...before.value.extra, claim: { by: "bob", at: "2026-07-01T00:00:00.000Z" } }, version: before.value.version + 1 },
      { expected_version: before.value.version },
    );
    if (!claimed.ok) throw new Error("setup failed");

    const result = await validityService.invalidate(taskId, { by: "alice", reason: "wrong turn" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task_claim_holder).toBe("bob");
    expect(result.value.task_already_terminal).toBeUndefined();
  });

  it("retracting a task the SAME actor holds a claim on does NOT surface task_claim_holder", async () => {
    const { corpusService, validityService, store } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const before = await store.find(taskId);
    if (!before.ok || before.value === null) throw new Error("setup failed");
    const claimed = await store.update(
      taskId,
      { extra: { ...before.value.extra, claim: { by: "alice", at: "2026-07-01T00:00:00.000Z" } }, version: before.value.version + 1 },
      { expected_version: before.value.version },
    );
    if (!claimed.ok) throw new Error("setup failed");

    const result = await validityService.invalidate(taskId, { by: "alice", reason: "self-caught mistake" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task_claim_holder).toBeUndefined();
  });

  it("a knowledge doc never carries either task-scoped advisory", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");

    const result = await validityService.invalidate(k1.id, { by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task_already_terminal).toBeUndefined();
    expect(result.value.task_claim_holder).toBeUndefined();
  });
});

// ─── STATE — partial-failure recovery (D2 idempotent link repair) ──────────

describe("STATE — partial-failure recovery: doc half committed, re-run repairs the missing link", () => {
  it("a forced addLink failure still commits the doc half; re-running the SAME invalidate repairs the link", async () => {
    const store = new FlakyLinkStore(1);
    const corpusService = new CorpusService(store);
    const validityService = new ValidityService(store);

    const a1CreateResult = await corpusService.create({
      type: "adr",
      title: "A1 old",
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    if (!a1CreateResult.ok) throw new Error("setup failed");
    const a1 = a1CreateResult.value;
    const a2CreateResult = await corpusService.create({
      type: "adr",
      title: "A2 new",
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    if (!a2CreateResult.ok) throw new Error("setup failed");
    const a2 = a2CreateResult.value;

    const nowIso = "2026-06-01T00:00:00.000Z";
    const firstAttempt = await validityService.invalidate(
      a1.id,
      { by: "alice", supersededBy: a2.slug },
      () => nowIso,
    );
    // The link write was forced to fail — the overall call reports the error...
    expect(firstAttempt.ok).toBe(false);

    // ...but the doc half (validity + decision_status) is ALREADY committed.
    const afterFirstAttempt = await store.find(a1.id);
    expect(afterFirstAttempt.ok).toBe(true);
    if (!afterFirstAttempt.ok || afterFirstAttempt.value === null) return;
    expect(afterFirstAttempt.value.extra["decision_status"]).toBe("superseded");
    expect((afterFirstAttempt.value.extra["validity"] as Record<string, unknown>)["invalid_at"]).toBe(nowIso);

    // No link exists yet.
    const linksAfterFirst = await store.findLinks(a2.id, "out");
    expect(linksAfterFirst.ok).toBe(true);
    if (linksAfterFirst.ok) {
      expect(linksAfterFirst.value.some((l) => l.link_type === "supersedes")).toBe(false);
    }

    // Re-running the SAME invalidate call repairs the missing link (idempotent) — the
    // invalid_at instant is unchanged (first signal wins) even under a later "now".
    const laterNow = "2026-08-01T00:00:00.000Z";
    const secondAttempt = await validityService.invalidate(
      a1.id,
      { by: "alice", supersededBy: a2.slug },
      () => laterNow,
    );
    expect(secondAttempt.ok).toBe(true);
    if (!secondAttempt.ok) return;
    expect((secondAttempt.value.doc.extra["validity"] as Record<string, unknown>)["invalid_at"]).toBe(nowIso);

    const linksAfterSecond = await store.findLinks(a2.id, "out");
    expect(linksAfterSecond.ok).toBe(true);
    if (!linksAfterSecond.ok) return;
    expect(linksAfterSecond.value.some((l) => l.link_type === "supersedes" && l.to_id === a1.id)).toBe(true);
  });
});

// ─── REGRESSION — legacy round-trip + D10 writer guard ─────────────────────

describe("REGRESSION — legacy doc round-trips untouched; D10 CorpusService.set writer guard", () => {
  it("a legacy doc with no validity round-trips set/get with no phantom validity key introduced", async () => {
    const { corpusService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    expect(k1.extra["validity"]).toBeUndefined();

    const setResult = await corpusService.set(k1.id, { title: "K1 renamed" });
    expect(setResult.ok).toBe(true);
    if (!setResult.ok) return;
    expect(setResult.value.extra["validity"]).toBeUndefined();

    const getResult = await corpusService.get(k1.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.doc.extra["validity"]).toBeUndefined();
  });

  it("D10 guard: a set patch CHANGING extra.validity is rejected, naming `lore invalidate`", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    const invalidated = await validityService.invalidate(k1.id, { by: "alice", reason: "obsolete" });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;
    const doc = invalidated.value.doc;

    const changedExtra = {
      ...doc.extra,
      validity: { ...(doc.extra["validity"] as Record<string, unknown>), reason: "changed via set" },
    };
    const result = await corpusService.set(k1.id, { extra: changedExtra });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("extra.validity");
    expect(result.error.message).toMatch(/lore invalidate/);
  });

  it("D10 guard does NOT reject a set patch whose extra.validity is UNCHANGED", async () => {
    const { corpusService, validityService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");
    const invalidated = await validityService.invalidate(k1.id, { by: "alice", reason: "obsolete" });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;
    const doc = invalidated.value.doc;

    // Same extra (including the SAME validity object) — only a title change intent,
    // but set() replaces extra wholesale so the caller must resupply it unchanged.
    const result = await corpusService.set(k1.id, { title: "K1 renamed again", extra: doc.extra });
    expect(result.ok).toBe(true);
  });

  it("malformed validity via set is rejected with the REAL issue message (not the guard message)", async () => {
    const { corpusService } = makeServices();
    const k1 = await createKnowledge(corpusService, "K1");

    const result = await corpusService.set(k1.id, {
      extra: { ...k1.extra, validity: { valid_at: "2026-06-01T00:00:00.000Z", invalid_at: "2020-01-01T00:00:00.000Z" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toMatch(/invalid_at/);
    expect(result.error.message).not.toMatch(/lore invalidate/);
  });

  it("D10/S1 REGRESSION: ADR create with valid decision_status + malformed validity reports the validity issue", async () => {
    const { corpusService } = makeServices();
    const result = await corpusService.create({
      type: "adr",
      title: "Bad validity ADR",
      content: "body",
      extra: {
        decision_status: "accepted",
        validity: { valid_at: "2026-06-01T00:00:00.000Z", invalid_at: "2020-01-01T00:00:00.000Z" },
      },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toMatch(/invalid_at/);
    expect(result.error.message).not.toMatch(/requires extra\.decision_status/);
  });
});

// ─── AC-SP-9 — SPEC-044 D12: optional stalenessCalibration port ────────────
//
// Six-dimension coverage for this block:
//   HAPPY:      a wired port + a latest 'escalate' (stale_candidate) staleness
//               judgment -> invalidate writes ONE calibration record FK'd to that
//               judgment, humanOutcome='confirmed'
//   NEGATIVE:   n/a beyond the "no prior probe" / "holds never" skip cases (STATE below)
//   BOUNDARY:   n/a — the port is a boolean present/absent DI switch, no numeric edges
//   ERROR:      n/a — the fake port here never returns err(); a real store failure
//               would propagate via the same Result-chain every other write does
//               (already covered generically elsewhere in this file)
//   STATE:      no prior probe (latestStalenessJudgment returns null) -> zero calls;
//               a 'holds' (decision='approve') latest staleness judgment -> zero calls
//               (D12 — "no observable outcome for holds"); --undo never triggers a
//               calibration write even when a wired port + an escalate judgment exist
//   REGRESSION: bare `new ValidityService(store)` (no port) writes NONE and does not
//               error — invalidate succeeds exactly as it did before SPEC-044

describe("AC-SP-9 — ValidityService optional stalenessCalibration port (SPEC-044 D12)", () => {
  function makeStalenessJudgment(overrides: Partial<ReviewJudgment> = {}): ReviewJudgment {
    return {
      id: "01ARZ3STALEJUDGMENT0001",
      doc_id: "01ARZ3DOCUNDERPROBE0001",
      doc_version: 1,
      decision: "escalate",
      confidence: 0.7,
      reasons: [{ dimension: "staleness", finding: "linked API changed" }],
      checks: [],
      blocking_questions: ["still true?"],
      kind: "staleness",
      judge: { provider: "p", model: "m", prompt_version: "v1" },
      created_at: "2026-07-01T00:00:00.000Z",
      created_by: "ai:p:m:v1",
      ...overrides,
    };
  }

  function makeFakePort(judgment: ReviewJudgment | null): {
    port: StalenessCalibrationPort;
    recordCalibrationCalls: unknown[];
  } {
    const recordCalibrationCalls: unknown[] = [];
    const port: StalenessCalibrationPort = {
      latestStalenessJudgment: vi.fn(async () => ok(judgment)),
      recordCalibration: vi.fn(async (input) => {
        recordCalibrationCalls.push(input);
        return ok({ recorded: true });
      }),
    };
    return { port, recordCalibrationCalls };
  }

  it("HAPPY: wired port + latest 'escalate' staleness judgment -> invalidate writes ONE calibration record FK'd to that judgment", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const k1 = await createKnowledge(corpusService, "K1 staleness-flagged");
    const judgment = makeStalenessJudgment({ doc_id: k1.id, doc_version: k1.version });
    const { port, recordCalibrationCalls } = makeFakePort(judgment);
    const validityService = new ValidityService(store, undefined, port);

    const result = await validityService.invalidate(k1.id, { by: "alice", reason: "confirmed stale" });
    expect(result.ok).toBe(true);

    expect(recordCalibrationCalls).toHaveLength(1);
    const call = recordCalibrationCalls[0] as {
      judgment: ReviewJudgment;
      docType: string;
      humanOutcome: string;
      actor: string;
    };
    expect(call.judgment.id).toBe(judgment.id);
    expect(call.docType).toBe("knowledge");
    expect(call.humanOutcome).toBe("confirmed");
    expect(call.actor).toBe("alice");
  });

  it("STATE: no prior probe (latestStalenessJudgment returns null) -> recordCalibration is never called", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const k1 = await createKnowledge(corpusService, "K1 never probed");
    const { port, recordCalibrationCalls } = makeFakePort(null);
    const validityService = new ValidityService(store, undefined, port);

    const result = await validityService.invalidate(k1.id, { by: "alice", reason: "just because" });
    expect(result.ok).toBe(true);
    expect(recordCalibrationCalls).toHaveLength(0);
  });

  it("STATE: a 'holds' (decision='approve') latest staleness judgment -> recordCalibration is never called (D12 — no observable outcome for holds)", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const k1 = await createKnowledge(corpusService, "K1 holds verdict");
    const holdsJudgment = makeStalenessJudgment({ doc_id: k1.id, doc_version: k1.version, decision: "approve" });
    const { port, recordCalibrationCalls } = makeFakePort(holdsJudgment);
    const validityService = new ValidityService(store, undefined, port);

    const result = await validityService.invalidate(k1.id, { by: "alice", reason: "invalidating anyway" });
    expect(result.ok).toBe(true);
    expect(recordCalibrationCalls).toHaveLength(0);
  });

  it("STATE: --undo never triggers a calibration write, even with a wired port + an escalate judgment", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const k1 = await createKnowledge(corpusService, "K1 undo case");

    // First invalidate (no port wired) to set up an undo-able state.
    const bareValidityService = new ValidityService(store);
    const invalidated = await bareValidityService.invalidate(k1.id, { by: "alice", reason: "temp" });
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) return;

    const judgment = makeStalenessJudgment({ doc_id: k1.id, doc_version: invalidated.value.doc.version });
    const { port, recordCalibrationCalls } = makeFakePort(judgment);
    const wiredValidityService = new ValidityService(store, undefined, port);

    const undoResult = await wiredValidityService.invalidate(k1.id, { by: "alice", undo: true });
    expect(undoResult.ok).toBe(true);
    expect(recordCalibrationCalls).toHaveLength(0);
  });

  it("REGRESSION: bare `new ValidityService(store)` (no port) writes NONE and does not error", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const k1 = await createKnowledge(corpusService, "K1 bare construction");
    const validityService = new ValidityService(store); // no telemetry, no port — mirrors every pre-SPEC-044 test in this file

    const result = await validityService.invalidate(k1.id, { by: "alice", reason: "no port wired" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc.extra["validity"]).toMatchObject({ reason: "no port wired" });
  });
});
