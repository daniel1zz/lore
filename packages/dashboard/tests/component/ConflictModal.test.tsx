// @vitest-environment jsdom
/**
 * Tests for ConflictModal component (409 optimistic-concurrency conflict UX).
 * Source: SPEC-022 §9.4, Q2 / SPEC-027 §DiffView extraction (AC-DH-4) / dispatch AC-DH-8.
 *
 * Test plan:
 *   HAPPY:
 *     - Renders the "You wrote" and "Now on server" panes with the client draft
 *       and server-current content respectively.
 *     - Renders the server's version number in both the header and the
 *       "Now on server" pane label.
 *   NEGATIVE:
 *     - Renders no diff-disclosure button at all when the diff string is blank
 *       (whitespace-only) — SPEC-027 controlled-disclosure invariant only
 *       mounts the section when there is a non-empty diff to show.
 *   BOUNDARY:
 *     - The diff lines are absent from the DOM until "Show unified diff" is
 *       clicked, and become present after — and re-collapsing removes them
 *       again (controlled disclosure, not a native <details> that keeps
 *       children mounted-but-hidden).
 *   ERROR:
 *     - n/a as a distinct dimension here: ConflictModal is presentation-only
 *       (no IO of its own — "Side-effect class: pure"), so there is no
 *       provider-facing error path to exercise beyond the callbacks already
 *       covered under HAPPY/STATE. Covered instead by DocDetail.write.test.tsx
 *       (AC-DH-2), which drives the real apiPatchDoc 409 path that produces
 *       the props this component renders.
 *   STATE:
 *     - Escape key calls onClose.
 *     - Force Overwrite button is disabled while isPending is true and shows
 *       the "Saving..." label; Cancel is disabled too (no operations allowed
 *       mid-flight).
 *     - Clicking Force Overwrite (when not pending) calls onForceOverwrite.
 *   REGRESSION:
 *     - The diff pane actually renders the real DiffView (color-coded lines),
 *       not just raw text — guards against ConflictModal reverting to an
 *       inline reimplementation instead of the shared component.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConflictModal } from "../../src/components/ConflictModal";
import type { DocRecord } from "@lore/core";

function makeServerDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HTEST00000000000000000001",
    slug: "prd-doc-a",
    title: "Document A",
    type: "prd",
    role: "intent",
    status: "active",
    priority: "medium",
    content: "Server content",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    created_by: "alice",
    parent_id: null,
    tags: [],
    extra: {},
    version: 9,
    deleted_at: null,
    ...overrides,
  };
}

function renderModal(overrides: Partial<Parameters<typeof ConflictModal>[0]> = {}) {
  const onForceOverwrite = vi.fn();
  const onClose = vi.fn();
  const props = {
    serverDoc: makeServerDoc(),
    myContent: "My draft content",
    diff: "@@ -1 +1 @@\n-old\n+new",
    isPending: false,
    onForceOverwrite,
    onClose,
    ...overrides,
  };
  const result = render(<ConflictModal {...props} />);
  return { ...result, onForceOverwrite, onClose, props };
}

describe("ConflictModal", () => {
  describe("happy path", () => {
    it("renders the client draft in the 'You wrote' pane", () => {
      renderModal({ myContent: "unsaved client edits" });
      expect(screen.getByText("unsaved client edits")).toBeInTheDocument();
    });

    it("renders the server content in the 'Now on server' pane", () => {
      renderModal({ serverDoc: makeServerDoc({ content: "fresh server text", version: 12 }) });
      expect(screen.getByText("fresh server text")).toBeInTheDocument();
    });

    it("renders the server's version number in the header", () => {
      renderModal({ serverDoc: makeServerDoc({ version: 42 }) });
      expect(screen.getByText(/now at v42/)).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders no diff-disclosure button when the diff is blank", () => {
      renderModal({ diff: "   " });
      expect(screen.queryByText("Show unified diff")).not.toBeInTheDocument();
      expect(screen.queryByText("Hide unified diff")).not.toBeInTheDocument();
    });
  });

  describe("boundary: controlled diff disclosure", () => {
    it("does not mount diff lines until expanded, and mounts them after clicking", async () => {
      const user = userEvent.setup();
      renderModal({ diff: "@@ -1 +1 @@\n-old line\n+new line" });

      // Collapsed: diff text absent from the DOM entirely.
      expect(screen.queryByText("-old line")).not.toBeInTheDocument();
      expect(screen.queryByText("+new line")).not.toBeInTheDocument();

      const toggle = screen.getByRole("button", { name: "Show unified diff" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      await user.click(toggle);

      expect(screen.getByText("-old line")).toBeInTheDocument();
      expect(screen.getByText("+new line")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Hide unified diff" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    it("removes diff lines from the DOM again after re-collapsing", async () => {
      const user = userEvent.setup();
      renderModal({ diff: "-old line\n+new line" });

      await user.click(screen.getByRole("button", { name: "Show unified diff" }));
      expect(screen.getByText("-old line")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Hide unified diff" }));
      expect(screen.queryByText("-old line")).not.toBeInTheDocument();
      expect(screen.queryByText("+new line")).not.toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("calls onClose when Escape is pressed", () => {
      const { onClose } = renderModal();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not call onClose for a non-Escape key", () => {
      const { onClose } = renderModal();
      fireEvent.keyDown(document, { key: "Enter" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("disables Force Overwrite and shows 'Saving...' while isPending", () => {
      renderModal({ isPending: true });
      const button = screen.getByRole("button", { name: "Saving..." });
      expect(button).toBeDisabled();
    });

    it("disables Cancel while isPending", () => {
      renderModal({ isPending: true });
      expect(screen.getByRole("button", { name: "Cancel — keep editing" })).toBeDisabled();
    });

    it("enables and labels Force Overwrite normally when not pending", () => {
      renderModal({ isPending: false });
      const button = screen.getByRole("button", { name: "Force overwrite" });
      expect(button).not.toBeDisabled();
    });

    it("calls onForceOverwrite when Force Overwrite is clicked (not pending)", async () => {
      const user = userEvent.setup();
      const { onForceOverwrite } = renderModal({ isPending: false });
      await user.click(screen.getByRole("button", { name: "Force overwrite" }));
      expect(onForceOverwrite).toHaveBeenCalledTimes(1);
    });
  });

  describe("regression", () => {
    it("renders diff lines through the shared DiffView color-coding (not a plain re-implementation)", async () => {
      const user = userEvent.setup();
      const { container } = renderModal({ diff: "+added\n-removed" });
      await user.click(screen.getByRole("button", { name: "Show unified diff" }));

      const added = screen.getByText("+added");
      const removed = screen.getByText("-removed");
      expect(added).toHaveClass("text-green-600");
      expect(removed).toHaveClass("text-red-600");
      // DiffView renders inside a <pre>, confirming it's the shared component's markup.
      expect(container.querySelector("pre > span")).not.toBeNull();
    });
  });
});
