/**
 * DB discovery for the CLI adapter — relocated OUT of `utils.ts`
 * (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D3/§D6):
 * `utils.ts`'s own module header used to assert "no business logic here" and
 * "DB discovery ... live[s] in `loader.ts`", both false the moment
 * `findLoreDbPath`, `findMainCheckoutLoreDb`, and (via `gate-bypass-audit.ts`)
 * `findLoreDbPathQuiet` lived there. This module is where that discovery
 * genuinely lives now, built on top of `@lore/core`'s pure
 * `resolveCorpusProvenance` decision (§D2) rather than a hand-rolled walk.
 *
 * Public surface:
 *   - resolveCorpus(cwd?) — the ONE composition-boundary function (§D3) that
 *     supplies REAL IO (`existsSync`, the git-based boundary probe) to
 *     `@lore/core`'s pure resolver and returns its full `ResolvedCorpus`,
 *     provenance included. This is the only place in the CLI adapter that
 *     should ever need to know *which route* a corpus resolution took.
 *   - findLoreDbPath() / findLoreDbPathQuiet() — ≤3-line wrappers over
 *     `resolveCorpus()` preserving their EXACT pre-existing terminal
 *     contracts: the loud one still prints the original message and
 *     `exitCli(1)`s on a miss, the quiet one still returns `undefined`.
 *     Both treat `provenance: "undetermined"` as a miss — see the note on
 *     `definiteCorpusPath` below for why that is a mechanism, not a
 *     convention left to each call site.
 *   - findMainCheckoutLoreDb(dir) — the SPEC M4 git-common-dir-vs-git-dir
 *     fallback probe, relocated verbatim from `utils.ts`. Still exported
 *     standalone (nothing outside this module calls it directly today, but
 *     nothing should have to reimplement it either).
 *   - gatherCorpusGitFacts(cwd) — the §D1 boundary-detector adapter: supplies
 *     `@lore/core`'s `CorpusProvenanceGitFacts` from real git probes. See its
 *     own doc comment for WHICH of `utils.ts`'s two pre-existing detectors
 *     this extracts (and why), and for the one place it deliberately departs
 *     from a literal git-facts translation (`resolveCallerTreeRoot`'s
 *     non-git fallback).
 *
 * ⛔ Route 2 (the §M4 main-checkout fallback, surfaced here as
 * `provenance: "git_common_dir"`) is LOAD-BEARING and untouched by this
 * relocation: the worktree-dispatch protocol's `claim`/`evidence`/`release`/
 * `verify` all resolve the main corpus through it from a freshly
 * `git worktree add`-ed tree that never materializes its own `.lore/`. This
 * module changes HOW that route is detected (one shared git-facts probe
 * feeding a pure decision, replacing an ad hoc inline walk), never WHETHER it
 * fires for the same inputs.
 *
 * ⛔ Test-run marker (task-skill-implement-tg-4, AC-TG-2): `resolveCorpus` is the
 * ONE choke point every db-path resolution passes through (CLI loader, MCP,
 * `findLoreDbPath*`). When `LORE_TEST_SANDBOX=1` (set by vitest `setupFiles` and the
 * bun `[test] preload` via `scripts/test-isolation-setup.ts`) it refuses, with exit
 * code 4, any resolved db that lies inside this repository
 * (`LORE_TEST_SANDBOX_REPO` and that repo's main checkout) — see
 * {@link findSandboxRefusal}.
 *
 * Side-effect class: IO — `existsSync` (the pure resolver's injected probe),
 *   `spawnSync` (git facts), `process.exit` (findLoreDbPath's miss branch),
 *   `process.stderr.write` (the same branch's diagnostic).
 *
 * Source: spec-corpus-resolution-carries-provenance-and-a-foreign-write
 * §Design D1, D2, D3, D6.
 */

import { existsSync, realpathSync } from "node:fs";
import { exitCli } from "./cli-exit.js";
import { dirname, isAbsolute, join, resolve as resolvePath, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveCorpusProvenance } from "@lore/core";
import type { CorpusProvenanceGitFacts, ResolvedCorpus } from "@lore/core";
import type { CliIo } from "./output.js";

