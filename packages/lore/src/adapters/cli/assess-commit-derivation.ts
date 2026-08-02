/**
 * Derives a plan's OWN commit set directly from git history, instead of asking the
 * caller for a git range (defect: task-lore-assess-asks-the-caller-for-a-git-range-
 * that-cannot-be). Under concurrency a plan's commits are NOT contiguous in `main` —
 * other sessions merge between them — so there is no correct contiguous range to ask
 * for (measured 2026-08-01: a naive "first task commit .. last task commit" range
 * pulled in 6 foreign commits out of 13, ≈46% foreign content). This module finds a
 * plan's own commits by their CONTENT (an exact, `--fixed-strings` git-grep match of
 * each task's slug against commit messages) rather than their POSITION.
 *
 * Shared by both adapters that create an assessment (CLI `commands/assess.ts`, MCP
 * `../mcp/tools.ts`) — mirrors the existing cross-adapter sharing precedent already in
 * this directory (`task-feed-wiring.ts`, `phase-wiring.ts`, `evidence-precheck.ts` all
 * live under `adapters/cli/` and are imported by `../mcp/tools.ts` too).
 *
 * Algorithm:
 *   1. Per task slug: `git log --fixed-strings --grep=<slug> --format=%H%x09%s` over
 *      HEAD's reachable history (deliberately NOT `--all` — that would also sweep in
 *      stray unmerged branches; HEAD's history already contains every MERGED branch's
 *      commits, which is what "this plan's own commits" means once work has landed).
 *   2. Union the matched shas across every task, remembering which task slug(s) each
 *      one matched (AC #3 transparency — an auditor can see exactly which tasks
 *      contributed which commits, and which tasks contributed none).
 *   3. Prune to MAXIMAL elements under the ancestor order (`git merge-base
 *      --is-ancestor`): if matched commit A is an ancestor of matched commit B, A's
 *      diff is already subsumed by B's (a merge commit subsumes its own branch's inner
 *      commits when a message happens to reference the same task slug on both) — only
 *      B needs diffing, keeping the recorded commit list free of double-counted work.
 *   4. Diff each maximal commit against its OWN first parent only (`git diff <sha>^1
 *      <sha>`, or the empty tree for a root commit). This first-parent-only diff is
 *      what makes the mechanism immune to interleaving: it is EXACTLY what that one
 *      step introduced, regardless of how many foreign commits sit before/after it
 *      anywhere else in main's history.
 *   5. Concatenate the maximal commits' diffs, oldest first, into one diff text.
 *
 * Zero matched commits — a plan with genuinely no discoverable commits yet, OR one
 * whose history was squashed/rewritten and no longer mentions any task slug — is
 * INDISTINGUISHABLE from either cause by this mechanism, and is reported as the SAME
 * named `"no_commits_found"` status. It is never silently downgraded to an empty
 * `"derived"` diff — that would be the false-green form of the very defect this module
 * exists to fix (`diff_available=true` on an empty diff reads as "audited").
 *
 * `"unverifiable_convention_mismatch"` (task-lore-assess-derives-a-plan-s-commits-by-
 * grepping-task): the ONE sub-case of "zero matched commits" that is NOT a legitimate
 * absence — every one of this plan's tasks is already `archived`, which by the lifecycle
 * graph (`VALID_TRANSITIONS`, `@lore/core`) means merged work exists. Zero matched commits
 * in that state is a CONTRADICTION: it proves the `--grep=<slug>` convention this module
 * relies on was not followed (a conventionally-worded commit, e.g. Conventional Commits,
 * never mentions the task slug), not that no work happened. The caller passes
 * `allTasksArchived` (computed from the DocRecord statuses it already holds — this module
 * stays free of any `@lore/core`/DocStatus dependency, mirroring its existing pure
 * git-log-wrapper scope) to distinguish this from genuine absence. See this function's own
 * JSDoc for the ADR three-question review this status answers.
 *
 * Source: task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be; SPEC-026 §3
 * D3 (diff acquisition is an adapter-layer concern, never the service layer);
 * task-lore-assess-derives-a-plan-s-commits-by-grepping-task;
 * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
 */

import { spawnSync } from "node:child_process";

/** Explicit maxBuffer — the 1 MiB spawnSync default silently truncates a growing diff/log payload. */
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

/** git's well-known empty-tree object — the diff base for a root commit (no parents). */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** One commit selected into the derived diff, and which task slug(s) referenced it. */
export interface DerivedCommit {
  sha: string;
  subject: string;
  matched_task_slugs: string[];
}

