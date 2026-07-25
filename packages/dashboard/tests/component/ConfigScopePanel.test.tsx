// @vitest-environment jsdom
/**
 * @spec_ref SPEC-078 D5 R-13, T10 dispatch deliverable 3 (AC-078-7 component-test half)
 *
 * FOCUSED test for ConfigScopePanel's SPEC-078 T10 `project` prop — NOT full
 * coverage of the component (edit/save/conflict flows are covered by
 * `tests/e2e/settings-render.pw.ts` / `settings-write.pw.ts`; this file has
 * no dedicated pre-existing unit suite of its own). Scope: does the
 * `ProjectIdentityLabel` render adjacent to the Edit/Save controls when a
 * project context is active, and stay absent in registry-less mode.
 *
 * Test plan:
 *   HAPPY — project="acme" renders the label next to the Edit button.
 *   STATE — entering edit mode still shows the label next to Save/Cancel.
 *   NEGATIVE — project omitted/null renders no label (registry-less, R-15).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigScopePanel } from "@/components/ConfigScopePanel";
import { MACHINE_FIELD_SPECS } from "@/components/config-field-specs";
import type { ConfigReadResponse } from "@/lib/api";
import type { GlobalLoreConfig } from "@lore/core";

function makeData(): ConfigReadResponse<GlobalLoreConfig> {
  return {
    config: { defaults: {} },
    effects: {},
    hash: "abc123",
  };
}

describe("ConfigScopePanel — project identity label (SPEC-078 T10)", () => {
  describe("happy path", () => {
    it("renders the active project's name adjacent to the Edit control", () => {
      render(
        <ConfigScopePanel
          scope="machine"
          title="Machine"
          filePath="~/.config/lore/config.yaml"
          fieldSpecs={MACHINE_FIELD_SPECS}
          data={makeData()}
          isLoading={false}
          error={null}
          onSave={vi.fn()}
          onSaved={vi.fn()}
          project="acme"
        />,
      );

      const label = screen.getByTestId("project-identity-label");
      expect(label).toHaveTextContent("acme");
      const editButton = screen.getByRole("button", { name: "Edit" });
      expect(label.parentElement).toBe(editButton.parentElement);
    });
  });

  describe("state", () => {
    it("still shows the label adjacent to Save/Cancel once editing starts", async () => {
      const user = userEvent.setup();
      render(
        <ConfigScopePanel
          scope="machine"
          title="Machine"
          filePath="~/.config/lore/config.yaml"
          fieldSpecs={MACHINE_FIELD_SPECS}
          data={makeData()}
          isLoading={false}
          error={null}
          onSave={vi.fn()}
          onSaved={vi.fn()}
          project="acme"
        />,
      );

      await user.click(screen.getByRole("button", { name: "Edit" }));

      const label = screen.getByTestId("project-identity-label");
      const saveButton = screen.getByRole("button", { name: "Save" });
      expect(label.parentElement).toBe(saveButton.parentElement);
    });
  });

  describe("negative", () => {
    it("renders no label in registry-less mode (project omitted)", () => {
      render(
        <ConfigScopePanel
          scope="machine"
          title="Machine"
          filePath="~/.config/lore/config.yaml"
          fieldSpecs={MACHINE_FIELD_SPECS}
          data={makeData()}
          isLoading={false}
          error={null}
          onSave={vi.fn()}
          onSaved={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("project-identity-label")).not.toBeInTheDocument();
    });
  });
});
