/**
 * AC-FS-1 / BR-1508: the reviewer reads each changed file's FINAL state in the plan, not the plan's intermediate landings.
 * Throwaway git repo; no corpus. The per-file net diff runs from the earliest touching landing's main_before to the main
 * commit that brought in the last touching landing.
 *
 * Dimensions: HAPPY (net diff shows only the final f), NEGATIVE (L1's version never shown; unmappable landing not seen),
 * BOUNDARY (added-then-deleted shows nothing; rename shown once), REGRESSION (the union of per-landing diffs shows L1's
 * version, so the never-L1 assertion fails on it).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { deriveLandingDiffForPlan, type LandingTaskInput } from "../../../src/adapters/cli/assess-commit-derivation.js";
import { touchedFilesOfDiff } from "../../../src/service/milestone-review-inputs.js";
import { answerJson, buildJudgmentFixture } from "../../helpers/milestone-judgment-fixture.js";

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

function write(dir: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content);
  git(dir, "add", file);
}

type Landing = { main_before: string; landing_commit: string };

/** Lands a one-commit branch on main with a merge commit; `edit` makes the branch's change. */
function land(dir: string, branch: string, edit: () => void): Landing {
  const main_before = git(dir, "rev-parse", "main");
  git(dir, "checkout", "-q", "-b", branch, main_before);
  edit();
  git(dir, "commit", "-q", "-m", `work ${branch}`);
  git(dir, "checkout", "-q", "main");
  git(dir, "merge", "--no-ff", "-q", "-m", `merge ${branch}`, branch);
  return { main_before, landing_commit: git(dir, "rev-parse", "HEAD") };
}

const BODY = ["line one", "line two", "line three", "line four", "line five", "line six", "line seven", "line eight"].join("\n") + "\n";

interface Fixture {
  dir: string;
  l1: Landing;
  l2: Landing;
  otherCommit: string;
  renameA: Landing;
  renameB: Landing;
  addTmp: Landing;
  delTmp: Landing;
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "lore-final-state-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  write(dir, "b.ts", BODY);
  write(dir, "seed.txt", "seed\n");
  git(dir, "commit", "-q", "-m", "seed");
  const l1 = land(dir, "p-one", () => write(dir, "a.ts", "export const f = () => 'f v1';\n"));
  write(dir, "a.ts", "export const f = () => 'f v1';\n// other plan note\n");
  git(dir, "commit", "-q", "-m", "other plan changes a.ts");
  const otherCommit = git(dir, "rev-parse", "HEAD");
  const l2 = land(dir, "p-two", () => write(dir, "a.ts", "export const f = () => 'f v2';\n// other plan note\n"));
  const renameA = land(dir, "p-edit-b", () => write(dir, "b.ts", BODY.replace("line two", "line 2 edited")));
  const renameB = land(dir, "p-rename-b", () => {
    git(dir, "mv", "b.ts", "c.ts");
  });
  const addTmp = land(dir, "p-add-tmp", () => write(dir, "tmp.ts", "temporary\n"));
  const delTmp = land(dir, "p-del-tmp", () => {
    git(dir, "rm", "-q", "tmp.ts");
  });
  return { dir, l1, l2, otherCommit, renameA, renameB, addTmp, delTmp };
}

const tasksOf = (...landings: Landing[]): LandingTaskInput[] => landings.map((landing, i) => ({ slug: `t${String(i + 1)}`, landing }));

function sectionOf(diff: string, file: string): string {
  const parts = diff.split(/^(?=diff --git )/m);
  return parts.filter((p) => p.startsWith(`diff --git a/`) && p.split("\n")[0]?.endsWith(` b/${file}`)).join("");
}

