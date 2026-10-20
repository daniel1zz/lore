/**
 * `lore issue` subcommands: `adopt <number>` and `resolve <issue> --state ...`.
 *
 * `lore issue adopt <number> [--json]` —
 * (task-skill-implement-lore-issue-adopt-and-the-label-round-trip, AC-GR-3)
 * turns one LISTED GitHub issue into a claimable corpus task: resolves the
 * consumer's configured `feedback.upstream` (must be GitHub-shaped —
 * `classifyFeedbackUpstream`), reads the live listing
 * (`report-issue-wiring.ts::resolveGithubIssueListing`), finds `<number>`
 * in it, then mints the task via `issue-task-shaping.ts::toIssueTaskInput`
 * (D1's deterministic `task-gh-<repo_id>-<number>` slug). IDEMPOTENT:
 * adopting the SAME issue twice reports the EXISTING task at exit 0
 * (`already_adopted: true` under `--json`) rather than creating a second
 * task or refusing — `CorpusService.create`'s typed `DUPLICATE_SLUG` on
 * that deterministic slug IS the "already adopted" signal, read back via
 * `corpusService.get(createResult.error.existing_id)`, the id of the task
 * that ALREADY holds the slug, never papered over with a silent catch.
 * ⛔ That re-fetch went through the locally re-derived D1 slug until
 * task-skill-implement-duplicate-slug-existing-id-names-the, because both
 * SQL-backed stores reported the REJECTED doc's own id in `existing_id`
 * (measured 2026-08-25). Both now resolve the winner
 * (`store/sqlite-store.ts::findSlugConflictIdSync`,
 * `store/turso-store.ts::findSlugConflictId`), so the workaround is retired
 * and the field is consumed as its name promises; the store-side guarantee
 * is pinned by `AC-1.01`–`AC-1.05` in
 * `tests/unit/store/sqlite-store.bun.test.ts` and this call site's own
 * consumption by `AC-GR-3 STATE (idempotency)` in
 * `tests/integration/cli/github-defect-claim-lifecycle.bun.test.ts`.
 * Refuses loudly (`VALIDATION_ERROR`, exit 4) when
 * `<number>` is not a positive integer, when it names no issue in the live
 * listing, when `feedback.upstream` is unconfigured or retired-shape, or
 * when this corpus has no root PRD to adhoc-parent the new task to (D13,
 * `toIssueTaskInput`'s own precondition) — never a silent no-op and never
 * a task minted anyway.
 *
 * `lore issue resolve <issue> --state rejected|wontfix|superseded|duplicate|adopted
 *   --reason <r> [--superseded-by <doc> | --duplicate-of <doc> | --adopted-by <doc>]
 *   [--json]`
 *
 * The five writable states and their pointer requirements are CONSUMED from
 * `service/issue-resolution.js`'s SSOT (`EXPLICIT_RESOLUTIONS` +
 * `reachOfExplicitResolution`), ⛔ never re-listed here — AC-DC-9 asserts one
 * definition site repo-wide.
 *
 * spec-the-defect-channel-cannot-be-honestly-maintained-an §M3 added the two
 * NON-DEROGATORY TERMINAL states. Each REQUIRES its pointer, and the pointer
 * MUST resolve to an existing doc BEFORE anything is written (AC-DC-4): a
 * `superseded` state with a dangling pointer retires a real defect report while
 * recording nothing a reader could follow, which is operationally the same
 * silent trash can as `rejected` — the defect §M3 fixes, not a milder version
 * of the fix. Both states are members of the shared terminal set and stay
 * visible under `lore issues --resolved`.
 *
 * §M7 added `adopted` — non-terminal (does NOT join
 * `TERMINAL_ISSUE_RESOLUTIONS`; stays visible under `--resolved`'s complement
 * because it has an owner but no verdict yet). Its pointer (`--adopted-by`)
 * carries an ADDITIONAL constraint no other pointer here has: the resolved
 * doc's `type` MUST be `plan` or `task` (checked AFTER existence/self-reference,
 * BEFORE any write — {@link wrongPointerTypeError}) —
 * an owner that cannot itself do work would let `adopted` become a quieter
 * `rejected`, which is the defect §M7 exists to avoid.
 *
 * D3 (spec-issue-closure-loop-computed-resolution-agent-reachable) — the ONLY
 * writer of `extra.issue_report.resolution`. The four TERMINAL explicit states
 * WIN over resolves-edge computation (`computeIssueResolution`'s precedence
 * rule 1 — `../../../service/issue-resolution.js`, landed by P1); `adopted`
 * does NOT — a `resolves` edge landing later still promotes it to
 * `fixed`/`resolving` (that same module's precedence rule 2/4, §M7). `--state
 * fixed` is REJECTED unconditionally, BEFORE any doc lookup: the only path to
 * a `fixed` resolution is a `resolves` edge (`lore link --type resolves
 * <fixer> <issue>`) whose source doc reaches `active`/`archived` (D1/D2).
 * This command never writes `fixed` under any input — there is no branch in
 * this file that can produce that value.
 *
 * Read-modify-write over `CorpusService.get`/`set` — no dedicated service
 * method exists for this narrow write (this task's file anchors did not
 * include a service file; see the task doc's "Added after P1 landed"
 * section). Every OTHER `extra` key on the target task (`adhoc`,
 * `file_anchors`, `claim`, `verification_evidence`, and every sibling
 * `issue_report` field — `reporter_project`, `expected`, `actual`, etc.) is
 * preserved untouched: only `issue_report.resolution` is replaced, mirroring
 * the RMW-merge shape `commands/set.ts`'s `--kind` branch and
 * `TaskWorkflowService`'s anchor mutations both use for the same "`set()`
 * replaces `extra` wholesale" footgun (`corpus-service.ts`'s own
 * `findDroppedStructuredExtraField` guard documents the incident this
 * pattern avoids).
 *
 * `resolve`'s exit codes: 0 success; 3 DOC_NOT_FOUND (unknown --issue); 4
 * VALIDATION_ERROR (`--state fixed`, an unrecognized --state value, empty/
 * missing --reason, a target lacking `extra.issue_report`, a REQUIRED pointer
 * that is missing / unresolvable / self-referential / wrong-typed (`adopted`
 * only), or a pointer flag passed for a state that takes none — an
 * unresolvable pointer is re-typed from DOC_NOT_FOUND so every pointer
 * refusal shares one exit code, see {@link unresolvablePointerError}); 5
 * STALE_VERSION (concurrent write race on the target task); a NONZERO code
 * distinct from all of the above ONLY when the corpus write above already
 * succeeded but the post-write `ResolutionProjector.project` call failed
 * (network/auth/rate-limit) — the corpus verdict is never discarded for
 * this, only the GitHub label update, and the underlying `LoreError`'s own
 * `exitCode()` mapping is echoed unchanged (see the `resolutionProjector`
 * block at the end of `run()`).
 *
 * `adopt`'s exit codes: 0 success, INCLUDING the idempotent "already
 * adopted" case (never a distinct code — the caller must read
 * `already_adopted` under `--json`, or the "Already adopted" vs "Adopted"
 * prefix in the human render, to tell the two apart); 4 VALIDATION_ERROR
 * for every refusal this command builds itself ({@link
 * invalidIssueNumberError}, {@link issueNotListedError}, {@link
 * noRootPrdError}) plus `buildUnconfiguredUpstreamRemedy()` (`@lore/core`)
 * and `classifyFeedbackUpstream`'s retired-shape error (both shared with
 * `report-issue.ts`/`issues.ts`, never re-worded here) and any
 * `VALIDATION_ERROR` `toIssueTaskInput` itself returns; any OTHER code is
 * whatever `resolveGithubIssueListing` or `corpusService.create` returned,
 * echoed via `exitCode()` unchanged — this subcommand introduces no new
 * `LoreError` variant.
 *
 * spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope
 * "ResolutionProjector" — ratifying a verdict here is exactly when the
 * `resolution:<state>` label is re-projected, via `app.resolutionProjector`
 * (the `App` composition root's own DI seam, never a projector constructed
 * inline in this file). Write-only: this command never reads a label back
 * as truth (Per-Field Authority table) — that is the separate AC-GI-5 drift
 * detector's job.
 *
 * D9 (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam) — the
 * live `gh api` call `ResolutionProjector.project` triggers targets, in
 * order of preference, the CONFIGURED repo
 * (`classifyFeedbackUpstream(config)`'s `cfg.repo`, when `.kind ===
 * "github"`), FALLING BACK to the STORED
 * `readGithubIssueRef(updated.extra).repo` when the current config does
 * not classify as GitHub-shaped (unconfigured, retired, or absent). The
 * stored string is this task's PROVENANCE (which repo it was
 * filed/adopted against at the time) and goes stale after a repository
 * rename, which is why the configured repo wins WHEN AVAILABLE — but the
 * config's shape today says nothing about whether THIS task should still
 * project, so it is never treated as a joint requirement alongside
 * `storedGithubRef`. The `run()` body below builds the live
 * `GithubIssueRef` by substituting `repo` alone (never `repo_id` —
 * `GhResolutionLabelPort.setLabel`'s `issueLabelsPath` never reads that
 * field, only `.repo`/`.issueNumber`) onto the STORED ref. The
 * `.project()` call is skipped ENTIRELY — never a refusal, the corpus
 * verdict already landed — in exactly one case: `readGithubIssueRef`
 * returns `undefined` (this task never carried a GitHub pointer), the same
 * "nothing to project" degrade this file already applies when no
 * projector is wired. A non-GitHub-shaped config alone never skips
 * projection for a task that DOES carry a stored ref.
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D3,
 *   AC-ICL-3, AC-ICL-4;
 *   spec-the-defect-channel-cannot-be-honestly-maintained-an §M3, AC-DC-4;
 *   §M7, AC-DC-15;
 *   spec-the-defect-channel-reaches-no-machine-but-its-own-github, AC-GI-4.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import {
  hasIssueReport,
  computeIssueResolution,
  checkResolutionPointer,
  EXPLICIT_RESOLUTIONS,
  reachOfExplicitResolution,
  type ExplicitResolution,
} from "../../../service/issue-resolution.js";
import { readGithubIssueRef, type GithubIssueRef } from "../../../service/resolution-projector.js";
// `githubIssueTaskSlug` is deliberately NOT imported here: `toIssueTaskInput`
// applies it internally (`service/issue-task-shaping.ts:231`), and the adopt
// path no longer needs the slug locally now that `DUPLICATE_SLUG.existing_id`
// names the winner (see the DUPLICATE_SLUG branch in `run()`).
import { toIssueTaskInput } from "../../../service/issue-task-shaping.js";
import { classifyFeedbackUpstream, resolveGithubIssueListing } from "../report-issue-wiring.js";
import { invocationOf } from "../command-invocation.js";
import { buildUnconfiguredUpstreamRemedy, type LoreError } from "@lore/core";
import { printLine } from "../output.js";

/**
 * The states this command may persist — CONSUMED from
 * `service/issue-resolution.js`'s SSOT, ⛔ never re-listed here
 * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M1/§M3/§M7,
 * AC-DC-9). `"fixed"`/`"closed"` are structurally absent from that subset
 * because their declared route is not `issue-resolve`; see
 * {@link fixedNotSettableError}.
 */
