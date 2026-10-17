// @spawns assets/hooks/run-end.mjs
/**
 * @spec_ref AC-ROI-7
 *
 * `assets/hooks/run-end.mjs` — spec-run-only-write-identity-and-run-end-claim-release
 * Scope 6, AC-ROI-7, BR-1059. SessionEnd ends the main run `cc:<session_id>`;
 * SubagentStop ends the subagent run `cc:<session_id>:<agent_id>`; the hook
 * exits 0 whatever lore does.
 *
 * Isolation: a stub `lore` on a throwaway PATH records argv in a mkdtemp dir.
 * The repo's own `.lore/` is never touched.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { HOOK_REGISTRATIONS, buildHookSettingsEntries, mergeSettings, deriveRunId } from "@lore/core";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "run-end.mjs");
const HELPER_PATH = join(REPO_ROOT, "assets", "hooks", "lib", "run-id.mjs");

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});
function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

function makeStub(exit = 0): { dir: string; calls(): string[][] } {
  const dir = scratch("re-stub-");
  const logDir = scratch("re-log-");
  writeFileSync(
    join(dir, "lore"),
    `#!/bin/bash\nf=$(mktemp "${logDir}/call.XXXXXX")\nprintf '%s\\n' "$@" > "$f"\necho boom >&2\nexit ${exit}\n`,
  );
  chmodSync(join(dir, "lore"), 0o755);
  return {
    dir,
    calls: () =>
      readdirSync(logDir)
        .sort()
        .map((n) => readFileSync(join(logDir, n), "utf8").split("\n").filter((l) => l !== "")),
  };
}

function runHook(payload: unknown, pathDir: string) {
  return spawnSync(process.execPath, [HOOK_PATH], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PATH: `${pathDir}:/usr/bin:/bin` },
  });
}

describe("AC-ROI-7 registration", () => {
  it("registers run-end.mjs on SessionEnd and SubagentStop, each with timeout >= 10", () => {
    for (const event of ["SessionEnd", "SubagentStop"]) {
      const regs = HOOK_REGISTRATIONS.filter((r) => r.file === "run-end.mjs" && r.event === event);
      expect(regs, event).toHaveLength(1);
      expect(regs[0]!.runner).toBe("node");
      expect(regs[0]!.timeout ?? 0).toBeGreaterThanOrEqual(10);
    }
  });

  it("the rendered settings.json entry carries timeout", () => {
    const entries = buildHookSettingsEntries("/c");
    const merged = mergeSettings({ existingRaw: null, loreEntries: entries });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const hooks = (merged.value.merged as any).hooks;
    for (const event of ["SessionEnd", "SubagentStop"]) {
      const cmds = hooks[event].flatMap((g: any) => g.hooks).filter((h: any) => h.command.endsWith("/hooks/run-end.mjs"));
      expect(cmds, event).toHaveLength(1);
      expect(cmds[0].timeout).toBeGreaterThanOrEqual(10);
    }
    // entries without a timeout render without the key
    const stop = hooks.Stop.flatMap((g: any) => g.hooks)[0];
    expect("timeout" in stop).toBe(false);
  });
});

describe("AC-ROI-7 hook behaviour", () => {
  it("SessionEnd ends cc:<session_id> with the payload reason", () => {
    const stub = makeStub();
    const r = runHook({ hook_event_name: "SessionEnd", session_id: "sess-1", reason: "logout" }, stub.dir);
    expect(r.status).toBe(0);
    expect(stub.calls()).toEqual([["run", "end", "cc:sess-1", "--reason", "logout"]]);
  });

  it("SubagentStop ends the subagent run cc:<session_id>:<agent_id> with reason subagent-stop", () => {
    const stub = makeStub();
    const r = runHook(
      { hook_event_name: "SubagentStop", session_id: "sess-1", agent_id: "ag-9", agent_type: "x" },
      stub.dir,
    );
    expect(r.status).toBe(0);
    expect(stub.calls()).toEqual([["run", "end", "cc:sess-1:ag-9", "--reason", "subagent-stop"]]);
  });

  it("an internal agent (empty agent_type) is passed through", () => {
    const stub = makeStub();
    runHook({ hook_event_name: "SubagentStop", session_id: "s", agent_id: "a", agent_type: "" }, stub.dir);
    expect(stub.calls()).toEqual([["run", "end", "cc:s:a", "--reason", "subagent-stop"]]);
  });

  it("exits 0 with one stderr line when lore fails", () => {
    const stub = makeStub(3);
    const r = runHook({ hook_event_name: "SessionEnd", session_id: "s", reason: "other" }, stub.dir);
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("exit 3");
  });

  it("exits 0 when lore is absent from PATH", () => {
    const r = spawnSync(process.execPath, [HOOK_PATH], {
      input: JSON.stringify({ hook_event_name: "SessionEnd", session_id: "s", reason: "other" }),
      encoding: "utf8",
      env: { ...process.env, PATH: scratch("re-empty-") },
    });
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });

  it.each([
    ["not json", "{nope"],
    ["empty stdin", ""],
    ["no session_id", { hook_event_name: "SessionEnd" }],
    ["unsafe session_id", { hook_event_name: "SessionEnd", session_id: "a b;c" }],
    ["unsafe agent_id", { hook_event_name: "SubagentStop", session_id: "s", agent_id: "x y" }],
  ])("malformed payload (%s) exits 0 without spawning lore", (_n, payload) => {
    const stub = makeStub();
    const r = runHook(payload, stub.dir);
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(stub.calls()).toEqual([]);
  });
});

describe("AC-ROI-7 run-id drift pin", () => {
  it("the shared helper derives the same id as core deriveRunId (the id lore run register stores)", async () => {
    const helper = await import(pathToFileURL(HELPER_PATH).href);
    expect(helper.deriveClaudeCodeRunId({ session_id: "S1" })).toBe(deriveRunId("claude-code", { sessionId: "S1" }));
    expect(helper.deriveClaudeCodeRunId({ session_id: "S1", agent_id: "A1" })).toBe(
      deriveRunId("claude-code", { sessionId: "S1", agentId: "A1" }),
    );
  });
});
