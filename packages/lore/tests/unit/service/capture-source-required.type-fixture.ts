/**
 * AC-1 NEGATIVE CONTROL — a type-level fixture, not a test file.
 * (task-capture-source-is-optional-at-the-evidence-write-boundary)
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * The task's mechanism-root fix makes `capture_source` a compile-time-REQUIRED
 * field on both `EvidenceInput` (self-reported, `addEvidence`) and
 * `VerifiedEvidenceInput` (runner-attested, `recordVerifiedEvidence`/
 * `recordChecklistVerifiedEvidence`) — the type itself refuses omission,
 * replacing a runtime `?? "self-report"` fallback that made the omission
 * invisible.
 *
 * But `bun run typecheck` passing proves nothing on its own: a signature left
 * OPTIONAL also typechecks. So the oracle needs a control that discriminates
 * (mirrors `setup-fs-boundary-required.type-fixture.ts`'s D8 precedent).
 *
 * HOW IT DISCRIMINATES
 * ────────────────────
 * Every construction below OMITS `capture_source` and is annotated
 * `@ts-expect-error`:
 *
 *   - field REQUIRED (correct)  → the construction errors → the directive is
 *                                 USED → `bun run typecheck` exits 0.
 *   - field reverted to OPTIONAL → the construction compiles → the directive
 *                                 is UNUSED → TS2578 "Unused '@ts-expect-error'
 *                                 directive" → `bun run typecheck` FAILS.
 *
 * Measured in both directions before this file was committed: required →
 * exit 0; reverting `EvidenceInput`/`VerifiedEvidenceInput` to inherit the
 * base schema's `.optional()` capture_source → TS2578, non-zero exit. A
 * control never observed failing is not a control.
 *
 * The `*WithCaptureSource` positive controls are equally load-bearing: without
 * them a type mangled into rejecting EVERYTHING would also satisfy every
 * `@ts-expect-error` above and pass vacuously. They pin that the required form
 * is the form that compiles.
 *
 * ⛔ NOT A `*.test.ts` FILE, deliberately: it asserts a COMPILE-TIME property,
 * so its oracle is `tsc` (`typecheck:lore-tests` includes `tests/**‍/*`), not a
 * runner. Naming it `*.test.ts` would make vitest collect a file with zero
 * cases. Its continued existence is pinned by a case in
 * `capture-source-required.test.ts` ("the type-fixture proving omission fails
 * typecheck still exists").
 *
 * Nothing here executes. `void` on each expression keeps the intent explicit.
 */

import type { EvidenceInput, VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";

// ─── Surface 1: EvidenceInput (addEvidence — self-reported path) ──────────────

function evidenceInputOmitted(): EvidenceInput {
  // @ts-expect-error — capture_source is required; omitting it must not compile.
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
  };
}

function evidenceInputWithCaptureSource(): EvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    capture_source: "self-report",
  };
}

// ─── Surface 2: VerifiedEvidenceInput (recordVerifiedEvidence — attested path) ─

function verifiedEvidenceInputOmitted(): VerifiedEvidenceInput {
  // @ts-expect-error — capture_source is required; omitting it must not compile,
  // even though `attestation` is also present on this same candidate.
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
  };
}

function verifiedEvidenceInputWithCaptureSource(): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    capture_source: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
  };
}

// Keep every symbol referenced so `isolatedModules`/unused-export tooling has
// nothing to prune, without executing any of it.
export const CAPTURE_SOURCE_REQUIRED_FIXTURE_SURFACES = [
  evidenceInputOmitted,
  evidenceInputWithCaptureSource,
  verifiedEvidenceInputOmitted,
  verifiedEvidenceInputWithCaptureSource,
] as const;
