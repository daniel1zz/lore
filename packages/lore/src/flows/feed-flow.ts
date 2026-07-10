/**
 * Feed-before-produce PULL flow (IoC vertical-slice tech-spec §4.1/§11, P4 slice) —
 * shared, surface-neutral composition behind `lore feed <checkpoint>` (CLI) and
 * `lore_feed` (MCP). Both adapters call {@link buildFeed} so the feeding-pack text is
 * assembled through EXACTLY one code path — the same {@link renderDocMarkdown}
 * MDX-splice helper and the same `buildFeedingPack`/`renderFeedingPack` primitives
 * `lore gate spec-create` uses on a rule violation
 * (`../adapters/cli/commands/gate.ts::runSpecCreateGate`) — so the two surfaces can
 * never drift on how a rule doc's (or a `--parent` doc's) markdown gets rendered into
 * a feeding-pack slice. `renderDocMarkdown` and {@link resolveParentDoc} used to be
 * private to `gate.ts`; they now live here and `gate.ts` imports them, so there is a
 * single implementation of each, not two copies that could silently diverge.
 *
 * Unlike the gate's feeding pack (built from a FAILURE — `missing` is always
 * non-empty), `lore feed` is advisory-only PULL: it always assembles with
 * `missing: []` (there is no violation to report, only "here is the governing rule
 * before you write"), and it NEVER fails the caller — an unknown checkpoint, a missing
 * approved skill, or an unresolvable `--parent` all degrade to an advisory note rather
 * than an error. This mirrors the task objective: "feed is advisory context, never a
 * gate" — exit 0 (CLI) / a non-`isError` content block (MCP), always.
 *
 * Public surface:
 *   renderDocMarkdown(app, doc)              — MDX-splice a DocRecord's content
 *   resolveParentDoc(app, idOrSlug)          — resolve an id/slug to a DocRecord,
 *                                               `null` on any failure (absent input,
 *                                               unresolvable, or store error)
 *   CHECKPOINT_PRODUCED_TYPE                 — checkpoint → produced-doc-type map;
 *                                               extend here when a new checkpoint
 *                                               gains a feed (this slice only wires
 *                                               `spec-create`)
 *   buildFeed(app, checkpoint, parentIdOrSlug?) — the full composition
 *   SESSION_RESUME_CHECKPOINT                — the `"session-resume"` checkpoint
 *                                               literal (SPEC-041 §3 D5)
 *   renderResumeFeed(resume)                 — pure `ResumeResult` → advisory text
 *   buildResumeFeed(app, opts)               — SPEC-041 S2 resume dispatch, called
 *                                               BEFORE `buildFeed`'s
 *                                               `CHECKPOINT_PRODUCED_TYPE` lookup
 *
 * @invariant `buildFeed` never throws and its result never carries a caller-visible
 *   failure signal — see module header. A checkpoint absent from
 *   `CHECKPOINT_PRODUCED_TYPE` degrades to `type: null` plus an "unknown checkpoint"
 *   note, not a thrown error.
 * @invariant `buildResumeFeed` is a SEPARATE dispatch, not a `buildFeed` branch and
 *   NOT a `CHECKPOINT_PRODUCED_TYPE` entry (SPEC-041 §3 D5) — that map's absent-key
 *   branch yields the generic "unknown checkpoint" advisory note, which would be
 *   wrong for `session-resume` (a real, wired capability, not an unknown one). Unlike
 *   `buildFeed`, `buildResumeFeed` CAN fail — `SessionService.resume`'s own contract
 *   treats an unresolvable `--plan`/`--handoff` target as a caller input error, not
 *   an advisory-degrade case (contrast with `resolveParentDoc`'s "unresolvable →
 *   null" for `buildFeed`'s optional `--parent`).
 *
 * Side-effect class: IO (corpusService reads, outlineService MDX resolution,
 *   sessionService reads — no writes)
 * Source: IoC vertical-slice tech-spec §4.1/§11, P4 slice; SPEC-041 §3 D5
 */

import type { App } from "../app.js";
import type { DocRecord, LoreError, Result } from "@lore/core";
import { err, ok } from "@lore/core";
import { buildFeedingPack, renderFeedingPack } from "../service/gate-feeding.js";
import { renderResolvedToMarkdown } from "../service/outline-service.js";
import type { ResumeHandoffRecord, ResumeResult } from "../service/session-service.js";
import { formatError } from "../adapters/cli/utils.js";

/**
 * Renders `doc.content` with MDX placeholders spliced in (`OutlineService.resolve` →
 * `renderResolvedToMarkdown`), mirroring `get.ts`'s `--raw`-off pattern. A resolution
 * failure degrades to the raw, unspliced body rather than aborting the caller — every
 * consumer of this function (the gate's violation feed, `lore feed`'s advisory pull)
 * treats the fed content as advisory context, not a hard dependency on placeholder
 * resolution succeeding.
 *
 * @param app - Wired `App` providing `outlineService`.
 * @param doc - The document whose content should be MDX-resolved.
 * @returns The MDX-spliced markdown body, or `doc.content` unchanged on any resolution failure.
 */
