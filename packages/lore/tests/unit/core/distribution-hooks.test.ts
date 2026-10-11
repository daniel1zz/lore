/**
 * Pure-module tests for `@lore/core`'s `distribution-hooks.ts` —
 * `HOOK_REGISTRATIONS` / `buildHookSettingsEntries` (SPEC-046 settings.json
 * auto-registration amendment, 2026-07-20 owner directive).
 *
 * Dimension mapping:
 *   HAPPY:      buildHookSettingsEntries produces the correct
 *               command/event/matcher shape for a real claudeDir
 *   BOUNDARY:   HOOK_REGISTRATIONS is exactly the declared 12-hook / 18-entry
 *               (all matchers expanded) set; a trailing slash on claudeDir
 *               does not double up in the command string
 *   NEGATIVE:   pre-subagent-gate.mjs / pre-no-general-agent-gate.mjs are
 *               NOT present anywhere in the declared set
 *   STATE:      calling with the literal "{{CLAUDE_DIR}}" placeholder token
 *               embeds the token verbatim in every command (RealAssetSource's
 *               use case)
 *   REGRESSION: every produced entry validates as a well-formed
 *               SettingsHookEntry (no `matcher` key present when the source
 *               registration declared none — never `matcher: undefined`)
 */

import { describe, it, expect } from "vitest";
import { HOOK_REGISTRATIONS, buildHookSettingsEntries } from "@lore/core";

const EXPECTED_FILES = [
  "pre-bash-git-safety-gate.mjs",
  "lore-gate-g1-spec-create.sh",
  "lore-gate-g2-spec-promote.sh",
  "lore-gate-g3-plan-promote.sh",
  "lore-gate-g4-task-claim.sh",
  "session-start-resume.mjs",
  // Same-session-authorship marker (task-verifying-a-handoff-you-just-authored-arms-the-coverage, 2026-08-01).
  "session-start-fragments.mjs", // task-skill-implement-hooks-new-session-start-fragments-thin
  "session-start-marker.mjs",
  "stop-doc-sync.mjs",
  // Stop-time resume-ticket coverage floor (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the, 2026-07-31).
  "stop-handoff-coverage.mjs",
  "subagent-context.mjs",
  "subagent-stop-commit-guard.mjs",
  "claude-md-guard.sh",
  // Run identity slice 1 (BR-1044): attribute a fresh install's first write to a run.
  "run-register.mjs",
  "pre-tool-harness-run.mjs",
];

describe("HAPPY: buildHookSettingsEntries", () => {
  it("produces the correct command/event/matcher for a real claudeDir", () => {
    const entries = buildHookSettingsEntries("/home/user/.claude");

    const gitSafety = entries.find(
      (e) => e.command === "node /home/user/.claude/hooks/pre-bash-git-safety-gate.mjs",
    );
    expect(gitSafety).toEqual({
      event: "PreToolUse",
      matcher: "Bash",
      command: "node /home/user/.claude/hooks/pre-bash-git-safety-gate.mjs",
    });

    const sessionStart = entries.find((e) => e.event === "SessionStart");
    expect(sessionStart).toEqual({
      event: "SessionStart",
      command: "node /home/user/.claude/hooks/session-start-resume.mjs",
    });

    const g4Mcp = entries.find(
      (e) => e.command === "bash /home/user/.claude/hooks/lore-gate-g4-task-claim.sh" && e.matcher?.includes("lore_claim"),
    );
    expect(g4Mcp).toEqual({
      event: "PreToolUse",
      matcher: "mcp__.*lore_claim.*",
      command: "bash /home/user/.claude/hooks/lore-gate-g4-task-claim.sh",
    });
  });

  it("registers BOTH Stop hooks as distinct matcher-less entries — the coverage-floor hook joins stop-doc-sync rather than replacing it", () => {
    const entries = buildHookSettingsEntries("/home/user/.claude");
    const stopEntries = entries.filter((e) => e.event === "Stop");

    // Asserted as a set comparison rather than two `find`s: a registration that
    // OVERWROTE the incumbent (same event, one entry) would satisfy a lone
    // `find` for the new hook while silently unwiring the doc-sync gate.
    expect(stopEntries).toEqual([
      { event: "Stop", command: "node /home/user/.claude/hooks/stop-doc-sync.mjs" },
      { event: "Stop", command: "node /home/user/.claude/hooks/stop-handoff-coverage.mjs" },
    ]);
  });
});

