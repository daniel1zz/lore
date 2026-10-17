// @spawns scripts/run-chain.ts
// @reads package.json
/** @spec_ref AC-TG-10 */
/**
 * run-chain: the `bun run test` chain runs EVERY step and reports all results (task-skill-implement-tg-15).
 * Six dimensions: HAPPY (all pass) / NEGATIVE (two failing steps both reported, exit 1) / BOUNDARY (the failing step is
 * first, then last) / ERROR (no steps, step that cannot start) / STATE (a failure never skips a later step) /
 * REGRESSION (package.json routes `test` through the runner, keeps the oracle lock, and lists the same steps).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_STEPS, main, renderTable, runChain } from "../run-chain";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const fake = (codes: Record<string, number>) => {
  const ran: string[] = [];
  return { ran, run: (s: string) => (ran.push(s), { exit: codes[s] ?? 0, seconds: 0.5 }) };
};

describe("runChain", () => {
  it("HAPPY: all steps pass -> every step ran in order, exit 0", () => {
    const f = fake({});
    const logs = vi_silence();
    expect(main(["a", "b", "c"], f.run)).toBe(0);
    logs();
    expect(f.ran).toEqual(["a", "b", "c"]);
  });

  it("NEGATIVE/STATE: two failing steps are BOTH reported and exit is exactly 1; later steps still ran", () => {
    const f = fake({ a: 3, c: 4 });
    const results = runChain(["a", "b", "c", "d"], f.run);
    expect(f.ran).toEqual(["a", "b", "c", "d"]);
    expect(results.map((r) => r.exit)).toEqual([3, 0, 4, 0]);
    const table = renderTable(results);
    expect(table).toContain("2 of 4 steps FAILED: a; c");
    expect(table).toMatch(/FAIL\s+exit\s+3.*a/);
    expect(table).toMatch(/FAIL\s+exit\s+4.*c/);
    const logs = vi_silence();
    expect(main(["a", "b", "c", "d"], fake({ a: 3, c: 4 }).run)).toBe(1);
    logs();
  });

  it("BOUNDARY: a failure in the last step alone is still exit 1", () => {
    const logs = vi_silence();
    expect(main(["a", "b"], fake({ b: 9 }).run)).toBe(1);
    logs();
  });

  it("ERROR: zero steps throws instead of passing", () => {
    expect(() => runChain([], fake({}).run)).toThrow(/no steps/);
  });

  it("REAL SPAWN: two failing shell steps and one passing step -> both failures in the table, exit exactly 1, the last step ran", () => {
    const r = spawnSync("bun", ["scripts/run-chain.ts", "exit 3", "echo still-ran-after-failure", "exit 4"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("still-ran-after-failure");
    expect(r.stdout).toMatch(/FAIL\s+exit\s+3\s.*exit 3/);
    expect(r.stdout).toMatch(/FAIL\s+exit\s+4\s.*exit 4/);
    expect(r.stdout).toContain("2 of 3 steps FAILED");
  });

  it("REAL SPAWN: a step that is not a command is a failure (127), not a skip", () => {
    const r = spawnSync("bun", ["scripts/run-chain.ts", "definitely-not-a-command-xyz"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAIL\s+exit\s+127/);
  });

  it("REGRESSION: package.json `test` is the oracle lock wrapping run-chain, and every default step is a real script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe("bun scripts/oracle-lock.ts bun scripts/run-chain.ts");
    for (const step of DEFAULT_STEPS) {
      const name = /^bun run (\S+)$/.exec(step)?.[1];
      expect(name, step).toBeDefined();
      expect(pkg.scripts[name as string], step).toBeDefined();
    }
    expect(DEFAULT_STEPS).toContain("bun run test:vitest");
  });
});

/** Silence console.log for one block; returns the restore function. */
function vi_silence(): () => void {
  const orig = console.log;
  console.log = () => undefined;
  return () => {
    console.log = orig;
  };
}
