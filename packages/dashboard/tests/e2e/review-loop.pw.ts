/**
 * SPEC-033 F2/F3/F4 dashboard feedback-loop e2e coverage.
 *
 * Covers the new surfaces the read-flow/write-flow suites predate:
 *   - Home (`/`) as the resolved living PRD (`ResolvedPrdBody`, F2) — asserts real
 *     MDX-placeholder-to-React splicing (a `ChildrenOf` placeholder resolves to a
 *     typed doc list, never raw `<ChildrenOf` tag text — AC-33-1).
 *   - `/pending` TriageQueue (F3) — AI judgment badges, the escalated-only filter,
 *     blocking-question expansion, and inline adjudicate-with-calibration-note.
 *   - The implicit calibration capture the adjudicate action triggers
 *     (`packages/lore/src/flows/calibration-hook.ts`, SPEC-033 F1/SPEC-035),
 *     verified by reading the `calibration_records` row back directly off the
 *     fixture's SQLite file (no dashboard UI surfaces raw calibration rows).
 *   - DocDetail's "audit" tab (F3) — `parseAuditActor`-decoded judge-identity badge
 *     for the seeded AI judgment plus the human "approve" entry.
 *
 * Judgment seeding: no dashboard UI creates a `review_judgments` row (SPEC-034's
 * `lore review` is a CLI/MCP-only AI-judge invocation). `seed-judgment.ts` opens the
 * SAME SQLite file the running `lore serve` process has open (via `SQLiteStore`,
 * `insertJudgment` — documented as a dual production+seed method,
 * `packages/lore/src/store/store-interface.ts`) as a separate `bun` child process,
 * and writes the same `judge` audit entry `JudgmentService.record()` would. The
 * fixture DB path is published by `global-setup.ts` via `process.env.LORE_E2E_DB_PATH`
 * (see that file's comment on why an env var, not a shared in-process variable).
 *
 * PRD singularity: `CorpusService.tree()` defaults to "the first PRD found" when no
 * root id is given, and `read-flow.pw.ts` already documents itself as the sole PRD
 * creator for this shared throwaway corpus. This suite therefore NEVER creates a
 * second top-level PRD — the "home" scenario below fetches whatever PRD already
 * exists (creating exactly one, order-independently, only if none exists yet) and
 * mutates only its `content` (never `title`/`type`), so it cannot break read-flow's
 * "first PRD" assumption regardless of which suite happens to run first.
 *
 * Auth: no manual cookie minting — `global-setup.ts` boots Vite with
 * `VITE_LORE_BOOTSTRAP_TOKEN` set, so the first full page load triggers the real
 * `bootstrapAuthIfNeeded()` SPA path (SPEC-016 §3.8); `page.request` reuses that same
 * browser-context cookie jar for out-of-band calls, exactly like write-flow.pw.ts's
 * "conflict" test.
 *
 * Source: SPEC-033 §2.2 (F2), §3 (F3), F1 (calibration hook); PRD-001 §13.5.
 * @spec_ref AC-33-1, SPEC-033-F2, SPEC-033-F3, SPEC-033-F1
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ORIGIN = "http://localhost:8787";

/**
 * Create a requirements document out-of-band and return its slug: the parent a plan created through the
 * New doc form must name (BR-709 refuses a plan without one). The page must already carry the session cookie.
 */
