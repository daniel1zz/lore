/**
 * @spec_ref spec-a-judged-finding-keeps-one-root-cause-while-the-code-and (AC-FP-1, AC-FP-2, AC-FP-3; BR-1552)
 *
 * A judged finding keeps one root cause, one issue and one human acceptance while the code and spec it judges are unchanged:
 * its root cause is keyed by the recorded per-unit input hashes, never by the judge's cites, wording or model (#629).
 *
 * The real `MilestoneReviewService` (BR-1535 reuse on, in-memory verdict store), `failingCausesOf`, `IssueFilingService` over a fake
 * tracker and the decision-log acceptance read run end to end. The judge is a stub that rewords and re-cites the same failure on
 * every call. Expected fingerprints are computed here with `node:crypto`, never with the code under test.
 *
 * Dimensions: HAPPY (unchanged code keeps causes, issues, acceptance), NEGATIVE (a path-only key keeps a stale cause), BOUNDARY
 * (cross-file cause appears next to per-file causes and stays when every unit passes), STATE (reuse off still hashes inputs),
 * REGRESSION (model, template, reuse setting never enter a key).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { err, ok, type AiCriterionInput, type DocRecord, type LoreError, type MilestoneDimension, type MilestoneReview, type Result } from "@lore/core";
import { splitDiffByFile } from "../../src/ai/diff-truncation.js";
import { MilestoneReviewService } from "../../src/service/milestone-review-service.js";
import type { JudgeReply } from "../../src/service/milestone-review-judgment.js";
import { failingCausesOf, type RootCause } from "../../src/service/root-cause-fingerprint.js";
import { IssueFilingService, type IssuePort, type IssueRef } from "../../src/service/issue-filing-service.js";
import { acceptedGatesOf, createGateAcceptanceLog } from "../../src/service/gate-acceptance-service.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { actedStore } from "../live-invocation.js";
import { humanAcceptGate } from "../helpers/gate-acceptance-log.js";

// ─── fakes ────────────────────────────────────────────────────────────────────

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

class MemoryVerdictStore {
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

class FakeTracker implements IssuePort {
  readonly open: { number: number; title: string }[] = [];
  readonly filed: { title: string; body: string }[] = [];
  private next = 100;
  async findOpenByFingerprint(short: string) {
    const hit = this.open.find((i) => i.title.includes(`[fp:${short}]`));
    return ok<IssueRef | undefined>(hit === undefined ? undefined : { number: hit.number });
  }
  async file(input: { title: string; body: string }) {
    this.next += 1;
    this.filed.push({ title: input.title, body: input.body });
    this.open.push({ number: this.next, title: input.title });
    return ok<IssueRef>({ number: this.next });
  }
  async recordKnownDefects() {
    return ok(undefined);
  }
}

// ─── the stub judge and the review harness ────────────────────────────────────

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function diffOf(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, body]) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${body}\n`)
    .join("");
}

interface Scenario {
  readonly files: Record<string, string>;
  /** Files whose own unit fails security. */
  readonly failFiles?: readonly string[];
  /** The call-level security verdict fails, citing these files. */
  readonly callCites?: readonly string[];
  readonly failCriteria?: readonly string[];
  readonly specFails?: boolean;
  readonly evidence?: readonly { ac: string; output: string }[];
  readonly specVersion?: number;
}

interface Judge {
  readonly model: string;
  readonly answering: string;
  readonly template?: string;
  readonly reuse: boolean;
}

const CRITERIA: readonly AiCriterionInput[] = [
  { spec: "spec-x", ac: "AC-X", rubric: "X is documented." },
  { spec: "spec-x", ac: "AC-Y", rubric: "Y is documented." },
];
const DIMS = ["spec_conformance", "design_necessity", "concurrency_safety", "security"];
const A = "src/a.ts";
const B = "src/b.ts";
const C = "src/c.ts";
const V1: Record<string, string> = { [A]: "A1", [B]: "B1", [C]: "C1" };

