/**
 * AC-RS-12 (BR-1068): a direct code edit by the main agent is never blocked, and the MODEL
 * receives the notice. Claude Code never shows stderr from a hook that exits 0, so the notice
 * must travel on stdout as PreToolUse `hookSpecificOutput.additionalContext`.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GATE = fileURLToPath(new URL("../../../../../assets/hooks/pre-subagent-gate.mjs", import.meta.url));
const NO_GENERAL = fileURLToPath(new URL("../../../../../assets/hooks/pre-no-general-agent-gate.mjs", import.meta.url));

function run(hook: string, payload: unknown) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_AGENT_TYPE;
  delete env.CLAUDE_SUBAGENT_GATE_BYPASS;
  delete env.CLAUDE_NO_SUBAGENT_MODE;
  const r = spawnSync("node", [hook], { input: JSON.stringify(payload), encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("AC-RS-12 hook notices", () => {
  it("AC-RS-12 pre-subagent-gate delivers its notice via additionalContext and exits 0", () => {
    const newString = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const r = run(GATE, {
      tool_name: "Edit",
      session_id: "rs-t12",
      tool_input: { file_path: "src/a.ts", old_string: "x", new_string: newString },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("CLAUDE_SUBAGENT_GATE_BYPASS");
    expect(ctx).toContain("CLAUDE_NO_SUBAGENT_MODE");
    expect(ctx).toMatch(/3[- ]line/);
    expect(ctx).toContain("src/a.ts");
  });

  it("AC-RS-12 pre-no-general-agent-gate refusal lists tester", () => {
    const r = run(NO_GENERAL, { tool_name: "Agent", tool_input: { subagent_type: "general-purpose" } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("tester");
  });
});
