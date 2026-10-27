/**
 * Decision flags: the CLI surface of a decision-carrying write (`--reason`, `--premise`, `--alt`, `--gate`, `--score`,
 * `--weight-table`, `--ref`) parsed into the {@link DecisionDraft} a service entry judges.
 *
 * Purpose: ONE definition of the seven flags and their parsing for every command whose write carries a decision
 *   (`lore set`, `lore baseline set-label|depends|glossary|map`, later `rule` and `ac` verbs), so no command re-types a flag
 *   description or a parser.
 * Public surface: {@link DECISION_FLAG_ARGS}, {@link parseDecisionFlags}.
 * Invariants:
 *   - Parsing is `@lore/core`'s (`parsePremiseFlag`, ...); a malformed flag is a `VALIDATION_ERROR` on field `decision`
 *     naming the flag and reason (exit 4), never a silent drop.
 *   - No flag given -> `ok(undefined)`: whether a decision was REQUIRED is the service's call (BR-1476), not this module's.
 *   - Imports nothing from `loader.ts` (vitest-safe split, adapters/cli/CLAUDE.md).
 * Side-effect class: pure.
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, "The decision payload" (CLI flags).
 */

import {
  err,
  ok,
  parseAlternativeFlag,
  parseGateFlag,
  parsePremiseFlag,
  parseRefFlag,
  parseScoreFlag,
  parseWeightTableFlag,
  type LoreError,
  type Result,
} from "@lore/core";
import type { DecisionDraft } from "../../service/decision-gate.js";

/** The citty arg definitions of the seven decision flags; spread into a command's `args`. */
export const DECISION_FLAG_ARGS = {
  reason: { type: "string", description: "[decision] Why this change is made. An agent's change to a non-draft target needs --reason, --premise and --alt" },
  premise: { type: "string", description: '[decision, repeatable] "<claim>|<source>|<tier>"; source: file:<path>:<from>[-<to>][@<sha>] | cmd:<command> ~ <expected> | issue:#<n> | doc:<slug>[@<v>]; tier S..E, one S..C needed' },
  alt: { type: "string", description: '[decision, repeatable] "<option>|<why rejected>"; at least one needed' },
  gate: { type: "string", description: '[decision, repeatable] "<id>|<pass|fail>|<evidence>"' },
  score: { type: "string", description: '[decision, repeatable] "<option>|<dimension>|<-1|0|1>|<evidence>"' },
  "weight-table": { type: "string", description: "[decision] <slug>@<version> of the weight table the scores use" },
  ref: { type: "string", description: '[decision, repeatable] "<practice>|<how this differs>"' },
} as const;

function repeatable(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function malformed(flag: string, reason: string, value: string): LoreError {
  return { code: "VALIDATION_ERROR", field: "decision", message: `--${flag}: ${reason}`, value, rule: "BR-1476" };
}

/**
 * Parse the decision flags of one invocation.
 *
 * @param args - the command's parsed args (only the seven decision keys are read)
 * @returns the draft, `ok(undefined)` when no decision flag was given, or the `decision` refusal for the first
 *   malformed flag.
 */
export function parseDecisionFlags(args: Readonly<Record<string, unknown>>): Result<DecisionDraft | undefined, LoreError> {
  const premiseTexts = repeatable(args["premise"]);
  const altTexts = repeatable(args["alt"]);
  const gateTexts = repeatable(args["gate"]);
  const scoreTexts = repeatable(args["score"]);
  const refTexts = repeatable(args["ref"]);
  const reason = args["reason"] === undefined ? undefined : String(args["reason"]);
  const weightText = args["weight-table"] === undefined ? undefined : String(args["weight-table"]);
  if (
    reason === undefined && weightText === undefined &&
    premiseTexts.length + altTexts.length + gateTexts.length + scoreTexts.length + refTexts.length === 0
  ) {
    return ok(undefined);
  }

  const premises = [];
  for (const text of premiseTexts) {
    const parsed = parsePremiseFlag(text);
    if (!parsed.ok) return err(malformed("premise", parsed.reason, text));
    premises.push(parsed.premise);
  }
  const alternatives = [];
  for (const text of altTexts) {
    const parsed = parseAlternativeFlag(text);
    if (!parsed.ok) return err(malformed("alt", parsed.reason, text));
    alternatives.push(parsed.alternative);
  }
  const gates = [];
  for (const text of gateTexts) {
    const parsed = parseGateFlag(text);
    if (!parsed.ok) return err(malformed("gate", parsed.reason, text));
    gates.push(parsed.gate);
  }
  const scores = [];
  for (const text of scoreTexts) {
    const parsed = parseScoreFlag(text);
    if (!parsed.ok) return err(malformed("score", parsed.reason, text));
    scores.push(parsed.score);
  }
  const refs = [];
  for (const text of refTexts) {
    const parsed = parseRefFlag(text);
    if (!parsed.ok) return err(malformed("ref", parsed.reason, text));
    refs.push(parsed.ref);
  }
  let weightTable;
  if (weightText !== undefined) {
    const parsed = parseWeightTableFlag(weightText);
    if (!parsed.ok) return err(malformed("weight-table", parsed.reason, weightText));
    weightTable = parsed.weightTable;
  }
  return ok({
    ...(reason !== undefined ? { reason } : {}),
    premises,
    alternatives,
    ...(gates.length > 0 ? { gates } : {}),
    ...(scores.length > 0 ? { scores } : {}),
    ...(weightTable !== undefined ? { weightTable } : {}),
    ...(refs.length > 0 ? { refs } : {}),
  });
}
