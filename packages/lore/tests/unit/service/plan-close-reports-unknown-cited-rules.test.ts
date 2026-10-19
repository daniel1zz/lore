/**
 * task-plan-close-reports-cited-rules-whose-state-could-not-be-measured (baseline-close-a-plan BR-984):
 * with the cited-rule check on, a cited rule whose state is `unknown` must not pass silently.
 *   - git-unavailable (a measurement failure): the close is REFUSED (VALIDATION_ERROR, exit 4) naming the rule.
 *   - every other reason (no-code-anchors, no-commit-recorded, dirty, not-ancestor): the close SUCCEEDS and prints
 *     one line per rule on the gate warning channel (the BR-1303 channel) naming the rule and the reason.
 * Falsifier: today's silent pass (no line, no refusal).
 */
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RuleStateService } from "../../../src/service/rule-state-service.js";
import { DOC_TYPE_ROLE_MAP, err, ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, DocType, EvidenceEntry, LoreConfig, LoreError, Result } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const sha = (c: string): string => c.repeat(40);
const HEAD = sha("f");
const OLD = sha("a");

class FakeGit {
  readonly changed = new Set<string>();
  gitDown = false;
  headSha(): Result<string, LoreError> {
    return this.gitDown ? err({ code: "VALIDATION_ERROR", message: "git unavailable", field: "git" }) : ok(HEAD);
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

const T0 = "2026-10-01T00:00:00.000Z";
let seq = 0;
function rawDoc(type: DocType, slug: string, extra: Record<string, unknown>, parentId: string | null, status = "approved"): DocRecord {
  seq += 1;
  return {
    id: `01UNKDOC${String(seq).padStart(18, "0")}`,
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
function attested(acRef: string, result: "pass" | "fail", at: string, headSha: string, dirty = false): EvidenceEntry {
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
      worktree_dirty: dirty,
    },
  } as EvidenceEntry;
}
function scopeOf(evidence: EvidenceEntry[]): string[] {
  return [...new Set(evidence.map((e) => e.ac_ref as string))];
}
function config(enabled: boolean): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    ...(enabled ? { workflow: { gates: { "plan-close": { cited_rule_check: { enabled: true } } } } } : {}),
  } as unknown as LoreConfig;
}

interface World {
  readonly cs: CorpusService;
  readonly git: FakeGit;
  readonly lines: string[];
  readonly plan: DocRecord;
  task(slug: string, evidence: EvidenceEntry[]): Promise<DocRecord>;
}

async function world(opts: {
  enabled: boolean;
  rules: Record<string, string[]>;
  specAcs: AcceptanceCriterion[];
  anchors?: string[];
}): Promise<World> {
  const store = actedStore(new InMemoryStore());
  const lines: string[] = [];
  const cs = new CorpusService(
    store,
    new RecordLockService(store, new GateEnforcer(undefined)),
    undefined,
    undefined,
    new GateEnforcer(config(opts.enabled), undefined, undefined, undefined, {}, (l) => lines.push(l)),
  );
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
    rawDoc(
      "spec",
      "feature-spec",
      { acceptance_criteria: opts.specAcs, code_anchors: opts.anchors ?? ["packages/lore/src/service/foo.ts"] },
      prd.id,
    ),
  );
  const link = await cs.link(spec.id, domainDoc.id, "implements");
  if (!link.ok) throw new Error(`link failed: ${JSON.stringify(link.error)}`);
  const plan = await put(store, rawDoc("plan", "closing-plan", {}, spec.id));
  cs.setRuleStateService(new RuleStateService(store, git));
  return {
    cs,
    git,
    lines,
    plan,
    task: (slug, evidence) =>
      put(store, rawDoc("task", slug, { plan_id: plan.id, ac_scope: scopeOf(evidence), verification_evidence: evidence }, plan.id, "draft")),
  };
}

