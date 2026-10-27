/**
 * Decision record: the structured trace an agent's decision-carrying write leaves on the version row it creates.
 *
 * Purpose: the single home of the `DecisionRecord` shape, the CLI flag / source-string parsers that build it, the
 *   confidence order, the "trivial rule patch" test and the gate ids the service computes or the writer states.
 * Public surface: DECISION_TIERS, STRONG_TIERS, isStrongTier, hasStrongPremise, CONFIDENCE_ORDER, isConfidenceLowered,
 *   isTrivialRulePatch, GATE_MEANING_UNCHANGED, GATE_EVIDENCE_S_TO_C, WEIGHT_TABLE_KINDS, decisionRecordSchema,
 *   DecisionRecord, Premise, parseDecisionSource, parsePremiseFlag, parseAlternativeFlag, parseGateFlag, parseScoreFlag,
 *   parseWeightTableFlag, parseRefFlag, renderDecisionRecord.
 * Invariants:
 *   - A stored file premise carries `sha` and `quote` (lore fills both at write time); a parsed-but-unresolved file source
 *     ({@link DecisionSourceDraft}) may lack `sha` and never has a `quote`. The two are separate types on purpose.
 *   - The confidence order is `established > observed > unconfirmed > undecided` (spec D3); no other module may restate it.
 *   - Parsers never throw: a malformed flag is `{ ok: false, reason }` so the caller can name the field in a refusal.
 *   - This module imports nothing from Node (the core barrel is browser-safe).
 * Side-effect class: pure (no IO, no clock).
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, "The decision payload", D3;
 *   adr-an-agent-s-decision-between-milestones-is-a-record-gates.
 */

import { z } from "zod";

/** Evidence tiers, strongest first (S official ... E untrusted). */
export const DECISION_TIERS = ["S", "A", "B", "C", "D", "E"] as const;
export const decisionTierSchema = z.enum(DECISION_TIERS);
export type DecisionTier = z.infer<typeof decisionTierSchema>;

/** The tiers a decision may rest on (a decision needs at least one premise from these). */
export const STRONG_TIERS: readonly DecisionTier[] = ["S", "A", "B", "C"];

/** Confidence states, strongest first (spec D3). */
export const CONFIDENCE_ORDER = ["established", "observed", "unconfirmed", "undecided"] as const;
export type OrderedConfidence = (typeof CONFIDENCE_ORDER)[number];

/** The judged gate the writer states on a rule statement change. */
export const GATE_MEANING_UNCHANGED = "meaning-unchanged";
/** The gate the service computes on a rule statement change: pass when every premise is tier S..C. */
export const GATE_EVIDENCE_S_TO_C = "evidence-s-to-c";

/** The weight-table kinds; the command fixes which one applies (`rule revision` for rule set|add|propose). */
export const WEIGHT_TABLE_KINDS = ["rule revision", "document revision"] as const;
export type WeightTableKind = (typeof WEIGHT_TABLE_KINDS)[number];

const nonEmpty = z.string().min(1);

/** A stored premise source. File sources carry the pinned `sha` and the `quote` lore read at write time. */
export const premiseSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: nonEmpty,
    lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    sha: nonEmpty,
    quote: z.string(),
  }),
  z.object({ kind: z.literal("cmd"), command: nonEmpty, expect: nonEmpty }),
  z.object({ kind: z.literal("issue"), number: z.number().int().min(1) }),
  z.object({ kind: z.literal("doc"), slug: nonEmpty, version: z.number().int().min(1).optional() }),
]);
export type PremiseSource = z.infer<typeof premiseSourceSchema>;

export const premiseSchema = z.object({ claim: nonEmpty, tier: decisionTierSchema, source: premiseSourceSchema });
export type Premise = z.infer<typeof premiseSchema>;

export const decisionAlternativeSchema = z.object({ option: nonEmpty, why_rejected: nonEmpty });
export type DecisionAlternative = z.infer<typeof decisionAlternativeSchema>;

export const decisionGateSchema = z.object({
  id: nonEmpty,
  verdict: z.enum(["pass", "fail"]),
  evidence: nonEmpty,
  computed: z.boolean(),
});
export type DecisionGate = z.infer<typeof decisionGateSchema>;

