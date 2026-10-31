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
 *        bun scripts/run-chain.ts --floor [--list] [package.json]       (install + build + typecheck + the two :changed checks = `bun run check:floor`; --list prints the step names)
 *        bun scripts/run-chain.ts --plan-close [--list] [package.json]  (every other ^check: script = `bun run check:plan-close`)
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
  /** The step's combined stdout+stderr, when the runner captured it (a failed step's block is re-printed after the table). */
  readonly output?: string;
}

export type StepRunner = (step: string) => { exit: number; seconds: number; output?: string };

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

/** Per-failed-step bound of the re-printed block: the last lines, then the last characters (a failure names itself at the end). */
export const FAILURE_BLOCK_MAX_LINES = 40;
export const FAILURE_BLOCK_MAX_CHARS = 2500;

/** Bound one failed step's output to its last lines/chars; the cut is never silent (a leading "... N lines omitted" marker). */
export function boundFailureOutput(output: string): string {
  const lines = output.replace(/\s+$/, "").split("\n");
  let keep = lines.slice(-FAILURE_BLOCK_MAX_LINES);
  while (keep.length > 1 && keep.join("\n").length > FAILURE_BLOCK_MAX_CHARS) keep = keep.slice(1);
  let body = keep.join("\n");
  let cutChars = 0;
  if (body.length > FAILURE_BLOCK_MAX_CHARS) {
    cutChars = body.length - FAILURE_BLOCK_MAX_CHARS;
    body = body.slice(-FAILURE_BLOCK_MAX_CHARS);
  }
  const omitted = lines.length - keep.length;
  const markers = [omitted > 0 ? `... ${omitted} lines omitted` : "", cutChars > 0 ? `... ${cutChars} chars omitted from the first kept line` : ""].filter((m) => m !== "");
  return [...markers, body].join("\n");
}

/**
 * The failed steps' own output, re-printed AFTER the exit table so the tail of a long chain output always ends with what
 * to fix (a consumer keeping only the tail, such as `lore integrate`, would otherwise lose an early failing step).
 * Empty string when no failed step captured output.
 */
export function renderFailureBlocks(results: readonly StepResult[]): string {
  const blocks = results
    .filter((r) => r.exit !== 0 && r.output !== undefined && r.output.trim() !== "")
    .map((r) => `\n=== run-chain: FAILED step output (exit ${r.exit}): ${r.step}\n${boundFailureOutput(r.output as string)}`);
  return blocks.join("\n");
}

/** Print the exit table, then the failed steps' own output (the last thing a chain prints). */
function report(results: readonly StepResult[], labels?: ReadonlyMap<string, string>): void {
  console.log(renderTable(results, labels));
  const failures = renderFailureBlocks(results);
  if (failures !== "") console.log(failures);
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
const AGGREGATE_SCRIPTS: ReadonlySet<string> = new Set(["check:static", "check:floor", "check:plan-close"]);

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
  report(results, labels);
  emitTimings(results);
  return results.every((r) => r.exit === 0) ? 0 : 1;
}

/**
 * The ONE declaration of the lean integrate floor (BR-1368): install, build, typecheck, plus the two checks that caught real
 * defects, scoped to the branch's own diff (`:changed`). Every other `check:*` script runs
 * at plan close (PLAN_CLOSE_STEPS). `--floor`, `--plan-close` and `--list` all read these two lists.
 */
export const FLOOR_STEPS = ["install", "build", "typecheck", "baseline-coverage:changed", "ac-oracle-ownership:changed", "test-spawns:changed"] as const;
const FLOOR_COMMANDS: Readonly<Record<(typeof FLOOR_STEPS)[number], string>> = {
  install: "bun install --frozen-lockfile",
  build: "bun run build",
  typecheck: "bun run typecheck",
  // reason: the two checks that caught real defects return to landing scoped to the branch's own diff against main (--changed)
  "baseline-coverage:changed": "bun run check:baseline-coverage:changed",
  "ac-oracle-ownership:changed": "bun run check:ac-oracle-ownership:changed",
  // reason: a test that spawns a process must declare it (@spawns / @spawns-external); refused at landing, scoped to the diff (AC-SC-2)
  "test-spawns:changed": "bun run check:test-spawns:changed",
};

/** Every `check:*` script that is not an aggregate, in package.json order; a new check must be added here (the test fails otherwise). */
export const PLAN_CLOSE_STEPS: readonly string[] = [
  "check:hook-shell-cwd",
  "check:hook-top-level-symbols",
  "check:ordinal-sites",
  "check:baseline-coverage",
  "check:no-timer-retry",
  "check:ac-ref-integrity",
  "check:memory-files",
  "check:no-nul-bytes",
  "check:no-bunx-of-declared-deps",
  "check:agent-hygiene",
  "check:plan-member-sites",
  "check:ac-state-renderers",
  "check:prose-pins",
  "check:shipped-defaults",
  "check:ac-oracle-ownership",
  "check:test-spawns",
  "check:evidence-identity-drop-set",
  "check:capture-source-buckets",
  "check:spec-mirror",
  "check:corpus-fail-census",
  "check:live-repo-state",
];

