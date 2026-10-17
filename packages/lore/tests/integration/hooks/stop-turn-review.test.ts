// @spawns assets/hooks/post-edit-mark.mjs
// @spawns assets/hooks/stop-turn-review.mjs
// @spawns assets/hooks/user-prompt-turn-start.mjs
/**
 * AC-TE-3 (+ AC-TE-2 remaining half): stop-turn-review.mjs reviews the MAIN session's turn once —
 * silent when compliant, setting-gated on main-session source edits, one block listing every finding.
 * Throwaway git repos only.
 */
import { describe, it, expect } from "vitest";
import { loadConfigFromString } from "@lore/core";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { git } from "./hook-harness";
import {
  initLoreWithAnchoredSpec, makeFixture, markEdit, numberedLines, parseBlock, startTurn, stopTurn,
  writeRepoFile, writeTurnEndSetting,
} from "./turn-review-harness";

const FIFTY = numberedLines(50);

/** Fixture with the setting applied, the turn started, and `rel` written (50 lines) + marked as a main-session edit. */
function editedTurn(sid: string, setting: string | null, rel: string, text = FIFTY, agentId?: string) {
  const f = makeFixture(sid);
  if (setting !== null) writeTurnEndSetting(f.repo, setting);
  startTurn(f);
  const abs = writeRepoFile(f.repo, rel, text);
  markEdit(f, abs, agentId);
  return f;
}

describe("AC-TE-3 stop-turn-review", () => {
  it("AC-TE-3 a turn with no edits exits 0 with empty stdout", () => {
    const f = makeFixture("t1"); writeTurnEndSetting(f.repo, "block"); startTurn(f);
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-3 stop_hook_active true is silent even with a blockable edit", () => {
    const f = editedTurn("t2", "block", "src/big.ts");
    const r = stopTurn(f, { stop_hook_active: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-3 setting absent + 50-line main-session .ts edit is silent (default off)", () => {
    const f = editedTurn("t3", null, "src/big.ts");
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-3 setting off + the same edit is silent", () => {
    const r = stopTurn(editedTurn("t3b", "off", "src/big.ts"));
    expect(r.stdout).toBe("");
  });

  it("AC-TE-3 setting block + 50-line main-session .ts edit blocks once, naming the file and 'implementer'", () => {
    const f = editedTurn("t4", "block", "src/big.ts");
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    const block = parseBlock(r);
    expect(block.decision).toBe("block");
    expect(block.reason).toContain("src/big.ts");
    expect(block.reason).toContain("implementer");
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("AC-TE-3 setting block + 2-line edit (inside the 3-line allowance) is silent", () => {
    const f = makeFixture("t5", { "src/small.ts": numberedLines(20) });
    writeTurnEndSetting(f.repo, "block"); startTurn(f);
    const abs = writeRepoFile(f.repo, "src/small.ts", numberedLines(20).replace("line 3\n", "changed 3\n").replace("line 4\n", "changed 4\n"));
    markEdit(f, abs);
    expect(stopTurn(f).stdout).toBe("");
  });

  it("AC-TE-3 setting block + a 4-line edit exceeds the allowance and blocks", () => {
    const f = makeFixture("t5b", { "src/small.ts": numberedLines(20) });
    writeTurnEndSetting(f.repo, "block"); startTurn(f);
    const abs = writeRepoFile(f.repo, "src/small.ts", numberedLines(20).replace(/line [3-6]\n/g, "changed\n"));
    markEdit(f, abs);
    expect(parseBlock(stopTurn(f)).reason).toContain("src/small.ts");
  });

  it("AC-TE-3 setting block + 50-line edit under .claude/ is exempt", () => {
    expect(stopTurn(editedTurn("t6", "block", ".claude/hooks/helper.ts")).stdout).toBe("");
  });

  it("AC-TE-3 setting block + 50-line edit to a .json file is exempt", () => {
    expect(stopTurn(editedTurn("t7", "block", "package.json")).stdout).toBe("");
  });

  it("AC-TE-2 edits carrying agent_id are never counted as the main session's", () => {
    const f = editedTurn("t8", "block", "src/big.ts", FIFTY, "agent-abc");
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-3 two findings in one turn produce ONE block listing both", () => {
    const f = makeFixture("t9", { "src/anchored.ts": "export const a = 1;\n" });
    const slug = initLoreWithAnchoredSpec(f.repo, ["src/anchored.ts"]);
    git(f.repo, "add", "-A"); git(f.repo, "commit", "-qm", "lore");
    writeTurnEndSetting(f.repo, "block");
    // writeTurnEndSetting replaced the lore config; restore gates-off via a fresh append is unnecessary: reads only
    startTurn(f);
    rmSync(join(f.repo, "src", "anchored.ts"));
    markEdit(f, writeRepoFile(f.repo, "src/big.ts", FIFTY));
    const r = stopTurn(f);
    const block = parseBlock(r);
    expect(block.reason).toContain("src/big.ts");
    expect(block.reason).toContain(slug);
    expect(block.reason).toContain("src/anchored.ts");
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("AC-TE-3 unreadable turn state (no current-turn.id) exits 0 with ONE stderr line containing 'not measured'", () => {
    const f = makeFixture("t10"); // turn never started
    const r = stopTurn(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const lines = r.stderr.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not measured");
  });

  it("AC-TE-3 malformed stdin exits 0 with a 'not measured' line, never a block", () => {
    const f = makeFixture("t11");
    const r = stopTurn(f, { session_id: 42 });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("not measured");
  });

  it("AC-TE-3 an unrecognised setting value is reported as 'not measured' and treated as off", () => {
    const r = stopTurn(editedTurn("t12", "maybe", "src/big.ts"));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("not measured");
  });
});

describe("AC-TE-3 workflow.turn_end.main_session_source_edits setting", () => {
  const load = (yaml: string) => loadConfigFromString(`project:\n  name: t\n  author: o\n${yaml}`);

  it("AC-TE-3 defaults to off when turn_end is empty and stays absent when the section is absent", () => {
    const bare = load("");
    expect(bare.ok && bare.value.workflow?.turn_end?.main_session_source_edits === undefined).toBe(true);
    const empty = load("workflow:\n  turn_end: {}\n");
    expect(empty.ok && empty.value.workflow?.turn_end?.main_session_source_edits).toBe("off");
  });

  it("AC-TE-3 accepts block and rejects any other value", () => {
    const block = load("workflow:\n  turn_end:\n    main_session_source_edits: block\n");
    expect(block.ok && block.value.workflow?.turn_end?.main_session_source_edits).toBe("block");
    expect(load("workflow:\n  turn_end:\n    main_session_source_edits: maybe\n").ok).toBe(false);
  });
});
