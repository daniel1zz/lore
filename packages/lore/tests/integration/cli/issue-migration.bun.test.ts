/**
 * @spec_ref spec-the-defect-channel-reaches-no-machine-but-its-own-github AC-GI-11
 *
 * RED integration test (task-skill-test-migration-integrity-and-dry-run-red-
 * scenarios). The capability under test — a migration entry point at
 * `scripts/migrate-issue-reports.ts` that create-then-PATCHes the 12
 * already-filed reports into GitHub — DOES NOT EXIST YET (paired implement
 * task: task-skill-implement-migrate-the-12-filed-reports-with-a). This file
 * is written from the spec's own Migration Plan P3, Risk PR-5, and the paired
 * task's own AC text, not from reading an implementation that is absent by
 * design at RED time.
 *
 * ── This file defines the CONTRACT the paired implement task must satisfy ──
 * `scripts/migrate-issue-reports.ts` is expected to export exactly the shapes
 * declared below as local types (`MigrationCandidate`, `RunMigrationOptions`,
 * `DryRunPlan`, `MigrationRunResult`, `ReconciliationEntry`) and a function
 * `runMigration(options): Promise<DryRunPlan | MigrationRunResult>`. Because
 * `scripts/**` lives OUTSIDE `packages/lore/tsconfig.tests.json`'s `rootDir`
 * ("."), a STATIC `import … from "…/scripts/migrate-issue-reports.js"` would
 * pull that file (and its own import graph) into this tsconfig's program and
 * fail `bun run typecheck` with TS6059 ("File is not under rootDir") the
 * moment the file starts to exist — the exact constraint already documented
 * and worked around in `packages/lore/tests/unit/scripts/changed-tests-cli
 * .bun.test.ts`. So this file uses that SAME worked-around shape: a
 * **dynamic** `import()` with a runtime-computed (`pathToFileURL`, non-
 * literal) specifier, resolved once per describe block's own `beforeAll`.
 *
 * ── Never touches this repo's own `.lore/` corpus ──
 * Every fixture is a throwaway `mkdtempSync` directory under `os.tmpdir()`,
 * asserted (`assertUnderTmp`) to live there, with its own `createApp(dbPath)`
 * (SQLiteStore auto-runs its migrations on a fresh file — no `lore init` CLI
 * spawn needed, mirroring `pending-judgment-badges.bun.test.ts`'s idiom).
 * `report-issue`'s CURRENT SQLite-upstream filing path (`feedback.upstream
 * .corpus_path`) is a SEPARATE, being-retired transport (this same plan's P4)
 * — this file deliberately does NOT go through it; already-filed reports are
 * seeded directly via `app.corpusService.create({type:"task", …})`, which is
 * how a "already exists in the corpus" precondition is honestly modelled
 * without depending on a filing path mid-rewrite by sibling tasks (T8–T13).
 *
 * ── Target discipline (plan Invariant 5 / Decisions Log D-3) ──
 * `TARGET_REPO` is the one dedicated e2e repo; `FORBIDDEN_REPO` is the
 * product's own tracker and must NEVER be targeted, asserted both statically
 * and inside the one fake-GitHub double every scenario routes through. NO
 * scenario in this file makes a real network call — per the task's own
 * instruction, none of the five scenarios genuinely need one (dry-run
 * integrity, success-shape counting, front-matter equality, corpus write-
 * back, and halfway-failure reconciliation are all observable against an
 * injected `GhExecFile` double) — so `FORBIDDEN_REPO` never actually reaches
 * a call site here; the guard exists as defense-in-depth against a future
 * edit that swaps the constant carelessly.
 *
 * ── Design decision: the fake GitHub double correlates by `category`, never
 *    free-form body text ──
 * Scenario 5 needs to know WHICH created issue's follow-up PATCH call to
 * fail. Rather than assuming the migration script includes some raw marker
 * string verbatim in the free-form body (an assumption this file cannot
 * verify independently), the fake double parses the CREATED issue's own
 * front-matter block with the REAL `parseIssueBody` and matches on
 * `fields.category` — one of AC-GI-11's own six mandated equal-by-contract
 * fields, so this correlation rides on a guarantee the AC itself already
 * requires, not on a side assumption about how the free body text is built.
 *
 * ── Design decision: `MigrationCandidate.resolution` is pre-computed, not
 *    derived by this test from `resolves` edges ──
 * `computeIssueResolution` (which terminal states/edges each report needs)
 * is exercised by other ACs in this spec (AC-GI-4, AC-GI-13) and by that
 * function's own test suite. This file supplies `resolution` directly on
 * each candidate — decoupling "how do we know a report is fixed" from "what
 * does migration do once it knows", which keeps this file's fixtures to
 * plain `corpusService.create` calls with no `resolves`-edge/companion-fix-
 * doc machinery, and keeps this RED file's failure surface narrow: a red run
 * here can only mean the migration mechanics are missing/wrong, never that
 * `computeIssueResolution`'s own unrelated logic is.
 *
 * ── Design decision: the injected `GhExecFile` carries the body as a literal
 *    `key=value` argv element ──
 * `GhExecFile`'s own type (`gh-runner.ts`) is `(args, options) =>
 * Promise<{stdout, stderr}>` — there is no `stdin`/`input` channel on it at
 * all, so a `gh api … --input -` (stdin-piped JSON) shape structurally
 * cannot be exercised through this seam. The only stdin-free way to carry a
 * multi-line front-matter payload through this signature is a literal
 * `key=value` argv element (`gh api`'s own `-f`/`-F` convention), so this
 * file's fake double scans args for any element of that shape rather than
 * assuming a specific flag spelling — permissive on HOW the key arrived,
 * strict on the value being present as one argv string.
 *
 * ── RED-vs-malformed-vs-network distinguishing mechanism ──
 * Each describe block's `beforeAll` builds its own throwaway corpus fixture
 * FIRST (pure `createApp`/`corpusService.create` calls — no migration module
 * involved), and only THEN attempts the dynamic import in its own try/catch,
 * storing any failure separately from fixture-building failures. Every `it`
 * calls `assertNoRedPrecondition` first, which throws a single, explicit,
 * grep-able message naming the missing module path and the paired task slug
 * when the import failed. A fixture-building bug would instead surface as a
 * DIFFERENT `beforeAll` failure (a Zod/store error, with its own distinct
 * stack) BEFORE the import is ever attempted; a network failure is
 * structurally impossible in this file (no code path here calls a real `gh`
 * binary or touches a real socket — every GitHub interaction is the
 * in-process fake double).
 *
 * Test names embed the AC token verbatim (`AC-GI-11`) per SPEC-061's
 * matched-count discipline.
 *
 * Six-dimension coverage note: this file's scope is exactly the five
 * scenarios the task doc enumerates — HAPPY (successful 12/2 migration,
 * scenario 2), BOUNDARY (dry-run's zero-call invariant, scenario 1),
 * STATE (corpus records gaining new extra fields, scenario 4), REGRESSION
 * (front-matter field equality surviving the create call, scenario 3), and
 * ERROR (halfway create-then-PATCH failure never silently counted as
 * migrated, scenario 5).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { VENDOR_INTAKE_REPO } from "@lore/core";

import { createApp, type App } from "../../../src/app.js";
import { GhRunner, type GhExecFile } from "../../../src/service/gh-runner.js";
import { ReceiptLogV2 } from "../../../src/service/receipt-log-v2.js";
import {
  ISSUE_SEVERITIES,
  parseIssueBody,
  TERMINAL_ISSUE_RESOLUTION_MEMBERS,
  type IssueResolution,
  type IssueSeverity,
} from "@lore/core";

// ─── Paths ──────────────────────────────────────────────────────────────────

/** packages/lore/tests/integration/cli -> this worktree's root (5 levels up). */
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const TMP_ROOT = tmpdir();

