/**
 * Supersede orchestration — composes `CorpusService.create` THEN
 * `ValidityService.invalidate` for `lore create <type> --supersedes <old>` (CLI)
 * (SPEC-043 §Design Decisions D11). Mirrors
 * `calibration-hook.ts`'s shape: a thin, surface-neutral sequencing helper living in
 * `flows/` (above the service layer, below the adapters) so every caller uses the SAME
 * function rather than each re-implementing the two-call sequence.
 *
 * Public surface:
 *   createWithSupersedes(deps, input, supersedes, by) — resolve `supersedes`, refuse
 *     BEFORE any write when its type is ineligible, otherwise create `input` then
 *     invalidate `supersedes` naming the newly created doc as its successor.
 *   renderSupersedeRepairMessage(supersedesInput, newDocSlug) — the pinned D11 repair
 *     command string, shared by every caller so the wording can never drift between
 *     the CLI's stderr output and any other error payload.
 *   SUPERSEDE_CREATE_ELIGIBLE_TYPES — the target-type eligibility set this function
 *     enforces (see its own doc comment for the eligibility rationale).
 *
 * @invariant The target-type eligibility precheck (`SUPERSEDE_CREATE_ELIGIBLE_TYPES`)
 *   lives HERE, inside `createWithSupersedes`, and NOWHERE ELSE
 *   (task-mcp-lore-create-supersedes-still-creates-then-fails-the). It was originally
 *   fixed one layer up, inside the CLI's `commands/create.ts` — ABOVE this shared seam
 *   — so a surface that already called this function directly never inherited
 *   it and kept exhibiting the pre-fix create-then-fail behavior. A defect fixed on an
 *   adapter that documents a shared seam beneath it belongs IN the seam, not above it;
 *   this invariant is the mechanization of that lesson, not just its record.
 * @invariant Half-failure is LOUD, never silent (D11, review U6 — the two-command dance
 *   reintroduces the silent-rot hazard the whole spec exists to close). When `create()`
 *   succeeds but `invalidate()` fails, this function still returns `ok()` — the created
 *   doc is real and must not be hidden from the caller — but `SupersedeOrchestrationResult
 *   .supersedeError` carries the invalidate failure so callers can report a
 *   nonzero exit naming the exact repair command via
 *   {@link renderSupersedeRepairMessage}.
 * @invariant `ValidityService` remains the SOLE mutator of `extra.validity` (D2) — this
 *   function never touches it directly, only sequences the three already-existing
 *   service calls it is injected with (Law of Demeter — narrower than the full `App`,
 *   mirrors `calibration-hook.ts`'s `CalibrationHookDeps`).
 * @invariant `create()` failing is a hard failure (propagated as `err()` untouched) —
 *   there is nothing to invalidate and nothing to report as "created but not
 *   superseded" when creation itself never happened. The SAME is now true of the
 *   type-eligibility refusal and of `get()` itself failing (e.g. `supersedes` naming a
 *   doc that does not exist): both propagate as `err()` before `deps.create` is ever
 *   called, so "nothing created" holds for every up-front-knowable refusal, not only
 *   schema-shape ones.
 *
 * Side-effect class: IO (delegates entirely to the three injected functions)
 * Source: SPEC-043 §Design Decisions D11; §Acceptance Criteria AC-MH-13;
 *   task-mcp-lore-create-supersedes-still-creates-then-fails-the (eligibility precheck
 *   hoisted into this seam); adr-lore-s-mechanisms-validate-a-proxy-for-the-property-
 *   not-the (Proxy/Silence/Opt-in — see {@link createWithSupersedes}'s doc comment)
 */

import { err, ok } from "@lore/core";
import type { CreateDocInput, DocRecord, DocType, LoreError, Result } from "@lore/core";
import type { InvalidateOpts, InvalidateResult } from "../service/validity-service.js";

/**
 * Doc types `--supersedes`/`supersedes` (the CREATE-time compose flag on
 * `lore create <type> --supersedes <old>`) may
 * target — DELIBERATELY NARROWER than `ValidityService.VALIDITY_ELIGIBLE_TYPES`
 * (which, since task-a-task-cannot-be-retracted-supersedes-emits-a-repair, also
 * accepts `task` for the STANDALONE `lore invalidate <task>` retraction path). This is
 * an intentional, independently-declared constant — NOT a re-derivation of
 * ValidityService's set that happened to drift — because `--supersedes` composes
 * "create a NEW doc that replaces an OLD one," a forward-looking gesture that fits
 * knowledge/adr (SPEC-043 D11's original scope). A task is typically retracted
 * RETROSPECTIVELY, after its correct replacement already exists as an independent
 * `lore create task` call — a caller retracting a task always uses the two-step
 * `lore create task` + `lore invalidate <old> --superseded-by <new>` flow instead,
 * never this atomic compose.
 *
 * Lives HERE, in the shared flow, and ONLY here (moved out of `commands/create.ts` by
 * task-mcp-lore-create-supersedes-still-creates-then-fails-the) — the CLI's original
 * Defect-1 fix declared and checked this constant locally, one layer above this
 * module, which is exactly why a surface already calling `createWithSupersedes`
 * directly never saw the check. A future adapter that needs this predicate calls
 * `createWithSupersedes`; it never re-declares the set.
 * `tests/unit/adapters/validity-supersede-orchestration.test.ts` pins the
 * single-reference-module invariant with a repo-wide grep assertion.
 */
