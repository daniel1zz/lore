/**
 * SPEC-078 T11 — multi-project isolation e2e coverage (AC-078-6).
 *
 * Runs under `playwright.multi-project.config.ts` (NOT the default config) —
 * `multi-project-global-setup.ts` boots ONE server whose `mountRegistry` carries two
 * REAL throwaway corpora, `project-a`/`project-b`, seeded with distinguishable content
 * (`multi-project-fixture-data.ts`::loadMultiProjectFixture()`). See that setup file's
 * header for why this suite cannot share the default suite's registry-less environment.
 *
 * Auth: exactly ONE page load (`test.beforeAll`) triggers the real
 * `bootstrapAuthIfNeeded()` SPA path, minting a MACHINE-scope session cookie (D1) — the
 * remaining tests reuse that SAME cookie (via `page.request`, sharing the browser
 * context's cookie jar) to address BOTH projects, proving "one login reads both
 * projects" structurally rather than asserting it as a side note.
 *
 * @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-6
 */
import { test, expect, type Page } from "@playwright/test";
import { loadMultiProjectFixture, type MultiProjectFixture } from "./multi-project-fixture-data";

const API_ORIGIN = "http://localhost:8787";

// This file must run under `playwright.multi-project.config.ts`'s dedicated
// globalSetup (`multi-project-global-setup.ts`) — NEVER the default
// `playwright.config.ts` (registry-less). Both configs' `testMatch` glob this
// filename (the default config's `**/*.spec.ts` cannot exclude it without editing
// that file, which is outside this task's anchor), so a bare `bunx playwright test`
// run must self-skip rather than fail: `multi-project-global-setup.ts` never runs
// under the default config, so none of the `LORE_E2E_MP_*` env vars it publishes
// would exist, and `loadMultiProjectFixture()` would throw.
const MULTI_PROJECT_FIXTURE_PRESENT = process.env.LORE_E2E_MP_RUN_ID !== undefined;
test.skip(
  !MULTI_PROJECT_FIXTURE_PRESENT,
  "requires playwright.multi-project.config.ts — run via `bunx playwright test " +
    "--config=tests/e2e/playwright.multi-project.config.ts`",
);

test.describe.configure({ mode: "serial" });

test.describe("SPEC-078 multi-project isolation", () => {
  let page: Page;
  let fixture: MultiProjectFixture;

  test.beforeAll(async ({ browser }) => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    fixture = loadMultiProjectFixture();
    page = await browser.newPage();
    // A full page load under a project-scoped route runs bootstrapAuthIfNeeded() and
    // mints the lore_sid cookie every subsequent page.request call below reuses.
    await page.goto("/p/project-a/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });

  test.afterAll(async () => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    await page.close();
  });

  test("one login reads both projects, each showing only its own distinguishable content", async () => {
    const aRes = await page.request.get(`${API_ORIGIN}/api/p/project-a/api/docs`);
    expect(aRes.status()).toBe(200);
    const bRes = await page.request.get(`${API_ORIGIN}/api/p/project-b/api/docs`);
    expect(bRes.status()).toBe(200);

    const aBody = (await aRes.json()) as { data: { docs: Array<{ title: string }> } };
    const bBody = (await bRes.json()) as { data: { docs: Array<{ title: string }> } };
    const aTitles = aBody.data.docs.map((d) => d.title);
    const bTitles = bBody.data.docs.map((d) => d.title);

    expect(aTitles).toContain(fixture.seed.a.markerTaskTitle);
    expect(bTitles).toContain(fixture.seed.b.markerTaskTitle);
    // Cross-leak check: A's marker never appears in B's list and vice versa.
    expect(aTitles).not.toContain(fixture.seed.b.markerTaskTitle);
    expect(bTitles).not.toContain(fixture.seed.a.markerTaskTitle);
  });

  test("a request naming an unregistered project returns 404-class", async () => {
    const res = await page.request.get(`${API_ORIGIN}/api/p/does-not-exist/api/docs`);
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(body.ok).toBe(false);
  });

  test("an approve + doc edit addressed to A lands in A while B's doc set is byte-unchanged", async () => {
    const bBeforeRes = await page.request.get(`${API_ORIGIN}/api/p/project-b/api/docs`);
    const bBefore: unknown = await bBeforeRes.json();

    const approveRes = await page.request.post(
      `${API_ORIGIN}/api/p/project-a/api/dashboard/docs/${fixture.seed.a.draftSpecId}/approve`,
    );
    expect(approveRes.ok()).toBe(true);
    const approveBody = (await approveRes.json()) as { data: { doc: { status: string } } };
    expect(approveBody.data.doc.status).toBe("approved");

    const editedMarker = `EDITED-VIA-PROJECT-A-${fixture.runId}`;
    const editedContent = `## Overview\n\n${editedMarker}\n\n## Scope\n\nn/a\n\n## Acceptance Criteria\n\n- n/a\n`;
    const editRes = await page.request.patch(
      `${API_ORIGIN}/api/p/project-a/api/dashboard/docs/${fixture.seed.a.draftSpecId}`,
      { headers: { "Content-Type": "application/json" }, data: { content: editedContent } },
    );
    expect(editRes.ok()).toBe(true);

    // Confirm the write actually landed in A. Editing content on an `approved` doc
    // auto-demotes it to `draft` (documented lifecycle rule, root CLAUDE.md "Document
    // Lifecycle") — asserting THAT demotion fired is itself stronger proof the edit
    // really landed than asserting a status that would just carry over unchanged.
    const aDocRes = await page.request.get(`${API_ORIGIN}/api/p/project-a/api/docs/${fixture.seed.a.draftSpecId}`);
    const aDocBody = (await aDocRes.json()) as { data: { doc: { content: string; status: string } } };
    expect(aDocBody.data.doc.content).toContain(editedMarker);
    expect(aDocBody.data.doc.status).toBe("draft");

    // B's ENTIRE doc set is byte-unchanged by A's write.
    const bAfterRes = await page.request.get(`${API_ORIGIN}/api/p/project-b/api/docs`);
    const bAfter: unknown = await bAfterRes.json();
    expect(bAfter).toEqual(bBefore);
  });

  test("an If-Match token minted under A replayed against B is rejected, never applied", async () => {
    const aMarkerRes = await page.request.get(
      `${API_ORIGIN}/api/p/project-a/api/docs/${fixture.seed.a.markerTaskId}`,
    );
    const aMarkerBody = (await aMarkerRes.json()) as { data: { doc: { version: number } } };
    const versionMintedUnderA = aMarkerBody.data.doc.version;

    // fixture.seed.a.markerTaskId does not exist in B's corpus at all — replaying A's
    // If-Match token against B must be rejected outright (404, DOC_NOT_FOUND), never
    // silently applied to some coincidentally-present doc in B.
    const replayRes = await page.request.patch(
      `${API_ORIGIN}/api/p/project-b/api/docs/${fixture.seed.a.markerTaskId}`,
      {
        headers: { "Content-Type": "application/json", "If-Match": String(versionMintedUnderA) },
        data: { content: "SHOULD-NEVER-APPLY-ANYWHERE" },
      },
    );
    expect(replayRes.status()).toBe(404);

    // B's OWN marker doc (a different id) is untouched.
    const bMarkerRes = await page.request.get(
      `${API_ORIGIN}/api/p/project-b/api/docs/${fixture.seed.b.markerTaskId}`,
    );
    const bMarkerBody = (await bMarkerRes.json()) as { data: { doc: { content: string } } };
    expect(bMarkerBody.data.doc.content).toContain(fixture.seed.b.markerContent);
  });
});
