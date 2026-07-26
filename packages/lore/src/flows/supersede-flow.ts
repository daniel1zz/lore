/**
 * Supersede orchestration — composes `CorpusService.create` THEN
 * `ValidityService.invalidate` for `lore create <type> --supersedes <old>` (CLI) and
 * MCP `lore_create.supersedes` (SPEC-043 §Design Decisions D11). Mirrors
 * `calibration-hook.ts`'s shape: a thin, surface-neutral sequencing helper living in
 * `flows/` (above the service layer, below the adapters) so CLI and MCP call the SAME
 * function rather than each re-implementing the two-call sequence.
 *
 * Public surface:
 *   createWithSupersedes(deps, input, supersedes, by) — create `input`, then invalidate
 *     `supersedes` naming the newly created doc as its successor.
 *   renderSupersedeRepairMessage(supersedesInput, newDocSlug) — the pinned D11 repair
 *     command string, shared by every caller so the wording can never drift between
 *     the CLI's stderr output and MCP's error-content payload.
 *
 * @invariant Half-failure is LOUD, never silent (D11, review U6 — the two-command dance
 *   reintroduces the silent-rot hazard the whole spec exists to close). When `create()`
 *   succeeds but `invalidate()` fails, this function still returns `ok()` — the created
 *   doc is real and must not be hidden from the caller — but `SupersedeOrchestrationResult
 *   .supersedeError` carries the invalidate failure so CLI/MCP callers can report a
 *   nonzero exit / `isError` response naming the exact repair command via
 *   {@link renderSupersedeRepairMessage}.
 * @invariant `ValidityService` remains the SOLE mutator of `extra.validity` (D2) — this
 *   function never touches it directly, only sequences the two already-existing service
 *   calls it is injected with (Law of Demeter — narrower than the full `App`, mirrors
 *   `calibration-hook.ts`'s `CalibrationHookDeps`).
 * @invariant `create()` failing is a hard failure (propagated as `err()` untouched) —
 *   there is nothing to invalidate and nothing to report as "created but not
 *   superseded" when creation itself never happened.
 *
 * Side-effect class: IO (delegates entirely to the two injected functions)
 * Source: SPEC-043 §Design Decisions D11; §Acceptance Criteria AC-MH-13
 */

import { ok } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";
import type { InvalidateOpts, InvalidateResult } from "../service/validity-service.js";

/**
 * Minimal dependency shape — the two service calls this orchestration sequences,
 * injected rather than imported so this module never constructs a `CorpusService`/
 * `ValidityService` itself (testable with plain fakes, no store, no spawning).
 */
export interface SupersedeOrchestrationDeps {
  create: (
    input: CreateDocInput,
    opts?: { by?: string },
  ) => Promise<Result<DocRecord, LoreError>>;
  invalidate: (idOrSlug: string, opts: InvalidateOpts) => Promise<Result<InvalidateResult, LoreError>>;
}

export interface SupersedeOrchestrationResult {
  /** The newly created document — always present on `ok()` regardless of `supersedeError`. */
  doc: DocRecord;
  /**
   * Present iff `create()` succeeded but the follow-up `invalidate()` call failed —
   * the D11 half-failure signal. Absent means the full supersede completed cleanly.
   */
  supersedeError?: LoreError;
}

/**
 * Creates `input`, then invalidates `supersedes` naming the new doc as its successor.
 *
 * @param deps - Injected `create`/`invalidate` service calls.
 * @param input - Candidate document to create (same shape `CorpusService.create` takes).
 * @param supersedes - ID or slug of the existing knowledge/adr doc being superseded.
 * @param by - Resolved actor identity for the invalidate step — also threaded to
 *   `deps.create` as `opts.by` (SPEC-079 G2), so the newly created doc's own
 *   audit entry carries the SAME resolved actor rather than falling back to
 *   the env chain independently of what the invalidate step used.
 * @returns `err()` only when `create()` itself fails; otherwise `ok({doc, supersedeError?})`.
 * @example
 * const result = await createWithSupersedes(
 *   { create: app.corpusService.create.bind(app.corpusService),
 *     invalidate: app.validityService.invalidate.bind(app.validityService) },
 *   { type: "adr", title: "New decision", extra: { decision_status: "accepted" } },
 *   "adr-old-decision",
 *   "alice",
 * );
 * if (result.ok && result.value.supersedeError !== undefined) {
 *   console.error(renderSupersedeRepairMessage("adr-old-decision", result.value.doc.slug));
 * }
 */
export async function createWithSupersedes(
  deps: SupersedeOrchestrationDeps,
  input: CreateDocInput,
  supersedes: string,
  by: string,
): Promise<Result<SupersedeOrchestrationResult, LoreError>> {
  const createResult = await deps.create(input, { by });
  if (!createResult.ok) return createResult;
  const doc = createResult.value;

  const invalidateResult = await deps.invalidate(supersedes, { supersededBy: doc.id, by });
  if (!invalidateResult.ok) {
    return ok({ doc, supersedeError: invalidateResult.error });
  }
  return ok({ doc });
}

/**
 * The pinned D11 repair-command message for a half-failed supersede — CLI stderr and
 * MCP error-content both render this SAME string (never independently authored, per
 * the "loud orphan, never silent" invariant).
 *
 * @example
 * renderSupersedeRepairMessage("adr-old-decision", "adr-new-decision");
 * // => 'new doc created but NOT superseded — run: lore invalidate adr-old-decision --superseded-by adr-new-decision'
 */
export function renderSupersedeRepairMessage(supersedesInput: string, newDocSlug: string): string {
  return `new doc created but NOT superseded — run: lore invalidate ${supersedesInput} --superseded-by ${newDocSlug}`;
}
