/**
 * Pure validation + parent-inference for `lore create task` (SPEC-065 D4;
 * extended by SPEC-069 D2/D3/D4 for the ad-hoc task channel).
 * Extracted from `commands/create.ts` for testability — `commands/create.ts`
 * transitively imports `loader.ts` (`bun:sqlite`), which vitest cannot
 * resolve, but this module imports nothing beyond plain TypeScript. Mirrors
 * `handoff-input.ts`'s identical split (same reason).
 *
 * Fixes the P1-5 dogfood finding (guyin 2026-07-22): `lore create task`
 * used to report a missing `--plan-id` and a missing `--parent_id` (Zod's
 * `superRefine`) across TWO separate round trips — a caller supplying
 * neither flag had to run the command twice to discover both problems. It
 * also never inferred `--parent` from `--plan-id` even though the two are
 * almost always the same value.
 *
 * SPEC-069 P2-9 finding: ad-hoc bugs discovered mid-plan had no legitimate
 * lightweight task channel — `--plan-id`/`--parent` were UNCONDITIONALLY
 * required, so the least-resistance path was parking unrelated tasks on
 * whatever plan was open (which `lore assess` then correctly flagged as
 * scope drift). `--adhoc` gives that work a first-class, planless home;
 * `--linkage` is the opposite case — an EXPLAINED attachment to a real plan.
 *
 * Public surface:
 *   - checkTaskCreateRequiredFlags / formatTaskCreateMissingFlagsError —
 *     single-pass missing-required-flag aggregation + its exit-2 message.
 *     `--adhoc` (SPEC-069 D2) makes BOTH `--plan-id`/`--parent` optional.
 *   - checkTaskCreateAdhocConflicts / formatTaskCreateAdhocConflictError —
 *     `--adhoc` is mutually exclusive with `--plan-id`/`--phase` (a planless
 *     task can declare neither) and with `--linkage` (one says "no plan",
 *     the other justifies the plan chosen) — SPEC-069 D2/D3.
 *   - isAdhocAcScopeDeclarationMissing / formatAdhocAcScopeMissingError —
 *     the ad-hoc branch of `--ac-scope` requiredness (task-an-ad-hoc-task-can-
 *     never-reach-the-attestation-path-that), exit 4 rather than exit 2 for
 *     parity with the plan branch's `task-create` gate denial.
 *   - inferTaskParentId — `--parent` when explicitly passed, else the
 *     resolved `--plan-id` (the dominant shape — a task parented elsewhere
 *     passes `--parent` explicitly). Unaffected by `--adhoc`: an ad-hoc task
 *     always resolves to `undefined` here (both inputs are unset by
 *     definition) — `CorpusService._createImpl` performs the actual root-PRD
 *     parenting, since only the service layer can look up "the root PRD".
 *
 * Side-effect class: pure
 *
 * Source: SPEC-065 D4, AC-065-5, AC-065-6; SPEC-069 D2, D3, D4, AC-069-5, AC-069-6
 */

import { TASK_KINDS, formatTaskKindRequiredMessage } from "@lore/core";

/** Raw, unresolved `lore create task` flag values this module's checks consume. */
export interface TaskCreateFlags {
  /** `args["plan-id"]`, or `undefined`/empty-string when the flag was omitted. */
  planId: string | undefined;
  /** `args.parent`, or `undefined`/empty-string when the flag was omitted. */
  parent: string | undefined;
  /**
   * `args.adhoc`, or `undefined` when the flag was omitted (SPEC-069 D2).
   * Marks this task as planless — relaxes BOTH `--plan-id`/`--parent`
   * required-flag checks, and conflicts with `--plan-id`/`--phase`/`--linkage`.
   * Additive/optional so every pre-SPEC-069 caller of this module (which only
   * ever supplied `planId`/`parent`) keeps compiling and behaving unchanged.
   */
  adhoc?: boolean | undefined;
  /**
   * `args.phase`, or `undefined`/empty-string when the flag was omitted.
   * Conflicts with `--adhoc` (SPEC-069 D2 — an ad-hoc task has no parent
   * plan, so a plan-declared phase name is meaningless).
   */
  phase?: string | undefined;
  /**
   * `args.linkage`, or `undefined`/empty-string when the flag was omitted.
   * Conflicts with `--adhoc` (SPEC-069 D3 — `--linkage` JUSTIFIES a CHOSEN
   * plan; `--adhoc` declares there is none to justify).
   */
  linkage?: string | undefined;
  /**
   * `args.kind`, or `undefined`/empty-string when the flag was omitted. REQUIRED for every task, `--adhoc` included
   * (spec-done-contract-compiled-at-approve-task-kinds-write-sets AC-DCS1-4, ledger D28): there is no kind-less task and no default.
   */
  kind?: string | undefined;
}