export const decisionScoreSchema = z.object({
  option: nonEmpty,
  dimension: nonEmpty,
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  evidence: nonEmpty,
});
export type DecisionScore = z.infer<typeof decisionScoreSchema>;

export const decisionWeightTableRefSchema = z.object({ slug: nonEmpty, version: z.number().int().min(1) });
export type DecisionWeightTableRef = z.infer<typeof decisionWeightTableRefSchema>;

export const decisionRefSchema = z.object({ practice: nonEmpty, difference: nonEmpty });
export type DecisionRef = z.infer<typeof decisionRefSchema>;

/** The payload stored (as JSON) in `versions.decision` on the version row a decision-carrying write creates. */
export const decisionRecordSchema = z.object({
  reason: nonEmpty,
  premises: z.array(premiseSchema),
  alternatives: z.array(decisionAlternativeSchema),
  gates: z.array(decisionGateSchema).optional(),
  scores: z.array(decisionScoreSchema).optional(),
  /** Required (by the service, not this schema) when `scores` are given. */
  weight_table: decisionWeightTableRefSchema.optional(),
  refs: z.array(decisionRefSchema).optional(),
  /** `rule set` statement change: the statement replaced. */
  before: z.string().optional(),
});
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

/**
 * Whether `tier` is S..C.
 *
 * @param tier - any string (a flag value is untrusted)
 * @returns true for exactly `S`, `A`, `B`, `C`
 */
export function isStrongTier(tier: string): boolean {
  return (STRONG_TIERS as readonly string[]).includes(tier);
}

/**
 * Whether the record holds at least one premise of tier S..C (the refusal condition's positive form).
 *
 * @param record - the decision (only `premises` is read)
 */
export function hasStrongPremise(record: Pick<DecisionRecord, "premises">): boolean {
  return record.premises.some((premise) => isStrongTier(premise.tier));
}

/**
 * Whether moving confidence from `from` to `to` lowers it. Equal or unknown values are not a lowering.
 *
 * @param from - current confidence
 * @param to - proposed confidence
 */
export function isConfidenceLowered(from: string, to: string): boolean {
  const order = CONFIDENCE_ORDER as readonly string[];
  const fromRank = order.indexOf(from);
  const toRank = order.indexOf(to);
  return fromRank !== -1 && toRank !== -1 && toRank > fromRank;
}

/**
 * The trivial check: a rule patch needs no decision only when it changes `examples` alone, or `confidence` alone and
 * only to a lower state. Any other key, any mix of the two, an empty patch, or a raise/no-op is non-trivial.
 *
 * @param currentConfidence - the rule's confidence before the patch
 * @param patch - the fields the patch sets
 */
export function isTrivialRulePatch(currentConfidence: string, patch: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(patch).filter((key) => patch[key] !== undefined);
  if (keys.length !== 1) return false;
  if (keys[0] === "examples") return true;
  if (keys[0] === "confidence") return typeof patch["confidence"] === "string" && isConfidenceLowered(currentConfidence, patch["confidence"]);
  return false;
}

/** A source as typed on the CLI: a file source may lack `sha` (lore stamps HEAD) and has no `quote` yet. */
export type DecisionSourceDraft =
  | { kind: "file"; path: string; lines: [number, number]; sha?: string }
  | { kind: "cmd"; command: string; expect: string }
  | { kind: "issue"; number: number }
  | { kind: "doc"; slug: string; version?: number };

/** Parse outcome: never throws, so a caller can refuse with the field and reason. */
export type ParseOutcome<K extends string, T> = ({ ok: true } & { [P in K]: T }) | { ok: false; reason: string };

const FILE_SOURCE = /^file:(.+):(\d+)(?:-(\d+))?(?:@([0-9a-f]{7,40}))?$/;
const POSITIVE_INT = /^[1-9]\d*$/;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/**
 * Parse one source string: `file:<path>:<from>[-<to>][@<sha>]`, `cmd:<command> ~ <expect>`, `issue:#<n>`,
 * `doc:<slug>[@<version>]`. Anything else is rejected.
 *
 * @param text - the source as typed
 * @example parseDecisionSource("issue:#473") // { ok: true, source: { kind: "issue", number: 473 } }
 */
