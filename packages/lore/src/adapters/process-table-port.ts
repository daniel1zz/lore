/**
 * Real process-table port — the OS facts `lore run register` and `lore run reap` measure
 * (spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-5; ADR D4).
 *
 * Purpose: one leaf-IO seam answering "which processes exist, who is whose parent, when did each start, where is
 * each one's cwd, is this pid still THE process I saw", plus sending a signal. No decision is made here.
 * Public surface: {@link ProcessTablePort}, {@link createRealProcessTablePort}, {@link ProcessEntry},
 *   {@link ProcessSnapshot}, {@link ProcessInspection}, {@link parsePsLine}.
 * Invariants:
 *   - Per OS: the process table comes from `ps -axo pid=,ppid=,stat=,lstart=,command=` (BSD/macOS and Linux procps both
 *     support it, with `LC_ALL=C` fixing the month names); the cwd table from ONE `lsof -n -d cwd -F pn` (macOS, and
 *     Linux with lsof installed), else the `/proc/<pid>/cwd` links. No new native dependency.
 *   - Start time is `lstart` parsed to ISO-8601: SECOND precision, TRUNCATED (a process that started at 12:00:00.9
 *     reads 12:00:00). Equality of two reads of the same pid is the pid-reuse test; comparisons against a ms-precision
 *     instant must floor that instant to the second.
 *   - Unmeasurable is a miss, never "nothing running": a failed `ps` returns `{ok:false}`; a failed cwd listing
 *     returns `{ok:false}`; a process whose cwd is unreadable (other user, exited) simply has no cwd entry.
 *   - `signal` never throws: ESRCH -> `gone`, EPERM -> `denied`.
 * Side-effect class: IO (spawns `ps`/`lsof`, reads `/proc`, sends signals).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readlinkSync } from "node:fs";
import { basename } from "node:path";
import type { Measured } from "../service/worktree-removal-test.js";

/** One row of the process table. `startTime` is null only when the `lstart` text did not parse. */
export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  /** `stat` begins with `Z`: the process is dead and only waits to be reaped by its parent. */
  readonly zombie: boolean;
  readonly startTime: string | null;
  readonly command: string;
}

/** Process table plus the cwd of every process whose cwd could be read. */
export interface ProcessSnapshot {
  readonly entries: readonly ProcessEntry[];
  readonly cwdByPid: ReadonlyMap<number, string>;
}

/** What one pid is right now; `null` from {@link ProcessTablePort.inspect} = no such process. */
export interface ProcessInspection {
  readonly zombie: boolean;
  readonly startTime: string | null;
}

export type SignalOutcome = "sent" | "gone" | "denied";

/** Injectable port; the production implementation is {@link createRealProcessTablePort}. */
export interface ProcessTablePort {
  /** The whole table and cwd map, or why it could not be measured. */
  snapshot(): Promise<Measured<ProcessSnapshot>>;
  /** Current state of ONE pid, read fresh (the kill-time re-read); `null` when the pid does not exist. */
  inspect(pid: number): Promise<ProcessInspection | null>;
  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): Promise<SignalOutcome>;
  sleep(milliseconds: number): Promise<void>;
  /**
   * The pid of the harness process a hook was spawned by: `pid` itself, or its parent when `pid` is a plain shell
   * wrapper (`sh -c "node hook.mjs"`). `null` when nothing sensible can be named (pid <= 1, process gone).
   */
  resolveHarnessPid(pid: number): Promise<number | null>;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const SHELL_WRAPPERS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ash"]);
const MAX_SHELL_HOPS = 3;

/** `lstart` text -> ISO-8601 (second precision), or null when it does not parse. */
export function parseLstart(text: string): string | null {
  const parsed = new Date(text.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Parses one `ps -axo pid=,ppid=,stat=,lstart=,command=` line; null for a line that is not a process row. */
export function parsePsLine(line: string): ProcessEntry | null {
  const match = PS_LINE.exec(line);
  if (match === null) return null;
  return {
    pid: Number.parseInt(match[1] as string, 10),
    ppid: Number.parseInt(match[2] as string, 10),
    zombie: (match[3] as string).startsWith("Z"),
    startTime: parseLstart(match[4] as string),
    command: match[5] as string,
  };
}

function psEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LC_ALL: "C" };
}

