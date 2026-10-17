/**
 * AC-ICL-8 e2e suite (spec-issue-closure-loop-computed-resolution-agent-reachable,
 * §D1/§D2/§D4/§D5) — the DECISIVE end-to-end proof that the issue closure loop
 * terminates on the REAL shape: a filed issue report (a `task` carrying
 * `extra.issue_report`) plus a SEPARATE fixing doc (spec OR plan) carrying a
 * `resolves` edge to it, walked through real lifecycle transitions against a
 * REAL `SQLiteStore`-backed corpus via the COMPILED `dist/lore` binary — never
 * `InMemoryStore`, never a store-free unit layer.
 *
 * This is the layer P1's own retro (`knowledge-retro-a-green-ac-over-a-store-
 * free-layer-let-a-schema`) flags as the one that matters: P1's ACs passed at
 * a store-free (`InMemoryStore`) layer while `resolves` was fully NON-
 * FUNCTIONAL against real SQLite (the CHECK constraint was never widened).
 * That gap is now closed by migration-012 (`packages/lore/src/store/
 * migrations/migration-012.ts`) and `commands/link.ts`'s SSOT collapse onto
 * `linkTypeSchema.options` — this suite therefore needs NO test-only CHECK-
 * widening workaround (unlike its siblings `issue-closure.bun.test.ts` /
 * `issue-check.bun.test.ts` / `issue-closed-state.bun.test.ts`, all authored
 * before migration-012 landed): every `lore link --type resolves` call below
 * is the real, unmodified CLI path against a freshly-`lore init`-ed corpus,
 * and its continued success is itself part of what this suite proves.
 *
 * Fixtures mirror `issue-closure.bun.test.ts`'s established hybrid idiom:
 * direct `SQLiteStore`/`CorpusService` seeding (bare `new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)))`
 * — ungated, no `GateEnforcer`) for doc creation and lifecycle-status walks
 * (`lore create task` has no CLI path to write `extra.issue_report`; walking a
 * spec/plan through `approved`/`active`/`archived` via the CLI would engage
 * the `spec-promote`/`plan-promote` gates for no reason relevant to this
 * suite), then the COMPILED binary spawn for every verb actually under test:
 * `lore link --type resolves`, `lore issues`, `lore status --check-issues`,
 * `lore issue resolve`. Never touches this repo's own `.lore/` corpus (project
 * CLAUDE.md hard rule) — every fixture lives under `os.tmpdir()`, asserted at
 * creation.
 *
 * The "unclosed escalation" shape of `--check-issues` (computed `fixed`, issue
 * task not yet `archived`) is RETIRED by spec-archiving-the-work-that-resolves-
 * a-defect-report-closes D6: archiving the fix now closes the GitHub issue, so
 * the computed resolution plus the closed issue are the record. The STATE and
 * BOUNDARY cases below assert the retirement — a computed-`fixed` report is
 * never flagged, before or after its issue task is archived.
 *
 * Six-dimension coverage:
 *   HAPPY:      filed issue + archived spec carrying a `resolves` edge
 *               computes `fixed`; `--open` omits it, `--resolved` includes it.
 *   STATE:      `--check-issues` stays quiet (exit 0, consistent) for a
 *               computed-`fixed` report both while the issue task is not yet
 *               archived and after it is — and the row still reads `fixed`.
 *   NEGATIVE:   a `resolves` edge whose source has NOT reached a terminal
 *               status (still `draft`) computes `resolving`, never `fixed` —
 *               `--check-issues` never false-positives on a fix in flight,
 *               and the report is NOT excluded from `--open`.
 *   BOUNDARY:   D2's "active OR archived" boundary — a fixing PLAN (not just
 *               a spec) reaching ONLY `active` (never archived) already
 *               computes `fixed`, and `--check-issues` still does not flag it.
 *   ERROR:      inside a real, already-`fixed` corpus, `lore issue resolve
 *               --state fixed` (the anti-pattern this whole spec forbids) is
 *               rejected unconditionally and provably writes nothing — the
 *               issue task's version is unchanged and its computed resolution
 *               stays exactly `fixed`.
 *   REGRESSION: once archived, the issue's resolution is STILL `fixed` — it
 *               never regresses into the D2 "archived-with-no-edge -> closed"
 *               bucket (resolves-edge precedence over archived-doc-status) —
 *               and a completely unrelated, untouched issue report elsewhere
 *               in the SAME corpus is byte-identical before and after the
 *               whole link/archive sequence runs.
 *
 * @spec_ref spec-issue-closure-loop-computed-resolution-agent-reachable §D1,
 *   §D2, §D4, §D5, AC-ICL-8;
 *   task-p3-e2e-closure-proof-live-backlog-closure.
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { RecordLockService } from "../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import type { CreateDocInput, DocRecord, DocStatus } from "@lore/core";
import { approveCitedSpec } from "../helpers/live-rule-fixture.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// same derivation as tests/e2e/issue-closure.bun.test.ts.
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

interface IssuesListPayload {
  mode: string;
  total: number;
  reports: IssueRow[];
}

interface IssueCheckJson {
  checked: number;
  consistent: boolean;
  stale_open: unknown[];
}

// ─── Spawn helpers ──────────────────────────────────────────────────────────

/**
 * Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at
 * the throwaway temp repo, `CLAUDECODE=1` so the "agent" caller surface
 * (SPEC-024) resolves the AI default OFF — mirrors every other compiled-
 * binary e2e suite's `runLore` convention.
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
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

/** Full raw `docs` row for one doc id — the "mutates nothing" byte-comparison oracle's unit (mirrors `issue-check.bun.test.ts`'s `snapshotDocRow`). */
function snapshotDocRow(dir: string, id: string): unknown {
  const db = new Database(dbPathFor(dir));
  try {
    return db.query("SELECT * FROM docs WHERE id = ?").get(id);
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

async function mustSet(cs: CorpusService, id: string, status: DocStatus): Promise<void> {
  const result = await cs.set(id, { status });
  if (!result.ok) {
    throw new Error(`seed status transition to '${status}' failed for ${id}: ${JSON.stringify(result.error)}`);
  }
}

async function seedRootPrd(cs: CorpusService): Promise<DocRecord> {
  return await mustCreate(cs, { type: "prd", title: "AC-ICL-8 Root PRD", content: "# PRD" } as CreateDocInput);
}

function defaultIssueReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reporter_project: "consumer-a",
    reporter_actor: "agent:consumer",
    lore_version: "0.5.0",
    expected: "exit 0",
    actual: "exit 4",
    reported_at: new Date().toISOString(),
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

async function seedFixingSpec(cs: CorpusService, prdId: string, title: string): Promise<DocRecord> {
  return await mustCreate(cs, {
    type: "spec",
    title,
    content: "## Overview\n\nFixing doc body.",
  } as CreateDocInput);
}

async function seedFixingPlan(cs: CorpusService, prdId: string, title: string): Promise<DocRecord> {
  return await mustCreate(cs, {
    type: "plan",
    title,
    content: "## Goal\n\nFixing plan body.",
    parent_id: prdId,
  } as CreateDocInput);
}

/** Walks a doc draft -> approved -> active (both legal `VALID_TRANSITIONS` steps) — a terminal `resolves`-edge source per D2 ("active OR archived" -> fixed), WITHOUT reaching archived. */
async function walkToActive(cs: CorpusService, docId: string, store: SQLiteStore): Promise<void> {
  // BR-1007: a spec is approved only through a criterion citing a live rule; every other type walks as before.
  const got = await cs.get(docId);
  if (!got.ok) throw new Error(`seed get failed for ${docId}: ${JSON.stringify(got.error)}`);
  if (got.value.doc.type === "spec") {
    const approved = await approveCitedSpec(store, cs, docId);
    if (!approved.ok) throw new Error(`seed spec approve failed for ${docId}: ${JSON.stringify(approved.error)}`);
  } else {
    await mustSet(cs, docId, "approved");
  }
  await mustSet(cs, docId, "active");
}

/** Walks a doc all the way to `archived` via the fast-track edge (draft -> approved -> active -> archived) — valid for spec/plan per `VALID_TRANSITIONS`. */
async function walkToArchived(cs: CorpusService, docId: string, store: SQLiteStore): Promise<void> {
  await walkToActive(cs, docId, store);
  await mustSet(cs, docId, "archived");
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

// ─── AC-ICL-8: HAPPY ─────────────────────────────────────────────────────────

describe("AC-ICL-8: filed issue + archived spec resolves-edge computes fixed", () => {
  it("AC-ICL-8: HAPPY — computed resolution is fixed; --open omits it, --resolved includes it", async () => {
    const dir = freshDir("lore-icl8-happy-");
    await initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "AC-ICL-8 filed defect (happy)");
    const fixingSpec = await seedFixingSpec(cs, prd.id, "AC-ICL-8 Fixing Spec");
    await walkToArchived(cs, fixingSpec.id, store);
    store.close();

    // The real CLI path, against a real SQLite-backed corpus — no widening workaround.
    const linkResult = await runLore(["link", fixingSpec.slug, issue.slug, "--type", "resolves"], dir);
    expect(linkResult.exitCode).toBe(0);

    const allResult = await runLore(["issues", "--all", "--json"], dir);
    expect(allResult.exitCode).toBe(0);
    const allParsed = parseJson<IssuesListPayload>(allResult.stdout);
    const row = allParsed.data?.reports.find((r) => r.slug === issue.slug);
    expect(row).toBeDefined();
    expect(row?.resolution).toBe("fixed");

    const openResult = await runLore(["issues", "--open", "--json"], dir);
    expect(openResult.exitCode).toBe(0);
    const openParsed = parseJson<IssuesListPayload>(openResult.stdout);
    expect(openParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(false);

    const resolvedResult = await runLore(["issues", "--resolved", "--json"], dir);
    expect(resolvedResult.exitCode).toBe(0);
    const resolvedParsed = parseJson<IssuesListPayload>(resolvedResult.stdout);
    expect(resolvedParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(true);
  }, 30_000);
});

// ─── AC-ICL-8: STATE (the decisive 5->6 transition, both directions) ───────

describe("AC-ICL-8 (amended by D6 of spec-archiving-the-work-that-resolves-a-defect-report-closes): --check-issues never flags a computed-fixed report", () => {
  it("AC-ICL-8: STATE — quiet while the issue task is not archived AND after it is archived; resolution stays fixed", async () => {
    const dir = freshDir("lore-icl8-state-");
    await initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "AC-ICL-8 filed defect (state)");
    const fixingSpec = await seedFixingSpec(cs, prd.id, "AC-ICL-8 State Fixing Spec");
    await walkToArchived(cs, fixingSpec.id, store);
    store.close();

    const linkResult = await runLore(["link", fixingSpec.slug, issue.slug, "--type", "resolves"], dir);
    expect(linkResult.exitCode).toBe(0);

    // D6: computed `fixed` with the issue task still draft is NOT flagged any more.
    const beforeJson = await runLore(["status", "--check-issues", "--json"], dir);
    expect(beforeJson.exitCode).toBe(0);
    const beforeData = parseJson<{ issues: IssueCheckJson }>(beforeJson.stdout).data?.issues;
    expect(beforeData).toBeDefined();
    expect(beforeData!.consistent).toBe(true);
    expect(beforeData!.checked).toBe(1);
    expect(Object.keys(beforeData!).sort()).toEqual(["checked", "consistent", "stale_open"]);

    const beforeText = await runLore(["status", "--check-issues"], dir);
    expect(beforeText.exitCode).toBe(0);
    expect(beforeText.stdout).not.toContain("unclosed escalation");

    const archiveResult = await runLore(["set", issue.slug, "--status", "archived"], dir);
    expect(archiveResult.exitCode).toBe(0);

    // Archiving the issue task changes nothing about the verdict: still quiet.
    const afterJson = await runLore(["status", "--check-issues", "--json"], dir);
    expect(afterJson.exitCode).toBe(0);
    const afterData = parseJson<{ issues: IssueCheckJson }>(afterJson.stdout).data?.issues;
    expect(afterData!.consistent).toBe(true);

    // The row itself still reads "fixed" — archiving the issue task closes
    // the ESCALATION, it does not change the COMPUTED RESOLUTION.
    const resolvedResult = await runLore(["issues", "--resolved", "--json"], dir);
    expect(resolvedResult.exitCode).toBe(0);
    const resolvedParsed = parseJson<IssuesListPayload>(resolvedResult.stdout);
    const row = resolvedParsed.data?.reports.find((r) => r.slug === issue.slug);
    expect(row?.resolution).toBe("fixed");
  }, 30_000);
});

// ─── AC-ICL-8: NEGATIVE ──────────────────────────────────────────────────────

describe("AC-ICL-8: a resolves edge whose source is not yet terminal never false-positives", () => {
  it("AC-ICL-8: NEGATIVE — a draft fixing spec computes resolving, not fixed; --check-issues stays consistent; --open still includes it", async () => {
    const dir = freshDir("lore-icl8-negative-");
    await initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "AC-ICL-8 filed defect (negative)");
    // Deliberately left at `draft` — no walkToActive/walkToArchived call.
    const fixingSpec = await seedFixingSpec(cs, prd.id, "AC-ICL-8 Negative Draft Fixing Spec");
    store.close();

    const linkResult = await runLore(["link", fixingSpec.slug, issue.slug, "--type", "resolves"], dir);
    expect(linkResult.exitCode).toBe(0);

    const allResult = await runLore(["issues", "--all", "--json"], dir);
    expect(allResult.exitCode).toBe(0);
    const row = parseJson<IssuesListPayload>(allResult.stdout).data?.reports.find(
      (r) => r.slug === issue.slug,
    );
    expect(row?.resolution).toBe("resolving");

    const checkResult = await runLore(["status", "--check-issues", "--json"], dir);
    expect(checkResult.exitCode).toBe(0);
    const checkData = parseJson<{ issues: IssueCheckJson }>(checkResult.stdout).data?.issues;
    expect(checkData!.consistent).toBe(true);

    const openResult = await runLore(["issues", "--open", "--json"], dir);
    expect(openResult.exitCode).toBe(0);
    const openParsed = parseJson<IssuesListPayload>(openResult.stdout);
    expect(openParsed.data?.reports.some((r) => r.slug === issue.slug)).toBe(true);
  }, 30_000);
});

// ─── AC-ICL-8: BOUNDARY ──────────────────────────────────────────────────────

describe("AC-ICL-8: D2's active-OR-archived boundary, proven with a PLAN (not just a spec) as the fixing doc", () => {
  it("AC-ICL-8: BOUNDARY — a fixing plan reaching only active already computes fixed, and --check-issues does not flag it (D6)", async () => {
    const dir = freshDir("lore-icl8-boundary-");
    await initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "AC-ICL-8 filed defect (boundary)");
    const fixingPlan = await seedFixingPlan(cs, prd.id, "AC-ICL-8 Boundary Fixing Plan");
    await walkToActive(cs, fixingPlan.id, store); // stops at "active" -- never archived
    store.close();

    const linkResult = await runLore(["link", fixingPlan.slug, issue.slug, "--type", "resolves"], dir);
    expect(linkResult.exitCode).toBe(0);

    const allResult = await runLore(["issues", "--all", "--json"], dir);
    expect(allResult.exitCode).toBe(0);
    const row = parseJson<IssuesListPayload>(allResult.stdout).data?.reports.find(
      (r) => r.slug === issue.slug,
    );
    // "active" alone (never archived) already computes fixed -- the D2 boundary.
    expect(row?.resolution).toBe("fixed");

    const checkResult = await runLore(["status", "--check-issues", "--json"], dir);
    expect(checkResult.exitCode).toBe(0);
    const checkData = parseJson<{ issues: IssueCheckJson }>(checkResult.stdout).data?.issues;
    expect(checkData!.consistent).toBe(true);
  }, 30_000);
});

// ─── AC-ICL-8: ERROR ─────────────────────────────────────────────────────────

describe("AC-ICL-8: the hand-set anti-pattern is rejected even inside a genuinely-fixed real corpus", () => {
  it("AC-ICL-8: ERROR — lore issue resolve --state fixed is rejected unconditionally and writes nothing", async () => {
    const dir = freshDir("lore-icl8-error-");
    await initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "AC-ICL-8 filed defect (error)");
    const fixingSpec = await seedFixingSpec(cs, prd.id, "AC-ICL-8 Error Fixing Spec");
    await walkToArchived(cs, fixingSpec.id, store);
    store.close();

    const linkResult = await runLore(["link", fixingSpec.slug, issue.slug, "--type", "resolves"], dir);
    expect(linkResult.exitCode).toBe(0);

    // Sanity: the corpus really is in the "fixed" state this test means to attack.
    const beforeAll = await runLore(["issues", "--all", "--json"], dir);
    const beforeRow = parseJson<IssuesListPayload>(beforeAll.stdout).data?.reports.find(
      (r) => r.slug === issue.slug,
    );
    expect(beforeRow?.resolution).toBe("fixed");

    const resolveResult = await runLore(["issue", "resolve", issue.slug, "--state", "fixed"], dir);
    expect(resolveResult.exitCode).not.toBe(0);
    expect(resolveResult.stderr).toContain("lore link");
    expect(resolveResult.stderr).toContain("resolves");

    // Nothing was written: version unchanged, resolution still exactly "fixed".
    const getResult = await runLore(["get", issue.slug, "--json"], dir);
    expect(getResult.exitCode).toBe(0);
    const doc = parseJson<{ doc: DocRecord }>(getResult.stdout).data?.doc;
    expect(doc?.version).toBe(1);

    const afterAll = await runLore(["issues", "--all", "--json"], dir);
    const afterRow = parseJson<IssuesListPayload>(afterAll.stdout).data?.reports.find(
      (r) => r.slug === issue.slug,
    );
    expect(afterRow?.resolution).toBe("fixed");
  }, 30_000);
});