function makeEnv(store = new MemoryVerdictStore()) {
  let counter = 0;
  let docs = 0;
  const env = {
    store,
    judge: { model: "stub-model-1", answering: "stub-model-1", reuse: true } as Judge,
    async review(sc: Scenario): Promise<MilestoneReview> {
      const judge = async (prompt: string): Promise<Result<JudgeReply, LoreError>> => {
        counter += 1;
        const n = counter;
        const files = [...prompt.matchAll(/^- file (\S+): ASK/gm)].map((m) => m[1] as string);
        const ids = [...prompt.matchAll(/^- criterion (\S+): ASK/gm)].map((m) => m[1] as string);
        const unitsListed = /^# Units$/m.test(prompt);
        const askedFiles = unitsListed ? files : Object.keys(sc.files);
        const askedIds = unitsListed ? ids : CRITERIA.map((c) => `${c.spec}:${c.ac}`);
        // every call words and cites the same failures differently (#629)
        const dim = (d: string, fail: boolean, cites: readonly string[]) => ({
          verdict: fail ? "fail" : "pass",
          reason: `call ${String(n)} says ${d} ${fail ? "is broken" : "is fine"}`,
          reference: "OWASP ASVS",
          cites: fail ? [`symbol-${String(n)}`, ...cites] : [],
        });
        const callFail = (sc.callCites?.length ?? 0) > 0;
        const answer = {
          dimensions: {
            spec_conformance: dim("spec_conformance", sc.specFails === true, []),
            design_necessity: dim("design_necessity", false, []),
            concurrency_safety: dim("concurrency_safety", false, []),
            security: dim("security", callFail, sc.callCites ?? []),
          },
          files: askedFiles.map((path) => ({
            path,
            security: dim(`security of ${path}`, (sc.failFiles ?? []).includes(path), [`${path}:${String(n)}`]),
            concurrency_safety: dim(`concurrency of ${path}`, false, []),
          })),
          criteria: askedIds.map((id) => {
            const [spec, ac] = id.split(":") as [string, string];
            return { spec, ac, verdict: (sc.failCriteria ?? []).includes(ac) ? "fail" : "pass", reason: `call ${String(n)} criterion ${ac}` };
          }),
        };
        return ok({ text: JSON.stringify(answer), duration_ms: 1, model: env.judge.answering } as JudgeReply);
      };
      const bundle = {
        plan: { id: "P1", slug: "plan-one", title: "Plan", content: "Body.", version: 1, status: "approved", extra: {} },
        tasks: [
          {
            id: "T1",
            slug: "task-one",
            title: "Task",
            status: "archived",
            content: "body",
            version: 1,
            extra: { verification_evidence: (sc.evidence ?? []).map((e) => ({ oracle: "test", command: "bun run t", result: "pass", output_tail: e.output, ac_ref: e.ac, recorded_at: "2026-11-01T00:00:00.000Z", recorded_by: "agent:a" })) },
          },
        ],
        spec: { id: "S1", slug: "spec-x", title: "Spec", content: "spec body", version: sc.specVersion ?? 1, extra: {} },
      };
      const service = new MilestoneReviewService({
        getPlanBundle: async () => ok(bundle as never),
        getCitedRuleStates: async () => ok([] as never),
        listDecisionLog: async () => ok([]),
        judge: async () => err({ code: "STORE_ERROR", message: "judgeMeasured is wired" }),
        judgeMeasured: judge,
        createReviewDoc: async (input: { extra: unknown }) => {
          docs += 1;
          return ok({ id: "R1", slug: `review-${String(docs)}`, extra: input.extra } as unknown as DocRecord);
        },
        link: async () => ok(undefined),
        judgeVerdicts: store,
        judgeIdentity: () => ({ provider: "stub", model: env.judge.model, reportsAnsweringModel: env.judge.reuse, settings: {} }),
        now: () => new Date("2026-11-01T00:00:00.000Z"),
        ...(env.judge.template !== undefined ? { unitInstructions: env.judge.template } : {}),
      } as never);
      const result = await service.review("plan-one", { diffText: diffOf(sc.files), diffSource: "test", maxDiffChars: 80000, facts: { ai_criteria: CRITERIA, assessed_commit: "c1" } } as never);
      if (!result.ok) throw new Error(`review failed: ${JSON.stringify(result.error)}`);
      return result.value.review;
    },
  };
  return env;
}