/**
 * Collects every missing required flag for `lore create task` in ONE pass.
 * `--plan-id` is ALWAYS required for `type: "task"` — UNLESS `--adhoc` is set
 * (SPEC-069 D2: an ad-hoc task is deliberately planless, so nothing is
 * "missing"). `--parent` is required ONLY when `--plan-id` is ALSO absent
 * (and `--adhoc` is not set) — a present `--plan-id` makes `--parent`
 * inferrable (see {@link inferTaskParentId}), so it is not separately
 * mandatory.
 *
 * @param flags - the caller's raw `--plan-id`/`--parent`/`--adhoc` values
 * @returns the missing flag names (`"--plan-id"`, `"--parent"`), `--plan-id`
 *   first when both are missing; empty array when nothing is missing OR
 *   `flags.adhoc === true`
 */
export function checkTaskCreateRequiredFlags(flags: TaskCreateFlags): string[] {
  const kind = flags.kind;
  const missing: string[] = [];
  // reason: --adhoc relaxes only --plan-id/--parent; the kind below is required for every task, an --adhoc one included (AC-DCS1-4).
  if (flags.adhoc !== true) {
    const hasPlanId = flags.planId !== undefined && flags.planId.trim() !== "";
    const hasParent = flags.parent !== undefined && flags.parent.trim() !== "";
    if (!hasPlanId) missing.push("--plan-id");
    if (!hasParent && !hasPlanId) missing.push("--parent");
  }
  if (kind === undefined || kind === "") missing.push("kind");
  return missing;
}

/**
 * Collects every `--adhoc` mutual-exclusion conflict for `lore create task`
 * in ONE pass (SPEC-069 D2/D3/D4 — participates in the SAME single-pass
 * validation `checkTaskCreateRequiredFlags` established, AC-069-5). A
 * planless (`--adhoc`) task cannot ALSO declare `--plan-id` (nothing to be
 * planless about) or `--phase` (a plan-declared grouping with no plan to
 * belong to), and cannot ALSO declare `--linkage` (which justifies a CHOSEN
 * plan — `--adhoc` says there is none).
 *
 * @param flags - the caller's raw `--adhoc`/`--plan-id`/`--phase`/`--linkage` values
 * @returns the conflicting flag names present alongside `--adhoc`, in
 *   `--plan-id`, `--phase`, `--linkage` order; empty array when `--adhoc` is
 *   not set OR no conflicting flag was also passed
 */
export function checkTaskCreateAdhocConflicts(flags: TaskCreateFlags): string[] {
  if (flags.adhoc !== true) return [];
  const conflicts: string[] = [];
  const hasPlanId = flags.planId !== undefined && flags.planId.trim() !== "";
  const hasPhase = flags.phase !== undefined && flags.phase.trim() !== "";
  const hasLinkage = flags.linkage !== undefined && flags.linkage.trim() !== "";
  if (hasPlanId) conflicts.push("--plan-id");
  if (hasPhase) conflicts.push("--phase");
  if (hasLinkage) conflicts.push("--linkage");
  return conflicts;
}

/**
 * Formats {@link checkTaskCreateAdhocConflicts}'s result into the exit-2
 * error message `lore create task` prints (SPEC-069 D2/D3).
 *
 * @param conflicts - non-empty result of {@link checkTaskCreateAdhocConflicts}
 */
export function formatTaskCreateAdhocConflictError(conflicts: string[]): string {
  const lines = [
    `Error: --adhoc is mutually exclusive with: ${conflicts.join(", ")}.`,
    "  --adhoc creates a planless task (parented to the root PRD) — it cannot also declare",
    "  --plan-id or --phase (both plan-scoped), or --linkage (which JUSTIFIES a chosen plan;",
    "  --adhoc declares there is none).",
  ];
  return lines.join("\n");
}

/**
 * Formats {@link checkTaskCreateRequiredFlags}'s result into the single
 * exit-2 error message `lore create task` prints — AC-065-6 requires BOTH
 * missing flags named in ONE message when neither was passed, not the
 * pre-D4 two-round-trip discovery.
 *
 * @param missing - non-empty result of {@link checkTaskCreateRequiredFlags}
 */
