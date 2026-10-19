// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-landing-does-the-bookkeeping-claims-start-from-main-parked  BR-1346 (holder scope);
 *   AC-LB-2 (holder query).
 *
 * What another task HOLDS at `lore integrate`: a holder with only an unlanded branch holds exactly what that branch's
 * own change touched (per path and per top-level symbol) intersected with its anchors; a holder with a held claim keeps
 * its declared anchors, except that a directory anchor holds only the files its branch changed.
 *
 * Coverage: (1) disjoint symbols of one file both land; (2) the same symbol changed on both sides is refused, naming the
 * symbol and the branch state; (3) an unlanded branch that never touched its anchor holds nothing; (4) a new file under
 * a held claim's directory anchor lands, a file its branch changed there is refused.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";

const B_BASE = "export function foo(): number {\n  return 1;\n}\n\nexport function bar(): number {\n  return 2;\n}\n";
const B_FOO_CHANGED = B_BASE.replace("return 1;", "return 10;");
const B_BAR_CHANGED = B_BASE.replace("return 2;", "return 20;");
const BASE = { "src/b.ts": B_BASE, "src/dir/old.ts": "export const old = 1;\n", "src/other.ts": "export const other = 1;\n" };

let fx: OwnDiffFixture | undefined;

afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

function start(): OwnDiffFixture {
  const f = new OwnDiffFixture();
  fx = f;
  f.commitOnMain(BASE, "base sources");
  return f;
}

describe("BR-1346 — what a holder holds", () => {
  it("(1) disjoint symbols of one file both land; (2) the same symbol on both sides is refused, naming it", () => {
    const f = start();
    // U: whole-file anchor, released, its unlanded branch changed bar
    f.makeBranch("branch-u", { "src/b.ts": B_BAR_CHANGED });
    const taskU = f.createTask("U", ["src/b.ts"]);
    f.claim(taskU, "branch-u");
    f.release(taskU);
    // T: symbol-scoped anchor on foo; its branch changed foo
    f.makeBranch("branch-t", { "src/b.ts": B_FOO_CHANGED });
    const taskT = f.createTask("T", ["src/b.ts#foo"]);
    f.claim(taskT, "branch-t");
    // T2: symbol-scoped anchor on bar; its branch changed bar too
    f.makeBranch("branch-t2", { "src/b.ts": B_BAR_CHANGED.replace("return 20;", "return 21;") });
    const taskT2 = f.createTask("T2", ["src/b.ts#bar"]);
    f.claim(taskT2, "branch-t2");
    const lastCommit = f.git(["log", "-1", "--format=%cI", "branch-u"]);

    const landed = f.integrate("branch-t");
    const refused = f.integrate("branch-t2");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1346");
    expect(refused.stderr).toContain("src/b.ts#bar");
    expect(refused.stderr).toContain(taskU);
    expect(refused.stderr).toContain("unlanded branch branch-u");
    expect(refused.stderr).toContain(lastCommit);
  }, 300_000);

  it("(3) an unlanded branch that never touched its anchored file holds nothing", () => {
    const f = start();
    f.makeBranch("branch-u", { "src/other.ts": "export const other = 2;\n" });
    const taskU = f.createTask("U", ["src/b.ts"]);
    f.claim(taskU, "branch-u");
    f.release(taskU);
    f.makeBranch("branch-t", { "src/b.ts": B_FOO_CHANGED });
    const taskT = f.createTask("T", ["src/t.ts"]);
    f.claim(taskT, "branch-t");

    const landed = f.integrate("branch-t");

    expect(landed.exitCode, landed.text).toBe(0);
  }, 300_000);

  it("(4) a new file under a held claim's directory anchor lands; a file its branch changed there is refused", () => {
    const f = start();
    f.makeBranch("branch-v", { "src/other.ts": "export const other = 3;\n" });
    const taskV = f.createTask("V", ["src/dir/"]);
    f.claim(taskV, "branch-v");
    f.makeBranch("branch-new", { "src/dir/new.ts": "export const fresh = 1;\n" });
    const taskN = f.createTask("N", ["src/n.ts"]);
    f.claim(taskN, "branch-new");

    const landed = f.integrate("branch-new");

    expect(landed.exitCode, landed.text).toBe(0);

    // now V's branch really changes a file under its directory anchor
    f.commitOnBranch("branch-v", { "src/dir/old.ts": "export const old = 2;\n" });
    f.makeBranch("branch-old", { "src/dir/old.ts": "export const old = 3;\n" });
    const taskO = f.createTask("O", ["src/o.ts"]);
    f.claim(taskO, "branch-old");

    const refused = f.integrate("branch-old");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1346");
    expect(refused.stderr).toContain("src/dir/old.ts");
    expect(refused.stderr).toContain(taskV);
    expect(refused.stderr).toContain("held claim");
  }, 300_000);
});
