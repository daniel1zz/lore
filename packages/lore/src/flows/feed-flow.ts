/**
 * Feed-before-produce PULL flow (IoC vertical-slice tech-spec §4.1/§11, P4 slice) —
 * shared, surface-neutral composition behind `lore feed <checkpoint>` (CLI).
 * Callers use {@link buildFeed} so the feeding-pack text is
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
 * gate" — exit 0 (CLI), always.
 *
 * Public surface:
 *   renderDocMarkdown(app, doc)              — MDX-splice a DocRecord's content,
 *                                               banner-prefixed and structured-`extra`
 *                                               loss-ANNOUNCING (see its own doc)
 *   renderDocBodyWithoutLossNotice(app, doc) — the same MINUS the loss notice; ⛔ ONE
 *                                               legitimate caller (`commands/get.ts`),
 *                                               which welds the notice itself so its
 *                                               `(no content)` placeholder and `--raw`
 *                                               path stay byte-identical
 *   resolveParentDoc(app, idOrSlug)          — resolve an id/slug to a DocRecord,
 *                                               `null` on any failure (absent input,
 *                                               unresolvable, or store error)
 *   CHECKPOINT_PRODUCED_TYPE                 — checkpoint → CURATED produced-doc-type
 *                                               map; extend here when a checkpoint's
 *                                               feed should discover a skill scoped by
 *                                               a doc TYPE rather than its own name
 *                                               (this slice only wires `spec-create`).
 *                                               A checkpoint absent here but present in
 *                                               `checkpointRegistry` still gets a real
 *                                               `buildFeed` discovery pass — scoped by
 *                                               its OWN name — task-derive-lore-feed-
 *                                               s-checkpoint-set-from-the-registry-make.
 *   buildFeed(app, checkpoint, parentIdOrSlug?) — the full composition; accepted-set
 *                                               is `CHECKPOINT_PRODUCED_TYPE` keys
 *                                               UNION `checkpointRegistry` keys (D1)
 *   SESSION_RESUME_CHECKPOINT                — the `"session-resume"` checkpoint
 *                                               literal (SPEC-041 §3 D5)
 *   renderResumeFeed(resume, suppressFloor?, authorshipUndeterminedNote?) — pure
 *                                               `ResumeResult` → advisory text, closing
 *                                               with `RESUME_SCOPE_CLOSURE` whenever a
 *                                               ticket is actually rendered
 *                                               (spec-context-provenance-injected-corpus-global-state-and-a
 *                                               D3). `suppressFloor` (default `false`,
 *                                               task-verifying-a-handoff-you-just-authored-arms-the-coverage
 *                                               D1) withholds `RESUME_COVERAGE_FLOOR`
 *                                               on the single-record path when `true`.
 *                                               `authorshipUndeterminedNote` (optional,
 *                                               task-the-session-start-marker-collapses-five-distinct
 *                                               AC 3) — when supplied, inserted on the
 *                                               single-record path BEFORE the floor,
 *                                               stating that same-session authorship
 *                                               could not be determined and the floor
 *                                               therefore armed unconditionally. Both
 *                                               are computed by `buildResumeFeed` below,
 *                                               NEVER by this function itself (stays
 *                                               pure).
 *   buildResumeFeed(app, opts)               — SPEC-041 S2 resume dispatch, called
 *                                               BEFORE `buildFeed`'s
 *                                               `CHECKPOINT_PRODUCED_TYPE` lookup. Also
 *                                               computes the same-session-authorship
 *                                               `suppressFloor` decision (D1 below) via
 *                                               the ONE new IO read in this module: the
 *                                               SessionStart hook's marker file — now a
 *                                               DISCRIMINATED read
 *                                               ({@link readSessionStartIso}, task-the-
 *                                               session-start-marker-collapses-five-distinct
 *                                               AC 1), so a non-`"measured"` outcome
 *                                               (never distinguishable from a genuinely
 *                                               different session before that task) is
 *                                               surfaced via `authorshipUndeterminedNote`
 *                                               rather than silently collapsed.
 *   SPECIAL_FEED_CHECKPOINTS                 — SPEC-070 Fix F7 SSOT: the special
 *                                               checkpoint set (session-resume/
 *                                               phase-start/task-start) + which
 *                                               field each requires, consumed by
 *                                               `commands/feed.ts`
 *   assertHandlersCoverDescriptor(d, h)      — fail-loud coverage check, called by
 *                                               `commands/feed.ts` at module init
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
 * @invariant `renderResumeFeed`'s `RESUME_SCOPE_CLOSURE` block is woven in at exactly
 *   ONE place (spec-context-provenance-injected-corpus-global-state-and-a D3) —
 *   `commands/feed.ts`'s `handleSessionResume` prints `buildResumeFeed`'s
 *   `.feed` verbatim to stdout; any other call site consumes the SAME
 *   `ResumeFeedOutcome` (`.feed` field included). No call site re-derives
 *   or duplicates the closure text — a surface that rendered its own copy is
 *   exactly the dual-write failure class this spec exists to close.
 * @invariant `renderResumeFeed`'s single-record path additionally appends
 *   `RESUME_COVERAGE_FLOOR` (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 *   D3, D10) — BEFORE `RESUME_SCOPE_CLOSURE` in the joined array, so
 *   `RESUME_SCOPE_CLOSURE` stays the trailing block (pinned by
 *   `tests/integration/cli-feed-task-start.bun.test.ts`'s
 *   `stdout.endsWith(RESUME_SCOPE_CLOSURE + "\n")` REGRESSION assertion,
 *   predating this task). The `multi_actor` branch does NOT append the floor
 *   (D10 — N records collide on `KD1`; the ordinal ids and a per-record
 *   cardinality line are already present because they are baked into each
 *   record's `content` by `renderHandoffContent`, `@lore/core`'s SSOT
 *   projection point — this module renders NO items itself, see
 *   `renderResumeRecord` below).
 * @invariant `buildResumeFeed`'s `suppressFloor` decision
 *   (task-verifying-a-handoff-you-just-authored-arms-the-coverage D1) is the
 *   ONLY place this module reads a wall clock's persisted trace or the
 *   filesystem beyond `app`'s own store — `readSessionStartIso` below reads
 *   the marker under the caller-supplied temp dir for the SessionStart hook's marker
 *   (`assets/hooks/session-start-marker.mjs`), never `app.corpusService` —
 *   the marker is a session-scoped fact, orthogonal to the corpus.
 *   `readSessionStartIso` returns a DISCRIMINATED `SessionStartReadResult`
 *   (task-the-session-start-marker-collapses-five-distinct AC 1) — the
 *   PRE-existing collapse of five distinct conditions (no session-id env
 *   var, no marker file, corrupt JSON, wrong-typed `started_at`, any IO
 *   error) into one `string | undefined` made "measured: a different
 *   session" indistinguishable from "never measured at all", which is
 *   exactly the "an empty result and a clean result must not be the same
 *   value" failure the governing proxy/silence/opt-in ADR names. Every
 *   non-`"measured"` kind still feeds `isSameSessionAuthorship` (`@lore/core`)
 *   an `undefined` `sessionStartIso` — that function is fail-safe on
 *   `undefined` (arms, never suppresses, ADR "Q2 Silence" review) — so the
 *   ARMING VERDICT for every non-measured kind is byte-identical to before
 *   this task (AC 2). What changed is OBSERVABILITY only:
 *   `buildResumeFeed` also derives a one-line `authorshipUndeterminedNote`
 *   from the non-measured kind (AC 3) and passes it to `renderResumeFeed`,
 *   and additionally writes one stderr line for the `"unreadable"` kind — a
 *   corrupt/wrong-typed marker is a real fault, not a normal steady state.
 *   `renderResumeFeed` itself performs NO IO for either decision — it only
 *   consumes the already-computed boolean/string, so it stays pure/testable
 *   exactly as before this task.
 *
 * Side-effect class: IO (corpusService reads, outlineService MDX resolution,
 *   sessionService reads, temp-dir marker read for `suppressFloor` — no
 *   writes, except one advisory stderr line when the marker is unreadable)
 * Source: IoC vertical-slice tech-spec §4.1/§11, P4 slice; SPEC-041 §3 D5;
 *   spec-context-provenance-injected-corpus-global-state-and-a D3;
 *   spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D3, D10;
 *   task-verifying-a-handoff-you-just-authored-arms-the-coverage D1, D2;
 *   task-the-session-start-marker-collapses-five-distinct AC 1-6
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "../app.js";
import type { DocRecord, Invocation, LoreError, Result } from "@lore/core";
import {
  err,
  ok,
  isSameSessionAuthorship,
  sessionStartMarkerFilename,
  RESUME_COVERAGE_FLOOR,
  RESUME_SCOPE_CLOSURE,
} from "@lore/core";
import { buildFeedingPack, renderFeedingPack } from "../service/gate-feeding.js";
import { resolveRuleSlice } from "../service/template-rule-slice.js";
import { isRegisteredCheckpoint } from "../service/checkpoint-registry.js";
import { renderResolvedToMarkdown } from "../service/outline-service.js";
import type { ResumeHandoffRecord, ResumeResult } from "../service/session-service.js";
import { formatError } from "../adapters/cli/utils.js";
import {
  composeWithStructuredExtraNotice,
  type RenderedBodyFacts,
} from "../adapters/cli/get-render.js";
import { PHASE_START_CHECKPOINT } from "./phase-feed-flow.js";
import { TASK_START_CHECKPOINT } from "./task-feed-flow.js";

/** Time seam (SPEC-043 D3/D4 convention) — never `Date.now()` read directly. */
const defaultNow = (): string => new Date().toISOString();

