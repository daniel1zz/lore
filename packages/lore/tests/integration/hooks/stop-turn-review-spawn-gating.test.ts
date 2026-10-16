/**
 * @spec_ref AC-ST-10
 *
 * The turn-end review spawns `lore session trail-review` only when some helper end is unjudged or the
 * `workflow.turn_end.co_change` key is present in `.lore/config.yaml` (spec Design, "Spawn gating"; key
 * PRESENCE only — the co-change judgment itself is another task). `lore` is a counting PATH stub.
 */
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { makeFixture, numberedLines, startTurn, writeRepoFile, type TurnFixture } from "./turn-review-harness";
import { makeLoreStub, stopTurnWithStub, writeHelperEnd, type LoreStub } from "./trail-review-stub";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

const CONFIG_WITHOUT_KEY = "project:\n  name: t\n  author: owner\nworkflow:\n  turn_end:\n    main_session_source_edits: off\n";
const CONFIG_WITH_KEY = `${CONFIG_WITHOUT_KEY}    co_change:\n      - name: assets-manifest\n        when: ["assets/**"]\n        require: ["manifest.ts"]\n`;

function setup(config: string): { f: TurnFixture; stub: LoreStub } {
  const f = makeFixture("S10");
  writeRepoFile(f.repo, ".lore/config.yaml", config);
  const stub = makeLoreStub();
  cleanup.push(f.repo, f.base, stub.binDir);
  startTurn(f);
  return { f, stub };
}

describe("AC-ST-10 trail-review spawn gating", () => {
  it("AC-ST-10 no unjudged helper end and no co_change key spawns trail-review zero times", () => {
    const { f, stub } = setup(CONFIG_WITHOUT_KEY);
    writeRepoFile(f.repo, "src/a.ts", numberedLines(2)); // a busy turn, still nothing to judge
    const r = stopTurnWithStub(f, stub);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(stub.reviewCalls()).toHaveLength(0);
    expect(stub.calls().filter((argv) => argv.includes("session"))).toHaveLength(0);
  });

  it("AC-ST-10 adding the co_change key makes it spawn exactly once", () => {
    const { f, stub } = setup(CONFIG_WITHOUT_KEY);
    expect(stopTurnWithStub(f, stub).status).toBe(0);
    expect(stub.reviewCalls()).toHaveLength(0);
    writeFileSync(join(f.repo, ".lore", "config.yaml"), CONFIG_WITH_KEY);
    startTurn(f);
    expect(stopTurnWithStub(f, stub).status).toBe(0);
    expect(stub.reviewCalls()).toHaveLength(1);
  });

  it("AC-ST-10 an unjudged helper end makes it spawn exactly once", () => {
    const { f, stub } = setup(CONFIG_WITHOUT_KEY);
    writeHelperEnd(f, "A1", 1);
    expect(stopTurnWithStub(f, stub).status).toBe(0);
    expect(stub.reviewCalls()).toHaveLength(1);
    const argv = stub.reviewCalls()[0]!;
    expect(argv.slice(argv.indexOf("session"), argv.indexOf("session") + 2)).toEqual(["session", "trail-review"]);
  });

  it("AC-ST-10 a helper end already judged spawns nothing", () => {
    const { f, stub } = setup(CONFIG_WITHOUT_KEY);
    writeHelperEnd(f, "A1", 1);
    stopTurnWithStub(f, stub);
    startTurn(f);
    stopTurnWithStub(f, stub);
    expect(stub.reviewCalls()).toHaveLength(1);
  });
});
