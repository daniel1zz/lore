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
 *               boundary), AC-072-9 (concurrency — now asserted against the
 *               SPECIFIED contract, see AC-IC-5 note at that case),
 *               AC-072-11 (MCP round-trip)
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  classifyConcurrencyOutcome,
  matchesWriteContentionTemplate,
  NoOpTelemetry,
  WRITE_CONTENTION_EXIT_CODE,
} from "@lore/core";
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

// AC-IC-5 (spec-report-issue-has-no-specified-concurrency-contract-ac-072):
// this case used to assert that BOTH invocations exited zero, unconditionally,
// one assertion per process — an ASSUMED contract that nothing in report-issue's
// specification promised, failing roughly one run in ten and teaching every
// reader to re-run instead of to read. Both of those assertions are gone from
// this file (deliberately not quoted here in their code form, so an auditor
// grepping for them finds zero hits). What it asserts now is the SPECIFIED
// contract (D2): both
// invocations wrote, OR exactly one wrote while the other refused with the
// DECLARED exit code and stderr template — with the per-shape bookkeeping
// (distinct ids, loser template) checked against the FINAL attributable
// attempt, while the CUMULATIVE corpus/receipt bookkeeping (`allSucceededIds`,
// task-fix-the-spec-072-cross-corpus-database-is-locked-race) is checked
// against every attempt the retry loop ran — an excluded
// (`not_attributable`) attempt still performs a real, permanent write
// whenever its surviving invocation completes normally.
//
// The verdict comes from `@lore/core`'s pure classifier, never from a rule
// restated here (D6), so this case and the 50-run harness
// (`tests/integration/cli/issue-report-concurrency.bun.test.ts`) can never
// disagree about what "conforming" means.
describe("AC-072-9 / AC-IC-5: two concurrent report() calls conform to the specified concurrency contract", () => {
  it("AC-072-9 / AC-IC-5: 2 concurrent CLI invocations → both write, or exactly one writes while the other refuses with the declared code and template", async () => {
    const { upstream, consumerRoot } = makeTwin("ac9");
    track(upstream.root, consumerRoot);

    const reportArgs = (title: string, description: string): string[] => [
      "report-issue",
      "--title",
      title,
      "--description",
      description,
      "--expected",
      "exit 0",
      "--actual",
      "exit 4",
      "--json",
    ];

    // A run can end in a state that is neither conforming nor violating: the
    // compiled binary's native-module load race, or a locked-database refusal
    // from the per-command STARTUP corpus write — both recorded in the spec's
    // §Contract Details as NOT belonging to this contract, and explicitly NOT
    // to be "handled" with a retry/sleep/raised-timeout INSIDE a single
    // invocation (D3). Retrying the whole two-invocation SCENARIO a bounded
    // number of times — drawing a fresh independent sample, no delay between
    // attempts — is the harness-level mechanism the spec itself sanctions for
    // this ("account for" the two contention sources, not eliminate them).
    // Raised from 5 to 20 (task-fix-the-spec-072-cross-corpus-database-is-
    // locked-race): the SAME cold-start speedup that exposed the upstream-
    // probe bug this task fixes also raises the two invocations' STARTUP-path
    // overlap probability, so `contention_outside_report_write` alone was
    // observed exhausting all 5 attempts on a loaded machine (measured: 4/5
    // clean, 1/5 exhausted in a 5-run local sample). 20 keeps the same
    // no-delay-between-attempts shape while making "every attempt excluded"
    // astronomically unlikely even at a pessimistic 50% per-attempt exclusion
    // rate (0.5^20 ~= 1e-6) — not a raised per-write timeout, not a sleep, a
    // larger bounded sample count for an already-excluded, already-classified
    // outcome.
    const MAX_ATTEMPTS = 20;
    const excluded: string[] = [];
    let attributable: { first: RunResult; second: RunResult; shape: string } | undefined;
    // Every invocation that actually landed an upstream write, across EVERY
    // attempt the loop below runs — including `not_attributable`-excluded
    // ones. `contention_outside_report_write`'s own definition (see
    // `@lore/core`'s `hasContentionOutsideReportWrite`) is "one side lost a
    // STARTUP-phase race on the CONSUMER corpus and died before ever reaching
    // the upstream write" — the OTHER side's startup did NOT lose that race,
    // so it typically runs its entire pipeline unimpeded and DOES write a
    // real, permanent task. The fixture is a single `makeTwin` twin shared by
    // every retry attempt (never reset in between), so a partial write from
    // an EXCLUDED attempt is just as real and just as permanent as one from
    // the eventually-attributable attempt — omitting it from the corpus/
    // receipt bookkeeping below would silently undercount (task-fix-the-
    // spec-072-cross-corpus-database-is-locked-race: observed 4-5 real tasks
    // in the upstream after 2-3 excluded attempts, against a bookkeeping
    // check that only knew about the final attempt's winners).
    const allSucceededIds: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && attributable === undefined; attempt++) {
      const proc1 = spawnAsync(reportArgs(`Concurrent report A ${attempt}`, "desc A"), {
        cwd: consumerRoot,
        env: { LORE_ACTOR: "agent:ac9-a" },
      });
      const proc2 = spawnAsync(reportArgs(`Concurrent report B ${attempt}`, "desc B"), {
        cwd: consumerRoot,
        env: { LORE_ACTOR: "agent:ac9-b" },
      });
      const [first, second] = await Promise.all([waitFor(proc1), waitFor(proc2)]);
      for (const run of [first, second]) {
        if (run.exitCode === 0) {
          allSucceededIds.push(
            (JSON.parse(run.stdout) as { data: { upstream_doc_id: string } }).data.upstream_doc_id,
          );
        }
      }
      const verdict = classifyConcurrencyOutcome(first, second);
      if (verdict.outcome === "not_attributable") {
        excluded.push(`attempt ${attempt}: ${verdict.reason} — ${verdict.detail}`);
        continue;
      }
      expect(
        verdict.outcome,
        verdict.outcome === "non_conforming" ? verdict.detail : "",
      ).toBe("conforming");
      attributable = {
        first,
        second,
        shape: verdict.outcome === "conforming" ? verdict.shape : "non_conforming",
      };
    }

    expect(
      attributable,
      `no attributable run in ${MAX_ATTEMPTS} attempts:\n${excluded.join("\n")}`,
    ).toBeDefined();
    const { first, second, shape } = attributable as { first: RunResult; second: RunResult; shape: string };

    const winners = [first, second].filter((run) => run.exitCode === 0);
    const losers = [first, second].filter((run) => run.exitCode !== 0);
    expect(winners.length).toBe(shape === "both_succeeded" ? 2 : 1);

    // Every winner reports its own distinct upstream doc id.
    const winnerIds = winners.map(
      (run) => (JSON.parse(run.stdout) as { data: { upstream_doc_id: string } }).data.upstream_doc_id,
    );
    expect(new Set(winnerIds).size).toBe(winnerIds.length);

    // A loser, if any, carries the DECLARED code and the DECLARED template —
    // never a bare storage failure.
    for (const loser of losers) {
      expect(loser.exitCode).toBe(WRITE_CONTENTION_EXIT_CODE);
      expect(matchesWriteContentionTemplate(loser.stderr)).toBe(true);
      expect(loser.stderr).not.toContain("Storage failure");
    }

    // The upstream holds exactly one task per invocation that ever actually
    // succeeded — across EVERY attempt this test ran, not only the final
    // attributable one (see `allSucceededIds`'s own note above: an excluded
    // attempt's surviving invocation still performs a real, permanent write).
    // A refusal, attributable or not, wrote nothing.
    expect(new Set(allSucceededIds).size).toBe(allSucceededIds.length);
    const taskCount = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], {
      cwd: upstream.root,
    });
    expect(taskCount.data.data.total).toBe(allSucceededIds.length);

    // …and the local receipt log has exactly one JSON-parseable line per
    // invocation that ever actually succeeded, for the same reason (receipts
    // are appended STRICTLY after a successful upstream write, on every
    // attempt, not only the final one).
    const receiptPath = join(consumerRoot, ".lore", "issue-receipts.jsonl");
    const lines = readFileSync(receiptPath, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(allSucceededIds.length);
    const parsedIds = new Set<string>();
    for (const line of lines) {
      const parsed = JSON.parse(line) as { upstream_doc_id: string };
      expect(typeof parsed.upstream_doc_id).toBe("string");
      parsedIds.add(parsed.upstream_doc_id);
    }
    expect(parsedIds).toEqual(new Set(allSucceededIds));
  }, 120_000);
});

