/**
 * @spec_ref spec-a-decision-carrying-write-records-its-decision-on-its
 * @ac_ref AC-DR-7
 *
 * Milestone re-check of recorded decisions (deterministic part): selection of a plan's decisions, the file-line check
 * against a real git repository, the read-only command allowlist, gate and score evidence, and the snapshot_accuracy
 * rule. Selection runs against all three stores.
 *
 * Coverage: HAPPY (a quote that still holds is no finding) / NEGATIVE (another plan's run, a write after the archive)
 * / BOUNDARY (an unrelated edit that shifts the lines) / ERROR (unreachable commit, unrunnable command) / STATE
 * (stale-since versus wrong-when-written) / REGRESSION (a non-allowlisted command is never run).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DOC_TYPE_ROLE_MAP,
  MILESTONE_DIMENSIONS,
  err,
  ok,
  type DecisionRecord,
  type DocId,
  type DocRecord,
  type LlmMilestoneOutput,
  type PlanBundle,
} from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { SpawnGitPort } from "../../../src/service/rule-state-git-port.js";
import {
  applyDecisionFindings,
  isRerunnableCommand,
  recheckDecision,
  recheckPlanDecisions,
  selectPlanDecisions,
  type CommandRunnerPort,
  type DecisionRecheckDeps,
} from "../../../src/service/decision-recheck.js";

// ─── A real git repository: registry.ts line 59 reads 180000 at commit A ────────────────────────────────

let repo: string;
let shaA: string;

function git(...args: string[]): string {
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

const registryLines = (limit: string): string[] => Array.from({ length: 80 }, (_, i) => (i === 58 ? `const LIMIT = ${limit};` : `// filler ${i + 1}`));
const otherLines = (): string[] => ["// header", "// one", "export const NAME = 'a';", "// tail"];

function commitFiles(message: string, files: Record<string, string[]>): string {
  for (const [path, lines] of Object.entries(files)) writeFileSync(join(repo, path), `${lines.join("\n")}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-recheck-repo-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  shaA = commitFiles("A", { "registry.ts": registryLines("180000"), "other.ts": otherLines() });
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

// ─── fixtures ────────────────────────────────────────────────────────────────────────────────────────

const quoteOf = (path: string, line: number, text: string): DecisionRecord["premises"][number]["source"] => ({
  kind: "file",
  path,
  lines: [line, line],
  sha: shaA,
  quote: text,
});

const decisionOf = (premises: DecisionRecord["premises"], extra: Partial<DecisionRecord> = {}): DecisionRecord => ({
  reason: "because",
  premises,
  alternatives: [{ option: "other", why_rejected: "worse" }],
  ...extra,
});

const filePremise = (source: DecisionRecord["premises"][number]["source"]): DecisionRecord["premises"][number] => ({ claim: "the code says so", tier: "S", source });

function depsOf(store: StoreInterface, runner: CommandRunnerPort = { run: async () => err({ code: "STORE_ERROR", message: "no runner" }) }): DecisionRecheckDeps {
  return { store, git: new SpawnGitPort(repo), runner };
}

const ADDR = { decision: "spec-x@2" };

async function recheck(record: DecisionRecord, runner?: CommandRunnerPort) {
  return recheckDecision(depsOf(new InMemoryStore(), runner), { address: ADDR.decision, record });
}

// ─── file premises ──────────────────────────────────────────────────────────────────────────────────

describe("AC-DR-7 file premises", () => {
  it("AC-DR-7 a premise quoting registry.ts:59 as 60000 where the line read 180000 at its commit is wrong-when-written", async () => {
    const findings = await recheck(decisionOf([filePremise(quoteOf("registry.ts", 59, "const LIMIT = 60000;"))]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ decision: "spec-x@2", part: "premise 1", kind: "wrong-when-written" });
    expect(findings[0]?.fact).toContain("180000");
  });

  it("AC-DR-7 a path that did not exist at its commit is wrong-when-written", async () => {
    const findings = await recheck(decisionOf([filePremise(quoteOf("nope.ts", 1, "x"))]));
    expect(findings.map((f) => f.kind)).toEqual(["wrong-when-written"]);
  });

  it("AC-DR-7 a quote that still holds on main is no finding", async () => {
    expect(await recheck(decisionOf([filePremise(quoteOf("registry.ts", 59, "const LIMIT = 180000;"))]))).toEqual([]);
  });

  it("AC-DR-7 an unreachable commit is unverifiable, never wrong-when-written", async () => {
    const source = { ...quoteOf("registry.ts", 59, "const LIMIT = 180000;"), sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" };
    const findings = await recheck(decisionOf([filePremise(source)]));
    expect(findings.map((f) => f.kind)).toEqual(["unverifiable"]);
  });

  describe("after main moves on", () => {
    beforeAll(() => {
      const edited = registryLines("500000");
      commitFiles("B", { "registry.ts": edited, "other.ts": ["// inserted above", ...otherLines()] });
    });

    it("AC-DR-7 a line changed only at main is stale-since", async () => {
      const findings = await recheck(decisionOf([filePremise(quoteOf("registry.ts", 59, "const LIMIT = 180000;"))]));
      expect(findings.map((f) => f.kind)).toEqual(["stale-since"]);
    });

    it("AC-DR-7 an unrelated edit to the same file that only shifts the quoted line is not a finding", async () => {
      expect(await recheck(decisionOf([filePremise(quoteOf("other.ts", 3, "export const NAME = 'a';"))]))).toEqual([]);
    });

    it("AC-DR-7 a gate's file evidence and a score's file evidence are checked the same way", async () => {
      const record = decisionOf([], {
        gates: [{ id: "g1", verdict: "pass", evidence: `file:registry.ts:59@${shaA}`, computed: false }],
        scores: [
          { option: "o", dimension: "d1", value: 1, evidence: `file:registry.ts:59@${shaA}` },
          { option: "o", dimension: "d2", value: 1, evidence: `file:other.ts:3@${shaA}` },
          { option: "o", dimension: "d3", value: 1, evidence: "plain prose, not a source" },
        ],
      });
      const findings = await recheck(record);
      expect(findings.map((f) => [f.part, f.kind])).toEqual([
        ["gate g1", "stale-since"],
        ["score o/d1", "stale-since"],
      ]);
    });

    it("AC-DR-7 file evidence citing a line past the end of the file at its commit is wrong-when-written", async () => {
      const record = decisionOf([], { gates: [{ id: "g1", verdict: "pass", evidence: `file:registry.ts:900@${shaA}`, computed: false }] });
      expect((await recheck(record)).map((f) => f.kind)).toEqual(["wrong-when-written"]);
    });
  });
});

// ─── command premises ───────────────────────────────────────────────────────────────────────────────

describe("AC-DR-7 command premises", () => {
  const cmdPremise = (command: string, expect_: string) => ({ claim: "it prints", tier: "S" as const, source: { kind: "cmd" as const, command, expect: expect_ } });

  it("AC-DR-7 an allowlisted command whose output lost its expected text is stale-since; one that still prints it is no finding", async () => {
    const runner: CommandRunnerPort = { run: async () => ok({ exitCode: 0, output: "LIMIT = 500000" }) };
    const stale = await recheck(decisionOf([cmdPremise("grep -n LIMIT registry.ts", "180000")]), runner);
    expect(stale.map((f) => f.kind)).toEqual(["stale-since"]);
    expect(await recheck(decisionOf([cmdPremise("grep -n LIMIT registry.ts", "500000")]), runner)).toEqual([]);
  });

  it("AC-DR-7 a non-allowlisted command is not-rerunnable and is not run", async () => {
    const ran: string[] = [];
    const runner: CommandRunnerPort = { run: async (command) => (ran.push(command), ok({ exitCode: 0, output: "rm" })) };
    const findings = await recheck(
      decisionOf([cmdPremise("rm -rf build", "rm"), cmdPremise("grep x f; rm -rf build", "x"), cmdPremise("git diff --output=out.txt", "x"), cmdPremise("bun run test", "ok")]),
      runner,
    );
    expect(findings.map((f) => f.kind)).toEqual(["not-rerunnable", "not-rerunnable", "not-rerunnable", "not-rerunnable"]);
    expect(ran).toEqual([]);
  });

  it("AC-DR-7 a runner that cannot run reports unverifiable", async () => {
    const findings = await recheck(decisionOf([cmdPremise("git log -1", "x")]));
    expect(findings.map((f) => f.kind)).toEqual(["unverifiable"]);
  });

  it("AC-DR-7 the allowlist admits exactly the read-only verbs", () => {
    for (const ok_ of ["lore get spec-a", "lore rule show BR-1", "lore rule find x", "lore ac list s", "lore log s", "git show HEAD:a", "git grep x", "rg x", "grep x f"]) {
      expect(isRerunnableCommand(ok_), ok_).toBe(true);
    }
    for (const bad of ["lore set x", "lore rule set BR-1", "lore done t", "git commit -m x", "git push", "sh -c ls", "grep x | sh", "grep $(id) f", "rg --pre ./evil x"]) {
      expect(isRerunnableCommand(bad), bad).toBe(false);
    }
  });
});

// ─── snapshot_accuracy ──────────────────────────────────────────────────────────────────────────────

describe("AC-DR-7 snapshot_accuracy", () => {
  const dimensions = (): LlmMilestoneOutput["dimensions"] =>
    Object.fromEntries(MILESTONE_DIMENSIONS.map((d) => [d, { verdict: "pass", reason: "fine", reference: "ref" }])) as LlmMilestoneOutput["dimensions"];
  const finding = (kind: string) => ({ decision: "spec-x@2", part: "premise 1", kind, fact: "a fact" });

  it("AC-DR-7 a wrong-when-written finding fails snapshot_accuracy and names the decision", () => {
    const result = applyDecisionFindings(dimensions(), [finding("wrong-when-written")]);
    expect(result.snapshot_accuracy.verdict).toBe("fail");
    expect(result.snapshot_accuracy.reason).toContain("spec-x@2");
    expect(result.regression.verdict).toBe("pass");
  });

  it("AC-DR-7 stale-since, unverifiable and not-rerunnable findings leave snapshot_accuracy alone", () => {
    const before = dimensions();
    expect(applyDecisionFindings(before, [finding("stale-since"), finding("unverifiable"), finding("not-rerunnable")])).toBe(before);
  });
});

// ─── selection, on every store ──────────────────────────────────────────────────────────────────────

interface StoreKind {
  readonly label: string;
  readonly create: () => { store: StoreInterface; cleanup: () => void };
}
const KINDS: readonly StoreKind[] = [
  { label: "InMemoryStore", create: () => ({ store: new InMemoryStore(), cleanup: () => {} }) },
  {
    label: "SQLiteStore",
    create: () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-recheck-sqlite-"));
      const store = new SQLiteStore(join(dir, "lore.db"));
      return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
    },
  },
  {
    label: "TursoStore",
    create: () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-recheck-turso-"));
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
    id: `01HRECHECK${String(counter).padStart(16, "0")}` as DocId,
    slug: `${type}-recheck-${label}-${counter}`,
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

async function writeVersion(store: StoreInterface, record: DocRecord, version: number, at: string, run: string | null, decision: DecisionRecord | undefined, status = record.status) {
  const written = await store.insertVersion({
    doc_id: record.id,
    version,
    content: record.content,
    extra: record.extra,
    status,
    title: record.title,
    action: "update",
    created_at: at,
    created_by: "agent:test",
    slug: record.slug,
    ...(run !== null ? { harness_run: run } : {}),
    ...(decision !== undefined ? { decision } : {}),
  });
  if (!written.ok) throw new Error(JSON.stringify(written.error));
}

const marker = (label: string): DecisionRecord => decisionOf([filePremise(quoteOf("registry.ts", 59, `const LIMIT = 180000; // ${label}`))]);

for (const kind of KINDS) {
  describe(`AC-DR-7 selection — ${kind.label}`, () => {
    let store: StoreInterface;
    let cleanup: () => void;
    beforeEach(() => {
      ({ store, cleanup } = kind.create());
    });
    afterEach(() => cleanup());

    async function plan(): Promise<{ bundle: PlanBundle; other: DocRecord }> {
      const leaf = await insert(store, doc("baseline", "leaf", { node: "leaf", rules: [] }));
      const spec = await insert(store, doc("spec", "s", { rule_changes: [{ op: "add", id: "BR-9001", leaf: leaf.slug, statement: "s", examples: ["e"], enforced_by: "both" }] }));
      const planDoc = await insert(store, doc("plan", "p"));
      const task = await insert(store, doc("task", "t", {}, "archived"));
      const other = await insert(store, doc("knowledge", "unrelated"));
      const claimed = await store.appendAuditEntry({ timestamp: "2026-10-10T00:00:00.000Z", actor: "agent:a", session_id: "s", action: "claim", doc_id: task.id, details: {}, harness_run: "run-mine" });
      if (!claimed.ok) throw new Error(JSON.stringify(claimed.error));
      // the task reached archived at 2026-10-12
      await writeVersion(store, task, 1, "2026-10-09T00:00:00.000Z", "run-mine", undefined, "approved");
      await writeVersion(store, task, 2, "2026-10-12T00:00:00.000Z", "run-mine", undefined, "archived");
      // spec: a rule proposal BEFORE any claim by a run that never claimed, and a main-agent correction after
      await writeVersion(store, spec, 2, "2026-10-05T00:00:00.000Z", "run-proposer", marker("proposal"));
      await writeVersion(store, spec, 3, "2026-10-20T00:00:00.000Z", null, marker("correction"));
      // the leaf the change set lands on
      await writeVersion(store, leaf, 2, "2026-10-21T00:00:00.000Z", "run-other-plan", marker("leaf"));
      // runs: mine inside the window, mine after the archive, another plan's run inside the window
      await writeVersion(store, other, 2, "2026-10-11T00:00:00.000Z", "run-mine", marker("mine-inside"));
      await writeVersion(store, other, 3, "2026-10-13T00:00:00.000Z", "run-mine", marker("mine-after-archive"));
      await writeVersion(store, other, 4, "2026-10-11T12:00:00.000Z", "run-another-plan", marker("another-plan"));
      return { bundle: { plan: planDoc, spec, tasks: [task] } as PlanBundle, other };
    }

    it("AC-DR-7 a rule proposal made before any claim, a main-agent correction on the spec and the change set's leaf are selected; another plan's run and a write after the archive are not", async () => {
      const { bundle } = await plan();
      const selected = await selectPlanDecisions(depsOf(store), bundle);
      expect(selected.ok).toBe(true);
      if (!selected.ok) return;
      const labels = selected.value.map((d) => (d.record.premises[0]?.source as { quote: string }).quote.split("// ")[1]).sort();
      expect(labels).toEqual(["correction", "leaf", "mine-inside", "proposal"]);
      expect(selected.value.every((d) => /^[a-z]+-recheck-[a-z]+-\d+@\d+$/.test(d.address))).toBe(true);
    });

    it("AC-DR-7 recheckPlanDecisions reports each selected decision's findings by address", async () => {
      const { bundle } = await plan();
      const found = await recheckPlanDecisions(depsOf(store), bundle);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      // every marker quote differs from the line at its commit (the comment suffix) -> wrong-when-written
      expect(found.value).toHaveLength(4);
      expect(found.value.every((f) => f.kind === "wrong-when-written")).toBe(true);
      expect(found.value.some((f) => f.decision.startsWith("spec-recheck-s-") && f.decision.endsWith("@2"))).toBe(true);
    });

    it("AC-DR-7 a plan with no recorded decision has no findings", async () => {
      const spec = await insert(store, doc("spec", "bare"));
      const planDoc = await insert(store, doc("plan", "bare"));
      const found = await recheckPlanDecisions(depsOf(store), { plan: planDoc, spec, tasks: [] } as PlanBundle);
      expect(found).toEqual(ok([]));
    });
  });
}
