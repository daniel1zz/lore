/**
 * Module: changed-files — the branch's own diff against main, for the `--changed` modes of the three landing checks
 * (BR-1368, AC-LG-5; reference: Nx/Bazel "affected").
 *
 * Purpose: `lore integrate` runs the floor inside its integration worktree with the branch merged onto main
 * (TARGET_NAME "main" in integrate-service.ts), so the branch's own change is `git diff <merge-base(HEAD, main)>`.
 * Public surface: `parseNameStatus` (pure), `resolveBase`, `changedFiles`, `wantsChanged`.
 * Invariants: an unresolvable base is a thrown error (never "no changes" - that would pass every branch); a rename
 * lists BOTH sides (the old path is a deletion the checks must see).
 * Side-effect class: IO in `resolveBase` / `changedFiles` (spawns git); the rest is pure.
 */
import { spawnSync } from "node:child_process";

/** One path touched by the diff. `A` added, `M` modified, `D` deleted; a rename is a `D` of the old path plus an `A` of the new. */
export interface ChangedFile {
  readonly status: "A" | "M" | "D";
  readonly path: string;
}

/** Env var that overrides the base ref (default: `git merge-base HEAD main`). */
export const FLOOR_BASE_ENV = "LORE_FLOOR_BASE";

/** True when argv asks for the changed mode. */
export function wantsChanged(argv: readonly string[]): boolean {
  return argv.includes("--changed");
}

/** Pure. Parse `git diff --name-status -M` output; renames and copies expand to D(old) + A(new). */
export function parseNameStatus(text: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const [code, first, second] = line.split("\t");
    const kind = (code ?? "").charAt(0);
    if (first === undefined) throw new Error(`changed-files: unparsable name-status line: ${line}`);
    if (kind === "R" || kind === "C") {
      if (second === undefined) throw new Error(`changed-files: rename line without a new path: ${line}`);
      if (kind === "R") out.push({ status: "D", path: first });
      out.push({ status: "A", path: second });
    } else if (kind === "A" || kind === "M" || kind === "D") {
      out.push({ status: kind, path: first });
    } else if (kind === "T") {
      out.push({ status: "M", path: first });
    } else {
      throw new Error(`changed-files: unknown status '${code ?? ""}' in: ${line}`);
    }
  }
  return out;
}

function git(cwd: string, args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? r.error?.message ?? "" };
}

/** The diff base: `LORE_FLOOR_BASE` when set, else `git merge-base HEAD main`. @throws Error when neither resolves. */
export function resolveBase(cwd: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const fromEnv = env[FLOOR_BASE_ENV];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const r = git(cwd, ["merge-base", "HEAD", "main"]);
  const base = r.stdout.trim();
  if (r.status !== 0 || base === "") throw new Error(`changed-files: cannot resolve the diff base (git merge-base HEAD main exited ${r.status}: ${r.stderr.trim()}); set ${FLOOR_BASE_ENV}`);
  return base;
}

/** Every path the working tree changes against `base` (committed and tracked-uncommitted). @throws Error when git fails. */
export function changedFiles(cwd: string, base: string): ChangedFile[] {
  const r = git(cwd, ["diff", "--name-status", "-M", "--no-color", base]);
  if (r.status !== 0) throw new Error(`changed-files: git diff against ${base} exited ${r.status}: ${r.stderr.trim()}`);
  return parseNameStatus(r.stdout);
}
