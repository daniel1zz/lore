/**
 * AC-EH-3 (spec-evidence-labels-and-reds-are-honest, BR-1076) — the falsifier's expected exit code is one whole
 * number 1..255, enforced at the AC WRITE CHOKEPOINT (the criteria-array validation `AcService` AND
 * `CorpusService.create` both pass through), never in a single caller.
 *
 * RED-first: written before the range check exists. Each case fails on an ASSERTION (a refused write is observed
 * as accepted / a row written / a document created) against current code.
 *
 * Dimension mapping:
 *   HAPPY:      (b) expected_exit_code 1 and 255 are accepted and stored
 *   NEGATIVE:   (a) 0, -1 and 256 on `addCriterion` each return VALIDATION_ERROR field
 *               'falsifier.expected_exit_code' with ZERO store writes; (c) `setCriterion` moving a falsifier to 0
 *               is refused the same way
 *   BOUNDARY:   0 and 256 are the two edges just outside 1..255; -1 is the sign edge; 1 and 255 are the inside edges
 *   ERROR:      (f) `CorpusService.create` of a spec whose extra.acceptance_criteria carries a falsifier exit 0
 *               is refused with the same code and field, and NO document exists afterwards (the chokepoint is
 *               below AcService — a check placed only in AcService lets this create the document)
 *   STATE:      (c) after the refused `setCriterion` the stored falsifier is unchanged (still its prior value)
 *   REGRESSION: (d) a statement-only `setCriterion` on a criterion whose STORED falsifier is 0 (planted directly
 *               into the store) still succeeds — a stored criterion whose falsifier is not changed is not
 *               re-checked; (e) reading that spec's criteria still parses (the READ schema is not tightened)
 *
 * @spec_ref AC-EH-3 — spec-evidence-labels-and-reds-are-honest; BR-1076
 */

import { describe, it, expect, vi } from "vitest";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import type { CreateDocInput, DocRecord, LoreError } from "@lore/core";

function makeServices() {
  const store = new InMemoryStore();
  const lock = () => new RecordLockService(store, new GateEnforcer(undefined));
  return { store, corpusService: new CorpusService(store, lock()), acService: new AcService(store, lock()) };
}

/** Counts every store write path a criterion write could take (pattern: record-lock-criterion-correction.test.ts). */
function spyOnWrites(store: InMemoryStore): () => number {
  const spies = [
    vi.spyOn(store, "insert"),
    vi.spyOn(store, "insertWithProvenance"),
    vi.spyOn(store, "insertWithAllocatedOrdinal"),
    vi.spyOn(store, "insertWithAllocatedOrdinalAndProvenance"),
    vi.spyOn(store, "update"),
    vi.spyOn(store, "updateWithProvenance"),
    vi.spyOn(store, "insertVersion"),
  ];
  return () => spies.reduce((n, s) => n + s.mock.calls.length, 0);
}

async function createSpec(cs: CorpusService): Promise<string> {
  const r = await cs.create({ type: "spec", title: "Range Spec", content: "spec body" } as CreateDocInput);
  if (!r.ok) throw new Error(`create spec failed: ${JSON.stringify(r.error)}`);
  return r.value.id;
}

function falsifier(expectedExitCode: number): Record<string, unknown> {
  return { path: "target.txt", find: "MAGIC", replace: "NOPE", expected_exit_code: expectedExitCode };
}

function criterion(expectedExitCode: number, id = "AC-FR-1"): Record<string, unknown> {
  return {
    id,
    statement: "Declares a falsifier",
    verify: { mode: "script", oracle: "test", command: "bun test x", falsifier: falsifier(expectedExitCode) },
  };
}

function expectRangeRefusal(error: LoreError): void {
  expect(error.code).toBe("VALIDATION_ERROR");
  if (error.code !== "VALIDATION_ERROR") return;
  expect(error.field).toBe("falsifier.expected_exit_code");
}

async function storedCriteria(store: InMemoryStore, specId: string): Promise<Array<Record<string, any>>> {
  const r = await store.find(specId as DocRecord["id"]);
  if (!r.ok || r.value === null) throw new Error("spec fetch failed");
  return (r.value.extra["acceptance_criteria"] as Array<Record<string, any>> | undefined) ?? [];
}

