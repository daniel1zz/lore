/**
 * Hand-built `MilestoneReviewService` for judgment-layer tests: one plan, one task, a scripted judge, no store.
 *
 * Purpose: let a test choose what the judge answers per call and read back the prompts, the stored review and the
 *   calls made, without a corpus or a model.
 * Public surface: buildJudgmentFixture, answerJson, JudgmentFixture.
 * Side-effect class: pure (in-memory ports).
 */

import { ok, type DocRecord, type MilestoneFacts, type MilestoneReview } from "@lore/core";
import { MilestoneReviewService, type MilestoneReviewOptions } from "../../src/service/milestone-review-service.js";
import type { JudgeReply } from "../../src/service/milestone-review-judgment.js";

type Dim = { verdict: string; reason?: string; reference?: string; cites?: string[] };

/**
 * One judge answer as JSON text.
 *
 * @param dims - verdicts per dimension; any key may be given, including facts dimensions (the review must ignore those)
 * @param extra - further top-level keys (`criteria`, `decisions`)
 */
export function answerJson(dims: Record<string, Dim>, extra: Record<string, unknown> = {}): string {
  const dimensions = Object.fromEntries(
    Object.entries(dims).map(([k, v]) => [k, { reason: `${k} reason`, reference: "Google engineering code review guide", ...v }]),
  );
  return JSON.stringify({ dimensions, ...extra });
}

/**
 * Adds the per-file verdicts every call must now return (BR-1535) to a scripted answer that predates them: one passing
 * `security` / `concurrency_safety` entry per file the prompt's `# Units` list marks ASK. An answer that already has `files`
 * (or is not JSON, so a test can feed the judge garbage) is returned unchanged.
 */
export function withFileAnswers(prompt: string, text: string): string {
  const asked = [...prompt.matchAll(/^- file (\S+): ASK/gm)].map((m) => m[1] as string);
  if (asked.length === 0) return text;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
  if (json["files"] !== undefined) return text;
  const pass = { verdict: "pass", reason: "no finding in this file", reference: "Google engineering code review guide", cites: [] as string[] };
  return JSON.stringify({ ...json, files: asked.map((path) => ({ path, security: pass, concurrency_safety: pass })) });
}

/** The service plus what the judge saw. */
export interface JudgmentFixture {
  readonly review: (opts: Partial<MilestoneReviewOptions> & { diffText?: string }) => ReturnType<MilestoneReviewService["review"]>;
  readonly prompts: string[];
  stored: () => MilestoneReview | undefined;
}

/**
 * Builds the fixture.
 *
 * @param judge - answers one prompt; may return a bare string or a reply with tokens and duration
 * @param opts.citedRules - the cited-rule states the plan's spec yields
 */
export function buildJudgmentFixture(
  judge: (prompt: string) => string | JudgeReply,
  opts: { citedRules?: { rule_id: string; state: string }[]; facts?: MilestoneFacts } = {},
): JudgmentFixture {
  const prompts: string[] = [];
  let stored: MilestoneReview | undefined;
  const plan = { id: "P1", slug: "plan-one", title: "Plan one", content: "Body.", version: 1, status: "approved", extra: {} };
  const task = { id: "T1", slug: "task-one", title: "Task", status: "archived", content: "task body", version: 1, extra: {} };
  const spec = { id: "S1", slug: "spec-one", title: "Spec", content: "spec body", version: 1, extra: {} };
  const service = new MilestoneReviewService({
    getPlanBundle: async () => ok({ plan, tasks: [task], spec } as never),
    getCitedRuleStates: async () => ok((opts.citedRules ?? []) as never),
    listDecisionLog: async () => ok([]),
    judge: async () => {
      throw new Error("judgeMeasured is wired in this fixture");
    },
    judgeMeasured: async (prompt) => {
      prompts.push(prompt);
      const reply = judge(prompt);
      const measured = typeof reply === "string" ? { text: reply, duration_ms: 5 } : reply;
      return ok({ ...measured, text: withFileAnswers(prompt, measured.text) });
    },
    createReviewDoc: async (input) => {
      stored = (input.extra as { milestone_review: MilestoneReview }).milestone_review;
      return ok({ id: "R1", slug: "review-one", extra: input.extra } as unknown as DocRecord);
    },
    link: async () => ok(undefined),
  });
  return {
    prompts,
    stored: () => stored,
    review: (o) =>
      service.review("plan-one", {
        diffSource: "test",
        maxDiffChars: 80000,
        ...(opts.facts !== undefined ? { facts: opts.facts } : {}),
        ...o,
      }),
  };
}
