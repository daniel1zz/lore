/**
 * AC-HR-3 — the decision / audit-item read routes are authenticated and PURE.
 *
 * Throwaway in-memory corpus + a real in-process Bun.Server (same harness as feedback-loop-routes.bun.test.ts).
 * Dimensions: HAPPY (cookie + agent key 200, detail/label/factors/commands), NEGATIVE (401, 404, 422),
 * STATE (a STALE pending decision survives every read untouched), BOUNDARY (pre-detail label).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoOpTelemetry } from "@lore/core";
import { ApiKeyStore } from "../../src/adapters/http/auth.js";
import { SessionStore } from "../../src/adapters/http/sessions.js";
import { startHttpServer } from "../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../src/adapters/http/machine-auth.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { ReviewService } from "../../src/service/review-service.js";
import { VersionService } from "../../src/service/version-service.js";
import { OutlineService } from "../../src/service/outline-service.js";
import { MigrationService } from "../../src/service/migration-service.js";
import { TreeCheckService } from "../../src/service/tree-check-service.js";
import { JudgmentService } from "../../src/service/judgment-service.js";
import { AuditService } from "../../src/service/audit-service.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { DecisionService } from "../../src/service/decision-service.js";
import { decisionChainHead, NO_DETAIL_TEXT, type DecisionRecordInput } from "../../src/store/decision-log.js";
import { MIGRATION_002_SQL } from "../../src/store/migrations/migration-002.js";
import type { App } from "../../src/app.js";
import { actedStore, liveIo } from "../live-invocation.js";
import { inLoopAuditVerifyRunner } from "../support/audit-verify-runner-stub.js";

const FAR_PAST = "2000-01-01T00:00:00.000Z";
const DETAIL = {
  summary: "Loosen the auto threshold of class doc-edit from 0.9 to 0.8",
  requested_by: "an agent session",
  change: { entry: "doc-edit", before: 0.9, after: 0.8 },
  on_accept: "doc-edit decisions auto-approve at score 0.8 and above",
  on_reject: "the threshold stays at 0.9",
};

function row(over: Partial<DecisionRecordInput>): DecisionRecordInput {
  return {
    ts: "2026-10-01T00:00:00.000Z",
    class: "doc-edit",
    subject_id: "subj",
    subject_version: "v1",
    facts: "{}",
    factors: "{}",
    score: 0.4,
    threshold: 0.8,
    verdict: "escalate",
    reasons: JSON.stringify(["weakest factor is coverage"]),
    executor_run: null,
    channel: "machine",
    ...over,
  };
}

interface Ctx {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  store: InMemoryStore;
  db: Database;
  machineAuth: MachineAuthStores;
  rawKey: string;
  machineRawKey: string;
  baseUrl: string;
  /** id of the stale pending decision (newer version re-measured). */
  staleId: number;
  /** id of the open decision recorded with a detail. */
  detailedId: number;
  /** id of the open decision recorded before detail existed. */
  legacyId: number;
  /** id of the audit item (10th auto decision of its class). */
  auditId: number;
}

async function seed(store: InMemoryStore): Promise<Pick<Ctx, "staleId" | "detailedId" | "legacyId" | "auditId">> {
  const must = async (input: DecisionRecordInput): Promise<number> => {
    const r = await store.appendDecisionRecord(input);
    if (!r.ok) throw new Error(`seed append failed: ${r.error.code}`);
    return r.value.id;
  };
  const staleId = await must(row({ subject_id: "stale-subject", subject_version: "v1" }));
  await must(row({ subject_id: "stale-subject", subject_version: "v2", verdict: "auto", score: 0.95 })); // re-measured -> stale
  const detailedId = await must(
    row({
      subject_id: "governed-entry",
      factors: JSON.stringify({ coverage: 0.4, blast_radius: 0.9 }),
      score: 0.4,
      detail: JSON.stringify(DETAIL),
    }),
  );
  const legacyId = await must(row({ subject_id: "legacy-subject", factors: JSON.stringify({ coverage: 0.7 }), score: 0.7 }));
  let auditId = 0;
  for (let i = 1; i <= 10; i += 1) {
    auditId = await must(row({ class: "audit-class", subject_id: `auto-${i}`, verdict: "auto", score: 0.9, threshold: 0.5, factors: JSON.stringify({ coverage: 0.9 }) }));
  }
  return { staleId, detailedId, legacyId, auditId };
}

