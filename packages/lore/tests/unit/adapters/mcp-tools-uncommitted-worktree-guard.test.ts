/**
 * Six-dimension tests for the MCP-surface wiring of the uncommitted-worktree
 * attestation guard's Q3 mismatch check (task-lore-evidence-add-and-lore-
 * release-over-mcp-get-no) — `lore_evidence_add` and `lore_release` in
 * `tools.ts` now thread `caller_cwd` through to
 * `TaskWorkflowService.addEvidence`/`release`'s `callerCwd` parameter via
 * `resolveMcpCallerCwd`, closing the gap left by the CLI-only fix
 * (task-lore-evidence-and-lore-release-accept-an-attestation-from, merged
 * `9a34739`).
 *
 * Scope note (mirrors mcp-tools-task-workflow.test.ts's own framing): this
 * suite is adapter-wiring-only. The PRIMARY whole-worktree cleanliness
 * predicate (`measureWorktreeCleanliness`, keyed off the claim's OWN
 * recorded `worktree`, never `callerCwd`) is exhaustively covered at the
 * service layer by `task-workflow-uncommitted-worktree-guard.test.ts` (21
 * tests) and is UNCHANGED by this fix — MEASURED (not assumed) to already
 * fire correctly via MCP even before this fix, since it never depended on
 * `callerCwd` at all (see the "control — primary predicate" describe block
 * below, and this task's own completion report for the probe that found
 * this). What this suite adds is coverage for the Q3 ESCALATION specifically
 * — the one code path that DOES read `callerCwd` — which was silently
 * unreachable via MCP before this fix (neither tool passed the field at
 * all).
 *
 * MOCK RISK: NONE for the worktree/repo state — every "clean"/"dirty"/
 * "not a repo" scenario below shells a REAL `git` subprocess against a REAL
 * temp directory (mirrors the CLI test file's own MOCK RISK note, for the
 * identical reason: a mocked git state would be exactly the proxy
 * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the warns
 * against for this specific predicate).
 *
 * Dimension mapping:
 *   HAPPY:      a clean recorded worktree (via lore_claim's `worktree` arg)
 *               → lore_evidence_add(pass) and lore_release both succeed via
 *               MCP, unaffected by caller_cwd wiring.
 *   NEGATIVE:   a claim recording NO worktree, called via MCP with NO
 *               caller_cwd supplied at all, is unaffected (no fabricated
 *               refusal) — the field is optional; an agent that does not
 *               declare its cwd must not be penalized.
 *   BOUNDARY:   the Q3 mismatch itself — a claim recording NO worktree,
 *               called via MCP WITH caller_cwd pointing at a REAL git repo,
 *               is REFUSED after this fix (RED-pin: proven to SUCCEED before
 *               the fix in this task's own completion report); the
 *               symmetric caller_cwd-pointing-at-a-non-repo-dir case is
 *               UNAFFECTED (control pair), for both lore_evidence_add and
 *               lore_release.
 *   ERROR:      AC-7 control — a task with NO claim recorded AT ALL (never
 *               claimed) is unaffected regardless of caller_cwd being
 *               omitted; this is the literal "absence of a claim" case the
 *               governing task explicitly says must NOT be widened. Extended
 *               by task-two-independent-copies-of-does-this-task-have-a-claim-
 *               now with the cases the adapter's deleted `hasRecordedTaskClaim`
 *               used to handle: no claim at all WITH a real (and separately, a
 *               DIRTY) git-repo caller_cwd, proving the MCP surface inherits
 *               the service's `hasRecordedClaim` short-circuit instead of
 *               re-deriving it — plus the measured fact that `lore_release`
 *               cannot reach the Q3 escalation for a never-claimed task at all
 *               (the ordinary no-claim refusal precedes it).
 *   STATE:      the SAME caller_cwd field now serves TWO purposes on
 *               lore_evidence_add (the pre-existing oracle-file-existence
 *               precheck AND this new worktree-guard use) without either
 *               clobbering the other.
 *   REGRESSION: control — primary predicate — a claim recording a DIRTY
 *               worktree is refused via MCP regardless of whether
 *               caller_cwd is supplied at all (proves the primary predicate
 *               was, and remains, completely independent of this fix).
 *
 * @spec_ref task-lore-evidence-add-and-lore-release-over-mcp-get-no
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { NoOpTelemetry, ok } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
// ─── Real-git fixture helpers (no fakes — see module MOCK RISK note) ────────

const createdDirs: string[] = [];

function runRealGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`fixture setup: git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

/** A freshly-initialized real git repo with ONE committed file, clean working tree. */
function makeCleanRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-uwg-clean-"));
  createdDirs.push(dir);
  runRealGit(dir, ["init", "-q"]);
  runRealGit(dir, ["config", "user.email", "fixture@example.com"]);
  runRealGit(dir, ["config", "user.name", "Fixture"]);
  writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
  runRealGit(dir, ["add", "."]);
  runRealGit(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

/** The same real repo as {@link makeCleanRepo}, but with an UNCOMMITTED modification. */
function makeDirtyRepo(): string {
  const dir = makeCleanRepo();
  appendFileSync(join(dir, "src.ts"), "// uncommitted edit\n");
  return dir;
}

/** A plain directory that is NOT a git repository at all. */
function makeNonRepoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-uwg-nonrepo-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test Infrastructure (mirrors mcp-tools-task-workflow.test.ts) ──────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

function makeApp(): App {
  store = actedStore(new InMemoryStore());
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return {
    warn: () => undefined,
    corpusService,
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(
      store,
      new NoOpTelemetry(),
      { claimTtlMinutes: 120 },
      async () => ok(new Set()), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe(),
    ),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

type McpServerInternal = {
  _registeredTools: Record<
    string,
    { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }
  >;
};

function getToolHandler(
  server: McpServer,
  name: string,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const internal = server as unknown as McpServerInternal;
  const tool = internal._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseResult(result: CallToolResult): unknown {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text);
}

async function createPlan(cs: CorpusService, title = "UWG Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "UWG Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

let app: App;
let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app, undefined, liveInvocation());
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY — a clean recorded worktree is unaffected via MCP", () => {
  it("lore_evidence_add(pass): claim recorded a CLEAN worktree succeeds", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const cleanDir = makeCleanRepo();

    const claimResult = await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice", worktree: cleanDir });
    expect(claimResult.isError).toBeFalsy();

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): "tsc"
      // self-report is now refused by rejectMissingPassOutputTail's D5 raise BEFORE
      // this file's own worktree-guard checks ever run; "manual" is the one oracle
      // that still lets a genuinely non-empty self-reported tail proceed past it, so
      // the worktree guard this file actually tests is what fires/passes instead.
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      output_tail: "ok",
    });
    expect(result.isError).toBeFalsy();
  });

  it("lore_release: claim recorded a CLEAN worktree succeeds", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const cleanDir = makeCleanRepo();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice", worktree: cleanDir });
    const result = await getToolHandler(server, "lore_release")({ id_or_slug: taskId, by: "alice" });
    expect(result.isError).toBeFalsy();
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — a no-worktree claim with NO caller_cwd declared is unaffected", () => {
  it("lore_evidence_add(pass): claim recorded NO worktree, caller_cwd omitted entirely → accepted", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice" }); // no worktree
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): "tsc"
      // self-report is now refused by rejectMissingPassOutputTail's D5 raise BEFORE
      // this file's own worktree-guard checks ever run; "manual" is the one oracle
      // that still lets a genuinely non-empty self-reported tail proceed past it, so
      // the worktree guard this file actually tests is what fires/passes instead.
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      output_tail: "ok",
      // caller_cwd omitted
    });
    expect(result.isError).toBeFalsy();
  });

  it("lore_release: claim recorded NO worktree, caller_cwd omitted entirely → accepted", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice" }); // no worktree
    const result = await getToolHandler(server, "lore_release")({ id_or_slug: taskId, by: "alice" });
    expect(result.isError).toBeFalsy();
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — the Q3 mismatch: no recorded worktree + a REAL caller_cwd repo", () => {
  // reason: BR-159 / #304 — the Q3 refusal is gone: a no-worktree claim is corpus-only work (BR-1468), proven at main's head.
  it("lore_evidence_add: claim recorded NO worktree + caller_cwd IS a real git repo → accepted", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const realRepoCwd = makeCleanRepo();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice" }); // no worktree
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): "tsc"
      // self-report is now refused by rejectMissingPassOutputTail's D5 raise BEFORE
      // this file's own worktree-guard checks ever run; "manual" is the one oracle
      // that still lets a genuinely non-empty self-reported tail proceed past it, so
      // the worktree guard this file actually tests is what fires/passes instead.
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      output_tail: "ok",
      caller_cwd: realRepoCwd,
    });
    expect(result.isError).toBeFalsy();
  });

  it("lore_release: claim recorded NO worktree + caller_cwd IS a real git repo → accepted", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const realRepoCwd = makeCleanRepo();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice" }); // no worktree
    const result = await getToolHandler(server, "lore_release")({
      id_or_slug: taskId,
      by: "alice",
      caller_cwd: realRepoCwd,
    });
    expect(result.isError).toBeFalsy();
  });

  it("control pair (lore_evidence_add): claim recorded NO worktree + caller_cwd is NOT a repo → accepted", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const nonRepoCwd = makeNonRepoDir();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice" });
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): "tsc"
      // self-report is now refused by rejectMissingPassOutputTail's D5 raise BEFORE
      // this file's own worktree-guard checks ever run; "manual" is the one oracle
      // that still lets a genuinely non-empty self-reported tail proceed past it, so
      // the worktree guard this file actually tests is what fires/passes instead.
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      output_tail: "ok",
      caller_cwd: nonRepoCwd,
    });
    expect(result.isError).toBeFalsy();
  });

  it("control pair (lore_release): claim recorded NO worktree + caller_cwd is NOT a repo → accepted", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const nonRepoCwd = makeNonRepoDir();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice" });
    const result = await getToolHandler(server, "lore_release")({
      id_or_slug: taskId,
      by: "alice",
      caller_cwd: nonRepoCwd,
    });
    expect(result.isError).toBeFalsy();
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — AC-7 control: absence of a claim is NEVER widened by this fix", () => {
  it("lore_evidence_add(pass): a task with NO claim at all, caller_cwd omitted → accepted", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    // No lore_claim call at all.

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): "tsc"
      // self-report is now refused by rejectMissingPassOutputTail's D5 raise BEFORE
      // this file's own worktree-guard checks ever run; "manual" is the one oracle
      // that still lets a genuinely non-empty self-reported tail proceed past it, so
      // the worktree guard this file actually tests is what fires/passes instead.
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      output_tail: "ok",
    });
    expect(result.isError).toBeFalsy();
  });

  // reason: task-two-independent-copies-of-does-this-task-have-a-claim-now —
  // the THREE cases below are the ones the adapter's now-deleted
  // `hasRecordedTaskClaim` pre-check existed to handle. They pin that the MCP
  // surface inherits the SERVICE's no-claim short-circuit
  // (`hasRecordedClaim` in task-workflow-service.ts) rather than re-deriving
  // "is there a claim" a second time in `tools.ts`.
  //
  // Why an EXPLICIT pin when the behavior is already exercised: before this,
  // the only MCP coverage of "never-claimed task + a REAL git-repo
  // caller_cwd" was INCIDENTAL — `mcp-tools-task-workflow.test.ts`'s
  // "AC-2.H1 (GREEN)", whose title and purpose are the oracle-file-existence
  // precheck's caller_cwd escape hatch, not the worktree guard. Its
  // `caller_cwd` happens to be a real working tree, so it happens to prove
  // this. Retitling or rescoping that test would delete this coverage with
  // nothing going red — the incidental-coverage half of the
  // AC-statement-drift hazard. These cases name the property they measure.
  //
  // A DIRTY repo is used in the second case deliberately: it proves the
  // short-circuit returns BEFORE any git inspection of `callerCwd` happens,
  // not merely that a clean tree passes the inspection.
  it("REGRESSION (lore_evidence_add): NO claim at all + caller_cwd IS a real git repo → accepted, not refused", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    // No lore_claim call at all — and a caller_cwd that IS a real repo, the
    // exact combination that produced a FALSE refusal before the service
    // learned to tell "no claim" from "a claim recording no worktree".
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): "tsc"
      // self-report is now refused by rejectMissingPassOutputTail's D5 raise BEFORE
      // this file's own worktree-guard checks ever run; "manual" is the one oracle
      // that still lets a genuinely non-empty self-reported tail proceed past it, so
      // the worktree guard this file actually tests is what fires/passes instead.
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      output_tail: "ok",
      caller_cwd: makeCleanRepo(),
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    expect(data.doc.extra["verification_evidence"]).toHaveLength(1);
  });

  it("REGRESSION (lore_evidence_add): NO claim at all + caller_cwd is a DIRTY real git repo → still accepted (short-circuit precedes any git inspection)", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): "tsc"
      // self-report is now refused by rejectMissingPassOutputTail's D5 raise BEFORE
      // this file's own worktree-guard checks ever run; "manual" is the one oracle
      // that still lets a genuinely non-empty self-reported tail proceed past it, so
      // the worktree guard this file actually tests is what fires/passes instead.
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      output_tail: "ok",
      caller_cwd: makeDirtyRepo(),
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    expect(data.doc.extra["verification_evidence"]).toHaveLength(1);
  });

  // MEASURED, not assumed (this was the RED that corrected this test's own
  // first draft): `lore_release` on a NEVER-CLAIMED task cannot reach the
  // worktree guard's Q3 escalation at all — the ordinary "nothing to release"
  // refusal fires first. So the assertion here is a NEGATIVE CONDITION,
  // independent of the positive one: the refusal that fires must be the
  // pre-existing `extra.claim` one, and must NOT be the Q3 mismatch on
  // `extra.claim.worktree`, even though `caller_cwd` IS a real git repo.
  // Asserting only "isError" would have passed for either reason — the
  // proxy-vs-property distinction this suite's governing ADR is about.
  it("REGRESSION (lore_release): NO claim at all + caller_cwd IS a real git repo → refused for the ordinary no-claim reason, NEVER the Q3 worktree mismatch", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const result = await getToolHandler(server, "lore_release")({
      id_or_slug: taskId,
      by: "alice",
      force: true,
      caller_cwd: makeCleanRepo(),
    });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string; message: string };
    expect(error.field).toBe("extra.claim");
    expect(error.message).toContain("no active claim to release");
    // The independent negative condition — the guard did not fire.
    expect(error.field).not.toBe("extra.claim.worktree");
    expect(error.message).not.toContain("recorded NO");
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — caller_cwd serves BOTH the pre-existing precheck AND the new worktree guard", () => {
  const EXISTING_TEST_FILE_FROM_PACKAGE_DIR = "tests/unit/adapters/mcp-tools-uncommitted-worktree-guard.test.ts";
  const CALLER_CWD_AS_PACKAGE_DIR = `${process.cwd()}/packages/lore`;

  // reason: this title used to say "(no claim recorded)", which the body has
  // NEVER matched — line below claims the task (recording NO worktree). Since
  // task-the-uncommitted-worktree-guard-treats-no-claim-at-all-as-a landed,
  // "no claim recorded" is precisely the case that is ACCEPTED, so the stale
  // title asserted the exact opposite of current behavior while staying green
  // (the AC-statement-drift shape: a true body under a false statement).
  it("a caller_cwd that resolves the precheck's file AND is a real repo (claim recorded NO worktree) → BOTH concerns satisfied, and accepted (the Q3 refusal is gone: BR-159 / #304)", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice" }); // no worktree
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): see
      // the identical reasoning at this file's other superseded oracle overrides.
      oracle: "manual",
      command: `bunx vitest run ${EXISTING_TEST_FILE_FROM_PACKAGE_DIR}`,
      result: "pass",
      output_tail: "ok",
      caller_cwd: CALLER_CWD_AS_PACKAGE_DIR,
    });
    // reason: the precheck finds the file (no "Oracle file(s) not found") and the worktree guard no longer refuses a
    // no-worktree claim, so the write goes through: neither use of caller_cwd clobbers the other.
    expect(result.isError).toBeFalsy();
  });

  it("the same caller_cwd, with a CLEAN recorded worktree instead of no claim, satisfies BOTH and succeeds", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const cleanDir = makeCleanRepo();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice", worktree: cleanDir });
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): see
      // the identical reasoning at this file's other superseded oracle overrides.
      oracle: "manual",
      command: `bunx vitest run ${EXISTING_TEST_FILE_FROM_PACKAGE_DIR}`,
      result: "pass",
      output_tail: "ok",
      caller_cwd: CALLER_CWD_AS_PACKAGE_DIR,
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    const evidenceArr = data.doc.extra["verification_evidence"] as unknown[];
    expect(evidenceArr).toHaveLength(1);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — control: the primary predicate is completely independent of caller_cwd wiring", () => {
  it("lore_evidence_add(pass): a claim recording a DIRTY worktree is refused via MCP regardless of caller_cwd", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const dirtyDir = makeDirtyRepo();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice", worktree: dirtyDir });
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      // SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own): "tsc"
      // self-report is now refused by rejectMissingPassOutputTail's D5 raise BEFORE
      // this file's own worktree-guard checks ever run; "manual" is the one oracle
      // that still lets a genuinely non-empty self-reported tail proceed past it, so
      // the worktree guard this file actually tests is what fires/passes instead.
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      output_tail: "ok",
      // caller_cwd deliberately omitted — proves this refusal does NOT depend on it.
    });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; message: string; value: string[] };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("src.ts");
    expect(error.message).toContain("uncommitted");
    expect(error.value).toContain("src.ts");
  });

  it("lore_release: a claim recording a DIRTY worktree is refused via MCP regardless of caller_cwd", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const dirtyDir = makeDirtyRepo();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice", worktree: dirtyDir });
    const result = await getToolHandler(server, "lore_release")({ id_or_slug: taskId, by: "alice" });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; message: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("src.ts");
  });

  it("lore_release: force:true from a non-holder is STILL subject to the worktree guard (ordering unaffected)", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const dirtyDir = makeDirtyRepo();

    await getToolHandler(server, "lore_claim")({ id_or_slug: taskId, by: "alice", worktree: dirtyDir });
    const result = await getToolHandler(server, "lore_release")({ id_or_slug: taskId, by: "bob", force: true });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});
