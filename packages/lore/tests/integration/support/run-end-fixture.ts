/**
 * Shared fixture for the run-end suites (AC-ROI-4, AC-ROI-5, AC-ROI-6).
 *
 * @spec_ref AC-ROI-4, AC-ROI-5, AC-ROI-6
 *   (spec-run-only-write-identity-and-run-end-claim-release D4/D5; BR-1057, BR-1058, BR-1029)
 *
 * Builds on `cli/support/claim-run-fixture.ts` (real CLI against an mkdtemp corpus made by `lore init`,
 * never the repo's own `.lore/`) and adds:
 *   - REAL temp git repositories (clean / dirty) to serve as a claim's `--worktree` — the dirtiness
 *     measurement under test is a real `git status`, so a fake would prove nothing;
 *   - read-only SQLite probes of the `runs` row and the newest audit row (the CLI exposes no
 *     `ended_at` and no audit-details reader).
 *
 * Side-effect class: IO (temp dirs, spawned git / lore processes).
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLore, type RunResult } from "../cli/support/claim-run-fixture.js";

export const REASON = "session-end";

/** Run `git` in `cwd`, failing loud: a fixture that silently half-built a repo would invalidate the verdict. */
function git(cwd: string, ...args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd });
  if (proc.exitCode !== 0) throw new Error(`fixture git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
}

const tempDirs: string[] = [];

/** A real git repository with one committed file. Pass `dirty: true` to leave an uncommitted change in it. */
export function makeWorktree(opts: { dirty: boolean }): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "run-end-wt-")));
  tempDirs.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "fixture@example.com");
  git(dir, "config", "user.name", "Fixture");
  writeFileSync(join(dir, "tracked.txt"), "one\n");
  git(dir, "add", "tracked.txt");
  git(dir, "commit", "-q", "-m", "init");
  if (opts.dirty) makeDirty(dir);
  return dir;
}

/** Leaves an uncommitted modification of a tracked file. */
export function makeDirty(dir: string): void {
  writeFileSync(join(dir, "tracked.txt"), "one\ntwo\n");
}

/** Commits whatever is pending, so the worktree reads clean again. */
export function commitAll(dir: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "work");
}

export function cleanupWorktrees(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

function openDb(dir: string): Database {
  return new Database(join(dir, ".lore", "lore.db"), { readonly: true });
}

export interface RunRow {
  ended_at: string | null;
  end_reason: string | null;
  registered_at: string;
}

/** The `runs` row, or null when unregistered. */
export function getRunRow(dir: string, runId: string): RunRow | null {
  const db = openDb(dir);
  try {
    return db.query("SELECT ended_at, end_reason, registered_at FROM runs WHERE id = ?").get(runId) as RunRow | null;
  } finally {
    db.close();
  }
}

/** Row counts of `runs` and `audit`, to prove a no-op wrote nothing. */
export function countRows(dir: string): { runs: number; audit: number } {
  const db = openDb(dir);
  try {
    const runs = db.query("SELECT COUNT(*) AS n FROM runs").get() as { n: number };
    const audit = db.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number };
    return { runs: runs.n, audit: audit.n };
  } finally {
    db.close();
  }
}

/** The newest audit row of `slug`, with `details` parsed. */
export function latestAudit(dir: string, slug: string): { action: string; details: Record<string, unknown> } {
  const db = openDb(dir);
  try {
    const doc = db.query("SELECT id FROM docs WHERE slug = ?").get(slug) as { id: string } | null;
    if (doc === null) throw new Error(`no doc ${slug}`);
    const row = db.query("SELECT action, details FROM audit WHERE doc_id = ? ORDER BY rowid DESC LIMIT 1").get(doc.id) as {
      action: string;
      details: string;
    };
    return { action: row.action, details: JSON.parse(row.details) as Record<string, unknown> };
  } finally {
    db.close();
  }
}

/** Slug of the corpus's one plan (the claim fixture creates exactly one). */
export function planSlug(dir: string): string {
  const db = openDb(dir);
  try {
    const row = db.query("SELECT slug FROM docs WHERE type = 'plan' LIMIT 1").get() as { slug: string } | null;
    if (row === null) throw new Error("no plan in the fixture corpus");
    return row.slug;
  } finally {
    db.close();
  }
}

/** `lore claim <task> [--worktree <wt>] [--steal]` as `run`. No `--by`: the run decides, the name is incidental. */
export function claimAs(dir: string, task: string, run: string, opts: { worktree?: string; steal?: boolean } = {}): RunResult {
  return runLore(
    ["claim", task, ...(opts.worktree !== undefined ? ["--worktree", opts.worktree] : []), ...(opts.steal === true ? ["--steal"] : [])],
    dir,
    run,
  );
}

/** `lore run end <run> --reason <r>`. */
export function endRun(dir: string, run: string, reason: string = REASON): RunResult {
  return runLore(["run", "end", run, "--reason", reason], dir);
}

/** `claim.stale` of `task` in `lore ready <plan> --json`, or undefined when the task has no claim record. */
export function readyClaimStale(dir: string, task: string): boolean | undefined {
  const r = runLore(["ready", planSlug(dir), "--json"], dir);
  if (r.exitCode !== 0) throw new Error(`lore ready failed (${r.exitCode}): ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as {
    data: { ready: { records: { task: { slug: string }; claim?: { stale: boolean } }[] } };
  };
  return parsed.data.ready.records.find((rec) => rec.task.slug === task)?.claim?.stale;
}
