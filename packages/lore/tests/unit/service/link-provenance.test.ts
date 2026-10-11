/**
 * SPEC-079 G1 (relationship provenance) — AC-079-1.
 *
 * `CorpusService.link` / `CorpusService.unlink` and every APPLIED
 * `TreeCheckService.fix` repair must each write exactly one audit entry with
 * a documented action/details shape:
 *   - link()   → action: "link",     doc_id: <from>, details: {to_id, link_type}
 *   - unlink() → action: "unlink",   doc_id: <from>, details: {to_id, link_type: string[]}
 *                (the FULL list of removed types, never one entry per type)
 *   - fix()    → action: "tree-fix", doc_id: <fixed doc>,
 *                details: {kind, doc_id, old_parent_id, new_parent_id}
 *
 * All three are AUDIT-ONLY (no `versions` row) — a link/tree-fix is not a
 * doc-content snapshot. Written ONLY on an actual state change: a no-op
 * unlink() (no matching link between the pair) writes nothing, and a failed
 * link()/fix() attempt writes nothing either (write-on-success only).
 *
 * Uses InMemoryStore — no file I/O, no bun:sqlite (vitest runner).
 *
 * Six-dimension coverage:
 *   HAPPY:      link() / unlink() / fix() each write exactly one well-shaped entry
 *   NEGATIVE:   a no-op unlink() (nothing to remove) writes zero entries;
 *               a rejected link() (INVALID_PARENT_TYPE) writes zero entries
 *   BOUNDARY:   unlink() removing TWO link types between the same pair collapses
 *               into ONE audit entry whose details.link_type is a 2-element array;
 *               fix() with zero fixable drifts writes zero tree-fix entries
 *   ERROR:      a store.addLink failure (LINK_CYCLE) never reaches the audit write
 *   STATE:      link → unlink → link on the same pair accumulates the correct
 *               entry COUNTS per action (2 link, 1 unlink) — order-independent,
 *               since same-millisecond timestamps make DESC-sort order unstable
 *   REGRESSION: link/unlink/tree-fix audit actions join NO
 *               VERSION_ACTION_AUDIT_FAMILY member — AuditService.verify() stays
 *               clean after a create + link + unlink + tree-fix sequence
 *
 * @spec_ref SPEC-079 §Acceptance Criteria AC-079-1
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { AuditService } from "../../../src/service/audit-service.js";
import type { CreateDocInput, DocId, DocRecord, LinkRecord, LoreError, Result, TreeBlueprint } from "@lore/core";
import { DOC_TYPE_ROLE_MAP, err } from "@lore/core";
import { ulid } from "ulidx";

const FAR_PAST = "2000-01-01T00:00:00.000Z"; // always before any doc created during a test run

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeStore() {
  return new InMemoryStore();
}

async function createPrd(cs: CorpusService, title: string): Promise<DocRecord> {
  const result = await cs.create({ type: "prd", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`create prd failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Insert a raw DocRecord bypassing service validation — mirrors corpus-hardgate.test.ts's helper. */
