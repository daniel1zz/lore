/**
 * @spec_ref AC-BLS2-22
 * @task task-red-ac-bls2-22-resume-rule-diff (RED)
 *
 * Spec: SPEC-157 AC-BLS2-22 / BR-966 (leaf baseline-resume-a-session, BL-15):
 *   resuming a session for a claimed task lists the governing rules whose statement,
 *   confidence or lifecycle changed since the claim, each with old and new value; a rule
 *   retired since the claim is listed as retired; with no change the output is the one
 *   line "governing rules unchanged since claim"; a change made before the claim is not listed.
 *
 * ── PINNED CONTRACT (the implementation builds to exactly this) ─────────────
 *   Module  packages/lore/src/service/resume-rule-diff.ts
 *   computeRuleDiffSinceClaim({ store, taskId }) -> Result<{
 *       claimed_at: string,                       // = task.extra.claim.at
 *       changes: Array<{ rule_id, kind: "statement"|"confidence"|"lifecycle", old: string, new: string }>,
 *       retired: string[]                         // rule ids retired now that were not retired at claim time
 *     }>
 *     - compares each GOVERNING rule (the task's spec cites) as of the claim timestamp
 *       (leaf version history) against its current value
 *     - no claim on the task -> err VALIDATION_ERROR whose message names the missing claim
 *   renderRuleDiff(diff) -> string[]  (empty diff -> exactly ["governing rules unchanged since claim"])
 *
 * A retirement is also a lifecycle change. This test pins ONLY that `retired` contains the
 * rule; it does not pin whether a lifecycle `changes` entry is also emitted for a retirement.
 *
 * Time: the store stamps version rows with the wall clock, so the test pins Date with fake
 * timers (Date only) to put edits strictly before / after the claim instant.
 *
 * Dimensions: HAPPY / NEGATIVE (other-spec rule, pre-claim change) / BOUNDARY (no change,
 * pre-claim then post-claim edit) / ERROR (no claim, unknown task) / REGRESSION (different
 * inputs -> different outputs, so a fixed stub cannot pass).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { actedStore } from "../../live-invocation.js";

interface RuleChange { rule_id: string; kind: "statement" | "confidence" | "lifecycle"; old: string; new: string }
interface RuleDiff { claimed_at: string; changes: RuleChange[]; retired: string[] }
type Res<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
interface DiffModule {
  computeRuleDiffSinceClaim(a: { store: InMemoryStore; taskId: string }): Promise<Res<RuleDiff>>;
  renderRuleDiff(d: RuleDiff): string[];
}

// Variable specifier: the module does not exist yet; keeps typecheck at 0 and RED at runtime.
async function loadModule(): Promise<DiffModule> {
  const specifier = "../../../src/service/resume-rule-diff.js";
  return (await import(/* @vite-ignore */ specifier)) as DiffModule;
}

const UNCHANGED_LINE = "governing rules unchanged since claim";
const T_SETUP = "2026-03-01T08:00:00.000Z";
const T_PRE = "2026-03-01T09:00:00.000Z";
const T_CLAIM = "2026-03-01T10:00:00.000Z";
const T_POST = "2026-03-01T11:00:00.000Z";

let store: InMemoryStore;
let corpus: CorpusService;
let rules: RuleService;
let workflow: TaskWorkflowService;

