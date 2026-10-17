// @spawns assets/hooks/pre-no-general-agent-gate.mjs
/**
 * AC-AT-3: pre-no-general-agent-gate refuses a general-purpose dispatch and its message names exactly the
 * two shipped agent types. (The former AC-RS-12 case for the retired pre-subagent-gate.mjs was deleted
 * with that hook — spec-interception-moves-off-every-tool-call-one-turn-end-review, Scope 4-5.)
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NO_GENERAL = fileURLToPath(new URL("../../../../../assets/hooks/pre-no-general-agent-gate.mjs", import.meta.url));

function run(hook: string, payload: unknown) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_AGENT_TYPE;
  delete env.CLAUDE_NO_SUBAGENT_MODE;
  const r = spawnSync("node", [hook], { input: JSON.stringify(payload), encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("pre-no-general-agent-gate message", () => {
  it("spec-two-helper-agent-types-lore-reader-and-lore-implementer#AC-AT-3 pre-no-general-agent-gate refusal lists exactly lore-reader and lore-implementer", () => {
    const r = run(NO_GENERAL, { tool_name: "Agent", tool_input: { subagent_type: "general-purpose" } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("lore-reader");
    expect(r.stderr).toContain("lore-implementer");
    expect(r.stderr).not.toMatch(/lore-explorer|lore-reviewer|tester/);
  });
});
