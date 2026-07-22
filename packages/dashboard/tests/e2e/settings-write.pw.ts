/**
 * SPEC-064 dashboard Settings — WRITE invariants e2e coverage (AC-064-2).
 *
 * TEAM scope ONLY, deliberately. The MACHINE-scope write path
 * (`PATCH /api/dashboard/config/machine`) touches the REAL machine-global XDG
 * config file (`~/.config/lore/config.yaml` / `$LORE_CONFIG_HOME`), which is
 * NOT corpus-scoped and therefore NOT covered by this repo's
 * throwaway-corpus isolation (`global-setup.ts`) — writing to it from this
 * suite would leak into every OTHER corpus on the machine running it
 * (SPEC-064 Overview table: machine-scope blast radius is "EVERY corpus on
 * this machine"), exactly the hazard SPEC-064 exists to make visible, not one
 * this suite may itself trigger. All three AC-064-2 assertions (restart
 * classification for a restart-required key, zero restart entries for a live
 * key, and a stale-hash conflict leaving the file byte-identical) are
 * independently verifiable against the TEAM scope alone — `sync.enabled` and
 * `workflow.claim_ttl_minutes` are both TEAM_FIELD_SPECS-only entries — so no
 * machine-scope write is needed to satisfy the AC.
 *
 * File-byte assertions read `.lore/config.yaml` directly off the throwaway
 * corpus's own directory, derived from `LORE_E2E_DB_PATH` (published by
 * `global-setup.ts`; `dirname(dbPath)` is the corpus's `.lore/` dir since
 * `dbPath = join(tmpDir, ".lore", "lore.db")`) — never the repo's own
 * `.lore/`.
 *
 * Auth / out-of-band-write pattern: identical to `write-flow.pw.ts`'s
 * "conflict" test — `page.request` shares the browser context's `lore_sid`
 * cookie, so an out-of-band PATCH reaches the server pre-authenticated with
 * no manual cookie plumbing. Unlike the doc-PATCH route, the config PATCH
 * routes REQUIRE `If-Match` (SPEC-062 §Design: "no unconditional-write path"
 * for config) — every out-of-band call below sends one explicitly.
 *
 * Serial, shared-page suite (mirrors `write-flow.pw.ts`): each test builds on
 * the config state the previous test left behind, exactly like a real user
 * session making several edits in sequence.
 *
 * Source: SPEC-064 §Acceptance Criteria AC-064-2; §Design D5, D6.
 * @spec_ref AC-064-2
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

const API_ORIGIN = "http://localhost:8787";

function teamConfigPath(): string {
  const dbPath = process.env.LORE_E2E_DB_PATH;
  if (dbPath === undefined) {
    throw new Error("LORE_E2E_DB_PATH is not set — global-setup.ts must run before this suite (see its comment).");
  }
  // dbPath = join(tmpDir, ".lore", "lore.db") -> dirname(dbPath) = tmpDir/.lore
  return join(dirname(dbPath), "config.yaml");
}

function readTeamConfigBytes(): string {
  const path = teamConfigPath();
  if (!existsSync(path)) {
    throw new Error(`Expected team config file at ${path} to already exist (written by 'lore init').`);
  }
  return readFileSync(path, "utf8");
}

test.describe.configure({ mode: "serial" });

test.describe("SPEC-064 Settings — write invariants", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("saving sync.enabled reports restart_required = exactly [sync.enabled]", async () => {
    await page.goto("/settings");
    const team = page.getByTestId("settings-team-scope");
    await expect(team.getByRole("button", { name: "Edit" })).toBeVisible();

    // D-007 (LoreConfigSchema superRefine, config.ts): `sync.enabled: true`
    // is REJECTED by the merge-validation step unless `sync.remote_url` is
    // ALSO already present — a patch that sets `enabled` alone on a fresh
    // corpus (where remote_url is unset) fails with VALIDATION_ERROR before
    // ever reaching `restart_required` accounting (confirmed empirically: the
    // panel renders "remote_url is required when sync.enabled is true
    // (D-007)" as a saveError, no save-result block at all). Pre-seed
    // `remote_url` out-of-band FIRST so the UI edit session below touches
    // ONLY `sync.enabled` — this is what makes "restart_required contains
    // EXACTLY 1 entry (sync.enabled)" (AC-064-2) a satisfiable scenario at
    // all, not a workaround around the assertion.
    const preSeedGet = await page.request.get(`${API_ORIGIN}/api/config`);
    expect(preSeedGet.ok()).toBe(true);
    const preSeedHash = ((await preSeedGet.json()) as { data: { hash: string } }).data.hash;
    // `sync` is `.optional()` at the LoreConfigSchema top level with NO
    // object-level default (config.ts) — on a fresh corpus `config.sync` is
    // `undefined` entirely, so a patch merging only `{sync: {remote_url}}`
    // replaces the whole (absent) `sync` object wholesale and fails
    // `SyncConfigSchema`'s required (non-defaulted) `enabled: z.boolean()`
    // field ("sync.enabled: Required", empirically confirmed). `enabled:
    // false` must be seeded alongside `remote_url` for the merge to validate.
    const preSeedPatch = await page.request.patch(`${API_ORIGIN}/api/dashboard/config`, {
      headers: { "Content-Type": "application/json", "If-Match": preSeedHash },
      data: { sync: { enabled: false, remote_url: "libsql://e2e-settings-write-placeholder" } },
    });
    expect(preSeedPatch.ok()).toBe(true);

    await page.reload();
    await expect(team.getByRole("button", { name: "Edit" })).toBeVisible();
    await team.getByRole("button", { name: "Edit" }).click();

    const checkbox = team.getByTestId("config-input-sync.enabled");
    const before = await checkbox.isChecked();
    // Fresh corpus -> sync.enabled is unset -> starts unchecked; toggling
    // to true is the only direction available, which is why remote_url had
    // to be pre-seeded above.
    await checkbox.setChecked(!before);

    await team.getByRole("button", { name: "Save" }).click();

    const restartRow = team.getByTestId("settings-team-restart-required");
    await expect(restartRow).toBeVisible();
    // classifyConfigEffect("sync.enabled") === "restart_required"
    // (RESTART_REQUIRED_KEY_PREFIXES includes "sync." — config-editability.ts)
    // — assert the EXACT set, not merely non-empty.
    await expect(restartRow).toHaveText("Restart required: sync.enabled");

    const saveResult = team.getByTestId("settings-team-save-result");
    await expect(saveResult).toContainText("sync.enabled");
  });

  test("saving workflow.claim_ttl_minutes reports exactly 0 restart entries", async () => {
    const team = page.getByTestId("settings-team-scope");
    await expect(team.getByRole("button", { name: "Edit" })).toBeVisible();
    await team.getByRole("button", { name: "Edit" }).click();

    const numberInput = team.getByTestId("config-input-workflow.claim_ttl_minutes");
    const current = await numberInput.inputValue();
    const currentNum = Number.parseInt(current, 10);
    const changed = Number.isFinite(currentNum) ? currentNum + 5 : 30;
    await numberInput.fill(String(changed));

    await team.getByRole("button", { name: "Save" }).click();

    const restartRow = team.getByTestId("settings-team-restart-required");
    await expect(restartRow).toBeVisible();
    // classifyConfigEffect("workflow.claim_ttl_minutes") === "live" — every
    // other key changed in this edit session already saved+cleared in the
    // previous test, so this session touches exactly this one live key.
    await expect(restartRow).toHaveText("Restart required: (none)");

    const saveResult = team.getByTestId("settings-team-save-result");
    await expect(saveResult).toContainText("workflow.claim_ttl_minutes");
  });

  test("a stale base hash opens ConfigConflictModal and leaves the config file byte-identical", async () => {
    await page.reload();
    const team = page.getByTestId("settings-team-scope");
    await expect(team.getByRole("button", { name: "Edit" })).toBeVisible();

    // Read the server's current hash the same way the UI just did (a fresh
    // GET immediately after reload), THEN use it to perform a valid
    // out-of-band write BEFORE the UI's own edit session freezes its
    // baseline — simulating "someone else saved between your load and your
    // save" (SPEC-064 D5).
    const getResponse = await page.request.get(`${API_ORIGIN}/api/config`);
    expect(getResponse.ok()).toBe(true);
    const getBody = (await getResponse.json()) as { data: { hash: string } };
    const baseHash = getBody.data.hash;
    expect(baseHash.length).toBeGreaterThan(0);

    await team.getByRole("button", { name: "Edit" }).click();

    const oobResponse = await page.request.patch(`${API_ORIGIN}/api/dashboard/config`, {
      headers: { "Content-Type": "application/json", "If-Match": baseHash },
      data: { project: { author: "oob-concurrent-writer" } },
    });
    expect(oobResponse.ok()).toBe(true);

    const bytesAfterOob = readTeamConfigBytes();

    // The UI's edit session was frozen at `baseHash` (pre-OOB) — attempting
    // to save now must be rejected as stale, and must touch zero bytes.
    const numberInput = team.getByTestId("config-input-workflow.claim_ttl_minutes");
    const current = await numberInput.inputValue();
    await numberInput.fill(String(Number.parseInt(current, 10) + 1));
    await team.getByRole("button", { name: "Save" }).click();

    const conflictModal = page.getByRole("dialog", { name: "team config edit conflict" });
    await expect(conflictModal).toBeVisible();
    await expect(conflictModal.getByText("Nothing was written", { exact: false })).toBeVisible();

    const bytesAfterRejectedSave = readTeamConfigBytes();
    expect(bytesAfterRejectedSave).toBe(bytesAfterOob);

    await conflictModal.getByRole("button", { name: "Discard my changes" }).click();
    await expect(conflictModal).not.toBeVisible();
  });
});
