// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end  AC-DJ-2;
 *   business rules BR-1347 (co-change judged on the branch's own change).
 *
 * Throwaway repo + corpus with a declared co-change rule {name: manifest, when: assets/**, require: gen/manifest.ts}.
 *
 * Coverage: (1) NEGATIVE a change matching the trigger without the required file is refused (exit 4, BR-1347, the rule
 * name) and main is unchanged; (2) HAPPY the same branch with the required file added lands, although the required file
 * is outside every anchor (REGRESSION, simplest green-but-broken: coverage is not a BR-1346 collision); (3) BOUNDARY a
 * change that does not match the trigger needs nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";
import { approvedTask, DONE_CONTRACT_FIXTURE_CONFIG } from "./support/own-diff-contract.js";

const RULE = [
  "  turn_end:",
  "    co_change:",
  "      - name: manifest",
  '        when: ["assets/**"]',
  '        require: ["gen/manifest.ts"]',
];

let fx: OwnDiffFixture | undefined;

afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

describe("AC-DJ-2 — co-change is judged on the branch's own change", () => {
  it("(1) a trigger without its required file is refused; (2) adding the required file lands, and it is recorded outside the anchors", () => {
    const f = new OwnDiffFixture([...RULE, ...DONE_CONTRACT_FIXTURE_CONFIG]);
    fx = f;
    const task = approvedTask(f, "Assets", ["assets/"]);
    f.makeBranch("branch-assets", { "assets/x.txt": "x\n" });
    f.claim(task, "branch-assets");
    const before = f.observableState();

    const refused = f.integrate("branch-assets");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1347");
    expect(refused.stderr).toContain("manifest");
    expect(f.observableState()).toBe(before);

    f.commitOnBranch("branch-assets", { "gen/manifest.ts": "export const manifest = 1;\n" });
    const landed = f.integrate("branch-assets");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(f.landingOf(task)?.outside_anchors).toEqual(["gen/manifest.ts"]);
  }, 300_000);

  it("(3) a change that does not match the trigger needs no co-change", () => {
    const f = new OwnDiffFixture([...RULE, ...DONE_CONTRACT_FIXTURE_CONFIG]);
    fx = f;
    const task = approvedTask(f, "Docs", ["docs/"]);
    f.makeBranch("branch-docs", { "docs/y.txt": "y\n" });
    f.claim(task, "branch-docs");

    const landed = f.integrate("branch-docs");

    expect(landed.exitCode, landed.text).toBe(0);
  }, 300_000);
});
