/**
 * AcService — manages structured acceptance criteria declared on spec documents.
 *
 * Acceptance criteria live in `spec.extra.acceptance_criteria` (array of
 * `AcceptanceCriterion`, schema-validated by `specAcceptanceCriteriaSchema` —
 * `@lore/core` acceptance.ts). They are NOT a doc type — no id of their own beyond
 * the `AC-*` string `id` field, no lifecycle, no independent version history; changes
 * ride the parent spec's own version log (unlike PhaseService's version-less writes —
 * AC declarations are judge-consumed data (SPEC-026/038), so history matters more here).
 *
 * Public surface:
 *   addCriterion(specIdOrSlug, criterion)          → AcceptanceCriterion[] (updated list)
 *   listCriteria(specIdOrSlug)                     → AcListResult { criteria, coverage, dangling }
 *   removeCriterion(specIdOrSlug, acId, opts?)     → AcceptanceCriterion[] (updated list)
 *   setCriterion(specIdOrSlug, acId, patch)        → AcceptanceCriterion[] (updated list) —
 *     in-place edit of ONE declared criterion (spec-lore-ac-set-in-place-edit-of-a-declared-
 *     acceptance, D1-D6). `id`/`mode` are immutable; `statement`/`covers` are mode-agnostic;
 *     `oracle`/`command`/`falsifier` (script) / `rubric` (ai) / `note` (human) are mode-specific
 *     and rejected as VALIDATION_ERROR when passed against a criterion of a different mode (D5).
 *     `falsifier` (task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error) REPLACES the
 *     whole `verify.falsifier` object — see {@link SetCriterionPatch.falsifier}'s own JSDoc for
 *     the require-all-four-together partial-update contract.
 *
 * @invariant All methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant `addCriterion` validates the FULL candidate array (existing + new) via
 *   `specAcceptanceCriteriaSchema` in one `safeParse` call — covers the new entry's own
 *   shape (id format, verify discriminant) AND array-level constraints (max 50, unique
 *   id) simultaneously. Mirrors `CorpusService.set`'s single-shot spec-extra validation
 *   (schemas.ts's `spec_kind` superRefine precedent) rather than re-deriving per-field
 *   checks here.
 * @invariant `addCriterion` ALSO rejects an unquantified abstract-quality claim in the
 *   new entry's `statement` (AC-Quantifiability Gate spec §Design) — the deterministic,
 *   zero-LLM `lintAcQuantifiability` lint (`@lore/core`, ac-quality.ts) runs AFTER shape
 *   validation succeeds and BEFORE the CAS write, so a `lore ac add` with an
 *   unquantified AC never reaches the store. This is the immediate-feedback layer; the
 *   `acQuantifiable` gate predicate (`gate-predicates.ts`, wired into `spec-create`/
 *   `spec-promote`) is the backstop for ACs added through any other path.
 * @invariant `removeCriterion` fails loud (VALIDATION_ERROR) when any task under a
 *   child plan of the spec has `verification_evidence[].ac_ref === acId`, UNLESS
 *   `opts.force` is true. A forced removal never touches task evidence — those
 *   `ac_ref` values become "dangling" (surfaced by `listCriteria`'s `dangling[]`,
 *   SPEC-038 §9 STATE dimension) rather than silently cleaned up. NOT (yet) extended
 *   to ad-hoc-governed tasks (see the next invariant) — a NAMED follow-up gap, since
 *   this method's own safety check is currently scoped to child-plan tasks only.
 * @invariant `listCriteria`'s coverage additionally folds in `--adhoc` tasks whose
 *   declared `ac_scope` resolves UNAMBIGUOUSLY to this spec (task-an-ad-hoc-task-s-
 *   attested-evidence-cannot-carry-ac-ref) — `findAdhocGovernedTasks` reuses the SAME
 *   `resolveGoverningSpecByAcScope` search (`@lore/core`) `VerifyRunnerService.
 *   verifyAdhocTask`/`CorpusService.resolveDeclaredAcIdsForAdhocTask` run, never a
 *   bare string match on `ac_ref` (AC ids are unique only WITHIN one spec, never
 *   globally — a coincidental cross-spec id collision must not double-count).
 * @invariant Writes are CAS-guarded (`store.update`'s `expected_version`) and produce
 *   exactly one `insertVersion` snapshot + one `appendAuditEntry` (action "update",
 *   actor "system") — same shape as `CorpusService.set`'s spec-extra write path, so
 *   `AuditService.verify`'s versions⋈audit completeness oracle (SPEC-035 §2) is
 *   satisfied without a special case for AC writes.
 * @invariant `setCriterion` applies the SAME approved→draft demotion rule
 *   `CorpusService.set` applies to a content/title edit — an in-place AC edit changes
 *   the spec's governing contract exactly as much as a content edit does (D2). "The
 *   same rule" is literal, not asserted by comment: both services call the ONE
 *   implementation, `resolveStatusAfterContractEdit` in `@lore/core` (schemas.ts,
 *   beside `VALID_TRANSITIONS`). It lives there because neither service may own it —
 *   `AcService` importing from `CorpusService` would trade an SSOT violation for the
 *   module invariant "service per concern, no cross-service imports" (module
 *   CLAUDE.md), while `@lore/core` is a dependency both already have and creates no
 *   cross-service edge. This method passes `contentChanged: true` explicitly: an AC
 *   edit is ALWAYS a contract change (an empty patch already returned
 *   VALIDATION_ERROR before the write). It was MIRRORED here until 2026-08-01
 *   (task-the-approved-to-draft-demotion-rule-is-mirrored-in-ac) — the two copies were
 *   held together by cross-referencing comments only, which is a prose mitigation for a
 *   mechanism problem; `tests/unit/service/demotion-rule-ssot.test.ts` is now the
 *   mechanism (it stubs the shared function and fails if either call site drifts).
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-038 §4, §6, §7 D4; spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D1-D6
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  specAcceptanceCriteriaSchema,
  computeAcCoverage,
  extractEvidence,
  lintAcQuantifiability,
  extractDeclaredAcScope,
  resolveGoverningSpecByAcScope,
  resolveStatusAfterContractEdit,
  findMissingOracleFiles,
  type AcceptanceCriterion,
  type AcCoverageFact,
  type AcVerifyMode,
  type FileExistsPort,
} from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
import { isPlanMember } from "./plan-membership.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/** Result of {@link AcService.listCriteria}. */
export interface AcListResult {
  /** Declared acceptance criteria, in declaration order. */
  criteria: AcceptanceCriterion[];
  /**
   * Pass/fail coverage facts, one per declared criterion — present iff the spec has
   * at least one child plan (regardless of whether that plan has any tasks yet) OR
   * at least one `--adhoc` task whose declared `ac_scope` resolves UNAMBIGUOUSLY to
   * this spec (task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref — an
   * ad-hoc task has no structural plan/spec link, SPEC-069 D2, so its evidence is
   * folded in via `resolveGoverningSpecByAcScope`, never a child-plan walk).
   * `null` means "nothing to aggregate against", NOT "zero coverage" — a spec with a
   * plan that has zero tasks (or an ad-hoc match with zero evidence) yields
   * `[]`-shaped facts (0 pass, 0 fail), not `null`.
   */
  coverage: AcCoverageFact[] | null;
  /**
   * `ac_ref` values found in child-plan tasks' evidence that do not match any
   * currently-declared criterion id — the residue of a `removeCriterion(..., {force:
   * true})` call whose evidence was deliberately left untouched. Sorted, deduplicated.
   */
  dangling: string[];
}

