/**
 * RED (TDD) vitest suite for `ReceiptLogV2`
 * (`packages/lore/src/service/receipt-log-v2.ts` — DOES NOT EXIST YET).
 *
 * Governing spec: `spec-the-defect-channel-reaches-no-machine-but-its-own-github`
 * (AC-GI-3, Risk R4). Paired implementation:
 * `task-skill-implement-receiptlogv2-two-phase-log-on-a-new-path`.
 *
 * Why v2 is a NEW module/file, not an extended schema: the existing
 * `receiptEntrySchema` in `packages/lore/src/service/receipt-log.ts:53-59`
 * is `.strict()` over exactly `{upstream_doc_id, title, at}`. Adding fields
 * to that schema would make every new line parse-FAIL under any older
 * binary still running that strict shape, and the live ledger already
 * holds 12 legacy rows written under it. So `ReceiptLogV2` lives on a
 * distinct file path with its own reader — one that must ALSO tolerate a
 * file still written in the old three-field shape (Scenario 4 below).
 *
 * The two-phase design (this is the whole point of a v2): an `intent`
 * line is appended BEFORE the network call that files an upstream issue,
 * and an `outcome` line is appended AFTER it succeeds. This deliberately
 * breaks the old "zero writes before a successful create" invariant — but
 * only the LOCAL half of it; no upstream write happens before the network
 * call, only a local append. The payoff: a filing that never reaches
 * GitHub (crash, network failure, `gh` error) leaves a durable local
 * trace instead of none. An `intent` line with no matching `outcome` line
 * for the same `idempotency_key` is exactly the reconcile signal Risk R4
 * names. `idempotency_key` is a client-generated ULID that pairs the two
 * lines and lets a retry recognise its own prior attempt.
 *
 * Contract this suite pins for the paired implementation (test-first, so
 * this IS the contract, not a description of one already written):
 *
 *   type ReceiptIntentEntry  = { phase: "intent";  idempotency_key: string; title: string; at: string };
 *   type ReceiptOutcomeEntry = { phase: "outcome"; idempotency_key: string; number: number; url: string; at: string };
 *   // A legacy v1 row carries NO `phase` field at all — {upstream_doc_id, title, at}.
 *
 *   class ReceiptLogV2 {
 *     constructor(filePath: string)
 *     appendIntent(entry: {idempotency_key, title, at}): Result<void, LoreError>
 *     appendOutcome(entry: {idempotency_key, number, url, at}): Result<void, LoreError>
 *     read(): Result<{ entries: Array<ReceiptIntentEntry | ReceiptOutcomeEntry | LegacyEntry>; corrupt_lines: number[] }, LoreError>
 *   }
 *
 * `read()` mirrors v1's contract: it NEVER throws, a missing/0-byte file
 * is valid-empty, and corruption is reported (1-indexed physical line
 * numbers) rather than silently dropped or repaired. Two distinct methods
 * (`appendIntent` / `appendOutcome`) rather than one `append({phase, ...})`
 * so a caller cannot mis-tag a phase at the call site — the method name
 * IS the phase.
 *
 * This suite deliberately does NOT test call-ordering against a real
 * network call (intent-before-call is only real once the intake port
 * calls this log — that is the PORT task's integration concern per its
 * own "Integration" note). This suite asserts only the log's own
 * read/write contract, in isolation, exactly as the paired implementation
 * task's AC list scopes it.
 *
 * Module-resolution note (same technique as `receipt-log.test.ts`): the
 * target module does not exist on disk at all, so a literal-string
 * `import("../../../src/service/receipt-log-v2.js")` would be statically
 * resolved by `tsc` and fail `bun run typecheck` with TS2307 even under
 * `--noEmit`. Routing the specifier through a `const` (a non-literal
 * expression) opts the dynamic `import()` out of TypeScript's static
 * module-resolution check, while `bun`'s runtime resolver still rejects it
 * at test-run time with a real "Cannot find module" error — exactly the
 * RED failure this suite exists to produce.
 *
 * Coverage: the five scenarios from the paired RED task doc, one test
 * each, plus the AC-mandated non-corruption assertions folded into
 * scenarios 4 and 5.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ─── Dynamic import helper (module does not exist yet — see header note) ────

const RECEIPT_LOG_V2_MODULE_SPECIFIER = "../../../src/service/receipt-log-v2.js";

async function importReceiptLogV2(): Promise<{ ReceiptLogV2: new (filePath: string) => any }> {
  const mod = await import(RECEIPT_LOG_V2_MODULE_SPECIFIER);
  const ReceiptLogV2 = (mod as any).ReceiptLogV2;
  if (typeof ReceiptLogV2 !== "function") {
    throw new Error(
      "receipt-log-v2.ts does not export ReceiptLogV2 — implementation missing (RED expected)",
    );
  }
  return { ReceiptLogV2 };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-receipt-log-v2-test-"));
  filePath = join(dir, "issue-receipts-v2.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-GI-3 ReceiptLogV2 (RED — packages/lore/src/service/receipt-log-v2.ts not implemented yet)", () => {
  it("SCENARIO-1 (R4 reconcile signal): a filing whose network call fails leaves an intent line and no outcome line for the same idempotency_key", async () => {
    const { ReceiptLogV2 } = await importReceiptLogV2();
    const log = new ReceiptLogV2(filePath);
    const key = "01HQZX3JBTG7VD9K5M2N4P6R8S";

    // The intent is written BEFORE the (here: simulated-failing) network
    // call. The network call fails, so the caller never reaches the point
    // where it would append an outcome line.
    const intentResult = log.appendIntent({
      idempotency_key: key,
      title: "bug: crash on empty title",
      at: "2026-08-23T00:00:00.000Z",
    });
    expect(intentResult.ok).toBe(true);

    const readResult = log.read();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    const intentsForKey = readResult.value.entries.filter(
      (e: any) => e.phase === "intent" && e.idempotency_key === key,
    );
    const outcomesForKey = readResult.value.entries.filter(
      (e: any) => e.phase === "outcome" && e.idempotency_key === key,
    );
    expect(intentsForKey).toHaveLength(1);
    expect(outcomesForKey).toHaveLength(0);
    expect(readResult.value.corrupt_lines).toEqual([]);
  });

  it("SCENARIO-2 (happy path): a filing that succeeds leaves both a matching intent and outcome line for the key", async () => {
    const { ReceiptLogV2 } = await importReceiptLogV2();
    const log = new ReceiptLogV2(filePath);
    const key = "01HQZX3JBTG7VD9K5M2N4P6R9T";

    const intentResult = log.appendIntent({
      idempotency_key: key,
      title: "bug: null pointer on save",
      at: "2026-08-23T00:00:00.000Z",
    });
    expect(intentResult.ok).toBe(true);

    // Network call succeeds — the caller now appends the outcome.
    const outcomeResult = log.appendOutcome({
      idempotency_key: key,
      number: 42,
      url: "https://github.com/example/repo/issues/42",
      at: "2026-08-23T00:00:05.000Z",
    });
    expect(outcomeResult.ok).toBe(true);

    const readResult = log.read();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    const intentsForKey = readResult.value.entries.filter(
      (e: any) => e.phase === "intent" && e.idempotency_key === key,
    );
    const outcomesForKey = readResult.value.entries.filter(
      (e: any) => e.phase === "outcome" && e.idempotency_key === key,
    );
    expect(intentsForKey).toHaveLength(1);
    expect(outcomesForKey).toHaveLength(1);
    expect(outcomesForKey[0]).toMatchObject({
      idempotency_key: key,
      number: 42,
      url: "https://github.com/example/repo/issues/42",
    });
    expect(readResult.value.corrupt_lines).toEqual([]);
  });

  it("SCENARIO-3 (retry safety): a retry that re-appends an intent for an already-outcome'd idempotency_key still surfaces the prior outcome as discoverable, never treated as a fresh unresolved attempt", async () => {
    const { ReceiptLogV2 } = await importReceiptLogV2();
    const log = new ReceiptLogV2(filePath);
    const key = "01HQZX3JBTG7VD9K5M2N4P6RAT";

    // First attempt: succeeds end to end.
    expect(log.appendIntent({ idempotency_key: key, title: "flaky retry case", at: "2026-08-23T00:00:00.000Z" }).ok).toBe(true);
    expect(
      log.appendOutcome({
        idempotency_key: key,
        number: 7,
        url: "https://github.com/example/repo/issues/7",
        at: "2026-08-23T00:00:01.000Z",
      }).ok,
    ).toBe(true);

    // A retry loop re-uses the SAME client-generated idempotency_key and
    // writes a second intent line for it (e.g. it did not itself observe
    // the earlier success and is about to re-check before calling again).
    expect(
      log.appendIntent({ idempotency_key: key, title: "flaky retry case", at: "2026-08-23T00:05:00.000Z" }).ok,
    ).toBe(true);

    const readResult = log.read();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    // The raw log does not dedupe writes — both intent lines are present.
    const intentsForKey = readResult.value.entries.filter(
      (e: any) => e.phase === "intent" && e.idempotency_key === key,
    );
    expect(intentsForKey).toHaveLength(2);

    // But the prior outcome for the key is discoverable regardless of the
    // intervening second intent — a caller consulting the log must be able
    // to find it rather than concluding (from "the latest line for this
    // key is an intent") that the filing is still unresolved.
    const outcomesForKey = readResult.value.entries.filter(
      (e: any) => e.phase === "outcome" && e.idempotency_key === key,
    );
    expect(outcomesForKey).toHaveLength(1);
    expect(outcomesForKey[0]).toMatchObject({ idempotency_key: key, number: 7 });
  });

  it("SCENARIO-4 (legacy compatibility): a receipt file written under the old three-field .strict() schema stays readable by the v2 reader and is never reported as corrupt", async () => {
    // Written directly to disk in the OLD v1 shape — no `phase` field at
    // all, exactly {upstream_doc_id, title, at} per
    // packages/lore/src/service/receipt-log.ts:53-59.
    const legacyLine1 = JSON.stringify({
      upstream_doc_id: "01AAAAAAAAAAAAAAAAAAAAAAAA",
      title: "legacy report filed before v2 existed",
      at: "2026-07-01T00:00:00.000Z",
    });
    const legacyLine2 = JSON.stringify({
      upstream_doc_id: "01BBBBBBBBBBBBBBBBBBBBBBBB",
      title: "second legacy report",
      at: "2026-07-02T00:00:00.000Z",
    });
    writeFileSync(filePath, [legacyLine1, legacyLine2].join("\n") + "\n", "utf8");

    const { ReceiptLogV2 } = await importReceiptLogV2();
    const log = new ReceiptLogV2(filePath);

    const readResult = log.read();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    expect(readResult.value.entries).toHaveLength(2);
    expect(readResult.value.entries[0]).toMatchObject({
      upstream_doc_id: "01AAAAAAAAAAAAAAAAAAAAAAAA",
      title: "legacy report filed before v2 existed",
    });
    expect(readResult.value.entries[1]).toMatchObject({
      upstream_doc_id: "01BBBBBBBBBBBBBBBBBBBBBBBB",
      title: "second legacy report",
    });
    // The whole point of this scenario: legacy rows are NOT corrupt.
    expect(readResult.value.corrupt_lines).toEqual([]);
  });

  it("SCENARIO-5 (crash tolerance): a truncated final line from a crash mid-append returns the parseable prefix and reports the partial line, never silently dropping it", async () => {
    const { ReceiptLogV2 } = await importReceiptLogV2();
    const log = new ReceiptLogV2(filePath);
    const key = "01HQZX3JBTG7VD9K5M2N4P6RCR";

    expect(log.appendIntent({ idempotency_key: key, title: "about to crash", at: "2026-08-23T00:00:00.000Z" }).ok).toBe(true);
    expect(
      log.appendOutcome({
        idempotency_key: key,
        number: 99,
        url: "https://github.com/example/repo/issues/99",
        at: "2026-08-23T00:00:01.000Z",
      }).ok,
    ).toBe(true);

    // Simulate a process crash mid-write: a third line, no trailing
    // newline, cut off partway through the JSON — exactly what a killed
    // `appendFileSync` write can leave behind.
    const truncatedFragment = '{"phase":"intent","idempotency_key":"01HQZX3JBTG7VD9K5M2N4P6RDX","tit';
    appendFileSync(filePath, truncatedFragment, "utf8");

    let readResult: any;
    expect(() => {
      readResult = log.read();
    }).not.toThrow();

    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    // The parseable prefix (the two valid lines written before the crash)
    // is returned in full.
    expect(readResult.value.entries).toHaveLength(2);
    expect(readResult.value.entries[0]).toMatchObject({ phase: "intent", idempotency_key: key });
    expect(readResult.value.entries[1]).toMatchObject({ phase: "outcome", idempotency_key: key, number: 99 });

    // The partial line is REPORTED (its 1-indexed physical line number),
    // never silently dropped.
    expect(readResult.value.corrupt_lines).toEqual([3]);
  });
});
