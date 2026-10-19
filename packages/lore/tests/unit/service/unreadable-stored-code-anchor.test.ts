// @reads packages/lore/src/service/drift-check-service.ts
// @reads packages/lore/src/flows/drift-flow.ts
/**
 * task-a-stored-code-anchor-the-drift-check-cannot-read-is (BR-416): a stored code anchor the
 * grammar rejects is reported by the drift check as an `anchor_unreadable` finding (document,
 * raw stored value, parse reason), fails the run, and is counted — never silently dropped.
 *
 * Rows reach the store through `store.update`, the seam a hand-edited / imported / legacy
 * document uses; the write verbs would refuse them.
 *
 * Six-dimension coverage:
 *   HAPPY:      one unreadable anchor -> one anchor_unreadable row, consistent:false (the exit-3 input)
 *   NEGATIVE:   a doc whose EVERY anchor is unreadable is still armed and counted (was: "no anchors", exit 0)
 *   BOUNDARY:   readable + unreadable on one doc: the readable one is still probed, both reported correctly
 *   ERROR:      a non-string entry and a non-array `code_anchors` are findings too, not filtered away
 *   STATE:      `lore anchor rm` of the unreadable raw string removes it, then the run is clean
 *   REGRESSION: the text rendering names the row and the repair; the reverse index still lists readable anchors only
 */

import { describe, expect, it } from "vitest";
import { ok, type CreateDocInput } from "@lore/core";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { DriftCheckService, type FsProbe } from "../../../src/service/drift-check-service.js";
import { renderDriftSectionLines, runDrift } from "../../../src/flows/drift-flow.js";
import { actedStore } from "../../live-invocation.js";

const UNREADABLE = "src/a.ts#not a symbol!";

function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return { store, corpusService, driftCheckService: new DriftCheckService(store) };
}

/** Creates a spec, then overwrites its stored `code_anchors` the way a hand edit would (no grammar seam). */
async function createSpecWithStoredAnchors(
  { store, corpusService }: ReturnType<typeof makeServices>,
  stored: unknown,
): Promise<string> {
  const created = await corpusService.create({ type: "spec", title: "Stored anchors", content: "body" } as CreateDocInput);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  const updated = await store.update(
    created.value.id,
    { extra: { ...created.value.extra, code_anchors: stored }, version: created.value.version + 1 },
    { expected_version: created.value.version },
  );
  if (!updated.ok) throw new Error(`store.update failed: ${JSON.stringify(updated.error)}`);
  return created.value.id;
}

const probe: FsProbe = {
  stat: (path) => (path === "src/ok.ts" ? "file" : "missing"),
  readFile: () => null,
  listDir: () => null,
};

describe("HAPPY — task-a-stored-code-anchor-the-drift-check-cannot-read-is", () => {
  it("reports one unreadable stored anchor as an anchor_unreadable finding and fails the run", async () => {
    const services = makeServices();
    await createSpecWithStoredAnchors(services, [UNREADABLE]);
    const result = await services.driftCheckService.checkDrift(probe);
    if (!result.ok) throw new Error("checkDrift failed");
    expect(result.value.consistent).toBe(false);
    expect(result.value.drifts).toHaveLength(1);
    const row = result.value.drifts[0]!;
    expect(row.kind).toBe("anchor_unreadable");
    expect(row.anchor).toBe(UNREADABLE);
    expect(row.doc_slug).toContain("stored-anchors");
    expect(row.detail).toMatch(/\S/);
  });
});

describe("NEGATIVE — a document whose every anchor is unreadable", () => {
  it("is armed and counted in specs_checked and the status breakdown, not treated as having none", async () => {
    const services = makeServices();
    await createSpecWithStoredAnchors(services, [UNREADABLE, "../escape.ts"]);
    const result = await services.driftCheckService.checkDrift(probe);
    if (!result.ok) throw new Error("checkDrift failed");
    expect(result.value.armed).toBe(true);
    expect(result.value.specs_checked).toBe(1);
    expect(result.value.status_breakdown).toEqual({ draft: 1 });
    expect(result.value.drifts.map((d) => d.kind)).toEqual(["anchor_unreadable", "anchor_unreadable"]);
  });
});

