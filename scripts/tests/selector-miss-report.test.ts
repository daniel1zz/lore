// @spawns scripts/selector-miss-report.ts -- the CLI cases run the real cross-check as a child process over a throwaway git repository
/**
 * AC-TG-8 oracle (task-skill-implement-tg-14, spec-test-governance-guards-that-refuse-bad-tests-declared):
 * given a full-suite result file and a commit range, the selector cross-check exits exactly 1 and names
 * each test that failed in the full run but would not have been selected for that range, and exits 0
 * when every failing test would have been selected.
 *
 * Coverage: HAPPY (all failures selected -> exit 0), NEGATIVE (an unselected failure -> exit 1 naming
 * file and test), BOUNDARY (empty range, no failures, two reports), ERROR (unreadable / malformed report,
 * bad range -> exit 2, never 0 or 1), STATE (a file-level failure with no assertions is named),
 * REGRESSION (the selection comes from `selectAffectedTests`, not a second algorithm: a declared `@reads` hit selects).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { findSelectorMisses, parseFailedTests } from "../selector-miss-report.js";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "selector-miss-report.ts");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

/** A throwaway repo: base commit, then a head commit that touches only `packages/lore/src/a.ts`. */
function makeRepo(): { root: string; range: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "selector-miss-")));
  dirs.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t.t");
  git(root, "config", "user.name", "t");
  put(root, "packages/core/package.json", JSON.stringify({ exports: { ".": "./src/index.ts", "./node": "./src/node.ts" } }));
  put(root, "packages/core/src/index.ts", "export const core = 1;\n");
  put(root, "packages/core/src/node.ts", "export const node = 1;\n");
  put(root, "packages/lore/src/a.ts", "export const a = 1;\n");
  put(root, "packages/lore/src/b.ts", "export const b = 1;\n");
  put(root, "packages/lore/tests/imports-a.test.ts", 'import { a } from "../src/a.js";\n');
  put(root, "packages/lore/tests/imports-b.test.ts", 'import { b } from "../src/b.js";\n');
  put(root, "packages/lore/tests/reads-a.test.ts", "// @reads packages/lore/src/a.ts\n");
  put(root, "packages/lore/tests/unrelated.test.ts", "export {};\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD");
  put(root, "packages/lore/src/a.ts", "export const a = 2;\n");
  git(root, "commit", "-qam", "touch a");
  return { root, range: `${base}..HEAD` };
}

interface Fixture {
  file: string;
  status?: string;
  failed?: string[];
  passed?: string[];
}

function report(root: string, name: string, files: Fixture[]): string {
  const path = join(dirname(root), `${name}-${Math.random().toString(36).slice(2)}.json`);
  dirs.push(path);
  const testResults = files.map((f) => ({
    name: join(root, f.file),
    status: f.status ?? ((f.failed ?? []).length > 0 ? "failed" : "passed"),
    assertionResults: [
      ...(f.failed ?? []).map((t) => ({ fullName: t, status: "failed" })),
      ...(f.passed ?? []).map((t) => ({ fullName: t, status: "passed" })),
    ],
  }));
  writeFileSync(path, JSON.stringify({ testResults }));
  return path;
}

