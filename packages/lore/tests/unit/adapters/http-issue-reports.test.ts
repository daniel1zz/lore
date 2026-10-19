/**
 * Tests for SPEC-074 AC-074-5 — `GET /api/issue-reports` (dashboard Issues
 * triage read projection) — PLUS D7 (spec-issue-closure-loop-computed-
 * resolution-agent-reachable, AC-ICL-9's HTTP half): every row additionally
 * carries a computed `resolution`, and `open_count` counts computed-`"open"`
 * rows rather than `rows.length` unconditionally.
 *
 * Harness: `InMemoryStore` + a real `CorpusService` (projection logic reads
 * `extra.issue_report`, which `CorpusService.listFull` exposes — no
 * cross-corpus / real-CLI e2e needed here, unlike the Playwright suite
 * covering AC-074-1..4). Every other `App` service is null-cast, mirroring
 * `routes.test.ts`'s/`config-routes.test.ts`'s established `makeApp()`
 * pattern. Cookie vs bearer duality is exercised via two fixed `ActorContext`
 * values passed directly to `handleApiRoute` (same approach
 * `config-routes.test.ts` uses for `GET /api/config`'s identical auth
 * duality) — the actual cookie/bearer credential-resolution gate
 * (`authenticateRequest`, upstream in `index.ts`) is real `bun:sqlite` IO and
 * is covered end-to-end elsewhere (`auth-routes.bun.test.ts`,
 * `feedback-loop-routes.bun.test.ts`, `ready-route.bun.test.ts`); the "no
 * auth" case here instead calls `authenticateRequest` directly against a
 * credential-less `Request` with duck-typed (never-invoked-on-this-path)
 * `ApiKeyStore`/`SessionStore` stubs, proving the SAME shared gate every
 * `/api/*` route inherits rejects this route's path with 401 before
 * `handleGetIssueReports` ever runs.
 *
 * D7 fixture recipe: a "fixing" doc is a plain task (via `createPlainTask`,
 * NOT an issue report itself) linked to the issue task via
 * `corpusService.link(fixingId, issueId, "resolves")`, then walked through
 * `corpusService.set(id, {status: ...})` (draft -> approved -> active ->
 * archived, all valid direct transitions — VALID_TRANSITIONS,
 * packages/core/src/CLAUDE.md) to reach the source-doc status
 * `computeIssueResolution` needs for each of "resolving" (approved, not yet
 * active) vs "fixed" (active or archived).
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-074 §Acceptance Criteria AC-074-5;
 *   spec-issue-closure-loop-computed-resolution-agent-reachable §D7, AC-ICL-9.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { AuditService } from "../../../src/service/audit-service.js";
import { handleApiRoute } from "../../../src/adapters/http/routes.js";
import { authenticateRequest } from "../../../src/adapters/http/auth.js";
import type { ApiKeyStore, ActorContext } from "../../../src/adapters/http/auth.js";
import type { SessionStore } from "../../../src/adapters/http/sessions.js";
import type { App } from "../../../src/app.js";
import { actedStore } from "../../live-invocation.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

/** Far enough in the past that every audit entry this suite writes is "since" it. */
const FAR_PAST = "2000-01-01T00:00:00.000Z";

// ─── Test infrastructure ────────────────────────────────────────────────────

const COOKIE_ACTOR: ActorContext = {
  name: "test-user",
  session_id: "cookie-session",
  callerSurface: "http_cookie" as const,
  owner: "admin",
};

const BEARER_ACTOR: ActorContext = {
  name: "test-agent",
  session_id: "token-session",
  callerSurface: "http_token" as const,
};

/** Never actually invoked on the "no auth" path — duck-typed stub only. */
const stubApiKeyStore = {} as ApiKeyStore;

