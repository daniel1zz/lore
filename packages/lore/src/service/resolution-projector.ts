/**
 * `ResolutionProjector` — the one-way projection of the corpus-computed
 * 9-state issue resolution (`@lore/core`'s `IssueResolution`) onto a GitHub
 * `resolution:<state>` label (spec-the-defect-channel-reaches-no-machine-
 * but-its-own-github, Scope entry "ResolutionProjector"; AC-GI-4).
 *
 * Public surface:
 *   - `resolutionToLabel(resolution)` — pure, `resolution:<state>`.
 *   - `labelToResolution(label)` — pure inverse; `undefined` on anything
 *     that is not a real member (defensive, never throws). Case-sensitive
 *     and whitespace-sensitive — no silent normalisation, because a
 *     normalising decode would let a near-miss label (wrong case, a stray
 *     leading space someone hand-typed) silently decode to a real state
 *     instead of correctly reporting "not one of ours".
 *   - `readGithubIssueRef(extra)` — defensive reader for the GitHub
 *     pointer an issue task's `extra.issue_report.github` carries
 *     (`{repo, number, repo_id?}`), returning `undefined` when the task was
 *     never filed through the GitHub intake path (a legacy/adhoc issue
 *     report has no counterpart to project onto — this is normal, not an
 *     error). `repo_id` (spec-a-github-filed-defect-must-be-claimable-one-
 *     ingest-seam D1/D9) is read when present and OMITTED (never `undefined`)
 *     when the stored bag predates that field — see {@link GithubIssueRef}'s
 *     own doc.
 *   - `ResolutionLabelPort` — the ONE injected write capability
 *     (`setLabel(ref, label): Promise<Result<void, LoreError>>`). This
 *     module never imports a concrete GitHub client (no `GhRunner`, no
 *     `child_process`) — every caller supplies its own port, which is what
 *     keeps this module testable under vitest with zero fixtures and keeps
 *     the projector swappable behind any transport.
 *   - `ResolutionProjector` — `new ResolutionProjector(port)`, then
 *     `project(resolution, ref): Promise<Result<void, LoreError>>`.
 *
 * Invariants:
 *   - ⛔ WRITE-ONLY (Per-Field Authority table, "read back as truth: never").
 *     `project()` never reads a label back before or after writing — it
 *     hands the port the corpus-computed value and nothing else. Reading a
 *     label to detect drift is a SEPARATE concern (AC-GI-5's drift
 *     detector, a different module) and must never be folded in here: doing
 *     so would let a caller mistake "what GitHub currently shows" for "what
 *     the corpus says", which is precisely the authority inversion this
 *     spec exists to prevent.
 *   - `project()` performs EXACTLY ONE port call, unconditionally — no
 *     merge, no "only write if changed", no preservation of whatever the
 *     label previously said. A hand-edited label is simply overwritten: the
 *     corpus value is the only fact this module will ever assert.
 *   - Nine states, nine PAIRWISE-DISTINCT labels (`resolutionToLabel` is
 *     injective by construction: every member of `IssueResolution` maps to
 *     a literal `resolution:` prefix plus that exact token, and no two
 *     tokens collide). This is what makes `rejected`/`wontfix`/`superseded`
 *     — which all collide on GitHub's own `state_reason: not_planned` —
 *     stay distinguishable via the label (this spec's Overview).
 *   - `readGithubIssueRef` degrades to `undefined` on ANY malformed or
 *     absent shape rather than throwing — mirrors `issue-resolution.ts`'s
 *     own defensive-read convention for the same `extra.issue_report` bag
 *     (untyped passthrough storage, never Zod-validated at this layer).
 *
 * Side-effect class: `resolutionToLabel`/`labelToResolution`/
 *   `readGithubIssueRef` are pure. `ResolutionProjector.project` is IO, but
 *   ONLY via the injected `ResolutionLabelPort` — this module itself never
 *   touches the network, a subprocess, or the filesystem.
 *
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github,
 *   Scope "ResolutionProjector", Per-Field Authority table, AC-GI-4.
 */

