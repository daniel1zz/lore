// @layer store AC-JR-4 (owner is tests/integration/judge-verdict-reuse.test.ts; this file pins the SQLite and in-memory stores)
/**
 * @spec_ref spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit (AC-JR-4, BR-1535)
 *
 * migration-049 `judge_verdicts` on a real SQLiteStore (throwaway file in a temp dir, never the repo's `.lore`) and the in-memory
 * store, one contract for both: insert-if-absent keeps the first writer, compare-and-swap replaces only the exact stored text,
 * a read refreshes `last_read_at`, expiry deletes by last-read age alone.
 *
 * Dimensions: HAPPY (insert, read back), NEGATIVE (second writer loses; a stale swap loses), BOUNDARY (missing key, empty prune),
 * ERROR (unknown unit_kind refused by the CHECK), STATE (a read keeps a row alive past the cutoff), REGRESSION (migration 049 is
 * the schema ceiling and creates the table on a new file).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore, LATEST_SCHEMA_VERSION } from "../../../src/store/sqlite-store.js";
import type { JudgeVerdictRow, StoreInterface } from "../../../src/store/store-interface.js";

const row = (overrides: Partial<JudgeVerdictRow> = {}): JudgeVerdictRow => ({
  key: "k1",
  unit_kind: "file",
  unit_id: "src/a.ts",
  raw_answer: '{"first":true}',
  provider: "http",
  model: "m1",
  template_hash: "t1",
  first_review: "plan@t#1",
  created_at: "2026-10-01T00:00:00.000Z",
  last_read_at: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

let dir: string;
const closers: (() => void)[] = [];
const stores: [string, () => StoreInterface][] = [
  ["in-memory", () => new InMemoryStore()],
  [
    "sqlite",
    () => {
      const s = new SQLiteStore(join(dir, `lore-${String(closers.length)}.db`));
      closers.push(() => s.close());
      return s;
    },
  ],
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-judge-verdict-store-"));
});

afterEach(() => {
  for (const close of closers.splice(0)) close();
  rmSync(dir, { recursive: true, force: true });
});

describe.each(stores)("judge_verdicts (%s)", (_name, make) => {
  it("AC-JR-4 a stored row reads back field for field and a missing key reads null", async () => {
    const store = make();
    expect((await store.getJudgeVerdict("nope", "2026-11-01T00:00:00.000Z"))).toEqual({ ok: true, value: null });
    const inserted = await store.insertJudgeVerdictIfAbsent(row());
    expect(inserted).toEqual({ ok: true, value: row() });
    const read = await store.getJudgeVerdict("k1", "2026-10-02T00:00:00.000Z");
    expect(read).toEqual({ ok: true, value: row({ last_read_at: "2026-10-02T00:00:00.000Z" }) });
  });

  it("AC-JR-4 the second writer of a key loses and receives the first writer's row", async () => {
    const store = make();
    await store.insertJudgeVerdictIfAbsent(row());
    const second = await store.insertJudgeVerdictIfAbsent(row({ raw_answer: '{"second":true}', first_review: "plan@t#2" }));
    expect(second.ok && second.value.raw_answer).toBe('{"first":true}');
    expect(second.ok && second.value.first_review).toBe("plan@t#1");
  });

  it("AC-JR-4 compare-and-swap replaces only the exact stored text; the first replacement wins", async () => {
    const store = make();
    await store.insertJudgeVerdictIfAbsent(row({ raw_answer: "{broken" }));
    const swapped = await store.replaceJudgeVerdictIfEquals("k1", "{broken", row({ raw_answer: '{"fixed":1}', first_review: "plan@t#2" }));
    expect(swapped.ok && swapped.value.raw_answer).toBe('{"fixed":1}');
    const stale = await store.replaceJudgeVerdictIfEquals("k1", "{broken", row({ raw_answer: '{"fixed":2}', first_review: "plan@t#3" }));
    expect(stale.ok && stale.value.raw_answer).toBe('{"fixed":1}');
    expect(stale.ok && stale.value.first_review).toBe("plan@t#2");
  });

  it("AC-JR-4 expiry deletes by last-read age only, whatever the template or model, and a read keeps a row alive", async () => {
    const store = make();
    await store.insertJudgeVerdictIfAbsent(row({ key: "old", last_read_at: "2026-09-01T00:00:00.000Z", template_hash: "t-a", model: "m-a" }));
    await store.insertJudgeVerdictIfAbsent(row({ key: "kept", last_read_at: "2026-09-01T00:00:00.000Z", template_hash: "t-b", model: "m-b" }));
    await store.insertJudgeVerdictIfAbsent(row({ key: "recent", last_read_at: "2026-10-20T00:00:00.000Z", template_hash: "t-c", model: "m-c" }));
    await store.getJudgeVerdict("kept", "2026-10-25T00:00:00.000Z");
    const pruned = await store.pruneJudgeVerdictsNotReadSince("2026-10-02T00:00:00.000Z");
    expect(pruned).toEqual({ ok: true, value: 1 });
    expect((await store.getJudgeVerdict("old", "2026-11-01T00:00:00.000Z")).ok && (await store.getJudgeVerdict("old", "2026-11-01T00:00:00.000Z"))).toEqual({ ok: true, value: null });
    expect(((await store.getJudgeVerdict("kept", "2026-11-01T00:00:00.000Z")) as { value: unknown }).value).not.toBeNull();
    expect(((await store.getJudgeVerdict("recent", "2026-11-01T00:00:00.000Z")) as { value: unknown }).value).not.toBeNull();
    expect(await store.pruneJudgeVerdictsNotReadSince("2026-01-01T00:00:00.000Z")).toEqual({ ok: true, value: 0 });
  });
});

describe("judge_verdicts (migration-049)", () => {
  it("AC-JR-4 migration 049 is the schema ceiling and a unit kind other than file or criterion is refused", async () => {
    expect(LATEST_SCHEMA_VERSION).toBe(49);
    const store = new SQLiteStore(join(dir, "lore-check.db"));
    closers.push(() => store.close());
    const refused = await store.insertJudgeVerdictIfAbsent(row({ unit_kind: "plan" as never }));
    expect(refused.ok).toBe(false);
  });
});
