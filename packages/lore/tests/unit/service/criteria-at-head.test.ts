/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-3, BR-1498)
 *
 * Criteria run once at the assessed commit: fake runner port and hand-built attestation rows (no git, no corpus).
 *
 * Dimensions: HAPPY (each script criterion runs once at head, in the suite's worktree when given; head attestation decides,
 * ids exposed), NEGATIVE (an older pass never decides: failing at head fails with an older pass, a landing-only or
 * worktree-only pass is not-measured), BOUNDARY (no criterion in scope is na and nothing runs; AI listed for the judge,
 * human and superseded skipped), ERROR (run that cannot complete, runner setup failure, unreadable corpus: not-measured and
 * named), STATE (latest row at head wins), REGRESSION (a later plan's landing broke a criterion that once passed).
 */

import { describe, expect, it } from "vitest";
import { err, ok, type LoreError, type Result } from "@lore/core";
import {
  measureCriteriaAtHead,
  type AttestationRow,
  type CriterionScope,
  type HeadCriteriaRunnerPort,
  type HeadCriterionOutcome,
} from "../../../src/service/milestone-attestation-facts.js";
import { factsDimensions } from "../../../src/service/milestone-review-judgment.js";
import { answerJson, buildJudgmentFixture } from "../../helpers/milestone-judgment-fixture.js";

const HEAD = "h".repeat(40);
const LANDING = "1".repeat(40);
const WORKTREE_COMMIT = "2".repeat(40);

const scope = (ac: string, mode: CriterionScope["mode"] = "script"): CriterionScope => ({
  spec_slug: "spec-one",
  ac_id: ac,
  mode,
  ...(mode === "ai" ? { rubric: "rubric" } : {}),
  holders: [{ task_slug: "task-one" }],
});

let n = 0;
const row = (ac: string, result: "pass" | "fail", head_sha: string): AttestationRow => {
  const at = `2026-10-29T10:00:${String(++n).padStart(2, "0")}.000Z`;
  return { id: `task-one@${at}`, spec_slug: "spec-one", ac_id: ac, result, head_sha, recorded_at: at };
};

interface FakeRunner {
  readonly port: HeadCriteriaRunnerPort;
  readonly requests: { commit: string; worktreeRoot: string | undefined; criteria: string[] }[];
}

/** A fake `lore verify`: for each criterion it pushes the attested row the real run would have written at the commit. */
function fakeRunner(
  rows: AttestationRow[],
  verdicts: Record<string, "pass" | "fail" | "cannot-complete" | "no-row">,
  setupFailure?: string,
): FakeRunner {
  const requests: FakeRunner["requests"] = [];
  return {
    requests,
    port: {
      attestAtHead: async (request): Promise<Result<readonly HeadCriterionOutcome[], LoreError>> => {
        requests.push({ commit: request.commit, worktreeRoot: request.worktreeRoot, criteria: request.criteria.map((c) => c.ac_id) });
        if (setupFailure !== undefined) return err({ code: "STORE_ERROR", message: setupFailure });
        return ok(
          request.criteria.map((c): HeadCriterionOutcome => {
            const verdict = verdicts[c.ac_id] ?? "pass";
            if (verdict === "cannot-complete") return { ...c, ran: false, cause: "the command was refused: not approved" };
            if (verdict !== "no-row") rows.push(row(c.ac_id, verdict, request.commit));
            return { ...c, ran: true };
          }),
        );
      },
    },
  };
}

const measure = (scopes: CriterionScope[], rows: AttestationRow[], runner: HeadCriteriaRunnerPort, worktreeRoot?: string) =>
  measureCriteriaAtHead({
    scopes,
    headCommit: HEAD,
    runner,
    ...(worktreeRoot !== undefined ? { worktreeRoot } : {}),
    readRows: async () => ok(rows),
  });

describe("AC-AO-3 criteria run once at the assessed commit", () => {
  it("AC-AO-3 HAPPY: each script criterion runs once at head, in the suite worktree when one is given, and the head attestation decides", async () => {
    const rows: AttestationRow[] = [];
    const fake = fakeRunner(rows, { "AC-1": "pass", "AC-2": "fail" });
    const facts = await measure([scope("AC-1"), scope("AC-2")], rows, fake.port, "/tmp/suite-worktree");
    expect(fake.requests).toEqual([{ commit: HEAD, worktreeRoot: "/tmp/suite-worktree", criteria: ["AC-1", "AC-2"] }]);
    expect(facts.rows.map((r) => [r.subject, r.verdict])).toEqual([
      ["spec-one:AC-1", "pass"],
      ["spec-one:AC-2", "fail"],
    ]);
    expect(facts.deciding_ids.map((d) => d.subject)).toEqual(["spec-one:AC-1", "spec-one:AC-2"]);
    expect(facts.deciding_ids.every((d) => rows.some((r) => r.id === d.id && r.head_sha === HEAD))).toBe(true);
  });

  it("AC-AO-3 HAPPY: without a suite worktree the runner is asked for a worktree of its own (no root handed over)", async () => {
    const rows: AttestationRow[] = [];
    const fake = fakeRunner(rows, {});
    await measure([scope("AC-1")], rows, fake.port);
    expect(fake.requests).toEqual([{ commit: HEAD, worktreeRoot: undefined, criteria: ["AC-1"] }]);
  });

  it("AC-AO-3 NEGATIVE: a criterion failing at head fails the gate even with an older pass (landing or later-plan breakage)", async () => {
    const rows = [row("AC-1", "pass", LANDING)];
    const fake = fakeRunner(rows, { "AC-1": "fail" });
    const facts = await measure([scope("AC-1")], rows, fake.port);
    expect(facts.rows[0]).toMatchObject({ subject: "spec-one:AC-1", verdict: "fail" });
  });

  it("AC-AO-3 NEGATIVE: a pass that exists only from a landing or a task worktree is never read (the run left no row at head: not-measured)", async () => {
    const rows = [row("AC-1", "pass", LANDING), row("AC-1", "pass", WORKTREE_COMMIT)];
    const fake = fakeRunner(rows, { "AC-1": "no-row" });
    const facts = await measure([scope("AC-1")], rows, fake.port);
    expect(facts.rows[0]?.verdict).toBe("not-measured");
    expect(facts.rows[0]?.detail).toContain("no attestation stamped at that commit");
    expect(facts.deciding_ids).toEqual([]);
  });

  it("AC-AO-3 STATE: the latest row at head decides; rows at other commits, newer or older, are ignored", async () => {
    const rows = [row("AC-1", "fail", HEAD), row("AC-1", "pass", HEAD)];
    rows.push(row("AC-1", "fail", LANDING));
    const fake = fakeRunner(rows, { "AC-1": "no-row" });
    const facts = await measure([scope("AC-1")], rows, fake.port);
    expect(facts.rows[0]?.verdict).toBe("pass");
  });

  it("AC-AO-3 REGRESSION: reading the latest landing-bound attestation would pass; the head run fails the criterion", async () => {
    const rows = [row("AC-1", "pass", LANDING)];
    const facts = await measure([scope("AC-1")], rows, fakeRunner(rows, { "AC-1": "fail" }).port);
    expect(facts.rows[0]?.verdict).not.toBe("pass");
  });

  it("AC-AO-3 ERROR: a criterion run that cannot complete is not-measured naming the criterion and the cause; the others still decide", async () => {
    const rows: AttestationRow[] = [];
    const facts = await measure([scope("AC-1"), scope("AC-2")], rows, fakeRunner(rows, { "AC-1": "cannot-complete", "AC-2": "pass" }).port);
    expect(facts.rows[0]).toMatchObject({ subject: "spec-one:AC-1", verdict: "not-measured" });
    expect(facts.rows[0]?.detail).toContain("not approved");
    expect(facts.rows[1]).toMatchObject({ subject: "spec-one:AC-2", verdict: "pass" });
  });

  it("AC-AO-3 ERROR: a runner that cannot set up (worktree, install) makes every script criterion not-measured, never pass", async () => {
    const rows = [row("AC-1", "pass", HEAD)];
    const facts = await measure([scope("AC-1"), scope("AC-2")], rows, fakeRunner(rows, {}, "bun install failed").port);
    expect(facts.rows.map((r) => r.verdict)).toEqual(["not-measured", "not-measured"]);
    expect(facts.rows[0]?.detail).toContain("bun install failed");
    expect(facts.deciding_ids).toEqual([]);
  });

  it("AC-AO-3 ERROR: an unreadable corpus after the run is not-measured, never pass", async () => {
    const rows: AttestationRow[] = [];
    const facts = await measureCriteriaAtHead({
      scopes: [scope("AC-1")],
      headCommit: HEAD,
      runner: fakeRunner(rows, {}).port,
      readRows: async () => err({ code: "STORE_ERROR", message: "store is locked" }),
    });
    expect(facts.rows[0]?.verdict).toBe("not-measured");
    expect(facts.rows[0]?.detail).toContain("store is locked");
  });

  it("AC-AO-3 BOUNDARY: a plan with no criterion in scope is na and the runner is never called; human and superseded criteria add nothing to run", async () => {
    const rows: AttestationRow[] = [];
    const fake = fakeRunner(rows, {});
    const empty = await measure([], rows, fake.port);
    expect(empty.rows).toEqual([{ subject: "criteria", verdict: "na", detail: expect.stringContaining("no criterion in scope") }]);
    const humanOnly = await measure([scope("AC-H", "human")], rows, fake.port);
    expect(humanOnly.rows[0]?.verdict).toBe("na");
    expect(fake.requests).toEqual([]);
  });

  it("AC-AO-3 AI: an AI-mode criterion is listed for the judge (not run), and a judge fail fails the gate", async () => {
    const rows: AttestationRow[] = [];
    const fake = fakeRunner(rows, {});
    const facts = await measure([scope("AC-1"), scope("AC-9", "ai")], rows, fake.port);
    expect(fake.requests[0]?.criteria).toEqual(["AC-1"]);
    expect(facts.ai_criteria).toEqual([{ spec: "spec-one", ac: "AC-9", rubric: "rubric" }]);
    const allPass = {
      spec_conformance: { verdict: "pass" },
      design_necessity: { verdict: "pass" },
      concurrency_safety: { verdict: "pass" },
      security: { verdict: "pass" },
    };
    const fx = buildJudgmentFixture(() => answerJson(allPass, { criteria: [{ spec: "spec-one", ac: "AC-9", verdict: "fail", reason: "rubric not met" }] }), {
      facts: { attestation: facts.rows, ai_criteria: facts.ai_criteria },
    });
    await fx.review({});
    const dim = fx.stored()!.dimensions.correctness_vs_acs;
    expect(dim.verdict).toBe("fail");
    expect(dim.reason).toContain("spec-one:AC-9");
    expect(factsDimensions).toBeDefined();
  });
});
