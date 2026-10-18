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
 * `(by, machine, worktree, session_id)`, this plan's scope only — the session
 * instance joined that key in
 * task-two-concurrent-orchestrators-both-resolve-to-agent-main, and each line
 * PRINTS it, including an explicit `(not measured)`) and `anchor_conflicts`
 * (fresh, anchor-overlapping sibling pairs from a different session — a
 * different actor, or the same actor in a different/unmeasured session, in which
 * case the line names the session verdict) — both computed
 * SERVICE-SIDE by `TaskWorkflowService.ready` (returning `ReadyReport`); this
 * command only renders them, it never recomputes anchor overlap or session
 * grouping itself. `--json` prints the full `ReadyReport` under `data.ready`
 * (an object `{records, sessions, anchor_conflicts, anchor_resolution}`, NOT the
 * pre-SPEC-042 flat array — see `ReadyReport`'s own JSDoc for why a wrapper
 * object was chosen over bolting extra properties onto an array).
 *
 * task-a-mistyped-task-file-anchor-is-stored-and-consulted adds
 * `anchor_resolution`: this command is the surface that INJECTS the fs port
 * (`buildFileAnchorProbeContext()`, rooted at cwd), so a dispatcher sees which
 * declared anchors do not resolve — and therefore protect nothing — BEFORE
 * assigning concurrent work. `--json` carries the union verbatim, so
 * `{probed: false}` (no port injected, e.g. the MCP/HTTP `ready` surfaces) can
 * never be mistaken for `{probed: true, unresolved: []}`.
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
import { exitCode, formatErrorFor } from "../utils.js";
import type { ReadyRecord, ReadySession } from "@lore/core";
import type { AnchorConflict } from "../../../service/task-workflow-service.js";
import { renderFileAnchorAdvisory } from "../../../service/anchor-resolution.js";
import { buildFileAnchorProbeContext } from "../../real-fs-probe.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/** The literal set `ReadyRecord.latest_evidence.result` can hold (@lore/core task-workflow.ts). */
type EvidenceResult = NonNullable<ReadyRecord["latest_evidence"]>["result"];

/**
 * Evidence-count badge for one readiness line — task-lore-ready-renders-an-
 * expected-fail-evidence-row-as-a (prerequisite of task-red-first-discipline-
 * is-asked-for-in-prose-but-never).
 *
 * Prior behavior only special-cased `"fail"`; every other `latest_evidence.result`
 * — INCLUDING `"expected-fail"` (a deliberate pre-implementation RED pin) and
 * `"inconclusive"` (an oracle ran but produced no trustworthy signal) — fell
 * through to plain `✔n`. That is a FALSE GREEN: a task whose most recent evidence
 * is a deliberate RED pin rendered indistinguishable from one with a real passing
 * oracle. Vocabulary is intentionally the SAME glyphs
 * `commands/ac.ts::coverageBadge` and `utils.ts::formatWorkflowBadge` already use
 * for these exact two states (spec-workflow-hardening-evidence-red-vocabulary-
 * claim-worktree §M1) — `⚑R` expected-fail, `⚑?` inconclusive — so a reader learns
 * one marker vocabulary across every evidence-rendering surface; only the numeral
 * placement (`⚑R{n}` suffix here, matching this function's pre-existing
 * `✔{n}`/`✘{n}` suffix shape) differs from ac.ts's parenthetical `⚑R({n})`.
 *
 * `undefined` result (BOUNDARY: `evidence_count > 0` but `latest_evidence` absent
 * or malformed) and any value outside the known literal set (NEGATIVE: corrupted/
 * legacy `extra` data reaching this formatter) both fall to the SAME `⚑?n` default
 * `formatWorkflowBadge` uses — never `✔n`. The `default` branch's `never`
 * assignment is a compile-time trip-wire: a future `EvidenceEntry.result` literal
 * added to `@lore/core` fails typecheck HERE too, so this badge cannot silently
 * regress back to the bug this task fixes.
 *
 * @param result - `record.latest_evidence?.result`, verbatim (may be `undefined`
 *   or, at runtime, a value outside the typed literal set if `extra` is corrupted)
 * @param count - `record.evidence_count`
 * @returns `""` when `count <= 0`; otherwise a leading-space-prefixed glyph+count
 *
 * Exported (unlike this file's other render helpers) so its deterministic
 * formatting is directly unit-testable without spawning the CLI or a real
 * store — mirrors `commands/ac.ts::coverageBadge`'s identical rationale.
 */
export function evidenceBadge(result: EvidenceResult | undefined, count: number): string {
  if (count <= 0) return "";
  switch (result) {
    case "pass":
      return ` ✔${count}`;
    case "fail":
      return ` ✘${count}`;
    case "inconclusive":
      return ` ⚑?${count}`;
    case "expected-fail":
      return ` ⚑R${count}`;
    case undefined:
      return ` ⚑?${count}`;
    default: {
      const _exhaustive: never = result;
      void _exhaustive;
      return ` ⚑?${count}`;
    }
  }
}

/**
 * Render one readiness line, e.g. "[READY] task-foo (draft) ✔2" — or
 * "[READY] task-foo (draft) ⚑R2" when the latest evidence is a deliberate
 * `expected-fail` RED pin (see {@link evidenceBadge}).
 *
 * Exported for direct unit testing (same rationale as {@link evidenceBadge}).
 */
