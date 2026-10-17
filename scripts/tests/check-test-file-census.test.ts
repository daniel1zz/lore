// @reads .lore-bootstrap/**
// @reads .serena/**
// @reads assets/**
// @reads dist-npm/**
// @reads docs/**
// @reads hooks/**
// @reads npm-pkg/**
// @reads packages/**
// @reads scripts/**
/**
 * check-test-file-census: the "files on disk == files run" proof (task-skill-implement-tg-23).
 * Six dimensions: HAPPY (complete census) / NEGATIVE (dropped, double-run, stale, mis-routed files) /
 * BOUNDARY (skipped trees, tsx) / ERROR (unreadable, malformed, empty reports) / STATE (pure,
 * order-independent) / REGRESSION (the real tree is complete against the real Node list).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NODE_PROJECT_FILES } from "../../vitest.node-files";
import { CensusError, evaluateCensus, findTestFilesOnDisk, main, readReportedFiles } from "../check-test-file-census";

const made: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "census-"));
  made.push(d);
  return d;
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const rules = (r: ReturnType<typeof evaluateCensus>) => r.findings.map((f) => `${f.rule}:${f.path}`).sort();

describe("evaluateCensus", () => {
  it("HAPPY: every file on disk ran exactly once, the listed one under Node", () => {
    const r = evaluateCensus(["a.test.ts", "b.test.ts", "n.test.ts"], ["a.test.ts", "b.test.ts"], ["n.test.ts"], ["n.test.ts"]);
    expect(r.findings).toEqual([]);
    expect([r.onDisk, r.ranUnderBun, r.ranUnderNode]).toEqual([3, 2, 1]);
  });

  it("NEGATIVE: a file on disk that no invocation ran is reported (the dropped-file case)", () => {
    const r = evaluateCensus(["a.test.ts", "dropped.test.ts"], ["a.test.ts"], [], []);
    expect(rules(r)).toEqual(["on-disk-not-run:dropped.test.ts"]);
  });

  it("NEGATIVE: a file run by both invocations, or twice by one, is reported run-twice", () => {
    const both = evaluateCensus(["a.test.ts"], ["a.test.ts"], ["a.test.ts"], ["a.test.ts"]);
    expect(rules(both)).toContain("run-twice:a.test.ts");
    const twice = evaluateCensus(["a.test.ts"], ["a.test.ts", "a.test.ts"], [], []);
    expect(rules(twice)).toEqual(["run-twice:a.test.ts"]);
  });

  it("NEGATIVE: a reported file that is not on disk is reported, as is a Node-listed file that does not exist", () => {
    const r = evaluateCensus(["a.test.ts"], ["a.test.ts", "ghost.test.ts"], [], ["gone.test.ts"]);
    expect(rules(r)).toEqual(["node-list-missing:gone.test.ts", "run-not-on-disk:ghost.test.ts"]);
  });

  it("NEGATIVE: a Node-listed file that ran under Bun, or a non-listed file that ran under Node, is mis-routed", () => {
    const r = evaluateCensus(["n.test.ts", "x.test.ts"], ["n.test.ts"], ["x.test.ts"], ["n.test.ts"]);
    expect(rules(r)).toEqual(["node-list-ran-under-bun:n.test.ts", "node-list-ran-under-bun:x.test.ts"]);
  });

  it("STATE: the result does not depend on input order", () => {
    const a = evaluateCensus(["a", "b", "c"], ["c", "a"], ["b"], ["b"]);
    const b = evaluateCensus(["c", "b", "a"], ["a", "c"], ["b"], ["b"]);
    expect(rules(a)).toEqual(rules(b));
    expect(a.findings).toEqual([]);
  });
});

describe("findTestFilesOnDisk", () => {
  it("BOUNDARY: finds .test.ts and .test.tsx, skips node_modules/.claude/dist and non-test files", () => {
    const root = tmp();
    for (const p of [
      "packages/x/tests/a.test.ts",
      "packages/dash/tests/b.test.tsx",
      "packages/x/tests/e2e/c.pw.ts",
      "packages/x/src/plain.ts",
      "node_modules/dep/d.test.ts",
      ".claude/worktrees/w/e.test.ts",
      "dist/f.test.ts",
    ]) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), "");
    }
    expect(findTestFilesOnDisk(root)).toEqual(["packages/dash/tests/b.test.tsx", "packages/x/tests/a.test.ts"]);
  });
});

describe("readReportedFiles", () => {
  it("HAPPY: reads repo-relative paths from testResults", () => {
    const root = tmp();
    const report = join(root, "r.json");
    writeFileSync(report, JSON.stringify({ testResults: [{ name: join(root, "p/a.test.ts") }] }));
    expect(readReportedFiles(report, root)).toEqual(["p/a.test.ts"]);
  });

  it("ERROR: a missing, malformed or shapeless report throws CensusError, never an empty list", () => {
    const root = tmp();
    expect(() => readReportedFiles(join(root, "missing.json"), root)).toThrow(CensusError);
    writeFileSync(join(root, "bad.json"), "{not json");
    expect(() => readReportedFiles(join(root, "bad.json"), root)).toThrow(CensusError);
    writeFileSync(join(root, "shape.json"), JSON.stringify({ other: 1 }));
    expect(() => readReportedFiles(join(root, "shape.json"), root)).toThrow(/no testResults/);
    writeFileSync(join(root, "noname.json"), JSON.stringify({ testResults: [{}] }));
    expect(() => readReportedFiles(join(root, "noname.json"), root)).toThrow(/no file name/);
  });
});

describe("main", () => {
  it("ERROR: missing arguments exit 2", () => {
    expect(main([])).toBe(2);
  });

  it("ERROR: a Bun report that ran nothing is not a pass (AS-17)", () => {
    const root = tmp();
    mkdirSync(join(root, "t"), { recursive: true });
    writeFileSync(join(root, "t", "a.test.ts"), "");
    writeFileSync(join(root, "empty.json"), JSON.stringify({ testResults: [] }));
    expect(main([join(root, "empty.json"), join(root, "empty.json")], root)).toBe(1);
  });
});

describe("REGRESSION: the declared Node list", () => {
  it("every Node-listed file exists on disk and carries a non-empty reason", () => {
    const onDisk = new Set(findTestFilesOnDisk(join(import.meta.dirname, "..", "..")));
    for (const [file, reason] of Object.entries(NODE_PROJECT_FILES)) {
      expect(onDisk.has(file), `${file} is listed in vitest.node-files.ts but not on disk`).toBe(true);
      expect(reason.trim().length, `${file} has no reason`).toBeGreaterThan(20);
    }
  });
});
