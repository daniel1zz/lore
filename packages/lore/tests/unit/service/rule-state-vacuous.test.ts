/**
 * Vacuous-truth scenarios for `RuleStateService.full` (baseline slice 1 §C6, North Star
 * property 2: "vacuously true must be distinguishable from true").
 *
 * A passing run of a citing spec that declares NO `code_anchors` proves nothing about
 * staleness ("anchored code unchanged since the pass" is vacuous), so it must surface as
 * `unknown(no-code-anchors)`, never `verified`. Rule state = contradicted if any input
 * failed, else stale if any stale, else verified if >= 1 input verified, else the first
 * unknown input's reason, else unverified. `counts()` is unchanged (never evaluates staleness).
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { RuleStateService } from "../../../src/service/rule-state-service.js";
import type { GitPort } from "../../../src/service/rule-state-service.js";
import { DOC_TYPE_ROLE_MAP, ok } from "@lore/core";
import type { DocRecord, DocType, EvidenceEntry } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const OLD = "a".repeat(40);
const HEAD = "f".repeat(40);
const T0 = "2026-10-01T00:00:00.000Z";

const git: GitPort = {
  headSha: () => ok(HEAD),
  isAncestor: () => ok(true),
  changedSince: () => ok(false),
};

let seq = 0;
function doc(type: DocType, slug: string, extra: Record<string, unknown>, parentId: string | null): DocRecord {
  seq += 1;
  return {
    id: `01VACUOUS${String(seq).padStart(17, "0")}`,
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

function attested(acRef: string, result: "pass" | "fail"): EvidenceEntry {
  return {
    oracle: "test",
    command: `bunx vitest run ${acRef}`,
    result,
    recorded_at: T0,
    recorded_by: "agent:t",
    ac_ref: acRef,
    attestation: {
      runner: "lore-cli",
      exit_code: result === "pass" ? 0 : 1,
      duration_ms: 1,
      timed_out: false,
      head_sha: OLD,
      worktree_dirty: false,
    },
  };
}

function scriptAc(id: string): Record<string, unknown> {
  return { id, statement: id, verify: { mode: "script", oracle: "test", command: `bunx vitest run ${id}` }, cites: ["BR-1"] };
}

interface SpecSetup {
  slug: string;
  anchors: string[];
  result: "pass" | "fail";
}

async function build(specs: SpecSetup[]): Promise<InMemoryStore> {
  const store = actedStore(new InMemoryStore());
  const put = async (d: DocRecord): Promise<DocRecord> => {
    const r = await store.insert(d);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return d;
  };
  const prd = await put(doc("prd", "root-prd", {}, null));
  await put(
    doc(
      "baseline",
      "leaf-a",
      {
        node: "leaf",
        rules: [{ id: "BR-1", statement: "s", confidence: "established", enforced_by: "guaranteed", examples: ["e"], lifecycle: "live" }],
      },
      prd.id,
    ),
  );
  for (const s of specs) {
    const acId = `AC-${s.slug.toUpperCase()}-1`;
    const spec = await put(doc("spec", s.slug, { acceptance_criteria: [scriptAc(acId)], code_anchors: s.anchors }, prd.id));
    const plan = await put(doc("plan", `plan-${s.slug}`, {}, spec.id));
    await put(doc("task", `task-${s.slug}`, { plan_id: plan.id, verification_evidence: [attested(acId, s.result)] }, plan.id));
  }
  return store;
}

async function stateOf(store: InMemoryStore): Promise<{ state: string; reason?: string }> {
  const res = await new RuleStateService(store, git).full();
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  const e = res.value.rules[0];
  if (e === undefined) throw new Error("no rule");
  return { state: e.state, ...(e.unknown_reason !== undefined ? { reason: e.unknown_reason } : {}) };
}

describe("RuleStateService.full — vacuous staleness (no code_anchors)", () => {
  it("(a) a pass on an anchorless spec is unknown(no-code-anchors), never verified", async () => {
    const store = await build([{ slug: "bare", anchors: [], result: "pass" }]);
    expect(await stateOf(store)).toEqual({ state: "unknown", reason: "no-code-anchors" });
  });

  it("(b) the same rule also passing on an anchored spec is verified (>= 1 verifiable input)", async () => {
    const store = await build([
      { slug: "bare", anchors: [], result: "pass" },
      { slug: "anchored", anchors: ["packages/x/src/a.ts"], result: "pass" },
    ]);
    expect(await stateOf(store)).toEqual({ state: "verified" });
  });

  it("(c) an anchorless pass plus a failing anchored run is contradicted", async () => {
    const store = await build([
      { slug: "bare", anchors: [], result: "pass" },
      { slug: "anchored", anchors: ["packages/x/src/a.ts"], result: "fail" },
    ]);
    expect(await stateOf(store)).toEqual({ state: "contradicted" });
  });

  it("counts() still reports the anchorless pass as passing_staleness_unchecked", async () => {
    const store = await build([{ slug: "bare", anchors: [], result: "pass" }]);
    const c = await new RuleStateService(store, git).counts();
    if (!c.ok) throw new Error(JSON.stringify(c.error));
    expect(c.value.by_verification.passing_staleness_unchecked).toBe(1);
  });
});
