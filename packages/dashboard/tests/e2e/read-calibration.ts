/**
 * Fixture-only helper — reads back the `calibration_records` row (if any) the
 * implicit calibration hook (`packages/lore/src/flows/calibration-hook.ts`) wrote
 * for a given judgment, via `StoreInterface.queryCalibrationWindow` (the same
 * store method `JudgmentService.computeCalibrationStats` uses) against the SAME
 * SQLite file the running `lore serve` process has open.
 *
 * Direct-DB-read counterpart to asserting via `/api/calibration/stats` — this path
 * confirms the CONCRETE row (judgment_id, human_outcome) rather than only the
 * aggregated Wilson-bound stats, which is what the CALIBRATE e2e scenario needs to
 * assert a "confirmed" pairing precisely (an aggregate agreement_rate alone
 * couldn't distinguish "our one seeded record landed" from "some other record in
 * the window happened to already agree").
 *
 * Usage: bun read-calibration.ts <dbPath> <docType> <judgmentId>
 * Prints the matching record as JSON (last stdout line), or the literal string
 * "null" if no record for that judgment_id exists yet.
 */
import { SQLiteStore } from "../../../lore/src/store/sqlite-store.js";
import type { DocType } from "@lore/core";

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  const docType = process.argv[3];
  const judgmentId = process.argv[4];
  if (dbPath === undefined || docType === undefined || judgmentId === undefined) {
    throw new Error("Usage: bun read-calibration.ts <dbPath> <docType> <judgmentId>");
  }

  const store = new SQLiteStore(dbPath);
  const result = await store.queryCalibrationWindow({ doc_type: docType as DocType, limit: 200 });
  if (!result.ok) {
    throw new Error(`queryCalibrationWindow failed: ${JSON.stringify(result.error)}`);
  }

  const match = result.value.find((record) => record.judgment_id === judgmentId) ?? null;
  console.log(JSON.stringify(match));
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
