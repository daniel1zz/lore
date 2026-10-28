/**
 * SPEC-022 dashboard write-flow e2e coverage.
 *
 * One continuous user journey (create -> edit -> conflict-resolve -> approve ->
 * approve-then-edit demotion -> history) driven against a single throwaway doc, run as
 * a `test.describe.serial` suite sharing one browser page (see the shared-`page`
 * pattern below) so each step naturally sees the state left by the previous one —
 * exactly like a real user session. `test.describe.configure({ mode: "serial" })`
 * both orders the tests and stops the suite on first failure so a broken step doesn't
 * cascade into confusing failures downstream.
 *
 * Auth: no manual cookie minting anywhere in this file. `global-setup.ts` boots Vite
 * with `VITE_LORE_BOOTSTRAP_TOKEN` set, so every full page load triggers the real
 * `bootstrapAuthIfNeeded()` SPA path (SPEC-016 §3.8), which exchanges the token for a
 * real `lore_sid` HttpOnly cookie via `POST /api/auth/local-bootstrap`. The "conflict"
 * scenario uses `page.request` (Playwright's APIRequestContext, sharing the same
 * browser-context cookie jar) to PATCH the doc out-of-band, so the cookie flows
 * automatically without any test-side cookie plumbing.
 *
 * Source: SPEC-022 §4 (AC-DASH-WRITE-1..10), §9.3, §9.4, §9.7; SPEC-027 AC-DH-6, AC-DH-7.
 * @spec_ref AC-DASH-WRITE-2, AC-DASH-WRITE-3, AC-DASH-WRITE-4, AC-DASH-WRITE-5,
 *           AC-DASH-WRITE-7, AC-DASH-WRITE-8, AC-DASH-WRITE-10, AC-DH-6, AC-DH-7
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ORIGIN = "http://localhost:8787";
const SEED_JUDGMENT_SCRIPT = join(__dirname, "seed-judgment.ts");

/**
 * Seed an approve judgment pinned to `docVersion` (BR-281: the `review-judgment` gate
 * refuses approve without an independent judgment of the CURRENT version, and no dashboard
 * UI produces one — same fixture route `adjudication.pw.ts` uses).
 */