const VALID_STATE_LIST = [...EXPLICIT_RESOLUTIONS].join(", ");

/** True iff `value` is a state `lore issue resolve` may write. */
function isExplicitResolutionState(value: string): value is ExplicitResolution {
  return (EXPLICIT_RESOLUTIONS as ReadonlySet<string>).has(value);
}

/** One `--state`-to-pointer-flag binding, derived from the reach table's declared pointer requirement. */
interface PointerFlagBinding {
  readonly state: ExplicitResolution;
  /** The user-facing flag, e.g. `--superseded-by`. */
  readonly flag: string;
  /** The citty args key (the flag minus its leading dashes). */
  readonly argName: string;
  /** Where the resolved doc id is persisted inside `extra.issue_report.resolution`. */
  readonly extraKey: string;
  /** Noun phrase for what the pointer must name — read from the SSOT, never re-worded per refusal. */
  readonly names: string;
  /** When present, the resolved pointer doc's `type` MUST be one of these (§M7's `adopted` only). */
  readonly allowedDocTypes?: readonly string[];
}

/**
 * Every state that REQUIRES a pointer, derived from
 * `reachOfExplicitResolution` — so adding a fourth pointer-carrying state needs
 * no edit here beyond the `args` declaration below.
 *
 * ⛔ Coupling worth knowing about: citty needs its flags declared STATICALLY in
 * `args`, so the flag names appear literally there as well. They cannot
 * drift SILENTLY — a flag present in the table but missing from `args` makes the
 * required pointer unsuppliable, i.e. every attempt at that state fails loud,
 * and `tests/integration/cli/issue-resolve-pointer-required.bun.test.ts` drives
 * both flags end-to-end.
 */
