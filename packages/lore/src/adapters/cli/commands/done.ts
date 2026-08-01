/**
 * lore done <task> [--by <name>] [--override-attestation "<reason>"] — evidence-
 * validated, atomic-from-the-caller's-perspective lifecycle walk to `"archived"`
 * for a task OR phase document (spec-workflow-hardening-evidence-red-vocabulary-
 * claim-worktree §M3, AC-WH-3).
 *
 * Closes the gap the EXECUTE loop (claim → evidence → release) leaves: a released
 * task stays `draft` forever, which readiness's `blocks`-link computation never
 * treats as "met" (only `archived`/`deprecated` are terminal) — sessions were forced
 * into hand-rolled `lore set --status` choreography (three writes) to unblock a
 * dependent task. `lore done` is the ONE command replacing that choreography.
 *
 * Refuses (VALIDATION_ERROR, exit 4) when the target holds no RUNNER-ATTESTED
 * `result: "pass"` evidence entry — i.e. no entry with BOTH `result: "pass"` AND
 * an `attestation` (adr-lore-done-requires-a-runner-attested-pass-the-sixth-
 * false: a self-reported-only pass, the ONLY shape any `lore evidence` write can
 * produce, is no longer sufficient to archive) — OR a FRESH claim is held by a
 * DIFFERENT actor than `--by` (`"expected-fail"`/`"fail"`/`"inconclusive"` never
 * count as a pass either way — see `TaskWorkflowService.done`'s own JSDoc). An
 * already-terminal target is an idempotent NO-OP (exit 0, unchanged doc) — a
 * second `lore done` after a first succeeded never fails, evaluated BEFORE any
 * evidence check.
 *
 * `--override-attestation "<reason>"` is the audited escape hatch
 * (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false) for
 * verification `lore verify` structurally cannot perform (`--oracle manual`
 * browser/visual checks; any oracle with no script-mode AC to bind to) — mirrors
 * `lore approve --override-judgment`/`lore outline exempt --reason`'s shape: an
 * explicit flag carrying a MANDATORY free-text reason, written verbatim to every
 * lifecycle step's audit entry (never silent, never defaulted, no env-var form).
 * A blank/whitespace-only reason is a CLI USAGE ERROR (exit 2) — checked HERE,
 * before `app` is even loaded, mirroring `commands/set.ts`'s `--refine`
 * non-empty-prompt precedent and `commands/outline.ts`'s `exempt --reason` guard
 * — never forwarded to the service as an empty string (the service re-checks it
 * too, defensively, for any OTHER caller that builds `DoneOpts` directly; see
 * `TaskWorkflowService.done`'s own JSDoc). The predicate itself lives ENTIRELY in
 * `TaskWorkflowService`/`PhaseWorkflowService` (never here) — this command only
 * resolves args, forwards the (validated) reason, and renders the result.
 *
 * MCP: NOT plumbed. `lore_done` does not exist on the MCP tool surface at all
 * (verified 2026-08-01: `grep -c "lore_done" packages/lore/src/adapters/mcp/
 * tools.ts` → 0; `grep -rln "\.done(" packages/lore/src/adapters` → this file
 * only) — there is no MCP call site to plumb the escape hatch onto. Should a
 * future `lore_done` MCP tool ever be added, it inherits the attestation floor
 * automatically (service-layer predicate) and would need its OWN explicit
 * `overrideReason` tool argument, same audited-and-mandatory shape as here.
 *
 * PHASE DOCS ARE UNAFFECTED BY THIS ESCAPE HATCH: `PhaseWorkflowService.done`
 * (a separate file, out of this feature's declared scope) still gates on the
 * pre-existing `result: "pass"` floor only — it never grew an attestation
 * requirement, so it has nothing to override. `--override-attestation` is
 * forwarded into the SAME `doneOpts` object used for the phase-fallback retry
 * below (see Target-type dispatch) purely because that object is shared; the
 * phase path silently ignores the extra field (`PhaseWorkflowService.done`'s own
 * `DoneOpts` consumption never reads `overrideReason`) — never any effect, never
 * an error either.
 *
 * Target-type dispatch (mirrors `commands/release.ts`/`commands/evidence.ts`'s SPEC-056
 * pattern exactly): `TaskWorkflowService.done` is ALWAYS tried FIRST, UNCHANGED — a
 * successful call, a DOC_NOT_FOUND, or any other error stays byte-identical. ONLY when
 * that call fails with its own `VALIDATION_ERROR {field: "type", value: "phase"}` does
 * this adapter retry via `PhaseWorkflowService.done`.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor.
 *
 * Exit codes: 0 = success (incl. idempotent no-op), 2 = CLI usage error
 *   (`--override-attestation` given with a blank/whitespace-only reason), 3 =
 *   DOC_NOT_FOUND, 4 = VALIDATION_ERROR (not a task/phase / no runner-attested
 *   passing evidence and no override / fresh foreign claim / illegal lifecycle
 *   step), 5 = STALE_VERSION.
 *
 * Source: spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3;
 *   adr-lore-done-requires-a-runner-attested-pass-the-sixth-false /
 *   task-lore-done-accepts-an-unattested-self-reported-pass-as
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import { formatDoneMessage, formatLastTaskAdvisory } from "../done-render.js";

export default defineCommand({
  meta: {
    name: "done",
    description:
      "Evidence-validated lifecycle walk to archived — validates passing evidence + no fresh foreign claim",
  },
  args: {
    task: {
      type: "positional",
      description: "Task (or phase) document ID or slug",
      required: true,
    },
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
    },
    "override-attestation": {
      type: "string",
      description:
        "Audited escape hatch (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false) — " +
        "archive without a runner-attested result:pass evidence row, for verification `lore verify` " +
        "structurally cannot perform. MANDATORY free-text reason as the flag's own value, written " +
        "verbatim to the audit trail. A blank/whitespace-only value is a usage error (exit 2).",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    // reason: CLI usage-error validation (exit 2) — checked BEFORE loadLoreApp(), same
    // shape as commands/set.ts's `--refine` non-empty-prompt guard and commands/
    // outline.ts's `exempt --reason` guard. A PRESENT-but-blank value is rejected;
    // an ABSENT flag is legal (no override requested) and falls through untouched.
    const overrideAttestationRaw = args["override-attestation"];
    const hasOverrideAttestation = typeof overrideAttestationRaw === "string";
    if (hasOverrideAttestation && overrideAttestationRaw.trim() === "") {
      process.stderr.write(
        "Error: --override-attestation requires a non-empty, non-whitespace reason.\n",
      );
      process.exit(2);
    }

    const { app } = loadLoreApp();
    try {
      const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
      const doneOpts = {
        by,
        source: app.callerSurface,
        ...(hasOverrideAttestation ? { overrideReason: overrideAttestationRaw } : {}),
      };

      // reason: SPEC-056-style target-type dispatch (see module header) — try
      // taskWorkflowService FIRST, UNCHANGED; retry via phaseWorkflowService ONLY on
      // its own {field: "type", value: "phase"} rejection.
      let result = await app.taskWorkflowService.done(args.task as string, doneOpts);
      if (
        !result.ok &&
        result.error.code === "VALIDATION_ERROR" &&
        result.error.field === "type" &&
        result.error.value === "phase"
      ) {
        result = await requirePhaseWorkflowService(app).done(args.task as string, doneOpts);
      }

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      // reason: DD-2 last-task advisory (spec-plan-closure-must-be-loud-terminality-
      // divergence-silent, AC-CLOSURE-3) — stderr-only side channel, printed in BOTH
      // --json and human-readable modes, never altering stdout's normal success
      // output. No once-per-process guard (unlike resolveActorWithIdentitySource's
      // precedent) — this fires at most once per plan, ever.
      const lastTaskAdvisory = formatLastTaskAdvisory(result.value);
      if (lastTaskAdvisory !== undefined) {
        process.stderr.write(lastTaskAdvisory + "\n");
      }

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              data: {
                doc: result.value.task,
                already_done: result.value.already_done,
                transitions: result.value.transitions,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(formatDoneMessage(result.value));
    } finally {
      app.close();
    }
  },
});