/** The (not-yet-existing) migration entry point this file specifies the contract for. */
const MIGRATION_MODULE_PATH = join(REPO_ROOT, "scripts", "migrate-issue-reports.ts");
/** Runtime-computed specifier — see this file's header for why a static import is wrong here. */
const MIGRATION_MODULE_SPECIFIER = pathToFileURL(MIGRATION_MODULE_PATH).href;
/** The paired implement task — echoed into every RED-precondition failure message. */
const PAIRED_IMPLEMENT_TASK = "task-skill-implement-migrate-the-12-filed-reports-with-a";

function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

if (TMP_ROOT.startsWith(REPO_ROOT) || REPO_ROOT.startsWith(TMP_ROOT)) {
  throw new Error(
    `Refusing to run: OS tmpdir (${TMP_ROOT}) and this worktree root (${REPO_ROOT}) overlap — ` +
      `every fixture in this suite assumes they are disjoint.`,
  );
}

// ─── Target discipline (plan Invariant 5 / Decisions Log D-3) ──────────────

const TARGET_REPO: string = "daniel1zz/lore-e2e-target";
/**
 * `@lore/core`'s `VENDOR_INTAKE_REPO` — the product's own tracker. ⛔ DERIVED,
 * never a second copy of the literal: the thing this suite must never touch is
 * *by definition* the address `feedback.upstream.vendor: true` resolves to, so
 * a hand-copied duplicate here could go stale against the real intake and
 * leave this guard watching an address nothing files to. The static
 * `TARGET_REPO === FORBIDDEN_REPO` self-check below now also fails loud if the
 * constant were ever pointed at this suite's dedicated e2e target.
 */
