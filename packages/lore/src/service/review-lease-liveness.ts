/**
 * Review-lease holder liveness (BR-1514): who a lease holder is, and whether that process is provably gone.
 *
 * Purpose: let a review lease whose holder is a dead process of THIS machine be taken over at once instead of at expiry.
 * Public surface: {@link formatHolder}, {@link parseHolder}, {@link LocalProcessIdentity}, {@link ProcessProbe},
 *   {@link LeaseLiveness}, {@link isHolderProvablyDead}, {@link resolveLocalIdentity}, {@link probeLocalProcess},
 *   {@link defaultLeaseLiveness}.
 * Invariants:
 *   - Holder name form: `<base>@<machineId>:<pid>:<startIso>#<suffix>`. A name that does not parse is the OLD form
 *     (`<base>#<suffix>`) and is never dead before expiry.
 *   - Machine id = sha256(random id stored under the lore home + this boot's identity), 16 hex chars. The stored id
 *     separates machines that share nothing; the boot identity separates pid namespaces that share a lore home (two
 *     containers, or this host before and after a reboot, where a pid means a different process).
 *     When the boot identity or the stored id cannot be read or written, the process has NO identity: its own holder
 *     names are old form and it never takes a lease over (a safe degradation: others treat it as live until expiry).
 *   - Dead means exactly: same machine id AND (no process with that pid, OR a live process whose start time differs).
 *     A probe error, an alive-but-unreadable start time, or any other machine id is live.
 * Side-effect class: IO in {@link resolveLocalIdentity} (file, sysctl, ps) and {@link probeLocalProcess} (kill 0, ps).
 */

import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { probeProcessStartTime } from "../adapters/process-probe-port.js";

/** Who this process is: the machine (per boot), its pid and its OS start time (second precision). */
export interface LocalProcessIdentity {
  readonly machineId: string;
  readonly pid: number;
  readonly startIso: string;
}

/** A parsed new-form holder name. */
export interface ParsedHolder extends LocalProcessIdentity {
  readonly base: string;
  readonly suffix: string;
}

/** What a process probe answers: absent (`alive: false`), or present with its start time (`null` when unreadable). */
export interface ProcessObservation {
  readonly alive: boolean;
  readonly startTime: string | null;
}

/** Probes one pid of this machine. An `err` means "could not tell". */
export type ProcessProbe = (pid: number) => Promise<Result<ProcessObservation, LoreError>>;

/** The injectable liveness ports of a {@link ReviewLeases}: this process's identity (or none) and the probe. */
export interface LeaseLiveness {
  readonly identity: () => Promise<LocalProcessIdentity | null>;
  readonly probe: ProcessProbe;
}

const HOLDER_PATTERN = /^(.*)@([^:@#]+):(\d+):([^#]+)#([^#]+)$/;

/** Builds a holder name; a `null` identity yields the old form `<base>#<suffix>`. */
export function formatHolder(base: string, identity: LocalProcessIdentity | null, suffix: string): string {
  if (identity === null) return `${base}#${suffix}`;
  return `${base}@${identity.machineId}:${String(identity.pid)}:${identity.startIso}#${suffix}`;
}

/** Parses a new-form holder name; `null` for the old form. */
export function parseHolder(name: string): ParsedHolder | null {
  const match = HOLDER_PATTERN.exec(name);
  if (match === null) return null;
  const [, base, machineId, pid, startIso, suffix] = match;
  if (base === undefined || machineId === undefined || pid === undefined || startIso === undefined || suffix === undefined) return null;
  return { base, machineId, pid: Number(pid), startIso, suffix };
}

/**
 * True only when `holder` provably ran on `local`'s machine and that process is gone (BR-1514).
 *
 * @param holder - the stored holder name of a live-looking lease
 * @param local - this process's identity; `null` means this process cannot tell, so nothing is dead
 */
export async function isHolderProvablyDead(holder: string, local: LocalProcessIdentity | null, probe: ProcessProbe): Promise<boolean> {
  if (local === null) return false;
  const parsed = parseHolder(holder);
  if (parsed === null || parsed.machineId !== local.machineId) return false;
  if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return false;
  const observed = await probe(parsed.pid);
  if (!observed.ok) return false;
  if (!observed.value.alive) return true;
  // reason: an alive pid with an unreadable start time cannot be told apart from the holder itself; live.
  return observed.value.startTime !== null && observed.value.startTime !== parsed.startIso;
}

function execText(file: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, [...args], { timeout: 5000 }, (error, stdout) => {
      resolve(error === null ? stdout.trim() : null);
    });
  });
}

/** This boot's identity: Linux `boot_id`, macOS `kern.bootsessionuuid`; `null` when neither can be read. */
async function readBootIdentity(): Promise<string | null> {
  try {
    const linux = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (linux !== "") return linux;
  } catch {
    // reason: not Linux (or /proc hidden); fall through to the macOS source.
  }
  const mac = await execText("sysctl", ["-n", "kern.bootsessionuuid"]);
  return mac !== null && mac !== "" ? mac : null;
}

/** The stored random machine id under the lore home (`$LORE_HOME` or `~/.lore`), created on first use; `null` when unusable. */
function readOrCreateStoredId(): string | null {
  const home = process.env["LORE_HOME"];
  const dir = home !== undefined && home !== "" ? home : join(homedir(), ".lore");
  const file = join(dir, "machine-id");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{32}$/.test(existing)) return existing;
  } catch {
    // reason: absent file is the first-use case; created below.
  }
  try {
    mkdirSync(dir, { recursive: true });
    const created = randomBytes(16).toString("hex");
    writeFileSync(file, `${created}\n`, { flag: "wx" });
    return created;
  } catch {
    // reason: a concurrent first-use may have just created it; read it back, else give up (no identity).
    try {
      const raced = readFileSync(file, "utf8").trim();
      return /^[0-9a-f]{32}$/.test(raced) ? raced : null;
    } catch {
      return null;
    }
  }
}

let cachedIdentity: Promise<LocalProcessIdentity | null> | undefined;

/** This process's identity, computed once; `null` (no identity) when any ingredient is unavailable. */
export function resolveLocalIdentity(): Promise<LocalProcessIdentity | null> {
  cachedIdentity ??= (async () => {
    const boot = await readBootIdentity();
    const stored = readOrCreateStoredId();
    const startIso = await probeProcessStartTime(process.pid);
    if (boot === null || stored === null || startIso === null) return null;
    const machineId = createHash("sha256").update(`${stored}:${boot}`).digest("hex").slice(0, 16);
    return { machineId, pid: process.pid, startIso };
  })();
  return cachedIdentity;
}

/** The real probe: `kill(pid, 0)` for existence, `ps lstart` for the start time. */
export const probeLocalProcess: ProcessProbe = async (pid) => {
  try {
    process.kill(pid, 0);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return ok({ alive: false, startTime: null });
    if (code !== "EPERM") return err({ code: "STORE_ERROR", message: `probing pid ${String(pid)} failed: ${String(code)}` });
  }
  return ok({ alive: true, startTime: await probeProcessStartTime(pid) });
};

/** Production wiring of {@link LeaseLiveness}. */
export const defaultLeaseLiveness: LeaseLiveness = { identity: resolveLocalIdentity, probe: probeLocalProcess };
