#!/usr/bin/env bun
/**
 * `lore assess` golden-fixture harness (SPEC-040 §T3 D7, AC-ADF-7, AC-ADF-12).
 *
 * A promotion gate for a NEW assess judge prompt version
 * (`ASSESS_PROMPT_VERSION` in `packages/lore/src/ai/assess-template.ts`) — run this
 * BEFORE bumping the active version, to catch a candidate prompt that systematically
 * regresses against a curated set of hand-designed outcome fixtures
 * (`packages/lore/tests/fixtures/assess-golden/`).
 *
 * ## Promotion rule (SPEC-040 §T3 D7)
 *
 * For each fixture, both the CANDIDATE and INCUMBENT prompt versions run N times
 * (default 3) through the configured AI provider. Each run's `overall_score` is mapped
 * onto a coarse direction label (`met` >=80 / `partial` / `not_met` <40 — see
 * `deriveGoldenDirectionLabel`, `packages/lore/src/ai/assess-golden-aggregation.ts`),
 * and the N labels are collapsed to one majority label per fixture per version
 * (`computeMajorityLabel` — a genuine tie resolves to the most conservative label).
 *
 * The candidate is PROMOTABLE iff its fixture-agreement-with-expected rate is >= the
 * incumbent's own agreement rate (`aggregateGoldenRun`'s `promotable` field) — a
 * NON-INFERIORITY check, not a requirement to strictly improve. A tie passes. This
 * mirrors "first, do no harm": a prompt change that regresses agreement on this curated
 * set should not be promoted even if it fixes an unrelated problem elsewhere — split
 * the change instead.
 *
 * ## Modes
 *
 *   --dry-run
 *     Lists every registered fixture (name + expected label + description) in the
 *     fixture registry's fixed declared order. Exits 0. Makes ZERO calls to any AI
 *     provider — this is the mode exercised by the CI/test oracle (AC-ADF-7), since it
 *     has no external dependency and no cost.
 *
 *   --candidate <version> --incumbent <version> [--runs <n>]
 *     Actually invokes the configured AI provider (via `getAssessTemplate(version)` +
 *     `buildProviderRegistry`, reading `.lore/config.yaml` from the current working
 *     directory if present) N times per fixture per version, and prints the
 *     `GoldenAggregationResult` as JSON. Exit 0 if promotable, exit 1 otherwise.
 *     NOT invoked by `bun run test` / CI — it costs real provider calls and its
 *     non-determinism (real LLM output) makes it unsuitable as an automated pass/fail
 *     oracle. The pure ARITHMETIC this mode's output feeds through (`aggregateGoldenRun`,
 *     `computeMajorityLabel`) IS unit-tested with scripted labels
 *     (`packages/lore/tests/unit/ai/assess-golden-aggregation.test.ts`, AC-ADF-12) — this
 *     script only wires that pure function to a live provider, it doesn't reimplement it.
 *
 * Usage:
 *   bun scripts/assess-golden.ts --dry-run
 *   bun scripts/assess-golden.ts --candidate 7 --incumbent 6
 *   bun scripts/assess-golden.ts --candidate 7 --incumbent 6 --runs 5
 */

import { AiConfigSchema, extractAssessmentJson, llmAssessmentOutputSchema } from "@lore/core";
import { loadConfig } from "@lore/core/node";
import { buildProviderRegistry } from "../packages/lore/src/ai/registry.js";
import { getAssessTemplate } from "../packages/lore/src/ai/assess-template.js";
import { ASSESS_GOLDEN_FIXTURES } from "../packages/lore/tests/fixtures/assess-golden/index.js";
import type { AssessGoldenFixture } from "../packages/lore/tests/fixtures/assess-golden/index.js";
import {
  aggregateGoldenRun,
  deriveGoldenDirectionLabel,
} from "../packages/lore/src/ai/assess-golden-aggregation.js";
import type { GoldenDirectionLabel, GoldenFixtureRun } from "../packages/lore/src/ai/assess-golden-aggregation.js";

/** Default number of judge runs per fixture per prompt version (SPEC-040 §T3 D7). */
const DEFAULT_RUNS_PER_VERSION = 3;

/**
 * `LoreError` is a discriminated union — not every variant carries a `message` field
 * (e.g. `DOC_NOT_FOUND` only has `id`/`suggestions`). Falls back to the error `code`
 * so every call site gets a printable string without a narrowing check of its own.
 */
function describeLoreError(error: import("@lore/core").LoreError): string {
  return "message" in error ? error.message : error.code;
}

/** Parsed CLI arguments for this script. */
export interface AssessGoldenCliArgs {
  dryRun: boolean;
  candidate: number | undefined;
  incumbent: number | undefined;
  runs: number;
}

/**
 * Parse this script's argv (excluding the `bun`/script-path prefix). Pure — no IO,
 * no process.exit — so it's directly unit-testable.
 *
 * @example
 * parseArgs(["--dry-run"]); // → { dryRun: true, candidate: undefined, incumbent: undefined, runs: 3 }
 * parseArgs(["--candidate", "7", "--incumbent", "6"]);
 * // → { dryRun: false, candidate: 7, incumbent: 6, runs: 3 }
 */
