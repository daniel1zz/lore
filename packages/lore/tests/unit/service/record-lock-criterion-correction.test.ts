/**
 * AC-CC-1 — `AcService.setCriterion` correction: an audited fix of ONE criterion of a locked spec.
 *
 * Spec: spec-a-criterion-of-a-locked-specification-can-be-fixed-as-an (D1-D5). Rule: BR-1069 (extends BR-1049).
 *
 * Dimensions:
 *   HAPPY       (a) correction + statement patch on an approved spec: ok, status kept, ONE version with
 *               `Correction: r`, ONE audit update row carrying `details.correction.reason`;
 *               (d) a command change bumps oracle_generation by exactly 1; (e) falsifier fields are stored (#162)
 *   NEGATIVE    (b) same patch without correction: record-edit refusal, nothing written;
 *               (f) addCriterion / removeCriterion on the locked spec: same refusal, nothing written
 *   BOUNDARY    (c) empty and whitespace-only reason: VALIDATION_ERROR field correction.reason, nothing written
 *   STATE       (g) a draft spec + correction: ok, stays draft, reason recorded in the change_summary
 *   ERROR       (h) unknown AC id + correction: the existing not-found error, nothing written
 *   REGRESSION  the audit row is one `countCorrections` (lore get) counts: action update + details.correction
 */

import { describe, it, expect, vi } from "vitest";
import type { AcceptanceCriterion, CreateDocInput, DocRecord, LoreError } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { actedStore } from "../../live-invocation.js";

interface Fixture {
  readonly store: InMemoryStore;
  readonly corpus: CorpusService;
  readonly ac: AcService;
}

function makeFixture(): Fixture {
  const store = actedStore(new InMemoryStore());
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  return { store, corpus: new CorpusService(store, lock), ac: new AcService(store, lock) };
}

const SCRIPT_AC = {
  id: "AC-CORR-1",
  statement: "Rejects a malformed request with exit code 4",
  verify: { mode: "script", oracle: "test", command: "bunx vitest run x.test.ts" },
} as const;