/**
 * Result of {@link deriveCommitSetForPlan} — always returned, never throws. `warnings`
 * collects non-fatal git-command failures (e.g. a transient `merge-base` error) —
 * informational only, never a reason to fail the whole derivation.
 *
 * @invariant `"no_commits_found"` and `"unverifiable_convention_mismatch"` are DISTINCT
 *   values, never collapsed into one shared empty result (SPEC per
 *   adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the Q2: "an empty result
 *   and a clean result must not be the same value"). `"no_commits_found"` means "this
 *   plan plausibly has no merged work yet" (a legitimate, scoreable absence);
 *   `"unverifiable_convention_mismatch"` means "this plan's tasks are ALL archived
 *   (merged work is a certainty) yet zero commits matched — the commit-message
 *   convention was not followed, not that nothing happened" (a contradiction; the
 *   dimension it would otherwise inform must be reported unverifiable, never scored).
 */
export interface CommitDerivationResult {
  status: "derived" | "no_commits_found" | "unverifiable_convention_mismatch";
  commits: DerivedCommit[];
  /** Task slugs for which NO commit anywhere in history mentioned them at all. */
  tasks_without_commits: string[];
  /** Concatenated unified diff across every selected commit, oldest first. `""` unless status is `"derived"`. */
  diff_text: string;
  warnings: string[];
}

/**
 * How a `lore assess` run's diff (if any) was obtained — persisted on the created
 * assessment doc's `extra.diff_source` (additive `.passthrough()` key, never a core
 * `assessmentResultSchema` change) and surfaced in both adapters' `--json`/MCP
 * envelopes, so `diff_available` alone is never the only auditable signal (AC #3,
 * task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be).
 */
export type DiffSourceRecord =
  | { mode: "explicit_diff"; range: string }
  | { mode: "explicit_diff_file"; path: string }
  /** MCP-only override — the caller passed pre-acquired `diff_text` directly (MCP has no subprocess/file-read seam of its own). */
  | { mode: "explicit_diff_text" }
  | ({ mode: "auto_derived" } & CommitDerivationResult);

