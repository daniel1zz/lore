/**
 * AC-DR-2 — `CorpusService.set` and the `record-edit` gate, on InMemoryStore (no SQLite).
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D1, D4, D10, D11, D13-D15).
 * Rules: BR-1047 (lock point), BR-1048 (refusal), BR-1049 (correction), BR-1053 (one gate knob),
 * BR-722 (demotion, narrowed to unlocked docs).
 *
 * Dimensions:
 *   HAPPY       draft spec, baseline and open plan edit in place; correction on a locked retro writes ONE
 *               version, keeps status approved, records the reason in change_summary and audit
 *   NEGATIVE    approved spec body edit, title-only edit, extra.sub_type flip on an approved retro,
 *               archived plan edit, claimed-then-released task edit — all refused, version count unchanged
 *   BOUNDARY    identical content + new tag on a locked spec succeeds and stays approved (difference
 *               trigger, D14); draft-then-deprecated spec and never-claimed archived task are not locked;
 *               a task whose only claim was rolled back by its own failed write is editable (D10)
 *   ERROR       empty / whitespace correction reason -> err, nothing written; correction + status -> err
 *   STATE       gate disabled -> BR-722 demotion and exactly one config_disabled skip audit naming the doc
 *   REGRESSION  claim/evidence-shaped metadata writes on a locked record are not refused (tags, priority)
 */

import { describe, it, expect } from "vitest";
import { LoreConfigSchema, type CreateDocInput, type DocRecord, type LoreError } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
interface Fixture {
  readonly store: InMemoryStore;
  readonly service: CorpusService;
}

/** `ledgerAutoApprove: true` is the production default — needed so a retro edit would write TWO versions without the correction exit. */
function makeFixture(gateEnforcer?: GateEnforcer): Fixture {
  const store = actedStore(new InMemoryStore());
  const lock = new RecordLockService(store, gateEnforcer ?? new GateEnforcer(undefined));
  const service = new CorpusService(store, lock, undefined, undefined, undefined, undefined, true);
  return { store, service };
}

