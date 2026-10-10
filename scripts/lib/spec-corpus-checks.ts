/**
 * Pure decision logic behind `scripts/check-spec-citation-census.ts` (AC-BLS3B-11) and
 * `scripts/check-uncited-spec-ledger.ts` (AC-BLS3B-12) of
 * `spec-baseline-slice-3b-specs-belong-to-the-trees-through`.
 *
 * Public surface: `CorpusReadError`, `parseCensus`, `evaluateCensus`, `parseLedgerRows`,
 * `checkLedgerStructure`, `finalDecision`, `parseSpecLiveState`, `parseRuleState`, `checkRowAgainstLiveState`.
 * Invariants: every required field missing from lore's output throws `CorpusReadError`
 * (exit 2 at the script edge) — a missing field is never read as 0 or "ok".
 * Side-effect class: pure (no IO, no subprocess); the scripts own all IO.
 */
import { z } from "zod";

/** Raised when lore's output (or the ledger markdown) cannot be read in the shape this check needs. Scripts map it to exit 2. */
export class CorpusReadError extends Error {
  constructor(
    public readonly source: string,
    public readonly reason: string,
  ) {
    super(`${source}: ${reason}`);
    this.name = "CorpusReadError";
  }
}

const SlugBucketSchema = z.object({ count: z.number().int().nonnegative(), slugs: z.array(z.string()) });
const StatusEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.object({ specs_with_parent: SlugBucketSchema, specs_without_citation: SlugBucketSchema }),
});

export type SlugBucket = z.infer<typeof SlugBucketSchema>;
export interface Census {
  readonly specsWithParent: SlugBucket;
  readonly specsWithoutCitation: SlugBucket;
}

function parseJson(source: string, stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new CorpusReadError(source, `stdout is not JSON (${String(cause)})`);
  }
}

/** Parse `lore status --json` stdout into the two census buckets; throws CorpusReadError on any shape deviation. */
export function parseCensus(stdout: string): Census {
  const source = "lore status --json";
  const parsed = StatusEnvelopeSchema.safeParse(parseJson(source, stdout));
  if (!parsed.success) throw new CorpusReadError(source, `unexpected shape: ${parsed.error.message}`);
  const { specs_with_parent, specs_without_citation } = parsed.data.data;
  for (const [name, bucket] of [
    ["specs_with_parent", specs_with_parent],
    ["specs_without_citation", specs_without_citation],
  ] as const) {
    if (bucket.count !== bucket.slugs.length) {
      throw new CorpusReadError(source, `${name}.count=${bucket.count} disagrees with slugs.length=${bucket.slugs.length}`);
    }
  }
  return { specsWithParent: specs_with_parent, specsWithoutCitation: specs_without_citation };
}

export interface CensusVerdict {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** AC-BLS3B-11 decision: pass iff both counts are 0; every offending slug is named. */
export function evaluateCensus(census: Census): CensusVerdict {
  const lines = [
    `specs_with_parent: ${census.specsWithParent.count}`,
    `specs_without_citation: ${census.specsWithoutCitation.count}`,
  ];
  for (const slug of census.specsWithParent.slugs) lines.push(`FAIL parented spec: ${slug}`);
  for (const slug of census.specsWithoutCitation.slugs) lines.push(`FAIL uncited spec: ${slug}`);
  return { ok: census.specsWithParent.count === 0 && census.specsWithoutCitation.count === 0, lines };
}

export const LEDGER_EXPECTED_ROWS = 84;
const VERDICTS: readonly string[] = ["cite", "deprecate", "needs-rule"];
const AGREEMENTS: readonly string[] = ["exact", "overlap", "disjoint", "decision"];
const FINALS: readonly string[] = ["cite", "deprecate"];

export interface LedgerRow {
  readonly index: string;
  readonly spec: string;
  readonly mapperA: string;
  readonly mapperB: string;
  readonly agreement: string;
  readonly final: string;
  readonly ruling: string;
}

const LEDGER_HEADER = ["#", "Spec", "Mapper A", "Mapper B", "Agreement", "Final", "Ruling / destination"];

function tableCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

/** Split the ledger markdown table into rows; throws CorpusReadError if the header is absent or a row has the wrong column count. */
export function parseLedgerRows(markdown: string): LedgerRow[] {
  const tableLines = markdown.split("\n").filter((line) => line.startsWith("|"));
  const headerIdx = tableLines.findIndex((l) => tableCells(l).join("|") === LEDGER_HEADER.join("|"));
  if (headerIdx === -1) throw new CorpusReadError("ledger", `table header "${LEDGER_HEADER.join(" | ")}" not found`);
  return tableLines.slice(headerIdx + 2).map((line) => {
    const c = tableCells(line);
    if (c.length !== LEDGER_HEADER.length) {
      throw new CorpusReadError("ledger", `row has ${c.length} columns, expected ${LEDGER_HEADER.length}: ${line.slice(0, 80)}`);
    }
    return { index: c[0]!, spec: c[1]!, mapperA: c[2]!, mapperB: c[3]!, agreement: c[4]!, final: c[5]!, ruling: c[6]! };
  });
}

/** Normalised Final decision: the leading token, so "cite (overruled)" counts as cite. */
export function finalDecision(row: LedgerRow): string {
  return row.final.split(/\s+/)[0] ?? "";
}

/** Structural checks of AC-BLS3B-12: row count, verdict/agreement vocabularies, ruling present on every non-exact row. */
export function checkLedgerStructure(rows: readonly LedgerRow[]): string[] {
  const problems: string[] = [];
  if (rows.length !== LEDGER_EXPECTED_ROWS) problems.push(`ledger has ${rows.length} rows, expected ${LEDGER_EXPECTED_ROWS}`);
  const seen = new Set<string>();
  for (const row of rows) {
    const at = `row ${row.index} (${row.spec})`;
    if (seen.has(row.spec)) problems.push(`${at}: duplicate spec`);
    seen.add(row.spec);
    if (!VERDICTS.includes(row.mapperA)) problems.push(`${at}: mapper A verdict "${row.mapperA}" not in ${VERDICTS.join("/")}`);
    if (!VERDICTS.includes(row.mapperB)) problems.push(`${at}: mapper B verdict "${row.mapperB}" not in ${VERDICTS.join("/")}`);
    if (!AGREEMENTS.includes(row.agreement)) problems.push(`${at}: agreement "${row.agreement}" not in ${AGREEMENTS.join("/")}`);
    if (!FINALS.includes(finalDecision(row))) problems.push(`${at}: final "${row.final}" must start with ${FINALS.join(" or ")}`);
    if (row.agreement !== "exact" && row.ruling.length === 0) problems.push(`${at}: agreement "${row.agreement}" but ruling is empty`);
  }
  return problems;
}

const SpecEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    doc: z.object({
      slug: z.string(),
      status: z.string(),
      deleted_at: z.string().nullable(),
      // reason: a spec with no criteria (e.g. an old deprecated one) has no `acceptance_criteria` key; absence = zero criteria,
      // which the cite rule then fails on its own ("no criterion cites a live rule") — not a silent pass.
      extra: z
        .object({
          acceptance_criteria: z.array(z.object({ id: z.string(), cites: z.array(z.string()).optional() })).optional(),
        })
        .nullable(),
    }),
  }),
});

