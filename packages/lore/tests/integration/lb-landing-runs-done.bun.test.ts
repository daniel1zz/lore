// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-landing-does-the-bookkeeping-claims-start-from-main-parked  AC-LB-4;
 *   business rule BR-1356 (a landing runs the done walk for every task of the branch; a refusal never rolls main back).
 *
 * Throwaway repo + corpus, real `lore` subprocesses (helpers/own-diff-fixture.ts, main-ref guard installed, floor
 * command `true`, each fixture claim under its own CLAUDE_CODE_SESSION_ID with the ambient one stripped).
 *
 * Coverage: (1) HAPPY complete runner-attested evidence: integrate archives the task with no separate `lore done`;
 * (2) NEGATIVE only a filtered pass of the anchored test file: integrate exits 0, the branch is on main, the task stays
 * unarchived, stdout names the unfiltered-test-file floor and a `lore evidence` command for that file.
 * REGRESSION (simplest green-but-broken): a landing that rolls main back when done refuses; main must contain X2.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";
import { approvedTask, DONE_CONTRACT_FIXTURE_CONFIG } from "./support/own-diff-contract.js";

const BASE = {
  "src/a.ts": "export const a = 1;\n",
  "tests/a.test.ts": 'import { expect, test } from "bun:test";\ntest("a case", () => { expect(1).toBe(1); });\n',
  "tests/b.test.ts": 'import { expect, test } from "bun:test";\ntest("b case", () => { expect(1).toBe(1); });\n',
};

let fx: OwnDiffFixture | undefined;

afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

function statusOf(f: OwnDiffFixture, slug: string): string {
  const payload = JSON.parse(f.mustLore(["get", slug, "--json"]).stdout) as { data: { doc: { status: string } } };
  return payload.data.doc.status;
}

describe("AC-LB-4 — landing archives tasks whose floors are met", () => {
  it("(1) complete attested evidence: integrate archives the task, no separate lore done", () => {
    const f = new OwnDiffFixture(DONE_CONTRACT_FIXTURE_CONFIG);
    fx = f;
    f.commitOnMain(BASE, "base sources");
    f.makeBranch("branch-x", { "src/a.ts": "export const a = 2;\n" });
    // reason: the landing runs the task's contract oracles itself (its anchored test file whole, typecheck) and records the rows
    // (AC-DCS2-1), so the task is approved with its contract and holds no evidence of its own before the landing.
    const task = approvedTask(f, "T", ["src/a.ts", "tests/a.test.ts"]);
    f.claim(task, "branch-x");
    f.release(task);
    f.mustLore(["set", f.defaultPlan, "--status", "approved"]);

    const landed = f.integrate("branch-x");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(statusOf(f, task)).toBe("archived");
  }, 300_000);

  // reason: the unfiltered whole-file run of an anchored test file is an oracle `lore integrate` runs itself (AC-DCS2-1), so a landing can
  // no longer end with that floor unmet: the case that keeps a landed task unarchived with its floor named is now the red run, which
  // only a runner can produce before the work and which the landing cannot invent (approve without a waiver requires it, AC-DCS1-5).
  it("(2) no red run on record: exit 0, the branch is on main, the task stays unarchived, stdout names the red-first floor and the evidence command", () => {
    const f = new OwnDiffFixture(DONE_CONTRACT_FIXTURE_CONFIG);
    fx = f;
    f.commitOnMain(BASE, "base sources");
    f.makeBranch("branch-x2", { "src/a.ts": "export const a = 3;\n" });
    const task = approvedTask(f, "T2", ["src/a.ts", "tests/b.test.ts"], undefined, false);
    f.claim(task, "branch-x2");
    f.release(task);
    f.mustLore(["set", f.defaultPlan, "--status", "approved"]);
    const mainBefore = f.git(["rev-parse", "refs/heads/main"]);

    const landed = f.integrate("branch-x2");

    expect(landed.exitCode, landed.text).toBe(0);
    // simplest green-but-broken: main rolled back to its old tip because the done walk refused
    const mainAfter = f.git(["rev-parse", "refs/heads/main"]);
    expect(mainAfter).not.toBe(mainBefore);
    // git exits 1 (and the helper throws) unless the branch tip is an ancestor of main
    f.git(["merge-base", "--is-ancestor", "branch-x2", "refs/heads/main"]);
    expect(statusOf(f, task)).not.toBe("archived");
    expect(landed.stdout).toContain("red-first");
    expect(landed.stdout).toContain(`lore evidence ${task} --oracle`);
  }, 300_000);
});