/** Options for {@link AcService.removeCriterion}. */
export interface RemoveCriterionOpts {
  /** Remove even when task evidence still references this id (see class invariant). */
  force?: boolean;
}

/**
 * Patch for {@link AcService.setCriterion} — every field optional, each one present
 * REPLACES that field on the target criterion, each one absent leaves it untouched
 * (D1). Deliberately has no `id`/`mode` field — those two are NOT editable through
 * this verb (D1): a caller wanting to change `mode` must use `rm` + `add` instead,
 * which this type cannot even represent, making the immutability structural rather
 * than a runtime check alone.
 *
 * @invariant `statement` and `covers` are mode-agnostic — every criterion has a
 *   statement, and any criterion may declare covered PRD requirement ids.
 * @invariant `oracle`/`command`/`falsifier` apply only to a `mode: "script"`
 *   criterion, `rubric` only to `"ai"`, `note` only to `"human"` — passing one
 *   against a criterion of a different mode is VALIDATION_ERROR (D5), never
 *   silently accepted-and-dropped.
 * @invariant `covers`, when present, REPLACES `requirement_refs` wholesale — an
 *   empty array (`[]`) clears it. `undefined` (the field omitted) leaves the
 *   existing `requirement_refs` untouched. The caller (CLI `commands/ac.ts`) is
 *   responsible for turning a bare `--covers ""` into `[]` before calling here.
 * @invariant `falsifier` — **REQUIRE-ALL-FOUR-TOGETHER partial-update contract**
 *   (task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error): when present,
 *   it REPLACES the criterion's ENTIRE `verify.falsifier` object; `undefined` (no
 *   `--falsifier-*` flag passed at all) leaves any existing falsifier untouched.
 *   There is NO field-level merge onto a previously-stored falsifier — a caller
 *   supplying only SOME of the four `--falsifier-*` flags produces a PARTIAL
 *   candidate object here (assembled by the CLI's `buildFalsifierCandidate`,
 *   shared with `add`), which then fails `specAcceptanceCriteriaSchema`'s
 *   `acFalsifierSchema` (`@lore/core`) naming the missing field(s) — the SAME
 *   all-four-or-fail-loud shape `add` already documents on itself. This was a
 *   deliberate choice between two defensible options (either is fine; an
 *   UNDOCUMENTED half-write is not, per this task's own mandate): a field-level
 *   merge would let a caller change ONLY `expected_exit_code` while silently
 *   keeping a now-stale `find`/`replace` pair pointed at content that may no
 *   longer exist — exactly the kind of half-write CLAUDE.md's "governance `set`
 *   commands... silently swallow" standing rule warns about. Requiring all four
 *   together makes every `set`-edited falsifier as fully re-declared, and
 *   therefore as trustworthy, as one created via `add` — never a blend of new
 *   and stale values a reader would have to reconstruct by hand.
 */
export interface SetCriterionPatch {
  statement?: string;
  oracle?: string;
  command?: string;
  rubric?: string;
  note?: string;
  covers?: string[];
  /**
   * Untyped candidate `AcFalsifier` shape — same rationale as `buildCriterionCandidate`'s
   * `verify` field in `commands/ac.ts`: `specAcceptanceCriteriaSchema` (via `acFalsifierSchema`)
   * is the single source of truth for whether all four sub-fields (`path`/`find`/`replace`/
   * `expected_exit_code`) are present and well-formed. This field only carries the shaped
   * candidate through; it is never itself validated here.
   */
  falsifier?: unknown;
}

// ─── D8 Declaration-Time Path-Existence Check ──────────────────────────────
// (task-promote-the-oracle-file-existence-primitives-into-lore,
//  spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.3/D8)

/**
 * Injected filesystem context for {@link AcService.addCriterion}/
 * {@link AcService.setCriterion}'s D8 declaration-time path-existence check,
 * and for {@link AcService.countUnredeemedAllowMissingPath}'s corpus-wide
 * count. Mirrors `DriftCheckService`'s `FsProbe`/`anchor-resolution.ts`'s
 * per-CALL injection shape (never a constructor default): the check is a
 * complete no-op whenever a caller omits it, so every pre-existing 2/3-arg
 * `addCriterion`/`setCriterion` call site across the repo (CLI `commands/
 * ac.ts`, every other test file) keeps compiling and behaving byte-
 * identically until a CLI/MCP surface is wired to pass a real one.
 */
