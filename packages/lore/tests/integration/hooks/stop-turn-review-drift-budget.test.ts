// @spawns assets/hooks/post-edit-mark.mjs
// @spawns assets/hooks/stop-turn-review.mjs
// @spawns assets/hooks/user-prompt-turn-start.mjs
/**
 * AC-TE-4: stop-turn-review.mjs anchor drift (measured against the turn-start snapshot, so Bash
 * rm / git mv count) and CLAUDE.md budget (delegated to `lore status --check-claude-md`).
 * Throwaway lore git projects only; needs `lore` on PATH.
 */
import { describe, it, expect } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { git } from "./hook-harness";
import {
  initLoreWithAnchoredSpec, makeFixture, markEdit, numberedLines, parseBlock, startTurn, stopTurn, writeRepoFile,
  type TurnFixture,
} from "./turn-review-harness";

const ANCHORED = "src/anchored.ts";

function anchoredProject(sid: string): { f: TurnFixture; slug: string } {
  const f = makeFixture(sid, { [ANCHORED]: "export const a = 1;\n", "src/other.ts": "export const b = 2;\n" });
  const slug = initLoreWithAnchoredSpec(f.repo, [ANCHORED]);
  git(f.repo, "add", "-A"); git(f.repo, "commit", "-qm", "lore project");
  return { f, slug };
}

describe("AC-TE-4 anchor drift against the turn-start snapshot", () => {
  it("AC-TE-4 an anchored file removed with a Bash rm (no Edit payload) blocks, naming spec slug and path", () => {
    const { f, slug } = anchoredProject("d1");
    startTurn(f);
    rmSync(join(f.repo, ANCHORED));
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    const block = parseBlock(r);
    expect(block.decision).toBe("block");
    expect(block.reason).toContain(slug);
    expect(block.reason).toContain(ANCHORED);
  });

  it("AC-TE-4 an anchored file renamed with git mv blocks", () => {
    const { f, slug } = anchoredProject("d2");
    startTurn(f);
    git(f.repo, "mv", ANCHORED, "src/renamed.ts");
    const block = parseBlock(stopTurn(f));
    expect(block.reason).toContain(slug);
    expect(block.reason).toContain(ANCHORED);
  });

  it("AC-TE-4 an anchored file edited and still present is silent", () => {
    const { f } = anchoredProject("d3");
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, ANCHORED, "export const a = 2;\n"));
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-4 an anchor already missing at the snapshot (earlier uncommitted turn) is pre-existing drift, not a finding", () => {
    const { f } = anchoredProject("d4");
    rmSync(join(f.repo, ANCHORED)); // deleted BEFORE this turn starts
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "src/other.ts", "export const b = 3;\n"));
    expect(stopTurn(f).stdout).toBe("");
  });

  it("AC-TE-4 removing a file no spec anchors is silent", () => {
    const { f } = anchoredProject("d5");
    startTurn(f);
    rmSync(join(f.repo, "src", "other.ts"));
    expect(stopTurn(f).stdout).toBe("");
  });
});

describe("AC-TE-4 CLAUDE.md budget", () => {
  it("AC-TE-4 a CLAUDE.md edited past its ceiling blocks, carrying the check-claude-md report", () => {
    const f = makeFixture("c1");
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "CLAUDE.md", numberedLines(450, "rule")));
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    const block = parseBlock(r);
    expect(block.decision).toBe("block");
    expect(block.reason).toContain("CLAUDE.md");
    expect(block.reason).toMatch(/ceiling|exceeds|lines/i);
  });

  it("AC-TE-4 a CLAUDE.md edited within budget is silent", () => {
    const f = makeFixture("c2");
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "CLAUDE.md", numberedLines(20, "rule")));
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-4 an over-budget CLAUDE.md that THIS turn did not touch is not re-reported", () => {
    const f = makeFixture("c3", { "CLAUDE.md": numberedLines(450, "rule") });
    startTurn(f);
    markEdit(f, writeRepoFile(f.repo, "src/x.txt", "x\n"));
    expect(stopTurn(f).stdout).toBe("");
  });
});