async function createParentPrdSlug(page: Page, label: string): Promise<string> {
  const response = await page.request.post(`${API_ORIGIN}/api/dashboard/docs`, {
    headers: { "Content-Type": "application/json" },
    data: { type: "prd", title: `E2E Parent PRD ${label} ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { ok: true; data: { doc: { slug: string } } };
  return body.data.doc.slug;
}
const SEED_JUDGMENT_SCRIPT = join(__dirname, "seed-judgment.ts");
const READ_CALIBRATION_SCRIPT = join(__dirname, "read-calibration.ts");

interface SeedJudgmentOpts {
  docId: string;
  docVersion: number;
  decision: "approve" | "reject" | "escalate";
  confidence: number;
  blockingQuestions: string[];
}

/** Runs `seed-judgment.ts` in a separate `bun` process; returns the inserted judgment's id. */
function seedJudgment(opts: SeedJudgmentOpts): string {
  const dbPath = process.env.LORE_E2E_DB_PATH;
  if (dbPath === undefined) {
    throw new Error(
      "LORE_E2E_DB_PATH is not set — global-setup.ts must run before this suite (see its comment).",
    );
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

/** Runs `read-calibration.ts`; returns the matching calibration record, or `null`. */
function readCalibrationRecord(docType: string, judgmentId: string): { human_outcome: string } | null {
  const dbPath = process.env.LORE_E2E_DB_PATH;
  if (dbPath === undefined) {
    throw new Error("LORE_E2E_DB_PATH is not set.");
  }
  const out = execFileSync("bun", [READ_CALIBRATION_SCRIPT, dbPath, docType, judgmentId], {
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();
  return JSON.parse(out.trim()) as { human_outcome: string } | null;
}

test.describe.configure({ mode: "serial" });

test.describe("SPEC-033 dashboard feedback-loop", () => {
  let page: Page;
  const runId = Date.now();

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Trigger the real cookie-bootstrap path once up front so every subsequent
    // page.request call in this file (which shares the browser-context cookie
    // jar) is already authenticated.
    await page.goto("/");
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── 1. HOME: resolved living PRD renders ChildrenOf as typed React ──────────

  test("home: renders the PRD title and a ChildrenOf-derived doc list, never raw tag text", async () => {
    // Resolve (or, only if genuinely absent, create) the corpus's single PRD —
    // never a second one; see the file-header comment.
    const treeRes = await page.request.get(`${API_ORIGIN}/api/tree`);
    let prdId: string;
    let prdTitle: string;

    if (treeRes.status() === 404) {
      prdTitle = `E2E Review-Loop Root PRD ${runId}`;
      await page.goto("/library");
      await page.getByRole("button", { name: "New doc" }).click();
      const dialog = page.getByRole("dialog", { name: "Create new document" });
      await dialog.locator("#doc-type").selectOption("prd");
      await dialog.locator("#doc-title").fill(prdTitle);
      await dialog.getByRole("button", { name: "Create" }).click();
      await expect(page.getByText(`Created prd-`, { exact: false })).toBeVisible();
      await expect(page).toHaveURL(/\/docs\/[^/]+$/);
      const match = /\/docs\/([^/]+)$/.exec(page.url());
      if (match?.[1] === undefined) throw new Error(`Could not extract doc id from URL: ${page.url()}`);
      prdId = decodeURIComponent(match[1]);
    } else {
      expect(treeRes.ok()).toBe(true);
      // HTTP envelope is { ok, data } (see src/lib/api.ts fetchJson), NOT { ok, value }.
      const body = (await treeRes.json()) as { ok: true; data: { doc: { id: string; title: string } } };
      prdId = body.data.doc.id;
      prdTitle = body.data.doc.title;
    }

    // Create a child doc parented under the PRD (ChildrenOf's query is
    // `parent_id: doc.id`, no type filter, so any child type qualifies).
    //
    // reason: the child is a `plan` — a spec takes no parent (BR-2), so it can never be a
    // PRD's child; a plan may be (PARENT_TYPE_CONTRACT). This test's subject is ChildrenOf's
    // resolution of "any child type", not the child's type (GitHub #321).
    const childTitle = `E2E Review-Loop Child ${runId}`;
    const childRes = await page.request.post(`${API_ORIGIN}/api/dashboard/docs`, {
      headers: { "Content-Type": "application/json" },
      data: {
        type: "plan",
        title: childTitle,
        parent_id: prdId,
      },
    });
    expect(childRes.ok()).toBe(true);

    // Splice a ChildrenOf placeholder into the PRD's content out-of-band —
    // content only, title/type are never touched (see file-header comment).
    const patchRes = await page.request.patch(`${API_ORIGIN}/api/dashboard/docs/${prdId}`, {
      headers: { "Content-Type": "application/json" },
      // No leading markdown `#` heading here — `ResolvedPrdBody`'s page header
      // already renders `prd.doc.title` as the page's own `<h1>`; a markdown
      // heading with the same text would render a SECOND `<h1>` with identical
      // accessible name, making `getByRole("heading", { name: prdTitle })`
      // ambiguous (Playwright strict-mode violation).
      data: { content: `See the children below.\n\n<ChildrenOf />\n` },
    });
    expect(patchRes.ok()).toBe(true);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: prdTitle })).toBeVisible();

    // AC-33-1: the placeholder resolves to a typed React doc list, never raw tag text.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("<ChildrenOf");

    const childrenRegion = page.getByRole("region", { name: "Children" });
    await expect(childrenRegion).toBeVisible();
    await expect(childrenRegion.getByText(childTitle, { exact: true })).toBeVisible();
  });

  // ── 2. TRIAGE: escalate judgment badge + blocking questions + filter ────────

  let triageDocId = "";
  let triageDocTitle = "";

  test("triage: seed + escalate judgment shows badge, blocking questions, and survives the escalated-only filter", async () => {
    triageDocTitle = `E2E Triage Escalate ${runId}`;
    await page.goto("/library");
    await page.getByRole("button", { name: "New doc" }).click();
    const dialog = page.getByRole("dialog", { name: "Create new document" });
    const triageParent = await createParentPrdSlug(page, "triage");
    await dialog.locator("#doc-type").selectOption("plan");
    await dialog.locator("#parent-id").fill(triageParent);
    await dialog.locator("#doc-title").fill(triageDocTitle);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(`Created plan-`, { exact: false })).toBeVisible();
    const match = /\/docs\/([^/]+)$/.exec(page.url());
    if (match?.[1] === undefined) throw new Error(`Could not extract doc id from URL: ${page.url()}`);
    triageDocId = decodeURIComponent(match[1]);

    seedJudgment({
      docId: triageDocId,
      docVersion: 1,
      decision: "escalate",
      confidence: 0.5,
      blockingQuestions: ["Is the scope final?", "Who owns rollout?"],
    });

    await page.goto("/pending");
    await expect(page.getByRole("heading", { name: "Triage Queue" })).toBeVisible();

    // Scope to the specific row `<div>` (TriageQueue.tsx: `className="rounded-lg
    // border p-3 space-y-2"`) via CSS class + hasText — NOT `locator("div", {
    // has: ... })`, which also matches every ANCESTOR div containing the button
    // (the whole rows-list wrapper, the page section, etc.) and `.first()` picks
    // the OUTERMOST of those (document order), silently scoping to the entire
    // queue instead of one row once more than one row is on the page.
    const row = page.locator("div.rounded-lg.border.p-3", { hasText: triageDocTitle });
    await expect(row.getByText(/escalate/, { exact: false })).toBeVisible();
    await expect(row.getByText(/\+2Q/, { exact: false })).toBeVisible();

    // Expand blocking questions — both must be visible.
    await row.getByRole("button", { name: /Show blocking questions/ }).click();
    await expect(row.getByText("Is the scope final?")).toBeVisible();
    await expect(row.getByText("Who owns rollout?")).toBeVisible();

    // Toggle "Escalated only" — this row (fresh escalation) must remain visible,
    // while an unjudged doc (read-flow.pw.ts's seeded docs are still draft/pending
    // and carry no judgment at all) must NOT.
    await page.getByLabel("Escalated only").check();
    await expect(page.getByRole("button", { name: triageDocTitle })).toBeVisible();
    await expect(page.getByText("No documents pending review.")).not.toBeVisible();
    await page.getByLabel("Escalated only").uncheck();
  });

  // ── 3. CALIBRATE: approve judgment + adjudicate approve w/ note → confirmed pairing ──

  let calibrateDocId = "";
  let calibrateJudgmentId = "";

  test("calibrate: seed + approve judgment, adjudicate approve with a calibration note, confirmed pairing persists", async () => {
    const calibrateDocTitle = `E2E Calibrate Approve ${runId}`;
    await page.goto("/library");
    await page.getByRole("button", { name: "New doc" }).click();
    const dialog = page.getByRole("dialog", { name: "Create new document" });
    const calibrateParent = await createParentPrdSlug(page, "calibrate");
    await dialog.locator("#doc-type").selectOption("plan");
    await dialog.locator("#parent-id").fill(calibrateParent);
    await dialog.locator("#doc-title").fill(calibrateDocTitle);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(`Created plan-`, { exact: false })).toBeVisible();
    const match = /\/docs\/([^/]+)$/.exec(page.url());
    if (match?.[1] === undefined) throw new Error(`Could not extract doc id from URL: ${page.url()}`);
    calibrateDocId = decodeURIComponent(match[1]);

    calibrateJudgmentId = seedJudgment({
      docId: calibrateDocId,
      docVersion: 1,
      decision: "approve",
      confidence: 0.91,
      blockingQuestions: [],
    });

    await page.goto("/pending");
    const row = page.locator("div.rounded-lg.border.p-3", { hasText: calibrateDocTitle });
    await expect(row.getByText("approve 0.91", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Review", exact: true }).click();
    await row.getByLabel(`Calibration note for ${calibrateDocTitle}`).fill("Matches AI judgment — confirming.");
    // exact: true — the row's own title button ("E2E Calibrate Approve <runId>")
    // otherwise substring-matches the "Approve" adjudicate button's accessible name.
    await row.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page.getByText("Document approved", { exact: true })).toBeVisible();

    // Confirmed pairing: the calibration hook fires against the pre-action version
    // (1), which matches the seeded judgment's doc_version (1) exactly, so this
    // MUST have persisted a "confirmed" calibration_records row keyed to our
    // judgment id — read it back directly off the fixture's SQLite file (no
    // dashboard UI surfaces raw calibration rows to assert against otherwise).
    const record = readCalibrationRecord("plan", calibrateJudgmentId);
    expect(record).not.toBeNull();
    expect(record?.human_outcome).toBe("confirmed");
  });

  // ── 4. AUDIT: judge entry (decoded badge) + approve entry ───────────────────

  test("audit: doc detail audit tab shows the decoded judge entry and the human approve entry", async () => {
    await page.goto(`/docs/${calibrateDocId}`);
    await page.getByRole("button", { name: "audit" }).click();

    const auditEntries = page.locator('[data-testid="audit-entry"]');
    await expect(auditEntries.first()).toBeVisible();

    const judgeEntry = auditEntries.filter({ hasText: "judge" });
    await expect(judgeEntry).toHaveCount(1);
    await expect(judgeEntry.getByText("e2e@v1", { exact: true })).toBeVisible();

    const approveEntry = auditEntries.filter({ hasText: "approve" });
    await expect(approveEntry.first()).toBeVisible();

    // The judge entry's "View judgment" expansion surfaces the same decision.
    await judgeEntry.getByRole("button", { name: "View judgment" }).click();
    await expect(judgeEntry.getByText(/Decision:/)).toBeVisible();
    await expect(judgeEntry.getByText(/approve/)).toBeVisible();
  });
});
