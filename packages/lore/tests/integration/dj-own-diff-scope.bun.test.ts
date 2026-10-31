// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end  AC-DJ-1;
 *   business rules BR-1346 (a change held by another live claim is refused), BR-1348 (tasks of a branch).
 *
 * Throwaway repo + corpus, real `lore` subprocesses (see helpers/own-diff-fixture.ts); never the repo's own `.lore/`.
 *
 * Coverage: (1) HAPPY an own change outside the task's anchors and held by nobody lands and is recorded as
 * `outside_anchors`; (2) NEGATIVE a changed symbol and a deleted file held by another live claim are refused (exit 4,
 * BR-1346, `path#Symbol`, the holder, main/worktrees byte-unchanged); (3) STATE the same branch lands once the holder is
 * archived; (4) REGRESSION (simplest green-but-broken) files that reached the branch from main are not the branch's own
 * change, merged in or not.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";

const BASE = {
  "src/a.ts": "export function alpha(): number {\n  return 1;\n}\n",
  "src/b.ts": "export function foo(): number {\n  return 1;\n}\n\nexport function bar(): number {\n  return 2;\n}\n",
  "src/e.ts": "export const e = 1;\n",
};

let fx: OwnDiffFixture | undefined;

afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

function setup(): { fx: OwnDiffFixture; taskT: string; taskU: string } {
  const f = new OwnDiffFixture();
  fx = f;
  f.commitOnMain(BASE, "base sources");
  f.makeBranch("branch-y", { "y.txt": "y\n" });
  const taskT = f.createTask("T", ["src/a.ts"], "code");
  const taskU = f.createTask("U", ["src/b.ts#bar", "src/e.ts"], "code");
  f.claim(taskU, "branch-y");
  return { fx: f, taskT, taskU };
}

describe("AC-DJ-1 — the own diff is judged against the other live claims", () => {
  it("(1) a change outside the task's anchors and held by nobody lands and is recorded as outside_anchors", () => {
    const { fx: f, taskT } = setup();
    f.makeBranch("branch-x", {
      "src/a.ts": "export function alpha(): number {\n  return 10;\n}\n",
      "src/b.ts": "export function foo(): number {\n  return 11;\n}\n\nexport function bar(): number {\n  return 2;\n}\n",
      "src/c.ts": "export const c = 1;\n",
    });
    f.claim(taskT, "branch-x");

    const landed = f.integrate("branch-x");

    expect(landed.exitCode, landed.text).toBe(0);
    expect([...(f.landingOf(taskT)?.outside_anchors ?? [])].sort()).toEqual(["src/b.ts", "src/c.ts"]);
  }, 300_000);

  it("(2) a changed symbol and a deleted file held by another live claim are refused; (3) the branch lands once the holder is archived", () => {
    const { fx: f, taskU } = setup();
    const taskT2 = f.createTask("T2", ["src/a2.ts"], "code");
    f.makeBranch("branch-x2", {
      "src/b.ts": "export function foo(): number {\n  return 1;\n}\n\nexport function bar(): number {\n  return 22;\n}\n",
      "src/e.ts": null,
      "src/a2.ts": "export const a2 = 1;\n",
    });
    f.claim(taskT2, "branch-x2");
    const before = f.observableState();

    const refused = f.integrate("branch-x2");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1346");
    expect(refused.stderr).toContain("src/b.ts#bar");
    expect(refused.stderr).toContain("src/e.ts");
    expect(refused.stderr).toContain(taskU);
    expect(f.observableState()).toBe(before);

    // U's own branch lands, then U is archived: nothing is held any more
    const yLanded = f.integrate("branch-y");
    expect(yLanded.exitCode, yLanded.text).toBe(0);
    f.archive(taskU);

    const landed = f.integrate("branch-x2");

    expect(landed.exitCode, landed.text).toBe(0);
  }, 300_000);

  it("(4) files that reached the branch from main are not its own change, merged in or not", () => {
    const { fx: f } = setup();
    // X3 is cut first; main then changes src/e.ts (held by U) without any lore integrate
    f.makeBranch("branch-x3", { "src/a.ts": "export function alpha(): number {\n  return 30;\n}\n" });
    f.makeBranch("branch-x3m", { "src/am.ts": "export const am = 1;\n" });
    f.commitOnMain({ "src/e.ts": "export const e = 2;\n" }, "main moves e.ts after the branches were cut");
    f.mergeIntoBranch("branch-x3m", "main");
    const t3 = f.createTask("T3", ["src/a.ts"], "code");
    f.claim(t3, "branch-x3");

    const unmerged = f.integrate("branch-x3");
    expect(unmerged.exitCode, unmerged.text).toBe(0);

    const t3m = f.createTask("T3m", ["src/am.ts"], "code");
    f.claim(t3m, "branch-x3m");
    const merged = f.integrate("branch-x3m");
    expect(merged.exitCode, merged.text).toBe(0);
  }, 300_000);
});
