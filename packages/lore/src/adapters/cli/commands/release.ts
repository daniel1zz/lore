/**
 * lore release <task> [--by <name>] [--reason <text>] [--force] — clear the
 * advisory execution lease on a task OR phase document.
 *
 * Target-type dispatch (SPEC-056 task-skill-implement-cli-mcp-surfaces-checklist-ref-
 * evidence): `TaskWorkflowService.release` is ALWAYS tried FIRST, UNCHANGED — a
 * successful call, a DOC_NOT_FOUND, or any other error stays byte-identical to
 * pre-SPEC-056 behavior (REGRESSION). ONLY when that call fails with its own
 * `VALIDATION_ERROR {field: "type", value: "phase"}` does this adapter retry via
 * `PhaseWorkflowService.release` — same dispatch shape `commands/evidence.ts` uses.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor.
 *
 * Release by the current holder always succeeds. Release by a non-holder
 * requires --force. `--reason` (e.g. a failure summary) lands in the version
 * history entry — visible via `lore log <task>`.
 *
 * Exit codes: 0 = success, 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task/phase /
 *   no active claim), 5 = CLAIM_CONFLICT | STALE_VERSION.
 *
 * Zero-evidence advisory (spec claim-time-actor-identity-guard-zero-evidence-release-
 * advis, AC-RELEASE-ADVISORY): a release on a doc with NO `verification_evidence`
 * entries still exits 0 (advisory, never a hard block — exploration/spike tasks
 * legitimately release with none) but prints a stderr warning line and, on `--json`,
 * adds a `warnings[]` array to `data`. A release with >=1 evidence entry omits
 * `warnings[]` entirely — byte-identical to pre-AC-RELEASE-ADVISORY output.
 *
 * Source: SPEC-025 §4 AC-WF-6; SPEC-056 §Design Decisions D2; spec claim-time-actor-
 *   identity-guard-zero-evidence-release-advis §AC-RELEASE-ADVISORY
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import { hasZeroReleaseEvidence, ZERO_EVIDENCE_RELEASE_WARNING } from "../../../service/task-workflow-service.js";

export default defineCommand({
  meta: {
    name: "release",
    description: "Clear the advisory execution lease on a task",
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
    reason: {
      type: "string",
      description: "Free-text reason (e.g. failure summary), recorded in version history",
    },
    force: {
      type: "boolean",
      description: "Release even when --by is not the current holder",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
      const releaseOpts = {
        by,
        ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
        force: args.force === true,
        source: app.callerSurface,
      };

      let result = await app.taskWorkflowService.release(args.task as string, releaseOpts);
      if (
        !result.ok &&
        result.error.code === "VALIDATION_ERROR" &&
        result.error.field === "type" &&
        result.error.value === "phase"
      ) {
        result = await requirePhaseWorkflowService(app).release(args.task as string, releaseOpts);
      }

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      // reason: AC-RELEASE-ADVISORY — computed on the doc `release()` already
      // returned (release() never touches verification_evidence, zero extra
      // reads). `warnings` stays `[]` (never added to the JSON envelope) on
      // the >=1-evidence path — REGRESSION: byte-identical to pre-AC-RELEASE-
      // ADVISORY output.
      const warnings = hasZeroReleaseEvidence(result.value) ? [ZERO_EVIDENCE_RELEASE_WARNING] : [];
      for (const warning of warnings) {
        process.stderr.write(`⚠ ${warning}\n`);
      }

      if (args.json) {
        const data: Record<string, unknown> = { doc: result.value };
        if (warnings.length > 0) {
          data["warnings"] = warnings;
        }
        console.log(JSON.stringify({ ok: true, data }, null, 2));
        return;
      }

      console.log(`Released ${result.value.slug} by ${by} (v${result.value.version})`);
    } finally {
      app.close();
    }
  },
});
