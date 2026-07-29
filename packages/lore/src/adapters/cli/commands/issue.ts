/**
 * `lore issue resolve <issue> --state rejected|wontfix --reason <r> [--by <actor>] [--json]`
 *
 * D3 (spec-issue-closure-loop-computed-resolution-agent-reachable) — the ONLY
 * writer of `extra.issue_report.resolution`, an explicit terminal state that
 * WINS over resolves-edge computation (`computeIssueResolution`'s precedence
 * rule 1 — `../../../service/issue-resolution.js`, landed by P1). `--state
 * fixed` is REJECTED unconditionally, BEFORE any doc lookup: the only path to
 * a `fixed` resolution is a `resolves` edge (`lore link --type resolves
 * <fixer> <issue>`) whose source doc reaches `active`/`archived` (D1/D2).
 * This command never writes `fixed` under any input — there is no branch in
 * this file that can produce that value.
 *
 * Read-modify-write over `CorpusService.get`/`set` — no dedicated service
 * method exists for this narrow write (this task's file anchors did not
 * include a service file; see the task doc's "Added after P1 landed"
 * section). Every OTHER `extra` key on the target task (`adhoc`,
 * `file_anchors`, `claim`, `verification_evidence`, and every sibling
 * `issue_report` field — `reporter_project`, `expected`, `actual`, etc.) is
 * preserved untouched: only `issue_report.resolution` is replaced, mirroring
 * the RMW-merge shape `commands/set.ts`'s `--kind` branch and
 * `TaskWorkflowService`'s anchor mutations both use for the same "`set()`
 * replaces `extra` wholesale" footgun (`corpus-service.ts`'s own
 * `findDroppedStructuredExtraField` guard documents the incident this
 * pattern avoids).
 *
 * Exit codes: 0 success; 3 DOC_NOT_FOUND (unknown --issue); 4
 * VALIDATION_ERROR (`--state fixed`, an unrecognized --state value, empty/
 * missing --reason, or a target lacking `extra.issue_report`); 5
 * STALE_VERSION (concurrent write race on the target task).
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D3,
 *   AC-ICL-3, AC-ICL-4.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { hasIssueReport, computeIssueResolution } from "../../../service/issue-resolution.js";
import type { LoreError } from "@lore/core";

/** The only two states this command may actually persist (D3) — `"fixed"` is deliberately excluded; see {@link fixedNotSettableError}. */
const EXPLICIT_TERMINAL_STATES = ["rejected", "wontfix"] as const;
type ExplicitTerminalState = (typeof EXPLICIT_TERMINAL_STATES)[number];

/** True iff `value` is one of the two states `lore issue resolve` may write. */
function isExplicitTerminalState(value: string): value is ExplicitTerminalState {
  return (EXPLICIT_TERMINAL_STATES as readonly string[]).includes(value);
}

/**
 * AC-ICL-3 — the unconditional `--state fixed` rejection. Names `lore link`
 * and `resolves` verbatim so a caller can copy-paste the real fix; checked in
 * `run()` BEFORE any app load or doc resolution, so it fires even when
 * `<issue>` does not exist or is not a task at all — "fixed" is never a
 * writable value here, full stop.
 */
function fixedNotSettableError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "state",
    message:
      "'fixed' is a COMPUTED resolution, never hand-set. The only path to 'fixed' is " +
      "`lore link --type resolves <fixer-doc> <issue>` (once the fixer doc reaches " +
      "active/archived). Use --state rejected or --state wontfix here instead.",
    value: "fixed",
  };
}

/** Any `--state` value that is neither a legal explicit state nor the specially-handled `"fixed"`. */
function invalidStateError(value: string | undefined): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "state",
    message:
      `Invalid --state '${value ?? ""}'. Valid values: ${EXPLICIT_TERMINAL_STATES.join(", ")} ` +
      "('fixed' is computed via `lore link --type resolves`, never passed here).",
    value,
  };
}

/** `--reason` is required and must be non-empty when writing an explicit terminal state. */
function missingReasonError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "reason",
    message: "--reason is required (non-empty) when resolving an issue as rejected/wontfix.",
  };
}

