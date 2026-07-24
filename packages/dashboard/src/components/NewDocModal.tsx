/**
 * NewDocModal — modal form for creating a new document.
 * Purpose: let the user specify type, title, and optional parent to create a doc.
 * Public surface: NewDocModal, NewDocModalProps
 * Invariants:
 *   - Client-side Zod validation (title required) before submission (AC-DASH-WRITE-10).
 *   - type-specific fields shown/hidden based on selected type.
 *   - Disabled when isPending; success closes modal and calls onSuccess.
 *   - Pressing Escape or clicking backdrop closes modal.
 *   - handleSubmit guards on `isPending` FIRST, before any validation or
 *     payload work (mirrors StatusPill.handleTransitionClick's pattern) —
 *     ASYNC2D-002. The Create button's `disabled` attribute alone is not
 *     sufficient: a form's native "submit" event (which Enter in a focused
 *     text field dispatches) reaches handleSubmit independently of any one
 *     button's disabled state, so without this guard a stray Enter while a
 *     create is already in flight could fire a second, duplicate
 *     `apiCreateDoc` racing the first. The title input is ALSO disabled while
 *     pending, narrowing (not replacing) that surface.
 *   - `docType === "spec"` is create-time BLOCKED (ADR: adr-newdocmodal-spec-create-cli-skill-only-authoring-disable):
 *     the spec-create gate (`hasSkeleton` + the deterministic/structured-AC rules
 *     in knowledge-write-spec-rules-gate-feeding-source) requires a skeleton
 *     PLUS follow-up `lore ac add` calls that this quick-create form has no way
 *     to collect — a seeded template would only mechanically pass the gate while
 *     staying hollow. So no `POST /api/dashboard/docs` request is ever issued for
 *     a spec: the form renders a visible notice naming the real authoring paths
 *     (`lore create spec` CLI / `/lore-design` skill) and disables Create,
 *     instead of letting the user hit a silent 4xx from the service-layer gate.
 * Side-effect class: IO (calls onCreate callback)
 * Source: SPEC-022 §9.2, AC-DASH-WRITE-10
 */

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { DocType, LinkType } from "@lore/core";
import { createDocInputSchema } from "@lore/core";
import type { CreateDocPayload } from "@/api/mutations";
import type { z } from "zod";

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

/**
 * Doc types this quick-create form must never submit, because the service-layer
 * create-time gate for that type demands more than type/title/parent can ever
 * express (see ADR adr-newdocmodal-spec-create-cli-skill-only-authoring-disable).
 * Currently just `spec`: the spec-create gate's `hasSkeleton` check requires
 * `## ` heading lines, and the write-spec rules go further still (deterministic,
 * oracle-verifiable ACs added via a separate `lore ac add` call) — no single
 * create-time payload, templated or not, can satisfy that. Submitting for a
 * blocked type would always be denied server-side with no way for this form to
 * explain why, so `isCreateBlockedType` is checked BEFORE any request is sent.
 */
const TYPES_BLOCKED_AT_CREATE: DocType[] = ["spec"];

/** @returns whether `docType` is in {@link TYPES_BLOCKED_AT_CREATE}. */
function isCreateBlockedType(docType: DocType): boolean {
  return TYPES_BLOCKED_AT_CREATE.includes(docType);
}

/**
 * Maps a raw Zod validation issue to user-facing copy.
 * Purpose: `createDocInputSchema`'s `parent_id is required for type '<type>'` message
 *   (packages/core/src/schemas.ts) is a CLI/MCP contract string, not UI copy — it names
 *   the internal field (`parent_id`) rather than explaining what the user needs to do.
 *   This is the ONLY special-cased message; every other issue passes through verbatim
 *   so server-side / other Zod errors keep their original text (D6, AC-37-9).
 * @param issue - the first `ZodError.issues[]` entry from `createDocInputSchema.safeParse`.
 * @param docType - the type currently selected in the form, spliced into the copy.
 */
function humanizeValidationIssue(issue: z.ZodIssue, docType: DocType): string {
  if (issue.path[0] === "parent_id") {
    return `Choose a parent document — every ${docType} lives under one.`;
  }
  return issue.message;
}

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
    // reason: ASYNC2D-002 — block a duplicate submission (e.g. a stray Enter
    // in the title field, which fires the form's native "submit" event
    // independent of the Create button's own disabled attribute) while the
    // first create is already in flight. See module doc comment.
    if (isPending) return;
    // reason: `spec` (and any future TYPES_BLOCKED_AT_CREATE entry) can never
    // pass the spec-create gate through this form — see the module doc comment
    // and TYPES_BLOCKED_AT_CREATE above. Guarding here (in addition to the
    // disabled Create button) mirrors the isPending guard's belt-and-braces
    // shape: a stray form "submit" event bypasses a button's own disabled
    // attribute, so the real gate belongs in handleSubmit, not only in JSX.
    if (isCreateBlockedType(docType)) return;
    setValidationError(null);

    const payload = buildPayload();
    // Client-side Zod validation (AC-DASH-WRITE-10).
    const result = createDocInputSchema.safeParse(payload);
    if (!result.success) {
      const issue = result.error.issues[0];
      setValidationError(issue !== undefined ? humanizeValidationIssue(issue, docType) : "Validation failed");
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

        {/* Spec-create is deliberately CLI/skill-only (visible explanation,
            per AC-1 — no silent 4xx from the service-layer spec-create gate).
            See TYPES_BLOCKED_AT_CREATE + the module doc comment. */}
        {isCreateBlockedType(docType) && (
          <p role="status" className="text-xs text-muted-foreground bg-muted rounded p-3">
            Specs need a gate-conformant skeleton and structured, verifiable
            acceptance criteria (<code>lore ac add</code>) that this quick-create
            form can&rsquo;t collect. Create specs with{" "}
            <code>lore create spec</code> on the CLI, or the{" "}
            <code>/lore-design</code> skill.
          </p>
        )}

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
            disabled={isPending}
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

        {/* Knowledge-specific: sub_type.
            reason (SPEC-026 §4 AC-ASSESS-11): "assessment" is a valid knowledgeExtraSchema
            sub_type but is deliberately NOT offered here — it requires a Zod-valid
            extra.assessment payload that this simple form has no field to collect, so
            selecting it would always fail server-side validation. Assessment docs are
            written exclusively by `lore assess` / `lore_assess`, never through this modal. */}
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
            disabled={isPending || title.trim() === "" || isCreateBlockedType(docType)}
          >
            {isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
