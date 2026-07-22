/**
 * SPEC-064 dashboard Settings — RENDER invariants e2e coverage (AC-064-1).
 *
 * Read-only suite: never PATCHes any config, in either scope. Boots against
 * the shared throwaway corpus (`global-setup.ts`) for the TEAM scope. The
 * MACHINE scope panel reads the real machine-global XDG config
 * (`~/.config/lore/config.yaml` / `$LORE_CONFIG_HOME`) because global config
 * is genuinely machine-scoped, not corpus-scoped (SPEC-064 Overview table) —
 * this suite asserts STRUCTURE only (containers / rows / disclosure /
 * precedence-table shape), never a specific machine-config VALUE, so it is
 * safe to run against whatever (if anything) that file currently holds on
 * the machine executing it.
 *
 * Auth: same zero-manual-cookie pattern as every other suite in this
 * directory — `global-setup.ts` boots Vite with `VITE_LORE_BOOTSTRAP_TOKEN`
 * set, so the first full page load exchanges it for a real `lore_sid` cookie
 * via `bootstrapAuthIfNeeded()`.
 *
 * Source: SPEC-064 §Acceptance Criteria AC-064-1; §Design D1-D4.
 * @spec_ref AC-064-1
 */

import { test, expect } from "@playwright/test";

test.describe("SPEC-064 Settings — render invariants", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    // Both scopes must leave their loading skeleton (each only renders its own
    // "Edit" button once `!isLoading && error === null && data !== undefined`,
    // ConfigScopePanel.tsx) before any structural assertion below is meaningful.
    await expect(page.getByTestId("settings-team-scope").getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.getByTestId("settings-machine-scope").getByRole("button", { name: "Edit" })).toBeVisible();
  });

  test("both scope containers render, visually distinct", async ({ page }) => {
    const team = page.getByTestId("settings-team-scope");
    const machine = page.getByTestId("settings-machine-scope");

    await expect(team).toBeVisible();
    await expect(machine).toBeVisible();

    // "Visually distinct" (SPEC-064 Overview: "never two collapsible sections
    // of one list") is asserted as a COMPARATIVE property — each carries its
    // own accent class and NEITHER carries the other's, not merely "each has
    // some class."
    await expect(team).toHaveClass(/border-blue-200/);
    await expect(machine).toHaveClass(/border-amber-300/);
    await expect(team).not.toHaveClass(/border-amber-300/);
    await expect(machine).not.toHaveClass(/border-blue-200/);

    // filePath text is unique to each panel's <p> subtitle (the <h2> title
    // also contains ".lore/config.yaml" as a substring, so match on the
    // filePath-only wording to avoid a strict-mode multi-match).
    await expect(team.getByText("git-tracked — changes apply to the whole team", { exact: false })).toBeVisible();
    await expect(machine.getByText("never git-tracked", { exact: false })).toBeVisible();
  });

  test("machine-scope blast-radius disclosure is present in the DOM, scoped to the machine container", async ({
    page,
  }) => {
    const disclosure = page.getByTestId("machine-blast-radius-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText("every corpus on this machine");

    // D3's whole point is a boundary marker at the HIGHER-blast-radius scope —
    // it must live inside the machine container, never the team one.
    await expect(
      page.getByTestId("settings-machine-scope").getByTestId("machine-blast-radius-disclosure"),
    ).toHaveCount(1);
    await expect(page.getByTestId("settings-team-scope").getByTestId("machine-blast-radius-disclosure")).toHaveCount(
      0,
    );
  });

  test("team scope: every present deny key renders read-only with the YAML note, contrasted against an editable row", async ({
    page,
  }) => {
    const team = page.getByTestId("settings-team-scope");
    await team.getByRole("button", { name: "Edit" }).click();

    // Both deny keys that are actually PRESENT as declared rows for the team
    // scope (TEAM_FIELD_SPECS includes both `defaults.editor` and
    // `verify.env.passthrough_all` — the other CONFIG_DENY_KEYS entries are
    // wildcard provider/header patterns with nothing seeded to match them on
    // a fresh corpus, so they render no row at all — nothing to assert).
    for (const path of ["defaults.editor", "verify.env.passthrough_all"]) {
      const row = team.getByTestId(`config-row-${path}`);
      await expect(row).toHaveAttribute("data-denied", "true");
      await expect(row).toContainText("Read-only — edit via YAML");
      await expect(row.getByTestId(`config-input-${path}`)).toHaveCount(0);
      await expect(row.locator("input, select")).toHaveCount(0);
    }

    // Contrast: a NON-denied row in the SAME scope, in the SAME edit session,
    // DOES render an enabled input — proves the zero-input assertions above
    // are a real signal (D2 enforcement), not an artifact of inputs never
    // rendering at all in this state.
    const editableRow = team.getByTestId("config-row-sync.enabled");
    await expect(editableRow).not.toHaveAttribute("data-denied", "true");
    await expect(editableRow.getByTestId("config-input-sync.enabled")).toBeEnabled();

    await team.getByRole("button", { name: "Cancel" }).click();
  });

  test("machine scope: defaults.editor renders read-only; format/color remain editable (D1 writable surface)", async ({
    page,
  }) => {
    const machine = page.getByTestId("settings-machine-scope");
    await machine.getByRole("button", { name: "Edit" }).click();

    const editorRow = machine.getByTestId("config-row-defaults.editor");
    await expect(editorRow).toHaveAttribute("data-denied", "true");
    await expect(editorRow).toContainText("Read-only — edit via YAML");
    await expect(editorRow.locator("input, select")).toHaveCount(0);

    // D1: one CONFIG_DENY_KEYS SSOT governs both scopes — the machine scope's
    // writable surface is EXACTLY `defaults.format` + `defaults.color`.
    await expect(machine.getByTestId("config-input-defaults.format")).toBeEnabled();
    await expect(machine.getByTestId("config-input-defaults.color")).toBeEnabled();

    await machine.getByRole("button", { name: "Cancel" }).click();
  });

  test("defaults.* precedence rows show all 3 layers with exactly 1 marked effective", async ({ page }) => {
    await expect(page.getByTestId("defaults-precedence")).toBeVisible();

    for (const key of ["editor", "format", "color"]) {
      const row = page.getByTestId(`precedence-row-${key}`);
      await expect(row).toBeVisible();
      // 4 <td> per row: the key/path column + 3 LayerCell instances
      // (machine, project, built-in) — DefaultsPrecedenceTable.tsx.
      await expect(row.locator("td")).toHaveCount(4);
      await expect(row.locator('td[data-effective="true"]')).toHaveCount(1);
    }
  });
});
