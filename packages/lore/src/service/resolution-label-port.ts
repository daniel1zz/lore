/**
 * `GhResolutionLabelPort` — the `gh`-backed `ResolutionLabelPort`
 * implementation (spec-the-defect-channel-reaches-no-machine-but-its-own-
 * github, Scope "ResolutionProjector"; AC-GI-4's production-reachability
 * half, task-skill-implement-wire-a-real-resolutionlabelport-so-the).
 *
 * `resolution-projector.ts`'s `ResolutionProjector` depends only on the
 * `ResolutionLabelPort` interface it declares — it never imports a concrete
 * GitHub client. This module supplies the ONE real implementation. Every
 * `gh` invocation routes through the injected `GhRunner` (`gh-runner.ts`),
 * the single subprocess seam AC-GI-7 enforces mechanically: this module
 * imports ZERO `node:child_process` and spawns nothing of its own.
 *
 * Public surface:
 *   - `GhResolutionLabelPort` — `new GhResolutionLabelPort(runner)`, then
 *     `setLabel(ref, label): Promise<Result<void, LoreError>>`.
 *
 * Convergence algorithm (Invariant 6 — a label is read back ONLY to
 * converge or detect drift, never as authority; `computeIssueResolution` in
 * `issue-resolution.ts`, never imported here, stays the sole authority):
 *   1. GET the issue's current labels (`gh api repos/<repo>/issues/<n>/labels`)
 *      — GitHub's label-add endpoint only ADDS, it never removes a sibling
 *      as a side effect, so a read-first step is the only way to find what
 *      needs removing.
 *   2. Compute the stale set: every current label matching `resolution:*`
 *      that is NOT `label` itself.
 *   3. DELETE each stale label, one `gh api ... -X DELETE` call per label —
 *      converges to zero stale siblings even when more than one accumulated
 *      (a hand-edited issue, or a prior partially-failed run).
 *   4. POST `label` ONLY when step 1's list did not already contain it — an
 *      issue whose label already matches the target resolution makes zero
 *      mutating calls beyond the initial GET.
 *   5. The FIRST call to fail (the list, any delete, or the add) short-
 *      circuits the remaining steps and returns that failure as `err(...)`
 *      — never swallowed, never retried silently. Whatever mutation already
 *      succeeded before the failing call stays in effect; the corpus verdict
 *      this port is invoked from (`ResolutionProjector.project`, itself
 *      called from `commands/issue.ts` AFTER the corpus write lands) is
 *      never rolled back because of a label-side failure here — the caller
 *      reports this `err` loudly with a non-zero exit instead.
 *
 * Invariants:
 *   - ⛔ WRITE-ONLY IN INTENT: the label list fetched in step 1 is consumed
 *     ONLY to decide which `gh api` calls to make in THIS SAME invocation —
 *     it is never returned, logged as a resolution value, or otherwise
 *     treated as a fact about what the corpus resolution "really is".
 *   - Every `gh` argv element is a literal array entry, never a
 *     concatenated/interpolated shell string. `GhRunner.run` spawns via
 *     `execFile` (no shell) one layer down, so this is already structurally
 *     enforced; this module additionally never builds a joined command
 *     string of its own.
 *   - The GET response is Zod-parsed before use — `gh`'s stdout is
 *     untrusted external JSON crossing a process boundary. A malformed
 *     shape is a `VALIDATION_ERROR`, never a thrown exception and never a
 *     silently-assumed-empty label list.
 *
 * Side-effect class: IO (subprocess, via the injected `GhRunner`) — this
 * module owns zero process state of its own; `issueLabelsPath`/
 * `issueLabelPath` are pure.
 *
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github,
 *   Scope "ResolutionProjector", Invariant 6, AC-GI-4, AC-GI-7.
 */

import { z } from "zod";

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

import type { GhRunner } from "./gh-runner.js";
import type { GithubIssueRef, ResolutionLabelPort } from "./resolution-projector.js";

