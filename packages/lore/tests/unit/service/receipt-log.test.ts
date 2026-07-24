/**
 * RED (TDD) vitest suite for SPEC-072 `ReceiptLog`
 * (`packages/lore/src/service/receipt-log.ts` — DOES NOT EXIST YET).
 *
 * `ReceiptLog` is the consumer-side append-only JSONL receipt file
 * (`<consumer>/.lore/issue-receipts.jsonl`, mirroring the `JsonlTelemetry`
 * write pattern — `packages/core/src/telemetry-node.ts`): `append()` writes
 * one JSON line per filed report, `read()` parses every line back, skipping
 * (never throwing on) corrupt lines and reporting their 1-indexed line
 * numbers via `corrupt_lines`.
 *
 * Module-resolution note: unlike `packages/lore/tests/unit/core/config-io.test.ts`
 * (whose target module ALREADY exists but is missing a named export — a
 * literal `await import("@lore/core/node")` resolves fine, only the
 * destructured export is undefined), THIS file's target module does not exist
 * on disk at all. A literal-string `import("../../../src/service/receipt-log.js")`
 * would be statically resolved by `tsc` and fail `bun run typecheck` with
 * TS2307 ("Cannot find module") even under `--noEmit`. Routing the specifier
 * through a `const` (a non-literal expression) opts the dynamic `import()`
 * out of TypeScript's static module-resolution check — verified empirically:
 * `tsc` flags a literal `import("./does-not-exist.js")` but NOT the same call
 * with a variable holding that same string. `bun`'s runtime resolver has no
 * such literal-only restriction — the import still rejects at test-run time
 * with a real "Cannot find module" error, which is exactly the RED failure
 * this suite exists to produce.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-072 §4 Public Interface (ReceiptLog), §11 Downstream Handoff
 *   ("Corruption is reported, not repaired").
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ─── Dynamic import helper (module does not exist yet — see header note) ────

const RECEIPT_LOG_MODULE_SPECIFIER = "../../../src/service/receipt-log.js";

async function importReceiptLog(): Promise<{ ReceiptLog: new (filePath: string) => any }> {
  const mod = await import(RECEIPT_LOG_MODULE_SPECIFIER);
  const ReceiptLog = (mod as any).ReceiptLog;
  if (typeof ReceiptLog !== "function") {
    throw new Error(
      "receipt-log.ts does not export ReceiptLog — implementation missing (RED expected)",
    );
  }
  return { ReceiptLog };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-receipt-log-test-"));
  filePath = join(dir, "issue-receipts.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SPEC-072 ReceiptLog (RED — packages/lore/src/service/receipt-log.ts not implemented yet)", () => {
  it("HAPPY: append() then read() round-trips a single entry with no corrupt lines", async () => {
    const { ReceiptLog } = await importReceiptLog();
    const log = new ReceiptLog(filePath);
    const entry = {
      upstream_doc_id: "01ABCDEF",
      title: "bug: crash on empty title",
      at: "2026-07-24T00:00:00.000Z",
    };

    const appendResult = log.append(entry);
    expect(appendResult.ok).toBe(true);

    const readResult = log.read();
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.entries).toEqual([entry]);
      expect(readResult.value.corrupt_lines).toEqual([]);
    }
  });

  it("NEGATIVE: read() on a file that was never created returns empty entries and never throws", async () => {
    const { ReceiptLog } = await importReceiptLog();
    expect(existsSync(filePath)).toBe(false);
    const log = new ReceiptLog(filePath);

    let readResult: any;
    expect(() => {
      readResult = log.read();
    }).not.toThrow();

    expect(readResult.ok).toBe(true);
    expect(readResult.value.entries).toEqual([]);
    expect(readResult.value.corrupt_lines).toEqual([]);
  });

  it("BOUNDARY: read() on a 0-byte file returns empty entries, never throws", async () => {
    const { ReceiptLog } = await importReceiptLog();
    writeFileSync(filePath, "", "utf8");
    const log = new ReceiptLog(filePath);

    const readResult = log.read();
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.entries).toEqual([]);
      expect(readResult.value.corrupt_lines).toEqual([]);
    }
  });

  it("ERROR: read() on a file with 1 corrupt line among 3 skips it — 2 entries + corrupt_lines=[2], no throw", async () => {
    const { ReceiptLog } = await importReceiptLog();
    const line1 = JSON.stringify({
      upstream_doc_id: "01AAAAAA",
      title: "first report",
      at: "2026-07-24T00:00:00.000Z",
    });
    const corruptLine = "{not valid json,,,";
    const line3 = JSON.stringify({
      upstream_doc_id: "01CCCCCC",
      title: "third report",
      at: "2026-07-24T00:02:00.000Z",
    });
    writeFileSync(filePath, [line1, corruptLine, line3].join("\n") + "\n", "utf8");

    const log = new ReceiptLog(filePath);
    let readResult: any;
    expect(() => {
      readResult = log.read();
    }).not.toThrow();

    expect(readResult.ok).toBe(true);
    expect(readResult.value.entries).toHaveLength(2);
    expect(readResult.value.entries[0]).toMatchObject({ upstream_doc_id: "01AAAAAA" });
    expect(readResult.value.entries[1]).toMatchObject({ upstream_doc_id: "01CCCCCC" });
    // 1-indexed line number of the corrupt line (it is the 2nd line in the file).
    expect(readResult.value.corrupt_lines).toEqual([2]);
  });

  it("STATE: sequential append() calls preserve insertion order across a subsequent read()", async () => {
    const { ReceiptLog } = await importReceiptLog();
    const log = new ReceiptLog(filePath);
    const e1 = { upstream_doc_id: "01A", title: "a", at: "2026-07-24T00:00:00.000Z" };
    const e2 = { upstream_doc_id: "01B", title: "b", at: "2026-07-24T00:01:00.000Z" };
    const e3 = { upstream_doc_id: "01C", title: "c", at: "2026-07-24T00:02:00.000Z" };

    expect(log.append(e1).ok).toBe(true);
    expect(log.append(e2).ok).toBe(true);
    expect(log.append(e3).ok).toBe(true);

    const readResult = log.read();
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.entries).toEqual([e1, e2, e3]);
      expect(readResult.value.corrupt_lines).toEqual([]);
    }
  });

  it("REGRESSION: read() is side-effect-free — calling it twice yields identical results and never rewrites the file", async () => {
    const { ReceiptLog } = await importReceiptLog();
    const log = new ReceiptLog(filePath);
    log.append({ upstream_doc_id: "01Z", title: "z", at: "2026-07-24T00:00:00.000Z" });

    const firstRead = log.read();
    const contentAfterFirstRead = readFileSync(filePath, "utf8");
    const secondRead = log.read();
    const contentAfterSecondRead = readFileSync(filePath, "utf8");

    expect(firstRead).toEqual(secondRead);
    expect(contentAfterFirstRead).toEqual(contentAfterSecondRead);
  });
});
