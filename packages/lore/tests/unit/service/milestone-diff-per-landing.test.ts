/**
 * AC-AF-8: the review diff is built from each landing's `main_before..landing_commit`, never from a commit range or a
 * slug search. Throwaway git repo; no corpus.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { deriveLandingDiffForPlan, describeLandingCount, type LandingTaskInput } from "../../../src/adapters/cli/assess-commit-derivation.js";
import { touchedFilesOfDiff } from "../../../src/service/milestone-review-inputs.js";

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

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(dir: string, file: string, message: string): string {
  writeFileSync(join(dir, file), `${message}\n`);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

/** Lands a one-commit branch on main with a merge commit; returns main before and the landing commit. */
function land(dir: string, branch: string, file: string): { main_before: string; landing_commit: string } {
  const main_before = git(dir, "rev-parse", "main");
  git(dir, "checkout", "-q", "-b", branch, main_before);
  commit(dir, file, `work ${file}`);
  git(dir, "checkout", "-q", "main");
  git(dir, "merge", "--no-ff", "-q", "-m", `merge ${branch}`, branch);
  return { main_before, landing_commit: git(dir, "rev-parse", "HEAD") };
}

function fixture(): { dir: string; first: ReturnType<typeof land>; second: ReturnType<typeof land> } {
  const dir = mkdtempSync(join(tmpdir(), "lore-landing-diff-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  commit(dir, "seed.txt", "seed");
  const first = land(dir, "p-one", "p-one.txt");
  commit(dir, "other-plan.txt", "other plan work"); // another plan's commit between the two landings
  const second = land(dir, "p-two", "p-two.txt");
  return { dir, first, second };
}

describe("AC-AF-8 review diff per landing", () => {
  it("AC-AF-8: another plan's commits between two landings stay out of the diff", () => {
    const { dir, first, second } = fixture();
    const tasks: LandingTaskInput[] = [
      { slug: "t1", landing: { ...first, outside_anchors: ["x.ts"] } },
      { slug: "t2", landing: { ...second } },
    ];
    const r = deriveLandingDiffForPlan(dir, tasks, false);
    expect(r.status).toBe("derived");
    expect([...touchedFilesOfDiff(r.diff_text)].sort()).toEqual(["p-one.txt", "p-two.txt"]);
    expect(r.diff_text).not.toContain("other-plan.txt");
    expect(r.unlanded_tasks).toEqual([]);
    expect(r.landings.map((l) => l.outside_anchors)).toEqual([["x.ts"], undefined]);
  });

  it("AC-AF-8: a task with no landing record is named, adds no diff, and is reported unlanded", () => {
    const { dir, first } = fixture();
    const r = deriveLandingDiffForPlan(
      dir,
      [
        { slug: "t1", landing: { ...first } },
        { slug: "t-unlanded", landing: undefined },
      ],
      false,
    );
    expect(r.unlanded_tasks).toEqual(["t-unlanded"]);
    expect(r.attribution["t-unlanded"]).toBe("not_measured");
    expect([...touchedFilesOfDiff(r.diff_text)]).toEqual(["p-one.txt"]);
  });

  it("AC-AF-8: no landings at all yields no diff and every task unlanded (no commit-range fallback)", () => {
    const { dir } = fixture();
    const r = deriveLandingDiffForPlan(dir, [{ slug: "t1", landing: undefined }], true);
    expect(r.status).toBe("unverifiable_convention_mismatch");
    expect(r.diff_text).toBe("");
    expect(r.unlanded_tasks).toEqual(["t1"]);
  });

  it("AC-AF-8: a landing whose commits are missing makes its task unlanded with a warning", () => {
    const { dir } = fixture();
    const bogus = "0123456789abcdef0123456789abcdef01234567";
    const bogusBefore = "fedcba9876543210fedcba9876543210fedcba98";
    const r = deriveLandingDiffForPlan(dir, [{ slug: "t1", landing: { main_before: bogusBefore, landing_commit: bogus } }], false);
    expect(r.unlanded_tasks).toEqual(["t1"]);
    expect(r.warnings.length).toBe(1);
  });

  it("AC-AF-8: a landing labelled no-change whose main_before..landing_commit is non-empty contributes its files", () => {
    const { dir, first } = fixture();
    // the stored record says no-change; the derivation never reads the label, only the range
    const labelled = { ...first, kind: "no-change" } as LandingTaskInput["landing"];
    const r = deriveLandingDiffForPlan(dir, [{ slug: "t1", landing: labelled }], false);
    expect(r.status).toBe("derived");
    expect([...touchedFilesOfDiff(r.diff_text)]).toEqual(["p-one.txt"]);
    expect(r.unlanded_tasks).toEqual([]);
    expect(r.tasks_without_commits).toEqual([]);
    expect(r.landings.map((l) => l.range_empty)).toEqual([false]);
  });

  it("AC-AF-8: a landing with main_before == landing_commit contributes nothing and its task is named", () => {
    const { dir, first } = fixture();
    const r = deriveLandingDiffForPlan(dir, [{ slug: "t-empty", landing: { main_before: first.main_before, landing_commit: first.main_before } }], false);
    expect(r.diff_text).toBe("");
    expect(r.tasks_without_commits).toEqual(["t-empty"]);
    expect(r.landings.map((l) => l.range_empty)).toEqual([true]);
  });

  it("AC-AF-8: the diff-source header names landings and says the reviewer sees each file's net final state (AC-FS-1 supersedes the per-landing wording)", () => {
    const header = describeLandingCount(2, 3);
    expect(header).toContain("2 landing(s), 3 commit(s)");
    expect(header).toContain("net diff");
    expect(header).not.toContain("merged in from main");
  });

  it("AC-AF-8: two tasks sharing one landing count its diff once; a no-change landing adds none", () => {
    const { dir, first } = fixture();
    const r = deriveLandingDiffForPlan(
      dir,
      [
        { slug: "t1", landing: { ...first } },
        { slug: "t2", landing: { ...first } },
        { slug: "t3", landing: { main_before: first.main_before, landing_commit: first.main_before } },
      ],
      false,
    );
    expect(r.diff_text.match(/^diff --git/gm)?.length).toBe(1);
    expect(r.commits[0]?.matched_task_slugs).toEqual(["t1", "t2"]);
    expect(r.landings.length).toBe(2);
    expect(r.unlanded_tasks).toEqual([]);
  });
});