const POINTER_FLAG_BINDINGS: readonly PointerFlagBinding[] = [...EXPLICIT_RESOLUTIONS].flatMap((state) => {
  const pointer = reachOfExplicitResolution(state).pointer;
  if (pointer === null) return [];
  return [
    {
      state,
      flag: pointer.flag,
      argName: pointer.flag.replace(/^-+/, ""),
      extraKey: pointer.extra_key,
      names: pointer.names,
      // reason: `exactOptionalPropertyTypes` distinguishes "key absent" from
      // "key present with value undefined" — spreading only when defined keeps
      // an M3 pointer's binding with NO `allowedDocTypes` key at all, matching
      // the interface's own "optional means absent, never present-undefined"
      // contract used everywhere else in this codebase.
      ...(pointer.allowed_doc_types !== undefined ? { allowedDocTypes: pointer.allowed_doc_types } : {}),
    },
  ];
});

/** Trimmed string value of a citty arg, or `""` when absent/not a string. */
function readStringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * `code` plus `message` when the variant carries one — only 4 of the 16
 * `LoreError` variants do. Same name and shape as
 * `service/issue-report-service.ts::describeLoreErrorWithCode`; both quote a
 * failure's CLASSIFICATION into a refusal a caller has to act on.
 */
function describeLoreErrorWithCode(error: LoreError): string {
  return "message" in error ? `${error.code}: ${error.message}` : error.code;
}

/**
 * AC-ICL-3 — the unconditional `--state fixed` rejection. Names `lore link`
 * and `resolves` verbatim so a caller can copy-paste the real fix; checked in
 * `run()` BEFORE any app load or doc resolution, so it fires even when
 * `<issue>` does not exist or is not a task at all — "fixed" is never a
 * writable value here, full stop.
 */
function fixedNotSettableError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "state",
    message:
      "'fixed' is a COMPUTED resolution, never hand-set. The only path to 'fixed' is " +
      "`lore link --type resolves <fixer-doc> <issue>` (once the fixer doc reaches " +
      "active/archived). Use --state rejected or --state wontfix here instead.",
    value: "fixed",
    rule: "BR-527",
  };
}

