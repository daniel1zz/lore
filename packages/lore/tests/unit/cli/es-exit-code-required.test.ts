// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * ES-E: a command's exit code is a required number; a dropped code is a compile error
 * (spec-process-state-end-state-one-invocation-per-entry-returned Goal 1 / D2, rule AS-26).
 *
 * Covers: NEGATIVE (a handler that omits its return, falls off one path, or returns nothing fails to compile and the
 * error names the fixture file), HAPPY (a handler that returns its code compiles clean; `runCli` still returns 0),
 * ERROR (`runCli` returns 4 for a validation refusal), BOUNDARY (`runCli` returns 2 for an unknown flag),
 * REGRESSION (a spy on `process.exit` records zero calls).
 *
 * The compile probes use the project's own tsconfig options (`packages/lore/tsconfig.json`) over fixtures written to a
 * throwaway directory under `.scratch/` (the repo's probe namespace, outside every typechecked glob).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import ts from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { runCli } from "../../../src/adapters/cli/run-cli";
import { buildTestInvocation } from "../../helpers/test-invocation";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");
const CLI_EXIT = join(REPO_ROOT, "packages/lore/src/adapters/cli/cli-exit");

let probeDir: string;

beforeAll(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  probeDir = mkdtempSync(join(REPO_ROOT, ".scratch", "es-exit-probe-"));
});

afterAll(() => {
  rmSync(probeDir, { recursive: true, force: true });
});

/** Compile `source` as `<name>.ts` with the lore project's compiler options; return the diagnostics that name that file. */
function compileFixture(name: string, source: string): readonly ts.Diagnostic[] {
  const file = join(probeDir, `${name}.ts`);
  writeFileSync(file, source);
  const config = ts.readConfigFile(join(REPO_ROOT, "packages/lore/tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, join(REPO_ROOT, "packages/lore"));
  const program = ts.createProgram([file], parsed.options);
  return ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.file?.fileName === file);
}

/** A command module whose `run` body is `body`. */
function handlerFixture(body: string): string {
  return [
    `import { defineLoreCommand } from "${CLI_EXIT}";`,
    "export default defineLoreCommand({",
    '  meta: { name: "probe" },',
    "  async run() {",
    body,
    "  },",
    "});",
    "",
  ].join("\n");
}

const REQUIRED_NUMBER_ERRORS = new Set([2322, 2345, 2366, 2769, 7030]);

describe("ES-E a dropped exit code fails to compile", () => {
  it("a handler that returns nothing is rejected, naming the handler file", () => {
    const diagnostics = compileFixture("returns-nothing", handlerFixture("    await Promise.resolve();"));
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) expect(diagnostic.file?.fileName).toContain("returns-nothing.ts");
    expect(diagnostics.some((diagnostic) => REQUIRED_NUMBER_ERRORS.has(diagnostic.code))).toBe(true);
  });

  it("a handler that returns a code on one path and falls off the end on another is rejected", () => {
    const diagnostics = compileFixture(
      "falls-off-one-path",
      handlerFixture("    if (Math.random() > 2) return 4;\n    await Promise.resolve();"),
    );
    expect(diagnostics.some((diagnostic) => REQUIRED_NUMBER_ERRORS.has(diagnostic.code))).toBe(true);
  });

  it("a handler that calls a code-returning helper without returning it is rejected", () => {
    const diagnostics = compileFixture(
      "drops-helper-code",
      [
        `import { defineLoreCommand } from "${CLI_EXIT}";`,
        "function finish(): number { return 4; }",
        "export default defineLoreCommand({",
        '  meta: { name: "probe" },',
        "  async run() {",
        "    finish();",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    expect(diagnostics.some((diagnostic) => REQUIRED_NUMBER_ERRORS.has(diagnostic.code))).toBe(true);
  });

  it("an undefined exit code is not an ExitReport", () => {
    const diagnostics = compileFixture(
      "undefined-report",
      [`import type { ExitReport } from "${CLI_EXIT}";`, "export const report: ExitReport = undefined;", ""].join("\n"),
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 2322)).toBe(true);
  });

  it("a handler that returns its code compiles clean (the control: the probe can tell the two apart)", () => {
    expect(compileFixture("returns-zero", handlerFixture("    return 0;"))).toEqual([]);
    expect(compileFixture("returns-failure", handlerFixture("    if (Math.random() > 2) return 4;\n    return 0;"))).toEqual([]);
  });
});

// ─── runCli still returns the codes ─────────────────────────────────────────

let root: string;
let home: string;
let cwd: string;
let exitSpy: MockInstance<typeof process.exit>;

/** The environment a run needs: PATH for git, the sandbox marker the corpus guard reads, and the throwaway HOME. */
function runEnv(): Record<string, string> {
  const env: Record<string, string> = { EDITOR: "true", HOME: home, PATH: process.env["PATH"] ?? "" };
  for (const key of ["LORE_TEST_SANDBOX", "LORE_TEST_SANDBOX_REPO"] as const) {
    const armed = process.env[key];
    if (armed !== undefined) env[key] = armed;
  }
  return env;
}

async function run(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const inv = buildTestInvocation({
    argv: args,
    cwd,
    env: runEnv(),
    home,
    io: { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) }, stdin: Readable.from([]), stdinIsTTY: false },
  });
  const code = await runCli(inv);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

describe("ES-E runCli returns the codes the typed handlers return", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "lore-es-exit-required-"));
    home = join(root, "home");
    cwd = join(root, "corpus");
    mkdirSync(home, { recursive: true });
    mkdirSync(cwd, { recursive: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)}) was called`);
    }) as typeof process.exit);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("returns 0 for a succeeding command, 4 for a validation refusal and 2 for an unknown flag", async () => {
    expect((await run(["init"])).code).toBe(0);
    expect((await run(["list", "--json"])).code).toBe(0);
    expect((await run(["create", "plan", "--title", "Plan one", "--no-ai"])).code).toBe(0);
    // `done` of a plan is a validation refusal ("Expected a task document"), not a usage error
    expect((await run(["done", "plan-one"])).code).toBe(4);
    expect((await run(["list", "--definitely-not-a-flag"])).code).toBe(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