export interface OraclePathContext {
  /** Real caller: `fs.existsSync`; tests inject a fake — never a real filesystem read here. */
  fileExists: FileExistsPort;
  /** Absolute current working directory the declared command's path token(s) resolve against. */
  cwd: string;
  /** Absolute discovered `.lore/` corpus root, when distinct from `cwd`. */
  corpusRoot?: string;
}

/**
 * Options for {@link AcService.addCriterion}/{@link AcService.setCriterion}'s
 * D8 declaration-time path-existence check.
 *
 * @invariant The check runs ONLY when `pathContext` is supplied — see
 *   {@link OraclePathContext}'s own doc for why this is opt-in rather than a
 *   service-owned default.
 * @invariant `allowMissingPath` is the D8 escape: a non-empty reason unlocks
 *   a script-mode command naming a test-file path not yet on disk (a
 *   red-first AC legitimately names a test not yet written —
 *   `~/.claude/skills/shared/verification-discipline.md`'s mandatory
 *   red-first discipline). An empty/whitespace-only/absent reason is
 *   REFUSED whenever a missing path was actually found — "refuse by
 *   default, with ONE explicit, audited escape" (D8). Supplying it when NO
 *   path is missing is harmless: nothing is declared (there is nothing to
 *   redeem).
 */
export interface DeclarePathOpts {
  pathContext?: OraclePathContext;
  allowMissingPath?: string;
}

/**
 * One tracked D8 escape-hatch exercise — an AC whose declaration named a
 * script-mode command path that did not exist on disk AT DECLARATION TIME,
 * with the reason the caller supplied. Stored in
 * `spec.extra.allow_missing_path_declarations` (a key `acceptance.ts`'s
 * `specAcceptanceCriteriaSchema` never validates or strips — deliberately
 * NOT a field on the criterion's own `verify` object, which WOULD be
 * silently stripped by that schema's default "strip unknown keys" `z.object`
 * behavior).
 *
 * @invariant Whether a given declaration is currently UNREDEEMED is NEVER
 *   cached here — it is recomputed fresh from the live filesystem every time
 *   {@link AcService.countUnredeemedAllowMissingPath} runs, by re-extracting
 *   the OWNING criterion's current `command` and re-checking it. A cached
 *   boolean would make the escape an untracked silent fallback the moment it
 *   went stale — the exact defect D8 exists to prevent.
 */
export interface AllowMissingPathDeclaration {
  ac_id: string;
  reason: string;
  declared_at: string;
}

// ─── AcService ─────────────────────────────────────────────────────────────

export class AcService {
  /**
   * @param store - Storage abstraction (same instance passed to CorpusService)
   */
  constructor(private readonly store: StoreInterface) {}

  // ── addCriterion ──────────────────────────────────────────────────────────