function causesOf(review: MilestoneReview, dimension: MilestoneDimension, slug = "review-x"): RootCause[] {
  const causes = failingCausesOf("plan-one", slug, review, dimension);
  if (!causes.ok) throw new Error(`no cause: ${JSON.stringify(causes.error)}`);
  return causes.value;
}
const fingerprints = (causes: readonly RootCause[]): string[] => causes.map((c) => c.fingerprint).sort();
/** sha256 of the file's net diff section: the file unit input as the production splitter defines it. */
const inputHash = (files: Record<string, string>, path: string): string => sha(splitDiffByFile(diffOf(files)).find((f) => f.filePath === path)?.text ?? "");
const unitFingerprint = (dimension: string, path: string, files: Record<string, string>): string => sha(`${dimension}|unit:${path}:${inputHash(files, path)}`);
const pairsOf = (files: Record<string, string>): string =>
  Object.keys(files)
    .sort()
    .map((p) => `${p}\u0000${inputHash(files, p)}`)
    .join("\n");
const crossFingerprint = (dimension: string, files: Record<string, string>): string => sha(`${dimension}|cross-file:${sha(pairsOf(files))}`);
const planFingerprint = (dimension: string, files: Record<string, string>, spec = "spec-x@1"): string => sha(`${dimension}|plan:${sha(`${spec}\n${pairsOf(files)}`)}`);

// ─── AC-FP-1 ──────────────────────────────────────────────────────────────────

describe("AC-FP-1 unchanged code keeps its causes, issues and acceptance", () => {
  const sc: Scenario = { files: V1, failFiles: [A, B], specFails: true };

  it("AC-FP-1 HAPPY: two reviews worded and cited differently give the same two security causes, keyed by file and input hash", async () => {
    const env = makeEnv();
    const first = await env.review(sc);
    const second = await env.review(sc);
    // the stub really did reword and re-cite the verdict: a cites-keyed cause would differ
    expect(first.dimensions.spec_conformance.reason).not.toBe(second.dimensions.spec_conformance.reason);
    expect(first.dimensions.spec_conformance.cites).not.toEqual(second.dimensions.spec_conformance.cites);

    const one = causesOf(first, "security");
    const two = causesOf(second, "security");
    expect(one).toHaveLength(2);
    expect(fingerprints(one)).toEqual([unitFingerprint("security", A, V1), unitFingerprint("security", B, V1)].sort());
    expect(fingerprints(two)).toEqual(fingerprints(one));
    expect(one.map((c) => c.label).sort()).toEqual([A, B]);
    // spec_conformance fails on both reviews with one cause, the same one
    const specOne = causesOf(first, "spec_conformance");
    expect(specOne).toHaveLength(1);
    expect(fingerprints(causesOf(second, "spec_conformance"))).toEqual(fingerprints(specOne));
    expect(specOne[0]?.fingerprint).toBe(planFingerprint("spec_conformance", V1));
  });

  it("AC-FP-1 HAPPY: the second review files no new issue and each issue body lists its unit with the input hash", async () => {
    const env = makeEnv();
    const first = await env.review(sc);
    const second = await env.review(sc);
    const tracker = new FakeTracker();
    const filing = new IssueFilingService(tracker);
    const finding = (review: MilestoneReview, dimension: MilestoneDimension, slug: string) => ({
      plan: "plan-one",
      dimension,
      reason: review.dimensions[dimension].reason,
      reference: review.dimensions[dimension].reference,
      cites: review.dimensions[dimension].cites,
      reviewSlug: slug,
      causes: review.causes,
    });
    const filedFirst = await filing.fileFindings([finding(first, "security", "review-1"), finding(first, "spec_conformance", "review-1")]);
    expect(filedFirst.ok).toBe(true);
    expect(tracker.filed).toHaveLength(3);
    const titlesAfterFirst = tracker.filed.map((f) => f.title);
    const filedSecond = await filing.fileFindings([finding(second, "security", "review-2"), finding(second, "spec_conformance", "review-2")]);
    expect(filedSecond.ok).toBe(true);
    expect(tracker.filed.map((f) => f.title)).toEqual(titlesAfterFirst);
    if (filedSecond.ok) expect(filedSecond.value.every((g) => g.reused)).toBe(true);
    const bodies = tracker.filed.filter((f) => f.title.startsWith("security:")).map((f) => f.body);
    for (const path of [A, B]) {
      const body = bodies.find((b) => b.includes(path));
      expect(body).toBeDefined();
      expect(body).toContain(inputHash(V1, path));
    }
  });

  it("AC-FP-1 STATE: a human acceptance of the security gate from the first review still counts for the second", async () => {
    const env = makeEnv();
    const first = await env.review(sc);
    const second = await env.review(sc);
    const store = actedStore(new InMemoryStore());
    for (const cause of causesOf(first, "security")) await humanAcceptGate(store, "P1", "security", cause.fingerprint);
    const log = createGateAcceptanceLog(store);
    const accepted = await acceptedGatesOf({ id: "P1", slug: "plan-one" } as never, { doc: { slug: "review-2" }, review: second } as never, log);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value).toContain("security");
  });
});