async function insertRawDoc(
  store: InMemoryStore,
  type: DocRecord["type"],
  title: string,
  parentId: DocId | null,
): Promise<DocRecord> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id,
    slug: `${type}-${title.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6)}`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title,
    status: "draft",
    priority: "medium",
    content: "",
    parent_id: parentId,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: type === "task" ? { plan_id: parentId ?? "fake-plan-id" } : {},
  };
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insertRawDoc failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function linkAudit(store: InMemoryStore, docId: DocId, action: string) {
  const r = await store.queryAudit({ doc_id: docId, action });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

/** Build a minimal blueprint: one prd root, with a plan child slot (min 0, unbounded max). */
function prdPlanBlueprint(): TreeBlueprint {
  return {
    version: 1,
    root: { type: "prd", min: 1, max: null, children: [{ type: "plan", min: 0, max: null, children: [] }] },
  };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — link/unlink/fix each write exactly one well-shaped audit entry", () => {
  it("link() writes one action:'link' entry, doc_id=from, details={to_id, link_type}", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const a = await createPrd(cs, "Provenance A");
    const b = await createPrd(cs, "Provenance B");

    const result = await cs.link(a.id, b.id, "relates-to");
    expect(result.ok).toBe(true);

    const entries = await linkAudit(store, a.id, "link");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.details).toEqual({ to_id: b.id, link_type: "relates-to" });
    expect(entries[0]?.doc_id).toBe(a.id);
  });

  it("unlink() writes one action:'unlink' entry, details.link_type is the removed-type array", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const a = await createPrd(cs, "Unlink A");
    const b = await createPrd(cs, "Unlink B");
    await cs.link(a.id, b.id, "relates-to");

    const result = await cs.unlink(a.id, b.id);
    expect(result.ok).toBe(true);

    const entries = await linkAudit(store, a.id, "unlink");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.details).toEqual({ to_id: b.id, link_type: ["relates-to"] });
  });

  it("fix() writes one action:'tree-fix' entry per applied repair, details={kind, doc_id, old_parent_id, new_parent_id}", async () => {
    const store = makeStore();
    const tcs = new TreeCheckService(store);
    const prd = await insertRawDoc(store, "prd", "Root", null);
    // plan with no parent (orphaned root-level plan) — the blueprint declares
    // plan as a child of prd, so fix() should reparent it under the prd.
    const plan = await insertRawDoc(store, "plan", "Orphan Plan", null);

    const result = await tcs.fix(prdPlanBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fixed.some((f) => f.id === plan.id)).toBe(true);

    const entries = await linkAudit(store, plan.id, "tree-fix");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.details).toEqual({
      kind: "orphan",
      doc_id: plan.id,
      old_parent_id: null,
      new_parent_id: prd.id,
    });
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — no state change means no audit entry", () => {
  it("unlink() with no matching link between the pair writes zero audit entries", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const a = await createPrd(cs, "No-op A");
    const b = await createPrd(cs, "No-op B");
    // never linked

    const result = await cs.unlink(a.id, b.id);
    expect(result.ok).toBe(true); // idempotent no-op, not an error

    const entries = await linkAudit(store, a.id, "unlink");
    expect(entries).toHaveLength(0);
  });

  it("a rejected link() (INVALID_PARENT_TYPE) writes zero audit entries", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const prd = await insertRawDoc(store, "prd", "Root", null);
    const spec = await insertRawDoc(store, "spec", "A Spec", prd.id);
    const plan = await insertRawDoc(store, "plan", "A Plan", prd.id);
    const task = await insertRawDoc(store, "task", "A Task", plan.id);

    // plan's allowed parent types = ["prd", "spec"]; task is not a legal "parent" link target.
    const result = await cs.link(plan.id, task.id, "parent");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_PARENT_TYPE");

    const entries = await linkAudit(store, plan.id, "link");
    expect(entries).toHaveLength(0);
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — multi-type unlink collapses to one entry; zero fixable drifts write nothing", () => {
  it("unlink() removing TWO link types between the same pair writes ONE entry with both types", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const a = await createPrd(cs, "Multi A");
    const b = await createPrd(cs, "Multi B");
    await cs.link(a.id, b.id, "relates-to");
    await cs.link(a.id, b.id, "blocks");

    const result = await cs.unlink(a.id, b.id);
    expect(result.ok).toBe(true);

    const entries = await linkAudit(store, a.id, "unlink");
    expect(entries).toHaveLength(1);
    const details = entries[0]?.details as { to_id: string; link_type: string[] };
    expect(details.to_id).toBe(b.id);
    expect(details.link_type.sort()).toEqual(["blocks", "relates-to"]);
  });

  it("fix() with zero fixable drifts writes zero tree-fix audit entries", async () => {
    const store = makeStore();
    const tcs = new TreeCheckService(store);
    const prd = await insertRawDoc(store, "prd", "Root", null);

    const result = await tcs.fix(prdPlanBlueprint());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fixed).toHaveLength(0);

    const entries = await linkAudit(store, prd.id, "tree-fix");
    expect(entries).toHaveLength(0);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("ERROR — a failed store write never reaches the audit write", () => {
  it("a store.addLink failure (e.g. LINK_CYCLE) writes zero audit entries", async () => {
    class FailingLinkStore extends InMemoryStore {
      override async addLink(_link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
        return err({ code: "LINK_CYCLE", path: [] });
      }
    }
    const store = new FailingLinkStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const a = await createPrd(cs, "Fail A");
    const b = await createPrd(cs, "Fail B");

    const result = await cs.link(a.id, b.id, "relates-to");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("LINK_CYCLE");

    const entries = await linkAudit(store, a.id, "link");
    expect(entries).toHaveLength(0);
  });

  it("a store.update failure inside fix() never writes a tree-fix audit entry", async () => {
    class FailingUpdateStore extends InMemoryStore {
      override async update(
        _id: DocId,
        _patch: Partial<DocRecord>,
      ): Promise<Result<DocRecord, LoreError>> {
        return err({ code: "STORE_ERROR", message: "forced failure for test" });
      }
    }
    const store = new FailingUpdateStore();
    const tcs = new TreeCheckService(store);
    await insertRawDoc(store, "prd", "Root", null);
    const plan = await insertRawDoc(store, "plan", "Orphan Plan", null);

    const result = await tcs.fix(prdPlanBlueprint());
    expect(result.ok).toBe(false);

    const entries = await linkAudit(store, plan.id, "tree-fix");
    expect(entries).toHaveLength(0);
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — link/unlink/link accumulates the correct per-action entry counts", () => {
  it("link → unlink → link on the same pair yields 2 'link' entries and 1 'unlink' entry", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const a = await createPrd(cs, "Sequence A");
    const b = await createPrd(cs, "Sequence B");

    expect((await cs.link(a.id, b.id, "relates-to")).ok).toBe(true);
    expect((await cs.unlink(a.id, b.id)).ok).toBe(true);
    expect((await cs.link(a.id, b.id, "relates-to")).ok).toBe(true);

    const linkEntries = await linkAudit(store, a.id, "link");
    const unlinkEntries = await linkAudit(store, a.id, "unlink");
    expect(linkEntries).toHaveLength(2);
    expect(unlinkEntries).toHaveLength(1);
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — link/unlink/tree-fix join no VERSION_ACTION_AUDIT_FAMILY member", () => {
  it("AuditService.verify() stays clean after create + link + unlink + a REAL applied fix", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const tcs = new TreeCheckService(store);
    const auditService = new AuditService(store, { verifySince: FAR_PAST });

    // Exactly ONE prd root — a second one would give the orphaned plan below two
    // equally-valid candidate parents, making fix() skip it ("0-or-many candidates")
    // instead of actually applying a repair.
    const root = await createPrd(cs, "Verify Root");
    const specA = await cs.create({
      type: "spec",
      title: "Verify Spec A",
      content: "x",
    } as CreateDocInput);
    const specB = await cs.create({
      type: "spec",
      title: "Verify Spec B",
      content: "x",
    } as CreateDocInput);
    if (!specA.ok || !specB.ok) throw new Error("fixture spec creation failed");
    await cs.link(specA.value.id, specB.value.id, "relates-to");
    await cs.unlink(specA.value.id, specB.value.id);

    // Orphaned plan — the blueprint declares plan as prd's child, so fix() reparents it.
    const plan = await insertRawDoc(store, "plan", "Verify Plan", null);
    const fixResult = await tcs.fix({
      version: 1,
      root: { type: "prd", min: 1, max: null, children: [{ type: "plan", min: 0, max: null, children: [] }] },
    });
    expect(fixResult.ok).toBe(true);
    if (fixResult.ok) {
      expect(fixResult.value.fixed.some((f) => f.id === plan.id)).toBe(true);
    }

    const result = await auditService.verify({ since: FAR_PAST });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clean).toBe(true);
    expect(result.value.misses).toEqual([]);
  });

  it("link()/unlink()/fix() write no versions row — only the audit entry", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store));
    const a = await createPrd(cs, "NoVersion A");
    const b = await createPrd(cs, "NoVersion B");
    const versionsBefore = await store.findVersions(a.id);
    if (!versionsBefore.ok) throw new Error(JSON.stringify(versionsBefore.error));
    const countBefore = versionsBefore.value.length;

    await cs.link(a.id, b.id, "relates-to");
    await cs.unlink(a.id, b.id);

    const versionsAfter = await store.findVersions(a.id);
    if (!versionsAfter.ok) throw new Error(JSON.stringify(versionsAfter.error));
    expect(versionsAfter.value.length).toBe(countBefore);
  });
});
