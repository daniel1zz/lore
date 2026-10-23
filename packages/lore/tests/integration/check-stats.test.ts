// @spawns packages/lore/src/index.ts
// @spawns assets/hooks/pre-no-general-agent-gate.mjs
// @reads packages/lore/src/service/**
/**
 * AC-LG-13 / AC-LG-14 oracle — checks count their catches; quality is measured, not sampled (BR-1373).
 *
 * Everything runs in THROWAWAY state: in-memory stores, mkdtemp dirs, and one mkdtemp corpus (`lore init`) for the CLI
 * halves; the repo's own `.lore/` is never touched. The issue tracker is a fake reader.
 *
 * Dimensions:
 *   HAPPY:      a gate run and a hook run each append one outcome row; stats sums runs/denials/last denial; the real
 *               hook file lands in `lore checks stats` through the ingest.
 *   NEGATIVE:   a check with one denial is never a removal candidate; an issue filed on day 15, before close, or citing
 *               only a longer slug is not escaped; an undated issue is refused.
 *   BOUNDARY:   exactly 30 days and 50 runs is a candidate; 29 days or 49 runs is not; day 14 counts, day 15 does not.
 *   ERROR:      a failing issue reader is returned, never read as "0 escaped"; malformed hook lines are counted.
 *   STATE:      ingest claims the file (a second ingest finds nothing); a failed append puts the lines back.
 *   REGRESSION: no auto decision is ever queued for audit: 50 auto decisions leave `lore pending` with no audit block.
 *
 * @spec_ref AC-LG-13
 * @spec_ref AC-LG-14
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { err, ok, storeError, type DocId, type DocRecord } from "@lore/core";
import * as calibration from "../../src/service/autonomy-calibration-service.js";
import { AutonomyCalibrationService } from "../../src/service/autonomy-calibration-service.js";
import {
  CheckStatsService,
  ESCAPE_WINDOW_DAYS,
  REMOVAL_MIN_DAYS,
  REMOVAL_MIN_RUNS,
  citesAny,
  deriveRemovalCandidates,
  hookOutcomesFilePath,
  type EscapeIssue,
} from "../../src/service/check-stats-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { CheckOutcomeInput } from "../../src/store/store-interface.js";
import { LATEST_SCHEMA_VERSION } from "../../src/store/schema-version.js";
import { AUTO_FACTS, lore, newCorpus, removeCorpora, seedDecisions } from "./fixtures/autonomy-calibration-helpers.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-no-general-agent-gate.mjs");
const OUTCOME_LIB = join(REPO_ROOT, "assets", "hooks", "lib", "check-outcome.mjs");
const DAY_MS = 86_400_000;
const NOW = "2026-10-23T00:00:00.000Z";

const scratch: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  removeCorpora();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const isoDaysBefore = (nowIso: string, days: number): string => new Date(Date.parse(nowIso) - days * DAY_MS).toISOString();
const isoDaysAfter = (baseIso: string, days: number): string => new Date(Date.parse(baseIso) + days * DAY_MS).toISOString();
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

function runs(checkId: string, count: number, firstTs: string, spanDays: number, denyAt: number[] = []): CheckOutcomeInput[] {
  return Array.from({ length: count }, (_, i) => ({
    check_id: checkId,
    outcome: denyAt.includes(i) ? ("deny" as const) : ("pass" as const),
    ts: new Date(Date.parse(firstTs) + (i * spanDays * DAY_MS) / Math.max(1, count - 1)).toISOString(),
  }));
}

describe("checks count catches (AC-LG-13)", () => {
  it("checks count catches: a gate run appends one pass row and a blocked run one deny row, under gate:<checkpoint>", async () => {
    const store = new InMemoryStore();
    const enforcer = new GateEnforcer(undefined, undefined, undefined, undefined, {}, undefined, (row) => store.appendCheckOutcomes([row]));
    expect(enforcer.enforce("task-claim", { hasSpecParent: false }).ok).toBe(true);
    expect(enforcer.enforce("spec-promote", { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" }).ok).toBe(false);
    expect(enforcer.enforce("spec-promote", { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" }).ok).toBe(false);
    await tick();
    const stats = await new CheckStatsService({ store, now: () => NOW }).stats();
    expect(stats.ok).toBe(true);
    if (!stats.ok) return;
    const byId = Object.fromEntries(stats.value.checks.map((c) => [c.check_id, c]));
    expect(byId["gate:task-claim"]).toMatchObject({ runs: 1, denials: 0, last_denial: null });
    expect(byId["gate:spec-promote"]).toMatchObject({ runs: 2, denials: 2, errors: 0 });
    expect(byId["gate:spec-promote"]?.last_denial).not.toBeNull();
  });

  it("checks count catches: a config-disabled checkpoint did not run, so it records nothing; a failing port never changes the verdict", async () => {
    const store = new InMemoryStore();
    const disabled = new GateEnforcer(
      { workflow: { gates: { "spec-promote": { enabled: false } } } } as never,
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      (row) => store.appendCheckOutcomes([row]),
    );
    expect(disabled.enforce("spec-promote", { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" }).ok).toBe(true);
    await tick();
    const none = await store.listCheckOutcomeStats();
    expect(none.ok && none.value).toEqual([]);

    const warnings: string[] = [];
    const broken = new GateEnforcer(undefined, undefined, undefined, undefined, {}, (line) => warnings.push(line), async () => err(storeError("disk full")));
    expect(broken.enforce("spec-promote", { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" }).ok).toBe(false); // still denied
    await tick();
    expect(warnings.some((w) => w.includes("check-outcome") && w.includes("disk full"))).toBe(true);
  });

  it("checks count catches: the real SQLite store (schema 33) aggregates runs, denials, errors and the last denial per check", async () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(33);
    const dir = tempDir("lore-checks-sqlite-");
    const store = new SQLiteStore(join(dir, "lore.db"));
    try {
      const appended = await store.appendCheckOutcomes([
        { check_id: "hook:a", outcome: "pass", ts: "2026-10-01T00:00:00.000Z" },
        { check_id: "hook:a", outcome: "deny", ts: "2026-10-02T00:00:00.000Z" },
        { check_id: "hook:a", outcome: "deny", ts: "2026-10-03T00:00:00.000Z" },
        { check_id: "hook:a", outcome: "error", ts: "2026-10-04T00:00:00.000Z" },
        { check_id: "gate:b", outcome: "pass", ts: "2026-10-05T00:00:00.000Z" },
      ]);
      expect(appended.ok).toBe(true);
      expect((await store.appendCheckOutcomes([])).ok).toBe(true);
      const stats = await store.listCheckOutcomeStats();
      expect(stats.ok && stats.value).toEqual([
        { check_id: "gate:b", runs: 1, denials: 0, errors: 0, first_run: "2026-10-05T00:00:00.000Z", last_run: "2026-10-05T00:00:00.000Z", last_denial: null },
        { check_id: "hook:a", runs: 4, denials: 2, errors: 1, first_run: "2026-10-01T00:00:00.000Z", last_run: "2026-10-04T00:00:00.000Z", last_denial: "2026-10-03T00:00:00.000Z" },
      ]);
    } finally {
      store.close();
    }
  });

  it("checks count catches: removal candidates need >=30 days AND >=50 runs AND 0 denials (boundaries included); one denial takes a check off", async () => {
    expect([REMOVAL_MIN_DAYS, REMOVAL_MIN_RUNS]).toEqual([30, 50]);
    const store = new InMemoryStore();
    const rows = [
      ...runs("gate:never-caught", 60, isoDaysBefore(NOW, 40), 39),
      ...runs("gate:caught-once", 60, isoDaysBefore(NOW, 40), 39, [17]),
      ...runs("gate:too-young", 60, isoDaysBefore(NOW, 10), 9),
      ...runs("gate:too-few-runs", 49, isoDaysBefore(NOW, 40), 39),
      ...runs("gate:exactly-at-bounds", 50, isoDaysBefore(NOW, 30), 29),
      ...runs("gate:one-day-short", 50, isoDaysBefore(NOW, 29), 28),
    ];
    await store.appendCheckOutcomes(rows);
    const stats = await new CheckStatsService({ store, now: () => NOW }).stats();
    expect(stats.ok).toBe(true);
    if (!stats.ok) return;
    expect(stats.value.removal_candidates).toEqual(["gate:exactly-at-bounds", "gate:never-caught"]);
    const caught = stats.value.checks.find((c) => c.check_id === "gate:caught-once");
    expect(caught).toMatchObject({ denials: 1, removal_candidate: false });
    expect(caught?.last_denial).not.toBeNull();
    expect(deriveRemovalCandidates([], NOW)).toEqual([]);
  });

  it("checks count catches: a shipped hook records pass and deny through its real exit code, with no lore process", () => {
    const state = tempDir("lore-hook-state-");
    const env = { PATH: process.env["PATH"] ?? "", HOME: state, CLAUDE_STATE_BASE_OVERRIDE: state };
    const run = (payload: unknown) => spawnSync("node", [HOOK], { input: JSON.stringify(payload), env, encoding: "utf8" });
    expect(run({ tool_name: "Agent", tool_input: { subagent_type: "lore-reader" } }).status).toBe(0);
    expect(run({ tool_name: "Agent", tool_input: {} }).status).toBe(2);
    const file = hookOutcomesFilePath({ CLAUDE_STATE_BASE_OVERRIDE: state }, "/unused-home");
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { check: string; outcome: string; ts: string });
    expect(lines.map((l) => [l.check, l.outcome])).toEqual([
      ["hook:pre-no-general-agent-gate", "pass"],
      ["hook:pre-no-general-agent-gate", "deny"],
    ]);
    expect(Number.isFinite(Date.parse(lines[0]?.ts ?? ""))).toBe(true);
  });

  it("checks count catches: the hook outcome library maps exit 0 to pass, exit 2 or markDeny to deny, any other exit to error, and never changes the exit code", () => {
    const state = tempDir("lore-hook-lib-");
    const env = { PATH: process.env["PATH"] ?? "", HOME: state, CLAUDE_STATE_BASE_OVERRIDE: state };
    const script = (body: string) =>
      spawnSync("node", ["--input-type=module", "-e", `import { trackOutcome, markDeny } from ${JSON.stringify(OUTCOME_LIB)}; trackOutcome('hook:t'); ${body}`], { env, encoding: "utf8" });
    expect(script("process.exit(0)").status).toBe(0);
    expect(script("markDeny(); process.exit(0)").status).toBe(0); // a hook that blocks through JSON still exits 0
    expect(script("process.exit(3)").status).toBe(3);
    const file = hookOutcomesFilePath({ CLAUDE_STATE_BASE_OVERRIDE: state }, "/unused-home");
    const outcomes = readFileSync(file, "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { outcome: string }).outcome);
    expect(outcomes).toEqual(["pass", "deny", "error"]);
    // an unwritable state base never changes the verdict
    const blocked = join(state, "is-a-file");
    writeFileSync(blocked, "x");
    const failing = spawnSync("node", ["--input-type=module", "-e", `import { trackOutcome } from ${JSON.stringify(OUTCOME_LIB)}; trackOutcome('hook:t'); process.exit(2)`], {
      env: { ...env, CLAUDE_STATE_BASE_OVERRIDE: join(blocked, "nested") },
      encoding: "utf8",
    });
    expect(failing.status).toBe(2);
  });

  it("checks count catches: ingest moves hook rows into the store once, counts malformed lines, and a second ingest finds nothing", async () => {
    const dir = tempDir("lore-ingest-");
    const path = join(dir, "check-outcomes.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ check: "hook:x", outcome: "pass", ts: "2026-10-20T00:00:00.000Z" }),
        JSON.stringify({ check: "hook:x", outcome: "deny", ts: "2026-10-21T00:00:00.000Z" }),
        "not json",
        JSON.stringify({ check: "hook:x", outcome: "maybe", ts: "2026-10-21T00:00:00.000Z" }),
        "",
      ].join("\n"),
    );
    const store = new InMemoryStore();
    const service = new CheckStatsService({ store, now: () => NOW, hookOutcomesPath: path });
    const first = await service.ingestHookOutcomes();
    expect(first.ok && first.value).toEqual({ ingested: 2, malformed: 2 });
    expect(existsSync(path)).toBe(false);
    const second = await service.ingestHookOutcomes();
    expect(second.ok && second.value).toEqual({ ingested: 0, malformed: 0 });
    const stats = await service.stats();
    expect(stats.ok && stats.value.checks).toMatchObject([{ check_id: "hook:x", runs: 2, denials: 1, last_denial: "2026-10-21T00:00:00.000Z" }]);
  });

  it("checks count catches: a failed append puts the claimed lines back, so nothing is lost", async () => {
    const dir = tempDir("lore-ingest-fail-");
    const path = join(dir, "check-outcomes.jsonl");
    const line = JSON.stringify({ check: "hook:x", outcome: "deny", ts: "2026-10-21T00:00:00.000Z" });
    writeFileSync(path, `${line}\n`);
    const store = new InMemoryStore();
    store.appendCheckOutcomes = async () => err(storeError("locked"));
    const result = await new CheckStatsService({ store, now: () => NOW, hookOutcomesPath: path }).ingestHookOutcomes();
    expect(result.ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(`${line}\n`);
  });

  it("checks count catches: through the real CLI, hook rows written before the call show up in `lore checks stats --json`", () => {
    const corpus = newCorpus("lore-checks-cli-");
    const file = join(corpus.dir, ".claude", "session-state", "check-outcomes.jsonl"); // HOME is the corpus dir in the helper
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ check: "hook:cli-probe", outcome: "deny", ts: "2026-10-22T00:00:00.000Z" })}\n`);
    const out = lore(corpus, ["checks", "stats", "--json"]);
    expect(out.exitCode, out.stderr).toBe(0);
    const json = JSON.parse(out.stdout) as { data: { checks: Array<{ check_id: string; runs: number; denials: number; last_denial: string }>; removal_candidates: string[] } };
    expect(json.data.checks).toMatchObject([{ check_id: "hook:cli-probe", runs: 1, denials: 1, last_denial: "2026-10-22T00:00:00.000Z" }]);
    expect(json.data.removal_candidates).toEqual([]);
    const text = lore(corpus, ["checks", "stats"]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("Removal candidates");
    expect(text.stdout).toContain("hook:cli-probe");
  }, 180_000);
});

const PLAN_ID = "01PLANPLANPLANPLANPLANPLAN" as DocId;

function doc(over: Partial<DocRecord> & Pick<DocRecord, "id" | "slug" | "type">): DocRecord {
  return {
    role: over.type === "plan" ? "plan" : "plan",
    title: over.slug,
    status: "active",
    priority: "medium",
    content: "",
    parent_id: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    created_by: "tester",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...over,
  } as DocRecord;
}

const CLOSED_AT = "2026-10-01T00:00:00.000Z";

async function seedClosedPlan(store: InMemoryStore): Promise<void> {
  await store.insert(doc({ id: PLAN_ID, slug: "plan-alpha", type: "plan", status: "archived", updated_at: "2026-10-05T00:00:00.000Z" }));
  await store.insert(doc({ id: "01TASKONE" as DocId, slug: "task-one", type: "task", parent_id: PLAN_ID, status: "archived" }));
  await store.insert(doc({ id: "01TASKTWO" as DocId, slug: "task-two", type: "task", parent_id: PLAN_ID, status: "archived" }));
  await store.appendAuditEntry({ timestamp: CLOSED_AT, actor: "tester", session_id: "s", action: "update", doc_id: PLAN_ID, details: { patch: { status: "archived" }, version: 2 } });
  // a still-open plan must never appear
  await store.insert(doc({ id: "01PLANOPEN" as DocId, slug: "plan-open", type: "plan", status: "active" }));
}

const issue = (number: number, createdAt: string | undefined, text: string): EscapeIssue => ({ number, title: text, body: "", ...(createdAt === undefined ? {} : { createdAt }) });

describe("escaped defects (AC-LG-14)", () => {
  it("escaped defects: issues within 14 days of close that cite the plan or one of its tasks count; day 15, before close, non-citing and longer-slug issues do not", async () => {
    expect(ESCAPE_WINDOW_DAYS).toBe(14);
    const store = new InMemoryStore();
    await seedClosedPlan(store);
    const issues = [
      issue(1, isoDaysAfter(CLOSED_AT, 1), "Regression after plan-alpha landed"),
      issue(2, isoDaysAfter(CLOSED_AT, 14), "task-two broke on Windows"), // day 14: counted
      issue(3, isoDaysAfter(CLOSED_AT, 15), "plan-alpha follow-up"), // day 15: not counted
      issue(4, isoDaysAfter(CLOSED_AT, -1), "plan-alpha was incomplete"), // filed before close: not an escape
      issue(5, isoDaysAfter(CLOSED_AT, 2), "Unrelated crash in the dashboard"), // cites nothing
      issue(6, isoDaysAfter(CLOSED_AT, 3), "plan-alpha-v2 needs a design"), // longer slug, a different plan
      issue(7, isoDaysAfter(CLOSED_AT, 0), "closed together with plan-alpha"), // at the close instant: counted
    ];
    const quality = await new CheckStatsService({ store, now: () => NOW }).quality(async () => ok(issues));
    expect(quality.ok).toBe(true);
    if (!quality.ok) return;
    expect(quality.value.plans).toHaveLength(1); // plan-open is not closed
    expect(quality.value.plans[0]).toMatchObject({
      plan_slug: "plan-alpha",
      closed_at: CLOSED_AT,
      close_source: "audit",
      escaped_issues: 3,
      escaped_issue_numbers: [1, 2, 7],
    });
  });

  it("escaped defects: reopened tasks (after close only) and fix tasks (created after close, outside the plan, citing it) are counted as rework", async () => {
    const store = new InMemoryStore();
    await seedClosedPlan(store);
    await store.appendAuditEntry({ timestamp: isoDaysAfter(CLOSED_AT, 3), actor: "t", session_id: "s", action: "update", doc_id: "01TASKONE" as DocId, details: { operation: "reopen", version: 3 } });
    await store.appendAuditEntry({ timestamp: isoDaysAfter(CLOSED_AT, 4), actor: "t", session_id: "s", action: "update", doc_id: "01TASKONE" as DocId, details: { operation: "reopen", version: 4 } }); // same task twice: one task
    await store.appendAuditEntry({ timestamp: isoDaysAfter(CLOSED_AT, -5), actor: "t", session_id: "s", action: "update", doc_id: "01TASKTWO" as DocId, details: { operation: "reopen", version: 3 } }); // before close: ordinary rework inside the plan
    await store.insert(doc({ id: "01FIXONE" as DocId, slug: "fix-alpha-crash", title: "Fix crash from task-one", type: "task", created_at: isoDaysAfter(CLOSED_AT, 6), content: "Cites task-one." }));
    await store.insert(doc({ id: "01FIXTWO" as DocId, slug: "fix-other", title: "Fix something else", type: "task", created_at: isoDaysAfter(CLOSED_AT, 6), content: "No citation." }));
    await store.insert(doc({ id: "01FIXTHREE" as DocId, slug: "new-feature", title: "Extend plan-alpha", type: "task", created_at: isoDaysAfter(CLOSED_AT, 6), content: "Cites plan-alpha but is not a fix." }));
    await store.insert(doc({ id: "01FIXOLD" as DocId, slug: "fix-before", title: "Fix plan-alpha scaffolding", type: "task", created_at: isoDaysAfter(CLOSED_AT, -2), content: "Before close." }));
    const quality = await new CheckStatsService({ store, now: () => NOW }).quality(async () => ok([]));
    expect(quality.ok && quality.value.plans[0]).toMatchObject({ reopened_tasks: 1, fix_tasks: 1, escaped_issues: 0 });
  });

  it("escaped defects: a plan with no archive audit row falls back to its last write time and says so", async () => {
    const store = new InMemoryStore();
    await store.insert(doc({ id: PLAN_ID, slug: "plan-legacy", type: "plan", status: "archived", updated_at: "2026-09-15T00:00:00.000Z" }));
    const quality = await new CheckStatsService({ store, now: () => NOW }).quality(async () => ok([issue(9, "2026-09-16T00:00:00.000Z", "plan-legacy regression")]));
    expect(quality.ok && quality.value.plans[0]).toMatchObject({ close_source: "updated_at", closed_at: "2026-09-15T00:00:00.000Z", escaped_issues: 1 });
  });

  it("escaped defects: a failing issue reader and an undated issue are errors, never a quiet zero", async () => {
    const store = new InMemoryStore();
    await seedClosedPlan(store);
    const service = new CheckStatsService({ store, now: () => NOW });
    const failing = await service.quality(async () => err(storeError("gh unavailable")));
    expect(failing.ok).toBe(false);
    const undated = await service.quality(async () => ok([issue(5, undefined, "plan-alpha")]));
    expect(undated.ok).toBe(false);
    if (!undated.ok) expect(undated.error.code).toBe("VALIDATION_ERROR");
  });

  it("escaped defects: slug citation is whole-token (hyphen and word characters bound it)", () => {
    expect(citesAny("see plan-alpha.", ["plan-alpha"])).toBe(true);
    expect(citesAny("(task-one)", ["task-one"])).toBe(true);
    expect(citesAny("plan-alpha-v2", ["plan-alpha"])).toBe(false);
    expect(citesAny("myplan-alpha", ["plan-alpha"])).toBe(false);
    expect(citesAny("anything", [""])).toBe(false);
  });

  it("escaped defects: the sampling audit no longer exists: its exports are gone, and 50 auto decisions leave `lore pending` with no audit item", async () => {
    for (const removed of ["AUDIT_EVERY", "deriveAuditQueue"]) expect(removed in calibration).toBe(false);
    const service = new AutonomyCalibrationService({ store: new InMemoryStore(), executorRun: null, now: () => NOW });
    for (const removed of ["auditQueue", "getAuditItem", "recordAudit"]) expect(removed in service).toBe(false);

    const corpus = newCorpus("lore-lg14-");
    const seeded = await seedDecisions(corpus, "stash-drop", 50);
    expect(seeded.verdicts).toEqual(Array<string>(50).fill("auto"));
    expect(AUTO_FACTS.evidence).toBe("lore-evaluated");
    const json = lore(corpus, ["pending", "--json"]);
    expect(json.exitCode, json.stderr).toBe(0);
    const data = (JSON.parse(json.stdout) as { data: { decisions: unknown[]; audit?: unknown } }).data;
    expect(data.decisions).toEqual([]);
    expect(data.audit).toBeUndefined();
    const text = lore(corpus, ["pending"]).stdout;
    expect(text).not.toContain("Awaiting audit");
    const decide = lore(corpus, ["decide", "10", "--accept"]);
    expect(decide.exitCode).not.toBe(0); // there is nothing to answer
  }, 240_000);

  it("escaped defects: through the real CLI, `lore checks stats --quality` without feedback.upstream is refused, naming the setting", () => {
    const corpus = newCorpus("lore-quality-cli-");
    const out = lore(corpus, ["checks", "stats", "--quality"]);
    expect(out.exitCode).toBe(4);
    expect(out.stderr).toContain("feedback.upstream");
  }, 180_000);
});
