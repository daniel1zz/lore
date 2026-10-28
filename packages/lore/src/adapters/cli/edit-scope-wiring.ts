/**
 * edit-scope-wiring.ts — composes the edit-scope service's ports from the App and keeps the per-worktree
 * `.lore-scope.json` current for the verbs that change a claim's anchors.
 *
 * Purpose: one place builds {@link EditScopeDeps} (used by `lore anchor scope|declare`) and one place refreshes the
 * scope file the PreToolUse hook `pre-edit-anchor-gate.mjs` reads, so `claim`, `release` and `anchor add|rm|declare`
 * all call the same two functions.
 * Public surface: {@link buildEditScopeDeps}, {@link scopeCandidatesOf}, {@link refreshScopeFilesOf}.
 * Side-effect class: IO (git spawns, the scope file, `.git/info/exclude`).
 *
 * @invariant The scope file is an optimisation, never an authority: the hook treats a missing, unreadable or
 *   empty file as "ask `lore anchor scope`". A refresh that fails removes the file and warns (stale is worse
 *   than absent); it never fails the verb that triggered it.
 * @invariant The file is made git-ignored through the repository's `info/exclude` (shared by every worktree of the
 *   repo, never committed), so it cannot dirty a worktree and trip the uncommitted-worktree attestation guard in a
 *   repository whose `.gitignore` does not name it.
 */

import { appendFileSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { extractHeldClaim } from "@lore/core";
import { SCOPE_FILE_NAME, refreshScopeFiles, type EditScopeDeps } from "../../service/edit-scope.js";
import { spawnGitCheckIgnore } from "../../service/git-ignore-probe.js";
import type { App } from "../../app.js";

/** git's answer for `args` run in `cwd`, or `undefined` when git cannot answer (not a repo, git missing). */
function gitOut(cwd: string, args: readonly string[]): string | undefined {
  const run = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : undefined;
}

/** Appends the scope file's name to the repository's `info/exclude` unless git already ignores it in `workingCopy`. */
function ensureScopeFileIgnored(workingCopy: string): void {
  const ignored = spawnSync("git", ["-C", workingCopy, "check-ignore", "-q", "--", SCOPE_FILE_NAME]);
  if (ignored.status === 0) return;
  if (ignored.status !== 1) throw new Error(`git check-ignore failed in ${workingCopy} (exit ${String(ignored.status)})`);
  const excludePath = gitOut(workingCopy, ["rev-parse", "--git-path", "info/exclude"]);
  if (excludePath === undefined) throw new Error(`cannot locate info/exclude of ${workingCopy}`);
  const file = resolve(workingCopy, excludePath);
  mkdirSync(dirname(file), { recursive: true });
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  appendFileSync(file, `${existing === "" || existing.endsWith("\n") ? "" : "\n"}${SCOPE_FILE_NAME}\n`);
}

/** The default-branch names a claim's commits are compared against, first that resolves wins. */
const DEFAULT_BRANCH_CANDIDATES = ["main", "master", "trunk"] as const;

/** The working-copy directory a claim's recorded `worktree` names: an absolute path, or a branch name of `fromWorkingCopy`'s repository. */
function resolveClaimWorkingCopy(worktree: string | undefined, fromWorkingCopy: string): string | undefined {
  if (worktree === undefined || worktree === "") return undefined;
  if (isAbsolute(worktree)) return existsSync(worktree) ? worktree : undefined;
  const listing = gitOut(fromWorkingCopy, ["worktree", "list", "--porcelain"]);
  if (listing === undefined) return undefined;
  for (const block of listing.split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    const branch = lines.find((l) => l.startsWith("branch "))?.slice("branch refs/heads/".length);
    if (path !== undefined && branch === worktree) return path;
  }
  return undefined;
}

/** git's UNTRIMMED stdout (a `-z` status line starts with a space that `gitOut`'s trim would eat), or `undefined` on failure. */
function gitRaw(cwd: string, args: readonly string[]): string | undefined {
  const run = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return run.status === 0 ? run.stdout : undefined;
}

/** NUL-separated git output as a list of non-empty entries. */
function nulList(out: string): string[] {
  return out.split("\0").filter((entry) => entry !== "");
}

/** See {@link EditScopeDeps.touchedFiles}: uncommitted changes (incl. untracked) plus commits since the default branch. */
function touchedFilesOf(worktree: string | undefined, fromWorkingCopy: string): readonly string[] | undefined {
  const dir = resolveClaimWorkingCopy(worktree, fromWorkingCopy);
  if (dir === undefined) return undefined;
  const status = gitRaw(dir, ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"]);
  if (status === undefined) return undefined;
  // `-z` entries are `XY path`; the porcelain status prefix is three characters.
  const touched = new Set(nulList(status).map((entry) => entry.slice(3)));
  const base = DEFAULT_BRANCH_CANDIDATES.find((name) => gitOut(dir, ["rev-parse", "--verify", "--quiet", name]) !== undefined);
  if (base !== undefined) {
    const committed = gitRaw(dir, ["diff", "--name-only", "-z", `${base}...HEAD`]);
    if (committed === undefined) return undefined;
    for (const file of nulList(committed)) touched.add(file);
  }
  return [...touched];
}

/** Wires {@link EditScopeDeps} from the App's services. Throws when the App lacks `runService` (mis-composed). */
export function buildEditScopeDeps(app: App): EditScopeDeps {
  if (app.runService === undefined) throw new Error("App was built without a runService");
  const runService = app.runService;
  return {
    openClaimsOfWorkingCopy: (workingCopy) => runService.openClaimsOfWorkingCopy(workingCopy),
    openClaimsOfProject: () => runService.openClaimsOfProject(),
    claimIsLive: (task, nowIso, endedRuns) => app.taskWorkflowService.isClaimLive(task, nowIso, endedRuns),
    getTask: async (slug) => {
      const found = await app.corpusService.get(slug);
      return found.ok ? { ok: true, value: found.value.doc } : found;
    },
    listTasks: async () => {
      const listed = await app.corpusService.listFull({ type: "task" });
      return listed.ok ? { ok: true, value: listed.value.docs } : listed;
    },
    buildSiblingContext: (by, candidate, siblings, nowIso) =>
      app.taskWorkflowService.buildAnchorGateContext(by, candidate, siblings, nowIso),
    addAnchors: (slug, anchors, opts) => app.taskWorkflowService.addAnchors(slug, anchors, opts),
    ignoreProbe: spawnGitCheckIgnore,
    touchedFiles: touchedFilesOf,
    realpath: (path) => realpathSync(path),
    now: () => new Date().toISOString(),
    hasScopeFile: (workingCopy) => existsSync(join(workingCopy, SCOPE_FILE_NAME)),
    writeScopeFile: (workingCopy, text) => {
      ensureScopeFileIgnored(workingCopy);
      const target = join(workingCopy, SCOPE_FILE_NAME);
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, text);
      renameSync(temp, target);
    },
    removeScopeFile: (workingCopy) => rmSync(join(workingCopy, SCOPE_FILE_NAME), { force: true }),
  };
}

/**
 * The working copies whose scope file `slug`'s verbs may change: the directory its claim recorded (when that is an
 * absolute path) and the git working copy `cwd` sits in (a claim by branch name is usually made from inside the
 * worktree). Call BEFORE a release, which erases the claim.
 */
export async function scopeCandidatesOf(app: App, slug: string, cwd: string, extra: readonly string[] = []): Promise<string[]> {
  const found: string[] = [...extra.filter((p) => isAbsolute(p))];
  const doc = await app.corpusService.get(slug);
  if (doc.ok) {
    const recorded = extractHeldClaim(doc.value.doc)?.worktree;
    if (recorded !== undefined && isAbsolute(recorded)) found.push(recorded);
  }
  const top = gitOut(cwd, ["rev-parse", "--show-toplevel"]);
  if (top !== undefined) found.push(top);
  return found.filter((p) => existsSync(p)).map((p) => realpathSync(p));
}

/** Refreshes the scope files of `candidates` after a verb changed `slug`'s claim or anchors; warns per failure. */
export async function refreshScopeFilesOf(app: App, slug: string, candidates: readonly string[]): Promise<void> {
  for (const problem of await refreshScopeFiles(buildEditScopeDeps(app), slug, candidates)) app.warn(`lore: ${problem}`);
}
