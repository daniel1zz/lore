/**
 * lore plan — plan-level writers for the two OPT-OUT plan-close predicates'
 * audited exemptions (SPEC-069 §Design Decisions D1; SPEC-106 §D4).
 *
 * Subcommands:
 *   exempt-attestation <plan> --reason <text> --kind <k>
 *       Record an audited, typed exemption from the plan-close ATTESTATION
 *       FLOOR (`extra.attestation_exempt` + `_reason` + `_kind`).
 *       `--kind` ∈ red-tdd | no-oracle | pipeline-unreachable | other.
 *   exempt-assessment-freshness <plan> --reason <text>
 *       Record an audited exemption from the plan-close ASSESSMENT-FRESHNESS
 *       predicate (`extra.assessment_freshness_exempt` + `_reason`).
 *
 * Both accept `--json`. Thin pipe over `PlanExemptionService` — zero business
 * logic here (read-merge-write, taxonomy validation, audit shape all live in
 * the service; see its module header), exactly the split `commands/outline.ts`
 * uses over `PrdOutlineService`.
 *
 * Actor identity: the invoking run, via the SHARED
 * `utils.ts::resolveActor` (no `--by` flag). This command deliberately reads no env var of its
 * own — a second precedence chain would silently diverge from every other
 * writer's (AC-069-10).
 *
 * Exit codes per SPEC-003 §5 (via utils.ts::exitCode):
 *   0 = success
 *   2 = CLI usage error (blank/missing --reason, missing/off-taxonomy --kind;
 *       unknown flag via the SPEC-051 strict-flag seam)
 *   3 = DOC_NOT_FOUND
 *   4 = VALIDATION_ERROR (target is not a plan; a blank reason that somehow
 *       reached the service)
 *   5 = STALE_VERSION
 *
 * ⛔ There is deliberately NO `lore set --attestation-exempt` (AC-069-11).
 * `set` replaces `extra` WHOLESALE, so a flag there would silently delete every
 * other service's owned state on the plan — the same reason `file_anchors`,
 * `ac_scope`, `claim`, `verification_evidence`, `validity`, and
 * `prd_sync_exempt` each have a dedicated writer. The existing strict
 * unknown-flag seam (`strict-flags.ts`) is what refuses it, exit 2; no bespoke
 * check is needed in `commands/set.ts`.
 *
 * @invariant The `loadLoreApp` import is DYNAMIC and performed INSIDE each
 *   `run()`, AFTER argument validation — unlike every sibling command module,
 *   which imports it statically at module scope. This is load-bearing, not
 *   stylistic: `loader.ts` pulls `bun:sqlite`, which vitest cannot resolve, so
 *   a static import would make AC-069-9's refusal cases untestable except by
 *   source-scanning for the literal `2` (which proves a digit appears near a
 *   refusal, not that the command exits 2). With the import deferred, the
 *   vitest suite invokes the REAL citty handler and observes the REAL
 *   `process.exitCode`. Do NOT "harmonize" this back to a static import — the
 *   refusal path must stay reachable without a store. (The failure would be
 *   loud, not silent: the vitest suite would fail to resolve `bun:sqlite` at
 *   collection time.)
 *
 * Source: SPEC-069 §Design Decisions D1, §Mechanism required 1–3
 *         (AC-069-8 … AC-069-11); spec-verify-reachability-plan-promote-
 *         early-warning §Scope M3; SPEC-106 §Design Decisions D4
 */

import { defineCommand } from "citty";
import { setExitCode } from "../run-scope.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import {
  ATTESTATION_EXEMPT_KIND_VALUES,
  PLAN_EXEMPT_USAGE_EXIT_CODE,
  checkExemptAssessmentFreshnessArgs,
  checkExemptAttestationArgs,
} from "../plan-exempt-validation.js";
import type { PlanExemptionService } from "../../../service/plan-exemption-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";

/**
 * `App.planExemptionService` is typed optional only to keep pre-existing
 * hand-built App test stubs compiling — the identical guard `commands/ac.ts`
 * and `commands/outline.ts` use. `loadLoreApp()` (this adapter's only App
 * source) always returns a fully-wired App from `createApp`, so this assertion
 * never fires in the CLI.
 */
function requirePlanExemptionService(app: { planExemptionService?: PlanExemptionService }): PlanExemptionService {
  const service = app.planExemptionService;
  if (service === undefined) {
    throw new Error("planExemptionService is not wired on this App instance");
  }
  return service;
}

/** Writes a usage refusal to stderr and sets the SPEC-003 §5 usage exit code. */
function refuse(io: CliIo, message: string): void {
  io.stderr.write(message + "\n");
  setExitCode(PLAN_EXEMPT_USAGE_EXIT_CODE);
}

const sharedArgs = {
  plan: {
    type: "positional" as const,
    description: "Plan document ID or slug",
    required: true,
  },
  reason: {
    type: "string" as const,
    description: "Required justification for the exemption (recorded in the audit trail)",
  },
  json: {
    type: "boolean" as const,
    description: "Output result as JSON",
  },
};

export default defineCommand({
  meta: {
    name: "plan",
    description: "Plan-level writers (audited plan-close exemptions)",
  },
  subCommands: {
    "exempt-attestation": defineCommand({
      meta: {
        name: "exempt-attestation",
        description: "Record an audited, typed exemption from the plan-close attestation floor",
      },
      args: {
        ...sharedArgs,
        kind: {
          type: "string" as const,
          description: `Required exemption type: ${ATTESTATION_EXEMPT_KIND_VALUES.join(" | ")}`,
        },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const checked = checkExemptAttestationArgs({ reason: args.reason, kind: args.kind });
        if (!checked.ok) {
          refuse(inv.io, checked.message);
          return;
        }

        // Deferred on purpose — see this module's @invariant.
        const { loadLoreApp } = await import("../loader.js");
        const { app } = loadLoreApp({ inv });
        try {
          const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
          const result = await requirePlanExemptionService(app).exemptAttestation(
            args.plan as string,
            { reason: checked.reason, kind: checked.kind, by },
          );

          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            setExitCode(exitCode(result.error));
            return;
          }

          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }

          printLine(inv.io.stdout, 
            `Recorded plan-close ATTESTATION EXEMPTION [${result.value.kind}] for ` +
              `${args.plan as string}: ${result.value.reason}`,
          );
          printLine(inv.io.stdout, `  declared by ${result.value.by} at ${result.value.at}`);
        } finally {
          app.close();
        }
      },
    }),

    "exempt-assessment-freshness": defineCommand({
      meta: {
        name: "exempt-assessment-freshness",
        description: "Record an audited exemption from the plan-close assessment-freshness predicate",
      },
      args: { ...sharedArgs },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const checked = checkExemptAssessmentFreshnessArgs({ reason: args.reason });
        if (!checked.ok) {
          refuse(inv.io, checked.message);
          return;
        }

        const { loadLoreApp } = await import("../loader.js");
        const { app } = loadLoreApp({ inv });
        try {
          const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
          const result = await requirePlanExemptionService(app).exemptAssessmentFreshness(
            args.plan as string,
            { reason: checked.reason, by },
          );

          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            setExitCode(exitCode(result.error));
            return;
          }

          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }

          printLine(inv.io.stdout, 
            `Recorded plan-close ASSESSMENT-FRESHNESS EXEMPTION for ` +
              `${args.plan as string}: ${result.value.reason}`,
          );
          printLine(inv.io.stdout, `  declared by ${result.value.by} at ${result.value.at}`);
        } finally {
          app.close();
        }
      },
    }),
  },
});