function at(iso: string): void { vi.setSystemTime(new Date(iso)); }

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`create ${input.type} failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function makeLeaf(prd: DocRecord): Promise<DocRecord> {
  const root = await mustCreate({
    type: "baseline", title: "Baseline root", content: "r", parent_id: prd.id,
    extra: { node: "root", label: "Root", glossary: [{ term: "Doc", meaning: "A unit" }] },
  } as CreateDocInput);
  const branch = await mustCreate({
    type: "baseline", title: "Baseline branch", content: "b", parent_id: root.id,
    extra: { node: "branch", label: "Branch", glossary: [{ term: "Leaf", meaning: "Holder" }, { term: "Rule", meaning: "A fact" }] },
  } as CreateDocInput);
  return mustCreate({
    type: "baseline", title: "Baseline leaf", content: "l", parent_id: branch.id,
    extra: { node: "leaf", label: "Leaf" },
  } as CreateDocInput);
}

async function addRule(leaf: DocRecord, statement: string): Promise<string> {
  const r = await rules.addRule(
    leaf.id,
    { statement, confidence: "established", enforced_by: "guaranteed", examples: [`example of ${statement}`] },
    { by: "agent:test" },
  );
  if (!r.ok) throw new Error(`addRule failed: ${JSON.stringify(r.error)}`);
  return r.value.ruleId;
}

async function setRule(id: string, patch: Parameters<RuleService["setRule"]>[1]): Promise<void> {
  const r = await rules.setRule(id, patch, { by: "agent:test" });
  if (!r.ok) throw new Error(`setRule ${id} failed: ${JSON.stringify(r.error)}`);
}

/**
 * Put a rule into the `deprecated` lifecycle by writing the leaf directly. `RuleService.setRule` refuses
 * `--lifecycle deprecated` since D4 of spec-a-spec-carries-its-rule-changes-the-baseline-takes-them, but rules that
 * were deprecated earlier still exist and the diff must keep reading them.
 */
async function forceDeprecated(ruleId: string): Promise<void> {
  const leaves = await store.findMany({ type: "baseline" });
  if (!leaves.ok) throw new Error("baseline read failed");
  const leaf = leaves.value.find((d) => (d.extra["rules"] as Array<{ id: string }> | undefined)?.some((r) => r.id === ruleId));
  if (leaf === undefined) throw new Error(`no leaf holds ${ruleId}`);
  const extra = {
    ...leaf.extra,
    rules: (leaf.extra["rules"] as Array<{ id: string }>).map((r) => (r.id === ruleId ? { ...r, lifecycle: "deprecated" } : r)),
  };
  const next = leaf.version + 1;
  const updated = await store.update(leaf.id, { extra, version: next, updated_at: new Date().toISOString() }, { expected_version: leaf.version });
  if (!updated.ok) throw new Error(`forceDeprecated failed: ${JSON.stringify(updated.error)}`);
  const logged = await store.insertVersion({
    doc_id: leaf.id, version: next, content: leaf.content, extra, status: leaf.status, title: leaf.title,
    action: "update", created_at: new Date().toISOString(), created_by: "agent:test", slug: leaf.slug,
  });
  if (!logged.ok) throw new Error("insertVersion failed");
}

function criterion(id: string, cites: string[]): unknown {
  return {
    id, statement: `Criterion ${id} is satisfied.`,
    verify: { mode: "script", oracle: "test", command: "bun test" }, cites,
  };
}

interface Fixture { task: DocRecord; governed: string; governed2: string; foreign: string }

/** Task whose spec cites `governed` + `governed2`; a second spec cites `foreign` (not governing). */
async function makeFixture(): Promise<Fixture> {
  at(T_SETUP);
  const prd = await mustCreate({ type: "prd", title: "Resume PRD", content: "p" } as CreateDocInput);
  const leaf = await makeLeaf(prd);
  const governed = await addRule(leaf, "Governed rule alpha holds");
  const governed2 = await addRule(leaf, "Governed rule beta holds");
  const foreign = await addRule(leaf, "Foreign rule gamma holds");
  const spec = await mustCreate({
    type: "spec", title: "Governing Spec",content: "s",
    extra: { acceptance_criteria: [criterion("AC-RES-1", [governed, governed2])] },
  } as CreateDocInput);
  await mustCreate({
    type: "spec", title: "Other Spec",content: "s2",
    extra: { acceptance_criteria: [criterion("AC-OTH-1", [foreign])] },
  } as CreateDocInput);
  const plan = await mustCreate({ type: "plan", title: "Resume Plan", parent_id: spec.id, content: "p" } as CreateDocInput);
  const task = await mustCreate({
    type: "task", title: "Resume Task", parent_id: plan.id, content: "body", extra: { plan_id: plan.id },
  } as CreateDocInput);
  return { task, governed, governed2, foreign };
}

async function claimAt(task: DocRecord, iso: string): Promise<void> {
  const r = await workflow.claim(task.id, { by: "agent:resumer" }, () => iso);
  if (!r.ok) throw new Error(`claim failed: ${JSON.stringify(r.error)}`);
}

async function diffOf(task: DocRecord): Promise<RuleDiff> {
  const mod = await loadModule();
  const r = await mod.computeRuleDiffSinceClaim({ store, taskId: task.id });
  if (!r.ok) throw new Error(`computeRuleDiffSinceClaim failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  store = actedStore(new InMemoryStore());
  corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  rules = makeRuleService(store);
  workflow = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
});

afterEach(() => { vi.useRealTimers(); });