  /**
   * Append a new acceptance criterion to a spec's `extra.acceptance_criteria`.
   * The FULL candidate array (existing + new) is validated via
   * `specAcceptanceCriteriaSchema` before writing — malformed shape, duplicate id, or
   * exceeding the 50-entry cap all fail loud with the doc left unchanged.
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param criterion - Untrusted candidate criterion (validated here, not by the caller —
   *   CLI/MCP callers pass raw flag-assembled objects)
   * @param opts - D8 declaration-time path-existence check options (see
   *   {@link DeclarePathOpts}) — omitted entirely, the check is a no-op
   * @returns Updated criteria array after appending
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / malformed criterion / duplicate
   *   id / 51st entry / a script-mode command naming a path that does not exist and no
   *   non-empty `--allow-missing-path` reason was supplied), STALE_VERSION
   *
   * @example
   * await acService.addCriterion("spec-my-feature", {
   *   id: "AC-ACODE-1",
   *   statement: "Rejects malformed input",
   *   verify: { mode: "script", oracle: "test", command: "bunx vitest run x" },
   * });
   */
  async addCriterion(
    specIdOrSlug: string,
    criterion: unknown,
    opts: DeclarePathOpts = {},
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const existing = extractCriteria(spec);
    const candidate = [...existing, criterion];
    const parsed = specAcceptanceCriteriaSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `acceptance_criteria.${issue.path.join(".")}` : "acceptance_criteria",
        message: issue !== undefined ? issue.message : "Invalid acceptance criterion",
        value: criterion,
      });
    }

    // reason: AC-Quantifiability Gate spec §Design — this is the PRIMARY, immediate
    // enforcement point (the spec-create/spec-promote gate predicate, `acQuantifiable`
    // in `gate-predicates.ts`, is the BACKSTOP that re-lints the whole declared set).
    // Lint ONLY the newly-appended entry — `existing` entries were already accepted
    // through this same check (or predate the gate; the backstop catches those at
    // spec-promote) — via the SAME zero-LLM `lintAcQuantifiability` lint, never a
    // second wordlist/heuristic. `parsed.data`'s last element is the validated form
    // of `criterion` (Zod array parsing preserves element order — `candidate` never
    // reorders `existing`).
    const newCriterion = parsed.data[parsed.data.length - 1];
    if (newCriterion !== undefined) {
      const findings = lintAcQuantifiability([newCriterion]).filter((f) => f.severity === "block");
      const finding = findings[0];
      if (finding !== undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: `acceptance_criteria.${finding.ac_id}`,
          message: finding.message,
          value: criterion,
        });
      }
    }

    // D8 — declaration-time path-existence check (task-promote-the-oracle-file-
    // existence-primitives-into-lore). `newCriterion` is the schema-VALIDATED
    // form (never raw `criterion`) so `checkDeclaredPathExistence` always reads
    // a well-shaped `verify` union.
    let declaration: AllowMissingPathDeclaration | undefined;
    if (newCriterion !== undefined) {
      const pathCheck = checkDeclaredPathExistence(newCriterion, opts);
      if (!pathCheck.ok) return pathCheck;
      if (pathCheck.value.declaration !== null) declaration = pathCheck.value.declaration;
    }

    const writeResult = await this.writeCriteria(
      spec,
      parsed.data,
      "add",
      declaration !== undefined ? { declaration } : {},
    );
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── listCriteria ──────────────────────────────────────────────────────────

  /**
   * Return the declared criteria for a spec, plus per-AC evidence coverage (when the
   * spec has ≥1 child plan OR ≥1 governed ad-hoc task) and dangling `ac_ref` ids
   * (evidence pointing at ids no longer declared).
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @returns {@link AcListResult}
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec)
   */
  async listCriteria(specIdOrSlug: string): Promise<Result<AcListResult, LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;
    const criteria = extractCriteria(spec);

    const plansResult = await this.findChildPlans(spec.id);
    if (!plansResult.ok) return plansResult;
    const plans = plansResult.value;

    const planTasksResult = await this.findTasksUnderPlans(plans);
    if (!planTasksResult.ok) return planTasksResult;

    const adhocTasksResult = await this.findAdhocGovernedTasks(spec);
    if (!adhocTasksResult.ok) return adhocTasksResult;

    const tasks = [...planTasksResult.value, ...adhocTasksResult.value];

    const coverage =
      plans.length > 0 || adhocTasksResult.value.length > 0 ? computeAcCoverage(criteria, tasks) : null;

    const declaredIds = new Set(criteria.map((c) => c.id));
    const danglingSet = new Set<string>();
    for (const task of tasks) {
      for (const entry of extractEvidence(task)) {
        if (entry.ac_ref !== undefined && !declaredIds.has(entry.ac_ref)) {
          danglingSet.add(entry.ac_ref);
        }
      }
    }

    return ok({ criteria, coverage, dangling: Array.from(danglingSet).sort() });
  }

  // ── removeCriterion ───────────────────────────────────────────────────────

  /**
   * Remove a declared acceptance criterion from a spec.
   * Fails if any task under a child plan of the spec has evidence referencing this
   * id, unless `opts.force` is true (see class invariant — force never touches
   * existing evidence).
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param acId - Acceptance criterion id to remove (exact match)
   * @param opts - `{ force? }`
   * @returns Updated criteria array after removal
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / id not found / evidence
   *   references it without force), STALE_VERSION
   */
  async removeCriterion(
    specIdOrSlug: string,
    acId: string,
    opts: RemoveCriterionOpts = {},
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const existing = extractCriteria(spec);
    if (!existing.some((c) => c.id === acId)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria[].id",
        message: `Acceptance criterion "${acId}" does not exist on this spec`,
        value: acId,
      });
    }

    if (opts.force !== true) {
      const plansResult = await this.findChildPlans(spec.id);
      if (!plansResult.ok) return plansResult;
      const tasksResult = await this.findTasksUnderPlans(plansResult.value);
      if (!tasksResult.ok) return tasksResult;

      const referencingTask = tasksResult.value.find((task) =>
        extractEvidence(task).some((entry) => entry.ac_ref === acId),
      );
      if (referencingTask !== undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acceptance_criteria[].id",
          message:
            `Cannot remove "${acId}" — task "${referencingTask.slug}" has evidence referencing it. ` +
            "Pass --force to remove anyway (existing evidence keeps its ac_ref and becomes dangling).",
          value: acId,
        });
      }
    }

    const updated = existing.filter((c) => c.id !== acId);
    const writeResult = await this.writeCriteria(spec, updated, "remove");
    if (!writeResult.ok) return writeResult;
    return ok(updated);
  }

  // ── setCriterion ──────────────────────────────────────────────────────────

  /**
   * Edit ONE declared acceptance criterion in place — `id` stable, every OTHER
   * criterion and every other `extra` key untouched (D6), no `--force`, ever.
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param acId - The criterion's id (unchanged by this call — see {@link SetCriterionPatch})
   * @param patch - Fields to replace; at least one MUST be present (D3 — a
   *   completely-empty patch is VALIDATION_ERROR here as defense in depth, though the
   *   CLI already refuses it pre-service at exit 2, argv-decidable, before this method
   *   is ever called — D5a)
   * @param opts - D8 declaration-time path-existence check options (see
   *   {@link DeclarePathOpts}) — omitted entirely, the check is a no-op
   * @returns Updated criteria array (all entries, target replaced in place)
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / empty patch / unknown id,
   *   naming the declared ids (D4) / a mode-inconsistent flag, naming the flag and the
   *   criterion's actual mode (D5) / malformed resulting shape / a script-mode command
   *   naming a path that does not exist and no non-empty `--allow-missing-path` reason
   *   was supplied), STALE_VERSION
   *
   * @example
   * await acService.setCriterion("spec-my-feature", "AC-ACODE-1", {
   *   statement: "Rejects malformed input with a named field",
   * });
   */
  async setCriterion(
    specIdOrSlug: string,
    acId: string,
    patch: SetCriterionPatch,
    opts: DeclarePathOpts = {},
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const hasAnyField =
      patch.statement !== undefined ||
      patch.oracle !== undefined ||
      patch.command !== undefined ||
      patch.rubric !== undefined ||
      patch.note !== undefined ||
      patch.covers !== undefined ||
      patch.falsifier !== undefined;
    if (!hasAnyField) {
      return err({
        code: "VALIDATION_ERROR",
        field: "patch",
        message:
          "lore ac set requires at least one field to change: --statement, --oracle, --command, --rubric, " +
          "--note, --covers, --falsifier-path/-find/-replace/-exit-code",
        value: patch,
      });
    }

    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const existing = extractCriteria(spec);
    const index = existing.findIndex((c) => c.id === acId);
    if (index === -1) {
      const declaredIds = existing.map((c) => c.id);
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria[].id",
        message:
          declaredIds.length > 0
            ? `Acceptance criterion "${acId}" is not declared on this spec. Declared ids: ${declaredIds.join(", ")}`
            : `Acceptance criterion "${acId}" is not declared on this spec — no criteria are declared yet`,
        value: acId,
      });
    }
    const target = existing[index] as AcceptanceCriterion;

    // D5 — mode-inconsistent flag guard: VALIDATION_ERROR (document-state fault,
    // D5a) naming BOTH the offending flag and the criterion's actual mode. Checked
    // in a fixed order (oracle, command, rubric, note) so a caller passing more
    // than one wrong flag at once still gets a single deterministic message.
    const mode = target.verify.mode;
    if (patch.oracle !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--oracle", mode));
    }
    if (patch.command !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--command", mode));
    }
    if (patch.falsifier !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--falsifier-*", mode));
    }
    if (patch.rubric !== undefined && mode !== "ai") {
      return err(modeMismatchError(acId, "--rubric", mode));
    }
    if (patch.note !== undefined && mode !== "human") {
      return err(modeMismatchError(acId, "--note", mode));
    }

    const candidateCriterion: Record<string, unknown> = {
      id: target.id,
      statement: patch.statement ?? target.statement,
      verify: buildVerifyCandidate(target.verify, patch),
      ...(patch.covers !== undefined
        ? { requirement_refs: patch.covers }
        : target.requirement_refs !== undefined
          ? { requirement_refs: target.requirement_refs }
          : {}),
    };

    const candidateArray = existing.map((c, i) => (i === index ? candidateCriterion : c));
    const parsed = specAcceptanceCriteriaSchema.safeParse(candidateArray);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `acceptance_criteria.${issue.path.join(".")}` : "acceptance_criteria",
        message: issue !== undefined ? issue.message : "Invalid acceptance criterion",
        value: candidateCriterion,
      });
    }

    // D8 — declaration-time path-existence check (task-promote-the-oracle-file-
    // existence-primitives-into-lore). Checked against `parsed.data[index]` (the
    // schema-VALIDATED edited entry), so an edit that only touches `--statement`/
    // `--covers` on a script-mode criterion still re-checks the (possibly
    // untouched) command — cheap and correct: a re-check of an unmodified,
    // already-existing path is a guaranteed no-op.
    const editedCriterion = parsed.data[index];
    let declaration: AllowMissingPathDeclaration | undefined;
    if (editedCriterion !== undefined) {
      const pathCheck = checkDeclaredPathExistence(editedCriterion, opts);
      if (!pathCheck.ok) return pathCheck;
      if (pathCheck.value.declaration !== null) declaration = pathCheck.value.declaration;
    }

    // D2 — the SHARED demotion rule (`@lore/core`, beside VALID_TRANSITIONS; the
    // same function CorpusService.set calls — see class invariant above): an
    // approved spec demotes to draft on this edit, a non-approved spec's status is
    // untouched. `true` is passed literally because reaching this line means a
    // field WAS edited — the no-field-flag case already returned VALIDATION_ERROR
    // (D3) — and every editable field on a criterion is governing contract content.
    const newStatus = resolveStatusAfterContractEdit(spec.status, true);

    const writeResult = await this.writeCriteria(spec, parsed.data, "set", {
      status: newStatus,
      acId,
      ...(declaration !== undefined ? { declaration } : {}),
    });
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── countUnredeemedAllowMissingPath ───────────────────────────────────────

  /**
   * Corpus-wide count of UNREDEEMED `--allow-missing-path` declarations — an
   * AC that exercised the D8 escape at declaration time whose declared
   * script-mode command STILL names a path absent from disk (AC-OX-9,
   * spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §D8).
   *
   * Recomputed FRESH from the live filesystem on every call via the SAME
   * `findMissingOracleFiles` (`@lore/core`) the write-path check uses — never
   * a cached/stored boolean. Creating the previously-missing file makes the
   * count drop on the very next call, with NO further command: that liveness
   * is the entire point of tracking the escape instead of letting it become
   * an untracked silent fallback (D8's own "make the ambiguity visible and
   * attributable" resolution).
   *
   * A declaration whose `ac_id` no longer names a CURRENTLY-declared
   * criterion (the AC was removed via {@link removeCriterion}, or its mode
   * changed away from `script` via `rm`+`add`) is silently excluded — removal
   * is itself a valid way to resolve a stale declaration, so no separate
   * cleanup step runs on `removeCriterion` itself.
   *
   * @param pathContext - the same injected fs context {@link DeclarePathOpts}
   *   accepts — REQUIRED here (unlike the opt-in write-path check): a count
   *   with no filesystem to check against is meaningless, so this method has
   *   no no-op mode.
   * @returns the corpus-wide unredeemed count — `0` when nothing was ever
   *   declared, or every declared path now exists
   * @throws whatever `StoreInterface.findMany` throws (STORE_ERROR family)
   */
  async countUnredeemedAllowMissingPath(
    pathContext: OraclePathContext,
  ): Promise<Result<number, LoreError>> {
    const listResult = await this.listUnredeemedAllowMissingPath(pathContext);
    if (!listResult.ok) return listResult;
    return ok(listResult.value.length);
  }

  /**
   * The MEMBER LIST behind {@link countUnredeemedAllowMissingPath} — task-
   * raise-the-evidence-tail-guard-s-predicate-to-its-own (AC-FR-5): a
   * corpus-wide count with no way to enumerate its members is not
   * actionable (measured 2026-08-10 — producing this exact list for
   * `pass_unfalsified_count=29` required a throwaway script iterating all
   * 138 specs by hand). `countUnredeemedAllowMissingPath` now DERIVES its
   * number from this list's length — one iteration, never two independently
   * maintained copies of "which declarations are still unredeemed".
   *
   * @param pathContext - same REQUIRED injected fs context as {@link
   *   countUnredeemedAllowMissingPath} — recomputed fresh from the live
   *   filesystem every call, never cached.
   * @returns one entry per unredeemed declaration, `"<spec-slug>#<ac-id>"` —
   *   stable, greppable, and sufficient to locate the offending
   *   `--allow-missing-path` declaration via `lore ac list <spec-slug>`.
   */
  async listUnredeemedAllowMissingPath(
    pathContext: OraclePathContext,
  ): Promise<Result<string[], LoreError>> {
    const specsResult = await this.store.findMany({ type: "spec" });
    if (!specsResult.ok) return specsResult;

    const unredeemed: string[] = [];
    for (const spec of specsResult.value) {
      const declarations = extractAllowMissingPathDeclarations(spec);
      if (declarations.length === 0) continue;

      const criteriaById = new Map(extractCriteria(spec).map((c) => [c.id, c] as const));
      for (const declaration of declarations) {
        const criterion = criteriaById.get(declaration.ac_id);
        if (criterion === undefined || criterion.verify.mode !== "script") continue;

        const missing = findMissingOracleFiles(criterion.verify.command, {
          cwd: pathContext.cwd,
          ...(pathContext.corpusRoot !== undefined ? { corpusRoot: pathContext.corpusRoot } : {}),
          fileExists: pathContext.fileExists,
        });
        if (missing.length > 0) unredeemed.push(`${spec.slug}#${declaration.ac_id}`);
      }
    }
    return ok(unredeemed);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Resolves idOrSlug and validates it is a spec document. */
  private async resolveSpec(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc.type !== "spec") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a spec document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /** Child plans of a spec (direct parent_id match only). */
  private async findChildPlans(specId: DocId): Promise<Result<DocRecord[], LoreError>> {
    return this.store.findMany({ parent_id: specId, type: "plan" });
  }

  /**
   * All tasks across a set of plans — ONE corpus-wide `type: "task"` findMany
   * (the store has no `extra.plan_id` filter — same accepted tradeoff
   * `TaskWorkflowService.ready`/`computePlanNowFullyTerminal` already
   * establish, task-plan-membership-is-extra-plan-id-but-the-last-task),
   * membership decided per plan by {@link isPlanMember} — never a bare
   * `t.parent_id === plan.id` (task-eight-more-plan-member-queries-still-
   * key-on-parent-id). Segments are pushed in `plans` iteration order and
   * each segment preserves the store's own `updated_at DESC, id ASC` relative
   * order (a filter over an already-sorted array never reorders its
   * survivors) — for the CONTROL case (every task's `parent_id ===
   * extra.plan_id`) this is byte-identical to the pre-fix per-plan-findMany
   * result, while now costing ONE store round trip instead of one PER plan.
   */
  private async findTasksUnderPlans(plans: DocRecord[]): Promise<Result<DocRecord[], LoreError>> {
    if (plans.length === 0) return ok([]);
    const allTasksResult = await this.store.findMany({ type: "task" });
    if (!allTasksResult.ok) return allTasksResult;
    const allTasks = allTasksResult.value;
    const collected: DocRecord[] = [];
    for (const plan of plans) {
      collected.push(...allTasks.filter((t) => isPlanMember(t, plan.id)));
    }
    return ok(collected);
  }

  /**
   * The ad-hoc-task counterpart to {@link findTasksUnderPlans} (task-an-ad-hoc-
   * task-s-attested-evidence-cannot-carry-ac-ref) — an `--adhoc` task (SPEC-069
   * D2) has no structural plan/spec link to `spec` to walk via `parent_id`, so
   * "does this ad-hoc task belong to THIS spec's coverage" is instead answered by
   * running the SAME `resolveGoverningSpecByAcScope` search
   * `VerifyRunnerService.verifyAdhocTask` / `CorpusService.
   * resolveDeclaredAcIdsForAdhocTask` run over the corpus's FULL spec list, and
   * checking whether the winning match IS `spec`.
   *
   * Deliberately NOT a bare string-equality match on `ac_ref` against `spec`'s
   * declared ids: `AC-*` ids are unique only WITHIN one spec's declared criteria,
   * never enforced globally (`specAcceptanceCriteriaSchema`) — two unrelated specs
   * may coincidentally declare the identical id string, and an ad-hoc task's
   * evidence must never be double-counted (or wrongly counted) against a spec its
   * `ac_scope` was never actually resolved against at write time. An ad-hoc task
   * whose scope is absent/empty, or resolves ambiguously/to no spec at all, is
   * silently excluded here (not an error — `listCriteria` never fails loud over
   * an unrelated ad-hoc task's own dangling scope; that task's own evidence log
   * simply contributes to no spec's coverage).
   *
   * @param spec - The spec {@link listCriteria} is computing coverage for.
   * @returns Every `--adhoc` task whose declared `ac_scope` resolves, unambiguously,
   *   to `spec` — `[]` when none do (never an error for that reason alone).
   */
  private async findAdhocGovernedTasks(spec: DocRecord): Promise<Result<DocRecord[], LoreError>> {
    const allTasksResult = await this.store.findMany({ type: "task" });
    if (!allTasksResult.ok) return allTasksResult;
    const adhocTasks = allTasksResult.value.filter((t) => t.extra["adhoc"] === true);
    if (adhocTasks.length === 0) return ok([]);

    const allSpecsResult = await this.store.findMany({ type: "spec" });
    if (!allSpecsResult.ok) return allSpecsResult;
    const allSpecs = allSpecsResult.value;

    const governed: DocRecord[] = [];
    for (const task of adhocTasks) {
      const declared = extractDeclaredAcScope(task);
      if (declared === undefined || declared.length === 0) continue;
      const resolveResult = resolveGoverningSpecByAcScope(
        declared,
        allSpecs,
        `ad-hoc task "${task.slug}"`,
      );
      if (!resolveResult.ok) continue;
      if (resolveResult.value.spec.id === spec.id) governed.push(task);
    }
    return ok(governed);
  }

  /**
   * Shared CAS-guarded write path for addCriterion/removeCriterion/setCriterion: bumps
   * the spec's version, writes one insertVersion snapshot, then one audit entry (action
   * "update", actor "system") — same shape as CorpusService.set's spec-extra write, so
   * AuditService.verify's versions⋈audit completeness oracle needs no special case.
   *
   * @param opts.status - Explicit status to write (setCriterion's D2 demotion); omitted
   *   for add/remove, which never change status — defaults to `spec.status` unchanged.
   * @param opts.acId - The edited criterion's id, for setCriterion's change_summary/audit
   *   `details` only (add/remove operate on the whole array, no single id to name).
   * @param opts.declaration - A NEW/updated D8 `--allow-missing-path` declaration to
   *   upsert into `spec.extra.allow_missing_path_declarations` (task-promote-the-
   *   oracle-file-existence-primitives-into-lore) — omitted when
   *   `checkDeclaredPathExistence` produced none (the common case: no path was
   *   missing, or the check did not run at all).
   */
  private async writeCriteria(
    spec: DocRecord,
    criteria: AcceptanceCriterion[],
    operation: "add" | "remove" | "set",
    opts: { status?: DocRecord["status"]; acId?: string; declaration?: AllowMissingPathDeclaration } = {},
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const newVersion = spec.version + 1;
    const newExtra: Record<string, unknown> = { ...spec.extra, acceptance_criteria: criteria };
    if (opts.declaration !== undefined) {
      newExtra["allow_missing_path_declarations"] = upsertAllowMissingPathDeclaration(
        extractAllowMissingPathDeclarations(spec),
        opts.declaration,
      );
    }
    const newStatus = opts.status ?? spec.status;

    const updateResult = await this.store.update(
      spec.id,
      { extra: newExtra, updated_at: now, version: newVersion, status: newStatus },
      { expected_version: spec.version },
    );
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: spec.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: now,
      created_by: "system",
      change_summary:
        operation === "set"
          ? buildSetChangeSummary(criteria.length, opts.acId, spec.status, newStatus)
          : `Acceptance criteria ${operation === "add" ? "updated" : "updated (removal)"} — ${criteria.length} entries`,
      // SPEC-072 D1/D2 — this write path only touches `extra`; carry the
      // current (unchanged) slug.
      slug: updateResult.value.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: spec.id,
      action: "update",
      doc_id: spec.id,
      details: {
        operation,
        criteria_count: criteria.length,
        version: newVersion,
        ...(opts.acId !== undefined ? { ac_id: opts.acId } : {}),
      },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the validated acceptance criteria array from a spec DocRecord.
 * Returns [] when extra.acceptance_criteria is absent or fails schema validation —
 * schema-based (not duck-typed) since the discriminated `verify` union is too
 * structural for a hand-rolled type guard to safely narrow.
 */
function extractCriteria(spec: DocRecord): AcceptanceCriterion[] {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return parsed.success ? parsed.data : [];
}

/**
 * D8 declaration-time path-existence check for ONE candidate criterion
 * (task-promote-the-oracle-file-existence-primitives-into-lore,
 * spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.3/D8).
 *
 * Deliberately does NOT reuse `evidence-precheck.ts`'s shared
 * `isSelfReportedPassInScope` — that gate answers "is this a self-reported
 * TEST/E2E PASS", a question with no meaning for AC DECLARATION (there is no
 * `result` here at all). Widening it to also cover this call site would
 * silently arm evidence-precheck.ts's OTHER four guards (2/3/5) for a
 * direction none of them reason about — an explicit non-negotiable
 * constraint of this task. This check's own, narrow scope is instead: a
 * `script`-mode criterion, checked at declaration time, with its own D8
 * escape — nothing shared with the evidence-write guards beyond the promoted
 * `findMissingOracleFiles` primitive itself.
 *
 * @param candidate - the schema-VALIDATED candidate criterion (never the raw,
 *   untrusted input) — `addCriterion` passes `parsed.data`'s new entry,
 *   `setCriterion` passes `parsed.data[index]`'s edited entry
 * @param opts - see {@link DeclarePathOpts}
 * @returns `err(VALIDATION_ERROR)` when a missing path was found with no (or
 *   whitespace-only) `allowMissingPath` reason; otherwise
 *   `ok({ declaration })` where `declaration` is:
 *   - `null` when the check did not run at all (`opts.pathContext` omitted),
 *     the criterion is not `script` mode, or every extracted path resolves —
 *     THREE cases collapsed into one "nothing to track" value, since none of
 *     them produces a stale escape to redeem later
 *   - a NEW {@link AllowMissingPathDeclaration} ONLY when the escape was
 *     genuinely exercised (≥1 path is missing AND a non-empty reason was
 *     supplied) — the caller persists this via {@link AcService.writeCriteria}
 */
function checkDeclaredPathExistence(
  candidate: { id: string; verify: AcceptanceCriterion["verify"] },
  opts: DeclarePathOpts,
): Result<{ declaration: AllowMissingPathDeclaration | null }, LoreError> {
  const { pathContext } = opts;
  if (pathContext === undefined) return ok({ declaration: null });
  if (candidate.verify.mode !== "script") return ok({ declaration: null });

  const missing = findMissingOracleFiles(candidate.verify.command, {
    cwd: pathContext.cwd,
    ...(pathContext.corpusRoot !== undefined ? { corpusRoot: pathContext.corpusRoot } : {}),
    fileExists: pathContext.fileExists,
  });
  if (missing.length === 0) return ok({ declaration: null });

  const reason = opts.allowMissingPath;
  if (reason === undefined || reason.trim().length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "verify.command",
      message:
        `Declared script-mode command names path(s) that do not exist yet: ${missing.join(", ")}. ` +
        "A red-first AC may legitimately name a test not yet written — pass a non-empty " +
        '--allow-missing-path "<reason>" to declare it explicitly. The declaration is then ' +
        "tracked as UNREDEEMED (lore status --json's unredeemed-declaration count) until the " +
        "file exists — creating it drops the count on the next read, no further command needed.",
      value: candidate.verify.command,
    });
  }

  return ok({
    declaration: {
      ac_id: candidate.id,
      reason: reason.trim(),
      declared_at: new Date().toISOString(),
    },
  });
}

