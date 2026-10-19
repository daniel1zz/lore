/**
 * RED/GREEN suite: a superseded acceptance criterion (D15, `lore ac supersede`) must never contribute to a
 * baseline rule's verification state; only its superseding criterion does.
 *
 * Defect: RuleStateService still listed and counted a superseded criterion, so a rule whose old citing
 * criterion went stale read `stale` and `plan-close` (cited-rule-state predicate) refused over a criterion
 * nothing can ever re-verify (`lore verify` skips it). Shared predicate: `isAcSuperseded` (@lore/core).
 *
 * Harness: real InMemoryStore + real RuleStateService + real GateEnforcer/CorpusService (plan-close);
 * only the git port is fake (it answers "anchors changed since sha X"). Fixture docs are raw store inserts.
 */
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { RuleStateService } from "../../../src/service/rule-state-service.js";
import { DOC_TYPE_ROLE_MAP, ok } from "@lore/core";
import type { DocRecord, DocType, EvidenceEntry, LoreConfig, LoreError, Result } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const sha = (c: string): string => c.repeat(40);
const HEAD = sha("f");
const OLD = sha("a");
const NEW = sha("b");
const T0 = "2026-10-01T00:00:00.000Z";

class FakeGit {
  readonly changed = new Set<string>([OLD]);
  headSha(): Result<string, LoreError> {
    return ok(HEAD);
  }
  isAncestor(_s: string): Result<boolean, LoreError> {
    return ok(true);
  }
  changedSince(s: string, _paths: string[]): Result<boolean, LoreError> {
    return ok(this.changed.has(s));
  }
  changedPaths(s: string, paths: string[]): Result<string[], LoreError> {
    return ok(this.changed.has(s) ? [...paths] : []);
  }
}

let seq = 0;
function rawDoc(type: DocType, slug: string, extra: Record<string, unknown>, parentId: string | null, status = "approved"): DocRecord {
  seq += 1;
  return {
    id: `01SUPDOC${String(seq).padStart(18, "0")}`,
    slug,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: slug,
    status,
    priority: "medium",
    content: `# ${slug}\n\nbody`,
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
function attested(acRef: string, headSha: string): EvidenceEntry {
  return {
    oracle: "test",
    command: `bunx vitest run ${acRef.toLowerCase()}.test.ts`,
    result: "pass",
    recorded_at: T0,
    recorded_by: "agent:t",
    ac_ref: acRef,
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 10, timed_out: false, head_sha: headSha, worktree_dirty: false },
  } as EvidenceEntry;
}
function scriptAc(id: string, cites: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    statement: `statement of ${id}`,
    verify: { mode: "script", oracle: "test", command: `bunx vitest run ${id.toLowerCase()}.test.ts` },
    cites,
    ...extra,
  };
}

interface World {
  readonly cs: CorpusService;
  readonly svc: RuleStateService;
  readonly plan: DocRecord;
}

/**
 * Spec A (the closing plan's spec) cites BR-7 via AC-A-1: stale (pass at OLD, anchors changed since).
 * Spec B's AC-B-1 also cites BR-7 with a fresh pass; `supersede` marks AC-A-1 as superseded by it.
 */
async function world(opts: { supersede: boolean }): Promise<World> {
  const store = actedStore(new InMemoryStore());
  const config = { project: { name: "t", author: "t" }, workflow: { gates: { "plan-close": { cited_rule_check: { enabled: true } } } } } as unknown as LoreConfig;
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(config));
  const git = new FakeGit();
  const prd = await put(store, rawDoc("prd", "root-prd", {}, null));
  await put(
    store,
    rawDoc("baseline", "leaf-a", { node: "leaf", rules: [{ id: "BR-7", statement: "b", confidence: "established", enforced_by: "guaranteed", examples: ["e"], lifecycle: "live" }] }, prd.id),
  );
  const domainDoc = await put(store, rawDoc("spec", "domain-overview-billing", {}, prd.id));
  const specB = await put(
    store,
    rawDoc("spec", "spec-b", { acceptance_criteria: [scriptAc("AC-B-1", ["BR-7"])], code_anchors: ["packages/lore/src/service/foo.ts"] }, prd.id),
  );
  const superseded = opts.supersede
    ? { superseded_by: { spec: specB.id, ac: "AC-B-1", reason: "moved", by: "agent:t", at: T0 } }
    : {};
  const specA = await put(
    store,
    rawDoc("spec", "spec-a", { acceptance_criteria: [scriptAc("AC-A-1", ["BR-7"], superseded)], code_anchors: ["packages/lore/src/service/foo.ts"] }, prd.id),
  );
  const link = await cs.link(specA.id, domainDoc.id, "implements");
  if (!link.ok) throw new Error(`link failed: ${JSON.stringify(link.error)}`);
  const plan = await put(store, rawDoc("plan", "closing-plan", {}, specA.id));
  const planB = await put(store, rawDoc("plan", "plan-b", {}, specB.id));
  const planA0 = await put(store, rawDoc("plan", "plan-a-old", {}, specA.id));
  await put(store, rawDoc("task", "a-old-task", { plan_id: planA0.id, ac_scope: ["AC-A-1"], verification_evidence: [attested("AC-A-1", OLD)] }, planA0.id, "draft"));
  await put(store, rawDoc("task", "b-task", { plan_id: planB.id, ac_scope: ["AC-B-1"], verification_evidence: [attested("AC-B-1", NEW)] }, planB.id, "draft"));
  const svc = new RuleStateService(store, git);
  cs.setRuleStateService(svc);
  return { cs, svc, plan };
}

describe("rule state ignores superseded criteria", () => {
  it("falsifier: WITHOUT the supersede the rule is stale, lists both citing criteria, and plan-close refuses", async () => {
    const w = await world({ supersede: false });
    const full = await w.svc.full({ rule: "BR-7" });
    expect(full.ok && full.value.rules[0]?.state).toBe("stale");
    expect(full.ok && full.value.rules[0]?.inputs.map((i) => i.ac_id)).toEqual(["AC-A-1", "AC-B-1"]);
    const r = await w.cs.set(w.plan.id, { status: "archived" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(r.error)).toContain("BR-7");
      expect(JSON.stringify(r.error).toLowerCase()).toContain("stale");
    }
  });

  it("with AC-A-1 superseded the rule is verified, only the superseding criterion is an input, and plan-close closes", async () => {
    const w = await world({ supersede: true });
    const full = await w.svc.full({ rule: "BR-7" });
    expect(full.ok && full.value.rules[0]?.state).toBe("verified");
    expect(full.ok && full.value.rules[0]?.inputs.map((i) => i.ac_id)).toEqual(["AC-B-1"]);
    const r = await w.cs.set(w.plan.id, { status: "archived" });
    expect(r.ok).toBe(true);
  });
});
