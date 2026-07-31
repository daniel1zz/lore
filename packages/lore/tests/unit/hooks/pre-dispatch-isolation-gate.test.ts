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
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

  describe("REGRESSION — the base diagnostic must not emit git's synthetic detached row", () => {
    /**
     * Found by review, reproduced live: `git branch --contains HEAD` emits git's
     * own display row `(HEAD detached at <sha>)` in a detached worktree, and
     * `rev-parse --abbrev-ref HEAD` returns the literal "HEAD" there, so no
     * current-branch filter removes it. The row then appeared in the diagnostic
     * as a ref "strictly behind" while the same message tells the agent to
     * `git merge --ff-only <that>` — impossible, it is not a ref.
     *
     * Built from a real git repo rather than a fixture: the defect lives in git's
     * output shape, which only real git produces.
     */
    it("reports only real refs when cwd is a detached HEAD", () => {
      const repo = mkdtempSync(join(tmpdir(), "gate-detached-"));
      const git = (...args: string[]): string =>
        execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        git("init", "--quiet");
        git("config", "user.email", "t@example.com");
        git("config", "user.name", "t");
        writeFileSync(join(repo, "f.txt"), "a\n");
        git("add", "f.txt");
        git("commit", "--quiet", "-m", "first");
        const first = git("rev-parse", "HEAD");
        writeFileSync(join(repo, "f.txt"), "b\n");
        git("commit", "--quiet", "-am", "second");
        // Detach onto the FIRST commit so `main` strictly contains HEAD — the
        // diagnostic must fire, which is what makes the assertion meaningful.
        git("checkout", "--quiet", "--detach", first);

        const run = runHook({
          tool_name: "Agent",
          cwd: repo,
          tool_input: { description: "d", prompt: "p", subagent_type: "lore-implementer", isolation: "worktree" },
        });

        expect(run.status).toBe(0);
        // Control: the diagnostic actually fired, so the negative below is not vacuous.
        expect(run.stderr).toContain("strictly BEHIND");
        expect(run.stderr).toContain("main");
        // The defect itself.
        expect(run.stderr).not.toContain("HEAD detached");
        expect(run.stderr).not.toContain("(");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  });

  describe("REGRESSION — the gate is only enforcing if it is WIRED, and it fails open when it is not", () => {
    /**
     * Round-two review established two facts that make this test load-bearing:
     *
     * 1. Claude Code treats a hook exiting 1 — which is what BOTH a missing file
     *    (MODULE_NOT_FOUND) and a syntax error produce — as a non-blocking error.
     *    So a deleted, renamed, or corrupted gate silently reverts dispatch to the
     *    "trust the dispatcher" regime that failed three times in one session,
     *    leaving only a transcript line.
     * 2. `gate-hooks.bun.test.ts` pins g1/g2/g3's settings.json wiring, but nothing
     *    pinned THIS hook's. Since spec D5 deliberately keeps it out of
     *    `lore setup`'s auto-registration, that config line is the ONLY thing
     *    enforcing it, and a bad merge could drop it with zero test failures.
     */
    it("this repo's .claude/settings.json registers the gate on Agent|Task", () => {
      const settingsPath = fileURLToPath(new URL("../../../../../.claude/settings.json", import.meta.url));
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
      };
      const groups = settings.hooks?.PreToolUse ?? [];
      expect(groups.length).toBeGreaterThan(0);

      const agentCommands = groups
        .filter((g) => (g.matcher ?? "").includes("Agent"))
        .flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? ""));

      // Control: the sibling gate is registered, so a wholesale settings.json
      // restructure surfaces here rather than making the assertion vacuous.
      expect(agentCommands.some((c) => c.includes("pre-no-general-agent-gate.mjs"))).toBe(true);
      expect(agentCommands.some((c) => c.includes("pre-dispatch-isolation-gate.mjs"))).toBe(true);
    });

    it("the registered path actually exists on disk (a registration pointing nowhere exits 1 = non-blocking)", () => {
      expect(readFileSync(HOOK_PATH, "utf8").length).toBeGreaterThan(0);
    });
  });

  describe("BOUNDARY — an unborn HEAD must not block either", () => {
    it("exits 0 in a freshly-initialised repo with zero commits", () => {
      const repo = mkdtempSync(join(tmpdir(), "gate-unborn-"));
      try {
        execFileSync("git", ["-C", repo, "init", "--quiet"], { stdio: ["ignore", "pipe", "ignore"] });
        const run = runHook({
          tool_name: "Agent",
          cwd: repo,
          tool_input: { description: "d", prompt: "p", subagent_type: "lore-implementer", isolation: "worktree" },
        });
        // `rev-parse --short HEAD` exits 128 here; the diagnostic must swallow it.
        expect(run.status).toBe(0);
        expect(run.stderr).toBe("");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
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
