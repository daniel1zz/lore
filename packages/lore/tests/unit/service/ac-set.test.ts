/**
 * Six-dimension tests for AcService.setCriterion (spec-lore-ac-set-in-place-edit-of-
 * a-declared-acceptance D1-D6). Uses InMemoryStore + CorpusService (fixture builder
 * only) — no file I/O, no SQLite. Mirrors ac-service.test.ts's fixture-helper style.
 *
 * Dimension mapping (AC-ACS-1..6; AC-ACS-3 is CLI-layer, covered by
 * cli-ac-set.test.ts's zero-flag exit-2 test, and AC-ACS-7 belongs to the sibling
 * dangling-ac_ref-detector task, not this file):
 *   HAPPY (AC-ACS-1):      setCriterion replaces the statement in place — id and
 *                          criterion count unchanged, listCriteria round-trips it
 *   NEGATIVE (AC-ACS-2):   an unknown id exits VALIDATION_ERROR (CLI exit 4), stderr-
 *                          bound message enumerates the declared ids, doc unchanged
 *   STATE (AC-ACS-4):      an approved spec demotes to draft on edit; a draft spec
 *                          stays draft, with no status-transition recorded in the
 *                          version log for that edit (consecutive versions' `status`
 *                          fields are equal)
 *   ERROR (AC-ACS-5):      a mode-inconsistent flag (--rubric against a script-mode
 *                          criterion) exits VALIDATION_ERROR naming both the flag and
 *                          the criterion's actual mode
 *   REGRESSION (AC-ACS-6): editing one criterion leaves every OTHER declared
 *                          criterion byte-identical and every other `extra` key
 *                          untouched (guards the `lore set`-replaces-extra failure
 *                          mode this whole spec exists to avoid)
 *
 * @spec_ref AC-ACS-1 AC-ACS-2 AC-ACS-4 AC-ACS-5 AC-ACS-6
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Fixture helpers (mirrors ac-service.test.ts) ──────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const acService = new AcService(store);
  return { store, corpusService, acService };
}

async function createPrd(cs: CorpusService, title = "Test PRD"): Promise<string> {
  const result = await cs.create({ type: "prd", title, content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createSpec(cs: CorpusService, parentId: string, title = "Test Spec"): Promise<string> {
  const result = await cs.create({
    type: "spec",
    title,
    parent_id: parentId,
    content: "spec body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

function scriptCriterion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "AC-X-1",
    statement: "Rejects malformed input with a named field",
    verify: { mode: "script", oracle: "test", command: "bun test x" },
    ...overrides,
  };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────────

describe("HAPPY — setCriterion replaces the statement in place (AC-ACS-1)", () => {
  it("replaces the statement in place", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, scriptCriterion());

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    const versionBefore = before.value.version;

    const result = await acService.setCriterion(specId, "AC-X-1", {
      statement: "Rejects malformed input with a specific field name in the error",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // id unchanged, criterion count unchanged.
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.id).toBe("AC-X-1");
    expect(result.value[0]?.statement).toBe(
      "Rejects malformed input with a specific field name in the error",
    );

    // A following listCriteria prints the new text for AC-X-1.
    const listed = await acService.listCriteria(specId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.criteria).toHaveLength(1);
    expect(listed.value.criteria[0]?.statement).toBe(
      "Rejects malformed input with a specific field name in the error",
    );
    expect(listed.value.criteria[0]?.id).toBe("AC-X-1");

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(versionBefore + 1);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────────

describe("NEGATIVE — unknown id exits 4 naming declared ids (AC-ACS-2)", () => {
  it("unknown id exits 4 naming declared ids", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, scriptCriterion());
    await acService.addCriterion(specId, scriptCriterion({ id: "AC-X-2", statement: "A second criterion" }));

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    const versionBefore = before.value.version;

    const result = await acService.setCriterion(specId, "AC-NOPE", { statement: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    // stderr (formatError-rendered) MUST contain the ids actually declared on this spec.
    expect(result.error.message).toContain("AC-X-1");
    expect(result.error.message).toContain("AC-X-2");

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(versionBefore);
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────────

describe("STATE — demotes an approved spec to draft; a draft spec stays draft with no status-transition entry (AC-ACS-4)", () => {
  it("demotes an approved spec to draft", async () => {
    const { store, corpusService, acService } = makeServices();

    // Half 1: an APPROVED spec is demoted to draft by the edit.
    const prdId1 = await createPrd(corpusService, "Test PRD Approved");
    const approvedSpecId = await createSpec(corpusService, prdId1, "Approved Spec");
    await acService.addCriterion(approvedSpecId, scriptCriterion());
    const promoted = await corpusService.set(approvedSpecId, { status: "approved" });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.value.status).toBe("approved");

    const editApproved = await acService.setCriterion(approvedSpecId, "AC-X-1", {
      statement: "An edited statement on a previously approved spec",
    });
    expect(editApproved.ok).toBe(true);

    const afterApprovedEdit = await store.find(approvedSpecId);
    if (!afterApprovedEdit.ok || afterApprovedEdit.value === null) throw new Error("spec re-fetch failed");
    expect(afterApprovedEdit.value.status).toBe("draft");

    // Half 2: a DRAFT spec stays draft, and the version log records NO
    // status-transition for this edit — consecutive versions' `status` fields
    // must be equal (both "draft"), proving nothing transitioned.
    const prdId2 = await createPrd(corpusService, "Test PRD Draft");
    const draftSpecId = await createSpec(corpusService, prdId2, "Draft Spec");
    await acService.addCriterion(draftSpecId, scriptCriterion());

    const beforeDraftEdit = await store.find(draftSpecId);
    if (!beforeDraftEdit.ok || beforeDraftEdit.value === null) throw new Error("spec fetch failed");
    expect(beforeDraftEdit.value.status).toBe("draft");

    const editDraft = await acService.setCriterion(draftSpecId, "AC-X-1", {
      statement: "An edited statement on a spec that was never approved",
    });
    expect(editDraft.ok).toBe(true);

    const afterDraftEdit = await store.find(draftSpecId);
    if (!afterDraftEdit.ok || afterDraftEdit.value === null) throw new Error("spec re-fetch failed");
    expect(afterDraftEdit.value.status).toBe("draft");

    const versions = await store.findVersions(draftSpecId);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    // versions are newest-first (mirrors ac-service.test.ts's existing convention).
    const latest = versions.value[0];
    const previous = versions.value[1];
    expect(latest?.status).toBe("draft");
    expect(previous?.status).toBe("draft");
    expect(latest?.status).toBe(previous?.status);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────────

describe("ERROR — mode-inconsistent flag exits 4 (AC-ACS-5)", () => {
  it("mode-inconsistent flag exits 4", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, scriptCriterion());

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    const versionBefore = before.value.version;

    const result = await acService.setCriterion(specId, "AC-X-1", { rubric: "Judge on clarity" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toContain("--rubric");
    expect(result.error.message).toContain("script");

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(versionBefore);
    expect((after.value.extra["acceptance_criteria"] as Array<{ statement: string }>)[0]?.statement).toBe(
      scriptCriterion()["statement"],
    );
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────────

describe("REGRESSION — leaves sibling criteria and other extra keys untouched (AC-ACS-6)", () => {
  it("leaves sibling criteria and other extra keys untouched", async () => {
    const { store, corpusService, acService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await acService.addCriterion(specId, scriptCriterion());
    const sibling = {
      id: "AC-X-2",
      statement: "A sibling criterion untouched by this edit",
      verify: { mode: "ai", rubric: "Judge whether the output is clear" },
    };
    await acService.addCriterion(specId, sibling);

    // Seed an unrelated custom extra key directly via the store (bypassing
    // CorpusService.set's dedicated-writer guards, same technique
    // ac-service.test.ts's BOUNDARY seed already uses) to prove setCriterion's
    // `{...spec.extra, acceptance_criteria: ...}` spread never drops it.
    const beforeSeed = await store.find(specId);
    if (!beforeSeed.ok || beforeSeed.value === null) throw new Error("spec fetch failed");
    await store.update(specId, { extra: { ...beforeSeed.value.extra, custom_marker: "untouched-value" } });

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    const siblingBefore = (before.value.extra["acceptance_criteria"] as unknown[])[1];

    const result = await acService.setCriterion(specId, "AC-X-1", {
      statement: "The only criterion that should change",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.statement).toBe("The only criterion that should change");
    // The sibling criterion is byte-identical (deep-equal) to its pre-edit form.
    expect(result.value[1]).toEqual(siblingBefore);

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    // Every other `extra` key is unchanged (the `lore set`-replaces-extra failure
    // mode this whole spec exists to avoid).
    expect(after.value.extra["custom_marker"]).toBe("untouched-value");
    expect(after.value.extra["acceptance_criteria"]).toEqual(result.value);
  });
});
