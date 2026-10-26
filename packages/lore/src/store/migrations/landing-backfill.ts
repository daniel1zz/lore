/**
 * The one-time back-fill of landing facts (spec-lore-done-closes-a-commitless-task-through-an-audited-no, D7; issue #422).
 *
 * Purpose: before the landing predicate (`@lore/core` `landing.ts`) a landing carried no `kind` and a branch claim carried no
 * `start_head`. This transform gives every stored landing `kind: "commits"` and every open branch claim a `start_head`
 * (`merge-base(integration, tip)`) plus the `end_tip` it was measured from, so the schemas can REQUIRE both fields and no
 * reader needs a default. A legacy claim whose start and tip cannot be recorded is RELEASED, never given a default.
 *
 * Public surface: {@link backfillLandingFacts}, the row/result types.
 *
 * Invariants:
 *   - Pure over its inputs plus read-only `git` queries against `repoRoot`; it writes nothing. The numbered migration
 *     (`migration-039.ts`) reads the rows inside its own write lock, calls this, and persists the result.
 *   - Idempotent: a row it already filled is skipped, so a second run over its own output returns no changes and no audits.
 *   - Tip of a claim, in order: the branch ref's tip, else a `end_tip` the claim already holds, else the newest evidence
 *     `head_sha` recorded after the claim (a pass before the claim says nothing about this claim's work). The tip must be a
 *     readable commit; `start_head` is then `merge-base(integrationBranch, tip)`.
 *   - A claim that names no branch on a task with NO file anchors (corpus-only) is left alone: it needs no start. On a task
 *     that declares a file anchor it is released with the reason `no-branch claim on a task with file anchors (BR-1468)`.
 *   - A stored landing gets `kind: "commits"` and, when it has none, `tip` = its recorded `branch_head`; `start_head` is not
 *     recoverable and stays absent on those landings.
 *   - A released claim yields exactly one audit entry whose `reason` begins `no start or tip recordable` and whose `remedy`
 *     names claiming again on a branch.
 *
 * Side-effect class: read-only subprocess (`git`), otherwise pure.
 */

import { execFileSync } from "node:child_process";

/** A stored task row, as the back-fill reads it. */
export interface BackfillTaskRow {
  readonly slug: string;
  readonly extra: Record<string, unknown>;
}

/** One row whose `extra` changes; `extra` is the full new value. */
export interface BackfillChange {
  readonly slug: string;
  readonly extra: Record<string, unknown>;
}

/** One released claim: why nothing could be recorded, and what to do. */
export interface BackfillAudit {
  readonly slug: string;
  readonly reason: string;
  readonly remedy: string;
}

export interface BackfillInput {
  readonly tasks: readonly BackfillTaskRow[];
  readonly repoRoot: string;
  readonly integrationBranch: string;
}

export interface BackfillResult {
  readonly changes: BackfillChange[];
  readonly audits: BackfillAudit[];
}

const SHA = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 20_000;

