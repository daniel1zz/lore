/**
 * lore claim <task> [--branch <branch>] [--machine <name>]
 *   [--worktree <path>] [--corpus-scope <baseline-branch>] [--steal] — acquire an advisory execution lease on a task OR
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
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`.
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
 * Claim-scoped corpus authoring (spec-baseline-slice-2 §C8, AC-BLS2-8, issue #39):
 * `--corpus-scope <branch>` (requires `--worktree`; TASK targets only) declares ON THE LEASE
 * that this worktree session may write baseline rules/cites/site maps under that one baseline
 * branch into the main checkout's corpus. The scope is a lease fact read back by the
 * foreign-corpus-write guard — never an argv flag re-read later — and is re-declared on
 * every refresh (never carried forward).
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

import { invocationOf } from "../command-invocation.js";
import { exitCli } from "../cli-exit.js";
import { defineLoreCommand } from "../cli-exit.js";
import { taskClaimSchema } from "@lore/core";
import type { ActorSource } from "@lore/core/node";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActorWithIdentitySource } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
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
    "corpus-scope": {
      type: "string",
      description:
        "Baseline branch (id or slug) this worktree session may write rules/cites/maps under in the main corpus; requires --worktree (task claims only)",
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
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      // reason: the run is verified ONCE against the registry (unregistered -> null + one warning); the decision
      // below and the stamped rows then agree (BR-1035, spec-run-identity-slice-1 D7).
      const verifiedIdentity = await app.verifiedInvocationIdentity?.();
      if (verifiedIdentity !== undefined && !verifiedIdentity.ok) {
        printLine(inv.io.stderr, formatErrorFor(inv, verifiedIdentity.error)); // CLI surface
        exitCli(exitCode(verifiedIdentity.error));
      }
      const verifiedRun = verifiedIdentity?.value?.harnessRun ?? null;
      const resolvedActor = resolveActorWithIdentitySource(inv.io, undefined, inv.env, inv.cwd, inv.user);
      const by = resolvedActor.actor;
      const machine = typeof args.machine === "string" ? args.machine : inv.host;
      const claimOpts = {
        by,
        // reason: spec-run-identity-slice-1 D6 — the claimant's run is passed EXPLICITLY (services that decide on
        // identity never read ambient state); `--harness-run` was stripped and resolved once at the CLI entry.
        harnessRun: verifiedRun,
        ...(typeof args.branch === "string" ? { branch: args.branch } : {}),
        machine,
        ...(typeof args.worktree === "string" ? { worktree: args.worktree } : {}),
        ...(typeof args["corpus-scope"] === "string" ? { corpusScope: args["corpus-scope"] } : {}),
        // reason: claim-time-actor-identity-guard-zero-evidence-release-advis
        // AC-IDENTITY-REJECT — threads the resolved tier into the task-claim
        // gate's collision-signature test (`TaskWorkflowService.enforceClaimGate`);
        // every other CLI verb keeps using plain `resolveActor` unchanged.
        //
        // SPEC-104 adds a fifth resolution tier, `"worktree-derived"`, to
        // utils.ts's own (wider) `ActorSource` — `@lore/core/node`'s
        // `ActorSource` (the type `ClaimOpts.identitySource` is declared
        // against, in `task-workflow-service.ts`) is intentionally left
        // unwidened: this task's declared file anchors are `utils.ts` +
        // `commands/claim.ts` only, and widening a shared core type is a
        // separate, out-of-anchor concern. The cast below is functionally
        // inert: `gate-predicates.ts::actorIdentityGuard` only ever compares
        // `candidateIdentitySource` against the `"os-fallback"` literal —
        // every OTHER string (including `"worktree-derived"`) is already an
        // automatic pass, identical to `"explicit"`/`"env"`/`"session"` today.
        identitySource: resolvedActor.source as ActorSource,
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
        // reason: corpus scope is a TASK-lease fact; PhaseWorkflowService has no such field, so
        // passing it on would silently drop an authority the caller believes they were granted.
        if (claimOpts.corpusScope !== undefined) {
          inv.io.stderr.write("Error: --corpus-scope applies to task claims only; this target is a phase\n");
          return 2;
        }
        result = await requirePhaseWorkflowService(app).claim(args.task as string, claimOpts);
      }

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { doc: result.value } }, null, 2));
        return 0;
      }

      printLine(inv.io.stdout, `Claimed ${result.value.slug} by ${by} (v${result.value.version})`);
      // reason: D4 — a `--steal` of an orphaned_dirty claim inherits uncommitted work, so the output names that worktree.
      const writtenClaim = taskClaimSchema.safeParse(result.value.extra["claim"]);
      const inheritedWorktree = writtenClaim.success ? writtenClaim.data.inherited_dirty_worktree : undefined;
      if (inheritedWorktree !== undefined) {
        printLine(inv.io.stdout, `Inherited dirty worktree: ${inheritedWorktree} (uncommitted changes from the ended run's claim)`);
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
