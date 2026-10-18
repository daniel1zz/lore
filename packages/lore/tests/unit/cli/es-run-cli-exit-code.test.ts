/**
 * AC-ES-2 — `runCli(invocation)` RETURNS the exit code and never calls `process.exit`
 * (spec-process-state-end-state-one-invocation-per-entry-returned Goal 2 / D2, rule AS-26).
 *
 * Covers: HAPPY (0), ERROR (4 validation refusal), NEGATIVE (2 unknown flag, citty's own strict-flag exit),
 * BOUNDARY (`--help` and an unknown command, the two exits citty's `runMain` used to take itself),
 * STATE (the code of one run does not leak into the next), REGRESSION (a spy on `process.exit` records zero calls).
 *
 * The runs go through `runCli` itself with an Invocation built from a throwaway home (never the developer's),
 * so what is measured is the entry sequence the binary runs, not a copy of it.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../../src/adapters/cli/run-cli";
import { buildTestInvocation } from "../../helpers/test-invocation";

let root: string;
let home: string;
let cwd: string;

/** The environment a run needs: PATH for git, the sandbox marker the corpus guard reads, and the throwaway HOME. */
function runEnv(): Record<string, string> {
  const env: Record<string, string> = { HOME: home, PATH: process.env["PATH"] ?? "" };
  for (const key of ["LORE_TEST_SANDBOX", "LORE_TEST_SANDBOX_REPO"] as const) {
    const armed = process.env[key];
    if (armed !== undefined) env[key] = armed;
  }
  return env;
}

/** One run of `lore <args>`: the returned code plus what was written. */
async function run(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const inv = buildTestInvocation({
    argv: args,
    cwd,
    env: runEnv(),
    home,
    io: { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) } },
  });
  const code = await runCli(inv, { installSyncStdout: false });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-es-exit-code-"));
  home = join(root, "home");
  cwd = join(root, "corpus");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  // reason: a throw (not a no-op) so code after a real `process.exit` cannot run on, exactly as in the binary.
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${String(code)}) was called`);
  }) as typeof process.exit);
});

afterEach(() => {
  exitSpy.mockRestore();
});

describe("AC-ES-2 runCli returns the exit code", () => {
  it("returns 0 for a succeeding command and 4 for a validation refusal, with no process.exit", async () => {
    const init = await run(["init"]);
    expect(init.stderr).not.toContain("Error");
    expect(init.code).toBe(0);

    const list = await run(["list", "--json"]);
    expect(list.code).toBe(0);

    const refused = await run(["create", "not-a-doc-type", "--title", "x"]);
    expect(refused.code).toBe(4);
    expect(refused.stderr.length).toBeGreaterThan(0);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("returns 2 for an unknown flag (citty strict-flag exit) with no process.exit", async () => {
    const result = await run(["list", "--definitely-not-a-flag"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown option: --definitely-not-a-flag");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("returns 0 for --help and 1 for an unknown command, the two exits citty's runMain took itself", async () => {
    const help = await run(["list", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("USAGE");

    const unknown = await run(["no-such-command"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("no-such-command");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not carry one run's code into the next run", async () => {
    expect((await run(["list", "--definitely-not-a-flag"])).code).toBe(2);
    expect((await run(["list", "--json"])).code).toBe(0);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
