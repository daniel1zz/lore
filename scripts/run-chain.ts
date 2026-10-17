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
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/** The chain, in the order `bun run test` has always run it (test:vitest stays after the cheap checks). */
export const DEFAULT_STEPS: readonly string[] = [
  "bun run check:ac-state-renderers",
  "bun run check:prose-pins",
  "bun run check:capture-source-buckets",
  "bun run test:vitest",
  "bun run check:spec-mirror",
  "bun run check:live-repo-state",
  "bun run check:corpus-fail-census",
  "bun run check:ac-oracle-ownership",
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

export function renderTable(results: readonly StepResult[]): string {
  const width = Math.max(...results.map((r) => r.step.length));
  const rows = results.map((r) => `  ${r.exit === 0 ? "PASS" : "FAIL"}  exit ${String(r.exit).padStart(3)}  ${r.seconds.toFixed(1).padStart(7)}s  ${r.step.padEnd(width)}`);
  const failed = results.filter((r) => r.exit !== 0);
  const verdict = failed.length === 0 ? `run-chain: all ${results.length} steps passed` : `run-chain: ${failed.length} of ${results.length} steps FAILED: ${failed.map((r) => r.step).join("; ")}`;
  return ["", "=== run-chain: per-step exit table", ...rows, verdict].join("\n");
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
  return results.every((r) => r.exit === 0) ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`run-chain: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