const FORBIDDEN_REPO: string = VENDOR_INTAKE_REPO;

if (TARGET_REPO === FORBIDDEN_REPO) {
  throw new Error("TARGET_REPO must never equal FORBIDDEN_REPO (plan Invariant 5)");
}

// ─── The contract this file specifies for scripts/migrate-issue-reports.ts ─

/** One already-filed report as migration is expected to consume it. */
interface MigrationCandidate {
  /** The corpus task doc's real id (see `seedCandidates`). */
  taskId: string;
  /** Free-form text migration is expected to pass as `assembleIssueBody`'s `description` argument. */
  description: string;
  severity: IssueSeverity;
  category: string;
  tags: string[];
  reporterCorpus: string;
  reporterRootPrd: string;
  /** Pre-computed resolution (see this file's header, "Design decision" on `resolution`). */
  resolution: IssueResolution;
}

/** One report migration actually completed (create, and PATCH-to-close when terminal). */
interface MigratedReportOutcome {
  taskId: string;
  idempotencyKey: string;
  githubNumber: number;
  closed: boolean;
  stateReason?: string;
}

/** One report whose create-then-PATCH sequence did not fully complete — Risk PR-5's reconcile signal. */
interface ReconciliationEntry {
  taskId: string;
  idempotencyKey: string;
  reason: string;
}

interface DryRunPlan {
  dryRun: true;
  plannedCreations: number;
  plannedClosures: number;
}

interface MigrationRunResult {
  dryRun: false;
  migrated: MigratedReportOutcome[];
  needsReconciliation: ReconciliationEntry[];
}

interface RunMigrationOptions {
  app: App;
  candidates: readonly MigrationCandidate[];
  targetRepo: string;
  concurrency: number;
  dryRun: boolean;
  ghRunner: GhRunner;
  receiptLogPath: string;
}

interface MigrationModuleShape {
  runMigration: (options: RunMigrationOptions) => Promise<DryRunPlan | MigrationRunResult>;
}

/** Throws a single, grep-able message when the entry point does not exist yet — the RED signal this file expects. */
function assertNoRedPrecondition(importError: unknown): void {
  if (importError !== undefined) {
    throw new Error(
      `RED PRECONDITION UNMET — the migration entry point does not exist yet at ${MIGRATION_MODULE_PATH} ` +
        `(paired implement task: ${PAIRED_IMPLEMENT_TASK}). Dynamic import failed with: ${String(importError)}`,
    );
  }
}

async function tryLoadMigrationModule(): Promise<
  { ok: true; mod: MigrationModuleShape } | { ok: false; importError: unknown }
> {
  try {
    const mod = (await import(MIGRATION_MODULE_SPECIFIER)) as MigrationModuleShape;
    return { ok: true, mod };
  } catch (cause) {
    return { ok: false, importError: cause };
  }
}

// ─── Fixture builder — pure corpus mechanics, no migration module involved ──

