/**
 * StatusPill — interactive status badge with a transition dropdown.
 * Purpose: let the user change doc status by clicking the pill and selecting a valid transition.
 * Public surface: StatusPill, StatusPillProps
 * Invariants:
 *   - Dropdown only shows transitions returned by getAllowedTransitions() SSOT (AC-DASH-WRITE-4).
 *   - "approve" transition is routed via the dedicated /approve endpoint (AC-DASH-WRITE-7).
 *   - "reject" transition shows an inline reason input before submitting.
 *   - When not in write mode (onTransition absent), renders as a plain badge (read-only).
 *   - Pending transitions are disabled (button shows loading state).
 * Side-effect class: IO (calls onTransition callback)
 * Source: SPEC-022 §9.2, AC-DASH-WRITE-4, AC-DASH-WRITE-7
 */

import { useState } from "react";
import { getAllowedTransitions } from "@lore/core";
import type { DocStatus } from "@lore/core";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StatusPillProps {
  /** Current document status. */
  status: DocStatus;
  /** When provided, makes the pill interactive with a transition dropdown. */
  onTransition?: (toStatus: DocStatus, reason?: string) => Promise<void>;
  /** When true, shows a loading spinner (transition in progress). */
  isPending?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<DocStatus, string> = {
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
  "in-review": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  archived: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  deprecated: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-100",
};

// reason: use raw status strings (lowercase) to match the data model and existing tests.
// TRANSITION_LABELS use friendlier text for the action affordances.
const STATUS_LABELS: Record<DocStatus, string> = {
  draft: "draft",
  "in-review": "in-review",
  approved: "approved",
  active: "active",
  archived: "archived",
  deprecated: "deprecated",
};

const TRANSITION_LABELS: Partial<Record<DocStatus, string>> = {
  "in-review": "Submit for review",
  approved: "Approve",
  active: "Activate",
  archived: "Archive",
  deprecated: "Deprecate",
  draft: "Return to draft",
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Interactive status pill that shows valid lifecycle transitions in a dropdown.
 * When onTransition is absent, renders as a static badge.
 *
 * @example
 * <StatusPill
 *   status={doc.status}
 *   onTransition={(to) => handleTransition(to)}
 *   isPending={isTransitioning}
 * />
 */
export function StatusPill({ status, onTransition, isPending }: StatusPillProps): React.ReactElement {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const colorClass = STATUS_COLORS[status] ?? "";
  const label = STATUS_LABELS[status] ?? status;

  // Read-only mode when no transition callback.
  if (onTransition === undefined) {
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        {label}
      </span>
    );
  }

  const allowedTransitions = getAllowedTransitions(status);

  function handleTransitionClick(toStatus: DocStatus): void {
    if (isPending === true || onTransition === undefined) return;

    // reason: "reject" is the `draft` reverse transition from "in-review".
    // We treat it specially by showing a reason input rather than immediately transitioning.
    // The actual transition target depends on what the ReviewService.reject() does.
    if (toStatus === "draft" && status === "in-review") {
      setShowRejectInput(true);
      return;
    }

    void onTransition(toStatus);
  }

  async function handleRejectConfirm(): Promise<void> {
    if (isPending === true || onTransition === undefined) return;
    await onTransition("draft", rejectReason || undefined);
    setShowRejectInput(false);
    setRejectReason("");
  }

  if (showRejectInput) {
    return (
      <div className="flex flex-col gap-2">
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="Rejection reason (optional)"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2">
          <button
            className="text-xs px-2 py-1 bg-destructive text-destructive-foreground rounded disabled:opacity-50"
            onClick={() => void handleRejectConfirm()}
            disabled={isPending}
            type="button"
          >
            {isPending === true ? "Rejecting..." : "Confirm reject"}
          </button>
          <button
            className="text-xs px-2 py-1 border rounded"
            onClick={() => setShowRejectInput(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (allowedTransitions.length === 0) {
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        {label}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer ${colorClass} hover:opacity-80 disabled:opacity-50`}
          disabled={isPending}
          type="button"
          aria-label={`Status: ${label}. Click to change`}
        >
          {isPending === true ? "..." : label}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <div className="px-2 py-1 text-xs text-muted-foreground">Transition to…</div>
        <DropdownMenuSeparator />
        {allowedTransitions.map((toStatus) => (
          <DropdownMenuItem
            key={toStatus}
            onClick={() => handleTransitionClick(toStatus)}
            className="text-sm"
          >
            {TRANSITION_LABELS[toStatus] ?? toStatus}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