/** One MDX-splice pass: the body, plus the facts the loss notice's exclusion set derives from. */
interface RenderedDocBody {
  /** The MDX-spliced body — `doc.content` verbatim when resolution failed. */
  readonly body: string;
  /** The SPEC-043 D4 invalidation banner, or `undefined` when `doc` is live. */
  readonly banner: string | undefined;
  /** What this render actually surfaced — never a hardcoded key-name guess. */
  readonly facts: RenderedBodyFacts;
}

/**
 * The ONE MDX-splice + banner pass both public entry points share, so they can never
 * disagree about the body OR about which `extra` keys this render already surfaced.
 *
 * `facts.mdxResolved` is unconditionally `true` here: unlike `lore get --raw`, this path
 * always attempts resolution AND always evaluates the banner, so the banner's presence is
 * exactly `isInvalidated(doc, nowIso)` — the same predicate
 * `findExtraKeysAlreadyRendered` re-applies to decide whether `validity` was surfaced.
 */
async function renderDocBodyPass(app: App, doc: DocRecord, nowIso: string): Promise<RenderedDocBody> {
  const resolveResult = await app.outlineService.resolve(doc);
  const body = resolveResult.ok ? renderResolvedToMarkdown(resolveResult.value) : doc.content;
  const banner = await app.outlineService.resolveValidityBanner(doc, () => nowIso);
  return {
    body,
    banner,
    facts: {
      mdxResolved: true,
      // The projection's OWN verdict on whether it appended its SPEC-038 / SPEC-045
      // block. ⛔ Never re-derived from `doc.type` + a second schema parse: the two
      // would drift and the notice would claim a loss that did not happen. A FAILED
      // resolve surfaced neither block, so both are `false` and both keys are announced.
      acceptanceCriteriaProjected: resolveResult.ok && resolveResult.value.acceptanceCriteria !== undefined,
      codeAnchorsProjected: resolveResult.ok && resolveResult.value.codeAnchors !== undefined,
      nowIso,
    },
  };
}

