/**
 * lore pending — list documents awaiting review (draft or in-review, `isPendingReviewDoc`).
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
 * (`VALID_TRANSITIONS` in `@lore/core` lifecycle.ts gives it no exit to `archived` for most doc
 * types; knowledge and task drafts are the exceptions) and would otherwise sit in this
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

import { defineLoreCommand } from "../cli-exit.js";

import { resolveDetailBase } from "../decision-detail-lines.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, findLoreDbPath, formatErrorFor, formatTable } from "../utils.js";
import { parseDocTypeFilter, parseSinceFilter, refuseFilterValue } from "../filter-values.js";
import { PENDING_TABLE_HEADERS, buildPendingTableRows } from "../pending-render.js";
import { parseAskLanguage } from "../pending-ask-text.js";
import { parseRecommendations, runPendingAsk } from "../pending-ask.js";
import { collectPendingDecisions, renderPendingDecisions } from "../pending-decisions-render.js";
import { withValidityStatus } from "../../../service/validity-service.js";
import type { DocType, Invocation, ReviewJudgment } from "@lore/core";
import type { PendingDoc } from "../../../service/review-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { HIDDEN_CLASSES_TEXT, refuseHiddenTypeWithoutAll } from "../../../service/pending-queue.js";

/** A fresh (non-stale) escalation: decision === "escalate" AND judgment.doc_version === doc.version. */
function isFreshEscalation(judgment: ReviewJudgment | null, docVersion: number): boolean {
  if (judgment === null) return false;
  return judgment.decision === "escalate" && judgment.doc_version === docVersion;
}

/** `--ask`: issue one question per open decision and print them as JSON (no pending documents). */
async function runAsk(inv: Invocation, recommend: unknown, langRaw: unknown): Promise<number> {
  const lang = parseAskLanguage(langRaw);
  if (!lang.ok) {
    inv.io.stderr.write(formatErrorFor(inv, lang.error) + "\n");
    return 2;
  }
  const raw = recommend === undefined ? [] : Array.isArray(recommend) ? recommend.map(String) : [String(recommend)];
  const parsed = parseRecommendations(raw);
  if (!parsed.ok) {
    inv.io.stderr.write(formatErrorFor(inv, parsed.error) + "\n");
    return 2;
  }
  const dbPath = findLoreDbPath(inv.io, inv);
  const asked = await runPendingAsk(inv, dbPath, parsed.value, lang.value);
  if (!asked.ok) {
    inv.io.stderr.write(formatErrorFor(inv, asked.error) + "\n");
    return exitCode(asked.error);
  }
  printLine(inv.io.stdout, JSON.stringify({ ok: true, data: asked.value }, null, 2));
  return 0;
}

