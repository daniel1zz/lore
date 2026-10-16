/**
 * Shared review-judgment + calibration-record contract (SPEC-034 §3, TG-12):
 * one suite run by `InMemoryStore`, `SQLiteStore` and `TursoStore`.
 * Not a test file; imports only `vitest` and the `StoreInterface` type so it
 * loads under both vitest and `bun test` (see `store-core.shared.ts`).
 *
 * @spec_ref SPEC-034
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewJudgment } from "@lore/core";
import {
  makeCalibrationRecord,
  makeDoc,
  makeJudgment,
  resetCounter,
  type StoreSuiteOptions,
} from "./store-core.shared.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";

export interface JudgmentSuiteOptions extends StoreSuiteOptions {
  /**
   * Whether the adapter enforces FOREIGN KEY constraints on
   * `review_judgments.doc_id` / `calibration_records.judgment_id`.
   * true  (SQLiteStore, TursoStore): inserting against a missing parent is a STORE_ERROR.
   * false (InMemoryStore): no FK constraint — the FK-violation cases are N/A and the
   *   orphan reference surfaces at query time instead (covered by the paired case).
   */
  readonly enforcesForeignKeys: boolean;
}

export function runStoreJudgmentsSuite(opts: JudgmentSuiteOptions): void {
  describe(`${opts.label} — review judgments + calibration (SPEC-034)`, () => {
    let store: StoreInterface;
    const fkIt = opts.enforcesForeignKeys ? it : it.skip;
    const noFkIt = opts.enforcesForeignKeys ? it.skip : it;

    beforeEach(() => {
      resetCounter();
      store = opts.createStore();
    });

    afterEach(() => {
      opts.destroyStore(store);
    });

    it("HAPPY: insertJudgment + findJudgments round-trip", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-judgment-doc" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgment = makeJudgment(doc.value.id);
      const insertResult = await store.insertJudgment(judgment);
      expect(insertResult.ok).toBe(true);

      const found = await store.findJudgments(doc.value.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      expect(found.value[0]).toEqual(judgment);
    });

    it("HAPPY: findJudgments orders newest first (created_at DESC)", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-judgment-order" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const older = makeJudgment(doc.value.id, { created_at: "2026-06-01T00:00:00.000Z" });
      const newer = makeJudgment(doc.value.id, { created_at: "2026-06-08T00:00:00.000Z" });
      await store.insertJudgment(older);
      await store.insertJudgment(newer);

      const found = await store.findJudgments(doc.value.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value.map((j) => j.id)).toEqual([newer.id, older.id]);
    });

    it("HAPPY: latestJudgment returns the most recent judgment", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-latest-judgment" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const older = makeJudgment(doc.value.id, { created_at: "2026-06-01T00:00:00.000Z" });
      const newer = makeJudgment(doc.value.id, { created_at: "2026-06-08T00:00:00.000Z" });
      await store.insertJudgment(older);
      await store.insertJudgment(newer);

      const latest = await store.latestJudgment(doc.value.id);
      expect(latest.ok).toBe(true);
      if (!latest.ok) return;
      expect(latest.value?.id).toBe(newer.id);
    });

    it("BOUNDARY: latestJudgment returns null when no judgment exists for the doc", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-no-judgment" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const latest = await store.latestJudgment(doc.value.id);
      expect(latest.ok).toBe(true);
      if (!latest.ok) return;
      expect(latest.value).toBeNull();
    });

    it("BOUNDARY: findJudgments returns an empty array for a doc with no judgments", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-empty-judgments" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const found = await store.findJudgments(doc.value.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toEqual([]);
    });

    fkIt("ERROR: insertJudgment on a non-existent doc_id violates the foreign key and reports STORE_ERROR", async () => {
      const judgment = makeJudgment("01HNOPE00000000000000001");
      const result = await store.insertJudgment(judgment);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("STORE_ERROR");
    });

    it("STATE: escalate decision with blocking_questions round-trips through storage intact", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-escalate-judgment" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgment = makeJudgment(doc.value.id, {
        decision: "escalate",
        blocking_questions: ["Is AC-7 in scope?"],
      });
      await store.insertJudgment(judgment);

      const latest = await store.latestJudgment(doc.value.id);
      expect(latest.ok).toBe(true);
      if (!latest.ok) return;
      expect(latest.value?.decision).toBe("escalate");
      expect(latest.value?.blocking_questions).toEqual(["Is AC-7 in scope?"]);
    });

    it("HAPPY: insertCalibrationRecord + queryCalibrationWindow round-trip", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calibration-doc" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgment = makeJudgment(doc.value.id);
      await store.insertJudgment(judgment);

      const record = makeCalibrationRecord(judgment.id, doc.value.id);
      const insertResult = await store.insertCalibrationRecord(record);
      expect(insertResult.ok).toBe(true);

      const found = await store.queryCalibrationWindow({ limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      // reason: queryCalibrationWindow now unconditionally projects the judgment's
      // judge_prompt_version onto the returned row — the plain CalibrationRecord
      // fields still round-trip verbatim via toMatchObject, and the projected field
      // is asserted separately against the judgment it was joined from.
      expect(found.value[0]).toMatchObject(record);
      expect(found.value[0]?.judge_prompt_version).toBe(judgment.judge.prompt_version);
    });

    it("HAPPY: queryCalibrationWindow filters by doc_type", async () => {
      const specDoc = await store.insert(
        makeDoc({ slug: "spec-calib-type-a", type: "spec", role: "spec" }),
      );
      const prdDoc = await store.insert(
        makeDoc({ slug: "prd-calib-type-b", type: "prd", role: "intent" }),
      );
      expect(specDoc.ok && prdDoc.ok).toBe(true);
      if (!specDoc.ok || !prdDoc.ok) return;

      const specJudgment = makeJudgment(specDoc.value.id);
      const prdJudgment = makeJudgment(prdDoc.value.id);
      await store.insertJudgment(specJudgment);
      await store.insertJudgment(prdJudgment);
      await store.insertCalibrationRecord(
        makeCalibrationRecord(specJudgment.id, specDoc.value.id, { doc_type: "spec" }),
      );
      await store.insertCalibrationRecord(
        makeCalibrationRecord(prdJudgment.id, prdDoc.value.id, { doc_type: "prd" }),
      );

      const found = await store.queryCalibrationWindow({ doc_type: "spec", limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      expect(found.value[0]?.doc_type).toBe("spec");
    });

    it("HAPPY: queryCalibrationWindow filters by prompt_version via the review_judgments JOIN", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calib-prompt-version" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgmentV1 = makeJudgment(doc.value.id, {
        judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
      });
      const judgmentV2 = makeJudgment(doc.value.id, {
        judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v2" },
      });
      await store.insertJudgment(judgmentV1);
      await store.insertJudgment(judgmentV2);
      await store.insertCalibrationRecord(makeCalibrationRecord(judgmentV1.id, doc.value.id));
      await store.insertCalibrationRecord(makeCalibrationRecord(judgmentV2.id, doc.value.id));

      const found = await store.queryCalibrationWindow({ prompt_version: "v1", limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      expect(found.value[0]?.judgment_id).toBe(judgmentV1.id);
    });

    it("HAPPY: queryCalibrationWindow projects judge_prompt_version onto EVERY row, even fully unfiltered", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calib-projection" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgmentV1 = makeJudgment(doc.value.id, {
        judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
      });
      const judgmentV2 = makeJudgment(doc.value.id, {
        judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v2" },
      });
      await store.insertJudgment(judgmentV1);
      await store.insertJudgment(judgmentV2);
      await store.insertCalibrationRecord(makeCalibrationRecord(judgmentV1.id, doc.value.id));
      await store.insertCalibrationRecord(makeCalibrationRecord(judgmentV2.id, doc.value.id));

      // No prompt_version filter at all — the join must still run and project the
      // REAL prompt_version onto each row (no "*" sentinel, no undefined field).
      const found = await store.queryCalibrationWindow({ limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(2);
      const byJudgmentId = new Map(found.value.map((r) => [r.judgment_id, r.judge_prompt_version]));
      expect(byJudgmentId.get(judgmentV1.id)).toBe("v1");
      expect(byJudgmentId.get(judgmentV2.id)).toBe("v2");
    });

    it("BOUNDARY: queryCalibrationWindow respects the limit bound, newest first", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calib-limit" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgment = makeJudgment(doc.value.id);
      await store.insertJudgment(judgment);

      for (let i = 0; i < 5; i += 1) {
        await store.insertCalibrationRecord(
          makeCalibrationRecord(judgment.id, doc.value.id, {
            created_at: `2026-06-0${i + 1}T00:00:00.000Z`,
          }),
        );
      }

      const found = await store.queryCalibrationWindow({ limit: 2 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(2);
      expect(found.value[0]?.created_at).toBe("2026-06-05T00:00:00.000Z");
    });

    it("BOUNDARY: queryCalibrationWindow returns an empty array when nothing matches", async () => {
      const found = await store.queryCalibrationWindow({ limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toEqual([]);
    });

    fkIt("ERROR: insertCalibrationRecord on a non-existent judgment_id violates the foreign key and reports STORE_ERROR", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calib-bad-judgment" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const record = makeCalibrationRecord("01HNOPE00000000000000002", doc.value.id);
      const result = await store.insertCalibrationRecord(record);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("STORE_ERROR");
    });

    it("REGRESSION: findJudgments returns independent copies — mutating result does not affect stored state", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-judgment-copy" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      await store.insertJudgment(makeJudgment(doc.value.id));

      const found = await store.findJudgments(doc.value.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      const [judgment] = found.value;
      expect(judgment).toBeDefined();
      if (!judgment) return;
      (judgment as ReviewJudgment).decision = "reject";

      const found2 = await store.findJudgments(doc.value.id);
      expect(found2.ok).toBe(true);
      if (!found2.ok) return;
      expect(found2.value[0]?.decision).toBe("approve");
    });

    noFkIt("ERROR: queryCalibrationWindow fails loud when a calibration record references an unknown judgment_id", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calib-orphan" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      // No insertJudgment call — this record's judgment_id has no corresponding row.
      // InMemoryStore has no FK constraint (unlike SQLiteStore/TursoStore), so this
      // insert succeeds; the failure must surface at query time instead.
      await store.insertCalibrationRecord(makeCalibrationRecord("01HNOPE00000000000000003", doc.value.id));

      const found = await store.queryCalibrationWindow({ limit: 10 });
      expect(found.ok).toBe(false);
      if (found.ok) return;
      expect(found.error.code).toBe("STORE_ERROR");
    });
  });
}
