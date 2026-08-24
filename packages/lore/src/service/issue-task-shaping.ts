/**
 * Write-time half of GitHub issue ingest (D3) — turns ONE listed GitHub
 * issue into a corpus `CreateDocInput`, and the deterministic, rename-proof
 * slug (D1) that makes the resulting task addressable regardless of any
 * subsequent GitHub repository rename
 * (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam).
 *
 * Store-free and total, exactly like `issue-resolution.ts` (no
 * `StoreInterface`, no IO, no `Date.now()`, no `Math.random()`) — the
 * caller (`commands/issue.ts`'s new `adopt <number>` subcommand, a later
 * phase's anchor) performs every store read/write and every `gh api` call;
 * this module only shapes data the caller already fetched.
 *
 * Public surface:
 *   - `githubIssueTaskSlug(repoId, issueNumber)` — D1's identity key.
 *   - `toIssueTaskInput(issue, ref, rootPrdId)` — the `CreateDocInput` for one
 *     listed issue, or `err(VALIDATION_ERROR)` when `ref` carries no
 *     `repo_id` yet, or when the issue's body carries no parsable lore
 *     front matter. Signature corrected under D13 (spec's "Review Revisions
 *     — round 2" item 7): round 1 took a `planId` the real shape has no room
 *     for — see this function's own doc for the measured shape.
 *
 * Invariants:
 *   - D1: identity is `(repo_id, issueNumber)`, NEVER `owner/repo` —
 *     `owner/repo` is mutable (a rename), and `slugSchema`
 *     (`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`) forbids underscores and uppercase,
 *     so any sanitizer maps the two DISTINCT GitHub repositories
 *     `owner_a/repo` and `owner-a/repo` onto the same slug. Keying on the
 *     numeric id sidesteps that collision entirely — see
 *     {@link githubIssueTaskSlug}'s own doc.
 *   - D4: `ref`'s type is IMPORTED from `resolution-projector.ts`
 *     (`GithubIssueRef`), never redeclared here — this makes the writer
 *     type-linked to `readGithubIssueRef`, the canonical READER of the same
 *     `extra.issue_report.github` bag, instead of the two agreeing on an
 *     untyped shape by convention.
 *   - `ref.repo_id` is REQUIRED at write time even though the shared
 *     `GithubIssueRef` type marks it optional (a ref read off a
 *     pre-this-spec task carries none — see that type's own doc). A fresh
 *     ingest ALWAYS has the numeric id in hand
 *     (`GitHubIntakePort.verifyTarget` fetches it at zero extra cost, D1),
 *     so an absent `repo_id` here is a caller bug, reported loudly as
 *     `err(VALIDATION_ERROR)` rather than silently falling back to a
 *     rename-unsafe key.
 *   - `extra.issue_report` carries the six DECODED front-matter fields
 *     (`parseIssueBody`, `@lore/core`) verbatim, PLUS the GitHub pointer
 *     (`github: {repo, number, repo_id}`) {@link readGithubIssueRef} reads
 *     back — never a re-derivation of either.
 *   - `content` is the issue body VERBATIM, front-matter block included:
 *     this task IS the corpus's copy of the GitHub issue, and
 *     `parseIssueBody` is how any later reader recovers the six fields from
 *     it — stripping the block here would leave nothing for that
 *     round-trip.
 *   - `parseIssueBody`'s one documented throw (`MalformedIssueFrontMatterError`,
 *     a front-matter block present but corrupted) is caught here and
 *     translated to `err(VALIDATION_ERROR)` — this module's public surface
 *     never throws, matching the "no exceptions cross a service boundary"
 *     convention every other exported function in this codebase follows.
 *
 * Side-effect class: pure.
 *
 * Source: spec-a-github-filed-defect-must-be-claimable-one-ingest-seam, D1,
 *   D2, D3, D4, D13; Module Boundary.
 */

import { err, ok, parseIssueBody, type CreateDocInput, type LoreError, type Result, type Slug } from "@lore/core";

import type { GithubListedIssue } from "./github-intake-port.js";
import type { GithubIssueRef } from "./resolution-projector.js";

