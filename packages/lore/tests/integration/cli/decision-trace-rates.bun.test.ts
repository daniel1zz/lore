// @reads assets/project/lore-config-template.yaml
// @reads packages/lore/src/adapters/cli/commands/decision.ts
/**
 * AC-DR-9 — outcome links and rates (BR-1481): `lore decision trace` appends issue, decision and part to the plan's latest
 * milestone review once (a repeat is a no-op; two concurrent traces both land); `lore set` refuses `traced_decisions` and
 * `decision_findings`; `lore decision rates` prints per gate and score dimension the decisions passed, the traced failures,
 * the share labelled a lower bound, the rule-of-three bound at zero failures, the decisions in no plan, and the two guard
 * figures. (spec-a-decision-carrying-write-records-its-decision-on-its, "Outcome link and rates")
 *
 * Fixture: `createItemsCorpus` (throwaway corpus; commands run in-process as an attested agent run). Decisions are real:
 * `rule add` / `rule set` on the approved leaf (rule revisions, one scored on an approved weight table) and an `ac add` on a
 * draft spec (a document revision that belongs to the plan). The milestone review is written through the same guarded
 * seam `lore assess` uses (`createMilestoneReviewDoc`), since the AI behind `assess` is not under test. Never the repo's `.lore/`.
 *
 * Dimensions: HAPPY (trace lands, rates print), NEGATIVE (unknown decision / part / plan without review, bad kind or date),
 * BOUNDARY (zero failures prints the rule-of-three bound; a future window selects nothing; no archived task is n/a),
 * STATE (a repeat writes no version; concurrent traces both land), REGRESSION (`lore set` key guards).
 *
 * MOCK RISK: none for the CLI; the review's judge output is hand-built (shape only).
 *
 * @spec_ref AC-DR-9
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { MILESTONE_DIMENSIONS, type MilestoneReview } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { liveAmbient, liveWriteContext, LIVE_TEST_RUN } from "../../live-invocation.js";
import { registerTestRun } from "../../helpers/test-run-identity.js";
import { createItemsCorpus, RULE_ARGS, type ItemsCorpus } from "../../helpers/baseline-items-corpus.js";
import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const DECIDED = ["--reason", "the rule under-states the claim contract", "--premise", "readers hit the gap|issue:#41|A", "--alt", "leave it|the gap stays"];
const GATE_OWNER = ["--gate", "owner-named|pass|the intake names an owner"];
const GATE_SCOPE = ["--gate", "scope-bounded|pass|the change touches one rule"];
const MEANING_PASS = ["--gate", "meaning-unchanged|pass|the new text only adds what the examples already show"];

interface RatesJson {
  ok: boolean;
  data: {
    kind: string | null;
    since: string | null;
    decisions: number;
    gates: Array<{ part: string; decisions: number; tracedFailures: number; shareLowerBound: number; ruleOfThreeUpperBound?: number }>;
    dimensions: Array<{ part: string; decisions: number; tracedFailures: number; shareLowerBound: number; ruleOfThreeUpperBound?: number }>;
    decisionsInNoPlan: number;
    guards: { milestoneReviews: number; tracedLinks: number; tracedLinksPerReview: number | null; archivedTasks: number; decisionsPerArchivedTask: number | null };
  };
}

describe("AC-DR-9: decision trace and decision rates", () => {
  let corpus: ItemsCorpus;
  let dbPath: string;
  let app: App;
  let plan: string;
  let planWithoutReview: string;
  let spec: string;
  let reviewSlug: string;
  let specAddress: string;
  let leafAddress: string;
  let rules: string[] = [];

  const sql = <T>(body: (db: Database) => T): T => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return body(db);
    } finally {
      db.close();
    }
  };
  const docRow = (slug: string): { id: string; version: number; extra: Record<string, unknown> } =>
    sql((db) => {
      const row = db.query("SELECT id, version, extra FROM docs WHERE slug = ?").get(slug) as { id: string; version: number; extra: string };
      return { ...row, extra: JSON.parse(row.extra) as Record<string, unknown> };
    });
  const traced = (): Array<{ issue: number; decision: string; part: string }> =>
    ((docRow(reviewSlug).extra["milestone_review"] as { traced_decisions?: Array<{ issue: number; decision: string; part: string }> }).traced_decisions ?? []);
  const latestVersion = (slug: string): number => docRow(slug).version;
  const slugOf = (stdout: string): string => {
    const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
    if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
    return slug;
  };
  const rates = async (...extra: string[]): Promise<RatesJson["data"]> => {
    const run = await corpus.lore(["decision", "rates", "--json", ...extra]);
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    return (JSON.parse(run.stdout) as RatesJson).data;
  };
  const trace = (...args: string[]) => corpus.lore(["decision", "trace", plan, ...args]);

  beforeAll(async () => {
    corpus = await createItemsCorpus("dr9");
    dbPath = join(corpus.dir, ".lore", "lore.db");

    // two rules, each added with a recorded decision carrying a gate
    for (const [i, gate] of [GATE_OWNER, GATE_OWNER].entries()) {
      const added = await corpus.must(["rule", "add", corpus.leaf, "--statement", `Rule number ${i} refuses an unowned claim at intake.`, ...RULE_ARGS, ...DECIDED, ...gate]);
      const id = added.stdout.match(/\b(BR-\d+)\b/)?.[1];
      if (id === undefined) throw new Error(`no rule id in: ${added.stdout}`);
      rules.push(id);
    }
    await corpus.approveAll(corpus.leaf);

    // an approved rule-revision weight table, then a scored rule revision
    const table = slugOf((await corpus.must(["create", "knowledge", "--parent", await ensureRequirementsDocSlugAsync((a) => corpus.must(a)), "--sub-type", "reference", "--title", "Rule revision weights", "--no-ai", "--content", "# Weights\n\nA table.\n"])).stdout);
    await corpus.must(["weights", "set", table, "--kind", "rule revision", "--dimension", "evidence=0.6", "--dimension", "reach=0.4"]);
    await corpus.approveAll(table);
    const tableVersion = docRow(table).version;
    await corpus.must([
      "rule", "set", rules[0]!, "--statement", "Rule number 0 refuses an unowned claim at intake, with its owner named.",
      ...DECIDED, ...MEANING_PASS, ...GATE_SCOPE, "--weight-table", `${table}@${tableVersion}`, "--score", "change it|evidence|1|measured in the review",
    ]);
    leafAddress = `${corpus.leaf}@${docRow(corpus.leaf).version}`;

    // a plan whose spec carries a document-revision decision (an `ac add` on a draft spec)
    spec = slugOf((await corpus.must(["create", "spec", "--title", "DR9 spec", "--no-ai", "--content", "## Goal\n\nbody"])).stdout);
    plan = slugOf((await corpus.must(["create", "plan", "--title", "DR9 plan", "--parent", spec, "--no-ai", "--content", "# Plan\n\nWork."])).stdout);
    planWithoutReview = slugOf((await corpus.must(["create", "plan", "--title", "DR9 bare plan", "--parent", spec, "--no-ai", "--content", "# Plan\n\nWork."])).stdout);
    await corpus.must(["ac", "add", spec, "AC-T5-1", "--statement", "the command exits exactly 4 and records no revision", "--mode", "human", ...DECIDED, ...GATE_OWNER]);
    specAddress = `${spec}@${docRow(spec).version}`;

    registerTestRun(corpus.dir, LIVE_TEST_RUN);
    app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    const planDoc = docRow(plan);
    const dimension = { verdict: "pass" as const, reason: "ok", reference: "ref" };
    const review: MilestoneReview = {
      plan_id: planDoc.id,
      fingerprint: "f".repeat(64),
      overall: "pass",
      dimensions: Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, dimension])) as MilestoneReview["dimensions"],
      decisions: [],
      prompt_version: "milestone-test",
      diff_source: "none",
    };
    const created = await app.corpusService.createMilestoneReviewDoc({
      type: "knowledge",
      title: "Milestone review: DR9 plan",
      parent_id: planDoc.id,
      extra: { sub_type: "milestone-review", milestone_review: review },
      content: "# Milestone review\n\nFixture.\n",
    });
    if (!created.ok) throw new Error(`review fixture: ${JSON.stringify(created.error)}`);
    reviewSlug = created.value.slug;
    const linked = await app.corpusService.link(created.value.id, planDoc.id, "informs");
    if (!linked.ok) throw new Error(`review link: ${JSON.stringify(linked.error)}`);
  });

  afterAll(() => {
    app.close();
    corpus.cleanup();
  });

  describe("lore decision trace", () => {
    it("refuses a decision that does not exist, a part the decision lacks, and a malformed address (exit 4); nothing is written", async () => {
      const before = latestVersion(reviewSlug);
      const missing = await trace("--issue", "12", "--decision", "no-such-doc@1", "--part", "owner-named");
      expect(missing.exitCode, `${missing.stdout}${missing.stderr}`).toBe(4);
      const noPart = await trace("--issue", "12", "--decision", specAddress, "--part", "charisma");
      expect(noPart.exitCode, `${noPart.stdout}${noPart.stderr}`).toBe(4);
      expect(noPart.stderr).toContain("owner-named");
      const malformed = await trace("--issue", "12", "--decision", "spec-without-version", "--part", "owner-named");
      expect(malformed.exitCode).toBe(4);
      const badIssue = await trace("--issue", "zero", "--decision", specAddress, "--part", "owner-named");
      expect(badIssue.exitCode).toBe(4);
      expect(latestVersion(reviewSlug)).toBe(before);
      expect(traced()).toEqual([]);
    });

    it("refuses a plan with no milestone review (exit 4)", async () => {
      const run = await corpus.lore(["decision", "trace", planWithoutReview, "--issue", "12", "--decision", specAddress, "--part", "owner-named"]);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
      expect(run.stderr).toContain("lore assess");
    });

    it("appends the triple to the plan's latest review; the same triple again is a no-op that writes no version", async () => {
      const first = await trace("--issue", "12", "--decision", specAddress, "--part", "owner-named");
      expect(first.exitCode, `${first.stdout}${first.stderr}`).toBe(0);
      expect(traced()).toEqual([{ issue: 12, decision: specAddress, part: "owner-named" }]);
      const version = latestVersion(reviewSlug);
      const again = await trace("--issue", "12", "--decision", specAddress, "--part", "owner-named");
      expect(again.exitCode, `${again.stdout}${again.stderr}`).toBe(0);
      expect(again.stdout).toContain("Already traced");
      expect(latestVersion(reviewSlug)).toBe(version);
      expect(traced()).toHaveLength(1);
    });

    it("two concurrent traces both land", async () => {
      const [a, b] = await Promise.all([
        trace("--issue", "21", "--decision", leafAddress, "--part", "scope-bounded"),
        trace("--issue", "22", "--decision", leafAddress, "--part", "evidence"),
      ]);
      expect(a.exitCode, `${a.stdout}${a.stderr}`).toBe(0);
      expect(b.exitCode, `${b.stdout}${b.stderr}`).toBe(0);
      const entries = traced();
      expect(entries).toContainEqual({ issue: 21, decision: leafAddress, part: "scope-bounded" });
      expect(entries).toContainEqual({ issue: 22, decision: leafAddress, part: "evidence" });
      expect(entries).toHaveLength(3);
    });

    it("accepts premise as a part", async () => {
      const run = await trace("--issue", "30", "--decision", specAddress, "--part", "premise");
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(traced()).toContainEqual({ issue: 30, decision: specAddress, part: "premise" });
    });
  });

  describe("lore set refuses the verb-owned keys", () => {
    it("a changed traced_decisions is refused (VALIDATION_ERROR, exit 4) naming lore decision trace; the review is unchanged", async () => {
      const row = docRow(reviewSlug);
      const review = row.extra["milestone_review"] as Record<string, unknown>;
      const res = await app.corpusService.set(reviewSlug, { extra: { ...row.extra, milestone_review: { ...review, traced_decisions: [] } } });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(res.error)).toContain("lore decision trace");
      }
      expect(docRow(reviewSlug).version).toBe(row.version);
    });

    it("a hand-written decision_findings is refused too", async () => {
      const row = docRow(reviewSlug);
      const review = row.extra["milestone_review"] as Record<string, unknown>;
      const forged = [{ decision: specAddress, part: "owner-named", kind: "wrong-when-written", fact: "forged" }];
      const res = await app.corpusService.set(reviewSlug, { extra: { ...row.extra, milestone_review: { ...review, decision_findings: forged } } });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("VALIDATION_ERROR");
      expect(docRow(reviewSlug).version).toBe(row.version);
    });

    it("an extra that echoes both keys unchanged stays writable", async () => {
      const row = docRow(reviewSlug);
      const res = await app.corpusService.set(reviewSlug, { extra: { ...row.extra } });
      expect(res.ok, JSON.stringify(res.ok ? "" : res.error)).toBe(true);
    });
  });

  describe("lore decision rates", () => {
    it("prints, per gate, the decisions passed, the traced failures and the share as a lower bound; the untraced gate carries the rule-of-three bound", async () => {
      const data = await rates();
      const owner = data.gates.find((g) => g.part === "owner-named");
      // three decisions pass owner-named: two rule adds (the second rule's version) and the spec's ac add
      expect(owner).toMatchObject({ decisions: 3, tracedFailures: 1 });
      expect(owner?.shareLowerBound).toBeCloseTo(1 / 3, 10);
      expect(owner?.ruleOfThreeUpperBound).toBeUndefined();
      const scope = data.gates.find((g) => g.part === "scope-bounded");
      expect(scope).toMatchObject({ decisions: 1, tracedFailures: 1 });
      const meaning = data.gates.find((g) => g.part === "meaning-unchanged");
      expect(meaning).toMatchObject({ decisions: 1, tracedFailures: 0, ruleOfThreeUpperBound: 3 });
      const text = await corpus.lore(["decision", "rates"]);
      expect(text.exitCode, `${text.stdout}${text.stderr}`).toBe(0);
      expect(text.stdout).toContain("≥ 1/3 (lower bound)");
      expect(text.stdout).toContain("rule of three: < 3/1 at 95%");
    });

    it("prints per score dimension the decisions that scored it and the traced failures", async () => {
      const data = await rates();
      expect(data.dimensions).toHaveLength(1);
      expect(data.dimensions[0]).toMatchObject({ part: "evidence", decisions: 1, tracedFailures: 1 });
    });

    it("counts the recorded decisions that belong to no plan: all but the spec's own", async () => {
      const data = await rates();
      // two rule adds, one scored rule set, one ac add on the plan's spec
      expect(data.decisions).toBe(4);
      expect(data.decisionsInNoPlan).toBe(data.decisions - 1);
      const text = await corpus.lore(["decision", "rates"]);
      expect(text.stdout).toContain(`Decisions in no plan: ${String(data.decisions - 1)}`);
    });

    it("prints the two guard figures: traced links per milestone review, and decisions per archived task (n/a with none archived)", async () => {
      const data = await rates();
      expect(data.guards.milestoneReviews).toBe(1);
      expect(data.guards.tracedLinks).toBe(4);
      expect(data.guards.tracedLinksPerReview).toBe(4);
      expect(data.guards.archivedTasks).toBe(0);
      expect(data.guards.decisionsPerArchivedTask).toBeNull();
      const text = await corpus.lore(["decision", "rates"]);
      expect(text.stdout).toContain("traced links per milestone review: 4.00 (4/1)");
      expect(text.stdout).toContain("decisions per archived task: n/a");
    });

    it("--kind selects the decisions the command fixed as that kind; the two kinds partition the decisions", async () => {
      const all = await rates();
      const rule = await rates("--kind", "rule revision");
      const document = await rates("--kind", "document revision");
      expect(rule.kind).toBe("rule revision");
      expect(rule.decisions + document.decisions).toBe(all.decisions);
      expect(document.decisions).toBeGreaterThanOrEqual(1);
      expect(document.gates.find((g) => g.part === "owner-named")).toMatchObject({ decisions: 1 });
      expect(rule.gates.find((g) => g.part === "owner-named")).toMatchObject({ decisions: 2 });
    });

    it("--since in the future selects no decision: no rows, no division by zero", async () => {
      const data = await rates("--since", "2999-01-01");
      expect(data.decisions).toBe(0);
      expect(data.gates).toEqual([]);
      expect(data.dimensions).toEqual([]);
      expect(data.decisionsInNoPlan).toBe(0);
    });

    it("an unknown kind and an unparsable date are refused (exit 4)", async () => {
      const kind = await corpus.lore(["decision", "rates", "--kind", "plan revision"]);
      expect(kind.exitCode, `${kind.stdout}${kind.stderr}`).toBe(4);
      const since = await corpus.lore(["decision", "rates", "--since", "last tuesday-ish"]);
      expect(since.exitCode, `${since.stdout}${since.stderr}`).toBe(4);
    });
  });
});