export interface SpecLiveState {
  readonly status: string;
  readonly deleted: boolean;
  /** Distinct rule ids cited by any criterion. */
  readonly citedRuleIds: readonly string[];
}

/** Parse `lore get <spec> --json` stdout into the live facts the ledger check needs. */
export function parseSpecLiveState(stdout: string): SpecLiveState {
  const source = "lore get <spec> --json";
  const parsed = SpecEnvelopeSchema.safeParse(parseJson(source, stdout));
  if (!parsed.success) throw new CorpusReadError(source, `unexpected shape: ${parsed.error.message}`);
  const { doc } = parsed.data.data;
  const ids = new Set<string>();
  for (const ac of doc.extra?.acceptance_criteria ?? []) for (const id of ac.cites ?? []) ids.add(id);
  return { status: doc.status, deleted: doc.deleted_at !== null, citedRuleIds: [...ids] };
}

const RuleEnvelopeSchema = z.object({ ok: z.literal(true), data: z.object({ id: z.string(), state: z.string() }) });

/** Parse `lore rule show <id> --json` stdout into the rule's lifecycle state. */
export function parseRuleState(stdout: string): string {
  const source = "lore rule show --json";
  const parsed = RuleEnvelopeSchema.safeParse(parseJson(source, stdout));
  if (!parsed.success) throw new CorpusReadError(source, `unexpected shape: ${parsed.error.message}`);
  return parsed.data.data.state;
}

/** Live view of one ledger row's spec; `null` = the spec does not exist. */
export type RowLiveView = { readonly spec: SpecLiveState; readonly ruleStates: Readonly<Record<string, string>> } | null;

/**
 * AC-BLS3B-12 live-state decision for one row.
 * Final=cite: spec exists, status not deprecated/archived, not deleted, and some cited rule is `live`.
 * Final=deprecate: spec status is deprecated or archived.
 * @returns a failure message, or `null` when the row matches the live corpus.
 */
export function checkRowAgainstLiveState(row: LedgerRow, view: RowLiveView): string | null {
  const at = `row ${row.index} (${row.spec})`;
  const decision = finalDecision(row);
  if (view === null) return `${at}: spec not found in corpus (final=${decision})`;
  const { spec, ruleStates } = view;
  if (decision === "deprecate") {
    return spec.status === "deprecated" || spec.status === "archived" ? null : `${at}: final=deprecate but live status is "${spec.status}"`;
  }
  if (decision === "cite") {
    if (spec.deleted || spec.status === "deprecated" || spec.status === "archived") {
      return `${at}: final=cite but spec is ${spec.deleted ? "deleted" : spec.status}`;
    }
    const liveRules = spec.citedRuleIds.filter((id) => ruleStates[id] === "live");
    if (liveRules.length === 0) {
      return `${at}: final=cite but no criterion cites a live rule (cited: ${spec.citedRuleIds.join(",") || "none"})`;
    }
    return null;
  }
  return `${at}: final "${row.final}" is neither cite nor deprecate`;
}
