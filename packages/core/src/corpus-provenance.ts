/**
 * Pure corpus-provenance decision — given already-resolved facts about the
 * caller's working directory and git position, decides WHERE a `.lore/
 * lore.db` lookup landed and BY WHICH ROUTE, performing no IO itself.
 *
 * Root cause this closes: `findLoreDbPath()` (`packages/lore/src/adapters/
 * cli/utils.ts:124`) returns a bare `string` reached by one of two routes —
 * an upward filesystem walk, or a fallback that crosses into a linked
 * worktree's MAIN checkout (`findMainCheckoutLoreDb`, §M4) — and the caller
 * cannot tell which. A harness worktree nested inside its own main checkout
 * (`<main>/.claude/worktrees/agent-*`) therefore resolves the MAIN corpus on
 * a WRITE with no signal that a boundary was crossed. This module is the
 * pure decision half of that fix: it never touches a filesystem or spawns
 * git itself, so it is fully unit-testable and reusable from every adapter
 * that can supply these facts (CLI today; MCP's `caller_cwd` parameter
 * later).
 *
 * Public surface:
 *   - CorpusProvenance — the three routes a resolution can have taken.
 *   - CorpusProvenanceGitFacts — already-resolved git facts the caller
 *     supplies (see "Why a new fact shape" below).
 *   - ResolvedCorpus / ResolveCorpusProvenanceInput — the resolver's I/O
 *     shapes.
 *   - resolveCorpusProvenance({cwd, probeExists, gitFacts}) — the pure
 *     decision.
 *
 * Why a NEW fact shape rather than reusing `VerifyGitFacts`
 * (`verify-execution-root.ts:51-74`): that type answers a narrower question
 * — "should `lore verify` spawn AC commands in the corpus root or a linked
 * worktree's root?" — and its `worktreeRoot` is `null` whenever
 * `isLinkedWorktree` is `false`, because its caller never needs a boundary
 * for the ordinary main-checkout case. This resolver's `"own"` outcome needs
 * a caller-tree boundary EVEN for a main checkout (no crossing involved at
 * all), and its `"git_common_dir"` outcome needs the MAIN checkout's root, a
 * field `VerifyGitFacts` structurally does not carry. Extending
 * `VerifyGitFacts` in place, or unioning the two shapes, would couple
 * SPEC-063's execution-root resolver to this module's needs and break the
 * "one attachment site per fact shape" property both rely on for
 * independent evolution — so `CorpusProvenanceGitFacts` is its own type,
 * deliberately NOT assignable to/from `VerifyGitFacts` (it mirrors
 * `resolved`/`isLinkedWorktree` in name and meaning, and adds
 * `callerTreeRoot` + `mainCheckoutRoot`). `VerifyGitFacts` itself is never
 * imported or mutated here.
 *
 * Invariants:
 *   - PURE: no IO, no `process.cwd()`/`process.exit()`, no git shell-outs,
 *     no `fs`/`path`/`os`/`child_process` imports. `probeExists` and
 *     `gitFacts` are supplied by the CALLER (the CLI/MCP adapter), same
 *     division of labor as `resolveVerifyExecutionRoot`.
 *   - FAIL-SAFE, NEVER GUESS: an unresolved git probe
 *     (`gitFacts.resolved === false`) with no hit inside the caller's own
 *     tree yields `"undetermined"`, never a guessed `"own"` or
 *     `"git_common_dir"`. An inconsistent fact set (`cwd` outside its own
 *     claimed `callerTreeRoot`) degrades the same way — see
 *     `findLoreDbWithinBoundary`.
 *   - Zero Node builtins — `@lore/core`'s default barrel is imported by the
 *     browser-facing dashboard (Vite); this module must stay import-safe
 *     there, same as every other pure module in this package.
 *
 * Side-effect class: pure
 *
 * Source: spec-corpus-resolution-carries-provenance-and-a-foreign-write
 * §Design D1 (decision half only — the IO-performing boundary DETECTOR
 * itself is a separate task), §Design D2 (these exact type shapes).
 */

/**
 * The three routes {@link resolveCorpusProvenance} can report for a resolved
 * `.lore/lore.db` path.
 */
