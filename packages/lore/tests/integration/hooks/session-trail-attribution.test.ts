// @spawns assets/hooks/post-edit-mark.mjs
// @spawns assets/hooks/stop-turn-review.mjs
// @spawns assets/hooks/user-prompt-turn-start.mjs
/**
 * @spec_ref AC-ST-3
 *
 * Turn-end attribution (spec-session-trail-a-session-local-record-of-what-each-run-4, Design >
 * Attribution at turn end): the turn-start and turn-end hooks, run against throwaway git repos and
 * mkdtemp state bases, write `<turn>/changes.json` labelling every change run | vcs | unknown.
 * Setup commits are dated in the past (before session.json started_at) so only commits made DURING
 * a test count as the session's own commits.
 *
 * Isolation (I1): mkdtemp repos + CLAUDE_STATE_BASE_OVERRIDE; never ~/.claude or this repo's .lore/.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readSessionTrail } from "@lore/core/node";
import { currentTurnDir, git, makeGitRepo, makeTmpDir } from "./hook-harness";
import { markEdit, startTurn, stopTurn, writeRepoFile, type TurnFixture } from "./turn-review-harness";

const LIB = join(resolve(__dirname, "../../../../../assets/hooks/lib"), "session-trail.mjs");
const PAST = "2020-01-01T00:00:00Z";
const SESSION_STARTED_AT = "2021-01-01T00:00:00.000Z";
const SID = "S1";
const MAIN_RUN = `cc:${SID}`;

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

/** git in `cwd`; `date` backdates author + committer (and so the reflog entry); a failing exit is returned, not thrown. */
function sh(cwd: string, args: string[], date?: string) {
  const env = date ? { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : process.env;
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
}
function must(cwd: string, args: string[], date?: string): string {
  const r = sh(cwd, args, date);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.err}`);
  return r.out;
}
/** A setup commit dated before the session started. */
function past(repo: string, message: string): void {
  must(repo, ["add", "-A"]);
  must(repo, ["commit", "-qm", message], PAST);
}
/** A commit made during the test (counts as the session's own). */
function own(repo: string, message: string): void {
  must(repo, ["add", "-A"]);
  must(repo, ["commit", "-qm", message]);
}

function makeRepo(): string {
  const repo = makeGitRepo();
  cleanup.push(repo);
  must(repo, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  writeRepoFile(repo, "src/a.ts", "export const a = 1;\n");
  writeRepoFile(repo, "src/c.ts", "export const c = 'base';\n");
  past(repo, "seed");
  return repo;
}

/** Fixture whose session.json already exists (SessionStart ran in 2021); the turn is NOT started. */
function fixtureOf(repo: string): TurnFixture {
  const base = makeTmpDir("trail-state-");
  cleanup.push(base);
  mkdirSync(join(base, "sessions", SID), { recursive: true });
  writeFileSync(join(base, "sessions", SID, "session.json"), JSON.stringify({ started_at: SESSION_STARTED_AT }));
  return { repo, base, sid: SID };
}

type Entry = { path: string; status: string; lines: number; source: { kind: string; run?: string } };
function readChanges(f: TurnFixture) {
  return JSON.parse(readFileSync(join(currentTurnDir(f.base, f.sid), "changes.json"), "utf8")) as {
    turn: string; at: string; shared_working_copy: boolean;
    changes: { measured: true; value: Entry[] } | { measured: false; reason: string };
  };
}
/** `{path: "M:run:cc:S1" | "A:vcs" | "D:unknown"}` of a measured changes.json. */
function labels(f: TurnFixture): Record<string, string> {
  const { changes } = readChanges(f);
  if (!changes.measured) throw new Error(`changes unmeasured: ${changes.reason}`);
  return Object.fromEntries(changes.value.map((c) => [c.path, `${c.status}:${c.source.kind}${c.source.run ? `:${c.source.run}` : ""}`]));
}
function endTurn(f: TurnFixture): Record<string, string> {
  const r = stopTurn(f);
  expect(r.status).toBe(0);
  return labels(f);
}

/** A branch `name` off the current HEAD with `files` committed (past-dated), then back to main. */
function pastBranch(repo: string, name: string, files: Record<string, string>): void {
  must(repo, ["checkout", "-qb", name]);
  for (const [rel, text] of Object.entries(files)) writeRepoFile(repo, rel, text);
  past(repo, `${name} work`);
  must(repo, ["checkout", "-q", "main"]);
}

describe("AC-ST-3 run and unknown attribution", () => {
  it("AC-ST-3 Edit -> run", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "src/a.ts", "export const a = 2;\n"));
    expect(endTurn(f)).toEqual({ "src/a.ts": `M:run:${MAIN_RUN}` });
  });

  it("AC-ST-3 Edit then commit -> run", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "src/a.ts", "export const a = 2;\n"));
    own(f.repo, "edit");
    expect(endTurn(f)).toEqual({ "src/a.ts": `M:run:${MAIN_RUN}` });
  });

  it("AC-ST-3 a helper's Edit is labelled with the helper run", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "src/a.ts", "export const a = 2;\n"), "AG1");
    expect(endTurn(f)).toEqual({ "src/a.ts": `M:run:${MAIN_RUN}:AG1` });
  });

  it("AC-ST-3 sed (a shell edit with no edit record) -> unknown", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    writeRepoFile(f.repo, "src/a.ts", "export const a = 2;\n");
    expect(endTurn(f)).toEqual({ "src/a.ts": "M:unknown" });
  });

  it("AC-ST-3 sed then commit -> unknown", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    writeRepoFile(f.repo, "src/a.ts", "export const a = 2;\n");
    own(f.repo, "sed");
    expect(endTurn(f)).toEqual({ "src/a.ts": "M:unknown" });
  });

  it("AC-ST-3 a same-size edit made within a second of the commit that wrote the index is not lost (the seeded index copy keeps the real index mtime)", () => {
    for (let round = 0; round < 4; round++) {
      const repo = makeRepo();
      const f = fixtureOf(repo);
      writeRepoFile(repo, "src/a.ts", `export const a = ${round + 2};\n`);
      own(repo, "v1");
      startTurn(f);
      markEdit(f, writeRepoFile(repo, "src/a.ts", `export const a = ${round + 6};\n`)); // same byte size as v1
      expect(endTurn(f)).toEqual({ "src/a.ts": `M:run:${MAIN_RUN}` });
    }
  });

  it("AC-ST-3 a rename -> D old + A new", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    renameSync(join(f.repo, "src/a.ts"), join(f.repo, "src/b.ts"));
    expect(endTurn(f)).toEqual({ "src/a.ts": "D:unknown", "src/b.ts": "A:unknown" });
  });

  it("AC-ST-3 stash pop -> unknown", () => {
    const repo = makeRepo();
    writeRepoFile(repo, "src/a.ts", "export const a = 'stashed';\n");
    must(repo, ["stash", "push", "-q"]);
    const f = fixtureOf(repo);
    startTurn(f);
    must(repo, ["stash", "pop", "-q"]);
    expect(endTurn(f)).toEqual({ "src/a.ts": "M:unknown" });
  });
});

describe("AC-ST-3 version-control attribution", () => {
  it("AC-ST-3 merge of another branch -> vcs", () => {
    const repo = makeRepo();
    pastBranch(repo, "other", { "src/o.ts": "export const o = 1;\n" });
    writeRepoFile(repo, "src/m.ts", "export const m = 1;\n");
    past(repo, "main work");
    const f = fixtureOf(repo);
    startTurn(f);
    must(repo, ["merge", "--no-ff", "-q", "other", "-m", "merge other"]);
    expect(endTurn(f)).toEqual({ "src/o.ts": "A:vcs" });
  });

  it("AC-ST-3 fast-forward pull -> vcs", () => {
    const repo = makeRepo();
    const upstream = makeTmpDir("trail-upstream-");
    cleanup.push(upstream);
    must(upstream, ["clone", "-q", repo, "."]);
    writeRepoFile(upstream, "src/u.ts", "export const u = 1;\n");
    must(upstream, ["add", "-A"]);
    must(upstream, ["commit", "-qm", "upstream work"], PAST);
    const f = fixtureOf(repo);
    startTurn(f);
    must(repo, ["pull", "--ff-only", "-q", upstream, "HEAD"]);
    expect(endTurn(f)).toEqual({ "src/u.ts": "A:vcs" });
  });

  it("AC-ST-3 rebase onto another branch -> vcs for that branch's paths", () => {
    const repo = makeRepo();
    must(repo, ["checkout", "-qb", "feature"]);
    writeRepoFile(repo, "src/f.ts", "export const f = 1;\n");
    past(repo, "feature work");
    must(repo, ["checkout", "-q", "main"]);
    writeRepoFile(repo, "src/m.ts", "export const m = 1;\n");
    past(repo, "main work");
    must(repo, ["checkout", "-q", "feature"]);
    const f = fixtureOf(repo);
    startTurn(f);
    must(repo, ["rebase", "-q", "main"]);
    expect(endTurn(f)).toEqual({ "src/m.ts": "A:vcs" });
  });

  it("AC-ST-3 cherry-pick -> vcs", () => {
    const repo = makeRepo();
    pastBranch(repo, "other", { "src/o.ts": "export const o = 1;\n" });
    const picked = must(repo, ["rev-parse", "other"]);
    const f = fixtureOf(repo);
    startTurn(f);
    must(repo, ["cherry-pick", picked]);
    expect(endTurn(f)).toEqual({ "src/o.ts": "A:vcs" });
  });

  it("AC-ST-3 reset --hard to another commit -> vcs", () => {
    const repo = makeRepo();
    pastBranch(repo, "other", { "src/o.ts": "export const o = 1;\n" });
    const f = fixtureOf(repo);
    startTurn(f);
    must(repo, ["reset", "--hard", "-q", "other"]);
    expect(endTurn(f)).toEqual({ "src/o.ts": "A:vcs" });
  });

  /** main and `other` both change src/c.ts (conflict); `other` also adds src/o.ts (clean). */
  function conflictingFixture() {
    const repo = makeRepo();
    must(repo, ["checkout", "-qb", "other"]);
    writeRepoFile(repo, "src/c.ts", "export const c = 'other';\n");
    writeRepoFile(repo, "src/o.ts", "export const o = 1;\n");
    past(repo, "other work");
    must(repo, ["checkout", "-q", "main"]);
    writeRepoFile(repo, "src/c.ts", "export const c = 'main';\n");
    past(repo, "main work");
    return repo;
  }

  it("AC-ST-3 a merge concluded with commit after a conflict -> cleanly merged paths vcs, the hand-resolved path unknown", () => {
    const repo = conflictingFixture();
    const f = fixtureOf(repo);
    startTurn(f);
    expect(sh(repo, ["merge", "other"]).status).toBe(1);
    writeRepoFile(repo, "src/c.ts", "export const c = 'resolved';\n");
    must(repo, ["add", "-A"]);
    must(repo, ["commit", "-qm", "resolve", "--no-edit"]);
    expect(must(repo, ["reflog", "-1", "--format=%gs"])).toMatch(/^commit \(merge\)/);
    expect(endTurn(f)).toEqual({ "src/o.ts": "A:vcs", "src/c.ts": "M:unknown" });
  });

  it("AC-ST-3 a conflicted merge concluded by commit keeps its cleanly merged paths vcs even after the session's own commit (the merge commit is not an own commit)", () => {
    const repo = conflictingFixture();
    const f = fixtureOf(repo);
    startTurn(f);
    writeRepoFile(repo, "src/own.ts", "export const own = 1;\n");
    own(repo, "own work before the merge");
    expect(sh(repo, ["merge", "other"]).status).toBe(1);
    writeRepoFile(repo, "src/c.ts", "export const c = 'resolved';\n");
    must(repo, ["add", "-A"]);
    must(repo, ["commit", "-qm", "resolve", "--no-edit"]);
    expect(endTurn(f)).toEqual({ "src/o.ts": "A:vcs", "src/c.ts": "M:unknown", "src/own.ts": "A:unknown" });
  });
});

describe("AC-ST-3 own commits are never laundered into vcs", () => {
  it("AC-ST-3 squash merge then commit -> unknown", () => {
    const repo = makeRepo();
    pastBranch(repo, "other", { "src/o.ts": "export const o = 1;\n" });
    const f = fixtureOf(repo);
    startTurn(f);
    must(repo, ["merge", "--squash", "-q", "other"]);
    must(repo, ["commit", "-qm", "squash"]);
    expect(endTurn(f)).toEqual({ "src/o.ts": "A:unknown" });
  });

  it("AC-ST-3 a commit on a side branch in this checkout, then merged -> unknown", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    must(f.repo, ["checkout", "-qb", "side"]);
    writeRepoFile(f.repo, "src/s.ts", "export const s = 1;\n");
    own(f.repo, "side work");
    must(f.repo, ["checkout", "-q", "main"]);
    must(f.repo, ["merge", "-q", "side"]);
    expect(endTurn(f)).toEqual({ "src/s.ts": "A:unknown" });
  });

  it("AC-ST-3 commit, reset --hard back, then cherry-pick that commit -> unknown (matched by patch-id)", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    writeRepoFile(f.repo, "src/x.ts", "export const x = 1;\n");
    own(f.repo, "x");
    const commit = must(f.repo, ["rev-parse", "HEAD"]);
    must(f.repo, ["reset", "--hard", "-q", "HEAD~1"]);
    must(f.repo, ["cherry-pick", commit], "2030-01-01T00:00:00Z"); // later date: same-second replay would reproduce the same sha
    expect(must(f.repo, ["rev-parse", "HEAD"])).not.toBe(commit);
    expect(endTurn(f)).toEqual({ "src/x.ts": "A:unknown" });
  });
});

describe("AC-ST-3 unmeasured is never an empty list", () => {
  it("AC-ST-3 a non-git directory writes changes measured:false with a reason", () => {
    const dir = makeTmpDir("trail-nogit-");
    cleanup.push(dir);
    const f = fixtureOf(dir);
    startTurn(f);
    expect(stopTurn(f).status).toBe(0);
    const { changes } = readChanges(f);
    expect(changes.measured).toBe(false);
    expect(changes.measured === false && changes.reason).toContain("not a git work tree");
  });

  it("AC-ST-3 a turn whose changes.json is missing reads unmeasured through the @lore/core reader, never as an empty list", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    const trail = readSessionTrail(SID, f.base)!;
    expect(existsSync(join(currentTurnDir(f.base, f.sid), "changes.json"))).toBe(false);
    expect(trail.turns).toHaveLength(1);
    expect(trail.turns[0]!.changes).toEqual({ measured: false, reason: "changes.json absent" });
  });

  it("AC-ST-3 the @lore/core reader accepts the written changes.json (schema parity) and reports shared_working_copy false", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "src/a.ts", "export const a = 2;\n"));
    stopTurn(f);
    const turn = readSessionTrail(SID, f.base)!.turns[0]!;
    expect(turn.shared_working_copy).toBe(false);
    expect(turn.changes.measured).toBe(true);
  });

  it("AC-ST-3 a changed file with no recorded edit and a start head the reflog never saw is unmeasured, not unknown", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    const snapshotFile = join(currentTurnDir(f.base, f.sid), "turn-start-snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8"));
    writeFileSync(snapshotFile, JSON.stringify({ ...snapshot, head: "0".repeat(40), reflog_len: 99 }));
    writeRepoFile(f.repo, "src/a.ts", "export const a = 2;\n");
    stopTurn(f);
    const { changes } = readChanges(f);
    expect(changes.measured).toBe(false);
    expect(changes.measured === false && changes.reason).toContain("reflog");
  });

  it("AC-ST-3 a merge with no session.json is unmeasured (the own-commit window is unknown)", () => {
    const repo = makeRepo();
    pastBranch(repo, "other", { "src/o.ts": "export const o = 1;\n" });
    const f = fixtureOf(repo);
    rmSync(join(f.base, "sessions", SID, "session.json"));
    startTurn(f);
    must(repo, ["merge", "-q", "other", "-m", "merge other"]);
    stopTurn(f);
    const { changes } = readChanges(f);
    expect(changes.measured).toBe(false);
    expect(changes.measured === false && changes.reason).toContain("session.json");
  });
});

describe("AC-ST-3 shared working copy and turn-start head", () => {
  const helperRecord = (isolated: boolean | undefined) => ({
    run: `cc:${SID}:H1`, started_at: "2021-06-01T00:00:00.000Z", end_count: 0, ...(isolated === undefined ? {} : { isolated }),
  });
  function withHelper(f: TurnFixture, record: object): void {
    mkdirSync(join(f.base, "sessions", SID, "helpers"), { recursive: true });
    writeFileSync(join(f.base, "sessions", SID, "helpers", "H1.json"), JSON.stringify(record));
  }

  it("AC-ST-3 shared_working_copy is true while a non-isolated helper record is open in the turn", () => {
    const f = fixtureOf(makeRepo());
    startTurn(f);
    withHelper(f, helperRecord(undefined));
    stopTurn(f);
    expect(readChanges(f).shared_working_copy).toBe(true);
  });

  it("AC-ST-3 shared_working_copy stays false for an isolated helper and for a helper that ended before the turn", () => {
    const f = fixtureOf(makeRepo());
    withHelper(f, { ...helperRecord(false), ended_at: "2021-06-02T00:00:00.000Z", end_count: 1 });
    startTurn(f);
    stopTurn(f);
    expect(readChanges(f).shared_working_copy).toBe(false);
    withHelper(f, helperRecord(true));
    stopTurn(f);
    expect(readChanges(f).shared_working_copy).toBe(false);
  });

  it("AC-ST-3 turn start records head and reflog length beside the tree, leaving the real index byte-identical", () => {
    const f = fixtureOf(makeRepo());
    const indexBefore = readFileSync(join(f.repo, ".git", "index"));
    startTurn(f);
    const snapshot = JSON.parse(readFileSync(join(currentTurnDir(f.base, f.sid), "turn-start-snapshot.json"), "utf8"));
    expect(snapshot.head).toBe(git(f.repo, "rev-parse", "HEAD"));
    expect(snapshot.reflog_len).toBe(1);
    expect(snapshot.tree).toMatch(/^[0-9a-f]{40}/);
    expect(readFileSync(join(f.repo, ".git", "index")).equals(indexBefore)).toBe(true);
  });
});

/** Run the pure `attributeTurn` in a child node process (Map/Set built from JSON arrays). */
function attribute(input: {
  entries: Array<{ status: string; path: string; lines: number }>;
  editRuns?: Array<[string, string]>;
  steps?: Array<{ paths?: string[]; diverged?: string[]; conflicted?: string[]; ownTouched?: string[] }>;
}): Entry[] {
  const script = `import { attributeTurn } from ${JSON.stringify("file://" + LIB)};
const i = JSON.parse(process.argv[1]);
const set = (a) => new Set(a ?? []);
const steps = (i.steps ?? []).map((s) => ({ paths: set(s.paths), diverged: set(s.diverged), conflicted: set(s.conflicted), ownTouched: set(s.ownTouched) }));
process.stdout.write(JSON.stringify(attributeTurn({ entries: i.entries, editRuns: new Map(i.editRuns ?? []), steps })));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(input)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as Entry[];
}

