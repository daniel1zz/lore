/**
 * @spec_ref spec-a-stored-ai-criterion-verdict-is-reused-only-while-its (AC-EV-1; BR-1535, issue #636)
 *
 * An AI criterion's stored verdict is reused only while the evidence rows the judge is shown for that criterion are
 * unchanged. The judge is a stub that records which criteria each call ASKS; the verdict store is in memory.
 *
 * Dimensions: HAPPY (no new evidence reuses), NEGATIVE (new evidence re-asks; removal re-asks), BOUNDARY (a content-identical
 * row, an unrelated criterion's row, new ids/timestamps do not re-ask), REGRESSION (file units stay reused).
 */

import { describe, expect, it } from "vitest";
import { err, ok, type AiCriterionInput, type DocRecord, type LoreError, type Result } from "@lore/core";
import { MilestoneReviewService } from "../../src/service/milestone-review-service.js";
import type { JudgeReply } from "../../src/service/milestone-review-judgment.js";

interface Row {
  key: string;
  unit_kind: string;
  unit_id: string;
  raw_answer: string;
  provider: string;
  model: string;
  template_hash: string;
  first_review: string;
  created_at: string;
  last_read_at: string;
}

class MemoryStore {
  readonly rows = new Map<string, Row>();
  async getJudgeVerdict(key: string, readAt: string): Promise<Result<Row | null, LoreError>> {
    const row = this.rows.get(key);
    if (row === undefined) return ok(null);
    row.last_read_at = readAt;
    return ok({ ...row });
  }
  async insertJudgeVerdictIfAbsent(row: Row): Promise<Result<Row, LoreError>> {
    const existing = this.rows.get(row.key);
    if (existing !== undefined) return ok({ ...existing });
    this.rows.set(row.key, { ...row });
    return ok({ ...row });
  }
  async replaceJudgeVerdictIfEquals(key: string, expected: string, row: Row): Promise<Result<Row, LoreError>> {
    const existing = this.rows.get(key);
    if (existing !== undefined && existing.raw_answer === expected) {
      this.rows.set(key, { ...row });
      return ok({ ...row });
    }
    return ok(existing === undefined ? { ...row } : { ...existing });
  }
  async pruneJudgeVerdictsNotReadSince(): Promise<Result<number, LoreError>> {
    return ok(0);
  }
}

interface EvidenceRow {
  oracle: string;
  command: string;
  result: string;
  output_tail?: string;
  ac_ref?: string;
  recorded_at: string;
  recorded_by: string;
}

const CRITERIA: readonly AiCriterionInput[] = [
  { spec: "spec-x", ac: "AC-X", rubric: "X is documented." },
  { spec: "spec-x", ac: "AC-Y", rubric: "Y is documented." },
];
const DIFF = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+A1\n";

const row = (ac: string, output: string, extra: Partial<EvidenceRow> = {}): EvidenceRow => ({
  oracle: "test",
  command: "bun run t",
  result: "pass",
  output_tail: output,
  ac_ref: ac,
  recorded_at: "2026-11-01T00:00:00.000Z",
  recorded_by: "agent:a",
  ...extra,
});

