/**
 * @spec_ref AC-TE-6
 *
 * `assets/hooks/pre-tool-harness-run.mjs` must trigger on every lore MCP tool call whatever the
 * server's registered name (`mcp__<server>__lore_<verb>`), and leave other servers' tools alone
 * (spec-interception-moves-off-every-tool-call-one-turn-end-review, Scope 6, BR-1093).
 *
 * The hook is a blind pipe (spec D10): "triggered" means it spawned `lore run attest-input` and
 * relayed the verb's `updatedInput` answer. A stub `lore` on PATH plays the verb for a registered
 * run, so no real state (~/.claude, this repo's .lore) is touched.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "pre-tool-harness-run.mjs");
const RUN_ID = "run-test-registered";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

/** Stub verb: answers every `lore run attest-input` with an updatedInput carrying the run. */
function stubLoreDir(): string {
  const dir = scratch("any-server-stub-");
  const answer = JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { run: RUN_ID } },
  });
  writeFileSync(join(dir, "lore"), `#!/bin/bash\ncat > /dev/null\nprintf '%s' '${answer}'\n`);
  chmodSync(join(dir, "lore"), 0o755);
  return dir;
}

function runHookFor(toolName: string): { status: number | null; stdout: string } {
  expect(existsSync(HOOK_PATH), `hook script missing: ${HOOK_PATH}`).toBe(true);
  const cwd = scratch("any-server-cwd-");
  const r = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: { slug: "x" },
      session_id: "s1",
    }),
    encoding: "utf8",
    cwd,
    timeout: 20000,
    env: { PATH: `${stubLoreDir()}:/usr/bin:/bin`, HOME: cwd },
  });
  return { status: r.status, stdout: r.stdout };
}

const carriesRun = (stdout: string): boolean => stdout.includes(`"updatedInput":{"run":"${RUN_ID}"}`);

describe("AC-TE-6 pre-tool-harness-run rewrites lore tools under any MCP server name", () => {
  it("AC-TE-6 HAPPY: mcp__lore__lore_get is rewritten", () => {
    const r = runHookFor("mcp__lore__lore_get");
    expect(r.status).toBe(0);
    expect(carriesRun(r.stdout)).toBe(true);
  });

  it("AC-TE-6 HAPPY: mcp__lore-dev__lore_get (renamed server) is rewritten", () => {
    const r = runHookFor("mcp__lore-dev__lore_get");
    expect(r.status).toBe(0);
    expect(carriesRun(r.stdout)).toBe(true);
  });

  it("AC-TE-6 NEGATIVE: mcp__github__get_issue is untouched", () => {
    const r = runHookFor("mcp__github__get_issue");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-6 NEGATIVE edge: mcp__mylore__get_issue (lore in server name, no lore_ verb) is untouched", () => {
    const r = runHookFor("mcp__mylore__get_issue");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
