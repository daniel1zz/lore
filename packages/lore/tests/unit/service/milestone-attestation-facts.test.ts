/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-3, BR-1498)
 *
 * Criteria attestation decided from bound evidence, against a throwaway git repo (main with a merged task branch) and
 * hand-built docs (no corpus is touched).
 *
 * Dimensions: HAPPY (bound pass / later-main fail decide; AI judge fail fails the gate), NEGATIVE (worktree-only and
 * before-landing attestations never decide, pass or fail), BOUNDARY (no criteria, human/superseded skipped, several
 * attestations: latest bound wins), ERROR (unreadable ancestry, unlanded task, failing attester), STATE (the batch attests
 * landed criteria at the landing commit so a worktree-only criterion is pass at review time; an already-bound criterion
 * is never re-run), REGRESSION (a batch without the step leaves it not-measured).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { err, ok, type DocRecord, type LoreError, type MilestoneFacts, type PlanBundle, type Result } from "@lore/core";
import {
  attestLandedCriteria,
  attestationFacts,
  attestationRowsOf,
  planCriterionScopes,
  type AttestationRow,
  type CriterionScope,
  type LandingAttesterPort,
  type MainFirstParentPort,
} from "../../../src/service/milestone-attestation-facts.js";
import { factsDimensions } from "../../../src/service/milestone-review-judgment.js";
import { ReviewBatchRunner, type BatchRunPorts } from "../../../src/service/review-batch-service.js";
import { createGitMainFirstParent } from "../../../src/adapters/cli/assess-main-first-parent.js";
import { answerJson, buildJudgmentFixture } from "../../helpers/milestone-judgment-fixture.js";

let repo = "";
let A = "";
let W = "";
let B = "";
let L = "";
let M = "";

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}

