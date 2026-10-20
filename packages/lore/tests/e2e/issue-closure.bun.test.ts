// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * Compiled-binary e2e oracle for AC-ICL-3/AC-ICL-4/AC-ICL-5
 * (spec-issue-closure-loop-computed-resolution-agent-reachable, §D3/§D4) —
 * `lore issue resolve` (D3) and `lore issues` (D4). Spawns the REAL compiled
 * `dist/lore` binary (`Bun.spawnSync`), mirroring the harness
 * `tests/e2e/context-verbs-compiled.bun.test.ts` and
 * `tests/integration/p2-e2e-closed-loop.bun.test.ts` establish
 * (`assertFreshBinary` guard, `mkdtempSync` throwaway corpus, `HOME` pointed
 * at the temp dir). Never touches this repo's own `.lore/` corpus (project
 * CLAUDE.md hard rule) — every test operates inside its own throwaway
 * directory.
 *
 * Fixtures are seeded via DIRECT `SQLiteStore`/`CorpusService` calls against
 * the throwaway corpus's real `.lore/lore.db` (bare `new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)))`
 * — ungated, no GateEnforcer), the SAME hybrid pattern
 * `tests/e2e/migrate-ordinals-compiled.bun.test.ts` uses: direct-store seed,
 * then compiled-binary spawn for the behavior under test. This is required
 * because `lore create task` has no CLI path to write `extra.issue_report`
 * (that shape is written only by the upstream `lore report-issue` consumer
 * flow, SPEC-072, a different spec) — `computeIssueResolution` itself
 * (`../../src/service/issue-resolution.js`) is CONSUMED via `issue.ts`/
 * `issues.ts`, never reimplemented here or there.
 *
 * Historical note: an earlier version of this suite carried a test-only
 * SQLite CHECK-widening helper because migration-004 widened
 * `links.link_type`'s CHECK constraint to accept `"governs"` but no migration
 * yet widened it for `"resolves"` — `linkTypeSchema` (`@lore/core`) had
 * already accepted `"resolves"` as its 8th member (P1), but every REAL
 * (non-`InMemoryStore`) write of a `resolves` edge failed the CHECK
 * constraint. `migration-012` (`packages/lore/src/store/migrations/
 * migration-012.ts`) closed that gap by widening the CHECK constraint on the
 * real migration path (mirroring migration-004's exact table-recreate DDL).
 * A fresh `lore init` corpus therefore already accepts `resolves` edges with
 * no widening step — every case below writes real `resolves` edges via
 * `dist/lore link --type resolves` against a normally-migrated corpus.
 *
 * Coverage (six-dimension, spread across the three AC groups):
 *   AC-ICL-3: HAPPY (fixed rejected, writes nothing) / NEGATIVE (fixed
 *     rejected even on a non-issue target) / BOUNDARY (--reason supplied
 *     anyway, still rejected) / ERROR (an unrecognized --state value) /
 *     REGRESSION (a legitimate resolve after a failed fixed attempt still
 *     works).
 *   AC-ICL-4: HAPPY (wontfix + rejected both persist state+reason) /
 *     NEGATIVE (non-issue target rejected, unchanged) / BOUNDARY (empty
 *     --reason rejected) / ERROR (nonexistent issue) / STATE (explicit state
 *     wins over a resolves-edge computation that would otherwise be
 *     "fixed") / REGRESSION (sibling extra fields survive the RMW write).
 *   AC-ICL-5: HAPPY (--all lists exactly the issue tasks with correct
 *     open/resolving/fixed resolutions, excludes a plain task) / BOUNDARY
 *     (default --open excludes all 3 terminal states, includes
 *     open+resolving) / ERROR (zero-report corpus -> empty list, exit 0) /
 *     STATE (resolving an open report moves it from --open into --resolved)
 *     / REGRESSION (mutex flag violation exits 2; no-flag default matches
 *     --open exactly).
 *
 * @spec_ref spec-issue-closure-loop-computed-resolution-agent-reachable §D3,
 *   §D4, AC-ICL-3, AC-ICL-4, AC-ICL-5;
 *   task-p2-cli-verbs-lore-issue-resolve-lore-issues.
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { RecordLockService } from "../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { actedStore } from "../live-invocation.js";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// same derivation as tests/e2e/context-verbs-compiled.bun.test.ts and
// tests/e2e/migrate-ordinals-compiled.bun.test.ts.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface JsonEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface IssueRow {
  id: string;
  slug: string;
  title: string;
  reporter_project: string;
  reported_at: string;
  age: string;
  resolution: string;
}