/**
 * D1 — the deterministic, rename-proof task slug for one GitHub issue: keyed
 * on GitHub's own numeric repository id plus the issue number, NEVER on the
 * `owner/repo` string (see this module's header for the collision that
 * string would produce). Total and injective over the domain AC-GR-6 pins
 * (`repoId` in `[1, 2^53-1]`, `issueNumber` in `[1, 10^6]`): the single
 * hyphen this function inserts between the two positive-integer renderings
 * is never itself produced by `Number.prototype.toString()` in that range,
 * so the string can always be split back into the exact `(repoId,
 * issueNumber)` pair that produced it — which is what makes two distinct
 * pairs unable to collide.
 *
 * @param repoId - GitHub's numeric repository id (`gh api repos/<repo>`'s
 *   `id`, returned by `GitHubIntakePort.verifyTarget`) — NEVER a sanitized
 *   `owner/repo` string.
 * @param issueNumber - the issue's number within that repository.
 * @returns a slug matching `slugSchema` (`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`).
 * @example
 *   githubIssueTaskSlug(12345, 7) // => "task-gh-12345-7"
 *   // D1's named adversarial case: two repos any owner/repo sanitizer would
 *   // collide on carry distinct numeric ids, so their slugs never collide.
 *   githubIssueTaskSlug(111111, 5) // => "task-gh-111111-5" (owner_a/repo)
 *   githubIssueTaskSlug(222222, 5) // => "task-gh-222222-5" (owner-a/repo)
 */
export function githubIssueTaskSlug(repoId: number, issueNumber: number): Slug {
  return `task-gh-${repoId}-${issueNumber}`;
}

/**
 * Builds the `CreateDocInput` for one listed GitHub issue — called both by
 * `commands/issue.ts`'s `adopt <number>` subcommand (a later phase's
 * anchor, reading a listed issue off GitHub) and by
 * `report-issue-wiring.ts::fileGithubIssue` (D8: mints the task in the same
 * call that files the issue, from the fields that call already has in
 * hand).
 *
 * D13 (spec's "Review Revisions — round 2" item 7): the minted task is
 * **adhoc**, never plan-parented. Measured 2026-08-24 against all 6
 * pre-existing issue-report tasks: `extra.adhoc === true`, NO
 * `extra.plan_id` key, `parent_id` = the corpus ROOT PRD (that STORED fact
 * — see `rootPrdId`'s own doc below for why this function's OUTPUT omits
 * `parent_id` rather than setting it directly; the doc still ends up
 * parented to the root PRD, via `CorpusService._createImpl`'s existing
 * auto-parenting). A filed defect has no plan by definition — it arrives
 * before anyone decides who owns it, which is what `lore issue resolve
 * --state adopted --adopted-by <plan|task>` exists to record later. So
 * this function takes a plan-less `rootPrdId`, not the `(planId,
 * parentId)` pair round 1 wrongly gave it — round 1 was derived from
 * `createDocInputSchema`'s GENERAL task rule (parent_id + extra.plan_id
 * required) rather than from how issue-report tasks are actually shaped.
 *
 * @param issue - the listed issue (`GitHubIntakePort.listIssues`'s element
 *   shape) — only `title`, `number`, and `body` are read.
 * @param ref - this issue's GitHub identity. MUST carry `repo_id` (D1) —
 *   see this module's own invariants for why an absent one is refused
 *   rather than defaulted.
 * @param rootPrdId - the corpus's root PRD id, REQUIRED as a precondition
 *   proof (this module is store-free — it cannot itself confirm a root PRD
 *   exists) but deliberately NEVER written into the returned
 *   `CreateDocInput.parent_id`. MEASURED 2026-08-24: `parent_id` and
 *   `PARENT_TYPE_CONTRACT.task = ["plan"]` (`@lore/core`'s
 *   `doc-type-rules.ts`) are checked UNCONDITIONALLY whenever
 *   `CreateDocInput.parent_id` is present at all — `CorpusService._createImpl`
 *   only bypasses that plan-only contract via its SPEC-069 `--adhoc`
 *   auto-parenting branch, which fires ONLY when `parent_id` is ABSENT
 *   (`data.parent_id === undefined && extra.adhoc === true`). A
 *   `CreateDocInput` naming the root PRD as `parent_id` EXPLICITLY (round
 *   1's actual attempt) is refused with `INVALID_PARENT_TYPE` before that
 *   auto-parenting branch is ever reached — confirmed by running the real
 *   AC-GR-9 e2e against that shape. So the ONLY legal way to land a task on
 *   a PRD is the same omission `lore create task --adhoc` (with no
 *   `--parent`) already relies on; explicitly threading `rootPrdId` through
 *   as `parent_id` is not a stricter, more-explicit variant of that path —
 *   it is a DIFFERENT, illegal one. This function's own precondition check
 *   (non-empty `rootPrdId`) gives the SAME "no root PRD" failure a pure,
 *   unit-testable, store-free surface instead of deferring it entirely to
 *   `_createImpl`'s own identical check.
 * @returns `ok(createDocInput)` — `parent_id` ABSENT (resolved later by
 *   `CorpusService._createImpl`'s adhoc auto-parenting, the SAME "first PRD"
 *   lookup {@link resolveLocalRootPrd}-style callers already use, so it
 *   resolves to the identical doc in every corpus carrying exactly one root
 *   PRD) — with the deterministic slug, `extra.adhoc === true`,
 *   `extra.ac_scope === []` (an adhoc task always requires an explicit,
 *   possibly-empty scope declaration — a filed defect claims no AC), and
 *   the shaped `extra.issue_report`; `err(VALIDATION_ERROR)` when
 *   `rootPrdId` is empty, `ref.repo_id` is absent, or when `issue.body`
 *   carries no parsable lore front matter (`parseIssueBody` returns
 *   `{present: false}`, or throws `MalformedIssueFrontMatterError` on a
 *   corrupted block).
 * @example
 *   toIssueTaskInput(
 *     {number: 7, title: "Bug", state: "open", body: "---\n{...}\n---\n\nSteps"},
 *     {repo: "acme/widget", issueNumber: 7, repo_id: 12345},
 *     "prd-lore",
 *   )
 *   // => ok({type: "task", title: "Bug", slug: "task-gh-12345-7",
 *   //        extra: {adhoc: true, ac_scope: [], ...}})  // no parent_id key
 */
