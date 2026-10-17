#!/usr/bin/env bun
/**
 * The one test entry point (`bun run test:vitest`; task-skill-implement-tg-23).
 *
 * Purpose: run every test file exactly once under vitest — the Bun-runtime invocation
 * (`bunx --bun vitest run`, vitest.config.ts) and the Node invocation for the files listed BY FILE
 * in vitest.node-files.ts (vitest.node.config.ts) — then prove files on disk == files run
 * (scripts/check-test-file-census.ts). Exit 0 only when all three succeed.
 * Reports go to a throwaway directory under the OS temp dir, never into the repository tree.
 * Side-effect class: IO (spawns the runners, writes reports to a temp dir).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const dir = mkdtempSync(join(tmpdir(), "lore-test-reports-"));
const bunReport = join(dir, "bun.json");
const nodeReport = join(dir, "node.json");

function run(label: string, cmd: string, args: string[], env: Record<string, string> = {}): number {
  console.log(`\n=== ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.error !== undefined) throw new Error(`${label} failed to start: ${r.error.message}`);
  return r.status ?? 1;
}

try {
  const bun = run("vitest on the Bun runtime", "bunx", ["--bun", "vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${bunReport}`]);
  const node = run(
    "vitest on Node (files listed in vitest.node-files.ts)",
    "bunx",
    ["vitest", "run", "-c", "vitest.node.config.ts", "--reporter=default", "--reporter=json", `--outputFile.json=${nodeReport}`],
    { NODE_OPTIONS: "--max-old-space-size=2048" },
  );
  const census = run("census", "bun", ["scripts/check-test-file-census.ts", bunReport, nodeReport]);
  console.log(`\nrun-tests: bun-runtime exit ${bun}, node exit ${node}, census exit ${census}`);
  process.exitCode = bun === 0 && node === 0 && census === 0 ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
