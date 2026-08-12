/**
 * Session liveness — L0 read-surface derivation (spec-multi-session-
 * concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-5). Pure: given
 * a RECORDED `{pid, started_at}` fact for a session and a FRESH probe of that
 * SAME pid's CURRENT observed start time, decides whether the session's
 * underlying orchestrator process is alive, dead, or unmeasured — NEVER from
 * claim age. `isClaimStale`'s TTL arithmetic (`@lore/core`, `task-workflow.ts`)
 * stays confined to reporting elsewhere (`ReadySession.stale`); this module
 * never imports or reads it, so "claim age must not influence the verdict"
 * (the AC's own wording) is enforced STRUCTURALLY — there is nothing here to
 * consult, not a runtime check that could be bypassed.
 *
 * Public surface:
 *   - sessionHeartbeatRecordSchema / SessionHeartbeatRecord — the Zod SSOT
 *     for a recorded `{pid, started_at, machine?}` fact. Validated at its ONE
 *     read boundary, `adapters/session-heartbeat-port.ts::readSessionHeartbeat`
 *     — this module defines the shape, that module owns the IO.
 *   - LivenessVerdict — `"alive" | "dead" | "unmeasured"`, never a boolean
 *     (mirrors `gate-predicates.ts::SessionComparison`'s three-valued
 *     "not equal" vs. "not known" distinction).
 *   - deriveLivenessVerdict(recorded, probedStartedAt, sameMachine) — the
 *     pure three-valued decision.
 *
 * Invariants:
 *   - Pure — no IO, no wall-clock reads. Both facts this function consumes
 *     (`recorded`, `probedStartedAt`) are caller-supplied; process probing
 *     and heartbeat storage are leaf IO behind separate injectable ports
 *     (`adapters/process-probe-port.ts`, `adapters/session-heartbeat-port.ts`),
 *     mirroring `detectWorktreeBranch`'s "leaf IO behind an injectable port"
 *     precedent in `real-git-port.ts`.
 *   - Pid-reuse defence: a probe that finds a DIFFERENT process now occupying
 *     `recorded.pid` (a non-null start time that does not equal
 *     `recorded.started_at`) is "dead", never "alive" — the spec's own
 *     pid+start-time identity rule ("kill -0 alone is defeated by pid reuse").
 *   - `!sameMachine` is ALWAYS "unmeasured", regardless of what `recorded`/
 *     `probedStartedAt` say — probing is same-machine only (spec §Non-goals:
 *     "Cross-machine authoritative exclusion... reported as advisory").
 *
 * Source: spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-5.
 */

import { z } from "zod";

/**
 * The recorded `{pid, started_at, machine?}` fact a session's own heartbeat
 * carries (`adapters/session-heartbeat-port.ts`). `started_at` is an
 * OS-probed timestamp (never a self-reported wall-clock value) — see
 * `SessionService.recordOwnHeartbeat`'s own JSDoc for why.
 *
 * @example
 * sessionHeartbeatRecordSchema.parse({ pid: 4242, started_at: "2026-08-12T10:00:00.000Z" });
 */
export const sessionHeartbeatRecordSchema = z.object({
  pid: z.number().int().positive(),
  started_at: z.string().min(1),
  /** This process's own machine identity (`os.hostname()`) at record time. */
  machine: z.string().min(1).optional(),
});

/** Derived TypeScript type for a recorded session heartbeat fact. */
export type SessionHeartbeatRecord = z.infer<typeof sessionHeartbeatRecordSchema>;

/**
 * A session's process-liveness verdict — never a boolean (mirrors
 * `gate-predicates.ts::SessionComparison`'s three-valued discipline: "not
 * alive" and "not measured" are different facts with opposite safe defaults).
 */
export type LivenessVerdict = "alive" | "dead" | "unmeasured";

/**
 * Decides a session's liveness verdict from a recorded heartbeat and a FRESH
 * probe of that SAME pid's current start time — never from claim age (see
 * this module's own header for why claim age cannot even reach this function).
 *
 * @param recorded - The session's last recorded heartbeat, or `undefined`
 *   when none was ever captured (a peer session that never ran `lore session
 *   list|show` on this machine, or a session_id-less legacy claim).
 * @param probedStartedAt - The CURRENT OS-observed start time of
 *   `recorded.pid`, or `null` when no such process currently exists.
 *   Ignored (never consulted) when `recorded` is `undefined`.
 * @param sameMachine - Whether the recording session and the probing caller
 *   are believed to be on the same machine — probing is same-machine only.
 * @returns `"unmeasured"` when `!sameMachine` or `recorded` is absent;
 *   `"dead"` when `probedStartedAt` is `null` (no such process) OR it does
 *   not equal `recorded.started_at` (pid reuse — a DIFFERENT process now
 *   holds that pid); `"alive"` when it matches.
 * @example
 * deriveLivenessVerdict({ pid: 1, started_at: "T0" }, null, true); // => "dead"
 * @example
 * deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T0", true); // => "alive"
 * @example
 * deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T1", true); // => "dead" (pid reuse)
 * @example
 * deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T0", false); // => "unmeasured" (cross-machine)
 * @example
 * deriveLivenessVerdict(undefined, "T0", true); // => "unmeasured" (never recorded)
 */
export function deriveLivenessVerdict(
  recorded: SessionHeartbeatRecord | undefined,
  probedStartedAt: string | null,
  sameMachine: boolean,
): LivenessVerdict {
  if (!sameMachine) return "unmeasured";
  if (recorded === undefined) return "unmeasured";
  if (probedStartedAt === null) return "dead";
  return probedStartedAt === recorded.started_at ? "alive" : "dead";
}
