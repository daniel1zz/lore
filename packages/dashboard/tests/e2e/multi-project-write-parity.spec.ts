/**
 * AC-P0C-8 — BR-996 write parity on a registered project (e2e half).
 *
 * BR-996: every dashboard write behaves on a registered project as with a single project —
 * the same out-of-date check applies and the audit trail records the same browser source and
 * person. Runs under `playwright.multi-project.config.ts` (testMatch `multi-project-*.spec.ts`);
 * the default config self-skips it, exactly like its siblings.
 *
 * Cases (project-b is a registered, prefixed project; project-a is the launch project whose
 * plain `/api/...` addresses are the single-project baseline):
 *   1. a PATCH carrying a stale If-Match on project-b is refused with HTTP 409 and the
 *      document is unchanged;
 *   2. the same stale-If-Match refusal happens on the plain launch-project address (parity);
 *   3. an accepted PATCH on project-b writes an audit row whose actor is the same person the
 *      launch project's plain write records (never the static bootstrap-key name);
 *
 * NOT asserted here: that the audit row carries a `surface`/`source` field for the browser.
 * Measured against the unmutated code, the audit row of an accepted cookie write holds only
 * {timestamp, actor, session_id, action, doc_id, details:{patch,new_version,version}} — there is
 * no such field (BR-996 "same browser source" is unmet; see the task report). Audit rows are
 * read via `GET /api/p/<project>/api/audit/:docId`, the same path multi-project-writes.spec.ts uses.
 *
 * @spec_ref spec-p0-requirement-coverage-falsifying-criteria-for-the-8 AC-P0C-8
 */
import { test, expect, type Page } from "@playwright/test";
import { E2E_HUMAN_NAME } from "./known-party";
import { loadMultiProjectFixture, type MultiProjectFixture } from "./multi-project-fixture-data";

const API_ORIGIN = "http://localhost:8787";

const MULTI_PROJECT_FIXTURE_PRESENT = process.env.LORE_E2E_MP_RUN_ID !== undefined;
test.skip(
  !MULTI_PROJECT_FIXTURE_PRESENT,
  "requires playwright.multi-project.config.ts — run via `bunx playwright test " +
    "--config=tests/e2e/playwright.multi-project.config.ts`",
);

test.describe.configure({ mode: "serial" });

interface AuditRow {
  actor: string;
  action: string;
  doc_id?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

test.describe("BR-996 write parity: registered project vs launch project", () => {
  let page: Page;
  let fixture: MultiProjectFixture;

  test.beforeAll(async ({ browser }) => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    fixture = loadMultiProjectFixture();
    page = await browser.newPage();
    await page.goto("/p/project-b/library");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });

  test.afterAll(async () => {
    if (!MULTI_PROJECT_FIXTURE_PRESENT) return;
    await page.close();
  });

  async function readVersion(prefix: string, docId: string): Promise<{ version: number; content: string }> {
    const res = await page.request.get(`${API_ORIGIN}${prefix}/api/docs/${docId}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { doc: { version: number; content: string } } };
    return body.data.doc;
  }

  async function patch(prefix: string, docId: string, content: string, ifMatch: string) {
    return page.request.patch(`${API_ORIGIN}${prefix}/api/dashboard/docs/${docId}`, {
      headers: { "Content-Type": "application/json", "If-Match": ifMatch },
      data: { content },
    });
  }

  test("a stale If-Match on a registered project is refused with HTTP 409 and the doc is unchanged", async () => {
    const docId = fixture.seed.b.markerTaskId;
    const before = await readVersion("/api/p/project-b", docId);

    const res = await patch("/api/p/project-b", docId, `stale write ${fixture.runId}`, String(before.version + 100));

    expect(res.status()).toBe(409);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
    const after = await readVersion("/api/p/project-b", docId);
    expect(after.version).toBe(before.version);
    expect(after.content).toBe(before.content);
  });

  test("the launch project's plain address refuses a stale If-Match the same way (parity baseline)", async () => {
    const docId = fixture.seed.a.markerTaskId;
    const before = await readVersion("", docId);

    const res = await patch("", docId, `stale write ${fixture.runId}`, String(before.version + 100));

    expect(res.status()).toBe(409);
    const after = await readVersion("", docId);
    expect(after.version).toBe(before.version);
  });

  test("an accepted write on a registered project records the same person as the launch project's write", async () => {
    const bId = fixture.seed.b.markerTaskId;
    const aId = fixture.seed.a.markerTaskId;
    const bBefore = await readVersion("/api/p/project-b", bId);
    const aBefore = await readVersion("", aId);

    const bRes = await patch("/api/p/project-b", bId, `accepted write B ${fixture.runId}`, String(bBefore.version));
    const aRes = await patch("", aId, `accepted write A ${fixture.runId}`, String(aBefore.version));
    expect(bRes.status()).toBe(200);
    expect(aRes.status()).toBe(200);

    const bAudit = await auditRows("/api/p/project-b", bId);
    const aAudit = await auditRows("", aId);
    const bUpdate = bAudit.filter((r) => r.action === "update").at(-1);
    const aUpdate = aAudit.filter((r) => r.action === "update").at(-1);
    expect(bUpdate, "project-b has an update audit row for the accepted write").toBeDefined();
    expect(aUpdate, "launch project has an update audit row for the accepted write").toBeDefined();
    expect(bUpdate!.actor).toBe(aUpdate!.actor);
    // The recorded person is the one whose human session the fixture opened in each checkout
    // (known-party.ts, multi-project-global-setup.ts step 1b), read at write time (GitHub #324).
    expect(bUpdate!.actor).toBe(E2E_HUMAN_NAME);
    // The static bootstrap-key identity must never be the recorded person.
    expect(bUpdate!.actor).not.toBe("dashboard-local");
    expect(bUpdate!.actor).not.toBe("admin");
  });

  async function auditRows(prefix: string, docId: string): Promise<AuditRow[]> {
    const res = await page.request.get(`${API_ORIGIN}${prefix}/api/audit/${docId}`);
    expect(res.status()).toBe(200);
    return ((await res.json()) as { data: AuditRow[] }).data;
  }
});
