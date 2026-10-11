/**
 * RED suite for slice 3a BL-16 (D3): plan-close's `prdOutlineSynced` (domain-document edit proxy) is
 * retired and replaced by a RULE-STATE predicate over the rules the closing plan's spec criteria cite.
 *
 * @spec_ref AC-BLS3-5
 *
 * Spec: spec-baseline-slice-3a-architecture-tree-baseline-root (Design "Outline", D3) ; rule BR-984:
 *   "Closing a plan is refused when a rule cited by its spec's criteria is contradicted, or stale with
 *    no attested pass recorded by the plan's tasks since it went stale. The former requirement that a
 *    domain document was edited during the plan no longer applies."
 *   Config key `workflow.gates.plan-close.prd_sync.enabled` stays the on/off switch.
 *
 * CONTRACT (this RED task's interface choices; the implementer builds exactly these):
 *   1. Rule state is read through the slice-1 `RuleStateService` (`rule-state-service.ts`, `full()`),
 *      handed to the corpus service by a setter:
 *          corpusService.setRuleStateService(svc: { full(): Promise<Result<RuleStateFull, LoreError>> }): void
 *      Absent setter call => no rule state => the predicate has nothing to refuse on (bare unit
 *      constructions stay byte-identical). `app.ts` wires the real one (real GitPort).
 *   2. Refusal: `set(plan, {status: "archived"})` returns err `{ code: "VALIDATION_ERROR" }` (CLI exit 4),
 *      whose message names every offending rule id (e.g. "BR-5") and its state word ("contradicted" /
 *      "stale"), and names no rule that is fine. Its `field` is NOT pinned here (the old
 *      "gate:plan-close:prd-outline-synced" field must not appear, however).
 *   3. The old reason code `PRD_OUTLINE_NOT_SYNCED` / field `prd-outline-synced` is never produced.
 *   4. Rules "cited by the plan's spec criteria" = `spec.extra.acceptance_criteria[].cites` of the
 *      closing plan's resolved ancestor spec (`getPlanBundle().spec`). Only `contradicted` and `stale`
 *      refuse; `verified`, `unverified` and `unknown` do not (BR-984 names exactly two refusing states).
 *   5. A plan-close with the knob off (default) never consults rule state.
 *
 * SPEC GAP (reported, not tested): "stale with no attested pass from the plan's tasks since it went
 *   stale" - a pass recorded after staleness would make the latest run fresh and the rule `verified`,
 *   so the only reachable stale case is "no such pass"; the suite therefore pins stale+foreign-pass ->
 *   refused and fresh plan-task pass -> verified -> closes, and leaves the timing clause to the spec owner.
 *
 * Harness: real InMemoryStore + real GateEnforcer + real CorpusService + REAL RuleStateService; the only
 * fake is the git port (MOCK RISK: hides real `git diff`; the staleness *rule* is the real one).
 * Fixture docs are raw store inserts (the idiom of rule-state-service.test.ts).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { DOC_TYPE_ROLE_MAP, err, ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, DocType, EvidenceEntry, LoreConfig, LoreError, Result } from "@lore/core";

// ─── fake git port (shape pinned by rule-state-service.test.ts) ─────────────────────────────

const sha = (c: string): string => c.repeat(40);
const HEAD = sha("f");
const OLD = sha("a");

class FakeGit {
  readonly changed = new Set<string>();
  headSha(): Result<string, LoreError> {
    return ok(HEAD);
  }
  isAncestor(_s: string): Result<boolean, LoreError> {
    return ok(true);
  }
  changedSince(s: string, _paths: string[]): Result<boolean, LoreError> {
    return ok(this.changed.has(s));
  }
}
void err;

// ─── loader for the not-yet-wired pieces ────────────────────────────────────────────────────

interface RuleStateLike {
  full(): Promise<Result<unknown, LoreError>>;
}
async function makeRuleState(store: InMemoryStore, git: FakeGit): Promise<RuleStateLike> {
  const spec = "../../../src/service/rule-state-service.js";
  const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  const Ctor = mod["RuleStateService"] as new (s: InMemoryStore, g: FakeGit) => RuleStateLike;
  return new Ctor(store, git);
}

function wireRuleState(cs: CorpusService, svc: RuleStateLike): void {
  const setter = (cs as unknown as Record<string, unknown>)["setRuleStateService"];
  if (typeof setter !== "function") {
    throw new Error(
      "MISSING BEHAVIOUR: CorpusService.setRuleStateService(svc) does not exist - plan-close has no way to read rule state (BL-16 / BR-984)",
    );
  }
  (setter as (s: RuleStateLike) => void).call(cs, svc);
}

// ─── fixtures ───────────────────────────────────────────────────────────────────────────────

const T0 = "2026-10-01T00:00:00.000Z";
let seq = 0;
function rawDoc(type: DocType, slug: string, extra: Record<string, unknown>, parentId: string | null, status = "approved"): DocRecord {
  seq += 1;
  return {
    id: `01RSPCDOC${String(seq).padStart(17, "0")}`,
    slug,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: slug,
    status,
    priority: "medium",
    content: `# ${slug}\n\nOriginal narrative.`,
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
function attested(acRef: string, result: "pass" | "fail", at: string, headSha: string): EvidenceEntry {
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
      head_sha: headSha,
      worktree_dirty: false,
    },
  } as EvidenceEntry;
}

/** plan-close's ATTESTATION_SCOPE_UNDECLARED conjunct: an evidence-bearing task must declare its scope. */
function scopeOf(evidence: EvidenceEntry[]): string[] {
  return [...new Set(evidence.map((e) => e.ac_ref as string))];
}

