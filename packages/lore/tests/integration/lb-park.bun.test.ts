// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-landing-does-the-bookkeeping-claims-start-from-main-parked  AC-LB-2;
 *   business rule BR-1354 (parking releases a hold), BR-1346 (a change held by another live claim is refused).
 *
 * Throwaway repo + corpus, real `lore` subprocesses (helpers/own-diff-fixture.ts, main-ref guard installed, floor
 * command `true`, each fixture claim under its own CLAUDE_CODE_SESSION_ID with the ambient one stripped).
 *
 * Coverage: (1) NEGATIVE an unlanded branch of a released task holds its anchor: exit 4, BR-1346, the path, the holder
 * and `unlanded branch` with the branch's last commit time; (2) HAPPY `lore park` exits 0 and the same integrate lands;
 * REGRESSION (simplest green-but-broken) parking deletes neither the branch nor the task's anchors; (3) STATE a
 * parked task that is claimed again holds again, as a `held claim`; (4) BOUNDARY `lore park` without `--reason` exits 2.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";

const BASE = { "src/x.ts": "export const x = 1;\n" };

let fx: OwnDiffFixture | undefined;

afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

/** Main holds src/x.ts; task U (anchor src/x.ts) was claimed on unlanded branch-y and released; branch-x (task T) changes src/x.ts. */
function setup(): { fx: OwnDiffFixture; taskT: string; taskU: string } {
  const f = new OwnDiffFixture();
  fx = f;
  f.commitOnMain(BASE, "base sources");
  f.makeBranch("branch-y", { "y.txt": "y\n" });
  const taskU = f.createTask("U", ["src/x.ts"]);
  f.claim(taskU, "branch-y");
  f.release(taskU);
  f.makeBranch("branch-x", { "src/x.ts": "export const x = 2;\n" });
  const taskT = f.createTask("T", ["src/x.ts"]);
  f.claim(taskT, "branch-x");
  return { fx: f, taskT, taskU };
}

describe("AC-LB-2 — parked work releases its hold", () => {
  it("(1) the unlanded branch of a released task holds its anchor: exit 4, BR-1346, names U and the branch's last commit time", () => {
    const { fx: f, taskU } = setup();
    const lastCommit = f.git(["log", "-1", "--format=%cI", "branch-y"]);

    const refused = f.integrate("branch-x");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1346");
    expect(refused.stderr).toContain("src/x.ts");
    expect(refused.stderr).toContain(taskU);
    expect(refused.stderr).toContain("unlanded branch");
    expect(refused.stderr).toContain("branch-y");
    expect(refused.stderr).toContain(lastCommit);
  }, 300_000);

  it("(2) lore park exits 0 and the same integrate lands; parking deletes neither the branch nor the anchors", () => {
    const { fx: f, taskU } = setup();
    const yTip = f.git(["rev-parse", "branch-y"]);

    const parked = f.lore(["park", taskU, "--reason", "r"]);

    expect(parked.exitCode, parked.text).toBe(0);
    const extra = f.extraOf(taskU);
    expect(extra["parked"]).toMatchObject({ reason: "r" });
    expect(typeof (extra["parked"] as { at: unknown }).at).toBe("string");
    expect(typeof (extra["parked"] as { by: unknown }).by).toBe("string");
    // simplest green-but-broken: a park that removed the hold by deleting the branch or the anchors
    expect(f.git(["rev-parse", "branch-y"])).toBe(yTip);
    expect(extra["file_anchors"]).toEqual(["src/x.ts"]);

    const landed = f.integrate("branch-x");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(f.git(["rev-parse", "branch-y"])).toBe(yTip);
    expect(f.extraOf(taskU)["file_anchors"]).toEqual(["src/x.ts"]);
  }, 300_000);

  it("(3) a parked task claimed again holds again, as a held claim", () => {
    const { fx: f, taskU } = setup();
    expect(f.lore(["park", taskU, "--reason", "r"]).exitCode).toBe(0);
    f.claim(taskU, "branch-y");

    const refused = f.integrate("branch-x");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1346");
    expect(refused.stderr).toContain(taskU);
    expect(refused.stderr).toContain("held claim");
  }, 300_000);

  it("(4) lore park without --reason exits 2 and parks nothing; a non-task exits 4, an unknown slug 3", () => {
    const { fx: f, taskU } = setup();

    const missing = f.lore(["park", taskU]);
    const blank = f.lore(["park", taskU, "--reason", "  "]);
    const notTask = f.lore(["park", f.defaultPlan, "--reason", "r"]);
    const unknown = f.lore(["park", "task-does-not-exist", "--reason", "r"]);

    expect(missing.exitCode, missing.text).toBe(2);
    expect(blank.exitCode, blank.text).toBe(2);
    expect(notTask.exitCode, notTask.text).toBe(4);
    expect(unknown.exitCode, unknown.text).toBe(3);
    expect(f.extraOf(taskU)["parked"]).toBeUndefined();
  }, 300_000);
});
