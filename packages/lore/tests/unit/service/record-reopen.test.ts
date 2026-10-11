/**
 * AC-DR-4 — `ReviewService.reopen` (the exit from a locked approved spec back to draft) and the
 * reopen-aware ever-approved lock fact, on InMemoryStore (no SQLite).
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D1, D5, D18).
 * Rules: BR-1050 (reopen only before evidence), BR-1054 (reopen race), BR-722 (demotion stays locked).
 *
 * Dimensions:
 *   HAPPY       approved spec, zero evidence, reason -> draft; ONE status version + ONE audit carrying the reason;
 *               approve -> reopen -> `set --content` succeeds with no correction
 *   NEGATIVE    evidence on an ad-hoc governed task -> refused naming 1; 3 evidence rows on a plan task -> refused
 *               naming 3; empty / whitespace reason -> err, no write; non-spec -> err naming the type
 *   BOUNDARY    CorpusService.set --status draft on an approved spec is still refused (VALID_TRANSITIONS unchanged)
 *   ERROR       draft spec (not approved) -> err
 *   STATE       approve -> reopen -> approve again -> locked again; non-reopen approved->draft demotion -> still locked
 *   RACE        evidence inserted between the status write and the recount -> spec stays draft, err names the
 *               evidence, nothing writes approved back
 */

import { describe, it, expect } from "vitest";
import type { CreateDocInput, DocRecord, LoreError } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";

function makeFixture() {
  const store = new InMemoryStore();
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  const corpus = new CorpusService(store, lock);
  const ac = new AcService(store, lock);
  const review = new ReviewService(store, lock);
  return { store, corpus, ac, review };
}
type Fixture = ReturnType<typeof makeFixture>;

