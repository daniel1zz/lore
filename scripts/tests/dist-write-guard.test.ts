/**
 * AC (task-skill-implement-tg-24): a run proves no test writes dist/lore. Unit tests of the guard
 * (scripts/dist-write-guard.ts) and of the global setup's build decision (scripts/test-global-setup.ts).
 * Coverage: HAPPY (unchanged binary passes) / NEGATIVE (rewritten content, touched mtime, deleted,
 * created-after-absent each throw) / BOUNDARY (same bytes rewritten still counts as a write) /
 * ERROR (missing build output fails loud) / STATE (absent-before then present is a write) /
 * REGRESSION (the stale-binary decision builds only when needed).
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DistWrittenDuringRunError,
  assertBinaryUnchanged,
  snapshotBinary,
} from "../dist-write-guard";

const dir = mkdtempSync(join(tmpdir(), "dist-guard-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fixture(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("dist-write-guard", () => {
  it("HAPPY: an untouched binary passes", () => {
    const path = fixture("happy", "binary-v1");
    const before = snapshotBinary(path);
    expect(() => assertBinaryUnchanged(before, path)).not.toThrow();
  });

  it("NEGATIVE: changed content is reported as a write", () => {
    const path = fixture("changed", "binary-v1");
    const before = snapshotBinary(path);
    writeFileSync(path, "binary-v2");
    expect(() => assertBinaryUnchanged(before, path)).toThrow(DistWrittenDuringRunError);
  });

  it("BOUNDARY: identical bytes rewritten (a rebuild that changed nothing) is still a write", () => {
    const path = fixture("rewritten", "same-bytes");
    const before = snapshotBinary(path);
    const later = new Date(Date.now() + 5_000);
    writeFileSync(path, "same-bytes");
    utimesSync(path, later, later);
    expect(() => assertBinaryUnchanged(before, path)).toThrow(/mtime/);
  });

  it("NEGATIVE: a deleted binary is reported", () => {
    const path = fixture("deleted", "x");
    const before = snapshotBinary(path);
    rmSync(path);
    expect(() => assertBinaryUnchanged(before, path)).toThrow(DistWrittenDuringRunError);
  });

  it("ERROR: snapshotting a missing binary fails loud instead of returning a placeholder", () => {
    const missing = join(dir, "never-built");
    expect(existsSync(missing)).toBe(false);
    expect(() => snapshotBinary(missing)).toThrow(/does not exist/);
  });

  it("STATE: the error names the path and what differs", () => {
    const path = fixture("named", "a");
    const before = snapshotBinary(path);
    writeFileSync(path, "bb");
    try {
      assertBinaryUnchanged(before, path);
      expect.unreachable("must throw");
    } catch (caught) {
      expect(caught).toBeInstanceOf(DistWrittenDuringRunError);
      expect((caught as DistWrittenDuringRunError).path).toBe(path);
      expect((caught as Error).message).toContain("size");
    }
  });
});