export function formatTaskCreateMissingFlagsError(missing: string[]): string {
  const lines = [`Error: type 'task' is missing required flag(s): ${missing.map((flag) => (flag === "kind" ? "--kind" : flag)).join(", ")}.`];
  if (missing.some((flag) => flag !== "kind")) {
    lines.push("  --plan-id <plan-id-or-slug> is always required for type 'task'.");
  }
  if (missing.includes("kind")) {
    lines.push(`  --kind <${TASK_KINDS.join("|")}> is required: ${formatTaskKindRequiredMessage(undefined, "--kind")}`);
  }
  if (missing.includes("--parent")) {
    lines.push(
      "  --parent <id-or-slug> is required because --plan-id is also missing — with " +
        "--plan-id present, --parent would default to it.",
    );
  }
  return lines.join("\n");
}

/**
 * Whether an `--adhoc` task creation is missing the `--ac-scope` DECLARATION —
 * the ad-hoc branch of `--ac-scope` requiredness (task-an-ad-hoc-task-can-never-
 * reach-the-attestation-path-that).
 *
 * The plan branch is enforced service-side by the `task-create` gate
 * (`acScopeRequiredAtCreate`, `service/gate-predicates.ts`), whose trigger is
 * "the task's parent plan resolves a spec-tier ancestor declaring >= 1
 * script-mode AC". `--adhoc` is DEFINED as having no parent plan, so that
 * trigger can never evaluate true for an ad-hoc task — while
 * `VerifyRunnerService.verifyAdhocTask` resolves an ad-hoc task's governing
 * spec THROUGH `extra.ac_scope`. With the key absent, the one flag that unlocks
 * the shipped ad-hoc attestation path was gated on the one condition `--adhoc`
 * guarantees is absent, so the attestation waiver then in force became the routine
 * archival route for the dominant task shape (and `lore done`'s red-first floor,
 * keyed on the same key's presence, never fired either).
 *
 * This lives at the CLI layer, not in the gate predicate, because the predicate
 * is fed a resolved PLAN LINEAGE and an ad-hoc task has none to feed it — the
 * requirement here is keyed on the AUTHOR'S FLAG, which only this layer sees.
 * `acScopeRequiredAtCreate`'s D3 vacuous pass is therefore unchanged: it still
 * never fires for an ad-hoc task, and this check refuses one step earlier.
 *
 * ⛔ The declaration is never DERIVED from the corpus: guessing which spec
 * governs a task is exactly what `verifyAdhocTask` refuses to do (zero or
 * multiple matches refuse loud, never guessed), and deriving it at create time
 * would move that guess one layer earlier.
 *
 * @param flags - the caller's raw flag values; only `adhoc` is read.
 * @param acScopePassed - {@link ResolvedAcScope.passed} for this invocation —
 *   whether `--ac-scope` appeared AT ALL, which is the bit that matters:
 *   `--ac-scope ""` (an empty but EXPLICIT claim) satisfies the requirement,
 *   an omitted flag does not.
 * @returns `true` iff `--adhoc` was set and `--ac-scope` was never passed;
 *   `false` for every non-ad-hoc creation (the plan branch keeps its
 *   pre-existing gate-side behaviour, byte-identical).
 * @example
 * isAdhocAcScopeDeclarationMissing({ planId: undefined, parent: undefined, adhoc: true }, false); // => true
 * @example
 * isAdhocAcScopeDeclarationMissing({ planId: undefined, parent: undefined, adhoc: true }, true);  // => false — `--ac-scope ""` counts
 * @example
 * isAdhocAcScopeDeclarationMissing({ planId: "plan-x", parent: "plan-x" }, false);                // => false — plan branch, gate's business
 */
export function isAdhocAcScopeDeclarationMissing(
  flags: TaskCreateFlags,
  acScopePassed: boolean,
): boolean {
  if (flags.adhoc !== true) return false;
  return acScopePassed === false;
}

/**
 * Formats {@link isAdhocAcScopeDeclarationMissing}'s refusal — the exit-4
 * message `lore create task --adhoc` prints when no `--ac-scope` was passed.
 *
 * Names BOTH legal forms verbatim (a real id list AND the explicit-empty
 * `--ac-scope ""`), because an author who genuinely claims no criterion must be
 * able to say so without guessing the syntax — an empty declaration does not
 * make the task verifiable, it makes the author's claim AUDITABLE, which is a
 * different and achievable goal. Points at `lore ac list <spec>` for legal ids
 * rather than enumerating any spec's criteria: this layer runs before the store
 * is opened and, unlike the plan branch's `feedTaskCreate`, has no resolved
 * governing spec to enumerate from.
 */