/** pid -> cwd for every readable process: `lsof -d cwd`, else `/proc`. */
function readCwdTable(procDir: string): Measured<Map<number, string>> {
  const table = new Map<number, string>();
  const lsof = spawnSync("lsof", ["-n", "-d", "cwd", "-F", "pn"], { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES });
  if (lsof.error === undefined) {
    const out = lsof.stdout ?? "";
    // reason: a non-zero lsof exit WITH a listing is the normal "some processes were not inspectable" case; only a
    // failure that produced no listing is unmeasurable (same rule as real-process-scan-port.ts).
    if (lsof.status !== 0 && !/^p\d+$/m.test(out)) {
      return { ok: false, reason: `lsof exited ${String(lsof.status ?? "abnormally")}` };
    }
    let pid: number | null = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) pid = Number.parseInt(line.slice(1), 10);
      else if (line.startsWith("n") && pid !== null && Number.isInteger(pid)) table.set(pid, line.slice(1));
    }
    return { ok: true, value: table };
  }
  if ((lsof.error as NodeJS.ErrnoException).code !== "ENOENT") {
    return { ok: false, reason: `lsof could not run (${(lsof.error as NodeJS.ErrnoException).code ?? lsof.error.message})` };
  }
  let names: string[];
  try {
    names = readdirSync(procDir).filter((name) => /^\d+$/.test(name));
  } catch {
    return { ok: false, reason: `lsof is not installed and ${procDir} is not readable` };
  }
  for (const name of names) {
    try {
      table.set(Number.parseInt(name, 10), readlinkSync(`${procDir}/${name}/cwd`));
    } catch {
      // reason: an exited or foreign-user process has no readable cwd link — absent, never guessed.
    }
  }
  return { ok: true, value: table };
}

export interface RealProcessTableOptions {
  /** Directory of `<pid>/cwd` links used only when `lsof` is not installed. */
  readonly procDir?: string;
}

/** The production {@link ProcessTablePort}. */
export function createRealProcessTablePort(options: RealProcessTableOptions = {}): ProcessTablePort {
  const procDir = options.procDir ?? "/proc";

  const inspect = async (pid: number): Promise<ProcessInspection | null> => {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const run = spawnSync("ps", ["-o", "stat=,lstart=", "-p", String(pid)], { encoding: "utf8", env: psEnv() });
    if (run.error !== undefined || run.status !== 0) return null;
    const text = (run.stdout ?? "").trim();
    const match = /^(\S+)\s+(.*)$/.exec(text);
    if (match === null) return null;
    return { zombie: (match[1] as string).startsWith("Z"), startTime: parseLstart(match[2] as string) };
  };

  return {
    async snapshot() {
      const ps = spawnSync("ps", ["-axo", "pid=,ppid=,stat=,lstart=,command="], {
        encoding: "utf8",
        env: psEnv(),
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      if (ps.error !== undefined) return { ok: false, reason: `ps could not run (${ps.error.message})` };
      if (ps.status !== 0) return { ok: false, reason: `ps exited ${String(ps.status ?? "abnormally")}` };
      const entries: ProcessEntry[] = [];
      for (const line of (ps.stdout ?? "").split("\n")) {
        const entry = parsePsLine(line);
        if (entry !== null) entries.push(entry);
      }
      if (entries.length === 0) return { ok: false, reason: "ps listed no processes" };
      const cwds = readCwdTable(procDir);
      if (!cwds.ok) return cwds;
      return { ok: true, value: { entries, cwdByPid: cwds.value } };
    },
    inspect,
    async signal(pid, signal) {
      try {
        process.kill(pid, signal);
        return "sent";
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code === "ESRCH") return "gone";
        if (code === "EPERM") return "denied";
        throw cause;
      }
    },
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    async resolveHarnessPid(pid) {
      let current = pid;
      for (let hop = 0; hop <= MAX_SHELL_HOPS; hop++) {
        if (!Number.isInteger(current) || current <= 1) return null;
        const run = spawnSync("ps", ["-o", "ppid=,comm=", "-p", String(current)], { encoding: "utf8", env: psEnv() });
        if (run.error !== undefined || run.status !== 0) return null;
        const match = /^\s*(\d+)\s+(.*)$/.exec((run.stdout ?? "").trim());
        if (match === null) return null;
        const command = basename((match[2] as string).replace(/^-/, ""));
        if (!SHELL_WRAPPERS.has(command)) return current;
        current = Number.parseInt(match[1] as string, 10);
      }
      return null;
    },
  };
}
