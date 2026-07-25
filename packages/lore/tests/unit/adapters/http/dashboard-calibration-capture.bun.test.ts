/**
 * @spec_ref SPEC-033 F1
 *
 * HTTP calibration capture end-to-end test — proves the dashboard's
 * `/api/dashboard/docs/:id/approve` route runs the SAME implicit calibration
 * hook the CLI `approve` command runs (SPEC-035 §3 D3, hoisted surface-neutral
 * in SPEC-033 F1), against a REAL `SQLiteStore` (not `InMemoryStore`) — the
 * calibration_records / review_judgments tables carry real FK constraints
 * (see `calibration-cli.bun.test.ts`'s header for the FK note), so a genuine
 * bun:sqlite-backed store is required to exercise the full write path.
 *
 * Six-dimension coverage:
 *   HAPPY:      seed doc + judgment directly via the store, POST approve with a
 *               real cookie session → the calibration_records table gains a
 *               `confirmed` row pinned to the judgment (approve matches the AI's
 *               own "approve" decision)
 *   NEGATIVE:   n/a — covered by the hook's own unit tests (tests/unit/flows/)
 *   BOUNDARY:   n/a — decision-pairing matrix is covered by the hook's own unit
 *               tests; this file only needs one real end-to-end pairing
 *   ERROR:      a forced `insertCalibrationRecord` failure (subclassed
 *               SQLiteStore) surfaces in the response's `warnings: string[]` —
 *               NEVER a 5xx, NEVER a rollback of the already-succeeded approve
 *   STATE:      after the forced-failure approve, the doc's status is STILL
 *               "approved" (the calibration failure did not undo the transition)
 *   REGRESSION: the response envelope's `warnings` field is `[]` (not absent,
 *               not undefined) on the happy path — a stable, always-present field
 *
 * @spec_ref SPEC-035 §3 D3; SPEC-033 F1
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SQLiteStore } from "../../../../src/store/sqlite-store.js";
import { ApiKeyStore } from "../../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../../src/adapters/http/sessions.js";
import { startHttpServer } from "../../../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../../src/adapters/http/machine-auth.js";
import { CorpusService } from "../../../../src/service/corpus-service.js";
import { ReviewService } from "../../../../src/service/review-service.js";
import { VersionService } from "../../../../src/service/version-service.js";
import { OutlineService } from "../../../../src/service/outline-service.js";
import { MigrationService } from "../../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../../src/service/tree-check-service.js";
import { JudgmentService } from "../../../../src/service/judgment-service.js";
import { AuditService } from "../../../../src/service/audit-service.js";
import { NoOpTelemetry, err } from "@lore/core";
import type { App } from "../../../../src/app.js";
import type { CalibrationRecord, LoreError, Result } from "@lore/core";

const FAR_PAST = "2000-01-01T00:00:00.000Z";

// ─── A SQLiteStore subclass that forces insertCalibrationRecord to fail ──────
// Mirrors `FailingCalibrationStore extends InMemoryStore` in
// tests/unit/flows/calibration-hook.test.ts — same forcing technique, over the
// real bun:sqlite-backed store instead of the in-memory test double.
class FailingCalibrationSQLiteStore extends SQLiteStore {
  override async insertCalibrationRecord(_record: CalibrationRecord): Promise<Result<void, LoreError>> {
    return err({ code: "STORE_ERROR", message: "forced failure (test)" });
  }
}

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  store: SQLiteStore;
  rawKey: string;
  // reason: SPEC-078 D1 — the cookie-bootstrap flow (bootstrapCookie below) mints
  // "dashboard-local" on this MACHINE-scope store, never the per-corpus app.apiKeyStore.
  machineAuth: MachineAuthStores;
  baseUrl: string;
  tmpDir: string;
}

/**
 * Build a real App backed by a SQLiteStore (optionally the forced-failure
 * subclass) — hand-wired rather than `createApp()` so a test can inject the
 * failing subclass; mirrors `buildAppFromSqlite`'s wiring in `app.ts`.
 */
async function makeTestServer(useFailingStore: boolean): Promise<TestContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-dashboard-calibration-"));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const dbPath = join(loreDir, "lore.db");

  const store = useFailingStore ? new FailingCalibrationSQLiteStore(dbPath) : new SQLiteStore(dbPath);
  const db = store.getDatabase();
  const telemetry = new NoOpTelemetry();

  const app: App = {
    corpusService: new CorpusService(store, telemetry),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: new ApiKeyStore(db),
    sessionStore: new SessionStore(db),
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(store, telemetry),
    auditService: new AuditService(store, { verifySince: FAR_PAST }),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry,
    close: () => { store.close(); },
  };

  // reason: SPEC-078 D1 — "dashboard-local" is minted on the MACHINE store; the
  // per-corpus app.apiKeyStore never sees this key. mkdtemp per call — never the real
  // XDG state path (root CLAUDE.md 2026-07-07 pollution-incident rule).
  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-calibration-machine-auth-")) });
  const createResult = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
  if (!createResult.ok) throw new Error("Failed to create API key");
  const rawKey = createResult.value.rawKey;

  const server = startHttpServer(app, { port: 0, host: "127.0.0.1", machineAuth });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return { server, app, store, rawKey, machineAuth, baseUrl, tmpDir };
}