/**
 * Extracts the well-formed subset of `spec.extra.allow_missing_path_declarations`
 * — malformed/legacy entries are silently dropped rather than thrown on, the
 * SAME fail-closed-on-read convention `extractCriteria` already uses for
 * `acceptance_criteria` itself. This key lives OUTSIDE `acceptance_criteria`
 * (never as a field on a criterion's own `verify` object) because
 * `specAcceptanceCriteriaSchema`'s per-criterion `z.object()` schemas use
 * Zod's default "strip unknown keys" behavior — an extra field on `verify`
 * would be silently DROPPED on the very next `safeParse`, which is exactly
 * the untracked-silent-fallback shape D8 exists to prevent.
 */
function extractAllowMissingPathDeclarations(spec: DocRecord): AllowMissingPathDeclaration[] {
  const raw = spec.extra["allow_missing_path_declarations"];
  if (!Array.isArray(raw)) return [];
  const declarations: AllowMissingPathDeclaration[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record["ac_id"] === "string" &&
      typeof record["reason"] === "string" &&
      typeof record["declared_at"] === "string"
    ) {
      declarations.push({ ac_id: record["ac_id"], reason: record["reason"], declared_at: record["declared_at"] });
    }
  }
  return declarations;
}

/**
 * Upserts `next` into `existing` by `ac_id` — a re-declaration for the same
 * criterion (e.g. `setCriterion` editing an already-escaped command again)
 * REPLACES the prior reason/timestamp rather than accumulating duplicates.
 */
