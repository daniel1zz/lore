// @layer service-resume-rule-diff-wiring AC-BLS2-22
/**
 * @spec_ref AC-BLS2-22
 * @task task-implement-the-bl-15-resume-rule-diff
 *
 * Wiring test (capability != wiring): `lore feed session-resume` (flows/feed-flow.ts
 * `buildResumeFeed`, shared by CLI and MCP) must PRINT the BL-15 governing-rule diff for the
 * claimed tasks of its plan scope. The capability itself is pinned by resume-rule-diff.test.ts.
 *
 * Dimensions: HAPPY (post-claim edit shown) / BOUNDARY (unchanged line) / NEGATIVE (no claimed
 * task -> no block; found-path ordering keeps the scope closure last) / ERROR (unknown plan fails).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { SessionService, type ResumeResult } from "../../../src/service/session-service.js";
import { buildResumeFeed, renderResumeFeed } from "../../../src/flows/feed-flow.js";
import type { App } from "../../../src/app.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { RESUME_SCOPE_CLOSURE } from "@lore/core";
import { makeRuleService } from "../../helpers/make-rule-service.js";

const T_SETUP = "2026-03-01T08:00:00.000Z";
const T_CLAIM = "2026-03-01T10:00:00.000Z";
const T_POST = "2026-03-01T11:00:00.000Z";
const UNCHANGED_LINE = "governing rules unchanged since claim";
const BLOCK_HEADER = "Governing rules since claim";

let store: InMemoryStore;
let corpus: CorpusService;
let rules: RuleService;
let workflow: TaskWorkflowService;
let app: App;

function at(iso: string): void { vi.setSystemTime(new Date(iso)); }

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`create ${input.type} failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

interface Fixture { plan: DocRecord; task: DocRecord; ruleId: string }

async function makeFixture(): Promise<Fixture> {
  at(T_SETUP);
  const prd = await mustCreate({ type: "prd", title: "Wiring PRD", content: "p" } as CreateDocInput);
  const root = await mustCreate({
    type: "baseline", title: "Baseline root", content: "r", parent_id: prd.id,
    extra: { node: "root", label: "Root", glossary: [{ term: "Doc", meaning: "A unit" }] },
  } as CreateDocInput);
  const branch = await mustCreate({
    type: "baseline", title: "Baseline branch", content: "b", parent_id: root.id,
    extra: { node: "branch", label: "Branch", glossary: [{ term: "Leaf", meaning: "Holder" }, { term: "Rule", meaning: "A fact" }] },
  } as CreateDocInput);
  const leaf = await mustCreate({
    type: "baseline", title: "Baseline leaf", content: "l", parent_id: branch.id,
    extra: { node: "leaf", label: "Leaf" },
  } as CreateDocInput);
  const added = await rules.addRule(
    leaf.id,
    { statement: "Wired rule holds", confidence: "established", enforced_by: "guaranteed", examples: ["wired example"] },
    { by: "agent:test" },
  );
  if (!added.ok) throw new Error(`addRule failed: ${JSON.stringify(added.error)}`);
  const ruleId = added.value.ruleId;
  const spec = await mustCreate({
    type: "spec", title: "Wiring Spec",content: "s",
    extra: {
      acceptance_criteria: [{
        id: "AC-W-1", statement: "Criterion AC-W-1 is satisfied.",
        verify: { mode: "script", oracle: "test", command: "bun test" }, cites: [ruleId],
      }],
    },
  } as CreateDocInput);
  const plan = await mustCreate({ type: "plan", title: "Wiring Plan", parent_id: spec.id, content: "p" } as CreateDocInput);
  const task = await mustCreate({
    type: "task", title: "Wiring Task", parent_id: plan.id, content: "body", extra: { plan_id: plan.id },
  } as CreateDocInput);
  return { plan, task, ruleId };
}

async function claimAt(task: DocRecord, iso: string): Promise<void> {
  const r = await workflow.claim(task.id, { by: "agent:resumer" }, () => iso);
  if (!r.ok) throw new Error(`claim failed: ${JSON.stringify(r.error)}`);
}

async function feedFor(plan: DocRecord): Promise<string> {
  const r = await buildResumeFeed(app, { plan: plan.slug });
  if (!r.ok) throw new Error(`buildResumeFeed failed: ${JSON.stringify(r.error)}`);
  return r.value.feed;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  store = new InMemoryStore();
  corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  rules = makeRuleService(store);
  workflow = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 1440,
    createHandoffDoc: (input) => corpus.createHandoffDoc(input),
  });
  // reason: buildResumeFeed reads only `app.sessionService`; the rest of App is irrelevant here.
  app = { sessionService } as unknown as App;
});

afterEach(() => { vi.useRealTimers(); });

describe("lore feed session-resume prints the BL-15 rule diff", () => {
  it("shows the claimed task's governing rule change with old and new statement", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    const set = await rules.setRule(fx.ruleId, { statement: "Wired rule now differs" }, { by: "agent:test" });
    if (!set.ok) throw new Error(JSON.stringify(set.error));

    const feed = await feedFor(fx.plan);
    expect(feed).toContain(BLOCK_HEADER);
    expect(feed).toContain(fx.task.slug);
    expect(feed).toContain(fx.ruleId);
    expect(feed).toContain("Wired rule holds");
    expect(feed).toContain("Wired rule now differs");
    expect(feed).not.toContain(UNCHANGED_LINE);
  });

  it("prints the unchanged line when no governing rule moved since the claim", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);

    const feed = await feedFor(fx.plan);
    expect(feed).toContain(BLOCK_HEADER);
    expect(feed).toContain(UNCHANGED_LINE);
  });

  it("prints no rule-diff block when the plan has no claimed task", async () => {
    const fx = await makeFixture();
    const feed = await feedFor(fx.plan);
    expect(feed).not.toContain(BLOCK_HEADER);
    expect(feed).not.toContain(UNCHANGED_LINE);
  });

  it("an unknown --plan fails the feed instead of printing nothing", async () => {
    await makeFixture();
    const r = await buildResumeFeed(app, { plan: "no-such-plan" });
    expect(r.ok).toBe(false);
  });
});

describe("renderResumeFeed weaves the block into a found ticket", () => {
  it("places the block before the scope closure, which stays the trailing block", () => {
    const resume: ResumeResult = {
      found: true,
      multi_actor: false,
      readiness: null,
      handoff: {
        handoff_slug: "h-1", plan_slug: null, by: "agent:x", age_minutes: 5,
        ttl_warning: false, degraded: false, content: "handoff body",
      } as unknown as NonNullable<ResumeResult["handoff"]>,
    };
    const out = renderResumeFeed(resume, false, undefined, "── Governing rules since claim ──\nt:\n  unchanged");
    expect(out).toContain(BLOCK_HEADER);
    expect(out.indexOf(BLOCK_HEADER)).toBeLessThan(out.indexOf(RESUME_SCOPE_CLOSURE));
    expect(out.endsWith(RESUME_SCOPE_CLOSURE)).toBe(true);
  });
});