export function formatReadyLine(record: ReadyRecord): string {
  const status = record.ready
    ? "READY"
    : record.task.status === "archived" || record.task.status === "deprecated"
      ? "done"
      : "blocked";
  const claimPart = record.claim
    ? ` claimed:${record.claim.by}${record.claim.stale ? " (stale)" : ""}`
    : "";
  const evidencePart = evidenceBadge(record.latest_evidence?.result, record.evidence_count);
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
  // reason: task-two-concurrent-orchestrators-both-resolve-to-agent-main — two
  // concurrently-live sessions legitimately share one `by` (and, in a main
  // checkout, one machine and NO worktree), so without the session instance these
  // lines render byte-identically and a reader cannot tell one session from two.
  // The unmeasured case is printed EXPLICITLY rather than omitted: an absent field
  // would be indistinguishable from a truthful single-session report, which is how
  // an orchestrator came to treat this list as proof it was alone.
  const session_id = ` session:${session.session_id ?? "(not measured)"}`;
  return `  - ${session.by}${location}${session_id}${branches} tasks: ${session.task_slugs.join(", ")} (newest ${session.newest_at})`;
}

/**
 * Render one anchor-conflict advisory line. `session_verdict` is present only when
 * the holder shares the conflicting task's own actor string — without it, a
 * same-actor conflict reads as a self-contradiction ("conflicts with myself")
 * rather than as the cross-session collision it is
 * (task-two-concurrent-orchestrators-both-resolve-to-agent-main).
 */
function formatAnchorConflictLine(conflict: AnchorConflict): string {
  const session =
    conflict.session_verdict !== undefined ? ` (same actor, session: ${conflict.session_verdict})` : "";
  return `  - ${conflict.task_slug} conflicts with ${conflict.holder}${session} on: ${conflict.paths.join(", ")}`;
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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const hasPlan = args.plan !== undefined && String(args.plan).trim() !== "";
    const hasAdhoc = args.adhoc === true;

    if (hasPlan && hasAdhoc) {
      inv.io.stderr.write("Error: <plan> and --adhoc are mutually exclusive. Pass only one.\n");
      return 2;
    }
    if (!hasPlan && !hasAdhoc) {
      inv.io.stderr.write("Error: a plan document ID or slug is required unless --adhoc is passed.\n");
      return 2;
    }

    const { app } = loadLoreApp({ inv });
    try {
      if (hasAdhoc) {
        const adhocResult = await app.taskWorkflowService.readyAdhoc();
        if (!adhocResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, adhocResult.error) + "\n");
          return exitCode(adhocResult.error);
        }
        const records = adhocResult.value;

        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { adhoc: { records } } }, null, 2));
          return;
        }

        if (records.length === 0) {
          printLine(inv.io.stdout, "No open ad-hoc tasks.");
        } else {
          printLine(inv.io.stdout, `Ad-hoc tasks (${records.length}):`);
          for (const record of records) printLine(inv.io.stdout, formatReadyLine(record));
        }
        return;
      }

      // task-a-mistyped-task-file-anchor-is-stored-and-consulted (Required #2):
      // the fs port is built HERE, in the adapter, and injected per call — the
      // service never opens an fs seam. Rooted at cwd, the same assumption
      // `--check-drift` makes (see buildFileAnchorProbeContext's JSDoc for why
      // NOT the corpus root).
      const result = await app.taskWorkflowService.ready(
        args.plan as string,
        undefined,
        buildFileAnchorProbeContext(inv.cwd),
      );

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const report = result.value;
      const records = report.records;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { ready: report } }, null, 2));
        return;
      }

      if (records.length === 0) {
        printLine(inv.io.stdout, "No tasks found under this plan.");
      } else {
        const hasPhases = records.some((r) => r.phase !== undefined);
        if (!hasPhases) {
          for (const record of records) printLine(inv.io.stdout, formatReadyLine(record));
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
            printLine(inv.io.stdout, `Phase: ${phase}`);
            for (const record of group) printLine(inv.io.stdout, formatReadyLine(record));
          }
          if (unphased.length > 0) {
            printLine(inv.io.stdout, "(unphased)");
            for (const record of unphased) printLine(inv.io.stdout, formatReadyLine(record));
          }
        }

        if (records.some((r) => r.upstream_unapproved === true)) {
          printLine(inv.io.stdout, "⚠ Parent spec is not approved — readiness above is advisory only.");
        }
      }

      // SPEC-042 D7 — sessions + anchor-conflict advisories (plan-scoped).
      printLine(inv.io.stdout, "");
      printLine(inv.io.stdout, `Sessions (${report.sessions.length}):`);
      if (report.sessions.length > 0) {
        for (const session of report.sessions) printLine(inv.io.stdout, formatSessionLine(session));
      } else {
        printLine(inv.io.stdout, "  (none)");
      }

      if (report.anchor_conflicts.length > 0) {
        printLine(inv.io.stdout, "");
        printLine(inv.io.stdout, `⚠ Anchor conflicts (${report.anchor_conflicts.length}):`);
        for (const conflict of report.anchor_conflicts) printLine(inv.io.stdout, formatAnchorConflictLine(conflict));
      }

      // task-a-mistyped-task-file-anchor-is-stored-and-consulted — non-resolving
      // declared anchors. Rendered through the SHARED advisory renderer every
      // write surface uses (one wording, one place), qualified per task since
      // this report spans the whole plan. Silent when everything resolves; a
      // `{probed: false}` report renders nothing here BUT is still visible
      // verbatim in `--json`, so "not probed" never masquerades as "clean".
      const anchorAdvisory = renderFileAnchorAdvisory(report.anchor_resolution, {
        subject: args.plan as string,
        rowLabel: (row) => `${row.task_slug} → ${row.anchor}`,
      });
      if (anchorAdvisory.length > 0) {
        printLine(inv.io.stdout, "");
        for (const line of anchorAdvisory) printLine(inv.io.stdout, line);
      }
    } finally {
      app.close();
    }
  },
});
