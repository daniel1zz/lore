/**
 * lore ready <plan> | lore ready --adhoc — computed readiness report.
 *
 * `<plan>` mode: readiness over a plan's tasks. A task is ready iff its status
 * is not archived/deprecated AND every blocker (doc on the `from` side of a
 * `blocks` link targeting it) has status archived. Never stored — recomputed
 * on every call (D3). Human rendering groups by phase when the plan declares
 * phases (D9 — the flat data shape is grouped here, at the CLI presentation
 * layer only).
 *
 * When the plan's parent spec is not "approved" (SPEC-032 §3.4), every record
 * carries `upstream_unapproved: true` — readiness/exit codes are unaffected; a
 * single advisory warning line is printed once (human mode) after the task list.
 *
 * SPEC-042 D7 additionally renders `sessions` (fresh claims grouped by
 * `(by, machine, worktree)`, this plan's scope only) and `anchor_conflicts`
 * (fresh, foreign, anchor-overlapping sibling pairs) — both computed
 * SERVICE-SIDE by `TaskWorkflowService.ready` (returning `ReadyReport`); this
 * command only renders them, it never recomputes anchor overlap or session
 * grouping itself. `--json` prints the full `ReadyReport` under `data.ready`
 * (an object `{records, sessions, anchor_conflicts}`, NOT the pre-SPEC-042
 * flat array — see `ReadyReport`'s own JSDoc for why a wrapper object was
 * chosen over bolting extra properties onto an array).
 *
 * `--adhoc` mode (SPEC-069 §Design Decisions D2, AC-069-7): mutually
 * exclusive with `<plan>` (a corpus-wide, plan-less listing has no plan
 * positional to resolve). Lists every OPEN (non-terminal) `extra.adhoc ===
 * true` task, thin pipe over `TaskWorkflowService.readyAdhoc` — a planless
 * task is otherwise invisible to `lore ready`, which is exactly the gap D2
 * closes. `--json` prints `{records: ReadyRecord[]}` under `data.adhoc` — no
 * `sessions`/`anchor_conflicts` (those are plan-scoped SPEC-042 D7 concepts
 * that don't apply to a plan-less listing).
 *
 * Exit codes: 0 = success, 2 = usage error (`<plan>`/`--adhoc` both or
 * neither passed), 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a plan).
 *
 * Source: SPEC-025 §4 AC-WF-7, AC-WF-8; SPEC-032 §3.4; SPEC-042 §Design Decisions D7;
 *         SPEC-069 §Design Decisions D2, AC-069-7
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { ReadyRecord, ReadySession } from "@lore/core";
import type { AnchorConflict } from "../../../service/task-workflow-service.js";

/** Render one readiness line, e.g. "[READY] task-foo (draft) ✔2". */
function formatReadyLine(record: ReadyRecord): string {
  const status = record.ready
    ? "READY"
    : record.task.status === "archived" || record.task.status === "deprecated"
      ? "done"
      : "blocked";
  const claimPart = record.claim
    ? ` claimed:${record.claim.by}${record.claim.stale ? " (stale)" : ""}`
    : "";
  const evidencePart =
    record.evidence_count > 0
      ? record.latest_evidence?.result === "fail"
        ? ` ✘${record.evidence_count}`
        : ` ✔${record.evidence_count}`
      : "";
  const blockersPart =
    record.unmet_blockers.length > 0
      ? ` blocked-by:${record.unmet_blockers.map((b) => b.slug).join(",")}`
      : "";
  const anchorlessPart = record.anchorless === true ? " ⚠anchorless" : "";
  return `  [${status}] ${record.task.slug} (${record.task.status})${claimPart}${evidencePart}${blockersPart}${anchorlessPart}`;
}

/** Render one session grouping line, e.g. "  - alice @hostA:/w1 [b1] tasks: task-a (newest T1)". */
function formatSessionLine(session: ReadySession): string {
  const location =
    session.machine !== undefined || session.worktree !== undefined
      ? ` @${session.machine ?? "?"}:${session.worktree ?? "?"}`
      : "";
  const branches = session.branches.length > 0 ? ` [${session.branches.join(", ")}]` : "";
  return `  - ${session.by}${location}${branches} tasks: ${session.task_slugs.join(", ")} (newest ${session.newest_at})`;
}