/** Any `--state` value that is neither a legal explicit state nor the specially-handled `"fixed"`. */
function invalidStateError(value: string | undefined): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "state",
    message:
      `Invalid --state '${value ?? ""}'. Valid values: ${VALID_STATE_LIST} ` +
      "('fixed' is computed via `lore link --type resolves`, never passed here).",
    value,
    rule: "BR-527",
  };
}

/** `--reason` is required and must be non-empty when writing an explicit terminal state. */
function missingReasonError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "reason",
    message: `--reason is required (non-empty) when resolving an issue as ${VALID_STATE_LIST}.`,
    rule: "BR-528",
  };
}

/**
 * §M3 — a NON-DEROGATORY terminal state was requested with no pointer. Refused
 * BEFORE the app is even loaded, so nothing is written: without the pointer the
 * state would carry no more information than `rejected`, which is the defect
 * §M3 exists to fix rather than a milder form of the fix.
 */
function missingPointerError(binding: PointerFlagBinding): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `--state ${binding.state} REQUIRES ${binding.flag} <doc>, naming ${binding.names} — ` +
      "without it the state records nothing a reader could act on, and is indistinguishable " +
      "from --state rejected. Pass an existing doc id or slug.",
    rule: "BR-529",
  };
}

/** A pointer flag was supplied for a state that takes no pointer — a contradiction, never silently dropped. */
function pointerForWrongStateError(binding: PointerFlagBinding, state: ExplicitResolution): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `${binding.flag} is only valid with --state ${binding.state}, but --state ${state} was requested. ` +
      "Drop the flag, or resolve with the state it belongs to.",
    value: state,
    rule: "BR-529",
  };
}

/**
 * The pointer named a doc that does not resolve. Deliberately re-typed to
 * `VALIDATION_ERROR` (exit 4) rather than propagating the underlying
 * `DOC_NOT_FOUND` (exit 3): the fact being reported is "this FLAG's value is
 * invalid", not "the document you asked to read is missing" — and AC-DC-4 pins
 * the exit code so a caller's error handling can treat every pointer refusal
 * identically. The underlying failure is quoted, never swallowed.
 */
function unresolvablePointerError(binding: PointerFlagBinding, value: string, cause: LoreError): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `${binding.flag} '${value}' does not resolve to an existing doc in this corpus ` +
      `(${describeLoreErrorWithCode(cause)}) — nothing was written. A ${binding.state} resolution must ` +
      `name ${binding.names}, otherwise it is a silent trash can.`,
    value,
    rule: "BR-529",
  };
}

/**
 * §M7 — the pointer resolved to a REAL doc (existence and self-reference both
 * already passed), but its `type` is not one of `binding.allowedDocTypes`.
 * `adopted` is the only state that declares this constraint (M3's
 * `superseded`/`duplicate` pointers accept any doc): an owner that is not
 * itself a `plan` or `task` cannot do the work the adoption claims will
 * happen, which is the "constrained party must not control the ceiling"
 * failure §M2/§M6 already record, applied to WHO may claim ownership by adopting.
 * ⛔ The original wording tied this constraint to the retired open-report ceiling,
 * which SPEC-145 deleted; the surviving reason is that a non-plan/task owner cannot
 * do the work an adoption claims will happen.
 */
function wrongPointerTypeError(
  binding: PointerFlagBinding,
  pointerDoc: { slug: string; type: string },
  allowedDocTypes: readonly string[],
): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `${binding.flag} '${pointerDoc.slug}' resolves to a doc of type '${pointerDoc.type}', but --state ` +
      `${binding.state} requires one of: ${allowedDocTypes.join(", ")} — naming ${binding.names}. Without a ` +
      "live plan or task as owner, adoption would name an owner that cannot do the work it claims.",
    value: pointerDoc.slug,
    rule: "BR-529",
  };
}

/** A report pointing at ITSELF carries no information — the same emptiness the required pointer exists to prevent. */
function selfPointerError(binding: PointerFlagBinding, slug: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `${binding.flag} points at the report being resolved ('${slug}') — it must name ` +
      `${binding.names}, which cannot be the report itself.`,
    value: slug,
    rule: "BR-529",
  };
}

/** The target resolved fine but does not carry `extra.issue_report` — not an issue task. */
function notAnIssueError(slug: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "issue",
    message:
      `Document "${slug}" does not carry extra.issue_report — only a filed issue report ` +
      "(created via the upstream `lore report-issue` consumer flow) can be resolved.",
    value: slug,
    rule: "BR-531",
  };
}

// ─── `adopt <number>` (task-skill-implement-lore-issue-adopt-and-the-label-round-trip, AC-GR-3) ───

/** `<number>` did not parse as a positive integer — the ONLY shape a GitHub issue number can take. */
function invalidIssueNumberError(raw: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "number",
    message:
      `'${raw}' is not a valid GitHub issue number (a positive integer) — pass the number ` +
      "'lore issues' printed.",
    value: raw,
    rule: "BR-520",
  };
}

