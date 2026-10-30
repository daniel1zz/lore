/**
 * The reviewer's diff of a plan: each changed file's NET diff, so what is judged is the file's final state in the plan,
 * never an intermediate landing's version (BR-1508, AC-FS-1).
 *
 * Purpose: for every file the plan's landings touched, one `git diff` from the earliest touching landing's `main_before` to
 *   the main commit that brought in the LAST touching landing. This replaces the old union of per-landing diffs; there is no
 *   second diff path.
 * Public surface: buildFinalStateDiff, FinalStateDiff, NetFileDiff, LandingRange.
 * Invariants:
 *   - A landing is placed on main by `findFirstParentCommitContaining` (the one landing-to-main-commit mapping, shared with
 *     regression at head). A landing it cannot place contributes NO diff; its files are `not_seen_files`, so security is
 *     not measured over them (never a pass over a file nobody read).
 *   - A rename is followed through the landings: the file appears once, under its final name, with the rename named.
 *   - A file added and later deleted has an empty net diff and is omitted.
 *   - Commits on main inside a file's range that are not this plan's landings are NAMED in the file's section, so the
 *     reviewer can tell another plan's change from the plan's own.
 *   - Every git failure becomes a warning and an unseen entry; nothing is read as "no change" on failure.
 * Side-effect class: IO (read-only `git` in `cwd`).
 *
 * @spec_ref spec-the-milestone-review-judges-each-file-s-final-state-in-the (AC-FS-1, BR-1508)
 */

import { spawnSync } from "node:child_process";
import { findFirstParentCommitContaining } from "./assess-regression-git.js";

/** Explicit maxBuffer: the 1 MiB spawnSync default silently truncates a growing diff payload. */
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

/** A landing's range as `lore integrate` recorded it. */
export interface LandingRange {
  readonly landing_commit: string;
  readonly main_before: string;
}

/** One file of the net diff: its final name, where it started, and the range the diff covers. */
export interface NetFileDiff {
  readonly path: string;
  /** The name at the start of the range; differs from `path` when the plan renamed the file. */
  readonly renamed_from: string | undefined;
  readonly range_start: string;
  readonly range_end: string;
  /** Commits on main inside the range, touching this file, that are not this plan's landings. */
  readonly other_commits: readonly { readonly sha: string; readonly subject: string }[];
}

/** What {@link buildFinalStateDiff} returns; never throws. */
export interface FinalStateDiff {
  /** One `git diff` section per file with a non-empty net diff, sorted by final path; `""` when none. */
  readonly diff_text: string;
  readonly files: readonly NetFileDiff[];
  /** Files of landings that could not be mapped to main: no call shows them, so gates over them are not-measured. */
  readonly not_seen_files: readonly string[];
  readonly warnings: readonly string[];
}

interface Lineage {
  startPath: string;
  path: string;
  start: string;
  end: string;
}

type GitOutcome = { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly warning: string };