export function parseArgs(argv: readonly string[]): AssessGoldenCliArgs {
  let dryRun = false;
  let candidate: number | undefined;
  let incumbent: number | undefined;
  let runs = DEFAULT_RUNS_PER_VERSION;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--candidate") {
      i += 1;
      candidate = Number(argv[i]);
      continue;
    }
    if (arg === "--incumbent") {
      i += 1;
      incumbent = Number(argv[i]);
      continue;
    }
    if (arg === "--runs") {
      i += 1;
      runs = Number(argv[i]);
      continue;
    }
  }

  return { dryRun, candidate, incumbent, runs };
}

/**
 * Render the `--dry-run` fixture listing — one tab-separated line per fixture, in the
 * registry's fixed declared order (AC-ADF-7 "deterministic order"). Pure.
 */
export function formatDryRunListing(fixtures: readonly AssessGoldenFixture[]): string {
  return fixtures.map((f) => `${f.name}\t${f.expectedLabel}\t${f.description}`).join("\n");
}

/**
 * Run one fixture against one prompt version, N times, returning the derived direction
 * label for each run. Throws on any provider/parse/schema failure — a golden-harness
 * run is an all-or-nothing operation (a fixture that can't be scored at all makes the
 * whole aggregation meaningless, so this fails loud rather than silently skipping it).
 */
async function runFixtureVersion(
  fixture: AssessGoldenFixture,
  version: number,
  runs: number,
  provider: import("@lore/core").AIProvider,
  budgets: { max_plan_chars: number; max_spec_chars: number; max_task_chars: number; max_diff_chars: number },
): Promise<GoldenDirectionLabel[]> {
  const templateResult = getAssessTemplate(version);
  if (!templateResult.ok) {
    throw new Error(`assess-golden: ${describeLoreError(templateResult.error)}`);
  }

  const labels: GoldenDirectionLabel[] = [];
  for (let i = 0; i < runs; i += 1) {
    const { prompt } = templateResult.value(fixture.bundle, fixture.diffText, budgets);
    const generated = await provider.generate({
      prompt,
      doc_type: "knowledge",
      title: fixture.bundle.plan.title,
    });
    if (!generated.ok) {
      throw new Error(
        `assess-golden: provider error on fixture "${fixture.name}" v${version} run ${i + 1}: ` +
          describeLoreError(generated.error),
      );
    }
    const extracted = extractAssessmentJson(generated.value.content);
    if (!extracted.ok) {
      throw new Error(
        `assess-golden: could not extract JSON on fixture "${fixture.name}" v${version} run ${i + 1}: ${describeLoreError(extracted.error)}`,
      );
    }
    const validated = llmAssessmentOutputSchema.safeParse(extracted.value);
    if (!validated.success) {
      throw new Error(
        `assess-golden: judge output failed schema validation on fixture "${fixture.name}" v${version} run ${i + 1}`,
      );
    }
    labels.push(deriveGoldenDirectionLabel(validated.data.overall_score));
  }
  return labels;
}

/** Scored mode: runs every fixture through both versions and prints the aggregation. */
async function runScored(candidate: number, incumbent: number, runs: number): Promise<number> {
  const configResult = loadConfig(process.cwd());
  const aiConfig = configResult.ok && configResult.value.ai !== undefined
    ? configResult.value.ai
    : AiConfigSchema.parse({});

  const registryResult = buildProviderRegistry(aiConfig);
  if (!registryResult.ok) {
    console.error(`assess-golden: failed to build provider registry: ${describeLoreError(registryResult.error)}`);
    return 1;
  }
  const provider = registryResult.value.providers.get(registryResult.value.active);
  if (provider === undefined) {
    console.error(`assess-golden: active provider "${registryResult.value.active}" not found in registry`);
    return 1;
  }

  const fixtureRuns: GoldenFixtureRun[] = [];
  for (const fixture of ASSESS_GOLDEN_FIXTURES) {
    const candidateLabels = await runFixtureVersion(fixture, candidate, runs, provider, aiConfig.assess);
    const incumbentLabels = await runFixtureVersion(fixture, incumbent, runs, provider, aiConfig.assess);
    fixtureRuns.push({
      fixtureName: fixture.name,
      expectedLabel: fixture.expectedLabel,
      candidateLabels,
      incumbentLabels,
    });
  }

  const aggregation = aggregateGoldenRun(fixtureRuns);
  console.log(JSON.stringify(aggregation, null, 2));
  return aggregation.promotable ? 0 : 1;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));

  if (args.dryRun) {
    console.log(formatDryRunListing(ASSESS_GOLDEN_FIXTURES));
    process.exit(0);
  }

  if (
    args.candidate === undefined ||
    args.incumbent === undefined ||
    Number.isNaN(args.candidate) ||
    Number.isNaN(args.incumbent)
  ) {
    console.error(
      "Usage: bun scripts/assess-golden.ts --dry-run\n" +
        "   or: bun scripts/assess-golden.ts --candidate <version> --incumbent <version> [--runs <n>]",
    );
    process.exit(2);
  }

  try {
    const exitCode = await runScored(args.candidate, args.incumbent, args.runs);
    process.exit(exitCode);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