/**
 * The SHARED doc→markdown seam every feeding-pack surface routes through: MDX-spliced
 * body (`OutlineService.resolve` → `renderResolvedToMarkdown`), SPEC-043 D4 invalidation
 * banner, and the structured-`extra` LOSS NOTICE. A resolution failure degrades to the
 * raw, unspliced body rather than aborting the caller — every consumer treats the fed
 * content as advisory context, not a hard dependency on placeholder resolution.
 *
 * ⛔ THE LOSS NOTICE IS PART OF THIS SEAM'S CONTRACT, not a per-consumer add-on
 * (task-the-shared-renderdocmarkdown-seam-still-drops-structured). The notice first
 * shipped on ONE consumer (`commands/get.ts`), leaving `lore feed`'s advisory pack and
 * the feeding pack pushed back with a GATE DENIAL silently dropping every structured
 * `extra` value — `issue_report`, `verification_evidence`, `claim`, `ac_scope` — to a
 * reader that is a MACHINE mid-write, acting on the pack alone. Producing it HERE means a
 * FUTURE fourth consumer inherits it with no edit, and there is no per-consumer opt-in to
 * forget. It is composed from `adapters/cli/get-render.ts`'s already-shipped key-agnostic
 * formatter — ⛔ never a second implementation.
 *
 * Output order is `banner → notice → body`, both meta annotations LEADING. That is not
 * cosmetic: `service/gate-feeding.ts` quotes a LEADING SLICE capped at
 * `DEFAULT_FEEDING_MAX_CHARS` (800), so a trailing notice is cut from every doc longer
 * than that — which is essentially every real spec/PRD. A bottom-placed notice would pass
 * a short-fixture test and stay silent in production.
 *
 * @param app - Wired `App` providing `outlineService`.
 * @param doc - The document whose content should be MDX-resolved.
 * @param now - Time seam (D3) — defaults to `() => new Date().toISOString()`.
 * @returns The banner-prefixed, notice-annotated, MDX-spliced markdown.
 */
export async function renderDocMarkdown(
  app: App,
  doc: DocRecord,
  now: () => string = defaultNow,
): Promise<string> {
  const { body, banner, facts } = await renderDocBodyPass(app, doc, now());
  const annotated = composeWithStructuredExtraNotice(body, doc, facts, "above-body");
  return banner !== undefined ? `${banner}\n\n${annotated}` : annotated;
}

/**
 * The SAME render as {@link renderDocMarkdown} MINUS the structured-`extra` loss notice.
 *
 * ⛔ ONE legitimate caller: `adapters/cli/commands/get.ts`. It is NOT exempt from
 * announcing — it announces via the SAME `get-render.ts` formatter — but it must weld the
 * notice itself, for two reasons the seam cannot serve:
 *   1. it substitutes `(no content)` for an empty body, and that placeholder has to sit
 *      BETWEEN the body and the notice to keep `lore get`'s output byte-identical;
 *   2. its `--raw` path never calls this seam at all, yet a `--raw` reader is equally
 *      blind, so the notice has to be welded outside the resolved branch.
 * Calling this from anywhere else silently reintroduces the exact defect
 * task-the-shared-renderdocmarkdown-seam-still-drops-structured closed — the name says
 * so out loud precisely so a future caller cannot pick it by accident. A wiring
 * REGRESSION test pins the caller set.
 *
 * @param app - Wired `App` providing `outlineService`.
 * @param doc - The document whose content should be MDX-resolved.
 * @param now - Time seam (D3) — defaults to `() => new Date().toISOString()`.
 * @returns The banner-prefixed, MDX-spliced markdown body, with NO loss notice.
 */
