/**
 * `IssueCloser` — the GitHub write capability behind "archiving the work that resolves a defect
 * report closes its issue" (spec-archiving-the-work-that-resolves-a-defect-report-closes D2/D3),
 * plus its one `GhRunner`-backed implementation `GhIssueCloser`.
 *
 * Public surface:
 *   - `IssueCloser` — five independent calls, each returning its own typed `Result`, so a comment or
 *     label failure can never be confused with (or undo) the close:
 *       `readIssue`    — current `state` + label names (the drift read `lore issues --sync` and the
 *                         already-closed check both use)
 *       `closeIssue`   — close as `completed`; an already-closed issue is `ok({alreadyClosed: true})`
 *       `commentIssue` — post one comment
 *       `labelIssue`   — converge the `resolution:*` label (delegates to `GhResolutionLabelPort`)
 *       `removeLabels` — delete named labels (`lore issues --sync` strips stray `resolution:*` from open issues)
 *   - `GhIssueCloser` — `new GhIssueCloser(runner)`.
 *
 * Invariants:
 *   - Every GitHub call routes through the injected `GhRunner` (AC-GI-7: no subprocess here).
 *   - Nothing is retried and no failure is swallowed: the first failing call of an operation is
 *     returned as `err(...)` to the caller, which owns reporting it.
 *   - Closing never reopens, and the close call is skipped (not repeated) for an already-closed issue.
 *   - Gh stdout is untrusted: it is Zod-parsed before use; a malformed body is a `VALIDATION_ERROR`.
 *
 * Side-effect class: IO (via the injected `GhRunner`).
 *
 * Source: spec-archiving-the-work-that-resolves-a-defect-report-closes D2, AC-IC-3.
 */

import { z } from "zod";

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

import type { GhRunner } from "./gh-runner.js";
import { GhResolutionLabelPort } from "./resolution-label-port.js";
import type { GithubIssueRef } from "./resolution-projector.js";

/** The GitHub-side facts the closer reads back: lifecycle state and the label names. */
export interface GithubIssueSnapshot {
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  /**
   * GitHub's `state_reason` (`completed`, `not_planned`, `duplicate`, ...); `null` when GitHub gives none.
   * Optional only so a test fake that predates the field still compiles; {@link GhIssueCloser} always sets it.
   * Archive-time close reads it to tell a closed-with-verdict issue from a plainly completed one.
   */
  readonly stateReason?: string | null;
}

/**
 * The injected GitHub write capability. Absent from an App whose `feedback.upstream` is not a
 * GitHub repository.
 */
export interface IssueCloser {
  /** Reads the issue's current state and labels. */
  readIssue(ref: GithubIssueRef): Promise<Result<GithubIssueSnapshot, LoreError>>;
  /** Closes the issue as completed; `alreadyClosed: true` when it was already closed (no write made). */
  closeIssue(ref: GithubIssueRef): Promise<Result<{ readonly alreadyClosed: boolean }, LoreError>>;
  /** Posts one comment on the issue. */
  commentIssue(ref: GithubIssueRef, body: string): Promise<Result<void, LoreError>>;
  /** Converges the issue to exactly the one `resolution:*` label `label`. */
  labelIssue(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>>;
  /**
   * Removes each named label from the issue (one DELETE per name, no read first: the caller already holds
   * the labels from the live listing). Stops at the first failing call and returns it.
   * Optional only so a closer fake that predates `--sync` still compiles ({@link GhIssueCloser} always has it);
   * `IssueCloseOnArchive.applySync` fails LOUD when a strip is planned and the closer lacks it.
   */
  removeLabels?(ref: GithubIssueRef, names: readonly string[]): Promise<Result<void, LoreError>>;
}

const GithubIssueResponseSchema = z
  .object({
    state: z.enum(["open", "closed"]),
    state_reason: z.string().nullable().optional(),
    labels: z.array(z.object({ name: z.string() }).passthrough()),
  })
  .passthrough();

/** Path of one issue's REST resource. */
function issuePath(ref: GithubIssueRef): string {
  return `repos/${ref.repo}/issues/${ref.issueNumber}`;
}

/** The `gh`-backed {@link IssueCloser}. */
export class GhIssueCloser implements IssueCloser {
  private readonly runner: GhRunner;
  private readonly labelPort: GhResolutionLabelPort;

  constructor(runner: GhRunner) {
    this.runner = runner;
    this.labelPort = new GhResolutionLabelPort(runner);
  }

  async readIssue(ref: GithubIssueRef): Promise<Result<GithubIssueSnapshot, LoreError>> {
    const response = await this.runner.run(["api", issuePath(ref)]);
    if (!response.ok) return err(response.error);
    let body: unknown;
    try {
      body = JSON.parse(response.value.stdout);
    } catch {
      body = undefined; // reason: relocated one line down — safeParse turns it into a VALIDATION_ERROR
    }
    const parsed = GithubIssueResponseSchema.safeParse(body);
    if (!parsed.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gh_issue_response",
        message: `GitHub returned an issue payload this module could not parse: ${parsed.error.message}`,
        value: response.value.stdout,
      });
    }
    return ok({
      state: parsed.data.state,
      stateReason: parsed.data.state_reason ?? null,
      labels: parsed.data.labels.map((label) => label.name),
    });
  }

  async closeIssue(ref: GithubIssueRef): Promise<Result<{ readonly alreadyClosed: boolean }, LoreError>> {
    const snapshot = await this.readIssue(ref);
    if (!snapshot.ok) return err(snapshot.error);
    if (snapshot.value.state === "closed") return ok({ alreadyClosed: true });
    const closed = await this.runner.run([
      "api",
      issuePath(ref),
      "-X",
      "PATCH",
      "-f",
      "state=closed",
      "-f",
      "state_reason=completed",
    ]);
    if (!closed.ok) return err(closed.error);
    return ok({ alreadyClosed: false });
  }

  async commentIssue(ref: GithubIssueRef, body: string): Promise<Result<void, LoreError>> {
    const posted = await this.runner.run(["api", `${issuePath(ref)}/comments`, "-X", "POST", "-f", `body=${body}`]);
    if (!posted.ok) return err(posted.error);
    return ok(undefined);
  }

  labelIssue(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>> {
    return this.labelPort.setLabel(ref, label);
  }

  async removeLabels(ref: GithubIssueRef, names: readonly string[]): Promise<Result<void, LoreError>> {
    for (const name of names) {
      // reason: encodeURIComponent — a resolution label carries a literal `:` that must not reach the request path raw.
      const removed = await this.runner.run(["api", `${issuePath(ref)}/labels/${encodeURIComponent(name)}`, "-X", "DELETE"]);
      if (!removed.ok) return err(removed.error);
    }
    return ok(undefined);
  }
}
