/**
 * `decideAdoption` and `buildCarrierTaskInput` — the pure half of `lore issue adopt <n>`
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D6, AC-GS-7): given one live listing row and the
 * carriers that already name it, decide whether to create a carrier task, and shape that task.
 *
 * Public surface:
 *   - `carrierTaskSlug(repoId, number, priorCarrierCount)` — `task-issue-<repo_id>-<n>`, `-r<k>` after k earlier carriers.
 *   - `decideAdoption(issue, repoId, carriers, nowIso)` — the four outcomes of {@link AdoptionDecision}.
 *   - `buildCarrierTaskInput(...)` — the `CreateDocInput` of the one draft carrier task.
 *
 * Invariants:
 *   - GitHub is only read; the single write is the task `create`, whose `DUPLICATE_SLUG` is the race arbiter (two
 *     sessions deciding `create` at once compute the SAME slug, so exactly one insert wins).
 *   - A closed issue is never adopted (checked first); an alive carrier makes the issue `already_adopted`; an alive
 *     ARCHIVED carrier means the work is done (`archived_carrier`, repaired by `lore issues --sync`, not by adopting).
 *   - A dead carrier (deprecated or invalidated) does not block adoption; it only bumps the `-r<k>` suffix.
 *   - The task carries `extra.issues` and, for a plan member, `extra.plan_id`; it never carries `extra.issue_report`.
 *
 * Side-effect class: pure.
 *
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries D6, AC-GS-7.
 */

import { isInvalidated } from "@lore/core";
import type { CreateDocInput, DocRecord, Slug } from "@lore/core";

import type { GithubListedIssue } from "./github-intake-port.js";
import { namesIssue } from "./github-issue-listing.js";

/** The outcome of deciding whether `adopt` creates a carrier. */
export type AdoptionDecision =
  | { readonly kind: "closed_on_github" }
  | { readonly kind: "already_adopted"; readonly slug: string; readonly id: string }
  | { readonly kind: "archived_carrier"; readonly slug: string }
  | { readonly kind: "create"; readonly slug: Slug };

/**
 * The carrier task slug: `task-issue-<repo_id>-<n>` for the first carrier, `-r<k>` after `k` earlier carriers of the
 * same ref (all dead, or adoption would not have been decided).
 */
export function carrierTaskSlug(repoId: number, issueNumber: number, priorCarrierCount: number): Slug {
  const base = `task-issue-${repoId}-${issueNumber}`;
  return priorCarrierCount === 0 ? base : `${base}-r${priorCarrierCount}`;
}

const isDead = (doc: DocRecord, nowIso: string): boolean => doc.status === "deprecated" || isInvalidated(doc, nowIso);

/**
 * @param issue - the listed issue being adopted
 * @param repoId - the configured repository's numeric id
 * @param carriers - every task and plan with `extra.issues` (archived ones included)
 * @param nowIso - the read instant (validity is time-dependent)
 */
export function decideAdoption(
  issue: GithubListedIssue,
  repoId: number,
  carriers: readonly DocRecord[],
  nowIso: string,
): AdoptionDecision {
  if (issue.state === "closed") return { kind: "closed_on_github" };
  const naming = carriers.filter((doc) => namesIssue(doc, repoId, issue.number));
  const alive = naming.filter((doc) => !isDead(doc, nowIso)).sort((a, b) => a.slug.localeCompare(b.slug));
  const live = alive.find((doc) => doc.status !== "archived");
  if (live !== undefined) return { kind: "already_adopted", slug: live.slug, id: live.id };
  const archived = alive[0];
  if (archived !== undefined) return { kind: "archived_carrier", slug: archived.slug };
  return { kind: "create", slug: carrierTaskSlug(repoId, issue.number, naming.length) };
}

/** The issue body without its lore front-matter block (the block's fields live on GitHub, not in the work description). */
function descriptionOf(body: string): string {
  const lines = body.split("\n");
  if (lines[0]?.trim() !== "---") return body.trim();
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return (close === -1 ? body : lines.slice(close + 1).join("\n")).trim();
}

/** What {@link buildCarrierTaskInput} needs. */
export interface CarrierTaskParams {
  readonly issue: GithubListedIssue;
  readonly repo: string;
  readonly repoId: number;
  readonly slug: Slug;
  /** The live plan the task joins; `undefined` for an ad-hoc task (parented to the root PRD by `CorpusService`). */
  readonly planId?: string;
}

/**
 * The draft carrier task: title = issue title, body = a link to the issue plus the issue's description (frozen at
 * adoption). A plan member gets `parent_id` and `extra.plan_id`; an ad-hoc one gets `extra.adhoc`. Both declare an empty
 * `ac_scope` (an adopted defect claims no acceptance criterion; the declaration is mandatory when the plan's spec has script ACs).
 */
export function buildCarrierTaskInput(params: CarrierTaskParams): CreateDocInput {
  const { issue, repo, repoId, slug, planId } = params;
  const content = [
    `GitHub issue: https://github.com/${repo}/issues/${issue.number}`,
    "",
    descriptionOf(issue.body) || "(the issue has no description)",
  ].join("\n");
  const issues = [{ repo_id: repoId, number: issue.number }];
  return {
    type: "task",
    title: issue.title,
    content,
    slug,
    ...(planId !== undefined ? { parent_id: planId, extra: { plan_id: planId, ac_scope: [], issues } } : { extra: { adhoc: true, ac_scope: [], issues } }),
  };
}
