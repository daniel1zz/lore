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
import { FLOOR_TAIL_CHARS } from "../../packages/lore/src/service/integrate-service";
import { boundFailureOutput, DEFAULT_STEPS, deriveFloorSteps, derivePlanCloseSteps, deriveStaticSteps, FAILURE_BLOCK_MAX_CHARS, main, renderFailureBlocks, renderTable, runChain, runStaticFloor } from "../run-chain";

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
    // DCL-4: the hook's generated shell-cwd copy must be drift-checked by the chain, not only by a test
    expect(DEFAULT_STEPS).toContain("bun run check:hook-shell-cwd");
    expect(derivePlanCloseSteps(pkg.scripts)).toContain("bun run check:hook-shell-cwd");
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
    for (const name of Object.keys(real).filter((n) => n.startsWith("check:") && n !== "check:static" && n !== "check:floor" && n !== "check:plan-close")) expect(steps).toContain(`bun run ${name}`);
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

describe("check:floor (deriveFloorSteps) is the lean floor (BR-1368)", () => {
  const fixture = { build: "b", typecheck: "t", "check:baseline-coverage:changed": "x", "check:ac-oracle-ownership:changed": "y", "check:test-spawns:changed": "z", "check:a": "a", "check:static": "bun scripts/run-chain.ts --static", "check:floor": "bun scripts/run-chain.ts --floor" };

  it("is install, build, typecheck and the two :changed checks whatever other check:* scripts exist", () => {
    expect(deriveFloorSteps(fixture)).toEqual(["bun install --frozen-lockfile", "bun run build", "bun run typecheck", "bun run check:baseline-coverage:changed", "bun run check:ac-oracle-ownership:changed", "bun run check:test-spawns:changed"]);
    expect(deriveFloorSteps({ ...fixture, "check:brand-new": "n" })).toEqual(deriveFloorSteps(fixture));
  });

  it("fails loud without build or typecheck", () => {
    expect(() => deriveFloorSteps({ typecheck: "y", "check:a": "a" })).toThrow(/"build"/);
  });

  it("the real package.json declares check:floor and check:plan-close; check:static still covers every check", () => {
    const real = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(real["check:floor"]).toBe("bun scripts/run-chain.ts --floor");
    expect(real["check:plan-close"]).toBe("bun scripts/run-chain.ts --plan-close");
    expect(deriveStaticSteps(real).steps).not.toContain("bun run check:plan-close");
  });
});

describe("machine-readable per-step timings (LORE_FLOOR_TIMINGS_FILE)", () => {
  it("REAL SPAWN: with the env set, run-chain writes {schema_version:1, steps:[{step, exit, seconds}]} in step order, failures included", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-chain-timings-"));
    try {
      const file = join(dir, "timings.json");
      const r = spawnSync("bun", ["scripts/run-chain.ts", "exit 0", "exit 3"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, LORE_FLOOR_TIMINGS_FILE: file } });
      expect(r.status).toBe(1);
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { schema_version: number; steps: { step: string; exit: number; seconds: number }[] };
      expect(parsed.schema_version).toBe(1);
      expect(parsed.steps.map((s) => [s.step, s.exit])).toEqual([["exit 0", 0], ["exit 3", 3]]);
      for (const s of parsed.steps) expect(typeof s.seconds).toBe("number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REAL SPAWN: with the env empty the table is unchanged and nothing is written", () => {
    const r = spawnSync("bun", ["scripts/run-chain.ts", "exit 0"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, LORE_FLOOR_TIMINGS_FILE: "" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("all 1 steps passed");
  });
});

describe("integrate floor failure shows the failing step's own output (task-integrate-floor-failure-shows-the-failing-step-s-own)", () => {
  const stepLines = (n: number) => `i=1; while [ $i -le ${n} ]; do echo "S2-FAIL-LINE-$i"; i=$((i+1)); done; exit 1`;
  const bigStep = (tag: string) => `head -c 10000 /dev/zero | tr '\\0' x; echo; echo ${tag}`;

  it("REAL SPAWN: step 2 of 4 fails with 200 lines, steps 3-4 print 10 KB each -> the last 4000 chars carry step 2's last failure lines and an omitted-lines marker", () => {
    const r = spawnSync("bun", ["scripts/run-chain.ts", "echo one", stepLines(200), bigStep("STEP3-DONE"), bigStep("STEP4-DONE")], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(1);
    const tail = r.stdout.slice(-4000);
    expect(tail).toContain("=== run-chain: FAILED step output (exit 1): i=1; while");
    expect(tail).toContain("S2-FAIL-LINE-200");
    expect(tail).toContain("S2-FAIL-LINE-161");
    expect(tail).not.toContain("S2-FAIL-LINE-160\n");
    expect(tail).toContain("... 160 lines omitted");
  });

  it("boundFailureOutput: short output is kept whole with no marker; a long single line is cut with an explicit chars marker", () => {
    expect(boundFailureOutput("a\nb\n")).toBe("a\nb");
    const cut = boundFailureOutput("y".repeat(3000));
    expect(cut.startsWith("... 500 chars omitted from the first kept line\n")).toBe(true);
    expect(cut.length).toBe("... 500 chars omitted from the first kept line\n".length + FAILURE_BLOCK_MAX_CHARS);
  });

  it("renderFailureBlocks: passing steps and steps without captured output print nothing", () => {
    expect(renderFailureBlocks([{ step: "ok", exit: 0, seconds: 0, output: "fine" }, { step: "bare", exit: 2, seconds: 0 }])).toBe("");
  });

  it("integrate's stored tail is sized to hold four failed steps' blocks", () => {
    expect(FLOOR_TAIL_CHARS).toBeGreaterThanOrEqual(4 * (FAILURE_BLOCK_MAX_CHARS + 200));
  });
});
