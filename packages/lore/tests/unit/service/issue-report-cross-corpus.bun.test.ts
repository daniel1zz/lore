/**
 * Cross-corpus twin-fixture GREEN e2e suite for SPEC-072 `lore report-issue`
 * (AC-072-1..6, 8..11). Every fixture is a THROWAWAY `mkdtempSync` corpus
 * pair — an "upstream" (the target this feature reports issues INTO) and a
 * "consumer" (the corpus filing the report) — NEVER the repo's own
 * `.lore/` (root `CLAUDE.md`'s "never write to the repo's own `.lore/` from
 * tests" rule; every corpus path used below is asserted to live under
 * `os.tmpdir()`).
 *
 * Runs under `bun test` (spawns the compiled `dist/lore` binary — the
 * stale-binary false-oracle vector, root `CLAUDE.md` "Four false-oracle
 * vectors" — so `beforeAll` runs `bun run build` ONCE from THIS WORKTREE'S
 * root before any test spawns it).
 *
 * Test names embed their AC token verbatim (`AC-072-N`) so `-t 'AC-072-N'`
 * filters match ≥1 test per id (SPEC-061 matched-count discipline).
 *
 * Six-dimension coverage across the suite:
 *   HAPPY:      AC-072-1 (round-trip + pending + approve), AC-072-8 (dedup
 *               boundary), AC-072-9 (concurrency), AC-072-11 (MCP round-trip)
 *   NEGATIVE:   AC-072-2 (unconfigured feedback.upstream)
 *   BOUNDARY:   AC-072-6 (rate cap at exactly OPEN_REPORT_CAP=10)
 *   ERROR:      AC-072-3 (root_prd mismatch), AC-072-4 (version skew),
 *               AC-072-5 (sync-enabled upstream), AC-072-11 (missing `by`)
 *   STATE:      AC-072-10 (a review-rejected report computes 'rejected' with
 *               reason persisted, per D2's recorded-review-rejection
 *               precedence step — spec-issue-closure-loop-computed-
 *               resolution-agent-reachable AC-ICL-11; upstream removal
 *               degrades list rows to "unreachable" without crashing)
 *   REGRESSION: AC-072-4/probe-purity fingerprinting (db/-wal byte-identical,
 *               -shm size invariant) pins the "no migration on a rejected
 *               upstream" invariant already covered at the unit level by
 *               `tests/unit/store/schema-probe.bun.test.ts` — this file
 *               re-proves it through the REAL CLI spawn path, not just the
 *               `buildUpstreamContext` unit.
 *
 * ── AC-072-1 vs SPEC-069 D2 conflict — RESOLVED (plan-closure fix,
 * fix-readyadhoc-filter) ──
 * A prior version of this suite flagged that `TaskWorkflowService.readyAdhoc`
 * passed a draft ad-hoc task through unconditionally (SPEC-069 D2's own
 * stated visibility intent), which conflicted with AC-072-1 + PRD §20 F3's
 * requirement that a foreign-authored issue report stay out of `--adhoc`
 * until approved. Resolution: `readyAdhoc` now excludes a task ONLY when it
 * BOTH carries `extra.issue_report` AND is `draft`/`in-review` — self-authored
 * ad-hoc tasks (no `issue_report`) keep full SPEC-069 D2 visibility
 * unchanged. The test below asserts the literal AC-072-1 text (absent while
 * draft, present after approve).
 *
 * Source: SPEC-072 §4 Public Interface, §5 check sequence, §Acceptance
 * Criteria AC-072-1..6, 8..11.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NoOpTelemetry } from "@lore/core";
import { loadConfig } from "@lore/core/node";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { registerTools, LoreReportIssueSchema } from "../../../src/adapters/mcp/tools.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/sqlite-store.js";

// ─── Worktree-anchored dist/lore binary (never the main checkout's) ─────────

const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Every fixture path used by this suite MUST resolve under the OS tmpdir — never the repo's own `.lore/`. */
function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Synchronous `dist/lore <args>` spawn — CLAUDECODE=1 (agent surface, no AI nesting). */
function run(args: string[], opts: { cwd: string; env?: Record<string, string> }): RunResult {
  assertUnderTmp(opts.cwd);
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, CLAUDECODE: "1", ...opts.env },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** `run` + `--json`, parsed. Throws with full stdio context on a non-JSON response. */
function runJson<T>(args: string[], opts: { cwd: string; env?: Record<string, string> }): { result: RunResult; data: T } {
  const result = run([...args, "--json"], opts);
  try {
    return { result, data: JSON.parse(result.stdout) as T };
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from 'lore ${args.join(" ")}' (exit ${result.exitCode}):\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}\ncause: ${String(e)}`,
    );
  }
}

/** Async `dist/lore <args>` spawn — for concurrent (Promise.all) invocations. */
function spawnAsync(args: string[], opts: { cwd: string; env?: Record<string, string> }): ReturnType<typeof Bun.spawn> {
  assertUnderTmp(opts.cwd);
  return Bun.spawn([DIST_LORE, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, CLAUDECODE: "1", ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function waitFor(proc: ReturnType<typeof Bun.spawn>): Promise<RunResult> {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

// ─── Twin-corpus fixture builders ────────────────────────────────────────────

interface UpstreamFixture {
  root: string;
  rootPrdId: string;
  rootPrdSlug: string;
}

/** Fresh mkdtemp corpus, `lore init`'d, with a seeded root PRD. */
function makeUpstream(prefix: string): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, `lore-upstream-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) {
    throw new Error(`upstream 'lore init' failed: ${initResult.stderr}`);
  }
  const { result, data } = runJson<{ ok: true; data: { id: string; slug: string } }>(
    ["create", "prd", "--title", `Upstream Root PRD (${prefix})`, "--content", "root prd content"],
    { cwd: root },
  );
  if (result.exitCode !== 0) {
    throw new Error(`upstream root PRD creation failed: ${result.stderr}`);
  }
  return { root, rootPrdId: data.data.id, rootPrdSlug: data.data.slug };
}

