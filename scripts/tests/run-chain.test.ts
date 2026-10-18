// @spawns scripts/run-chain.ts
// @reads package.json
/** @spec_ref AC-TG-10 */
/** @layer unit AC-TG-10 — unit coverage of the chain runner behind the whole-run AC; the AC itself is owned by its `bun run test` oracle */
/**
 * run-chain: the `bun run test` chain runs EVERY step and reports all results (task-skill-implement-tg-15).
 * Six dimensions: HAPPY (all pass) / NEGATIVE (two failing steps both reported, exit 1) / BOUNDARY (the failing step is
 * first, then last) / ERROR (no steps, step that cannot start) / STATE (a failure never skips a later step) /
 * REGRESSION (package.json routes `test` through the runner, keeps the oracle lock, and lists the same steps).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORPUS_DEPENDENT_CHECKS, DEFAULT_STEPS, deriveFloorSteps, deriveStaticSteps, main, renderTable, runChain, runStaticFloor } from "../run-chain";

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
    expect(DEFAULT_STEPS).toContain("bun run check:evidence-identity-drop-set");
    expect(pkg.scripts["check:evidence-identity-drop-set"]).toBe("bun scripts/check-evidence-identity-drop-set.ts");
  });
});

describe("check:static (deriveStaticSteps / runStaticFloor)", () => {
  const scripts = { build: "x", typecheck: "y", test: "z", "check:a": "a", "check:spec-mirror": "m", "check:static": "s", "other:check:b": "b" };

  it("HAPPY: derives build, typecheck, then every ^check: script, excluding itself", () => {
    expect(deriveStaticSteps(scripts).steps).toEqual(["bun run build", "bun run typecheck", "bun run check:a", "bun run check:spec-mirror"]);
  });

  it("STATE: a newly added check:* script is picked up without editing the runner", () => {
    expect(deriveStaticSteps({ ...scripts, "check:brand-new": "n" }).steps).toContain("bun run check:brand-new");
  });

  it("labels corpus-dependent steps in the table", () => {
    const { steps, labels } = deriveStaticSteps(scripts);
    const table = renderTable(runChain(steps, () => ({ exit: 0, seconds: 0 })), labels);
    expect(table).toMatch(/check:spec-mirror\s+\[corpus-dependent/);
    expect(table).not.toMatch(/check:a\s+\[/);
  });

  it("ERROR: missing build or typecheck throws", () => {
    expect(() => deriveStaticSteps({ typecheck: "y", "check:a": "a" })).toThrow(/"build"/);
    expect(() => deriveStaticSteps({ build: "x", "check:a": "a" })).toThrow(/"typecheck"/);
  });

  it("RED-FIRST: a fixture package.json with a failing check step exits non-zero naming it, and later steps still ran", () => {
    const dir = mkdtempSync(join(tmpdir(), "static-floor-"));
    try {
      const pkg = join(dir, "package.json");
      writeFileSync(pkg, JSON.stringify({ scripts: { build: "true", typecheck: "true", "check:bad": "false", "check:later": "true" } }));
      const ran: string[] = [];
      const logs: string[] = [];
      const orig = console.log;
      console.log = (m: string) => void logs.push(String(m));
      let code: number;
      try {
        code = runStaticFloor(pkg, (s) => (ran.push(s), { exit: s === "bun run check:bad" ? 1 : 0, seconds: 0 }));
      } finally {
        console.log = orig;
      }
      expect(code).toBe(1);
      expect(ran).toEqual(["bun run build", "bun run typecheck", "bun run check:bad", "bun run check:later"]);
      expect(logs.join("\n")).toContain("1 of 4 steps FAILED: bun run check:bad");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REGRESSION: package.json wires check:static to the runner and the derived list covers every real check:*", () => {
    const real = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(real["check:static"]).toContain("run-chain.ts --static");
    const { steps } = deriveStaticSteps(real);
    for (const name of Object.keys(real).filter((n) => n.startsWith("check:") && n !== "check:static" && n !== "check:floor")) expect(steps).toContain(`bun run ${name}`);
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

describe("check:floor (deriveFloorSteps)", () => {
  const fixture = {
    build: "b",
    typecheck: "t",
    "check:a": "a",
    "check:spec-mirror": "m",
    "check:live-repo-state": "l",
    "check:corpus-fail-census": "c",
    "check:z": "z",
    "check:static": "bun scripts/run-chain.ts --static",
    "check:floor": "bun scripts/run-chain.ts --floor",
  };

  it("is build, typecheck, every check:* minus the corpus-dependent set and the aggregate scripts", () => {
    expect(deriveFloorSteps(fixture)).toEqual(["bun run build", "bun run typecheck", "bun run check:a", "bun run check:z"]);
  });

  it("picks up a brand-new check:* without an edit, and never names check:floor or check:static (no recursion)", () => {
    const steps = deriveFloorSteps({ ...fixture, "check:brand-new": "n" });
    expect(steps).toContain("bun run check:brand-new");
    expect(steps).not.toContain("bun run check:floor");
    expect(steps).not.toContain("bun run check:static");
    expect(deriveStaticSteps(fixture).steps).not.toContain("bun run check:floor");
  });

  it("excludes exactly the CORPUS_DEPENDENT_CHECKS source set", () => {
    const steps = deriveFloorSteps(fixture);
    for (const name of CORPUS_DEPENDENT_CHECKS) expect(steps).not.toContain(`bun run ${name}`);
  });

  it("classifies by what a check judges: corpus-state checks are out of the floor, the tree-judging ac-oracle-ownership stays in", () => {
    expect(CORPUS_DEPENDENT_CHECKS.has("check:evidence-identity-drop-set")).toBe(true);
    expect(CORPUS_DEPENDENT_CHECKS.has("check:ac-ref-integrity")).toBe(true);
    expect(CORPUS_DEPENDENT_CHECKS.has("check:ac-oracle-ownership")).toBe(false);
    const real = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    const steps = deriveFloorSteps(real);
    expect(steps).toContain("bun run check:ac-oracle-ownership");
    expect(steps).not.toContain("bun run check:evidence-identity-drop-set");
    expect(steps).not.toContain("bun run check:ac-ref-integrity");
  });

  it("fails loud without build or typecheck", () => {
    expect(() => deriveFloorSteps({ typecheck: "y", "check:a": "a" })).toThrow(/"build"/);
  });

  it("the real package.json declares check:floor and the floor lists every non-corpus check", () => {
    const real = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(real["check:floor"]).toBe("bun scripts/run-chain.ts --floor");
    const expected = Object.keys(real).filter((n) => /^check:/.test(n) && n !== "check:static" && n !== "check:floor" && !CORPUS_DEPENDENT_CHECKS.has(n));
    expect(deriveFloorSteps(real)).toEqual(["bun run build", "bun run typecheck", ...expected.map((n) => `bun run ${n}`)]);
  });
});
