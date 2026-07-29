/**
 * Compiled-binary e2e oracle for AC-ICL-10
 * (spec-issue-closure-loop-computed-resolution-agent-reachable, §D2) — the
 * `closed` computed-resolution state: an issue task whose OWN status is
 * `archived`, with no `resolves` in-edge and no explicit terminal state,
 * computes `closed`; `lore issues --open` omits it, `--resolved` includes
 * it. Mirrors `tests/e2e/issue-closure.bun.test.ts`'s harness exactly
 * (`assertFreshBinary` guard, `mkdtempSync` throwaway corpus, `HOME` pointed
 * at the temp dir, direct-`CorpusService` seeding). Never touches this
 * repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Fixtures are seeded via DIRECT `SQLiteStore`/`CorpusService` calls (bare
 * `new CorpusService(store)` — ungated) for the SAME reason
 * `issue-closure.bun.test.ts`'s module header documents: `lore create task`
 * has no CLI path to write `extra.issue_report`, and archiving a doc has no
 * dedicated CLI verb either (`CorpusService.set({status: "archived"})` is
 * the direct-store equivalent of what a future `lore done`/`lore archive`
 * caller would do). `computeIssueResolution` itself
 * (`../../src/service/issue-resolution.js`) is CONSUMED via `issues.ts`,
 * never reimplemented here.
 *
 * Shares the SAME KNOWN GAP `issue-closure.bun.test.ts` documents (migration
 * never widened `links.link_type`'s CHECK constraint for `"resolves"`) —
 * the two precedence cases below that need a real `resolves` edge reuse
 * `widenLinkTypeCheckForResolvesTestOnly`, duplicated rather than imported
 * (test-only helper, not a production module).
 *
 * Coverage (six-dimension):
 *   HAPPY: an archived issue with no edge/no explicit state computes
 *     'closed'; excluded from --open, included in --resolved and --all.
 *   NEGATIVE: a non-archived (draft) issue with no edge stays 'open';
 *     included in --open, excluded from --resolved.
 *   BOUNDARY: precedence — an explicit terminal state on an archived issue
 *     wins over 'closed' (still 'wontfix', not 'closed').
 *   STATE: precedence — a resolves edge (terminal OR non-terminal source) on
 *     an archived issue wins over 'closed' ('fixed'/'resolving', not
 *     'closed'); AND a draft issue transitioning draft -> archived (task
 *     type's legal direct edge) moves out of --open into --resolved as
 *     'closed'.
 *   ERROR: a corpus containing only a PLAIN archived task (no
 *     extra.issue_report at all) never leaks into `lore issues` under any
 *     flag — --resolved/--all both yield an empty list, exit 0, no crash.
 *   REGRESSION: --all's total count is exactly right across a mix of
 *     open/closed issues, and the no-flag default still matches --open
 *     byte-for-byte (AC-ICL-5's existing invariant, now proven to still hold
 *     with 'closed' in the terminal set).
 *
 * @spec_ref spec-issue-closure-loop-computed-resolution-agent-reachable §D2,
 *   AC-ICL-10; task-p2-computed-closed-state-for-archived-issues-without-a.
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// same derivation as tests/e2e/issue-closure.bun.test.ts.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

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

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
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

/**
 * ⚠ TEST-ONLY workaround for the SAME known gap `issue-closure.bun.test.ts`
 * documents — widens `links.link_type`'s CHECK constraint on THIS throwaway
 * corpus's `.lore/lore.db` to accept `"resolves"`, mirroring migration-004's
 * exact table-recreate DDL shape. Deliberately does NOT touch
 * `PRAGMA user_version` — this db is discarded at test end.
 */