// ─── AC-ICL-8: REGRESSION ────────────────────────────────────────────────────

describe("AC-ICL-8: archived-with-a-fixed-edge never regresses to closed; an unrelated sibling report is untouched", () => {
  it("AC-ICL-8: REGRESSION — resolution stays fixed (not closed) after archival; a separate unrelated report is byte-identical throughout", async () => {
    const dir = freshDir("lore-icl8-regression-");
    await initCorpus(dir);

    const store = new SQLiteStore(dbPathFor(dir));
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await seedRootPrd(cs);
    const issue = await seedIssueTask(cs, "AC-ICL-8 filed defect (regression, fixed)");
    // A completely unrelated, never-touched issue report living in the SAME
    // corpus -- proves the link/archive sequence below never leaks onto it.
    const sibling = await seedIssueTask(cs, "AC-ICL-8 unrelated sibling report (regression)");
    const fixingSpec = await seedFixingSpec(cs, prd.id, "AC-ICL-8 Regression Fixing Spec");
    await walkToArchived(cs, fixingSpec.id, store);
    store.close();

    const siblingBefore = snapshotDocRow(dir, sibling.id);

    const linkResult = await runLore(["link", fixingSpec.slug, issue.slug, "--type", "resolves"], dir);
    expect(linkResult.exitCode).toBe(0);

    const archiveResult = await runLore(["set", issue.slug, "--status", "archived"], dir);
    expect(archiveResult.exitCode).toBe(0);

    const allResult = await runLore(["issues", "--all", "--json"], dir);
    expect(allResult.exitCode).toBe(0);
    const parsed = parseJson<IssuesListPayload>(allResult.stdout);

    const issueRow = parsed.data?.reports.find((r) => r.slug === issue.slug);
    // Archived + a resolves edge to a terminal source -> resolves-edge
    // precedence wins; MUST NOT regress to the D2 "archived-with-no-edge"
    // "closed" bucket (AC-ICL-10's own precedence rule, reproven here on the
    // real end-to-end shape).
    expect(issueRow?.resolution).toBe("fixed");

    const siblingRow = parsed.data?.reports.find((r) => r.slug === sibling.slug);
    expect(siblingRow?.resolution).toBe("open");

    const siblingAfter = snapshotDocRow(dir, sibling.id);
    expect(siblingAfter).toEqual(siblingBefore);
  }, 30_000);
});
