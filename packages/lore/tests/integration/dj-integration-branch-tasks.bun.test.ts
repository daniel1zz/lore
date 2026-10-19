// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end  AC-DJ-3;
 *   business rules BR-1346 (collision with another live claim), BR-1348 (the tasks of a branch).
 *
 * Throwaway repo + corpus. Plan P declares integration branch I; its tasks T1 and T2 are claimed on their own branches,
 * which are merged into I; no task is claimed on I. Task U (another plan) holds src/z.ts on an unlanded branch.
 *
 * Coverage: (1) HAPPY I lands and the landing is recorded on T1 and T2 (REGRESSION, simplest green-but-broken: a judge
 * that reads only claims recorded on the branch would treat T1 and T2 as other live claims); (2) NEGATIVE a change to
 * what U holds is refused naming BR-1346, the path and U; (3) NEGATIVE a branch of no plan with no task is refused
 * naming BR-1348 and the branch.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";

let fx: OwnDiffFixture | undefined;

afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

describe("AC-DJ-3 — an integration branch is judged against its plan's tasks", () => {
  it("(1) lands and records on every task of the plan; (2) refuses what another plan's task holds; (3) refuses a branch with no task", () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n", "src/z.ts": "export const z = 1;\n" }, "base sources");
    const t1 = f.createTask("T1", ["src/a.ts"]);
    const t2 = f.createTask("T2", ["src/b.ts"]);
    const otherPlan = f.createPlan("Other plan");
    const u = f.createTask("U", ["src/z.ts"], otherPlan);
    f.makeBranch("t1-branch", { "src/a.ts": "export const a = 2;\n" });
    f.makeBranch("t2-branch", { "src/b.ts": "export const b = 2;\n" });
    f.makeBranch("branch-y", { "y.txt": "y\n" });
    f.claim(t1, "t1-branch");
    f.claim(t2, "t2-branch");
    f.claim(u, "branch-y");
    f.makeBranch("integration-i", { "i.txt": "i\n" });
    f.mergeIntoBranch("integration-i", "t1-branch");
    f.mergeIntoBranch("integration-i", "t2-branch");
    f.mustLore(["plan", "integration-branch", f.defaultPlan, "integration-i"]);

    const landed = f.integrate("integration-i");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(f.landingOf(t1)?.branch).toBe("integration-i");
    expect(f.landingOf(t2)?.branch).toBe("integration-i");

    f.commitOnBranch("integration-i", { "src/z.ts": "export const z = 2;\n" });
    const refused = f.integrate("integration-i");
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1346");
    expect(refused.stderr).toContain("src/z.ts");
    expect(refused.stderr).toContain(u);

    f.makeBranch("branch-j", { "j.txt": "j\n" });
    const orphan = f.integrate("branch-j");
    expect(orphan.exitCode, orphan.text).toBe(4);
    expect(orphan.stderr).toContain("BR-1348");
    expect(orphan.stderr).toContain("branch-j");
  }, 300_000);
});