function makeThrowawayApp(prefix: string): { app: App; root: string } {
  const root = mkdtempSync(join(TMP_ROOT, `lore-migration-${prefix}-`));
  assertUnderTmp(root);
  const loreDir = join(root, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const app = createApp(join(loreDir, "lore.db"));
  return { app, root };
}

interface CandidateSpec {
  marker: string;
  resolution: IssueResolution;
  severity: IssueSeverity;
  category: string;
  tags: string[];
}

/** Seeds one throwaway "already-filed report" task per spec, via `corpusService.create` directly. */
async function seedCandidates(
  app: App,
  planId: string,
  specs: readonly CandidateSpec[],
): Promise<MigrationCandidate[]> {
  const out: MigrationCandidate[] = [];
  for (const spec of specs) {
    const reporterCorpus = `lore-migration-fixture-${spec.marker}`;
    const reporterRootPrd = "prd-lore-migration-fixture-root";
    const description = `Synthetic already-filed report fixture (${spec.marker}) for AC-GI-11's migration RED test. Expected: fixture behaves as specified. Actual: fixture behaves as specified.`;
    const created = await app.corpusService.create({
      type: "task",
      title: `[issue-report] fixture ${spec.marker}`,
      content: description,
      parent_id: planId,
      extra: {
        plan_id: planId,
        issue_report: {
          severity: spec.severity,
          category: spec.category,
          tags: spec.tags,
          reporter_corpus: reporterCorpus,
          reporter_root_prd: reporterRootPrd,
          expected: "fixture behaves as specified",
          actual: "fixture behaves as specified",
        },
      },
    });
    if (!created.ok) {
      throw new Error(`fixture task creation failed for '${spec.marker}': ${JSON.stringify(created.error)}`);
    }
    out.push({
      taskId: created.value.id,
      description,
      severity: spec.severity,
      category: spec.category,
      tags: spec.tags,
      reporterCorpus,
      reporterRootPrd,
      resolution: spec.resolution,
    });
  }
  return out;
}

function tenOpenTwoFixedSpecs(): CandidateSpec[] {
  const open: CandidateSpec[] = Array.from({ length: 10 }, (_, i) => ({
    marker: `open-${i}`,
    resolution: "open" as IssueResolution,
    severity: ISSUE_SEVERITIES[i % ISSUE_SEVERITIES.length] as IssueSeverity,
    category: `cat-open-${i}`,
    tags: [`tag-open-${i}`, "regression"],
  }));
  const fixed: CandidateSpec[] = [
    { marker: "fixed-0", resolution: "fixed" as IssueResolution, severity: "critical", category: "cat-fixed-0", tags: ["fixed", "tag-a"] },
    { marker: "fixed-1", resolution: "fixed" as IssueResolution, severity: "high", category: "cat-fixed-1", tags: ["fixed", "tag-b"] },
  ];
  return [...open, ...fixed];
}

// ─── Fake GitHub double — every scenario routes through this, never the network ─

interface FakeGithubIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  stateReason?: string;
  /** Parsed front-matter `category`, used ONLY by this fake for scenario-5 correlation. */
  category?: string;
}

interface RecordedGhCall {
  args: readonly string[];
}

interface FakeGhOptions {
  targetRepo: string;
  /** When true, EVERY call throws — proves dry-run makes zero calls (scenario 1). */
  poisonAll?: boolean;
  /** The `category` value whose issue's follow-up PATCH must fail (scenario 5). */
  failPatchForCategory?: string;
}

interface FakeGh {
  execFile: GhExecFile;
  calls: RecordedGhCall[];
  issuesByNumber: Map<number, FakeGithubIssue>;
}

/** Any argv element shaped `repos/<owner>/<repo>/issues[/<number>]` — gh api's own REST path convention. */
function extractIssuesPath(args: readonly string[]): { repoPath: string; number?: number } | undefined {
  const re = /^\/?repos\/([^/]+\/[^/]+)\/issues(?:\/(\d+))?$/;
  for (const arg of args) {
    const m = re.exec(arg);
    if (m) {
      const repoPath = m[1] as string;
      const numStr = m[2];
      return numStr !== undefined ? { repoPath, number: Number(numStr) } : { repoPath };
    }
  }
  return undefined;
}

/** `-X <METHOD>` / `--method <METHOD>` / `--method=<METHOD>`, tolerant of spacing style. */
function extractMethod(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "-X" || a === "--method") {
      const v = args[i + 1];
      if (v !== undefined) return v.toUpperCase();
    }
    if (a.startsWith("--method=")) return a.slice("--method=".length).toUpperCase();
  }
  return undefined;
}

