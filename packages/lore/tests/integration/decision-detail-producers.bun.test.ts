// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads packages/lore/src/service/**
/**
 * AC-HR-1 oracle — every escalating producer records a readable detail: one table row per class
 * (governance-loosen, worktree-remove, stash-drop, run-end-stale, process-reap, override-judgment,
 * override-attestation, ac-exempt, verify-new-command).
 *
 * Throwaway corpora only (mkdtemp + `lore init`, cwd and HOME inside the temp tree), never the repo's `.lore/`. Most rows
 * drive the real CLI (`bun run src/index.ts`); the stash and run-reap rows drive the real service in-process over the
 * corpus database (a throwaway git repo for stash; a scripted process table for reap, because a dead harness pid
 * cannot be staged through the CLI) and, where the natural verdict would be auto, with an explicit strict class table
 * so the verdict is a genuine escalate. The stored detail is read straight from the corpus database.
 *
 * @spec_ref AC-HR-1
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { OPERATION_CLASS_REGISTRY, ok, type OperationClassRegistry } from "@lore/core";
import { decisionDetailSchema, type DecisionDetail } from "../../src/store/decision-log.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { DecisionService } from "../../src/service/decision-service.js";
import { RunReapService } from "../../src/service/run-reap-service.js";
import { StashPruneService, type GitRunner } from "../../src/service/stash-prune-service.js";
import type { ProcessTablePort } from "../../src/adapters/process-table-port.js";
import { citeSpecViaCli, loreRunnerFor } from "../helpers/cli-live-rule.js";
import { actedStore } from "../live-invocation.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const HEX_RUN_40 = /[0-9a-fA-F]{40,}/;

const created: string[] = [];
afterAll(() => {
  for (const dir of created) if (dir.startsWith(tmpdir()) || dir.startsWith(realpathSync(tmpdir()))) rmSync(dir, { recursive: true, force: true });
});

interface Corpus {
  readonly dir: string;
  readonly dbPath: string;
}

function lore(corpus: Corpus, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: corpus.dir,
    env: { PATH: process.env["PATH"] ?? "", HOME: corpus.dir, EDITOR: "true" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
}

function newCorpus(): Corpus {
  const dir = mkdtempSync(join(tmpdir(), "lore-hr1-"));
  created.push(dir);
  const corpus: Corpus = { dir, dbPath: join(dir, ".lore", "lore.db") };
  const init = lore(corpus, ["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const shown = lore(corpus, ["autonomy", "show"]);
  if (shown.exitCode !== 0) throw new Error(`lore autonomy show failed: ${shown.stderr}`);
  return corpus;
}

/** The latest stored detail of `cls`, parsed, or null when the row has none. */
function latestDetail(corpus: Corpus, cls: string): { raw: string | null; detail: DecisionDetail | null; verdict: string } {
  const db = new Database(corpus.dbPath);
  try {
    const row = db.query("SELECT detail, verdict FROM decision_log WHERE class = ? ORDER BY id DESC LIMIT 1").get(cls) as { detail: string | null; verdict: string } | null;
    if (row === null) throw new Error(`no decision_log row for class ${cls}`);
    return { raw: row.detail, detail: row.detail === null ? null : decisionDetailSchema.parse(JSON.parse(row.detail)), verdict: row.verdict };
  } finally {
    db.close();
  }
}

/** Everything a driver learned that its row's assertions compare against (exact values, never mere presence). */
type Expected = Record<string, unknown>;

interface ProducerRow {
  readonly cls: string;
  readonly label: string;
  /** Drives the producer to an escalate verdict; returns the exact values the detail must carry. */
  readonly drive: (corpus: Corpus) => Expected | Promise<Expected>;
  /** The verdict the driven decision is recorded with; absent = `escalate`. */
  readonly verdict?: "escalate" | "milestone";
  /** The words the summary must contain (the subject). */
  readonly summaryWords: (expected: Expected) => readonly string[];
  /** Class-specific assertions over `change`. */
  readonly checkChange: (change: Record<string, unknown>, expected: Expected) => void;
}