const NO_DB_MESSAGE =
  "Error: No Lore database found in this directory or any parent.\n" +
  "  Run `lore init` to initialise a new Lore project here.\n";

// ─── §D1 boundary detector ───────────────────────────────────────────────

/**
 * The git-common-dir-vs-git-dir crossing determination, shared by
 * {@link findMainCheckoutLoreDb} and {@link gatherCorpusGitFacts} — the ONE
 * primitive §D1 asks for, so the two can never independently drift on
 * whether `dir` sits inside a linked worktree or where its main checkout is.
 */
interface GitCommonDirProbe {
  readonly resolved: boolean;
  readonly isLinkedWorktree: boolean;
  readonly mainCheckoutRoot: string | null;
}

/**
 * Runs `git rev-parse --git-common-dir` / `--git-dir` from `dir` and
 * classifies the result — the extracted core of `utils.ts`'s former
 * `findMainCheckoutLoreDb` (unchanged probe shape: same two commands, same
 * 5000ms timeout, same comparison). ANY probe failure (not a git repo, `git`
 * missing, nonzero exit, empty/whitespace-only stdout, a thrown `spawnSync`
 * error) degrades to `resolved: false` — mirrors `commands/verify.ts`'s
 * `gatherVerifyGitFacts` UNRESOLVED convention rather than trying to
 * discriminate "genuinely not a worktree" from "the probe itself is broken",
 * a distinction `git rev-parse`'s exit code cannot reliably support anyway
 * (both print a similar generic `fatal:` line).
 */
function probeGitCommonDir(dir: string): GitCommonDirProbe {
  try {
    const commonDirRaw = spawnSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5000,
    });
    const gitDirRaw = spawnSync("git", ["rev-parse", "--git-dir"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5000,
    });
    if (
      commonDirRaw.status !== 0 ||
      gitDirRaw.status !== 0 ||
      !commonDirRaw.stdout?.trim() ||
      !gitDirRaw.stdout?.trim()
    ) {
      return { resolved: false, isLinkedWorktree: false, mainCheckoutRoot: null };
    }

    const commonDirAbs = resolvePath(dir, commonDirRaw.stdout.trim());
    const gitDirAbs = resolvePath(dir, gitDirRaw.stdout.trim());
    if (commonDirAbs === gitDirAbs) {
      // Primary checkout (or a non-worktree repo) — resolved, not linked.
      return { resolved: true, isLinkedWorktree: false, mainCheckoutRoot: null };
    }

    // Linked worktree confirmed: commonDirAbs is the MAIN repo's shared
    // `.git` directory — its parent is the main checkout root.
    return { resolved: true, isLinkedWorktree: true, mainCheckoutRoot: dirname(commonDirAbs) };
  } catch {
    return { resolved: false, isLinkedWorktree: false, mainCheckoutRoot: null };
  }
}

/**
 * The filesystem root — the boundary handed to `@lore/core` when `cwd` sits
 * inside no git repository at all, so the "own" walk climbs as far as it
 * possibly can (the pre-existing unconditional walk-to-filesystem-root
 * behaviour of `utils.ts`'s old `findLoreDbPath`).
 */
const FILESYSTEM_ROOT = "/";

/**
 * The caller's own working-tree boundary (`CorpusProvenanceGitFacts.
 * callerTreeRoot`), resolved independently of the crossing determination
 * above — the two are kept as SEPARATE facts by `@lore/core`'s own module
 * header specifically so an unresolved crossing probe never has to also
 * poison the "own" search's boundary. `git rev-parse --show-toplevel`
 * answers this directly for any git-tracked `dir` (nested or not — it
 * always reports the working tree's own top, whether that is a main
 * checkout or a linked worktree); a `dir` that isn't inside any git
 * repository at all falls back to {@link FILESYSTEM_ROOT} — the REAL root,
 * passed straight through, which the shared resolver treats as an ordinary
 * boundary (`@lore/core`'s `corpus-provenance.ts::childPrefix`). That covers
 * the rare-but-pre-existing-test-covered non-git case: see
 * `tests/integration/cli/gate-bypass-audit.test.ts`'s "walks upward past a
 * nested cwd to find an ancestor .lore/lore.db".
 *
 * ⛔ Do NOT reintroduce a "highest non-root ancestor" helper here to dodge a
 * root-shaped boundary. That workaround existed until the bare-root case was
 * fixed at its one attachment site in the shared resolver, where it is pinned
 * by `packages/core/tests/corpus-provenance-resolver.test.ts`'s
 * `BOUNDARY — callerTreeRoot === "/" behaves like a real boundary` block;
 * re-adding it here would put the policy in two places again, and every other
 * consumer of `resolveCorpusProvenance` (MCP, HTTP) would still need its own
 * copy.
 */
