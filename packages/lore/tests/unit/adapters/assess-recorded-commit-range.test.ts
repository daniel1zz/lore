/**
 * @spec_ref task-gh-1343388703-180
 *
 * Issue #180: `lore assess` found a task's commits only by the task slug in a commit message,
 * so a merge whose message lacked the slug made the task's work invisible. These tests pin the
 * recorded-range path of `deriveCommitSetForPlan` against a real throwaway repo (never the
 * repo `.lore/`, never an AI judge):
 *   HAPPY:      a slug-less merge commit's branch commits are attributed via the recorded range.
 *   NO-GUESS:   no recorded range -> NOT MEASURED, never attributed by a task slug in a commit message.
 *   BOUNDARY:   head-only range (pre-base_sha claim) attributes just the head commit and says so.
 *   STATE:      not-measured (no range, no slug match) is distinguishable from measured-zero
 *               (range recorded, base == head).
 *   ERROR:      a recorded range whose objects are gone is NOT MEASURED (with a warning), never a slug search.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { deriveCommitSetForPlan } from "../../../src/adapters/cli/assess-commit-derivation.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

function run(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-assess-range-test-"));
  dirs.push(dir);
  run(dir, "init", "-q", "-b", "main");
  return dir;
}

function commit(dir: string, file: string, content: string, message: string): string {
  writeFileSync(join(dir, file), content);
  run(dir, "add", file);
  run(dir, "commit", "-q", "-m", message);
  return run(dir, "rev-parse", "HEAD");
}

const SLUG = "task-range-subject";

/** main: seed; branch: two commits WITHOUT the slug; merged --no-ff with a slug-less message. */
function slugLessMergeFixture(): { dir: string; base: string; head: string; c1: string; c2: string } {
  const dir = initRepo();
  const base = commit(dir, "seed.txt", "seed\n", "seed commit");
  run(dir, "checkout", "-q", "-b", "work");
  const c1 = commit(dir, "a.txt", "RANGE_CONTENT_A\n", "feat: add a");
  const c2 = commit(dir, "b.txt", "RANGE_CONTENT_B\n", "feat: add b");
  run(dir, "checkout", "-q", "main");
  commit(dir, "foreign.txt", "FOREIGN_CONTENT\n", "unrelated foreign change");
  run(dir, "merge", "--no-ff", "-q", "-m", "merge work branch", "work");
  return { dir, base, head: c2, c1, c2 };
}

describe("deriveCommitSetForPlan — recorded commit range (issue #180)", () => {
  it("HAPPY: a task whose merge commit lacks the slug still gets its commits via the recorded range", () => {
    const { dir, base, head, c1, c2 } = slugLessMergeFixture();
    const ranges = new Map([[SLUG, { base, head }]]);

    const result = deriveCommitSetForPlan(dir, [SLUG], true, ranges);

    expect(result.status).toBe("derived");
    expect(result.commits.map((c) => c.sha)).toEqual([c1, c2]);
    expect(result.commits.every((c) => c.matched_task_slugs.includes(SLUG))).toBe(true);
    expect(result.diff_text).toContain("RANGE_CONTENT_A");
    expect(result.diff_text).toContain("RANGE_CONTENT_B");
    expect(result.diff_text).not.toContain("FOREIGN_CONTENT");
    expect(result.tasks_not_measured).toEqual([]);
    expect(result.attribution[SLUG]).toBe("recorded_range");
  });

  it("NO-GUESS: a commit naming the slug does not attribute a task that has no recorded range", () => {
    const dir = initRepo();
    commit(dir, "seed.txt", "seed\n", "seed commit");
    commit(dir, "own.txt", "SLUG_MATCHED_CONTENT\n", `implements ${SLUG}`);

    const result = deriveCommitSetForPlan(dir, [SLUG], false, new Map());

    expect(result.commits).toEqual([]);
    expect(result.diff_text).not.toContain("SLUG_MATCHED_CONTENT");
    expect(result.attribution[SLUG]).toBe("not_measured");
    expect(result.tasks_not_measured).toEqual([SLUG]);
    expect(result.tasks_without_commits).toEqual([SLUG]);
  });

  it("STATE: no range and no slug match is NOT MEASURED, distinct from a measured-zero range", () => {
    const dir = initRepo();
    const only = commit(dir, "seed.txt", "seed\n", "seed commit");

    const notMeasured = deriveCommitSetForPlan(dir, [SLUG], false, new Map());
    expect(notMeasured.tasks_not_measured).toEqual([SLUG]);
    expect(notMeasured.attribution[SLUG]).toBe("not_measured");

    const measuredZero = deriveCommitSetForPlan(dir, [SLUG], false, new Map([[SLUG, { base: only, head: only }]]));
    expect(measuredZero.tasks_not_measured).toEqual([]);
    expect(measuredZero.attribution[SLUG]).toBe("recorded_range");
    expect(measuredZero.commits).toEqual([]);
  });

  it("BOUNDARY: a head-only range (claim predates base_sha) attributes just the head commit and warns", () => {
    const { dir, head, c2 } = slugLessMergeFixture();

    const result = deriveCommitSetForPlan(dir, [SLUG], true, new Map([[SLUG, { head }]]));

    expect(result.status).toBe("derived");
    expect(result.commits.map((c) => c.sha)).toEqual([c2]);
    expect(result.warnings.join("\n")).toContain("head-only");
  });

  it("ERROR: a recorded range whose commit objects are gone is NOT MEASURED with a warning, never a slug search", () => {
    const dir = initRepo();
    commit(dir, "seed.txt", "seed\n", "seed commit");
    commit(dir, "own.txt", "FALLBACK_CONTENT\n", `implements ${SLUG}`);
    const gone = "0123456789abcdef0123456789abcdef01234567";

    const result = deriveCommitSetForPlan(dir, [SLUG], false, new Map([[SLUG, { base: gone, head: gone }]]));

    expect(result.commits).toEqual([]);
    expect(result.attribution[SLUG]).toBe("not_measured");
    expect(result.tasks_not_measured).toEqual([SLUG]);
    expect(result.warnings.join("\n")).toContain(SLUG);
  });
});