// ─── A SYNCHRONOUS store-init throw refuses, it does not escape ──────────────
//
// task-openvalidatedupstream-lets-a-synchronous-store-init-throw. Both
// re-typing sites in `openValidatedUpstream` (the `deps.probe` failure and the
// `deps.openUpstream` failure) only ever saw the `Result`-RETURNING failure
// path. `buildUpstreamContext` — the real `openUpstream` port — could instead
// THROW synchronously out of `new SQLiteStore(...)`: `SQLiteStore.init()`
// issues `PRAGMA journal_mode = WAL` as its FIRST statement, and bun:sqlite
// raises `database is locked` (`code: "SQLITE_BUSY"`) straight out of the
// constructor when that statement collides with another process's write lock.
// Nothing caught it, so it escaped `openValidatedUpstream` → `report` and
// killed the process with a raw stack trace — measured at 92 deaths across
// ~300 attempts of the AC-IC-1 harness, with frames `run (bun:sqlite)` →
// `init` → `new SQLiteStore` → `buildUpstreamContext` → `openValidatedUpstream`.
//
// Why THIS fixture (a rollback-journal upstream), and not simply "hold a lock":
// the production window is a WAL cold-open race — two invocations opening the
// same corpus with no live `-shm`, one of them needing wal-index recovery
// while the other holds `BEGIN IMMEDIATE`. That window is inherently
// PROBABILISTIC (measured 24 throws / 240 cold-open connections), so a test
// built on it could pass while measuring nothing. Putting the upstream in
// rollback-journal mode makes the SAME statement fail DETERMINISTICALLY and
// for the same reason: `PRAGMA journal_mode = WAL` now has to genuinely SWITCH
// modes, which needs the write lock the holder is sitting on. Two properties
// make this fixture the right deterministic stand-in rather than a contrivance:
//
//   1. The readonly schema probe (`openValidatedUpstream` step 4) still
//      SUCCEEDS against it — a holder's `BEGIN IMMEDIATE` takes a RESERVED
//      lock, which still admits readers — so the invocation genuinely reaches
//      `deps.openUpstream` and fails exactly where the defect lives. A holder
//      that also blocked the probe would refuse one rail EARLIER and this test
//      would pass without ever exercising the store-construction path.
//   2. SQLite does NOT consult the busy handler for a journal-mode SWITCH
//      (measured: throws at ~0ms whether `busy_timeout` is 0 or 2000, unlike
//      the WAL-recovery path where the declared bound does eliminate it). So
//      no bound, however large, can rescue this case — the ONLY thing standing
//      between it and a raw stack trace is that a `Result`-returning boundary
//      stops leaking exceptions. That makes this a pure oracle for the catch.
//
// The control below pairs with it: the byte-identical invocation against the
// byte-identical rollback-journal fixture, with NO holder, exits 0 and files a
// real report. Without that control a green refusal here would be
// indistinguishable from a fixture that is simply broken.