async function mustCreate(corpus: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const created = await corpus.create(input);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

async function forceStatus(store: InMemoryStore, doc: DocRecord, status: DocRecord["status"]): Promise<void> {
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
}

/** A spec with one criterion and one evidence row on an ad-hoc task; approved when `approved`. */
async function specFixture(f: Fixture, approved: boolean): Promise<DocRecord> {
  const spec = await mustCreate(f.corpus, { type: "spec", title: "Correction spec", content: "body" });
  const added = await f.ac.addCriterion(spec.slug, SCRIPT_AC);
  if (!added.ok) throw new Error(`fixture ac add failed: ${JSON.stringify(added.error)}`);
  if (approved) {
    await forceStatus(f.store, spec, "approved");
    const plan = await mustCreate(f.corpus, { type: "plan", title: "Plan", parent_id: spec.id, content: "plan" });
    const task = await mustCreate(f.corpus, {
      type: "task",
      title: "Task",
      parent_id: plan.id,
      content: "task",
      extra: { plan_id: plan.id },
    });
    const evidenced = await f.store.update(task.id, {
      extra: {
        ...task.extra,
        verification_evidence: [
          {
            oracle: "test",
            command: "bunx vitest run x.test.ts",
            result: "pass",
            recorded_at: new Date().toISOString(),
            recorded_by: "tester",
            ac_ref: SCRIPT_AC.id,
          },
        ],
      },
    });
    if (!evidenced.ok) throw new Error("evidence write failed");
  }
  return spec;
}

async function reload(f: Fixture, id: string): Promise<DocRecord> {
  const found = await f.store.find(id as DocRecord["id"]);
  if (!found.ok || found.value === null) throw new Error("doc vanished");
  return found.value;
}

function criteriaOf(doc: DocRecord): AcceptanceCriterion[] {
  return (doc.extra["acceptance_criteria"] as AcceptanceCriterion[] | undefined) ?? [];
}

async function versionsOf(f: Fixture, id: string) {
  const r = await f.store.findVersions(id as DocRecord["id"], { limit: 1000 });
  if (!r.ok) throw new Error("findVersions failed");
  return r.value;
}

/** Counts every store write path a criterion edit could take. */
function spyOnWrites(store: InMemoryStore): () => number {
  const spies = [
    vi.spyOn(store, "update"),
    vi.spyOn(store, "updateWithProvenance"),
    vi.spyOn(store, "insertVersion"),
  ];
  return () => spies.reduce((n, s) => n + s.mock.calls.length, 0);
}

function expectRecordEditRefusal(error: LoreError): void {
  expect(error.code).toBe("VALIDATION_ERROR");
  if (error.code !== "VALIDATION_ERROR") return;
  expect(error.field).toBe("gate:record-edit");
  expect(error.message).toContain("lore ac set");
  expect(error.message).toContain("--correction");
}

describe("AcService.setCriterion correction (AC-CC-1)", () => {
  it("(a) correction + statement on an approved spec: ok, status kept, one version, one counted audit row", async () => {
    const f = makeFixture();
    const spec = await specFixture(f, true);
    const before = await reload(f, spec.id);
    const versionsBefore = (await versionsOf(f, spec.id)).length;

    const result = await f.ac.setCriterion(spec.slug, "AC-CORR-1", { statement: "Rejects a bad request with exit 4" }, {
      correction: { reason: "r" },
    });

    expect(result.ok).toBe(true);
    const after = await reload(f, spec.id);
    expect(after.status).toBe("approved");
    expect(criteriaOf(after)[0]?.statement).toBe("Rejects a bad request with exit 4");
    expect(after.version).toBe(before.version + 1);
    const versions = await versionsOf(f, spec.id);
    expect(versions).toHaveLength(versionsBefore + 1);
    const newest = versions.find((v) => v.version === after.version);
    expect(newest?.change_summary?.startsWith("Correction: r")).toBe(true);
    expect(newest?.status).toBe("approved");
    const audit = await f.store.queryAudit({ doc_id: spec.id });
    if (!audit.ok) throw new Error("audit failed");
    const corrected = audit.value.filter(
      (row) => row.action === "update" && (row.details as { correction?: { reason?: string } } | undefined)?.correction !== undefined,
    );
    expect(corrected).toHaveLength(1);
    expect((corrected[0]?.details as { correction: { reason: string } }).correction.reason).toBe("r");
    expect((corrected[0]?.details as { version: number }).version).toBe(after.version);
  });

  it("(b) the same patch without a correction is the record-edit refusal and writes nothing", async () => {
    const f = makeFixture();
    const spec = await specFixture(f, true);
    const writes = spyOnWrites(f.store);
    const before = await reload(f, spec.id);

    const result = await f.ac.setCriterion(spec.slug, "AC-CORR-1", { statement: "Rejects a bad request with exit 4" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRecordEditRefusal(result.error);
    expect(writes()).toBe(0);
    expect((await reload(f, spec.id)).version).toBe(before.version);
  });

  it.each([[""], ["   "]])("(c) reason %j is VALIDATION_ERROR on correction.reason and writes nothing", async (reason) => {
    const f = makeFixture();
    const spec = await specFixture(f, true);
    const writes = spyOnWrites(f.store);

    const result = await f.ac.setCriterion(spec.slug, "AC-CORR-1", { statement: "x y z" }, { correction: { reason } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") expect(result.error.field).toBe("correction.reason");
    expect(writes()).toBe(0);
  });

  it("(d) correction + a command change bumps oracle_generation by exactly 1", async () => {
    const f = makeFixture();
    const spec = await specFixture(f, true);
    const genBefore = criteriaOf(await reload(f, spec.id))[0]?.oracle_generation ?? 1;

    const result = await f.ac.setCriterion(spec.slug, "AC-CORR-1", { command: "bunx vitest run z.test.ts" }, {
      correction: { reason: "wrong test path" },
    });

    expect(result.ok).toBe(true);
    const after = criteriaOf(await reload(f, spec.id))[0];
    expect(after?.oracle_generation).toBe(genBefore + 1);
    expect(after?.verify.mode === "script" ? after.verify.command : "").toBe("bunx vitest run z.test.ts");
  });

  it("(e) correction + falsifier fields on a locked spec stores the falsifier (closes #162)", async () => {
    const f = makeFixture();
    const spec = await specFixture(f, true);
    const falsifier = { path: "src/a.ts", find: "return 1", replace: "return 2", expected_exit_code: 1 };

    const result = await f.ac.setCriterion(spec.slug, "AC-CORR-1", { falsifier }, { correction: { reason: "declare falsifier" } });

    expect(result.ok).toBe(true);
    const stored = criteriaOf(await reload(f, spec.id))[0];
    expect(stored?.verify.mode === "script" ? stored.verify.falsifier : undefined).toEqual(falsifier);
    expect((await reload(f, spec.id)).status).toBe("approved");
  });

  it("(f) addCriterion and removeCriterion on the locked spec keep the same refusal and write nothing", async () => {
    const f = makeFixture();
    const spec = await specFixture(f, true);
    const writes = spyOnWrites(f.store);

    const added = await f.ac.addCriterion(spec.slug, {
      id: "AC-CORR-2",
      statement: "Returns the stored record within 200 ms",
      verify: { mode: "script", oracle: "test", command: "bunx vitest run y.test.ts" },
    });
    const removed = await f.ac.removeCriterion(spec.slug, "AC-CORR-1", { force: true });

    for (const result of [added, removed]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expectRecordEditRefusal(result.error);
    }
    expect(writes()).toBe(0);
    expect(criteriaOf(await reload(f, spec.id))).toHaveLength(1);
  });

  it("(g) a draft spec + correction: ok, stays draft, the change_summary carries the reason", async () => {
    const f = makeFixture();
    const spec = await specFixture(f, false);

    const result = await f.ac.setCriterion(spec.slug, "AC-CORR-1", { statement: "Rejects a bad request with exit 4" }, {
      correction: { reason: "draft fix" },
    });

    expect(result.ok).toBe(true);
    const after = await reload(f, spec.id);
    expect(after.status).toBe("draft");
    const newest = (await versionsOf(f, spec.id)).find((v) => v.version === after.version);
    expect(newest?.change_summary).toContain("draft fix");
  });

  it("(h) an unknown AC id + correction is the existing not-declared error and writes nothing", async () => {
    const f = makeFixture();
    const spec = await specFixture(f, true);
    const writes = spyOnWrites(f.store);

    const result = await f.ac.setCriterion(spec.slug, "AC-NOPE-9", { statement: "x y z" }, { correction: { reason: "r" } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("acceptance_criteria[].id");
      expect(result.error.message).toContain("AC-NOPE-9");
    }
    expect(writes()).toBe(0);
  });
});