export type CorpusProvenance =
  // `.lore/lore.db` found at or above the caller's `cwd`, still inside the
  // caller's own working-tree root (`gitFacts.callerTreeRoot`) — no crossing
  // involved at all.
  | "own"
  // No hit inside the caller's own tree; reached the MAIN checkout's corpus
  // via the already-resolved git facts (mirrors the §M4 fallback route in
  // spec-workflow-hardening-evidence-red-vocabulary-claim-worktree).
  | "git_common_dir"
  // No hit inside the caller's own tree, and `gitFacts.resolved` is `false`
  // — whether crossing would have been the legitimate `git_common_dir` route
  // or an accidental escape is UNKNOWN from the supplied facts, so neither
  // is assumed. Defined purely by the supplied fact shape, never by
  // detector-internal disagreement (that framing belongs to the ADAPTER that
  // produces `resolved`, not to this pure decision).
  | "undetermined";

/**
 * Already-resolved git facts about {@link ResolveCorpusProvenanceInput.cwd},
 * supplied by the CALLER — this module never probes git itself (see the
 * module header's PURE invariant). Deliberately NOT `VerifyGitFacts`
 * (`verify-execution-root.ts:51-74`) reused or extended — see the module
 * header's "Why a NEW fact shape" note for why coupling the two would break
 * their independent "one attachment site" property.
 */
export interface CorpusProvenanceGitFacts {
  /**
   * The root of the CALLER's own working tree — populated for a main
   * checkout too, unlike `VerifyGitFacts.worktreeRoot` (which is `null`
   * whenever `isLinkedWorktree` is `false`). `"own"` provenance needs this
   * boundary even when the caller never left home, and it is available
   * independent of `resolved` below: this module keeps the two as SEPARATE
   * facts because `utils.ts`'s two pre-existing boundary detectors (one
   * shells out to git, one reads the `.git` file directly) can disagree
   * about the main-checkout CROSSING determination specifically — this
   * field is the caller's-own-boundary determination, not the
   * disagreement-prone one.
   */
  callerTreeRoot: string;
  /**
   * `false` iff the SEPARATE probe for crossing into a main checkout (git
   * common-dir vs git-dir comparison) failed or was unavailable — mirrors
   * `VerifyGitFacts.resolved`, but scoped to ONLY that crossing
   * determination. Meaningless when `false`: `isLinkedWorktree` and
   * `mainCheckoutRoot` below carry no signal in that case and MUST NOT be
   * consulted.
   */
  resolved: boolean;
  /**
   * `true` iff the caller sits inside a linked (non-main) git worktree.
   * Only meaningful when `resolved` is `true`.
   */
  isLinkedWorktree: boolean;
  /**
   * The MAIN checkout's root when `isLinkedWorktree` is `true` — the field
   * `VerifyGitFacts` structurally lacks (its caller never needed to cross
   * into it; this resolver's whole job is deciding whether to). `null` when
   * `isLinkedWorktree` is `false`, `resolved` is `false`, or the probe could
   * not determine it.
   */
  mainCheckoutRoot: string | null;
}

/** {@link resolveCorpusProvenance}'s successful result. */
export interface ResolvedCorpus {
  /**
   * The absolute path to a `.lore/lore.db` file — EXCEPT when `provenance`
   * is `"undetermined"`, where no corpus location could be confirmed (see
   * that member's doc on {@link CorpusProvenance}) and this field instead
   * carries the caller's own `cwd` as a diagnostic anchor. Callers MUST
   * treat `path` as a real corpus location only when `provenance` is
   * `"own"` or `"git_common_dir"`.
   */
  readonly path: string;
  /** Which route produced {@link path} — see {@link CorpusProvenance}. */
  readonly provenance: CorpusProvenance;
}

/** Input to {@link resolveCorpusProvenance}. */
export interface ResolveCorpusProvenanceInput {
  /** The caller's current working directory. */
  cwd: string;
  /**
   * Injected path-existence predicate — the caller (CLI/MCP adapter) owns
   * the real `existsSync` walk; this module never touches the filesystem.
   */
  probeExists: (path: string) => boolean;
  /** Already-resolved git facts about {@link cwd} — see {@link CorpusProvenanceGitFacts}. */
  gitFacts: CorpusProvenanceGitFacts;
}

/**
 * Strips one trailing `/` (never the bare root `"/"`) — mirrors
 * `verify-execution-root.ts`'s helper of the same purpose, duplicated rather
 * than imported so this module keeps zero dependencies of its own.
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
 * The parent directory of `dir`, via plain string manipulation (no `path`
 * module — this file must stay Node-builtin-free). Returns `"/"` once `dir`
 * has no further parent to climb to.
 */
function parentDirectory(dir: string): string {
  const normalized = stripTrailingSlash(dir);
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "/" : normalized.slice(0, idx);
}

