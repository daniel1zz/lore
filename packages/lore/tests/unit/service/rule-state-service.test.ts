/**
 * RED tests for `RuleStateService` (baseline slice 1 §C6) — read-time verification state of
 * baseline rules: precedence, unknown reasons, evidence -> AC attribution through plan
 * lineage, a git-free `counts` mode and a deterministic, memoisable `full` mode.
 *
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C6, §C7, QA-3/4/5
 *   (AC-BLS1-3, AC-BLS1-4, AC-BLS1-5). Paired implementation task: C7.
 *
 * ─── PINNED CONTRACT (the C7 implementer builds exactly this; do not reshape it) ───────────
 *
 * Module: `packages/lore/src/service/rule-state-service.ts`, export `RuleStateService`.
 *
 *   // Git is reached ONLY through this injected port. All three methods are synchronous
 *   // and return a Result; an `err` from any of them means "git unavailable / shallow".
 *   interface GitPort {
 *     headSha(): Result<string, LoreError>;                     // full 40-hex HEAD
 *     isAncestor(sha: string): Result<boolean, LoreError>;      // is `sha` an ancestor of HEAD
 *     changedSince(sha: string, paths: string[]): Result<boolean, LoreError>;
 *                                                               // true = `git diff --quiet <sha> HEAD -- paths` exits 1
 *   }
 *
 *   new RuleStateService(store: StoreInterface, git: GitPort)
 *   counts(): Promise<Result<RuleStateCounts, LoreError>>          // git-free: ZERO GitPort calls
 *   full(opts?: { rule?: string }): Promise<Result<RuleStateFull, LoreError>>
 *                                   // `rule: "BR-7"` narrows `rules` to that rule; an id no
 *                                   // live baseline leaf holds is an `err` (fail loud)
 *
 *   type RuleVerification = "contradicted" | "stale" | "verified" | "unverified" | "unknown";
 *   type UnknownReason = "no-commit-recorded" | "dirty" | "not-ancestor" | "git-unavailable";
 *
 *   interface RuleStateInput {              // one per (citing script-mode AC) — returned for EVERY state
 *     spec: string;                         // citing spec slug
 *     ac_id: string;
 *     evidence_recorded_at: string | null;  // latest ATTESTED, conclusive (pass|fail) run of the AC; null = none
 *     evidence_result: "pass" | "fail" | null;
 *     head_sha: string | null;              // that run's attestation.head_sha
 *     anchor_paths: string[];               // path part of the citing spec's extra.code_anchors, sorted
 *   }
 *   interface RuleStateEntry {
 *     rule_id: string;                      // "BR-n"
 *     leaf: string;                         // slug of the baseline leaf holding the rule
 *     state: RuleVerification;
 *     unknown_reason?: UnknownReason;       // present iff state === "unknown"
 *     inputs: RuleStateInput[];             // sorted by (spec, ac_id)
 *   }
 *   interface RuleStateFull {
 *     computed_from: { head_sha: string; corpus_version: number };  // corpus_version = max DocRecord.version over live docs
 *     ambiguous_ac_ref: number;             // evidence rows whose ac_ref resolves to >1 spec (excluded)
 *     rules: RuleStateEntry[];              // numeric ascending by rule id (BR-2 before BR-10)
 *   }
 *   interface RuleStateCounts {
 *     computed_from: { head_sha: null; corpus_version: number };    // no git in counts mode
 *     ambiguous_ac_ref: number;
 *     rules_total: number;
 *     by_verification: {
 *       contradicted: number;
 *       passing_staleness_unchecked: number; // attested pass present, staleness NOT evaluated.
 *                                            // counts mode NEVER emits a `verified` key (a verdict must
 *                                            // carry the state it describes); `full` keeps `verified`.
 *       unverified: number;
 *       stale: "not_computed";
 *     };
 *     stale_not_computed_reason: string;    // non-empty human reason (git-free mode)
 *   }
 *
 * Resolution rules pinned here:
 *   - Evidence -> AC goes through plan lineage keyed by (spec, AC): task.extra.plan_id -> plan
 *     (parent_id = spec). A task with NO plan lineage (ad-hoc) resolves by its `ac_scope` /
 *     the evidence `ac_ref` only if exactly ONE spec declares that AC id; otherwise the row is
 *     `ambiguous_ac_ref` (counted once per evidence row, attributed to 0 rules).
 *   - Only runner-attested (`attestation` present), conclusive (pass|fail) rows count; the
 *     latest by `recorded_at` per (spec, AC) wins. Self-reported rows never verify and never
 *     contradict.
 *   - E = citing ACs with verify.mode === "script". Precedence contradicted > stale >
 *     verified > unverified. unknown(reason) replaces stale/verified when the deciding pass
 *     has no head_sha / worktree_dirty / sha not an ancestor of HEAD / git unavailable.
 *   - GitPort budget in `full`: headSha <= 1 call total; isAncestor <= 1 and changedSince <= 1
 *     per distinct sha (changedSince receives the union of the citing specs' anchor paths).
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { DOC_TYPE_ROLE_MAP, err, ok } from "@lore/core";
import type {
  AcceptanceCriterion,
  DocRecord,
  DocType,
  EvidenceEntry,
  LoreError,
  Result,
} from "@lore/core";

// ─── Pinned contract types (mirrors the header; the implementation must satisfy these) ───

type RuleVerification = "contradicted" | "stale" | "verified" | "unverified" | "unknown";
type UnknownReason = "no-commit-recorded" | "dirty" | "not-ancestor" | "git-unavailable";

interface GitPort {
  headSha(): Result<string, LoreError>;
  isAncestor(sha: string): Result<boolean, LoreError>;
  changedSince(sha: string, paths: string[]): Result<boolean, LoreError>;
}

interface RuleStateInput {
  spec: string;
  ac_id: string;
  evidence_recorded_at: string | null;
  evidence_result: "pass" | "fail" | null;
  head_sha: string | null;
  anchor_paths: string[];
}
interface RuleStateEntry {
  rule_id: string;
  leaf: string;
  state: RuleVerification;
  unknown_reason?: UnknownReason;
  inputs: RuleStateInput[];
}
interface RuleStateFull {
  computed_from: { head_sha: string; corpus_version: number };
  ambiguous_ac_ref: number;
  rules: RuleStateEntry[];
}
interface RuleStateCounts {
  computed_from: { head_sha: null; corpus_version: number };
  ambiguous_ac_ref: number;
  rules_total: number;
  by_verification: {
    contradicted: number;
    passing_staleness_unchecked: number;
    unverified: number;
    stale: "not_computed";
  };
  stale_not_computed_reason: string;
}
interface RuleStateServiceLike {
  counts(): Promise<Result<RuleStateCounts, LoreError>>;
  full(opts?: { rule?: string }): Promise<Result<RuleStateFull, LoreError>>;
}
type RuleStateServiceCtor = new (store: StoreInterface, git: GitPort) => RuleStateServiceLike;

// ─── Loader: the module does not exist yet; every scenario must fail NAMING that ───────────

const SERVICE_MODULE = "../../../src/service/rule-state-service.js";

async function makeService(store: StoreInterface, git: GitPort): Promise<RuleStateServiceLike> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ SERVICE_MODULE)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(
      `MISSING BEHAVIOUR: RuleStateService (baseline slice 1 §C6) is not implemented — ` +
        `${SERVICE_MODULE} cannot be loaded (${String(cause)})`,
    );
  }
  const Ctor = mod["RuleStateService"] as RuleStateServiceCtor | undefined;
  if (Ctor === undefined) {
    throw new Error(
      "MISSING BEHAVIOUR: rule-state-service module does not export `RuleStateService` (baseline slice 1 §C6)",
    );
  }
  return new Ctor(store, git);
}

function must<T>(result: Result<T, LoreError>, what: string): T {
  if (!result.ok) throw new Error(`${what} returned err: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── Counting fake git port ────────────────────────────────────────────────────────────────

const sha = (c: string): string => c.repeat(40);
const HEAD = sha("f");
const OLD = sha("a");
const OLDER = sha("b");

interface GitCall {
  method: "headSha" | "isAncestor" | "changedSince";
  sha?: string;
  paths?: string[];
}

class CountingGit implements GitPort {
  readonly calls: GitCall[] = [];
  unavailable = false;
  /** shas that are NOT ancestors of HEAD */
  readonly nonAncestors = new Set<string>();
  /** shas whose anchors changed between sha and HEAD */
  readonly changed = new Set<string>();

  private gone(): Result<never, LoreError> {
    return err({ code: "STORE_ERROR", message: "git unavailable (fake)" } as LoreError);
  }
  headSha(): Result<string, LoreError> {
    this.calls.push({ method: "headSha" });
    return this.unavailable ? this.gone() : ok(HEAD);
  }
  isAncestor(s: string): Result<boolean, LoreError> {
    this.calls.push({ method: "isAncestor", sha: s });
    return this.unavailable ? this.gone() : ok(!this.nonAncestors.has(s));
  }
  changedSince(s: string, paths: string[]): Result<boolean, LoreError> {
    this.calls.push({ method: "changedSince", sha: s, paths: [...paths] });
    return this.unavailable ? this.gone() : ok(this.changed.has(s));
  }
  count(method: GitCall["method"], s?: string): number {
    return this.calls.filter((c) => c.method === method && (s === undefined || c.sha === s)).length;
  }
}

