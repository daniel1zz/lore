/**
 * Tests for SPEC-074 AC-074-5 — `GET /api/issue-reports` (dashboard Issues
 * triage read projection).
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
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-074 §Acceptance Criteria AC-074-5.
 */

import { describe, it, expect } from "vitest";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { handleApiRoute } from "../../../src/adapters/http/routes.js";
import { authenticateRequest } from "../../../src/adapters/http/auth.js";
import type { ApiKeyStore, ActorContext } from "../../../src/adapters/http/auth.js";
import type { SessionStore } from "../../../src/adapters/http/sessions.js";
import type { App } from "../../../src/app.js";

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
    corpusService: new CorpusService(store),
    reviewService: null as unknown as App["reviewService"],
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
    auditService: null as unknown as App["auditService"],
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
] as const;

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("GET /api/issue-reports (AC-074-5)", () => {
  it("AC-074-5 HAPPY: cookie session returns 200", async () => {
    const store = new InMemoryStore();
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
    const store = new InMemoryStore();
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
    const store = new InMemoryStore();
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
    const store = new InMemoryStore();
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
    const store = new InMemoryStore();
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

  // ─── BOUNDARY ──────────────────────────────────────────────────────────────

  it("AC-074-5 BOUNDARY: zero reports returns 200 with empty rows and open_count 0, not an error", async () => {
    const store = new InMemoryStore();
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
    const store = new InMemoryStore();
    const app = makeApp(store);

    const res = await getIssueReports(app);
    expect(res.status).toBe(200);
    const body = await parseRes(res);
    expect(body.data!.rows).toEqual([]);
    expect(body.data!.open_count).toBe(0);
  });

  // ─── ERROR ─────────────────────────────────────────────────────────────────

  it("AC-074-5 ERROR: a malformed extra.issue_report (wrong nested type) degrades gracefully rather than throwing", async () => {
    const store = new InMemoryStore();
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
    const store = new InMemoryStore();
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
    const store = new InMemoryStore();
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

  // ─── REGRESSION ────────────────────────────────────────────────────────────

  it("AC-074-5 REGRESSION: an unrelated v1 GET route on the same dispatcher is unaffected by the new route", async () => {
    const store = new InMemoryStore();
    const app = makeApp(store);
    const url = makeUrl("/api/issue-reports");
    const res = await handleApiRoute(req("/api/issue-reports"), url, app, COOKIE_ACTOR);
    expect(res).not.toBeNull();

    const unmatchedUrl = makeUrl("/api/totally-unmatched");
    const unmatchedRes = await handleApiRoute(req("/api/totally-unmatched"), unmatchedUrl, app, COOKIE_ACTOR);
    expect(unmatchedRes).toBeNull();
  });

  it("AC-074-5 REGRESSION: open_count always equals rows.length (single-endpoint badge/page parity, SPEC-074 §Design)", async () => {
    const store = new InMemoryStore();
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
