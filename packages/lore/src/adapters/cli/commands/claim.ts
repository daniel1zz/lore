/**
 * lore claim <task> [--by <name>] [--branch <branch>] [--machine <name>]
 *   [--worktree <path>] [--steal] — acquire an advisory execution lease on a task OR
 *   phase document.
 *
 * Target-type dispatch (SPEC-056 task-skill-implement-cli-mcp-surfaces-checklist-ref-
 * evidence): `TaskWorkflowService.claim` is ALWAYS tried FIRST, UNCHANGED — a
 * successful call, a DOC_NOT_FOUND, or any other error stays byte-identical to
 * pre-SPEC-056 behavior (REGRESSION). `resolveTask`'s doc-type check runs BEFORE the
 * `task-claim` gate (verified in `task-workflow-service.ts`), so a phase target is
 * rejected before any gate side effect — ONLY on that specific `VALIDATION_ERROR
 * {field: "type", value: "phase"}` rejection does this adapter retry via
 * `PhaseWorkflowService.claim` (which itself runs the `phase-claim` gate) — same
 * dispatch shape `commands/evidence.ts`/`commands/release.ts` use.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor.
 *
 * Session-field capture (SPEC-042 D2):
 *   - `--machine` overrides auto-capture; when omitted, `machine` is
 *     auto-captured as `os.hostname()`.
 *   - `--worktree` is ALWAYS explicit — never auto-captured from
 *     `process.cwd()` (review U2: an orchestrator's cwd would describe the
 *     dispatcher, not the worktree the work happens in). Omitted → no
 *     `worktree` field is sent to the service at all.
 *   - A same-holder fresh refresh MERGES FORWARD `branch`/`machine`/`worktree`
 *     from the existing claim when a field is omitted here (D2 carry-forward,
 *     `TaskWorkflowService.claim`'s job, not this adapter's).
 *
 * Semantics (SPEC-025 §8.3):
 *   - No existing claim → acquired.
 *   - Existing claim held by the same actor → refreshed.
 *   - Existing claim is stale (age > workflow.claim_ttl_minutes, default 120) →
 *     claimable without --steal.
 *   - Existing claim is fresh and held by someone else → exit 5 (CLAIM_CONFLICT)
 *     unless --steal is passed.
 *   - Fresh sibling claim in the same plan whose declared file_anchors overlap
 *     this task's own → task-claim gate blocks with a nonzero exit naming the
 *     conflicting task and a recovery command (SPEC-042 D5; --steal does NOT
 *     bypass this — it only overrides a fresh claim on THIS task).
 *
 * Exit codes: 0 = success, 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task/phase,
 *   or the task-claim/phase-claim gate blocked the claim — e.g. anchor overlap /
 *   upstream spec not approved), 5 = CLAIM_CONFLICT | STALE_VERSION.
 *
 * Source: SPEC-025 §4 AC-WF-3, AC-WF-4, AC-WF-5; SPEC-042 §Design Decisions D2, D5;
 *   SPEC-056 §Design Decisions D2, D7
 */

import { hostname } from "os";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActorWithIdentitySource } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";

export default defineCommand({
  meta: {
    name: "claim",
    description: "Acquire an advisory execution lease on a task",
  },
  args: {
    task: {
      type: "positional",
      description: "Task document ID or slug",
      required: true,
    },
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
    },
    branch: {
      type: "string",
      description: "Git branch where the work is happening (optional)",
    },
    machine: {
      type: "string",
      description: "Machine identity (optional); auto-captured as os.hostname() when omitted (SPEC-042 D2)",
    },
    worktree: {
      type: "string",
      description: "Worktree path (optional); ALWAYS explicit — never auto-captured from cwd (SPEC-042 D2)",
    },
    steal: {
      type: "boolean",
      description: "Override even a fresh claim held by someone else",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const resolvedActor = resolveActorWithIdentitySource(typeof args.by === "string" ? args.by : undefined);
      const by = resolvedActor.actor;
      const machine = typeof args.machine === "string" ? args.machine : hostname();
      const claimOpts = {
        by,
        ...(typeof args.branch === "string" ? { branch: args.branch } : {}),
        machine,
        ...(typeof args.worktree === "string" ? { worktree: args.worktree } : {}),
        // reason: claim-time-actor-identity-guard-zero-evidence-release-advis
        // AC-IDENTITY-REJECT — threads the resolved tier into the task-claim
        // gate's collision-signature test (`TaskWorkflowService.enforceClaimGate`);
        // every other CLI verb keeps using plain `resolveActor` unchanged.
        identitySource: resolvedActor.source,
        steal: args.steal === true,
        source: app.callerSurface,
      };

      let result = await app.taskWorkflowService.claim(args.task as string, claimOpts);
      if (
        !result.ok &&
        result.error.code === "VALIDATION_ERROR" &&
        result.error.field === "type" &&
        result.error.value === "phase"
      ) {
        result = await requirePhaseWorkflowService(app).claim(args.task as string, claimOpts);
      }

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { doc: result.value } }, null, 2));
        return;
      }

      console.log(`Claimed ${result.value.slug} by ${by} (v${result.value.version})`);
    } finally {
      app.close();
    }
  },
});
