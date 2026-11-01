/**
 * @spec_ref spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit (AC-JR-1, AC-JR-2, AC-JR-3, AC-JR-4; BR-1535)
 *
 * A re-review keeps the judge's calls batched as today but records every verdict per unit (each changed file's
 * security and concurrency_safety verdict, each AI criterion's verdict) under the key of that unit's own inputs, and
 * leaves out of the call every unit whose key already has a stored verdict.
 *
 * The judge here is a stub that records which units each call ASKS (and which it was given as already judged); the
 * verdict store is an in-test fake of the store port, so the tests can seed, corrupt and inspect rows directly.
 * No model, no corpus, no git.
 *
 * Dimensions: HAPPY (a fix re-asks only what changed), NEGATIVE (a stale verdict is never reused: import-reached
 * source, attestation change, deleted path), BOUNDARY (a chunked review and a full review share units; no AI
 * criterion prints 0 criterion units), ERROR (a store read or write failure fails the review, exit 4, no document),
 * STATE (first writer wins; a corrupt row is replaced once; unread rows expire), REGRESSION (call count unchanged).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as core from "@lore/core";
import { err, ok, type AiCriterionInput, type DocRecord, type LoreError, type MilestoneReview, type Result } from "@lore/core";
import { chunkDiffByFile } from "../../src/ai/diff-chunking.js";
import { exitCode } from "../../src/adapters/cli/utils.js";
import { MilestoneReviewService } from "../../src/service/milestone-review-service.js";
import type { JudgeReply } from "../../src/service/milestone-review-judgment.js";

// ─── the fake verdict store (the store port, in memory) ──────────────────────

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

class FakeVerdictStore {
  readonly rows = new Map<string, Row>();
  readonly replaceCalls: string[] = [];
  readonly insertCalls: string[] = [];
  failOn: "get" | "insert" | "replace" | "prune" | undefined;

  private failure(op: string): LoreError {
    return { code: "STORE_ERROR", message: `fake store ${op} failed` };
  }

  async getJudgeVerdict(key: string, readAt: string): Promise<Result<Row | null, LoreError>> {
    if (this.failOn === "get") return err(this.failure("get"));
    const row = this.rows.get(key);
    if (row === undefined) return ok(null);
    row.last_read_at = readAt;
    return ok({ ...row });
  }

  async insertJudgeVerdictIfAbsent(row: Row): Promise<Result<Row, LoreError>> {
    if (this.failOn === "insert") return err(this.failure("insert"));
    this.insertCalls.push(row.key);
    const existing = this.rows.get(row.key);
    if (existing !== undefined) return ok({ ...existing });
    this.rows.set(row.key, { ...row });
    return ok({ ...row });
  }

  async replaceJudgeVerdictIfEquals(key: string, expectedRawAnswer: string, row: Row): Promise<Result<Row, LoreError>> {
    if (this.failOn === "replace") return err(this.failure("replace"));
    const existing = this.rows.get(key);
    if (existing !== undefined && existing.raw_answer === expectedRawAnswer) {
      this.replaceCalls.push(key);
      this.rows.set(key, { ...row });
      return ok({ ...row });
    }
    return ok(existing === undefined ? { ...row } : { ...existing });
  }

  async pruneJudgeVerdictsNotReadSince(cutoff: string): Promise<Result<number, LoreError>> {
    if (this.failOn === "prune") return err(this.failure("prune"));
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (row.last_read_at < cutoff) {
        this.rows.delete(key);
        removed += 1;
      }
    }
    return ok(removed);
  }

  rowOf(unitId: string): Row | undefined {
    return [...this.rows.values()].find((r) => r.unit_id === unitId);
  }
}

// ─── the stub judge ──────────────────────────────────────────────────────────

interface CallRecord {
  readonly mode: "full" | "chunk" | "summary";
  readonly askedFiles: string[];
  readonly reusedFiles: string[];
  readonly askedCriteria: string[];
  readonly reusedCriteria: string[];
  readonly dims: string[];
  readonly prompt: string;
}

const ALL_DIMS = ["spec_conformance", "design_necessity", "concurrency_safety", "security"];

function parseCall(prompt: string): CallRecord {
  const mode = prompt.includes("# Diff chunk") ? "chunk" : prompt.includes("All files (") ? "summary" : "full";
  const dimsMatch = /each separately: ([a-z_, ]+)\./.exec(prompt);
  const dims = dimsMatch === null ? [] : (dimsMatch[1] as string).split(",").map((d) => d.trim());
  const askedFiles: string[] = [];
  const reusedFiles: string[] = [];
  const askedCriteria: string[] = [];
  const reusedCriteria: string[] = [];
  const hasUnits = /^# Units$/m.test(prompt);
  for (const m of prompt.matchAll(/^- (file|criterion) (\S+): (ASK|ALREADY JUDGED)/gm)) {
    const target = m[1] === "file" ? (m[3] === "ASK" ? askedFiles : reusedFiles) : m[3] === "ASK" ? askedCriteria : reusedCriteria;
    target.push(m[2] as string);
  }
  if (!hasUnits && mode !== "chunk") {
    // a prompt without a units section asks every criterion it lists
    for (const m of prompt.matchAll(/^## ([\w-]+:[\w-]+)$/gm)) askedCriteria.push(m[1] as string);
  }
  return { mode, askedFiles, reusedFiles, askedCriteria, reusedCriteria, dims, prompt };
}

interface Identity {
  provider: string;
  model: string | undefined;
  settings: Record<string, string | number>;
}

interface EnvOptions {
  readonly store?: FakeVerdictStore;
  readonly tag?: string;
  readonly gate?: () => Promise<void>;
  readonly clock?: Date;
}

interface PlanState {
  readonly files: Record<string, string>;
  readonly criteria: readonly AiCriterionInput[];
  readonly maxDiffChars?: number;
  readonly ctx?: {
    pathExists: (path: string) => Promise<Result<boolean, LoreError>>;
    reachedChangedFiles: (command: string, changed: readonly string[]) => Promise<Result<readonly string[], LoreError>>;
  };
}

function diffOf(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, body]) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${body}\n`)
    .join("");
}

function makeEnv(options: EnvOptions = {}) {
  const store = options.store ?? new FakeVerdictStore();
  const calls: CallRecord[] = [];
  const tag = options.tag ?? "J";
  let counter = 0;
  const state = { docs: 0 };
  const env = {
    store,
    calls,
    state,
    identity: { provider: "stub-provider", model: "stub-model-1", settings: { temperature: 0 } } as Identity,
    clock: options.clock ?? new Date("2026-11-01T00:00:00.000Z"),
    template: undefined as string | undefined,
    reviews: [] as MilestoneReview[],
    async review(plan: PlanState): Promise<Result<{ review: MilestoneReview }, LoreError>> {
      const judge = async (prompt: string): Promise<Result<JudgeReply, LoreError>> => {
        const call = parseCall(prompt);
        calls.push(call);
        if (options.gate !== undefined) await options.gate();
        counter += 1;
        const n = counter;
        const dim = (d: string) => ({ verdict: "pass", reason: `${tag}${String(n)} ${d} ok`, reference: "Google engineering code review guide", cites: [] as string[] });
        const askedDims = call.dims.length > 0 ? call.dims : ALL_DIMS;
        const answer = {
          dimensions: Object.fromEntries(askedDims.map((d) => [d, dim(d)])),
          files: call.askedFiles.map((path) => ({ path, security: dim(`security of ${path}`), concurrency_safety: dim(`concurrency of ${path}`) })),
          criteria: call.askedCriteria.map((id) => {
            const [spec, ac] = id.split(":") as [string, string];
            return { spec, ac, verdict: "pass", reason: `${tag}${String(n)} criterion ${ac} ok` };
          }),
        };
        const reply: JudgeReply = { text: JSON.stringify(answer), duration_ms: 3, ...(env.identity.model !== undefined ? { model: env.identity.model } : {}) };
        return ok(reply);
      };
      const bundle = {
        plan: { id: "P1", slug: "plan-one", title: "Plan one", content: "Body.", version: 1, status: "approved", extra: {} },
        tasks: [{ id: "T1", slug: "task-one", title: "Task", status: "archived", content: "task body", version: 1, extra: {} }],
        spec: { id: "S1", slug: "spec-x", title: "Spec", content: "spec body", version: 1, extra: {} },
      };
      const service = new MilestoneReviewService({
        getPlanBundle: async () => ok(bundle as never),
        getCitedRuleStates: async () => ok([] as never),
        listDecisionLog: async () => ok([]),
        judge: async () => err({ code: "STORE_ERROR", message: "judgeMeasured is wired" }),
        judgeMeasured: judge,
        createReviewDoc: async (input) => {
          state.docs += 1;
          return ok({ id: "R1", slug: `review-${String(state.docs)}`, extra: input.extra } as unknown as DocRecord);
        },
        link: async () => ok(undefined),
        judgeVerdicts: store,
        judgeIdentity: () => env.identity,
        now: () => env.clock,
        ...(env.template !== undefined ? { unitInstructions: env.template } : {}),
      } as never);
      const diffText = diffOf(plan.files);
      const result = await service.review("plan-one", {
        diffText,
        diffSource: "test",
        maxDiffChars: plan.maxDiffChars ?? 80000,
        facts: { ai_criteria: plan.criteria, assessed_commit: "c1" },
        ...(plan.ctx !== undefined ? { criterionContext: plan.ctx } : {}),
      } as never);
      if (!result.ok) return result;
      env.reviews.push(result.value.review);
      return ok({ review: result.value.review });
    },
  };
  return env;
}

const criterion = (ac: string, rubric: string, extra: Partial<AiCriterionInput> = {}): AiCriterionInput => ({ spec: "spec-x", ac, rubric, ...extra });
const CRITERIA: readonly AiCriterionInput[] = [
  criterion("AC-X", "The behaviour in src/a.ts is documented."),
  criterion("AC-Y", "The behaviour in src/c.ts is documented."),
  criterion("AC-Z", "The plan reads clearly overall."),
];
const FILES_V1 = { "src/a.ts": "A1", "src/b.ts": "B1", "src/c.ts": "C1" };
const FILES_A_CHANGED = { "src/a.ts": "A2", "src/b.ts": "B1", "src/c.ts": "C1" };

const askedFiles = (calls: readonly CallRecord[]): string[] => calls.flatMap((c) => c.askedFiles).sort();
const askedCriteria = (calls: readonly CallRecord[]): string[] => calls.flatMap((c) => c.askedCriteria).sort();
const unitsOf = (review: MilestoneReview | undefined): { kind: string; id: string; source: string; first_review: string; key: string; answer_sha256: string }[] =>
  ((review?.judgment as unknown as { units?: never[] } | undefined)?.units ?? []) as never;
const reviewToken = (review: MilestoneReview | undefined): string | undefined => (review?.judgment as unknown as { review_token?: string } | undefined)?.review_token;
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function must<T>(result: Result<T, LoreError>): T {
  if (!result.ok) throw new Error(`review failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── AC-JR-1 ─────────────────────────────────────────────────────────────────

describe("AC-JR-1: only changed units are re-asked", () => {
  it("AC-JR-1 a first review asks every unit in one full call; after a fix to a's diff the second asks a, X, Z and reuses b, c, Y", async () => {
    const env = makeEnv();
    const first = must(await env.review({ files: FILES_V1, criteria: CRITERIA }));
    expect(env.calls).toHaveLength(1);
    expect(askedFiles(env.calls)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(askedCriteria(env.calls)).toEqual(["spec-x:AC-X", "spec-x:AC-Y", "spec-x:AC-Z"]);
    expect(env.calls[0]?.dims).toEqual(ALL_DIMS);

    env.calls.length = 0;
    const second = must(await env.review({ files: FILES_A_CHANGED, criteria: CRITERIA }));
    // same call count as the first review (one full call), never one call per unit
    expect(env.calls).toHaveLength(1);
    expect(askedFiles(env.calls)).toEqual(["src/a.ts"]);
    expect(askedCriteria(env.calls)).toEqual(["spec-x:AC-X", "spec-x:AC-Z"]);
    expect(env.calls[0]?.dims).toEqual(ALL_DIMS);
    // reused units are given to the call as already judged, and their diffs are still sent
    expect([...(env.calls[0]?.reusedFiles ?? [])].sort()).toEqual(["src/b.ts", "src/c.ts"]);
    expect(env.calls[0]?.reusedCriteria).toEqual(["spec-x:AC-Y"]);
    expect(env.calls[0]?.prompt).toContain("+B1");
    expect(env.calls[0]?.prompt).toContain("+C1");

    // each reused unit is recorded with the review it came from
    const reused = unitsOf(second.review).filter((u) => u.source === "reused");
    expect(reused.map((u) => u.id).sort()).toEqual(["spec-x:AC-Y", "src/b.ts", "src/c.ts"]);
    const sourceToken = reviewToken(first.review);
    expect(typeof sourceToken).toBe("string");
    expect(reused.every((u) => u.first_review === sourceToken)).toBe(true);
    expect(unitsOf(second.review).filter((u) => u.source === "fresh").map((u) => u.id).sort()).toEqual(["spec-x:AC-X", "spec-x:AC-Z", "src/a.ts"]);

    // lore assess prints fresh and reused counts per dimension
    expect(typeof (core as Record<string, unknown>)["renderUnitCounts"]).toBe("function");
    const line = (core as unknown as { renderUnitCounts: (r: MilestoneReview) => string }).renderUnitCounts(second.review);
    expect(line).toContain("security: 1 fresh, 2 reused");
    expect(line).toContain("concurrency_safety: 1 fresh, 2 reused");
    expect(line).toContain("criteria: 2 fresh, 1 reused");
  });

  it("AC-JR-1 a chunked review keeps today's call count (one call per chunk plus the summary) and every chunk is still sent", async () => {
    const env = makeEnv();
    const diff = diffOf(FILES_V1);
    const eachOwnChunk = Math.max(...Object.keys(FILES_V1).map((p) => diffOf({ [p]: "A1" }).length)) + 2;
    const expectedCalls = chunkDiffByFile(diff, eachOwnChunk).chunks.length + 1;
    expect(expectedCalls).toBe(4);
    const first = must(await env.review({ files: FILES_V1, criteria: CRITERIA, maxDiffChars: eachOwnChunk }));
    expect(env.calls.map((c) => c.mode)).toEqual(["chunk", "chunk", "chunk", "summary"]);
    expect(askedFiles(env.calls)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(askedCriteria(env.calls)).toEqual(["spec-x:AC-X", "spec-x:AC-Y", "spec-x:AC-Z"]);

    env.calls.length = 0;
    const second = must(await env.review({ files: FILES_A_CHANGED, criteria: CRITERIA, maxDiffChars: eachOwnChunk }));
    expect(env.calls).toHaveLength(expectedCalls);
    expect(askedFiles(env.calls)).toEqual(["src/a.ts"]);
    expect(askedCriteria(env.calls)).toEqual(["spec-x:AC-X", "spec-x:AC-Z"]);
    // every chunk is sent, including the chunks whose only file is reused
    const chunkPrompts = env.calls.filter((c) => c.mode === "chunk").map((c) => c.prompt);
    expect(chunkPrompts.some((p) => p.includes("+B1"))).toBe(true);
    expect(chunkPrompts.some((p) => p.includes("+C1"))).toBe(true);
    expect(unitsOf(second.review).filter((u) => u.source === "reused").map((u) => u.id).sort()).toEqual(["spec-x:AC-Y", "src/b.ts", "src/c.ts"]);
    expect(unitsOf(first.review).every((u) => u.source === "fresh")).toBe(true);
  });

  it("AC-JR-1 a plan with no AI criterion prints 0 criterion units", async () => {
    const env = makeEnv();
    const { review } = must(await env.review({ files: FILES_V1, criteria: [] }));
    expect(typeof (core as Record<string, unknown>)["renderUnitCounts"]).toBe("function");
    const line = (core as unknown as { renderUnitCounts: (r: MilestoneReview) => string }).renderUnitCounts(review);
    expect(line).toContain("criteria: 0 fresh, 0 reused");
    expect(line).toContain("security: 3 fresh, 0 reused");
  });
});

// ─── AC-JR-2 ─────────────────────────────────────────────────────────────────

describe("AC-JR-2: criterion key covers its files and facts", () => {
  const TEST_FILE = "packages/x/tests/feature.test.ts";
  const COMMAND = `bun run test:file ${TEST_FILE}`;
  const attestation = (testSha: string, commit: string) => [
    { criterion_id: "AC-W", verdict: "pass", command: COMMAND, test_files: [{ path: TEST_FILE, content_sha256: testSha }], commit_sha: commit, run_id: `run-${commit}`, recorded_at: `2026-10-${commit}` },
  ];
  const importing = (testSha = "t1", commit = "01"): AiCriterionInput =>
    criterion("AC-W", "The feature works end to end.", { statement: "The feature works.", command: COMMAND, attestation: attestation(testSha, commit) as never });
  const ctx = (reach: readonly string[], present: readonly string[] = []) => ({
    pathExists: async (path: string): Promise<Result<boolean, LoreError>> => ok(present.includes(path)),
    reachedChangedFiles: async (_command: string, changed: readonly string[]): Promise<Result<readonly string[], LoreError>> => ok(reach.filter((f) => changed.includes(f))),
  });
  const BASE = { "src/lib.ts": "L1", "src/other.ts": "O1" };

  async function secondReviewAsks(first: PlanState, second: PlanState): Promise<string[]> {
    const env = makeEnv();
    must(await env.review(first));
    env.calls.length = 0;
    must(await env.review(second));
    return askedCriteria(env.calls);
  }

  it("AC-JR-2 re-asks when a changed source its command's tests import (and its text does not name) changed", async () => {
    const reach = ctx(["src/lib.ts"]);
    const asked = await secondReviewAsks(
      { files: BASE, criteria: [importing()], ctx: reach },
      { files: { ...BASE, "src/lib.ts": "L2" }, criteria: [importing()], ctx: reach },
    );
    expect(asked).toEqual(["spec-x:AC-W"]);
  });

  it("AC-JR-2 reuses when only files outside its covered set changed", async () => {
    const reach = ctx(["src/lib.ts"]);
    const asked = await secondReviewAsks(
      { files: BASE, criteria: [importing()], ctx: reach },
      { files: { ...BASE, "src/other.ts": "O2" }, criteria: [importing()], ctx: reach },
    );
    expect(asked).toEqual([]);
  });

  it("AC-JR-2 re-asks when its attestation rows at the assessed commit changed (a test file's content hash)", async () => {
    const reach = ctx(["src/lib.ts"]);
    const asked = await secondReviewAsks(
      { files: BASE, criteria: [importing("t1")], ctx: reach },
      { files: BASE, criteria: [importing("t2")], ctx: reach },
    );
    expect(asked).toEqual(["spec-x:AC-W"]);
  });

  it("AC-JR-2 reuses when only the commit, run id and timestamp of its attestation rows changed", async () => {
    const reach = ctx(["src/lib.ts"]);
    const asked = await secondReviewAsks(
      { files: BASE, criteria: [importing("t1", "01")], ctx: reach },
      { files: BASE, criteria: [importing("t1", "02")], ctx: reach },
    );
    expect(asked).toEqual([]);
  });

  it("AC-JR-2 re-asks a criterion that covers no file when any plan file changed", async () => {
    const asked = await secondReviewAsks(
      { files: BASE, criteria: [criterion("AC-Z", "The plan reads clearly overall.")] },
      { files: { ...BASE, "src/other.ts": "O2" }, criteria: [criterion("AC-Z", "The plan reads clearly overall.")] },
    );
    expect(asked).toEqual(["spec-x:AC-Z"]);
  });

  it("AC-JR-2 re-asks when it names a path a fix deleted (neither changed nor present)", async () => {
    const named = criterion("AC-N", "The behaviour in src/gone.ts is documented.");
    const asked = await secondReviewAsks(
      { files: { ...BASE, "src/gone.ts": "G1" }, criteria: [named], ctx: ctx([], []) },
      { files: BASE, criteria: [named], ctx: ctx([], []) },
    );
    expect(asked).toEqual(["spec-x:AC-N"]);
  });

  it("AC-JR-2 reuses a criterion naming a changed path when a different file changed", async () => {
    const named = criterion("AC-N", "The behaviour in src/lib.ts is documented.");
    const asked = await secondReviewAsks(
      { files: BASE, criteria: [named] },
      { files: { ...BASE, "src/other.ts": "O2" }, criteria: [named] },
    );
    expect(asked).toEqual([]);
  });
});

// ─── AC-JR-3 ─────────────────────────────────────────────────────────────────

describe("AC-JR-3: model and prompt version are in the key", () => {
  async function secondAsks(change: (env: ReturnType<typeof makeEnv>) => void, plan: PlanState = { files: FILES_V1, criteria: CRITERIA }) {
    const env = makeEnv();
    must(await env.review(plan));
    env.calls.length = 0;
    change(env);
    const second = must(await env.review(plan));
    return { env, second };
  }
  const EVERY_UNIT_FILES = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const EVERY_UNIT_CRITERIA = ["spec-x:AC-X", "spec-x:AC-Y", "spec-x:AC-Z"];

  it("AC-JR-3 an unchanged second review reuses every unit (control)", async () => {
    const { env } = await secondAsks(() => undefined);
    expect(askedFiles(env.calls)).toEqual([]);
    expect(askedCriteria(env.calls)).toEqual([]);
  });

  it("AC-JR-3 editing the unit-instruction template source makes every unit fresh", async () => {
    const { env } = await secondAsks((e) => {
      e.template = "EDITED unit instructions, no version string changed.";
    });
    expect(askedFiles(env.calls)).toEqual(EVERY_UNIT_FILES);
    expect(askedCriteria(env.calls)).toEqual(EVERY_UNIT_CRITERIA);
  });

  it("AC-JR-3 changing a model-behaviour setting makes every unit fresh", async () => {
    const { env } = await secondAsks((e) => {
      e.identity = { ...e.identity, settings: { temperature: 0.7 } };
    });
    expect(askedFiles(env.calls)).toEqual(EVERY_UNIT_FILES);
    expect(askedCriteria(env.calls)).toEqual(EVERY_UNIT_CRITERIA);
  });

  it("AC-JR-3 changing the answering model makes every unit fresh", async () => {
    const { env } = await secondAsks((e) => {
      e.identity = { ...e.identity, model: "stub-model-2" };
    });
    expect(askedFiles(env.calls)).toEqual(EVERY_UNIT_FILES);
    expect(askedCriteria(env.calls)).toEqual(EVERY_UNIT_CRITERIA);
  });

  it("AC-JR-3 a unit judged first in a chunk call is reused in a full call (call kind, schema and max tokens are not in the key)", async () => {
    const env = makeEnv();
    const eachOwnChunk = Math.max(...Object.keys(FILES_V1).map((p) => diffOf({ [p]: "A1" }).length)) + 2;
    must(await env.review({ files: FILES_V1, criteria: CRITERIA, maxDiffChars: eachOwnChunk }));
    expect(env.calls.map((c) => c.mode)).toEqual(["chunk", "chunk", "chunk", "summary"]);
    env.calls.length = 0;
    must(await env.review({ files: FILES_V1, criteria: CRITERIA }));
    expect(env.calls.map((c) => c.mode)).toEqual(["full"]);
    expect(askedFiles(env.calls)).toEqual([]);
    expect(askedCriteria(env.calls)).toEqual([]);
  });

  it("AC-JR-3 a provider that reports no model makes every unit fresh and the review records reuse disabled with the cause", async () => {
    const { env, second } = await secondAsks((e) => {
      e.identity = { ...e.identity, model: undefined };
    });
    expect(askedFiles(env.calls)).toEqual(EVERY_UNIT_FILES);
    expect(askedCriteria(env.calls)).toEqual(EVERY_UNIT_CRITERIA);
    const reuse = (second.review.judgment as unknown as { reuse?: { enabled: boolean; cause?: string } } | undefined)?.reuse;
    expect(reuse?.enabled).toBe(false);
    expect(reuse?.cause).toMatch(/model/i);
    expect(unitsOf(second.review).every((u) => u.source === "fresh")).toBe(true);
  });

  it("AC-JR-3 a criterion's canonical attestation input is identical across two commits whose test files did not change", async () => {
    const withRows = (commit: string): AiCriterionInput =>
      criterion("AC-W", "Works.", {
        command: "bun run test:file t.test.ts",
        attestation: [{ criterion_id: "AC-W", verdict: "pass", command: "bun run test:file t.test.ts", test_files: [{ path: "t.test.ts", content_sha256: "same" }], commit_sha: commit, run_id: `r-${commit}`, recorded_at: `at-${commit}` }] as never,
      });
    const reach = { pathExists: async () => ok(true), reachedChangedFiles: async () => ok([] as readonly string[]) };
    const env = makeEnv();
    must(await env.review({ files: { "src/x.ts": "X1" }, criteria: [withRows("c1")], ctx: reach as never }));
    env.calls.length = 0;
    must(await env.review({ files: { "src/x.ts": "X1" }, criteria: [withRows("c2")], ctx: reach as never }));
    expect(askedCriteria(env.calls)).toEqual([]);
  });
});

// ─── AC-JR-4 ─────────────────────────────────────────────────────────────────

describe("AC-JR-4: store is first-writer-wins and fails loud", () => {
  it("AC-JR-4 two reviews writing the same unit key concurrently store the first answer and both record it", async () => {
    const store = new FakeVerdictStore();
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = (who: "A" | "B") => async () => {
      arrived += 1;
      if (arrived >= 2) release();
      await bothArrived;
      // B answers well after A has written, so B's insert meets A's row
      if (who === "B") await new Promise((r) => setTimeout(r, 40));
    };
    const a = makeEnv({ store, tag: "A", gate: gate("A") });
    const b = makeEnv({ store, tag: "B", gate: gate("B") });
    const plan: PlanState = { files: FILES_V1, criteria: CRITERIA };
    const [ra, rb] = await Promise.all([a.review(plan), b.review(plan)]);
    const reviewA = must(ra).review;
    const reviewB = must(rb).review;
    const unitA = unitsOf(reviewA).find((u) => u.id === "src/a.ts");
    const unitB = unitsOf(reviewB).find((u) => u.id === "src/a.ts");
    expect(unitA).toBeDefined();
    expect(unitB).toBeDefined();
    const stored = store.rowOf("src/a.ts");
    expect(stored?.raw_answer).toContain("A1");
    expect(stored?.raw_answer).not.toContain("B1");
    expect(unitA?.answer_sha256).toBe(sha(stored?.raw_answer ?? ""));
    expect(unitB?.answer_sha256).toBe(sha(stored?.raw_answer ?? ""));
  });

  it("AC-JR-4 a stored row that fails to parse is replaced once by compare-and-swap and later reviews reuse the replacement", async () => {
    const env = makeEnv();
    const plan: PlanState = { files: FILES_V1, criteria: CRITERIA };
    must(await env.review(plan));
    const row = env.store.rowOf("src/a.ts");
    expect(row).toBeDefined();
    (row as Row).raw_answer = "{not json";
    env.calls.length = 0;
    must(await env.review(plan));
    expect(askedFiles(env.calls)).toEqual(["src/a.ts"]);
    expect(env.store.replaceCalls).toHaveLength(1);
    expect(() => JSON.parse(env.store.rowOf("src/a.ts")?.raw_answer ?? "{not json")).not.toThrow();
    env.calls.length = 0;
    must(await env.review(plan));
    expect(askedFiles(env.calls)).toEqual([]);
    expect(env.store.replaceCalls).toHaveLength(1);
  });

  it("AC-JR-4 rows not read for 30 days are deleted when a review writes; rows read within 30 days survive whatever their template or model", async () => {
    const store = new FakeVerdictStore();
    const now = new Date("2026-11-01T00:00:00.000Z");
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    const seed = (key: string, lastRead: string, model: string): void => {
      store.rows.set(key, { key, unit_kind: "file", unit_id: `seed-${key}`, raw_answer: "{}", provider: "other", model, template_hash: `tpl-${key}`, first_review: "r", created_at: lastRead, last_read_at: lastRead });
    };
    seed("old", daysAgo(31), "m-old");
    seed("recent", daysAgo(29), "m-other-build");
    const env = makeEnv({ store, clock: now });
    must(await env.review({ files: FILES_V1, criteria: CRITERIA }));
    expect(store.rows.has("old")).toBe(false);
    expect(store.rows.has("recent")).toBe(true);
    // a read refreshes last_read_at
    const aRow = store.rowOf("src/a.ts") as Row;
    aRow.last_read_at = daysAgo(10);
    must(await env.review({ files: FILES_V1, criteria: CRITERIA }));
    expect(store.rowOf("src/a.ts")?.last_read_at).toBe(now.toISOString());
  });

  it("AC-JR-4 a store read failure fails the review with exit 4 naming the store and writes no review document", async () => {
    const env = makeEnv();
    env.store.failOn = "get";
    const result = await env.review({ files: FILES_V1, criteria: CRITERIA });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(exitCode(result.error)).toBe(4);
    expect("message" in result.error ? result.error.message : "").toContain("judge_verdicts");
    expect(env.state.docs).toBe(0);
  });

  it("AC-JR-4 a store write failure fails the review with exit 4 naming the store and writes no review document", async () => {
    const env = makeEnv();
    env.store.failOn = "insert";
    const result = await env.review({ files: FILES_V1, criteria: CRITERIA });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(exitCode(result.error)).toBe(4);
    expect("message" in result.error ? result.error.message : "").toContain("judge_verdicts");
    expect(env.state.docs).toBe(0);
  });

  it("AC-JR-4 a failed prune fails the review too (a store failure is never swallowed)", async () => {
    const env = makeEnv();
    env.store.failOn = "prune";
    const result = await env.review({ files: FILES_V1, criteria: CRITERIA });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(exitCode(result.error)).toBe(4);
    expect(env.state.docs).toBe(0);
  });
});
