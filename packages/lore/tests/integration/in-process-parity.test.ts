// @spawns dist/lore
// @reads .lore/lore.db
// @layer integration-helper-parity AC-TG-11 (in-process helper vs dist/lore parity; owner is the full-run wall-time script)
/**
 * Parity of the in-process command helper with the compiled binary (task tg-25,
 * adr-tg-1-test-runner-decision-measured-comparison-of-bun-only option b).
 *
 * The same command sequence runs twice, each time in its own throwaway corpus (mkdtemp + `lore init`,
 * never this repository's `.lore/`): once through `dist/lore` (Bun.spawnSync) and once through
 * `runLoreInProcess`. Exit code and stdout/stderr must match after the values that legitimately differ
 * between two corpora (ULIDs, timestamps, the temp directory) are normalised.
 *
 * Coverage:
 *   HAPPY:      init / create / get / list / tree / status produce the same exit code and text both ways
 *   NEGATIVE:   missing slug (3), unknown flag (2), invalid create type (usage) match both ways
 *   BOUNDARY:   `--version` (a run that never calls process.exit) and `--help` (runMain's exit 0)
 *   STATE:      a write made in-process is read back by the BINARY from the same corpus (same store, same file)
 *   REGRESSION: the sandbox refuses this repository's own corpus in-process, exactly as for the binary
 *   ISOLATION:  runs started together (Promise.all) in different cwds never see each other's cwd, env or output,
 *               and the test process's own cwd/env/argv/exit are restored afterwards
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSessionIdentity } from "../helpers/session-actor";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// tests/integration/ -> tests/ -> packages/lore/ -> packages/ -> repo root.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

type Runner = (args: readonly string[], cwd: string) => Promise<RunResult>;

function envFor(cwd: string): Record<string, string> {
  return withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true" }, "parity") as Record<string, string>;
}

const runBinary: Runner = async (args, cwd) => {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd, env: envFor(cwd) });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
};

const runInProcess: Runner = (args, cwd) => runLoreInProcess(args, { cwd, home: cwd, env: envFor(cwd) });

/** Replace what differs between two corpora by construction: ids, times, the directory. */
function normalise(text: string, dir: string): string {
  return text
    .split(dir)
    .join("<DIR>")
    .split(dir.slice(dir.lastIndexOf("/") + 1))
    .join("<BASE>")
    .replace(/[0-9A-HJKMNP-TV-Z]{26}/g, "<ULID>")
    .replace(/[0-9A-HJKMNP-TV-Z]{8}…[0-9A-HJKMNP-TV-Z]{5}/g, "<ULID8>")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<TS>")
    .replace(/\b\d+ (?:seconds?|minutes?) ago\b|\bjust now\b/g, "<AGO>");
}

/** The sequence both runners execute; each entry is one argv. */
const SEQUENCE: readonly (readonly string[])[] = [
  ["init"],
  ["create", "plan", "--title", "Parity plan", "--content", "Plan body.", "--no-ai"],
  ["list", "--json"],
  ["get", "plan-parity-plan"],
  ["tree", "plan-parity-plan"],
  ["get", "no-such-slug-anywhere"],
  ["list", "--no-such-flag"],
  ["create", "no-such-type", "--title", "x", "--content", "y", "--no-ai"],
  ["--version"],
  ["--help"],
  ["list", "--help"],
];

async function runSequence(runner: Runner, dir: string): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const args of SEQUENCE) results.push(await runner(args, dir));
  return results;
}

let dirs: string[] = [];

function freshDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-parity-")));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("AC-TG-11 in-process helper parity with dist/lore", () => {
  it("AC-TG-11 runs the same command sequence with the same exit code and normalised output both ways", async () => {
    const binaryDir = freshDir();
    const inProcessDir = freshDir();
    const viaBinary = await runSequence(runBinary, binaryDir);
    const viaHelper = await runSequence(runInProcess, inProcessDir);

    expect(viaHelper.length).toBe(SEQUENCE.length);
    SEQUENCE.forEach((args, index) => {
      const label = `lore ${args.join(" ")}`;
      const binary = viaBinary[index]!;
      const helper = viaHelper[index]!;
      expect({ label, exitCode: helper.exitCode }).toEqual({ label, exitCode: binary.exitCode });
      expect({ label, stdout: normalise(helper.stdout, inProcessDir) }).toEqual({
        label,
        stdout: normalise(binary.stdout, binaryDir),
      });
      expect({ label, stderr: normalise(helper.stderr, inProcessDir) }).toEqual({
        label,
        stderr: normalise(binary.stderr, binaryDir),
      });
    });
    // The reads of the document the sequence just created must succeed, or the comparison above proves nothing about them.
    const getIndex = SEQUENCE.findIndex((args) => args[0] === "get" && args[1] === "plan-parity-plan");
    expect(viaHelper[getIndex]!.exitCode).toBe(0);
    expect(viaHelper[getIndex]!.stdout).toContain("Parity plan");
    // The sample must actually exercise the mapped codes, not collapse to all zeros.
    const codes = new Set(viaHelper.map((r) => r.exitCode));
    expect(codes.has(0)).toBe(true);
    expect(codes.has(3)).toBe(true);
    expect(codes.has(2)).toBe(true);
  });

  it("AC-TG-11 a corpus written in-process is read back by the binary", async () => {
    const dir = freshDir();
    expect((await runInProcess(["init"], dir)).exitCode).toBe(0);
    expect(
      (await runInProcess(["create", "plan", "--title", "Written in process", "--content", "Body.", "--no-ai"], dir))
        .exitCode,
    ).toBe(0);
    const read = await runBinary(["get", "plan-written-in-process", "--json"], dir);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toContain("Written in process");
  });

  it("AC-TG-11 refuses this repository's own corpus in-process (sandbox guard), as the binary does", async () => {
    const viaBinary = await runBinary(["list", "--json"], REPO_ROOT);
    const viaHelper = await runInProcess(["list", "--json"], REPO_ROOT);
    expect(viaBinary.exitCode).not.toBe(0);
    expect(viaHelper.exitCode).toBe(viaBinary.exitCode);
    expect(viaHelper.stderr).toBe(viaBinary.stderr);
  });

  it("AC-TG-11 refuses to run when the sandbox marker is not armed in the test process", async () => {
    const armed = process.env.LORE_TEST_SANDBOX;
    delete process.env.LORE_TEST_SANDBOX;
    try {
      await expect(runLoreInProcess(["list"], { cwd: freshDir(), home: freshDir() })).rejects.toThrow(/LORE_TEST_SANDBOX is not armed/);
    } finally {
      process.env.LORE_TEST_SANDBOX = armed;
    }
  });

  it("AC-TG-11 runs started together never see each other's cwd, env or output, and the test process is restored", async () => {
    const before = { cwd: process.cwd(), argv: [...process.argv], exit: process.exit, home: process.env.HOME };
    const a = freshDir();
    const b = freshDir();
    for (const dir of [a, b]) expect((await runInProcess(["init"], dir)).exitCode).toBe(0);
    await runInProcess(["create", "plan", "--title", "Only in A", "--content", "A.", "--no-ai"], a);

    const [inA, inB] = await Promise.all([
      runInProcess(["list", "--json"], a),
      runInProcess(["list", "--json"], b),
    ]);
    expect(inA.stdout).toContain("plan-only-in-a");
    expect(inB.stdout).not.toContain("plan-only-in-a");

    expect(process.cwd()).toBe(before.cwd);
    expect(process.argv).toEqual(before.argv);
    expect(process.exit).toBe(before.exit);
    expect(process.env.HOME).toBe(before.home);
  });
});
