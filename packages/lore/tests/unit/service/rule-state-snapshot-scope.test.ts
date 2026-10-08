/**
 * @spec_ref AC-BLS2-9
 *
 * RED tests: the RuleStateService snapshot must read ONLY the doc types rule state depends on
 * (baseline, spec, plan, task) and must never fetch/parse knowledge docs.
 *
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C6 (snapshot narrowing).
 * Rationale: `lore status --json` measured 19.2 s; a large share is parsing every document.
 *
 * Expected (from the spec, not from the code):
 *   - every `store.findMany` filter issued while building the snapshot names a `type` in
 *     {baseline, spec, plan, task} — an unfiltered `findMany({})` is a defect;
 *   - zero knowledge docs are returned to the service;
 *   - computed rule states are identical to the states on the same corpus without the
 *     knowledge docs (narrowing must not change any verdict).
 */
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { StoreFilters } from "../../../src/store/store-interface.js";
import { RuleStateService } from "../../../src/service/rule-state-service.js";
import { DOC_TYPE_ROLE_MAP, ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, DocType, EvidenceEntry, LoreError, Result } from "@lore/core";

const HEAD = "f".repeat(40);
const OLD = "a".repeat(40);
const T0 = "2026-10-01T00:00:00.000Z";
const T1 = "2026-10-02T00:00:00.000Z";
const NARROW: ReadonlySet<DocType> = new Set<DocType>(["baseline", "spec", "plan", "task"]);

const git = {
  headSha: (): Result<string, LoreError> => ok(HEAD),
  isAncestor: (): Result<boolean, LoreError> => ok(true),
  changedSince: (): Result<boolean, LoreError> => ok(false),
};

let seq = 0;
function rawDoc(type: DocType, slug: string, extra: Record<string, unknown>, parentId: string | null): DocRecord {
  seq += 1;
  return {
    id: `01SNAPDOC${String(seq).padStart(17, "0")}`,
    slug,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: slug,
    status: "approved",
    priority: "medium",
    content: `# ${slug}`,
    parent_id: parentId,
    created_at: T0,
    updated_at: T0,
    created_by: "agent:test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
    ordinal: null,
  } as DocRecord;
}

async function put(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`fixture insert failed: ${JSON.stringify(r.error)}`);
  return doc;
}

function scriptAc(id: string, cites: string[]): AcceptanceCriterion {
  return {
    id,
    statement: `statement of ${id}`,
    verify: { mode: "script", oracle: "test", command: `bunx vitest run ${id.toLowerCase()}.test.ts` },
    cites,
  };
}
function attested(acRef: string, result: EvidenceEntry["result"], at: string): EvidenceEntry {
  return {
    oracle: "test",
    command: `bunx vitest run ${acRef.toLowerCase()}.test.ts`,
    result,
    recorded_at: at,
    recorded_by: "agent:t",
    ac_ref: acRef,
    attestation: {
      runner: "lore-cli",
      exit_code: result === "pass" ? 0 : 1,
      duration_ms: 10,
      timed_out: false,
      head_sha: OLD,
      worktree_dirty: false,
    },
  };
}

/** BR-1 verified (attested pass), BR-2 contradicted (latest attested fail), BR-3 unverified (no evidence). */
async function buildCorpus(store: InMemoryStore, knowledgeCount: number): Promise<void> {
  const prd = await put(store, rawDoc("prd", "root-prd", {}, null));
  await put(
    store,
    rawDoc(
      "baseline",
      "leaf-a",
      {
        node: "leaf",
        rules: ["BR-1", "BR-2", "BR-3"].map((id) => ({
          id,
          statement: `behaviour ${id}`,
          confidence: "established",
          enforced_by: "guaranteed",
          examples: ["an example"],
          lifecycle: "live",
        })),
      },
      prd.id,
    ),
  );
  const spec = await put(
    store,
    rawDoc(
      "spec",
      "spec-a",
      {
        acceptance_criteria: [scriptAc("AC-A-1", ["BR-1"]), scriptAc("AC-A-2", ["BR-2"]), scriptAc("AC-A-3", ["BR-3"])],
        code_anchors: ["packages/lore/src/service/foo.ts"],
      },
      prd.id,
    ),
  );
  const plan = await put(store, rawDoc("plan", "plan-a", {}, spec.id));
  await put(
    store,
    rawDoc(
      "task",
      "task-a",
      {
        plan_id: plan.id,
        verification_evidence: [
          attested("AC-A-1", "pass", T0),
          attested("AC-A-2", "pass", T0),
          attested("AC-A-2", "fail", T1),
        ],
      },
      plan.id,
    ),
  );
  for (let i = 0; i < knowledgeCount; i += 1) {
    await put(store, rawDoc("knowledge", `kn-${i}`, { sub_type: "learning" }, prd.id));
  }
}