/** Puts an upstream corpus db into rollback-journal mode — see the section note above. */
function setRollbackJournalMode(upstreamRoot: string): void {
  assertUnderTmp(upstreamRoot);
  const db = new Database(join(upstreamRoot, ".lore", "lore.db"));
  const mode = (db.query("PRAGMA journal_mode = DELETE").get() as { journal_mode: string }).journal_mode;
  db.close();
  if (mode !== "delete") {
    throw new Error(`fixture setup: expected journal_mode 'delete', got '${mode}'`);
  }
}

/**
 * Child-process write-lock holder. Deliberately self-contained (raw bun:sqlite
 * only, zero coupling to this repo's module resolution) — same shape as
 * `tests/unit/store/busy-timeout.bun.test.ts`'s holder. `BEGIN IMMEDIATE`
 * takes the RESERVED lock immediately per SQLite's documented semantics (no
 * write statement needed), and the transaction is ROLLED BACK, never
 * committed, so the holder mutates nothing in the upstream corpus.
 */
const UPSTREAM_LOCK_HOLDER_SCRIPT = `
import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";

const [, , dbPath, markerPath, holdMsArg] = process.argv;
const db = new Database(dbPath);
db.exec("BEGIN IMMEDIATE");
writeFileSync(markerPath, "locked");
await Bun.sleep(Number(holdMsArg));
db.exec("ROLLBACK");
db.close();
`;

/** Polls for the holder's lock-acquired marker, or throws (never silently proceeds unlocked). */
async function waitForLockMarker(markerPath: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(markerPath)) {
    if (Date.now() > deadline) {
      throw new Error(`lock holder never signalled acquisition within ${timeoutMs}ms`);
    }
    await Bun.sleep(5);
  }
}

