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
 *   renderResumeFeed(resume)                 — pure `ResumeResult` → advisory text,
 *                                               closing with `RESUME_SCOPE_CLOSURE`
 *                                               whenever a ticket is actually rendered
 *                                               (spec-context-provenance-injected-corpus-global-state-and-a
 *                                               D3)
 *   buildResumeFeed(app, opts)               — SPEC-041 S2 resume dispatch, called
 *                                               BEFORE `buildFeed`'s
 *                                               `CHECKPOINT_PRODUCED_TYPE` lookup
 *   SPECIAL_FEED_CHECKPOINTS                 — SPEC-070 Fix F7 SSOT: the special
 *                                               checkpoint set (session-resume/
 *                                               phase-start/task-start) + which
 *                                               field each requires, consumed by
 *                                               both `commands/feed.ts` and
 *                                               `adapters/mcp/tools.ts`
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
 *   `.feed` verbatim to stdout, and `adapters/mcp/tools.ts`'s `lore_feed`
 *   session-resume branch JSON-stringifies the SAME `ResumeFeedOutcome`
 *   (`.feed` field included) as its response text. Neither call site re-derives
 *   or duplicates the closure text — a surface that rendered its own copy is
 *   exactly the dual-write failure class this spec exists to close.
 *
 * Side-effect class: IO (corpusService reads, outlineService MDX resolution,
 *   sessionService reads — no writes)
 * Source: IoC vertical-slice tech-spec §4.1/§11, P4 slice; SPEC-041 §3 D5;
 *   spec-context-provenance-injected-corpus-global-state-and-a D3
 */

import type { App } from "../app.js";
import type { DocRecord, LoreError, Result } from "@lore/core";
import { err, ok, RESUME_SCOPE_CLOSURE } from "@lore/core";
import { buildFeedingPack, renderFeedingPack } from "../service/gate-feeding.js";
import { renderResolvedToMarkdown } from "../service/outline-service.js";
import type { ResumeHandoffRecord, ResumeResult } from "../service/session-service.js";
import { formatError } from "../adapters/cli/utils.js";
import { PHASE_START_CHECKPOINT } from "./phase-feed-flow.js";
import { TASK_START_CHECKPOINT } from "./task-feed-flow.js";

/** Time seam (SPEC-043 D3/D4 convention) — never `Date.now()` read directly. */
const defaultNow = (): string => new Date().toISOString();

/**
 * Renders `doc.content` with MDX placeholders spliced in (`OutlineService.resolve` →
 * `renderResolvedToMarkdown`), mirroring `get.ts`'s `--raw`-off pattern. A resolution
 * failure degrades to the raw, unspliced body rather than aborting the caller — every
 * consumer of this function (the gate's violation feed, `lore feed`'s advisory pull)
 * treats the fed content as advisory context, not a hard dependency on placeholder
 * resolution succeeding.
 *
 * Prepends the SPEC-043 D4 invalidation banner (via
 * `OutlineService.resolveValidityBanner`, the SAME shared renderer CLI `get`/
 * `export-docs` use, T2) when `doc` is currently invalidated — the THIRD D4 wiring
 * site (AC-MH-12): `lore feed <checkpoint>`'s discovered feeding-skill doc, when
 * invalidated, must never be handed to a caller as an unmarked feeding pack.
 *
 * @param app - Wired `App` providing `outlineService`.
 * @param doc - The document whose content should be MDX-resolved.
 * @param now - Time seam (D3) — defaults to `() => new Date().toISOString()`.
 * @returns The MDX-spliced markdown body (banner-prefixed when invalidated), or
 *   `doc.content` unchanged (banner still prefixed) on any resolution failure.
 */
export async function renderDocMarkdown(
  app: App,
  doc: DocRecord,
  now: () => string = defaultNow,
): Promise<string> {
  const nowIso = now();
  const resolveResult = await app.outlineService.resolve(doc);
  const body = resolveResult.ok ? renderResolvedToMarkdown(resolveResult.value) : doc.content;
  const banner = await app.outlineService.resolveValidityBanner(doc, () => nowIso);
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
 * TTL-warning marker when stale, a live readiness pointer block, a
 * multi-actor header when the result spans more than one actor (divergent state
 * is surfaced, never silently collapsed), and — whenever an actual ticket is
 * rendered — the {@link RESUME_SCOPE_CLOSURE} boundary block
 * (spec-context-provenance-injected-corpus-global-state-and-a D3). Pure — no
 * IO, no wall-clock reads (all of `resume`'s time-derived fields are already
 * computed).
 *
 * Both `lore feed`/`commands/feed.ts` (CLI stdout) and `lore_feed`/
 * `adapters/mcp/tools.ts` (MCP `feed` field, JSON-stringified alongside the
 * rest of `ResumeFeedOutcome`) print/return this SAME string via
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
 * @param resume - A `SessionService.resume` result.
 * @returns `"(no handoff recorded)"` when `!resume.found`; otherwise the
 *   rendered ticket text followed by `RESUME_SCOPE_CLOSURE`.
 */
export function renderResumeFeed(resume: ResumeResult): string {
  if (!resume.found) {
    return "(no handoff recorded)";
  }
  if (resume.multi_actor) {
    const records = resume.handoffs ?? [];
    const header = `${records.length} actors have handoffs`;
    const body = records.map(renderResumeRecord).join("\n\n");
    return [header, "", body, renderReadinessPointer(resume.readiness), RESUME_SCOPE_CLOSURE]
      .filter((s) => s !== "")
      .join("\n\n");
  }
  const record = resume.handoff;
  if (record === undefined) {
    return "(no handoff recorded)";
  }
  return [renderResumeRecord(record), renderReadinessPointer(resume.readiness), RESUME_SCOPE_CLOSURE]
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
 * handler table, `adapters/mcp/tools.ts`'s `if` chain) — a silent three-way SSOT that
 * could drift without any test catching it. Both adapters now derive membership +
 * per-checkpoint required-field validation from THIS map:
 *   - `commands/feed.ts`'s `SPECIAL_CHECKPOINT_HANDLERS` table asserts, at MODULE INIT
 *     (via {@link assertHandlersCoverDescriptor}, fail loud — never a silent fallthrough
 *     to the generic `buildFeed` path), that every key here has a matching CLI handler.
 *   - `adapters/mcp/tools.ts`'s `lore_feed` handler looks up `SPECIAL_FEED_CHECKPOINTS[checkpoint]`
 *     for contradictory-field-combo rejection (task-start+phase, phase-start+task, a
 *     non-special checkpoint carrying task or phase — Fix F8) AND for the
 *     "missing required field" `VALIDATION_ERROR` (`requiredArg` non-null and absent).
 *
 * Handler/branch BODIES stay adapter-local — their dependencies genuinely differ (the
 * CLI handler prints to stdout and sets `process.exitCode`; the MCP branch returns a
 * `CallToolResult`) — only the SET of checkpoint names + which field each requires is
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