function commit(file: string, message: string): string {
  writeFileSync(join(repo, file), message);
  git("add", file);
  git("commit", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-attest-facts-"));
  git("init", "-b", "main");
  A = commit("a.txt", "root");
  git("checkout", "-b", "work");
  W = commit("w.txt", "worktree commit");
  git("checkout", "main");
  B = commit("b.txt", "main before the landing");
  git("merge", "--no-ff", "work", "-m", "landing");
  L = git("rev-parse", "HEAD");
  M = commit("m.txt", "later main commit");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

const main = (): MainFirstParentPort => createGitMainFirstParent(repo, process.env);

const scope = (ac: string, landing: string | undefined, mode: CriterionScope["mode"] = "script"): CriterionScope => ({
  spec_slug: "spec-one",
  ac_id: ac,
  mode,
  ...(mode === "ai" ? { rubric: "rubric" } : {}),
  holders: [{ task_slug: "task-one", ...(landing !== undefined ? { landing_commit: landing } : {}) }],
});

let n = 0;
const row = (ac: string, result: "pass" | "fail", head_sha: string): AttestationRow => ({
  id: `task-one@2026-10-29T10:00:${String(++n).padStart(2, "0")}.000Z`,
  spec_slug: "spec-one",
  ac_id: ac,
  result,
  head_sha,
  recorded_at: `2026-10-29T10:00:${String(n).padStart(2, "0")}.000Z`,
});

describe("AC-AF-3 correctness from bound evidence", () => {
  it("AC-AF-3 HAPPY: the real git port holds the landing and later main commits, not the worktree commit or the commit before", async () => {
    const set = (await main().commitsFrom(L)) as Result<ReadonlySet<string> | null, LoreError>;
    expect(set.ok && set.value !== null && [...set.value].sort()).toEqual([L, M].sort());
    const w = await main().commitsFrom(W);
    expect(w.ok && w.value).toBeNull();
  });

  it("AC-AF-3 HAPPY: a pass attested at the landing commit counts as pass", async () => {
    const facts = await attestationFacts([scope("AC-1", L)], [row("AC-1", "pass", L)], main());
    expect(facts.rows).toEqual([expect.objectContaining({ subject: "spec-one:AC-1", verdict: "pass" })]);
    expect(factsDimensions({ attestation: facts.rows }, []).correctness_vs_acs.verdict).toBe("pass");
  });

  it("AC-AF-3 HAPPY: an attested fail on a later main commit fails the gate naming the criterion; the latest bound row decides", async () => {
    const pass = row("AC-1", "pass", L);
    const fail = row("AC-1", "fail", M);
    const facts = await attestationFacts([scope("AC-1", L)], [pass, fail], main());
    expect(facts.rows[0]).toMatchObject({ verdict: "fail" });
    expect(facts.deciding_ids).toEqual([{ subject: "spec-one:AC-1", id: fail.id }]);
    const dim = factsDimensions({ attestation: facts.rows }, []).correctness_vs_acs;
    expect(dim.verdict).toBe("fail");
    expect(dim.reason).toContain("spec-one:AC-1");
  });

  it("AC-AF-3 NEGATIVE: a pass or a fail attested only on a worktree commit is not-measured naming the criterion", async () => {
    const facts = await attestationFacts([scope("AC-1", L), scope("AC-2", L)], [row("AC-1", "pass", W), row("AC-2", "fail", W)], main());
    expect(facts.rows.map((r) => r.verdict)).toEqual(["not-measured", "not-measured"]);
    expect(facts.rows[0]?.subject).toBe("spec-one:AC-1");
    expect(facts.deciding_ids).toEqual([]);
    const dim = factsDimensions({ attestation: facts.rows }, []).correctness_vs_acs;
    expect(dim.verdict).toBe("not-measured");
    expect(dim.reason).toContain("spec-one:AC-1");
    expect(dim.reason).toContain("spec-one:AC-2");
  });

  it("AC-AF-3 NEGATIVE: an attestation on main before the task landed never decides, pass or fail", async () => {
    const facts = await attestationFacts([scope("AC-1", L), scope("AC-2", L)], [row("AC-1", "pass", B), row("AC-2", "fail", A)], main());
    expect(facts.rows.map((r) => r.verdict)).toEqual(["not-measured", "not-measured"]);
  });

  it("AC-AF-3 AI: an AI-mode criterion the AI judge double rules fail fails the gate", async () => {
    const attested = await attestationFacts([scope("AC-1", L), scope("AC-9", L, "ai")], [row("AC-1", "pass", L)], main());
    expect(attested.ai_criteria).toEqual([{ spec: "spec-one", ac: "AC-9", rubric: "rubric" }]);
    const allPass = {
      spec_conformance: { verdict: "pass" },
      design_necessity: { verdict: "pass" },
      concurrency_safety: { verdict: "pass" },
      security: { verdict: "pass" },
    };
    const fx = buildJudgmentFixture(() => answerJson(allPass, { criteria: [{ spec: "spec-one", ac: "AC-9", verdict: "fail", reason: "rubric not met" }] }), {
      facts: { attestation: attested.rows, ai_criteria: attested.ai_criteria },
    });
    await fx.review({});
    const dim = fx.stored()!.dimensions.correctness_vs_acs;
    expect(dim.verdict).toBe("fail");
    expect(dim.reason).toContain("spec-one:AC-9");
  });

  it("AC-AF-3 BOUNDARY: a plan with no live script or AI criterion is na naming that no criterion is in scope, human criteria are left to UAT", async () => {
    const none = await attestationFacts([], [], main());
    expect(none.rows).toEqual([expect.objectContaining({ verdict: "na", detail: expect.stringContaining("no criterion in scope") })]);
    const human = await attestationFacts([scope("AC-H", L, "human")], [], main());
    expect(human.rows).toEqual([expect.objectContaining({ verdict: "na", detail: expect.stringContaining("no criterion in scope") })]);
  });

  it("AC-AF-3 ERROR: an unreadable history and a task with no landing are not-measured, never pass", async () => {
    const broken: MainFirstParentPort = { commitsFrom: async () => err({ code: "STORE_ERROR", message: "git exploded" }) };
    const unreadable = await attestationFacts([scope("AC-1", L)], [row("AC-1", "pass", L)], broken);
    expect(unreadable.rows[0]).toMatchObject({ verdict: "not-measured" });
    expect(unreadable.rows[0]?.detail).toContain("git exploded");
    const unlanded = await attestationFacts([scope("AC-1", undefined)], [row("AC-1", "pass", L)], main());
    expect(unlanded.rows[0]).toMatchObject({ verdict: "not-measured" });
    expect(unlanded.rows[0]?.detail).toContain("task-one");
    expect(unlanded.attestable).toEqual([]);
  });
});

describe("AC-AF-3 readers of the corpus", () => {
  const doc = (over: Partial<DocRecord> & { extra: Record<string, unknown>; slug: string; id: string; type: DocRecord["type"] }): DocRecord =>
    ({ title: over.slug, status: "approved", content: "", parent_id: null, deleted_at: null, version: 1, tags: [], ...over }) as unknown as DocRecord;
  const attestation = (stamp: boolean) => ({
    runner: "lore-cli",
    exit_code: 0,
    duration_ms: 1,
    timed_out: false,
    ...(stamp ? { state_stamp: { head_sha: L, worktree_dirty: false } } : {}),
  });
  const evidence = (ac: string, stamp: boolean, result = "pass") => ({
    oracle: "test",
    command: "bun test",
    result,
    recorded_at: "2026-10-29T10:00:00.000Z",
    recorded_by: "agent:x",
    ac_ref: ac,
    attestation: attestation(stamp),
  });
  const spec = doc({
    id: "S1",
    slug: "spec-one",
    type: "spec",
    extra: {
      acceptance_criteria: [
        { id: "AC-1", statement: "s", verify: { mode: "script", oracle: "test", command: "true" } },
        { id: "AC-2", statement: "s", verify: { mode: "ai", rubric: "r" } },
        { id: "AC-3", statement: "s", verify: { mode: "script", oracle: "test", command: "true" }, superseded_by: { spec: "other", ac: "AC-3", reason: "moved", at: "2026-10-29T10:00:00.000Z", by: "x" } },
      ],
    },
  });
  const plan = doc({ id: "P1", slug: "plan-one", type: "plan", parent_id: "S1" as never, extra: {} });
  // reason: the shas exist only after beforeAll, so the task is built lazily inside each test.
  const landing = (): Record<string, string> => ({ branch: "b", branch_head: W, main_before: B, main_after: L, landing_commit: L, recorded_at: "2026-10-29T10:00:00.000Z", kind: "commits" });
  const taskDoc = (): DocRecord => doc({
    id: "T1",
    slug: "task-one",
    type: "task",
    extra: { plan_id: "P1", ac_scope: ["AC-1", "AC-2", "AC-3"], landing: landing(), verification_evidence: [evidence("AC-1", true), evidence("AC-1", false, "fail")] },
  });

  it("AC-AF-3 HAPPY: scopes keep live criteria in scope with the landing; superseded ones are dropped", () => {
    const scopes = planCriterionScopes(spec, [taskDoc()]);
    expect(scopes.map((s) => [s.ac_id, s.mode, s.holders[0]?.landing_commit])).toEqual([
      ["AC-1", "script", L],
      ["AC-2", "ai", L],
    ]);
  });

  it("AC-AF-3 NEGATIVE: only stamped, conclusive attested rows are read; an unstamped one never decides", () => {
    const rows = attestationRowsOf([spec], [plan], [taskDoc()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spec_slug: "spec-one", ac_id: "AC-1", head_sha: L, result: "pass" });
  });

  it("AC-AF-3 BOUNDARY: a task with no plan lineage counts only for the one spec declaring the criterion", () => {
    const adhoc = doc({ id: "T2", slug: "adhoc", type: "task", extra: { adhoc: true, ac_scope: ["AC-1"], verification_evidence: [evidence("AC-1", true)] } });
    expect(attestationRowsOf([spec], [plan], [adhoc])).toHaveLength(1);
    const twin = doc({ id: "S2", slug: "spec-two", type: "spec", extra: { acceptance_criteria: [{ id: "AC-1", statement: "s", verify: { mode: "human" } }] } });
    expect(attestationRowsOf([spec, twin], [plan], [adhoc])).toHaveLength(0);
  });
});

describe("AC-AF-3 the post-landing batch attests landed criteria", () => {
  /** A fake `lore verify` at a commit: records the attested row it would have written. */
  function attester(rows: AttestationRow[], outcome: "pass" | "fail" = "pass", failWith?: string): { port: LandingAttesterPort; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      port: {
        attestAt: async (commitSha, criteria) => {
          calls.push(`${commitSha}:${criteria.map((c) => c.ac_id).join(",")}`);
          if (failWith !== undefined) return err({ code: "STORE_ERROR", message: failWith });
          for (const c of criteria) rows.push(row(c.ac_id, outcome, commitSha));
          return ok(undefined);
        },
      },
    };
  }

  const plan = { id: "P1", slug: "plan-one", title: "Plan", content: "", version: 1, status: "approved", extra: {} };
  const bundle = { plan, tasks: [{ id: "T1", slug: "task-one", version: 1, extra: {} }], spec: { id: "S1", slug: "spec-one", extra: {} } } as unknown as PlanBundle;

  /** Runs the batch for one plan; returns what the review step saw and what was audited. */
  async function runBatch(attestLanded: BatchRunPorts["attestLanded"]): Promise<{ order: string[]; errors: string[] }> {
    const order: string[] = [];
    const errors: string[] = [];
    const runner = new ReviewBatchRunner({
      getPlanBundle: async () => ok(bundle),
      listReviewDocs: async () => ok([]),
      issueCoverage: async () => ok({ covered: [], uncovered: [], fixed: [] } as never),
    });
    const passDim = { verdict: "pass", reason: "ok", reference: "r" };
    await runner.runBatch(["plan-one"], {
      acquireLease: async () => ok({ state: "acquired", tookOver: false, handle: { release: async () => undefined, lost: () => false } } as never),
      settleRetirement: async () => ok(undefined),
      measureSuite: async () => undefined,
      ...(attestLanded !== undefined
        ? {
            attestLanded: async (ref: string) => {
              order.push("attest");
              return attestLanded(ref);
            },
          }
        : {}),
      reviewPlan: async () => {
        order.push("review");
        return ok({
          doc: { slug: "review-one" },
          review: { overall: "pass", dimensions: Object.fromEntries(["correctness_vs_acs", "spec_conformance", "regression", "design_necessity", "snapshot_accuracy", "concurrency_safety", "security"].map((d) => [d, passDim])) },
        } as never);
      },
      closePlan: async () => ok(undefined),
      recordError: async (e) => {
        errors.push(e.message);
        return ok(undefined);
      },
      filing: undefined,
      now: () => "2026-10-29T10:00:00.000Z",
    });
    return { order, errors };
  }

  it("AC-AF-3 STATE: a criterion verified only in the task worktree is pass at review time once the batch attested it at the landing", async () => {
    const rows = [row("AC-1", "pass", W)];
    const scopes = [scope("AC-1", L)];
    expect((await attestationFacts(scopes, rows, main())).rows[0]?.verdict).toBe("not-measured");
    const fake = attester(rows);
    const { order } = await runBatch(async () => attestLandedCriteria(scopes, rows, main(), fake.port));
    expect(order).toEqual(["attest", "review"]);
    expect(fake.calls).toEqual([`${L}:AC-1`]);
    const after = await attestationFacts(scopes, rows, main());
    expect(after.rows[0]).toMatchObject({ verdict: "pass" });
    expect(after.deciding_ids).toHaveLength(1);
  });

  it("AC-AF-3 STATE: an attested fail at the landing fails the criterion (the batch records what the run says)", async () => {
    const rows: AttestationRow[] = [];
    const scopes = [scope("AC-1", L)];
    await attestLandedCriteria(scopes, rows, main(), attester(rows, "fail").port);
    expect((await attestationFacts(scopes, rows, main())).rows[0]).toMatchObject({ verdict: "fail" });
  });

  it("AC-AF-3 REGRESSION: a batch without the attestation step leaves the worktree-only criterion not-measured", async () => {
    const rows = [row("AC-1", "pass", W)];
    const { order } = await runBatch(undefined);
    expect(order).toEqual(["review"]);
    expect((await attestationFacts([scope("AC-1", L)], rows, main())).rows[0]?.verdict).toBe("not-measured");
  });

  it("AC-AF-3 BOUNDARY: a criterion already bound to main is never re-run", async () => {
    const rows = [row("AC-1", "pass", L)];
    const fake = attester(rows);
    const report = await attestLandedCriteria([scope("AC-1", L)], rows, main(), fake.port);
    expect(fake.calls).toEqual([]);
    expect(report.ok && report.value.attested).toEqual([]);
  });

  it("AC-AF-3 BOUNDARY: a landing that is not on main's first-parent history is not attested (the attestation would not count)", async () => {
    const fake = attester([]);
    await attestLandedCriteria([scope("AC-1", W)], [], main(), fake.port);
    expect(fake.calls).toEqual([]);
  });

  it("AC-AF-3 ERROR: one failing landing is reported and the others still run; a failing batch step is an audited error, not a skipped step", async () => {
    const rows: AttestationRow[] = [];
    const two: CriterionScope[] = [scope("AC-1", L), { ...scope("AC-2", M), holders: [{ task_slug: "task-two", landing_commit: M }] }];
    let first = true;
    const flaky: LandingAttesterPort = {
      attestAt: async (commitSha, criteria) => {
        if (first) {
          first = false;
          return err({ code: "STORE_ERROR", message: "worktree failed" });
        }
        for (const c of criteria) rows.push(row(c.ac_id, "pass", commitSha));
        return ok(undefined);
      },
    };
    const report = await attestLandedCriteria(two, rows, main(), flaky);
    expect(report.ok && report.value.failures).toHaveLength(1);
    expect(report.ok && report.value.attested).toHaveLength(1);
    const { order, errors } = await runBatch(async () => err<LoreError>({ code: "STORE_ERROR", message: "corpus unreadable" }));
    expect(order).toEqual(["attest"]);
    expect(errors).toEqual(["corpus unreadable"]);
  });
});

/** Compile-time: the deciding ids ride on the facts so the fingerprint can hash them. */
const _facts: MilestoneFacts = { attestation_ids: [{ subject: "spec-one:AC-1", id: "task-one@t" }] };
void _facts;