function resolveCallerTreeRoot(cwd: string): string {
  try {
    const topLevelRaw = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    if (topLevelRaw.status === 0 && topLevelRaw.stdout?.trim()) {
      return resolvePath(cwd, topLevelRaw.stdout.trim());
    }
  } catch {
    // fall through to the non-git fallback below
  }
  return FILESYSTEM_ROOT;
}

/**
 * Supplies `@lore/core`'s pure `resolveCorpusProvenance` with real
 * `CorpusProvenanceGitFacts` about `cwd` — the §D1 "one boundary detector,
 * never a third" adapter. Extracted from `utils.ts`'s `findMainCheckoutLoreDb`
 * (the git-shellout detector): that detector answers exactly the "main-checkout CROSSING determination" §D1 calls out
 * as the two detectors' disagreement surface, via git's OWN documented
 * `rev-parse` contract rather than a hand-parsed assumption about the
 * `.git/worktrees/<name>` internal layout. Extending it one step further
 * with `--show-toplevel` (mirroring `commands/verify.ts`'s own
 * `gatherVerifyGitFacts`, which this module's sibling `VerifyGitFacts`
 * already established as the precedent — see `@lore/core`'s
 * `corpus-provenance.ts` module header) supplies `callerTreeRoot` too, with
 * zero new detection MECHANISM invented.
 */
export function gatherCorpusGitFacts(cwd: string): CorpusProvenanceGitFacts {
  const probe = probeGitCommonDir(cwd);
  return {
    callerTreeRoot: resolveCallerTreeRoot(cwd),
    resolved: probe.resolved,
    isLinkedWorktree: probe.isLinkedWorktree,
    mainCheckoutRoot: probe.mainCheckoutRoot,
  };
}

// ─── §M4 fallback probe (relocated verbatim from utils.ts) ─────────────────

/**
 * Resolves the MAIN checkout's `.lore/lore.db` when `dir` sits inside a
 * LINKED git worktree (SPEC M4 —
 * spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M4,
 * AC-WH-4). A fresh `git worktree add` tree never materializes `.lore/`
 * (gitignored, untracked, never checked out into a linked worktree) — the
 * primary "own" search inside {@link resolveCorpus} always misses there.
 * This is the fallback of last resort, consulted only via
 * `resolveCorpusProvenance`'s own `git_common_dir` route once that primary
 * search has already failed.
 *
 * Shares {@link probeGitCommonDir} with {@link gatherCorpusGitFacts} (§D1) —
 * this function adds only the final `.lore/lore.db` existence check on top
 * of the shared crossing determination.
 *
 * @param dir - Directory the primary walk-up already failed to resolve
 *   `.lore/lore.db` from (`process.cwd()` in production).
 * @returns The main checkout's `.lore/lore.db` absolute path, when that
 *   checkout's `.lore/` directory actually contains one; otherwise `undefined`.
 */
export function findMainCheckoutLoreDb(dir: string): string | undefined {
  const probe = probeGitCommonDir(dir);
  if (!probe.resolved || !probe.isLinkedWorktree || probe.mainCheckoutRoot === null) {
    return undefined;
  }
  const candidate = join(probe.mainCheckoutRoot, ".lore", "lore.db");
  return existsSync(candidate) ? candidate : undefined;
}

// ─── test-run marker guard (AC-TG-2) ────────────────────────────────────────