describe("resume lists rule changes since claim (BL-15)", () => {
  it("lists a governing rule whose statement was edited after the claim, with old and new statement", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await setRule(fx.governed, { statement: "Governed rule alpha now holds differently" });

    const diff = await diffOf(fx.task);
    expect(diff.claimed_at).toBe(T_CLAIM);
    expect(diff.changes).toEqual([
      { rule_id: fx.governed, kind: "statement", old: "Governed rule alpha holds", new: "Governed rule alpha now holds differently" },
    ]);
    expect(diff.retired).toEqual([]);
  });

  it("lists a confidence change with old and new confidence", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await setRule(fx.governed2, { confidence: "unconfirmed" });

    const diff = await diffOf(fx.task);
    expect(diff.changes).toEqual([
      { rule_id: fx.governed2, kind: "confidence", old: "established", new: "unconfirmed" },
    ]);
  });

  it("lists a rule retired after the claim in `retired`", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await setRule(fx.governed, { lifecycle: "retired", note: "superseded by a newer rule" });

    const diff = await diffOf(fx.task);
    expect(diff.retired).toEqual([fx.governed]);
  });

  it("lists a lifecycle change (live -> deprecated) with old and new lifecycle, and does not call it retired", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await forceDeprecated(fx.governed);

    const diff = await diffOf(fx.task);
    expect(diff.changes).toEqual([{ rule_id: fx.governed, kind: "lifecycle", old: "live", new: "deprecated" }]);
    expect(diff.retired).toEqual([]);
  });

  it("does not list a change made BEFORE the claim", async () => {
    const fx = await makeFixture();
    at(T_PRE);
    await setRule(fx.governed, { statement: "Governed rule alpha was edited before the claim" });
    await setRule(fx.governed2, { confidence: "observed" });
    await claimAt(fx.task, T_CLAIM);

    const diff = await diffOf(fx.task);
    expect(diff.changes).toEqual([]);
    expect(diff.retired).toEqual([]);
  });

  it("a pre-claim edit followed by a post-claim edit reports old = the value AT claim time, not the original", async () => {
    const fx = await makeFixture();
    at(T_PRE);
    await setRule(fx.governed, { statement: "alpha as of claim" });
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await setRule(fx.governed, { statement: "alpha after claim" });

    const diff = await diffOf(fx.task);
    expect(diff.changes).toEqual([
      { rule_id: fx.governed, kind: "statement", old: "alpha as of claim", new: "alpha after claim" },
    ]);
  });

  it("does not list a changed rule that does not govern the task (cited only by another spec)", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await setRule(fx.foreign, { statement: "Foreign rule gamma changed after claim" });
    await setRule(fx.foreign, { lifecycle: "retired", note: "gone" });

    const diff = await diffOf(fx.task);
    expect(diff.changes).toEqual([]);
    expect(diff.retired).toEqual([]);
  });

  it("reports only the governing rule that changed when two govern the task", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await setRule(fx.governed2, { statement: "beta moved" });

    const diff = await diffOf(fx.task);
    expect(diff.changes.map((c) => c.rule_id)).toEqual([fx.governed2]);
  });

  it("a task with no claim is refused with VALIDATION_ERROR naming the missing claim", async () => {
    const fx = await makeFixture();
    const mod = await loadModule();
    const r = await mod.computeRuleDiffSinceClaim({ store, taskId: fx.task.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VALIDATION_ERROR");
    expect(r.error.message.toLowerCase()).toContain("claim");
  });

  it("an unknown task id is refused, not treated as an empty diff", async () => {
    await makeFixture();
    const mod = await loadModule();
    const r = await mod.computeRuleDiffSinceClaim({ store, taskId: "does-not-exist" });
    expect(r.ok).toBe(false);
  });
});

describe("resume rule diff rendering (BL-15)", () => {
  it("an unchanged claim renders exactly the one line 'governing rules unchanged since claim'", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);

    const mod = await loadModule();
    expect(mod.renderRuleDiff(await diffOf(fx.task))).toEqual([UNCHANGED_LINE]);
  });

  it("a changed diff does NOT render the unchanged line and shows rule id, old and new value", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await setRule(fx.governed, { statement: "alpha rewritten after claim" });

    const mod = await loadModule();
    const text = mod.renderRuleDiff(await diffOf(fx.task)).join("\n");
    expect(text).not.toContain(UNCHANGED_LINE);
    expect(text).toContain(fx.governed);
    expect(text).toContain("Governed rule alpha holds");
    expect(text).toContain("alpha rewritten after claim");
  });

  it("a retired rule is rendered by id with the word 'retired'", async () => {
    const fx = await makeFixture();
    await claimAt(fx.task, T_CLAIM);
    at(T_POST);
    await setRule(fx.governed2, { lifecycle: "retired", note: "obsolete" });

    const mod = await loadModule();
    const text = mod.renderRuleDiff(await diffOf(fx.task)).join("\n");
    expect(text).toContain(fx.governed2);
    expect(text.toLowerCase()).toContain("retired");
  });
});
