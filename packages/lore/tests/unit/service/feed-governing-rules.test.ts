/**
 * @spec_ref AC-BLS2-7
 * @task task-skill-test-red-task-start-governing-rules-cap-ac-bls2-7 (RED)
 *
 * Spec: spec-baseline-slice-2-completeness-census-per-branch-citation
 *   C6 "Feed integration" + QA-6 (BL-15: agents see the rules governing their
 *   work within a budget; overflow is a COUNT, never silently dropped).
 *
 * ── PINNED CONTRACT (the implementation builds to exactly this) ─────────────
 *
 *   SEAM: `renderTaskStartPack(await buildTaskStartPack(buildTaskFeedFlowDeps(app), task.slug))`
 *   — the text `lore feed task-start` prints. `app` is a real App over an
 *   InMemoryStore with `ruleService` wired to the SAME store; rule lookup is the
 *   implementation's business (RuleReadService, another task). This test
 *   asserts the RENDERED outcome only.
 *
 *   SECTION HEADING (pinned literal, own line):   "## Governing rules"
 *   It follows the existing eight sections (it is the last `## ` section unless a
 *   later section is added; the test reads up to the next "\n## " or end/footer).
 *
 *   RULE LINE: one line per rule containing the rule id (`BR-<n>`) AND its
 *   statement text (id + statement only). Format of the bullet is free.
 *
 *   ORDER: rules cited by the task's own spec's acceptance criteria
 *   (`extra.acceptance_criteria[].cites`) come first; then rules reached via the
 *   task's file anchors (`extra.file_anchors`) -> OTHER specs whose
 *   `extra.code_anchors` cover that file -> those specs' ACs' cites.
 *
 *   CAP: at most 40 rules listed. Overflow line, own line, exactly "+<N> more"
 *   where N = total governing rules - 40 (e.g. "+80 more" for 120).
 *   No overflow line when total <= 40.
 *
 *   ABSENT: when the corpus has no baseline docs, the "## Governing rules"
 *   section is absent and the rest of the render is byte-identical to the
 *   pre-feature render (eight sections, same joins).
 *
 * Dimensions: HAPPY (cap+overflow, file-covered after cited) / NEGATIVE
 * (uncited rule never listed; no section without baseline) / BOUNDARY (40, 41,
 * cited-fill-cap pushes file rule out) / REGRESSION (byte-identical absent case).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { buildTaskFeedFlowDeps } from "../../../src/adapters/cli/task-feed-wiring.js";
import { renderTaskStartPack } from "../../../src/adapters/cli/task-feed-render.js";
import { buildTaskStartPack } from "../../../src/flows/task-feed-flow.js";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { actedStore } from "../../live-invocation.js";

/** Pinned section heading — the implementation must emit exactly this line. */
const HEADING = "## Governing rules";
const FILE_F = "packages/widget/src/engine.ts";

let store: InMemoryStore;
let corpus: CorpusService;
let rules: RuleService;
let app: App;