/** Fresh mkdtemp corpus, `lore init`'d, with no `feedback.upstream` configured yet. */
function makeConsumer(prefix: string): string {
  const root = mkdtempSync(join(TMP_ROOT, `lore-consumer-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) {
    throw new Error(`consumer 'lore init' failed: ${initResult.stderr}`);
  }
  return root;
}

/** Appends a `feedback.upstream` stanza onto a consumer's config.yaml. */
function configureFeedbackUpstream(consumerRoot: string, upstreamRoot: string, rootPrdIdentity: string): void {
  assertUnderTmp(consumerRoot);
  appendFileSync(
    join(consumerRoot, ".lore", "config.yaml"),
    ["feedback:", "  upstream:", `    corpus_path: ${upstreamRoot}`, `    root_prd: ${rootPrdIdentity}`, ""].join(
      "\n",
    ),
  );
}

/** A fully-wired twin: upstream (seeded root PRD) + consumer (feedback.upstream configured). */
function makeTwin(prefix: string): { upstream: UpstreamFixture; consumerRoot: string } {
  const upstream = makeUpstream(prefix);
  const consumerRoot = makeConsumer(prefix);
  configureFeedbackUpstream(consumerRoot, upstream.root, upstream.rootPrdSlug);
  return { upstream, consumerRoot };
}

const fixturesToClean: string[] = [];
function track(...paths: string[]): void {
  for (const p of paths) fixturesToClean.push(p);
}

// ─── db/-wal/-shm fingerprint (mirrors schema-probe.bun.test.ts's "probe purity" helper) ──

const ABSENT_SIDECAR_MARKER = "lore-issue-report-cross-corpus:absent-sidecar";

function hashPathOrMarker(path: string): string {
  const hash = createHash("sha256");
  hash.update(existsSync(path) ? readFileSync(path) : ABSENT_SIDECAR_MARKER);
  return hash.digest("hex");
}

function sizeOfPathOrZero(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function fingerprintDb(dbPath: string): { db: string; wal: string; shmSize: number } {
  return {
    db: hashPathOrMarker(dbPath),
    wal: hashPathOrMarker(`${dbPath}-wal`),
    shmSize: sizeOfPathOrZero(`${dbPath}-shm`),
  };
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

beforeAll(() => {
  const buildResult = Bun.spawnSync(["bun", "run", "build"], { cwd: WORKTREE_ROOT });
  if (buildResult.exitCode !== 0) {
    throw new Error(
      `'bun run build' failed (exit ${buildResult.exitCode}):\n` +
        `stdout: ${buildResult.stdout.toString()}\nstderr: ${buildResult.stderr.toString()}`,
    );
  }
  if (!existsSync(DIST_LORE)) {
    throw new Error(`Expected ${DIST_LORE} to exist after 'bun run build'`);
  }
}, 120_000);

afterAll(() => {
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup — a fixture already removed by a test
      // itself (AC-072-10's "remove the upstream dir" step) must not throw.
    }
  }
});

// ─── AC-072-1: round-trip + pending queue + ready --adhoc + approve ──────────

describe("AC-072-1: round-trip lands a draft ad-hoc task with all 7 issue_report fields", () => {
  it("AC-072-1: filed report appears in upstream pending queue with all 7 extra.issue_report fields populated", () => {
    const { upstream, consumerRoot } = makeTwin("ac1");
    track(upstream.root, consumerRoot);

    const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string; possible_duplicates: string[]; dedup_degraded: boolean } }>(
      [
        "report-issue",
        "--title",
        "Report: something broke",
        "--description",
        "full description of the defect",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4 with a confusing message",
        "--repro-command",
        "lore status --check-drift",
      ],
      { cwd: consumerRoot, env: { LORE_ACTOR: "agent:ac1-reporter" } },
    );
    expect(result.exitCode).toBe(0);
    const upstreamDocId = data.data.upstream_doc_id;
    expect(upstreamDocId).toBeTruthy();

    // Appears in upstream pending queue as a draft task. SPEC-103 M3 hides task-type
    // docs from the DEFAULT queue ("pending = promises"); `--all` restores them — this
    // test's concern (the filed report shows up with its issue_report fields) is
    // orthogonal to M3's filtering behavior.
    const pending = runJson<{ ok: true; data: { docs: Array<{ id: string; type: string; status: string }> } }>(
      ["pending", "--all"],
      { cwd: upstream.root },
    );
    expect(pending.result.exitCode).toBe(0);
    const pendingRow = pending.data.data.docs.find((d) => d.id === upstreamDocId);
    expect(pendingRow).toBeTruthy();
    expect(pendingRow?.type).toBe("task");
    expect(pendingRow?.status).toBe("draft");

    // All 7 named extra.issue_report fields populated (SPEC-072 §4 IssueReportPayload,
    // excluding possible_duplicates which is the 8th, unnamed-in-the-AC field).
    // reason: `lore get --json`'s `data` shape is `{doc, navigation}` (get.ts) —
    // the doc's own fields live one level deeper than `lore create`'s flatter shape.
    const doc = runJson<{
      ok: true;
      data: { doc: { status: string; extra: { adhoc: boolean; issue_report: Record<string, unknown> } } };
    }>(["get", upstreamDocId], { cwd: upstream.root });
    expect(doc.result.exitCode).toBe(0);
    expect(doc.data.data.doc.status).toBe("draft");
    expect(doc.data.data.doc.extra.adhoc).toBe(true);
    const issueReport = doc.data.data.doc.extra.issue_report;
    for (const field of [
      "reporter_project",
      "reporter_actor",
      "lore_version",
      "repro_command",
      "expected",
      "actual",
      "reported_at",
    ]) {
      expect(issueReport).toHaveProperty(field);
      expect(issueReport[field]).toBeTruthy();
    }
    expect(issueReport["reporter_actor"]).toBe("agent:ac1-reporter");
    expect(issueReport["expected"]).toBe("exit 0");
    expect(issueReport["actual"]).toBe("exit 4 with a confusing message");

    // Per the resolved AC-072-1 vs SPEC-069 D2 conflict (this file's header):
    // a foreign-authored issue report is review-gated — ABSENT from
    // `lore ready --adhoc` while still draft.
    const readyBeforeApprove = runJson<{ ok: true; data: { adhoc: { records: Array<{ task: { id: string; status: string }; ready: boolean }> } } }>(
      ["ready", "--adhoc"],
      { cwd: upstream.root },
    );
    expect(readyBeforeApprove.result.exitCode).toBe(0);
    const recordBeforeApprove = readyBeforeApprove.data.data.adhoc.records.find((r) => r.task.id === upstreamDocId);
    expect(recordBeforeApprove).toBeUndefined();

    // After approve, the task becomes present in ready --adhoc.
    const approve = run(["approve", upstreamDocId, "--by", "tester"], { cwd: upstream.root });
    expect(approve.exitCode).toBe(0);

    const readyAfterApprove = runJson<{ ok: true; data: { adhoc: { records: Array<{ task: { id: string; status: string }; ready: boolean }> } } }>(
      ["ready", "--adhoc"],
      { cwd: upstream.root },
    );
    expect(readyAfterApprove.result.exitCode).toBe(0);
    const recordAfterApprove = readyAfterApprove.data.data.adhoc.records.find((r) => r.task.id === upstreamDocId);
    expect(recordAfterApprove).toBeTruthy();
    expect(recordAfterApprove?.task.status).toBe("approved");
    expect(recordAfterApprove?.ready).toBe(true);
  }, 20_000);
});

// ─── AC-072-2: unconfigured feedback.upstream ────────────────────────────────

describe("AC-072-2: unconfigured feedback.upstream fails loud, zero writes", () => {
  it("AC-072-2: exit 4, message names both required config keys, zero docs created, no receipt file", () => {
    const consumerRoot = makeConsumer("ac2");
    track(consumerRoot);

    const before = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], { cwd: consumerRoot });
    expect(before.data.data.total).toBe(0);

    const result = run(
      [
        "report-issue",
        "--title",
        "Report: unconfigured",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
      ],
      { cwd: consumerRoot },
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("feedback.upstream.corpus_path");
    expect(result.stderr).toContain("feedback.upstream.root_prd");

    const after = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], { cwd: consumerRoot });
    expect(after.data.data.total).toBe(0);

    expect(existsSync(join(consumerRoot, ".lore", "issue-receipts.jsonl"))).toBe(false);
  });
});

// ─── AC-072-3: root_prd identity mismatch ────────────────────────────────────

describe("AC-072-3: root_prd mismatch fails loud, zero upstream writes", () => {
  it("AC-072-3: exit 4 naming expected vs found; upstream doc count unchanged", () => {
    const upstream = makeUpstream("ac3");
    const consumerRoot = makeConsumer("ac3");
    track(upstream.root, consumerRoot);
    configureFeedbackUpstream(consumerRoot, upstream.root, "prd-this-slug-does-not-exist-upstream");

    const beforeTaskCount = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], {
      cwd: upstream.root,
    });
    expect(beforeTaskCount.data.data.total).toBe(0);

    const result = run(
      [
        "report-issue",
        "--title",
        "Report: mismatch",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
      ],
      { cwd: consumerRoot },
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("prd-this-slug-does-not-exist-upstream");
    expect(result.stderr).toContain(upstream.rootPrdSlug);

    const afterTaskCount = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], {
      cwd: upstream.root,
    });
    expect(afterTaskCount.data.data.total).toBe(0);
  });
});

// ─── AC-072-4: version skew (PRAGMA downgrade) ───────────────────────────────

describe("AC-072-4: version skew rejects with byte-identical db/-wal + -shm-size-invariant upstream", () => {
  it("AC-072-4: exit 4 naming both versions (LATEST_SCHEMA_VERSION vs 3); db/-wal sha256 identical, -shm size unchanged pre/post", () => {
    const upstream = makeUpstream("ac4");
    const consumerRoot = makeConsumer("ac4");
    track(upstream.root, consumerRoot);
    configureFeedbackUpstream(consumerRoot, upstream.root, upstream.rootPrdSlug);

    const dbPath = join(upstream.root, ".lore", "lore.db");
    const downgradedVersion = 3;

    // Downgrade via bun:sqlite directly (synthetic fixture — real corpora never
    // regress their own schema version).
    const rawDb = new Database(dbPath);
    // reason: PRAGMA statements do not accept bound parameters in SQLite —
    // interpolating a hardcoded test integer literal (never externally-sourced).
    rawDb.exec(`PRAGMA user_version = ${downgradedVersion}`);
    rawDb.close();

    const before = fingerprintDb(dbPath);

    const result = run(
      [
        "report-issue",
        "--title",
        "Report: version skew",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
      ],
      { cwd: consumerRoot },
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(String(LATEST_SCHEMA_VERSION));
    expect(result.stderr).toContain(String(downgradedVersion));

    const after = fingerprintDb(dbPath);
    expect(after.db).toBe(before.db);
    expect(after.wal).toBe(before.wal);
    // reason: -shm content legitimately churns on ANY WAL reader connection
    // (empirically verified in schema-probe.bun.test.ts's module header) —
    // SIZE is the real invariant (no migration ever grows/truncates it).
    expect(after.shmSize).toBe(before.shmSize);
  });
});

// ─── AC-072-5: sync-enabled upstream ─────────────────────────────────────────

describe("AC-072-5: sync-enabled upstream is rejected (v1 SQLite-only constraint)", () => {
  it("AC-072-5: exit 4 naming the SQLite-only constraint", () => {
    const upstream = makeUpstream("ac5");
    const consumerRoot = makeConsumer("ac5");
    track(upstream.root, consumerRoot);
    configureFeedbackUpstream(consumerRoot, upstream.root, upstream.rootPrdSlug);

    // reason: sync.enabled:true alone fails LoreConfigSchema's OWN superRefine
    // (remote_url required when enabled) — that would surface a DIFFERENT
    // ("remote_url is required") message than the rail this AC targets, so a
    // schema-valid remote_url is included to actually reach IssueReportService's
    // step-3 sync.enabled check.
    appendFileSync(
      join(upstream.root, ".lore", "config.yaml"),
      ["sync:", "  enabled: true", "  remote_url: libsql://example-upstream.turso.io", ""].join("\n"),
    );

    const result = run(
      [
        "report-issue",
        "--title",
        "Report: sync enabled",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
      ],
      { cwd: consumerRoot },
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr.toLowerCase()).toContain("sqlite-only");
  });
});

// ─── AC-072-6: rate cap ───────────────────────────────────────────────────────

describe("AC-072-6: rate cap refuses the 11th open report", () => {
  // reason: 11 sequential dist/lore spawns exceed bun:test's default 5000ms timeout.
  it("AC-072-6: 11th open report exits 4 listing the 10 open ids; upstream task count stays 10", () => {
    const { upstream, consumerRoot } = makeTwin("ac6");
    track(upstream.root, consumerRoot);

    const filedIds: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
        [
          "report-issue",
          "--title",
          `Report ${i}`,
          "--description",
          "desc",
          "--expected",
          "exit 0",
          "--actual",
          "exit 4",
        ],
        { cwd: consumerRoot, env: { LORE_ACTOR: "agent:ac6-reporter" } },
      );
      expect(result.exitCode).toBe(0);
      filedIds.push(data.data.upstream_doc_id);
    }
    expect(filedIds).toHaveLength(10);

    const eleventh = run(
      ["report-issue", "--title", "Report 11", "--description", "desc", "--expected", "exit 0", "--actual", "exit 4"],
      { cwd: consumerRoot, env: { LORE_ACTOR: "agent:ac6-reporter" } },
    );
    expect(eleventh.exitCode).toBe(4);
    for (const id of filedIds) {
      expect(eleventh.stderr).toContain(id);
    }

    const taskCount = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], {
      cwd: upstream.root,
    });
    expect(taskCount.data.data.total).toBe(10);
  }, 30_000);
});

// ─── AC-072-8: dedup boundary on a fresh (root-PRD-only) upstream ────────────

describe("AC-072-8: dedup boundary — fresh upstream yields empty possible_duplicates", () => {
  it("AC-072-8: possible_duplicates === [] and the write succeeds with exit 0", () => {
    const { upstream, consumerRoot } = makeTwin("ac8");
    track(upstream.root, consumerRoot);

    const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string; possible_duplicates: string[] } }>(
      [
        "report-issue",
        "--title",
        "A totally unique first-ever report",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
      ],
      { cwd: consumerRoot },
    );
    expect(result.exitCode).toBe(0);
    expect(data.data.possible_duplicates).toEqual([]);
  });
});

// ─── AC-072-9: concurrency ────────────────────────────────────────────────────

describe("AC-072-9: two concurrent report() calls yield two distinct tasks + two well-formed receipt lines", () => {
  it("AC-072-9: 2 concurrent CLI invocations → 2 distinct upstream tasks, exactly 2 JSON-parseable receipt lines", async () => {
    const { upstream, consumerRoot } = makeTwin("ac9");
    track(upstream.root, consumerRoot);

    const proc1 = spawnAsync(
      [
        "report-issue",
        "--title",
        "Concurrent report A",
        "--description",
        "desc A",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
        "--json",
      ],
      { cwd: consumerRoot, env: { LORE_ACTOR: "agent:ac9-a" } },
    );
    const proc2 = spawnAsync(
      [
        "report-issue",
        "--title",
        "Concurrent report B",
        "--description",
        "desc B",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
        "--json",
      ],
      { cwd: consumerRoot, env: { LORE_ACTOR: "agent:ac9-b" } },
    );

    const [r1, r2] = await Promise.all([waitFor(proc1), waitFor(proc2)]);
    expect(r1.exitCode).toBe(0);
    expect(r2.exitCode).toBe(0);

    const id1 = (JSON.parse(r1.stdout) as { data: { upstream_doc_id: string } }).data.upstream_doc_id;
    const id2 = (JSON.parse(r2.stdout) as { data: { upstream_doc_id: string } }).data.upstream_doc_id;
    expect(id1).not.toBe(id2);

    const taskCount = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], {
      cwd: upstream.root,
    });
    expect(taskCount.data.data.total).toBe(2);

    const receiptPath = join(consumerRoot, ".lore", "issue-receipts.jsonl");
    const receiptContent = readFileSync(receiptPath, "utf8");
    const lines = receiptContent.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(2);
    const parsedIds = new Set<string>();
    for (const line of lines) {
      const parsed = JSON.parse(line) as { upstream_doc_id: string };
      expect(typeof parsed.upstream_doc_id).toBe("string");
      parsedIds.add(parsed.upstream_doc_id);
    }
    expect(parsedIds).toEqual(new Set([id1, id2]));
  }, 20_000);
});

// ─── AC-072-10: closure list — rejection reason + upstream-removed unreachable rows ──
//
// P2 (spec-issue-closure-loop-computed-resolution-agent-reachable AC-ICL-11)
// reconciled this describe block's rejected-row expectation to the CORRECTED
// semantics below. Before P2, `UpstreamPort.getResolution` computed
// `resolution` with no knowledge of a review-workflow rejection (the SPEC-005
// audit trail, not `doc.status`, is the only record — see the inline `reason:`
// comment below), so a review-rejected report computed `open` while still
// carrying a `rejection_reason` — a self-contradicting row §20 F3/F4 forbid.
// This change is a SEMANTIC fix, not a test-green-washing edit: the row's
// `status` field IS the computed resolution (`issue-report-service.ts`'s
// `ReceiptStatusRow.status`, joined from `live.resolution` — never
// `doc.status` directly), and `rejected` is the only value consistent with a
// rejection reason being present at all.

describe("AC-072-10: --list joins live upstream status; rejection reason surfaces; unreachable upstream degrades rows", () => {
  it("AC-072-10: rejected row computes 'rejected' (via the recorded review rejection, spec D2) and carries the reason; removed upstream → status unreachable, exit 0, no crash", () => {
    const { upstream, consumerRoot } = makeTwin("ac10");
    track(consumerRoot); // upstream.root is deliberately removed mid-test below

    const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
      [
        "report-issue",
        "--title",
        "Report to be rejected",
        "--description",
        "desc",
        "--expected",
        "exit 0",
        "--actual",
        "exit 4",
      ],
      { cwd: consumerRoot },
    );
    expect(result.exitCode).toBe(0);
    const upstreamDocId = data.data.upstream_doc_id;

    const reject = run(["reject", upstreamDocId, "--by", "tester", "--reason", "not a lore defect"], {
      cwd: upstream.root,
    });
    expect(reject.exitCode).toBe(0);

    const listAfterReject = runJson<{
      ok: true;
      data: { rows: Array<{ upstream_doc_id: string; status: string; rejection_reason?: string }> };
    }>(["report-issue", "--list"], { cwd: consumerRoot });
    expect(listAfterReject.result.exitCode).toBe(0);
    const rejectedRow = listAfterReject.data.data.rows.find((r) => r.upstream_doc_id === upstreamDocId);
    expect(rejectedRow).toBeTruthy();
    // reason: ReviewService.reject never transitions a doc OFF draft (SPEC-005) —
    // the audit trail, not doc.status, is the sole record of "rejected". P2
    // (spec-issue-closure-loop-computed-resolution-agent-reachable D2) made
    // computeIssueResolution read that audit trail directly via
    // UpstreamPort.getResolution's restored reject-lookback, so the computed
    // resolution is 'rejected' — never 'open' (the pre-P2 gap: a rejection
    // reason present on a row computed 'open' was the exact self-contradiction
    // §20 F3/F4 forbid) and never 'draft' (`status` here is the COMPUTED
    // resolution, not the raw `doc.status` — that raw value is separately
    // available as `doc_status` and stays 'draft', per SPEC-005, unasserted here).
    expect(rejectedRow?.status).toBe("rejected");
    expect(rejectedRow?.rejection_reason).toBe("not a lore defect");

    // Remove the upstream corpus entirely.
    assertUnderTmp(upstream.root);
    rmSync(upstream.root, { recursive: true, force: true });

    const listAfterRemoval = runJson<{
      ok: true;
      data: { rows: Array<{ upstream_doc_id: string; status: string }> };
    }>(["report-issue", "--list"], { cwd: consumerRoot });
    expect(listAfterRemoval.result.exitCode).toBe(0);
    const unreachableRow = listAfterRemoval.data.data.rows.find((r) => r.upstream_doc_id === upstreamDocId);
    expect(unreachableRow).toBeTruthy();
    expect(unreachableRow?.status).toBe("unreachable");
  }, 20_000);
});

// ─── AC-072-11: MCP surface ───────────────────────────────────────────────────

/** Minimal, DI-only App stub — mirrors mcp-tools.test.ts's makeApp() (this handler
 * only reaches app via `registerTools`'s signature; the actual IO for `lore_report_issue`
 * comes from `resolveConsumerCorpusRoot()`/`buildIssueReportDeps` closures inside the
 * handler itself, keyed off `process.cwd()` — never `app`). */
function makeStubApp(): App {
  const store = new InMemoryStore();
  return {
    corpusService: new CorpusService(store),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: {} as ApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  } as unknown as App;
}

type McpServerInternal = {
  _registeredTools: Record<
    string,
    { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }
  >;
};

function getToolHandler(server: McpServer, name: string): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const internal = server as unknown as McpServerInternal;
  const tool = internal._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseToolResult(result: CallToolResult): unknown {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text);
}

describe("AC-072-11: MCP lore_report_issue", () => {
  it("AC-072-11: schema rejects a payload missing 'by' (required, same actor-identity precedent as lore_claim)", () => {
    const withoutBy = {
      title: "Report via MCP",
      description: "desc",
      expected: "exit 0",
      actual: "exit 4",
    };
    const parsed = LoreReportIssueSchema.safeParse(withoutBy);
    expect(parsed.success).toBe(false);
  });

  it("AC-072-11: with 'by', produces the same upstream draft ad-hoc task shape as the CLI path (all 7 issue_report fields)", async () => {
    const { upstream, consumerRoot } = makeTwin("ac11");
    track(upstream.root, consumerRoot);

    const app = makeStubApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const getConfig = () => {
      const configResult = loadConfig(consumerRoot);
      return configResult.ok ? configResult.value : undefined;
    };
    registerTools(server, app, getConfig);
    const handler = getToolHandler(server, "lore_report_issue");

    const originalCwd = process.cwd();
    let toolResult: CallToolResult;
    try {
      // reason: resolveConsumerCorpusRoot() (report-issue-wiring.ts) walks up
      // from process.cwd() — the in-process MCP harness must temporarily point
      // it at the consumer fixture, mirroring what a real MCP server process
      // launched with cwd=consumerRoot would see.
      process.chdir(consumerRoot);
      toolResult = await handler({
        by: "agent:mcp-reporter",
        title: "Report via MCP",
        description: "full description via MCP",
        expected: "exit 0",
        actual: "exit 4",
        repro_command: "lore status",
      });
    } finally {
      process.chdir(originalCwd);
    }

    expect(toolResult.isError).not.toBe(true);
    const parsed = parseToolResult(toolResult) as { upstream_doc_id: string; possible_duplicates: string[] };
    expect(parsed.upstream_doc_id).toBeTruthy();

    const doc = runJson<{
      ok: true;
      data: { doc: { status: string; extra: { issue_report: Record<string, unknown> } } };
    }>(["get", parsed.upstream_doc_id], { cwd: upstream.root });
    expect(doc.result.exitCode).toBe(0);
    expect(doc.data.data.doc.status).toBe("draft");
    const issueReport = doc.data.data.doc.extra.issue_report;
    for (const field of [
      "reporter_project",
      "reporter_actor",
      "lore_version",
      "repro_command",
      "expected",
      "actual",
      "reported_at",
    ]) {
      expect(issueReport).toHaveProperty(field);
      expect(issueReport[field]).toBeTruthy();
    }
    expect(issueReport["reporter_actor"]).toBe("agent:mcp-reporter");
  }, 20_000);
});