export async function renderDocBodyWithoutLossNotice(
  app: App,
  doc: DocRecord,
  now: () => string = defaultNow,
): Promise<string> {
  const { body, banner } = await renderDocBodyPass(app, doc, now());
  return banner !== undefined ? `${banner}\n\n${body}` : body;
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
 * Add new entries here as future checkpoints gain a feed; no other code in
 * {@link buildFeed} needs to change to support them.
 *
 * `"phase-start"` (SPEC-056 §Design Decisions D5) is registered here as the SSOT
 * entry point — never a parallel dispatch path — even though its actual assembly
 * (`phase-feed-flow.ts::buildPhaseStartPack`) is a phase-specific composition
 * distinct from `buildFeed`'s generic skill-discovery pull; wiring the dispatch
 * branch that calls it is a separate task, out of this map's own scope.
 *
 * `"task-start"` (SPEC-070 §Design Decisions D1) is registered the SAME way —
 * `task-feed-flow.ts::buildTaskStartPack` is its own dedicated composition, dispatched
 * by `commands/feed.ts` BEFORE this map's generic `buildFeed` path is ever consulted.
 */
export const CHECKPOINT_PRODUCED_TYPE: Readonly<Record<string, string>> = {
  "spec-create": "spec",
  "phase-start": "phase",
  "task-start": "task",
};

/** Pointer to the discovered governing skill doc — slug/title only, never its full body. */
export interface FeedSkillPointer {
  readonly slug: string;
  readonly title: string;
}

/** Result of one `buildFeed` call — the shape the CLI `--json` output returns. */
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
 * The discovery+render pass shared by every `buildFeed` branch that has SOME
 * `applies_to` discovery scope to try — `discoveryScope` equals
 * `CHECKPOINT_PRODUCED_TYPE[checkpoint]` for a CURATED checkpoint (today: only
 * `"spec-create"` reaches this from `buildFeed`; `"phase-start"`/`"task-start"`
 * hold curated entries too but never reach here in production — module
 * invariant above), or the checkpoint's OWN NAME, unchanged, for a checkpoint
 * registered in `checkpointRegistry` with no curated produced-type mapping
 * (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make, D1 — the same
 * derivation principle as `isRegisteredCheckpoint`: no second hand-maintained
 * scope list). `FeedOutcome.type` is always set to `discoveryScope` — for
 * `spec-create` this is byte-identical to before that task; for every OTHER
 * registered checkpoint it is the checkpoint's own name, since no doc-type-
 * scoped produced-type mapping exists for it (yet — a team may seed one by
 * approving a `knowledge/skill` doc with `extra.skill.applies_to:
 * "<checkpoint-name>"`, discovered here exactly the same way `spec-create`'s
 * `applies_to: "spec"` already is).
 *
 * @param app - Wired `App`.
 * @param checkpoint - The checkpoint argument, as the caller supplied it.
 * @param discoveryScope - The `extra.skill.applies_to` scope to discover a
 *   governing skill doc by.
 * @param parentIdOrSlug - Optional `--parent` doc id/slug to include a summary of.
 * @returns A `FeedOutcome` — always resolves, never rejects (module invariant).
 */
async function buildDiscoveredFeed(
  app: App,
  checkpoint: string,
  discoveryScope: string,
  parentIdOrSlug?: string,
): Promise<FeedOutcome> {
  const discoveryResult = await app.corpusService.findFeedingSkill(discoveryScope);
  if (!discoveryResult.ok) {
    return {
      checkpoint,
      type: discoveryScope,
      skill: null,
      feed: `no approved governing skill for ${discoveryScope} (lookup failed: ${formatError(discoveryResult.error)})`,
    };
  }
  if (discoveryResult.value === null) {
    return { checkpoint, type: discoveryScope, skill: null, feed: `no approved governing skill for ${discoveryScope}` };
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
    type: discoveryScope,
    skill: { slug: skillDoc.slug, title: skillDoc.title },
    feed: renderFeedingPack(pack),
  };
}

/**
 * The feed of a checkpoint whose governing rule is the approved template of `docType`/`kind`: a pack with
 * `missing: []` quoting the template's compact rule slice, plus the `--parent` slice when it resolves.
 *
 * @returns a `FeedOutcome` with `skill: null` (no governing skill document); always resolves
 */
async function buildTemplateFeed(
  app: App,
  checkpoint: string,
  docType: string,
  kind: string,
  parentIdOrSlug?: string,
): Promise<FeedOutcome> {
  if (app.templateService === undefined) {
    return { checkpoint, type: docType, skill: null, feed: `no rule available for ${docType}: TemplateService is not wired on this App` };
  }
  const slice = await resolveRuleSlice(app.templateService, docType, kind);
  const parentDoc = await resolveParentDoc(app, parentIdOrSlug);
  const parentMarkdown = parentDoc !== null ? await renderDocMarkdown(app, parentDoc) : undefined;
  const pack = buildFeedingPack({
    ruleSource: slice.source,
    ruleMarkdown: slice.markdown,
    ...(parentMarkdown !== undefined ? { parentMarkdown } : {}),
    missing: [],
  });
  return { checkpoint, type: docType, skill: null, feed: renderFeedingPack(pack) };
}

/**
 * Assembles the feed-before-produce advisory pack for `checkpoint`: derives the
 * discovery scope, discovers its approved governing skill
 * (`app.corpusService.findFeedingSkill`, the SAME discovery call `lore gate
 * spec-create` uses), and — when found — renders a `buildFeedingPack`/
 * `renderFeedingPack` block with `missing: []` (module header). When `--parent` /
 * `parentIdOrSlug` resolves to a doc, its MDX-resolved summary is included as the
 * pack's parent slice, via the SAME `renderDocMarkdown` helper the gate uses for its
 * own parent slice.
 *
 * ⛔ D1 (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make): the
 * accepted-checkpoint set for the "real, feedable" branch is
 * `CHECKPOINT_PRODUCED_TYPE`'s keys UNION `checkpointRegistry`'s keys — DERIVED
 * from those two SSOTs, never a THIRD hand-maintained list. A checkpoint absent
 * from BOTH degrades to the pre-existing `type: null` / `"unknown checkpoint:
 * ..."` advisory note (unchanged — see this module's own invariant above and
 * a regression pinning that exact text for an unrecognized
 * name); `commands/feed.ts`'s CLI dispatch additionally refuses that same case
 * with exit 2 BEFORE ever calling this function (AC-FR-1's sharper half) — this
 * function itself stays advisory-only and never fails, keeping its "always
 * succeeds" contract.
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
 * @example
 * const outcome = await buildFeed(app, "spec-promote");
 * // outcome.type === "spec-promote" — no curated CHECKPOINT_PRODUCED_TYPE
 * // entry, so discovery scope defaults to the checkpoint's own name.
 */
export async function buildFeed(
  app: App,
  checkpoint: string,
  parentIdOrSlug?: string,
): Promise<FeedOutcome> {
  // reason: the rule a spec author is fed before writing is the approved TEMPLATE (the `feature` kind, the create-time
  // default; the slice points at `lore template show spec --kind <kind>` for the others). The spec-rules corpus document is
  // retired (spec-every-document-is-stored-as-structured-fields-validated-by, "One source"); a pull that finds no template
  // says so in the pack rather than quoting an invented rule.
  if (checkpoint === "spec-create") return buildTemplateFeed(app, checkpoint, "spec", "feature", parentIdOrSlug);
  const curatedType = CHECKPOINT_PRODUCED_TYPE[checkpoint];
  if (curatedType !== undefined) {
    return buildDiscoveredFeed(app, checkpoint, curatedType, parentIdOrSlug);
  }

  if (isRegisteredCheckpoint(checkpoint)) {
    return buildDiscoveredFeed(app, checkpoint, checkpoint, parentIdOrSlug);
  }

  return { checkpoint, type: null, skill: null, feed: `unknown checkpoint: ${checkpoint}` };
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

/**
 * Renders one resolved handoff record: header line, age, TTL/degraded markers, full
 * content. `record.content` is printed VERBATIM, never parsed or re-rendered — it is
 * `@lore/core`'s `renderHandoffContent` SSOT projection, and by the time it reaches
 * here it already carries the resume-ticket ordinal `KD<n>`/`NS<n>` lines and the
 * per-record cardinality line (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * D1 — that spec's own text names this exact function as the shape an earlier draft
 * wrongly assigned item-rendering to; `renderHandoffContent` is unbuildable-around here
 * because `ResumeHandoffRecord` never carries the underlying structured decision/
 * next-step arrays, only their pre-rendered projection — AC-RC-6 pins this function's
 * file to zero traversal of those arrays and zero use of the item-id prefix
 * constants, so this comment deliberately avoids spelling either field's exact
 * identifier).
 */
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
 * TTL-warning marker when stale, a live readiness pointer block, a
 * multi-actor header when the result spans more than one actor (divergent state
 * is surfaced, never silently collapsed), and — whenever an actual ticket is
 * rendered — the {@link RESUME_SCOPE_CLOSURE} boundary block
 * (spec-context-provenance-injected-corpus-global-state-and-a D3), plus, on the
 * SINGLE-record path only, {@link RESUME_COVERAGE_FLOOR}
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D3, D10). Pure —
 * no IO, no wall-clock reads (all of `resume`'s time-derived fields are already
 * computed), and this function itself renders no items — see
 * {@link renderResumeRecord}'s own doc for why the ordinals live one layer
 * lower, in `@lore/core`'s `renderHandoffContent`.
 *
 * `lore feed`/`commands/feed.ts` (CLI stdout) prints this string via
 * {@link buildResumeFeed} below — this is the ONE place the closure is woven
 * in, so the two surfaces cannot drift on whether it's present (module
 * invariant; the defect class this constant exists to close was measured
 * exactly here, on a render path with two call sites).
 *
 * @invariant The closure is appended ONLY when a real ticket is rendered
 *   (`resume.found === true`) — the `"(no handoff recorded)"` advisory note
 *   is not itself a resume ticket, so it carries no scope to close (pinned
 *   REGRESSION: `tests/integration/cli-feed-task-start.bun.test.ts`'s
 *   "session-resume with no handoff recorded still prints '(no handoff
 *   recorded)'" byte-exact assertion, predating this task, stays green).
 * @invariant `RESUME_COVERAGE_FLOOR` is appended BEFORE `RESUME_SCOPE_CLOSURE`
 *   (not after) on the single-record path — `RESUME_SCOPE_CLOSURE` must stay
 *   the trailing block, pinned by the SAME integration file's
 *   `stdout.endsWith(RESUME_SCOPE_CLOSURE + "\n")` REGRESSION assertion,
 *   predating this task. The `multi_actor` branch never appends the floor
 *   (D10) — only `RESUME_SCOPE_CLOSURE`, unchanged from before this task.
 * @invariant `suppressFloor` (task-verifying-a-handoff-you-just-authored-arms-the-coverage
 *   D1) withholds `RESUME_COVERAGE_FLOOR` on the single-record path ONLY —
 *   it has NO effect on the `multi_actor` branch (which never appends the
 *   floor regardless, D10) nor on `RESUME_SCOPE_CLOSURE` (always present
 *   whenever a ticket is rendered, unchanged by this task). Defaults to
 *   `false` (arm) so every pre-existing call site that does not pass this
 *   argument keeps today's exact behavior — this function performs NO IO to
 *   decide the value itself; {@link buildResumeFeed} computes it and passes
 *   it in, keeping this function pure/testable exactly as before.
 * @invariant `authorshipUndeterminedNote` (task-the-session-start-marker-collapses-five-distinct
 *   AC 2, AC 3) is inserted on the single-record path ONLY, BEFORE
 *   `RESUME_COVERAGE_FLOOR` — never on the `multi_actor` or not-found
 *   branches (`buildResumeFeed` only ever attempts the authorship read on
 *   the single-record found path, matching `suppressFloor`'s own scope, so
 *   this parameter and `suppressFloor` are always consistent with each
 *   other by construction, not by a runtime check here). Defaults to
 *   `undefined` (nothing inserted) so every pre-existing call site that does
 *   not pass this argument keeps today's exact byte-for-byte output — this
 *   parameter changes OBSERVABILITY only, never the `suppressFloor` verdict
 *   itself, which is computed independently and passed in unchanged.
 * @param resume - A `SessionService.resume` result.
 * @param suppressFloor - When `true` on the single-record path, omits
 *   `RESUME_COVERAGE_FLOOR` from the rendered text (default `false`).
 * @param authorshipUndeterminedNote - When supplied on the single-record
 *   path, a one-line advisory inserted before `RESUME_COVERAGE_FLOOR`
 *   stating that same-session authorship could not be determined and the
 *   floor was therefore armed unconditionally (default `undefined` — no
 *   line inserted).
 * @returns `"(no handoff recorded)"` when `!resume.found`; a multi-actor
 *   result ending in `RESUME_SCOPE_CLOSURE`; otherwise a single-record ticket
 *   carrying `authorshipUndeterminedNote` (if supplied) then
 *   `RESUME_COVERAGE_FLOOR` (unless `suppressFloor`) then
 *   `RESUME_SCOPE_CLOSURE`.
 */
