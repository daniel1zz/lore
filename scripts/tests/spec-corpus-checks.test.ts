/**
 * Tests for the pure decision logic of `scripts/check-spec-citation-census.ts` (AC-BLS3B-11) and
 * `scripts/check-uncited-spec-ledger.ts` (AC-BLS3B-12). In-memory strings only: no subprocess, no corpus.
 */
import { describe, expect, it } from "vitest";
import {
  CorpusReadError,
  checkLedgerStructure,
  checkRowAgainstLiveState,
  evaluateCensus,
  finalDecision,
  parseCensus,
  parseLedgerRows,
  parseRuleState,
  parseSpecLiveState,
  type LedgerRow,
} from "../lib/spec-corpus-checks.js";

const status = (withParent: string[], uncited: string[], count = { p: withParent.length, u: uncited.length }) =>
  JSON.stringify({
    ok: true,
    data: {
      specs_with_parent: { count: count.p, slugs: withParent },
      specs_without_citation: { count: count.u, slugs: uncited },
    },
  });

describe("AC-BLS3B-11 census decision", () => {
  it("HAPPY: both buckets empty passes and prints both counts", () => {
    const v = evaluateCensus(parseCensus(status([], [])));
    expect(v.ok).toBe(true);
    expect(v.lines).toEqual(["specs_with_parent: 0", "specs_without_citation: 0"]);
  });
  it("NEGATIVE: a parented spec fails and is named", () => {
    const v = evaluateCensus(parseCensus(status(["spec-a"], [])));
    expect(v.ok).toBe(false);
    expect(v.lines).toContain("FAIL parented spec: spec-a");
  });
  it("NEGATIVE: an uncited spec fails and is named", () => {
    const v = evaluateCensus(parseCensus(status([], ["spec-b", "spec-c"])));
    expect(v.ok).toBe(false);
    expect(v.lines).toContain("FAIL uncited spec: spec-b");
    expect(v.lines).toContain("FAIL uncited spec: spec-c");
  });
  it("ERROR: a missing field is a read error, never read as 0", () => {
    const missing = JSON.stringify({ ok: true, data: { specs_with_parent: { count: 0, slugs: [] } } });
    expect(() => parseCensus(missing)).toThrow(CorpusReadError);
  });
  it("ERROR: non-JSON and ok:false envelopes are read errors", () => {
    expect(() => parseCensus("not json")).toThrow(CorpusReadError);
    expect(() => parseCensus(JSON.stringify({ ok: false, error: { code: "X" } }))).toThrow(CorpusReadError);
  });
  it("BOUNDARY: count disagreeing with slugs.length is a read error", () => {
    expect(() => parseCensus(status([], [], { p: 0, u: 2 }))).toThrow(/disagrees/);
  });
});

const header = "| # | Spec | Mapper A | Mapper B | Agreement | Final | Ruling / destination |\n|---|---|---|---|---|---|---|\n";
const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  index: "1",
  spec: "spec-x",
  mapperA: "cite",
  mapperB: "cite",
  agreement: "exact",
  final: "cite",
  ruling: "",
  ...over,
});
const many = (n: number, over: (i: number) => Partial<LedgerRow> = () => ({})) =>
  Array.from({ length: n }, (_, i) => row({ index: String(i + 1), spec: `spec-${i}`, ...over(i) }));

describe("AC-BLS3B-12 ledger parsing and structure", () => {
  it("HAPPY: parses rows after the header and normalises 'cite (overruled)'", () => {
    const md = `intro\n\n${header}| 1 | spec-a | cite | deprecate | decision | cite (overruled) | ruling text |\n`;
    const rows = parseLedgerRows(md);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spec).toBe("spec-a");
    expect(finalDecision(rows[0]!)).toBe("cite");
  });
  it("ERROR: missing header or wrong column count is a read error", () => {
    expect(() => parseLedgerRows("| a | b |\n|---|---|\n| 1 | 2 |")).toThrow(CorpusReadError);
    expect(() => parseLedgerRows(`${header}| 1 | spec-a | cite |\n`)).toThrow(/columns/);
  });
  it("HAPPY: 84 well-formed rows pass", () => {
    expect(checkLedgerStructure(many(84))).toEqual([]);
  });
  it("BOUNDARY: 83 and 85 rows fail the count", () => {
    expect(checkLedgerStructure(many(83))[0]).toMatch(/83 rows/);
    expect(checkLedgerStructure(many(85))[0]).toMatch(/85 rows/);
  });
  it("NEGATIVE: bad verdict, bad agreement, bad final, duplicate spec, empty ruling on non-exact", () => {
    const rows = many(84);
    rows[0] = row({ index: "1", spec: "spec-0", mapperA: "maybe" });
    rows[1] = row({ index: "2", spec: "spec-1", agreement: "yes" });
    rows[2] = row({ index: "3", spec: "spec-2", final: "needs-rule" });
    rows[3] = row({ index: "4", spec: "spec-2" });
    rows[4] = row({ index: "5", spec: "spec-4", agreement: "decision", ruling: "" });
    const problems = checkLedgerStructure(rows).join("\n");
    expect(problems).toMatch(/mapper A verdict "maybe"/);
    expect(problems).toMatch(/agreement "yes"/);
    expect(problems).toMatch(/final "needs-rule"/);
    expect(problems).toMatch(/duplicate spec/);
    expect(problems).toMatch(/ruling is empty/);
  });
  it("BOUNDARY: an exact row may carry an empty ruling", () => {
    expect(checkLedgerStructure(many(84, () => ({ agreement: "exact", ruling: "" })))).toEqual([]);
  });
});