describe("BOUNDARY: HOOK_REGISTRATIONS shape", () => {
  it("declares exactly the 15 core-governance-and-security hook files", () => {
    const files = [...new Set(HOOK_REGISTRATIONS.map((r) => r.file))].sort();
    expect(files).toEqual([...EXPECTED_FILES].sort());
  });

  it("expands to exactly 24 entries (15 hooks; per-matcher expansion for the 4 gate hooks and the 2 session-start-fragments registrations)", () => {
    // pre-bash-git-safety-gate: 1, g1: 2, g2: 3, g3: 3, g4: 2, session-start-resume: 1, session-start-fragments: 2 (startup/resume + compact), session-start-marker: 1, stop-doc-sync: 1, stop-handoff-coverage: 1, subagent-context: 1, subagent-stop-commit-guard: 1, claude-md-guard: 1, run-register: 2 (SessionStart + SubagentStart), pre-tool-harness-run: 2 (Bash + mcp__.*lore_.*) = 24
    expect(HOOK_REGISTRATIONS).toHaveLength(24);
  });

  it("tolerates a trailing slash on claudeDir without a double slash in the command", () => {
    const withSlash = buildHookSettingsEntries("/home/user/.claude/");
    const withoutSlash = buildHookSettingsEntries("/home/user/.claude");
    expect(withSlash).toEqual(withoutSlash);
    for (const entry of withSlash) {
      expect(entry.command).not.toContain("//hooks/");
    }
  });

  it("every PreToolUse gate-hook entry uses the bash runner; every node-runner hook is a lifecycle hook (Session/Stop/Subagent)", () => {
    for (const reg of HOOK_REGISTRATIONS) {
      if (reg.file.startsWith("lore-gate-")) {
        expect(reg.runner).toBe("bash");
      }
    }
  });
});

describe("NEGATIVE: excluded orchestration-policy hooks", () => {
  it("never registers pre-subagent-gate.mjs or pre-no-general-agent-gate.mjs", () => {
    const files = HOOK_REGISTRATIONS.map((r) => r.file);
    expect(files).not.toContain("pre-subagent-gate.mjs");
    expect(files).not.toContain("pre-no-general-agent-gate.mjs");
  });
});

describe("STATE: placeholder-token pass-through", () => {
  it("embeds the literal {{CLAUDE_DIR}} placeholder verbatim when called with it", () => {
    const entries = buildHookSettingsEntries("{{CLAUDE_DIR}}");
    for (const entry of entries) {
      expect(entry.command).toContain("{{CLAUDE_DIR}}/hooks/");
    }
  });
});

describe("REGRESSION: produced entries are well-formed SettingsHookEntry objects", () => {
  it("omits the matcher key entirely for matcher-less registrations (never matcher: undefined)", () => {
    const entries = buildHookSettingsEntries("/x");
    const sessionStart = entries.find((e) => e.event === "SessionStart");
    expect(sessionStart).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(sessionStart, "matcher")).toBe(false);
  });

  it("carries a matcher key for every registration that declared one", () => {
    const entries = buildHookSettingsEntries("/x");
    const withMatcherCount = HOOK_REGISTRATIONS.filter((r) => r.matcher !== undefined).length;
    const producedWithMatcher = entries.filter((e) => Object.prototype.hasOwnProperty.call(e, "matcher")).length;
    expect(producedWithMatcher).toBe(withMatcherCount);
  });

  it("returns one entry per HOOK_REGISTRATIONS row, in the same order", () => {
    const entries = buildHookSettingsEntries("/x");
    expect(entries).toHaveLength(HOOK_REGISTRATIONS.length);
  });
});
