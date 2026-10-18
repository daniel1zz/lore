/**
 * Real human-channel ports — the production wiring of `HumanChannelPorts` (service/human-channel.ts).
 *
 * Purpose: read the REAL stdin/stdout TTY state, environment, argv, OS process table and controlling terminal
 * (/dev/tty) for `lore decide`.
 * Public surface: createProductionHumanChannelPorts, readLiveProcessTable, openControllingTerminal.
 * Invariants:
 *   - The product path takes NO switch that redirects the ancestry or environment check: the only way to change a
 *     port is the `overrides` argument, which exists for in-process callers (the test driver) and is never fed
 *     from argv, env or a file by this module.
 *   - The terminal is /dev/tty (the controlling terminal), not stdin/stdout: the nonce is written and read there
 *     even if the process's own stdout is redirected (a redirected stdout is refused earlier by `tty-required`).
 *   - An unreadable process table is an `err`, never an empty table.
 * Side-effect class: IO (spawns `ps`, opens /dev/tty, reads process state).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3.
 */
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync, writeSync } from "node:fs";
import { isatty } from "node:tty";
import type { Invocation } from "@lore/core";
import { generateNonce, type HumanChannelOutcome, type HumanChannelPorts, type HumanTerminal, type ProcessEntry } from "../service/human-channel.js";

const MAX_PS_BYTES = 64 * 1024 * 1024;
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(.*)$/;
const EAGAIN_RETRY_MS = 20;

/** The whole OS process table via `ps -axo pid=,ppid=,command=`. */
export function readLiveProcessTable(cwd: string): HumanChannelOutcome<readonly ProcessEntry[], string> {
  const run = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { cwd, encoding: "utf8", maxBuffer: MAX_PS_BYTES });
  if (run.error !== undefined || run.status !== 0) {
    return { ok: false, error: `ps failed: ${run.error?.message ?? `exit ${String(run.status)}`}` };
  }
  const entries: ProcessEntry[] = [];
  for (const line of run.stdout.split("\n")) {
    const match = PS_LINE.exec(line);
    if (match !== null) entries.push({ pid: Number(match[1]), ppid: Number(match[2]), command: (match[3] ?? "").trim() });
  }
  if (entries.length === 0) return { ok: false, error: "ps returned no processes" };
  return { ok: true, value: entries };
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Opens /dev/tty read-write, or null when this process has no controlling terminal. */
export function openControllingTerminal(): HumanTerminal | null {
  let fd: number;
  try {
    fd = openSync("/dev/tty", "r+");
  } catch {
    return null; // no controlling terminal: the caller turns this into the `tty-required` refusal
  }
  return {
    write(text: string): void {
      writeSync(fd, text);
    },
    readLine(): string {
      const bytes: number[] = [];
      const one = Buffer.alloc(1);
      for (;;) {
        let count: number;
        try {
          count = readSync(fd, one, 0, 1, null);
        } catch (cause) {
          // reason: a tty fd can report EAGAIN when the runtime sets it non-blocking; waiting and retrying is the
          // correct read, anything else is a real failure and propagates.
          if ((cause as NodeJS.ErrnoException).code === "EAGAIN") {
            sleepMs(EAGAIN_RETRY_MS);
            continue;
          }
          throw cause;
        }
        if (count === 0) break; // EOF
        const byte = one[0] as number;
        if (byte === 10 || byte === 13) break;
        bytes.push(byte);
      }
      return Buffer.from(bytes).toString("utf8");
    },
    close(): void {
      closeSync(fd);
    },
  };
}

/**
 * Production ports. `overrides` replaces individual ports for in-process callers only.
 *
 * @param inv - the run's Invocation: the environment, argv and harness-run identity the channel check reads (AS-26)
 * @param overrides - ports to replace (in-process callers only)
 */
export function createProductionHumanChannelPorts(inv: Invocation, overrides: Partial<HumanChannelPorts> = {}): HumanChannelPorts {
  return {
    stdinIsTty: () => isatty(0),
    stdoutIsTty: () => isatty(1),
    env: () => inv.env,
    argv: () => {
      // reason: the entry strips `--harness-run <id>` from argv and keeps it in the invocation identity;
      // an agent run identity must still be visible to the channel check, so it is re-surfaced here.
      const args = inv.argv;
      // reason: the UNVERIFIED id is deliberate here; surfacing an unregistered run makes the channel refuse, the safe direction (BR-1035).
      const harnessRun = inv.identity.harnessRun;
      return harnessRun != null ? [...args, "--harness-run", String(harnessRun)] : args;
    },
    selfPid: () => process.pid,
    readProcessTable: () => readLiveProcessTable(inv.cwd),
    newNonce: generateNonce,
    openTerminal: openControllingTerminal,
    ...overrides,
  };
}