function upsertAllowMissingPathDeclaration(
  existing: AllowMissingPathDeclaration[],
  next: AllowMissingPathDeclaration,
): AllowMissingPathDeclaration[] {
  return [...existing.filter((d) => d.ac_id !== next.ac_id), next];
}

/**
 * Build the candidate `verify` object for {@link AcService.setCriterion} — mode is
 * ALWAYS carried over from `existingVerify` unchanged (D1: not editable through this
 * verb); each mode-specific field is `patch`'s value when supplied, else the
 * existing value. Deliberately returns `Record<string, unknown>` (not the typed
 * `AcceptanceCriterion["verify"]` union) — same pattern `commands/ac.ts`'s
 * `buildCriterionCandidate` already uses for `add`: the candidate is validated by
 * `specAcceptanceCriteriaSchema.safeParse` immediately after, which is the single
 * source of truth for shape correctness, not this assembly step.
 */
function buildVerifyCandidate(
  existingVerify: AcceptanceCriterion["verify"],
  patch: SetCriterionPatch,
): Record<string, unknown> {
  switch (existingVerify.mode) {
    case "script":
      return {
        mode: "script",
        oracle: patch.oracle ?? existingVerify.oracle,
        command: patch.command ?? existingVerify.command,
        ...(existingVerify.timeout_ms !== undefined ? { timeout_ms: existingVerify.timeout_ms } : {}),
        // reason: REQUIRE-ALL-FOUR-TOGETHER partial-update contract (see
        // SetCriterionPatch.falsifier's own JSDoc) — `patch.falsifier` REPLACES
        // the whole object wholesale when present (a partial candidate fails
        // `acFalsifierSchema` naming the missing field, never a silent
        // field-level merge onto `existingVerify.falsifier`); absent leaves the
        // existing falsifier (if any) untouched.
        ...(patch.falsifier !== undefined
          ? { falsifier: patch.falsifier }
          : existingVerify.falsifier !== undefined
            ? { falsifier: existingVerify.falsifier }
            : {}),
      };
    case "ai":
      return { mode: "ai", rubric: patch.rubric ?? existingVerify.rubric };
    case "human":
      return {
        mode: "human",
        ...(patch.note !== undefined
          ? { note: patch.note }
          : existingVerify.note !== undefined
            ? { note: existingVerify.note }
            : {}),
      };
  }
}

