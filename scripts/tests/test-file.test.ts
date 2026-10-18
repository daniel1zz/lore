// @spawns scripts/test-file.ts
/**
 * TG-41: `bun run test:file` routes each path to the runner that can collect it, and fails (never
 * silently passes) when a path collected nothing. Pure routing + exit-code cases with an injected
 * runner, plus one real spawn proving a path that matches nothing exits non-zero.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NODE_PROJECT_FILES } from "../../vitest.node-files.js";
import { judgeCollected, main, planGroups, splitArgs, type Group } from "../test-file.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE_FILE = Object.keys(NODE_PROJECT_FILES)[0] as string;
const BUN_FILE = "scripts/tests/some-bun.test.ts";
const NODE_SET: ReadonlySet<string> = new Set([NODE_FILE]);

const report = (...names: string[]): string =>
  JSON.stringify({ testResults: names.map((n) => ({ name: join(ROOT, n), assertionResults: [{ status: "passed" }] })) });

function fakeRunner(exit: number, collected: (g: Group) => string[]) {
  const seen: Group[] = [];
  const run = (g: Group): { exit: number; report: string | null } => {
    seen.push(g);
    return { exit, report: report(...collected(g)) };
  };
  return { seen, run };
}

describe("test:file routing (TG-41)", () => {
  it("HAPPY: a Node-listed path alone runs only under the Node config, passthrough kept", () => {
    const { paths, passthrough } = splitArgs([NODE_FILE, "-t", "AC-1"]);
    const g = planGroups(paths, passthrough, NODE_SET, (r) => `/x/${r}.json`);
    expect(g.map((x) => x.runner)).toEqual(["node"]);
    expect(g[0]?.argv).toContain("vitest.node.config.ts");
    expect(g[0]?.argv).not.toContain("--bun");
    expect(g[0]?.argv).toEqual(expect.arrayContaining(["-t", "AC-1", NODE_FILE]));
  });

  it("HAPPY: a Bun path alone runs only under --bun, never the Node config", () => {
    const g = planGroups([BUN_FILE], [], NODE_SET, (r) => `/x/${r}.json`);
    expect(g.map((x) => x.runner)).toEqual(["bun"]);
    expect(g[0]?.argv[0]).toBe("--bun");
    expect(g[0]?.argv).not.toContain("vitest.node.config.ts");
  });

  it("HAPPY: a mix splits into both groups, each with only its own files", () => {
    const g = planGroups([BUN_FILE, NODE_FILE], ["-t", "x"], NODE_SET, (r) => `/x/${r}.json`);
    expect(g.map((x) => [x.runner, x.files])).toEqual([["bun", [BUN_FILE]], ["node", [NODE_FILE]]]);
    for (const x of g) expect(x.argv).toEqual(expect.arrayContaining(["-t", "x"]));
  });

  it("exit 0 only when every runner passed and every path collected tests", () => {
    const { run } = fakeRunner(0, (g) => [...g.files]);
    expect(main([BUN_FILE, NODE_FILE], run, NODE_SET, ROOT)).toBe(0);
  });

  it("NEGATIVE: a path that collected nothing exits 1 even when the runner exited 0", () => {
    const { run } = fakeRunner(0, () => []);
    expect(main([NODE_FILE], run, NODE_SET, ROOT)).toBe(1);
  });

  it("NEGATIVE: one failing runner exits 1 although the other passed", () => {
    const run = (g: Group): { exit: number; report: string | null } => ({ exit: g.runner === "node" ? 1 : 0, report: report(...g.files) });
    expect(main([BUN_FILE, NODE_FILE], run, NODE_SET, ROOT)).toBe(1);
  });

  it("BOUNDARY: no path is a usage error (exit 2); an all-skipped or absent report counts as collecting nothing", () => {
    expect(main(["-t", "x"], () => ({ exit: 0, report: null }), NODE_SET, ROOT)).toBe(2);
    const skipped = JSON.stringify({ testResults: [{ name: join(ROOT, BUN_FILE), assertionResults: [{ status: "skipped" }] }] });
    expect(judgeCollected([BUN_FILE], skipped, ROOT)).toEqual([BUN_FILE]);
    expect(judgeCollected([BUN_FILE], null, ROOT)).toEqual([BUN_FILE]);
    expect(judgeCollected([BUN_FILE], "not json", ROOT)).toEqual([BUN_FILE]);
  });

  it("ERROR (real spawn): a path that matches nothing exits non-zero", () => {
    const r = spawnSync("bun", ["scripts/test-file.ts", "scripts/tests/does-not-exist-tg41.test.ts"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("collected no tests");
  }, 120_000);
});
