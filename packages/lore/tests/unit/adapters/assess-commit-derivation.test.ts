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
    commit(dir, "foreign1.txt", "CONTENT_FOREIGN_ALPHA\n", "unrelated foreign change alpha");
    const c2OwnA = commit(dir, "own-a.txt", "CONTENT_OWN_A_MARKER\n", "implements task-plan-x-own-task-a");
    commit(
      dir,
      "foreign2.txt",
      "CONTENT_FOREIGN_BETA\n",
      "unrelated foreign change beta, references task-other-plan-foreign-task",
    );
    const c4Own = commit(dir, "own-b.txt", "CONTENT_OWN_B_MARKER\n", "implements task-plan-x-own-task-b");
    commit(dir, "foreign3.txt", "CONTENT_FOREIGN_GAMMA\n", "unrelated foreign change gamma");

    const result = deriveCommitSetForPlan(dir, ["task-plan-x-own-task-a", "task-plan-x-own-task-b"]);

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
  });
});

// ─── CONTROL ───────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — CONTROL: contiguous commits (SPEC oracle #5)", () => {
  it("produces the same file content as today's naive contiguous range when there is no foreign interleaving", () => {
    const dir = initRepo();
    commit(dir, "base.txt", "base content\n", "seed commit");
    const cYA = commit(dir, "y-a.txt", "CONTENT_Y_A\n", "implements task-plan-y-a");
    const cLast = commit(dir, "y-b.txt", "CONTENT_Y_B\n", "implements task-plan-y-b");

    const result = deriveCommitSetForPlan(dir, ["task-plan-y-a", "task-plan-y-b"]);
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
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — BOUNDARY: no discoverable commits (zero-commit AND squashed-history alike)", () => {
  it("returns a named 'no_commits_found' status, never a silent empty 'derived' diff", () => {
    const dir = initRepo();
    commit(dir, "unrelated.txt", "unrelated content\n", "a commit that names neither task slug");

    const result = deriveCommitSetForPlan(dir, ["task-plan-z-a", "task-plan-z-b"]);

    expect(result.status).toBe("no_commits_found");
    expect(result.commits).toEqual([]);
    expect(result.tasks_without_commits).toEqual(["task-plan-z-a", "task-plan-z-b"]);
    expect(result.diff_text).toBe("");
  });

  it("a plan with genuinely zero commits (fresh repo, no commits at all) also reports 'no_commits_found'", () => {
    const dir = initRepo();
    const result = deriveCommitSetForPlan(dir, ["task-plan-empty-a"]);
    expect(result.status).toBe("no_commits_found");
    expect(result.tasks_without_commits).toEqual(["task-plan-empty-a"]);
  });
});

describe("deriveCommitSetForPlan — BOUNDARY: ancestor pruning collapses a merge + its own inner commit", () => {
  it("keeps only the descendant when two matched commits are in an ancestor relationship", () => {
    const dir = initRepo();
    commit(dir, "base.txt", "base\n", "seed");
    // Simulate a branch commit whose message references the task slug...
    spawnSync("git", ["checkout", "-q", "-b", "feature"], { cwd: dir, env: GIT_ENV });
    commit(dir, "inner.txt", "CONTENT_INNER\n", "implements task-plan-w-a (inner)");
    spawnSync("git", ["checkout", "-q", "main"], { cwd: dir, env: GIT_ENV }).status === 0 ||
      spawnSync("git", ["checkout", "-q", "master"], { cwd: dir, env: GIT_ENV });
    // ...and a --no-ff merge commit whose OWN message ALSO references the same task slug.
    spawnSync("git", ["merge", "--no-ff", "-q", "-m", "merge: implements task-plan-w-a (inner)", "feature"], {
      cwd: dir,
      env: GIT_ENV,
    });

    const result = deriveCommitSetForPlan(dir, ["task-plan-w-a"]);
    expect(result.status).toBe("derived");
    // Both the inner commit and the merge commit matched the same token, but the inner
    // commit is an ancestor of the merge commit — only the merge (the maximal/tip
    // element) should remain, not a duplicate-counted pair.
    expect(result.commits).toHaveLength(1);
    expect(result.diff_text).toContain("CONTENT_INNER");
  });
});

// ─── NEGATIVE ──────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — NEGATIVE: cwd exists but is not a git repository", () => {
  it("degrades gracefully — no_commits_found, non-empty warnings, never throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-assess-commit-derivation-nongit-"));
    createdDirs.push(dir);

    expect(() => deriveCommitSetForPlan(dir, ["task-anything"])).not.toThrow();
    const result = deriveCommitSetForPlan(dir, ["task-anything"]);
    expect(result.status).toBe("no_commits_found");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── ERROR ─────────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — ERROR: cwd does not exist on disk at all", () => {
  it("degrades gracefully — no_commits_found, non-empty warnings, never throws", () => {
    const nonexistent = join(tmpdir(), "lore-assess-commit-derivation-does-not-exist-xyz-123");
    expect(() => deriveCommitSetForPlan(nonexistent, ["task-anything"])).not.toThrow();
    const result = deriveCommitSetForPlan(nonexistent, ["task-anything"]);
    expect(result.status).toBe("no_commits_found");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── STATE (idempotency) ───────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — STATE: idempotent across repeated calls", () => {
  it("calling twice against the identical repo/args yields deep-equal results", () => {
    const dir = initRepo();
    commit(dir, "own.txt", "CONTENT_IDEMPOTENT\n", "implements task-plan-idem-a");

    const first = deriveCommitSetForPlan(dir, ["task-plan-idem-a"]);
    const second = deriveCommitSetForPlan(dir, ["task-plan-idem-a"]);
    expect(second).toEqual(first);
  });
});

// ─── REGRESSION ────────────────────────────────────────────────────────────────

describe("deriveCommitSetForPlan — REGRESSION: an unrelated later commit never leaks in", () => {
  it("a subsequent commit that names neither task slug is excluded from a re-derived result", () => {
    const dir = initRepo();
    commit(dir, "own.txt", "CONTENT_REG_OWN\n", "implements task-plan-reg-a");
    const before = deriveCommitSetForPlan(dir, ["task-plan-reg-a"]);
    expect(before.diff_text).toContain("CONTENT_REG_OWN");

    commit(dir, "later-unrelated.txt", "CONTENT_REG_UNRELATED\n", "a later commit naming nothing relevant");
    const after = deriveCommitSetForPlan(dir, ["task-plan-reg-a"]);

    expect(after.commits).toHaveLength(1);
    expect(after.diff_text).toContain("CONTENT_REG_OWN");
    expect(after.diff_text).not.toContain("CONTENT_REG_UNRELATED");
  });
});
