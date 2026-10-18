/**
 * Module: owned-by — the grammar of a `non-business:owned-by` site-map entry, and the lookup that judges it.
 *
 * Purpose: one parser and one judge shared by map-time validation (`RuleService.setSiteMap`) and
 *   coverage-time accounting (`computeLeafCoverage`), so the two never disagree about what an entry means.
 * Public surface: {@link parseOwnedBy}, {@link buildOwnerLeafIndex}, {@link judgeOwnedBy},
 *   {@link OWNED_BY_REASON_PREFIX}, and the types.
 * Grammar: `non-business:owned-by <leaf> BR-n[ BR-m...] — <reason>` where `<leaf>` is a leaf id or slug,
 *   the separator is a SPACED em-dash (` — `), and `<reason>` is non-blank.
 * Invariants:
 *   - A reason not starting with `owned-by ` is `not_owned_by` (never inspected further).
 *   - An entry is judged `ok` only when its owner resolves to a LEAF (not a branch, not missing) and every
 *     named id is a LIVE rule of that leaf; a rule that exists on another leaf is NOT held by the named one.
 * Side-effect class: pure.
 */

/** Prefix of a siteMap entry that justifies a site as not business behaviour: `non-business:<reason>`. */
export const NON_BUSINESS_PREFIX = "non-business:";

/** Start of the reason text that marks an owned-by entry (after `non-business:`). */
export const OWNED_BY_REASON_PREFIX = "owned-by ";

const SEPARATOR = " — ";
const RULE_ID = /^BR-[1-9][0-9]*$/;

export type OwnedByParse =
  | { kind: "not_owned_by" }
  | { kind: "malformed"; problem: string }
  | { kind: "owned_by"; leaf: string; ruleIds: string[]; reason: string };

/** Parse one site-map entry. Never throws. */
export function parseOwnedBy(entry: string): OwnedByParse {
  if (!entry.startsWith(NON_BUSINESS_PREFIX)) return { kind: "not_owned_by" };
  const body = entry.slice(NON_BUSINESS_PREFIX.length);
  if (!body.startsWith(OWNED_BY_REASON_PREFIX)) return { kind: "not_owned_by" };
  const rest = body.slice(OWNED_BY_REASON_PREFIX.length);
  const at = rest.indexOf(SEPARATOR);
  if (at < 0) return { kind: "malformed", problem: "missing the spaced em-dash separator ' — ' before the reason" };
  const reason = rest.slice(at + SEPARATOR.length).trim();
  if (reason.length === 0) return { kind: "malformed", problem: "the reason after ' — ' is blank" };
  const tokens = rest.slice(0, at).trim().split(/\s+/).filter((t) => t.length > 0);
  const leaf = tokens[0];
  if (leaf === undefined) return { kind: "malformed", problem: "no owner leaf named" };
  const ruleIds = tokens.slice(1);
  if (ruleIds.length === 0) return { kind: "malformed", problem: "no rule id named (expected BR-n after the leaf)" };
  const bad = ruleIds.find((id) => !RULE_ID.test(id));
  if (bad !== undefined) return { kind: "malformed", problem: `'${bad}' is not a BR-n rule id` };
  return { kind: "owned_by", leaf, ruleIds, reason };
}

/** What the lookup knows of one leaf: its id and the ids of its LIVE rules. */
export interface OwnerLeaf {
  readonly leafId: string;
  readonly liveRuleIds: ReadonlySet<string>;
}

/** id-or-slug → leaf. Holds LEAVES only, so a branch or a deleted node is simply absent. */
export type OwnerLeafIndex = ReadonlyMap<string, OwnerLeaf>;

/** Minimal doc shape the index needs (a `DocRecord` satisfies it). */
export interface OwnerIndexDoc {
  readonly id: string;
  readonly slug: string;
  readonly extra: Readonly<Record<string, unknown>>;
}

/** Build the lookup from the live baseline docs. */
export function buildOwnerLeafIndex(docs: readonly OwnerIndexDoc[]): OwnerLeafIndex {
  const index = new Map<string, OwnerLeaf>();
  for (const doc of docs) {
    if (doc.extra["node"] !== "leaf") continue;
    const rules = Array.isArray(doc.extra["rules"]) ? (doc.extra["rules"] as Array<{ id?: unknown; lifecycle?: unknown }>) : [];
    const liveRuleIds = new Set(rules.filter((r) => r.lifecycle === "live" && typeof r.id === "string").map((r) => r.id as string));
    const owner: OwnerLeaf = { leafId: doc.id, liveRuleIds };
    index.set(doc.id, owner);
    index.set(doc.slug, owner);
  }
  return index;
}

/**
 * Judge a parsed owned-by entry against the lookup. `problem` is a human sentence when not ok.
 * @param excludeLeafId - the leaf being mapped: it cannot excuse its own site (map-time only).
 */
export function judgeOwnedBy(
  parsed: Extract<OwnedByParse, { kind: "owned_by" }>,
  index: OwnerLeafIndex | undefined,
  excludeLeafId?: string,
): { ok: true } | { ok: false; problem: string } {
  const owner = index?.get(parsed.leaf);
  if (owner === undefined) return { ok: false, problem: `'${parsed.leaf}' is not a leaf` };
  if (excludeLeafId !== undefined && owner.leafId === excludeLeafId) {
    return { ok: false, problem: `'${parsed.leaf}' is the leaf being mapped; name a different leaf` };
  }
  const notLive = parsed.ruleIds.filter((id) => !owner.liveRuleIds.has(id));
  if (notLive.length > 0) return { ok: false, problem: `${notLive.join(", ")} not a live rule of '${parsed.leaf}'` };
  return { ok: true };
}
