/**
 * lore pending — list documents in draft status awaiting review.
 *
 * SPEC-034 §4 triage rendering: every pending doc gains an "AI Judgment" badge
 * column (`judgmentService.latestFor(doc.id)`, one call per doc — CLI-scale
 * read, N pending docs → N latestFor calls, same trade-off documented on
 * `CorpusService.getReviewBundle`'s per-link find loop). `--escalated` narrows
 * the list to docs whose LATEST judgment is a fresh (non-stale) escalation,
 * and additionally prints each doc's `blocking_questions` as indented bullets.
 *
 * SPEC-043 D3 (task `task-lore-pending-does-not-filter-invalidated-docs-an`):
 * `ReviewService.pending` excludes invalidated docs by default — an
 * invalidated draft (e.g. a superseded duplicate) has no lifecycle exit
 * (`draft` never transitions to `archived`) and would otherwise sit in this
 * queue forever. `--include-invalid` restores them, badged `[invalid]` on the
 * Title column (`../pending-render.js::buildPendingTableRows`, the SAME
 * `formatValidityBadge` renderer `lore list --include-invalid` uses).
 *
 * Machine-readable validity (task-validity-landed-on-lore-list-only-the-dispatch-surface,
 * Required #5): the FILTER was already correct here; the DATA was partial — a `--json`
 * consumer saw a queue whose rows carried a raw `validity` field on some docs and nothing
 * on others, with no evaluated verdict. Every `--json` record now carries the same
 * explicit `validity_status` `lore list --json` records carry, via `withValidityStatus`
 * (`../../../service/validity-service.js`, the SSOT projection).
 * ⛔ `withValidityStatus`, NOT `withPreGatedLiveStatus`: `PendingDoc` HOISTS `validity`
 * (see its declaration), so the verdict is genuinely COMPUTABLE per row — which matters
 * precisely in the `--include-invalid` mode, where the pre-gated helper would stamp every
 * restored retracted doc as live.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";
import { PENDING_TABLE_HEADERS, buildPendingTableRows } from "../pending-render.js";
import { collectPendingDecisions, renderPendingDecisions } from "../pending-decisions-render.js";
import { withValidityStatus } from "../../../service/validity-service.js";
import type { DocType, ReviewJudgment } from "@lore/core";
import type { PendingDoc } from "../../../service/review-service.js";

/** A fresh (non-stale) escalation: decision === "escalate" AND judgment.doc_version === doc.version. */
function isFreshEscalation(judgment: ReviewJudgment | null, docVersion: number): boolean {
  if (judgment === null) return false;
  return judgment.decision === "escalate" && judgment.doc_version === docVersion;
}

export default defineCommand({
  meta: {
    name: "pending",
    description: "List documents in draft status (pending review)",
  },
  args: {
    author: {
      type: "string",
      description: "Filter by author",
    },
    type: {
      type: "string",
      description: "Filter by document type",
    },
    since: {
      type: "string",
      description: "ISO 8601 date — only docs updated at or after this time",
    },
    escalated: {
      type: "boolean",
      description: "Show only docs whose latest AI judgment is a fresh escalation, with blocking questions",
    },
    "include-invalid": {
      type: "boolean",
      description: "Include invalidated docs (excluded by default), badged [invalid]. Source: SPEC-043 D3.",
    },
    all: {
      type: "boolean",
      description:
        "SPEC-103 M3 — restore the full draft list, including task-type docs and ledger " +
        "knowledge sub_types (assessment/retro/handoff/uat), both hidden by default " +
        "('pending = promises').",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app, dbPath } = loadLoreApp();
    try {
      // AC-AU-3: open autonomy decisions (escalations awaiting the human) are listed beside the pending docs,
      // in both output modes. A read failure is loud, never an empty list.
      const decisionsResult = await collectPendingDecisions(dbPath);
      if (!decisionsResult.ok) {
        process.stderr.write(formatError(decisionsResult.error) + "\n");
        process.exitCode = exitCode(decisionsResult.error);
        return;
      }
      const decisions = decisionsResult.value;
      const decisionsBlock = renderPendingDecisions(decisions);

      const filters: Record<string, unknown> = {};
      if (args.author !== undefined) filters["author"] = args.author;
      if (args.type !== undefined) filters["type"] = args.type as DocType;
      if (args.since !== undefined) filters["since"] = args.since;
      if (args["include-invalid"] === true) filters["include_invalid"] = true;
      if (args.all === true) filters["all"] = true;

      const result = await app.reviewService.pending(filters);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const docs: PendingDoc[] = result.value;

      // reason: an empty queue skips the judgment-fetch loop entirely (nothing to fetch),
      // but --json must still emit a valid empty envelope, not fall through to the
      // human-readable message (regression guard: this branch runs BEFORE the --json
      // check specifically so both output modes are handled here, symmetrically with the
      // post-filter empty check below).
      if (docs.length === 0) {
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { docs: [], total: 0, decisions } }, null, 2));
        } else {
          console.log("No pending documents.");
          if (decisionsBlock !== "") console.log(decisionsBlock);
        }
        return;
      }

      // reason: one latestFor call per pending doc — acceptable at CLI scale (same
      // trade-off as getReviewBundle's per-link find loop, corpus-service.ts).
      const judgments = new Map<string, ReviewJudgment | null>();
      for (const doc of docs) {
        const judgmentResult = await app.judgmentService.latestFor(doc.id);
        if (!judgmentResult.ok) {
          process.stderr.write(formatError(judgmentResult.error) + "\n");
          process.exitCode = exitCode(judgmentResult.error);
          return;
        }
        judgments.set(doc.id, judgmentResult.value);
      }

      const visibleDocs = args.escalated
        ? docs.filter((d) => isFreshEscalation(judgments.get(d.id) ?? null, d.version))
        : docs;

      if (args.json) {
        // reason: ONE instant for the whole queue — a single listing must never straddle
        // two "now"s (the same rule `lore list`'s single `nowIso` read enforces).
        const nowIso = new Date().toISOString();
        const withValidity = withValidityStatus(visibleDocs, nowIso);
        console.log(
          JSON.stringify(
            {
              ok: true,
              data: {
                docs: withValidity.map((d) => ({ ...d, judgment: judgments.get(d.id) ?? null })),
                total: withValidity.length,
                decisions,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      if (visibleDocs.length === 0) {
        console.log(args.escalated ? "No escalated documents." : "No pending documents.");
        if (decisionsBlock !== "") console.log(decisionsBlock);
        return;
      }

      console.log(formatTable(PENDING_TABLE_HEADERS, buildPendingTableRows(visibleDocs, judgments)));
      console.log(`\n${visibleDocs.length} ${args.escalated ? "escalated" : "pending"} document${visibleDocs.length === 1 ? "" : "s"}`);

      if (decisionsBlock !== "") console.log(decisionsBlock);

      if (args.escalated) {
        for (const doc of visibleDocs) {
          const judgment = judgments.get(doc.id);
          if (judgment !== null && judgment !== undefined && judgment.blocking_questions.length > 0) {
            console.log(`\n${doc.title}:`);
            for (const question of judgment.blocking_questions) {
              console.log(`  - ${question}`);
            }
          }
        }
      }
    } finally {
      app.close();
    }
  },
});
