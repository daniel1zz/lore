/**
 * One prepared worktree per commit per review: a cache that checks a commit out and installs its dependencies once, lends
 * the worktree to every run at that commit, and removes every worktree when the review ends (BR-1496, #535).
 *
 * Purpose: stop paying `git worktree add` + `bun install` for every file run at a commit (162 s per run measured in #535).
 * Public surface: PreparedWorktreeCache, PreparedWorktree, PrepareWorktree.
 * Invariants:
 *   - `prepare` runs at most once per commit while a worktree for it is held, even for concurrent callers (the in-flight
 *     preparation is shared); a failed preparation is not cached, so a later call retries.
 *   - `disposeAll` removes every held worktree, whatever happened to the runs; it reports the first removal failure (never ignored)
 *     and leaves the cache empty so the next use prepares again.
 *   - `use` never throws: a throwing `work` is an `err`.
 * Side-effect class: stateful (holds worktrees through the injected ports); IO only through `prepare` and `dispose`.
 *
 * @spec_ref spec-a-plan-s-regression-reuses-a-stored-suite-that-contains (AC-AC-2, BR-1496)
 */

import { err, ok, type LoreError, type Result } from "@lore/core";

/** A prepared worktree: its root and the call that removes it. */
export interface PreparedWorktree {
  readonly root: string;
  readonly dispose: () => Promise<Result<void, LoreError>>;
}

/** Checks `commit` out and prepares its dependencies. */
export type PrepareWorktree = (commit: string) => Promise<Result<PreparedWorktree, LoreError>>;

/** See the module header. */
export class PreparedWorktreeCache {
  private readonly held = new Map<string, Promise<Result<PreparedWorktree, LoreError>>>();

  constructor(private readonly prepare: PrepareWorktree) {}

  /**
   * Runs `work` in the prepared worktree of `commit`, preparing it on first use.
   *
   * @param commit - the commit to work at
   * @param work - awaited with the worktree root
   * @returns `work`'s value, or the preparation's error, or an `err` when `work` throws
   */
  async use<T>(commit: string, work: (root: string) => Promise<T>): Promise<Result<T, LoreError>> {
    let entry = this.held.get(commit);
    if (entry === undefined) {
      entry = this.prepare(commit);
      this.held.set(commit, entry);
    }
    const prepared = await entry;
    if (!prepared.ok) {
      // reason: a failed preparation must not poison the review: drop it so the next use retries.
      if (this.held.get(commit) === entry) this.held.delete(commit);
      return prepared;
    }
    try {
      return ok(await work(prepared.value.root));
    } catch (cause) {
      return err({ code: "STORE_ERROR", message: `work in the prepared worktree of ${commit} failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
  }

  /** The commits whose worktree is currently held. */
  heldCommits(): string[] {
    return [...this.held.keys()];
  }

  /**
   * Removes every held worktree (the review ended, success or not).
   *
   * @returns `ok` when all were removed; the first removal failure otherwise (the rest are still attempted)
   */
  async disposeAll(): Promise<Result<void, LoreError>> {
    const entries = [...this.held.values()];
    this.held.clear();
    let failure: LoreError | undefined;
    for (const entry of entries) {
      const prepared = await entry;
      if (!prepared.ok) continue;
      const removed = await prepared.value.dispose();
      if (!removed.ok && failure === undefined) failure = removed.error;
    }
    return failure === undefined ? ok(undefined) : err(failure);
  }
}
