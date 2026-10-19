#!/usr/bin/env bun
/**
 * The `bun run test` chain runner (task-skill-implement-tg-15, AC-TG-10 / AC-TG-11).
 *
 * Purpose: run EVERY step of the test chain in order and print a per-step exit table, then exit
 * non-zero if any step failed. It replaces an `&&` chain, in which the first red step hid every
 * step behind it (measured: check:spec-mirror red hid check:ac-oracle-ownership red).
 * Public surface: `DEFAULT_STEPS` (the chain, in order), `runChain` (pure over an injected runner),
 * `renderTable`, `main` (IO, returns the exit code).
 * Invariants: every step runs even after a failure; a step that cannot start counts as failed
 * (exit 127), never as skipped; zero steps is an error, not a pass.
 * Side-effect class: IO in `main` (spawns each step with inherited stdio); `runChain`/`renderTable` are pure.
 *
 * Usage: bun scripts/run-chain.ts [shell-command ...]   (no arguments = DEFAULT_STEPS)
 *        bun scripts/run-chain.ts --floor [package.json]    (build + typecheck + every ^check: script except the corpus-dependent set = `bun run check:floor`)
 *        bun scripts/run-chain.ts --static [package.json]   (build + typecheck + every ^check: script = `bun run check:static`)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/** The chain, in the order `bun run test` has always run it (test:vitest stays after the cheap checks). */
export const DEFAULT_STEPS: readonly string[] = [
  "bun run check:ac-state-renderers",
  "bun run check:prose-pins",
  "bun run check:capture-source-buckets",
  "bun run check:hook-shell-cwd",
  "bun run test:vitest",
  "bun run check:spec-mirror",
  "bun run check:live-repo-state",
  "bun run check:corpus-fail-census",
  "bun run check:ac-oracle-ownership",
  "bun run check:evidence-identity-drop-set",
];

export interface StepResult {
  readonly step: string;
  readonly exit: number;
  readonly seconds: number;
}

export type StepRunner = (step: string) => { exit: number; seconds: number };

/** Run every step in order, never stopping at a failure. */
export function runChain(steps: readonly string[], run: StepRunner): StepResult[] {
  if (steps.length === 0) throw new Error("run-chain: no steps to run (refusing to report a pass over nothing)");
  return steps.map((step) => ({ step, ...run(step) }));
}

/** Env var naming a file that receives the machine-readable per-step timings (`lore integrate` reads it; never parse the table). */
export const FLOOR_TIMINGS_ENV = "LORE_FLOOR_TIMINGS_FILE";

/**
 * Write `{ schema_version: 1, steps: [{ step, exit, seconds }] }` to the file named by `LORE_FLOOR_TIMINGS_FILE`;
 * a no-op when the variable is unset or empty. Called after every chain so a failing floor still reports its timings.
 */
export function emitTimings(results: readonly StepResult[], env: Readonly<Record<string, string | undefined>> = process.env): void {
  const file = env[FLOOR_TIMINGS_ENV];
  if (file === undefined || file === "") return;
  writeFileSync(file, `${JSON.stringify({ schema_version: 1, steps: results.map((r) => ({ step: r.step, exit: r.exit, seconds: r.seconds })) })}\n`);
}

/**
 * Render the per-step exit table. `labels` maps a step to a short note appended to its row
 * (check:static uses it to mark corpus-dependent steps); steps absent from the map get no note.
 */
export function renderTable(results: readonly StepResult[], labels: ReadonlyMap<string, string> = new Map()): string {
  const width = Math.max(...results.map((r) => r.step.length));
  const rows = results.map((r) => {
    const note = labels.get(r.step);
    return `  ${r.exit === 0 ? "PASS" : "FAIL"}  exit ${String(r.exit).padStart(3)}  ${r.seconds.toFixed(1).padStart(7)}s  ${r.step.padEnd(width)}${note === undefined ? "" : `  [${note}]`}`;
  });
  const failed = results.filter((r) => r.exit !== 0);
  const verdict = failed.length === 0 ? `run-chain: all ${results.length} steps passed` : `run-chain: ${failed.length} of ${results.length} steps FAILED: ${failed.map((r) => r.step).join("; ")}`;
  return ["", "=== run-chain: per-step exit table", ...rows, verdict].join("\n");
}

/**
 * The check:* scripts whose verdict depends on live corpus / mirror state rather than on the code alone:
 * the first two are red until `bun scripts/export-spec-mirror.ts` ran, the census reads recorded AC states.
 */
export const CORPUS_DEPENDENT_CHECKS: ReadonlySet<string> = new Set([
  "check:spec-mirror", // reason: compares the exported mirror to live corpus docs
  "check:live-repo-state", // reason: sweeps the live corpus / repo state, not the merged code
  "check:corpus-fail-census", // reason: reads recorded AC states in the corpus
  "check:evidence-identity-drop-set", // reason: judges only recorded AC states in the corpus; a branch cannot turn it red
  "check:ac-ref-integrity", // reason: judges evidence rows' ac_ref against declared ACs in the corpus only
]);
export const CORPUS_DEPENDENT_LABEL = "corpus-dependent: needs a fresh mirror export / live corpus state";

