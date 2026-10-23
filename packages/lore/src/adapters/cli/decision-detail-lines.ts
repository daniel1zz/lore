/**
 * Plain-words detail of one decision for the terminal (`lore decide` confirmation, `lore pending`), plus the
 * dashboard link to its detail page.
 *
 * Purpose: one place that turns a decision row's stored detail into the `What:` / `Before:` / `After:` /
 * `If you accept:` / `If you reject:` lines and the `Details:` line, so the two CLI surfaces cannot drift.
 * Public surface: renderDecisionDetailLines, resolveDetailBase, renderDetailsLine, DETAIL_PAGE_PATH_PREFIX.
 * Invariants:
 *   - The summary text comes from `renderDecisionDetailSummary` (store/decision-log.ts), never re-derived here: a row
 *     decided before detail existed shows its exact `NO_DETAIL_TEXT` label and no other detail line.
 *   - `Before:` / `After:` appear only when the stored `change` carries them (a class with no before/after omits both).
 *   - The `Details:` line is built from the registered live base URL (live-server-registry.ts) and the decision id
 *     only. It carries no nonce and no port literal; with no live server it names the command instead of a URL.
 * Side-effect class: `resolveDetailBase` reads the live-server registry (fs); the renderers are pure.
 *
 * Source: spec-human-review-surface-decisions-audit-items-and-pending D5, AC-HR-6.
 */
import type { Invocation } from "@lore/core";
import { decisionDetailSchema, renderDecisionDetailSummary, type DecisionLogRow } from "../../store/decision-log.js";
import { ASK_TEXT, type AskLanguage } from "./pending-ask-text.js";
import { readLiveServerUrl, resolveLiveServerRegistryDir } from "./live-server-registry.js";

/** Path of a decision's detail page on the dashboard; the id follows. */
export const DETAIL_PAGE_PATH_PREFIX = "/needs-you/decisions/";

function describeSide(side: unknown): string {
  if (side !== null && typeof side === "object" && !Array.isArray(side)) {
    return Object.entries(side as Record<string, unknown>)
      .map(([entry, value]) => `${entry}: ${JSON.stringify(value)}`)
      .join("; ");
  }
  return JSON.stringify(side);
}

/**
 * The detail lines of a decision row, in print order, each starting exactly with its label. Always begins with
 * `What: `. Unreadable stored detail yields only the `What:` line carrying the renderer's "unreadable" text.
 */
export function renderDecisionDetailLines(row: Pick<DecisionLogRow, "detail">, lang: AskLanguage = "en"): string[] {
  const t = ASK_TEXT[lang];
  const lines = [`${t.what}${renderDecisionDetailSummary(row)}`];
  if (row.detail === null || row.detail === undefined) return lines;
  let json: unknown;
  try {
    json = JSON.parse(row.detail);
  } catch {
    return lines; // reason: the What line already says "unreadable"; there is nothing further to print.
  }
  const parsed = decisionDetailSchema.safeParse(json);
  if (!parsed.success) return lines;
  const { change, on_accept, on_reject } = parsed.data;
  if (change["before"] !== undefined) lines.push(`${t.before}${describeSide(change["before"])}`);
  if (change["after"] !== undefined) lines.push(`${t.after}${describeSide(change["after"])}`);
  lines.push(`${t.ifAccept}${on_accept}`, `${t.ifReject}${on_reject}`);
  return lines;
}

/** The registered live dashboard base URL (no trailing slash) for this invocation's corpus, or null when none is live. */
export function resolveDetailBase(inv: Invocation): string | null {
  if (inv.paths.projectRoot === null) return null;
  const lookup = readLiveServerUrl(resolveLiveServerRegistryDir(inv.env, inv.paths.home), inv.paths.projectRoot);
  return lookup.live ? lookup.url.replace(/\/+$/, "") : null;
}

/** `Details: <base>/needs-you/decisions/<id>`, or the start-the-dashboard form (no URL) when `base` is null. */
export function renderDetailsLine(base: string | null, decisionId: number): string {
  const path = `${DETAIL_PAGE_PATH_PREFIX}${decisionId}`;
  return base === null ? `Details: start the dashboard with \`lore dashboard\`, then open ${path}` : `Details: ${base}${path}`;
}