/** One `git` answer as trimmed stdout; `undefined` when git fails (no repo, missing ref, unreadable object). */
function git(repoRoot: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: GIT_TIMEOUT_MS }).trim();
  } catch {
    // reason: every failure of a read-only git query means "this fact cannot be recorded"; the caller releases the claim
    // with that reason, which is the loud outcome. It is never turned into a default value.
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function commitOf(repoRoot: string, rev: string): string | undefined {
  const out = git(repoRoot, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  return out !== undefined && SHA.test(out) ? out : undefined;
}

/** The newest evidence head recorded strictly after the claim, when it names a readable commit. */
function newestEvidenceHeadAfter(extra: Record<string, unknown>, claimedAt: string, repoRoot: string): string | undefined {
  const evidence = Array.isArray(extra["verification_evidence"]) ? extra["verification_evidence"] : [];
  let best: { recordedAt: string; head: string } | undefined;
  for (const raw of evidence) {
    const entry = asObject(raw);
    const attestation = asObject(entry?.["attestation"]);
    const recordedAt = entry?.["recorded_at"];
    const head = attestation?.["head_sha"];
    if (typeof recordedAt !== "string" || typeof head !== "string" || !SHA.test(head)) continue;
    if (recordedAt <= claimedAt) continue;
    if (best === undefined || recordedAt > best.recordedAt) best = { recordedAt, head };
  }
  return best === undefined ? undefined : commitOf(repoRoot, best.head);
}

type TipResolution = { readonly tip: string } | { readonly why: string };

function resolveTip(extra: Record<string, unknown>, claim: Record<string, unknown>, branch: string, repoRoot: string): TipResolution {
  const ref = commitOf(repoRoot, `refs/heads/${branch}`);
  if (ref !== undefined) return { tip: ref };
  const held = claim["end_tip"];
  if (typeof held === "string" && SHA.test(held)) {
    const readable = commitOf(repoRoot, held);
    if (readable !== undefined) return { tip: readable };
  }
  const claimedAt = typeof claim["at"] === "string" ? claim["at"] : "";
  const fromEvidence = newestEvidenceHeadAfter(extra, claimedAt, repoRoot);
  if (fromEvidence !== undefined) return { tip: fromEvidence };
  return { why: `branch ${branch} is gone and no evidence was recorded at a readable commit after the claim` };
}

function hasFileAnchors(extra: Record<string, unknown>): boolean {
  const anchors = extra["file_anchors"];
  return Array.isArray(anchors) && anchors.length > 0;
}

function withoutClaim(extra: Record<string, unknown>): Record<string, unknown> {
  const { claim: _claim, ...rest } = extra;
  return rest;
}

/**
 * Back-fills `landing.kind` and branch-claim `start_head` / `end_tip`; releases the claims that cannot be filled.
 *
 * @param input - the stored task rows, the repository they were worked in, and its integration branch name
 * @returns only the rows that change (full new `extra`) and one audit entry per released claim
 *
 * @example
 * backfillLandingFacts({ tasks: [{ slug: "t", extra: { landing: { branch: "b" } } }], repoRoot: "/repo", integrationBranch: "main" })
 * // => { changes: [{ slug: "t", extra: { landing: { branch: "b", kind: "commits" } } }], audits: [] }
 */
export function backfillLandingFacts(input: BackfillInput): BackfillResult {
  const changes: BackfillChange[] = [];
  const audits: BackfillAudit[] = [];

  for (const task of input.tasks) {
    let extra = task.extra;
    let changed = false;

    const landing = asObject(extra["landing"]);
    if (landing !== undefined && landing["kind"] === undefined) {
      // reason: a landing written before the predicate holds only the old fields. Its branch tip is the recorded `branch_head`;
      // `start_head` is not recoverable and stays absent (`kind: commits` readers never need it).
      const recordedTip = landing["branch_head"];
      const tip = landing["tip"] === undefined && typeof recordedTip === "string" && recordedTip !== "" ? { tip: recordedTip } : {};
      extra = { ...extra, landing: { ...landing, kind: "commits", ...tip } };
      changed = true;
    }

    const claim = asObject(extra["claim"]);
    const branch = claim?.["branch"];
    const startHead = claim?.["start_head"];
    if (claim !== undefined && typeof branch === "string" && branch !== "" && !(typeof startHead === "string" && SHA.test(startHead))) {
      const resolved = resolveTip(extra, claim, branch, input.repoRoot);
      const start =
        "tip" in resolved ? git(input.repoRoot, ["merge-base", input.integrationBranch, resolved.tip]) : undefined;
      if ("tip" in resolved && start !== undefined && SHA.test(start)) {
        extra = { ...extra, claim: { ...claim, start_head: start, end_tip: resolved.tip } };
      } else {
        const why = "tip" in resolved ? `no common ancestor of ${resolved.tip.slice(0, 12)} and ${input.integrationBranch} could be read` : resolved.why;
        extra = withoutClaim(extra);
        audits.push({
          slug: task.slug,
          reason: `no start or tip recordable: ${why}`,
          remedy: `claim again on a branch: lore claim ${task.slug} --worktree <branch>`,
        });
      }
      changed = true;
    } else if (claim !== undefined && branch === undefined && hasFileAnchors(extra)) {
      // reason: BR-1468 — work on declared files needs a branch; a no-branch claim on such a task has no measurable start.
      extra = withoutClaim(extra);
      audits.push({
        slug: task.slug,
        reason: "no-branch claim on a task with file anchors (BR-1468)",
        remedy: `claim again on a branch: lore claim ${task.slug} --worktree <branch>`,
      });
      changed = true;
    }

    if (changed) changes.push({ slug: task.slug, extra });
  }

  return { changes, audits };
}