export default defineLoreCommand({
  meta: {
    name: "pending",
    description:
      `List documents awaiting review (draft or in-review). Hidden by default: ${HIDDEN_CLASSES_TEXT}; pass --all to list tasks and ledger records, --include-invalid for invalidated documents.`,
  },
  args: {
    author: {
      type: "string",
      description: "Filter by author",
    },
    type: {
      type: "string",
      description: "Filter by document type (--type task needs --all: tasks are hidden by default)",
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
        "SPEC-103 M3 — restore the full queue, including task-type docs and ledger " +
        "knowledge sub_types (assessment/retro/handoff/uat), both hidden by default " +
        "('pending = promises').",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    ask: {
      type: "boolean",
      description:
        "BR-1374 — print one AskUserQuestion-ready question per open decision (lore writes the text; JSON on stdout). " +
        "Pass each question verbatim to the interactive question tool; the PostToolUse hook records the answer.",
    },
    lang: {
      type: "string",
      description: "With --ask: the question language, en or zh (default en)",
    },
    recommend: {
      type: "string",
      description: "With --ask: the agent's recommendation as <id>=accept|reject:<reason> (repeatable); shown as one labelled line",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    // reason: AC-DCL-2 — filter values are validated BEFORE the corpus opens; an unknown value
    // used to reach the store and render an empty queue with exit 0.
    let typeFilter: DocType | undefined;
    if (args.type !== undefined) {
      const parsedType = parseDocTypeFilter("--type", args.type);
      if (!parsedType.ok) return refuseFilterValue(inv, parsedType.error);
      typeFilter = parsedType.value;
    }
    // reason: D11 — the default queue hides tasks, so `--type task` alone could only print an
    // empty list that reads as "nothing to review". Say so instead (usage error, exit 2).
    const hiddenRefusal = refuseHiddenTypeWithoutAll(typeFilter, args.all === true);
    if (hiddenRefusal !== undefined) {
      inv.io.stderr.write(hiddenRefusal + "\n");
      return 2;
    }
    if (args.since !== undefined) {
      const parsedSince = parseSinceFilter("--since", args.since);
      if (!parsedSince.ok) return refuseFilterValue(inv, parsedSince.error);
    }
    if (args.ask === true) return runAsk(inv, args.recommend, args.lang);
    if (args.recommend !== undefined) {
      inv.io.stderr.write("Error: --recommend needs --ask\n");
      return 2;
    }
    const { app, dbPath } = loadLoreApp({ inv });
    const { repoRoot } = app;
    try {
      // AC-AU-3: open autonomy decisions (escalations awaiting the human) are listed beside the pending docs,
      // in both output modes. A read failure is loud, never an empty list.
      const decisionsResult = await collectPendingDecisions(dbPath, inv.env, repoRoot);
      if (!decisionsResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, decisionsResult.error) + "\n");
        return exitCode(decisionsResult.error);
      }
      const decisions = decisionsResult.value;
      const detailBase = resolveDetailBase(inv);
      const decisionsBlock = renderPendingDecisions(decisions, detailBase);

      const filters: Record<string, unknown> = {};
      if (args.author !== undefined) filters["author"] = args.author;
      if (typeFilter !== undefined) filters["type"] = typeFilter;
      if (args.since !== undefined) filters["since"] = args.since;
      if (args["include-invalid"] === true) filters["include_invalid"] = true;
      if (args.all === true) filters["all"] = true;

      const result = await app.reviewService.pending(filters);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const docs: PendingDoc[] = result.value;

      // reason: an empty queue skips the judgment-fetch loop entirely (nothing to fetch),
      // but --json must still emit a valid empty envelope, not fall through to the
      // human-readable message (regression guard: this branch runs BEFORE the --json
      // check specifically so both output modes are handled here, symmetrically with the
      // post-filter empty check below).
      if (docs.length === 0) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { docs: [], total: 0, decisions } }, null, 2));
        } else {
          printLine(inv.io.stdout, "No pending documents.");
          if (decisionsBlock !== "") printLine(inv.io.stdout, decisionsBlock);
        }
        return 0;
      }

      // reason: one latestFor call per pending doc — acceptable at CLI scale (same
      // trade-off as getReviewBundle's per-link find loop, corpus-service.ts).
      const judgments = new Map<string, ReviewJudgment | null>();
      for (const doc of docs) {
        const judgmentResult = await app.judgmentService.latestFor(doc.id);
        if (!judgmentResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, judgmentResult.error) + "\n");
          return exitCode(judgmentResult.error);
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
        printLine(inv.io.stdout, 
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
        return 0;
      }

      if (visibleDocs.length === 0) {
        printLine(inv.io.stdout, args.escalated ? "No escalated documents." : "No pending documents.");
        if (decisionsBlock !== "") printLine(inv.io.stdout, decisionsBlock);
        return 0;
      }

      printLine(inv.io.stdout, formatTable(PENDING_TABLE_HEADERS, buildPendingTableRows(visibleDocs, judgments)));
      printLine(inv.io.stdout, `\n${visibleDocs.length} ${args.escalated ? "escalated" : "pending"} document${visibleDocs.length === 1 ? "" : "s"}`);

      if (decisionsBlock !== "") printLine(inv.io.stdout, decisionsBlock);

      if (args.escalated) {
        for (const doc of visibleDocs) {
          const judgment = judgments.get(doc.id);
          if (judgment !== null && judgment !== undefined && judgment.blocking_questions.length > 0) {
            printLine(inv.io.stdout, `\n${doc.title}:`);
            for (const question of judgment.blocking_questions) {
              printLine(inv.io.stdout, `  - ${question}`);
            }
          }
        }
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