/**
 * The literal prefix every resolution label carries. `resolution-
 * projector.ts` owns the canonical constant of the same value (private to
 * that module, not exported) — this is a second, independently-declared
 * copy of the SAME literal string rather than a shared import, because the
 * only shared oracle that matters here is `resolutionToLabel`'s actual
 * OUTPUT (which `label` — this method's own parameter — already is), never
 * this prefix in isolation. Duplicating the literal costs nothing; a
 * cross-module import of a private constant would.
 */
const RESOLUTION_LABEL_PREFIX = "resolution:";

/** One label object as GitHub's REST API returns it — only `name` is read. */
const GithubLabelSchema = z.object({ name: z.string() }).passthrough();

/** The shape `GET .../labels` returns: an array of label objects. */
const GithubLabelListSchema = z.array(GithubLabelSchema);

/** Builds the `gh api` path for an issue's labels collection. */
function issueLabelsPath(ref: GithubIssueRef): string {
  return `repos/${ref.repo}/issues/${ref.issueNumber}/labels`;
}

/**
 * Builds the `gh api` path for one specific label on an issue — the DELETE
 * target. `encodeURIComponent` is required: every resolution label contains
 * a literal `:` (RESOLUTION_LABEL_PREFIX), which must not reach the request
 * line unescaped in a path segment.
 */
function issueLabelPath(ref: GithubIssueRef, labelName: string): string {
  return `${issueLabelsPath(ref)}/${encodeURIComponent(labelName)}`;
}

/**
 * Defensive `JSON.parse` — `gh api`'s stdout is untrusted external text (a
 * network response relayed unmodified by `GhRunner.run`). A malformed body
 * degrades to `undefined` here rather than throwing past this module's
 * `Result` boundary; `GithubLabelListSchema.safeParse` immediately below
 * rejects `undefined` and turns it into a `VALIDATION_ERROR` this module's
 * caller can see — the failure is never silently swallowed, only relocated
 * one line down to where it can be reported through `Result` instead of a
 * thrown exception.
 */
function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The `gh`-backed `ResolutionLabelPort`. Every call is exactly the
 * convergence sequence this module's header documents — never a bare "set"
 * that trusts GitHub's own label-add semantics to remove a stale sibling
 * (it does not: the add endpoint only adds).
 */
export class GhResolutionLabelPort implements ResolutionLabelPort {
  private readonly runner: GhRunner;

  constructor(runner: GhRunner) {
    this.runner = runner;
  }

  /**
   * Converges `ref`'s labels to exactly one `resolution:*` label — `label`
   * itself. See this module's header doc comment for the full algorithm.
   *
   * @param ref - the target issue's GitHub identity
   * @param label - the exact label to converge to, e.g. `resolution:fixed`
   *   (always `resolutionToLabel(...)`'s output — this method never
   *   inspects or re-derives the resolution state itself)
   * @returns `ok(undefined)` once the issue carries exactly `label` among
   *   its `resolution:*` labels; `err(loreError)` on the first failed `gh`
   *   call (list, delete, or add)
   */
  async setLabel(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>> {
    const listResult = await this.runner.run(["api", issueLabelsPath(ref)]);
    /** @lore-site BR-534 */
    if (!listResult.ok) return err(listResult.error);

    const parsed = GithubLabelListSchema.safeParse(parseJsonSafely(listResult.value.stdout));
    if (!parsed.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gh_labels_response",
        message: `gh returned a labels payload this module could not parse: ${parsed.error.message}`,
        value: listResult.value.stdout,
        rule: "BR-534",
      });
    }

    const currentNames = parsed.data.map((entry) => entry.name);
    const staleSiblings = currentNames.filter(
      (name) => name.startsWith(RESOLUTION_LABEL_PREFIX) && name !== label,
    );

    for (const stale of staleSiblings) {
      const deleteResult = await this.runner.run(["api", issueLabelPath(ref, stale), "-X", "DELETE"]);
      /** @lore-site BR-534 */
      if (!deleteResult.ok) return err(deleteResult.error);
    }

    if (currentNames.includes(label)) return ok(undefined);

    const addResult = await this.runner.run([
      "api",
      issueLabelsPath(ref),
      "-X",
      "POST",
      "-f",
      `labels[]=${label}`,
    ]);
    /** @lore-site BR-534 */
    if (!addResult.ok) return err(addResult.error);
    return ok(undefined);
  }
}