// ─── Corpus fixtures — raw store inserts; no RuleService / ac cite dependency ──────────────

const T0 = "2026-10-01T00:00:00.000Z";
const T1 = "2026-10-02T00:00:00.000Z";
const T2 = "2026-10-03T00:00:00.000Z";

let idSeq = 0;
function rawDoc(
  type: DocType,
  slug: string,
  extra: Record<string, unknown>,
  parentId: string | null,
  version = 1,
): DocRecord {
  idSeq += 1;
  return {
    id: `01TESTDOC${String(idSeq).padStart(17, "0")}`,
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
    version,
    deleted_at: null,
    tags: [],
    extra,
    ordinal: null,
  } as DocRecord;
}

async function put(store: StoreInterface, doc: DocRecord): Promise<DocRecord> {
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`fixture insert failed: ${JSON.stringify(r.error)}`);
  return doc;
}

function scriptAc(id: string, cites: string[] | undefined): AcceptanceCriterion {
  return {
    id,
    statement: `statement of ${id}`,
    verify: { mode: "script", oracle: "test", command: `bunx vitest run ${id.toLowerCase()}.test.ts` },
    ...(cites !== undefined ? { cites } : {}),
  };
}
function aiAc(id: string, cites: string[]): AcceptanceCriterion {
  return { id, statement: `statement of ${id}`, verify: { mode: "ai", rubric: "judge it" }, cites };
}

