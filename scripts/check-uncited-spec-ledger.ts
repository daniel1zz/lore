#!/usr/bin/env bun
/**
 * Read-only check of the uncited-spec mapping ledger (AC-BLS3B-12,
 * `spec-baseline-slice-3b-specs-belong-to-the-trees-through`): the knowledge doc
 * `knowledge-uncited-spec-mapping-ledger-slice-3b` must hold 84 well-formed rows, and every row's Final
 * decision must match the spec's live state (cite -> live spec citing a live rule; deprecate -> deprecated/archived).
 * Exit 0 = all pass, 1 = mismatch (per-row lines printed), 2 = a lore read failed.
 * Side-effect class: IO (read-only lore calls). Decision logic lives in `scripts/lib/spec-corpus-checks.ts`.
 */
import { z } from "zod";
import { runLore } from "./lib/lore-cli.js";
import {
  CorpusReadError,
  checkLedgerStructure,
  checkRowAgainstLiveState,
  finalDecision,
  parseLedgerRows,
  parseRuleState,
  parseSpecLiveState,
  type RowLiveView,
} from "./lib/spec-corpus-checks.js";

const LEDGER_SLUG = "knowledge-uncited-spec-mapping-ledger-slice-3b";
const LedgerDocSchema = z.object({ ok: z.literal(true), data: z.object({ doc: z.object({ content: z.string() }) }) });
const DOC_NOT_FOUND_EXIT = 3;

function readLedgerMarkdown(): string {
  const label = `lore get ${LEDGER_SLUG}`;
  const stdout = runLore(["get", LEDGER_SLUG, "--json"]).stdout;
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch (cause) {
    throw new CorpusReadError(label, `stdout is not JSON (${String(cause)})`);
  }
  const parsed = LedgerDocSchema.safeParse(raw);
  if (!parsed.success) throw new CorpusReadError(label, `unexpected shape: ${parsed.error.message}`);
  return parsed.data.data.doc.content;
}

/** CLI surface: returns the process exit code. */
export function main(): number {
  try {
    const rows = parseLedgerRows(readLedgerMarkdown());
    const problems = checkLedgerStructure(rows);
    const ruleStates: Record<string, string> = {};
    for (const row of rows) {
      let view: RowLiveView = null;
      const res = runLore(["get", row.spec, "--json"], [0, DOC_NOT_FOUND_EXIT]);
      if (res.status === 0) {
        const spec = parseSpecLiveState(res.stdout);
        if (finalDecision(row) === "cite") {
          for (const id of spec.citedRuleIds) {
            if (!(id in ruleStates)) {
              const rule = runLore(["rule", "show", id, "--json"], [0, DOC_NOT_FOUND_EXIT]);
              ruleStates[id] = rule.status === 0 ? parseRuleState(rule.stdout) : "missing";
            }
          }
        }
        view = { spec, ruleStates };
      }
      const failure = checkRowAgainstLiveState(row, view);
      if (failure !== null) problems.push(failure);
    }
    for (const p of problems) console.log(`FAIL ${p}`); // CLI surface
    console.log(`ledger rows: ${rows.length}; failures: ${problems.length}`); // CLI surface
    return problems.length === 0 ? 0 : 1;
  } catch (err) {
    if (err instanceof CorpusReadError) {
      console.error(`check-uncited-spec-ledger: read error: ${err.message}`); // CLI surface
      return 2;
    }
    throw err;
  }
}

if (import.meta.main) process.exit(main());
