// @spawns scripts/measure-test-wall.ts
/** @spec_ref AC-TG-11 */
/**
 * measure-test-wall: exit 1 above the limit OR when files run < files on disk (task-skill-implement-tg-15).
 * Six dimensions: HAPPY (in limit, complete: 0) / NEGATIVE (over limit: 1; incomplete: 1; each reason alone,
 * so neither can hide behind the other) / BOUNDARY (exactly at the limit passes) / ERROR (bad args: 2, suite red: 1) /
 * STATE (a duplicated report entry is not a second file) / REGRESSION (worker env override is validated, the printed line
 * carries seconds, workers, files, machine).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_WORKERS, resolveMaxWorkers } from "../test-max-workers";
import { evaluateMeasurement, main, parseMaxSeconds, type MeasureDeps } from "../measure-test-wall";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const green = { bun: 0, node: 0, census: 0, miss: 0, bunReport: "bun.json", nodeReport: "node.json" };

function deps(over: { seconds?: number; onDisk?: string[]; ran?: Record<string, string[]>; outcome?: typeof green }): MeasureDeps {
  let t = 1_000;
  const ran = over.ran ?? { "bun.json": ["a.test.ts", "b.test.ts"], "node.json": ["n.test.ts"] };
  return {
    runSuite: () => {
      t += (over.seconds ?? 100) * 1000;
      return over.outcome ?? green;
    },
    filesOnDisk: () => over.onDisk ?? ["a.test.ts", "b.test.ts", "n.test.ts"],
    filesInReport: (p) => ran[p] ?? [],
    now: () => t,
    machine: () => "os=test arch=test cpus=8",
    workers: () => 4,
  };
}

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("measure-test-wall main", () => {
  it("HAPPY: within the limit, every file ran, suite green -> exit 0 and the printed line carries the four facts", () => {
    expect(main(["--max-seconds", "600"], deps({ seconds: 300 }))).toBe(0);
    const line = out.join("\n");
    expect(line).toContain("300.0 s wall");
    expect(line).toContain("workers=4");
    expect(line).toContain("files run=3 of 3 on disk");
    expect(line).toContain("os=test arch=test cpus=8");
  });

  it("NEGATIVE (reason 1): over the limit with every file run -> exactly exit 1, reason over-limit only", () => {
    expect(main(["--max-seconds", "600"], deps({ seconds: 601 }))).toBe(1);
    expect(out.join("\n")).toContain("FAIL — over-limit");
    expect(out.join("\n")).not.toContain("files-run-below");
  });

  it("NEGATIVE (reason 2): within the limit but a test file did not run -> exactly exit 1, reason files-run-below-files-on-disk only", () => {
    const d = deps({ seconds: 10, onDisk: ["a.test.ts", "b.test.ts", "n.test.ts", "dropped.test.ts"] });
    expect(main(["--max-seconds", "600"], d)).toBe(1);
    expect(out.join("\n")).toContain("FAIL — files-run-below-files-on-disk");
    expect(out.join("\n")).not.toContain("over-limit");
  });

  it("BOUNDARY: exactly at the limit passes; one second above fails", () => {
    expect(main(["--max-seconds", "600"], deps({ seconds: 600 }))).toBe(0);
    expect(main(["--max-seconds", "600"], deps({ seconds: 601 }))).toBe(1);
  });

  it("ERROR: a red suite fails the measurement even when fast and complete", () => {
    expect(main(["--max-seconds", "600"], deps({ seconds: 5, outcome: { ...green, bun: 1 } }))).toBe(1);
    expect(out.join("\n")).toContain("suite-failed");
  });

  it("ERROR: missing, non-numeric, zero and negative --max-seconds are usage errors (exit 2), the suite never runs", () => {
    const d = deps({});
    const spy = vi.spyOn(d, "runSuite");
    for (const argv of [[], ["--max-seconds"], ["--max-seconds", "abc"], ["--max-seconds", "0"], ["--max-seconds", "-5"]]) {
      expect(main(argv, d)).toBe(2);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("STATE: a file listed twice across the reports is counted once (a double run cannot mask a dropped file)", () => {
    const d = deps({ onDisk: ["a.test.ts", "b.test.ts", "c.test.ts"], ran: { "bun.json": ["a.test.ts", "a.test.ts", "b.test.ts"], "node.json": [] } });
    expect(main(["--max-seconds", "600"], d)).toBe(1);
  });
});

describe("pure helpers", () => {
  it("evaluateMeasurement reports both reasons together, in a fixed order", () => {
    const m = { seconds: 700, workers: 4, filesRun: 1, filesOnDisk: 2, suiteExit: 1, machine: "m" };
    expect(evaluateMeasurement(m, 600)).toEqual(["over-limit", "files-run-below-files-on-disk", "suite-failed"]);
  });
  it("parseMaxSeconds accepts a decimal", () => {
    expect(parseMaxSeconds(["--max-seconds", "12.5"])).toBe(12.5);
  });
  it("REGRESSION: resolveMaxWorkers defaults, honours a valid override and rejects an invalid one loudly", () => {
    expect(resolveMaxWorkers({})).toBe(DEFAULT_MAX_WORKERS);
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: "6" })).toBe(6);
    expect(() => resolveMaxWorkers({ VITEST_MAX_WORKERS: "0" })).toThrow(/positive integer/);
    expect(() => resolveMaxWorkers({ VITEST_MAX_WORKERS: "four" })).toThrow(/positive integer/);
  });
});

describe("real process", () => {
  it("a bad invocation exits exactly 2 without running anything", () => {
    const r = spawnSync("bun", ["scripts/measure-test-wall.ts"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage");
  });
});