/**
 * Walks upward from `cwd` to `boundary` INCLUSIVE, probing each ancestor for
 * `.lore/lore.db` — the bounded half of D1's "the walk halts at the
 * caller's own working-tree boundary." Never climbs past `boundary`.
 * Returns `undefined` (never guesses) when `cwd` is not itself within
 * `boundary` — an inconsistent fact set.
 */
function findLoreDbWithinBoundary(
  cwd: string,
  boundary: string,
  probeExists: (path: string) => boolean,
): string | undefined {
  const normalizedBoundary = stripTrailingSlash(boundary);
  let current = stripTrailingSlash(cwd);

  if (!isWithin(normalizedBoundary, current)) {
    return undefined;
  }

  while (true) {
    const candidate = `${current}/.lore/lore.db`;
    if (probeExists(candidate)) {
      return candidate;
    }
    if (current === normalizedBoundary) {
      return undefined;
    }
    current = parentDirectory(current);
  }
}

/**
 * Decides WHERE a `.lore/lore.db` corpus resolves from `cwd` and BY WHICH
 * ROUTE, from already-supplied facts
 * (spec-corpus-resolution-carries-provenance-and-a-foreign-write §Design
 * D1/D2).
 *
 * Decision table:
 *   1. `.lore/lore.db` found at or above `cwd`, still inside
 *      `gitFacts.callerTreeRoot` → `{path, provenance: "own"}`.
 *   2. No hit in (1), and `gitFacts.resolved === false` →
 *      `{path: cwd, provenance: "undetermined"}` — never guess which
 *      crossing story applies.
 *   3. No hit in (1), `gitFacts.resolved === true`, and
 *      (`gitFacts.isLinkedWorktree === false` OR
 *      `gitFacts.mainCheckoutRoot === null`) → `undefined` — an ordinary
 *      main-checkout caller (or an inconsistent linked-worktree fact set)
 *      has no legitimate crossing route.
 *   4. No hit in (1)-(3), and `.lore/lore.db` found under
 *      `gitFacts.mainCheckoutRoot` → `{path, provenance: "git_common_dir"}`.
 *   5. Otherwise (the main-checkout corpus is absent) → `undefined`.
 *
 * @param input - `{cwd, probeExists, gitFacts}` — see
 *   {@link ResolveCorpusProvenanceInput}.
 * @returns `{path, provenance}` when a corpus was found or the crossing
 *   question could not be resolved; `undefined` when no corpus exists on
 *   any route this module knows about.
 * @example
 * resolveCorpusProvenance({
 *   cwd: "/repo/packages/lore",
 *   probeExists: (p) => p === "/repo/.lore/lore.db",
 *   gitFacts: { callerTreeRoot: "/repo", resolved: true, isLinkedWorktree: false, mainCheckoutRoot: null },
 * }); // => { path: "/repo/.lore/lore.db", provenance: "own" }
 * @example
 * resolveCorpusProvenance({
 *   cwd: "/repo/.claude/worktrees/agent-x",
 *   probeExists: (p) => p === "/repo/.lore/lore.db",
 *   gitFacts: { callerTreeRoot: "/repo/.claude/worktrees/agent-x", resolved: true, isLinkedWorktree: true, mainCheckoutRoot: "/repo" },
 * }); // => { path: "/repo/.lore/lore.db", provenance: "git_common_dir" }
 * @example
 * resolveCorpusProvenance({
 *   cwd: "/repo/.claude/worktrees/agent-x",
 *   probeExists: () => false,
 *   gitFacts: { callerTreeRoot: "/repo/.claude/worktrees/agent-x", resolved: false, isLinkedWorktree: false, mainCheckoutRoot: null },
 * }); // => { path: "/repo/.claude/worktrees/agent-x", provenance: "undetermined" } — fail-safe
 */
export function resolveCorpusProvenance(
  input: ResolveCorpusProvenanceInput,
): ResolvedCorpus | undefined {
  const { cwd, probeExists, gitFacts } = input;

  const ownHit = findLoreDbWithinBoundary(cwd, gitFacts.callerTreeRoot, probeExists);
  if (ownHit !== undefined) {
    return { path: ownHit, provenance: "own" };
  }

  if (!gitFacts.resolved) {
    return { path: cwd, provenance: "undetermined" };
  }

  if (!gitFacts.isLinkedWorktree || gitFacts.mainCheckoutRoot === null) {
    return undefined;
  }

  const crossingCandidate = `${stripTrailingSlash(gitFacts.mainCheckoutRoot)}/.lore/lore.db`;
  if (probeExists(crossingCandidate)) {
    return { path: crossingCandidate, provenance: "git_common_dir" };
  }

  return undefined;
}
