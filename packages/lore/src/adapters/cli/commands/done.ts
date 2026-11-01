/**
 * lore done <task> —
 * evidence-validated, atomic-from-the-caller's-perspective lifecycle walk to
 * `"archived"` for a task OR phase
 * document (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3,
 * AC-WH-3).
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
 * produce, is not sufficient to archive) — OR a FRESH claim is held by a
 * DIFFERENT actor than the invoking identity (`"expected-fail"`/`"fail"`/`"inconclusive"` never
 * count as a pass either way — see `TaskWorkflowService.done`'s own JSDoc). An
 * already-terminal target is an idempotent NO-OP (exit 0, unchanged doc) — a
 * second `lore done` after a first succeeded never fails, evaluated BEFORE any
 * evidence check.
 *
 * There is no override: under the done contract the contract's oracles are the only proof of done.
 * `--override-attestation` and `--override-attestation-cite` are RETIRED (decision D45) and stay declared only as
 * stubs that print {@link RETIRED_OVERRIDE_MESSAGE} and exit 2 before the app loads, so a caller gets the replacement
 * path (meet the contract's oracles, or amend the contract) rather than the generic strict-flags "Unknown option".
 *
 * `lore bulk done` reaches the same service method for many tasks. A task is judged ONLY by its stored done contract
 * (compiled at `lore approve`); the red requirement is waived at approve (`lore approve --red-waiver`), never here.
 *
 * Target-type dispatch (mirrors `commands/release.ts`/`commands/evidence.ts`'s SPEC-056
 * pattern exactly): `TaskWorkflowService.done` is ALWAYS tried FIRST, UNCHANGED — a
 * successful call, a DOC_NOT_FOUND, or any other error stays byte-identical. ONLY when
 * that call fails with its own `VALIDATION_ERROR {field: "type", value: "phase"}` does
 * this adapter retry via `PhaseWorkflowService.done` (which gates on the `result: "pass"` floor only).
 *
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`.
 *
 * Exit codes: 0 = success (incl. idempotent no-op), 2 = CLI usage error
 *   (a retired `--override-attestation`/`--override-attestation-cite`; an unknown option), 3 = DOC_NOT_FOUND, 4 =
 *   VALIDATION_ERROR (not a task/phase / an unmet floor of the stored contract, the first one
 *   named as `[floor: <name>]` / fresh foreign claim / illegal lifecycle step), 5 =
 *   STALE_VERSION.
 *
 * Source: spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3;
 *   adr-lore-done-requires-a-runner-attested-pass-the-sixth-false /
 *   task-lore-done-accepts-an-unattested-self-reported-pass-as;
 *   spec-done-contract-compiled-at-approve-task-kinds-write-sets (the override's retirement)
 */

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { extractEvidence } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { buildPlanCloseTrigger } from "../review-batch-wiring.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import { resolveCallerSession } from "../caller-session.js";
import { formatDoneMessage, formatLastTaskAdvisory } from "../done-render.js";
import { formatFlakyRowLines } from "../get-render.js";
import { emitIssueCloseItems } from "../issue-close-output.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/**
 * stderr text for a retired `--override-attestation` / `--override-attestation-cite` use (exit 2). Names the flag as retired
 * and the replacement path, like `governance.ts`'s retired-topic message.
 */
const RETIRED_OVERRIDE_MESSAGE =
  "Error: `lore done --override-attestation` and `--override-attestation-cite` are retired " +
  "(decision D45; spec-done-contract-compiled-at-approve-task-kinds-write-sets). " +
  "A task is archived only when its stored contract's oracles are met: run `lore verify` / `lore evidence --capture` " +
  "so the contract's oracles pass. A task that cannot meet its contract goes through a contract amendment, not a waiver.\n";