/** Any argv element shaped `<key>=<value>` — gh api's own `-f`/`-F` field convention (see this file's header). */
function extractGhApiField(args: readonly string[], key: string): string | undefined {
  const prefix = `${key}=`;
  for (const a of args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

/** Every mutating shape the task text names, checked structurally — used as an EXTRA assertion beyond the call-count check. */
function isMutatingGhCall(args: readonly string[]): boolean {
  const method = extractMethod(args);
  if (method !== undefined && ["POST", "PATCH", "PUT", "DELETE"].includes(method)) return true;
  if (args[0] === "issue" && (args[1] === "create" || args[1] === "close")) return true;
  return false;
}

function createFakeGh(opts: FakeGhOptions): FakeGh {
  const calls: RecordedGhCall[] = [];
  const issuesByNumber = new Map<number, FakeGithubIssue>();
  let nextNumber = 9000;

  const execFile: GhExecFile = async (args) => {
    calls.push({ args: [...args] });

    if (opts.poisonAll === true) {
      throw new Error(
        `FAKE GH POISON: dry-run must perform ZERO network writes, but a call was attempted: ${JSON.stringify(args)}`,
      );
    }

    const path = extractIssuesPath(args);
    if (path === undefined) {
      throw new Error(`FAKE GH: call carries no recognizable repos/.../issues path: ${JSON.stringify(args)}`);
    }
    if (path.repoPath === FORBIDDEN_REPO) {
      throw new Error(
        `FAKE GH: refusing to simulate a call against ${FORBIDDEN_REPO} — plan Invariant 5 forbids ever ` +
          `targeting the product's own tracker, even inside a fake`,
      );
    }
    if (path.repoPath !== opts.targetRepo) {
      throw new Error(
        `FAKE GH: refusing a call targeting '${path.repoPath}', expected the dedicated target '${opts.targetRepo}'`,
      );
    }

    const method = extractMethod(args) ?? "GET";

    if (method === "POST" && path.number === undefined) {
      const title = extractGhApiField(args, "title") ?? "";
      const body = extractGhApiField(args, "body") ?? "";
      const number = nextNumber++;
      let category: string | undefined;
      try {
        const parsed = parseIssueBody(body);
        if (parsed.present) category = parsed.fields.category;
      } catch {
        // reason: a malformed front-matter block is a DIFFERENT, more specific
        // failure this fake does not diagnose itself — scenario 3's own
        // parseIssueBody assertion on this exact body text surfaces it.
      }
      const issue: FakeGithubIssue =
        category !== undefined ? { number, title, body, state: "open", category } : { number, title, body, state: "open" };
      issuesByNumber.set(number, issue);
      return {
        stdout: JSON.stringify({ number, html_url: `https://github.com/${opts.targetRepo}/issues/${number}`, state: "open" }),
        stderr: "",
      };
    }

    if (method === "PATCH" && path.number !== undefined) {
      const issue = issuesByNumber.get(path.number);
      if (issue === undefined) {
        throw new Error(`FAKE GH: PATCH targets unknown issue #${path.number}`);
      }
      if (opts.failPatchForCategory !== undefined && issue.category === opts.failPatchForCategory) {
        throw new Error(
          `FAKE GH: simulated network failure PATCHing issue #${path.number} (halfway-failure scenario, AC-GI-11 scenario 5)`,
        );
      }
      const newState = extractGhApiField(args, "state");
      const newStateReason = extractGhApiField(args, "state_reason");
      if (newState === "open" || newState === "closed") issue.state = newState;
      if (newStateReason !== undefined) issue.stateReason = newStateReason;
      return { stdout: JSON.stringify(issue), stderr: "" };
    }

    throw new Error(
      `FAKE GH: unrecognized call shape (method=${method}, number=${String(path.number)}): ${JSON.stringify(args)}`,
    );
  };

  return { execFile, calls, issuesByNumber };
}

// ─── Cleanup tracking ───────────────────────────────────────────────────────

const appsToClose: App[] = [];
const rootsToClean: string[] = [];

afterAll(() => {
  for (const app of appsToClose) {
    try {
      app.close();
    } catch {
      // reason: best-effort cleanup only.
    }
  }
  for (const root of rootsToClean) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup only.
    }
  }
});

// ─── Scenario 1: dry-run performs ZERO network writes ──────────────────────

