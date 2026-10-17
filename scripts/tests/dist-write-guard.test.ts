// @reads packages/lore/src/generated/dashboard-assets.ts
// @reads packages/lore/src/generated/assets-manifest.ts
// @spawns scripts/build.ts
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
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DistWrittenDuringRunError,
  SourceTreeWrittenDuringRunError,
  TEST_RUN_ACTIVE_ENV,
  assertBinaryUnchanged,
  assertSourceTreeUnchanged,
  isNestedTestRun,
  snapshotBinary,
  snapshotSourceTree,
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

describe("source-tree guard (TG-24 follow-up: a src mtime bump makes dist/lore look stale to every compiled test)", () => {
  function tree(): string {
    const root = mkdtempSync(join(tmpdir(), "src-guard-"));
    mkdirSync(join(root, "sub"), { recursive: true });
    writeFileSync(join(root, "a.ts"), "a");
    writeFileSync(join(root, "sub", "b.ts"), "b");
    writeFileSync(join(root, "sub", "ignored.md"), "not a ts file");
    return root;
  }

  it("HAPPY: an untouched tree passes", () => {
    const root = tree();
    const before = snapshotSourceTree([root]);
    expect(() => assertSourceTreeUnchanged(before, [root])).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it("NEGATIVE: a touched .ts file (mtime only, same bytes) is named", () => {
    const root = tree();
    const before = snapshotSourceTree([root]);
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(root, "sub", "b.ts"), later, later);
    try {
      assertSourceTreeUnchanged(before, [root]);
      expect.unreachable("must throw");
    } catch (caught) {
      expect(caught).toBeInstanceOf(SourceTreeWrittenDuringRunError);
      expect((caught as SourceTreeWrittenDuringRunError).changedPaths).toEqual([join(root, "sub", "b.ts")]);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("NEGATIVE: an added and a removed .ts file are both reported", () => {
    const root = tree();
    const before = snapshotSourceTree([root]);
    writeFileSync(join(root, "new.ts"), "n");
    rmSync(join(root, "a.ts"));
    expect(() => assertSourceTreeUnchanged(before, [root])).toThrow(/new\.ts[\s\S]*a\.ts|a\.ts[\s\S]*new\.ts/);
    rmSync(root, { recursive: true, force: true });
  });

  it("BOUNDARY: a non-.ts file changing is not a source change", () => {
    const root = tree();
    const before = snapshotSourceTree([root]);
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(root, "sub", "ignored.md"), later, later);
    expect(() => assertSourceTreeUnchanged(before, [root])).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it("ERROR: a missing source dir fails loud instead of snapshotting an empty tree", () => {
    expect(() => snapshotSourceTree([join(dir, "no-such-dir")])).toThrow(/does not exist/);
  });
});

describe("nested test runs never build or snapshot (a vitest a test spawns inherits the run's marker)", () => {
  it("STATE: only the marker set to 1 means nested", () => {
    expect(isNestedTestRun({})).toBe(false);
    expect(isNestedTestRun({ [TEST_RUN_ACTIVE_ENV]: "" })).toBe(false);
    expect(isNestedTestRun({ [TEST_RUN_ACTIVE_ENV]: "1" })).toBe(true);
  });
});

describe("variant build (--outfile) writes nothing under the repo tree", () => {
  const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
  const GENERATED = [
    join(ROOT, "packages", "lore", "src", "generated", "dashboard-assets.ts"),
    join(ROOT, "packages", "lore", "src", "generated", "assets-manifest.ts"),
  ];

  it("REGRESSION: prints the variant marker, skips the dashboard step, leaves generated sources' mtimes alone", () => {
    const outDir = mkdtempSync(join(tmpdir(), "variant-build-"));
    const before = GENERATED.map((p) => statSync(p).mtimeMs);
    const run = spawnSync("bun", ["run", "scripts/build.ts", "--outfile", join(outDir, "lore")], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 240_000,
    });
    const out = `${run.stdout}${run.stderr}`;
    expect(run.status, out).toBe(0);
    expect(out).toContain("variant build (--outfile)");
    expect(out).not.toContain("Checking dashboard build freshness");
    expect(GENERATED.map((p) => statSync(p).mtimeMs)).toEqual(before);
    expect(readFileSync(join(outDir, "lore")).length).toBeGreaterThan(1_000_000);
    rmSync(outDir, { recursive: true, force: true });
  }, 300_000);
});