// ─── AC-FP-2 ──────────────────────────────────────────────────────────────────

describe("AC-FP-2 a cause changes exactly when its unit input changes", () => {
  it("AC-FP-2 NEGATIVE: after a fix changes only a's diff, a has a new cause and b keeps its own", async () => {
    const env = makeEnv();
    const first = await env.review({ files: V1, failFiles: [A, B] });
    const changed = { ...V1, [A]: "A2" };
    const second = await env.review({ files: changed, failFiles: [A, B] });
    const one = causesOf(first, "security");
    const two = causesOf(second, "security");
    expect(fingerprints(two)).toEqual([unitFingerprint("security", A, changed), unitFingerprint("security", B, changed)].sort());
    // b kept, a replaced: a path-only key would have kept a's old cause
    expect(fingerprints(two).filter((f) => fingerprints(one).includes(f))).toEqual([unitFingerprint("security", B, V1)]);
    expect(fingerprints(two)).not.toContain(unitFingerprint("security", A, V1));
  });

  it("AC-FP-2 BOUNDARY: a call-level fail citing c, whose unit passes, adds one cross-file cause that changes when any changed file changes", async () => {
    const env = makeEnv();
    const sc: Scenario = { files: V1, failFiles: [A, B], callCites: [C] };
    const first = await env.review(sc);
    const causes = causesOf(first, "security");
    expect(causes).toHaveLength(3);
    expect(fingerprints(causes)).toEqual([unitFingerprint("security", A, V1), unitFingerprint("security", B, V1), crossFingerprint("security", V1)].sort());
    const cross = causes.find((c) => c.fingerprint === crossFingerprint("security", V1));
    expect(cross?.cited_files).toEqual([C]);

    for (const path of [A, B, C]) {
      const changedFiles = { ...V1, [path]: "CHANGED" };
      const again = await env.review({ ...sc, files: changedFiles });
      const crossAgain = causesOf(again, "security").find((c) => c.fingerprint.length > 0 && c.cited_files !== undefined);
      expect(crossAgain?.fingerprint).toBe(crossFingerprint("security", changedFiles));
      expect(crossAgain?.fingerprint).not.toBe(cross?.fingerprint);
    }
  });

  it("AC-FP-2 BOUNDARY: when a and b are fixed the cross-file cause remains, not folded into per-file causes", async () => {
    const env = makeEnv();
    const review = await env.review({ files: V1, failFiles: [], callCites: [C] });
    const causes = causesOf(review, "security");
    expect(causes).toHaveLength(1);
    expect(causes[0]?.fingerprint).toBe(crossFingerprint("security", V1));
  });

  it("AC-FP-2 HAPPY: a failing AI criterion has its own cause, which changes when its evidence rows change and not otherwise", async () => {
    const env = makeEnv();
    const sc: Scenario = { files: V1, failCriteria: ["AC-X"], evidence: [{ ac: "AC-X", output: "out-1" }] };
    const first = await env.review(sc);
    const same = await env.review(sc);
    const one = causesOf(first, "correctness_vs_acs");
    expect(one).toHaveLength(1);
    expect(one[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprints(causesOf(same, "correctness_vs_acs"))).toEqual(fingerprints(one));
    const evidenceChanged = await env.review({ ...sc, evidence: [{ ac: "AC-X", output: "out-2" }] });
    expect(fingerprints(causesOf(evidenceChanged, "correctness_vs_acs"))).not.toEqual(fingerprints(one));
    // the criterion unit's recorded input hash is what the cause is keyed by
    const unit = (first.judgment as unknown as { units: { id: string; input_sha256?: string }[] }).units.find((u) => u.id === "spec-x:AC-X");
    expect(unit?.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(one[0]?.fingerprint).toBe(sha(`correctness_vs_acs|criterion:spec-x:AC-X:${unit?.input_sha256 as string}`));
  });

  it("AC-FP-2 BOUNDARY: the plan-level cause changes when the spec version or any changed file changes", async () => {
    const env = makeEnv();
    const sc: Scenario = { files: V1, specFails: true };
    const base = causesOf(await env.review(sc), "spec_conformance");
    expect(base[0]?.fingerprint).toBe(planFingerprint("spec_conformance", V1));
    const v2 = causesOf(await env.review({ ...sc, specVersion: 2 }), "spec_conformance");
    expect(v2[0]?.fingerprint).toBe(planFingerprint("spec_conformance", V1, "spec-x@2"));
    const edited = { ...V1, [C]: "C2" };
    const moved = causesOf(await env.review({ ...sc, files: edited }), "spec_conformance");
    expect(moved[0]?.fingerprint).toBe(planFingerprint("spec_conformance", edited));
  });
});

// ─── AC-FP-3 ──────────────────────────────────────────────────────────────────

describe("AC-FP-3 the model and prompt never enter a cause", () => {
  const sc: Scenario = { files: V1, failFiles: [A, B], callCites: [C], failCriteria: ["AC-X"], specFails: true };
  const DIMENSIONS: MilestoneDimension[] = ["security", "spec_conformance", "correctness_vs_acs"];
  const all = (review: MilestoneReview): string[] => DIMENSIONS.flatMap((d) => fingerprints(causesOf(review, d)).map((f) => `${d}:${f}`));

  it("AC-FP-3 REGRESSION: changing the judge model, the prompt template or turning reuse off leaves every fingerprint the same", async () => {
    const env = makeEnv();
    const base = await env.review(sc);
    const baseline = all(base);
    expect(baseline.length).toBeGreaterThanOrEqual(5);

    env.judge = { model: "other-model-2", answering: "other-model-2", reuse: true };
    const otherModel = await env.review(sc);
    // the units were judged again (a model-keyed cause would differ) yet the causes are the same
    expect((otherModel.judgment as unknown as { units: { source: string }[] }).units.every((u) => u.source === "fresh")).toBe(true);
    expect(all(otherModel)).toEqual(baseline);

    env.judge = { model: "other-model-2", answering: "other-model-2", template: "EDITED unit instructions", reuse: true };
    expect(all(await env.review(sc))).toEqual(baseline);

    env.judge = { model: "stub-model-1", answering: "stub-model-1", reuse: false };
    const noReuse = await env.review(sc);
    expect(all(noReuse)).toEqual(baseline);
  });

  it("AC-FP-3 STATE: with reuse off the unit input hashes are still recorded and computed", async () => {
    const env = makeEnv();
    env.judge = { model: "stub-model-1", answering: "stub-model-1", reuse: false };
    const review = await env.review(sc);
    const units = (review.judgment as unknown as { units: { kind: string; id: string; input_sha256?: string }[]; reuse: { enabled: boolean } }).units;
    expect((review.judgment as unknown as { reuse: { enabled: boolean } }).reuse.enabled).toBe(false);
    const fileUnit = units.find((u) => u.id === A);
    expect(fileUnit?.input_sha256).toBe(inputHash(V1, A));
    expect(units.every((u) => /^[0-9a-f]{64}$/.test(u.input_sha256 ?? ""))).toBe(true);
    expect(fingerprints(causesOf(review, "security"))).toContain(unitFingerprint("security", A, V1));
  });
});