describe("AC-GI-11 scenario 1: dry-run performs ZERO network writes", () => {
  let root: string;
  let receiptLogPath: string;
  let fakeGh: FakeGh;
  let result: DryRunPlan | MigrationRunResult | undefined;
  let importError: unknown;

  beforeAll(async () => {
    const built = makeThrowawayApp("dryrun");
    appsToClose.push(built.app);
    rootsToClean.push(built.root);
    root = built.root;

    const plan = await built.app.corpusService.create({ type: "plan", title: "AC-GI-11 dry-run fixture plan" });
    if (!plan.ok) throw new Error(`plan fixture failed: ${JSON.stringify(plan.error)}`);

    const candidates = await seedCandidates(built.app, plan.value.id, tenOpenTwoFixedSpecs());
    expect(candidates.length).toBe(12); // fixture sanity — proves seeding itself is not broken

    fakeGh = createFakeGh({ targetRepo: TARGET_REPO, poisonAll: true });
    receiptLogPath = join(root, "dryrun-receipts.jsonl");

    const loaded = await tryLoadMigrationModule();
    if (!loaded.ok) {
      importError = loaded.importError;
      return;
    }

    result = await loaded.mod.runMigration({
      app: built.app,
      candidates,
      targetRepo: TARGET_REPO,
      concurrency: 4,
      dryRun: true,
      ghRunner: new GhRunner({ execFile: fakeGh.execFile }),
      receiptLogPath,
    });
  }, 30_000);

  it("AC-GI-11 scenario 1: reports 12 planned creations and 2 planned closures, with zero gh calls of any kind", () => {
    assertNoRedPrecondition(importError);
    expect(result).toBeDefined();
    const plan = result as DryRunPlan;
    expect(plan.dryRun).toBe(true);
    expect(plan.plannedCreations).toBe(12);
    expect(plan.plannedClosures).toBe(2);
    expect(fakeGh.calls.length).toBe(0);
    expect(fakeGh.calls.some((c) => isMutatingGhCall(c.args))).toBe(false);
  });

  it("AC-GI-11 scenario 1: dry-run writes no local receipt log either (nothing was actually attempted)", () => {
    assertNoRedPrecondition(importError);
    expect(existsSync(receiptLogPath)).toBe(false);
  });
});

// ─── Scenarios 2-4: a successful migration ─────────────────────────────────