export async function renderDocMarkdown(app: App, doc: DocRecord): Promise<string> {
  const resolveResult = await app.outlineService.resolve(doc);
  if (!resolveResult.ok) {
    return doc.content;
  }
  return renderResolvedToMarkdown(resolveResult.value);
}

/**
 * Resolves `idOrSlug` to a full `DocRecord` via `corpusService.get`.
 *
 * @param app - Wired `App` providing `corpusService`.
 * @param idOrSlug - Candidate document id/slug, or `undefined`/blank when the caller
 *   supplied none.
 * @returns `null` when `idOrSlug` is absent/blank OR fails to resolve (unknown id/slug,
 *   store error) — callers treat "could not resolve" the same as "none supplied".
 */
export async function resolveParentDoc(
  app: App,
  idOrSlug: string | undefined,
): Promise<DocRecord | null> {
  if (idOrSlug === undefined || idOrSlug.trim() === "") {
    return null;
  }
  const result = await app.corpusService.get(idOrSlug);
  if (!result.ok) {
    return null;
  }
  return result.value.doc;
}

/**
 * Maps a `lore feed <checkpoint>` argument to the corpus doc `type` its governing
 * skill is scoped by (`extra.skill.applies_to`, `CorpusService.findFeedingSkill`).
 * This slice only wires `spec-create` (the sole checkpoint the task objective
 * requires) — add new entries here as future checkpoints gain a feed; no other code
 * in {@link buildFeed} needs to change to support them.
 */
export const CHECKPOINT_PRODUCED_TYPE: Readonly<Record<string, string>> = {
  "spec-create": "spec",
};

/** Pointer to the discovered governing skill doc — slug/title only, never its full body. */
export interface FeedSkillPointer {
  readonly slug: string;
  readonly title: string;
}

/** Result of one `buildFeed` call — the shape both the CLI `--json` output and the `lore_feed` MCP tool return. */
export interface FeedOutcome {
  /** The checkpoint argument as supplied by the caller. */
  readonly checkpoint: string;
  /** Produced-type derived from `checkpoint` via `CHECKPOINT_PRODUCED_TYPE`, or `null` for an unknown checkpoint. */
  readonly type: string | null;
  /** The discovered governing skill's pointer, or `null` when none was found (or `type` is `null`). */
  readonly skill: FeedSkillPointer | null;
  /** The advisory text to print/return — either a rendered feeding pack or a one-line note. */
  readonly feed: string;
}

/**
 * Assembles the feed-before-produce advisory pack for `checkpoint`: derives the
 * produced-type, discovers its approved governing skill
 * (`app.corpusService.findFeedingSkill`, the SAME discovery call `lore gate
 * spec-create` uses), and — when found — renders a `buildFeedingPack`/
 * `renderFeedingPack` block with `missing: []` (module header). When `--parent` /
 * `parentIdOrSlug` resolves to a doc, its MDX-resolved summary is included as the
 * pack's parent slice, via the SAME `renderDocMarkdown` helper the gate uses for its
 * own parent slice.
 *
 * Never fails: an unknown checkpoint, no approved skill, a lookup error, or an
 * unresolvable parent all degrade to an advisory note in `feed` (module invariant).
 *
 * @param app - Wired `App`.
 * @param checkpoint - The checkpoint argument, e.g. `"spec-create"`.
 * @param parentIdOrSlug - Optional `--parent` doc id/slug to include a summary of.
 * @returns A `FeedOutcome` — always resolves, never rejects.
 * @example
 * const outcome = await buildFeed(app, "spec-create", "prd-my-feature");
 * // outcome.feed starts with "[source: <skill-slug>, trust: team-authored]"
 */
export async function buildFeed(
  app: App,
  checkpoint: string,
  parentIdOrSlug?: string,
): Promise<FeedOutcome> {
  const type = CHECKPOINT_PRODUCED_TYPE[checkpoint] ?? null;
  if (type === null) {
    return { checkpoint, type: null, skill: null, feed: `unknown checkpoint: ${checkpoint}` };
  }

  const discoveryResult = await app.corpusService.findFeedingSkill(type);
  if (!discoveryResult.ok) {
    return {
      checkpoint,
      type,
      skill: null,
      feed: `no approved governing skill for ${type} (lookup failed: ${formatError(discoveryResult.error)})`,
    };
  }
  if (discoveryResult.value === null) {
    return { checkpoint, type, skill: null, feed: `no approved governing skill for ${type}` };
  }

  const skillDoc = discoveryResult.value;
  const ruleMarkdown = await renderDocMarkdown(app, skillDoc);

  const parentDoc = await resolveParentDoc(app, parentIdOrSlug);
  const parentMarkdown = parentDoc !== null ? await renderDocMarkdown(app, parentDoc) : undefined;

  const pack = buildFeedingPack({
    ruleSource: skillDoc.slug,
    ruleMarkdown,
    ...(parentMarkdown !== undefined ? { parentMarkdown } : {}),
    missing: [],
  });

  return {
    checkpoint,
    type,
    skill: { slug: skillDoc.slug, title: skillDoc.title },
    feed: renderFeedingPack(pack),
  };
}