function cli(root: string, ...args: string[]) {
  const r = spawnSync("bun", [SCRIPT, ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("AC-TG-8 selector cross-check", () => {
  it("AC-TG-8: exits 1 and names each failed test the selector would not have selected for the range", () => {
    const { root, range } = makeRepo();
    const rep = report(root, "bun", [
      { file: "packages/lore/tests/imports-b.test.ts", failed: ["b breaks"] },
      { file: "packages/lore/tests/unrelated.test.ts", failed: ["flaky one", "flaky two"] },
      { file: "packages/lore/tests/imports-a.test.ts", failed: ["a breaks"] },
    ]);
    const r = cli(root, range, rep);
    expect(r.code).toBe(1);
    expect(r.out).toContain("packages/lore/tests/imports-b.test.ts");
    expect(r.out).toContain("b breaks");
    expect(r.out).toContain("packages/lore/tests/unrelated.test.ts");
    expect(r.out).toContain("flaky one");
    expect(r.out).toContain("flaky two");
    // the selected failure is not a miss
    expect(r.out).not.toContain("a breaks");
  });

  it("AC-TG-8: exits 0 when every failed test would have been selected (import and declared read)", () => {
    const { root, range } = makeRepo();
    const rep = report(root, "bun", [
      { file: "packages/lore/tests/imports-a.test.ts", failed: ["a breaks"] },
      { file: "packages/lore/tests/reads-a.test.ts", failed: ["reads a"] },
      { file: "packages/lore/tests/imports-b.test.ts", passed: ["fine"] },
    ]);
    const r = cli(root, range, rep);
    expect(r.code).toBe(0);
  });

  it("AC-TG-8: exits 0 when the full run had no failures, even for an empty range", () => {
    const { root } = makeRepo();
    const rep = report(root, "bun", [{ file: "packages/lore/tests/unrelated.test.ts", passed: ["ok"] }]);
    expect(cli(root, "HEAD..HEAD", rep).code).toBe(0);
  });

  it("AC-TG-8: an empty range selects nothing, so any failure is a miss", () => {
    const { root } = makeRepo();
    const rep = report(root, "bun", [{ file: "packages/lore/tests/imports-a.test.ts", failed: ["a breaks"] }]);
    const r = cli(root, "HEAD..HEAD", rep);
    expect(r.code).toBe(1);
    expect(r.out).toContain("a breaks");
  });

  it("AC-TG-8: reads the Bun and Node reports together", () => {
    const { root, range } = makeRepo();
    const bun = report(root, "bun", [{ file: "packages/lore/tests/imports-a.test.ts", passed: ["ok"] }]);
    const node = report(root, "node", [{ file: "packages/lore/tests/unrelated.test.ts", failed: ["node only"] }]);
    const r = cli(root, range, bun, node);
    expect(r.code).toBe(1);
    expect(r.out).toContain("node only");
  });

  it("AC-TG-8: a file-level failure with no failed assertion is still named", () => {
    const { root, range } = makeRepo();
    const rep = report(root, "bun", [{ file: "packages/lore/tests/unrelated.test.ts", status: "failed" }]);
    const r = cli(root, range, rep);
    expect(r.code).toBe(1);
    expect(r.out).toContain("packages/lore/tests/unrelated.test.ts");
  });

  it("AC-TG-8: a missing report, a malformed report or a bad range exits 2, never 0 or 1", () => {
    const { root, range } = makeRepo();
    expect(cli(root, range, join(root, "nope.json")).code).toBe(2);
    const bad = join(root, "bad.json");
    writeFileSync(bad, "{not json");
    expect(cli(root, range, bad).code).toBe(2);
    const rep = report(root, "bun", [{ file: "packages/lore/tests/unrelated.test.ts", passed: ["ok"] }]);
    expect(cli(root, "no-such-ref..HEAD", rep).code).toBe(2);
    expect(cli(root, "not-a-range", rep).code).toBe(2);
    expect(cli(root).code).toBe(2);
  });
});

describe("AC-TG-8 pure core", () => {
  it("AC-TG-8: parseFailedTests keeps only failed assertions and rejects a report without testResults", () => {
    const json = JSON.stringify({
      testResults: [{ name: "/r/x.test.ts", status: "failed", assertionResults: [{ fullName: "t1", status: "failed" }, { fullName: "t2", status: "passed" }] }],
    });
    expect(parseFailedTests(json, "/r", "r.json")).toEqual([{ file: "x.test.ts", test: "t1" }]);
    expect(() => parseFailedTests("{}", "/r", "r.json")).toThrow(/testResults/);
  });

  it("AC-TG-8: findSelectorMisses partitions failures by the selection", () => {
    const selection = { selected: [{ path: "a.test.ts", reason: "transitive" as const, runner: "vitest" as const }], zeroSelectionWarning: false, changedFiles: ["a.ts"] };
    const misses = findSelectorMisses(
      [
        { file: "a.test.ts", test: "x" },
        { file: "b.test.ts", test: "y" },
      ],
      selection,
    );
    expect(misses).toEqual([{ file: "b.test.ts", test: "y" }]);
  });
});