async function bootstrapCookie(ctx: TestContext): Promise<string> {
  const res = await fetch(`${ctx.baseUrl}/api/auth/local-bootstrap`, {
    method: "POST",
    headers: { "X-Lore-Token": ctx.rawKey, Origin: "http://localhost:5173" },
  });
  const { data } = await res.json() as { data: { session_id: string } };
  return data.session_id;
}

/**
 * Seed a draft doc, transition it to in-review (bumping version 1 -> 2), and
 * record an AI judgment PINNED to that version (2) — the exact version the
 * doc is at right before the HTTP approve call, so the hook's version-pin
 * check (`judgment.doc_version === actedOnVersion`) is satisfied.
 */
async function seedDocWithJudgment(app: App, decision: "approve" | "reject"): Promise<string> {
  const createResult = await app.corpusService.create({ type: "prd", title: "Calibration Capture Doc" });
  if (!createResult.ok) throw new Error("failed to create doc");
  const docId = createResult.value.id;

  const inReviewResult = await app.corpusService.set(docId, { status: "in-review" });
  if (!inReviewResult.ok) throw new Error("failed to set in-review");
  expect(inReviewResult.value.version).toBe(2);

  const judgmentResult = await app.judgmentService.record({
    doc_id: docId,
    doc_version: 2,
    decision,
    confidence: 0.92,
    reasons: [{ dimension: "completeness", finding: "Looks complete" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
  });
  if (!judgmentResult.ok) throw new Error("failed to record judgment");

  return docId;
}

// ─── HAPPY: real calibration capture over SQLiteStore ────────────────────────

describe("HTTP calibration capture end-to-end (SQLiteStore)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer(false);
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    ctx.machineAuth.db.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it("POST /api/dashboard/docs/:id/approve persists a 'confirmed' calibration row and returns warnings: []", async () => {
    const docId = await seedDocWithJudgment(ctx.app, "approve");
    const sessionId = await bootstrapCookie(ctx);

    const res = await fetch(`${ctx.baseUrl}/api/dashboard/docs/${docId}/approve`, {
      method: "POST",
      headers: { Cookie: `lore_sid=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { doc: { status: string }; warnings: string[] } };
    expect(body.ok).toBe(true);
    expect(body.data.doc.status).toBe("approved");
    expect(body.data.warnings).toEqual([]);

    const windowResult = await ctx.store.queryCalibrationWindow({ limit: 200 });
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    const row = windowResult.value.find((r) => r.doc_id === docId);
    expect(row).toBeDefined();
    expect(row?.human_outcome).toBe("confirmed");
  });

  it("calibration_note in the request body flows into the persisted row's delta_reasons[0]", async () => {
    const docId = await seedDocWithJudgment(ctx.app, "reject");
    const sessionId = await bootstrapCookie(ctx);

    // reason: human rejects (matching AC-DASH-WRITE-4-style flow) — the doc must be
    // in-review to reject too, which seedDocWithJudgment already arranged.
    const res = await fetch(`${ctx.baseUrl}/api/dashboard/docs/${docId}/reject`, {
      method: "POST",
      headers: { Cookie: `lore_sid=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "needs more detail", calibration_note: "AI missed an edge case" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { warnings: string[] } };
    expect(body.data.warnings).toEqual([]);

    const windowResult = await ctx.store.queryCalibrationWindow({ limit: 200 });
    if (!windowResult.ok) throw new Error("expected calibration window query to succeed");
    const row = windowResult.value.find((r) => r.doc_id === docId);
    expect(row?.human_outcome).toBe("confirmed"); // reject vs AI "reject" -> confirmed
    expect(row?.delta_reasons).toEqual(["AI missed an edge case"]);
  });
});

// ─── ERROR: forced calibration write failure ─────────────────────────────────

describe("HTTP calibration capture — forced hook failure (SQLiteStore)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer(true);
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    ctx.machineAuth.db.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it("approve still returns 200 and the doc is still approved, but response.warnings is non-empty", async () => {
    const docId = await seedDocWithJudgment(ctx.app, "approve");
    const sessionId = await bootstrapCookie(ctx);

    const res = await fetch(`${ctx.baseUrl}/api/dashboard/docs/${docId}/approve`, {
      method: "POST",
      headers: { Cookie: `lore_sid=${sessionId}` },
    });

    // reason: SPEC-033 F1's core contract — calibration is a byproduct, never a gate.
    // A write failure inside the hook must NEVER surface as a 5xx and must NEVER
    // roll back the already-succeeded approve.
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { doc: { status: string }; warnings: string[] } };
    expect(body.ok).toBe(true);
    expect(body.data.doc.status).toBe("approved");
    expect(body.data.warnings.length).toBeGreaterThan(0);
    expect(body.data.warnings[0]).toContain("approved, but calibration record failed:");
  });
});
