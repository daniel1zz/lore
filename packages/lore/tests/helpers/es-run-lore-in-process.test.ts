/**
 * AC-ES-1 — two `runLoreInProcess` calls run AT THE SAME TIME, each in its own throwaway home, and neither sees
 * nor changes the other or the test process (spec-process-state-end-state-one-invocation-per-entry-returned
 * Goal 2 / D4, rules AS-26 and AS-27).
 *
 * How overlap is proven: the command of each run waits on one shared latch until BOTH have entered `runCli`.
 * A runner that still queues runs (one starts when the previous settled) never lets the second run enter, so the
 * first waits for a peer that cannot start and the latch times out; the test fails by that timeout.
 *
 * Covers: HAPPY (both runs complete with their own output), STATE (each home holds exactly its own run's files, so
 * the other home is untouched; `process.env` and `process.cwd()` equal what they were, DURING the overlap and
 * after), NEGATIVE (a run sees only its own env and its own home), BOUNDARY (the two runs' stdout and stderr never
 * mix although both write between the same two awaits), REGRESSION (a missing `home` is refused, never defaulted).
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandDef } from "citty";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLoreInProcess } from "./run-lore-in-process";

/** A barrier for `parties` runs; `arrive` resolves once all have arrived and rejects after `timeoutMs`. */
function makeLatch(parties: number, timeoutMs: number) {
  let arrived = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    get arrived(): number {
      return arrived;
    },
    async arrive(label: string): Promise<void> {
      arrived += 1;
      if (arrived === parties) open();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`latch timeout: run ${label} waited for ${String(parties)} runs, ${String(arrived)} entered`)),
          timeoutMs,
        );
      });
      try {
        await Promise.race([gate, timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

/** Every file under `dir` as `relative path -> bytes`, so "byte-identical" is a plain equality. */
function snapshot(dir: string, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, snapshot(join(dir, entry.name), relative));
    else result[relative] = readFileSync(join(dir, entry.name), "utf8");
  }
  return result;
}

let root: string;
const homes = { A: "", B: "" };
const cwds = { A: "", B: "" };
const duringOverlap: Record<string, { envSame: boolean; cwdSame: boolean; envHome: string | undefined; ownHome: string }> = {};
const startEnv = JSON.stringify(process.env);
const startCwd = process.cwd();

/** The files a run labelled `label` leaves in its own home, derived from the label alone. */
function expectedHome(label: string): Record<string, string> {
  return { "entered.txt": `entered ${label}`, "finished.txt": `finished ${label}` };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-es-concurrent-"));
  for (const label of ["A", "B"] as const) {
    homes[label] = join(root, `home-${label}`);
    cwds[label] = join(root, `cwd-${label}`);
    mkdirSync(homes[label], { recursive: true });
    mkdirSync(cwds[label], { recursive: true });
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AC-ES-1 concurrent in-process runs are isolated", () => {
  it("overlaps two runs, keeps each in its own home, and leaves process.env and process.cwd() alone", async () => {
    const latch = makeLatch(2, 8_000);

    /** Replace `list` with a command that proves overlap, writes under ITS home, and prints. */
    const transformCommand = (name: string, command: CommandDef<any>): CommandDef<any> => {
      if (name !== "list") return command;
      return {
        ...command,
        run: async (context: { inv: { cwd: string; paths: { home: string }; env: Record<string, string | undefined> } }) => {
          const { inv } = context;
          const label = inv.env["ES_RUN_LABEL"] ?? "?";
          writeFileSync(join(inv.paths.home, "entered.txt"), `entered ${label}`);
          await latch.arrive(label);
          // both runs are inside runCli here: whatever the runner changed for ONE run is visible NOW
          duringOverlap[label] = {
            envSame: JSON.stringify(process.env) === startEnv,
            cwdSame: process.cwd() === startCwd,
            envHome: process.env["HOME"],
            ownHome: inv.paths.home,
          };
          console.log(`stdout-console ${label}`);
          process.stdout.write(`stdout-write ${label}\n`);
          console.error(`stderr-console ${label}`);
          writeFileSync(join(inv.paths.home, "finished.txt"), `finished ${label}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          console.log(`stdout-after-wait ${label}`);
        },
      } as CommandDef<any>;
    };

    const sandbox: Record<string, string> = {};
    for (const key of ["LORE_TEST_SANDBOX", "LORE_TEST_SANDBOX_REPO"] as const) {
      const armed = process.env[key];
      if (armed !== undefined) sandbox[key] = armed;
    }
    const start = (label: "A" | "B") =>
      runLoreInProcess(["list"], {
        cwd: cwds[label],
        home: homes[label],
        env: { ...sandbox, PATH: process.env["PATH"] ?? "", HOME: homes[label], ES_RUN_LABEL: label },
        transformCommand,
      });

    const [a, b] = await Promise.all([start("A"), start("B")]);

    expect(latch.arrived).toBe(2);
    for (const [label, result] of [["A", a], ["B", b]] as const) {
      const other = label === "A" ? "B" : "A";
      expect(result.stderr).toBe(`stderr-console ${label}\n`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`stdout-console ${label}\nstdout-write ${label}\nstdout-after-wait ${label}\n`);
      expect(result.stdout).not.toContain(other);
      expect(duringOverlap[label]).toEqual({ envSame: true, cwdSame: true, envHome: process.env["HOME"], ownHome: homes[label] });
      // each home holds exactly what its own run wrote: the other run changed nothing there
      expect(snapshot(homes[label])).toEqual(expectedHome(label));
    }
    expect(JSON.stringify(process.env)).toBe(startEnv);
    expect(process.cwd()).toBe(startCwd);
  });

  it("refuses a call without a home instead of defaulting to the process home", async () => {
    const call = runLoreInProcess(["list"], { cwd: cwds.A, env: { PATH: process.env["PATH"] ?? "" } } as never);
    await expect(call).rejects.toThrow(/home/);
  });
});