/**
 * `<number>` resolved to no entry in the live GitHub listing — refused
 * loudly rather than silently ignored or adopted-anyway (this task's own
 * "refuse loudly" requirement). Deliberately `VALIDATION_ERROR` (exit 4),
 * not `DOC_NOT_FOUND` (exit 3): `DOC_NOT_FOUND`'s render
 * (`formatError`, `utils.ts`) says "Run \`lore list\` to see available
 * documents", which is actively misleading for a GitHub issue number — this
 * command's own message points at 'lore issues' instead.
 */
function issueNotListedError(issueNumber: number, repo: string, listedCount: number): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "number",
    message:
      `GitHub issue #${issueNumber} was not found in ${repo}'s live listing (${listedCount} issue(s) ` +
      "currently listed) — run 'lore issues' to see what is adoptable, or check the number.",
    value: issueNumber,
    rule: "BR-522",
  };
}

/**
 * This corpus has no root PRD — `toIssueTaskInput` (D13) requires one to
 * adhoc-parent the adopted task to, and this module is store-free so it
 * cannot discover one itself. Mirrors `report-issue-wiring.ts`'s own
 * identically-worded `resolveLocalRootPrd` refusal for `fileGithubIssue`
 * (that function is unexported — this is an independent, ADOPT-scoped
 * copy of the same fact, not a shared import).
 */
function noRootPrdError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "rootPrdId",
    message:
      "this corpus has no root PRD at all — an adopted task (D13) has nothing to be adhoc-parented " +
      "to. Create one (`lore create prd`) first.",
    rule: "BR-524",
  };
}