describe("AC-FS-1 the reviewer reads each file's final state", () => {
  it("AC-FS-1: a.ts is one net diff from L1's main_before to L2's main commit: only the rewritten f, never L1's version", () => {
    const f = fixture();
    const r = deriveLandingDiffForPlan(f.dir, tasksOf(f.l1, f.l2), false);
    expect(r.status).toBe("derived");
    const a = sectionOf(r.diff_text, "a.ts");
    expect(a).toContain("f v2");
    expect(a).not.toContain("f v1");
    expect(r.diff_text.match(/^diff --git .* b\/a\.ts$/gm)?.length).toBe(1);
  });

  it("AC-FS-1: another plan's commit inside a.ts's range is named by commit", () => {
    const f = fixture();
    const r = deriveLandingDiffForPlan(f.dir, tasksOf(f.l1, f.l2), false);
    const a = sectionOf(r.diff_text, "a.ts");
    expect(a).toContain(f.otherCommit.slice(0, 12));
    expect(a).toContain("other plan changes a.ts");
    // this plan's own merge commits are not "another plan"
    expect(a).not.toContain("merge p-one");
    expect(a).not.toContain("merge p-two");
  });

  it("AC-FS-1: the union of per-landing diffs shows L1's version of f (the false-green the net diff removes)", () => {
    const f = fixture();
    const union = [f.l1, f.l2].map((l) => git(f.dir, "diff", l.main_before, l.landing_commit)).join("\n");
    expect(union).toContain("f v1");
    const net = deriveLandingDiffForPlan(f.dir, tasksOf(f.l1, f.l2), false).diff_text;
    expect(net).not.toContain("f v1");
  });

  it("AC-FS-1: a file renamed from b.ts to c.ts across the plan's landings is shown once under c.ts, with the rename named", () => {
    const f = fixture();
    const r = deriveLandingDiffForPlan(f.dir, tasksOf(f.renameA, f.renameB), false);
    expect([...touchedFilesOfDiff(r.diff_text)]).toEqual(["c.ts"]);
    const c = sectionOf(r.diff_text, "c.ts");
    expect(c).toContain("renamed from b.ts");
    expect(c).toContain("line 2 edited");
    expect(r.diff_text).not.toMatch(/^diff --git a\/b\.ts b\/b\.ts$/m);
  });

  it("AC-FS-1: a file the plan added and later deleted shows nothing", () => {
    const f = fixture();
    const r = deriveLandingDiffForPlan(f.dir, tasksOf(f.addTmp, f.delTmp), false);
    expect(r.diff_text).not.toContain("tmp.ts");
    expect(r.not_seen_files).toEqual([]);
  });

  it("AC-FS-1: a landing that cannot be mapped to main has its files listed as not seen, and security is not measured", async () => {
    const f = fixture();
    const main = git(f.dir, "rev-parse", "main");
    git(f.dir, "checkout", "-q", "-b", "never-merged", main);
    write(f.dir, "u.ts", "unmerged\n");
    git(f.dir, "commit", "-q", "-m", "work never-merged");
    const head = git(f.dir, "rev-parse", "HEAD");
    git(f.dir, "checkout", "-q", "main");
    const r = deriveLandingDiffForPlan(f.dir, tasksOf(f.l1, { main_before: main, landing_commit: head }), false);
    expect(r.not_seen_files).toEqual(["u.ts"]);
    expect(r.diff_text).not.toContain("u.ts");
    expect(r.diff_text).toContain("f v1");

    const pass = { verdict: "pass" };
    const fx = buildJudgmentFixture(
      () => ({ text: answerJson({ spec_conformance: pass, design_necessity: pass, concurrency_safety: pass, security: pass }), duration_ms: 1 }),
      { facts: { not_seen_files: r.not_seen_files } },
    );
    await fx.review({ diffText: r.diff_text, maxDiffChars: 100000 });
    const security = fx.stored()!.dimensions.security;
    expect(security.verdict).toBe("not-measured");
    expect(security.reason).toContain("u.ts");
    expect(fx.stored()!.judgment!.unseen_files).toContain("u.ts");
  });
});