export const SUPERSEDE_CREATE_ELIGIBLE_TYPES: ReadonlySet<DocType> = new Set(["knowledge", "adr"]);

/**
 * Minimal dependency shape — the three service calls this orchestration sequences,
 * injected rather than imported so this module never constructs a `CorpusService`/
 * `ValidityService` itself (testable with plain fakes, no store, no spawning).
 */
export interface SupersedeOrchestrationDeps {
  /**
   * Narrow resolve port used ONLY to read `supersedes`'s `type` before `create()`
   * runs. Deliberately narrower than `CorpusService.get`'s real return shape
   * (`DocWithNavigation`, which also carries `navigation` — ancestors/siblings/
   * children/related this orchestration never touches, Law of Demeter) — declared
   * as the minimal structural shape this function needs, so `App.corpusService.get`
   * satisfies it directly (excess properties on the real return value are simply
   * ignored) with no adapter-side shim.
   */
  get: (idOrSlug: string) => Promise<Result<{ doc: Pick<DocRecord, "type"> }, LoreError>>;
  create: (
    input: CreateDocInput,
    opts?: { by?: string },
  ) => Promise<Result<DocRecord, LoreError>>;
  invalidate: (idOrSlug: string, opts: InvalidateOpts) => Promise<Result<InvalidateResult, LoreError>>;
}

/** Return shape of {@link createWithSupersedes} on its `ok()` branch. */
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
 * Resolves `supersedes` and refuses BEFORE any write when it is ineligible; otherwise
 * creates `input`, then invalidates `supersedes` naming the new doc as its successor.
 *
 * @remarks Proxy / Silence / Opt-in — every new deterministic mechanism answers these
 *   three (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the):
 *   - **Proxy.** "The target resolves and its type is eligible" is checked directly
 *     against a fresh `deps.get` read, not by proxy. The residual proxy is
 *     `SUPERSEDE_CREATE_ELIGIBLE_TYPES` itself standing for "can meaningfully be
 *     superseded": an `adr` already `superseded` satisfies the type-eligible proxy
 *     while arguably violating the property. ACCEPTED, and named here: invalidating
 *     an already-invalidated doc is `ValidityService`'s job, not this predicate's.
 *   - **Silence.** This refusal is loud — an `err()` the caller must render — and
 *     leaves no partial state (nothing created). The half-failure path that remains
 *     (`create()` ok, `invalidate()` fails for a NON-type reason — see
 *     `supersedeError` on the return type) stays loud via the pre-existing repair-
 *     command mechanism: that failure is a genuine race, not a knowable-up-front
 *     precondition, and must not be silently swallowed either.
 *   - **Opt-in.** None — the precheck binds every caller of this function (every
 *     surface), which is the point: no adapter can bypass it or re-implement it
 *     more loosely.
 *
 * @param deps - Injected `get`/`create`/`invalidate` service calls.
 * @param input - Candidate document to create (same shape `CorpusService.create` takes).
 * @param supersedes - ID or slug of the existing knowledge/adr doc being superseded.
 * @param by - Resolved actor identity for the invalidate step — also threaded to
 *   `deps.create` as `opts.by` (SPEC-079 G2), so the newly created doc's own
 *   audit entry carries the SAME resolved actor rather than falling back to
 *   the env chain independently of what the invalidate step used.
 * @returns `err()` when `supersedes` fails to resolve, when its type is outside
 *   {@link SUPERSEDE_CREATE_ELIGIBLE_TYPES}, or when `create()` itself fails —
 *   `deps.create` is never called in the first two cases; otherwise
 *   `ok({doc, supersedeError?})`.
 * @example
 * const result = await createWithSupersedes(
 *   { get: app.corpusService.get.bind(app.corpusService),
 *     create: app.corpusService.create.bind(app.corpusService),
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
  const targetResult = await deps.get(supersedes);
  if (!targetResult.ok) return targetResult;
  const targetType = targetResult.value.doc.type;
  if (!SUPERSEDE_CREATE_ELIGIBLE_TYPES.has(targetType)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "supersedes",
      message:
        `--supersedes target '${supersedes}' has type '${targetType}'; only ` +
        `${[...SUPERSEDE_CREATE_ELIGIBLE_TYPES].join("/")} documents can be targeted by ` +
        `--supersedes. A ${targetType} is retracted via the two-step ` +
        `'lore create ${targetType} ...' + 'lore invalidate <old> --superseded-by <new>' ` +
        `flow instead (see 'lore invalidate --help').`,
      value: targetType,
      rule: "BR-710",
    });
  }

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
 * any other error payload both render this SAME string (never independently authored, per
 * the "loud orphan, never silent" invariant).
 *
 * @example
 * renderSupersedeRepairMessage("adr-old-decision", "adr-new-decision");
 * // => 'new doc created but NOT superseded — run: lore invalidate adr-old-decision --superseded-by adr-new-decision'
 */
export function renderSupersedeRepairMessage(supersedesInput: string, newDocSlug: string): string {
  return `new doc created but NOT superseded — run: lore invalidate ${supersedesInput} --superseded-by ${newDocSlug}`;
}
