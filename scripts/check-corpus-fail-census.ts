#!/usr/bin/env bun
/**
 * Corpus fail census (`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a`,
 * AC-OX-11; cites AS-17 - a completeness oracle never reports complete over what it could not see).
 *
 * Purpose: report how many live script acceptance criteria are in coverage state `fail`, naming
 * each, enumerated from the corpus instead of counted per spec by hand.
 * Public surface: `collectFailCensus` (pure over an injected `lore ... --json` reader),
 * `runCensus` (prints, returns the exit code), `main` (IO, spawns the `lore` CLI).
 * Invariants: this script derives NOTHING. The coverage `state` is read verbatim from
 * `lore ac list --json`, which fills it with `deriveAcCoverageState` (`@lore/core`), the single
 * fail-first derivation; a second precedence implementation here is what
 * `check:ac-state-renderers` exists to refuse. Only the exact state `fail` counts:
 * `fail_superseded` (a newer attested pass exists) and `not_measured` are different facts.
 * Deprecated specs are skipped, counted and named (AS-17), as in `check-ac-oracle-ownership`.
 * Side-effect class: IO (spawns `lore`, prints).
 *
 * Exit codes: 0 no live script AC is in state fail; 1 at least one is, OR zero script ACs were
 * visible (`rule=nothing-scanned`, never a clean 0 over nothing); a lore failure or an
 * unexpected output shape throws (the CLI entry prints it and exits 1).
 *
 * Usage: bun scripts/check-corpus-fail-census.ts
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ListSchema, runLoreJson } from "./check-ac-oracle-ownership.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

const CoverageListSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    criteria: z.array(z.object({ id: z.string(), verify: z.object({ mode: z.string().optional() }).optional() })),
    // reason: `coverage` is null for a spec with no child task evidence yet - no coverage means no state, so no `fail`
    coverage: z.array(z.object({ ac_id: z.string(), mode: z.string(), state: z.string() })).nullable(),
  }),
});

/** Injected `lore ... --json` reader (the default spawns the CLI); lets tests feed any corpus shape. */
export type CensusJsonRunner = <T extends z.ZodTypeAny>(args: readonly string[], schema: T) => z.infer<T>;

/** One live script criterion whose derived coverage state is `fail`. */
export interface FailOffender {
  readonly spec: string;
  readonly acId: string;
}

export interface FailCensus {
  readonly scannedSpecs: number;
  readonly scannedScriptAcs: number;
  readonly skippedDeprecatedSpecs: readonly string[];
  readonly offenders: readonly FailOffender[];
}

/** Enumerates every live spec's script criteria and collects those whose coverage state is exactly `fail`. */
export function collectFailCensus(runJson: CensusJsonRunner): FailCensus {
  const specs = runJson(["list", "--type", "spec", "--json"], ListSchema);
  const offenders: FailOffender[] = [];
  const skippedDeprecatedSpecs: string[] = [];
  let scannedSpecs = 0;
  let scannedScriptAcs = 0;
  for (const doc of specs.data.docs) {
    if (doc.status === "deprecated") {
      skippedDeprecatedSpecs.push(doc.slug);
      continue;
    }
    scannedSpecs += 1;
    const listing = runJson(["ac", "list", doc.slug, "--json"], CoverageListSchema);
    scannedScriptAcs += listing.data.criteria.filter((c) => c.verify?.mode === "script").length;
    for (const entry of listing.data.coverage ?? []) {
      if (entry.mode === "script" && entry.state === "fail") offenders.push({ spec: doc.slug, acId: entry.ac_id });
    }
  }
  return { scannedSpecs, scannedScriptAcs, skippedDeprecatedSpecs, offenders };
}

/** Prints the census through `print` and returns the exit code (0 clean, 1 offenders or nothing scanned). */
export function runCensus(runJson: CensusJsonRunner, print: (line: string) => void): number {
  const census = collectFailCensus(runJson);
  const skipped = census.skippedDeprecatedSpecs;
  print(`check-corpus-fail-census: skipped ${skipped.length} deprecated spec(s)${skipped.length > 0 ? `: ${skipped.join(", ")}` : ""}`);
  if (census.scannedScriptAcs === 0) {
    print("check-corpus-fail-census: FAIL - rule=nothing-scanned: 0 script ACs were visible; refusing to report complete (AS-17).");
    return 1;
  }
  print(
    `check-corpus-fail-census: scanned ${census.scannedScriptAcs} script AC(s) across ${census.scannedSpecs} live spec(s); ${census.offenders.length} in state fail.`,
  );
  for (const o of census.offenders) print(`  fail spec=${o.spec} ac=${o.acId}`);
  return census.offenders.length === 0 ? 0 : 1;
}

/** Runs the census for the corpus at `corpusCwd`; returns the exit code, never calls `process.exit`. */
export function main(corpusCwd: string = REPO_ROOT, indexTs: string = join(REPO_ROOT, "packages", "lore", "src", "index.ts")): number {
  return runCensus((args, schema) => runLoreJson(corpusCwd, indexTs, args, schema), (line) => console.log(line));
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`check-corpus-fail-census: scan failed - ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
