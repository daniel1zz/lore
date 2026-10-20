/**
 * SPEC-075 dashboard adjudication workbench e2e coverage (AC-075-4, R-8).
 *
 * Seeds an in-review task doc WITH real verification evidence (out-of-band
 * `page.request` PATCH — no dashboard UI writes `extra.verification_evidence`
 * directly, same division of labor `review-loop.pw.ts` documents for
 * `review_judgments`) plus an AI review judgment pinned to that exact doc
 * version (`seed-judgment.ts`, the SAME fixture helper `review-loop.pw.ts`
 * uses), then proves:
 *   1. AdjudicationBar's evidence-summary chips AND the approve/reject
 *      controls both render in `DocDetail`'s header — same screen, zero tab
 *      clicks / extra navigation (R-8).
 *   2. Adjudicating (approve, with a calibration note) through that SAME bar
 *      produces a calibration record whose fields — `doc_id`, judgment
 *      pairing (a non-null record after adjudication IS the pairing proof:
 *      `runCalibrationHook` silently skips on ANY version mismatch, so a
 *      populated "confirmed" row could only exist if `judgment.doc_version`
 *      matched the pre-approve doc version exactly), `human_outcome`
 *      ("confirmed" — both AI and human said "approve"), `actor`, and
 *      `delta_reasons` (the note) — are asserted field-by-field via a direct
 *      read-back, not visually (AC-075-4's "asserted via API read-back, not
 *      visually").
 *
 * Auth: no manual cookie minting — `global-setup.ts` boots Vite with
 * `VITE_LORE_BOOTSTRAP_TOKEN` set, so the first full page load triggers the
 * real `bootstrapAuthIfNeeded()` SPA path; `page.request` reuses that same
 * browser-context cookie jar for every out-of-band seed call below.
 *
 * Source: SPEC-075 §Acceptance Criteria AC-075-4; PRD §21 F1 (R-8).
 * @spec_ref AC-075-4
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ORIGIN = "http://localhost:8787";
const SEED_JUDGMENT_SCRIPT = join(__dirname, "seed-judgment.ts");
const READ_CALIBRATION_SCRIPT = join(__dirname, "read-calibration.ts");

/** Full shape `read-calibration.ts` actually prints (see its own JSDoc — a direct
 * `CalibrationRecord` read via `queryCalibrationWindow`, not a narrowed projection). */
interface CalibrationRecordRow {
  id: string;
  judgment_id: string;
  doc_id: string;
  doc_type: string;
  human_outcome: "confirmed" | "overridden";
  delta_reasons: string[];
  actor: string;
  created_at: string;
}

