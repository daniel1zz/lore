/**
 * Live-server registry: a running `lore dashboard` / `lore serve` records the base URL it
 * listens on for the corpus it serves, so another CLI process can print a link without
 * assuming a port (spec-human-review-surface-decisions-audit-items-and-pending D4, AC-HR-5).
 *
 * Public surface: `registerLiveServer`, `readLiveServerUrl`, `resolveLiveServerRegistryDir`,
 *   `registerServerForInvocation`, `LiveServerLookup`, `LiveServerRegistration`.
 * Invariants:
 *   - One record per corpus, keyed by the sha256 of the corpus root's realpath, stored as
 *     `<state dir>/live-servers/<key>.json` (state dir = `resolveMachineAuthBaseDir`, so
 *     `$LORE_STATE_HOME` redirects it in tests).
 *   - The record holds the BASE origin only (never the single-use sign-in nonce URL).
 *   - Writes are atomic (temp file in the same dir, then rename).
 *   - A record whose pid is not alive is reported absent, naming the dead pid; it is never
 *     returned as a live URL.
 *   - Removal only deletes a record this process owns (pid match), so a late-stopping
 *     server never erases its successor's record.
 * Side-effect class: IO (filesystem, process liveness probe).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Invocation } from "@lore/core";
import { resolveMachineAuthBaseDir } from "../http/machine-auth.js";

const LiveServerRecordSchema = z.object({
  url: z.string().url(),
  pid: z.number().int().positive(),
  corpusRoot: z.string().min(1),
  startedAt: z.string().min(1),
});

/** What a running server records about itself. */
export type LiveServerRegistration = z.infer<typeof LiveServerRecordSchema>;

/** Answer of {@link readLiveServerUrl}: a live base URL, or why there is none. */
export type LiveServerLookup =
  | { readonly live: true; readonly url: string; readonly pid: number }
  | { readonly live: false; readonly reason: string };

/** Directory holding the per-corpus records. Pure: never touches the filesystem. */
export function resolveLiveServerRegistryDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return join(resolveMachineAuthBaseDir(env, home), "live-servers");
}

function recordPathFor(registryDir: string, corpusRoot: string): string {
  const key = createHash("sha256").update(realpathSync(corpusRoot)).digest("hex").slice(0, 32);
  return join(registryDir, `${key}.json`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // reason: EPERM means the process exists but belongs to another user, so it is still alive.
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Record that this process serves `corpusRoot` at `baseUrl`. Returns a function that removes
 * the record again (call it on the shutdown path); removal is a no-op if another process
 * has since replaced the record.
 *
 * @param opts.baseUrl - Base origin, a scheme, host and port with no path and no nonce.
 * @throws on filesystem failure: a server that cannot register must fail loud, not run undiscoverable.
 */
export function registerLiveServer(opts: {
  readonly registryDir: string;
  readonly corpusRoot: string;
  readonly baseUrl: string;
  readonly pid?: number;
}): () => void {
  const pid = opts.pid ?? process.pid;
  const record = LiveServerRecordSchema.parse({
    url: opts.baseUrl,
    pid,
    corpusRoot: realpathSync(opts.corpusRoot),
    startedAt: new Date().toISOString(),
  });
  mkdirSync(opts.registryDir, { recursive: true });
  const path = recordPathFor(opts.registryDir, opts.corpusRoot);
  const tmp = `${path}.${pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  renameSync(tmp, path);

  return () => {
    try {
      const current = LiveServerRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      if (current.pid !== pid) return;
    } catch {
      // reason: record already gone or unreadable, so nothing of ours is left to remove.
      return;
    }
    rmSync(path, { force: true });
  };
}

/**
 * Register the server of this invocation for its corpus. A run outside any corpus has
 * nothing to key a record on and registers nothing (returns a no-op remover).
 */
export function registerServerForInvocation(inv: Invocation, baseUrl: string): () => void {
  if (inv.paths.projectRoot === null) return () => {};
  return registerLiveServer({
    registryDir: resolveLiveServerRegistryDir(inv.env, inv.paths.home),
    corpusRoot: inv.paths.projectRoot,
    baseUrl,
  });
}

function parseJsonOrNull(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Look up the live server for `corpusRoot`. Reports absent (with a reason) when no record
 * exists, the record is unreadable, or its pid is dead.
 */
export function readLiveServerUrl(registryDir: string, corpusRoot: string): LiveServerLookup {
  let path: string;
  try {
    path = recordPathFor(registryDir, corpusRoot);
  } catch (cause) {
    return { live: false, reason: `corpus root ${corpusRoot} cannot be resolved: ${(cause as Error).message}` };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return { live: false, reason: `no lore dashboard or serve is registered for ${corpusRoot}` };
    }
    return { live: false, reason: `server record ${path} is unreadable: ${(cause as Error).message}` };
  }
  const parsed = LiveServerRecordSchema.safeParse(parseJsonOrNull(raw));
  if (!parsed.success) {
    return { live: false, reason: `server record ${path} is malformed` };
  }
  if (!isProcessAlive(parsed.data.pid)) {
    return { live: false, reason: `server record names pid ${parsed.data.pid}, which is not alive (stale record ${path})` };
  }
  return { live: true, url: parsed.data.url, pid: parsed.data.pid };
}