async function mustCreate(service: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const created = await service.create(input);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

async function mustSet(
  service: CorpusService,
  slug: string,
  patch: Parameters<CorpusService["set"]>[1],
  opts?: Parameters<CorpusService["set"]>[2],
): Promise<DocRecord> {
  const result = await service.set(slug, patch, opts);
  if (!result.ok) throw new Error(`set failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * Moves `doc` to `status` the way an approval does at the store level — status write plus the version
 * row that records it — WITHOUT the approval gates (BR-1007 citation, spec-promote), which this suite
 * does not exercise. The lock reads exactly these two facts (current status, version history).
 */
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

async function approvedSpec(store: InMemoryStore, service: CorpusService, title = "Locked spec"): Promise<DocRecord> {
  const spec = await mustCreate(service, { type: "spec", title, content: "original body" });
  return forceStatus(store, spec, "approved");
}

async function approvedRetro(store: InMemoryStore, service: CorpusService): Promise<DocRecord> {
  const retro = await mustCreate(service, {
    parent_id: await ensureRequirementsDocId(service), type: "knowledge",
    title: "A retro",
    content: "what happened",
    extra: { sub_type: "retro" },
  });
  // Ledger kinds fast-track to approved at create when ledgerAutoApprove is on; make it explicit either way.
  return retro.status === "approved" ? retro : forceStatus(store, retro, "approved");
}

async function versionCount(store: InMemoryStore, docId: string): Promise<number> {
  const versions = await store.findVersions(docId as DocRecord["id"], { limit: 1000 });
  if (!versions.ok) throw new Error("findVersions failed");
  return versions.value.length;
}

function expectRecordEditRefusal(error: LoreError): void {
  expect(error.code).toBe("VALIDATION_ERROR");
  if (error.code !== "VALIDATION_ERROR") return;
  expect(error.field).toBe("gate:record-edit");
  expect(error.message).toContain("locked record");
}

describe("record-edit gate on CorpusService.set (AC-DR-2)", () => {
  describe("NEGATIVE — a locked record is not rewritten", () => {
    it("refuses a body edit on an approved spec and writes no version", async () => {
      const { store, service } = makeFixture();
      const spec = await approvedSpec(store, service);
      const before = await versionCount(store, spec.id);

      const result = await service.set(spec.slug, { content: "rewritten body" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expectRecordEditRefusal(result.error);
      expect(await versionCount(store, spec.id)).toBe(before);
      const after = await store.find(spec.id);
      expect(after.ok && after.value?.content).toBe("original body\n");
      expect(after.ok && after.value?.status).toBe("approved");
    });

    it("refuses a title-only edit on an approved spec", async () => {
      const { store, service } = makeFixture();
      const spec = await approvedSpec(store, service);
      const before = await versionCount(store, spec.id);

      const result = await service.set(spec.slug, { title: "A different title" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expectRecordEditRefusal(result.error);
      expect(await versionCount(store, spec.id)).toBe(before);
    });

    it("refuses an extra.sub_type flip on an approved retro (D13: retro -> reference would unlock it)", async () => {
      const { store, service } = makeFixture();
      const retro = await approvedRetro(store, service);
      const before = await versionCount(store, retro.id);

      const result = await service.set(retro.slug, { extra: { sub_type: "reference" } });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expectRecordEditRefusal(result.error);
      expect(result.error.code === "VALIDATION_ERROR" && result.error.message).toContain("sub_type");
      expect(await versionCount(store, retro.id)).toBe(before);
    });

    it("names the sanctioned change paths and advertises the reopen exit for a spec (D5/D18)", async () => {
      const { store, service } = makeFixture();
      const spec = await approvedSpec(store, service);

      const result = await service.set(spec.slug, { content: "rewritten body" });

      expect(result.ok).toBe(false);
      if (result.ok || result.error.code !== "VALIDATION_ERROR") return;
      expect(result.error.message).toContain("--correction");
      expect(result.error.message).toContain("relates-to");
      expect(result.error.message).toContain("lore reopen");
      expect(result.error.message).toContain("when it has no evidence");
    });

    it("refuses an edit on an archived plan", async () => {
      const { store, service } = makeFixture();
      const prd = await mustCreate(service, { type: "prd", title: "Root", content: "root" });
      const plan = await mustCreate(service, { type: "plan", title: "Closed plan", parent_id: prd.id, content: "p" });
      await mustSet(service, plan.slug, { status: "approved" });
      await mustSet(service, plan.slug, { status: "active" });
      await mustSet(service, plan.slug, { status: "archived" });
      const before = await versionCount(store, plan.id);

      const result = await service.set(plan.slug, { content: "late rewrite" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expectRecordEditRefusal(result.error);
      expect(await versionCount(store, plan.id)).toBe(before);
    });

    it("refuses an edit on a claimed-then-released task (D1: a released task was executed)", async () => {
      const { store, service } = makeFixture();
      const task = await adhocTask(service);
      await appendClaimAudit(store, task.id);
      await appendReleaseAudit(store, task.id, false);
      const before = await versionCount(store, task.id);

      const result = await service.set(task.slug, { content: "rewritten task" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expectRecordEditRefusal(result.error);
      expect(await versionCount(store, task.id)).toBe(before);
    });
  });

  describe("BOUNDARY — only a difference triggers, only a settled record locks", () => {
    it("accepts identical content plus a new tag on a locked spec and keeps it approved (D14)", async () => {
      const { store, service } = makeFixture();
      const spec = await approvedSpec(store, service);

      const result = await service.set(spec.slug, { content: "original body", tags: ["dashboard-save"] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tags).toEqual(["dashboard-save"]);
      expect(result.value.status).toBe("approved");
    });

    it("accepts a priority-only edit on a locked spec", async () => {
      const { store, service } = makeFixture();
      const spec = await approvedSpec(store, service);

      const result = await service.set(spec.slug, { priority: "high" });

      expect(result.ok).toBe(true);
    });

    it("does not lock a draft-then-deprecated spec (never approved)", async () => {
      const { store, service } = makeFixture();
      const spec = await mustCreate(service, { type: "spec", title: "Abandoned", content: "x" });
      await forceStatus(store, spec, "deprecated");

      const result = await service.set(spec.slug, { content: "tidy up" });

      expect(result.ok).toBe(true);
    });

    it("locks a spec that is draft again but was approved earlier (version history, not current status)", async () => {
      const { store, service } = makeFixture();
      const spec = await approvedSpec(store, service);
      await forceStatus(store, spec, "draft");

      const result = await service.set(spec.slug, { content: "rewrite after a demotion" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expectRecordEditRefusal(result.error);
    });

    it("does not lock a never-claimed task, even an archived one", async () => {
      const { service } = makeFixture();
      const task = await adhocTask(service);
      await mustSet(service, task.slug, { status: "approved" });
      await mustSet(service, task.slug, { status: "active" });
      await mustSet(service, task.slug, { status: "archived" });

      const result = await service.set(task.slug, { content: "archived by cascade, never claimed" });

      expect(result.ok).toBe(true);
    });

    it("treats a task whose only claim was rolled back by its own failed write as editable (D10)", async () => {
      const { store, service } = makeFixture();
      const task = await adhocTask(service);
      // The shape TaskWorkflowService._claimImpl leaves behind: the claim audit row stays, and
      // rollbackClaim appends ONE release row carrying details.rollback === true.
      await appendClaimAudit(store, task.id);
      await appendReleaseAudit(store, task.id, true);

      const result = await service.set(task.slug, { content: "still a plan, never executed" });

      expect(result.ok).toBe(true);
    });

    it("locks a task claimed again after an earlier claim was rolled back", async () => {
      const { store, service } = makeFixture();
      const task = await adhocTask(service);
      await appendClaimAudit(store, task.id);
      await appendReleaseAudit(store, task.id, true);
      await appendClaimAudit(store, task.id);

      const result = await service.set(task.slug, { content: "rewrite" });

      expect(result.ok).toBe(false);
    });
  });

  describe("HAPPY — living documents and unsettled records edit in place", () => {
    it("edits a draft spec", async () => {
      const { service } = makeFixture();
      const spec = await mustCreate(service, { type: "spec", title: "Draft", content: "v1" });

      const result = await service.set(spec.slug, { content: "v2" });

      expect(result.ok).toBe(true);
    });

    it("edits a prd (living, always editable)", async () => {
      const { service } = makeFixture();
      const prd = await mustCreate(service, { type: "prd", title: "Living PRD", content: "v1" });
      await mustSet(service, prd.slug, { status: "approved" });

      const result = await service.set(prd.slug, { content: "v2" });

      expect(result.ok).toBe(true);
    });

    it("edits an open approved plan (D3) — BR-722 demotion still applies to it", async () => {
      const { service } = makeFixture();
      const prd = await mustCreate(service, { type: "prd", title: "Root", content: "root" });
      const plan = await mustCreate(service, { type: "plan", title: "Open plan", parent_id: prd.id, content: "p1" });
      await mustSet(service, plan.slug, { status: "approved" });

      const result = await service.set(plan.slug, { content: "p2" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("draft");
    });
  });

  describe("HAPPY — the correction exit (D15)", () => {
    it("writes exactly ONE version on a locked retro, keeps it approved, and records the reason", async () => {
      const { store, service } = makeFixture();
      const retro = await approvedRetro(store, service);
      const before = await versionCount(store, retro.id);

      const result = await service.set(retro.slug, { content: "what happened, typo fixed" }, {
        correction: { reason: "typo" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("approved");
      expect(result.value.content).toContain("typo fixed");
      // ONE version: no BR-722 demotion write and no ledger re-approve second write.
      expect(await versionCount(store, retro.id)).toBe(before + 1);
      const versions = await store.findVersions(retro.id, { limit: 1000 });
      expect(versions.ok).toBe(true);
      if (!versions.ok) return;
      const newest = versions.value[0];
      expect(newest?.status).toBe("approved");
      expect(newest?.change_summary).toContain("typo");
      const audit = await store.queryAudit({ doc_id: retro.id, action: "update" });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(JSON.stringify(audit.value[0]?.details)).toContain("typo");
      expect(JSON.stringify(audit.value[0]?.details)).toContain("correction");
    });

    it("lets a correction fix a locked spec's body without demoting it", async () => {
      const { store, service } = makeFixture();
      const spec = await approvedSpec(store, service);

      const result = await service.set(spec.slug, { content: "original body, typo fixed" }, {
        correction: { reason: "typo in the second sentence" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("approved");
    });
  });

  describe("ERROR — a correction needs a reason and only corrects text", () => {
    it("rejects an empty reason and writes nothing", async () => {
      const { store, service } = makeFixture();
      const retro = await approvedRetro(store, service);
      const before = await versionCount(store, retro.id);

      const result = await service.set(retro.slug, { content: "changed" }, { correction: { reason: "" } });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.code === "VALIDATION_ERROR" && result.error.field).toBe("correction.reason");
      expect(await versionCount(store, retro.id)).toBe(before);
    });

    it("rejects a whitespace-only reason", async () => {
      const { store, service } = makeFixture();
      const retro = await approvedRetro(store, service);
      const before = await versionCount(store, retro.id);

      const result = await service.set(retro.slug, { content: "changed" }, { correction: { reason: "   " } });

      expect(result.ok).toBe(false);
      expect(await versionCount(store, retro.id)).toBe(before);
    });

    it("rejects a correction that also asks for a status change", async () => {
      const { store, service } = makeFixture();
      const spec = await approvedSpec(store, service);
      const before = await versionCount(store, spec.id);

      const result = await service.set(spec.slug, { content: "fixed", status: "active" }, {
        correction: { reason: "typo" },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code === "VALIDATION_ERROR" && result.error.field).toBe("correction");
      expect(await versionCount(store, spec.id)).toBe(before);
    });
  });

  describe("STATE — the gate knob (D11, BR-1053)", () => {
    it("with the gate disabled, an approved spec edit follows BR-722 and leaves exactly one config_disabled skip audit naming the doc", async () => {
      const store = actedStore(new InMemoryStore());
      const config = LoreConfigSchema.parse({
        project: { name: "test-project", author: "alice" },
        workflow: { gates: { "record-edit": { enabled: false } } },
      });
      const enforcer = new GateEnforcer(config, store.appendAuditEntry.bind(store), undefined, () => "test-actor");
      const service = new CorpusService(store, new RecordLockService(store, enforcer));
      const spec = await approvedSpec(store, service);

      const result = await service.set(spec.slug, { content: "rewritten with the gate off" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("draft");
      // The skip audit is fire-and-forget; let its promise settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const audit = await store.queryAudit({ doc_id: spec.id, action: "gate_skipped" });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.value).toHaveLength(1);
      expect(audit.value[0]?.details).toMatchObject({ checkpoint: "record-edit", mechanism: "config_disabled" });
    });

    it("a passing evaluation (an unlocked doc rewritten) leaves a gate_passed trace naming the doc, and a metadata-only save leaves none", async () => {
      const store = actedStore(new InMemoryStore());
      const enforcer = new GateEnforcer(undefined, store.appendAuditEntry.bind(store), undefined, () => "test-actor");
      const service = new CorpusService(store, new RecordLockService(store, enforcer));
      const spec = await mustCreate(service, { type: "spec", title: "Draft", content: "v1" });

      await mustSet(service, spec.slug, { tags: ["metadata-only"] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const afterMetadata = await store.queryAudit({ doc_id: spec.id, action: "gate_passed" });
      expect(afterMetadata.ok && afterMetadata.value).toHaveLength(0);

      await mustSet(service, spec.slug, { content: "v2" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const afterRewrite = await store.queryAudit({ doc_id: spec.id, action: "gate_passed" });
      expect(afterRewrite.ok).toBe(true);
      if (!afterRewrite.ok) return;
      expect(afterRewrite.value).toHaveLength(1);
      expect(afterRewrite.value[0]?.details).toMatchObject({ checkpoint: "record-edit" });
    });
  });
});

// ─── Task fixtures ───────────────────────────────────────────────────────────

/** An `--adhoc` task: it needs no plan, so the fixture needs only a root PRD. */
async function adhocTask(service: CorpusService): Promise<DocRecord> {
  await mustCreate(service, { type: "prd", title: "Root", content: "root" });
  return mustCreate(service, {
    type: "task",
    title: "Some task",
    content: "task body",
    extra: { adhoc: true, ac_scope: [] },
  } as CreateDocInput);
}

async function appendClaimAudit(store: InMemoryStore, docId: string): Promise<void> {
  const written = await store.appendAuditEntry({
    timestamp: new Date().toISOString(),
    actor: "agent:test",
    session_id: `claim-${docId}`,
    action: "claim",
    doc_id: docId as DocRecord["id"],
    details: { by: "agent:test", steal: false },
  });
  if (!written.ok) throw new Error("audit append failed");
}

async function appendReleaseAudit(store: InMemoryStore, docId: string, rollback: boolean): Promise<void> {
  const written = await store.appendAuditEntry({
    timestamp: new Date().toISOString(),
    actor: "agent:test",
    session_id: `release-${docId}`,
    action: "release",
    doc_id: docId as DocRecord["id"],
    details: rollback ? { by: "agent:test", rollback: true } : { by: "agent:test" },
  });
  if (!written.ok) throw new Error("audit append failed");
}
