/**
 * Behavioural suite for `assets/hooks/pre-dispatch-isolation-gate.mjs`.
 *
 * The hook is spawned as a real process with a real stdin payload, because its
 * entire contract is (payload in) → (exit code, stderr out). Exit codes are read
 * from `spawnSync().status` rather than through a shell pipe — a piped `$?`
 * reports the last pipe stage, which is how this repo has produced false green
 * before.
 *
 * The payload shapes below are not invented: they are the two shapes measured
 * from this harness on 2026-07-31 (a dispatch without isolation carries no
 * `isolation` key at all; a dispatch with it carries `isolation: "worktree"`).
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HOOK_PATH = fileURLToPath(new URL("../../../../../assets/hooks/pre-dispatch-isolation-gate.mjs", import.meta.url));

interface HookRun {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function runHook(payload: unknown): HookRun {
  const result = spawnSync("node", [HOOK_PATH], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return { status: result.status, stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
}

/** The exact shape measured for a dispatch that OMITS isolation — the key is absent, not null. */
function dispatchWithoutIsolation(subagentType: string): Record<string, unknown> {
  return {
    tool_name: "Agent",
    hook_event_name: "PreToolUse",
    cwd: process.cwd(),
    tool_input: { description: "d", prompt: "p", subagent_type: subagentType },
  };
}

/** The exact shape measured for a dispatch that passes isolation. */
function dispatchWithIsolation(subagentType: string, isolation = "worktree"): Record<string, unknown> {
  return {
    tool_name: "Agent",
    hook_event_name: "PreToolUse",
    cwd: process.cwd(),
    tool_input: { description: "d", prompt: "p", subagent_type: subagentType, isolation },
  };
}

describe("pre-dispatch-isolation-gate", () => {
  describe("NEGATIVE — an implementation subagent without worktree isolation is denied", () => {
    it("denies lore-implementer with exit 2 and names the missing field", () => {
      const run = runHook(dispatchWithoutIsolation("lore-implementer"));
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("DISPATCH_ISOLATION_GATE");
      expect(run.stderr).toContain("lore-implementer");
      // Must report what it actually observed, so a future payload change that
      // starts sending null/"" is visible in the message instead of silently
      // reclassified.
      expect(run.stderr).toContain("<absent>");
    });

    it("denies tester too", () => {
      const run = runHook(dispatchWithoutIsolation("tester"));
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("tester");
    });

    it("denies a non-worktree isolation value rather than treating any value as good enough", () => {
      const run = runHook(dispatchWithIsolation("lore-implementer", "remote"));
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('"remote"');
    });

    it("tells the dispatcher to fix the BASE as well, since isolation alone does not", () => {
      const run = runHook(dispatchWithoutIsolation("lore-implementer"));
      expect(run.stderr).toContain("merge --ff-only");
      expect(run.stderr).toContain("bun install");
      // And steers away from the command the git-safety gate blocks.
      expect(run.stderr).toContain("reset --hard");
    });
  });

  describe("HAPPY — a correctly isolated dispatch is allowed", () => {
    it("allows lore-implementer with isolation worktree", () => {
      const run = runHook(dispatchWithIsolation("lore-implementer"));
      expect(run.status).toBe(0);
    });

    it("allows tester with isolation worktree", () => {
      const run = runHook(dispatchWithIsolation("tester"));
      expect(run.status).toBe(0);
    });
  });

  describe("BOUNDARY — the gate stays narrow on purpose", () => {
    it.each(["Explore", "lore-explorer", "lore-reviewer", "Plan", "researcher"])(
      "does not block read-only type %s even without isolation",
      (agentType) => {
        const run = runHook(dispatchWithoutIsolation(agentType));
        expect(run.status).toBe(0);
      },
    );

    it("does not block the catch-all `claude` type (false denials get gates bypassed)", () => {
      const run = runHook(dispatchWithoutIsolation("claude"));
      expect(run.status).toBe(0);
    });

    it("leaves general-purpose to its own dedicated gate rather than double-denying", () => {
      const run = runHook(dispatchWithoutIsolation("general-purpose"));
      expect(run.status).toBe(0);
    });

    it("ignores tool calls that are not Agent/Task", () => {
      const run = runHook({ tool_name: "Bash", tool_input: { command: "ls" } });
      expect(run.status).toBe(0);
    });

    it("treats a missing subagent_type as out of scope (that is general-purpose's gate)", () => {
      const run = runHook({ tool_name: "Agent", tool_input: { description: "d", prompt: "p" } });
      expect(run.status).toBe(0);
    });
  });

  describe("ERROR — a broken payload must never block a dispatch", () => {
    it("exits 0 on unparseable stdin", () => {
      const run = runHook("this is not json");
      expect(run.status).toBe(0);
    });

    it("exits 0 on empty stdin", () => {
      const run = runHook("");
      expect(run.status).toBe(0);
    });

    it("exits 0 when cwd is not a git repository, proving the base diagnostic cannot block", () => {
      const run = runHook({
        tool_name: "Agent",
        cwd: "/",
        tool_input: { description: "d", prompt: "p", subagent_type: "lore-implementer", isolation: "worktree" },
      });
      expect(run.status).toBe(0);
    });
  });

  describe("STATE — the hook holds no grammar it should not", () => {
    it("carries no hardcoded branch name or integration tip", () => {
      const source = readFileSync(HOOK_PATH, "utf8");
      // Control: the file is real and is the gate under test.
      expect(source).toContain("DISPATCH_ISOLATION_GATE");
      // A hardcoded tip would rot the moment the integration line moved — the
      // whole reason the base half is diagnostic rather than declarative.
      expect(source).not.toContain("fix/governance");
      expect(source).not.toMatch(/\bmain\b\s*===/);
    });
  });
});