function seedApproveJudgment(docId: string, docVersion: number): void {
  const dbPath = process.env.LORE_E2E_DB_PATH;
  if (dbPath === undefined) {
    throw new Error("LORE_E2E_DB_PATH is not set — global-setup.ts must run before this suite.");
  }
  const payload = { docId, docVersion, decision: "approve", confidence: 0.9, blockingQuestions: [] };
  execFileSync("bun", [SEED_JUDGMENT_SCRIPT, dbPath, JSON.stringify(payload)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
}

test.describe.configure({ mode: "serial" });

test.describe("SPEC-022 dashboard write flow", () => {
  let page: Page;
  let docId = "";
  let docTitle = "";

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    docTitle = `E2E Write Flow ${Date.now()}`;
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Read the "Version" row's `v<N>` text from the metadata table and parse the number.
   * The DocDetail metadata table renders `<TableCell>v{doc.version}</TableCell>` next
   * to a `<TableCell>Version</TableCell>` label cell (src/components/DocDetail.tsx).
   */
  async function readDisplayedVersion(): Promise<number> {
    const cell = page.locator("tr", { hasText: "Version" }).locator("td").nth(1);
    const text = await cell.innerText();
    const match = /v(\d+)/.exec(text);
    if (match?.[1] === undefined) {
      throw new Error(`Could not parse version from cell text: "${text}"`);
    }
    return parseInt(match[1], 10);
  }

  /**
   * Replace the full CodeMirror editor content. Clicks into `.cm-content`
   * (CodeMirror 6's contenteditable host), selects all, and types replacement text.
   */
  async function replaceEditorContent(newText: string): Promise<void> {
    const editorContent = page.locator(".cm-content");
    await editorContent.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(newText);
  }

  // ── 1. Create ────────────────────────────────────────────────────────────────

  test("create: New doc button creates a doc and navigates to its detail page", async () => {
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    await page.getByRole("button", { name: "New doc" }).click();

    const dialog = page.getByRole("dialog", { name: "Create new document" });
    await expect(dialog).toBeVisible();

    // A plan names its parent (BR-709); a PRD created out-of-band keeps the create step focused on the
    // create flow itself rather than incidental type-specific validation.
    const parentSlug = await createParentPrdSlug(page, "write-flow");
    await dialog.locator("#doc-type").selectOption("plan");
    await dialog.locator("#parent-id").fill(parentSlug);
    await dialog.locator("#doc-title").fill(docTitle);

    await dialog.getByRole("button", { name: "Create" }).click();

    // Success toast (api/mutations.ts create path) + navigation to /docs/$id.
    await expect(page.getByText(`Created plan-`, { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/docs\/[^/]+$/);
    await expect(page.getByRole("heading", { name: docTitle })).toBeVisible();

    const match = /\/docs\/([^/]+)$/.exec(page.url());
    if (match?.[1] === undefined) throw new Error(`Could not extract doc id from URL: ${page.url()}`);
    docId = decodeURIComponent(match[1]);
    expect(docId.length).toBeGreaterThan(0);

    // New doc is created in "draft" status (SPEC-002 lifecycle default).
    await expect(page.getByRole("button", { name: /^Status: draft/ })).toBeVisible();
  });

  // ── 2. Edit + save ───────────────────────────────────────────────────────────

  test("edit + save: editing content persists and shows a success toast", async () => {
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.locator(".cm-content")).toBeVisible();

    await replaceEditorContent("# Edited\n\nE2E-EDIT-MARKER-ONE content body.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Document saved", { exact: true })).toBeVisible();
    // Edit mode closes back to the "Edit" button on success.
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.getByText("E2E-EDIT-MARKER-ONE")).toBeVisible();

    expect(await readDisplayedVersion()).toBe(2);
  });

  // ── 3. Conflict ──────────────────────────────────────────────────────────────

  test("conflict: an out-of-band edit triggers ConflictModal; Force overwrite resolves it", async () => {
    // Out-of-band PATCH via the shared browser-context cookie jar (page.request reuses
    // the same cookies the browser holds — no manual cookie extraction needed). No
    // If-Match header is sent, so concurrency.ts::checkConcurrency lets it through
    // unconditionally (documented "legacy path" behaviour) and bumps the version.
    const outOfBandResponse = await page.request.patch(
      `${API_ORIGIN}/api/dashboard/docs/${docId}`,
      {
        headers: { "Content-Type": "application/json" },
        data: { content: "OUT-OF-BAND-SERVER-CONTENT (written outside the browser)" },
      },
    );
    expect(outOfBandResponse.ok()).toBe(true);

    await page.getByRole("button", { name: "Edit" }).click();
    await replaceEditorContent("E2E-MY-DRAFT-CONTENT (typed in the browser, now stale)");
    await page.getByRole("button", { name: "Save" }).click();

    // 409 -> ConflictModal (AC-DASH-WRITE-3).
    const conflictModal = page.getByRole("dialog", { name: "Edit Conflict" });
    await expect(conflictModal).toBeVisible();
    await expect(conflictModal.getByText("You wrote (draft)")).toBeVisible();
    await expect(conflictModal.getByText(/Now on server/)).toBeVisible();
    await expect(conflictModal.getByText("E2E-MY-DRAFT-CONTENT")).toBeVisible();
    await expect(conflictModal.getByText("OUT-OF-BAND-SERVER-CONTENT")).toBeVisible();

    await conflictModal.getByRole("button", { name: "Force overwrite" }).click();

    await expect(page.getByText("Document saved (force overwrite)", { exact: true })).toBeVisible();
    await expect(conflictModal).not.toBeVisible();
    // Force overwrite writes the client's draft content, not the out-of-band content.
    await expect(page.getByText("E2E-MY-DRAFT-CONTENT")).toBeVisible();
  });

  // ── 4. Approve ───────────────────────────────────────────────────────────────

  test("approve: status pill dropdown transitions draft -> approved", async () => {
    await expect(page.getByRole("button", { name: /^Status: draft/ })).toBeVisible();

    seedApproveJudgment(docId, await readDisplayedVersion());

    await page.getByRole("button", { name: /^Status: draft/ }).click();
    // AC-DASH-WRITE-4: dropdown only lists getAllowedTransitions("draft") = [in-review, approved].
    await expect(page.getByRole("menuitem", { name: "Submit for review" })).toBeVisible();
    const approveItem = page.getByRole("menuitem", { name: "Approve" });
    await expect(approveItem).toBeVisible();
    await approveItem.click();

    await expect(page.getByText("Document approved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Status: approved/ })).toBeVisible();
  });

  // ── 5. AC-DASH-WRITE-5 demotion toast ────────────────────────────────────────

  test("editing an approved doc auto-demotes it to draft with the AC-5 toast", async () => {
    await page.getByRole("button", { name: "Edit" }).click();
    await replaceEditorContent("E2E-POST-APPROVAL-EDIT triggers the approved->draft demotion.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByText("Saved — status reverted to draft (editing an approved doc requires re-review)", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Status: draft/ })).toBeVisible();
  });

  // ── 6. History ───────────────────────────────────────────────────────────────

  test("history: History tab lists versions and a diff view opens", async () => {
    await page.getByRole("button", { name: "history" }).click();

    const versionBadges = page.locator('div:text-matches("^v\\\\d+$")');
    await expect(versionBadges.first()).toBeVisible();
    const count = await versionBadges.count();
    // We performed 5 writes on this doc (create, edit, out-of-band edit, force
    // overwrite, approve, post-approval edit) => at least 2 version rows exist,
    // which also guarantees at least one "diff" link is rendered.
    expect(count).toBeGreaterThanOrEqual(2);

    const diffButton = page.getByRole("button", { name: "diff" }).first();
    await expect(diffButton).toBeVisible();
    await diffButton.click();

    const diffModal = page.getByRole("dialog", { name: /^Diff from v\d+ to v\d+$/ });
    await expect(diffModal).toBeVisible();
    await diffModal.getByRole("button", { name: "Close" }).click();
    await expect(diffModal).not.toBeVisible();
  });

  // ── 7. Restore (SPEC-027 AC-DH-7) ─────────────────────────────────────────────

  test("restore: restoring an older version creates a new version and refreshes the doc view", async () => {
    const versionBeforeRestore = await readDisplayedVersion();

    // History tab is still active from the previous test. Restore the oldest
    // row (last in the descending-by-version list — the original creation
    // content) so the restored content is guaranteed to differ from the
    // current "E2E-POST-APPROVAL-EDIT" content written in the previous test.
    const restoreButtons = page.getByRole("button", { name: "restore" });
    await expect(restoreButtons.first()).toBeVisible();
    await restoreButtons.last().click();

    await expect(page.getByText(/^Restored to v\d+$/)).toBeVisible();

    // Restore is append-only — it must produce version N+1, never reuse/overwrite.
    // Poll: the toast fires before the query cache repaints the version display.
    await expect.poll(() => readDisplayedVersion()).toBe(versionBeforeRestore + 1);
    // VersionService.restore always resets status to draft (mirrors CLI/HTTP behavior).
    await expect(page.getByRole("button", { name: /^Status: draft/ })).toBeVisible();

    // Switch to the content tab: the most recent marker must be gone now that
    // content has been rolled back to the original (v1) creation content.
    await page.getByRole("button", { name: "content" }).click();
    await expect(page.getByText("E2E-POST-APPROVAL-EDIT")).not.toBeVisible();
  });

  // ── 8. Delete (SPEC-027 AC-DH-6) ───────────────────────────────────────────────

  test("delete: confirming the delete dialog soft-deletes the doc and navigates home", async () => {
    await page.getByRole("button", { name: "Delete" }).click();

    const confirmDialog = page.getByRole("alertdialog", { name: "Confirm delete" });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText(`Delete "${docTitle}"?`)).toBeVisible();

    await confirmDialog.getByRole("button", { name: /Delete \(recoverable\)/ }).click();

    await expect(page.getByText("Document deleted (recoverable for 30 days)")).toBeVisible();
    await expect(confirmDialog).not.toBeVisible();

    // onDeleted navigates away from the now-gone document's page (SPEC-027 AC-DH-6).
    // Home is the resolved living PRD since SPEC-033 F2 — assert its panels, not the old doc list.
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByRole("heading", { name: "Pending Review" })).toBeVisible();
  });
});
