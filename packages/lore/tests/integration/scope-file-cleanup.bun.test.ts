// @spawns packages/lore/src/index.ts
/**
 * The edit-time scope file (`<worktree>/.lore-scope.json`) is lore's own derived state, so it must never keep a
 * finished worktree alive (task-skill-fix-the-edit-time-scope-file-blocks-worktree-cleanup).
 *
 * Real CLI against a THROWAWAY git repo + `lore init` corpus + linked worktree (HOME inside the temp tree); never
 * the repo's own `.lore/` or worktrees. Decisions are read back from the corpus DB's `decision_log`.
 *
 * Coverage:
 *   AC-SFC-1 HAPPY     claim writes the scope file; release (no open claim left) deletes it
 *   AC-SFC-2 REGRESSION a scope file left by a crashed run, every claim closed, does not block the worktree removal
 *                      (`worktree sweep --apply`, the same gate `lore done`'s cleanup calls): removed, no escalated decision record
 *   NEGATIVE           an ignored `.env` beside the scope file still escalates, naming only `.env`
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionActorFor } from "../helpers/session-actor";
import { registerRun, runLore } from "./cli/support/claim-run-fixture.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const RUN = "cc:sfc-sess";
const ACTOR = sessionActorFor("agent:sfc");
const SCOPE = ".lore-scope.json";

let base = "";
let repo = "";
let wt = "";
let task = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function mustLore(args: string[], cwd: string, withRun = true): string {
  const r = withRun ? runLore(args, cwd, RUN, ACTOR) : runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`\`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

/** Verdicts of every worktree-remove decision record, oldest first (an `auto` one is the normal removal record). */
function worktreeRemoveVerdicts(): string[] {
  const db = new Database(join(repo, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.query("SELECT verdict FROM decision_log WHERE class = 'worktree-remove' ORDER BY id").all() as { verdict: string }[]).map((r) => r.verdict);
  } finally {
    db.close();
  }
}

function sweepRow(): { removed?: boolean; verdict: string; escalated?: { ignored_paths: string[] } } {
  // The fixture CLI runs with HOME = its cwd, so macOS tooling drops `Library/` into the worktree: not under test.
  rmSync(join(wt, "Library"), { recursive: true, force: true });
  const out = mustLore(["worktree", "sweep", "--apply", "--json"], repo, false);
  const rows = (JSON.parse(out) as { data: { worktrees: { path: string; removed?: boolean; verdict: string; escalated?: { ignored_paths: string[] } }[] } }).data.worktrees;
  const row = rows.find((r) => r.path === wt);
  if (row === undefined) throw new Error(`sweep listed no row for ${wt}: ${out}`);
  return row;
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "sfc-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "sfc@example.invalid");
  git(repo, "config", "user.name", "sfc test");
  writeFileSync(join(repo, ".gitignore"), ".lore/\n.env\nLibrary/\n");
  writeFileSync(join(repo, "a.ts"), "export const v = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  mustLore(["init"], repo, false);
  patchLoreConfig(repo, ["workflow:", "  gates:", "    task-claim:", "      enabled: false", ""].join("\n"));
  const prd = slugOf(mustLore(["create", "prd", "--title", "SFC PRD", "--content", "root", "--no-ai"], repo, false));
  const plan = slugOf(mustLore(["create", "plan", "--title", "SFC Plan", "--parent", prd, "--content", "x", "--no-ai"], repo, false));
  task = slugOf(
    mustLore(["create", "task", "--title", "SFC Task", "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai", "--anchor", "a.ts"], repo, false),
  );
  wt = join(base, "wt");
  git(repo, "worktree", "add", "-q", "-b", "sfc-branch", wt);
  registerRun(repo, RUN);
});

afterEach(() => {
  if (base.startsWith(realpathSync(tmpdir()))) rmSync(base, { recursive: true, force: true });
});

describe("scope file lifecycle", () => {
  it("AC-SFC-1 claim writes the scope file; release deletes it", () => {
    mustLore(["claim", task, "--worktree", wt], wt);
    expect(existsSync(join(wt, SCOPE))).toBe(true);
    mustLore(["release", task], wt);
    expect(existsSync(join(wt, SCOPE))).toBe(false);
  });

  it("AC-SFC-2 a crashed run's scope file (all claims closed) does not block removal, no escalated record", () => {
    mustLore(["claim", task, "--worktree", wt], wt);
    mustLore(["release", task], wt);
    // The crash: the run died after the file was written and never reached release's refresh.
    writeFileSync(
      join(wt, SCOPE),
      JSON.stringify({ schema: 1, working_copy: wt, claims: [{ task, anchors: ["a.ts"], holder_run: RUN }], not_measured: [] }) + "\n",
    );
    const row = sweepRow();
    expect(row.removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(worktreeRemoveVerdicts()).toEqual(["auto"]); // no escalated decision record
  });

  it("NEGATIVE an ignored .env beside the scope file still escalates, naming only .env", () => {
    mustLore(["claim", task, "--worktree", wt], wt);
    mustLore(["release", task], wt);
    writeFileSync(join(wt, SCOPE), JSON.stringify({ schema: 1, working_copy: wt, claims: [], not_measured: [] }) + "\n");
    writeFileSync(join(wt, ".env"), "SECRET=1\n");
    const row = sweepRow();
    expect(row.removed).not.toBe(true);
    expect(row.escalated?.ignored_paths).toEqual([".env"]);
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("SECRET=1\n");
  });
});