function makeApp(): App {
  store = actedStore(new InMemoryStore());
  corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  rules = makeRuleService(store);
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10_080,
    createHandoffDoc: corpus.createHandoffDoc.bind(corpus),
  });
  return {
    warn: () => undefined,
    corpusService: corpus,
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: {} as ApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(
      store,
      new NoOpTelemetry(),
      { claimTtlMinutes: 120 },
      corpus.resolveDeclaredAcIds.bind(corpus),
    ),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    sessionService,
    ruleService: rules,
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`create ${input.type} failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** prd -> baseline root -> branch -> leaf; returns the leaf and the prd. */
async function makeBaselineLeaf(prd: DocRecord): Promise<DocRecord> {
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

/** Adds `count` live rules with unique, greppable statements; returns [{id, statement}]. */
async function addRules(leaf: DocRecord, prefix: string, count: number): Promise<Array<{ id: string; statement: string }>> {
  const out: Array<{ id: string; statement: string }> = [];
  for (let n = 1; n <= count; n += 1) {
    const statement = `${prefix} invariant number ${String(n).padStart(3, "0")} holds`;
    const r = await rules.addRule(
      leaf.id,
      { statement, confidence: "established", enforced_by: "guaranteed", examples: [`example for ${prefix} ${n}`] },
      { by: "agent:test" },
    );
    if (!r.ok) throw new Error(`addRule failed: ${JSON.stringify(r.error)}`);
    out.push({ id: r.value.ruleId, statement });
  }
  return out;
}

/** Spec limits: <= 50 criteria, <= 10 cites each (AC_CITES_MAX) — so 120 rules span 12 criteria. */
function criteria(ruleIds: string[]): unknown[] {
  const out: unknown[] = [];
  for (let at = 0; at < ruleIds.length; at += 10) {
    out.push({
      id: `AC-GOV-${at / 10 + 1}`,
      statement: `Criterion ${at / 10 + 1} is satisfied.`,
      verify: { mode: "script", oracle: "test", command: "bun test" },
      cites: ruleIds.slice(at, at + 10),
    });
  }
  return out;
}

interface TaskFixture { task: DocRecord; spec: DocRecord; prd: DocRecord }

async function makeTask(opts: { cites?: string[]; fileAnchors?: string[]; prd?: DocRecord } = {}): Promise<TaskFixture> {
  const prd = opts.prd ?? (await mustCreate({ type: "prd", title: "Governing PRD", content: "p" } as CreateDocInput));
  const spec = await mustCreate({
    type: "spec", title: "Governed Spec",content: "s",
    extra: { acceptance_criteria: criteria(opts.cites ?? []) },
  } as CreateDocInput);
  const plan = await mustCreate({ type: "plan", title: "Governed Plan", parent_id: spec.id, content: "p" } as CreateDocInput);
  const task = await mustCreate({
    type: "task", title: "Governed Task", parent_id: plan.id, content: "body",
    extra: { plan_id: plan.id, ...(opts.fileAnchors !== undefined ? { file_anchors: opts.fileAnchors } : {}) },
  } as CreateDocInput);
  return { task, spec, prd };
}

/** A second spec whose code anchors cover FILE_F and whose single AC cites `ruleId`. */
async function makeFileCoveringSpec(prd: DocRecord, ruleId: string): Promise<void> {
  await mustCreate({
    type: "spec", title: "Other Spec Covering F",content: "s2",
    extra: { code_anchors: [FILE_F], acceptance_criteria: criteria([ruleId]) },
  } as CreateDocInput);
}

async function renderFeed(task: DocRecord): Promise<string> {
  const pack = await buildTaskStartPack(buildTaskFeedFlowDeps(app), task.slug);
  if (!pack.ok) throw new Error(`pack failed: ${JSON.stringify(pack.error)}`);
  return renderTaskStartPack(pack.value);
}

/** Lines of the governing-rules section (heading excluded), or null when the heading is absent. */
function governingSection(text: string): string[] | null {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === HEADING);
  if (at === -1) return null;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => l.startsWith("## ") || l.startsWith("(truncated sections:"));
  return end === -1 ? rest : rest.slice(0, end);
}

function listedRuleLines(section: string[]): string[] {
  return section.filter((l) => /\bBR-\d+\b/.test(l));
}

function overflowLines(section: string[]): string[] {
  return section.filter((l) => /\+\d+ more/.test(l));
}

beforeEach(() => {
  app = makeApp();
});

describe("HAPPY — a spec citing 120 rules renders a capped section (AC-BLS2-7 / QA-6)", () => {
  it("lists exactly 40 rules, each with id and statement, and a '+80 more' overflow line", async () => {
    const prd = await mustCreate({ type: "prd", title: "Governing PRD", content: "p" } as CreateDocInput);
    const leaf = await makeBaselineLeaf(prd);
    const cited = await addRules(leaf, "Cited", 120);
    const { task } = await makeTask({ prd, cites: cited.map((r) => r.id) });

    const section = governingSection(await renderFeed(task));
    expect(section, `heading "${HEADING}" must be present`).not.toBeNull();
    if (section === null) return;

    const listed = listedRuleLines(section);
    expect(listed).toHaveLength(40);
    // every listed line carries a real cited id AND that rule's own statement
    const byId = new Map(cited.map((r) => [r.id, r.statement]));
    for (const line of listed) {
      const id = /\bBR-\d+\b/.exec(line)?.[0];
      expect(id !== undefined && byId.has(id)).toBe(true);
      if (id !== undefined) expect(line).toContain(byId.get(id) as string);
    }
    // 40 distinct rules, not one rule repeated
    expect(new Set(listed.map((l) => /\bBR-\d+\b/.exec(l)?.[0])).size).toBe(40);
    expect(overflowLines(section).map((l) => l.trim())).toEqual([expect.stringMatching(/^(?:[-*]\s*)?\+80 more\b/)]);
  });

  it("overflow count tracks the real total, not a baked-in number (cites 55 -> '+15 more')", async () => {
    const prd = await mustCreate({ type: "prd", title: "Governing PRD", content: "p" } as CreateDocInput);
    const leaf = await makeBaselineLeaf(prd);
    const cited = await addRules(leaf, "Cited", 55);
    const { task } = await makeTask({ prd, cites: cited.map((r) => r.id) });

    const section = governingSection(await renderFeed(task));
    expect(section).not.toBeNull();
    if (section === null) return;
    expect(listedRuleLines(section)).toHaveLength(40);
    expect(overflowLines(section).join("\n")).toContain("+15 more");
  });

  it("a rule reached only through a file anchor (another spec's code anchors) is listed AFTER the cited rules", async () => {
    const prd = await mustCreate({ type: "prd", title: "Governing PRD", content: "p" } as CreateDocInput);
    const leaf = await makeBaselineLeaf(prd);
    const cited = await addRules(leaf, "Cited", 3);
    const [brz] = await addRules(leaf, "FileCovered", 1);
    if (brz === undefined) throw new Error("fixture");
    const { task } = await makeTask({ prd, cites: cited.map((r) => r.id), fileAnchors: [FILE_F] });
    await makeFileCoveringSpec(prd, brz.id);

    const section = governingSection(await renderFeed(task));
    expect(section).not.toBeNull();
    if (section === null) return;
    const listed = listedRuleLines(section);
    expect(listed).toHaveLength(4);
    const ids = listed.map((l) => /\bBR-\d+\b/.exec(l)?.[0]);
    expect(ids.indexOf(brz.id)).toBe(3);
    expect(listed[3]).toContain(brz.statement);
    expect(overflowLines(section)).toEqual([]);
  });
});

describe("BOUNDARY — the cap is 40, cited rules outrank file-covered ones", () => {
  it("exactly 40 governing rules: all listed, NO overflow line", async () => {
    const prd = await mustCreate({ type: "prd", title: "Governing PRD", content: "p" } as CreateDocInput);
    const leaf = await makeBaselineLeaf(prd);
    const cited = await addRules(leaf, "Cited", 40);
    const { task } = await makeTask({ prd, cites: cited.map((r) => r.id) });

    const section = governingSection(await renderFeed(task));
    expect(section).not.toBeNull();
    if (section === null) return;
    expect(listedRuleLines(section)).toHaveLength(40);
    expect(overflowLines(section)).toEqual([]);
  });

  it("41 governing rules: 40 listed and '+1 more'", async () => {
    const prd = await mustCreate({ type: "prd", title: "Governing PRD", content: "p" } as CreateDocInput);
    const leaf = await makeBaselineLeaf(prd);
    const cited = await addRules(leaf, "Cited", 41);
    const { task } = await makeTask({ prd, cites: cited.map((r) => r.id) });

    const section = governingSection(await renderFeed(task));
    expect(section).not.toBeNull();
    if (section === null) return;
    expect(listedRuleLines(section)).toHaveLength(40);
    expect(overflowLines(section).join("\n")).toContain("+1 more");
  });

  it("when cited rules fill the cap, the file-covered rule is the one counted in overflow, never listed", async () => {
    const prd = await mustCreate({ type: "prd", title: "Governing PRD", content: "p" } as CreateDocInput);
    const leaf = await makeBaselineLeaf(prd);
    const cited = await addRules(leaf, "Cited", 45);
    const [brz] = await addRules(leaf, "FileCovered", 1);
    if (brz === undefined) throw new Error("fixture");
    const { task } = await makeTask({ prd, cites: cited.map((r) => r.id), fileAnchors: [FILE_F] });
    await makeFileCoveringSpec(prd, brz.id);

    const section = governingSection(await renderFeed(task));
    expect(section).not.toBeNull();
    if (section === null) return;
    const listed = listedRuleLines(section);
    expect(listed).toHaveLength(40);
    expect(listed.join("\n")).not.toContain(brz.statement);
    expect(overflowLines(section).join("\n")).toContain("+6 more"); // 46 total - 40
  });
});

describe("NEGATIVE — only governing rules appear", () => {
  it("a live rule that is neither cited by the task's spec nor file-covered is not listed", async () => {
    const prd = await mustCreate({ type: "prd", title: "Governing PRD", content: "p" } as CreateDocInput);
    const leaf = await makeBaselineLeaf(prd);
    const cited = await addRules(leaf, "Cited", 2);
    const [stray] = await addRules(leaf, "Stray", 1);
    if (stray === undefined) throw new Error("fixture");
    const { task } = await makeTask({ prd, cites: cited.map((r) => r.id), fileAnchors: [FILE_F] });

    const text = await renderFeed(task);
    const section = governingSection(text);
    expect(section).not.toBeNull();
    expect(text).not.toContain(stray.statement);
  });
});

describe("REGRESSION — no baseline docs: section absent, rest of the render byte-identical", () => {
  it("renders none of the section and exactly today's eight-section text", async () => {
    const { task } = await makeTask({ fileAnchors: [FILE_F] });

    const deps = buildTaskFeedFlowDeps(app);
    const pack = await buildTaskStartPack(deps, task.slug);
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const text = renderTaskStartPack(pack.value);

    expect(text).not.toContain(HEADING);
    expect(text).not.toMatch(/governing rules/i);
    expect(text).not.toMatch(/\+\d+ more/);

    // Today's render, reconstructed byte-for-byte from the pack's own eight sections
    // (the format of renderTaskStartPack before this feature).
    const s = pack.value.sections;
    const expectedToday = [
      `# Task start — ${pack.value.task_id}\n`,
      "## Objective", s.objective,
      "\n## Acceptance", s.acceptance,
      "\n## Constraints", s.constraints,
      "\n## Boundaries", s.boundaries,
      "\n## Claim", s.claim,
      "\n## Plan state", s.plan_state,
      "\n## Linked knowledge", s.knowledge_pointers,
      "\n## Latest handoff", s.handoff,
      ...(pack.value.truncated.length > 0 ? [`\n(truncated sections: ${pack.value.truncated.join(", ")})`] : []),
    ].join("\n");
    expect(text).toBe(expectedToday);
  });
});