/** The `check:*` scripts in `scripts` that are in neither the floor nor PLAN_CLOSE_STEPS (aggregates excluded). */
export function unlistedChecks(scripts: Readonly<Record<string, string>>): string[] {
  return Object.keys(scripts).filter((n) => /^check:/.test(n) && !AGGREGATE_SCRIPTS.has(n) && !PLAN_CLOSE_STEPS.includes(n) && !(FLOOR_STEPS as readonly string[]).includes(n.replace(/^check:/, "")));
}

/**
 * The `check:floor` step commands (the integrate floor): install, build, typecheck.
 * @throws Error when the map has no `build` or `typecheck` script (a floor missing its base steps is not a floor).
 */
export function deriveFloorSteps(scripts: Readonly<Record<string, string>>): string[] {
  for (const base of ["build", "typecheck"]) {
    if (!(base in scripts)) throw new Error(`check:floor: package.json has no "${base}" script`);
  }
  for (const name of FLOOR_STEPS.filter((n) => n.endsWith(":changed"))) {
    if (!(`check:${name}` in scripts)) throw new Error(`check:floor: package.json has no "check:${name}" script`);
  }
  return FLOOR_STEPS.map((name) => FLOOR_COMMANDS[name]);
}

/**
 * The `check:plan-close` step commands: every PLAN_CLOSE_STEPS script.
 * @throws Error when a declared check is missing from `scripts`, or a `check:*` script is in neither list.
 */
export function derivePlanCloseSteps(scripts: Readonly<Record<string, string>>): string[] {
  const missing = PLAN_CLOSE_STEPS.filter((n) => !(n in scripts));
  if (missing.length > 0) throw new Error(`check:plan-close: package.json has no script for ${missing.join(", ")}`);
  const unlisted = unlistedChecks(scripts);
  if (unlisted.length > 0) throw new Error(`check:plan-close: ${unlisted.join(", ")} is in neither FLOOR_STEPS nor PLAN_CLOSE_STEPS (scripts/run-chain.ts)`);
  return PLAN_CLOSE_STEPS.map((name) => `bun run ${name}`);
}

function readScripts(packageJsonPath: string, label: string): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const scripts = (parsed as { scripts?: Record<string, string> }).scripts;
  if (scripts === undefined) throw new Error(`${label}: ${packageJsonPath} has no scripts`);
  return scripts;
}

/** Run the integrate floor over `packageJsonPath` and print the table; returns the exit code. */
export function runFloor(packageJsonPath: string, run: StepRunner = spawnStep): number {
  const results = runChain(deriveFloorSteps(readScripts(packageJsonPath, "check:floor")), run);
  report(results);
  emitTimings(results);
  return results.every((r) => r.exit === 0) ? 0 : 1;
}

/** Run the plan-close checks over `packageJsonPath` and print the table; returns the exit code. */
export function runPlanClose(packageJsonPath: string, run: StepRunner = spawnStep): number {
  const results = runChain(derivePlanCloseSteps(readScripts(packageJsonPath, "check:plan-close")), run);
  report(results);
  emitTimings(results);
  return results.every((r) => r.exit === 0) ? 0 : 1;
}

function spawnStep(step: string): { exit: number; seconds: number; output: string } {
  console.log(`\n=== run-chain: ${step}`);
  const t0 = Date.now();
  // stderr is merged into stdout inside the shell so the captured stream keeps terminal order; printed once the step ends
  const r = spawnSync("sh", ["-c", `exec 2>&1; ${step}`], { cwd: ROOT, stdio: ["inherit", "pipe", "inherit"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const seconds = (Date.now() - t0) / 1000;
  const output = r.stdout ?? "";
  process.stdout.write(output);
  if (r.error !== undefined) {
    console.error(`run-chain: step failed to start: ${step}: ${r.error.message}`);
    return { exit: 127, seconds, output };
  }
  // a step killed by a signal has status null: that is a failure, never a pass
  return { exit: r.status ?? 128, seconds, output };
}

export function main(argv: readonly string[], run: StepRunner = spawnStep): number {
  const steps = argv.length === 0 ? DEFAULT_STEPS : argv;
  const results = runChain(steps, run);
  report(results);
  emitTimings(results);
  return results.every((r) => r.exit === 0) ? 0 : 1;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    // `--floor [--list] [package.json]`: the integrate floor (install + build + typecheck)
    // `--plan-close [--list] [package.json]`: every other check:* script, run at plan close
    // `--static [package.json]`: the post-merge floor (build + typecheck + every check:*)
    const listOnly = argv.includes("--list");
    const rest = argv.filter((a) => a !== "--list");
    const pkg = rest[1] ?? join(ROOT, "package.json");
    if (listOnly && (rest[0] === "--floor" || rest[0] === "--plan-close")) {
      if (rest[0] === "--plan-close") derivePlanCloseSteps(readScripts(pkg, "check:plan-close")); // fail loud on a drifted declaration
      console.log((rest[0] === "--floor" ? [...FLOOR_STEPS] : PLAN_CLOSE_STEPS).join("\n"));
      process.exit(0);
    }
    process.exit(rest[0] === "--static" ? runStaticFloor(pkg) : rest[0] === "--floor" ? runFloor(pkg) : rest[0] === "--plan-close" ? runPlanClose(pkg) : main(argv));
  } catch (e) {
    console.error(`run-chain: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
