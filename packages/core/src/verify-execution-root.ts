/**
 * `lore verify` execution-root resolution — pure decision of which directory
 * the trusted runner (`VerifyRunnerService`) should spawn a plan's declared
 * script-mode AC commands in (SPEC-063).
 *
 * Root cause this closes: `VerifyRunnerService`'s `config.repoRoot` is derived
 * once, in `app.ts`, as `dirname(dirname(dbPath))` — the CORPUS root. A linked
 * git worktree carries no `.lore/` of its own, so `findLoreDbPath` (which walks
 * UP from `process.cwd()`) always resolves the corpus in the MAIN checkout,
 * even when the caller is standing inside a worktree. Before this module, an
 * agent running `lore verify` from its own worktree therefore attested against
 * the main checkout's tree, not the code it just wrote — every trust marker
 * (exit-code-derived result, `attestation` object) present, describing the
 * wrong subject.
 *
 * Public surface:
 *   - VerifyGitFacts — already-resolved git facts the caller supplies (pure
 *     data in, no git access here — mirrors the `GitPort`/`FsProbe`/`seat.ts`
 *     `GitFacts` precedent: probing is the ADAPTER's job).
 *   - VerifyExecutionMode / VerifyExecutionRootResolution — the resolver's
 *     output shape.
 *   - resolveVerifyExecutionRoot({corpusRoot, callerCwd, gitFacts}) — the D1
 *     pure resolver.
 *
 * Invariants:
 *   - PURE: no IO, no `process.cwd()`/`Date.now()` reads, no git shell-outs.
 *     `gitFacts` arrives as data the caller (CLI adapter) already resolved via
 *     `git rev-parse --git-common-dir`/`--git-dir`/`--show-toplevel` — same
 *     division of labor `seat.ts`'s `classifySessionLocation` uses.
 *   - FAIL-SAFE, NEVER GUESS: any anomaly in the supplied facts — an
 *     unresolved probe (`gitFacts.resolved === false`), a worktree root
 *     identical to `corpusRoot` (the degenerate case), or a `callerCwd`
 *     outside the claimed `worktreeRoot` (an inconsistent fact set) — falls
 *     back to `mode: "corpus_root"`, the ONLY behavior this module's callers
 *     had before SPEC-063 (byte-identical for every main-checkout invocation
 *     and every anomalous/unresolvable one).
 *   - Zero Node builtins — `@lore/core`'s default barrel is imported by the
 *     browser-facing dashboard (Vite); this module must stay import-safe
 *     there, same as every other pure module in this package.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-063 §Design, §Design Decisions D1.
 */

/**
 * Already-resolved git facts about `callerCwd`, supplied by the CALLER (the
 * CLI adapter, which shells out to `git rev-parse`) — this module never
 * probes git itself (module @invariant above).
 */
export interface VerifyGitFacts {
  /**
   * `false` iff the caller's git probe failed or was unavailable (e.g. `git`
   * not on PATH, not inside a git repo, a probe timeout) — an ERROR-dimension
   * signal distinct from `isLinkedWorktree: false`, which means "the probe
   * succeeded and confirmed this is NOT a linked worktree." An unresolved
   * probe always fails safe to `mode: "corpus_root"` regardless of the other
   * two fields' values.
   */
  resolved: boolean;
  /**
   * `true` iff `callerCwd` sits inside a linked (non-main) git worktree —
   * resolved via comparing `git rev-parse --git-common-dir` against
   * `--git-dir` (they differ only for a linked worktree; identical for the
   * main checkout and for a non-worktree repo).
   */
  isLinkedWorktree: boolean;
  /**
   * The linked worktree's root (`git rev-parse --show-toplevel`, run from
   * `callerCwd`), or `null` when `isLinkedWorktree` is `false` or the
   * top-level probe itself failed.
   */
  worktreeRoot: string | null;
}

/** The two execution-root modes `lore verify` can report (SPEC-063 §Design). */
export type VerifyExecutionMode = "corpus_root" | "worktree";

/** {@link resolveVerifyExecutionRoot}'s return shape. */
export interface VerifyExecutionRootResolution {
  /** The absolute directory `lore verify` should spawn AC commands in. */
  readonly root: string;
  /** Which of the two resolution paths produced {@link root}. */
  readonly mode: VerifyExecutionMode;
  /**
   * Present iff the resolver fell back to `corpus_root` because of an
   * ANOMALY in the supplied facts (unresolved probe, or a `callerCwd`/
   * `worktreeRoot` mismatch) rather than a genuine main-checkout invocation —
   * callers surface this as an advisory (mirrors SPEC-057's `seat_unresolved`
   * warning-field convention). Absent on every ordinary resolution (a ordinary
   * main-checkout call, or a clean worktree resolution).
   */
  readonly warning?: string;
}

