// @vitest-environment jsdom
/**
 * Tests for NewDocModal component (create-document form).
 * Source: SPEC-022 §9.2, AC-DASH-WRITE-10 / SPEC-026 §4 AC-ASSESS-11 (assessment
 * sub_type exclusion) / SPEC-027 dispatch AC-DH-8.
 *
 * These tests deliberately drive the REAL `createDocInputSchema` from `@lore/core`
 * (not a mock) — the component's own client-side validation contract is the thing
 * under test, so faking the schema would make these tests tautological.
 *
 * Test plan:
 *   HAPPY:
 *     - Creating a "prd" (no parent/extra required) calls onCreate with the
 *       trimmed title and no parent_id.
 *     - Creating a "spec" with a parent id calls onCreate with parent_id set.
 *   NEGATIVE:
 *     - Submitting a "spec" with no parent id shows the schema's
 *       "parent_id is required for type 'spec'" validation error and never
 *       calls onCreate (fail loud, not a silent skip).
 *     - Submitting a "task" with a parent id but no plan id shows the
 *       "task requires extra.plan_id" validation error and never calls onCreate.
 *   BOUNDARY:
 *     - A whitespace-only title is trimmed to empty by buildPayload, which the
 *       Create button's own `disabled` condition (`title.trim() === ""`) blocks —
 *       submitting the form directly still yields the "Title must not be empty"
 *       error rather than an accidental empty-titled doc.
 *     - The knowledge-type sub-type dropdown never includes "assessment"
 *       (SPEC-026 AC-ASSESS-11 — assessment docs require a Zod-valid
 *       extra.assessment payload this simple form cannot collect).
 *   ERROR:
 *     - A server-side error passed via the `error` prop (fail-loud path, e.g.
 *       an API_ERROR bubbled up from apiCreateDoc) is rendered, not swallowed.
 *   STATE:
 *     - Selecting "adr" reveals the decision_status field; switching to "prd"
 *       hides all type-specific fields again.
 *     - Escape closes the modal via onClose.
 *   REGRESSION:
 *     - onCreate receives the type-specific `extra` shape appropriate to the
 *       selected type (adr -> decision_status, knowledge -> sub_type, task ->
 *       plan_id) rather than a hardcoded/omitted extra object.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewDocModal } from "../../src/components/NewDocModal";

function renderModal(overrides: Partial<Parameters<typeof NewDocModal>[0]> = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const props = {
    onCreate,
    isPending: false,
    error: null,
    onClose,
    ...overrides,
  };
  const result = render(<NewDocModal {...props} />);
  return { ...result, onCreate, onClose };
}

async function selectType(user: ReturnType<typeof userEvent.setup>, type: string): Promise<void> {
  await user.selectOptions(screen.getByLabelText("Type"), type);
}

describe("NewDocModal", () => {
  describe("happy path", () => {
    it("creates a prd with a trimmed title and no parent_id", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "prd");
      await user.type(screen.getByLabelText(/Title/), "  My New PRD  ");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(onCreate).toHaveBeenCalledTimes(1);
      const payload = onCreate.mock.calls[0]?.[0];
      expect(payload.type).toBe("prd");
      expect(payload.title).toBe("My New PRD");
      expect(payload.parent_id).toBeUndefined();
    });

    it("creates a spec with the entered parent_id", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "spec");
      await user.type(screen.getByLabelText(/Title/), "My Spec");
      await user.type(screen.getByLabelText(/Parent ID/), "01HPARENT000000000000000001");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(onCreate).toHaveBeenCalledTimes(1);
      const payload = onCreate.mock.calls[0]?.[0];
      expect(payload.type).toBe("spec");
      expect(payload.parent_id).toBe("01HPARENT000000000000000001");
    });
  });

  describe("negative", () => {
    it("rejects a spec with no parent_id (fail loud, not silent skip)", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "spec");
      await user.type(screen.getByLabelText(/Title/), "Spec without parent");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(
        screen.getByText("Choose a parent document — every spec lives under one."),
      ).toBeInTheDocument();
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("rejects a task with a parent_id but no plan_id", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "task");
      await user.type(screen.getByLabelText(/Title/), "Task without plan");
      await user.type(screen.getByLabelText(/Parent ID/), "01HPARENT000000000000000001");
      // Deliberately leave "Plan ID" blank.
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(screen.getByText("task requires extra.plan_id")).toBeInTheDocument();
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("passes a non-parent_id validation message through verbatim (D6 — only the parent_id issue is humanized)", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "task");
      await user.type(screen.getByLabelText(/Title/), "Task without plan, with parent");
      await user.type(screen.getByLabelText(/Parent ID/), "01HPARENT000000000000000001");
      // parent_id is filled in, so the only remaining issue is "task requires
      // extra.plan_id" — its raw Zod message must render unchanged, proving the
      // NewDocModal message mapping matches on parent_id specifically rather than
      // rewriting every validation issue.
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(screen.getByText("task requires extra.plan_id")).toBeInTheDocument();
      expect(
        screen.queryByText("Choose a parent document — every task lives under one."),
      ).not.toBeInTheDocument();
      expect(onCreate).not.toHaveBeenCalled();
    });
  });

  describe("boundary", () => {
    it("disables Create for a whitespace-only title, and a forced submit still reports the empty-title error", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "prd");
      await user.type(screen.getByLabelText(/Title/), "   ");
      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

      // Bypass the disabled button to exercise the form's own submit-time guard.
      const form = screen.getByRole("button", { name: "Create" }).closest("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form as HTMLFormElement);

      expect(screen.getByText("Title must not be empty")).toBeInTheDocument();
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("never offers 'assessment' as a knowledge sub-type option", async () => {
      const user = userEvent.setup();
      renderModal();

      await selectType(user, "knowledge");
      const subTypeSelect = screen.getByLabelText("Sub-type") as HTMLSelectElement;
      const optionValues = Array.from(subTypeSelect.options).map((o) => o.value);

      expect(optionValues).toEqual(["ideation", "retro", "research", "reference"]);
      expect(optionValues).not.toContain("assessment");
    });
  });

  describe("error", () => {
    it("renders a server-side error passed via the error prop (fail loud, never swallowed)", () => {
      renderModal({ error: "API_ERROR: something went wrong upstream" });
      expect(screen.getByText("API_ERROR: something went wrong upstream")).toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("shows the decision_status field only when type is adr", async () => {
      const user = userEvent.setup();
      renderModal();

      expect(screen.queryByLabelText("Decision status")).not.toBeInTheDocument();

      await selectType(user, "adr");
      expect(screen.getByLabelText("Decision status")).toBeInTheDocument();

      await selectType(user, "prd");
      expect(screen.queryByLabelText("Decision status")).not.toBeInTheDocument();
    });

    it("closes the modal when Escape is pressed", () => {
      const { onClose } = renderModal();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("regression", () => {
    it("submits extra.decision_status for adr (not a hardcoded/omitted extra)", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "adr");
      await user.type(screen.getByLabelText(/Title/), "My ADR");
      await user.selectOptions(screen.getByLabelText("Decision status"), "accepted");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate.mock.calls[0]?.[0].extra).toEqual({ decision_status: "accepted" });
    });

    it("submits extra.sub_type for knowledge matching the selected option (not always the default)", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "knowledge");
      await user.type(screen.getByLabelText(/Title/), "My Knowledge Doc");
      await user.selectOptions(screen.getByLabelText("Sub-type"), "retro");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate.mock.calls[0]?.[0].extra).toEqual({ sub_type: "retro" });
    });

    it("submits extra.plan_id for task matching the entered plan id", async () => {
      const user = userEvent.setup();
      const { onCreate } = renderModal();

      await selectType(user, "task");
      await user.type(screen.getByLabelText(/Title/), "My Task");
      await user.type(screen.getByLabelText(/Parent ID/), "01HPARENT000000000000000001");
      await user.type(screen.getByLabelText(/Plan ID/), "01HPLAN0000000000000000001");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate.mock.calls[0]?.[0].extra).toEqual({ plan_id: "01HPLAN0000000000000000001" });
    });
  });

  // ─── ASYNC2D-002 — double-submit guard ──────────────────────────────────────
  describe("ASYNC2D-002: exactly one create fires while a submission is pending", () => {
    /**
     * Reproduces the finding directly: the Create BUTTON is `disabled` while
     * pending, but the title <input> is not (pre-fix) — and a form's native
     * "submit" event (which Enter-in-a-text-field dispatches) does not route
     * through any specific button's disabled attribute, so it reaches
     * handleSubmit regardless. Firing `submit` on the <form> directly is the
     * environment-agnostic way to exercise that exact path without depending
     * on jsdom/browser implicit-submission nuances.
     */
    it("ignores a stray form submit (e.g. Enter in the title field) while a create is already in flight", async () => {
      const user = userEvent.setup();
      // Type a VALID title first so the guard under test — isPending, not the
      // pre-existing empty-title validation — is what blocks this submission.
      const { rerender } = render(
        <NewDocModal onCreate={vi.fn()} isPending={false} error={null} onClose={vi.fn()} />,
      );
      // "prd" needs no parent_id/extra — isolates the pending guard under test
      // from the pre-existing (and separately tested) schema-validation path.
      await selectType(user, "prd");
      await user.type(screen.getByLabelText(/Title/), "A valid title");

      // Simulate the parent having already flagged pending (e.g. from the
      // first, legitimate submit) by re-rendering with isPending: true and a
      // fresh onCreate spy, then firing a second, stray form submission.
      const onCreate = vi.fn().mockResolvedValue(undefined);
      rerender(<NewDocModal onCreate={onCreate} isPending={true} error={null} onClose={vi.fn()} />);

      const form = screen.getByRole("button", { name: "Creating..." }).closest("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form as HTMLFormElement);

      expect(onCreate).not.toHaveBeenCalled();
    });

    it("disables the title input while a create is in flight (not just the Create button)", () => {
      renderModal({ isPending: true });
      expect(screen.getByLabelText(/Title/)).toBeDisabled();
    });

    it("does not disable the title input when idle (no regression to normal editing)", () => {
      renderModal({ isPending: false });
      expect(screen.getByLabelText(/Title/)).not.toBeDisabled();
    });
  });
});
