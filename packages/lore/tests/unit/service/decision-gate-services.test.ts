// @layer service-decision-gate-wiring AC-DR-2
/**
 * @spec_ref spec-a-decision-carrying-write-records-its-decision-on-its ("Which writes carry a decision", "Refusal", D2)
 *
 * `CorpusService.set` and the `RuleService` baseline verbs, armed with a decision gate over a fake git port, as an agent
 * run and as a human party. No process and no corpus file: an InMemoryStore wrapped with an agent write context.
 * The composition roots' arming (app.ts) and the CLI/MCP surfaces are pinned by the integration suites; this file pins
 * the service-layer contract itself, so it also holds when a service is called directly.
 *
 * Dimensions: HAPPY (decision stored on the version row), NEGATIVE (each target, refused with no version), BOUNDARY
 * (a resend of stored values, a never-approved node), STATE (pending revision on an approved node), REGRESSION (human
 * party, draft spec, status-only write, unarmed service).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { withWriteContext } from "../../../src/store/write-context-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { DecisionGate, type DecisionDraft, type DecisionGitPort } from "../../../src/service/decision-gate.js";
import { actedStore } from "../../live-invocation.js";
import { approveAllPending } from "../../helpers/approve-baseline.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
const noGit: DecisionGitPort = {
  headSha: () => ({ ok: true, value: "c".repeat(40) }),
  hasUncommittedChanges: () => ({ ok: true, value: false }),
  readLinesAt: () => ({ ok: true, value: null }),
};

const DECISION: DecisionDraft = {
  reason: "the sentence states the wrong default",
  premises: [{ claim: "the default is 30 days", tier: "A", source: { kind: "issue", number: 77 } }],
  alternatives: [{ option: "leave it", why_rejected: "it misleads readers" }],
};

interface Fixture {
  readonly agentCorpus: CorpusService;
  readonly humanCorpus: CorpusService;
  readonly agentRules: RuleService;
  readonly humanRules: RuleService;
  readonly unarmedCorpus: CorpusService;
  readonly store: InMemoryStore;
  readonly agentStore: ReturnType<typeof withWriteContext>;
}

function fixture(): Fixture {
  const store = new InMemoryStore();
  // one corpus, three writers: an agent run (source "run"), a human party, and an agent run on a service nobody armed
  const agentStore = withWriteContext(store, { identity: { harnessRun: "cc:dr-agent", claimed: "agent:session-dr-agent", claimedSource: "run" } });
  const humanStore = withWriteContext(store, { identity: { harnessRun: "human:dana", claimed: "dana", claimedSource: "human" } });
  const gate = new DecisionGate(noGit);
  const build = (s: ReturnType<typeof withWriteContext>, armed: boolean) => {
    const corpus = new CorpusService(s, new RecordLockService(s, new GateEnforcer(undefined)));
    if (armed) corpus.setDecisionGate(gate);
    const rules = new RuleService(s, corpus.create.bind(corpus), corpus);
    if (armed) rules.setDecisionGate(gate);
    return { corpus, rules };
  };
  const agent = build(agentStore, true);
  const human = build(humanStore, true);
  const unarmed = build(agentStore, false);
  return { agentCorpus: agent.corpus, humanCorpus: human.corpus, agentRules: agent.rules, humanRules: human.rules, unarmedCorpus: unarmed.corpus, store, agentStore };
}

let f: Fixture;
beforeEach(() => {
  f = fixture();
});

async function mustCreate(corpus: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const created = await corpus.create(input);
  if (!created.ok) throw new Error(`fixture create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

/** An approved ADR (the human writes it: a fixture is not under test). */
async function approvedAdr(): Promise<DocRecord> {
  const adr = await mustCreate(f.humanCorpus, { parent_id: await ensureRequirementsDocId(f.humanCorpus), type: "adr", title: "Pick a store", content: "Chose A.", extra: { decision_status: "proposed" } } as CreateDocInput);
  const approved = await f.humanCorpus.set(adr.id, { status: "approved" });
  if (!approved.ok) throw new Error(`fixture approve failed: ${JSON.stringify(approved.error)}`);
  return approved.value;
}

async function versionsOf(id: string) {
  const found = await f.store.findVersions(id);
  if (!found.ok) throw new Error("versions");
  // reason: findVersions answers newest first; the assertions below read "the latest" as `.at(-1)`.
  return [...found.value].sort((a, b) => a.version - b.version);
}