import { err, ok, ISSUE_RESOLUTION_MEMBERS } from "@lore/core";
import type { IssueResolution, LoreError, Result } from "@lore/core";

/** The literal prefix every resolution label carries — the only construction site of that prefix in this module. */
const RESOLUTION_LABEL_PREFIX = "resolution:";

/** The 9-state vocabulary as a membership set, for `labelToResolution`'s decode check — never a second array literal. */
const ISSUE_RESOLUTION_MEMBER_SET: ReadonlySet<string> = new Set(ISSUE_RESOLUTION_MEMBERS);

/**
 * Projects a corpus-computed resolution onto its GitHub label — pure,
 * total, injective (see this module's own "nine pairwise-distinct labels"
 * invariant above).
 *
 * @param resolution - any member of the 9-state `IssueResolution` vocabulary
 * @returns the label, always `resolution:<resolution>`
 * @example
 *   resolutionToLabel("fixed") // => "resolution:fixed"
 *   resolutionToLabel("open")  // => "resolution:open"
 */
export function resolutionToLabel(resolution: IssueResolution): string {
  return `${RESOLUTION_LABEL_PREFIX}${resolution}`;
}

/**
 * The pure inverse of {@link resolutionToLabel} — defensive, never throws.
 * Case-sensitive and whitespace-sensitive by construction (a plain
 * substring check, no `.trim()`/`.toLowerCase()` anywhere in this
 * function): a label that is merely CLOSE to a real one (wrong case, a
 * stray space) must decode to "not one of ours", never to a guessed
 * nearest match.
 *
 * @param label - any string; only an exact `resolution:<member>` shape decodes
 * @returns the matching {@link IssueResolution}, or `undefined` when `label`
 *   does not name a real member of the vocabulary
 * @example
 *   labelToResolution("resolution:fixed")       // => "fixed"
 *   labelToResolution("resolution:not-a-state") // => undefined
 *   labelToResolution("Resolution:fixed")       // => undefined (case-sensitive)
 *   labelToResolution("resolution: fixed")      // => undefined (whitespace-sensitive)
 */
export function labelToResolution(label: string): IssueResolution | undefined {
  if (!label.startsWith(RESOLUTION_LABEL_PREFIX)) return undefined;
  const candidate = label.slice(RESOLUTION_LABEL_PREFIX.length);
  return ISSUE_RESOLUTION_MEMBER_SET.has(candidate) ? (candidate as IssueResolution) : undefined;
}

/**
 * An issue task's GitHub counterpart — the target `project()` writes the
 * label onto, and (D4) the type `issue-task-shaping.ts::toIssueTaskInput`
 * imports rather than re-declaring its own `{repo, number}` shape.
 */
export interface GithubIssueRef {
  readonly repo: string;
  readonly issueNumber: number;
  /**
   * D1's rename-proof identity fact — GitHub's own numeric repository id
   * (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam D1/D9).
   * OPTIONAL: a ref read off a task written BEFORE this field existed
   * carries none, and {@link readGithubIssueRef} degrades that case to an
   * omitted key (never `repo_id: undefined`) rather than fabricating one.
   * A freshly-minted ref (`issue-task-shaping.ts::toIssueTaskInput`, going
   * forward) always carries it — that module refuses to proceed without it.
   */
  readonly repo_id?: number;
}