/** Render one anchor-conflict advisory line. */
function formatAnchorConflictLine(conflict: AnchorConflict): string {
  return `  - ${conflict.task_slug} conflicts with ${conflict.holder} on: ${conflict.paths.join(", ")}`;
}

export default defineCommand({
  meta: {
    name: "ready",
    description: "Computed readiness report over a plan's tasks (never stored)",
  },
  args: {
    plan: {
      type: "positional",
      description: "Plan document ID or slug. Omit when passing --adhoc.",
      required: false,
    },
    adhoc: {
      type: "boolean",
      description:
        "List OPEN (non-terminal) ad-hoc (planless) tasks corpus-wide instead of a plan's readiness. Mutually exclusive with <plan>. Source: SPEC-069 D2",
    },
    json: {
      type: "boolean",
      description: "Output the full ReadyReport as JSON (see SPEC-042 §Design Decisions D7)",
    },
  },
  async run({ args }) {
    const hasPlan = args.plan !== undefined && String(args.plan).trim() !== "";
    const hasAdhoc = args.adhoc === true;

    if (hasPlan && hasAdhoc) {
      process.stderr.write("Error: <plan> and --adhoc are mutually exclusive. Pass only one.\n");
      process.exitCode = 2;
      return;
    }
    if (!hasPlan && !hasAdhoc) {
      process.stderr.write("Error: a plan document ID or slug is required unless --adhoc is passed.\n");
      process.exitCode = 2;
      return;
    }

    const { app } = loadLoreApp();
    try {
      if (hasAdhoc) {
        const adhocResult = await app.taskWorkflowService.readyAdhoc();
        if (!adhocResult.ok) {
          process.stderr.write(formatError(adhocResult.error) + "\n");
          process.exitCode = exitCode(adhocResult.error);
          return;
        }
        const records = adhocResult.value;

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { adhoc: { records } } }, null, 2));
          return;
        }

        if (records.length === 0) {
          console.log("No open ad-hoc tasks.");
        } else {
          console.log(`Ad-hoc tasks (${records.length}):`);
          for (const record of records) console.log(formatReadyLine(record));
        }
        return;
      }

      const result = await app.taskWorkflowService.ready(args.plan as string);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const report = result.value;
      const records = report.records;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { ready: report } }, null, 2));
        return;
      }

      if (records.length === 0) {
        console.log("No tasks found under this plan.");
      } else {
        const hasPhases = records.some((r) => r.phase !== undefined);
        if (!hasPhases) {
          for (const record of records) console.log(formatReadyLine(record));
        } else {
          const byPhase = new Map<string, ReadyRecord[]>();
          const unphased: ReadyRecord[] = [];
          for (const record of records) {
            if (record.phase !== undefined) {
              const group = byPhase.get(record.phase) ?? [];
              group.push(record);
              byPhase.set(record.phase, group);
            } else {
              unphased.push(record);
            }
          }

          for (const [phase, group] of byPhase) {
            console.log(`Phase: ${phase}`);
            for (const record of group) console.log(formatReadyLine(record));
          }
          if (unphased.length > 0) {
            console.log("(unphased)");
            for (const record of unphased) console.log(formatReadyLine(record));
          }
        }

        if (records.some((r) => r.upstream_unapproved === true)) {
          console.log("⚠ Parent spec is not approved — readiness above is advisory only.");
        }
      }

      // SPEC-042 D7 — sessions + anchor-conflict advisories (plan-scoped).
      console.log("");
      console.log(`Sessions (${report.sessions.length}):`);
      if (report.sessions.length > 0) {
        for (const session of report.sessions) console.log(formatSessionLine(session));
      } else {
        console.log("  (none)");
      }

      if (report.anchor_conflicts.length > 0) {
        console.log("");
        console.log(`⚠ Anchor conflicts (${report.anchor_conflicts.length}):`);
        for (const conflict of report.anchor_conflicts) console.log(formatAnchorConflictLine(conflict));
      }
    } finally {
      app.close();
    }
  },
});
