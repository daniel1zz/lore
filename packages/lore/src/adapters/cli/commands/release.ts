/**
 * lore release <task> [--reason <text>] [--force] — clear the
 * advisory execution lease on a task OR phase document.
 *
 * Target-type dispatch (SPEC-056 task-skill-implement-cli-mcp-surfaces-checklist-ref-
 * evidence): `TaskWorkflowService.release` is ALWAYS tried FIRST, UNCHANGED — a
 * successful call, a DOC_NOT_FOUND, or any other error stays byte-identical to
 * pre-SPEC-056 behavior (REGRESSION). ONLY when that call fails with its own
 * `VALIDATION_ERROR {field: "type", value: "phase"}` does this adapter retry via
 * `PhaseWorkflowService.release` — same dispatch shape `commands/evidence.ts` uses.
 *
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`.
 *
 * Release by the current holder always succeeds. Release by a non-holder
 * requires --force. `--reason` (e.g. a failure summary) lands in the version
 * history entry — visible via `lore log <task>`.
 *
 * Exit codes: 0 = success, 3 = DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task/phase /
 *   no active claim / an uncommitted claim worktree / a no-worktree claim running
 *   inside a real git repo — TaskWorkflowService's uncommitted-worktree guard, see
 *   below), 5 = CLAIM_CONFLICT | STALE_VERSION.
 *
 * Zero-evidence advisory (spec claim-time-actor-identity-guard-zero-evidence-release-
 * advis, AC-RELEASE-ADVISORY): a release on a doc with NO `verification_evidence`
 * entries still exits 0 (advisory, never a hard block — exploration/spike tasks
 * legitimately release with none) but prints a stderr warning line and, on `--json`,
 * adds a `warnings[]` array to `data`. A release with >=1 evidence entry omits
 * `warnings[]` entirely — byte-identical to pre-AC-RELEASE-ADVISORY output.
 *
 * Uncommitted-worktree attestation guard (task-lore-evidence-and-lore-release-
 * accept-an-attestation-from) — a release used to clear the advisory lease cleanly
 * even while the claim's own recorded worktree sat uncommitted, which is what makes
 * that worktree eligible for the orchestrator's routine post-merge cleanup (the
 * doc's own framing: release is the MORE dangerous of the two, since evidence alone
 * never triggers cleanup). `releaseOpts.callerCwd` below is this process's own
 * `process.cwd()` — passed through to `TaskWorkflowService.release` ONLY to close an
 * opt-in hole (a claim recording NO worktree, from a call plainly running inside a
 * real git repo, refuses instead of silently passing); the primary whole-worktree
 * `git status --porcelain` predicate lives entirely in the service
 * (`task-workflow-service.ts`), keyed off the claim's own recorded worktree.
 *
 * Source: SPEC-025 §4 AC-WF-6; SPEC-056 §Design Decisions D2; spec claim-time-actor-
 *   identity-guard-zero-evidence-release-advis §AC-RELEASE-ADVISORY;
 *   task-lore-evidence-and-lore-release-accept-an-attestation-from
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
    reason: {
      type: "string",
      description: "Free-text reason (e.g. failure summary), recorded in version history",
    },
    force: {
      type: "boolean",
      description: "Release even when the invoking identity is not the current holder",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      // reason: the run is verified ONCE against the registry (unregistered -> null + one warning); the decision
      // below and the stamped rows then agree (BR-1035, spec-run-identity-slice-1 D7).
      const verifiedIdentity = await app.verifiedInvocationIdentity?.();
      if (verifiedIdentity !== undefined && !verifiedIdentity.ok) {
        console.error(formatError(verifiedIdentity.error)); // CLI surface
        process.exit(exitCode(verifiedIdentity.error));
      }
      const verifiedRun = verifiedIdentity?.value?.harnessRun ?? null;
      const by = resolveActor();
      const releaseOpts = {
        by,
        // reason: spec-run-identity-slice-1 D6/BR-1043 — see commands/claim.ts: the releasing run is explicit.
        harnessRun: verifiedRun,
        ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
        force: args.force === true,
        source: app.callerSurface,
        // reason: task-lore-evidence-and-lore-release-accept-an-attestation-
        // from — see module header's "Uncommitted-worktree attestation guard"
        // paragraph. A fresh subprocess per CLI invocation inherits the
        // caller's real shell cwd.
        callerCwd: process.cwd(),
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