function attested(
  acRef: string,
  result: EvidenceEntry["result"],
  recordedAt: string,
  att: { head_sha?: string; worktree_dirty?: boolean } = {},
): EvidenceEntry {
  return {
    oracle: "test",
    command: `bunx vitest run ${acRef.toLowerCase()}.test.ts`,
    result,
    recorded_at: recordedAt,
    recorded_by: "agent:t",
    ac_ref: acRef,
    attestation: {
      runner: "lore-cli",
      exit_code: result === "pass" ? 0 : 1,
      duration_ms: 10,
      timed_out: false,
      ...att,
    },
  };
}
function selfReported(acRef: string, result: EvidenceEntry["result"], recordedAt: string): EvidenceEntry {
  return {
    oracle: "test",
    command: "bunx vitest run something",
    result,
    recorded_at: recordedAt,
    recorded_by: "agent:t",
    ac_ref: acRef,
  };
}

interface World {
  store: InMemoryStore;
  prd: DocRecord;
  /** a baseline leaf holding the given rule ids (live) */
  leaf(slug: string, ruleIds: string[]): Promise<DocRecord>;
  /** a spec declaring `acs`, with code anchors */
  spec(slug: string, acs: AcceptanceCriterion[], anchors?: string[]): Promise<DocRecord>;
  /** a plan parented under `spec` */
  plan(slug: string, spec: DocRecord): Promise<DocRecord>;
  /** a plan-member task (`extra.plan_id`) carrying evidence */
  task(slug: string, plan: DocRecord, evidence: EvidenceEntry[]): Promise<DocRecord>;
  /** an ad-hoc task: no plan lineage, parented under the root PRD, declaring `ac_scope` */
  adhocTask(slug: string, acScope: string[], evidence: EvidenceEntry[]): Promise<DocRecord>;
}