export function renderResumeFeed(
  resume: ResumeResult,
  suppressFloor = false,
  authorshipUndeterminedNote?: string,
  ruleDiffBlock = "",
): string {
  if (!resume.found) {
    return ["(no handoff recorded)", ruleDiffBlock].filter((s) => s !== "").join("\n\n");
  }
  if (resume.multi_actor) {
    const records = resume.handoffs ?? [];
    const header = `${records.length} actors have handoffs`;
    const body = records.map(renderResumeRecord).join("\n\n");
    return [header, "", body, renderReadinessPointer(resume.readiness), ruleDiffBlock, RESUME_SCOPE_CLOSURE]
      .filter((s) => s !== "")
      .join("\n\n");
  }
  const record = resume.handoff;
  if (record === undefined) {
    return "(no handoff recorded)";
  }
  return [
    renderResumeRecord(record),
    renderReadinessPointer(resume.readiness),
    ruleDiffBlock,
    ...(authorshipUndeterminedNote !== undefined ? [authorshipUndeterminedNote] : []),
    ...(suppressFloor ? [] : [RESUME_COVERAGE_FLOOR]),
    RESUME_SCOPE_CLOSURE,
  ]
    .filter((s) => s !== "")
    .join("\n\n");
}

/**
 * Discriminated outcome of {@link readSessionStartIso}'s attempt to establish
 * the CURRENTLY-arming session's start-time fact
 * (task-the-session-start-marker-collapses-five-distinct AC 1). Before this
 * task, all five of the conditions below collapsed into one
 * `string | undefined` — `undefined` meant BOTH "measured: a different/
 * earlier session" AND "never measured at all", which made the whole
 * same-session-authorship mechanism (task-verifying-a-handoff-you-just-authored-arms-the-coverage
 * D1) silently, indistinguishably inert on any install that has not
 * re-run `lore setup` (steady state: `"no-session-id"` or `"no-marker"`).
 * `"measured"` is the only kind carrying a usable fact; every other kind is
 * still treated as an unknown boundary by {@link isSameSessionAuthorship}
 * (arms — Q2 fail-safe, byte-identical direction to before this task, AC 2)
 * but is now externally visible via {@link buildResumeFeed}'s
 * `authorshipUndeterminedNote`.
 */