describe("BOUNDARY — readable and unreadable anchors on one document", () => {
  it("still probes the readable anchor and reports only the unreadable one", async () => {
    const services = makeServices();
    await createSpecWithStoredAnchors(services, ["src/ok.ts", UNREADABLE]);
    const result = await services.driftCheckService.checkDrift(probe);
    if (!result.ok) throw new Error("checkDrift failed");
    expect(result.value.drifts.map((d) => [d.anchor, d.kind])).toEqual([[UNREADABLE, "anchor_unreadable"]]);
    expect(result.value.specs_checked).toBe(1);
  });
});

describe("ERROR — stored values that are not strings", () => {
  it("reports a non-string entry rather than filtering it away", async () => {
    const services = makeServices();
    await createSpecWithStoredAnchors(services, [42]);
    const result = await services.driftCheckService.checkDrift(probe);
    if (!result.ok) throw new Error("checkDrift failed");
    expect(result.value.drifts.map((d) => [d.anchor, d.kind])).toEqual([["42", "anchor_unreadable"]]);
  });

  it("reports a code_anchors value that is not a list", async () => {
    const services = makeServices();
    await createSpecWithStoredAnchors(services, "src/a.ts");
    const result = await services.driftCheckService.checkDrift(probe);
    if (!result.ok) throw new Error("checkDrift failed");
    expect(result.value.consistent).toBe(false);
    expect(result.value.drifts[0]?.kind).toBe("anchor_unreadable");
    expect(result.value.drifts[0]?.detail).toMatch(/list/);
  });
});

describe("STATE — repairing the unreadable anchor", () => {
  it("removeCodeAnchors accepts the stored raw string, after which the run is clean", async () => {
    const services = makeServices();
    const id = await createSpecWithStoredAnchors(services, [UNREADABLE, "src/ok.ts"]);
    const removed = await services.driftCheckService.removeCodeAnchors(id, [UNREADABLE]);
    expect(removed.ok).toBe(true);
    const result = await services.driftCheckService.checkDrift(probe);
    if (!result.ok) throw new Error("checkDrift failed");
    expect(result.value.consistent).toBe(true);
  });

  it("still refuses to remove a malformed string that is not stored", async () => {
    const services = makeServices();
    const id = await createSpecWithStoredAnchors(services, ["src/ok.ts"]);
    const removed = await services.driftCheckService.removeCodeAnchors(id, [UNREADABLE]);
    expect(removed.ok).toBe(false);
  });
});

describe("REGRESSION — rendering and the reverse index", () => {
  it("names the unreadable row and its repair in the text section", async () => {
    const services = makeServices();
    await createSpecWithStoredAnchors(services, [UNREADABLE]);
    const payload = await runDrift({ checkDrift: (p) => services.driftCheckService.checkDrift(p), listSpecs: async () => ok([]) }, probe);
    if (!payload.ok) throw new Error("runDrift failed");
    const text = renderDriftSectionLines(payload.value).join("\n");
    expect(text).toContain("anchor_unreadable");
    expect(text).toContain(UNREADABLE);
    expect(text).toContain("lore anchor rm");
  });

  it("listDeclaredAnchors keeps listing readable anchors only", async () => {
    const services = makeServices();
    await createSpecWithStoredAnchors(services, ["src/ok.ts", UNREADABLE]);
    const declared = await services.driftCheckService.listDeclaredAnchors();
    if (!declared.ok) throw new Error("listDeclaredAnchors failed");
    expect(declared.value.map((d) => d.anchor.raw)).toEqual(["src/ok.ts"]);
  });
});
