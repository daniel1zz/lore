/**
 * Pure render helpers for EVERY human/machine-facing markdown projection of a
 * `DocRecord` — the structured-`extra` loss notice and its placement.
 *
 * Purpose: make a lossy doc projection SELF-ANNOUNCING. Public surface:
 * {@link findExtraKeysAlreadyRendered} + {@link findHiddenStructuredExtra} (queries),
 * {@link classifyExtraValue} (classifier), {@link formatStructuredExtraNotice}
 * (formatter), {@link composeWithStructuredExtraNotice} (the ONE joiner every surface
 * calls). Side-effect class: PURE — no IO, no store access, no `process.*`, no clock
 * read (`nowIso` is injected); callers do the printing.
 *
 * ── This module is the SSOT for TWO surfaces, not one
 * (task-the-shared-renderdocmarkdown-seam-still-drops-structured)
 * It shipped serving `lore get` alone. The shared seam those consumers reuse —
 * `flows/feed-flow.ts::renderDocMarkdown` — kept returning an UNANNOTATED projection,
 * so `lore feed`'s advisory pack and (the sharp end) the feeding pack pushed back with
 * a GATE DENIAL both dropped structured `extra` in silence, to a reader that is a
 * MACHINE mid-write acting on the pack alone. The seam now composes its notice from
 * THIS module. ⛔ Do not grow a second notice implementation for a new surface — two
 * implementations of one invariant is precisely what made the first divergence
 * invisible.
 *
 * ── Why placement is an explicit discriminant ({@link ExtraNoticePlacement})
 * The two surfaces put the notice on opposite sides of the body, for reasons that are
 * MEASURED, not stylistic:
 *   - `lore get` prints the WHOLE body and has always closed with the notice, directly
 *     above the Navigation footer (`"below-body"`). That placement is frozen: this
 *     task's REGRESSION oracle is a captured byte-for-byte before/after of `lore get`.
 *   - A feeding pack quotes a LEADING SLICE truncated to
 *     `service/gate-feeding.ts::DEFAULT_FEEDING_MAX_CHARS` (800 chars). A trailing
 *     notice is therefore CUT from every doc longer than that — i.e. from essentially
 *     every real spec/PRD, including the 5.6 KB one in the originating incident. A
 *     bottom-placed notice would have passed a short-fixture test and stayed silent in
 *     production: the same false-oracle shape this task exists to close. The seam
 *     places it `"above-body"` (right after the SPEC-043 banner, the other meta
 *     annotation that leads for the same reason) so truncation cannot swallow it.
 * The discriminant changes ONE preposition and WHICH SIDE the joiner welds to. The
 * detector, the inventory, and the `--json` pointer line are shared — there is exactly
 * one implementation of "what is withheld".
 *
 * ── Why this module exists (task-lore-get-s-default-render-silently-omits-structured-extra)
 * `lore get <slug>` printed `content` + Navigation and DROPPED every structured `extra`
 * value. A reader could not distinguish "this doc has no `extra`" from "this doc's
 * `extra` was not shown": the omission produced no output at all, so a careful reader was
 * affected identically to a careless one. Measured cost — an orchestrator authored a
 * 5.6 KB implementation spec on a mechanism assumption that `extra.issue_report.actual`
 * refuted; three acceptance criteria asserted against a field that does not exist, full
 * rewrite. Write-up: `knowledge-lore-get-s-human-view-hides-extra-issue-report-so-a`.
 *
 * ── Design fork: OPTION B (announce the loss), chosen AFTER the AC-3 sweep
 * The task offered two options. **Option A** — render the structured values in the
 * default view — was REJECTED on the sweep's evidence, not on preference:
 *   1. `extra` is an open bag: ~43 top-level keys across the seven doc types
 *      (`issue_report`, `file_anchors`, `code_anchors`, `verification_evidence`,
 *      `phases`, `claim`, `ac_scope`, `handoff`, `requirements`, `acceptance_criteria`,
 *      `red_first`, `validity`, …). Option A must decide per shape what renders, so it is
 *      a moving target by construction and goes stale the day a 44th key lands.
 *   2. Several shapes are UNBOUNDED. `verification_evidence[].output_tail` holds whole
 *      captured oracle logs — kilobytes per entry (≈6 KB across three entries on the
 *      specimen task measured for this fix). Rendering them by default would bury the
 *      doc's own content: one unreadable projection traded for another.
 *   3. Every key already has a dedicated reader (`lore ready`, `lore phase list`,
 *      `lore anchor`, `lore scope list`, `--json`). Option A would re-implement those
 *      renderers here and become a second, drifting SSOT for each.
 * Option B is key-AGNOSTIC: it announces the EXISTENCE and SHAPE of every structured
 * value without reproducing any of them, so a future 44th key is covered the day it is
 * written, with no edit here. Its stated cost — the reader needs a second call — is paid
 * down by printing the exact copy-pasteable command (`lore get <slug> --json`).
 *
 * Child key NAMES are announced; VALUES are not. That is the one line this module draws,
 * and it is what keeps output bounded: key names are short and schema-bounded, values are
 * not. It is also what makes the notice actionable — in the measured incident, seeing
 * `issue_report → expected, actual, repro_command` listed is what would have triggered
 * the `--json` call.
 *
 * ── Invariants
 * - **Never claims a loss that did not happen.** A key is excluded only when THIS render
 *   actually surfaced its content, derived from render FACTS the caller already holds
 *   ({@link RenderedBodyFacts}) — never from a hardcoded key-name guess, because the
 *   three surfacing branches are conditional: the SPEC-043 invalidation banner fires only
 *   when `isInvalidated` is true AND MDX resolution ran (`--raw` skips both), and the
 *   SPEC-038 `## Acceptance Criteria (structured)` / SPEC-045 `## Code anchors` blocks
 *   fire only for a `spec` whose declared array survives its own schema parse. Under
 *   `--raw` all three are withheld, so all three are announced.
 * - **Never announces an EMPTY container** (`[]` / `{}`): nothing is being withheld, and
 *   noise here would train readers to skip the section.
 * - **SCALAR `extra` values are deliberately OUT of scope** (`plan_id`, `sub_type`,
 *   `decision_status`, `phase`, `adhoc`, …). The task's AC-2 negative control requires a
 *   doc whose `extra` holds no STRUCTURED value to emit nothing at all, so firing on a
 *   scalar-only bag (every task has `plan_id`; every knowledge doc has `sub_type`) would
 *   violate it. Scalars being absent from the human header is a separate, narrower
 *   omission — reported alongside this task, never silently folded into it.
 * - **Schema-free ON PURPOSE.** No Zod parse: the module never trusts a value's shape
 *   beyond `typeof` / `Array.isArray`, and per-key schemas would re-introduce exactly the
 *   per-shape whitelist Option B exists to avoid (`extra.issue_report` has no schema at
 *   all — SPEC-072 §11's P5 admission rule — so a schema-keyed detector could not see the
 *   very field that motivated this fix). `null` is classified as a scalar explicitly,
 *   because `typeof null === "object"`.
 */

