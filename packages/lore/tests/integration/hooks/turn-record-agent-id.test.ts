/** AC-TE-2 (recording half): post-edit-mark records agent_id/agent_type from the hook payload. */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { currentTurnDir, makeGitRepo, makeTmpDir, readJsonl, runHook } from "./hook-harness";
import { makeFixture, markEdit, numberedLines, startTurn as startTurn_, stopTurn, writeRepoFile, writeTurnEndSetting } from "./turn-review-harness";

function startTurn(stateBase: string, sid: string, cwd: string) {
  runHook("user-prompt-turn-start.mjs", { session_id: sid, cwd, hook_event_name: "UserPromptSubmit", prompt: "x" }, stateBase);
}

describe("AC-TE-2 turn record carries the editing agent", () => {
  it("AC-TE-2 records agent_id and agent_type when the payload carries them", () => {
    const base = makeTmpDir("turn-state-"); const repo = makeGitRepo();
    startTurn(base, "s1", repo);
    const r = runHook("post-edit-mark.mjs", {
      session_id: "s1", cwd: repo, tool_name: "Edit", tool_input: { file_path: "/a/b.ts" },
      agent_id: "agent-abc", agent_type: "lore-implementer",
    }, base);
    expect(r.status).toBe(0);
    const [entry] = readJsonl(join(currentTurnDir(base, "s1"), "edited-files.jsonl"));
    expect(entry).toMatchObject({ file: "/a/b.ts", agent_id: "agent-abc", agent_type: "lore-implementer" });
  });

  it("AC-TE-2 records no agent fields when the payload has none (main-session edit)", () => {
    const base = makeTmpDir("turn-state-"); const repo = makeGitRepo();
    startTurn(base, "s2", repo);
    runHook("post-edit-mark.mjs", { session_id: "s2", cwd: repo, tool_name: "Edit", tool_input: { file_path: "/a/c.ts" } }, base);
    const [entry] = readJsonl(join(currentTurnDir(base, "s2"), "edited-files.jsonl"));
    expect(entry).toMatchObject({ file: "/a/c.ts" });
    expect(entry).not.toHaveProperty("agent_id");
    expect(entry).not.toHaveProperty("agent_type");
  });

  it("AC-TE-2 ignores non-string / empty agent fields instead of recording fake values", () => {
    const base = makeTmpDir("turn-state-"); const repo = makeGitRepo();
    startTurn(base, "s3", repo);
    runHook("post-edit-mark.mjs", { session_id: "s3", cwd: repo, tool_input: { file_path: "/a/d.ts" }, agent_id: 42, agent_type: "" }, base);
    const [entry] = readJsonl(join(currentTurnDir(base, "s3"), "edited-files.jsonl"));
    expect(entry).not.toHaveProperty("agent_id");
    expect(entry).not.toHaveProperty("agent_type");
  });
});

describe("AC-TE-2 stop-turn-review never counts a helper agent's edits", () => {
  const turn = (sid: string, agentId?: string) => {
    const f = makeFixture(sid);
    writeTurnEndSetting(f.repo, "block");
    startTurn_(f);
    markEdit(f, writeRepoFile(f.repo, "src/big.ts", numberedLines(50)), agentId);
    return stopTurn(f);
  };

  it("AC-TE-2 a turn whose only edits carry an agent_id produces no output and exit 0", () => {
    const r = turn("a1", "agent-abc");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-2 control: the same edit without agent_id is counted as the main session's", () => {
    const r = turn("a2");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).decision).toBe("block");
  });
});