export function toIssueTaskInput(
  issue: GithubListedIssue,
  ref: GithubIssueRef,
  rootPrdId: string,
): Result<CreateDocInput, LoreError> {
  if (rootPrdId.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "rootPrdId",
      message:
        `Cannot mint a corpus task for GitHub issue #${issue.number}: no root PRD id was supplied — an adhoc ` +
        `task (D13) can only be minted once this corpus has a root PRD to anchor it to.`,
      value: rootPrdId,
    });
  }

  if (ref.repo_id === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "ref.repo_id",
      message:
        `Cannot mint a rename-proof slug for GitHub issue #${issue.number}: the supplied GithubIssueRef ` +
        `carries no repo_id (D1) — a fresh ingest must always resolve it via ` +
        `GitHubIntakePort.verifyTarget before calling toIssueTaskInput.`,
      value: ref,
    });
  }

  let parsed: ReturnType<typeof parseIssueBody>;
  try {
    parsed = parseIssueBody(issue.body);
  } catch (error) {
    return err({
      code: "VALIDATION_ERROR",
      field: "issue.body",
      message: `GitHub issue #${issue.number}'s body has a corrupted lore front-matter block: ${String(error)}`,
      value: issue.body,
    });
  }

  if (!parsed.present) {
    return err({
      code: "VALIDATION_ERROR",
      field: "issue.body",
      message:
        `GitHub issue #${issue.number} carries no parsable lore front matter — it was not filed through ` +
        `'lore report-issue' (or its body no longer opens with the front-matter block).`,
      value: issue.body,
    });
  }

  const { fields } = parsed;

  return ok({
    type: "task",
    title: issue.title,
    content: issue.body,
    // parent_id deliberately OMITTED — see this function's own @param
    // rootPrdId doc for why an explicit parent_id here is a DIFFERENT,
    // illegal path (INVALID_PARENT_TYPE), not a stricter variant of the
    // legal one. CorpusService._createImpl's SPEC-069 adhoc auto-parenting
    // resolves the root PRD instead, triggered by extra.adhoc === true
    // below plus this key's absence.
    slug: githubIssueTaskSlug(ref.repo_id, ref.issueNumber),
    extra: {
      // D13: adhoc, never plan-parented — NO plan_id key at all (a filed
      // defect has no plan by definition; see this function's own doc).
      adhoc: true,
      // An adhoc task always requires an explicit ac_scope declaration
      // (createDocInputSchema / create-task-validation.ts's "ALWAYS with
      // --adhoc" rule) — a filed defect claims no acceptance criterion, so
      // an explicit EMPTY array, never an omitted key.
      ac_scope: [],
      issue_report: {
        severity: fields.severity,
        category: fields.category,
        tags: fields.tags,
        reporter_corpus: fields.reporter_corpus,
        reporter_root_prd: fields.reporter_root_prd,
        idempotency_key: fields.idempotency_key,
        github: {
          repo: ref.repo,
          number: ref.issueNumber,
          repo_id: ref.repo_id,
        },
      },
    },
  });
}