async function newWorld(): Promise<World> {
  const store = new InMemoryStore();
  const prd = await put(store, rawDoc("prd", "root-prd", {}, null));
  return {
    store,
    prd,
    leaf: (slug, ruleIds) =>
      put(
        store,
        rawDoc(
          "baseline",
          slug,
          {
            node: "leaf",
            rules: ruleIds.map((id) => ({
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
      ),
    spec: (slug, acs, anchors = ["packages/lore/src/service/foo.ts"]) =>
      put(store, rawDoc("spec", slug, { acceptance_criteria: acs, code_anchors: anchors }, prd.id)),
    plan: (slug, spec) => put(store, rawDoc("plan", slug, {}, spec.id)),
    task: (slug, plan, evidence) =>
      put(store, rawDoc("task", slug, { plan_id: plan.id, verification_evidence: evidence }, plan.id)),
    adhocTask: (slug, acScope, evidence) =>
      put(
        store,
        rawDoc("task", slug, { ac_scope: acScope, adhoc: true, verification_evidence: evidence }, prd.id),
      ),
  };
}

/** One leaf (BR-1) cited by one script AC of one spec with its own plan + task carrying `evidence`. */
async function singleRuleWorld(evidence: EvidenceEntry[], anchors?: string[]): Promise<World> {
  const w = await newWorld();
  await w.leaf("leaf-a", ["BR-1"]);
  const spec = await w.spec("spec-a", [scriptAc("AC-A-1", ["BR-1"])], anchors);
  const plan = await w.plan("plan-a", spec);
  await w.task("task-a", plan, evidence);
  return w;
}

async function runFull(world: World, git: CountingGit, opts?: { rule?: string }): Promise<RuleStateFull> {
  const svc = await makeService(world.store, git);
  return must(await svc.full(opts), "full()");
}
function entry(res: RuleStateFull, id: string): RuleStateEntry {
  const e = res.rules.find((r) => r.rule_id === id);
  if (e === undefined) throw new Error(`rule ${id} missing from full() result: ${JSON.stringify(res.rules)}`);
  return e;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// AC-BLS1-4 — full mode
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("AC-BLS1-4 RuleStateService.full — precedence", () => {
  it("contradicted: the latest attested run of a citing AC failed (even with an older passing run)", async () => {
    const w = await singleRuleWorld([
      attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-1", "fail", T1, { head_sha: OLD, worktree_dirty: false }),
    ]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("contradicted");
  });

  it("an older fail followed by a newer attested pass is NOT contradicted (latest run wins)", async () => {
    const w = await singleRuleWorld([
      attested("AC-A-1", "fail", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-1", "pass", T1, { head_sha: OLD, worktree_dirty: false }),
    ]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("verified");
  });

  it("stale: attested pass whose anchors changed between its head_sha and HEAD", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const git = new CountingGit();
    git.changed.add(OLD);
    const res = await runFull(w, git);
    expect(entry(res, "BR-1").state).toBe("stale");
  });

  it("verified: attested pass, ancestor sha, anchors unchanged since", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("verified");
  });

  it("unverified: no executable citing AC (a cited ai-mode AC with a passing attested row is not in E)", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1"]);
    const spec = await w.spec("spec-a", [aiAc("AC-A-1", ["BR-1"])]);
    const plan = await w.plan("plan-a", spec);
    await w.task("task-a", plan, [attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("unverified");
  });

  it("unverified: executable citing AC but no evidence at all", async () => {
    const w = await singleRuleWorld([]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("unverified");
  });

  it("unverified: a rule nobody cites", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1"]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("unverified");
  });

  it("precedence contradicted > stale: one AC failed while another AC's pass is stale", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1"]);
    const spec = await w.spec("spec-a", [scriptAc("AC-A-1", ["BR-1"]), scriptAc("AC-A-2", ["BR-1"])]);
    const plan = await w.plan("plan-a", spec);
    await w.task("task-a", plan, [
      attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-2", "fail", T0, { head_sha: OLDER, worktree_dirty: false }),
    ]);
    const git = new CountingGit();
    git.changed.add(OLD);
    const res = await runFull(w, git);
    expect(entry(res, "BR-1").state).toBe("contradicted");
  });

  it("precedence stale > verified: one AC's pass is current, another AC's pass is stale", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1"]);
    const spec = await w.spec("spec-a", [scriptAc("AC-A-1", ["BR-1"]), scriptAc("AC-A-2", ["BR-1"])]);
    const plan = await w.plan("plan-a", spec);
    await w.task("task-a", plan, [
      attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-2", "pass", T0, { head_sha: OLDER, worktree_dirty: false }),
    ]);
    const git = new CountingGit();
    git.changed.add(OLDER);
    const res = await runFull(w, git);
    expect(entry(res, "BR-1").state).toBe("stale");
  });

  it("precedence verified > unverified: one AC has an attested pass, a sibling AC has no evidence", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1"]);
    const spec = await w.spec("spec-a", [scriptAc("AC-A-1", ["BR-1"]), scriptAc("AC-A-2", ["BR-1"])]);
    const plan = await w.plan("plan-a", spec);
    await w.task("task-a", plan, [attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("verified");
  });
});

describe("AC-BLS1-4 RuleStateService.full — self-reported and inconclusive evidence never decide", () => {
  it("a self-reported pass alone never verifies", async () => {
    const w = await singleRuleWorld([selfReported("AC-A-1", "pass", T0)]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("unverified");
  });

  it("a self-reported fail does not contradict an attested pass", async () => {
    const w = await singleRuleWorld([
      attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      selfReported("AC-A-1", "fail", T2),
    ]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("verified");
  });

  it("a newer attested expected-fail / inconclusive row neither contradicts nor replaces the pass", async () => {
    const w = await singleRuleWorld([
      attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-1", "expected-fail", T1, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-1", "inconclusive", T2, { head_sha: OLD, worktree_dirty: false }),
    ]);
    const res = await runFull(w, new CountingGit());
    expect(entry(res, "BR-1").state).toBe("verified");
  });
});

describe("AC-BLS1-4 RuleStateService.full — the four unknown reasons", () => {
  it("attested pass WITHOUT head_sha -> unknown(no-commit-recorded), never verified", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "pass", T0)]);
    const e = entry(await runFull(w, new CountingGit()), "BR-1");
    expect(e.state).toBe("unknown");
    expect(e.unknown_reason).toBe("no-commit-recorded");
  });

  it("attested pass with worktree_dirty -> unknown(dirty)", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: true })]);
    const e = entry(await runFull(w, new CountingGit()), "BR-1");
    expect(e.state).toBe("unknown");
    expect(e.unknown_reason).toBe("dirty");
  });

  it("head_sha that is not an ancestor of HEAD -> unknown(not-ancestor)", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const git = new CountingGit();
    git.nonAncestors.add(OLD);
    const e = entry(await runFull(w, git), "BR-1");
    expect(e.state).toBe("unknown");
    expect(e.unknown_reason).toBe("not-ancestor");
  });

  it("git port unavailable -> unknown(git-unavailable) and full() still returns ok", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const git = new CountingGit();
    git.unavailable = true;
    const e = entry(await runFull(w, git), "BR-1");
    expect(e.state).toBe("unknown");
    expect(e.unknown_reason).toBe("git-unavailable");
  });

  it("a known state carries no unknown_reason", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const e = entry(await runFull(w, new CountingGit()), "BR-1");
    expect(e.state).toBe("verified");
    expect(e.unknown_reason).toBeUndefined();
  });

  it("a failing attested run still contradicts when git is unavailable (no git needed)", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "fail", T0, { head_sha: OLD, worktree_dirty: false })]);
    const git = new CountingGit();
    git.unavailable = true;
    expect(entry(await runFull(w, git), "BR-1").state).toBe("contradicted");
  });
});