/**
 * D5's VALIDATION_ERROR for a flag that does not apply to the target criterion's
 * mode — names BOTH the flag and the actual mode (D5: "accepting-and-dropping would
 * let a caller believe an oracle was rewritten when it was not"). Exit-4 family per
 * D5a: this is decidable only against the RESOLVED document's declared mode, never
 * from argv alone.
 */
function modeMismatchError(acId: string, flag: string, actualMode: AcVerifyMode): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "verify",
    message: `${flag} only applies to a "${modeFieldName(flag)}"-mode criterion — "${acId}" is mode "${actualMode}"`,
    value: { ac_id: acId, flag, mode: actualMode },
  };
}

/** The verify mode a given mode-specific flag belongs to (for modeMismatchError's message). */
function modeFieldName(flag: string): AcVerifyMode {
  if (flag === "--oracle" || flag === "--command" || flag === "--falsifier-*") return "script";
  if (flag === "--rubric") return "ai";
  return "human";
}

/**
 * change_summary for a `setCriterion` write — names the edited id, and appends a
 * demotion note ONLY when this write actually moved the spec's status (AC-ACS-4:
 * the draft-stays-draft case must show no status-transition text at all).
 *
 * reason: the condition is `fromStatus !== toStatus` and the note interpolates the
 * OBSERVED pair, deliberately NOT the literals `"approved"`/`"draft"`. Hardcoding
 * them here would make this function a third partial copy of the demotion rule that
 * `resolveStatusAfterContractEdit` (`@lore/core`) owns — it would silently stop
 * annotating the write the day that rule's target status changes. For the
 * approved→draft transition the rendered text is byte-identical to the pre-SSOT
 * version ("(demoted approved → draft on edit)").
 */
function buildSetChangeSummary(
  count: number,
  acId: string | undefined,
  fromStatus: DocRecord["status"],
  toStatus: DocRecord["status"],
): string {
  const base = `Acceptance criterion "${acId ?? "?"}" updated — ${count} entries`;
  return fromStatus !== toStatus ? `${base} (demoted ${fromStatus} → ${toStatus} on edit)` : base;
}
