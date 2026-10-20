// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-landing-does-the-bookkeeping-claims-start-from-main-parked  AC-LB-2;
 *   business rules BR-1354 (a refusal for a held path names the holder's state), BR-1346 (a change held by another live
 *   claim is refused).
 *
 * Throwaway repo + corpus, real `lore` subprocesses (helpers/own-diff-fixture.ts, main-ref guard installed, floor
 * command `true`, each fixture claim under its own CLAUDE_CODE_SESSION_ID with the ambient one stripped).
 *
 * Coverage: (1) NEGATIVE task U holds a claim on src/x.ts; branch X changes it: exit 4, BR-1346, the path, U, the claim's
 * holder H and the claim's age in minutes. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a refusal naming only the slug
 * passes the exit-code check, so H and the age are asserted; (2) STATE the holder named is the one in the current claim
 * record (U released and claimed again by a new session names that session).
 */
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";

const BASE = { "src/x.ts": "export const x = 1;\n" };

let fx: OwnDiffFixture | undefined;

afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

/** Main holds src/x.ts; task U (anchor src/x.ts) holds a claim on branch-y; branch-x (task T) changes src/x.ts. */
function setup(): { fx: OwnDiffFixture; taskT: string; taskU: string } {
  const f = new OwnDiffFixture();
  fx = f;
  f.commitOnMain(BASE, "base sources");
  f.makeBranch("branch-y", { "y.txt": "y\n" });
  const taskU = f.createTask("U", ["src/x.ts"]);
  f.claim(taskU, "branch-y");
  // T anchors another file: its change to src/x.ts is outside its anchors, so only U's hold is in question
  f.makeBranch("branch-x", { "src/x.ts": "export const x = 2;\n" });
  const taskT = f.createTask("T", ["src/t.ts"]);
  f.claim(taskT, "branch-x");
  return { fx: f, taskT, taskU };
}

describe("AC-LB-2 — a refusal for a held path names the holder and the claim's age", () => {
  it("(1) exit 4 naming BR-1346, src/x.ts, U, the claim's holder H and its age in minutes", () => {
    const { fx: f, taskU } = setup();
    const holder = (f.extraOf(taskU)["claim"] as { by: string }).by;

    const refused = f.integrate("branch-x");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1346");
    expect(refused.stderr).toContain("src/x.ts");
    expect(refused.stderr).toContain(taskU);
    expect(refused.stderr).toContain("held claim");
    // simplest green-but-broken: a refusal naming only the slug
    expect(holder).toMatch(/^agent:session-/);
    expect(refused.stderr).toContain(holder);
    expect(refused.stderr).toMatch(/\(\d+ minutes old\)/);
  }, 300_000);

  it("(2) the named holder follows the claim record: a second holder is named after the claim moves", () => {
    const { fx: f, taskU } = setup();
    f.release(taskU);
    f.claim(taskU, "branch-y");
    const holder = (f.extraOf(taskU)["claim"] as { by: string }).by;

    const refused = f.integrate("branch-x");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain(holder);
    expect(refused.stderr).toMatch(/held claim by \S+ since \S+ \(\d+ minutes old\)/);
  }, 300_000);
});
