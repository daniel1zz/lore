/**
 * `lore issue` subcommands: `adopt <number>` and `resolve <issue> --state ...`.
 *
 * `lore issue adopt <number> [--by <actor>] [--json]` —
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
 * `corpusService.get(derivedSlug)` — the SAME D1 slug this call site
 * already computed before calling `create`, NEVER
 * `error.existing_id` (MEASURED 2026-08-25: `SqliteStore`/`TursoStore`'s
 * `DUPLICATE_SLUG` branch returns the NEW, never-persisted doc's own id
 * there, not the pre-existing doc's — see the `run()` body's own comment
 * at the `DUPLICATE_SLUG` check for the full finding), never papered over
 * with a silent catch. Refuses loudly (`VALIDATION_ERROR`, exit 4) when
 * `<number>` is not a positive integer, when it names no issue in the live
 * listing, when `feedback.upstream` is unconfigured or retired-shape, or
 * when this corpus has no root PRD to adhoc-parent the new task to (D13,
 * `toIssueTaskInput`'s own precondition) — never a silent no-op and never
 * a task minted anyway.
 *
 * `lore issue resolve <issue> --state rejected|wontfix|superseded|duplicate|adopted
 *   --reason <r> [--superseded-by <doc> | --duplicate-of <doc> | --adopted-by <doc>]
 *   [--by <actor>] [--json]`
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
 * live `gh api` call `ResolutionProjector.project` triggers MUST target the
 * CONFIGURED repo (`classifyFeedbackUpstream(config)`'s `cfg.repo`), NEVER
 * the STORED `readGithubIssueRef(updated.extra).repo`: the stored string is
 * this task's PROVENANCE (which repo it was filed/adopted against at the
 * time), and a repository rename leaves it stale while `.lore/config.yaml`
 * is the operator's up-to-date pointer. The `run()` body below therefore
 * builds the live `GithubIssueRef` by substituting `repo` alone (never
 * `repo_id` — `GhResolutionLabelPort.setLabel`'s `issueLabelsPath` never
 * reads that field, only `.repo`/`.issueNumber`) onto the STORED ref, and
 * skips the `.project()` call entirely — never a refusal, the corpus
 * verdict already landed — when `feedback.upstream` no longer classifies as
 * GitHub-shaped at all (unconfigured or retired), the same "nothing to
 * project" degrade this file already applies when no projector is wired or
 * no GitHub pointer exists on the task.
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D3,
 *   AC-ICL-3, AC-ICL-4;
 *   spec-the-defect-channel-cannot-be-honestly-maintained-an §M3, AC-DC-4;
 *   §M7, AC-DC-15;
 *   spec-the-defect-channel-reaches-no-machine-but-its-own-github, AC-GI-4.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import {
  hasIssueReport,
  computeIssueResolution,
  checkResolutionPointer,
  EXPLICIT_RESOLUTIONS,
  reachOfExplicitResolution,
  type ExplicitResolution,
} from "../../../service/issue-resolution.js";
import { readGithubIssueRef, type GithubIssueRef } from "../../../service/resolution-projector.js";
import { githubIssueTaskSlug, toIssueTaskInput } from "../../../service/issue-task-shaping.js";
import { classifyFeedbackUpstream, resolveGithubIssueListing } from "../report-issue-wiring.js";
import { buildUnconfiguredUpstreamRemedy, type LoreError } from "@lore/core";

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
  };
}

/** `--reason` is required and must be non-empty when writing an explicit terminal state. */
function missingReasonError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "reason",
    message: `--reason is required (non-empty) when resolving an issue as ${VALID_STATE_LIST}.`,
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
  };
}