function makeEnv() {
  const store = new MemoryStore();
  const asked: string[][] = [];
  const prompts: string[] = [];
  const env = {
    evidence: [] as EvidenceRow[],
    asked,
    prompts,
    async review(): Promise<void> {
      let n = 0;
      const judge = async (prompt: string): Promise<Result<JudgeReply, LoreError>> => {
        prompts.push(prompt);
        const ids = [...prompt.matchAll(/^- criterion (\S+): ASK/gm)].map((m) => m[1] as string);
        const files = [...prompt.matchAll(/^- file (\S+): ASK/gm)].map((m) => m[1] as string);
        asked.push([...ids, ...files.map((f) => `file:${f}`)]);
        n += 1;
        const dim = (d: string) => ({ verdict: "pass", reason: `${String(n)} ${d}`, reference: "Google engineering code review guide", cites: [] as string[] });
        const answer = {
          dimensions: Object.fromEntries(["spec_conformance", "design_necessity", "concurrency_safety", "security"].map((d) => [d, dim(d)])),
          files: files.map((path) => ({ path, security: dim("s"), concurrency_safety: dim("c") })),
          criteria: ids.map((id) => {
            const [spec, ac] = id.split(":") as [string, string];
            return { spec, ac, verdict: "pass", reason: `${String(n)} ${ac}` };
          }),
        };
        return ok({ text: JSON.stringify(answer), duration_ms: 1, model: "stub-model-1" } as JudgeReply);
      };
      const bundle = {
        plan: { id: "P1", slug: "plan-one", title: "Plan", content: "Body.", version: 1, status: "approved", extra: {} },
        tasks: [{ id: "T1", slug: "task-one", title: "Task", status: "archived", content: "body", version: 1, extra: { verification_evidence: env.evidence } }],
        spec: { id: "S1", slug: "spec-x", title: "Spec", content: "spec body", version: 1, extra: {} },
      };
      const service = new MilestoneReviewService({
        getPlanBundle: async () => ok(bundle as never),
        getCitedRuleStates: async () => ok([] as never),
        listDecisionLog: async () => ok([]),
        judge: async () => err({ code: "STORE_ERROR", message: "judgeMeasured is wired" }),
        judgeMeasured: judge,
        createReviewDoc: async (input: { extra: unknown }) => ok({ id: "R1", slug: "review-1", extra: input.extra } as unknown as DocRecord),
        link: async () => ok(undefined),
        judgeVerdicts: store,
        judgeIdentity: () => ({ provider: "stub", model: "stub-model-1", reportsAnsweringModel: true, settings: {} }),
        now: () => new Date("2026-11-01T00:00:00.000Z"),
      } as never);
      const result = await service.review("plan-one", { diffText: DIFF, diffSource: "test", maxDiffChars: 80000, facts: { ai_criteria: CRITERIA, assessed_commit: "c1" } } as never);
      if (!result.ok) throw new Error(`review failed: ${JSON.stringify(result.error)}`);
    },
  };
  return env;
}

const lastAsked = (env: ReturnType<typeof makeEnv>): string[] => env.asked[env.asked.length - 1] ?? [];

describe("AC-EV-1: a criterion is re-judged when its evidence changes and reused when it does not", () => {
  it("AC-EV-1 reuses X with no new evidence, re-asks only X after a new row for X, and keeps unchanged file units reused", async () => {
    const env = makeEnv();
    env.evidence = [row("AC-X", "out-1")];
    await env.review();
    expect(lastAsked(env)).toEqual(["spec-x:AC-X", "spec-x:AC-Y", "file:src/a.ts"]);
    await env.review();
    expect(lastAsked(env)).toEqual([]);

    env.evidence = [row("AC-X", "out-1"), row("AC-X", "out-2 different", { recorded_at: "2026-11-02T00:00:00.000Z" })];
    await env.review();
    expect(lastAsked(env)).toEqual(["spec-x:AC-X"]);
    await env.review();
    expect(lastAsked(env)).toEqual([]);
  });

  it("AC-EV-1 does not re-ask X for a row identical in content, nor for new timestamps or authors; another criterion's row re-asks only that criterion", async () => {
    const env = makeEnv();
    env.evidence = [row("AC-X", "out-1")];
    await env.review();
    env.evidence = [row("AC-X", "out-1"), row("AC-X", "out-1", { recorded_at: "2026-12-01T00:00:00.000Z", recorded_by: "agent:b" })];
    await env.review();
    expect(lastAsked(env)).toEqual([]);
    env.evidence = [...env.evidence, row("AC-Y", "other output")];
    await env.review();
    expect(lastAsked(env)).toEqual(["spec-x:AC-Y"]);
  });

  it("AC-EV-1 re-asks X when one of its rows is invalidated (leaves the set)", async () => {
    const env = makeEnv();
    env.evidence = [row("AC-X", "out-1"), row("AC-X", "out-2")];
    await env.review();
    await env.review();
    expect(lastAsked(env)).toEqual([]);
    env.evidence = [row("AC-X", "out-1")];
    await env.review();
    expect(lastAsked(env)).toEqual(["spec-x:AC-X"]);
  });

  it("AC-EV-1 the prompt shows the same evidence rows the key reads", async () => {
    const env = makeEnv();
    env.evidence = [row("AC-X", "out-1", { command: "bun run only-x" })];
    await env.review();
    const prompt = env.prompts[0] ?? "";
    const section = prompt.slice(prompt.indexOf("## spec-x:AC-X"), prompt.indexOf("## spec-x:AC-Y"));
    expect(section).toContain("bun run only-x");
  });
});
