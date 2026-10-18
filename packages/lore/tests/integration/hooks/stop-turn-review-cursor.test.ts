// @spawns assets/hooks/stop-turn-review.mjs
// @spawns assets/hooks/user-prompt-turn-start.mjs
/**
 * @spec_ref AC-ST-9
 *
 * Each helper END is judged by exactly one completed turn-end review: the review snapshots every helper's
 * `end_count` when it starts, spawns `lore session trail-review`, and only after that succeeded writes
 * `helpers/<agent_id>.judged.json` = the snapshot (spec Design > Consumers, "Judging each helper end once").
 * `lore` is a PATH stub (trail-review-stub.ts); throwaway git repos and mkdtemp state bases only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { readSessionTrail } from "@lore/core/node";
import { makeFixture, numberedLines, parseBlock, startTurn, writeRepoFile, writeTurnEndSetting, type TurnFixture } from "./turn-review-harness";
import { EMPTY_REVIEW, makeLoreStub, readJudged, readJudgedAt, stopTurnWithStub, writeHelperEnd, type LoreStub } from "./trail-review-stub";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function setup(): { f: TurnFixture; stub: LoreStub } {
  const f = makeFixture("S9");
  const stub = makeLoreStub();
  cleanup.push(f.repo, f.base, stub.binDir);
  return { f, stub };
}

const FINDING = JSON.stringify({
  ok: true,
  data: { helpers: [], findings: [{ kind: "outside-anchors", helper: "A1", file: "src/x.ts", tasks: ["t-1"], message: "Helper A1 changed src/x.ts outside the anchors of t-1" }] },
});

/** One full turn: open it, then run the Stop hook. */
function turn(f: TurnFixture, stub: LoreStub, extra: Record<string, unknown> = {}) {
  startTurn(f);
  return stopTurnWithStub(f, stub, extra);
}