describe("AC-GI-11 scenarios 2-4: a successful migration lands 12 issues (2 closed), front matter equal, corpus updated", () => {
  let app: App;
  let root: string;
  let receiptLogPath: string;
  let fakeGh: FakeGh;
  let candidates: MigrationCandidate[];
  let result: DryRunPlan | MigrationRunResult | undefined;
  let importError: unknown;

  beforeAll(async () => {
    const built = makeThrowawayApp("success");
    appsToClose.push(built.app);
    rootsToClean.push(built.root);
    app = built.app;
    root = built.root;

    const plan = await app.corpusService.create({ type: "plan", title: "AC-GI-11 success fixture plan" });
    if (!plan.ok) throw new Error(`plan fixture failed: ${JSON.stringify(plan.error)}`);

    candidates = await seedCandidates(app, plan.value.id, tenOpenTwoFixedSpecs());
    expect(candidates.length).toBe(12); // fixture sanity

    fakeGh = createFakeGh({ targetRepo: TARGET_REPO });
    receiptLogPath = join(root, "success-receipts.jsonl");

    const loaded = await tryLoadMigrationModule();
    if (!loaded.ok) {
      importError = loaded.importError;
      return;
    }

    result = await loaded.mod.runMigration({
      app,
      candidates,
      targetRepo: TARGET_REPO,
      concurrency: 4,
      dryRun: false,
      ghRunner: new GhRunner({ execFile: fakeGh.execFile }),
      receiptLogPath,
    });
  }, 30_000);

  it("AC-GI-11 scenario 2: exactly 12 issues created, exactly 2 closed with a state_reason, no wasted calls", () => {
    assertNoRedPrecondition(importError);
    expect(TERMINAL_ISSUE_RESOLUTION_MEMBERS.includes("fixed")).toBe(true); // grounding: "fixed" is the real vocabulary, not a made-up string

    const r = result as MigrationRunResult;
    expect(r.dryRun).toBe(false);
    expect(r.migrated.length).toBe(12);

    const closed = r.migrated.filter((m) => m.closed);
    expect(closed.length).toBe(2);
    for (const c of closed) {
      expect(typeof c.stateReason).toBe("string");
      expect((c.stateReason as string).length).toBeGreaterThan(0);
    }

    expect(fakeGh.issuesByNumber.size).toBe(12);
    const closedInFake = [...fakeGh.issuesByNumber.values()].filter((iss) => iss.state === "closed");
    expect(closedInFake.length).toBe(2);

    // 10 open candidates need only a create call; the 2 fixed ones need create+PATCH.
    // Any MORE than 14 calls is a wasted/duplicate write; any fewer means something
    // didn't happen. Exact equality, not merely "some calls happened".
    expect(fakeGh.calls.length).toBe(14);

    // Receipt log: every migrated report has a PAIRED intent+outcome (never intent-only).
    const read = new ReceiptLogV2(receiptLogPath).read();
    expect(read.ok).toBe(true);
    if (read.ok) {
      const intentKeys = new Set(
        read.value.entries
          .filter((e): e is { phase: "intent"; idempotency_key: string; title: string; at: string } => "phase" in e && e.phase === "intent")
          .map((e) => e.idempotency_key),
      );
      const outcomeKeys = new Set(
        read.value.entries
          .filter((e): e is { phase: "outcome"; idempotency_key: string; number: number; url: string; at: string } => "phase" in e && e.phase === "outcome")
          .map((e) => e.idempotency_key),
      );
      for (const m of r.migrated) {
        expect(intentKeys.has(m.idempotencyKey), `no intent line for migrated report ${m.taskId}`).toBe(true);
        expect(outcomeKeys.has(m.idempotencyKey), `no outcome line for migrated report ${m.taskId}`).toBe(true);
      }
    }
  });

  it("AC-GI-11 scenario 3: each migrated issue's front matter equals its corpus source, field by field", () => {
    assertNoRedPrecondition(importError);
    const r = result as MigrationRunResult;

    for (const candidate of candidates) {
      const outcome = r.migrated.find((m) => m.taskId === candidate.taskId);
      expect(outcome, `no migrated outcome for candidate ${candidate.taskId}`).toBeDefined();
      const o = outcome as MigratedReportOutcome;

      const issue = fakeGh.issuesByNumber.get(o.githubNumber);
      expect(issue, `fake GH has no issue #${o.githubNumber}`).toBeDefined();
      const body = (issue as FakeGithubIssue).body;

      const parsed = parseIssueBody(body);
      expect(parsed.present, `issue #${o.githubNumber} body carries no front-matter block:\n${body}`).toBe(true);
      if (!parsed.present) continue;

      expect(parsed.fields.severity).toBe(candidate.severity);
      expect(parsed.fields.category).toBe(candidate.category);
      expect(parsed.fields.tags).toEqual(candidate.tags);
      expect(parsed.fields.reporter_corpus).toBe(candidate.reporterCorpus);
      expect(parsed.fields.reporter_root_prd).toBe(candidate.reporterRootPrd);
      expect(parsed.fields.idempotency_key).toBe(o.idempotencyKey);
    }
  });

  it("AC-GI-11 scenario 4: each migrated corpus record gains extra.issue_report.github + idempotency_key, prior fields intact", async () => {
    assertNoRedPrecondition(importError);
    const r = result as MigrationRunResult;

    for (const candidate of candidates) {
      const outcome = r.migrated.find((m) => m.taskId === candidate.taskId);
      expect(outcome, `no migrated outcome for candidate ${candidate.taskId}`).toBeDefined();
      const o = outcome as MigratedReportOutcome;

      const got = await app.corpusService.get(candidate.taskId);
      expect(got.ok, `failed to read back task ${candidate.taskId} after migration`).toBe(true);
      if (!got.ok) continue;

      const issueReport = (got.value.doc.extra as Record<string, unknown>)["issue_report"] as
        | Record<string, unknown>
        | undefined;
      expect(issueReport, `extra.issue_report missing on ${candidate.taskId} after migration`).toBeDefined();
      if (issueReport === undefined) continue;

      // Prior fields survive the read-modify-write merge — a wholesale `extra`
      // replace (CLAUDE.md's "改共享字段前先读回现值" warning) would wipe these.
      expect(issueReport["severity"]).toBe(candidate.severity);
      expect(issueReport["category"]).toBe(candidate.category);
      expect(issueReport["tags"]).toEqual(candidate.tags);

      const github = issueReport["github"] as { repo?: string; number?: number } | undefined;
      expect(github, `extra.issue_report.github missing on ${candidate.taskId}`).toBeDefined();
      expect(github?.repo).toBe(TARGET_REPO);
      expect(github?.number).toBe(o.githubNumber);

      expect(typeof issueReport["idempotency_key"]).toBe("string");
      expect((issueReport["idempotency_key"] as string).length).toBeGreaterThan(0);
      expect(issueReport["idempotency_key"]).toBe(o.idempotencyKey);
    }
  });
});

// ─── Scenario 5: halfway create-then-PATCH failure (Risk PR-5) ─────────────