describe("AC-BLS1-4 RuleStateService.full — inputs and computed_from", () => {
  it("returns, for every state, the inputs it was decided from", async () => {
    const w = await singleRuleWorld(
      [attested("AC-A-1", "pass", T1, { head_sha: OLD, worktree_dirty: false })],
      ["packages/lore/src/service/foo.ts#Foo", "packages/core/src/bar.ts"],
    );
    const e = entry(await runFull(w, new CountingGit()), "BR-1");
    expect(e.leaf).toBe("leaf-a");
    expect(e.inputs).toEqual([
      {
        spec: "spec-a",
        ac_id: "AC-A-1",
        evidence_recorded_at: T1,
        evidence_result: "pass",
        head_sha: OLD,
        anchor_paths: ["packages/core/src/bar.ts", "packages/lore/src/service/foo.ts"],
      },
    ]);
  });

  it("an unverified rule still lists its citing AC with null evidence inputs", async () => {
    const w = await singleRuleWorld([]);
    const e = entry(await runFull(w, new CountingGit()), "BR-1");
    expect(e.state).toBe("unverified");
    expect(e.inputs).toEqual([
      {
        spec: "spec-a",
        ac_id: "AC-A-1",
        evidence_recorded_at: null,
        evidence_result: null,
        head_sha: null,
        anchor_paths: ["packages/lore/src/service/foo.ts"],
      },
    ]);
  });

  it("a contradicted rule's inputs name the failing run", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "fail", T1, { head_sha: OLD, worktree_dirty: false })]);
    const e = entry(await runFull(w, new CountingGit()), "BR-1");
    expect(e.inputs[0]).toMatchObject({ ac_id: "AC-A-1", evidence_result: "fail", evidence_recorded_at: T1 });
  });

  it("computed_from = (HEAD sha, max corpus version over live docs)", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    await put(w.store, rawDoc("knowledge", "k-high-version", {}, null, 42));
    const res = await runFull(w, new CountingGit());
    expect(res.computed_from).toEqual({ head_sha: HEAD, corpus_version: 42 });
  });

  it("full({rule}) narrows to that rule; an unknown rule id fails loud", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1", "BR-2"]);
    const git = new CountingGit();
    const svc = await makeService(w.store, git);
    const one = must(await svc.full({ rule: "BR-2" }), "full({rule})");
    expect(one.rules.map((r) => r.rule_id)).toEqual(["BR-2"]);
    const missing = await svc.full({ rule: "BR-999" });
    expect(missing.ok).toBe(false);
  });
});