function runGit(cwd: string, env: NodeJS.ProcessEnv, args: readonly string[]): GitOutcome {
  const r = spawnSync("git", [...args], { cwd, env, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
  if (r.error) return { ok: false, warning: `git ${args.join(" ")}: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, warning: `git ${args.join(" ")}: ${(r.stderr ?? "").trim() || `exit ${String(r.status)}`}` };
  return { ok: true, stdout: r.stdout ?? "" };
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line.length > 0);

/** Inserts the note lines right after a section's `diff --git` header so the file's section stays one unit when chunked. */
function annotate(section: string, notes: readonly string[]): string {
  const newline = section.indexOf("\n");
  if (newline === -1 || notes.length === 0) return section;
  return `${section.slice(0, newline + 1)}${notes.map((n) => `# lore: ${n}\n`).join("")}${section.slice(newline + 1)}`;
}

/**
 * Builds the plan's net per-file diff.
 *
 * @param cwd - repository root
 * @param env - environment for git
 * @param ref - main (or the assessed commit): the first-parent chain landings are placed on
 * @param landings - the plan's distinct, non-empty landings
 * @returns the diff text, the per-file facts, the not-seen files and warnings
 *
 * @example
 * buildFinalStateDiff(repo, process.env, "main", [{ landing_commit: "abc", main_before: "def" }]).diff_text
 */
export function buildFinalStateDiff(cwd: string, env: NodeJS.ProcessEnv, ref: string, landings: readonly LandingRange[]): FinalStateDiff {
  const warnings: string[] = [];
  const notSeen = new Set<string>();
  const chain = runGit(cwd, env, ["rev-list", "--first-parent", "--reverse", ref]);
  const chainIndex = new Map<string, number>();
  if (chain.ok) lines(chain.stdout).forEach((sha, i) => chainIndex.set(sha, i));
  else warnings.push(chain.warning);

  const mapped: { landing: LandingRange; mainCommit: string }[] = [];
  for (const landing of landings) {
    // reason: a landing commit already ON main's first-parent chain is its own main commit; the containment lookup only
    // places a commit that is off the chain (a branch merged into a branch that landed) and excludes the commit itself.
    const placed = chainIndex.has(landing.landing_commit)
      ? ({ ok: true, value: landing.landing_commit } as const)
      : findFirstParentCommitContaining(cwd, env, landing.landing_commit, ref);
    if (placed.ok && placed.value !== undefined && chainIndex.has(placed.value)) {
      mapped.push({ landing, mainCommit: placed.value });
      continue;
    }
    if (!placed.ok) warnings.push(`cannot place landing ${landing.landing_commit} on ${ref}: ${placed.error.code}`);
    const listed = runGit(cwd, env, ["diff", "--name-only", landing.main_before, landing.landing_commit]);
    if (listed.ok) for (const file of lines(listed.stdout)) notSeen.add(file);
    else {
      warnings.push(listed.warning);
      notSeen.add(`landing:${landing.landing_commit}`);
    }
  }
  mapped.sort((a, b) => (chainIndex.get(a.mainCommit) ?? 0) - (chainIndex.get(b.mainCommit) ?? 0));

  const lineages = new Map<string, Lineage>();
  for (const { landing, mainCommit } of mapped) {
    const status = runGit(cwd, env, ["diff", "--name-status", "-M", landing.main_before, landing.landing_commit]);
    if (!status.ok) {
      warnings.push(status.warning);
      notSeen.add(`landing:${landing.landing_commit}`);
      continue;
    }
    for (const row of lines(status.stdout)) {
      const [code = "", first = "", second] = row.split("\t");
      const moved = (code.startsWith("R") || code.startsWith("C")) && second !== undefined;
      const from = first;
      const to = moved ? second : first;
      const known = lineages.get(from);
      if (code.startsWith("R") && known !== undefined) {
        lineages.delete(from);
        known.path = to;
        known.end = mainCommit;
        lineages.set(to, known);
      } else if (known !== undefined) {
        known.end = mainCommit;
      } else {
        lineages.set(to, { startPath: code.startsWith("R") ? from : to, path: to, start: landing.main_before, end: mainCommit });
      }
    }
  }

  const ownCommits = new Set(mapped.map((m) => m.mainCommit));
  const files: NetFileDiff[] = [];
  const sections: string[] = [];
  for (const l of [...lineages.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const paths = l.startPath === l.path ? [l.path] : [l.startPath, l.path];
    const diff = runGit(cwd, env, ["diff", "-M", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", l.start, l.end, "--", ...paths]);
    if (!diff.ok) {
      warnings.push(diff.warning);
      notSeen.add(l.path);
      continue;
    }
    if (diff.stdout.trim().length === 0) continue;
    const history = runGit(cwd, env, ["log", "--first-parent", "--format=%H%x09%s", `${l.start}..${l.end}`, "--", ...paths]);
    if (!history.ok) warnings.push(history.warning);
    const other = (history.ok ? lines(history.stdout) : [])
      .map((row) => ({ sha: row.slice(0, row.indexOf("\t")), subject: row.slice(row.indexOf("\t") + 1) }))
      .filter((c) => !ownCommits.has(c.sha));
    const renamedFrom = l.startPath === l.path ? undefined : l.startPath;
    files.push({ path: l.path, renamed_from: renamedFrom, range_start: l.start, range_end: l.end, other_commits: other });
    const notes = [
      `net diff of ${l.path}: from ${l.start.slice(0, 12)} to main commit ${l.end.slice(0, 12)} (the file's final state in this plan; intermediate landings are not shown)`,
      ...(renamedFrom !== undefined ? [`renamed from ${renamedFrom} (shown once, under its final name ${l.path})`] : []),
      ...other.map((c) => `another plan's commit inside this range: ${c.sha.slice(0, 12)} ${c.subject}`),
    ];
    sections.push(annotate(diff.stdout, notes));
  }
  return { diff_text: sections.join(""), files, not_seen_files: [...notSeen].sort(), warnings };
}
