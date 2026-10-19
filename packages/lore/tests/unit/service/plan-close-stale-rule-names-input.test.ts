/**
 * Plan-close refusal for a cited rule names WHICH citing criterion made the rule stale / contradicted.
 *
 * @spec_ref BR-984
 *
 * Task: task-plan-close-stale-rule-refusal-names-the-stale-citing. Two specs cite one rule. Spec A (the
 * closing plan's spec) passed at HEAD; spec B passed at an older commit, after which a file B anchors changed.
 * The refusal must name B's criterion, its pass sha, the changed path and `lore verify <B plan> --task <B task>`,
 * and must not name A's criterion. Harness: real InMemoryStore + GateEnforcer + CorpusService + RuleStateService
 * over a REAL throwaway git repository (SpawnGitPort) - nothing in the repo's own `.lore/` is touched.
 * VALIDATION_ERROR is the code the CLI maps to exit 4 (CITED_RULE_REFUTED rides in the message/feeding pack).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, DocType, EvidenceEntry, LoreConfig, LoreError, Result } from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { RuleStateService } from "../../../src/service/rule-state-service.js";
import { SpawnGitPort } from "../../../src/service/rule-state-git-port.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { actedStore } from "../../live-invocation.js";

const T0 = "2026-10-01T00:00:00.000Z";
const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Repo with OLD (a.ts + b.ts) then HEAD (b.ts changed). */
function makeRepo(): { root: string; oldSha: string; headSha: string } {
  const root = mkdtempSync(join(tmpdir(), "lore-pcsr-"));
  tmpRoots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.ts"), "a1\n");
  writeFileSync(join(root, "src/b.ts"), "b1\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "old");
  const oldSha = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "src/b.ts"), "b2\n");
  git(root, "commit", "-q", "-am", "change b");
  return { root, oldSha, headSha: git(root, "rev-parse", "HEAD") };
}

let seq = 0;
function rawDoc(type: DocType, slug: string, extra: Record<string, unknown>, parentId: string | null, status = "approved"): DocRecord {
  seq += 1;
  return {
    id: `01PCSRDOC${String(seq).padStart(17, "0")}`,
    slug,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: slug,
    status,
    priority: "medium",
    content: `# ${slug}\n\nNarrative.`,
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
function attested(acRef: string, result: "pass" | "fail", headSha: string): EvidenceEntry {
  return {
    oracle: "test",
    command: `bunx vitest run ${acRef.toLowerCase()}.test.ts`,
    result,
    recorded_at: T0,
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

interface TwoSpecWorld {
  readonly cs: CorpusService;
  readonly planA: DocRecord;
  readonly oldSha: string;
  readonly headSha: string;
}

async function twoSpecWorld(bResult: "pass" | "fail", bTaskHasPlan = true): Promise<TwoSpecWorld> {
  const repo = makeRepo();
  const store = actedStore(new InMemoryStore());
  const config = {
    project: { name: "t", author: "t" },
    workflow: { gates: { "plan-close": { cited_rule_check: { enabled: true } } } },
  } as unknown as LoreConfig;
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(config));
  const prd = await put(store, rawDoc("prd", "root-prd", {}, null));
  await put(
    store,
    rawDoc(
      "baseline",
      "leaf-a",
      {
        node: "leaf",
        rules: [
          { id: "BR-7", statement: "behaviour BR-7", confidence: "established", enforced_by: "guaranteed", examples: ["x"], lifecycle: "live" },
        ],
      },
      prd.id,
    ),
  );
  const domainDoc = await put(store, rawDoc("spec", "domain-overview-billing", {}, prd.id));
  const specA = await put(store, rawDoc("spec", "spec-a", { acceptance_criteria: [scriptAc("AC-A-1", ["BR-7"])], code_anchors: ["src/a.ts"] }, prd.id));
  const specB = await put(store, rawDoc("spec", "spec-b", { acceptance_criteria: [scriptAc("AC-B-1", ["BR-7"])], code_anchors: ["src/b.ts"] }, prd.id));
  const link = await cs.link(specA.id, domainDoc.id, "implements");
  if (!link.ok) throw new Error(`link failed: ${JSON.stringify(link.error)}`);
  const planA = await put(store, rawDoc("plan", "plan-a", {}, specA.id));
  const planB = await put(store, rawDoc("plan", "plan-b", {}, specB.id));
  await put(
    store,
    rawDoc("task", "task-a", { plan_id: planA.id, ac_scope: ["AC-A-1"], verification_evidence: [attested("AC-A-1", "pass", repo.headSha)] }, planA.id, "draft"),
  );
  await put(
    store,
    rawDoc("task", "task-b", { ...(bTaskHasPlan ? { plan_id: planB.id } : {}), ac_scope: ["AC-B-1"], verification_evidence: [attested("AC-B-1", bResult, repo.oldSha)] }, planB.id, "draft"),
  );
  cs.setRuleStateService(new RuleStateService(store, new SpawnGitPort(repo.root)));
  return { cs, planA, oldSha: repo.oldSha, headSha: repo.headSha };
}

async function closeA(w: TwoSpecWorld): Promise<{ message: string; code: string }> {
  const r: Result<DocRecord, LoreError> = await w.cs.set(w.planA.id, { status: "archived" });
  if (r.ok) throw new Error("expected the close to be refused");
  return r.error as { message: string; code: string };
}

describe("plan-close cited-rule refusal names the offending citing input (BR-984)", () => {
  it("AC-PCSR-1 stale: names spec B's criterion, pass sha, changed path and the verify command; never spec A's criterion", async () => {
    const w = await twoSpecWorld("pass");
    const error = await closeA(w);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("BR-7 (stale)");
    expect(error.message).toContain("AC-B-1");
    expect(error.message).toContain(w.oldSha);
    expect(error.message).toContain("src/b.ts");
    expect(error.message).toContain("lore verify plan-b --task task-b");
    expect(error.message).not.toContain("AC-A-1");
    expect(error.message).not.toContain("lore verify plan-a");
  });

  it("AC-PCSR-1 the rule text states BR-984 (stale by ANY citing spec, by any plan), not the retired 'this plan's tasks' claim", async () => {
    const w = await twoSpecWorld("pass");
    const error = await closeA(w);
    expect(error.message).toContain("by any plan");
    expect(error.message).not.toContain("recorded by this plan's tasks since it went stale");
  });

  it("AC-PCSR-2 contradicted: names the failing run (criterion, sha, verify command) the same way", async () => {
    const w = await twoSpecWorld("fail");
    const error = await closeA(w);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("BR-7 (contradicted)");
    expect(error.message).toContain("AC-B-1");
    expect(error.message).toContain(w.oldSha);
    expect(error.message).toContain("lore verify plan-b --task task-b");
    expect(error.message).not.toContain("AC-A-1");
  });

  it("AC-PCSR-3 a run whose task records no plan renders `lore verify --task <task>` (no invented plan)", async () => {
    const w = await twoSpecWorld("pass", false);
    const error = await closeA(w);
    expect(error.message).toContain("AC-B-1");
    expect(error.message).toContain("`lore verify --task task-b`");
    expect(error.message).not.toContain("lore verify plan-b");
  });
});