export type SessionStartReadResult =
  | { readonly kind: "measured"; readonly startedAt: string }
  | { readonly kind: "no-session-id" }
  | { readonly kind: "no-marker" }
  | { readonly kind: "unreadable"; readonly detail: string };

/** Every {@link SessionStartReadResult} kind except `"measured"` — the shape {@link describeUnmeasuredAuthorship} accepts, so a `"measured"` result cannot be passed to it by construction. */
type UnmeasuredSessionStartReadResult = Exclude<SessionStartReadResult, { kind: "measured" }>;

/**
 * Reads the CURRENTLY-arming session's start-time marker
 * (task-verifying-a-handoff-you-just-authored-arms-the-coverage D1) —
 * written ONCE per session, idempotently, by the `SessionStart`
 * `assets/hooks/session-start-marker.mjs` hook into `os.tmpdir()`. Session
 * identity is read from `CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID` — the
 * SAME precedence `@lore/core/node`'s `resolveActorWithSource` already
 * trusts for cross-process session identity. `CLAUDE_CODE_SESSION_ID` equals the
 * hook payload's `session_id` for hook AND Bash-tool processes
 * (code.claude.com/docs/en/env-vars), so the hook-side writer and this reader
 * agree; `assets/hooks/lib/turn-state.mjs::resolveSessionId(payload)` is the
 * hook-only (payload-based) resolver and is deliberately not used here.
 *
 * Exported (task-the-session-start-marker-collapses-five-distinct AC 4) so
 * the discrimination is unit-testable directly, without simulating every
 * kind through the full `buildResumeFeed` IO wiring.
 *
 * @invariant Never throws — every failure mode maps to a `SessionStartReadResult`
 *   kind rather than propagating. `"unreadable"`'s two triggers
 *   (`JSON.parse` throwing on malformed JSON vs. a successfully-parsed value
 *   with no string `started_at`) are DISTINCT code paths (AC 4c/4d), both
 *   converging on the same kind because both mean the same thing to a
 *   caller: a marker exists but cannot be trusted.
 * @param env - Environment map (`Invocation.env`; a literal object in tests).
 * @param tmpDir - The OS temp directory the hook writes the marker under (`Invocation.paths.tmpDir`).
 * @returns The discriminated outcome — see {@link SessionStartReadResult}.
 */
export function readSessionStartIso(
  env: Readonly<Record<string, string | undefined>>,
  tmpDir: string,
): SessionStartReadResult {
  const sessionId = env["CLAUDE_CODE_SESSION_ID"] ?? env["CLAUDE_SESSION_ID"];
  if (sessionId === undefined || sessionId.trim() === "") {
    return { kind: "no-session-id" };
  }

  const markerPath = join(tmpDir, sessionStartMarkerFilename(sessionId));
  let raw: string;
  try {
    if (!existsSync(markerPath)) return { kind: "no-marker" };
    raw = readFileSync(markerPath, "utf8");
  } catch (cause) {
    return { kind: "unreadable", detail: `marker file could not be read: ${String(cause)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    // AC 4d: malformed JSON — a THROWING code path, distinct from the
    // successfully-parsed-but-wrong-shape path below (AC 4c).
    return { kind: "unreadable", detail: `marker file is not valid JSON: ${String(cause)}` };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "started_at" in parsed &&
    typeof (parsed as Record<string, unknown>)["started_at"] === "string"
  ) {
    return { kind: "measured", startedAt: (parsed as Record<string, unknown>)["started_at"] as string };
  }
  // AC 4c: parse SUCCEEDED but `started_at` is absent or non-string — a
  // NON-throwing code path, distinct from the catch block above.
  return { kind: "unreadable", detail: 'marker file has no string "started_at" field' };
}

/**
 * Renders the one-line advisory `buildResumeFeed` surfaces on the
 * `session-resume` output whenever {@link readSessionStartIso} returns
 * anything other than `"measured"` (task-the-session-start-marker-collapses-five-distinct
 * AC 3) — stating that same-session authorship could not be determined and
 * the resume-ticket coverage floor was therefore armed unconditionally. The
 * `result.kind` literal is embedded verbatim so a caller (or a test) can key
 * on the KIND VALUE from the rendered text alone, never on mere absence of
 * `RESUME_COVERAGE_FLOOR`.
 *
 * @param result - A non-`"measured"` {@link SessionStartReadResult}.
 * @returns The one-line advisory text (never empty, never throws).
 */
function describeUnmeasuredAuthorship(result: UnmeasuredSessionStartReadResult): string {
  const reason = ((): string => {
    switch (result.kind) {
      case "no-session-id":
        return "no-session-id: neither CLAUDE_CODE_SESSION_ID nor CLAUDE_SESSION_ID is set";
      case "no-marker":
        return "no-marker: the SessionStart hook's marker file was not found (hook not installed, or has not fired yet)";
      case "unreadable":
        return `unreadable: ${result.detail}`;
      default: {
        const exhaustive: never = result;
        throw new Error(`describeUnmeasuredAuthorship: unhandled session-start read kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  })();
  return `⚠ same-session authorship could not be determined (${reason}) — resume-ticket coverage floor armed unconditionally`;
}

