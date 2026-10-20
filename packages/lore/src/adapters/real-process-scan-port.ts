/**
 * Real process-scan port — which OS processes have their working directory inside a worktree
 * (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a D1; the scan the git-safety hook used to carry,
 * moved here so it exists ONCE).
 *
 * Public surface: {@link ProcessScanPort}, {@link createRealProcessScanPort}.
 *
 * @invariant Side-effect class: IO (spawns `lsof` / `ps`, reads `<procDir>/<pid>/cwd`). Never throws.
 * @invariant The caller's own ancestry (this process, its parent chain) and the `lsof` child never count as "inside":
 *   the shell / harness that launched lore may legitimately sit in the worktree — that is the caller, not a peer.
 * @invariant Unmeasurable is a miss, never "nobody inside": `lsof` absent AND `<procDir>` unreadable, or `lsof` failing
 *   without any listing, return `{ok:false}`.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readlinkSync } from "node:fs";
import type { Measured, ProcessInsideFact } from "../service/worktree-removal-test.js";

/** Scans for processes inside a set of directory spellings of one worktree. */
export interface ProcessScanPort {
  /** @param roots - the worktree path in every spelling (given + realpath) */
  processesInside(roots: readonly string[]): Measured<readonly ProcessInsideFact[]>;
}

export interface RealProcessScanOptions {
  /** Directory of `<pid>/cwd` links (`/proc` on Linux); used only when `lsof` is not installed. */
  readonly procDir?: string;
  /** Working directory for the `lsof` child (the invocation's `cwd`). */
  readonly cwd: string;
}

const MAX_LSOF_BYTES = 64 * 1024 * 1024;
const MAX_ANCESTRY_DEPTH = 64;

function isInside(cwdOfProcess: string, roots: readonly string[]): boolean {
  return roots.some((root) => cwdOfProcess === root || cwdOfProcess.startsWith(root.endsWith("/") ? root : `${root}/`));
}

/** This process and its parent chain. */
function ownAncestryPids(cwd: string): Set<number> {
  const pids = new Set<number>([process.pid, process.ppid]);
  let current = process.ppid;
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH && current > 1; depth++) {
    const run = spawnSync("ps", ["-o", "ppid=", "-p", String(current)], { cwd, encoding: "utf8" });
    if (run.error !== undefined || run.status !== 0) break;
    const parent = Number.parseInt((run.stdout ?? "").trim(), 10);
    if (!Number.isInteger(parent) || parent <= 0 || pids.has(parent)) break;
    pids.add(parent);
    current = parent;
  }
  return pids;
}

/** Best-effort command name, for the refusal text only. */
function commandOfPid(pid: number, cwd: string): string {
  const run = spawnSync("ps", ["-o", "comm=", "-p", String(pid)], { cwd, encoding: "utf8" });
  const name = run.error !== undefined || run.status !== 0 ? "" : (run.stdout ?? "").trim();
  return name === "" ? "(command unknown)" : name;
}

/** The production {@link ProcessScanPort}: `lsof -d cwd`, else the `/proc` cwd links. */
export function createRealProcessScanPort(options: RealProcessScanOptions): ProcessScanPort {
  const procDir = options.procDir ?? "/proc";
  return {
    processesInside: (roots) => {
      const excluded = ownAncestryPids(options.cwd);
      const found = new Set<number>();
      const lsof = spawnSync("lsof", ["-n", "-d", "cwd", "-F", "pn"], {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: MAX_LSOF_BYTES,
      });
      if (lsof.pid) excluded.add(lsof.pid); // lsof itself sits in our cwd
      if (lsof.error === undefined) {
        const out = lsof.stdout ?? "";
        // reason: a non-zero lsof exit WITH a listing is the normal "some processes were not inspectable" case;
        // only a failure that produced no listing is unmeasurable.
        if (lsof.status !== 0 && !/^p\d+$/m.test(out)) {
          const detail = (lsof.stderr ?? "").trim().split("\n")[0] ?? "";
          return { ok: false, reason: `lsof exited ${String(lsof.status ?? "abnormally")}${detail !== "" ? `: ${detail}` : ""}` };
        }
        let pid: number | null = null;
        for (const line of out.split("\n")) {
          if (line.startsWith("p")) pid = Number.parseInt(line.slice(1), 10);
          else if (line.startsWith("n") && pid !== null && Number.isInteger(pid) && !excluded.has(pid) && isInside(line.slice(1), roots)) {
            found.add(pid);
          }
        }
      } else if ((lsof.error as NodeJS.ErrnoException).code === "ENOENT") {
        let entries: string[];
        try {
          entries = readdirSync(procDir).filter((name) => /^\d+$/.test(name));
        } catch {
          return { ok: false, reason: `lsof is not installed and ${procDir} is not readable` };
        }
        for (const name of entries) {
          const pid = Number.parseInt(name, 10);
          if (excluded.has(pid)) continue;
          let target: string;
          try {
            target = readlinkSync(`${procDir}/${name}/cwd`);
          } catch {
            // reason: a process that exited or belongs to another user has no readable cwd link — that is not a
            // measurement of "inside", so it is skipped, never counted.
            continue;
          }
          if (isInside(target, roots)) found.add(pid);
        }
      } else {
        const code = (lsof.error as NodeJS.ErrnoException).code;
        return { ok: false, reason: `lsof could not run (${code ?? lsof.error.message})` };
      }
      return {
        ok: true,
        value: [...found].sort((a, b) => a - b).map((pid) => ({ pid, command: commandOfPid(pid, options.cwd) })),
      };
    },
  };
}