async function close(w: World): Promise<Result<DocRecord, LoreError>> {
  return w.cs.set(w.plan.id, { status: "archived" });
}

const UNKNOWN_PREFIX = "cited rule state unknown";

describe("task-plan-close-reports-cited-rules-whose-state-could-not-be-measured", () => {
  it("UNK-1 HAPPY: a cited rule with no code anchors closes ok AND prints the unknown line naming rule and reason", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])], anchors: [] });
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD)]);
    const r = await close(w);
    expect(r.ok).toBe(true);
    expect(w.lines).toContain(
      "cited rule state unknown: BR-5 (no-code-anchors: the citing spec declares no code anchors, so staleness was not measured)",
    );
    if (r.ok) {
      expect(r.value.extra["plan_close_unmeasured_cited_rules"]).toEqual([{ rule_id: "BR-5", reason: "no-code-anchors" }]);
    }
  });

  it("UNK-2 NEGATIVE: git unavailable refuses the close (VALIDATION_ERROR) naming the rule and the failed measurement", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])] });
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD)]);
    w.git.gitDown = true;
    const r = await close(w);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(r.error.message).toContain("BR-5");
      expect(r.error.message).toContain("git-unavailable");
      expect(r.error.message).toContain("could not be measured");
    }
  });

  it("UNK-3 STATE: a verified rule prints no unknown line and records no unmeasured field", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])] });
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD)]);
    const r = await close(w);
    expect(r.ok).toBe(true);
    expect(w.lines.filter((l) => l.startsWith(UNKNOWN_PREFIX))).toEqual([]);
    if (r.ok) expect(r.value.extra["plan_close_unmeasured_cited_rules"]).toBeUndefined();
  });

  it("UNK-4 BOUNDARY: a dirty-tree pass is reported (not refused), one line per unknown rule only", async () => {
    const w = await world({
      enabled: true,
      rules: { "leaf-a": ["BR-5", "BR-6"] },
      specAcs: [scriptAc("AC-X-1", ["BR-5"]), scriptAc("AC-X-2", ["BR-6"])],
    });
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD, true), attested("AC-X-2", "pass", T0, OLD)]);
    const r = await close(w);
    expect(r.ok).toBe(true);
    expect(w.lines.filter((l) => l.startsWith(UNKNOWN_PREFIX))).toEqual([
      "cited rule state unknown: BR-5 (dirty: the latest pass was recorded on a dirty worktree, so staleness was not measured)",
    ]);
  });

  it("UNK-5 REGRESSION: with the check setting off, git down and no anchors neither refuse nor print", async () => {
    const w = await world({ enabled: false, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])], anchors: [] });
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD)]);
    w.git.gitDown = true;
    const r = await close(w);
    expect(r.ok).toBe(true);
    expect(w.lines.filter((l) => l.startsWith(UNKNOWN_PREFIX))).toEqual([]);
  });

  it("UNK-6 REGRESSION: a contradicted rule still refuses, and is not reported as unknown", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])] });
    await w.task("t1", [attested("AC-X-1", "fail", T0, OLD)]);
    const r = await close(w);
    expect(r.ok).toBe(false);
    expect(w.lines.filter((l) => l.startsWith(UNKNOWN_PREFIX))).toEqual([]);
  });

  it("UNK-7 STATE: a no-code-anchors input never consults git, so git down does not turn it into a refusal", async () => {
    const w = await world({ enabled: true, rules: { "leaf-a": ["BR-5"] }, specAcs: [scriptAc("AC-X-1", ["BR-5"])], anchors: [] });
    await w.task("t1", [attested("AC-X-1", "pass", T0, OLD)]);
    w.git.gitDown = true;
    const r = await close(w);
    // no anchors -> nothing to diff, so git is never consulted for this input: it stays a reported unknown.
    expect(r.ok).toBe(true);
    expect(w.lines.some((l) => l.includes("no-code-anchors"))).toBe(true);
  });
});
