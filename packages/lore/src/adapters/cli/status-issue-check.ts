/**
 * `computeIssueCheck` — the detector behind `lore status --check-issues`
 * (spec-issue-closure-loop-computed-resolution-agent-reachable D5, as amended by
 * spec-archiving-the-work-that-resolves-a-defect-report-closes D6).
 *
 * Vitest-safe sibling of `commands/status.ts` (see `adapters/cli/CLAUDE.md`): imports only service
 * types, so `tests/unit/adapters/status-check-issues.test.ts` drives it over an InMemoryStore-backed
 * `CorpusService` without loading `bun:sqlite`.
 *
 * Flags ONE shape — a stale open report (computed `open`, no `resolves` edge, `reported_at` at least
 * `staleAfterDays` old, INCLUSIVE boundary, mirroring `staleness.ts`'s `age_days === min_age_days`
 * precedent). The former shape (a) "unclosed escalation" (computed `fixed` while the issue task is not
 * archived) is RETIRED: since archiving the resolving work closes the GitHub issue, the computed
 * resolution plus the closed issue ARE the record, so flagging every such report would be permanent
 * noise (D6). A report whose computed resolution is `fixed` is therefore never flagged.
 *
 * REPORT-ONLY: every call is a read (`listFull` / `get`) — never a write.
 *
 * `resolvesInEdges`/`sourceDocs` come from `get(issueId).navigation.related` filtered to `resolves`:
 * `CorpusService.link`'s write-time D1b validation makes every such entry on an issue task an IN-edge.
 *
 * Side-effect class: IO (store reads only).
 */

import { ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

import type { CorpusService } from "../../service/corpus-service.js";
import {
  computeIssueResolution,
  hasIssueReport,
  type ResolutionSourceDocLike,
  type ResolvesInEdgeLike,
} from "../../service/issue-resolution.js";

/** One issue task flagged as a "stale open report". */
export interface StaleOpenReport {
  id: string;
  slug: string;
  title: string;
  reported_at: string;
  age_days: number;
}

/** `--check-issues` result payload — mirrors the other check sections' `{checked, consistent, ...}` shape. */
export interface IssueCheckPayload {
  checked: number;
  consistent: boolean;
  stale_open: StaleOpenReport[];
}

/**
 * Defensive `extra.issue_report.reported_at` reader. A malformed/legacy `extra`, or an `issue_report`
 * missing/mistyped `reported_at`, degrades to `undefined` rather than throwing.
 */
function readReportedAt(extra: unknown): string | undefined {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return undefined;
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) return undefined;
  const reportedAt = (issueReport as Record<string, unknown>)["reported_at"];
  return typeof reportedAt === "string" ? reportedAt : undefined;
}

/**
 * @param corpus - read access (`listFull`, `get`) to the corpus
 * @param staleAfterDays - resolved `feedback.stale_after_days`
 * @param nowMs - clock seam (defaults to `Date.now()`)
 * @returns `ok(payload)`; `err` only on an underlying store read failure
 */
export async function computeIssueCheck(
  corpus: Pick<CorpusService, "listFull" | "get">,
  staleAfterDays: number,
  nowMs: number = Date.now(),
): Promise<Result<IssueCheckPayload, LoreError>> {
  const tasksResult = await corpus.listFull({ type: "task" });
  if (!tasksResult.ok) return tasksResult;

  const issueTasks = tasksResult.value.docs.filter((doc) => hasIssueReport(doc.extra));
  const staleOpen: StaleOpenReport[] = [];

  for (const issueTask of issueTasks) {
    const getResult = await corpus.get(issueTask.id);
    if (!getResult.ok) return getResult;

    const resolvesRelated = getResult.value.navigation.related.filter((related) => related.link_type === "resolves");
    const resolvesInEdges: ResolvesInEdgeLike[] = resolvesRelated.map((related) => ({ from_id: related.id }));
    const sourceDocs: ResolutionSourceDocLike[] = resolvesRelated.map((related) => ({
      id: related.id,
      status: related.status,
    }));

    const resolution = computeIssueResolution({ extra: issueTask.extra }, resolvesInEdges, sourceDocs);
    if (resolution !== "open") continue;

    const reportedAt = readReportedAt(issueTask.extra);
    if (reportedAt === undefined) continue;
    const ageDays = Math.floor((nowMs - new Date(reportedAt).getTime()) / 86_400_000);
    if (Number.isFinite(ageDays) && ageDays >= staleAfterDays) {
      staleOpen.push({
        id: issueTask.id,
        slug: issueTask.slug,
        title: issueTask.title,
        reported_at: reportedAt,
        age_days: ageDays,
      });
    }
  }

  return ok({ checked: issueTasks.length, consistent: staleOpen.length === 0, stale_open: staleOpen });
}