/** Input to {@link resolveVerifyExecutionRoot}. */
export interface ResolveVerifyExecutionRootInput {
  /** The corpus root `lore verify`'s pre-SPEC-063 `repoRoot` always resolved to (`dirname(dirname(dbPath))`, `app.ts`). Never derived here — the caller's `App.repoRoot`. */
  corpusRoot: string;
  /** The caller's current working directory (`process.cwd()`, or an explicit `--execution-root` candidate — see the CLI adapter's own composition of a synthetic {@link VerifyGitFacts} for that escape hatch). */
  callerCwd: string;
  /** Already-resolved git facts about {@link callerCwd} — see {@link VerifyGitFacts}. */
  gitFacts: VerifyGitFacts;
}

/**
 * Strips one trailing `/` (never the bare root `"/"`) so `"/repo"` and
 * `"/repo/"` compare/contain identically — git and `dirname()` output don't
 * normally carry a trailing slash, but this keeps the comparison robust
 * against a caller that does.
 */
function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** `true` iff `candidate` is `root` itself or a path nested under it. */
function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = stripTrailingSlash(root);
  const normalizedCandidate = stripTrailingSlash(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

/**
 * Resolves the directory `lore verify` should spawn a plan's declared
 * script-mode AC commands in (SPEC-063 §Design Decisions D1).
 *
 * Decision table:
 *   1. `gitFacts.resolved === false` → `corpus_root` + warning (ERROR — the
 *      probe itself failed; never guess a worktree).
 *   2. `gitFacts.isLinkedWorktree === false` OR `gitFacts.worktreeRoot ===
 *      null` → `corpus_root` (the ordinary main-checkout case — byte-identical
 *      to pre-SPEC-063 behavior).
 *   3. `gitFacts.worktreeRoot === corpusRoot` → `corpus_root` (BOUNDARY — a
 *      degenerate "linked worktree whose root happens to equal the corpus
 *      root" fact set; there is nothing to redirect to).
 *   4. `callerCwd` is not `gitFacts.worktreeRoot` itself and not nested under
 *      it → `corpus_root` + warning (ERROR — an internally inconsistent fact
 *      set; never guess which root to trust).
 *   5. Otherwise → `worktree`, rooted at `gitFacts.worktreeRoot`.
 *
 * @param input - `{corpusRoot, callerCwd, gitFacts}` — see {@link ResolveVerifyExecutionRootInput}.
 * @returns `{root, mode, warning?}` — see {@link VerifyExecutionRootResolution}.
 * @example
 * resolveVerifyExecutionRoot({
 *   corpusRoot: "/repo",
 *   callerCwd: "/repo",
 *   gitFacts: { resolved: true, isLinkedWorktree: false, worktreeRoot: null },
 * }); // => { root: "/repo", mode: "corpus_root" }
 * @example
 * resolveVerifyExecutionRoot({
 *   corpusRoot: "/repo",
 *   callerCwd: "/repo/.worktrees/t1",
 *   gitFacts: { resolved: true, isLinkedWorktree: true, worktreeRoot: "/repo/.worktrees/t1" },
 * }); // => { root: "/repo/.worktrees/t1", mode: "worktree" }
 * @example
 * resolveVerifyExecutionRoot({
 *   corpusRoot: "/repo",
 *   callerCwd: "/repo/.worktrees/t1",
 *   gitFacts: { resolved: false, isLinkedWorktree: false, worktreeRoot: null },
 * }); // => { root: "/repo", mode: "corpus_root", warning: "..." } — fail-safe
 */
export function resolveVerifyExecutionRoot(
  input: ResolveVerifyExecutionRootInput,
): VerifyExecutionRootResolution {
  const { corpusRoot, callerCwd, gitFacts } = input;

  if (!gitFacts.resolved) {
    return {
      root: corpusRoot,
      mode: "corpus_root",
      warning:
        "git worktree facts were unavailable (probe failed or unresolved) — " +
        "execution root defaulted to the corpus root rather than guessing.",
    };
  }

  if (!gitFacts.isLinkedWorktree || gitFacts.worktreeRoot === null) {
    return { root: corpusRoot, mode: "corpus_root" };
  }

  if (stripTrailingSlash(gitFacts.worktreeRoot) === stripTrailingSlash(corpusRoot)) {
    return { root: corpusRoot, mode: "corpus_root" };
  }

  if (!isWithin(gitFacts.worktreeRoot, callerCwd)) {
    return {
      root: corpusRoot,
      mode: "corpus_root",
      warning:
        `caller cwd "${callerCwd}" is not inside the reported worktree root ` +
        `"${gitFacts.worktreeRoot}" — execution root defaulted to the corpus ` +
        "root rather than guessing.",
    };
  }

  return { root: gitFacts.worktreeRoot, mode: "worktree" };
}