function widenLinkTypeCheckForResolvesTestOnly(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE IF EXISTS links_new;
      CREATE TABLE links_new (
        from_id     TEXT NOT NULL REFERENCES docs(id),
        to_id       TEXT NOT NULL REFERENCES docs(id),
        link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks','governs','resolves')),
        created_at  TEXT NOT NULL,
        created_by  TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, link_type)
      );
      INSERT INTO links_new (from_id, to_id, link_type, created_at, created_by)
        SELECT from_id, to_id, link_type, created_at, created_by FROM links;
      DROP TABLE links;
      ALTER TABLE links_new RENAME TO links;
      CREATE INDEX idx_links_from ON links(from_id);
      CREATE INDEX idx_links_to   ON links(to_id);
      CREATE INDEX idx_links_type ON links(link_type);
      COMMIT;
    `);
  } finally {
    db.close();
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
  return mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
}

function defaultIssueReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reporter_project: "consumer-a",
    reporter_actor: "agent:consumer",
    lore_version: "0.5.0",
    expected: "exit 0",
    actual: "exit 4",
    reported_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    possible_duplicates: [],
    ...overrides,
  };
}

async function seedIssueTask(
  cs: CorpusService,
  title: string,
  issueReport: Record<string, unknown> = defaultIssueReport(),
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true, issue_report: issueReport },
  } as CreateDocInput);
}

async function seedPlainTask(cs: CorpusService, title: string): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true },
  } as CreateDocInput);
}

/** `task` doc type is on `DRAFT_TO_ARCHIVED_ALLOWED_TYPES` (SPEC-002/D3 of
 * spec-lifecycle-archival-plan-close-cascade-deterministic) — a direct
 * draft -> archived transition is legal, so this needs only ONE `cs.set`
 * call (no approved/active waypoint required). */
async function archiveDoc(cs: CorpusService, docId: string): Promise<void> {
  const result = await cs.set(docId, { status: "archived" });
  if (!result.ok) {
    throw new Error(`seed archive failed: ${JSON.stringify(result.error)}`);
  }
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

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

// ─── AC-ICL-10: 'closed' state for an archived issue with no edge/no explicit state ─

describe("AC-ICL-10: archived issue with no resolves in-edge and no explicit terminal state computes 'closed'", () => {
  it("AC-ICL-10 HAPPY: an archived issue (no edge, no explicit state) computes 'closed'; excluded from --open, included in --resolved and --all", async () => {
    const dir = freshDir("lore-issue-closed-happy-");
    initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store);
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Fixed four days ago, never linked");
    await archiveDoc(cs, issue.id);
    store.close();

    const openResult = runLore(["issues", "--open", "--json"], dir);
    expect(openResult.exitCode).toBe(0);
    const openParsed = parseJson<{ reports: IssueRow[] }>(openResult.stdout);
    expect(openParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(false);

    const resolvedResult = runLore(["issues", "--resolved", "--json"], dir);
    expect(resolvedResult.exitCode).toBe(0);
    const resolvedParsed = parseJson<{ reports: IssueRow[] }>(resolvedResult.stdout);
    const row = resolvedParsed.data?.reports.find((r) => r.slug === issue.slug);
    expect(row).toBeDefined();
    expect(row?.resolution).toBe("closed");

    const allResult = runLore(["issues", "--all", "--json"], dir);
    expect(allResult.exitCode).toBe(0);
    const allParsed = parseJson<{ reports: IssueRow[] }>(allResult.stdout);
    expect(allParsed.data?.reports.find((r) => r.slug === issue.slug)?.resolution).toBe("closed");
  });

  it("AC-ICL-10 NEGATIVE: a non-archived (draft) issue with no edge stays 'open' — closed is gated on status === 'archived' specifically", async () => {
    const dir = freshDir("lore-issue-closed-negative-");
    initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store);
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Still draft, never touched");
    store.close();

    const openResult = runLore(["issues", "--open", "--json"], dir);
    const openParsed = parseJson<{ reports: IssueRow[] }>(openResult.stdout);
    const row = openParsed.data?.reports.find((r) => r.slug === issue.slug);
    expect(row).toBeDefined();
    expect(row?.resolution).toBe("open");

    const resolvedResult = runLore(["issues", "--resolved", "--json"], dir);
    const resolvedParsed = parseJson<{ reports: IssueRow[] }>(resolvedResult.stdout);
    expect(resolvedParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(false);
  });

  it("AC-ICL-10 BOUNDARY: an explicit terminal state on an archived issue WINS over 'closed'", async () => {
    const dir = freshDir("lore-issue-closed-boundary-");
    initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store);
    await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "Archived AND explicitly resolved");
    await archiveDoc(cs, issue.id);
    store.close();

    const resolveResult = runLore(
      ["issue", "resolve", issue.slug, "--state", "wontfix", "--reason", "stale, closed manually"],
      dir,
    );
    expect(resolveResult.exitCode).toBe(0);

    const allResult = runLore(["issues", "--all", "--json"], dir);
    const allParsed = parseJson<{ reports: IssueRow[] }>(allResult.stdout);
    const row = allParsed.data?.reports.find((r) => r.slug === issue.slug);
    expect(row?.resolution).toBe("wontfix");
    expect(row?.resolution).not.toBe("closed");
  });

  it("AC-ICL-10 STATE: a resolves edge on an archived issue WINS over 'closed' (both terminal 'fixed' and non-terminal 'resolving' sources), and a draft->archived transition moves an issue from --open into --resolved as 'closed'", async () => {
    const dir = freshDir("lore-issue-closed-state-");
    initCorpus(dir);
    widenLinkTypeCheckForResolvesTestOnly(dbPathFor(dir));

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store);
    await seedRootPrd(cs);

    // Precedence: resolves-edge (fixed) beats archived-doc-status (closed).
    const issueWithFixedEdge = await seedIssueTask(cs, "Archived, but has a fixed-source edge");
    await archiveDoc(cs, issueWithFixedEdge.id);
    const fixerActive = await seedPlainTask(cs, "Fixer (active)");
    await transitionToActive(cs, fixerActive.id);
    store.close();

    const linkFixed = runLore(["link", fixerActive.slug, issueWithFixedEdge.slug, "--type", "resolves"], dir);
    expect(linkFixed.exitCode).toBe(0);

    // Precedence: resolves-edge (resolving, non-terminal) ALSO beats closed.
    const store2 = new SQLiteStore(dbPathFor(dir));
    const cs2 = new CorpusService(store2);
    const issueWithResolvingEdge = await seedIssueTask(cs2, "Archived, but has a resolving-source edge");
    await archiveDoc(cs2, issueWithResolvingEdge.id);
    const fixerDraft = await seedPlainTask(cs2, "Fixer (still draft)");
    store2.close();

    const linkResolving = runLore(
      ["link", fixerDraft.slug, issueWithResolvingEdge.slug, "--type", "resolves"],
      dir,
    );
    expect(linkResolving.exitCode).toBe(0);

    const allResult = runLore(["issues", "--all", "--json"], dir);
    const allParsed = parseJson<{ reports: IssueRow[] }>(allResult.stdout);
    const bySlug = new Map(allParsed.data?.reports.map((r) => [r.slug, r]));
    expect(bySlug.get(issueWithFixedEdge.slug)?.resolution).toBe("fixed");
    expect(bySlug.get(issueWithResolvingEdge.slug)?.resolution).toBe("resolving");

    // Draft -> archived transition (no edge/explicit state) moves an issue
    // out of --open and into --resolved as 'closed'.
    const store3 = new SQLiteStore(dbPathFor(dir));
    const cs3 = new CorpusService(store3);
    const transitioning = await seedIssueTask(cs3, "Transitioning to closed");
    store3.close();

    const beforeOpen = runLore(["issues", "--open", "--json"], dir);
    const beforeParsed = parseJson<{ reports: IssueRow[] }>(beforeOpen.stdout);
    expect(beforeParsed.data?.reports.some((r) => r.slug === transitioning.slug)).toBe(true);

    const store4 = new SQLiteStore(dbPathFor(dir));
    const cs4 = new CorpusService(store4);
    await archiveDoc(cs4, transitioning.id);
    store4.close();

    const afterOpen = runLore(["issues", "--open", "--json"], dir);
    const afterOpenParsed = parseJson<{ reports: IssueRow[] }>(afterOpen.stdout);
    expect(afterOpenParsed.data?.reports.some((r) => r.slug === transitioning.slug)).toBe(false);

    const afterResolved = runLore(["issues", "--resolved", "--json"], dir);
    const afterResolvedParsed = parseJson<{ reports: IssueRow[] }>(afterResolved.stdout);
    const afterRow = afterResolvedParsed.data?.reports.find((r) => r.slug === transitioning.slug);
    expect(afterRow?.resolution).toBe("closed");
  });

  it("AC-ICL-10 ERROR: a corpus with only a PLAIN archived task (no extra.issue_report) never leaks into lore issues under any flag — empty lists, exit 0, no crash", async () => {
    const dir = freshDir("lore-issue-closed-error-");
    initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store);
    await seedRootPrd(cs);
    const plain = await seedPlainTask(cs, "Ordinary archived task, not a report");
    await archiveDoc(cs, plain.id);
    store.close();

    const resolvedResult = runLore(["issues", "--resolved", "--json"], dir);
    expect(resolvedResult.exitCode).toBe(0);
    const resolvedParsed = parseJson<{ total: number; reports: IssueRow[] }>(resolvedResult.stdout);
    expect(resolvedParsed.data?.total).toBe(0);
    expect(resolvedParsed.data?.reports).toEqual([]);

    const allResult = runLore(["issues", "--all", "--json"], dir);
    expect(allResult.exitCode).toBe(0);
    const allParsed = parseJson<{ total: number; reports: IssueRow[] }>(allResult.stdout);
    expect(allParsed.data?.total).toBe(0);
    expect(allParsed.data?.reports).toEqual([]);
  });

  it("AC-ICL-10 REGRESSION: --all's total count is exact across a mix of open/closed issues, and the no-flag default still matches --open byte-for-byte", async () => {
    const dir = freshDir("lore-issue-closed-regression-");
    initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store);
    await seedRootPrd(cs);
    const openIssue = await seedIssueTask(cs, "Still open");
    const closedIssue = await seedIssueTask(cs, "Long since archived");
    await archiveDoc(cs, closedIssue.id);
    store.close();

    const allResult = runLore(["issues", "--all", "--json"], dir);
    expect(allResult.exitCode).toBe(0);
    const allParsed = parseJson<{ total: number; reports: IssueRow[] }>(allResult.stdout);
    expect(allParsed.data?.total).toBe(2);
    const bySlug = new Map(allParsed.data?.reports.map((r) => [r.slug, r]));
    expect(bySlug.get(openIssue.slug)?.resolution).toBe("open");
    expect(bySlug.get(closedIssue.slug)?.resolution).toBe("closed");

    const defaultResult = runLore(["issues", "--json"], dir);
    const explicitOpenResult = runLore(["issues", "--open", "--json"], dir);
    expect(defaultResult.stdout).toBe(explicitOpenResult.stdout);
    const defaultParsed = parseJson<{ reports: IssueRow[] }>(defaultResult.stdout);
    expect(defaultParsed.data?.reports.some((r) => r.slug === closedIssue.slug)).toBe(false);
    expect(defaultParsed.data?.reports.some((r) => r.slug === openIssue.slug)).toBe(true);
  });
});