/** Runs one git subprocess; never throws — failures are reported via the returned shape. */
function runGit(cwd: string, args: string[]): { ok: true; stdout: string } | { ok: false; warning: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
  if (result.error) {
    return { ok: false, warning: `git ${args.join(" ")}: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const reason = (result.stderr ?? "").trim() || `exit ${String(result.status)}`;
    return { ok: false, warning: `git ${args.join(" ")}: ${reason}` };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}

/** Every commit whose message contains `token` verbatim (exact-substring, no regex ambiguity). */
function findCommitsReferencing(
  cwd: string,
  token: string,
  warnings: string[],
): { sha: string; subject: string }[] {
  if (token.length === 0) return [];
  const result = runGit(cwd, ["log", "--fixed-strings", `--grep=${token}`, "--format=%H%x09%s"]);
  if (!result.ok) {
    warnings.push(result.warning);
    return [];
  }
  const commits: { sha: string; subject: string }[] = [];
  for (const line of result.stdout.split("\n")) {
    if (line.length === 0) continue;
    const tabIndex = line.indexOf("\t");
    if (tabIndex === -1) continue;
    commits.push({ sha: line.slice(0, tabIndex), subject: line.slice(tabIndex + 1) });
  }
  return commits;
}

/** `true` iff `maybeAncestor` is a (non-strict) ancestor of `maybeDescendant`. Errors resolve to `false` — never wrongly drop a real commit from the diff set. */
function isAncestor(cwd: string, maybeAncestor: string, maybeDescendant: string, warnings: string[]): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", maybeAncestor, maybeDescendant], {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error) {
    warnings.push(`git merge-base --is-ancestor: ${result.error.message}`);
    return false;
  }
  // exit 0 = true (is an ancestor), 1 = false, anything else = a real error.
  return result.status === 0;
}

/**
 * Drops a matched commit `a` ONLY when its changes are already fully captured by
 * another matched commit `b`'s own first-parent-only diff (`b^1..b`) — i.e. `a` became
 * reachable from `b` EXCLUSIVELY at that one step (a merge's non-first-parent side),
 * not before it.
 *
 * This is deliberately NOT a plain "is `a` an ancestor of `b`" test: on a linear
 * (non-merge) history, EVERY earlier commit is trivially an ancestor of every later
 * one, but `b^1..b` only shows what `b` itself introduced — it does NOT subsume an
 * earlier sibling commit `a` sitting further back on the same line (that is exactly
 * the interleaving case this module exists to handle correctly). The extra
 * "AND NOT an ancestor of `b`'s own first parent" check is what tells apart "`a` is
 * only reachable via the branch `b` merged in" (safe to drop — subsumed) from "`a` is
 * mainline history that predates `b`" (must keep its own diff).
 */
function isSubsumedByFirstParentDiff(
  cwd: string,
  a: string,
  b: string,
  bFirstParent: string | undefined,
  warnings: string[],
): boolean {
  if (!isAncestor(cwd, a, b, warnings)) return false;
  if (bFirstParent === undefined) return false; // b is a root commit — nothing subsumes into it
  return !isAncestor(cwd, a, bFirstParent, warnings);
}

/** Drops every sha whose diff is already fully captured by another matched sha's own first-parent diff — keeps only the "tips" needed for a complete, non-duplicated diff. */
function selectMaximal(shas: string[], cwd: string, warnings: string[]): string[] {
  const dropped = new Set<string>();
  const firstParentCache = new Map<string, string | undefined>();
  const firstParentOf = (sha: string): string | undefined => {
    if (!firstParentCache.has(sha)) {
      firstParentCache.set(sha, parentsOf(cwd, sha, warnings)[0]);
    }
    return firstParentCache.get(sha);
  };

  for (const a of shas) {
    if (dropped.has(a)) continue;
    for (const b of shas) {
      if (a === b || dropped.has(b)) continue;
      if (isSubsumedByFirstParentDiff(cwd, a, b, firstParentOf(b), warnings)) {
        dropped.add(a);
        break;
      }
    }
  }
  return shas.filter((sha) => !dropped.has(sha));
}

/** Orders `shas` oldest-first by their position in HEAD's history (one `git log` call, not one per sha). */
function orderByHistory(cwd: string, shas: string[], warnings: string[]): string[] {
  if (shas.length <= 1) return shas;
  const result = runGit(cwd, ["log", "--format=%H", "--reverse"]);
  if (!result.ok) {
    warnings.push(result.warning);
    return shas;
  }
  const wanted = new Set(shas);
  const ordered: string[] = [];
  for (const line of result.stdout.split("\n")) {
    if (wanted.has(line)) ordered.push(line);
  }
  // Defensive: a sha absent from this HEAD-history walk (shouldn't happen — every matched sha
  // came FROM a HEAD-reachable git-log call above) still gets included, appended at the end,
  // rather than silently dropped.
  for (const sha of shas) {
    if (!ordered.includes(sha)) ordered.push(sha);
  }
  return ordered;
}

/** The immediate parent shas of `sha` (0 for a root commit, 2+ for a merge commit). */
function parentsOf(cwd: string, sha: string, warnings: string[]): string[] {
  const result = runGit(cwd, ["rev-list", "--parents", "-1", sha]);
  if (!result.ok) {
    warnings.push(result.warning);
    return [];
  }
  const tokens = result.stdout.trim().split(/\s+/).filter((t) => t.length > 0);
  return tokens.slice(1); // drop the sha itself, keep parent sha(s)
}

/** `git diff <first-parent-or-empty-tree> <sha>` — exactly what this ONE commit introduced. */
function diffAgainstFirstParent(cwd: string, sha: string, warnings: string[]): string {
  const parents = parentsOf(cwd, sha, warnings);
  const base = parents[0] ?? EMPTY_TREE_SHA;
  const result = runGit(cwd, ["diff", base, sha]);
  if (!result.ok) {
    warnings.push(result.warning);
    return "";
  }
  return result.stdout;
}

/**
 * Derives the commit set + assembled diff for a plan's own tasks. Never throws — every
 * git-command failure degrades to an empty match for that step, surfaced in `warnings`.
 *
 * ADR three-question review (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the),
 * for the `allTasksArchived` → `"unverifiable_convention_mismatch"` branch specifically:
 *   1. **Proxy** — "every task archived" is a proxy for "merged work exists", not the
 *      property itself. Concrete input satisfying the proxy while the property still
 *      somehow failed: none is known — the lifecycle graph (`VALID_TRANSITIONS`)
 *      structurally requires a task to have passed through review/evidence gates to reach
 *      `archived`, so this proxy is as strong as the lifecycle graph it reads. What it
 *      does NOT distinguish (deliberately, per the task's own oracle) is genuinely-lost
 *      history (squashed/rewritten) from a convention mismatch — both are real causes of
 *      "cannot verify", and both get the identical honest answer.
 *   2. **Silence** — this is precisely what closes: zero commits on an all-archived plan
 *      used to collapse into the SAME `"no_commits_found"` value a genuinely-empty plan
 *      gets, which downstream (`AIProviderService.assessPlan`) let an absence-based
 *      `scope_fidelity` score publish as a real finding. `"unverifiable_convention_mismatch"`
 *      is a distinct, named value a caller MUST branch on — never a bare boolean/empty
 *      collapse.
 *   3. **Opt-in** — CLOSED (task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan):
 *      `allTasksArchived` is now a REQUIRED third parameter — no default, no `?`. It was
 *      briefly optional-with-a-default ONLY so the pre-existing 2-arg
 *      `deriveCommitSetForPlan(cwd, taskSlugs)` call site in `../mcp/tools.ts` kept
 *      compiling while a concurrent session's file anchors excluded that file — which is
 *      exactly the proxy that let the MCP adapter's omission go unnoticed by the type
 *      checker (it still compiled, still passed all 12 pre-existing tests, and still
 *      silently reported `"no_commits_found"` for the contradiction state). Both adapters
 *      that create an assessment (CLI `commands/assess.ts`, MCP `../mcp/tools.ts`) now
 *      compute this fact from their own already-loaded `bundle.tasks` and MUST pass it — a
 *      third adapter that forgets fails `bun run typecheck`, not silently at runtime.
 *
 * @param cwd - Repository root to run git in (callers pass `process.cwd()` in
 *   production; tests pass a throwaway `git init` fixture directory).
 * @param taskSlugs - Every task-in-plan's slug (`bundle.tasks.map(t => t.slug)`).
 * @param allTasksArchived - REQUIRED. Whether EVERY task in the plan already has
 *   `status === "archived"` (caller-computed — this module never imports `@lore/core`'s
 *   `DocStatus` to stay a pure git wrapper). No default: every caller must compute and
 *   pass this fact explicitly (task-the-mcp-assess-adapter-still-calls-
 *   derivecommitsetforplan — see the ADR three-question review above, Q3).
 * @returns `status: "no_commits_found"` when NOT ONE task slug appears in ANY commit
 *   message reachable from `cwd`'s HEAD AND `allTasksArchived` is `false` — a named,
 *   honest boundary state, never a silent empty `"derived"` diff. `status:
 *   "unverifiable_convention_mismatch"` for that SAME zero-match condition when
 *   `allTasksArchived` IS `true` — a distinct value, never collapsed with the above.
 *
 * @example
 * deriveCommitSetForPlan("/repo", ["task-own-a", "task-own-b"], false);
 * // → { status: "derived", commits: [...], tasks_without_commits: [], diff_text: "...", warnings: [] }
 * @example
 * deriveCommitSetForPlan("/repo", ["task-archived-a"], true); // every task archived, zero matches
 * // → { status: "unverifiable_convention_mismatch", commits: [], tasks_without_commits: ["task-archived-a"], diff_text: "", warnings: [] }
 */
export function deriveCommitSetForPlan(
  cwd: string,
  taskSlugs: string[],
  allTasksArchived: boolean,
): CommitDerivationResult {
  const warnings: string[] = [];
  const matchedBySha = new Map<string, { subject: string; taskSlugs: Set<string> }>();
  const tasksWithoutCommits: string[] = [];

  for (const slug of taskSlugs) {
    const matches = findCommitsReferencing(cwd, slug, warnings);
    if (matches.length === 0) {
      tasksWithoutCommits.push(slug);
      continue;
    }
    for (const match of matches) {
      const existing = matchedBySha.get(match.sha);
      if (existing) {
        existing.taskSlugs.add(slug);
      } else {
        matchedBySha.set(match.sha, { subject: match.subject, taskSlugs: new Set([slug]) });
      }
    }
  }

  if (matchedBySha.size === 0) {
    return {
      // reason: zero matches on an all-archived plan is a CONTRADICTION (archived tasks
      // have merged work by definition) — reported as a distinct, named "cannot verify"
      // value, never silently folded into the same "no_commits_found" a genuinely
      // commit-less (still in-progress) plan gets. See this function's own JSDoc/the
      // module header for the ADR three-question review this answers.
      status: allTasksArchived ? "unverifiable_convention_mismatch" : "no_commits_found",
      commits: [],
      tasks_without_commits: [...taskSlugs],
      diff_text: "",
      warnings,
    };
  }

  const allShas = [...matchedBySha.keys()];
  const maximalShas = selectMaximal(allShas, cwd, warnings);
  const ordered = orderByHistory(cwd, maximalShas, warnings);

  const commits: DerivedCommit[] = ordered.map((sha) => {
    const entry = matchedBySha.get(sha);
    // Every sha in `ordered` originated from `maximalShas` <- `allShas` <- `matchedBySha`'s own
    // keys, so this lookup cannot miss — the fallback below is a defensive shape, not a hope.
    const safeEntry = entry ?? { subject: "", taskSlugs: new Set<string>() };
    return { sha, subject: safeEntry.subject, matched_task_slugs: [...safeEntry.taskSlugs].sort() };
  });

  const diffText = ordered.map((sha) => diffAgainstFirstParent(cwd, sha, warnings)).join("");

  return {
    status: "derived",
    commits,
    tasks_without_commits: tasksWithoutCommits,
    diff_text: diffText,
    warnings,
  };
}