import { isInvalidated } from "@lore/core";
import type { DocRecord } from "@lore/core";

/**
 * Upper bound on child key names listed for one object-valued `extra` field.
 *
 * 12 covers every shape in the corpus today (the widest, `issue_report`, has 8), so the
 * cap is inert for real data and only bounds an unknown future shape. The overflow count
 * is always reported, so a truncated list can never be mistaken for a complete one.
 */
export const MAX_CHILD_KEYS_LISTED = 12;

/**
 * What `lore get`'s body render actually did on this invocation — the facts the exclusion
 * set is derived from. Supplied by `commands/get.ts`, which already holds every one of
 * them; recomputing them here would duplicate predicates that live in `OutlineService`.
 */
export interface RenderedBodyFacts {
  /**
   * Whether MDX resolution + the invalidation banner ran at all. `false` under `--raw`,
   * where the body is the stored bytes and every render-time projection is absent.
   */
  readonly mdxResolved: boolean;
  /**
   * Whether the SPEC-038 `## Acceptance Criteria (structured)` block was appended —
   * i.e. `ResolvedDoc.acceptanceCriteria !== undefined`, the projection's own verdict,
   * which already encodes "is a spec", "parses", and "is non-empty".
   */
  readonly acceptanceCriteriaProjected: boolean;
  /**
   * Whether the SPEC-045 `## Code anchors` block was appended — i.e.
   * `ResolvedDoc.codeAnchors !== undefined`.
   */
  readonly codeAnchorsProjected: boolean;
  /** Injected clock for the SAME `isInvalidated` predicate the banner itself uses. */
  readonly nowIso: string;
}

/** Structural classification of a single `extra` value. `null` is a SCALAR, not an object. */
export type ExtraValueKind = "object" | "array" | "string" | "number" | "boolean" | "null" | "other";

/**
 * One structured `extra` entry whose value the human view withholds.
 *
 * Discriminated on `kind` so the formatter's branches are exhaustive at compile time — a
 * third structural kind cannot be added without the switch failing to build.
 */
