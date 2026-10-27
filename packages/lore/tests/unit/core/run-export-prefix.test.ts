/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-1
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * Every Bash call gets ONE export line in front of its UNCHANGED command, whether or not the command names lore.
 * @spawns packages/lore/src/index.ts
 * Behaviour level: the real `lore run attest-input` verb is spawned with a PreToolUse payload on stdin and the WHOLE
 * `updatedInput.command` string is compared (a prefix-only comparison would pass a mangled command).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const INDEX_TS = new URL("../../../src/index.ts", import.meta.url).pathname;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-export-prefix-"));
  mkdirSync(join(root, "home"), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface HookOutput {
  hookSpecificOutput: Record<string, unknown> & { updatedInput: Record<string, unknown> };
}

function runVerb(stdin: string): { exitCode: number; stdout: string } {
  // reason: Bun.spawnSync, not node:child_process: the test run's spawn shims patch the node call twice under Bun.
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, "run", "attest-input"], {
    cwd: root,
    stdin: new TextEncoder().encode(stdin),
    env: { ...process.env, HOME: join(root, "home"), CLAUDECODE: "1", LORE_TEST_IDENTITY: "none" } as Record<string, string>,
  });
  return { exitCode: proc.exitCode ?? -1, stdout: proc.stdout.toString() };
}

function attest(payload: Record<string, unknown>): { exitCode: number; stdout: string; parsed: HookOutput | null } {
  const r = runVerb(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", ...payload }));
  return { ...r, parsed: r.stdout.trim() === "" ? null : (JSON.parse(r.stdout) as HookOutput) };
}

/** The shell forms of the spec's "Every shell form in #418" section, plus commands that never name lore. */
const SHELL_FORMS: ReadonlyArray<readonly [string, string]> = [
  ["plain", "lore get x"],
  ["relative binary", "./dist/lore get x"],
  ["absolute binary", "/usr/local/bin/lore get x"],
  ["for loop", "for t in a b; do lore get $t; done"],
  ["if", "if true; then lore get x; fi"],
  ["negation", "! lore get x"],
  ["braces", "{ lore get x; }"],
  ["function body", "f() {\n  lore get x\n}\nf"],
  ["env", "env A=1 lore get x"],
  ["xargs", "echo x | xargs lore get"],
  ["timeout", "timeout 5 lore get x"],
  ["exec", "exec lore get x"],
  ["command", "command lore get x"],
  ["sh -c", "sh -c 'lore get x'"],
  ["quoted command substitution", 'echo "$(lore get x)"'],
  ["alias", "alias l=lore; l get x"],
  ["script file", "bash ./scripts/claim.sh"],
  ["bun run dev", "bun run dev get x"],
  ["sudo", "sudo lore get x"],
  ["no lore in the command", "ls -la && echo done"],
  ["heredoc with trailing newline", "cat <<'EOF'\nlore get x\nEOF\n"],
  ["quotes and unicode", "echo 'it''s' \"é\" # lore"],
];

describe("AC-RV-1: the export prefix", () => {
  it.each(SHELL_FORMS)("main thread, %s: the whole command is the export line, a newline, then the original bytes", (_label, command) => {
    const r = attest({ session_id: "S", tool_input: { command } });
    expect(r.exitCode).toBe(0);
    expect(r.parsed, `attest-input printed ${JSON.stringify(r.stdout)}`).not.toBeNull();
    expect(r.parsed?.hookSpecificOutput.updatedInput["command"]).toBe(`export LORE_HARNESS_RUN='cc:S'\n${command}`);
  }, 60_000);

  it("a subagent payload (agent_id A) carries cc:S:A", () => {
    const r = attest({ session_id: "S", agent_id: "A", tool_input: { command: "lore get x" } });
    expect(r.parsed, `attest-input printed ${JSON.stringify(r.stdout)}`).not.toBeNull();
    expect(r.parsed?.hookSpecificOutput.updatedInput["command"]).toBe("export LORE_HARNESS_RUN='cc:S:A'\nlore get x");
  }, 60_000);

  it("other tool_input keys survive and the hook never gives a permission decision (BR-1218)", () => {
    const r = attest({ session_id: "S", tool_input: { command: "ls", description: "list", timeout: 5000 } });
    expect(r.parsed, `attest-input printed ${JSON.stringify(r.stdout)}`).not.toBeNull();
    expect(r.parsed?.hookSpecificOutput.updatedInput["description"]).toBe("list");
    expect(r.parsed?.hookSpecificOutput.updatedInput["timeout"]).toBe(5000);
    expect(r.stdout).not.toContain("permissionDecision");
  }, 60_000);

  it("a malformed payload passes through: nothing printed, exit 0", () => {
    const r = runVerb("not json");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  }, 60_000);
});
