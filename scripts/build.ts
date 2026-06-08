#!/usr/bin/env bun
/**
 * Build script: compiles src/index.ts into a standalone binary at dist/lore.
 * Uses bun build --compile for single-binary output.
 */

import { join } from "path";

const root = join(import.meta.dir, "..");
const entrypoint = join(root, "src", "index.ts");
const outfile = join(root, "dist", "lore");

console.log(`Building lore binary...`);
console.log(`  Entry:  ${entrypoint}`);
console.log(`  Output: ${outfile}`);

const result = Bun.spawnSync(
  ["bun", "build", "--compile", "--minify", entrypoint, "--outfile", outfile],
  {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }
);

if (result.exitCode !== 0) {
  console.error(`Build failed with exit code ${result.exitCode}`);
  process.exit(result.exitCode ?? 1);
}

console.log(`\nBuild succeeded: ${outfile}`);
