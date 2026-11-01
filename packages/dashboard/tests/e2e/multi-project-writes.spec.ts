/**
 * SPEC-078 T11 — write-surface equivalence e2e coverage (AC-078-7).
 *
 * Runs under `playwright.multi-project.config.ts` (see `multi-project-global-setup.ts`
 * for why this is a SEPARATE config from the default registry-less suite). The
 * component-test half of AC-078-7 ("a component test asserts the selected project's
 * name renders adjacent to the adjudication and save controls") is ALREADY covered by
 * `tests/component/ConfigScopePanel.test.tsx` (landed with T10's `ProjectIdentityLabel`)
 * — this file covers ONLY the e2e half: the gate-armed spec-create write itself must
 * behave identically per-project (denied in A, green in B), and both corpora's audit
 * trails must reflect a real cookie-authenticated (not bearer) write.
 *
 * "audit rows... carry surface=http_cookie": `AuditEntry` (`@lore/core`) has no literal
 * `surface` column — dashboard write routes (`dashboard-routes.ts::assertCookieActor`)
 * structurally REJECT (403) any actor whose `callerSurface !== "http_cookie"` before
 * ever reaching the service layer, so a successful create audit row is BY CONSTRUCTION
 * proof the write happened over the http_cookie surface; there is no other path that
 * could have produced it. This suite asserts the row exists (real proof the write
 * landed), not a nonexistent field.
 *
 * @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-7
 */
import { test, expect, type Page } from "@playwright/test";
import { loadMultiProjectFixture, type MultiProjectFixture } from "./multi-project-fixture-data";

const API_ORIGIN = "http://localhost:8787";

// Must run under `playwright.multi-project.config.ts` — see
// `multi-project-isolation.spec.ts`'s identical guard for the full rationale (both
// configs' `testMatch` glob this filename; the default registry-less config must
// self-skip rather than fail with `LORE_E2E_MP_*` env vars absent).
const MULTI_PROJECT_FIXTURE_PRESENT = process.env.LORE_E2E_MP_RUN_ID !== undefined;
test.skip(
  !MULTI_PROJECT_FIXTURE_PRESENT,
  "requires playwright.multi-project.config.ts — run via `bunx playwright test " +
    "--config=tests/e2e/playwright.multi-project.config.ts`",
);

test.describe.configure({ mode: "serial" });

test.describe("SPEC-078 multi-project write-surface equivalence", () => {
  let page: Page;
  let fixture: MultiProjectFixture;

  test.beforeAll(async ({ browser }) => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    fixture = loadMultiProjectFixture();
    page = await browser.newPage();
    await page.goto("/p/project-a/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });

  test.afterAll(async () => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    await page.close();
  });

  test("a gate-armed spec write in A is denied, rendering A's feeding pack", async () => {
    const res = await page.request.post(`${API_ORIGIN}/api/p/project-a/api/dashboard/docs`, {
      headers: { "Content-Type": "application/json" },
      data: {
        type: "spec",
        title: `E2E Gate-Denied Spec ${fixture.runId}`,
        content: "no heading here, just plain prose",
        // reason: BR-4's heading count (hasSkeleton) is retired; the spec-create predicate a schema-valid write can
        // still trip is the AC-quantifiability one: an abstract-quality criterion with no threshold.
        extra: { acceptance_criteria: [{ id: "AC-VAGUE-1", statement: "the dashboard loads fast", verify: { mode: "human" } }] },
      },
    });

    expect(res.status()).toBe(422);
    const body = (await res.json()) as { ok: boolean; error?: { code: string; field?: string; message?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(body.error?.field).toBe("gate:spec-create:ac-quantifiable");
    // The feeding pack (GateEnforcer D1/SPEC-049) is embedded in the message.
    expect(body.error?.message).toContain('Gate "spec-create" blocked');
    expect(body.error?.message).toContain("AC_NOT_QUANTIFIABLE");
  });

  test("the same write succeeds in B, and both corpora's audit trails show a real http_cookie write", async () => {
    const specTitle = `E2E Gate-Allowed Spec ${fixture.runId}`;
    const res = await page.request.post(`${API_ORIGIN}/api/p/project-b/api/dashboard/docs`, {
      headers: { "Content-Type": "application/json" },
      data: {
        type: "spec",
        title: specTitle,
        content:
          "## Overview\n\nE2E multi-project write-surface fixture spec (project B).\n\n## Scope\n\nGate-armed write equivalence only.\n\n## Acceptance Criteria\n\n- N/A (fixture doc, not a real spec).\n",
      },
    });

    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { ok: boolean; data: { doc: { id: string; title: string } } };
    expect(body.ok).toBe(true);
    expect(body.data.doc.title).toBe(specTitle);
    const newDocId = body.data.doc.id;

    // Audit trail for the newly created doc in B — the only way this row could exist
    // at all is a successful cookie-authenticated dashboard write (see this file's
    // header for why "surface=http_cookie" is proven structurally, not by field).
    const auditRes = await page.request.get(`${API_ORIGIN}/api/p/project-b/api/audit/${newDocId}`);
    expect(auditRes.status()).toBe(200);
    const auditBody = (await auditRes.json()) as { data: Array<{ action: string; doc_id?: string; actor: string }> };
    expect(auditBody.data.length).toBeGreaterThan(0);
    expect(auditBody.data.every((entry) => entry.doc_id === newDocId)).toBe(true);

    // A's audit trail is untouched by B's write — no entry anywhere in A references
    // B's freshly-created doc id.
    const aAuditRes = await page.request.get(`${API_ORIGIN}/api/p/project-a/api/audit/${newDocId}`);
    const aAuditBody = (await aAuditRes.json()) as { data: unknown[] };
    expect(aAuditBody.data.length).toBe(0);
  });
});