function config(enabled: boolean): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    ...(enabled ? { workflow: { gates: { "plan-close": { prd_sync: { enabled: true } } } } } : {}),
  } as unknown as LoreConfig;
}

interface World {
  readonly store: InMemoryStore;
  readonly cs: CorpusService;
  readonly git: FakeGit;
  readonly spec: DocRecord;
  readonly plan: DocRecord;
  readonly domainDoc: DocRecord;
  /** a task of the CLOSING plan */
  task(slug: string, evidence: EvidenceEntry[]): Promise<DocRecord>;
  /** a task of ANOTHER plan on the SAME spec */
  foreignTask(slug: string, evidence: EvidenceEntry[]): Promise<DocRecord>;
}

/**
 * prd -> {domainDoc, spec(implements domainDoc)} ; plan under spec. The domain doc is NEVER edited:
 * under the retired predicate that alone refuses the close, so any "closes" outcome here proves the
 * domain-document-edit requirement is gone.
 */
async function world(opts: { enabled: boolean; rules: Record<string, string[]>; specAcs: AcceptanceCriterion[] }): Promise<World> {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store), undefined, undefined, new GateEnforcer(config(opts.enabled)));
  const git = new FakeGit();
  const prd = await put(store, rawDoc("prd", "root-prd", {}, null));
  for (const [leaf, ids] of Object.entries(opts.rules)) {
    await put(
      store,
      rawDoc(
        "baseline",
        leaf,
        {
          node: "leaf",
          rules: ids.map((id) => ({
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
  }
  const domainDoc = await put(store, rawDoc("spec", "domain-overview-billing", {}, prd.id));
  const spec = await put(
    store,
    rawDoc("spec", "feature-spec", { acceptance_criteria: opts.specAcs, code_anchors: ["packages/lore/src/service/foo.ts"] }, prd.id),
  );
  const link = await cs.link(spec.id, domainDoc.id, "implements");
  if (!link.ok) throw new Error(`link failed: ${JSON.stringify(link.error)}`);
  const plan = await put(store, rawDoc("plan", "closing-plan", {}, spec.id));
  const other = await put(store, rawDoc("plan", "other-plan", {}, spec.id));
  wireRuleState(cs, await makeRuleState(store, git));
  return {
    store,
    cs,
    git,
    spec,
    plan,
    domainDoc,
    task: (slug, evidence) =>
      put(store, rawDoc("task", slug, { plan_id: plan.id, ac_scope: scopeOf(evidence), verification_evidence: evidence }, plan.id, "draft")),
    foreignTask: (slug, evidence) =>
      put(store, rawDoc("task", slug, { plan_id: other.id, ac_scope: scopeOf(evidence), verification_evidence: evidence }, other.id, "draft")),
  };
}

async function close(w: World): Promise<Result<DocRecord, LoreError>> {
  return w.cs.set(w.plan.id, { status: "archived" });
}
function refusalText(r: Result<DocRecord, LoreError>): string {
  if (r.ok) throw new Error("expected a refusal, got ok");
  return JSON.stringify(r.error);
}

// ─── describe title pinned by AC-BLS3-5 ─────────────────────────────────────────────────────

describe("plan-close rule state (BL-16)", () => {
  // ---------- NEGATIVE: contradicted ----------

  it("refuses a close when a cited rule is contradicted: VALIDATION_ERROR naming the rule", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])] });
    await w.task("t1", [attested("AC-X-1", "fail", T0, OLD)]);

    const r = await close(w);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(r.error)).toContain("BR-5");
      expect(JSON.stringify(r.error).toLowerCase()).toContain("contradicted");
    }
  });

  it("names the OTHER contradicted rule when a different rule is the contradicted one (not a hardcoded id)", async () => {
    const w = await world({
      enabled: true,
      rules: { "leaf-a": ["BR-5", "BR-6"] },
      specAcs: [scriptAc("AC-X-1", ["BR-5"]), scriptAc("AC-X-2", ["BR-6"])],
    });
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD), attested("AC-X-2", "fail", T0, OLD)]);

    const text = refusalText(await close(w));

    expect(text).toContain("BR-6");
    expect(text).not.toContain("BR-5");
  });

  it("the refusal never carries the retired PRD_OUTLINE_NOT_SYNCED reason or prd-outline-synced field", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])] });
    await w.task("t1", [attested("AC-X-1", "fail", T0, OLD)]);

    const text = refusalText(await close(w));

    expect(text).not.toContain("PRD_OUTLINE_NOT_SYNCED");
    expect(text).not.toContain("prd-outline-synced");
  });

  // ---------- NEGATIVE: stale ----------

  it("refuses a close when a cited rule is stale and the closing plan's tasks recorded no pass", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-7"] }, specAcs: [scriptAc("AC-X-1", ["BR-7"])] });
    w.git.changed.add(OLD);
    await w.foreignTask("other-t", [attested("AC-X-1", "pass", T0, OLD)]);
    await w.task("t1", []);

    const r = await close(w);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(r.error)).toContain("BR-7");
      expect(JSON.stringify(r.error).toLowerCase()).toContain("stale");
      expect(JSON.stringify(r.error)).not.toContain("PRD_OUTLINE_NOT_SYNCED");
    }
  });

  it("a stale rule is refused for exactly the anchors-changed condition: same evidence, anchors unchanged -> closes", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-7"] }, specAcs: [scriptAc("AC-X-1", ["BR-7"])] });
    // git.changed left empty: the pass at OLD is still current -> verified
    await w.foreignTask("other-t", [attested("AC-X-1", "pass", T0, OLD)]);
    await w.task("t1", []);

    const r = await close(w);

    expect(r.ok).toBe(true);
  });

  // ---------- HAPPY: verified closes with no domain-document edit ----------

  it("closes when every cited rule is verified, with the linked domain document never edited", async () => {
    const w = await world({
      enabled: true,
      rules: { "leaf-a": ["BR-1", "BR-2"] },
      specAcs: [scriptAc("AC-X-1", ["BR-1"]), scriptAc("AC-X-2", ["BR-2"])],
    });
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD), attested("AC-X-2", "pass", T0, OLD)]);

    const r = await close(w);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("archived");
    const dd = await w.store.find(w.domainDoc.id);
    expect(dd.ok && dd.value?.version).toBe(1); // no domain-document edit happened
  });

  it("a plan whose spec cites no rule closes without a domain-document edit", async () => {
    const w = await world({ enabled: true, rules: {}, specAcs: [scriptAc("AC-X-1", [])] });
    await w.task("t1", []);

    const r = await close(w);

    expect(r.ok).toBe(true);
  });

  it("a contradicted rule that the plan's spec does NOT cite does not block the close", async () => {
    const w = await world({
      enabled: true,
      rules: { "leaf-a": ["BR-1", "BR-9"] },
      specAcs: [scriptAc("AC-X-1", ["BR-1"])],
    });
    // BR-9 is contradicted by a criterion of an unrelated spec
    const prdId = w.spec.parent_id as string;
    const unrelated = await put(w.store, rawDoc("spec", "unrelated-spec", { acceptance_criteria: [scriptAc("AC-U-1", ["BR-9"])], code_anchors: ["x.ts"] }, prdId));
    const unrelatedPlan = await put(w.store, rawDoc("plan", "unrelated-plan", {}, unrelated.id));
    await put(w.store, rawDoc("task", "unrelated-task", { plan_id: unrelatedPlan.id, ac_scope: ["AC-U-1"], verification_evidence: [attested("AC-U-1", "fail", T0, OLD)] }, unrelatedPlan.id, "draft"));
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD)]);

    const r = await close(w);

    expect(r.ok).toBe(true);
  });

  // ---------- BOUNDARY: only the two named states refuse (BR-984 literal) ----------

  it("a cited rule with no evidence at all (unverified) does not refuse the close", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-3"] }, specAcs: [scriptAc("AC-X-1", ["BR-3"])] });
    await w.task("t1", []);

    const r = await close(w);

    expect(r.ok).toBe(true);
  });

  // ---------- STATE: the config key stays the switch ----------

  it("with prd_sync disabled a contradicted cited rule does not refuse the close (knob off = predicate off)", async () => {
    const w = await world({ enabled: false, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])] });
    await w.task("t1", [attested("AC-X-1", "fail", T0, OLD)]);

    const r = await close(w);

    expect(r.ok).toBe(true);
  });

  // ---------- REGRESSION: the retired predicate is gone from the public surface ----------

  it("gate-predicates no longer exports prdOutlineSynced", async () => {
    const spec = "../../../src/service/gate-predicates.js";
    const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
    expect(mod["prdOutlineSynced"]).toBeUndefined();
  });
});