async function makeCtx(): Promise<Ctx> {
  const db = new Database(":memory:");
  db.exec(MIGRATION_002_SQL);
  const apiKeyStore = new ApiKeyStore(db);
  const docStore = actedStore(new InMemoryStore());
  const store = new InMemoryStore();
  const ids = await seed(store);
  const locks = new RecordLockService(docStore, new GateEnforcer(undefined));
  const app: App = {
    warn: () => undefined,
    corpusService: new CorpusService(docStore, locks),
    reviewService: new ReviewService(docStore, locks),
    versionService: new VersionService(docStore, locks),
    outlineService: new OutlineService(docStore),
    migrationService: new MigrationService(docStore),
    treeCheckService: new TreeCheckService(docStore),
    apiKeyStore,
    sessionStore: new SessionStore(db),
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(docStore, new NoOpTelemetry()),
    auditService: new AuditService(docStore, { verifySince: FAR_PAST }),
    auditVerifyRunner: inLoopAuditVerifyRunner(new AuditService(docStore, { verifySince: FAR_PAST })),
    callerSurface: "cli" as const,
    resolveAiDefault: () => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    decisionReadService: new DecisionService({ store, executorRun: null }),
    close: () => db.close(),
  };
  const key = await apiKeyStore.create("read-agent", "owner");
  if (!key.ok) throw new Error("api key create failed");
  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-decision-read-test-")) });
  const machineKey = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
  if (!machineKey.ok) throw new Error("machine key create failed");
  const server = startHttpServer(app, { io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
  return { server, app, store, db, machineAuth, rawKey: key.value.rawKey, machineRawKey: machineKey.value.rawKey, baseUrl: `http://127.0.0.1:${server.port}`, ...ids };
}

async function cookieFor(ctx: Ctx): Promise<string> {
  const res = await fetch(`${ctx.baseUrl}/api/auth/local-bootstrap`, {
    method: "POST",
    headers: { "X-Lore-Token": ctx.machineRawKey, Origin: "http://localhost:5173" },
  });
  const body = (await res.json()) as { data: { session_id: string } };
  return `lore_sid=${body.data.session_id}`;
}

interface View {
  kind: string;
  id: number;
  summary: string;
  detail: Record<string, unknown> | null;
  factors: Record<string, number>;
  recommendation: { answer: string; reason: string } | null;
  answer_commands: { accept: string; reject: string };
}

describe("AC-HR-3 decision read routes", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await makeCtx();
  });
  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    ctx.machineAuth.db.close();
  });

  const paths = (c: Ctx): string[] => ["/api/decisions", `/api/decisions/${c.detailedId}`, "/api/audit-items"];

  it("AC-HR-3 NEGATIVE: 401 with no credentials on all three routes", async () => {
    for (const p of paths(ctx)) expect((await fetch(`${ctx.baseUrl}${p}`)).status).toBe(401);
  });

  it("AC-HR-3 HAPPY: 200 with a browser session cookie and with an agent key", async () => {
    const cookie = await cookieFor(ctx);
    for (const p of paths(ctx)) {
      expect((await fetch(`${ctx.baseUrl}${p}`, { headers: { Cookie: cookie } })).status).toBe(200);
      expect((await fetch(`${ctx.baseUrl}${p}`, { headers: { Authorization: `Bearer ${ctx.rawKey}` } })).status).toBe(200);
    }
  });

  it("AC-HR-3 STATE: reading all three leaves the row count and chain head unchanged on a corpus with a STALE pending decision", async () => {
    const before = await ctx.store.listDecisionLog();
    if (!before.ok) throw new Error("list failed");
    const headBefore = decisionChainHead(before.value);
    const auth = { headers: { Authorization: `Bearer ${ctx.rawKey}` } };
    for (const p of paths(ctx)) expect((await fetch(`${ctx.baseUrl}${p}`, auth)).status).toBe(200);
    expect((await fetch(`${ctx.baseUrl}/api/decisions/${ctx.staleId}`, auth)).status).toBe(404); // stale is not open; reading did not close it by writing
    const after = await ctx.store.listDecisionLog();
    if (!after.ok) throw new Error("list failed");
    expect(after.value.length).toBe(before.value.length);
    expect(decisionChainHead(after.value)).toEqual(headBefore);
    // Control: the writing path really appends a marker for the stale decision, so this test can go red.
    const writes = new DecisionService({ store: ctx.store, executorRun: null });
    const listed = await writes.listPending();
    if (!listed.ok) throw new Error("listPending failed");
    const afterWrite = await ctx.store.listDecisionLog();
    if (!afterWrite.ok) throw new Error("list failed");
    expect(afterWrite.value.length).toBe(before.value.length + 1);
  });

  it("AC-HR-3 NEGATIVE: an unknown id returns 404; a malformed id returns 422", async () => {
    const auth = { headers: { Authorization: `Bearer ${ctx.rawKey}` } };
    expect((await fetch(`${ctx.baseUrl}/api/decisions/999999`, auth)).status).toBe(404);
    expect((await fetch(`${ctx.baseUrl}/api/decisions/abc`, auth)).status).toBe(422);
  });

  it("AC-HR-3 HAPPY: an open decision serves its detail, factors by name, recommendation and answer commands", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/decisions/${ctx.detailedId}`, { headers: { Authorization: `Bearer ${ctx.rawKey}` } });
    const { data } = (await res.json()) as { data: View };
    expect(data.kind).toBe("decision");
    expect(data.summary).toBe(DETAIL.summary);
    expect(data.detail).toEqual(DETAIL);
    expect(data.factors).toEqual({ coverage: 0.4, blast_radius: 0.9 });
    expect(data.recommendation?.answer).toBe("reject");
    expect(data.answer_commands).toEqual({ accept: `lore decide ${ctx.detailedId} --accept`, reject: `lore decide ${ctx.detailedId} --reject` });
  });

  it("AC-HR-3 BOUNDARY: a decision recorded before detail existed carries the exact honest label", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/decisions/${ctx.legacyId}`, { headers: { Authorization: `Bearer ${ctx.rawKey}` } });
    const { data } = (await res.json()) as { data: View };
    expect(data.summary).toBe("no detail recorded (decided before detail existed)");
    expect(data.summary).toBe(NO_DETAIL_TEXT);
    expect(data.detail).toBeNull();
  });

  it("AC-HR-3 HAPPY: an audit item is served by the same route, marked kind=audit, and listed by /api/audit-items", async () => {
    const auth = { headers: { Authorization: `Bearer ${ctx.rawKey}` } };
    const one = (await (await fetch(`${ctx.baseUrl}/api/decisions/${ctx.auditId}`, auth)).json()) as { data: View };
    expect(one.data.kind).toBe("audit");
    expect(one.data.factors).toEqual({ coverage: 0.9 });
    expect(one.data.answer_commands.accept).toBe(`lore decide ${ctx.auditId} --accept`);
    const list = (await (await fetch(`${ctx.baseUrl}/api/audit-items`, auth)).json()) as { data: View[] };
    expect(list.data.map((v) => v.id)).toEqual([ctx.auditId]);
    const open = (await (await fetch(`${ctx.baseUrl}/api/decisions`, auth)).json()) as { data: View[] };
    expect(open.data.map((v) => v.id)).toEqual([ctx.detailedId, ctx.legacyId]); // stale one excluded; audit item is not an open decision
  });
});