const specJson = (over: { status?: string; deleted_at?: string | null; criteria?: unknown } = {}) =>
  JSON.stringify({
    ok: true,
    data: {
      doc: {
        slug: "spec-x",
        status: over.status ?? "approved",
        deleted_at: over.deleted_at ?? null,
        extra: over.criteria === undefined ? { acceptance_criteria: [{ id: "AC-1", cites: ["BR-1", "AS-2"] }, { id: "AC-2" }] } : over.criteria,
      },
    },
  });

describe("AC-BLS3B-12 live-state decision", () => {
  it("HAPPY: parses status, deletion, and distinct cited rule ids", () => {
    const s = parseSpecLiveState(specJson());
    expect(s).toEqual({ status: "approved", deleted: false, citedRuleIds: ["BR-1", "AS-2"] });
  });
  it("ERROR: wrong shapes are read errors; a spec without criteria parses as zero cites", () => {
    expect(() => parseSpecLiveState("{}")).toThrow(CorpusReadError);
    expect(parseSpecLiveState(specJson({ criteria: {} })).citedRuleIds).toEqual([]);
    expect(() => parseRuleState(JSON.stringify({ ok: true, data: { id: "BR-1" } }))).toThrow(CorpusReadError);
    expect(parseRuleState(JSON.stringify({ ok: true, data: { id: "BR-1", state: "live" } }))).toBe("live");
  });
  it("HAPPY: cite row passes with a live spec citing a live rule", () => {
    const view = { spec: parseSpecLiveState(specJson()), ruleStates: { "BR-1": "live" } };
    expect(checkRowAgainstLiveState(row(), view)).toBeNull();
  });
  it("NEGATIVE: cite row fails when no cited rule is live, spec is dead, or spec is missing", () => {
    const spec = parseSpecLiveState(specJson());
    expect(checkRowAgainstLiveState(row(), { spec, ruleStates: { "BR-1": "deprecated", "AS-2": "missing" } })).toMatch(/no criterion cites a live rule/);
    expect(checkRowAgainstLiveState(row(), { spec: parseSpecLiveState(specJson({ status: "deprecated" })), ruleStates: { "BR-1": "live" } })).toMatch(/spec is deprecated/);
    expect(checkRowAgainstLiveState(row(), { spec: parseSpecLiveState(specJson({ deleted_at: "2026-10-01" })), ruleStates: { "BR-1": "live" } })).toMatch(/deleted/);
    expect(checkRowAgainstLiveState(row(), null)).toMatch(/not found/);
  });
  it("HAPPY/NEGATIVE: deprecate row needs deprecated or archived status", () => {
    const dep = row({ final: "deprecate" });
    expect(checkRowAgainstLiveState(dep, { spec: parseSpecLiveState(specJson({ status: "deprecated" })), ruleStates: {} })).toBeNull();
    expect(checkRowAgainstLiveState(dep, { spec: parseSpecLiveState(specJson({ status: "archived" })), ruleStates: {} })).toBeNull();
    expect(checkRowAgainstLiveState(dep, { spec: parseSpecLiveState(specJson({ status: "approved" })), ruleStates: {} })).toMatch(/final=deprecate/);
  });
  it("REGRESSION: 'cite (overruled)' is judged as cite", () => {
    const view = { spec: parseSpecLiveState(specJson({ status: "approved" })), ruleStates: {} };
    expect(checkRowAgainstLiveState(row({ final: "cite (overruled)" }), view)).toMatch(/no criterion cites a live rule/);
  });
});