export default defineLoreCommand({
  meta: {
    name: "issue",
    description: "Manage filed issue reports (adopt, resolve)",
  },
  subCommands: {
    adopt: defineLoreCommand({
      meta: {
        name: "adopt",
        description:
          "Mint a claimable corpus task for one listed GitHub issue (idempotent: re-adopting reports the existing task, exit 0)",
      },
      args: {
        number: {
          type: "positional",
          description: "GitHub issue number to adopt, as printed by `lore issues`",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const inv = invocationOf(context);
        const { args } = context;
        const rawNumber = readStringArg(args as unknown as Record<string, unknown>, "number");
        const issueNumber = Number(rawNumber);
        if (rawNumber.length === 0 || !Number.isInteger(issueNumber) || issueNumber <= 0) {
          const error = invalidIssueNumberError(rawNumber);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }

        const { app, config } = loadLoreApp({ inv });
        try {
          // ONE shared shape-policy classifier (report-issue-wiring.ts's own
          // header) — never a second, independently-derived verdict on
          // whether `feedback.upstream` is adoptable from here.
          const classification = classifyFeedbackUpstream(config);
          if (classification.kind === "unconfigured") {
            const error = buildUnconfiguredUpstreamRemedy();
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }
          if (classification.kind === "retired") {
            inv.io.stderr.write(formatErrorFor(inv, classification.error) + "\n");
            return exitCode(classification.error);
          }
          const cfg = classification.cfg;

          const listingResult = await resolveGithubIssueListing(inv.io, cfg, invocationOf(context));
          if (!listingResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, listingResult.error) + "\n");
            return exitCode(listingResult.error);
          }
          const { issues, repoId } = listingResult.value;

          const issue = issues.find((candidate) => candidate.number === issueNumber);
          if (issue === undefined) {
            const error = issueNotListedError(issueNumber, cfg.repo, issues.length);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }

          // D13 precondition (toIssueTaskInput's own doc) — this module is
          // store-free, so the "first PRD" lookup happens here, mirroring
          // `report-issue-wiring.ts::resolveLocalRootPrd`'s identical shape.
          const rootPrdListResult = await app.corpusService.list({ type: "prd" });
          if (!rootPrdListResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, rootPrdListResult.error) + "\n");
            return exitCode(rootPrdListResult.error);
          }
          const rootPrd = rootPrdListResult.value.docs[0];
          if (rootPrd === undefined) {
            const error = noRootPrdError();
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }

          const ref: GithubIssueRef = { repo: cfg.repo, issueNumber, repo_id: repoId };
          const taskInputResult = toIssueTaskInput(issue, ref, rootPrd.id);
          if (!taskInputResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, taskInputResult.error) + "\n");
            return exitCode(taskInputResult.error);
          }

          const by = resolveActor(inv);
          const createResult = await app.corpusService.create(taskInputResult.value, { by });

          if (!createResult.ok) {
            // Idempotency decision (this task's own header): adopting the
            // SAME issue twice must be VISIBLY idempotent, never a second
            // task and never a silently-swallowed error. D1's deterministic
            // slug makes `DUPLICATE_SLUG` exactly the "already adopted"
            // signal — read the existing task back and report it at exit
            // 0, distinguished from a fresh adopt only by the
            // `already_adopted` flag / "Already adopted" prefix, never by
            // exit code.
            //
            // reason: re-fetch by `createResult.error.existing_id` — the id
            // of the task that already holds the colliding slug, which is
            // what that field names. ⛔ This call site used to re-derive the
            // D1 slug instead, because both SQL-backed stores reported the
            // REJECTED doc's own never-persisted id there and every
            // `get(existing_id)` answered DOC_NOT_FOUND (measured
            // 2026-08-25). That defect is FIXED, not sidestepped:
            // `store/sqlite-store.ts::findSlugConflictIdSync` and
            // `store/turso-store.ts::findSlugConflictId` now resolve the
            // winner, and `AC-1.01`–`AC-1.05` in
            // `tests/unit/store/sqlite-store.bun.test.ts` assert the id
            // RESOLVES (not merely that it is id-shaped) for all four
            // SQLite insert entry points. The workaround is therefore
            // retired here rather than left standing as an expired
            // assertion — `githubIssueTaskSlug` is still the slug `create`
            // was called WITH (via `toIssueTaskInput`), it is just no longer
            // needed to read the winner back.
            if (createResult.error.code === "DUPLICATE_SLUG") {
              const existingResult = await app.corpusService.get(createResult.error.existing_id);
              if (!existingResult.ok) {
                inv.io.stderr.write(formatErrorFor(inv, existingResult.error) + "\n");
                return exitCode(existingResult.error);
              }
              const existing = existingResult.value.doc;
              if (args.json) {
                printLine(inv.io.stdout, 
                  JSON.stringify({ ok: true, data: { doc: existing, already_adopted: true } }, null, 2),
                );
              } else {
                printLine(inv.io.stdout, 
                  `Already adopted GitHub issue #${issueNumber} as ${existing.slug} (adopted previously).`,
                );
              }
              return 0;
            }

            inv.io.stderr.write(formatErrorFor(inv, createResult.error) + "\n");
            return exitCode(createResult.error);
          }

          const created = createResult.value;
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { doc: created, already_adopted: false } }, null, 2));
          } else {
            printLine(inv.io.stdout, `Adopted GitHub issue #${issueNumber} as ${created.slug}.`);
          }
        } finally {
          app.close();
        }
        return 0;
      },
    }),
    resolve: defineLoreCommand({
      meta: {
        name: "resolve",
        description:
          "Record an explicit resolution (rejected/wontfix/superseded/duplicate/adopted) on a filed issue report",
      },
      args: {
        issue: {
          type: "positional",
          description: "Issue task document ID or slug",
          required: true,
        },
        state: {
          type: "string",
          description: `Explicit resolution: ${[...EXPLICIT_RESOLUTIONS].join(" | ")} ('fixed'/'closed' are computed, never accepted here)`,
        },
        reason: {
          type: "string",
          description: "Human-readable reason (required, non-empty)",
        },
        // reason: citty resolves flags from a STATIC args map, so these three
        // names are declared literally even though their requiredness,
        // storage key and error messages all derive from
        // `POINTER_FLAG_BINDINGS`. See that const's own comment.
        "superseded-by": {
          type: "string",
          description: "REQUIRED with --state superseded: the doc (id or slug) that supersedes this report",
        },
        "duplicate-of": {
          type: "string",
          description: "REQUIRED with --state duplicate: the doc (id or slug) this report duplicates",
        },
        "adopted-by": {
          type: "string",
          description:
            "REQUIRED with --state adopted: the LIVE plan or task (id or slug) that now owns this claim",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const state = typeof args.state === "string" ? args.state : undefined;

        // AC-ICL-3 — checked BEFORE loadLoreApp()/any doc resolution: writes
        // NOTHING, regardless of whether <issue> even exists.
        if (state === "fixed") {
          const error = fixedNotSettableError();
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }

        if (state === undefined || !isExplicitResolutionState(state)) {
          const error = invalidStateError(state);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }

        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (reason.length === 0) {
          const error = missingReasonError();
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }

        // §M3 pointer contract, checked BEFORE loadLoreApp() — both halves are
        // pure argv arithmetic, so a refusal here provably writes zero bytes.
        const argRecord = args as unknown as Record<string, unknown>;
        const strayPointer = POINTER_FLAG_BINDINGS.find(
          (binding) => binding.state !== state && readStringArg(argRecord, binding.argName).length > 0,
        );
        if (strayPointer !== undefined) {
          const error = pointerForWrongStateError(strayPointer, state);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }

        const requiredPointer = POINTER_FLAG_BINDINGS.find((binding) => binding.state === state);
        const pointerValue = requiredPointer === undefined ? "" : readStringArg(argRecord, requiredPointer.argName);
        if (requiredPointer !== undefined && pointerValue.length === 0) {
          const error = missingPointerError(requiredPointer);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }

        const { app, config } = loadLoreApp({ inv });
        try {
          const issueId = args.issue as string;
          const getResult = await app.corpusService.get(issueId);
          if (!getResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, getResult.error) + "\n");
            return exitCode(getResult.error);
          }
          const issueDoc = getResult.value.doc;

          if (!hasIssueReport(issueDoc.extra)) {
            const error = notAnIssueError(issueDoc.slug);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }

          // §M3/§M7 — resolve the REQUIRED pointer against the live corpus
          // BEFORE any write, then hand the OUTCOME to `checkResolutionPointer`
          // — the ONE decision (`service/issue-resolution.js`, AC-DC-15) every
          // pointer-carrying state's refusal goes through, never a second
          // CLI-local re-implementation of the same rules. A pointer that
          // names nothing (or the wrong thing) would make `superseded`/
          // `adopted` indistinguishable from a silent trash can, so every
          // refusal here must happen while zero bytes have been written.
          let resolvedPointer: Record<string, string> = {};
          if (requiredPointer !== undefined) {
            const pointerResult = await app.corpusService.get(pointerValue);
            const resolvedTarget = pointerResult.ok
              ? { id: pointerResult.value.doc.id, type: pointerResult.value.doc.type }
              : undefined;
            const pointerSpec = {
              flag: requiredPointer.flag,
              extra_key: requiredPointer.extraKey,
              names: requiredPointer.names,
              ...(requiredPointer.allowedDocTypes !== undefined
                ? { allowed_doc_types: requiredPointer.allowedDocTypes }
                : {}),
            };
            const verdict = checkResolutionPointer(pointerSpec, pointerValue, resolvedTarget, issueDoc.id);

            if (!verdict.ok) {
              let error: LoreError;
              if (verdict.reason === "unresolvable" && !pointerResult.ok) {
                error = unresolvablePointerError(requiredPointer, pointerValue, pointerResult.error);
              } else if (verdict.reason === "self-reference") {
                error = selfPointerError(requiredPointer, issueDoc.slug);
              } else if (verdict.reason === "wrong-type" && pointerResult.ok) {
                error = wrongPointerTypeError(
                  requiredPointer,
                  pointerResult.value.doc,
                  requiredPointer.allowedDocTypes ?? [],
                );
              } else {
                // reason: "missing" is already refused earlier (argv-only,
                // before loadLoreApp) and can never reach this point with a
                // non-empty pointerValue; kept as a defensive, fail-loud
                // catch-all rather than a silent fallthrough — a genuine
                // reason/lookup mismatch here is a bug in this wiring, not a
                // caller input to accept quietly.
                error = missingPointerError(requiredPointer);
              }
              inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
              return exitCode(error);
            }

            // reason: `verdict.ok` guarantees `resolvedTarget !== undefined`,
            // which is only ever set from a successful lookup — so
            // `pointerResult.ok` here is guaranteed, not merely assumed.
            if (!pointerResult.ok) {
              throw new Error("unreachable: checkResolutionPointer accepted an unresolved pointer");
            }
            const pointerDoc = pointerResult.value.doc;
            // reason: the RESOLVED id is persisted, never the id-or-slug the
            // caller typed — a slug is editable (`CorpusService.set` accepts a
            // slug patch), so storing one would let a rename silently dangle
            // the pointer this state's whole meaning rests on.
            resolvedPointer = { [requiredPointer.extraKey]: pointerDoc.id };
          }

          const by = resolveActor(inv);
          const nowIso = new Date().toISOString();
          const existingIssueReport = issueDoc.extra["issue_report"] as Record<string, unknown>;
          // reason: RMW merge — spread the FULL existing extra first so every
          // sibling key (claim/verification_evidence/file_anchors/adhoc, and
          // every OTHER issue_report field) survives; only issue_report.resolution
          // is replaced. CorpusService.set()'s docPatch.extra REPLACES extra
          // wholesale (no service-side merge), so this merge must happen here.
          const newExtra: Record<string, unknown> = {
            ...issueDoc.extra,
            issue_report: {
              ...existingIssueReport,
              // reason: `resolution` is REPLACED wholesale (never merged into the
              // previous one) so re-resolving from `superseded` to `duplicate`
              // cannot leave a stale `superseded_by` beside the new state — a
              // lingering pointer would assert a supersession that no longer holds.
              resolution: { state, reason, resolved_at: nowIso, resolved_by: by, ...resolvedPointer },
            },
          };

          const setResult = await app.corpusService.set(issueId, { extra: newExtra }, { by });
          if (!setResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, setResult.error) + "\n");
            return exitCode(setResult.error);
          }

          const updated = setResult.value;

          // reason: demonstrates D2's precedence rule end-to-end using the SAME
          // navigation.related data get() already fetched above — no second
          // store round trip. For the four TERMINAL explicit states this is the
          // explicit write winning over any resolves-edge computation; for §M7's
          // `adopted` a PRE-EXISTING resolves edge (present before this command
          // ran) still outranks it, per that module's own precedence — this call
          // reports whichever of the two is actually true, never assumes the
          // write we just made is what wins. `related` mixes in/out non-parent links
          // without exposing direction; a `resolves`-typed entry on an issue
          // task is, in every write-time-validated shape (D1b), an INBOUND edge
          // from a fixer doc, so treating each match's `id`/`status` as a
          // resolvesInEdges/sourceDocs pair is correct for every reachable
          // corpus state (an issue task cannot itself be the "from" side of a
          // resolves edge unless ITS target also carries extra.issue_report —
          // a degenerate chain this command does not need to special-case).
          const resolvesInEdges = getResult.value.navigation.related.filter(
            (r) => r.link_type === "resolves",
          );
          const computed = computeIssueResolution(
            updated,
            resolvesInEdges.map((r) => ({ from_id: r.id })),
            resolvesInEdges.map((r) => ({ id: r.id, status: r.status })),
          );

          if (args.json) {
            printLine(inv.io.stdout, 
              JSON.stringify({ ok: true, data: { doc: updated, resolution: computed } }, null, 2),
            );
          } else {
            const pointerNote =
              requiredPointer === undefined ? "" : ` ${requiredPointer.flag} ${resolvedPointer[requiredPointer.extraKey]}`;
            printLine(inv.io.stdout, 
              `Resolved ${updated.slug} as '${state}'${pointerNote} (${reason}) — resolution: ${computed}`,
            );
          }

          // spec-the-defect-channel-reaches-no-machine-but-its-own-github,
          // Scope "ResolutionProjector" + AC-GI-4 — the moment a verdict is
          // ratified (the write above just landed) is exactly when the label
          // should be re-projected. `app.resolutionProjector` is the ONLY
          // production seam this file calls through — never a `new
          // ResolutionProjector(...)` constructed inline here, which would
          // make this call site untestable from the app-level DI every other
          // command uses. Absent (no port wired yet) or no GitHub pointer on
          // this issue (never filed through the GitHub intake path) both
          // degrade to "nothing to project" — never a refusal, since the
          // corpus verdict above already landed regardless.
          const storedGithubRef = readGithubIssueRef(updated.extra);
          // D9 (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam)
          // — the LIVE `gh api` target PREFERS the CONFIGURED repo over the
          // STORED one: `storedGithubRef.repo` is this task's PROVENANCE
          // (which repo it was filed/adopted against AT THE TIME), and a
          // repository rename leaves that string stale while
          // `.lore/config.yaml`'s `feedback.upstream.repo` is the operator's
          // current pointer. `classifyFeedbackUpstream` is the SAME shared
          // classifier `adopt`/`report-issue`/`issues` use — no second,
          // independently-derived read of `feedback.upstream` here.
          //
          // "Prefer" is not "require": when the CURRENT config does not
          // classify as GitHub-shaped (`kind !== "github"` — unconfigured,
          // retired, or absent), that says nothing about whether THIS task
          // was ever filed through GitHub; `storedGithubRef` is the
          // independent, authoritative answer to that question. Falling
          // through to `undefined` here — as a pre-D9 revert of this file
          // would — is the exact silent-no-op this project bans: a task
          // that legitimately carries a GitHub pointer would stop
          // projecting for a reason (today's config shape) that has
          // nothing to do with whether it should project. So `liveRepo`
          // is a PREFERENCE, and `storedGithubRef.repo` is the fallback —
          // never a joint requirement with `liveRepo`.
          const upstreamClassification = classifyFeedbackUpstream(config);
          const liveRepo =
            upstreamClassification.kind === "github" ? upstreamClassification.cfg.repo : undefined;
          // reason: `repo_id` is carried over UNCHANGED from the stored ref
          // (never re-derived here) — `GhResolutionLabelPort.setLabel`'s
          // `issueLabelsPath`/`issueLabelPath` read only `.repo`/
          // `.issueNumber`, never `.repo_id`, so substituting just `repo`
          // is the entire fix; a stale `repo_id` in provenance is a
          // separate, D5-scoped concern this call site does not touch.
          // `githubRef` is `undefined` in EXACTLY one case: no stored ref at
          // all (this task never carried a GitHub pointer) — the
          // legitimate "nothing to project" this file already documents for
          // an absent projector. A stored ref ALWAYS yields a `githubRef`:
          // `liveRepo` when the config is GitHub-shaped, `storedGithubRef.repo`
          // (the fallback) otherwise.
          const githubRef: GithubIssueRef | undefined =
            storedGithubRef !== undefined
              ? { ...storedGithubRef, repo: liveRepo ?? storedGithubRef.repo }
              : undefined;
          if (app.resolutionProjector !== undefined && githubRef !== undefined) {
            const projectResult = await app.resolutionProjector.project(computed, githubRef);
            if (!projectResult.ok) {
              // Invariant "Scope-Alt" — projection may be best-effort on a
              // network failure PROVIDED the corpus verdict still lands (it
              // already did, above) and the failure is reported loudly,
              // never swallowed: nonzero exit, distinct from the clean
              // happy-path exit above, and the underlying reason on stderr.
              inv.io.stderr.write(
                `Warning: resolution recorded in the corpus, but the GitHub label was not updated — ` +
                  `${formatErrorFor(inv, projectResult.error)}\n`,
              );
              return exitCode(projectResult.error);
            }
          }
        } finally {
          app.close();
        }
        return 0;
      },
    }),
  },
});