export type HiddenExtraField =
  | {
      readonly kind: "object";
      readonly key: string;
      /** Child key names, in author (insertion) order, capped at {@link MAX_CHILD_KEYS_LISTED}. */
      readonly childKeys: readonly string[];
      /** How many child keys the cap dropped; 0 when `childKeys` is complete. */
      readonly hiddenChildKeyCount: number;
    }
  | {
      readonly kind: "array";
      readonly key: string;
      readonly length: number;
      /** Element type token, or `"mixed"` when elements disagree. */
      readonly elementKind: ExtraValueKind | "mixed";
    };

/**
 * Classifies one `extra` value structurally.
 *
 * @param value - An arbitrary `extra` value (JSON-shaped, but never trusted).
 * @returns The structural kind; `"null"` for `null`, guarding the `typeof null === "object"` trap.
 */
export function classifyExtraValue(value: unknown): ExtraValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object":
      return "object";
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      // undefined / bigint / symbol / function — unreachable for JSON-sourced `extra`, and
      // classified as a scalar so it is never announced as withheld structured content.
      return "other";
  }
}

/**
 * Names the `extra` keys whose content THIS render already showed, and which therefore
 * must NOT be reported as withheld.
 *
 * ⛔ Do not "simplify" this to a static key list — see the module header's first
 * invariant. All three surfaces are conditional, and a static list would silence a real
 * loss under `--raw`, on a non-`spec` doc carrying `acceptance_criteria`, or on a doc
 * whose `extra.validity` exists but is not (yet) invalidating.
 *
 * @param doc - The document being displayed; only `extra` is read (for `isInvalidated`).
 * @param facts - What the body render actually did on this invocation.
 * @returns Excluded key names, possibly empty.
 */
export function findExtraKeysAlreadyRendered(
  doc: Pick<DocRecord, "extra">,
  facts: RenderedBodyFacts,
): readonly string[] {
  const keys: string[] = [];
  // The SPEC-043 D4 banner is the `validity` surface; it exists only on the resolved
  // path, and only for a doc the SSOT predicate calls invalidated.
  if (facts.mdxResolved && isInvalidated({ extra: doc.extra }, facts.nowIso)) keys.push("validity");
  if (facts.acceptanceCriteriaProjected) keys.push("acceptance_criteria");
  if (facts.codeAnchorsProjected) keys.push("code_anchors");
  return keys;
}

/**
 * Finds every structured `extra` value that this render withholds.
 *
 * Key-agnostic by design (see the module header's Option B rationale): any non-empty
 * object- or array-valued entry qualifies, so keys introduced after this code was written
 * are covered without an edit here. Scalars and empty containers never qualify.
 *
 * @param extra - A `DocRecord`'s `extra` bag.
 * @param alreadyRenderedKeys - Keys to exclude, from {@link findExtraKeysAlreadyRendered}.
 *   Required (no default) so a caller can never silently skip the exclusion step and emit
 *   a false loss claim.
 * @returns The withheld fields in author (insertion) order; empty when nothing is withheld.
 * @example
 * findHiddenStructuredExtra({ plan_id: "01K…", file_anchors: ["a.ts"] }, []);
 * // → [{ kind: "array", key: "file_anchors", length: 1, elementKind: "string" }]
 */
export function findHiddenStructuredExtra(
  extra: Record<string, unknown>,
  alreadyRenderedKeys: readonly string[],
): readonly HiddenExtraField[] {
  const fields: HiddenExtraField[] = [];

  for (const [key, value] of Object.entries(extra)) {
    if (alreadyRenderedKeys.includes(key)) continue;

    // reason: both casts below are narrowings already PROVEN by `classifyExtraValue` —
    // "array" is returned only after `Array.isArray`, and "object" only after the
    // `value === null` / array branches are exhausted. Do NOT "simplify" them into a
    // second inline `typeof`/`Array.isArray` test: that would be a duplicate classifier
    // free to disagree with the one the notice's kind labels come from.
    const kind = classifyExtraValue(value);
    if (kind === "array") {
      const items = value as readonly unknown[];
      if (items.length === 0) continue;
      fields.push({ kind: "array", key, length: items.length, elementKind: describeElementKind(items) });
      continue;
    }
    if (kind === "object") {
      const childKeys = Object.keys(value as Record<string, unknown>);
      if (childKeys.length === 0) continue;
      fields.push({
        kind: "object",
        key,
        childKeys: childKeys.slice(0, MAX_CHILD_KEYS_LISTED),
        hiddenChildKeyCount: Math.max(0, childKeys.length - MAX_CHILD_KEYS_LISTED),
      });
    }
  }

  return fields;
}

/**
 * Which side of the rendered body the notice sits on — see the module header for why
 * this is an explicit discriminant rather than a per-surface constant.
 *
 * - `"below-body"` — `lore get`'s frozen placement (whole body printed, notice closes it).
 * - `"above-body"` — every TRUNCATED projection (feeding packs), where a trailing notice
 *   would be cut off the end of any doc longer than the slice budget.
 */
