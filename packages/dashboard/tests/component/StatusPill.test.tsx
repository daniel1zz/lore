// @vitest-environment jsdom
/**
 * Tests for StatusPill component (interactive status badge + transition dropdown).
 * Source: SPEC-022 §9.2, AC-DASH-WRITE-4, AC-DASH-WRITE-7 / SPEC-027 dispatch AC-DH-8.
 *
 * Note on scope: StatusPill itself is a thin presentational SSOT-driven component —
 * it calls `onTransition(toStatus, reason?)` generically and leaves routing to a
 * specific endpoint (approve / reject / generic PATCH) to the caller (DocDetail's
 * handleTransition, already covered end-to-end by DocDetail.write.test.tsx AC-DH-2).
 * These tests pin StatusPill's own contract: which transitions it *offers* (driven
 * by getAllowedTransitions(), never hardcoded) and what it *calls back with*.
 *
 * Test plan:
 *   HAPPY:
 *     - Read-only mode (no onTransition) renders a plain badge with the status label.
 *     - Interactive mode renders a clickable trigger; opening it lists exactly the
 *       transitions from a draft status (in-review, approved).
 *   NEGATIVE:
 *     - Read-only mode renders no button at all (no accidental interactivity).
 *     - A terminal status (archived) with onTransition supplied still renders a
 *       plain badge, not a dropdown — guards against hardcoding "always show menu
 *       when write mode" instead of consulting the real allowed-transitions list.
 *   BOUNDARY:
 *     - The dropdown transition set for "approved" status matches the literal
 *       SPEC-002 §3 lifecycle graph (active, archived, deprecated) — pinned
 *       against the spec, not against the implementation being tested.
 *   ERROR:
 *     - While isPending is true, the trigger is disabled and clicking it fires
 *       no onTransition call and opens no menu (defensive guard against
 *       double-submission mid-flight).
 *   STATE:
 *     - Clicking a normal (non-reject) transition item calls onTransition with
 *       exactly that target status and no reason.
 *     - Clicking "Return to draft" from "in-review" status does NOT call
 *       onTransition immediately — it shows the inline reject-reason input first.
 *     - Typing a reason and confirming calls onTransition("draft", reason).
 *     - Cancelling the reject input calls onTransition zero times and returns
 *       to the normal badge/dropdown view.
 *   REGRESSION:
 *     - Confirming reject with an EMPTY reason passes `undefined` (not an empty
 *       string) as the reason — this is the exact "" -> undefined coercion the
 *       component performs (`rejectReason || undefined`).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusPill } from "../../src/components/StatusPill";

// Radix DropdownMenu calls these DOM APIs during open/close; jsdom throws
// rather than no-ops without them. Local to this file (see DocDetail.write.test.tsx
// for the same pattern) so it cannot affect other test files' jsdom environments.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

async function openMenu(user: ReturnType<typeof userEvent.setup>, status: string): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: new RegExp(`^Status: ${status}`) }));
  return screen.findByRole("menu");
}

describe("StatusPill", () => {
  describe("happy path", () => {
    it("renders a plain badge with the status label when read-only (no onTransition)", () => {
      render(<StatusPill status="draft" />);
      expect(screen.getByText("draft")).toBeInTheDocument();
    });

    it("renders an interactive trigger for a draft doc when onTransition is supplied", () => {
      render(<StatusPill status="draft" onTransition={vi.fn()} />);
      expect(screen.getByRole("button", { name: /^Status: draft/ })).toBeInTheDocument();
    });

    it("lists exactly the draft transitions (Submit for review, Approve, Deprecate) in the dropdown", async () => {
      const user = userEvent.setup();
      render(<StatusPill status="draft" onTransition={vi.fn()} />);
      const menu = await openMenu(user, "draft");

      expect(within(menu).getByText("Submit for review")).toBeInTheDocument();
      expect(within(menu).getByText("Approve")).toBeInTheDocument();
      expect(within(menu).getByText("Deprecate")).toBeInTheDocument();
      expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    });
  });

  describe("negative", () => {
    it("renders no button in read-only mode", () => {
      render(<StatusPill status="active" />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders a plain badge (no dropdown) for a terminal status even with onTransition supplied", () => {
      render(<StatusPill status="archived" onTransition={vi.fn()} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByText("archived")).toBeInTheDocument();
    });
  });

  describe("boundary: SSOT-driven transition set", () => {
    it("offers exactly {active, archived, deprecated} for 'approved' status per SPEC-002 §3", async () => {
      const user = userEvent.setup();
      render(<StatusPill status="approved" onTransition={vi.fn()} />);
      const menu = await openMenu(user, "approved");

      const items = within(menu).getAllByRole("menuitem").map((el) => el.textContent);
      expect(items).toHaveLength(3);
      expect(items).toEqual(
        expect.arrayContaining(["Activate", "Archive", "Deprecate"]),
      );
    });
  });

  describe("error: pending guard", () => {
    it("marks the trigger as natively disabled while isPending", () => {
      render(<StatusPill status="draft" onTransition={vi.fn()} isPending />);
      expect(screen.getByRole("button", { name: /^Status:/ })).toBeDisabled();
    });

    it("never invokes onTransition from a click while isPending, even if the menu opens", async () => {
      const onTransition = vi.fn();
      const user = userEvent.setup();
      render(<StatusPill status="draft" onTransition={onTransition} isPending />);

      const trigger = screen.getByRole("button", { name: /^Status:/ });
      await user.click(trigger);
      const menu = screen.queryByRole("menu");
      if (menu !== null) {
        // If the menu did open, clicking an item must still be a no-op —
        // handleTransitionClick's own `isPending === true` guard is the last
        // line of defense (see the DEFECT test below for why it's reached).
        await user.click(within(menu).getByText("Submit for review"));
      }
      expect(onTransition).not.toHaveBeenCalled();
    });

    // DEFECT (found while writing this test, not pre-existing/expected):
    // StatusPill sets `disabled={isPending}` only on the inner <button>
    // (src/components/StatusPill.tsx `disabled={isPending}` on the trigger
    // button). Radix's <DropdownMenuTrigger> gates its pointerdown-based
    // open handler on its OWN `disabled` prop (default false) — see
    // node_modules/@radix-ui/react-dropdown-menu onPointerDown:
    // `if (!disabled && event.button === 0 ...)` — which reads the prop
    // passed to <DropdownMenuTrigger> itself, never the merged child's HTML
    // `disabled` attribute. StatusPill never passes `disabled` to
    // <DropdownMenuTrigger>, so the menu still opens on click/pointerdown
    // while a transition is in flight — contradicting this component's own
    // documented invariant ("Pending transitions are disabled (button shows
    // loading state)"). The onTransition callback itself is NOT reachable
    // (handleTransitionClick's `isPending === true` guard blocks it — see
    // the test above) but the dropdown visibly opens, letting a user
    // interact with a menu that silently no-ops. Fix: pass
    // `disabled={isPending === true}` to <DropdownMenuTrigger> as well.
    it("DEFECT: the transition menu still opens on click while isPending (should stay closed)", async () => {
      const user = userEvent.setup();
      render(<StatusPill status="draft" onTransition={vi.fn()} isPending />);

      await user.click(screen.getByRole("button", { name: /^Status:/ }));

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("calls onTransition with exactly the clicked target status (no reason) for a normal transition", async () => {
      const onTransition = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<StatusPill status="active" onTransition={onTransition} />);
      const menu = await openMenu(user, "active");

      await user.click(within(menu).getByText("Archive"));

      expect(onTransition).toHaveBeenCalledTimes(1);
      expect(onTransition).toHaveBeenCalledWith("archived");
    });

    it("shows the reject-reason input instead of calling onTransition immediately for in-review -> draft", async () => {
      const onTransition = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<StatusPill status="in-review" onTransition={onTransition} />);
      const menu = await openMenu(user, "in-review");

      await user.click(within(menu).getByText("Return to draft"));

      expect(onTransition).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText("Rejection reason (optional)")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm reject" })).toBeInTheDocument();
    });

    it("calls onTransition('draft', reason) after typing a reason and confirming", async () => {
      const onTransition = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<StatusPill status="in-review" onTransition={onTransition} />);
      const menu = await openMenu(user, "in-review");
      await user.click(within(menu).getByText("Return to draft"));

      await user.type(screen.getByPlaceholderText("Rejection reason (optional)"), "needs more detail");
      await user.click(screen.getByRole("button", { name: "Confirm reject" }));

      expect(onTransition).toHaveBeenCalledTimes(1);
      expect(onTransition).toHaveBeenCalledWith("draft", "needs more detail");
    });

    it("cancelling the reject input calls onTransition zero times and returns to the dropdown badge", async () => {
      const onTransition = vi.fn();
      const user = userEvent.setup();
      render(<StatusPill status="in-review" onTransition={onTransition} />);
      const menu = await openMenu(user, "in-review");
      await user.click(within(menu).getByText("Return to draft"));

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onTransition).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText("Rejection reason (optional)")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Status: in-review/ })).toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("passes undefined (not an empty string) as the reason when confirming reject with no text entered", async () => {
      const onTransition = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<StatusPill status="in-review" onTransition={onTransition} />);
      const menu = await openMenu(user, "in-review");
      await user.click(within(menu).getByText("Return to draft"));

      await user.click(screen.getByRole("button", { name: "Confirm reject" }));

      expect(onTransition).toHaveBeenCalledWith("draft", undefined);
    });
  });
});