describe("AC-BLS1-4 RuleStateService.full — git budget and determinism", () => {
  it("calls the git port at most once per distinct sha (and headSha once), however many rules share it", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1", "BR-2", "BR-3"]);
    const spec = await w.spec("spec-a", [
      scriptAc("AC-A-1", ["BR-1"]),
      scriptAc("AC-A-2", ["BR-2"]),
      scriptAc("AC-A-3", ["BR-3"]),
    ]);
    const plan = await w.plan("plan-a", spec);
    await w.task("task-a", plan, [
      attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-2", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-3", "pass", T0, { head_sha: OLDER, worktree_dirty: false }),
    ]);
    const git = new CountingGit();
    const res = await runFull(w, git);
    expect(res.rules.map((r) => r.state)).toEqual(["verified", "verified", "verified"]);
    expect(git.count("headSha")).toBeLessThanOrEqual(1);
    for (const s of [OLD, OLDER]) {
      expect(git.count("isAncestor", s)).toBeLessThanOrEqual(1);
      expect(git.count("changedSince", s)).toBeLessThanOrEqual(1);
    }
    // the diff is over the citing spec's anchors, and was actually asked for each sha
    expect(git.count("changedSince", OLD)).toBe(1);
    expect(git.calls.find((c) => c.method === "changedSince" && c.sha === OLD)?.paths).toEqual([
      "packages/lore/src/service/foo.ts",
    ]);
  });

  it("makes no git call for a rule decided without git (no evidence / contradicted)", async () => {
    const w = await singleRuleWorld([attested("AC-A-1", "fail", T0, { head_sha: OLD, worktree_dirty: false })]);
    const git = new CountingGit();
    await runFull(w, git);
    expect(git.count("changedSince")).toBe(0);
  });

  it("identical output for identical (HEAD, corpus) inputs — across calls and fresh instances; rules numerically ordered", async () => {
    const w = await newWorld();
    await w.leaf("leaf-b", ["BR-10", "BR-2"]);
    await w.leaf("leaf-a", ["BR-1"]);
    const spec = await w.spec("spec-a", [scriptAc("AC-A-1", ["BR-1", "BR-2", "BR-10"])]);
    const plan = await w.plan("plan-a", spec);
    await w.task("task-a", plan, [attested("AC-A-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const git = new CountingGit();
    const svc = await makeService(w.store, git);
    const first = must(await svc.full(), "full#1");
    const second = must(await svc.full(), "full#2");
    const fresh = must(await (await makeService(w.store, new CountingGit())).full(), "full#fresh");
    expect(first.rules.map((r) => r.rule_id)).toEqual(["BR-1", "BR-2", "BR-10"]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(fresh)).toBe(JSON.stringify(first));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// AC-BLS1-5 — evidence -> AC attribution, ambiguity
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("AC-BLS1-5 evidence attribution through plan lineage", () => {
  it("evidence whose ac_ref matches ACs in 2 specs (no plan lineage to disambiguate) is attributed to 0 rules and counted once", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1", "BR-2"]);
    await w.spec("spec-one", [scriptAc("AC-DUP-1", ["BR-1"])]);
    await w.spec("spec-two", [scriptAc("AC-DUP-1", ["BR-2"])]);
    // ad-hoc task: no plan_id, so only the bare ac_ref could attribute it — and that is ambiguous
    await w.adhocTask("task-adhoc", ["AC-DUP-1"], [
      attested("AC-DUP-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
    ]);
    const res = await runFull(w, new CountingGit());
    expect(res.ambiguous_ac_ref).toBe(1);
    expect(entry(res, "BR-1").state).toBe("unverified");
    expect(entry(res, "BR-2").state).toBe("unverified");
    expect(entry(res, "BR-1").inputs[0]?.evidence_recorded_at).toBeNull();
    expect(entry(res, "BR-2").inputs[0]?.evidence_recorded_at).toBeNull();
  });

  it("falsifier: a failing ambiguous row must not contradict either spec's rule (bare-id resolution would)", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1", "BR-2"]);
    await w.spec("spec-one", [scriptAc("AC-DUP-1", ["BR-1"])]);
    await w.spec("spec-two", [scriptAc("AC-DUP-1", ["BR-2"])]);
    await w.adhocTask("task-adhoc", ["AC-DUP-1"], [
      attested("AC-DUP-1", "fail", T0, { head_sha: OLD, worktree_dirty: false }),
    ]);
    const res = await runFull(w, new CountingGit());
    expect(res.ambiguous_ac_ref).toBe(1);
    expect(entry(res, "BR-1").state).not.toBe("contradicted");
    expect(entry(res, "BR-2").state).not.toBe("contradicted");
  });

  it("a plan-lineage task resolves a shared AC id to ITS spec only — not ambiguous, other spec untouched", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1", "BR-2"]);
    const specOne = await w.spec("spec-one", [scriptAc("AC-DUP-1", ["BR-1"])]);
    await w.spec("spec-two", [scriptAc("AC-DUP-1", ["BR-2"])]);
    const plan = await w.plan("plan-one", specOne);
    await w.task("task-one", plan, [attested("AC-DUP-1", "pass", T0, { head_sha: OLD, worktree_dirty: false })]);
    const res = await runFull(w, new CountingGit());
    expect(res.ambiguous_ac_ref).toBe(0);
    expect(entry(res, "BR-1").state).toBe("verified");
    expect(entry(res, "BR-2").state).toBe("unverified");
  });

  it("two ambiguous evidence rows are counted as 2", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1", "BR-2"]);
    await w.spec("spec-one", [scriptAc("AC-DUP-1", ["BR-1"])]);
    await w.spec("spec-two", [scriptAc("AC-DUP-1", ["BR-2"])]);
    await w.adhocTask("task-adhoc", ["AC-DUP-1"], [
      attested("AC-DUP-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-DUP-1", "pass", T1, { head_sha: OLD, worktree_dirty: false }),
    ]);
    const res = await runFull(w, new CountingGit());
    expect(res.ambiguous_ac_ref).toBe(2);
  });

  it("an ad-hoc task whose ac_ref matches exactly ONE spec is attributed to it (not ambiguous)", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1"]);
    await w.spec("spec-one", [scriptAc("AC-ONLY-1", ["BR-1"])]);
    await w.adhocTask("task-adhoc", ["AC-ONLY-1"], [
      attested("AC-ONLY-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
    ]);
    const res = await runFull(w, new CountingGit());
    expect(res.ambiguous_ac_ref).toBe(0);
    expect(entry(res, "BR-1").state).toBe("verified");
  });

  it("counts mode reports the same ambiguous_ac_ref", async () => {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1", "BR-2"]);
    await w.spec("spec-one", [scriptAc("AC-DUP-1", ["BR-1"])]);
    await w.spec("spec-two", [scriptAc("AC-DUP-1", ["BR-2"])]);
    await w.adhocTask("task-adhoc", ["AC-DUP-1"], [
      attested("AC-DUP-1", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
    ]);
    const svc = await makeService(w.store, new CountingGit());
    const counts = must(await svc.counts(), "counts()");
    expect(counts.ambiguous_ac_ref).toBe(1);
    expect(counts.by_verification.passing_staleness_unchecked).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// AC-BLS1-3 — counts mode
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("AC-BLS1-3 RuleStateService.counts — git-free", () => {
  async function countsWorld(): Promise<World> {
    const w = await newWorld();
    await w.leaf("leaf-a", ["BR-1", "BR-2", "BR-3", "BR-4"]);
    const spec = await w.spec("spec-a", [
      scriptAc("AC-A-1", ["BR-1"]), // will fail  -> contradicted
      scriptAc("AC-A-2", ["BR-2"]), // will pass  -> verified (staleness not evaluated)
      scriptAc("AC-A-3", ["BR-3"]), // pass, but self-reported only -> unverified
      // BR-4 is cited by nothing -> unverified
    ]);
    const plan = await w.plan("plan-a", spec);
    await w.task("task-a", plan, [
      attested("AC-A-1", "fail", T0, { head_sha: OLD, worktree_dirty: false }),
      attested("AC-A-2", "pass", T0, { head_sha: OLD, worktree_dirty: false }),
      selfReported("AC-A-3", "pass", T0),
    ]);
    return w;
  }

  it("returns rule counts by verification state", async () => {
    const w = await countsWorld();
    const svc = await makeService(w.store, new CountingGit());
    const c = must(await svc.counts(), "counts()");
    expect(c.rules_total).toBe(4);
    expect(c.by_verification.contradicted).toBe(1);
    expect(c.by_verification.passing_staleness_unchecked).toBe(1);
    expect(c.by_verification.unverified).toBe(2);
  });

  it("counts mode NEVER emits a `verified` key (staleness is not evaluated there)", async () => {
    const w = await countsWorld();
    const svc = await makeService(w.store, new CountingGit());
    const c = must(await svc.counts(), "counts()");
    expect(Object.keys(c.by_verification).sort()).toEqual([
      "contradicted",
      "passing_staleness_unchecked",
      "stale",
      "unverified",
    ]);
    expect("verified" in c.by_verification).toBe(false);
  });

  it("spawns 0 git operations in counts mode — not even headSha", async () => {
    const w = await countsWorld();
    const git = new CountingGit();
    const svc = await makeService(w.store, git);
    must(await svc.counts(), "counts()");
    expect(git.calls).toEqual([]);
  });

  it("reports stale as not_computed WITH a reason", async () => {
    const w = await countsWorld();
    const svc = await makeService(w.store, new CountingGit());
    const c = must(await svc.counts(), "counts()");
    expect(c.by_verification.stale).toBe("not_computed");
    expect(typeof c.stale_not_computed_reason).toBe("string");
    expect(c.stale_not_computed_reason.length).toBeGreaterThan(0);
  });

  it("counts mode is git-free even when git is unavailable (no unknown(git-unavailable) leak)", async () => {
    const w = await countsWorld();
    const git = new CountingGit();
    git.unavailable = true;
    const svc = await makeService(w.store, git);
    const c = must(await svc.counts(), "counts()");
    expect(git.calls).toEqual([]);
    expect(c.rules_total).toBe(4);
  });

  it("computed_from carries a null head_sha and the max corpus version", async () => {
    const w = await countsWorld();
    await put(w.store, rawDoc("knowledge", "k-high-version", {}, null, 17));
    const svc = await makeService(w.store, new CountingGit());
    const c = must(await svc.counts(), "counts()");
    expect(c.computed_from).toEqual({ head_sha: null, corpus_version: 17 });
  });

  it("an empty corpus yields rules_total 0 and zero counts (BOUNDARY)", async () => {
    const w = await newWorld();
    const svc = await makeService(w.store, new CountingGit());
    const c = must(await svc.counts(), "counts()");
    expect(c.rules_total).toBe(0);
    expect(c.by_verification).toEqual({
      contradicted: 0,
      passing_staleness_unchecked: 0,
      unverified: 0,
      stale: "not_computed",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// AC-BLS1-3 — performance (separate describe so it can be filtered: -t "performance")
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("AC-BLS1-3 RuleStateService.counts — performance", () => {
  const RUNS = 20;
  const P95_BUDGET_MS = 1500;

  /** 20 leaves x 10 rules, 40 specs x 5 script ACs (each citing 1-2 rules), 40 plans, 899 tasks + the root PRD = 1000 docs. */
  async function buildThousandDocWorld(): Promise<{ world: World; docCount: number }> {
    const world = await newWorld();
    let docs = 1; // the root PRD
    let rule = 0;
    const ruleIds: string[] = [];
    for (let l = 0; l < 20; l += 1) {
      const ids: string[] = [];
      for (let r = 0; r < 10; r += 1) {
        rule += 1;
        ids.push(`BR-${rule}`);
      }
      ruleIds.push(...ids);
      await world.leaf(`perf-leaf-${l}`, ids);
      docs += 1;
    }
    const plans: DocRecord[] = [];
    const acIdsBySpec: string[][] = [];
    for (let s = 0; s < 40; s += 1) {
      const acs: AcceptanceCriterion[] = [];
      for (let a = 0; a < 5; a += 1) {
        const first = ruleIds[(s * 5 + a) % ruleIds.length] as string;
        const second = ruleIds[(s * 5 + a + 7) % ruleIds.length] as string;
        acs.push(scriptAc(`AC-P${s}-${a}`, [first, second]));
      }
      acIdsBySpec.push(acs.map((c) => c.id));
      const spec = await world.spec(`perf-spec-${s}`, acs, [`packages/perf/src/m${s}.ts`]);
      plans.push(await world.plan(`perf-plan-${s}`, spec));
      docs += 2;
    }
    for (let t = 0; t < 899; t += 1) {
      const s = t % 40;
      const acId = acIdsBySpec[s]?.[t % 5] as string;
      await world.task(`perf-task-${t}`, plans[s] as DocRecord, [
        attested(acId, "pass", T0, { head_sha: OLD, worktree_dirty: false }),
        attested(acId, t % 11 === 0 ? "fail" : "pass", T1, { head_sha: OLDER, worktree_dirty: false }),
      ]);
      docs += 1;
    }
    return { world, docCount: docs };
  }

  it("p95 <= 1.5 s over 20 runs of counts mode on a 1000-doc corpus, with 0 git calls", async () => {
    const { world, docCount } = await buildThousandDocWorld();
    expect(docCount).toBe(1000);
    const git = new CountingGit();
    const svc = await makeService(world.store, git);

    const first = must(await svc.counts(), "counts() warm-up");
    expect(first.rules_total).toBe(200);

    const samples: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const t = performance.now();
      must(await svc.counts(), "counts()");
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(0.95 * RUNS) - 1] as number;
    expect(git.calls).toEqual([]);
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  }, 120_000);
});