/** InMemoryStore that records every findMany filter and every doc type it hands back. */
class SpyStore extends InMemoryStore {
  readonly filters: Array<StoreFilters | undefined> = [];
  readonly returnedTypes: DocType[] = [];
  override async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
    this.filters.push(filters);
    const res = await super.findMany(filters);
    if (res.ok) for (const d of res.value) this.returnedTypes.push(d.type);
    return res;
  }
}

function stateMap(rules: ReadonlyArray<{ rule_id: string; state: string }>): Record<string, string> {
  return Object.fromEntries(rules.map((r) => [r.rule_id, r.state]));
}

describe("AC-BLS2-9 RuleStateService snapshot scope", () => {
  it("full(): every findMany filter names a type in {baseline, spec, plan, task}", async () => {
    const store = new SpyStore();
    await buildCorpus(store, 1000);
    store.filters.length = 0;
    const res = await new RuleStateService(store, git).full();
    expect(res.ok).toBe(true);
    const offending = store.filters.filter((f) => f?.type === undefined || !NARROW.has(f.type));
    expect(offending).toEqual([]);
  });

  it("full(): the snapshot queries all four needed types (narrowing must not drop one)", async () => {
    const store = new SpyStore();
    await buildCorpus(store, 10);
    store.filters.length = 0;
    await new RuleStateService(store, git).full();
    const queried = new Set(store.filters.map((f) => f?.type));
    expect([...queried].sort()).toEqual(["baseline", "plan", "spec", "task"]);
  });

  it("full(): 0 knowledge docs are returned to the service out of 1000 in the store", async () => {
    const store = new SpyStore();
    await buildCorpus(store, 1000);
    store.returnedTypes.length = 0;
    await new RuleStateService(store, git).full();
    expect(store.returnedTypes.filter((t) => t === "knowledge")).toHaveLength(0);
  });

  it("counts(): every findMany filter names a type in {baseline, spec, plan, task}", async () => {
    const store = new SpyStore();
    await buildCorpus(store, 1000);
    store.filters.length = 0;
    const res = await new RuleStateService(store, git).counts();
    expect(res.ok).toBe(true);
    const offending = store.filters.filter((f) => f?.type === undefined || !NARROW.has(f.type));
    expect(offending).toEqual([]);
  });

  it("rule states are unchanged by narrowing: known verdicts on a 1000-knowledge corpus", async () => {
    const store = new SpyStore();
    await buildCorpus(store, 1000);
    const res = await new RuleStateService(store, git).full();
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    expect(stateMap(res.value.rules)).toEqual({ "BR-1": "verified", "BR-2": "contradicted", "BR-3": "unverified" });
  });

  it("rule states equal those of the same corpus with zero knowledge docs", async () => {
    const big = new SpyStore();
    await buildCorpus(big, 1000);
    const bare = new SpyStore();
    await buildCorpus(bare, 0);
    const a = await new RuleStateService(big, git).full();
    const b = await new RuleStateService(bare, git).full();
    if (!a.ok || !b.ok) throw new Error("full() failed");
    expect(stateMap(a.value.rules)).toEqual(stateMap(b.value.rules));
  });
});