describe("AC-ST-3 attributeTurn is a pure function over facts", () => {
  const entries = [
    { status: "M", path: "a.ts", lines: 2 },
    { status: "A", path: "b.ts", lines: 1 },
  ];
  const kinds = (out: Entry[]) => Object.fromEntries(out.map((e) => [e.path, e.source.kind]));

  it("AC-ST-3 an edit record wins over a take-in step covering the same path", () => {
    const out = attribute({ entries, editRuns: [["a.ts", "cc:S:A"]], steps: [{ paths: ["a.ts", "b.ts"] }] });
    expect(out.find((e) => e.path === "a.ts")!.source).toEqual({ kind: "run", run: "cc:S:A" });
    expect(kinds(out)).toEqual({ "a.ts": "run", "b.ts": "vcs" });
  });

  it("AC-ST-3 a conflicted, diverged or own-touched path is never vcs; an untouched path is unknown", () => {
    const out = attribute({
      entries: [...entries, { status: "M", path: "c.ts", lines: 1 }, { status: "M", path: "d.ts", lines: 1 }],
      steps: [{ paths: ["a.ts", "b.ts", "c.ts"], conflicted: ["a.ts"], diverged: ["b.ts"], ownTouched: ["c.ts"] }],
    });
    expect(kinds(out)).toEqual({ "a.ts": "unknown", "b.ts": "unknown", "c.ts": "unknown", "d.ts": "unknown" });
  });

  it("AC-ST-3 statuses other than A and D report M, and output is sorted by path", () => {
    const out = attribute({ entries: [{ status: "T", path: "z.ts", lines: 0 }, { status: "D", path: "a.ts", lines: 3 }] });
    expect(out.map((e) => `${e.path}:${e.status}`)).toEqual(["a.ts:D", "z.ts:M"]);
  });
});