export default defineLoreCommand({
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
    "override-attestation": {
      type: "string",
      description: "Retired — exits 2 (meet the contract's oracles, or amend the contract).",
    },
    "override-attestation-cite": {
      type: "string",
      description: "Retired — exits 2 (meet the contract's oracles, or amend the contract).",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    // reason: retired flags (D45) — refused BEFORE loadLoreApp(), so the corpus is never touched; the pattern is governance.ts's retired topic.
    if (typeof args["override-attestation"] === "string" || typeof args["override-attestation-cite"] === "string") {
      inv.io.stderr.write(RETIRED_OVERRIDE_MESSAGE);
      return 2;
    }

    const { app, dbPath } = loadLoreApp({ inv });
    try {
      // reason: BR-1056 — the holder check compares RUNS, so the caller's run is the invocation's VERIFIED run
      // (unregistered -> null + one warning), resolved once and passed EXPLICITLY like `claim`/`release` do.
      const verifiedIdentity = await app.verifiedInvocationIdentity?.();
      if (verifiedIdentity !== undefined && !verifiedIdentity.ok) {
        inv.io.stderr.write(formatErrorFor(inv, verifiedIdentity.error) + "\n");
        return exitCode(verifiedIdentity.error);
      }
      const by = resolveActor(inv);
      // reason: AC-DCS2-11 — the archive that leaves its plan with no open task starts the plan's close in the background (the batch
      // is delegated this verified run); a done that archives a non-last task, or a phase, starts nothing.
      const closeTrigger = buildPlanCloseTrigger({
        app,
        dbPath,
        execPath: inv.execPath,
        isCompiled: inv.isCompiled,
        env: inv.env,
        actor: by,
        caller: { claimedRun: inv.identity.harnessRun, verified: verifiedIdentity ?? { ok: true, value: undefined } },
      });
      if (closeTrigger !== undefined) app.taskWorkflowService.setPlanCloseTrigger(closeTrigger);
      // reason: the worktree-removal test's "mine" side (D2) — raw session id, unknown stays absent.
      const callerSession = resolveCallerSession(undefined, inv.env);
      const doneOpts = {
        by,
        harnessRun: verifiedIdentity?.value?.harnessRun ?? null,
        source: app.callerSurface,
        ...(callerSession !== undefined ? { callerSession } : {}),
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
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      // reason: DD-2 last-task advisory (spec-plan-closure-must-be-loud-terminality-
      // divergence-silent, AC-CLOSURE-3) — stderr-only side channel, printed in BOTH
      // --json and human-readable modes, never altering stdout's normal success
      // output. No once-per-process guard (unlike resolveActorWithIdentitySource's
      // precedent) — this fires at most once per plan, ever.
      const lastTaskAdvisory = formatLastTaskAdvisory(result.value);
      if (lastTaskAdvisory !== undefined) {
        inv.io.stderr.write(lastTaskAdvisory + "\n");
      }

      // reason: an unmeasured / claim-derived commit range is stated, never silent (the evid-* range defect); done is not refused
      if (result.value.commit_range_note !== undefined) {
        inv.io.stderr.write(`lore done: ${result.value.commit_range_note}\n`);
      }

      if (args.json) {
        printLine(inv.io.stdout,
          JSON.stringify(
            {
              ok: true,
              data: {
                doc: result.value.task,
                already_done: result.value.already_done,
                transitions: result.value.transitions,
                ...(result.value.worktree_outcomes !== undefined ? { worktree_outcomes: result.value.worktree_outcomes } : {}),
                ...(result.value.removed_oracles !== undefined ? { removed_oracles: result.value.removed_oracles } : {}),
                ...(result.value.claim_release_failure !== undefined ? { claim_release_failure: result.value.claim_release_failure } : {}),
                ...(result.value.issue_close !== undefined ? { issue_close: result.value.issue_close } : {}),
                ...(result.value.unrecoverable_claims !== undefined ? { unrecoverable_claims: result.value.unrecoverable_claims } : {}),
                ...("plan_close_start" in result.value && result.value.plan_close_start !== undefined ? { plan_close_start: result.value.plan_close_start } : {}),
              },
            },
            null,
            2,
          ),
        );
        emitIssueCloseItems(inv.io, result.value.issue_close, { json: true });
        return 0;
      }

      printLine(inv.io.stdout, formatDoneMessage(result.value));
      // reason: AC-DCS2-4 — a flaky row counts as evidence but is never silent: done names it too
      for (const line of formatFlakyRowLines(extractEvidence(result.value.task))) printLine(inv.io.stdout, line);
      if (result.value.unrecoverable_claims !== undefined) {
        const listed = result.value.unrecoverable_claims;
        printLine(inv.io.stdout, `unrecoverable claims: ${listed.count} (${listed.branches.join(", ")})`);
      }
      emitIssueCloseItems(inv.io, result.value.issue_close, { json: false });
      // reason: stderr like the last-task advisory above, so the normal stdout of a done is unchanged
      if ("plan_close_start" in result.value && result.value.plan_close_start !== undefined) inv.io.stderr.write(`${result.value.plan_close_start}\n`);
    } finally {
      app.close();
    }
    return 0;
  },
});
