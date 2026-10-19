/**
 * Review-queue membership (spec-defect-clusters-round-2-part-b-review-pending-queue-corpus D11).
 *
 * A document is awaiting review while it is `draft` (nobody asked yet) OR `in-review`
 * (someone asked and no verdict landed). Before D11 the queue read `status: "draft"` only, so a
 * document that moved to `in-review` vanished from `lore pending` and `lore review --pending`.
 *
 * The status set is the single source: `ReviewService.pending` issues one store query per status
 * in {@link PENDING_REVIEW_STATUSES} and keeps only rows {@link isPendingReviewDoc} admits, so the
 * query and the predicate cannot drift apart.
 *
 * The default queue also hides tasks and ledger records ("pending = promises"). `--type task`
 * without `--all` therefore can only ever be empty; {@link refuseHiddenTypeWithoutAll} names that
 * instead of printing an empty list.
 */

import type { DocStatus, DocType } from "@lore/core";

/** The statuses that put a document in the review queue. */
export const PENDING_REVIEW_STATUSES: readonly DocStatus[] = ["draft", "in-review"];

/** True when a document with this status belongs in the review queue. */
export function isPendingReviewDoc(doc: { readonly status: DocStatus }): boolean {
  return PENDING_REVIEW_STATUSES.includes(doc.status);
}

/** The doc types the default queue hides entirely (only `--all` shows them). */
const TYPES_HIDDEN_WITHOUT_ALL: ReadonlySet<DocType> = new Set<DocType>(["task"]);

/** What the default queue hides, for help text and refusal messages. */
export const HIDDEN_CLASSES_TEXT =
  "tasks, ledger records (knowledge assessment/retro/handoff/uat) and invalidated documents";

/**
 * Refusal message when `--type` names a type the default queue hides and `--all` is absent,
 * or `undefined` when the combination is fine. Exit code 2 (usage) at the caller.
 */
export function refuseHiddenTypeWithoutAll(type: DocType | undefined, all: boolean): string | undefined {
  if (type === undefined || all || !TYPES_HIDDEN_WITHOUT_ALL.has(type)) return undefined;
  return `Error: --type ${type} lists nothing without --all: the default queue hides ${type} documents. Pass --all to list them.`;
}