describe("AC-GI-11 scenario 5: a failure between create and PATCH is reconciliation-flagged, never silently counted as migrated", () => {
  let app: App;
  let root: string;
  let receiptLogPath: string;
  let fakeGh: FakeGh;
  let candidates: MigrationCandidate[];
  let result: DryRunPlan | MigrationRunResult | undefined;
  let importError: unknown;

  const SURVIVOR_CATEGORY = "cat-halfway-survivor";
  const FAILING_CATEGORY = "cat-halfway-induced-failure";

  beforeAll(async () => {
    const built = makeThrowawayApp("halfway");
    appsToClose.push(built.app);
    rootsToClean.push(built.root);
    app = built.app;
    root = built.root;

    const plan = await app.corpusService.create({ type: "plan", title: "AC-GI-11 halfway-failure fixture plan" });
    if (!plan.ok) throw new Error(`plan fixture failed: ${JSON.stringify(plan.error)}`);

    const specs: CandidateSpec[] = [
      { marker: "survivor", resolution: "open", severity: "low", category: SURVIVOR_CATEGORY, tags: ["survivor"] },
      { marker: "halfway-fail", resolution: "fixed", severity: "critical", category: FAILING_CATEGORY, tags: ["halfway"] },
    ];
    candidates = await seedCandidates(app, plan.value.id, specs);
    expect(candidates.length).toBe(2); // fixture sanity

    fakeGh = createFakeGh({ targetRepo: TARGET_REPO, failPatchForCategory: FAILING_CATEGORY });
    receiptLogPath = join(root, "halfway-receipts.jsonl");

    const loaded = await tryLoadMigrationModule();
    if (!loaded.ok) {
      importError = loaded.importError;
      return;
    }

    result = await loaded.mod.runMigration({
      app,
      candidates,
      targetRepo: TARGET_REPO,
      concurrency: 1,
      dryRun: false,
      ghRunner: new GhRunner({ execFile: fakeGh.execFile }),
      receiptLogPath,
    });
  }, 30_000);

  it("AC-GI-11 scenario 5: the survivor is migrated; the halfway-failed report is NOT counted as migrated", () => {
    assertNoRedPrecondition(importError);
    const r = result as MigrationRunResult;

    const survivor = candidates.find((c) => c.category === SURVIVOR_CATEGORY) as MigrationCandidate;
    const failing = candidates.find((c) => c.category === FAILING_CATEGORY) as MigrationCandidate;

    expect(r.migrated.some((m) => m.taskId === survivor.taskId)).toBe(true);
    expect(r.migrated.some((m) => m.taskId === failing.taskId)).toBe(false);

    const reconciliationEntry = r.needsReconciliation.find((n) => n.taskId === failing.taskId);
    expect(reconciliationEntry, "the halfway-failed report must be surfaced as needing reconciliation").toBeDefined();
  });

  it("AC-GI-11 scenario 5: the receipt log shows an intent with NO matching outcome for the halfway-failed report", () => {
    assertNoRedPrecondition(importError);
    const r = result as MigrationRunResult;
    const failing = candidates.find((c) => c.category === FAILING_CATEGORY) as MigrationCandidate;
    const reconciliationEntry = r.needsReconciliation.find((n) => n.taskId === failing.taskId) as
      | ReconciliationEntry
      | undefined;
    expect(reconciliationEntry).toBeDefined();

    const read = new ReceiptLogV2(receiptLogPath).read();
    expect(read.ok).toBe(true);
    if (!read.ok || reconciliationEntry === undefined) return;

    const intentKeys = new Set(
      read.value.entries
        .filter((e): e is { phase: "intent"; idempotency_key: string; title: string; at: string } => "phase" in e && e.phase === "intent")
        .map((e) => e.idempotency_key),
    );
    const outcomeKeys = new Set(
      read.value.entries
        .filter((e): e is { phase: "outcome"; idempotency_key: string; number: number; url: string; at: string } => "phase" in e && e.phase === "outcome")
        .map((e) => e.idempotency_key),
    );

    expect(
      intentKeys.has(reconciliationEntry.idempotencyKey),
      `expected an intent line for the halfway-failed report's idempotency_key ${reconciliationEntry.idempotencyKey}`,
    ).toBe(true);
    expect(
      outcomeKeys.has(reconciliationEntry.idempotencyKey),
      `expected NO outcome line for the halfway-failed report's idempotency_key — its PATCH never completed`,
    ).toBe(false);
  });
});