/** The target resolved fine but does not carry `extra.issue_report` — not an issue task. */
function notAnIssueError(slug: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "issue",
    message:
      `Document "${slug}" does not carry extra.issue_report — only a filed issue report ` +
      "(created via the upstream `lore report-issue` consumer flow) can be resolved.",
    value: slug,
  };
}

export default defineCommand({
  meta: {
    name: "issue",
    description: "Manage filed issue reports (resolve)",
  },
  subCommands: {
    resolve: defineCommand({
      meta: {
        name: "resolve",
        description:
          "Record an explicit terminal resolution (rejected/wontfix) on a filed issue report",
      },
      args: {
        issue: {
          type: "positional",
          description: "Issue task document ID or slug",
          required: true,
        },
        state: {
          type: "string",
          description: `Explicit terminal state: ${EXPLICIT_TERMINAL_STATES.join(" | ")} ('fixed' is computed, never accepted here)`,
        },
        reason: {
          type: "string",
          description: "Human-readable reason (required, non-empty)",
        },
        by: {
          type: "string",
          description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const state = typeof args.state === "string" ? args.state : undefined;

        // AC-ICL-3 — checked BEFORE loadLoreApp()/any doc resolution: writes
        // NOTHING, regardless of whether <issue> even exists.
        if (state === "fixed") {
          const error = fixedNotSettableError();
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        if (state === undefined || !isExplicitTerminalState(state)) {
          const error = invalidStateError(state);
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (reason.length === 0) {
          const error = missingReasonError();
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const { app } = loadLoreApp();
        try {
          const issueId = args.issue as string;
          const getResult = await app.corpusService.get(issueId);
          if (!getResult.ok) {
            process.stderr.write(formatError(getResult.error) + "\n");
            process.exitCode = exitCode(getResult.error);
            return;
          }
          const issueDoc = getResult.value.doc;

          if (!hasIssueReport(issueDoc.extra)) {
            const error = notAnIssueError(issueDoc.slug);
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
            return;
          }

          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
          const nowIso = new Date().toISOString();
          const existingIssueReport = issueDoc.extra["issue_report"] as Record<string, unknown>;
          // reason: RMW merge — spread the FULL existing extra first so every
          // sibling key (claim/verification_evidence/file_anchors/adhoc, and
          // every OTHER issue_report field) survives; only issue_report.resolution
          // is replaced. CorpusService.set()'s docPatch.extra REPLACES extra
          // wholesale (no service-side merge), so this merge must happen here.
          const newExtra: Record<string, unknown> = {
            ...issueDoc.extra,
            issue_report: {
              ...existingIssueReport,
              resolution: { state, reason, resolved_at: nowIso, resolved_by: by },
            },
          };

          const setResult = await app.corpusService.set(issueId, { extra: newExtra }, { by });
          if (!setResult.ok) {
            process.stderr.write(formatError(setResult.error) + "\n");
            process.exitCode = exitCode(setResult.error);
            return;
          }

          const updated = setResult.value;

          // reason: demonstrates D2's precedence rule end-to-end (the explicit
          // state we just wrote wins over any resolves-edge computation) using
          // the SAME navigation.related data get() already fetched above — no
          // second store round trip. `related` mixes in/out non-parent links
          // without exposing direction; a `resolves`-typed entry on an issue
          // task is, in every write-time-validated shape (D1b), an INBOUND edge
          // from a fixer doc, so treating each match's `id`/`status` as a
          // resolvesInEdges/sourceDocs pair is correct for every reachable
          // corpus state (an issue task cannot itself be the "from" side of a
          // resolves edge unless ITS target also carries extra.issue_report —
          // a degenerate chain this command does not need to special-case).
          const resolvesInEdges = getResult.value.navigation.related.filter(
            (r) => r.link_type === "resolves",
          );
          const computed = computeIssueResolution(
            updated,
            resolvesInEdges.map((r) => ({ from_id: r.id })),
            resolvesInEdges.map((r) => ({ id: r.id, status: r.status })),
          );

          if (args.json) {
            console.log(
              JSON.stringify({ ok: true, data: { doc: updated, resolution: computed } }, null, 2),
            );
          } else {
            console.log(`Resolved ${updated.slug} as '${state}' (${reason}) — resolution: ${computed}`);
          }
        } finally {
          app.close();
        }
      },
    }),
  },
});