/** A class table in which every normal class needs a score no measured fact can reach: every decision is a real escalate. */
const STRICT_REGISTRY: OperationClassRegistry = Object.fromEntries(
  Object.entries(OPERATION_CLASS_REGISTRY).map(([id, cls]) => [id, cls.tier === "normal" ? { ...cls, threshold: 0.999 } : cls]),
);

async function withStrictDecisions<T>(corpus: Corpus, body: (store: SQLiteStore, decisions: DecisionService) => Promise<T>): Promise<T> {
  const store = actedStore(new SQLiteStore(corpus.dbPath));
  try {
    return await body(store, new DecisionService({ store, executorRun: null, registry: STRICT_REGISTRY }));
  } finally {
    store.close();
  }
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", ["-c", "user.email=hr2@example.com", "-c", "user.name=hr2", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function mustOk(corpus: Corpus, args: string[]): string {
  const r = lore(corpus, args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function slugOf(stdout: string): string {
  const slug = /Slug:\s+(\S+)/.exec(stdout)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
}

/** A spec holding one script AC that cites a live rule, plus `extraAcs` uncited script ACs. */
function specWithAc(corpus: Corpus, extraAcs = 0): { spec: string; specId: string; version: number } {
  const prd = (JSON.parse(mustOk(corpus, ["create", "prd", "--title", "Root PRD", "--content", "x", "--json"])) as { data: { slug: string } }).data.slug;
  const spec = (JSON.parse(mustOk(corpus, ["create", "spec", "--title", "Overridden Spec", "--content", "## Overview\n\nBody.", "--json"])) as { data: { slug: string } }).data.slug;
  mustOk(corpus, ["ac", "add", spec, "AC-1", "--statement", "the parser round-trips every fixture file", "--mode", "script", "--oracle", "test", "--command", "true"]);
  citeSpecViaCli(loreRunnerFor((args) => lore(corpus, args), corpus.dir), corpus.dir, prd, spec, "AC-1");
  // reason: the exemption cap is floor(10% of live criteria); ten live criteria allow one exemption.
  for (let n = 2; n <= 1 + extraAcs; n++) {
    mustOk(corpus, ["ac", "add", spec, `AC-${n}`, "--statement", `criterion ${n} that stays uncited`, "--mode", "script", "--oracle", "test", "--command", "true"]);
  }
  const doc = (JSON.parse(mustOk(corpus, ["get", spec, "--json"])) as { data: { doc: { id: string; version: number } } }).data.doc;
  return { spec, specId: doc.id, version: doc.version };
}

function expectRefusedWithPendingDecision(r: { exitCode: number; stderr: string }): void {
  expect(r.exitCode, r.stderr).toBe(4);
  expect(r.stderr).toMatch(/Pending decision \d+ created/);
}

/** BR-1370: a milestone-class override applies at once and opens NO pending decision (its `milestone` row is the record). */
function expectAppliedWithoutPendingDecision(r: { exitCode: number; stderr: string }): void {
  expect(r.exitCode, r.stderr).toBe(0);
  expect(r.stderr).not.toMatch(/Pending decision/);
}

const ENDED_RUN_ID = "cc:hr2-ended-run";
const DEAD_RUN_ID = "cc:hr2-dead-run";
const DEAD_PID = 424242;
const ORPHAN_PID = 777001;

/** A scripted process table: no real process is touched. */
function scriptedProcesses(entries: { pid: number; ppid: number; startTime: string; command: string; cwd: string }[]): ProcessTablePort {
  return {
    snapshot: async () => ({
      ok: true as const,
      value: {
        entries: entries.map(({ pid, ppid, startTime, command }) => ({ pid, ppid, zombie: false, startTime, command })),
        cwdByPid: new Map(entries.map((e) => [e.pid, e.cwd] as const)),
      },
    }),
    inspect: async () => null,
    signal: async () => "gone" as const,
    sleep: async () => undefined,
    resolveHarnessPid: async () => null,
  };
}

function lifecycle(id: string, over: { endedAt: string | null; pid: number | null; startTime: string | null; worktree: string | null }) {
  return {
    id: id as never,
    registeredAt: "2026-10-01T00:00:00.000Z",
    endedAt: over.endedAt,
    endReason: over.endedAt === null ? null : "test-ended",
    parentRunId: null,
    agentRef: null,
    process: { pid: over.pid, startTime: over.startTime, worktree: over.worktree },
  };
}

const PRODUCERS: readonly ProducerRow[] = [
  {
    cls: "governance-loosen",
    label: "lore autonomy regenerable add",
    drive: (corpus) => {
      const r = lore(corpus, ["autonomy", "regenerable", "add", ".cache-hr1/"]);
      expect(r.exitCode, r.stderr).not.toBe(1);
      return {};
    },
    summaryWords: () => [".cache-hr1/"],
    checkChange: (change) => {
      expect(Object.keys(change)).toEqual(expect.arrayContaining(["entry", "before", "after"]));
      expect(change["entry"]).toBe("worktreeRemoveRegenerable");
      const before = (change["before"] as Record<string, string[]>)["worktreeRemoveRegenerable"];
      const after = (change["after"] as Record<string, string[]>)["worktreeRemoveRegenerable"];
      expect(before).not.toContain(".cache-hr1/");
      expect(after).toContain(".cache-hr1/");
      expect(after).toEqual([...(before as string[]), ".cache-hr1/"]);
    },
  },
  {
    cls: "governance-loosen",
    label: "lore autonomy set (threshold loosening)",
    drive: (corpus) => {
      const r = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.5"]);
      expect(r.exitCode, r.stderr).not.toBe(1);
      return {};
    },
    summaryWords: () => ["stash-drop", "threshold"],
    checkChange: (change) => {
      expect(Object.keys(change)).toEqual(expect.arrayContaining(["entry", "before", "after"]));
      expect(change["entry"]).toBe("stash-drop");
      const before = (change["before"] as Record<string, { threshold: number }>)["stash-drop"];
      const after = (change["after"] as Record<string, { threshold: number }>)["stash-drop"];
      expect(before?.threshold).toBe(0.8);
      expect(after?.threshold).toBe(0.5);
    },
  },
  {
    cls: "worktree-remove",
    label: "lore worktree sweep --apply (ignored files outside the regenerable set)",
    drive: (corpus) => {
      const repo = join(corpus.dir, "repo");
      mkdirSync(repo);
      git(repo, ["init", "-q", "-b", "main"]);
      writeFileSync(join(repo, ".gitignore"), ".env\nsecrets.local\n.lore/\n");
      writeFileSync(join(repo, "README.md"), "base\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "base"]);
      const repoCorpus: Corpus = { dir: repo, dbPath: join(repo, ".lore", "lore.db") };
      mustOk(repoCorpus, ["init"]);
      const wt = join(realpathSync(mkdtempSync(join(tmpdir(), "lore-hr2-wt-"))), "wt");
      created.push(join(wt, ".."));
      git(repo, ["worktree", "add", "-q", "-b", "agent-hr2", wt]);
      writeFileSync(join(wt, ".env"), "SECRET=1\n");
      writeFileSync(join(wt, "secrets.local"), "TOKEN=1\n");
      const swept = lore(repoCorpus, ["worktree", "sweep", "--apply"]);
      expect(swept.exitCode, swept.stderr).toBe(0);
      // reason: the decision lands in the repo's own throwaway corpus, so the reader is pointed there (`dbDir`).
      return { worktree: wt, dbDir: repo };
    },
    summaryWords: (e) => [e["worktree"] as string],
    checkChange: (change, e) => {
      expect(change["worktree"]).toBe(e["worktree"]);
      expect(change["ignored_paths_measured"]).toBe(true);
      expect([...(change["ignored_paths"] as string[])].sort()).toEqual([".env", "secrets.local"]);
    },
  },
  {
    cls: "stash-drop",
    label: "StashPruneService.apply (no provable owner, strict class table)",
    drive: async (corpus) => {
      const repo = join(corpus.dir, "stash-repo");
      mkdirSync(repo);
      git(repo, ["init", "-q", "-b", "main"]);
      writeFileSync(join(repo, "tracked.txt"), "base\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "base"]);
      writeFileSync(join(repo, "tracked.txt"), "edited\n");
      git(repo, ["stash", "push", "-m", "hr2 half-finished experiment"]);
      const runner: GitRunner = (args, stdin) => {
        const r = spawnSync("git", [...args], { cwd: repo, encoding: "utf8", input: stdin });
        return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
      };
      return withStrictDecisions(corpus, async (store, decisions) => {
        const report = await new StashPruneService({ git: runner, store, decisions }).apply();
        if (!report.ok) throw new Error(`stash prune failed: ${JSON.stringify(report.error)}`);
        const entry = report.value.entries[0];
        expect(entry?.outcome?.kind).toBe("escalated");
        return { message: entry?.facts.message ?? "", reason: entry?.facts.attribution.reason ?? "" };
      });
    },
    summaryWords: (e) => ["hr2 half-finished experiment", e["message"] as string],
    checkChange: (change, e) => {
      expect(e["message"]).toContain("hr2 half-finished experiment");
      expect(change["stash_message"]).toBe(e["message"]);
      expect(change["attribution_state"]).toBe("no-provable-owner");
      expect((e["reason"] as string).length).toBeGreaterThan(0);
      expect(change["attribution_reason"]).toBe(e["reason"]);
    },
  },
  {
    cls: "run-end-stale",
    label: "run reap --apply (run whose recorded pid is dead, strict class table)",
    drive: (corpus) =>
      withStrictDecisions(corpus, async (_store, decisions) => {
        const runs = [lifecycle(DEAD_RUN_ID, { endedAt: null, pid: DEAD_PID, startTime: "2026-10-01T00:00:00.000Z", worktree: null })];
        const service = new RunReapService({
          store: { listRunLifecycles: async () => ok(runs), queryAudit: async () => ok([]) } as never,
          runs: { end: async () => ok({ outcome: "ended" as const, claims: [] }) },
          decisions,
          processes: scriptedProcesses([]),
          registry: STRICT_REGISTRY,
        });
        const report = await service.reap({ apply: true });
        if (!report.ok) throw new Error(`reap failed: ${JSON.stringify(report.error)}`);
        expect(report.value.runs[0]).toMatchObject({ run_id: DEAD_RUN_ID, action: "escalated" });
        return {};
      }),
    summaryWords: () => [DEAD_RUN_ID],
    checkChange: (change) => {
      expect(change["run_ids"]).toEqual([DEAD_RUN_ID]);
      expect(change["pids"]).toEqual([DEAD_PID]);
    },
  },
  {
    cls: "run-end-stale",
    label: "run reap --apply (legacy runs with no recorded pid)",
    drive: async (corpus) => {
      const store = actedStore(new SQLiteStore(corpus.dbPath));
      try {
        const runs = [
          lifecycle("cc:hr2-legacy-1", { endedAt: null, pid: null, startTime: null, worktree: null }),
          lifecycle("cc:hr2-legacy-2", { endedAt: null, pid: null, startTime: null, worktree: null }),
        ];
        const service = new RunReapService({
          store: { listRunLifecycles: async () => ok(runs), queryAudit: async () => ok([]) } as never,
          runs: { end: async () => ok({ outcome: "ended" as const, claims: [] }) },
          decisions: new DecisionService({ store, executorRun: null }),
          processes: scriptedProcesses([]),
        });
        const report = await service.reap({ apply: true });
        if (!report.ok) throw new Error(`reap failed: ${JSON.stringify(report.error)}`);
        expect(report.value.legacy).toMatchObject({ verdict: "escalate" });
        return {};
      } finally {
        store.close();
      }
    },
    summaryWords: () => ["cc:hr2-legacy-1", "cc:hr2-legacy-2"],
    checkChange: (change) => {
      expect(change["run_ids"]).toEqual(["cc:hr2-legacy-1", "cc:hr2-legacy-2"]);
      expect(change["pids"]).toEqual([]);
    },
  },
  {
    cls: "process-reap",
    label: "run reap --apply (orphan started after its run ended: no ownership proof)",
    drive: async (corpus) => {
      const store = actedStore(new SQLiteStore(corpus.dbPath));
      try {
        const worktree = "/tmp/hr2-ended-worktree";
        const runs = [lifecycle(ENDED_RUN_ID, { endedAt: "2026-10-01T01:00:00.000Z", pid: 1, startTime: "2026-10-01T00:00:00.000Z", worktree })];
        const service = new RunReapService({
          store: { listRunLifecycles: async () => ok(runs), queryAudit: async () => ok([]) } as never,
          runs: { end: async () => ok({ outcome: "ended" as const, claims: [] }) },
          decisions: new DecisionService({ store, executorRun: null }),
          processes: scriptedProcesses([{ pid: ORPHAN_PID, ppid: 1, startTime: "2026-10-02T00:00:00.000Z", command: "sleep 600", cwd: `${worktree}/sub` }]),
          realpath: (path) => path,
        });
        const report = await service.reap({ apply: true });
        if (!report.ok) throw new Error(`reap failed: ${JSON.stringify(report.error)}`);
        expect(report.value.processes[0]).toMatchObject({ pid: ORPHAN_PID, action: "escalated" });
        return {};
      } finally {
        store.close();
      }
    },
    summaryWords: () => [ENDED_RUN_ID],
    checkChange: (change) => {
      expect(change["run_ids"]).toEqual([ENDED_RUN_ID]);
      expect(change["pids"]).toEqual([ORPHAN_PID]);
    },
  },
  {
    cls: "override-judgment",
    verdict: "milestone",
    label: "lore approve --override-judgment <id>",
    drive: (corpus) => {
      const { spec, specId, version } = specWithAc(corpus);
      const judgmentId = "judgment-hr2-refused";
      const db = new Database(corpus.dbPath);
      try {
        db.run(
          `INSERT INTO review_judgments (id, doc_id, doc_version, decision, confidence, reasons, checks, blocking_questions,
             judge_provider, judge_model, judge_prompt_version, created_at, created_by)
           VALUES (?, ?, ?, 'reject', 0.9, ?, ?, '[]', 'test-judge', 'test-model', 'v1', ?, 'ai:test-judge:test-model:v1')`,
          [judgmentId, specId, version, JSON.stringify([{ dimension: "completeness", finding: "seeded" }]), JSON.stringify([{ check: "schema", outcome: "pass" }]), new Date().toISOString()],
        );
      } finally {
        db.close();
      }
      expectAppliedWithoutPendingDecision(lore(corpus, ["approve", spec, "--override-judgment", judgmentId]));
      return { document: spec, judgmentId };
    },
    summaryWords: (e) => [e["document"] as string],
    checkChange: (change, e) => {
      expect(change["document"]).toBe(e["document"]);
      expect(change["refused_judgment_id"]).toBe(e["judgmentId"]);
    },
  },
  {
    cls: "override-attestation",
    verdict: "milestone",
    label: "lore done --override-attestation",
    drive: (corpus) => {
      mustOk(corpus, ["create", "prd", "--title", "Root PRD", "--content", "x", "--json"]);
      const task = (JSON.parse(mustOk(corpus, ["create", "task", "--title", "Manual Task", "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"])) as { data: { slug: string } }).data.slug;
      mustOk(corpus, ["evidence", task, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"]);
      expectAppliedWithoutPendingDecision(lore(corpus, ["done", task, "--override-attestation", "verified by hand in staging", "--declare-no-new-tests", "this task adds no test"]));
      return { document: task };
    },
    summaryWords: (e) => [e["document"] as string],
    checkChange: (change, e) => {
      expect(change["document"]).toBe(e["document"]);
      expect(change["override"]).toBe("attestation");
      expect(change["reason"]).toBe("verified by hand in staging");
    },
  },
  {
    cls: "ac-exempt",
    verdict: "milestone",
    label: "lore ac exempt",
    drive: (corpus) => {
      const { spec } = specWithAc(corpus, 9);
      expectAppliedWithoutPendingDecision(lore(corpus, ["ac", "exempt", spec, "AC-2", "--reason", "no rule exists for this yet", "--expires", "2099-01-01T00:00:00Z"]));
      return { document: spec };
    },
    summaryWords: (e) => [e["document"] as string],
    checkChange: (change, e) => {
      expect(change["document"]).toBe(e["document"]);
      expect(change["ac_id"]).toBe("AC-2");
      expect(change["reason"]).toBe("no rule exists for this yet");
      expect(change["expires_at"]).toBe("2099-01-01T00:00:00.000Z");
    },
  },
  {
    cls: "verify-new-command",
    label: "lore verify --allow-new-commands (command with no attested row)",
    drive: (corpus) => {
      // reason: mirrors tests/integration/verify-ac-ref-wiring.bun.test.ts — the gates that would block the authoring flow are disabled.
      patchLoreConfig(
        corpus.dir,
        ["workflow:", "  gates:", "    spec-create:", "      enabled: false", "    spec-promote:", "      enabled: false", "    plan-promote:", "      enabled: false", "    task-claim:", "      enabled: false", '    "task-create":', "      enabled: false", ""].join("\n"),
      );
      mustOk(corpus, ["create", "prd", "--title", "Hr2 PRD", "--no-ai", "--content", "body"]);
      const spec = slugOf(mustOk(corpus, ["create", "spec", "--title", "Hr2 Spec", "--no-ai", "--content", "body"]));
      mustOk(corpus, ["ac", "add", spec, "AC-HR2-1", "--statement", "A command that has never been attested on its task.", "--mode", "script", "--oracle", "other", "--command", "echo hr2-new-command"]);
      const plan = slugOf(mustOk(corpus, ["create", "plan", "--title", "Hr2 Plan", "--parent", spec, "--no-ai", "--content", "body"]));
      const task = slugOf(mustOk(corpus, ["create", "task", "--title", "Hr2 Task", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body", "--ac-scope", "AC-HR2-1"]));
      // reason: the seeded verify-new-command prior (0.95) lets this ask through as auto; tightening a threshold is not a loosening, so it applies at once.
      mustOk(corpus, ["autonomy", "set", "verify-new-command", "--threshold", "0.99"]);
      expectRefusedWithPendingDecision(lore(corpus, ["verify", plan, "--task", task, "--allow-new-commands"]));
      return { document: task };
    },
    summaryWords: (e) => [e["document"] as string],
    checkChange: (change, e) => {
      expect(change["document"]).toBe(e["document"]);
      expect(change["ac_id"]).toBe("AC-HR2-1");
      expect(change["command"]).toBe("echo hr2-new-command");
    },
  },
];

describe("decision detail producers", () => {
  it.each(PRODUCERS.map((p) => [`${p.cls}: ${p.label}`, p] as const))("AC-HR-1: %s records a complete, readable detail", async (_label, producer) => {
    const corpus = newCorpus();
    const expected = await producer.drive(corpus);
    const dbDir = expected["dbDir"];
    const readFrom: Corpus = typeof dbDir === "string" ? { dir: dbDir, dbPath: join(dbDir, ".lore", "lore.db") } : corpus;
    const { raw, detail, verdict } = latestDetail(readFrom, producer.cls);
    expect(verdict, `class ${producer.cls} must have been recorded as ${producer.verdict ?? "escalate"}`).toBe(producer.verdict ?? "escalate");
    expect(raw, `class ${producer.cls} wrote no detail`).not.toBeNull();
    if (detail === null) return;
    for (const field of ["summary", "requested_by", "on_accept", "on_reject"] as const) {
      expect(detail[field].trim().length, `${producer.cls}.${field} is empty`).toBeGreaterThan(0);
      expect(HEX_RUN_40.test(detail[field]), `${producer.cls}.${field} holds a hash-like run`).toBe(false);
    }
    for (const word of producer.summaryWords(expected)) expect(detail.summary, `${producer.cls} summary names the subject`).toContain(word);
    producer.checkChange(detail.change, expected);
  }, 240_000);
});