// ─── SPEC-041 S2: session-resume dispatch (D5) ─────────────────────────────

/**
 * The `checkpoint` literal `lore feed`/`lore_feed` special-case to the SPEC-041 S2
 * resume read path instead of the gate-checkpoint pull path above. Deliberately
 * NOT a `CHECKPOINT_PRODUCED_TYPE` entry — see module invariants.
 */
export const SESSION_RESUME_CHECKPOINT = "session-resume";

/** Result of a `session-resume` feed dispatch (`buildResumeFeed`). */
export interface ResumeFeedOutcome {
  readonly checkpoint: typeof SESSION_RESUME_CHECKPOINT;
  readonly resume: ResumeResult;
  /** The advisory text to print/return — rendered handoff content(s) + age/TTL + readiness. */
  readonly feed: string;
}

/** Renders one resolved handoff record: header line, age, TTL/degraded markers, full content. */
function renderResumeRecord(record: ResumeHandoffRecord): string {
  const lines: string[] = [];
  const planPart = record.plan_slug !== null ? `, plan ${record.plan_slug}` : "";
  lines.push(`── Handoff ${record.handoff_slug} (by ${record.by}${planPart}) ──`);
  lines.push(`age: ${record.age_minutes}m`);
  if (record.ttl_warning) {
    lines.push("⚠ handoff older than the configured TTL (workflow.handoff_ttl_minutes)");
  }
  if (record.degraded) {
    lines.push("(degraded — git-only capture, no recorded decisions)");
  }
  lines.push("");
  lines.push(record.content);
  return lines.join("\n");
}

/** Renders the live readiness pointer block, or `""` when `readiness` is `null`. */
function renderReadinessPointer(readiness: ResumeResult["readiness"]): string {
  if (readiness === null) return "";
  return (
    "── Readiness ──\n" +
    `${readiness.plan_slug}: ${readiness.ready}/${readiness.total} ready, ` +
    `${readiness.claimed} claimed, ${readiness.done} done`
  );
}

/**
 * Renders a `ResumeResult` into the advisory text `lore feed session-resume` /
 * `lore_feed {checkpoint: "session-resume"}` print — the full handoff content(s)
 * (the one deliberate pointers-only exception, SPEC-041 §3 D5), an age line, a
 * TTL-warning marker when stale, a live readiness pointer block, and a
 * multi-actor header when the result spans more than one actor (divergent state
 * is surfaced, never silently collapsed). Pure — no IO, no wall-clock reads (all
 * of `resume`'s time-derived fields are already computed).
 *
 * @param resume - A `SessionService.resume` result.
 * @returns `"(no handoff recorded)"` when `!resume.found`; otherwise the rendered text.
 */
export function renderResumeFeed(resume: ResumeResult): string {
  if (!resume.found) {
    return "(no handoff recorded)";
  }
  if (resume.multi_actor) {
    const records = resume.handoffs ?? [];
    const header = `${records.length} actors have handoffs`;
    const body = records.map(renderResumeRecord).join("\n\n");
    return [header, "", body, renderReadinessPointer(resume.readiness)].filter((s) => s !== "").join("\n\n");
  }
  const record = resume.handoff;
  if (record === undefined) {
    return "(no handoff recorded)";
  }
  return [renderResumeRecord(record), renderReadinessPointer(resume.readiness)]
    .filter((s) => s !== "")
    .join("\n\n");
}

/**
 * Dispatches the `session-resume` checkpoint to `SessionService.resume` — the
 * SPEC-041 §3 D5 branch both `lore feed`/`lore_feed` consult BEFORE the
 * `CHECKPOINT_PRODUCED_TYPE` gate-checkpoint lookup (`buildFeed` above). Unlike
 * `buildFeed` (never fails — advisory-only), this CAN fail: an unresolvable
 * `--plan`/`--handoff` target is `SessionService.resume`'s own documented input
 * error, not a "no handoff yet" fact.
 *
 * @param app - Wired `App` providing `sessionService`.
 * @param opts - `{plan?, handoff?, by?}`, forwarded to `SessionService.resume` untouched.
 * @returns `ok(ResumeFeedOutcome)`, or `err(LoreError)` on an unresolvable target,
 *   a `SessionService.resume` store error, or a missing `sessionService` (an
 *   `App` test stub that omits it — see `app.ts`'s `sessionService?` JSDoc).
 * @example
 * const result = await buildResumeFeed(app, { plan: "plan-session-layer" });
 * if (result.ok) console.log(result.value.feed);
 */
export async function buildResumeFeed(
  app: App,
  opts: { plan?: string; handoff?: string; by?: string },
): Promise<Result<ResumeFeedOutcome, LoreError>> {
  if (app.sessionService === undefined) {
    return err({
      code: "STORE_ERROR",
      message: "Internal error: SessionService not wired on App",
    });
  }
  const result = await app.sessionService.resume(opts);
  if (!result.ok) return result;
  return ok({
    checkpoint: SESSION_RESUME_CHECKPOINT,
    resume: result.value,
    feed: renderResumeFeed(result.value),
  });
}