/** Env var set to "1" by the test runners' setup files — arms the guard. */
export const TEST_SANDBOX_ENV = "LORE_TEST_SANDBOX";
/** Env var holding the absolute path of the repository checkout the tests run from. */
export const TEST_SANDBOX_REPO_ENV = "LORE_TEST_SANDBOX_REPO";
/** Exit code for the refusal — the validation/lifecycle family (adapters/cli/CLAUDE.md). */
const SANDBOX_REFUSAL_EXIT_CODE = 4;

function realPathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    // reason: a path that does not exist cannot be a symlink alias of the repo; compare as given.
    return resolvePath(p);
  }
}

/**
 * Decides (reads env + filesystem, never exits) whether the resolved `dbPath` must be
 * refused because `LORE_TEST_SANDBOX=1` and it lies inside this repository. Refused
 * roots are `LORE_TEST_SANDBOX_REPO` AND, when that checkout is a linked worktree, its
 * main checkout (a worktree resolves the main `.lore/` via the git-common-dir route).
 *
 * @param dbPath - the resolved corpus db path
 * @param env - the Invocation's environment (`inv.env`; no ambient default, AS-26)
 * @returns the refusal message, or `undefined` when the path is allowed / guard unarmed
 */
/** The two facts corpus discovery reads from the run: where it stands and which environment guards it (an `Invocation` satisfies this). */
export type CorpusLocator = Readonly<{ cwd: string; env: NodeJS.ProcessEnv }>;

export function findSandboxRefusal(dbPath: string, env: NodeJS.ProcessEnv): string | undefined {
  if (env[TEST_SANDBOX_ENV] !== "1") return undefined;
  const repo = env[TEST_SANDBOX_REPO_ENV];
  if (repo === undefined || repo === "" || !isAbsolute(repo)) {
    return (
      `Error: ${TEST_SANDBOX_ENV}=1 but ${TEST_SANDBOX_REPO_ENV} is not an absolute path ` +
      `(got ${JSON.stringify(repo ?? null)}); refusing to resolve "${dbPath}". ` +
      `The test setup file (scripts/test-isolation-setup.ts) must set both variables.\n`
    );
  }
  const roots = [realPathOrSelf(repo)];
  const probe = probeGitCommonDir(repo);
  if (probe.resolved && probe.isLinkedWorktree && probe.mainCheckoutRoot !== null) {
    roots.push(realPathOrSelf(probe.mainCheckoutRoot));
  }
  const dbReal = realPathOrSelf(dbPath);
  const root = roots.find((r) => dbReal === r || dbReal.startsWith(r + sep));
  if (root === undefined) return undefined;
  return (
    `Error: ${TEST_SANDBOX_ENV}=1 refuses the repository's own corpus "${dbPath}" ` +
    `(inside ${root}). A test must use a throwaway corpus (mkdtemp + \`lore init\`).\n`
  );
}

// ─── §D3 composition boundary + wrappers ───────────────────────────────────

/**
 * The ONE composition-boundary function exposing `@lore/core`'s
 * `resolveCorpusProvenance` decision (§D3) — supplies the real
 * `existsSync`-based `probeExists` and the real {@link gatherCorpusGitFacts}
 * git facts, and returns the decision UNFILTERED, provenance included.
 * `findLoreDbPath` / `findLoreDbPathQuiet` are the only two callers that
 * collapse `provenance: "undetermined"` into a miss; a future caller that
 * genuinely needs to know WHICH route a resolution took (the corpus-write
 * guard this spec's later tasks add) calls this directly instead of either
 * wrapper.
 *
 * @param cwd - the directory to resolve from (`inv.cwd`; tests pass a fixture directory)
 * @param env - the Invocation's environment, read by the test-sandbox refusal (`inv.env`)
 * @returns `@lore/core`'s `ResolvedCorpus` (path + provenance), or
 *   `undefined` when no corpus exists on any route this module knows about
 */
export function resolveCorpus(io: CliIo, cwd: string, env: NodeJS.ProcessEnv): ResolvedCorpus | undefined {
  const resolved = resolveCorpusProvenance({
    cwd,
    probeExists: existsSync,
    gitFacts: gatherCorpusGitFacts(cwd),
  });
  // "undetermined" carries a bare cwd directory, not a corpus file — nothing to refuse.
  if (resolved !== undefined && resolved.provenance !== "undetermined") {
    const refusal = findSandboxRefusal(resolved.path, env);
    if (refusal !== undefined) {
      io.stderr.write(refusal);
      exitCli(SANDBOX_REFUSAL_EXIT_CODE);
    }
  }
  return resolved;
}