export function formatAdhocAcScopeMissingError(): string {
  return [
    "Error: --adhoc requires an explicit --ac-scope declaration.",
    "  An ad-hoc task has no parent plan, so `lore verify --task <slug>` resolves its",
    "  governing spec THROUGH extra.ac_scope. With that key absent the task can never",
    "  reach a runner-attested pass for its declared criteria (`lore evidence --capture`",
    "  remains its route to an attested pass).",
    "  Declare the criterion ids this task claims (legal ids: lore ac list <spec>):",
    "    --ac-scope <AC-ID> [--ac-scope <AC-ID> ...]",
    "  Or declare explicitly that it claims NONE — an auditable decision, not a silence:",
    '    --ac-scope ""',
  ].join("\n");
}

/**
 * Resolves a task's `parent_id` per D4's inference rule: an explicit
 * `--parent` always wins; an omitted `--parent` defaults to the
 * (already-resolved) `--plan-id` — the dominant shape, since a task parented
 * somewhere OTHER than its own plan passes `--parent` explicitly.
 *
 * @param rawParent - `args.parent`, unresolved id-or-slug, or `undefined`
 * @param resolvedPlanId - the `--plan-id` value AFTER `resolveDoc`
 *   resolution (a canonical ULID), or `undefined` when `--plan-id` was
 *   omitted — callers for non-task doc types always pass `undefined` here,
 *   which makes this fn transparently return `rawParent` unchanged for them
 * @returns the value to place in `CreateDocInput.parent_id`, or `undefined`
 *   when neither is available
 */
export function inferTaskParentId(
  rawParent: string | undefined,
  resolvedPlanId: string | undefined,
): string | undefined {
  if (rawParent !== undefined) return rawParent;
  return resolvedPlanId;
}

/**
 * Resolved `--ac-scope` intent — whether the flag was passed AT ALL, plus the
 * exact ids to store (spec-declaring-ac-scope-is-required-at-task-creation-
 * so-the §Design Decisions D2). The CLI-ergonomics half of the absent-vs-
 * empty contract `taskExtraSchema.ac_scope`/`acScopeArraySchema` (`@lore/core`)
 * already enforces at the schema layer — a repeatable `string` citty flag
 * naturally yields ids or nothing, with no built-in way to say "I passed this
 * flag on purpose to declare an EMPTY scope"; this function adds that one
 * missing bit.
 */
export interface ResolvedAcScope {
  /** Whether `--ac-scope` appeared at least once on the command line. */
  readonly passed: boolean;
  /** The ids to store — `[]` when every occurrence was empty/whitespace-only. */
  readonly ids: string[];
}

/**
 * Resolves the CLI's raw `--ac-scope` occurrence(s) into {@link ResolvedAcScope}.
 * citty/mri yields `undefined` for zero occurrences, a bare `string` for one,
 * a `string[]` for >= 2 (mirrors `commands/create.ts::normalizeRepeatable`'s
 * existing contract, which this supersedes for `--ac-scope` only — every other
 * repeatable flag, e.g. `--anchor`, keeps using `normalizeRepeatable`).
 *
 * A single passed occurrence whose value is empty/whitespace-only (e.g.
 * `--ac-scope ""`) is the CLI's sentinel for "I explicitly declare this task
 * claims NOTHING" (D2) — it is dropped from `ids`, but `passed` stays `true`,
 * so the caller stores `extra.ac_scope: []` rather than treating the flag as
 * never having been passed. Real ids pass through COMPLETELY UNTOUCHED (no
 * trim) — AC-ACS-2 requires the stored array equal EXACTLY the ids passed.
 *
 * @param rawFlag - `args["ac-scope"]` as citty/mri parsed it.
 * @returns `{passed: false, ids: []}` when the flag was never passed;
 *   `{passed: true, ids: [...]}` otherwise.
 * @example
 * resolveAcScopeForCreate(undefined);        // => { passed: false, ids: [] }
 * @example
 * resolveAcScopeForCreate("AC-1");           // => { passed: true, ids: ["AC-1"] }
 * @example
 * resolveAcScopeForCreate(["AC-1", "AC-2"]); // => { passed: true, ids: ["AC-1", "AC-2"] }
 * @example
 * resolveAcScopeForCreate("");               // => { passed: true, ids: [] } — explicit empty (D2)
 */
export function resolveAcScopeForCreate(rawFlag: string | string[] | undefined): ResolvedAcScope {
  if (rawFlag === undefined) {
    return { passed: false, ids: [] };
  }
  const raw = Array.isArray(rawFlag) ? rawFlag.map(String) : [String(rawFlag)];
  return { passed: true, ids: raw.filter((s) => s.trim() !== "") };
}