function makeApp(store: InMemoryStore): App {
  return {
    warn: () => undefined,
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    // reason: real ReviewService/AuditService (not null-cast, unlike the
    // other unused services below) — the AC-074-3 exclusion this route now
    // implements reads real "reject"/"approve" audit entries, which only
    // ReviewService.reject/approve actually write.
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: null as unknown as App["versionService"],
    outlineService: null as unknown as App["outlineService"],
    migrationService: null as unknown as App["migrationService"],
    treeCheckService: null as unknown as App["treeCheckService"],
    apiKeyStore: stubApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: new AuditService(store, { verifySince: FAR_PAST }),
    auditVerifyRunner: inLoopAuditVerifyRunner(new AuditService(store, { verifySince: FAR_PAST })),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

function makeUrl(path: string): URL {
  return new URL(`http://localhost${path}`);
}

function req(path: string, headers?: Record<string, string>): Request {
  return new Request(`http://localhost${path}`, { method: "GET", headers: headers ?? {} });
}

async function getIssueReports(app: App, actor: ActorContext = COOKIE_ACTOR): Promise<Response> {
  const url = makeUrl("/api/issue-reports");
  const res = await handleApiRoute(req("/api/issue-reports"), url, app, actor);
  return res as Response;
}

interface IssueReportsBody {
  ok: boolean;
  data?: { rows: Record<string, unknown>[]; open_count: number };
  error?: Record<string, unknown>;
}

async function parseRes(res: Response): Promise<IssueReportsBody> {
  return res.json() as Promise<IssueReportsBody>;
}

async function createRootPrd(cs: CorpusService): Promise<string> {
  const result = await cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createPlan(cs: CorpusService, parentId: string): Promise<string> {
  const result = await cs.create({
    type: "plan",
    title: "Test Plan",
    parent_id: parentId,
    content: "body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

interface IssueReportOpts {
  title?: string;
  reported_at: string;
  reporter_project?: string;
  reporter_actor?: string;
  lore_version?: string;
  possible_duplicates?: string[];
  status?: "draft" | "in-review" | "approved";
}

/** Creates a task carrying `extra.issue_report` (mirrors the shape `lore report-issue` writes, SPEC-072). */
async function createIssueReportTask(
  cs: CorpusService,
  planId: string,
  opts: IssueReportOpts,
): Promise<{ id: string; slug: string }> {
  const createResult = await cs.create({
    type: "task",
    title: opts.title ?? "Issue report",
    parent_id: planId,
    content: "body",
    extra: {
      plan_id: planId,
      issue_report: {
        reporter_project: opts.reporter_project ?? "consumer-a",
        reporter_actor: opts.reporter_actor ?? "agent:consumer",
        lore_version: opts.lore_version ?? "0.5.0",
        expected: "exit 0",
        actual: "exit 4",
        reported_at: opts.reported_at,
        possible_duplicates: opts.possible_duplicates ?? [],
      },
    },
  } as CreateDocInput);
  if (!createResult.ok) throw new Error(`Failed to create issue-report task: ${JSON.stringify(createResult.error)}`);

  if (opts.status !== undefined && opts.status !== "draft") {
    const setResult = await cs.set(createResult.value.id, { status: opts.status });
    if (!setResult.ok) throw new Error(`Failed to set status: ${JSON.stringify(setResult.error)}`);
  }

  return { id: createResult.value.id, slug: createResult.value.slug };
}

/** A plain ad-hoc/self-authored task (no `extra.issue_report`) — must never appear in rows. */
async function createPlainTask(cs: CorpusService, planId: string, title = "Plain task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plain task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

const ALL_ROW_KEYS = [
  "id",
  "slug",
  "title",
  "reporter_project",
  "reporter_actor",
  "lore_version",
  "reported_at",
  "possible_duplicates",
  "status",
  "resolution",
] as const;

/**
 * Creates a "fixing" doc (a plain task, NOT itself carrying `extra.issue_report`)
 * and walks it through `draft -> approved -> active[-> archived]` (all valid
 * direct transitions), then links it to `issueId` via `resolves`. Returns the
 * fixing doc's id. `finalStatus` controls how far the walk goes:
 *   - `"approved"` — stops before `active` (computeIssueResolution's
 *     "resolving" case: an in-edge exists, no source doc is terminal yet).
 *   - `"active"` / `"archived"` — reaches a terminal status (the "fixed" case).
 */
async function createResolvesFix(
  cs: CorpusService,
  planId: string,
  issueId: string,
  finalStatus: "approved" | "active" | "archived",
): Promise<string> {
  const fixId = await createPlainTask(cs, planId, "Fixing doc");

  const approveResult = await cs.set(fixId, { status: "approved" });
  if (!approveResult.ok) throw new Error(`Failed to approve fix doc: ${JSON.stringify(approveResult.error)}`);
  if (finalStatus !== "approved") {
    const activeResult = await cs.set(fixId, { status: "active" });
    if (!activeResult.ok) throw new Error(`Failed to activate fix doc: ${JSON.stringify(activeResult.error)}`);
  }
  if (finalStatus === "archived") {
    const archivedResult = await cs.set(fixId, { status: "archived" });
    if (!archivedResult.ok) throw new Error(`Failed to archive fix doc: ${JSON.stringify(archivedResult.error)}`);
  }

  const linkResult = await cs.link(fixId, issueId, "resolves");
  if (!linkResult.ok) throw new Error(`Failed to create resolves link: ${JSON.stringify(linkResult.error)}`);

  return fixId;
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("GET /api/issue-reports (AC-074-5)", () => {
  it("AC-074-5 HAPPY: cookie session returns 200", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    await createIssueReportTask(app.corpusService, planId, { reported_at: "2026-07-20T00:00:00.000Z" });

    const res = await getIssueReports(app, COOKIE_ACTOR);
    expect(res.status).toBe(200);
    const body = await parseRes(res);
    expect(body.ok).toBe(true);
    expect(body.data!.rows.length).toBe(1);
  });

  it("AC-074-5 HAPPY: bearer token returns 200 (read-only)", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    await createIssueReportTask(app.corpusService, planId, { reported_at: "2026-07-20T00:00:00.000Z" });

    const res = await getIssueReports(app, BEARER_ACTOR);
    expect(res.status).toBe(200);
    const body = await parseRes(res);
    expect(body.ok).toBe(true);
    expect(body.data!.rows.length).toBe(1);
  });

  it("AC-074-5 HAPPY: field-exactness — each row carries exactly the 9 declared keys, response carries open_count", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    await createIssueReportTask(app.corpusService, planId, {
      reported_at: "2026-07-20T00:00:00.000Z",
      reporter_project: "consumer-a",
      reporter_actor: "agent:x",
      lore_version: "0.5.0",
      possible_duplicates: ["task-01ABC"],
    });

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    const row = body.data!.rows[0]!;

    expect(Object.keys(row).sort()).toEqual([...ALL_ROW_KEYS].sort());
    expect(row.reporter_project).toBe("consumer-a");
    expect(row.reporter_actor).toBe("agent:x");
    expect(row.lore_version).toBe("0.5.0");
    expect(row.reported_at).toBe("2026-07-20T00:00:00.000Z");
    expect(row.possible_duplicates).toEqual(["task-01ABC"]);
    expect(row.status).toBe("draft");
    expect(row.resolution).toBe("open"); // D7 — no resolves in-edge yet
    expect(typeof body.data!.open_count).toBe("number");
    expect(body.data!.open_count).toBe(1);
  });

  // ─── NEGATIVE ──────────────────────────────────────────────────────────────

  it("AC-074-5 NEGATIVE: no auth returns 401 (same shared gate every /api/* route inherits)", async () => {
    // reason: authenticateRequest is the REAL upstream gate (index.ts) every
    // /api/* route (including this one) sits behind. Neither cookie nor bearer
    // credential is present here, so it returns not-ok BEFORE ever touching
    // keyStore/sessionStore — the stubs below are never invoked on this path.
    const noAuthReq = req("/api/issue-reports");
    const authResult = await authenticateRequest(
      noAuthReq,
      stubApiKeyStore,
      undefined as unknown as SessionStore,
    );
    expect(authResult.ok).toBe(false);
    // Mirrors index.ts's exact mapping: an auth failure short-circuits to 401
    // before handleApiRoute (and therefore handleGetIssueReports) ever runs.
    if (!authResult.ok) {
      expect(authResult.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("AC-074-5 NEGATIVE: non-issue-report tasks are excluded from rows", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    await createPlainTask(app.corpusService, planId, "Just a regular task");
    await createIssueReportTask(app.corpusService, planId, { reported_at: "2026-07-20T00:00:00.000Z" });

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    expect(body.data!.rows.length).toBe(1);
    expect(body.data!.rows[0]!.title).toBe("Issue report");
  });

  it("AC-074-5 NEGATIVE: approved reports are excluded from the open set", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    await createIssueReportTask(app.corpusService, planId, {
      title: "Still open",
      reported_at: "2026-07-20T00:00:00.000Z",
    });
    await createIssueReportTask(app.corpusService, planId, {
      title: "Approved already",
      reported_at: "2026-07-19T00:00:00.000Z",
      status: "approved",
    });

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    expect(body.data!.rows.length).toBe(1);
    expect(body.data!.rows[0]!.title).toBe("Still open");
    expect(body.data!.open_count).toBe(1);
  });

  it("AC-074-3 NEGATIVE: a rejected report is excluded from the open set even though its status stays draft (SPEC-005 audit-trail invariant)", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    const stillOpen = await createIssueReportTask(app.corpusService, planId, {
      title: "Still open",
      reported_at: "2026-07-20T00:00:00.000Z",
    });
    const rejected = await createIssueReportTask(app.corpusService, planId, {
      title: "Rejected report",
      reported_at: "2026-07-21T00:00:00.000Z",
    });

    const rejectResult = await app.reviewService.reject(rejected.id, { reason: "not a lore defect" });
    if (!rejectResult.ok) throw new Error(JSON.stringify(rejectResult.error));
    // `ReviewService.reject` NEVER transitions a doc off draft (SPEC-005) —
    // the rejected report's status is still "draft" going into this route.
    expect(rejectResult.value.status).toBe("draft");

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    expect(body.data!.rows.length).toBe(1);
    expect(body.data!.rows[0]!.id).toBe(stillOpen.id);
    expect(body.data!.rows.some((r) => r.id === rejected.id)).toBe(false);
    expect(body.data!.open_count).toBe(1);
  });

  // ─── BOUNDARY ──────────────────────────────────────────────────────────────

  it("AC-074-5 BOUNDARY: zero reports returns 200 with empty rows and open_count 0, not an error", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    await createRootPrd(app.corpusService); // corpus with docs, but no issue reports

    const res = await getIssueReports(app);
    expect(res.status).toBe(200);
    const body = await parseRes(res);
    expect(body.ok).toBe(true);
    expect(body.data!.rows).toEqual([]);
    expect(body.data!.open_count).toBe(0);
  });

  it("AC-074-5 BOUNDARY: an entirely empty corpus (no docs at all) also returns 200 empty, not an error", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);

    const res = await getIssueReports(app);
    expect(res.status).toBe(200);
    const body = await parseRes(res);
    expect(body.data!.rows).toEqual([]);
    expect(body.data!.open_count).toBe(0);
  });

  // ─── ERROR ─────────────────────────────────────────────────────────────────

  it("AC-074-5 ERROR: a malformed extra.issue_report (wrong nested type) degrades gracefully rather than throwing", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    const createResult = await app.corpusService.create({
      type: "task",
      title: "Malformed report",
      parent_id: planId,
      content: "body",
      extra: { plan_id: planId, issue_report: { reporter_project: 12345, possible_duplicates: "not-an-array" } },
    } as CreateDocInput);
    if (!createResult.ok) throw new Error(JSON.stringify(createResult.error));

    const res = await getIssueReports(app);
    expect(res.status).toBe(200);
    const body = await parseRes(res);
    expect(body.data!.rows.length).toBe(1);
    const row = body.data!.rows[0]!;
    expect(row.reporter_project).toBe(""); // wrong type degrades to "", never throws
    expect(row.possible_duplicates).toEqual([]); // non-array degrades to []
  });

  // ─── STATE ─────────────────────────────────────────────────────────────────

  it("AC-074-5 STATE: rows are sorted reported_at descending (newest first)", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    await createIssueReportTask(app.corpusService, planId, { title: "Oldest", reported_at: "2026-07-01T00:00:00.000Z" });
    await createIssueReportTask(app.corpusService, planId, { title: "Newest", reported_at: "2026-07-23T00:00:00.000Z" });
    await createIssueReportTask(app.corpusService, planId, { title: "Middle", reported_at: "2026-07-10T00:00:00.000Z" });

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    const titles = body.data!.rows.map((r) => r.title);
    expect(titles).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("AC-074-5 STATE: an in-review report stays in the open set (only status leaving draft/in-review closes it)", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    await createIssueReportTask(app.corpusService, planId, {
      title: "In review",
      reported_at: "2026-07-20T00:00:00.000Z",
      status: "in-review",
    });

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    expect(body.data!.rows.length).toBe(1);
    expect(body.data!.rows[0]!.status).toBe("in-review");
  });

  it(
    "AC-074-3 STATE: a report rejected then re-approved and later reopened (content edit auto-demotes an approved doc to draft) is NOT excluded — a later approve supersedes the earlier reject",
    async () => {
      const store = actedStore(new InMemoryStore());
      const app = makeApp(store);
      const prdId = await createRootPrd(app.corpusService);
      const planId = await createPlan(app.corpusService, prdId);
      const report = await createIssueReportTask(app.corpusService, planId, {
        title: "Reopened report",
        reported_at: "2026-07-22T00:00:00.000Z",
      });

      // Reject first (audit "reject" entry #1) ...
      const rejectResult = await app.reviewService.reject(report.id, { reason: "premature" });
      if (!rejectResult.ok) throw new Error(JSON.stringify(rejectResult.error));

      // ... then a reviewer changes their mind and approves it (a real
      // draft -> approved transition is still legal after reject, since
      // reject never leaves `draft` — this "approve" audit entry is NEWER
      // than the reject above).
      const approveResult = await app.reviewService.approve(report.id, { reviewer: "reviewer-2" });
      if (!approveResult.ok) throw new Error(JSON.stringify(approveResult.error));
      expect(approveResult.value.status).toBe("approved");

      // Editing content on an approved doc auto-demotes it back to `draft`
      // (CorpusService's approved->draft auto-reset invariant) — the report
      // is under review again, with NO new reject entry since the approve.
      const editResult = await app.corpusService.set(report.id, { content: "updated report body" });
      if (!editResult.ok) throw new Error(JSON.stringify(editResult.error));
      expect(editResult.value.status).toBe("draft");

      const res = await getIssueReports(app);
      const body = await parseRes(res);
      expect(body.data!.rows.length).toBe(1);
      expect(body.data!.rows[0]!.id).toBe(report.id);
      expect(body.data!.open_count).toBe(1);
    },
  );

  // ─── D7 (spec-issue-closure-loop-computed-resolution-agent-reachable, AC-ICL-9) ──

  it("spec-issue-closure-loop-computed-resolution-agent-reachable#AC-ICL-9 HAPPY: a resolves in-edge from a non-terminal source computes 'resolving'", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    const issue = await createIssueReportTask(app.corpusService, planId, {
      title: "Being worked on",
      reported_at: "2026-07-20T00:00:00.000Z",
    });
    await createResolvesFix(app.corpusService, planId, issue.id, "approved");

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    expect(body.data!.rows.length).toBe(1);
    expect(body.data!.rows[0]!.resolution).toBe("resolving");
    expect(body.data!.open_count).toBe(0);
  });

  it("spec-issue-closure-loop-computed-resolution-agent-reachable#AC-ICL-9 HAPPY: a resolves in-edge from an archived source computes 'fixed'", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    const issue = await createIssueReportTask(app.corpusService, planId, {
      title: "Actually fixed",
      reported_at: "2026-07-20T00:00:00.000Z",
    });
    await createResolvesFix(app.corpusService, planId, issue.id, "archived");

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    expect(body.data!.rows.length).toBe(1);
    expect(body.data!.rows[0]!.resolution).toBe("fixed");
    expect(body.data!.open_count).toBe(0);
  });

  it("spec-issue-closure-loop-computed-resolution-agent-reachable#AC-ICL-9 STATE: an unclosed escalation — status stays 'draft' but resolution is 'fixed' — stays visible in rows while excluded from open_count", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    const stillOpen = await createIssueReportTask(app.corpusService, planId, {
      title: "Still open",
      reported_at: "2026-07-19T00:00:00.000Z",
    });
    const unclosedEscalation = await createIssueReportTask(app.corpusService, planId, {
      title: "Unclosed escalation",
      reported_at: "2026-07-20T00:00:00.000Z",
    });
    await createResolvesFix(app.corpusService, planId, unclosedEscalation.id, "active");

    const res = await getIssueReports(app);
    const body = await parseRes(res);

    // Both reports are still-governed (neither approved/rejected) so BOTH
    // remain in `rows` — the unclosed-escalation row is deliberately NOT
    // hidden, per spec's Overview (a hidden row would reproduce the exact
    // status-as-proxy failure D7/D8 remove).
    expect(body.data!.rows.length).toBe(2);
    const escalationRow = body.data!.rows.find((r) => r.id === unclosedEscalation.id);
    expect(escalationRow?.status).toBe("draft"); // never auto-advanced (D5(a) non-goal)
    expect(escalationRow?.resolution).toBe("fixed");
    const stillOpenRow = body.data!.rows.find((r) => r.id === stillOpen.id);
    expect(stillOpenRow?.resolution).toBe("open");

    // open_count counts ONLY the genuinely-open row — this is the numeric
    // proof that open_count is no longer a synonym for rows.length.
    expect(body.data!.open_count).toBe(1);
    expect(body.data!.open_count).toBeLessThan(body.data!.rows.length);
  });

  // ─── REGRESSION ────────────────────────────────────────────────────────────

  it("AC-074-5 REGRESSION: an unrelated v1 GET route on the same dispatcher is unaffected by the new route", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const url = makeUrl("/api/issue-reports");
    const res = await handleApiRoute(req("/api/issue-reports"), url, app, COOKIE_ACTOR);
    expect(res).not.toBeNull();

    const unmatchedUrl = makeUrl("/api/totally-unmatched");
    const unmatchedRes = await handleApiRoute(req("/api/totally-unmatched"), unmatchedUrl, app, COOKIE_ACTOR);
    expect(unmatchedRes).toBeNull();
  });

  it("AC-074-5 REGRESSION: open_count still equals rows.length when no row has a resolves edge (pre-D7 baseline — every row computes 'open')", async () => {
    const store = actedStore(new InMemoryStore());
    const app = makeApp(store);
    const prdId = await createRootPrd(app.corpusService);
    const planId = await createPlan(app.corpusService, prdId);
    await createIssueReportTask(app.corpusService, planId, { reported_at: "2026-07-20T00:00:00.000Z" });
    await createIssueReportTask(app.corpusService, planId, { reported_at: "2026-07-21T00:00:00.000Z" });

    const res = await getIssueReports(app);
    const body = await parseRes(res);
    expect(body.data!.open_count).toBe(body.data!.rows.length);
  });
});
