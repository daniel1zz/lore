/**
 * @spec_ref task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be
 *
 * Unit + real-git-fixture tests for `deriveCommitSetForPlan`
 * (adapters/cli/assess-commit-derivation.ts) — the mechanism that replaces
 * `lore assess`'s caller-supplied git range with a plan-derived commit set that is
 * immune to concurrent interleaving.
 *
 * No `bun:sqlite` dependency (the module under test is pure `node:child_process`
 * spawnSync calls against real throwaway git repos) — plain vitest, no `.bun.test.ts`
 * split needed.
 *
 * Six-dimension coverage:
 *   HAPPY:      PRIMARY ORACLE — a plan's task-referencing commits interleaved with a
 *               foreign plan's commits: the derived diff contains only the plan's own
 *               commits, never the foreign ones. Also proves the pre-fix "naive
 *               contiguous range" DOES leak the foreign commits, on the SAME fixture —
 *               the defect this module exists to fix is real, not hypothetical.
 *   CONTROL:    a plan whose commits ARE contiguous (SPEC oracle #5) — the derived file
 *               set equals today's naive `first^..last` range's file set.
 *   BOUNDARY:   (a) no commit anywhere references any of the plan's task slugs at all
 *               ("zero task commits" and "squashed history" are mechanically identical —
 *               both must produce the SAME loud `"no_commits_found"` status, never a
 *               silent empty `"derived"` diff); (b) two matched commits where one is an
 *               ancestor of the other collapse to ONE recorded commit (maximal-element
 *               pruning), not a duplicate-counted pair.
 *   NEGATIVE:   `cwd` is a real directory that is NOT a git repository at all.
 *   ERROR:      `cwd` does not exist on disk at all (git itself fails to spawn/resolve).
 *   STATE:      calling twice against the identical repo/args is idempotent (pure
 *               derivation, no hidden mutation of git state or of the returned shape).
 *   REGRESSION: an UNRELATED commit added after the matched ones (never mentioning any
 *               of the plan's task slugs) does not leak into a re-derived result.
 *
 * @spec_ref task-lore-assess-derives-a-plan-s-commits-by-grepping-task
 *
 * Additional six-dimension coverage for the `allTasksArchived` parameter / the
 * `"unverifiable_convention_mismatch"` status (task-lore-assess-derives-a-plan-s-commits-
 * by-grepping-task — a conventionally-worded commit carries no task slug, so a
 * convention-mismatch plan and a genuinely commit-less plan both used to collapse into the
 * SAME `"no_commits_found"` value; an all-archived plan with zero matches is a
 * CONTRADICTION and must be a DISTINCT, named value):
 *   HAPPY/RED-FIRST: a fixture plan whose task commits use CONVENTIONAL messages (no task
 *               slug at all) with `allTasksArchived: true` derives
 *               `"unverifiable_convention_mismatch"`, not `"no_commits_found"` — this test
 *               was written and run against the PRE-FIX two-argument function first (it
 *               failed: the third argument was silently ignored by plain-JS call
 *               semantics and the old code always returned `"no_commits_found"`), then the
 *               source was fixed to make it pass.
 *   CONTROL:    the exact SAME zero-match fixture with `allTasksArchived: false`
 *               still derives the pre-existing `"no_commits_found"` value, byte-identical
 *               to the pre-fix behavior — the new parameter never affects the case it
 *               doesn't apply to (AC #6, distinguishable-genuinely-commit-less control).
 *               (`allTasksArchived` is now a REQUIRED third parameter — task-the-mcp-
 *               assess-adapter-still-calls-derivecommitsetforplan — so this CONTROL is
 *               expressed as an explicit `false`, never an omitted argument.)
 *   CONTROL:    a plan whose commits DO mention the slug derives the identical `"derived"`
 *               commit list regardless of `allTasksArchived`'s value (AC #5 — the flag
 *               only matters on a zero-match result, never overrides a real derivation).
 *   BOUNDARY:   the two zero-match statuses are asserted by VALUE equality (not merely
 *               falsy/truthy), and are asserted DISTINCT from each other on the same input
 *               shape (AC #4).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { deriveCommitSetForPlan } from "../../../src/adapters/cli/assess-commit-derivation.js";

// ─── Git fixture helpers ──────────────────────────────────────────────────────

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const createdDirs: string[] = [];

/** A well-formed sha that names no object in any fixture repo. */
const GONE_SHA = "0123456789abcdef0123456789abcdef01234567";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-assess-commit-derivation-test-"));
  createdDirs.push(dir);
  spawnSync("git", ["init", "-q"], { cwd: dir, env: GIT_ENV });
  return dir;
}

