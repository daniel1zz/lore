/**
 * @spec_ref SPEC-102 §Acceptance Criteria AC-TRACE-4, AC-TRACE-5, AC-TRACE-6
 *
 * `lore trace stats` integration tests (T3) — spawns the real CLI in SOURCE
 * mode (`bun run src/index.ts`, mirrors `ai-config-fail-loud.bun.test.ts`'s
 * precedent) against a THROWAWAY corpus created via `mkdtemp(os.tmpdir())`.
 * Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-TRACE-4 — a read doc, an unread doc, a hit search, and a
 *               zero-hit search all surface correctly in `--json` output.
 *   NEGATIVE:   `trace.enabled: false` disables BOTH recording (a `lore get`
 *               inserts nothing) AND pruning (an old row survives).
 *   BOUNDARY:   the retention prune deletes a row exactly at the cutoff
 *               boundary while leaving a recent row untouched.
 *   STATE:      AC-TRACE-5 — startup prune deletes only rows older than
 *               `trace.retention_days`, and is idempotent (a second run finds
 *               nothing left to prune).
 *   ERROR:      n/a — `lore trace stats` has no invalid-input surface beyond
 *               citty's own arg validation (out of this spec's scope).
 *   REGRESSION: AC-TRACE-6 — running `lore trace stats` twice in a row never
 *               changes the underlying `trace_events` row count.
 *
 * SPEC-102 hardening (T4 items 1+2): NO oracle previously asserted a
 * `kind='feed'` row is ever written — `feed.ts` gated the trace write on
 * `process.exitCode === 0`, a strict equality Node never guarantees (its
 * OWN default is `undefined`). Every CURRENT checkpoint handler happens to
 * assign `0` explicitly, so this was a LATENT trap, not a live bug — but no
 * test would have caught a future handler that succeeds the natural way
 * (returning without assigning `process.exitCode`). The
 * "AC-TRACE-4/5/6 regression gate" describe block below adds the missing
 * HAPPY assertion (a successful `lore feed session-resume` produces a
 * `kind='feed'` row with the right `checkpoint` column) — proven RED-first
 * against the pre-fix `=== 0` predicate with a handler that leaves
 * `process.exitCode` unset (see this task's completion report for the
 * manual repro; not re-encoded as a permanent test since it requires
 * temporarily un-fixing production code).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ (3 up)
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the real CLI (source mode) with `cwd` as its working directory and `$HOME`. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

function writeConfig(projectDir: string, yamlBody: string): void {
  const loreDir = join(projectDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), yamlBody.trim() + "\n", "utf8");
}

function traceEventCount(dir: string): number {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db.query("SELECT COUNT(*) as count FROM trace_events").get() as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

/** Every `kind='feed'` row's `checkpoint` column, oldest first — SPEC-102 hardening T4 item 2. */
function feedTraceCheckpoints(dir: string): string[] {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    const rows = db
      .query("SELECT checkpoint FROM trace_events WHERE kind = 'feed' ORDER BY id ASC")
      .all() as { checkpoint: string | null }[];
    return rows.map((row) => row.checkpoint ?? "");
  } finally {
    db.close();
  }
}

/** Directly inserts one trace_events row — bypasses every real write path, used ONLY to seed an OLD row a live CLI invocation could never itself produce (SPEC-102 retention prune tests need rows dated in the past). */
function insertRawTraceRow(dir: string, ts: string, kind = "get"): void {
  const db = new Database(join(dir, ".lore", "lore.db"));
  try {
    db.run(
      "INSERT INTO trace_events (ts, actor, surface, session_id, kind, details) VALUES (?, ?, ?, ?, ?, ?)",
      [ts, "agent:seed", "agent", "s-seed", kind, "{}"],
    );
  } finally {
    db.close();
  }
}

interface JsonEnvelope<T> {
  ok: boolean;
  data: T;
}

interface DocEnvelope {
  id: string;
  slug: string;
}

interface TraceStatsReport {
  since: string;
  counts_by_kind: Record<string, number>;
  deny_by_checkpoint: { checkpoint: string; layer: string; count: number }[];
  zero_hit_search_count: number;
  never_read_docs_count: number;
  deny_retry_gap: { checkpoint: string; denies: number; retried_success: number }[];
}

function createPrd(dir: string, title: string): DocEnvelope {
  const result = runLore(["create", "prd", "--title", title, "--content", "x", "--json"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore create prd failed: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout) as JsonEnvelope<DocEnvelope>).data;
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-TRACE-4: lore trace stats --json aggregates counts-by-kind/deny-by-checkpoint/zero-hit/never-read", () => {
  it("HAPPY: a read doc, an unread doc, a hit search, and a zero-hit search all surface correctly", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-stats-"));
    initCorpus(tmpDir);

    const docA = createPrd(tmpDir, "Findable Widget");
    createPrd(tmpDir, "Unread Gadget"); // docB — deliberately never `lore get`'d

    const getResult = runLore(["get", docA.id], tmpDir);
    expect(getResult.exitCode).toBe(0);

    const hitSearch = runLore(["search", "Findable", "--json"], tmpDir);
    expect(hitSearch.exitCode).toBe(0);

    const missSearch = runLore(["search", "zzznomatchzzz9000", "--json"], tmpDir);
    expect(missSearch.exitCode).toBe(0);

    const statsResult = runLore(["trace", "stats", "--json"], tmpDir);
    expect(statsResult.exitCode).toBe(0);
    const report = (JSON.parse(statsResult.stdout) as JsonEnvelope<TraceStatsReport>).data;

    expect(report.counts_by_kind["get"]).toBeGreaterThanOrEqual(1);
    expect(report.counts_by_kind["search"]).toBe(2);
    expect(report.zero_hit_search_count).toBe(1);
    // Exactly docB — docA was read, and lore init/create seed no other docs.
    expect(report.never_read_docs_count).toBe(1);
  });

  it("HAPPY: --raw-queries includes the literal query text; omitted by default", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-stats-raw-"));
    initCorpus(tmpDir);
    createPrd(tmpDir, "Raw Query Target");

    const search = runLore(["search", "Raw Query Target", "--json"], tmpDir);
    expect(search.exitCode).toBe(0);

    const withoutRaw = runLore(["trace", "stats", "--json"], tmpDir);
    expect(withoutRaw.exitCode).toBe(0);
    const reportWithoutRaw = (JSON.parse(withoutRaw.stdout) as JsonEnvelope<TraceStatsReport & { raw_search_queries?: unknown }>).data;
    expect(reportWithoutRaw.raw_search_queries).toBeUndefined();

    const withRaw = runLore(["trace", "stats", "--json", "--raw-queries"], tmpDir);
    expect(withRaw.exitCode).toBe(0);
    const reportWithRaw = (
      JSON.parse(withRaw.stdout) as JsonEnvelope<TraceStatsReport & { raw_search_queries?: { query: string }[] }>
    ).data;
    expect(reportWithRaw.raw_search_queries).toBeDefined();
    expect(reportWithRaw.raw_search_queries?.some((q) => q.query === "Raw Query Target")).toBe(true);
  });
});