function seedJudgment(opts: {
  docId: string;
  docVersion: number;
  decision: "approve" | "reject" | "escalate";
  confidence: number;
  blockingQuestions: string[];
}): string {
  const dbPath = process.env.LORE_E2E_DB_PATH;
  if (dbPath === undefined) {
    throw new Error("LORE_E2E_DB_PATH is not set — global-setup.ts must run before this suite.");
  }
  const out = execFileSync("bun", [SEED_JUDGMENT_SCRIPT, dbPath, JSON.stringify(opts)], {
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();
  const id = out.trim().split("\n").pop();
  if (id === undefined || id.length === 0) {
    throw new Error(`seed-judgment.ts produced no id. stdout: ${out}`);
  }
  return id;
}

function readCalibrationRecord(docType: string, judgmentId: string): CalibrationRecordRow | null {
  const dbPath = process.env.LORE_E2E_DB_PATH;
  if (dbPath === undefined) {
    throw new Error("LORE_E2E_DB_PATH is not set.");
  }
  const out = execFileSync("bun", [READ_CALIBRATION_SCRIPT, dbPath, docType, judgmentId], {
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();
  return JSON.parse(out.trim()) as CalibrationRecordRow | null;
}

test.describe.configure({ mode: "serial" });

test.describe("SPEC-075 dashboard adjudication workbench", () => {
  let page: Page;
  const runId = Date.now();
  let planId = "";
  let taskId = "";
  let taskTitle = "";
  /** The task's version right before the human's approve action (the version the seeded judgment is pinned to). */
  let preApproveVersion = 0;
  let judgmentId = "";

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Trigger the real cookie-bootstrap path once up front — every page.request
    // call below shares this same authenticated browser-context cookie jar.
    await page.goto("/");
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("seed: in-review task with evidence + a matching-version approve judgment", async () => {
    taskTitle = `E2E Adjudication Task ${runId}`;

    const planRes = await page.request.post(`${API_ORIGIN}/api/dashboard/docs`, {
      headers: { "Content-Type": "application/json" },
      data: { type: "plan", title: `E2E Adjudication Plan ${runId}` },
    });
    expect(planRes.ok()).toBe(true);
    const planBody = (await planRes.json()) as { ok: true; data: { doc: { id: string } } };
    planId = planBody.data.doc.id;

    const taskRes = await page.request.post(`${API_ORIGIN}/api/dashboard/docs`, {
      headers: { "Content-Type": "application/json" },
      data: { type: "task", title: taskTitle, parent_id: planId, extra: { plan_id: planId } },
    });
    expect(taskRes.ok()).toBe(true);
    const taskBody = (await taskRes.json()) as { ok: true; data: { doc: { id: string; version: number } } };
    taskId = taskBody.data.doc.id;

    // draft -> in-review (a valid VALID_TRANSITIONS edge).
    const statusRes = await page.request.patch(`${API_ORIGIN}/api/dashboard/docs/${taskId}`, {
      headers: { "Content-Type": "application/json" },
      data: { status: "in-review" },
    });
    expect(statusRes.ok()).toBe(true);

    // Seed real verification evidence (out-of-band — no dashboard UI writes this field).
    const evidenceRes = await page.request.patch(`${API_ORIGIN}/api/dashboard/docs/${taskId}`, {
      headers: { "Content-Type": "application/json" },
      data: {
        extra: {
          plan_id: planId,
          verification_evidence: [
            {
              oracle: "test",
              command: "bunx vitest run packages/dashboard",
              result: "pass",
              recorded_at: new Date().toISOString(),
              recorded_by: "e2e-runner",
            },
          ],
        },
      },
    });
    expect(evidenceRes.ok()).toBe(true);
    const evidenceBody = (await evidenceRes.json()) as { ok: true; data: { doc: { version: number } } };
    preApproveVersion = evidenceBody.data.doc.version;

    // Seed an AI "approve" judgment pinned to the EXACT current version — the
    // version the human is about to act on through AdjudicationBar.
    judgmentId = seedJudgment({
      docId: taskId,
      docVersion: preApproveVersion,
      decision: "approve",
      confidence: 0.88,
      blockingQuestions: [],
    });
  });

  test("R-8: AdjudicationBar evidence summary + approve/reject render on the same screen, no extra navigation", async () => {
    await page.goto(`/docs/${taskId}`);
    await expect(page.getByRole("heading", { name: taskTitle })).toBeVisible();

    // Same screen, no tab click: the header region shows both the evidence
    // summary (AdjudicationBar's chips) AND the approve/reject controls.
    // reason: `aria-label` on a plain `<div>` (no ARIA form role) — Playwright's
    // getByLabel targets form-control label association, not arbitrary aria-label
    // divs; the raw attribute selector is the unambiguous match for this markup.
    const adjudicationBar = page.locator('[aria-label="Adjudication"]');
    await expect(adjudicationBar).toBeVisible();

    const evidenceSummary = adjudicationBar.locator('[aria-label="Evidence summary"]');
    await expect(evidenceSummary).toBeVisible();
    await expect(evidenceSummary.getByText("1 evidence")).toBeVisible();
    // reason: the seeded evidence entry is self-reported (no `attestation` object) —
    // "0 attested" pins that, guarding against a false "1 attested" regression.
    await expect(evidenceSummary.getByText("0 attested")).toBeVisible();

    await expect(adjudicationBar.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(adjudicationBar.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("adjudicate: approving with a calibration note produces a field-by-field-correct calibration record", async () => {
    await page.goto(`/docs/${taskId}`);
    const adjudicationBar = page.locator('[aria-label="Adjudication"]');
    await expect(adjudicationBar).toBeVisible();

    const noteText = "Matches the AI judgment — confirming.";
    await adjudicationBar.getByLabel(`Calibration note for ${taskTitle}`).fill(noteText);
    await adjudicationBar.getByRole("button", { name: "Approve" }).click();

    await expect(page.getByText("Document approved", { exact: true })).toBeVisible();

    // Read back the doc — proves the approve transition actually bumped the version
    // by exactly 1 over the version the seeded judgment was pinned to.
    const docRes = await page.request.get(`${API_ORIGIN}/api/docs/${taskId}`);
    expect(docRes.ok()).toBe(true);
    const docBody = (await docRes.json()) as { ok: true; data: { doc: { version: number; status: string } } };
    expect(docBody.data.doc.status).toBe("approved");
    expect(docBody.data.doc.version).toBe(preApproveVersion + 1);

    // Field-by-field calibration record assertion (AC-075-4) — read via the SAME
    // direct-SQLite-read fixture path review-loop.pw.ts established (no dashboard
    // UI surfaces raw calibration rows to assert against otherwise).
    const record = readCalibrationRecord("task", judgmentId);
    expect(record).not.toBeNull();
    // A non-null record IS the judgment-pairing proof: runCalibrationHook silently
    // skips (writes nothing) on ANY doc_version mismatch between the judgment and
    // the version the human acted on — see calibration-hook.ts's documented invariant.
    expect(record?.judgment_id).toBe(judgmentId);
    expect(record?.doc_id).toBe(taskId);
    expect(record?.doc_type).toBe("task");
    expect(record?.human_outcome).toBe("confirmed"); // AI said approve, human approved
    // The reviewer is the cookie login's owner: this suite runs under `lore serve` (no human-session wiring), and the
    // machine-wide dashboard-local key minted by ensureLocalApiKey is owned by its own placeholder name (GitHub #324).
    expect(record?.actor).toBe("dashboard-local");
    expect(record?.delta_reasons).toEqual([noteText]); // note -> delta_reasons[0]
  });
});