// ─── Spawn helpers ──────────────────────────────────────────────────────────

/**
 * Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at
 * the throwaway temp repo, `CLAUDECODE=1` so the "agent" caller surface
 * (SPEC-024) resolves the AI default OFF (none of the commands under test
 * have an AI path, but this matches every other compiled-binary suite's
 * convention).
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function initCorpus(dir: string): Promise<void> {
  const result = await runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed in fixture setup: ${result.stderr}`);
  }
}

function dbPathFor(dir: string): string {
  return join(dir, ".lore", "lore.db");
}

function parseJson<T = unknown>(stdout: string): JsonEnvelope<T> {
  try {
    return JSON.parse(stdout) as JsonEnvelope<T>;
  } catch {
    throw new Error(`could not parse JSON from stdout: ${stdout}`);
  }
}

// ─── Direct-store seed helpers (bare CorpusService — ungated) ──────────────

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) {
    throw new Error(`seed create failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

async function seedRootPrd(cs: CorpusService): Promise<DocRecord> {
  return await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
}

function defaultIssueReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reporter_project: "consumer-a",
    reporter_actor: "agent:consumer",
    lore_version: "0.5.0",
    expected: "exit 0",
    actual: "exit 4",
    reported_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    possible_duplicates: [],
    ...overrides,
  };
}

async function seedIssueTask(
  cs: CorpusService,
  title: string,
  issueReport: Record<string, unknown> = defaultIssueReport(),
): Promise<DocRecord> {
  return await mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true, issue_report: issueReport },
  } as CreateDocInput);
}

async function seedPlainTask(cs: CorpusService, title: string): Promise<DocRecord> {
  return await mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true },
  } as CreateDocInput);
}

/** Walks a doc draft -> approved -> active (both legal VALID_TRANSITIONS steps) so it counts as a "terminal" resolves-edge source (D2: active/archived -> fixed). */
async function transitionToActive(cs: CorpusService, docId: string): Promise<void> {
  const approveResult = await cs.set(docId, { status: "approved" });
  if (!approveResult.ok) {
    throw new Error(`seed transition to approved failed: ${JSON.stringify(approveResult.error)}`);
  }
  const activeResult = await cs.set(docId, { status: "active" });
  if (!activeResult.ok) {
    throw new Error(`seed transition to active failed: ${JSON.stringify(activeResult.error)}`);
  }
}

// ─── Fixture lifecycle ──────────────────────────────────────────────────────

const activeDirs: string[] = [];

function freshDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  // Never the repo's own .lore/ corpus (project CLAUDE.md hard rule) — a
  // genuine os.tmpdir() path is never a prefix of REPO_ROOT.
  expect(dir.startsWith(REPO_ROOT)).toBe(false);
  activeDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (activeDirs.length > 0) {
    const dir = activeDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ─── AC-ICL-3: --state fixed is rejected unconditionally ───────────────────

describe("AC-ICL-3: lore issue resolve --state fixed is rejected unconditionally", () => {
  it("HAPPY: a genuine issue task's --state fixed exits non-zero, names lore link + resolves, writes nothing", async () => {
    const dir = freshDir("lore-issue-closure-3-happy-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Filed defect A");
    store.close();

    const result = await runLore(["issue", "resolve", issue.slug, "--state", "fixed"], dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lore link");
    expect(result.stderr).toContain("resolves");

    // Writes NOTHING — re-read via a fresh `dist/lore get --json` call.
    const getResult = await runLore(["get", issue.slug, "--json"], dir);
    expect(getResult.exitCode).toBe(0);
    const parsed = parseJson<{ doc: DocRecord }>(getResult.stdout);
    const extra = parsed.data?.doc.extra as Record<string, unknown>;
    const issueReport = extra["issue_report"] as Record<string, unknown>;
    expect(issueReport["resolution"]).toBeUndefined();
    expect(parsed.data?.doc.version).toBe(1);
  });

  it("NEGATIVE: --state fixed on a PLAIN task (no extra.issue_report) is rejected the SAME way — the fixed-check fires before any issue_report/type validation", async () => {
    const dir = freshDir("lore-issue-closure-3-negative-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const plain = await seedPlainTask(cs, "Ordinary task");
    store.close();

    const result = await runLore(["issue", "resolve", plain.slug, "--state", "fixed"], dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lore link");
    expect(result.stderr).toContain("resolves");
  });

  it("BOUNDARY: --state fixed with --reason ALSO supplied is still rejected identically (reason is irrelevant to this branch)", async () => {
    const dir = freshDir("lore-issue-closure-3-boundary-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Filed defect B");
    store.close();

    const result = await runLore(
      ["issue", "resolve", issue.slug, "--state", "fixed", "--reason", "irrelevant"],
      dir,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lore link");
    expect(result.stderr).toContain("resolves");
  });

  it("ERROR: an unrecognized --state value exits non-zero via a DISTINCT message from the fixed-specific rejection", async () => {
    const dir = freshDir("lore-issue-closure-3-error-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Filed defect C");
    store.close();

    const result = await runLore(["issue", "resolve", issue.slug, "--state", "bogus-value"], dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Invalid");
    expect(result.stderr).toContain("state");
  });

  it("REGRESSION: a legitimate resolve on the SAME issue still works after an earlier failed --state fixed attempt", async () => {
    const dir = freshDir("lore-issue-closure-3-regression-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Filed defect D");
    store.close();

    const failedAttempt = await runLore(["issue", "resolve", issue.slug, "--state", "fixed"], dir);
    expect(failedAttempt.exitCode).not.toBe(0);

    const legitAttempt = await runLore(
      ["issue", "resolve", issue.slug, "--state", "wontfix", "--reason", "not a bug", "--json"],
      dir,
    );
    expect(legitAttempt.exitCode).toBe(0);
    const parsed = parseJson<{ doc: DocRecord; resolution: string }>(legitAttempt.stdout);
    expect(parsed.data?.resolution).toBe("wontfix");
  });
});

// ─── AC-ICL-4: --state rejected|wontfix --reason persists ──────────────────

describe("AC-ICL-4: lore issue resolve --state rejected|wontfix --reason persists explicit terminal state", () => {
  it("HAPPY: --state wontfix --reason persists both fields under extra.issue_report.resolution and bumps version", async () => {
    const dir = freshDir("lore-issue-closure-4-happy-wontfix-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Filed defect E");
    store.close();

    const result = await runLore(
      ["issue", "resolve", issue.slug, "--state", "wontfix", "--reason", "not a bug", "--json"],
      dir,
    );
    expect(result.exitCode).toBe(0);
    const parsed = parseJson<{ doc: DocRecord; resolution: string }>(result.stdout);
    const doc = parsed.data?.doc as DocRecord;
    expect(doc.version).toBe(2);
    const issueReport = (doc.extra as Record<string, unknown>)["issue_report"] as Record<string, unknown>;
    const resolution = issueReport["resolution"] as Record<string, unknown>;
    expect(resolution["state"]).toBe("wontfix");
    expect(resolution["reason"]).toBe("not a bug");
    expect(parsed.data?.resolution).toBe("wontfix");
  });

  it("HAPPY: --state rejected --reason on a different issue also persists correctly", async () => {
    const dir = freshDir("lore-issue-closure-4-happy-rejected-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Filed defect F");
    store.close();

    const result = await runLore(
      ["issue", "resolve", issue.slug, "--state", "rejected", "--reason", "duplicate of #1", "--json"],
      dir,
    );
    expect(result.exitCode).toBe(0);
    const parsed = parseJson<{ doc: DocRecord; resolution: string }>(result.stdout);
    expect(parsed.data?.resolution).toBe("rejected");
    const doc = parsed.data?.doc as DocRecord;
    const issueReport = (doc.extra as Record<string, unknown>)["issue_report"] as Record<string, unknown>;
    const resolution = issueReport["resolution"] as Record<string, unknown>;
    expect(resolution["reason"]).toBe("duplicate of #1");
  });

  it("NEGATIVE: target lacking extra.issue_report is rejected, left unchanged", async () => {
    const dir = freshDir("lore-issue-closure-4-negative-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const plain = await seedPlainTask(cs, "Ordinary task 2");
    store.close();

    const result = await runLore(
      ["issue", "resolve", plain.slug, "--state", "wontfix", "--reason", "n/a"],
      dir,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("issue_report");

    const getResult = await runLore(["get", plain.slug, "--json"], dir);
    const parsed = parseJson<{ doc: DocRecord }>(getResult.stdout);
    expect(parsed.data?.doc.version).toBe(1);
  });

  it("BOUNDARY: an empty --reason is rejected", async () => {
    const dir = freshDir("lore-issue-closure-4-boundary-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Filed defect G");
    store.close();

    const result = await runLore(["issue", "resolve", issue.slug, "--state", "wontfix", "--reason", ""], dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("reason");
  });

  it("ERROR: a nonexistent issue id exits non-zero", async () => {
    const dir = freshDir("lore-issue-closure-4-doc-not-found-");
    await initCorpus(dir);

    const result = await runLore(
      ["issue", "resolve", "task-does-not-exist", "--state", "wontfix", "--reason", "n/a"],
      dir,
    );
    expect(result.exitCode).not.toBe(0);
  });

  it("STATE: an explicit terminal state WINS over a resolves-edge computation that would otherwise be 'fixed'", async () => {
    const dir = freshDir("lore-issue-closure-4-state-precedence-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Filed defect H");
    const fixer = await seedPlainTask(cs, "Fixer for H");
    await transitionToActive(cs, fixer.id); // active source -> would compute "fixed" absent the explicit state
    store.close();

    const linkResult = await runLore(["link", fixer.slug, issue.slug, "--type", "resolves"], dir);
    expect(linkResult.exitCode).toBe(0);

    const resolveResult = await runLore(
      ["issue", "resolve", issue.slug, "--state", "wontfix", "--reason", "explicit wins"],
      dir,
    );
    expect(resolveResult.exitCode).toBe(0);

    const issuesResult = await runLore(["issues", "--all", "--json"], dir);
    expect(issuesResult.exitCode).toBe(0);
    const parsed = parseJson<{ reports: IssueRow[] }>(issuesResult.stdout);
    const row = parsed.data?.reports.find((r) => r.slug === issue.slug);
    expect(row).toBeDefined();
    expect(row?.resolution).toBe("wontfix");
  });

  it("REGRESSION: resolving does not clobber sibling extra fields (issue_report's other fields, extra.adhoc)", async () => {
    const dir = freshDir("lore-issue-closure-4-regression-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(
      cs,
      "Filed defect I",
      defaultIssueReport({ possible_duplicates: ["task-dup-1", "task-dup-2"] }),
    );
    store.close();

    const result = await runLore(
      ["issue", "resolve", issue.slug, "--state", "wontfix", "--reason", "not a bug", "--json"],
      dir,
    );
    expect(result.exitCode).toBe(0);
    const parsed = parseJson<{ doc: DocRecord }>(result.stdout);
    const doc = parsed.data?.doc as DocRecord;
    expect(doc.extra["adhoc"]).toBe(true);
    const issueReport = doc.extra["issue_report"] as Record<string, unknown>;
    expect(issueReport["reporter_project"]).toBe("consumer-a");
    expect(issueReport["reporter_actor"]).toBe("agent:consumer");
    expect(issueReport["lore_version"]).toBe("0.5.0");
    expect(issueReport["expected"]).toBe("exit 0");
    expect(issueReport["actual"]).toBe("exit 4");
    expect(issueReport["possible_duplicates"]).toEqual(["task-dup-1", "task-dup-2"]);
  });
});

// ─── AC-ICL-5: lore issues --json listing + computed resolution ────────────

describe("AC-ICL-5: lore issues --json lists exactly issue-report-carrying tasks with computed resolution", () => {
  it("HAPPY: --all lists exactly the 3 issue tasks with correct resolutions, excludes a plain task entirely", async () => {
    const dir = freshDir("lore-issue-closure-5-happy-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);

    const issueOpen = await seedIssueTask(cs, "Open issue");
    const issueResolving = await seedIssueTask(cs, "Resolving issue");
    const issueFixed = await seedIssueTask(cs, "Fixed issue");
    const fixerDraft = await seedPlainTask(cs, "Fixer (still draft)");
    const fixerActive = await seedPlainTask(cs, "Fixer (active)");
    await transitionToActive(cs, fixerActive.id);
    const plain = await seedPlainTask(cs, "Totally unrelated plain task");
    store.close();

    const linkResolving = await runLore(
      ["link", fixerDraft.slug, issueResolving.slug, "--type", "resolves"],
      dir,
    );
    expect(linkResolving.exitCode).toBe(0);
    const linkFixed = await runLore(["link", fixerActive.slug, issueFixed.slug, "--type", "resolves"], dir);
    expect(linkFixed.exitCode).toBe(0);

    const result = await runLore(["issues", "--all", "--json"], dir);
    expect(result.exitCode).toBe(0);
    const parsed = parseJson<{ total: number; reports: IssueRow[] }>(result.stdout);
    expect(parsed.data?.total).toBe(3);
    expect(parsed.data?.reports.length).toBe(3);

    const bySlug = new Map(parsed.data?.reports.map((r) => [r.slug, r]));
    expect(bySlug.get(issueOpen.slug)?.resolution).toBe("open");
    expect(bySlug.get(issueResolving.slug)?.resolution).toBe("resolving");
    expect(bySlug.get(issueFixed.slug)?.resolution).toBe("fixed");
    expect(bySlug.has(plain.slug)).toBe(false);

    // D4's named columns are all present and well-formed.
    const openRow = bySlug.get(issueOpen.slug) as IssueRow;
    expect(openRow.title).toBe("Open issue");
    expect(openRow.reporter_project).toBe("consumer-a");
    expect(openRow.reported_at.length).toBeGreaterThan(0);
    expect(openRow.age).toMatch(/ago$/);
  });

  it("BOUNDARY: default (--open) excludes fixed/rejected/wontfix but includes open+resolving", async () => {
    const dir = freshDir("lore-issue-closure-5-boundary-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issueOpen = await seedIssueTask(cs, "Open issue 2");
    const issueResolving = await seedIssueTask(cs, "Resolving issue 2");
    const issueFixed = await seedIssueTask(cs, "Fixed issue 2");
    const fixerDraft = await seedPlainTask(cs, "Fixer draft 2");
    const fixerActive = await seedPlainTask(cs, "Fixer active 2");
    await transitionToActive(cs, fixerActive.id);
    store.close();

    expect((await runLore(["link", fixerDraft.slug, issueResolving.slug, "--type", "resolves"], dir)).exitCode).toBe(0);
    expect((await runLore(["link", fixerActive.slug, issueFixed.slug, "--type", "resolves"], dir)).exitCode).toBe(0);
    expect(
      (await runLore(["issue", "resolve", issueFixed.slug, "--state", "wontfix", "--reason", "n/a"], dir)).exitCode,
    ).toBe(0);
    // reason: issueFixed is now explicitly "wontfix" (still terminal, just a
    // different one of the 3 excluded states) — this simultaneously proves
    // the resolves-edge fixture materialized (a subsequent --all check below
    // would show "wontfix" not "fixed", consistent with AC-ICL-4's
    // precedence) and gives --open a genuine terminal row to exclude even
    // without relying on the "fixed" pathway specifically.

    const defaultResult = await runLore(["issues", "--json"], dir);
    expect(defaultResult.exitCode).toBe(0);
    const explicitOpenResult = await runLore(["issues", "--open", "--json"], dir);
    expect(explicitOpenResult.exitCode).toBe(0);

    // No-flag default matches --open exactly (REGRESSION half of this case).
    expect(defaultResult.stdout).toBe(explicitOpenResult.stdout);

    const parsed = parseJson<{ reports: IssueRow[] }>(defaultResult.stdout);
    const slugs = new Set(parsed.data?.reports.map((r) => r.slug));
    expect(slugs.has(issueOpen.slug)).toBe(true);
    expect(slugs.has(issueResolving.slug)).toBe(true);
    expect(slugs.has(issueFixed.slug)).toBe(false);
    expect(parsed.data?.reports.length).toBe(2);
  });

  it("ERROR: a corpus with zero issue reports yields an empty list and exit 0", async () => {
    const dir = freshDir("lore-issue-closure-5-empty-");
    await initCorpus(dir);

    const result = await runLore(["issues", "--all", "--json"], dir);
    expect(result.exitCode).toBe(0);
    const parsed = parseJson<{ total: number; reports: IssueRow[] }>(result.stdout);
    expect(parsed.data?.total).toBe(0);
    expect(parsed.data?.reports).toEqual([]);
  });

  it("STATE: resolving an open report transitions it out of --open and into --resolved", async () => {
    const dir = freshDir("lore-issue-closure-5-state-transition-");
    await initCorpus(dir);

    const store = actedStore(new SQLiteStore(dbPathFor(dir)));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Transitioning issue");
    store.close();

    const beforeOpen = await runLore(["issues", "--open", "--json"], dir);
    const beforeParsed = parseJson<{ reports: IssueRow[] }>(beforeOpen.stdout);
    expect(beforeParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(true);

    const beforeResolved = await runLore(["issues", "--resolved", "--json"], dir);
    const beforeResolvedParsed = parseJson<{ reports: IssueRow[] }>(beforeResolved.stdout);
    expect(beforeResolvedParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(false);

    const resolveResult = await runLore(
      ["issue", "resolve", issue.slug, "--state", "rejected", "--reason", "not reproducible"],
      dir,
    );
    expect(resolveResult.exitCode).toBe(0);

    const afterOpen = await runLore(["issues", "--open", "--json"], dir);
    const afterOpenParsed = parseJson<{ reports: IssueRow[] }>(afterOpen.stdout);
    expect(afterOpenParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(false);

    const afterResolved = await runLore(["issues", "--resolved", "--json"], dir);
    const afterResolvedParsed = parseJson<{ reports: IssueRow[] }>(afterResolved.stdout);
    expect(afterResolvedParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(true);
  });

  it("REGRESSION: passing more than one of --open/--resolved/--all is a usage error (exit 2)", async () => {
    const dir = freshDir("lore-issue-closure-5-mutex-");
    await initCorpus(dir);

    const result = await runLore(["issues", "--open", "--all"], dir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("mutually exclusive");
  });
});
