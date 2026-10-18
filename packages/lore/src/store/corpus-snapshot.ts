/**
 * Corpus snapshot: a consistent, private copy of a live corpus for `lore integrate`'s floor.
 *
 * Purpose: the floor runs the BRANCH's code, which may need a newer schema than the shared checkout's corpus; the
 * foreign-schema guard (foreign-schema-guard.ts) rightly refuses to let a linked worktree migrate the main checkout's
 * `.lore/lore.db`. The floor therefore gets its own `.lore/` inside the integration worktree, holding a snapshot, so
 * the branch binary migrates the snapshot and never the live corpus.
 * Public surface: {@link takeCorpusSnapshot}, {@link removeCorpusSnapshot}, {@link CorpusSnapshot}.
 * Invariants:
 *   - The database is copied with SQLite's `VACUUM INTO` from a READ-ONLY handle: a consistent image even while other
 *     sessions write the WAL-mode live file. A raw file copy is never used.
 *   - The live corpus is never written (read-only handle; nothing flows back from the snapshot).
 *   - Only `config.yaml` is carried besides the database, and only when the destination lacks it (a tracked one is
 *     already checked out at the merged tree's version). No caches, keys, ledgers or exports are copied.
 *   - Writing into `<worktree>/.lore/` is safe for git: `*.db` is ignored repo-wide and `.lore/` is untracked-ignored in
 *     consumer repos; the snapshot is removed after every floor run anyway.
 * Side-effect class: IO (reads the live db, writes/removes files under the destination `.lore/`).
 */
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";

/** Facts about a snapshot that was taken. */
export interface CorpusSnapshot {
  /** The snapshot's `.lore/` directory (inside the destination worktree). */
  readonly corpusDir: string;
  /** ISO-8601 instant the snapshot was taken. */
  readonly takenAt: string;
}

const DB_FILES = ["lore.db", "lore.db-wal", "lore.db-shm"] as const;
const CONFIG_FILE = "config.yaml";
/** Wait for a concurrent writer's lock instead of failing at once (native SQLite busy handler, same as the store). */
const BUSY_TIMEOUT_MS = 30_000;

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Snapshots `<sourceCorpusDir>/lore.db` into `<destRoot>/.lore/lore.db`, replacing any earlier snapshot there.
 *
 * @param sourceCorpusDir - the live `.lore/` directory (never written)
 * @param destRoot - the integration worktree root; its `.lore/` receives the snapshot
 * @returns ok(snapshot), or err(STORE_ERROR) naming the failing step (a missing source db included)
 */
export function takeCorpusSnapshot(sourceCorpusDir: string, destRoot: string): Result<CorpusSnapshot, LoreError> {
  const sourceDb = join(sourceCorpusDir, "lore.db");
  if (!existsSync(sourceDb)) {
    return err({ code: "STORE_ERROR", message: `integrate: cannot snapshot the corpus: ${sourceDb} does not exist` });
  }
  const corpusDir = join(destRoot, ".lore");
  const removed = removeCorpusSnapshot(destRoot);
  if (!removed.ok) return removed;
  let source: Database | undefined;
  try {
    mkdirSync(corpusDir, { recursive: true });
    source = new Database(sourceDb, { readonly: true });
    source.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    source.run("VACUUM INTO ?", [join(corpusDir, "lore.db")]);
    const sourceConfig = join(sourceCorpusDir, CONFIG_FILE);
    if (existsSync(sourceConfig) && !existsSync(join(corpusDir, CONFIG_FILE))) copyFileSync(sourceConfig, join(corpusDir, CONFIG_FILE));
    return ok({ corpusDir, takenAt: new Date().toISOString() });
  } catch (cause) {
    return err({ code: "STORE_ERROR", message: `integrate: snapshotting ${sourceDb} into ${corpusDir} failed: ${describeCause(cause)}` });
  } finally {
    source?.close();
  }
}

/** Deletes the snapshot database files under `<destRoot>/.lore/` (other files there, tracked or not, stay). */
export function removeCorpusSnapshot(destRoot: string): Result<void, LoreError> {
  try {
    for (const name of DB_FILES) rmSync(join(destRoot, ".lore", name), { force: true });
    return ok(undefined);
  } catch (cause) {
    return err({ code: "STORE_ERROR", message: `integrate: removing the corpus snapshot under ${destRoot}/.lore failed: ${describeCause(cause)}` });
  }
}
