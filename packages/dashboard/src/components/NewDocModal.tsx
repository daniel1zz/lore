/**
 * NewDocModal — modal form for creating a new document.
 * Purpose: let the user specify type, title, and optional parent to create a doc.
 * Public surface: NewDocModal, NewDocModalProps
 * Invariants:
 *   - Client-side Zod validation (title required) before submission (AC-DASH-WRITE-10).
 *   - type-specific fields shown/hidden based on selected type.
 *   - Disabled when isPending; success closes modal and calls onSuccess.
 *   - Pressing Escape or clicking backdrop closes modal.
 * Side-effect class: IO (calls onCreate callback)
 * Source: SPEC-022 §9.2, AC-DASH-WRITE-10
 */

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { DocType, LinkType } from "@lore/core";
import { createDocInputSchema } from "@lore/core";
import type { CreateDocPayload } from "@/api/mutations";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewDocModalProps {
  /** Called with validated payload when the user submits. */
  onCreate: (payload: CreateDocPayload) => Promise<void>;
  /** Whether creation is in progress. */
  isPending: boolean;
  /** Error message from the server, if any. */
  error?: string | null;
  /** Close the modal. */
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DOC_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task"];

const TYPES_REQUIRING_PARENT: DocType[] = ["spec", "task"];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Modal form for creating a new Lore document.
 *
 * @example
 * {showCreate && (
 *   <NewDocModal
 *     onCreate={handleCreate}
 *     isPending={isCreating}
 *     error={createError}
 *     onClose={() => setShowCreate(false)}
 *   />
 * )}
 */
export function NewDocModal({ onCreate, isPending, error, onClose }: NewDocModalProps): React.ReactElement {
  const [docType, setDocType] = useState<DocType>("spec");
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState("");
  const [decisionStatus, setDecisionStatus] = useState<"proposed" | "accepted" | "deprecated" | "superseded">("proposed");
  const [subType, setSubType] = useState<"ideation" | "retro" | "research" | "reference">("research");
  const [planId, setPlanId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Close on Escape.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function buildPayload(): CreateDocPayload {
    const base: CreateDocPayload = {
      type: docType,
      title: title.trim(),
      ...(parentId.trim() !== "" ? { parent_id: parentId.trim() } : {}),
    };

    if (docType === "adr") {
      return { ...base, extra: { decision_status: decisionStatus } };
    }
    if (docType === "knowledge") {
      return { ...base, extra: { sub_type: subType } };
    }
    if (docType === "task") {
      return {
        ...base,
        extra: { plan_id: planId.trim() !== "" ? planId.trim() : undefined },
      };
    }
    return base;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setValidationError(null);

    const payload = buildPayload();
    // Client-side Zod validation (AC-DASH-WRITE-10).
    const result = createDocInputSchema.safeParse(payload);
    if (!result.success) {
      const issue = result.error.issues[0];
      setValidationError(issue?.message ?? "Validation failed");
      return;
    }

    await onCreate(result.data);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create new document"
      onClick={onClose}
    >
      <form
        className="bg-background border rounded-lg shadow-xl w-full max-w-md flex flex-col gap-4 p-6"
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">New document</h2>
          <button onClick={onClose} type="button" className="p-1 rounded hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Type selector */}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="doc-type">Type</label>
          <select
            id="doc-type"
            className="w-full border rounded px-3 py-2 text-sm bg-background"
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocType)}
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="doc-title">
            Title <span className="text-destructive">*</span>
          </label>
          <input
            id="doc-title"
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Document title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </div>

        {/* Parent ID — required for spec/task */}
        {(TYPES_REQUIRING_PARENT.includes(docType) || parentId !== "") && (
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="parent-id">
              Parent ID
              {TYPES_REQUIRING_PARENT.includes(docType) && (
                <span className="text-destructive"> *</span>
              )}
            </label>
            <input
              id="parent-id"
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="ULID or slug of parent doc"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            />
          </div>
        )}

        {/* ADR-specific: decision_status */}
        {docType === "adr" && (
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="decision-status">Decision status</label>
            <select
              id="decision-status"
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              value={decisionStatus}
              onChange={(e) => setDecisionStatus(e.target.value as typeof decisionStatus)}
            >
              <option value="proposed">proposed</option>
              <option value="accepted">accepted</option>
              <option value="deprecated">deprecated</option>
              <option value="superseded">superseded</option>
            </select>
          </div>
        )}

        {/* Knowledge-specific: sub_type */}
        {docType === "knowledge" && (
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="sub-type">Sub-type</label>
            <select
              id="sub-type"
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              value={subType}
              onChange={(e) => setSubType(e.target.value as typeof subType)}
            >
              <option value="ideation">ideation</option>
              <option value="retro">retro</option>
              <option value="research">research</option>
              <option value="reference">reference</option>
            </select>
          </div>
        )}

        {/* Task-specific: plan_id */}
        {docType === "task" && (
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="plan-id">
              Plan ID <span className="text-destructive">*</span>
            </label>
            <input
              id="plan-id"
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="ULID or slug of parent plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            />
          </div>
        )}

        {/* Errors */}
        {(validationError !== null || error !== null) && (
          <p className="text-xs text-destructive">
            {validationError ?? error}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded hover:bg-muted"
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            disabled={isPending || title.trim() === ""}
          >
            {isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
