/**
 * issue-carrier — the one reader of a document's issue carrier (`extra.issues`).
 *
 * Purpose: answer "which GitHub issues does this document carry?" for every consumer (archive close, plan-close
 *   coverage, the known-defect link, the assess filing port) so none re-parses `extra.issues` on its own.
 * Public surface: {@link readCarrierIssueRefs}, {@link isIssueCarrier}.
 * Invariants:
 *   - Pure: no IO, no store.
 *   - Only a task or plan can be a carrier; any other document yields `[]`.
 *   - A malformed bag degrades to the entries that parse (the write path refuses a malformed bag, so malformed data
 *     is legacy or hand-edited and must never abort a read that is already underway).
 * Side-effect class: pure.
 *
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries (D1)
 */

import { issueRefSchema, type IssueRef } from "@lore/core";

/** The slice of a document the carrier reader needs. */
export interface CarrierDoc {
  readonly type: string;
  readonly extra: Readonly<Record<string, unknown>> | undefined;
}

/**
 * The issues a carrier names, in declared order; `[]` for a non-carrier or a malformed `extra.issues`.
 *
 * @param doc - any document
 * @returns the parsed refs
 */
export function readCarrierIssueRefs(doc: CarrierDoc): readonly IssueRef[] {
  if (doc.type !== "task" && doc.type !== "plan") return [];
  const raw = doc.extra?.["issues"];
  if (!Array.isArray(raw)) return [];
  const refs: IssueRef[] = [];
  for (const entry of raw) {
    const parsed = issueRefSchema.safeParse(entry);
    if (parsed.success) refs.push(parsed.data);
  }
  return refs;
}

/**
 * Does the document carry at least one issue?
 *
 * @param doc - any document
 */
export function isIssueCarrier(doc: CarrierDoc): boolean {
  return readCarrierIssueRefs(doc).length > 0;
}