/** Aggregate scripts excluded from every derived list: they ARE the chains, naming them would recurse. */
const AGGREGATE_SCRIPTS: ReadonlySet<string> = new Set(["check:static", "check:floor"]);

/**
 * Derive the `check:static` step list from a package.json `scripts` map: build, typecheck, then EVERY
 * `^check:` script in declaration order (so a new check is picked up with no edit here).
 * @throws Error when the map has no `build` or `typecheck` script (a floor missing its base steps is not a floor).
 */
export function deriveStaticSteps(scripts: Readonly<Record<string, string>>): { steps: string[]; labels: Map<string, string> } {
  for (const base of ["build", "typecheck"]) {
    if (!(base in scripts)) throw new Error(`check:static: package.json has no "${base}" script`);
  }
  const checks = Object.keys(scripts).filter((name) => /^check:/.test(name) && !AGGREGATE_SCRIPTS.has(name));
  const steps = ["build", "typecheck", ...checks].map((name) => `bun run ${name}`);
  const labels = new Map<string, string>();
  for (const name of checks) if (CORPUS_DEPENDENT_CHECKS.has(name)) labels.set(`bun run ${name}`, CORPUS_DEPENDENT_LABEL);
  return { steps, labels };
}

/** Run the derived static floor over `packageJsonPath` and print the labelled table; returns the exit code. */
export function runStaticFloor(packageJsonPath: string, run: StepRunner = spawnStep): number {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const scripts = (parsed as { scripts?: Record<string, string> }).scripts;
  if (scripts === undefined) throw new Error(`check:static: ${packageJsonPath} has no scripts`);
  const { steps, labels } = deriveStaticSteps(scripts);
  const results = runChain(steps, run);
  console.log(renderTable(results, labels));
  emitTimings(results);
  return results.every((r) => r.exit === 0) ? 0 : 1;
}

/**
 * Derive the `check:floor` step list (the integrate floor): build, typecheck, then every `^check:` script
 * except the aggregates and CORPUS_DEPENDENT_CHECKS (the one source of what judges corpus state, not code).
 * @throws Error when the map has no `build` or `typecheck` script.
 */
export function deriveFloorSteps(scripts: Readonly<Record<string, string>>): string[] {
  for (const base of ["build", "typecheck"]) {
    if (!(base in scripts)) throw new Error(`check:floor: package.json has no "${base}" script`);
  }
  const checks = Object.keys(scripts).filter((name) => /^check:/.test(name) && !AGGREGATE_SCRIPTS.has(name) && !CORPUS_DEPENDENT_CHECKS.has(name));
  return ["build", "typecheck", ...checks].map((name) => `bun run ${name}`);
}

/** Run the derived integrate floor over `packageJsonPath` and print the table; returns the exit code. */
export function runFloor(packageJsonPath: string, run: StepRunner = spawnStep): number {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const scripts = (parsed as { scripts?: Record<string, string> }).scripts;
  if (scripts === undefined) throw new Error(`check:floor: ${packageJsonPath} has no scripts`);
  const results = runChain(deriveFloorSteps(scripts), run);
  console.log(renderTable(results));
  emitTimings(results);
  return results.every((r) => r.exit === 0) ? 0 : 1;
}

function spawnStep(step: string): { exit: number; seconds: number } {
  console.log(`\n=== run-chain: ${step}`);
  const t0 = Date.now();
  const r = spawnSync("sh", ["-c", step], { cwd: ROOT, stdio: "inherit" });
  const seconds = (Date.now() - t0) / 1000;
  if (r.error !== undefined) {
    console.error(`run-chain: step failed to start: ${step}: ${r.error.message}`);
    return { exit: 127, seconds };
  }
  // a step killed by a signal has status null: that is a failure, never a pass
  return { exit: r.status ?? 128, seconds };
}

export function main(argv: readonly string[], run: StepRunner = spawnStep): number {
  const steps = argv.length === 0 ? DEFAULT_STEPS : argv;
  const results = runChain(steps, run);
  console.log(renderTable(results));
  emitTimings(results);
  return results.every((r) => r.exit === 0) ? 0 : 1;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    // `--static [package.json]`: the post-merge floor (build + typecheck + every check:*)
    // `--floor [package.json]`: the integrate floor (the static floor minus the corpus-dependent checks)
    const pkg = argv[1] ?? join(ROOT, "package.json");
    process.exit(argv[0] === "--static" ? runStaticFloor(pkg) : argv[0] === "--floor" ? runFloor(pkg) : main(argv));
  } catch (e) {
    console.error(`run-chain: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