/** (d)/(e) fixture: a stored falsifier of 0, planted straight into the store (bypassing every writer). */
async function plantStoredZero(store: InMemoryStore, specId: string): Promise<void> {
  const r = await store.update(specId as DocRecord["id"], { extra: { acceptance_criteria: [criterion(0)] } });
  if (!r.ok) throw new Error(`plant failed: ${JSON.stringify(r.error)}`);
}

describe("AC-EH-3 (a) — addCriterion refuses a falsifier exit code outside 1..255", () => {
  it.each([0, -1, 256])("expected_exit_code %i -> VALIDATION_ERROR falsifier.expected_exit_code, zero writes", async (code) => {
    const { store, corpusService, acService } = makeServices();
    const specId = await createSpec(corpusService);
    const writes = spyOnWrites(store);

    const result = await acService.addCriterion(specId, criterion(code));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRangeRefusal(result.error);
    expect(writes()).toBe(0);
    expect(await storedCriteria(store, specId)).toEqual([]);
  });
});

describe("AC-EH-3 (b) — the inside edges 1 and 255 are accepted and stored", () => {
  it.each([1, 255])("expected_exit_code %i is accepted and stored", async (code) => {
    const { store, corpusService, acService } = makeServices();
    const specId = await createSpec(corpusService);

    const result = await acService.addCriterion(specId, criterion(code));

    expect(result.ok).toBe(true);
    const stored = await storedCriteria(store, specId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.["verify"]?.["falsifier"]?.["expected_exit_code"]).toBe(code);
  });
});

describe("AC-EH-3 (c) — setCriterion moving a falsifier to 0 is refused and leaves the stored one unchanged", () => {
  it("refuses with falsifier.expected_exit_code, zero writes, stored value still 1", async () => {
    const { store, corpusService, acService } = makeServices();
    const specId = await createSpec(corpusService);
    const added = await acService.addCriterion(specId, criterion(1));
    expect(added.ok).toBe(true);
    const writes = spyOnWrites(store);

    const result = await acService.setCriterion(specId, "AC-FR-1", { falsifier: falsifier(0) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRangeRefusal(result.error);
    expect(writes()).toBe(0);
    const stored = await storedCriteria(store, specId);
    expect(stored[0]?.["verify"]?.["falsifier"]?.["expected_exit_code"]).toBe(1);
  });
});

describe("AC-EH-3 (d)/(e) — a stored 0 is not re-checked when its falsifier is untouched, and still reads", () => {
  it("(d) a statement-only setCriterion on a criterion whose stored falsifier is 0 succeeds", async () => {
    const { store, corpusService, acService } = makeServices();
    const specId = await createSpec(corpusService);
    await plantStoredZero(store, specId);

    const result = await acService.setCriterion(specId, "AC-FR-1", { statement: "Reworded statement" });

    expect(result.ok).toBe(true);
    const stored = await storedCriteria(store, specId);
    expect(stored[0]?.["statement"]).toBe("Reworded statement");
    expect(stored[0]?.["verify"]?.["falsifier"]?.["expected_exit_code"]).toBe(0);
  });

  it("(e) listCriteria on that spec still parses (the read schema is not tightened)", async () => {
    const { store, corpusService, acService } = makeServices();
    const specId = await createSpec(corpusService);
    await plantStoredZero(store, specId);

    const listed = await acService.listCriteria(specId);

    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.criteria).toHaveLength(1);
    expect(listed.value.criteria[0]?.id).toBe("AC-FR-1");
  });
});

describe("AC-EH-3 (f) — the create path shares the chokepoint: no document is created", () => {
  it("CorpusService.create of a spec whose criteria carry falsifier exit 0 is refused with the same code and field", async () => {
    const { store, corpusService } = makeServices();

    const result = await corpusService.create({
      type: "spec",
      title: "Zero Falsifier Spec",
      content: "spec body",
      extra: { acceptance_criteria: [criterion(0)] },
    } as CreateDocInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRangeRefusal(result.error);

    const docs = await store.findMany({ type: "spec" });
    expect(docs.ok).toBe(true);
    if (!docs.ok) return;
    expect(docs.value).toHaveLength(0);
  });
});
