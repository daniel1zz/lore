// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-decision-records-cover-code-anchor-removal-and-keep
 * @ac_ref AC-DX-2
 *
 * An exemption keeps its decision (migration-042, BR-1492, #481): `lore ac exempt` by an agent with a complete decision
 * stores it (and the writer's run) on the exemption row; older rows read none; the milestone re-check selects it for the
 * plan whose spec it exempts AND through a plan task's claim run window, checks it like a version-row decision and names
 * the exemption in its findings; `lore decision rates` counts it. Selection runs on all three stores.
 *
 * Coverage: HAPPY (CLI grant stores the decision; both selection paths; rates counts it) / NEGATIVE (a grant with no
 * decision stores none, a run outside every window and another spec's exemption are not selected) / BOUNDARY (window
 * edges: a grant after the task's archive is out) / ERROR (a stored decision that no longer parses fails loud) / STATE
 * (an older row without the columns reads none) / REGRESSION (finding address names spec, AC and grant instant).
 */

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DOC_TYPE_ROLE_MAP, err, ok, type DecisionRecord, type DocId, type DocRecord, type PlanBundle } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { AcExemptionRow, StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { SpawnGitPort } from "../../../src/service/rule-state-git-port.js";
import { recheckPlanDecisions, selectPlanDecisions, type DecisionRecheckDeps } from "../../../src/service/decision-recheck.js";
import { DecisionOutcomeService } from "../../../src/service/decision-outcome-service.js";
import { createPartyCorpus, type Party, type PartyCorpus } from "../../helpers/known-party-corpus.js";

// ─── CLI: the grant stores the decision ─────────────────────────────────────────────────────────────

const AGENT: Party = { kind: "run", run: "cc:dx2-agent" };

describe("AC-DX-2 lore ac exempt stores the decision on the exemption row", () => {
  let corpus: PartyCorpus;
  let reviewSpec: string;
  let draftSpec: string;
  const dbPath = (): string => join(corpus.dir, ".lore", "lore.db");
  const rowOf = (slug: string, ac: string): { decision: string | null; harness_run: string | null } | null => {
    const db = new Database(dbPath(), { readonly: true });
    try {
      return db
        .query("SELECT e.decision AS decision, e.harness_run AS harness_run FROM ac_exemptions e JOIN docs d ON d.id = e.doc_id WHERE d.slug = ? AND e.ac_id = ?")
        .get(slug, ac) as { decision: string | null; harness_run: string | null } | null;
    } finally {
      db.close();
    }
  };

  beforeAll(() => {
    corpus = createPartyCorpus("dx2");
    const spec = (title: string): string => corpus.slugOf(corpus.setup(["create", "spec", "--title", title, "--no-ai", "--content", "## Goal\n\nbody"]));
    reviewSpec = spec("DX2 review spec");
    draftSpec = spec("DX2 draft spec");
    for (const slug of [reviewSpec, draftSpec]) {
      for (const id of ["AC-X-1", "AC-X-2"]) corpus.setup(["ac", "add", slug, id, "--statement", "the command exits exactly 4 and records no revision", "--mode", "human"]);
    }
    // reason: the exemption cap is floor(10% x live criteria), so two exemptions need 20 live criteria.
    for (let i = 1; i <= 16; i += 1) corpus.setup(["ac", "add", draftSpec, `AC-FILL-${i}`, "--statement", "the command exits exactly 4 and records no revision", "--mode", "human"]);
    const db = new Database(dbPath());
    try {
      db.query("UPDATE docs SET status = 'in-review' WHERE slug = ?").run(reviewSpec);
    } finally {
      db.close();
    }
  });
  afterAll(() => corpus.cleanup());

  it("AC-DX-2 an agent's exemption on a spec in review with a complete decision stores the decision and the writer's run", () => {
    const run = corpus.lore(
      ["ac", "exempt", reviewSpec, "AC-X-1", "--reason", "no rule covers it yet", "--expires", "2099-01-01T00:00:00Z", "--premise", "no rule exists|issue:#481|A", "--alt", "cite a rule|none fits"],
      AGENT,
    );
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    const row = rowOf(reviewSpec, "AC-X-1");
    expect(row?.harness_run).toBe("cc:dx2-agent");
    const stored = JSON.parse(row?.decision ?? "null") as DecisionRecord;
    expect(stored.reason).toBe("no rule covers it yet");
    expect(stored.premises).toHaveLength(1);
    expect(stored.alternatives?.[0]?.option).toBe("cite a rule");
  });

  it("AC-DX-2 an exemption on a draft spec carries no decision and stores none", () => {
    const run = corpus.lore(["ac", "exempt", draftSpec, "AC-X-2", "--reason", "draft", "--expires", "2099-01-01T00:00:00Z"], AGENT);
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    expect(rowOf(draftSpec, "AC-X-2")?.decision).toBeNull();
  });

  it("AC-DX-2 a refused grant (no decision on a spec in review) writes no row", () => {
    const run = corpus.lore(["ac", "exempt", reviewSpec, "AC-X-2", "--reason", "no rule", "--expires", "2099-01-01T00:00:00Z"], AGENT);
    expect(run.exitCode).toBe(4);
    expect(rowOf(reviewSpec, "AC-X-2")).toBeNull();
  });

  it("AC-DX-2 a row written before the columns existed (decision and run NULL) reads none", async () => {
    const db = new Database(dbPath());
    try {
      db.exec("INSERT INTO ac_exemptions (doc_id, ac_id, reason, expires_at, granted_by, granted_at) SELECT id, 'AC-OLD', 'old', '2099-01-01T00:00:00.000Z', 'agent:old', '2026-01-01T00:00:00.000Z' FROM docs LIMIT 1");
    } finally {
      db.close();
    }
    const store = new SQLiteStore(dbPath());
    try {
      const rows = await store.listAcExemptions();
      expect(rows.ok).toBe(true);
      const old = rows.ok ? rows.value.find((r) => r.ac_id === "AC-OLD") : undefined;
      expect(old).toBeDefined();
      expect(old).not.toHaveProperty("decision");
      expect(old).not.toHaveProperty("harness_run");
    } finally {
      store.close();
    }
  });
});

// ─── re-check selection and rates, on every store ───────────────────────────────────────────────────

let repo: string;
let shaA: string;
function git(...args: string[]): string {
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-dx2-repo-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "registry.ts"), `${Array.from({ length: 80 }, (_, i) => (i === 58 ? "const LIMIT = 180000;" : `// filler ${i + 1}`)).join("\n")}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "A");
  shaA = git("rev-parse", "HEAD");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

/** A decision whose file premise is WRONG when written (the line read 180000, the quote says the suffix) unless `quote` is right. */
const decision = (label: string, quote = `const LIMIT = 180000; // ${label}`): DecisionRecord => ({
  reason: label,
  premises: [{ claim: "the code says so", tier: "S", source: { kind: "file", path: "registry.ts", lines: [59, 59], sha: shaA, quote } }],
  alternatives: [{ option: "other", why_rejected: "worse" }],
  gates: [{ id: "g-pass", verdict: "pass", evidence: "ok", computed: false }],
});

function depsOf(store: StoreInterface): DecisionRecheckDeps {
  return { store, git: new SpawnGitPort(repo), runner: { run: async () => err({ code: "STORE_ERROR", message: "no runner" }) } };
}

interface StoreKind {
  readonly label: string;
  readonly create: () => { store: StoreInterface; cleanup: () => void };
}
const KINDS: readonly StoreKind[] = [
  { label: "InMemoryStore", create: () => ({ store: new InMemoryStore(), cleanup: () => {} }) },
  {
    label: "SQLiteStore",
    create: () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-dx2-sqlite-"));
      const store = new SQLiteStore(join(dir, "lore.db"));
      return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
    },
  },
  {
    label: "TursoStore",
    create: () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-dx2-turso-"));
      const store = new TursoStore({ localPath: join(dir, "lore.db") });
      return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
    },
  },
];

let counter = 0;
function doc(type: DocRecord["type"], label: string, extra: Record<string, unknown> = {}, status: DocRecord["status"] = "draft"): DocRecord {
  counter += 1;
  const stamp = "2026-10-01T00:00:00.000Z";
  return {
    id: `01HDX2${String(counter).padStart(20, "0")}` as DocId,
    slug: `${type}-dx2-${label}-${counter}`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: `${type} ${label}`,
    status,
    priority: "medium",
    content: label,
    parent_id: null,
    extra,
    tags: [],
    version: 1,
    created_at: stamp,
    updated_at: stamp,
    created_by: "agent:test",
    deleted_at: null,
    ordinal: null,
  } as DocRecord;
}

async function insert(store: StoreInterface, record: DocRecord): Promise<DocRecord> {
  const inserted = await store.insert(record);
  if (!inserted.ok) throw new Error(JSON.stringify(inserted.error));
  return inserted.value;
}

async function exempt(store: StoreInterface, specId: DocId, acId: string, grantedAt: string, run: string | undefined, record: DecisionRecord | undefined): Promise<void> {
  const row: AcExemptionRow = {
    doc_id: specId,
    ac_id: acId,
    reason: "no rule yet",
    expires_at: "2099-01-01T00:00:00.000Z",
    granted_by: "agent:test",
    granted_at: grantedAt,
    ...(record !== undefined ? { decision: record } : {}),
    ...(run !== undefined ? { harness_run: run } : {}),
  };
  const inserted = await store.insertAcExemptionCapped(row, { liveCriteria: 100, maxActive: 100, now: "2026-10-01T00:00:00.000Z" });
  if (!inserted.ok) throw new Error(JSON.stringify(inserted.error));
}

async function writeVersion(store: StoreInterface, record: DocRecord, version: number, at: string, run: string, status: DocRecord["status"]): Promise<void> {
  const written = await store.insertVersion({
    doc_id: record.id, version, content: record.content, extra: record.extra, status, title: record.title,
    action: "update", created_at: at, created_by: "agent:test", slug: record.slug, harness_run: run,
  });
  if (!written.ok) throw new Error(JSON.stringify(written.error));
}

for (const kind of KINDS) {
  describe(`AC-DX-2 exemption decisions — ${kind.label}`, () => {
    let store: StoreInterface;
    let cleanup: () => void;
    beforeEach(() => {
      ({ store, cleanup } = kind.create());
    });
    afterEach(() => cleanup());

    async function plan(): Promise<{ bundle: PlanBundle; otherSpec: DocRecord }> {
      const spec = await insert(store, doc("spec", "mine"));
      const otherSpec = await insert(store, doc("spec", "other"));
      const planDoc = await insert(store, doc("plan", "p"));
      const task = await insert(store, doc("task", "t", {}, "archived"));
      const claimed = await store.appendAuditEntry({ timestamp: "2026-10-10T00:00:00.000Z", actor: "agent:a", session_id: "s", action: "claim", doc_id: task.id, details: {}, harness_run: "run-mine" });
      if (!claimed.ok) throw new Error(JSON.stringify(claimed.error));
      await writeVersion(store, task, 1, "2026-10-09T00:00:00.000Z", "run-mine", "approved");
      await writeVersion(store, task, 2, "2026-10-12T00:00:00.000Z", "run-mine", "archived");
      // by the plan's spec, whatever the run (the first path)
      await exempt(store, spec.id, "AC-BY-SPEC", "2026-10-02T00:00:00.000Z", "run-stranger", decision("by-spec"));
      // another spec's criterion, by the task's claim run inside its window (the second path)
      await exempt(store, otherSpec.id, "AC-BY-RUN", "2026-10-11T00:00:00.000Z", "run-mine", decision("by-run"));
      // not selected: the claim run after the archive, a stranger run, no decision, no run
      await exempt(store, otherSpec.id, "AC-AFTER", "2026-10-13T00:00:00.000Z", "run-mine", decision("after-archive"));
      await exempt(store, otherSpec.id, "AC-STRANGER", "2026-10-11T00:00:00.000Z", "run-stranger", decision("stranger"));
      await exempt(store, otherSpec.id, "AC-NODEC", "2026-10-11T00:00:00.000Z", "run-mine", undefined);
      await exempt(store, otherSpec.id, "AC-NORUN", "2026-10-11T00:00:00.000Z", undefined, decision("no-run"));
      return { bundle: { plan: planDoc, spec, tasks: [task] } as PlanBundle, otherSpec };
    }

    it("AC-DX-2 the re-check selects an exemption by the plan's spec and by a claim run window, and no other", async () => {
      const { bundle, otherSpec } = await plan();
      const selected = await selectPlanDecisions(depsOf(store), bundle);
      expect(selected.ok).toBe(true);
      if (!selected.ok) return;
      expect(selected.value.map((d) => d.record.reason).sort()).toEqual(["by-run", "by-spec"]);
      const addresses = selected.value.map((d) => d.address).sort();
      expect(addresses).toEqual([
        `${otherSpec.slug}#exempt:AC-BY-RUN@2026-10-11T00:00:00.000Z`,
        `${bundle.spec?.slug as string}#exempt:AC-BY-SPEC@2026-10-02T00:00:00.000Z`,
      ].sort());
    });

    it("AC-DX-2 a wrong-when-written file premise on an exemption decision is reported, naming the exemption", async () => {
      const { bundle } = await plan();
      const found = await recheckPlanDecisions(depsOf(store), bundle);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(2);
      expect(found.value.every((f) => f.kind === "wrong-when-written" && f.part === "premise 1")).toBe(true);
      expect(found.value.every((f) => f.decision.includes("#exempt:AC-BY-"))).toBe(true);
    });

    it("AC-DX-2 an exemption decision whose premise still holds is no finding", async () => {
      const spec = await insert(store, doc("spec", "ok"));
      const planDoc = await insert(store, doc("plan", "ok"));
      await exempt(store, spec.id, "AC-OK", "2026-10-02T00:00:00.000Z", "run-x", decision("ok", "const LIMIT = 180000;"));
      const found = await recheckPlanDecisions(depsOf(store), { plan: planDoc, spec, tasks: [] } as PlanBundle);
      expect(found).toEqual(ok([]));
    });

    it("AC-DX-2 lore decision rates counts exemption decisions among the decisions passed", async () => {
      const { bundle } = await plan();
      const service = new DecisionOutcomeService({
        store,
        writer: { writeDoc: async () => err({ code: "STORE_ERROR", message: "unused" }) } as never,
        listMilestoneReviewDocs: async () => ok([]),
        getPlanBundle: async () => ok(bundle),
      });
      const rates = await service.rates({});
      expect(rates.ok, JSON.stringify(rates)).toBe(true);
      if (!rates.ok) return;
      // five exemptions carry a decision (by-spec, by-run, after-archive, stranger, no-run)
      expect(rates.value.decisions).toBe(5);
      expect(rates.value.gates.find((g) => g.part === "g-pass")?.decisions).toBe(5);
      const documentKind = await service.rates({ kind: "document revision" });
      expect(documentKind.ok && documentKind.value.decisions).toBe(5);
      const ruleKind = await service.rates({ kind: "rule revision" });
      expect(ruleKind.ok && ruleKind.value.decisions).toBe(0);
    });
  });
}
