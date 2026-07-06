/**
 * lore ready <plan> — computed readiness report over a plan's tasks.
 *
 * A task is ready iff its status is not archived/deprecated AND every blocker
 * (doc on the `from` side of a `blocks` link targeting it) has status archived.
 * Never stored — recomputed on every call (D3). Human rendering groups by phase
 * when the plan declares phases (D9 — the flat data shape is grouped here, at
 * the CLI presentation layer only).
 *
 * When the plan's parent spec is not "approved" (SPEC-032 §3.4), every record
 * carries `upstream_unapproved: true` — readiness/exit codes are unaffected; a
 * single advisory warning line is printed once (human mode) after the task list.
 *
 * Exit codes: 0 = success, 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a plan).
 *
 * Source: SPEC-025 §4 AC-WF-7, AC-WF-8; SPEC-032 §3.4
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { ReadyRecord } from "@lore/core";

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
  return `  [${status}] ${record.task.slug} (${record.task.status})${claimPart}${evidencePart}${blockersPart}`;
}

export default defineCommand({
  meta: {
    name: "ready",
    description: "Computed readiness report over a plan's tasks (never stored)",
  },
  args: {
    plan: {
      type: "positional",
      description: "Plan document ID or slug",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output as JSON (flat ReadyRecord[] — see SPEC-025 §8.2 D9)",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const result = await app.taskWorkflowService.ready(args.plan as string);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const records = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { ready: records } }, null, 2));
        return;
      }

      if (records.length === 0) {
        console.log("No tasks found under this plan.");
        return;
      }

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
    } finally {
      app.close();
    }
  },
});
