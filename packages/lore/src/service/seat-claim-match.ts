/**
 * seat-claim-match — the ONE comparison deciding whether a task claim's recorded `worktree` names a given
 * worktree (spec-session-start-injection-carries-only-the-session-s-own D11/D12; reused by
 * spec-worktree-removal-is-decided-by-who-is-inside-not-by-how D2).
 *
 * Public surface: {@link makeDirectoryResolver}, {@link claimNamesWorktree}.
 *
 * @invariant Side-effect class: pure given the injected realpath port (no store, no fs of its own).
 * @invariant `claim.worktree` holds EITHER a branch name or an absolute path (issue #158). A branch name matches
 *   by string equality; an absolute path matches when both sides resolve to the same directory. A non-absolute
 *   recorded value is compared as a branch only; an empty one matches nothing.
 * @invariant ENOENT from the port (a worktree already removed) falls back to lexical `path.resolve`; every other
 *   port error is thrown to the caller — never swallowed.
 */
import { isAbsolute, resolve as resolvePath } from "node:path";

/** Injectable realpath: throws the `fs` error (`code: "ENOENT"` for an absent path). Structurally `RealpathPort`. */
export type RealpathFn = (path: string) => string;

/** Normalises a directory for comparison. Throws the port's error unless it is ENOENT. */
export type DirectoryResolver = (directory: string) => string;

/** Wraps a realpath port with the explicit ENOENT -> `path.resolve` fallback. */
export function makeDirectoryResolver(realpath: RealpathFn): DirectoryResolver {
  return (directory) => {
    try {
      return realpath(directory);
    } catch (cause) {
      // reason: ENOENT is an expected fact (a worktree `lore done` already removed), not an error — fall back to
      // lexical resolution so a claim still matches its own recorded string. Every other code is real.
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return resolvePath(directory);
      throw cause;
    }
  };
}

/**
 * Whether a claim's recorded worktree value names the worktree.
 *
 * @param recorded - `extra.claim.worktree` (branch name or absolute path); `undefined`/"" matches nothing.
 * @param worktree - `resolvedDirectory` already passed through `resolveDirectory`; `branch` when it was measured.
 * @param resolveDirectory - the resolver used for `resolvedDirectory`.
 */
export function claimNamesWorktree(
  recorded: string | undefined,
  worktree: { readonly branch: string | undefined; readonly resolvedDirectory: string },
  resolveDirectory: DirectoryResolver,
): boolean {
  if (recorded === undefined || recorded === "") return false;
  if (worktree.branch !== undefined && recorded === worktree.branch) return true;
  return isAbsolute(recorded) && resolveDirectory(recorded) === worktree.resolvedDirectory;
}