/**
 * BL-15 (SPEC-157 AC-BLS2-22 / BR-966): the "governing rules since claim" block for every
 * claimed task in the resume's plan scope (`opts.plan`, else the readiness pointer's plan).
 * `""` when no plan scopes the resume or the plan has no claimed task — nothing to report.
 * A diff failure is an `err` (never silently dropped): the resume fails loud with it.
 */
async function buildRuleDiffBlock(
  sessions: NonNullable<App["sessionService"]>,
  opts: { plan?: string; by?: string },
  resume: ResumeResult,
): Promise<Result<string, LoreError>> {
  const planRef = opts.plan ?? resume.readiness?.plan_slug;
  if (planRef === undefined) return ok("");
  const diffs = await sessions.resumeRuleDiffs(planRef, opts.by);
  if (!diffs.ok) return diffs;
  if (diffs.value.length === 0) return ok("");
  const body = diffs.value.map((d) => [`${d.task_slug}:`, ...d.lines.map((l) => `  ${l}`)].join("\n"));
  return ok(["── Governing rules since claim ──", ...body].join("\n"));
}

/**
 * Dispatches the `session-resume` checkpoint to `SessionService.resume` — the
 * SPEC-041 §3 D5 branch both `lore feed`/`lore_feed` consult BEFORE the
 * `CHECKPOINT_PRODUCED_TYPE` gate-checkpoint lookup (`buildFeed` above). Unlike
 * `buildFeed` (never fails — advisory-only), this CAN fail: an unresolvable
 * `--plan`/`--handoff` target is `SessionService.resume`'s own documented input
 * error, not a "no handoff yet" fact.
 *
 * Also computes the `suppressFloor` decision
 * (task-verifying-a-handoff-you-just-authored-arms-the-coverage D1): on the
 * single-record, found path, this session's own resolved actor
 * (`opts.by`, else the invocation's known-party name — the SAME name every other corpus
 * write surface uses, computed here PURELY for this side-decision, never
 * forwarded to `SessionService.resume` — `opts` itself is passed through
 * untouched, so the resume/candidate-selection behavior is byte-identical to
 * before this task) plus this session's start marker
 * ({@link readSessionStartIso}) feed `isSameSessionAuthorship` (`@lore/core`).
 * A multi-record or not-found result never attempts this — `suppressFloor`
 * stays `false`, matching `renderResumeFeed`'s own default and its
 * pre-existing multi_actor behavior (D10, unchanged).
 *
 * `readSessionStartIso`'s result is now a DISCRIMINATED
 * `SessionStartReadResult` (task-the-session-start-marker-collapses-five-distinct
 * AC 1). Only `"measured"` feeds a real `startedAt` into
 * `isSameSessionAuthorship`; every other kind feeds it `undefined` — THE
 * EXACT SAME CALL, with the exact same fail-safe `sessionStartIso: undefined`
 * argument shape as before this task, so `suppressFloor`'s VERDICT for every
 * non-measured kind is byte-identical (AC 2). What this task adds on top:
 * a non-measured kind also derives a one-line `authorshipUndeterminedNote`
 * ({@link describeUnmeasuredAuthorship}) threaded into `renderResumeFeed`
 * (AC 3), and the `"unreadable"` kind additionally writes one stderr line —
 * a corrupt or wrong-typed marker is a real fault, not this mechanism's
 * normal (if inert) steady state.
 *
 * @param app - Wired `App` providing `sessionService`.
 * @param opts - `{plan?, handoff?, by?}`, forwarded to `SessionService.resume` untouched.
 * @param ambient - The invocation's `env`, `paths.tmpDir`, `cwd` and `identity`, read only to locate the SessionStart marker and name the actor
 *   (AS-26: this flow reads no ambient state itself).
 * @returns `ok(ResumeFeedOutcome)`, or `err(LoreError)` on an unresolvable target,
 *   a `SessionService.resume` store error, or a missing `sessionService` (an
 *   `App` test stub that omits it — see `app.ts`'s `sessionService?` JSDoc).
 * @example
 * const result = await buildResumeFeed(app, { plan: "plan-session-layer" }, { env: inv.env, tmpDir: inv.paths.tmpDir, cwd: inv.cwd });
 * if (result.ok) console.log(result.value.feed);
 */