/**
 * Defensive reader for an issue task's GitHub pointer
 * (`extra.issue_report.github`), mirroring `issue-resolution.ts`'s own
 * `hasIssueReport`/`readExplicitResolutionState` guard shape: a malformed
 * or absent shape degrades to `undefined`, never a throw.
 *
 * `undefined` is a legitimate, expected outcome — not every issue task was
 * filed through the GitHub intake path (a pre-migration or purely local
 * `--adhoc` report has nothing to project a label onto), so a caller must
 * treat a missing ref as "nothing to do here", never as a malformed-data
 * error.
 *
 * @param extra - a doc's raw `extra` field (untyped storage)
 * @returns the `{repo, issueNumber, repo_id?}` pointer, or `undefined` when
 *   absent or malformed. `repo_id` is present iff the stored bag carries a
 *   numeric `repo_id` (D1) — otherwise the key is OMITTED, never set to
 *   `undefined` (`exactOptionalPropertyTypes`).
 * @example
 *   readGithubIssueRef({issue_report: {github: {repo: "acme/widget", number: 42, repo_id: 12345}}})
 *     // => {repo: "acme/widget", issueNumber: 42, repo_id: 12345}
 *   readGithubIssueRef({issue_report: {github: {repo: "acme/widget", number: 42}}})
 *     // => {repo: "acme/widget", issueNumber: 42} (pre-D1 shape — no repo_id key at all)
 *   readGithubIssueRef({issue_report: {}}) // => undefined (never filed via GitHub)
 *   readGithubIssueRef({})                 // => undefined
 *   readGithubIssueRef(null)               // => undefined
 */
export function readGithubIssueRef(extra: unknown): GithubIssueRef | undefined {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return undefined;
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) return undefined;
  const github = (issueReport as Record<string, unknown>)["github"];
  if (github === null || typeof github !== "object" || Array.isArray(github)) return undefined;
  const repo = (github as Record<string, unknown>)["repo"];
  const issueNumber = (github as Record<string, unknown>)["number"];
  if (typeof repo !== "string" || repo.length === 0 || typeof issueNumber !== "number") return undefined;
  const repoId = (github as Record<string, unknown>)["repo_id"];
  if (typeof repoId === "number") {
    return { repo, issueNumber, repo_id: repoId };
  }
  return { repo, issueNumber };
}

/**
 * The ONE injected write capability {@link ResolutionProjector} depends on.
 * Every real implementation (a subprocess-backed CLI seam, a REST client,
 * whatever P2's GitHub-intake work eventually supplies) lives OUTSIDE this
 * module — `resolution-projector.ts` never imports a concrete GitHub
 * client, so it stays testable with a plain injected double and swappable
 * behind any transport.
 */
export interface ResolutionLabelPort {
  /**
   * Sets the target issue's resolution label to exactly `label`, replacing
   * whatever was there before (no merge, no read-first). Never rejects —
   * every failure (network, auth, rate limit) is classified into a
   * `LoreError` and returned as `err(...)`, mirroring this repo's "no
   * exceptions cross a service boundary" convention.
   */
  setLabel(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>>;
}

/**
 * The one-way projector: corpus-computed resolution → GitHub label.
 * ⛔ WRITE-ONLY — see this module's own header invariants for why `project`
 * never reads a label back, before or after writing.
 */
export class ResolutionProjector {
  private readonly port: ResolutionLabelPort;

  constructor(port: ResolutionLabelPort) {
    this.port = port;
  }

  /**
   * Projects `resolution` onto `ref`'s label via the injected port. Exactly
   * one port call, unconditionally — the corpus value always wins over
   * whatever the label previously said.
   *
   * @param resolution - the corpus-computed resolution (`computeIssueResolution`'s
   *   result — never a raw, uninspected `--state` string)
   * @param ref - the target issue's GitHub identity
   * @returns `ok(undefined)` on success; `err(loreError)` when the
   *   underlying write fails — the caller (`lore issue resolve`'s live call
   *   site) is responsible for reporting that failure loudly and for never
   *   treating it as a reason to discard the corpus verdict that was
   *   already recorded before this call.
   */
  async project(resolution: IssueResolution, ref: GithubIssueRef): Promise<Result<void, LoreError>> {
    const label = resolutionToLabel(resolution);
    const setResult = await this.port.setLabel(ref, label);
    if (!setResult.ok) return err(setResult.error);
    return ok(undefined);
  }
}
