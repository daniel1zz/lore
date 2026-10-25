/**
 * Check-only entry of migration 038 (BR-1421): reports how many `known-defect` links of a corpus convert into plan
 * entries and which cannot, WITHOUT writing anything.
 *
 * Usage: bun scripts/check-known-defects-conversion.ts <path-to-corpus-db>
 *
 * Invariants:
 *   - The given file is COPIED (with its -wal/-shm companions when present) into a fresh temp directory and the copy is
 *     opened read-only; the original is never opened, so a live corpus is not touched even if its path is passed.
 *   - Prints `N convertible, M unconvertible` then one line per link naming the source used (`milestone_findings` or
 *     `issue body lines`) or the reason it fails. Exit 0 when M is 0, exit 1 when any link is unconvertible, exit 2 on
 *     a usage or read error.
 *   - The corpus must be at schema 37 or later with a `links` table (a corpus already at 38 has no known-defect link
 *     and reports `0 convertible, 0 unconvertible`).
 *
 * Side-effect class: IO (a temp copy of the file); the check itself is the pure planner of migration-038.
 */

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { checkKnownDefectConversion, summarizeConversion } from "../packages/lore/src/store/migrations/migration-038.js";

function main(argv: readonly string[]): number {
  const source = argv[0];
  if (source === undefined || argv.length !== 1 || !existsSync(source)) {
    process.stderr.write("usage: bun scripts/check-known-defects-conversion.ts <path-to-corpus-db>\n");
    return 2;
  }
  const dir = mkdtempSync(join(tmpdir(), "lore-kd-check-"));
  try {
    const copy = join(dir, basename(source));
    copyFileSync(source, copy);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(`${source}${suffix}`)) copyFileSync(`${source}${suffix}`, `${copy}${suffix}`);
    const db = new Database(copy, { readonly: true });
    try {
      const plan = checkKnownDefectConversion(db);
      process.stdout.write(`${summarizeConversion(plan)}\n`);
      return plan.unconvertible.length === 0 ? 0 : 1;
    } finally {
      db.close();
    }
  } catch (error) {
    process.stderr.write(`check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(main(process.argv.slice(2)));