/** A non-default declared bound, so "the bound reported is the bound declared" cannot pass by coincidence. */
const DECLARED_UPSTREAM_WRITE_WAIT_MS = 1_500;

function configureUpstreamWriteWaitMs(consumerRoot: string, ms: number): void {
  assertUnderTmp(consumerRoot);
  appendFileSync(join(consumerRoot, ".lore", "config.yaml"), `    write_wait_ms: ${ms}\n`);
}

const initThrowReportArgs = (title: string): string[] => [
  "report-issue",
  "--title",
  title,
  "--description",
  "a report filed while the upstream corpus write lock is held by another process",
  "--expected",
  "the declared write-contention refusal",
  "--actual",
  "an uncaught SQLITE_BUSY stack trace",
  "--json",
];

describe("a synchronous store-init throw is re-typed into the declared refusal instead of escaping", () => {
  it("REGRESSION: report against a write-locked upstream refuses with the declared contention code + template, never a raw bun:sqlite stack trace", async () => {
    const { upstream, consumerRoot } = makeTwin("initthrow");
    track(upstream.root, consumerRoot);
    configureUpstreamWriteWaitMs(consumerRoot, DECLARED_UPSTREAM_WRITE_WAIT_MS);
    setRollbackJournalMode(upstream.root);

    const holderDir = mkdtempSync(join(TMP_ROOT, "lore-lockholder-"));
    track(holderDir);
    const holderScriptPath = join(holderDir, "holder.mjs");
    const markerPath = join(holderDir, "locked.marker");
    writeFileSync(holderScriptPath, UPSTREAM_LOCK_HOLDER_SCRIPT);

    const holderProc = Bun.spawn(
      ["bun", holderScriptPath, join(upstream.root, ".lore", "lore.db"), markerPath, "8000"],
      { stdout: "ignore", stderr: "pipe" },
    );
    await waitForLockMarker(markerPath);

    const result = run(initThrowReportArgs("Report filed against a locked upstream"), {
      cwd: consumerRoot,
      env: { LORE_ACTOR: "agent:initthrow-reporter" },
    });

    const holderExitCode = await holderProc.exited;
    expect(holderExitCode).toBe(0);

    // The declared refusal — code AND template, from `@lore/core`'s own
    // constants, never a number restated here.
    expect(result.exitCode).toBe(WRITE_CONTENTION_EXIT_CODE);
    expect(matchesWriteContentionTemplate(result.stderr)).toBe(true);

    // …and NOT the pre-fix outcome. Two INDEPENDENT negative conditions rather
    // than one remembered phrase: an uncaught bun:sqlite throw prints both the
    // module name in its frames and an indented `at …` frame line.
    expect(result.stderr).not.toContain("bun:sqlite");
    expect(result.stderr).not.toMatch(/\n\s+at /);

    // D4: the bound SURFACED is the bound DECLARED, verbatim — not a
    // re-derived, rounded, or defaulted number.
    expect(result.stderr).toContain(`${DECLARED_UPSTREAM_WRITE_WAIT_MS}ms bound`);

    // A refusal writes nothing: no upstream task, no local receipt.
    const taskCount = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], {
      cwd: upstream.root,
    });
    expect(taskCount.data.data.total).toBe(0);
    expect(existsSync(join(consumerRoot, ".lore", "issue-receipts.jsonl"))).toBe(false);
  }, 60_000);

  it("CONTROL: the byte-identical invocation against the byte-identical fixture, with NO holder, succeeds — proving the holder is what produced the refusal above", () => {
    const { upstream, consumerRoot } = makeTwin("initthrow-control");
    track(upstream.root, consumerRoot);
    configureUpstreamWriteWaitMs(consumerRoot, DECLARED_UPSTREAM_WRITE_WAIT_MS);
    setRollbackJournalMode(upstream.root);

    const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
      initThrowReportArgs("Report filed against an unlocked upstream"),
      { cwd: consumerRoot, env: { LORE_ACTOR: "agent:initthrow-control" } },
    );

    expect(result.exitCode).toBe(0);
    expect(data.data.upstream_doc_id).toBeTruthy();
    const taskCount = runJson<{ ok: true; data: { total: number } }>(["list", "--type", "task"], {
      cwd: upstream.root,
    });
    expect(taskCount.data.data.total).toBe(1);
  }, 60_000);
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