export function parseDecisionSource(text: string): ParseOutcome<"source", DecisionSourceDraft> {
  if (text.startsWith("file:")) {
    const match = FILE_SOURCE.exec(text);
    if (!match) return fail(`file source must be file:<path>:<from>[-<to>][@<sha>], got "${text}"`);
    const from = Number(match[2]);
    const to = match[3] === undefined ? from : Number(match[3]);
    if (from < 1 || to < from) return fail(`file source line range must satisfy 1 <= from <= to, got ${from}-${to}`);
    const sha = match[4];
    return { ok: true, source: { kind: "file", path: match[1] as string, lines: [from, to], ...(sha ? { sha } : {}) } };
  }
  if (text.startsWith("cmd:")) {
    const body = text.slice(4);
    const at = body.indexOf(" ~ ");
    const command = at === -1 ? "" : body.slice(0, at).trim();
    const expectText = at === -1 ? "" : body.slice(at + 3).trim();
    if (!command || !expectText) return fail(`cmd source must be cmd:<command> ~ <expected substring>, got "${text}"`);
    return { ok: true, source: { kind: "cmd", command, expect: expectText } };
  }
  if (text.startsWith("issue:#")) {
    const digits = text.slice(7);
    if (!POSITIVE_INT.test(digits)) return fail(`issue source must be issue:#<n> with n >= 1, got "${text}"`);
    return { ok: true, source: { kind: "issue", number: Number(digits) } };
  }
  if (text.startsWith("doc:")) {
    const [slug, version, ...rest] = text.slice(4).split("@");
    if (!slug || rest.length > 0) return fail(`doc source must be doc:<slug>[@<version>], got "${text}"`);
    if (version === undefined) return { ok: true, source: { kind: "doc", slug } };
    if (!POSITIVE_INT.test(version)) return fail(`doc source version must be an integer >= 1, got "${version}"`);
    return { ok: true, source: { kind: "doc", slug, version: Number(version) } };
  }
  return fail(`unknown source "${text}": expected file:, cmd:, issue:# or doc:`);
}

/** A premise as typed on the CLI (its file source is not yet quoted). */
export interface PremiseDraft {
  claim: string;
  tier: DecisionTier;
  source: DecisionSourceDraft;
}

const SOURCE_START = /\|(?:file|cmd|issue|doc):/;

/**
 * Parse `--premise "<claim>|<source>|<tier>"`. The tier is the last `|` field and the source starts at the first
 * `|<kind>:`, so a claim or command may itself hold other `|` characters.
 *
 * @param text - the flag value
 */
export function parsePremiseFlag(text: string): ParseOutcome<"premise", PremiseDraft> {
  const lastBar = text.lastIndexOf("|");
  if (lastBar === -1) return fail(`premise must be "<claim>|<source>|<tier>", got "${text}"`);
  const tier = text.slice(lastBar + 1).trim();
  if (!(DECISION_TIERS as readonly string[]).includes(tier)) return fail(`premise tier must be one of ${DECISION_TIERS.join("")}, got "${tier}"`);
  const head = text.slice(0, lastBar);
  const sourceAt = head.search(SOURCE_START);
  if (sourceAt === -1) return fail(`premise needs a source (file:, cmd:, issue:# or doc:) between claim and tier, got "${text}"`);
  const claim = head.slice(0, sourceAt).trim();
  if (!claim) return fail(`premise claim is empty in "${text}"`);
  const parsed = parseDecisionSource(head.slice(sourceAt + 1).trim());
  if (!parsed.ok) return parsed;
  return { ok: true, premise: { claim, tier: tier as DecisionTier, source: parsed.source } };
}

/** Parse `--alt "<option>|<why rejected>"`. */
export function parseAlternativeFlag(text: string): ParseOutcome<"alternative", DecisionAlternative> {
  const at = text.indexOf("|");
  const option = at === -1 ? "" : text.slice(0, at).trim();
  const why = at === -1 ? "" : text.slice(at + 1).trim();
  if (!option || !why) return fail(`alternative must be "<option>|<why rejected>", got "${text}"`);
  return { ok: true, alternative: { option, why_rejected: why } };
}

