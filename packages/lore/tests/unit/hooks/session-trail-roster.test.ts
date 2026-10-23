// @spawns assets/hooks/session-trail-start.mjs
// @spawns assets/hooks/subagent-trail.mjs
/**
 * @spec_ref AC-ST-12
 *
 * Session-trail hooks are shipped: registered in the roster on the right events, present in the
 * embedded assets manifest, none on PreToolUse, and every new trail hook fails open.
 *
 * Six dimensions: HAPPY (registrations, manifest), NEGATIVE (no PreToolUse trail hook),
 * BOUNDARY (timeout exactly 10 on SubagentStop), ERROR (fail-open matrix: malformed stdin,
 * missing session_id, unwritable state base, non-git cwd, no lore on PATH), STATE (no trail
 * files written when no session), REGRESSION (existing registrations unchanged).
 * Isolation: mkdtemp + CLAUDE_STATE_BASE_OVERRIDE; never the real ~/.claude.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { HOOK_REGISTRATIONS } from "@lore/core";
import { EMBEDDED_ASSETS_MANIFEST } from "../../../src/generated/assets-manifest.js";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOKS = join(REPO_ROOT, "assets", "hooks");

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});
function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

const regs = (file: string) => HOOK_REGISTRATIONS.filter((r) => r.file === file);
const events = (file: string) => regs(file).map((r) => r.event).sort();

describe("AC-ST-12 roster", () => {
  it("HAPPY: session-trail-start on SessionStart and SubagentStart, subagent-trail on SubagentStop with timeout 10", () => {
    expect(events("session-trail-start.mjs")).toEqual(["SessionStart", "SubagentStart"]);
    expect(events("subagent-trail.mjs")).toEqual(["SubagentStop"]);
    expect(regs("subagent-trail.mjs")[0]!.timeout).toBe(10);
    expect(regs("session-trail-start.mjs").every((r) => r.runner === "node")).toBe(true);
  });

  it("HAPPY: turn-open and edit-mark producers stay registered on UserPromptSubmit and PostToolUse (edits)", () => {
    expect(events("user-prompt-turn-start.mjs")).toEqual(["UserPromptSubmit"]);
    const post = regs("post-edit-mark.mjs");
    expect(post.map((r) => r.event)).toEqual(["PostToolUse"]);
    expect(post[0]!.matcher).toContain("Edit");
  });

  it("NEGATIVE: no trail hook is registered on PreToolUse", () => {
    const trail = new Set(["session-trail-start.mjs", "subagent-trail.mjs", "user-prompt-turn-start.mjs", "post-edit-mark.mjs"]);
    expect(HOOK_REGISTRATIONS.filter((r) => trail.has(r.file) && r.event === "PreToolUse")).toEqual([]);
  });

  it("REGRESSION: the existing SubagentStop hooks are still registered next to subagent-trail", () => {
    const stop = HOOK_REGISTRATIONS.filter((r) => r.event === "SubagentStop").map((r) => r.file);
    expect(stop).toEqual(expect.arrayContaining(["subagent-stop-commit-guard.mjs", "run-end.mjs", "subagent-trail.mjs"]));
  });

  it("STATE: the assets manifest ships both trail hooks and their library, and every registered file is in it", () => {
    const paths = new Set(EMBEDDED_ASSETS_MANIFEST.entries.map((e) => e.path));
    for (const f of ["hooks/session-trail-start.mjs", "hooks/subagent-trail.mjs", "hooks/lib/session-trail.mjs"]) {
      expect(paths.has(f), f).toBe(true);
    }
    for (const r of HOOK_REGISTRATIONS) expect(paths.has(`hooks/${r.file}`), r.file).toBe(true);
  });
});

interface Run {
  status: number | null;
  stdout: string;
}
function runHook(file: string, stdin: string, env: Record<string, string>, cwd: string): Run {
  const r = spawnSync(process.execPath, [join(HOOKS, file)], { input: stdin, cwd, env, encoding: "utf8", timeout: 20000 });
  return { status: r.status, stdout: r.stdout };
}

const TRAIL_HOOKS: Array<{ name: string; file: string; payload: (sid: string | null, cwd: string) => Record<string, unknown> }> = [
  { name: "session-trail-start SessionStart", file: "session-trail-start.mjs", payload: (sid, cwd) => ({ hook_event_name: "SessionStart", ...(sid ? { session_id: sid } : {}), cwd }) },
  { name: "session-trail-start SubagentStart", file: "session-trail-start.mjs", payload: (sid, cwd) => ({ hook_event_name: "SubagentStart", ...(sid ? { session_id: sid } : {}), agent_id: "A", cwd }) },
  { name: "subagent-trail SubagentStop", file: "subagent-trail.mjs", payload: (sid, cwd) => ({ hook_event_name: "SubagentStop", ...(sid ? { session_id: sid } : {}), agent_id: "A", cwd }) },
];

describe.each(TRAIL_HOOKS)("AC-ST-12 fail-open: $name", (hook) => {
  const env = (base: string, path = process.env.PATH ?? "") => ({ PATH: path, HOME: base, CLAUDE_STATE_BASE_OVERRIDE: base });
  const expectSilent = (r: Run) => {
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  };

  it("ERROR: malformed stdin", () => {
    const base = scratch("trail-base-");
    expectSilent(runHook(hook.file, "{not json", env(base), base));
    // reason: every hook appends its own outcome row (check-outcomes.jsonl, BR-1373); that is the one allowed file.
    expect(readdirSync(base).filter((name) => name !== "check-outcomes.jsonl")).toEqual([]);
  });

  it("ERROR: missing session_id writes nothing", () => {
    const base = scratch("trail-base-");
    expectSilent(runHook(hook.file, JSON.stringify(hook.payload(null, base)), env(base), base));
    expect(existsSync(join(base, "sessions"))).toBe(false);
  });

  it("ERROR: unwritable state base (a file where the directory should be)", () => {
    const dir = scratch("trail-file-");
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    expectSilent(runHook(hook.file, JSON.stringify(hook.payload("S1", dir)), env(join(blocker, "sub")), dir));
  });

  it("ERROR: non-git cwd", () => {
    const base = scratch("trail-base-");
    const cwd = scratch("trail-nogit-");
    expectSilent(runHook(hook.file, JSON.stringify(hook.payload("S1", cwd)), env(base), cwd));
  });

  it("ERROR: no lore on PATH", () => {
    const base = scratch("trail-base-");
    expectSilent(runHook(hook.file, JSON.stringify(hook.payload("S1", base)), env(base, ""), base));
  });
});
