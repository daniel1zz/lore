// @reads packages/lore/src/**
/**
 * AC-DCL-5 — NO MODULE WRITES AROUND THE WRITE PATH (spec-no-module-writes-around-the-write-path-the-remaining-17).
 *
 * Completes AC-DCL-3 (single-write-path.bun.test.ts): the 17 modules it had pinned as exceptions — task-workflow, phase-workflow,
 * review, outline-sections-retire, drift-check, phase-checklist, plan-integration-branch, rule-change, spec-parent-migration, spec-kind, ac,
 * issue-close-on-archive, judgment, state-binding, foreign-corpus-write-guard, baseline-adopt, app.ts — now write through
 * `CorpusService` and nothing else does. This file asserts, on throwaway corpora only (mkdtemp, never the repo's `.lore/`):
 *
 *   1. STATIC SCAN, no allowance list: only `service/corpus-service.ts` and `store/*` call a store write primitive
 *      (`WRITE_PRIMITIVES`, matched by `WRITE_CALL`).
 *   2. PER MODULE, own corpus (world "own", a real SQLite store with a write context naming CALLER and RUN): the module's
 *      write lands a version row (when it bumps a version) and an audit row, every row naming the CALLER and the RUN —
 *      never the doc's author, never "system".
 *   3. PER MODULE, foreign corpus (world "foreign": a REAL linked worktree of a repo that owns the corpus, driven through
 *      `loadLoreApp`, so the corpus the write resolves is the main checkout's, provenance `git_common_dir`): the same write
 *      through the app's own composed service is refused by the foreign-corpus rule and writes nothing — which also proves
 *      `app.ts` composes the one write route into each of them.
 *   4. `assignOrdinalForRepair` is ONE transaction: a failure injected after the ordinal write leaves no ordinal change.
 *
 * Coverage: HAPPY (each module's write) / NEGATIVE (foreign refusal, nothing written) / BOUNDARY (a repeat ordinal repair
 * writes nothing) / ERROR (injected failure rolls the ordinal back) / STATE (version bump == rows, caller on every row) /
 * REGRESSION (the static scan, app wiring).
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP, NoOpTelemetry, err, ok } from "@lore/core";
import type { AuditEntry, DocRecord, DocType, LoreError, Result, VersionRecord } from "@lore/core";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { TaskWorkflowService } from "../../src/service/task-workflow-service.js";
import { PhaseWorkflowService } from "../../src/service/phase-workflow-service.js";
import { ReviewService } from "../../src/service/review-service.js";
import { OutlineSectionsRetireMigrationService } from "../../src/service/outline-sections-retire-migration-service.js";
import { DriftCheckService } from "../../src/service/drift-check-service.js";
import { PhaseChecklistService } from "../../src/service/phase-checklist-service.js";
import { PlanIntegrationBranchService } from "../../src/service/plan-integration-branch-service.js";
import { RuleChangeService } from "../../src/service/rule-change-service.js";
import { SpecParentMigrationService } from "../../src/service/spec-parent-migration-service.js";
import { SpecKindService } from "../../src/service/spec-kind-service.js";
import { AcService } from "../../src/service/ac-service.js";
import { JudgmentService } from "../../src/service/judgment-service.js";
import { StateBindingService } from "../../src/service/state-binding-service.js";
import { IssueCloseOnArchive, ISSUE_CLOSE_FAILED_AUDIT_ACTION } from "../../src/service/issue-close-on-archive.js";
import type { IssueCloser } from "../../src/service/issue-closer-port.js";
import { CorpusWriteAuthority, FOREIGN_CORPUS_WRITE_TOKEN } from "../../src/service/foreign-corpus-write-guard.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { withWriteContext } from "../../src/store/write-context-store.js";
import { createApp, buildStateBindingOccupancyPort, type App } from "../../src/app.js";
import { appendAdoptAuditRow, BASELINE_ADOPT_AUDIT_ACTION } from "../../src/adapters/cli/commands/baseline-adopt.js";
import { loadLoreApp } from "../../src/adapters/cli/loader.js";
import { actedStore, liveInvocation } from "../live-invocation.js";
import { createLiveApp } from "../helpers/live-app.js";
import { runOfName } from "../helpers/test-run-identity.js";

import { fakeWorktreeProbe } from "../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../helpers/parented-create.js";
const CALLER = "agent:dcl5-caller";
const AUTHOR = "agent:dcl5-original-author";
const RUN = "cc:dcl5-run";

const scratch: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => {
  for (const close of closers.splice(0)) close();
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

// ─── 1. static scan: no allowance list ──────────────────────────────────────

const SRC_ROOT = join(fileURLToPath(new URL("../../", import.meta.url)), "src");

/**
 * The store methods that write a document, a version row, an audit row, or a registry-owned write of one. Every
 * `*WithProvenance` method is matched by the generic `[A-Za-z]*WithProvenance` alternative as well, so a NEW composite
 * is covered without editing this list.
 */
const WRITE_PRIMITIVES = [
  "update",
  "insertVersion",
  "appendAuditEntry",
  "[A-Za-z]*WithProvenance",
  "moveRule",
  "allocateRuleAndUpdateLeaf",
  "reserveProposedRuleAndUpdateSpec",
  "assignOrdinalForRepair",
];

