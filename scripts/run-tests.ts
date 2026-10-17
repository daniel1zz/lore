#!/usr/bin/env bun
/**
 * The one test entry point (`bun run test:vitest`; task-skill-implement-tg-23).
 *
 * Purpose: run every test file exactly once under vitest — the Bun-runtime invocation
 * (`bunx --bun vitest run`, vitest.config.ts) and the Node invocation for the files listed BY FILE
 * in vitest.node-files.ts (vitest.node.config.ts) — then prove files on disk == files run
 * (scripts/check-test-file-census.ts). Exit 0 only when all three succeed.
 * With `--base <ref>` it then runs the selector cross-check (scripts/selector-miss-report.ts, AC-TG-8)
 * over `<ref>..HEAD` using those same reports, and that must succeed too.
 * Reports go to a throwaway directory under the OS temp dir, never into the repository tree.
 * Public surface: `runSuite` (also used by scripts/measure-test-wall.ts), `suiteExit`.
 * Side-effect class: IO (spawns the runners, writes reports to a temp dir).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

function run(label: string, cmd: string, args: string[], env: Record<string, string> = {}): number {
  console.log(`\n=== ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.error !== undefined) throw new Error(`${label} failed to start: ${r.error.message}`);
  return r.status ?? 1;
}

export interface SuiteOutcome {
  readonly bun: number;
  readonly node: number;
  readonly census: number;
  readonly miss: number;
  readonly bunReport: string;
  readonly nodeReport: string;
}

/**
 * Build once, run both invocations, census, optional selector cross-check. Reports are written into
 * `reportDir` (the caller owns it and its cleanup). Throws when the build fails or a runner cannot start.
 */
export function runSuite(reportDir: string, baseRef?: string): SuiteOutcome {
  const bunReport = join(reportDir, "bun.json");
  const nodeReport = join(reportDir, "node.json");
  // reason: dist/lore is built ONCE per run, here, before any test (task-skill-implement-tg-24); a
  // failed build stops the run loud. scripts/test-global-setup.ts then finds it fresh in both
  // invocations and only snapshots it for the no-test-writes-dist check.
  const build = run("build dist/lore (once)", "bun", ["run", "build"]);
  if (build !== 0) throw new Error(`run-tests: \`bun run build\` failed (exit ${build}); no test ran`);
  const bun = run("vitest on the Bun runtime", "bunx", ["--bun", "vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${bunReport}`]);
  const node = run(
    "vitest on Node (files listed in vitest.node-files.ts)",
    "bunx",
    ["vitest", "run", "-c", "vitest.node.config.ts", "--reporter=default", "--reporter=json", `--outputFile.json=${nodeReport}`],
    { NODE_OPTIONS: "--max-old-space-size=2048" },
  );
  const census = run("census", "bun", ["scripts/check-test-file-census.ts", bunReport, nodeReport]);
  // AC-TG-8: with a base ref, cross-check the selector against this run's own reports.
  const miss = baseRef === undefined ? 0 : run("selector cross-check", "bun", ["scripts/selector-miss-report.ts", `${baseRef}..HEAD`, bunReport, nodeReport]);
  return { bun, node, census, miss, bunReport, nodeReport };
}

export function suiteExit(o: SuiteOutcome): number {
  return o.bun === 0 && o.node === 0 && o.census === 0 && o.miss === 0 ? 0 : 1;
}

if (import.meta.main) {
  const dir = mkdtempSync(join(tmpdir(), "lore-test-reports-"));
  try {
    const baseIdx = process.argv.indexOf("--base");
    const baseRef = baseIdx === -1 ? undefined : process.argv[baseIdx + 1];
    if (baseIdx !== -1 && (baseRef === undefined || baseRef.startsWith("--"))) throw new Error("run-tests: --base needs a git ref");
    const o = runSuite(dir, baseRef);
    console.log(`\nrun-tests: bun-runtime exit ${o.bun}, node exit ${o.node}, census exit ${o.census}, selector cross-check exit ${o.miss}`);
    process.exitCode = suiteExit(o);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