export async function buildResumeFeed(
  app: App,
  opts: { plan?: string; handoff?: string; by?: string },
  ambient: { readonly env: Readonly<Record<string, string | undefined>>; readonly tmpDir: string; readonly cwd: string; readonly identity: Invocation["identity"]; readonly io: Invocation["io"] },
): Promise<Result<ResumeFeedOutcome, LoreError>> {
  if (app.sessionService === undefined) {
    return err({
      code: "STORE_ERROR",
      message: "Internal error: SessionService not wired on App",
    });
  }
  const result = await app.sessionService.resume(opts);
  if (!result.ok) return result;

  const resume = result.value;
  const ruleDiffBlock = await buildRuleDiffBlock(app.sessionService, opts, resume);
  if (!ruleDiffBlock.ok) return ruleDiffBlock;
  let suppressFloor = false;
  let authorshipUndeterminedNote: string | undefined;
  if (resume.found && !resume.multi_actor && resume.handoff !== undefined) {
    // reason: this is a READ-side decision (`by` here is the feed's own filter, never a write identity), so an
    // invocation with no known party is not refused: it is nobody's session, the floor stays armed (`suppressFloor` false).
    const currentActor = opts.by !== undefined && opts.by.trim() !== "" ? opts.by : ambient.identity.claimed;
    const sessionStart = readSessionStartIso(ambient.env, ambient.tmpDir);
    const sessionStartIso = sessionStart.kind === "measured" ? sessionStart.startedAt : undefined;
    // Same call, same argument shape as before this task — the arming
    // VERDICT for every non-measured kind is therefore byte-identical
    // (task-the-session-start-marker-collapses-five-distinct AC 2).
    suppressFloor = currentActor !== null && isSameSessionAuthorship(resume.handoff, currentActor, sessionStartIso);

    if (sessionStart.kind !== "measured") {
      authorshipUndeterminedNote = describeUnmeasuredAuthorship(sessionStart);
      if (sessionStart.kind === "unreadable") {
        // reason: a corrupt/wrong-typed marker is a real fault, not this
        // mechanism's normal (if inert) steady state — AC 3 requires this
        // to be loud on stderr, distinct from the advisory feed line above.
        ambient.io.stderr.write(
          `lore: session-start marker unreadable (${sessionStart.detail}) — same-session authorship ` +
            "could not be determined; the resume-ticket coverage floor will arm unconditionally.\n",
        );
      }
    }
  }

  return ok({
    checkpoint: SESSION_RESUME_CHECKPOINT,
    resume,
    feed: renderResumeFeed(resume, suppressFloor, authorshipUndeterminedNote, ruleDiffBlock.value),
  });
}

// ─── SPEC-070 Fix F7: shared special-checkpoint descriptor (dispatch-triplication fix) ─

/**
 * ONE checkpoint each for `"task"` (an "id-or-slug" positional/field) or `"phase"`
 * required, or `null` when the checkpoint has no single mandatory target field
 * (`"session-resume"` — `plan`/`handoff`/`by` are all optional).
 */
export type SpecialFeedCheckpointDescriptor = { readonly requiredArg: "task" | "phase" | null };

/**
 * The ONE exported descriptor of every checkpoint `lore feed`/`lore_feed` dispatch to
 * a DEDICATED assembly instead of the generic `buildFeed`/`CHECKPOINT_PRODUCED_TYPE`
 * path above — `session-resume` (SPEC-041 D5), `phase-start` (SPEC-056 D5), `task-start`
 * (SPEC-070 D1). Before this fix, "which checkpoints are special" was maintained
 * independently in THREE places (this module's own header comment, `commands/feed.ts`'s
 * handler table, and a since-removed adapter's `if` chain) — a silent three-way SSOT that
 * could drift without any test catching it. Adapters now derive membership +
 * per-checkpoint required-field validation from THIS map:
 *   - `commands/feed.ts`'s `SPECIAL_CHECKPOINT_HANDLERS` table asserts, at MODULE INIT
 *     (via {@link assertHandlersCoverDescriptor}, fail loud — never a silent fallthrough
 *     to the generic `buildFeed` path), that every key here has a matching CLI handler.
 *   - any other feed adapter looks up `SPECIAL_FEED_CHECKPOINTS[checkpoint]`
 *     for contradictory-field-combo rejection (task-start+phase, phase-start+task, a
 *     non-special checkpoint carrying task or phase — Fix F8) AND for the
 *     "missing required field" `VALIDATION_ERROR` (`requiredArg` non-null and absent).
 *
 * Handler/branch BODIES stay adapter-local — their dependencies genuinely differ (the
 * CLI handler prints to stdout and sets `process.exitCode`; another adapter's branch returns
 * its own result shape) — only the SET of checkpoint names + which field each requires is
 * centralised here.
 */
export const SPECIAL_FEED_CHECKPOINTS: Readonly<Record<string, SpecialFeedCheckpointDescriptor>> = {
  [SESSION_RESUME_CHECKPOINT]: { requiredArg: null },
  [PHASE_START_CHECKPOINT]: { requiredArg: "phase" },
  [TASK_START_CHECKPOINT]: { requiredArg: "task" },
};

/**
 * Asserts every checkpoint declared in `descriptor` has a matching key in `handlers` —
 * throws (fail loud) naming the FIRST checkpoint missing one. `commands/feed.ts` calls
 * this once, at MODULE INIT, against its own `SPECIAL_CHECKPOINT_HANDLERS` table, so a
 * checkpoint added to {@link SPECIAL_FEED_CHECKPOINTS} without a matching CLI handler
 * fails the very first time the CLI process starts — never a silent fallthrough to the
 * generic `buildFeed` advisory-note path (which would print the wrong thing and exit 0,
 * masking the gap). Exported (rather than private to `commands/feed.ts`, which
 * transitively imports `bun:sqlite` via `loader.ts` and is therefore NOT
 * vitest-reachable) so this invariant is unit-testable against fixture descriptor/
 * handler pairs without spawning the compiled CLI binary.
 *
 * @param descriptor - The special-checkpoint descriptor map (production callers pass
 *   {@link SPECIAL_FEED_CHECKPOINTS}).
 * @param handlers - The checkpoint→handler table to check for coverage. Only key
 *   presence is checked — handler value type is deliberately `unknown` so this
 *   function stays usable from any adapter's own handler-table shape.
 * @throws {Error} naming the first descriptor checkpoint absent from `handlers`.
 * @example
 * assertHandlersCoverDescriptor(SPECIAL_FEED_CHECKPOINTS, SPECIAL_CHECKPOINT_HANDLERS);
 */
export function assertHandlersCoverDescriptor(
  descriptor: Readonly<Record<string, SpecialFeedCheckpointDescriptor>>,
  handlers: Readonly<Record<string, unknown>>,
): void {
  for (const checkpoint of Object.keys(descriptor)) {
    if (handlers[checkpoint] === undefined) {
      throw new Error(
        `SPECIAL_FEED_CHECKPOINTS declares checkpoint "${checkpoint}" with no matching ` +
          "handler in the caller's handler table — add one before this checkpoint can " +
          "dispatch (SPEC-070 Fix F7 SSOT invariant).",
      );
    }
  }
}