describe("AC-ST-9 each helper end is judged by exactly one completed review", () => {
  it("AC-ST-9 a helper ending between turn 4 review and turn 5 opening is judged by turn 5 and not by turn 6", () => {
    const { f, stub } = setup();
    for (let n = 1; n <= 4; n++) turn(f, stub);
    expect(stub.reviewCalls()).toHaveLength(0);
    writeHelperEnd(f, "A1", 1); // lands after the turn-4 review, before turn 5 opens
    stub.reply({ stdout: FINDING });
    const fifth = turn(f, stub);
    expect(stub.reviewCalls()).toHaveLength(1);
    expect(parseBlock(fifth).reason).toContain("Helper A1 changed src/x.ts outside the anchors of t-1");
    expect(readJudged(f, "A1")).toBe(1);
    const sixth = turn(f, stub);
    expect(stub.reviewCalls()).toHaveLength(1); // not spawned again
    expect(sixth.stdout).toBe("");
  });

  it("AC-ST-9 two helpers ending in turn 2 are both judged by the turn-2 review", () => {
    const { f, stub } = setup();
    turn(f, stub);
    startTurn(f);
    writeHelperEnd(f, "A1", 1);
    writeHelperEnd(f, "A2", 3);
    const r = stopTurnWithStub(f, stub);
    expect(r.status).toBe(0);
    expect(stub.reviewCalls()).toHaveLength(1);
    expect(readJudged(f, "A1")).toBe(1);
    expect(readJudged(f, "A2")).toBe(3);
  });

  it("AC-ST-9 a review with no finding still records judged_end_count equal to the end_count it read", () => {
    const { f, stub } = setup();
    writeHelperEnd(f, "A1", 2);
    stub.reply({ stdout: EMPTY_REVIEW });
    const r = turn(f, stub);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(readJudged(f, "A1")).toBe(2);
  });

  it("AC-ST-9 a trail-review that exits non-zero leaves judged_end_count unchanged, names the helper, and the next review judges it", () => {
    const { f, stub } = setup();
    writeHelperEnd(f, "A1", 1);
    stub.reply({ exit: 3, stdout: "" });
    const failed = turn(f, stub);
    expect(failed.status).toBe(0);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toContain("not measured");
    expect(failed.stderr).toContain("A1");
    expect(readJudged(f, "A1")).toBeNull();
    stub.reply({ stdout: EMPTY_REVIEW });
    turn(f, stub);
    expect(stub.reviewCalls()).toHaveLength(2);
    expect(readJudged(f, "A1")).toBe(1);
  });

  it("AC-ST-9 a failed review with no other finding stays silent on stdout and names the helper on stderr", () => {
    const { f, stub } = setup();
    writeHelperEnd(f, "A1", 1);
    stub.reply({ exit: 2 });
    const r = turn(f, stub);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/not measured:.*A1/);
  });

  it("AC-ST-9 a failed review next to another finding puts the not-measured line in the one block", () => {
    const { f, stub } = setup();
    writeTurnEndSetting(f.repo, "block");
    startTurn(f);
    writeRepoFile(f.repo, "src/e.ts", numberedLines(10, "sed")); // shell edit: a source-edit finding
    writeHelperEnd(f, "A1", 1);
    stub.reply({ exit: 2 });
    const r = stopTurnWithStub(f, stub);
    const block = parseBlock(r);
    expect(block.decision).toBe("block");
    expect(block.reason).toContain("src/e.ts");
    expect(block.reason).toMatch(/Not measured:.*A1/);
    expect(readJudged(f, "A1")).toBeNull();
  });

  it("AC-ST-9 a helper judged at end 1 that ends again is judged once for end 2 and end 1 is not re-reported", () => {
    const { f, stub } = setup();
    writeHelperEnd(f, "A1", 1);
    stub.reply({ stdout: FINDING });
    expect(parseBlock(turn(f, stub)).reason).toContain("outside the anchors");
    expect(readJudged(f, "A1")).toBe(1);
    expect(turn(f, stub).stdout).toBe("");
    expect(stub.reviewCalls()).toHaveLength(1);
    writeHelperEnd(f, "A1", 2);
    stub.reply({ stdout: EMPTY_REVIEW });
    const again = turn(f, stub);
    expect(again.stdout).toBe("");
    expect(stub.reviewCalls()).toHaveLength(2);
    expect(readJudged(f, "A1")).toBe(2);
    turn(f, stub);
    expect(stub.reviewCalls()).toHaveLength(2);
  });

  it("AC-ST-9 a SubagentStop landing while the review runs is not marked judged by it and is judged by the next", () => {
    const { f, stub } = setup();
    const file = writeHelperEnd(f, "A1", 1);
    stub.reply({ bumpHelper: { file, endCount: 2 } });
    turn(f, stub);
    expect(readJudged(f, "A1")).toBe(1); // the snapshot, not the re-read 2
    stub.reply({});
    turn(f, stub);
    expect(stub.reviewCalls()).toHaveLength(2);
    expect(readJudged(f, "A1")).toBe(2);
    turn(f, stub);
    expect(stub.reviewCalls()).toHaveLength(2);
  });

  it("AC-ST-9 a turn that is already continuing after a block neither spawns nor marks anything judged", () => {
    const { f, stub } = setup();
    writeHelperEnd(f, "A1", 1);
    const quiet = turn(f, stub, { stop_hook_active: true });
    expect(quiet.stdout).toBe("");
    expect(stub.reviewCalls()).toHaveLength(0);
    expect(readJudged(f, "A1")).toBeNull();
  });
});

describe("AU-T25 the review stamps when it judged a helper end", () => {
  it("AU-T25 judged.json carries judged_at_ms taken no earlier than the review started, and the core reader returns it", () => {
    const { f, stub } = setup();
    writeHelperEnd(f, "A1", 1);
    stub.reply({ stdout: EMPTY_REVIEW });
    const before = Date.now();
    const r = turn(f, stub);
    expect(r.status).toBe(0);
    const stamp = readJudgedAt(f, "A1");
    expect(stamp).not.toBeNull();
    expect(stamp!).toBeGreaterThanOrEqual(before);
    expect(stamp!).toBeLessThanOrEqual(Date.now());
    const trail = readSessionTrail(f.sid, f.base);
    expect(trail?.helpers.find((h) => h.agent_id === "A1")?.judged_at_ms).toBe(stamp);
  });
});