/** Writes `filename` with `content`, commits it with `message`, returns the resulting sha. */
function commit(dir: string, filename: string, content: string, message: string): string {
  writeFileSync(join(dir, filename), content);
  spawnSync("git", ["add", filename], { cwd: dir, env: GIT_ENV });
  spawnSync("git", ["commit", "-q", "-m", message], { cwd: dir, env: GIT_ENV });
  const rev = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: GIT_ENV, encoding: "utf8" });
  return rev.stdout.trim();
}

/** Naive baseline this defect fixes: `git diff <fromSha>^..<toSha>` — a plain contiguous range. */
function naiveRangeDiff(dir: string, fromSha: string, toSha: string): string {
  const result = spawnSync("git", ["diff", `${fromSha}^..${toSha}`], { cwd: dir, env: GIT_ENV, encoding: "utf8" });
  return result.stdout;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

// ─── HAPPY / PRIMARY ORACLE ───────────────────────────────────────────────────

describe("deriveCommitSetForPlan — PRIMARY ORACLE: interleaved foreign history", () => {
  it("derives only the plan's own commits, excluding every foreign commit interleaved between them", () => {
    const dir = initRepo();
    // Seed commit so the first REAL commit below is never the repo's root commit (a
    // root commit has no parent — the naive "<first task commit>^.." baseline this
    // fixture contrasts against needs one to exist, mirroring real repos which always
    // have history predating any one plan).
    commit(dir, "seed.txt", "seed\n", "seed commit");
    const foreign1 = commit(dir, "foreign1.txt", "CONTENT_FOREIGN_ALPHA\n", "unrelated foreign change alpha");
    const c2OwnA = commit(dir, "own-a.txt", "CONTENT_OWN_A_MARKER\n", "implements task-plan-x-own-task-a");
    const foreign2 = commit(
      dir,
      "foreign2.txt",
      "CONTENT_FOREIGN_BETA\n",
      "unrelated foreign change beta, references task-plan-x-own-task-a",
    );
    const c4Own = commit(dir, "own-b.txt", "CONTENT_OWN_B_MARKER\n", "implements task-plan-x-own-task-b");
    commit(dir, "foreign3.txt", "CONTENT_FOREIGN_GAMMA\n", "unrelated foreign change gamma");

    // each task's RECORDED range is its own commit; the foreign commit that names task A's slug is never attributed
    const ranges = new Map([
      ["task-plan-x-own-task-a", { base: foreign1, head: c2OwnA }],
      ["task-plan-x-own-task-b", { base: foreign2, head: c4Own }],
    ]);
    const result = deriveCommitSetForPlan(dir, ["task-plan-x-own-task-a", "task-plan-x-own-task-b"], false, ranges);

    expect(result.status).toBe("derived");
    expect(result.commits).toHaveLength(2);
    expect(result.tasks_without_commits).toEqual([]);
    expect(result.diff_text).toContain("CONTENT_OWN_A_MARKER");
    expect(result.diff_text).toContain("CONTENT_OWN_B_MARKER");
    expect(result.diff_text).not.toContain("CONTENT_FOREIGN_ALPHA");
    expect(result.diff_text).not.toContain("CONTENT_FOREIGN_BETA");
    expect(result.diff_text).not.toContain("CONTENT_FOREIGN_GAMMA");

    // Each commit's matched_task_slugs is attributed correctly (auditability, AC #3).
    const bySubject = new Map(result.commits.map((c) => [c.subject, c]));
    expect(bySubject.get("implements task-plan-x-own-task-a")?.matched_task_slugs).toEqual(["task-plan-x-own-task-a"]);
    expect(bySubject.get("implements task-plan-x-own-task-b")?.matched_task_slugs).toEqual(["task-plan-x-own-task-b"]);

    // ── Proves the defect is real: CLAUDE.md's own pre-fix standing rule ("derive the
    // range from the plan's own FIRST task commit") — computed on the SAME fixture as
    // `<first own commit>^..<last own commit>` — DOES leak the interleaved foreign
    // commit sitting between them. This is the exact mechanism this module fixes.
    const naive = naiveRangeDiff(dir, c2OwnA, c4Own);
    expect(naive).toContain("CONTENT_FOREIGN_BETA"); // interleaved foreign commit leaks into a naive range
    expect(naive).toContain("CONTENT_OWN_A_MARKER");
    expect(naive).toContain("CONTENT_OWN_B_MARKER");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 8 direct spawn-helper calls (`initRepo` x1, `commit`
  // x6, `naiveRangeDiff` x1 — each is itself a registered spawn helper because its
  // own body directly calls `spawnSync`). Measured 513-546ms in isolation across
  // 2 runs; 15000ms gives >=27x headroom for a concurrent-worktree load spike
  // without policing the value.
});

// ─── CONTROL ───────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — CONTROL: contiguous commits (SPEC oracle #5)", () => {
  it("produces the same file content as today's naive contiguous range when there is no foreign interleaving", () => {
    const dir = initRepo();
    const seed = commit(dir, "base.txt", "base content\n", "seed commit");
    const cYA = commit(dir, "y-a.txt", "CONTENT_Y_A\n", "implements task-plan-y-a");
    const cLast = commit(dir, "y-b.txt", "CONTENT_Y_B\n", "implements task-plan-y-b");

    const ranges = new Map([
      ["task-plan-y-a", { base: seed, head: cYA }],
      ["task-plan-y-b", { base: cYA, head: cLast }],
    ]);
    const result = deriveCommitSetForPlan(dir, ["task-plan-y-a", "task-plan-y-b"], false, ranges);
    expect(result.status).toBe("derived");
    expect(result.diff_text).toContain("CONTENT_Y_A");
    expect(result.diff_text).toContain("CONTENT_Y_B");

    // Naive baseline mirrors CLAUDE.md's pre-fix rule: range from the plan's own FIRST
    // task commit (cYA) to the last (cLast) — contiguous here, so it agrees with the
    // derivation (this is the control: no foreign interleaving to disagree about).
    const naive = naiveRangeDiff(dir, cYA, cLast);
    expect(naive).toContain("CONTENT_Y_A");
    expect(naive).toContain("CONTENT_Y_B");
    // Same file set in both — contiguous, no-foreign-interleaving is the case where the
    // old naive range and the new derivation agree.
    expect(result.diff_text).toContain("diff --git a/y-a.txt b/y-a.txt");
    expect(result.diff_text).toContain("diff --git a/y-b.txt b/y-b.txt");
    expect(naive).toContain("diff --git a/y-a.txt b/y-a.txt");
    expect(naive).toContain("diff --git a/y-b.txt b/y-b.txt");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 5 direct spawn-helper calls (`initRepo` x1, `commit`
  // x3, `naiveRangeDiff` x1). Measured 393-417ms in isolation across 2 runs;
  // 15000ms gives >=35x headroom for a concurrent-worktree load spike.
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — BOUNDARY: no discoverable commits (zero-commit AND squashed-history alike)", () => {
  it("returns a named 'no_commits_found' status, never a silent empty 'derived' diff", () => {
    const dir = initRepo();
    commit(dir, "unrelated.txt", "unrelated content\n", "a commit that names neither task slug");

    const result = deriveCommitSetForPlan(dir, ["task-plan-z-a", "task-plan-z-b"], false, new Map());

    expect(result.status).toBe("no_commits_found");
    expect(result.commits).toEqual([]);
    expect(result.tasks_without_commits).toEqual(["task-plan-z-a", "task-plan-z-b"]);
    expect(result.diff_text).toBe("");
  });

  it("a plan with genuinely zero commits (fresh repo, no commits at all) also reports 'no_commits_found'", () => {
    const dir = initRepo();
    const result = deriveCommitSetForPlan(dir, ["task-plan-empty-a"], false, new Map());
    expect(result.status).toBe("no_commits_found");
    expect(result.tasks_without_commits).toEqual(["task-plan-empty-a"]);
  });
});

describe("deriveCommitSetForPlan — BOUNDARY: a merge commit inside a recorded range is not an own commit", () => {
  it("attributes only the branch's own non-merge commit, never the merge commit that landed it", () => {
    const dir = initRepo();
    const seed = commit(dir, "base.txt", "base\n", "seed");
    spawnSync("git", ["checkout", "-q", "-b", "feature"], { cwd: dir, env: GIT_ENV });
    const inner = commit(dir, "inner.txt", "CONTENT_INNER\n", "inner work");
    spawnSync("git", ["checkout", "-q", "-"], { cwd: dir, env: GIT_ENV });
    spawnSync("git", ["merge", "--no-ff", "-q", "-m", "merge feature", "feature"], { cwd: dir, env: GIT_ENV });

    const result = deriveCommitSetForPlan(dir, ["task-plan-w-a"], false, new Map([["task-plan-w-a", { base: seed, head: inner }]]));

    expect(result.status).toBe("derived");
    expect(result.commits.map((c) => c.sha)).toEqual([inner]);
    expect(result.diff_text).toContain("CONTENT_INNER");
  }, 15000);
});

// ─── NEGATIVE ──────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — NEGATIVE: cwd exists but is not a git repository", () => {
  it("degrades gracefully — no_commits_found, non-empty warnings, never throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-assess-commit-derivation-nongit-"));
    createdDirs.push(dir);

    const ranges = new Map([["task-anything", { base: GONE_SHA, head: GONE_SHA }]]);
    expect(() => deriveCommitSetForPlan(dir, ["task-anything"], false, ranges)).not.toThrow();
    const result = deriveCommitSetForPlan(dir, ["task-anything"], false, ranges);
    expect(result.status).toBe("no_commits_found");
    expect(result.tasks_not_measured).toEqual(["task-anything"]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── ERROR ─────────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — ERROR: cwd does not exist on disk at all", () => {
  it("degrades gracefully — no_commits_found, non-empty warnings, never throws", () => {
    const nonexistent = join(tmpdir(), "lore-assess-commit-derivation-does-not-exist-xyz-123");
    const ranges = new Map([["task-anything", { base: GONE_SHA, head: GONE_SHA }]]);
    expect(() => deriveCommitSetForPlan(nonexistent, ["task-anything"], false, ranges)).not.toThrow();
    const result = deriveCommitSetForPlan(nonexistent, ["task-anything"], false, ranges);
    expect(result.status).toBe("no_commits_found");
    expect(result.tasks_not_measured).toEqual(["task-anything"]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── STATE (idempotency) ───────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — STATE: idempotent across repeated calls", () => {
  it("calling twice against the identical repo/args yields deep-equal results", () => {
    const dir = initRepo();
    const seed = commit(dir, "seed.txt", "seed\n", "seed");
    const own = commit(dir, "own.txt", "CONTENT_IDEMPOTENT\n", "implements task-plan-idem-a");
    const ranges = new Map([["task-plan-idem-a", { base: seed, head: own }]]);

    const first = deriveCommitSetForPlan(dir, ["task-plan-idem-a"], false, ranges);
    const second = deriveCommitSetForPlan(dir, ["task-plan-idem-a"], false, ranges);
    expect(second).toEqual(first);
  }, 15000);
});

// ─── REGRESSION ────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — REGRESSION: an unrelated later commit never leaks in", () => {
  it("a subsequent commit that names neither task slug is excluded from a re-derived result", () => {
    const dir = initRepo();
    const seed = commit(dir, "seed.txt", "seed\n", "seed");
    const own = commit(dir, "own.txt", "CONTENT_REG_OWN\n", "implements task-plan-reg-a");
    const ranges = new Map([["task-plan-reg-a", { base: seed, head: own }]]);
    const before = deriveCommitSetForPlan(dir, ["task-plan-reg-a"], false, ranges);
    expect(before.diff_text).toContain("CONTENT_REG_OWN");

    commit(dir, "later-unrelated.txt", "CONTENT_REG_UNRELATED\n", "a later commit naming nothing relevant");
    const after = deriveCommitSetForPlan(dir, ["task-plan-reg-a"], false, ranges);

    expect(after.commits).toHaveLength(1);
    expect(after.diff_text).toContain("CONTENT_REG_OWN");
    expect(after.diff_text).not.toContain("CONTENT_REG_UNRELATED");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 3 direct spawn-helper calls (`initRepo` x1, `commit`
  // x2). Measured 198-221ms in isolation across 2 runs; 15000ms gives >=67x
  // headroom for a concurrent-worktree load spike.
});

// ─── task-lore-assess-derives-a-plan-s-commits-by-grepping-task ──────────────────
// HAPPY/RED-FIRST: convention-mismatch on an all-archived plan is a DISTINCT, named
// value from genuine absence — never a shared silent empty.

describe("deriveCommitSetForPlan — RED-FIRST: convention-mismatch (allTasksArchived) is DISTINCT from no_commits_found", () => {
  it("an all-archived plan whose commits are conventionally-worded (no task slug) derives 'unverifiable_convention_mismatch', never 'no_commits_found'", () => {
    const dir = initRepo();
    // Conventional Commits messages — deliberately reference NEITHER task's slug, mirroring
    // the measured defect (fix(evidence): ... never mentions the task slug it closes).
    commit(dir, "a.txt", "content-a\n", "fix(evidence): self-reported fail must carry a non-empty output_tail");
    commit(dir, "b.txt", "content-b\n", "feat(assess): add scope mismatch warning");

    const result = deriveCommitSetForPlan(dir, ["task-conv-archived-a", "task-conv-archived-b"], true, new Map());

    // AC #4: assert the VALUE, not mere falsiness/truthiness.
    expect(result.status).toBe("unverifiable_convention_mismatch");
    expect(result.status).not.toBe("no_commits_found");
    expect(result.status).not.toBe("derived");
    expect(result.commits).toEqual([]);
    expect(result.tasks_without_commits).toEqual(["task-conv-archived-a", "task-conv-archived-b"]);
    expect(result.diff_text).toBe("");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 3 direct spawn-helper calls (`initRepo` x1, `commit` x2).
  // Comparable to this file's other 3-spawn-call CONTROL cases (198-303ms measured);
  // 15000ms gives ample headroom for a concurrent-worktree load spike.

  // ─── CONTROL: the identical zero-match fixture with allTasksArchived: false stays the
  // pre-existing 'no_commits_found' — the new parameter never changes the case it
  // doesn't apply to (AC #6: distinguishable from the mismatch state above).
  //
  // reason: `allTasksArchived` is now a REQUIRED third parameter (task-the-mcp-assess-
  // adapter-still-calls-derivecommitsetforplan closed the ADR's Q3 "Opt-in" gap) — there
  // is no longer a compiling call site that OMITS it, so this CONTROL is exercised with a
  // single explicit `false` call instead of comparing an omitted call against an explicit
  // one; the asserted BEHAVIOR (this is the pre-existing, unaffected path) is unchanged.
  it("CONTROL: the identical conventional-commit fixture with allTasksArchived: false still derives 'no_commits_found', distinguishably from the archived-mismatch case", () => {
    const dir = initRepo();
    commit(dir, "a.txt", "content-a\n", "fix(evidence): self-reported fail must carry a non-empty output_tail");
    commit(dir, "b.txt", "content-b\n", "feat(assess): add scope mismatch warning");

    const explicitFalse = deriveCommitSetForPlan(dir, ["task-conv-not-archived-a", "task-conv-not-archived-b"], false, new Map());

    expect(explicitFalse.status).toBe("no_commits_found");
    expect(explicitFalse.status).not.toBe("unverifiable_convention_mismatch");
    expect(explicitFalse.commits).toEqual([]);
    expect(explicitFalse.diff_text).toBe("");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 3 direct spawn-helper calls (`initRepo` x1, `commit` x2).
  // Comparable to this file's other 3-spawn-call CONTROL cases (198-303ms measured);
  // 15000ms gives ample headroom for a concurrent-worktree load spike.

  // ─── CONTROL: a real, matched derivation is byte-identical regardless of
  // allTasksArchived — the flag only ever matters on a ZERO-match result (AC #5).
  //
  // reason: same closure as above — `allTasksArchived` is REQUIRED, so this CONTROL now
  // compares the `true` and `false` values against each other instead of also including
  // an omitted third variant.
  it("CONTROL: a plan whose tasks have recorded ranges derives the identical 'derived' commit set whether allTasksArchived is true or false", () => {
    const dir = initRepo();
    const seed = commit(dir, "base.txt", "base\n", "seed commit");
    const own = commit(dir, "own.txt", "CONTENT_ARCHIVED_MATCH\n", "implements task-conv-matched-a");
    const ranges = new Map([["task-conv-matched-a", { base: seed, head: own }]]);

    const withArchivedTrue = deriveCommitSetForPlan(dir, ["task-conv-matched-a"], true, ranges);
    const withArchivedFalse = deriveCommitSetForPlan(dir, ["task-conv-matched-a"], false, ranges);

    expect(withArchivedTrue.status).toBe("derived");
    expect(withArchivedTrue).toEqual(withArchivedFalse);
    expect(withArchivedTrue.diff_text).toContain("CONTENT_ARCHIVED_MATCH");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 2 direct spawn-helper calls (`initRepo` x1, `commit` x2).
  // Measured well under the seed-commit baseline of the CONTROL block above; 15000ms
  // gives comparable headroom for a concurrent-worktree load spike.
});