/** The exact call pattern: a store-named receiver (`store`, `this.store`, `rawStore`, `corpusStore`, ...) calling a primitive. */
const WRITE_CALL = new RegExp(`\\b[A-Za-z]*[sS]tore\\.(?:${WRITE_PRIMITIVES.join("|")})\\(`, "g");

/** The ONLY modules allowed to call a primitive: the one route, and the store itself. There is no other entry. */
function isWritePathModule(rel: string): boolean {
  return rel === "service/corpus-service.ts" || rel.startsWith("store/");
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Code lines only: comment-only lines (`//`, `*`, `/*`) are dropped, so a JSDoc that names a primitive never counts. */
function countWriteCalls(source: string): number {
  let count = 0;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    count += line.match(WRITE_CALL)?.length ?? 0;
  }
  return count;
}

describe("AC-DCL-5 static scan — only corpus-service.ts and store/* call a store write primitive", () => {
  it("REGRESSION: zero direct calls in every other module under packages/lore/src (no allowance list)", () => {
    const offenders: Array<[string, number]> = [];
    for (const file of walkTs(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split(sep).join("/");
      if (isWritePathModule(rel)) continue;
      const n = countWriteCalls(readFileSync(file, "utf8"));
      if (n > 0) offenders.push([rel, n]);
    }
    expect(offenders, `direct store write calls outside the write path: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  it("CONTROL: the pattern finds the route's own calls and every primitive's call shape (so the zero is not a mis-aimed regex)", () => {
    expect(countWriteCalls(readFileSync(join(SRC_ROOT, "service", "corpus-service.ts"), "utf8"))).toBeGreaterThan(0);
    for (const sample of [
      "await this.store.update(id, patch);",
      "await store.insertVersion(row);",
      "await this.store.appendAuditEntry(entry);",
      "await this.store.updateWithProvenance(a, b);",
      "await this.store.insertWithProvenance(a, b);",
      "await this.store.setDocParentWithProvenance(a, b);",
      "await this.store.assignOrdinalForRepairWithProvenance(a, b);",
      "await store.moveRule(a, b);",
      "await this.store.reserveProposedRuleAndUpdateSpec(a);",
    ]) {
      expect(countWriteCalls(sample), sample).toBe(1);
    }
    expect(countWriteCalls("// await this.store.update(a)")).toBe(0);
    expect(isWritePathModule("service/corpus-service.ts")).toBe(true);
    expect(isWritePathModule("store/sqlite-store.ts")).toBe(true);
    expect(isWritePathModule("service/review-service.ts")).toBe(false);
    expect(isWritePathModule("app.ts")).toBe(false);
  });

  it("REGRESSION: app.ts composes corpusService into each of the migrated services in BOTH composition roots", () => {
    const app = readFileSync(join(SRC_ROOT, "app.ts"), "utf8");
    const wired: Array<[string, RegExp]> = [
      ["TaskWorkflowService", /worktreeRemovalService,\n\s+corpusService,\n\s+\);/g],
      ["JudgmentService", /new JudgmentService\(store, telemetry, corpusService\)/g],
      ["ReviewService", /judgmentRequiredTypes,\n\s+corpusService,\n\s+\);/g],
      ["RuleChangeService", /new RuleChangeService\(store, recordLockService, corpusService\)/g],
      ["DriftCheckService", /new DriftCheckService\(store, corpusService\)/g],
      ["OutlineSectionsRetireMigrationService", /new OutlineSectionsRetireMigrationService\(store, corpusService\)/g],
      ["SpecParentMigrationService", /new SpecParentMigrationService\(store, corpusService\)/g],
      ["SpecKindService", /new SpecKindService\(store, corpusService\)/g],
      ["StateBindingService", /new StateBindingService\(store, corpusService\)/g],
      ["AcService", /new AcService\(store, recordLockService, \{ citeGate: citeGateRaw \}, corpusService\)/g],
      ["PlanIntegrationBranchService", /new PlanIntegrationBranchService\(store, corpusService\)/g],
      ["state-binding occupancy port", /buildStateBindingOccupancyPort\(corpusService\)/g],
    ];
    for (const [name, pattern] of wired) {
      expect(app.match(pattern)?.length ?? 0, `${name} must be composed over corpusService in both createApp roots`).toBe(2);
    }
    expect(app).toContain("new IssueCloseOnArchive(store, closer, repo, undefined, app.corpusService)");
    const phaseWiring = readFileSync(join(SRC_ROOT, "adapters", "cli", "phase-wiring.ts"), "utf8");
    expect(phaseWiring).toContain("corpusService,\n  );\n  const phaseChecklistService = new PhaseChecklistService(store, corpusService);");
  });
});

// ─── shared row helpers ─────────────────────────────────────────────────────

function makeDoc(type: DocType, slug: string, overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: ulid(),
    slug,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: `Fixture ${slug}`,
    status: "draft",
    priority: "medium",
    content: "Fixture body.",
    parent_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: AUTHOR,
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ordinal: null,
    ...overrides,
  } as DocRecord;
}

async function seedRaw(raw: StoreInterface, doc: DocRecord): Promise<DocRecord> {
  const inserted = await raw.insert(doc);
  if (!inserted.ok) throw new Error(`seed ${doc.slug} failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

async function mustCreate(corpus: CorpusService, input: Parameters<CorpusService["create"]>[0]): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`fixture create ${input.type} failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function docOf(raw: StoreInterface, id: string): Promise<DocRecord> {
  const r = await raw.find(id as DocRecord["id"]);
  if (!r.ok || r.value === null) throw new Error(`doc ${id} not found`);
  return r.value;
}

async function versionsOf(raw: StoreInterface, id: string): Promise<VersionRecord[]> {
  const r = await raw.findVersions(id as DocRecord["id"]);
  if (!r.ok) throw new Error("findVersions failed");
  return r.value;
}

async function auditsOf(raw: StoreInterface, filter: { doc_id?: string; action?: string } = {}): Promise<AuditEntry[]> {
  const r = await raw.queryAudit({ ...filter, limit: 100000 } as Parameters<StoreInterface["queryAudit"]>[0]);
  if (!r.ok) throw new Error("queryAudit failed");
  // reason: a gate that PASSES leaves a `gate_passed` trace row (the record-lock check some services run before the
  // write); that row records a check, not a write, so "nothing was written" is measured over the non-gate rows.
  return r.value.filter((a) => !a.action.startsWith("gate"));
}

interface Snapshot {
  readonly versions: Readonly<Record<string, { version: number; versionRows: number; auditRows: number }>>;
  readonly auditTotal: number;
}

async function snapshotOf(raw: StoreInterface, ids: readonly string[]): Promise<Snapshot> {
  const versions: Record<string, { version: number; versionRows: number; auditRows: number }> = {};
  for (const id of ids) {
    versions[id] = {
      version: (await docOf(raw, id)).version,
      versionRows: (await versionsOf(raw, id)).length,
      auditRows: (await auditsOf(raw, { doc_id: id })).length,
    };
  }
  return { versions, auditTotal: (await auditsOf(raw)).length };
}

/** The refusal of a result, as text: the error's JSON when it failed, else undefined. */
function failureText(result: Result<unknown, unknown>): string | undefined {
  return result.ok ? undefined : JSON.stringify(result.error);
}

// ─── services under test, as a bundle ───────────────────────────────────────

interface Svc {
  readonly taskWorkflow: TaskWorkflowService;
  readonly phaseWorkflow: PhaseWorkflowService;
  readonly review: ReviewService;
  readonly outlineMigration: OutlineSectionsRetireMigrationService;
  readonly driftCheck: DriftCheckService;
  readonly phaseChecklist: PhaseChecklistService;
  readonly planIntegrationBranch: PlanIntegrationBranchService;
  readonly ruleChange: RuleChangeService;
  readonly specParentMigration: SpecParentMigrationService;
  readonly specKind: SpecKindService;
  readonly ac: AcService;
  readonly judgment: JudgmentService;
  readonly stateBinding: StateBindingService;
}

function buildOwnSvc(store: StoreInterface, lock: RecordLockService, writer: CorpusService): Svc {
  const telemetry = new NoOpTelemetry();
  return {
    taskWorkflow: new TaskWorkflowService(
      store, telemetry, { claimTtlMinutes: 120 },
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe(), undefined,
      writer,
    ),
    phaseWorkflow: new PhaseWorkflowService(store, telemetry, { claimTtlMinutes: 120 }, undefined, undefined, undefined, writer),
    review: new ReviewService(store, lock, undefined, undefined, undefined, undefined, writer),
    outlineMigration: new OutlineSectionsRetireMigrationService(store, writer),
    driftCheck: new DriftCheckService(store, writer),
    phaseChecklist: new PhaseChecklistService(store, writer),
    planIntegrationBranch: new PlanIntegrationBranchService(store, writer),
    ruleChange: new RuleChangeService(store, lock, writer),
    specParentMigration: new SpecParentMigrationService(store, writer),
    specKind: new SpecKindService(store, writer),
    ac: new AcService(store, lock, undefined, writer),
    judgment: new JudgmentService(store, telemetry, writer),
    stateBinding: new StateBindingService(store, writer),
  };
}

function svcOfApp(app: App): Svc {
  return {
    taskWorkflow: app.taskWorkflowService,
    phaseWorkflow: app.phaseWorkflowService!,
    review: app.reviewService,
    outlineMigration: app.outlineSectionsRetireMigrationService!,
    driftCheck: app.driftCheckService!,
    phaseChecklist: app.phaseChecklistService!,
    planIntegrationBranch: app.planIntegrationBranchService!,
    ruleChange: app.ruleChangeService!,
    specParentMigration: app.specParentMigrationService!,
    specKind: app.specKindService,
    ac: app.acService!,
    judgment: app.judgmentService,
    stateBinding: app.stateBindingService!,
  };
}

// ─── the two worlds ─────────────────────────────────────────────────────────

interface World {
  readonly kind: "own" | "foreign";
  /** Seeds docs and reads rows back: an un-wrapped connection to the world's corpus. */
  readonly raw: SQLiteStore;
  /** Creates seed docs through the real create path (own corpus, never refused). */
  readonly seedCorpus: CorpusService;
  /** The services under test: constructed over CALLER's write context (own) or taken from the worktree's app (foreign). */
  readonly svc: Svc;
  /** The one write route the services under test hold. */
  readonly writer: CorpusService;
  /** The store the services under test hold (reads). */
  readonly store: StoreInterface;
  readonly lock: RecordLockService;
  /** A directory the caller stands in (a lease worktree must contain it). */
  readonly callerDir: string;
}

/** World "own": a real SQLite corpus; services write as CALLER under run RUN; seeds are authored by AUTHOR. */
function openOwnWorld(): World {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "write-path-everywhere-")));
  scratch.push(dir);
  const raw = new SQLiteStore(join(dir, "lore.db"));
  const store = withWriteContext(raw, { identity: { harnessRun: RUN as never, claimed: CALLER, claimedSource: "run" } });
  // reason: the seed author is a known party too (every stamped write needs a run, BR-1351); its run is NOT the caller's.
  const authorStore = withWriteContext(raw, { identity: { harnessRun: "cc:wpe-seed-author" as never, claimed: AUTHOR, claimedSource: "run" } });
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  const writer = new CorpusService(store, lock);
  const seedCorpus = new CorpusService(authorStore, new RecordLockService(authorStore, new GateEnforcer(undefined)));
  closers.push(() => raw.close());
  return { kind: "own", raw, seedCorpus, svc: buildOwnSvc(store, lock, writer), writer, store, lock, callerDir: dir };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let foreignWorldMemo: Promise<World> | undefined;

/**
 * World "foreign": a repo that OWNS the corpus plus a nested LINKED WORKTREE with none, so `loadLoreApp` from the worktree
 * resolves the main checkout's corpus through the git-common-dir fallback (provenance `git_common_dir`). Seeds go through
 * an app booted INSIDE the repo; the services under test are the worktree app's own composed services.
 */
function openForeignWorld(): Promise<World> {
  foreignWorldMemo ??= (async () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "write-path-everywhere-repo-")));
    scratch.push(repoRoot);
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.email", "dcl5@example.invalid"]);
    git(repoRoot, ["config", "user.name", "dcl5 test"]);
    writeFileSync(join(repoRoot, "README.md"), "fixture\n");
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-q", "-m", "init"]);
    const loreDir = join(repoRoot, ".lore");
    mkdirSync(loreDir, { recursive: true });
    createLiveApp(join(loreDir, "lore.db")).close();
    mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
    const worktreePath = join(repoRoot, ".claude", "worktrees", "agent-dcl5");
    git(repoRoot, ["worktree", "add", "-q", "-b", "dcl5-agent", join(".claude", "worktrees", "agent-dcl5")]);

    const original = process.cwd();
    try {
      process.chdir(repoRoot);
      const seedApp = loadLoreApp({ inv: liveInvocation() }).app;
      process.chdir(worktreePath);
      const foreignApp = loadLoreApp({ inv: liveInvocation() }).app;
      closers.push(() => {
        seedApp.close();
        foreignApp.close();
      });
      const raw = new SQLiteStore(join(loreDir, "lore.db"));
      closers.push(() => raw.close());
      return {
        kind: "foreign",
        raw,
        seedCorpus: seedApp.corpusService,
        svc: svcOfApp(foreignApp),
        writer: foreignApp.corpusService,
        store: raw,
        lock: foreignApp.recordLockService!,
        callerDir: worktreePath,
      } satisfies World;
    } finally {
      process.chdir(original);
    }
  })();
  return foreignWorldMemo;
}

// ─── per-module scenarios ───────────────────────────────────────────────────

interface Seeded {
  /** Docs whose rows are snapshotted (and, for a versioned module, the first one carries the paired rows). */
  readonly docIds: readonly string[];
  /** Runs the module's write; resolves the refusal/failure text, or undefined when it succeeded. */
  readonly run: () => Promise<string | undefined>;
  /** Slugs of docs the write CREATES (version-1 + audit rows by CALLER). */
  readonly createdSlugs?: readonly string[];
}

interface Scenario {
  readonly module: string;
  /**
   * `versioned`: the write bumps `docIds[0]`'s version (one version row + one audit row).
   * `working-state`: the write bumps the version, adds NO version row, and its one audit row carries `details.state_change`
   * (spec-history-records-content-a-working-state-only-write-adds-no).
   * `audit-only`: audit rows only.
   */
  readonly kind: "versioned" | "working-state" | "audit-only";
  /** Audit action the write records. */
  readonly auditAction: string;
  /** Doc the audit rows hang on (audit-only); defaults to `docIds[0]`. */
  readonly auditDocId?: boolean;
  /** Actor the audit rows name; default CALLER. */
  readonly actor?: string;
  readonly seed: (w: World) => Promise<Seeded>;
}

const EVIDENCE = {
  oracle: "manual",
  command: "bun run typecheck",
  result: "pass",
  recorded_by: CALLER,
  output_tail: "captured output",
  capture_source: "self-report",
} as const;

const SCRIPT_CRITERION = {
  id: "AC-DCL5-1",
  statement: "Does the thing",
  verify: { mode: "script", oracle: "test", command: "bunx vitest run x.test.ts" },
  cites: [],
};

const PRD_BODY = [
  "# Root PRD (fixture)",
  "",
  "## 1. Overview",
  "",
  "Core intro text, not a domain section.",
  "",
  "## 14. Feedback Loop",
  "",
  "Every lifecycle transition is audit-traced end to end, closing the loop described by §14 (R-14).",
  "",
  "Calibration data accumulates per doc type; Wilson-bounded agreement gates the auto-approve trigger (R-15).",
  "",
].join("\n");

let uniq = 0;
const slugFor = (prefix: string): string => `${prefix}-dcl5-${(uniq += 1)}`;

const SCENARIOS: readonly Scenario[] = [
  {
    module: "task-workflow",
    kind: "working-state",
    auditAction: "claim",
    seed: async (w) => {
      const plan = await mustCreate(w.seedCorpus, { parent_id: await ensureRequirementsDocId(w.seedCorpus), type: "plan", title: slugFor("plan"), content: "body" });
      const task = await mustCreate(w.seedCorpus, {
        type: "task", title: slugFor("task"), parent_id: plan.id, content: "body", extra: { plan_id: plan.id },
      });
      return { docIds: [task.id], run: async () => failureText(await w.svc.taskWorkflow.claim(task.id, { by: CALLER, harnessRun: runOfName(CALLER) })) };
    },
  },
  {
    module: "phase-workflow",
    kind: "working-state",
    auditAction: "evidence",
    seed: async (w) => {
      const plan = await mustCreate(w.seedCorpus, { parent_id: await ensureRequirementsDocId(w.seedCorpus), type: "plan", title: slugFor("plan"), content: "body" });
      const phase = await seedRaw(
        w.raw,
        makeDoc("phase" as DocType, slugFor("phase"), { parent_id: plan.id, extra: { plan_id: plan.id, checklist: [], track: [] } }),
      );
      return { docIds: [phase.id], run: async () => failureText(await w.svc.phaseWorkflow.addEvidence(phase.id, { ...EVIDENCE })) };
    },
  },
  {
    module: "review",
    kind: "versioned",
    auditAction: "approve",
    seed: async (w) => {
      const prd = await mustCreate(w.seedCorpus, { type: "prd", title: slugFor("prd"), content: "root" });
      return { docIds: [prd.id], run: async () => failureText(await w.svc.review.approve(prd.id)) };
    },
  },
  {
    module: "outline-sections-retire",
    kind: "versioned",
    auditAction: "update",
    seed: async (w) => {
      const prd = await seedRaw(w.raw, makeDoc("prd", slugFor("prd-outline"), { status: "approved", content: PRD_BODY, extra: { outline: [{ section: "s" }] } }));
      return {
        docIds: [prd.id],
        run: async () => {
          const applied = await w.svc.outlineMigration.apply();
          if (!applied.ok) return JSON.stringify(applied.error);
          // reason: `apply` collects a per-PRD failure into `errors` instead of failing the whole sweep.
          return applied.value.errors.length > 0 ? applied.value.errors.join("; ") : undefined;
        },
      };
    },
  },
  {
    module: "drift-check",
    kind: "working-state",
    auditAction: "update",
    seed: async (w) => {
      const spec = await seedRaw(w.raw, makeDoc("spec", slugFor("spec")));
      return { docIds: [spec.id], run: async () => failureText(await w.svc.driftCheck.addCodeAnchors(spec.id, ["packages/lore/src/app.ts"])) };
    },
  },
  {
    module: "phase-checklist",
    kind: "working-state",
    auditAction: "update",
    seed: async (w) => {
      const plan = await mustCreate(w.seedCorpus, { parent_id: await ensureRequirementsDocId(w.seedCorpus), type: "plan", title: slugFor("plan"), content: "body" });
      const phase = await seedRaw(
        w.raw,
        makeDoc("phase" as DocType, slugFor("phase"), { parent_id: plan.id, extra: { plan_id: plan.id, checklist: [], track: [] } }),
      );
      const item = { id: "CHK-1", statement: "CHK-1 manual claim", bind: { kind: "manual" } };
      return { docIds: [phase.id], run: async () => failureText(await w.svc.phaseChecklist.addChecklistItem(phase.id, item)) };
    },
  },
  {
    module: "plan-integration-branch",
    kind: "working-state",
    auditAction: "update",
    seed: async (w) => {
      const plan = await mustCreate(w.seedCorpus, { parent_id: await ensureRequirementsDocId(w.seedCorpus), type: "plan", title: slugFor("plan"), content: "body" });
      return {
        docIds: [plan.id],
        run: async () =>
          failureText(await w.svc.planIntegrationBranch.setIntegrationBranch(plan.id, { branch: "gs-integration", by: CALLER })),
      };
    },
  },
  {
    module: "rule-change",
    kind: "versioned",
    auditAction: "update",
    seed: async (w) => {
      const branch = await seedRaw(w.raw, makeDoc("baseline", slugFor("branch"), { extra: { node: "branch", label: "A" } }));
      const leaf = await seedRaw(w.raw, makeDoc("baseline", slugFor("leaf"), { parent_id: branch.id, extra: { node: "leaf", label: "A leaf" } }));
      const spec = await seedRaw(w.raw, makeDoc("spec", slugFor("spec")));
      return {
        docIds: [spec.id],
        run: async () =>
          failureText(
            await w.svc.ruleChange.propose(
              spec.id,
              { op: "add", leaf: leaf.slug, statement: "A proposed rule", examples: ["e1"], enforced_by: "both" },
              { by: CALLER },
            ),
          ),
      };
    },
  },
  {
    module: "spec-parent-migration",
    kind: "audit-only",
    auditAction: "migrate_spec_parent",
    seed: async (w) => {
      const prd = await mustCreate(w.seedCorpus, { type: "prd", title: slugFor("prd"), content: "root" });
      const spec = await seedRaw(w.raw, makeDoc("spec", slugFor("spec-parented"), { parent_id: prd.id }));
      return {
        docIds: [spec.id],
        run: async () => {
          const applied = await w.svc.specParentMigration.apply();
          if (!applied.ok) return JSON.stringify(applied.error);
          // reason: `apply` collects a per-spec failure into `errors` instead of failing the whole sweep.
          return applied.value.errors.length > 0 ? applied.value.errors.join("; ") : undefined;
        },
      };
    },
  },
  {
    module: "spec-kind",
    kind: "versioned",
    auditAction: "update",
    seed: async (w) => {
      const spec = await seedRaw(w.raw, makeDoc("spec", slugFor("spec-kind"), { title: "Dashboard Visual Redesign dcl5" }));
      return { docIds: [spec.id], run: async () => failureText(await w.svc.specKind.migrateSpecKind({ dryRun: false })) };
    },
  },
  {
    module: "ac",
    kind: "versioned",
    auditAction: "update",
    seed: async (w) => {
      const spec = await seedRaw(w.raw, makeDoc("spec", slugFor("spec")));
      return { docIds: [spec.id], run: async () => failureText(await w.svc.ac.addCriterion(spec.id, SCRIPT_CRITERION)) };
    },
  },
  {
    module: "issue-close-on-archive",
    kind: "audit-only",
    auditAction: ISSUE_CLOSE_FAILED_AUDIT_ACTION,
    seed: async (w) => {
      // the carrier: an archived plan naming GitHub #7 in extra.issues (no report document, no link)
      const plan = await seedRaw(
        w.raw,
        makeDoc("plan", slugFor("plan-archived"), { status: "archived", extra: { issues: [{ repo_id: 123, number: 7 }] } }),
      );
      // reason: a closer whose close call FAILS is the only way the step writes a row (the failure audit), with no network.
      const closer: IssueCloser = {
        readIssue: async () => ok({ state: "open", stateReason: null, labels: [] }),
        closeIssue: async () => err({ code: "VALIDATION_ERROR", field: "gh", message: "HTTP 502 bad gateway", value: "502" }),
        commentIssue: async () => ok(undefined),
        labelIssue: async () => ok(undefined),
      };
      const step = new IssueCloseOnArchive(w.raw, closer, "acme/widget", undefined, w.writer);
      return {
        docIds: [plan.id],
        run: async () => {
          const items = await step.onArchived(plan, CALLER);
          // reason: the step never fails; a refused audit write is REPORTED in the failure line it appends.
          const refusedLine = items.find((i) => i.message.includes("audit row NOT written"));
          return refusedLine?.message;
        },
      };
    },
  },
  {
    module: "judgment",
    kind: "audit-only",
    auditAction: "judge",
    actor: "ai:claude-cli:claude-cli:v1",
    seed: async (w) => {
      const prd = await mustCreate(w.seedCorpus, { type: "prd", title: slugFor("prd"), content: "root" });
      return {
        docIds: [prd.id],
        run: async () =>
          failureText(
            await w.svc.judgment.record({
              doc_id: prd.id,
              doc_version: prd.version,
              decision: "approve",
              confidence: 0.9,
              reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
              checks: [{ check: "schema", outcome: "pass" }],
              blocking_questions: [],
              judge: { provider: "claude-cli", model: "claude-cli", prompt_version: "v1" },
            } as Parameters<JudgmentService["record"]>[0]),
          ),
      };
    },
  },
  {
    module: "state-binding",
    kind: "audit-only",
    auditAction: "state-binding-armed",
    seed: async (w) => {
      const anchor = await mustCreate(w.seedCorpus, { type: "prd", title: slugFor("prd"), content: "root" });
      return { docIds: [anchor.id], run: async () => failureText(await w.svc.stateBinding.arm({ actor: CALLER, nowIso: new Date().toISOString() })) };
    },
  },
  {
    module: "baseline-adopt",
    kind: "audit-only",
    auditAction: BASELINE_ADOPT_AUDIT_ACTION,
    seed: async (w) => {
      const anchor = await mustCreate(w.seedCorpus, { type: "prd", title: slugFor("prd"), content: "root" });
      return {
        docIds: [anchor.id],
        run: async () =>
          failureText(await appendAdoptAuditRow(w.writer, CALLER, { mode: null, armed_branches: [] }, { mode: "report", armed_branches: [] })),
      };
    },
  },
  {
    module: "app.ts (state-binding occupancy port)",
    kind: "audit-only",
    auditAction: "state_binding_skip",
    seed: async (w) => {
      const anchor = await mustCreate(w.seedCorpus, { type: "prd", title: slugFor("prd"), content: "root" });
      return {
        docIds: [anchor.id],
        run: async () =>
          failureText(
            await buildStateBindingOccupancyPort(w.writer).recordSkip({
              timestamp: new Date().toISOString(),
              actor: CALLER,
              session_id: "state-binding-skip-dcl5",
              action: "state_binding_skip",
              details: { reason: "peer holds the checkout oracle lock" },
            }),
          ),
      };
    },
  },
];

describe("AC-DCL-5 per module — the write carries version + audit rows naming the caller (own corpus)", () => {
  for (const scenario of SCENARIOS) {
    it(`HAPPY: ${scenario.module} — ${scenario.kind === "versioned" ? "one version row and one audit row" : "its audit row"} naming CALLER and RUN`, async () => {
      const w = openOwnWorld();
      const seeded = await scenario.seed(w);
      const before = await snapshotOf(w.raw, seeded.docIds);
      const primary = seeded.docIds[0]!;

      expect(await seeded.run()).toBeUndefined();

      const after = await snapshotOf(w.raw, seeded.docIds);
      const newAudits = (await auditsOf(w.raw, { action: scenario.auditAction })).filter((a) =>
        scenario.kind !== "audit-only" ? a.doc_id === primary : true,
      );
      expect(newAudits.length, `no ${scenario.auditAction} audit row`).toBeGreaterThan(0);
      const expectedActor = scenario.actor ?? CALLER;
      for (const a of newAudits) {
        expect(a.actor).toBe(expectedActor);
        expect(a.actor).not.toBe("system");
        expect(a.actor).not.toBe(AUTHOR);
        expect(a.harness_run).toBe(RUN);
      }

      const b = before.versions[primary]!;
      const a = after.versions[primary]!;
      if (scenario.kind === "versioned") {
        const bumps = a.version - b.version;
        expect(bumps).toBe(1);
        expect(a.versionRows - b.versionRows).toBe(bumps);
        const row = (await versionsOf(w.raw, primary)).find((v) => v.version === a.version)!;
        expect(row.created_by).toBe(CALLER);
        expect(row.created_by).not.toBe(AUTHOR);
        expect(row.harness_run).toBe(RUN);
        const joined = newAudits.filter((x) => x.details?.["version"] === a.version);
        expect(joined, "an audit row carrying the new version (the join key)").toHaveLength(1);
      } else if (scenario.kind === "working-state") {
        expect(a.version - b.version, "a working-state write bumps the version once").toBe(1);
        expect(a.versionRows, "a working-state write adds no versions row").toBe(b.versionRows);
        const joined = newAudits.filter((x) => x.details?.["version"] === a.version);
        expect(joined, "one audit row carrying the new version").toHaveLength(1);
        expect(joined[0]!.details?.["state_change"], "the delta lives in the audit row").toBeDefined();
      } else {
        expect(a.version, "an audit-only write bumps no version").toBe(b.version);
        expect(a.versionRows).toBe(b.versionRows);
      }

      for (const slug of seeded.createdSlugs ?? []) {
        const found = await w.raw.findBySlug(slug as never);
        if (!found.ok || found.value === null) throw new Error(`created doc ${slug} missing`);
        const rows = await versionsOf(w.raw, found.value.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.created_by).toBe(CALLER);
        expect(rows[0]!.harness_run).toBe(RUN);
        const created = await auditsOf(w.raw, { doc_id: found.value.id });
        expect(created).toHaveLength(1);
        expect(created[0]!.actor).toBe(CALLER);
      }
    });
  }
});

describe("AC-DCL-5 per module — a write from a linked worktree resolving the main checkout's corpus is refused (foreign corpus)", () => {
  for (const scenario of SCENARIOS) {
    it(`NEGATIVE: ${scenario.module} — refused by the foreign-corpus rule, nothing written`, async () => {
      const w = await openForeignWorld();
      const seeded = await scenario.seed(w);
      const before = await snapshotOf(w.raw, seeded.docIds);

      const refusal = await seeded.run();

      expect(refusal, `${scenario.module} was not refused`).toBeDefined();
      expect(refusal).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
      expect(await snapshotOf(w.raw, seeded.docIds)).toEqual(before);
      for (const slug of seeded.createdSlugs ?? []) {
        const found = await w.raw.findBySlug(slug as never);
        expect(found.ok && found.value === null, `${slug} must not have been created`).toBe(true);
      }
      if (scenario.module === "judgment") {
        const latest = await w.raw.latestJudgment(seeded.docIds[0] as never, "review");
        expect(latest.ok && latest.value === null, "a refused judgment leaves no judgment row behind").toBe(true);
      }
    });
  }
});

// ─── foreign-corpus-write-guard: the authority's own audit row ──────────────

describe("AC-DCL-5 foreign-corpus-write-guard — the authorization row goes through the write route", () => {
  async function seedLeafAndLease(w: World, leased: boolean): Promise<{ leaf: DocRecord }> {
    const branch = await seedRaw(w.raw, makeDoc("baseline", slugFor("branch-guard"), { extra: { node: "branch", label: "B" } }));
    const leaf = await seedRaw(w.raw, makeDoc("baseline", slugFor("leaf-guard"), { parent_id: branch.id, extra: { node: "leaf", label: "L" } }));
    if (leased) {
      await seedRaw(
        w.raw,
        makeDoc("task", slugFor("lease"), {
          extra: { claim: { by: "agent:lease-holder", at: new Date().toISOString(), worktree: w.callerDir, corpus_scope: branch.slug } },
        }),
      );
    }
    return { leaf };
  }

  const context = (callerDir: string) => ({
    foreign: { provenance: "git_common_dir", enabled: true } as const,
    callerDir,
    claimTtlMinutes: 120,
  });

  it("HAPPY: a scoped lease is authorized and ONE corpus-scope-write row names CALLER and RUN — even when the route itself is foreign", async () => {
    const w = openOwnWorld();
    const { leaf } = await seedLeafAndLease(w, true);
    // reason: the route is foreign too, so a row that took the refusal predicate would be refused — it must be `record`ed.
    w.writer.setForeignCorpusWriteContext({ provenance: "git_common_dir", enabled: true });
    const authority = new CorpusWriteAuthority(w.store, context(w.callerDir), w.writer);

    const verdict = await authority.authorize([leaf], "baseline-map", CALLER);

    expect(verdict.ok).toBe(true);
    const rows = await auditsOf(w.raw, { action: "corpus-scope-write" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(CALLER);
    expect(rows[0]!.harness_run).toBe(RUN);
    expect(rows[0]!.details?.["claim_by"]).toBe("agent:lease-holder");
  });

  it("NEGATIVE: no scoped lease from a linked worktree is refused by the foreign-corpus rule and records no authorization row", async () => {
    const w = await openForeignWorld();
    const { leaf } = await seedLeafAndLease(w, false);
    const before = (await auditsOf(w.raw, { action: "corpus-scope-write" })).length;
    const authority = new CorpusWriteAuthority(w.store, context(w.callerDir), w.writer);

    const verdict = await authority.authorize([leaf], "baseline-map", CALLER);

    expect(verdict.ok).toBe(false);
    expect(failureText(verdict)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    expect((await auditsOf(w.raw, { action: "corpus-scope-write" })).length).toBe(before);
  });
});

// ─── assignOrdinalForRepair is one transaction ──────────────────────────────

describe("AC-DCL-5 D3 — assignOrdinalForRepair is ONE transaction", () => {
  async function seedSpec(w: World): Promise<DocRecord> {
    const doc = await seedRaw(w.raw, makeDoc("spec", slugFor("spec-ordinal")));
    const r = await w.raw.insertVersion({
      doc_id: doc.id, version: 1, content: doc.content, extra: doc.extra, status: doc.status, title: doc.title,
      action: "create", created_at: doc.created_at, created_by: AUTHOR, slug: doc.slug,
    });
    if (!r.ok) throw new Error("seed version failed");
    return doc;
  }

  it("HAPPY: the ordinal, ONE version row and ONE audit row land together, naming CALLER and RUN", async () => {
    const w = openOwnWorld();
    const doc = await seedSpec(w);

    const r = await w.writer.assignOrdinalForRepair(doc, 7);

    expect(r.ok && r.value.written).toBe(true);
    const after = await docOf(w.raw, doc.id);
    expect(after.ordinal).toBe(7);
    expect(after.version).toBe(2);
    const row = (await versionsOf(w.raw, doc.id)).find((v) => v.version === 2)!;
    expect(row.created_by).toBe(CALLER);
    expect(row.harness_run).toBe(RUN);
    const audits = await auditsOf(w.raw, { doc_id: doc.id, action: "ordinal-backfill" });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor).toBe(CALLER);
    expect(audits[0]!.harness_run).toBe(RUN);
    expect(audits[0]!.details?.["version"]).toBe(2);
  });

  it("ERROR: a failure injected AFTER the ordinal write (a colliding version row) leaves no ordinal change and no audit row", async () => {
    const w = openOwnWorld();
    const doc = await seedSpec(w);
    // Injection: a stray version row already occupies (doc_id, 2), so the version insert collides AFTER the ordinal
    // UPDATE ran inside the transaction — the whole write must roll back.
    const stray = await w.raw.insertVersion({
      doc_id: doc.id, version: 2, content: "stray", extra: {}, status: "draft", title: "stray",
      action: "update", created_at: doc.created_at, created_by: AUTHOR, slug: doc.slug,
    });
    if (!stray.ok) throw new Error("stray row failed");

    const r = await w.writer.assignOrdinalForRepair(doc, 7);

    expect(r.ok).toBe(false);
    const after = await docOf(w.raw, doc.id);
    expect(after.ordinal).toBeNull();
    expect(after.version).toBe(1);
    expect(await auditsOf(w.raw, { doc_id: doc.id, action: "ordinal-backfill" })).toHaveLength(0);
    expect(await versionsOf(w.raw, doc.id)).toHaveLength(2); // the seed row and the stray one, nothing from the repair
  });

  it("ERROR (in-memory contract): a failing audit append leaves the doc on its previous ordinal and version", async () => {
    class AuditFailingStore extends InMemoryStore {
      override async appendAuditEntry(): Promise<Result<void, LoreError>> {
        return err({ code: "STORE_ERROR", message: "injected audit failure" });
      }
    }
    const store = actedStore(new AuditFailingStore());
    const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = makeDoc("spec", slugFor("spec-mem"));
    const inserted = await store.insert(doc);
    if (!inserted.ok) throw new Error("seed failed");

    const r = await corpus.assignOrdinalForRepair(doc, 3);

    expect(r.ok).toBe(false);
    const after = await store.find(doc.id);
    expect(after.ok && after.value?.ordinal).toBeNull();
    expect(after.ok && after.value?.version).toBe(1);
  });

  it("BOUNDARY: a repeat at the same ordinal is a no-op that writes no row", async () => {
    const w = openOwnWorld();
    const doc = await seedSpec(w);
    const first = await w.writer.assignOrdinalForRepair(doc, 7);
    if (!first.ok) throw new Error("first assignment failed");
    const before = await snapshotOf(w.raw, [doc.id]);

    const again = await w.writer.assignOrdinalForRepair(first.value.doc, 7);

    expect(again.ok && again.value.written).toBe(false);
    expect(await snapshotOf(w.raw, [doc.id])).toEqual(before);
  });

  it("NEGATIVE: from a foreign-resolved corpus the repair is refused and writes nothing", async () => {
    const w = await openForeignWorld();
    const doc = await seedSpec(w);
    const before = await snapshotOf(w.raw, [doc.id]);

    const r = await w.writer.assignOrdinalForRepair(doc, 9);

    expect(failureText(r)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    expect(await snapshotOf(w.raw, [doc.id])).toEqual(before);
    expect((await docOf(w.raw, doc.id)).ordinal).toBeNull();
  });
});