export type ExtraNoticePlacement = "below-body" | "above-body";

/**
 * Formats the loss notice a surface prints alongside the body when structured `extra`
 * exists but was not rendered.
 *
 * @param doc - The document being displayed; only `slug` and `extra` are read.
 * @param facts - What the body render actually did on this invocation.
 * @param placement - Which side of the body the caller will weld this to. Defaults to
 *   `"below-body"`, the placement shipped first and pinned byte-for-byte by `lore get`'s
 *   REGRESSION capture; the seam passes `"above-body"` explicitly.
 * @returns The notice block, or `undefined` when nothing is withheld — the caller then
 *   prints nothing at all (AC-2's negative control: a doc with no structured `extra` must
 *   emit no marker, or an always-printing implementation would satisfy the positive case
 *   vacuously).
 * @example
 * formatStructuredExtraNotice(
 *   { slug: "task-foo", extra: { issue_report: { actual: "…" } } },
 *   { mdxResolved: true, acceptanceCriteriaProjected: false, codeAnchorsProjected: false, nowIso },
 * );
 * // ⚠ 1 structured `extra` field(s) present, values NOT shown above:
 * //     issue_report  object · keys: actual
 * //   → show values: lore get task-foo --json
 */
export function formatStructuredExtraNotice(
  doc: Pick<DocRecord, "slug" | "extra">,
  facts: RenderedBodyFacts,
  placement: ExtraNoticePlacement = "below-body",
): string | undefined {
  const fields = findHiddenStructuredExtra(doc.extra, findExtraKeysAlreadyRendered(doc, facts));
  if (fields.length === 0) return undefined;

  const direction = placement === "above-body" ? "below" : "above";
  const keyColumnWidth = Math.max(...fields.map((field) => field.key.length));
  return [
    `⚠ ${fields.length} structured \`extra\` field(s) present, values NOT shown ${direction}:`,
    ...fields.map((field) => `    ${field.key.padEnd(keyColumnWidth)}  ${formatFieldShape(field)}`),
    `  → show values: lore get ${doc.slug} --json`,
  ].join("\n");
}

/**
 * Welds {@link formatStructuredExtraNotice}'s output onto `body` on the side `placement`
 * names — the ONE joiner every surface calls, so no caller re-derives the separator or
 * the empty-body handling.
 *
 * @param body - The already-rendered markdown body (may be empty).
 * @param doc - The document being displayed; only `slug` and `extra` are read.
 * @param facts - What the body render actually did on this invocation.
 * @param placement - Which side to weld to. REQUIRED (no default) so a new surface must
 *   state which projection shape it is — a caller that silently inherited `"below-body"`
 *   into a truncated pack is exactly the failure the module header describes.
 * @returns `body` UNCHANGED when nothing is withheld; the notice alone when `body` is
 *   empty; otherwise the two joined by one blank line, notice on the `placement` side.
 * @example
 * composeWithStructuredExtraNotice("Body.", doc, facts, "above-body");
 * // "⚠ 1 structured `extra` field(s) present, values NOT shown below:\n…\n\nBody."
 */
export function composeWithStructuredExtraNotice(
  body: string,
  doc: Pick<DocRecord, "slug" | "extra">,
  facts: RenderedBodyFacts,
  placement: ExtraNoticePlacement,
): string {
  const notice = formatStructuredExtraNotice(doc, facts, placement);
  if (notice === undefined) return body;
  if (body === "") return notice;
  return placement === "above-body" ? `${notice}\n\n${body}` : `${body}\n\n${notice}`;
}

/**
 * Describes an array's element type, collapsing to `"mixed"` when elements disagree.
 *
 * @param items - The array's elements; never empty (empty arrays are excluded upstream).
 * @returns A single element-kind token, or `"mixed"`.
 */
function describeElementKind(items: readonly unknown[]): ExtraValueKind | "mixed" {
  const kinds = new Set(items.map(classifyExtraValue));
  if (kinds.size !== 1) return "mixed";
  const [only] = kinds;
  // reason: `size === 1` guarantees a first element — the cast keeps the return type total
  // without an `?? "mixed"` fallback that would mask a future refactor's real bug.
  return only as ExtraValueKind;
}

/** Renders one withheld field's shape summary — names and counts only, never values. */
function formatFieldShape(field: HiddenExtraField): string {
  switch (field.kind) {
    case "object": {
      const overflow = field.hiddenChildKeyCount > 0 ? `, +${field.hiddenChildKeyCount} more` : "";
      return `object · keys: ${field.childKeys.join(", ")}${overflow}`;
    }
    case "array":
      return `array · ${field.length} item(s) of ${field.elementKind}`;
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}