/**
 * `resolveCorpus()` filtered down to a definite, real corpus path — `undefined`
 * for BOTH a total miss (`resolveCorpus()` returns `undefined`) AND an
 * unresolved crossing question (`provenance: "undetermined"`, whose `path`
 * field is the caller's bare `cwd`, a DIRECTORY, never a real corpus file —
 * `@lore/core`'s own doc comment on `ResolvedCorpus.path` is explicit that
 * only `"own"`/`"git_common_dir"` provenance makes that field a real corpus
 * location). Collapsing that filter into ONE shared helper — rather than
 * leaving each wrapper below to remember the same `!== "undetermined"` check
 * — is what makes it a mechanism instead of a convention two call sites could
 * independently forget.
 */
function definiteCorpusPath(io: CliIo, locator: CorpusLocator): string | undefined {
  const resolved = resolveCorpus(io, locator.cwd, locator.env);
  return resolved !== undefined && resolved.provenance !== "undetermined" ? resolved.path : undefined;
}

/**
 * Resolves `.lore/lore.db` for the current process — the loud, exit-on-miss
 * half of the pair (§D3). Delegates entirely to {@link definiteCorpusPath};
 * still exits with the EXACT original message and code 1 when no corpus can
 * be confirmed (whether that is a genuine absence or an unresolved crossing
 * question — see {@link definiteCorpusPath}'s doc for why the latter counts
 * as a miss here too).
 *
 * @param locator - the run's `cwd` + `env` (an `Invocation` works)
 * @returns absolute path to the lore.db file
 */
export function findLoreDbPath(io: CliIo, locator: CorpusLocator): string {
  const path = definiteCorpusPath(io, locator);
  if (path === undefined) {
    io.stderr.write(NO_DB_MESSAGE);
    exitCli(1);
  }
  return path;
}

/**
 * `findLoreDbPath`'s quiet sibling (§D3) — same resolution, `undefined` on a
 * miss instead of a loud `exitCli(1)`. Relocated here from
 * `gate-bypass-audit.ts` (which now only re-exports this name, so
 * `commands/gate.ts`'s existing import site is untouched) — see this
 * module's own header for why that relocation matters on its own, not just
 * as a side effect of the resolver collapse.
 *
 * @param locator - the run's `cwd` + `env` (an `Invocation` works)
 * @returns The discovered `.lore/lore.db` absolute path, or `undefined` when
 *   no corpus can be confirmed from `locator.cwd`.
 */
export function findLoreDbPathQuiet(io: CliIo, locator: CorpusLocator): string | undefined {
  return definiteCorpusPath(io, locator);
}

/**
 * The priming probe's resolution: the same corpus path {@link findLoreDbPathQuiet} finds, but a corpus the test
 * sandbox refuses is reported as a miss (`undefined`) instead of ending the run with exit 4.
 *
 * reason: replica priming runs for EVERY command, including corpus-free ones (`--help`, `governance`, `setup --check`),
 * and only reads the config to decide whether to load the sync client. Refusing there broke every sandboxed test that
 * spawns lore at the repo root. The refusal is not weakened: a command that really opens the corpus still goes through
 * {@link resolveCorpus} in `loadLoreApp` and exits 4 there (corpus-free-commands.test.ts pins both halves).
 *
 * @param locator - the run's `cwd` + `env` (an `Invocation` works)
 * @returns the `.lore/lore.db` path, or `undefined` when none is confirmed or the sandbox refuses it
 */
export function findLoreDbPathForPriming(locator: CorpusLocator): string | undefined {
  const resolved = resolveCorpusProvenance({
    cwd: locator.cwd,
    probeExists: existsSync,
    gitFacts: gatherCorpusGitFacts(locator.cwd),
  });
  if (resolved === undefined || resolved.provenance === "undetermined") return undefined;
  if (findSandboxRefusal(resolved.path, locator.env) !== undefined) return undefined;
  return resolved.path;
}