async function mustCreate(corpus: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const created = await corpus.create(input);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

/** Status write plus its version row — the two facts the lock reads — without the approval gates. */
async function forceStatus(store: InMemoryStore, doc: DocRecord, status: DocRecord["status"]): Promise<DocRecord> {
  const current = await store.find(doc.id);
  if (!current.ok || current.value === null) throw new Error("fixture doc vanished");
  const nextVersion = current.value.version + 1;
  const updated = await store.update(doc.id, { status, version: nextVersion }, { expected_version: current.value.version });
  if (!updated.ok) throw new Error(`forceStatus failed: ${JSON.stringify(updated.error)}`);
  const inserted = await store.insertVersion({
    doc_id: doc.id,
    version: nextVersion,
    content: updated.value.content,
    extra: updated.value.extra,
    status,
    title: updated.value.title,
    action: "update",
    created_at: new Date().toISOString(),
    created_by: "tester",
    slug: updated.value.slug,
  });
  if (!inserted.ok) throw new Error("insertVersion failed");
  return updated.value;
}

async function approvedSpec(f: Fixture, title = "Reopen spec"): Promise<DocRecord> {
  const spec = await mustCreate(f.corpus, { type: "spec", title, content: "original body" });
  return forceStatus(f.store, spec, "approved");
}

async function addEvidence(store: InMemoryStore, taskId: string, count: number, acRef: string): Promise<void> {
  const before = await store.find(taskId);
  if (!before.ok || before.value === null) throw new Error("task fetch failed");
  const existing = Array.isArray(before.value.extra["verification_evidence"])
    ? (before.value.extra["verification_evidence"] as unknown[])
    : [];
  const rows = Array.from({ length: count }, () => ({
    oracle: "test",
    command: "bunx vitest run x.test.ts",
    result: "pass",
    recorded_at: new Date().toISOString(),
    recorded_by: "tester",
    ac_ref: acRef,
  }));
  const updated = await store.update(taskId, {
    extra: { ...before.value.extra, verification_evidence: [...existing, ...rows] },
  });
  if (!updated.ok) throw new Error("evidence write failed");
}

async function planTaskFor(f: Fixture, spec: DocRecord): Promise<DocRecord> {
  const plan = await mustCreate(f.corpus, { type: "plan", title: "Plan", parent_id: spec.id, content: "plan" });
  return mustCreate(f.corpus, {
    type: "task",
    title: "Plan task",
    parent_id: plan.id,
    content: "task",
    extra: { plan_id: plan.id },
  });
}

async function versions(store: InMemoryStore, id: string) {
  const r = await store.findVersions(id as DocRecord["id"], { limit: 1000 });
  if (!r.ok) throw new Error("findVersions failed");
  return r.value;
}

function messageOf(error: LoreError): string {
  return "message" in error ? String(error.message) : JSON.stringify(error);
}

describe("ReviewService.reopen (AC-DR-4)", () => {
  describe("HAPPY", () => {
    it("moves an approved spec with zero evidence to draft with one status version and one audit row carrying the reason", async () => {
      const f = makeFixture();
      const spec = await approvedSpec(f);
      const versionsBefore = (await versions(f.store, spec.id)).length;

      const result = await f.review.reopen(spec.slug, "scope changed before any work started");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("draft");
      const after = await versions(f.store, spec.id);
      expect(after.length).toBe(versionsBefore + 1);
      const audit = await f.store.queryAudit({ doc_id: spec.id });
      if (!audit.ok) throw new Error("audit failed");
      const reopenRows = audit.value.filter(
        (a) => (a.details as Record<string, unknown> | undefined)?.["operation"] === "reopen",
      );
      expect(reopenRows).toHaveLength(1);
      expect((reopenRows[0]?.details as Record<string, unknown>)["reason"]).toBe("scope changed before any work started");
    });

    it("approve -> reopen -> set --content succeeds without a correction", async () => {
      const f = makeFixture();
      const spec = await approvedSpec(f);
      const locked = await f.corpus.set(spec.slug, { content: "nope" });
      expect(locked.ok).toBe(false);

      const reopened = await f.review.reopen(spec.slug, "rework the body");
      expect(reopened.ok).toBe(true);

      const edited = await f.corpus.set(spec.slug, { content: "rewritten body" });
      expect(edited.ok).toBe(true);
    });
  });

  describe("NEGATIVE", () => {
    it("refuses naming 1 when evidence sits only on an ad-hoc governed task", async () => {
      const f = makeFixture();
      const spec = await mustCreate(f.corpus, { type: "spec", title: "Adhoc spec", content: "body" });
      await mustCreate(f.corpus, { type: "prd", title: "Root", content: "root" });
      const added = await f.ac.addCriterion(spec.id, {
        id: "AC-RO-1",
        statement: "Does the thing",
        verify: { mode: "script", oracle: "test", command: "bun test x" },
      });
      expect(added.ok).toBe(true);
      const adhoc = await mustCreate(f.corpus, {
        type: "task",
        title: "Adhoc",
        content: "found",
        extra: { adhoc: true, ac_scope: ["AC-RO-1"] },
      });
      await addEvidence(f.store, adhoc.id, 1, "AC-RO-1");
      await forceStatus(f.store, spec, "approved");

      const result = await f.review.reopen(spec.slug, "try");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(messageOf(result.error)).toMatch(/\b1 evidence/);
      const after = await f.store.find(spec.id);
      expect(after.ok && after.value?.status).toBe("approved");
    });

    it("refuses naming 3 when a plan task holds 3 evidence rows and writes nothing", async () => {
      const f = makeFixture();
      const spec = await approvedSpec(f);
      const task = await planTaskFor(f, spec);
      await addEvidence(f.store, task.id, 3, "AC-ANY");
      const versionsBefore = (await versions(f.store, spec.id)).length;

      const result = await f.review.reopen(spec.slug, "try");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(messageOf(result.error)).toMatch(/\b3 evidence/);
      expect((await versions(f.store, spec.id)).length).toBe(versionsBefore);
    });

    it.each(["", "   "])("refuses reason %j with no write", async (reason) => {
      const f = makeFixture();
      const spec = await approvedSpec(f);
      const versionsBefore = (await versions(f.store, spec.id)).length;

      const result = await f.review.reopen(spec.slug, reason);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((await versions(f.store, spec.id)).length).toBe(versionsBefore);
      const after = await f.store.find(spec.id);
      expect(after.ok && after.value?.status).toBe("approved");
    });

    it("refuses a non-spec naming the type", async () => {
      const f = makeFixture();
      const plan = await mustCreate(f.corpus, { type: "knowledge", title: "K", content: "k", extra: { sub_type: "reference" } });

      const result = await f.review.reopen(plan.slug, "why not");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(messageOf(result.error)).toContain("knowledge");
    });

    it("refuses a spec that is not approved", async () => {
      const f = makeFixture();
      const spec = await mustCreate(f.corpus, { type: "spec", title: "Draft spec", content: "b" });

      const result = await f.review.reopen(spec.slug, "nothing to reopen");

      expect(result.ok).toBe(false);
    });
  });

  describe("BOUNDARY", () => {
    it("CorpusService.set --status draft on an approved spec is still refused", async () => {
      const f = makeFixture();
      const spec = await approvedSpec(f);

      const result = await f.corpus.set(spec.slug, { status: "draft" });

      expect(result.ok).toBe(false);
      const after = await f.store.find(spec.id);
      expect(after.ok && after.value?.status).toBe("approved");
    });
  });

  describe("STATE — the reopen-aware lock fact", () => {
    it("approve -> reopen -> approve again -> locked again", async () => {
      const f = makeFixture();
      const spec = await approvedSpec(f);
      const reopened = await f.review.reopen(spec.slug, "rework");
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      await forceStatus(f.store, reopened.value, "approved");

      const result = await f.corpus.set(spec.slug, { content: "after re-approval" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
    });

    it("a non-reopen approved -> draft demotion (BR-722) does NOT unlock", async () => {
      const f = makeFixture();
      const spec = await approvedSpec(f);
      const current = await f.store.find(spec.id);
      if (!current.ok || current.value === null) throw new Error("vanished");
      await forceStatus(f.store, current.value, "draft");

      const lock = await new RecordLockService(f.store, new GateEnforcer(undefined)).resolve(
        (await f.store.find(spec.id) as { ok: true; value: DocRecord }).value,
      );

      expect(lock.ok).toBe(true);
      if (!lock.ok) return;
      expect(lock.value).toMatchObject({ standing: "record", locked: true });
    });
  });

  describe("RACE (BR-1054)", () => {
    it("evidence inserted after the status write leaves the spec draft, errs naming it, and never writes approved back", async () => {
      const f = makeFixture();
      const spec = await approvedSpec(f);
      const task = await planTaskFor(f, spec);

      const result = await f.review.reopen(spec.slug, "racing", {
        afterStatusWrite: async () => {
          await addEvidence(f.store, task.id, 1, "AC-ANY");
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(messageOf(result.error)).toMatch(/\b1 evidence/);
      const after = await f.store.find(spec.id);
      expect(after.ok && after.value?.status).toBe("draft");
      const all = await versions(f.store, spec.id);
      expect(all[all.length - 1]?.status).toBe("draft");
    });
  });
});