describe("AC-TRACE-5: startup retention prune", () => {
  it("STATE: deletes only rows older than trace.retention_days, and is idempotent once clean", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-prune-"));
    initCorpus(tmpDir);
    writeConfig(
      tmpDir,
      `
project:
  name: trace-prune-test
  author: tester
trace:
  retention_days: 1
`,
    );

    const oldTs = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const recentTs = new Date().toISOString();
    insertRawTraceRow(tmpDir, oldTs);
    insertRawTraceRow(tmpDir, recentTs);
    expect(traceEventCount(tmpDir)).toBe(2);

    // Any CLI invocation triggers loadLoreApp()'s opportunistic prune.
    const statusResult = runLore(["status"], tmpDir);
    expect(statusResult.exitCode).toBe(0);

    expect(traceEventCount(tmpDir)).toBe(1); // only the recent row survives

    // Idempotent: a second invocation with nothing left to prune changes nothing.
    const secondStatus = runLore(["status"], tmpDir);
    expect(secondStatus.exitCode).toBe(0);
    expect(traceEventCount(tmpDir)).toBe(1);
  });

  it("NEGATIVE: trace.enabled=false disables BOTH recording and pruning", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-disabled-"));
    initCorpus(tmpDir);
    writeConfig(
      tmpDir,
      `
project:
  name: trace-disabled-test
  author: tester
trace:
  enabled: false
  retention_days: 1
`,
    );

    const oldTs = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    insertRawTraceRow(tmpDir, oldTs);
    expect(traceEventCount(tmpDir)).toBe(1);

    const doc = createPrd(tmpDir, "No Trace Please");
    const getResult = runLore(["get", doc.id], tmpDir);
    expect(getResult.exitCode).toBe(0);

    // Old row survives (pruning disabled) AND no new row was added (recording disabled).
    expect(traceEventCount(tmpDir)).toBe(1);
  });
});

describe("AC-TRACE-6: running lore trace stats twice yields identical trace_events row counts", () => {
  it("REGRESSION: stats reads emit ZERO trace rows (no recursion)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-norecursion-"));
    initCorpus(tmpDir);

    const doc = createPrd(tmpDir, "Norecursion Doc");
    const getResult = runLore(["get", doc.id], tmpDir);
    expect(getResult.exitCode).toBe(0);

    const countBefore = traceEventCount(tmpDir);
    expect(countBefore).toBeGreaterThan(0);

    const first = runLore(["trace", "stats", "--json"], tmpDir);
    expect(first.exitCode).toBe(0);
    expect(traceEventCount(tmpDir)).toBe(countBefore);

    const second = runLore(["trace", "stats", "--json"], tmpDir);
    expect(second.exitCode).toBe(0);
    expect(traceEventCount(tmpDir)).toBe(countBefore);
  });
});

describe("SPEC-102 hardening T4 item 1+2: a successful lore feed writes a kind='feed' row", () => {
  it("HAPPY: lore feed session-resume on a fresh corpus produces a kind='feed' row carrying its checkpoint", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-feed-row-"));
    initCorpus(tmpDir);

    const feedResult = runLore(["feed", "session-resume", "--json"], tmpDir);
    expect(feedResult.exitCode).toBe(0);

    expect(feedTraceCheckpoints(tmpDir)).toEqual(["session-resume"]);
  });

  it("HAPPY: lore feed phase-start and task-start ALSO write their own kind='feed' checkpoint rows", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-feed-row-multi-"));
    initCorpus(tmpDir);

    // Generic (non-special-checkpoint) path — always exit 0 (module header, feed.ts) —
    // covers the OTHER `recordFeedTrace` call site (outside the dispatch table).
    const specCreateResult = runLore(["feed", "spec-create", "--json"], tmpDir);
    expect(specCreateResult.exitCode).toBe(0);

    // "session-resume" exercises the SPECIAL_CHECKPOINT_HANDLERS dispatch path
    // this task's item 1 fix touches (feed.ts's `(process.exitCode ?? 0) === 0`).
    const sessionResumeResult = runLore(["feed", "session-resume", "--json"], tmpDir);
    expect(sessionResumeResult.exitCode).toBe(0);

    expect(feedTraceCheckpoints(tmpDir)).toEqual(["spec-create", "session-resume"]);
  });
});