export default defineCommand({
  meta: {
    name: "issue",
    description: "Manage filed issue reports (adopt, resolve)",
  },
  subCommands: {
    adopt: defineCommand({
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
        by: {
          type: "string",
          description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const rawNumber = readStringArg(args as unknown as Record<string, unknown>, "number");
        const issueNumber = Number(rawNumber);
        if (rawNumber.length === 0 || !Number.isInteger(issueNumber) || issueNumber <= 0) {
          const error = invalidIssueNumberError(rawNumber);
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          // ONE shared shape-policy classifier (report-issue-wiring.ts's own
          // header) — never a second, independently-derived verdict on
          // whether `feedback.upstream` is adoptable from here.
          const classification = classifyFeedbackUpstream(config);
          if (classification.kind === "unconfigured") {
            const error = buildUnconfiguredUpstreamRemedy();
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
            return;
          }
          if (classification.kind === "retired") {
            process.stderr.write(formatError(classification.error) + "\n");
            process.exitCode = exitCode(classification.error);
            return;
          }
          const cfg = classification.cfg;

          const listingResult = await resolveGithubIssueListing(cfg);
          if (!listingResult.ok) {
            process.stderr.write(formatError(listingResult.error) + "\n");
            process.exitCode = exitCode(listingResult.error);
            return;
          }
          const { issues, repoId } = listingResult.value;

          const issue = issues.find((candidate) => candidate.number === issueNumber);
          if (issue === undefined) {
            const error = issueNotListedError(issueNumber, cfg.repo, issues.length);
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
            return;
          }

          // D13 precondition (toIssueTaskInput's own doc) — this module is
          // store-free, so the "first PRD" lookup happens here, mirroring
          // `report-issue-wiring.ts::resolveLocalRootPrd`'s identical shape.
          const rootPrdListResult = await app.corpusService.list({ type: "prd" });
          if (!rootPrdListResult.ok) {
            process.stderr.write(formatError(rootPrdListResult.error) + "\n");
            process.exitCode = exitCode(rootPrdListResult.error);
            return;
          }
          const rootPrd = rootPrdListResult.value.docs[0];
          if (rootPrd === undefined) {
            const error = noRootPrdError();
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
            return;
          }

          const ref: GithubIssueRef = { repo: cfg.repo, issueNumber, repo_id: repoId };
          const taskInputResult = toIssueTaskInput(issue, ref, rootPrd.id);
          if (!taskInputResult.ok) {
            process.stderr.write(formatError(taskInputResult.error) + "\n");
            process.exitCode = exitCode(taskInputResult.error);
            return;
          }

          // D1's deterministic slug, computed independently of
          // `taskInputResult.value.slug` (which carries the SAME value, but
          // typed `Slug | undefined` since `CreateDocInput.slug` is
          // optional in general — this call site knows it is always
          // present for an issue task and wants a non-optional `Slug` to
          // key the idempotent re-fetch below on).
          const derivedSlug = githubIssueTaskSlug(repoId, issueNumber);

          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
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
            // reason: re-fetch by `derivedSlug`, NEVER by
            // `createResult.error.existing_id` — MEASURED 2026-08-25:
            // `SqliteStore.insert`/`TursoStore.insert`'s `DUPLICATE_SLUG`
            // branch (`store/sqlite-store.ts` ~L558, `store/turso-store.ts`
            // several sites) returns `existing_id: doc.id`, i.e. the NEW
            // (never-persisted, since the insert failed) doc's own freshly
            // generated id — NOT the id of the doc actually holding the
            // slug (`InMemoryStore.insert`'s `findSlugConflict`-derived
            // `existing_id` gets this right; the two SQL-backed stores do
            // not). A `corpusService.get(error.existing_id)` call here
            // would DOC_NOT_FOUND every single time. This is a store-layer
            // defect outside this task's file anchors — reported, not
            // fixed here — but `derivedSlug` sidesteps it entirely: it is
            // exactly the slug the collision just happened on, known to
            // this call site independent of what the store reports.
            if (createResult.error.code === "DUPLICATE_SLUG") {
              const existingResult = await app.corpusService.get(derivedSlug);
              if (!existingResult.ok) {
                process.stderr.write(formatError(existingResult.error) + "\n");
                process.exitCode = exitCode(existingResult.error);
                return;
              }
              const existing = existingResult.value.doc;
              if (args.json) {
                console.log(
                  JSON.stringify({ ok: true, data: { doc: existing, already_adopted: true } }, null, 2),
                );
              } else {
                console.log(
                  `Already adopted GitHub issue #${issueNumber} as ${existing.slug} (adopted previously).`,
                );
              }
              return;
            }

            process.stderr.write(formatError(createResult.error) + "\n");
            process.exitCode = exitCode(createResult.error);
            return;
          }

          const created = createResult.value;
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { doc: created, already_adopted: false } }, null, 2));
          } else {
            console.log(`Adopted GitHub issue #${issueNumber} as ${created.slug}.`);
          }
        } finally {
          app.close();
        }
      },
    }),
    resolve: defineCommand({
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
        by: {
          type: "string",
          description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const state = typeof args.state === "string" ? args.state : undefined;

        // AC-ICL-3 — checked BEFORE loadLoreApp()/any doc resolution: writes
        // NOTHING, regardless of whether <issue> even exists.
        if (state === "fixed") {
          const error = fixedNotSettableError();
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        if (state === undefined || !isExplicitResolutionState(state)) {
          const error = invalidStateError(state);
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (reason.length === 0) {
          const error = missingReasonError();
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        // §M3 pointer contract, checked BEFORE loadLoreApp() — both halves are
        // pure argv arithmetic, so a refusal here provably writes zero bytes.
        const argRecord = args as unknown as Record<string, unknown>;
        const strayPointer = POINTER_FLAG_BINDINGS.find(
          (binding) => binding.state !== state && readStringArg(argRecord, binding.argName).length > 0,
        );
        if (strayPointer !== undefined) {
          const error = pointerForWrongStateError(strayPointer, state);
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const requiredPointer = POINTER_FLAG_BINDINGS.find((binding) => binding.state === state);
        const pointerValue = requiredPointer === undefined ? "" : readStringArg(argRecord, requiredPointer.argName);
        if (requiredPointer !== undefined && pointerValue.length === 0) {
          const error = missingPointerError(requiredPointer);
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          const issueId = args.issue as string;
          const getResult = await app.corpusService.get(issueId);
          if (!getResult.ok) {
            process.stderr.write(formatError(getResult.error) + "\n");
            process.exitCode = exitCode(getResult.error);
            return;
          }
          const issueDoc = getResult.value.doc;

          if (!hasIssueReport(issueDoc.extra)) {
            const error = notAnIssueError(issueDoc.slug);
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
            return;
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
              process.stderr.write(formatError(error) + "\n");
              process.exitCode = exitCode(error);
              return;
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

          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
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
            process.stderr.write(formatError(setResult.error) + "\n");
            process.exitCode = exitCode(setResult.error);
            return;
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
            console.log(
              JSON.stringify({ ok: true, data: { doc: updated, resolution: computed } }, null, 2),
            );
          } else {
            const pointerNote =
              requiredPointer === undefined ? "" : ` ${requiredPointer.flag} ${resolvedPointer[requiredPointer.extraKey]}`;
            console.log(
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
          // — the LIVE `gh api` target MUST be the CONFIGURED repo, never
          // the STORED one: `storedGithubRef.repo` is this task's
          // PROVENANCE (which repo it was filed/adopted against AT THE
          // TIME), and a repository rename leaves that string stale while
          // `.lore/config.yaml`'s `feedback.upstream.repo` is the operator's
          // current pointer. `classifyFeedbackUpstream` is the SAME shared
          // classifier `adopt`/`report-issue`/`issues` use — no second,
          // independently-derived read of `feedback.upstream` here.
          const upstreamClassification = classifyFeedbackUpstream(config);
          const liveRepo =
            upstreamClassification.kind === "github" ? upstreamClassification.cfg.repo : undefined;
          // reason: `repo_id` is carried over UNCHANGED from the stored ref
          // (never re-derived here) — `GhResolutionLabelPort.setLabel`'s
          // `issueLabelsPath`/`issueLabelPath` read only `.repo`/
          // `.issueNumber`, never `.repo_id`, so substituting just `repo`
          // is the entire fix; a stale `repo_id` in provenance is a
          // separate, D5-scoped concern this call site does not touch.
          const githubRef: GithubIssueRef | undefined =
            storedGithubRef !== undefined && liveRepo !== undefined
              ? { ...storedGithubRef, repo: liveRepo }
              : undefined;
          if (app.resolutionProjector !== undefined && githubRef !== undefined) {
            const projectResult = await app.resolutionProjector.project(computed, githubRef);
            if (!projectResult.ok) {
              // Invariant "Scope-Alt" — projection may be best-effort on a
              // network failure PROVIDED the corpus verdict still lands (it
              // already did, above) and the failure is reported loudly,
              // never swallowed: nonzero exit, distinct from the clean
              // happy-path exit above, and the underlying reason on stderr.
              process.stderr.write(
                `Warning: resolution recorded in the corpus, but the GitHub label was not updated — ` +
                  `${formatError(projectResult.error)}\n`,
              );
              process.exitCode = exitCode(projectResult.error);
            }
          }
        } finally {
          app.close();
        }
      },
    }),
  },
});