/** Parse `--gate "<id>|<pass|fail>|<evidence>"` (a writer-stated gate is never `computed`). */
export function parseGateFlag(text: string): ParseOutcome<"gate", DecisionGate> {
  const [id, verdict, ...evidenceParts] = text.split("|");
  const evidence = evidenceParts.join("|").trim();
  if (!id?.trim() || !evidence) return fail(`gate must be "<id>|<pass|fail>|<evidence>", got "${text}"`);
  if (verdict !== "pass" && verdict !== "fail") return fail(`gate verdict must be pass or fail, got "${verdict ?? ""}"`);
  return { ok: true, gate: { id: id.trim(), verdict, evidence, computed: false } };
}

/** Parse `--score "<option>|<dimension>|<-1|0|1>|<evidence>"`. */
export function parseScoreFlag(text: string): ParseOutcome<"score", DecisionScore> {
  const [option, dimension, value, ...evidenceParts] = text.split("|");
  const evidence = evidenceParts.join("|").trim();
  if (!option?.trim() || !dimension?.trim() || !evidence) return fail(`score must be "<option>|<dimension>|<-1|0|1>|<evidence>", got "${text}"`);
  if (value !== "-1" && value !== "0" && value !== "1") return fail(`score value must be -1, 0 or 1, got "${value ?? ""}"`);
  return { ok: true, score: { option: option.trim(), dimension: dimension.trim(), value: Number(value) as -1 | 0 | 1, evidence } };
}

/** Parse `--weight-table <slug>@<version>`. */
export function parseWeightTableFlag(text: string): ParseOutcome<"weightTable", DecisionWeightTableRef> {
  const at = text.lastIndexOf("@");
  const slug = at === -1 ? "" : text.slice(0, at).trim();
  const version = at === -1 ? "" : text.slice(at + 1);
  if (!slug || !POSITIVE_INT.test(version)) return fail(`weight table must be <slug>@<version> with version >= 1, got "${text}"`);
  return { ok: true, weightTable: { slug, version: Number(version) } };
}

/** One premise's source as a short label (`file:a.ts:5-6@abc1234`, `cmd:...`, `issue:#1`, `doc:slug@2`). */
function renderPremiseSource(source: PremiseSource): string {
  switch (source.kind) {
    case "file":
      return `file:${source.path}:${source.lines[0]}-${source.lines[1]}@${source.sha}`;
    case "cmd":
      return `cmd:${source.command} ~ ${source.expect}`;
    case "issue":
      return `issue:#${source.number}`;
    case "doc":
      return `doc:${source.slug}${source.version === undefined ? "" : `@${source.version}`}`;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

/**
 * Render a decision as indented text lines: reason, premises (tier, claim, source), alternatives, gates, scores,
 * weight table, refs and `before`. Pure; used by `lore log`.
 *
 * @param record - the stored decision
 */
export function renderDecisionRecord(record: DecisionRecord): string {
  const lines: string[] = [`  reason: ${record.reason}`];
  for (const p of record.premises) lines.push(`  premise [${p.tier}] ${p.claim} (${renderPremiseSource(p.source)})`);
  for (const a of record.alternatives) lines.push(`  alternative: ${a.option} -- rejected: ${a.why_rejected}`);
  for (const g of record.gates ?? []) lines.push(`  gate ${g.id}: ${g.verdict}${g.computed ? " (computed)" : ""} -- ${g.evidence}`);
  for (const s of record.scores ?? []) lines.push(`  score ${s.option} / ${s.dimension}: ${s.value} -- ${s.evidence}`);
  if (record.weight_table !== undefined) lines.push(`  weight table: ${record.weight_table.slug}@${record.weight_table.version}`);
  for (const r of record.refs ?? []) lines.push(`  ref: ${r.practice} -- differs: ${r.difference}`);
  if (record.before !== undefined) lines.push(`  before: ${record.before}`);
  return lines.join("\n");
}

/** Parse `--ref "<practice>|<difference>"`. */
export function parseRefFlag(text: string): ParseOutcome<"ref", DecisionRef> {
  const at = text.indexOf("|");
  const practice = at === -1 ? "" : text.slice(0, at).trim();
  const difference = at === -1 ? "" : text.slice(at + 1).trim();
  if (!practice || !difference) return fail(`ref must be "<practice>|<difference>", got "${text}"`);
  return { ok: true, ref: { practice, difference } };
}