describe("CorpusService.set on an approved ADR (AC-DR-2)", () => {
  it("an agent's correction without a decision is refused naming each missing part, and writes no version", async () => {
    const adr = await approvedAdr();
    const before = (await versionsOf(adr.id)).length;
    const res = await f.agentCorpus.set(adr.id, { content: "Chose B." }, { correction: { reason: "typo" } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ code: "VALIDATION_ERROR", field: "decision" });
    const message = (res.error as { message: string }).message;
    expect(message).toContain("reason");
    expect(message).toContain("premise of tier S..C");
    expect(message).toContain("alternative");
    expect((await versionsOf(adr.id)).length).toBe(before);
    expect((await f.store.find(adr.id) as { ok: true; value: DocRecord }).value.content.trim()).toBe("Chose A.");
  });

  it("with a complete decision the correction lands and the version row carries the decision", async () => {
    const adr = await approvedAdr();
    const res = await f.agentCorpus.set(adr.id, { content: "Chose B." }, { correction: { reason: "typo" }, decision: DECISION });
    expect(res.ok).toBe(true);
    const latest = (await versionsOf(adr.id)).at(-1);
    expect(latest?.decision).toMatchObject({ reason: DECISION.reason });
    expect(latest?.decision?.premises[0]?.source).toEqual({ kind: "issue", number: 77 });
  });

  it("a human party's correction succeeds and records no decision", async () => {
    const adr = await approvedAdr();
    const res = await f.humanCorpus.set(adr.id, { content: "Chose B." }, { correction: { reason: "typo" } });
    expect(res.ok).toBe(true);
    expect((await versionsOf(adr.id)).at(-1)?.decision ?? null).toBeNull();
  });

  it("a status-only write by the agent needs no decision", async () => {
    const adr = await approvedAdr();
    const res = await f.agentCorpus.set(adr.id, { status: "archived" });
    expect(res.ok).toBe(true);
  });

  it("a resend of the stored values is not a change: no decision is required", async () => {
    const adr = await approvedAdr();
    const res = await f.agentCorpus.set(adr.id, { content: adr.content, title: adr.title }, { correction: { reason: "noop" } });
    expect(res.ok).toBe(true);
  });

  it("an unarmed service (a bare construction) is ungated, exactly as before the gate existed", async () => {
    const adr = await approvedAdr();
    const res = await f.unarmedCorpus.set(adr.id, { content: "Chose C." }, { correction: { reason: "typo" } });
    expect(res.ok).toBe(true);
  });

  it("a supplied decision that is incomplete is refused even for a human party", async () => {
    const adr = await approvedAdr();
    const res = await f.humanCorpus.set(adr.id, { content: "Chose D." }, { correction: { reason: "typo" }, decision: { reason: "only a reason" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ field: "decision" });
  });
});

describe("CorpusService.set on a spec (AC-DR-2)", () => {
  it("a draft spec edit by the agent succeeds with no decision", async () => {
    const spec = await mustCreate(f.humanCorpus, { type: "spec", title: "Draft spec", content: "v1" } as CreateDocInput);
    const res = await f.agentCorpus.set(spec.id, { content: "v2" });
    expect(res.ok).toBe(true);
    expect((await versionsOf(spec.id)).at(-1)?.decision ?? null).toBeNull();
  });

  it("an in-review spec edit by the agent is refused (not a draft), by the human it succeeds", async () => {
    const spec = await mustCreate(f.humanCorpus, { type: "spec", title: "Review spec", content: "v1" } as CreateDocInput);
    const moved = await f.humanCorpus.set(spec.id, { status: "in-review" });
    if (!moved.ok) throw new Error(JSON.stringify(moved.error));
    const refused = await f.agentCorpus.set(spec.id, { priority: "high" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatchObject({ field: "decision" });
    const human = await f.humanCorpus.set(spec.id, { priority: "high" });
    expect(human.ok).toBe(true);
  });
});

describe("RuleService baseline verbs on a node with an approved version (AC-DR-2)", () => {
  /** A leaf that was approved, with a pending revision on top (a human proposed a label). */
  async function leafWithPendingRevision(): Promise<string> {
    const prd = await mustCreate(f.humanCorpus, { type: "prd", title: "Product", content: "p" } as CreateDocInput);
    const root = await f.humanRules.addNode(prd.id, { node: "root", label: "Root", title: "Root", content: "r" });
    if (!root.ok) throw new Error(JSON.stringify(root.error));
    const branch = await f.humanRules.addNode(root.value.id, { node: "branch", label: "B", title: "Branch", content: "b" });
    if (!branch.ok) throw new Error(JSON.stringify(branch.error));
    const leaf = await f.humanRules.addNode(branch.value.id, { node: "leaf", label: "L", title: "Leaf", content: "l" });
    if (!leaf.ok) throw new Error(JSON.stringify(leaf.error));
    await approveAllPending(f.agentStore);
    const revised = await f.humanRules.setLabel(leaf.value.id, "L2");
    if (!revised.ok) throw new Error(JSON.stringify(revised.error));
    return leaf.value.id;
  }

  it("set-label by the agent without a decision is refused naming each part and writes no version", async () => {
    const leaf = await leafWithPendingRevision();
    const before = (await versionsOf(leaf)).length;
    const res = await f.agentRules.setLabel(leaf, "L3");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ code: "VALIDATION_ERROR", field: "decision" });
    expect((res.error as { message: string }).message).toContain("alternative");
    expect((await versionsOf(leaf)).length).toBe(before);
  });

  it("set-label, glossary add and remove, commands and depends are each gated; each records the decision when given", async () => {
    const leaf = await leafWithPendingRevision();
    const doc = (await f.store.find(leaf)) as { ok: true; value: DocRecord };
    const branchId = doc.value.parent_id as string;
    const attempts: Array<[string, () => Promise<{ ok: boolean; error?: unknown }>, () => Promise<{ ok: boolean }>]> = [
      ["set-label", () => f.agentRules.setLabel(leaf, "L9"), () => f.agentRules.setLabel(leaf, "L9", { decision: DECISION })],
      ["map", () => f.agentRules.setCommands(leaf, { addCommands: ["ac add"] }), () => f.agentRules.setCommands(leaf, { addCommands: ["ac add"] }, { decision: DECISION })],
      ["glossary add", () => f.agentRules.glossaryAdd(branchId, { term: "T", meaning: "m" }), () => f.agentRules.glossaryAdd(branchId, { term: "T", meaning: "m" }, { decision: DECISION })],
    ];
    for (const [label, without, withDecision] of attempts) {
      const refused = await without();
      expect(refused.ok, `${label} without a decision`).toBe(false);
      expect(refused.error, label).toMatchObject({ field: "decision" });
      const landed = await withDecision();
      expect(landed.ok, `${label} with a decision`).toBe(true);
    }
    const rm = await f.agentRules.glossaryRemove(branchId, "T");
    expect(rm.ok).toBe(false);
    if (!rm.ok) expect(rm.error).toMatchObject({ field: "decision" });
    expect((await f.agentRules.glossaryRemove(branchId, "T", { decision: DECISION })).ok).toBe(true);
    const latest = (await versionsOf(leaf)).at(-1);
    expect(latest?.decision).toMatchObject({ reason: DECISION.reason });
  });

  it("the same verbs as a human party succeed with no decision", async () => {
    const leaf = await leafWithPendingRevision();
    const res = await f.humanRules.setLabel(leaf, "L-human");
    expect(res.ok).toBe(true);
    expect((await versionsOf(leaf)).at(-1)?.decision ?? null).toBeNull();
  });

  it("a never-approved node is a draft: the agent's write needs no decision", async () => {
    const prd = await mustCreate(f.humanCorpus, { type: "prd", title: "Product 2", content: "p" } as CreateDocInput);
    const root = await f.humanRules.addNode(prd.id, { node: "root", label: "Root", title: "Root 2", content: "r" });
    if (!root.ok) throw new Error(JSON.stringify(root.error));
    const res = await f.agentRules.setLabel(root.value.id, "Root renamed");
    expect(res.ok).toBe(true);
  });

  it("CorpusService.set on an approved baseline node with a pending revision: the agent's body edit is refused", async () => {
    const leaf = await leafWithPendingRevision();
    const refused = await f.agentCorpus.set(leaf, { content: "a new body" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatchObject({ field: "decision" });
    const accepted = await f.agentCorpus.set(leaf, { content: "a new body" }, { decision: DECISION });
    expect(accepted.ok).toBe(true);
  });

  it("a no-op node write (the label already pending) writes nothing and needs no decision", async () => {
    const leaf = await leafWithPendingRevision();
    const before = (await versionsOf(leaf)).length;
    const res = await f.agentRules.setLabel(leaf, "L2");
    expect(res.ok).toBe(true);
    expect((await versionsOf(leaf)).length).toBe(before);
  });
});

// actedStore is imported so a bare InMemoryStore stays a human-sourced writer when a test needs one without a wrapper.
void actedStore;
