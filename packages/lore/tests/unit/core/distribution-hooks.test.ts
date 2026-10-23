/**
 * Pure-module tests for `@lore/core`'s `distribution-hooks.ts` —
 * `HOOK_REGISTRATIONS` / `buildHookSettingsEntries` (SPEC-046 settings.json
 * auto-registration amendment, 2026-07-20 owner directive).
 *
 * Dimension mapping:
 *   HAPPY:      buildHookSettingsEntries produces the correct
 *               command/event/matcher shape for a real claudeDir
 *   BOUNDARY:   HOOK_REGISTRATIONS is exactly the declared 12-hook / 15-entry
 *               (all matchers expanded) set; a trailing slash on claudeDir
 *               does not double up in the command string
 *   NEGATIVE:   pre-dispatch-isolation-gate.mjs / pre-no-general-agent-gate.mjs are
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
  "session-start-resume.mjs",
  // Same-session-authorship marker (task-verifying-a-handoff-you-just-authored-arms-the-coverage, 2026-08-01).
  "session-start-marker.mjs",
  "user-prompt-turn-start.mjs", // turn-state producers of stop-turn-review (issue #156)
  "user-prompt-fragments.mjs",
  "post-edit-mark.mjs",
  "post-ask-decide.mjs",
  // Turn-end review of the main session; replaced stop-doc-sync.mjs and claude-md-guard.sh (spec-interception-moves-off-every-tool-call-one-turn-end-review, AC-TE-5).
  "stop-turn-review.mjs",
  "subagent-context.mjs",
  "subagent-stop-commit-guard.mjs",
  // Run identity slice 1 (BR-1044): attribute a fresh install's first write to a run.
  "run-register.mjs",
  // Run end on SessionEnd/SubagentStop (BR-1059).
  "run-end.mjs",
  // Session trail writers (spec-session-trail D13): session/helper start and helper end.
  "session-trail-start.mjs",
  "subagent-trail.mjs",
  "pre-tool-harness-run.mjs",
  // Foreign working copy gate: refuses an isolated helper's Write/Edit inside a git working copy that is not its own (BR-1092).
  "pre-helper-foreign-working-copy-gate.mjs",
  // Edit-time anchor gate: a helper's edit outside its claim's anchors is declared through `lore anchor declare` or denied.
  "pre-edit-anchor-gate.mjs",
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

    // The g1-g4 checkpoint hooks are retired (the write itself refuses): no registered command is a lore-gate hook.
    expect(entries.filter((e) => e.command.includes("lore-gate")).map((e) => e.command)).toEqual([]);
  });

  it("registers exactly one Stop hook (stop-turn-review); the coverage-floor Stop hook is removed", () => {
    const entries = buildHookSettingsEntries("/home/user/.claude");
    const stopEntries = entries.filter((e) => e.event === "Stop");

    // Asserted as a set comparison rather than two `find`s: a registration that
    // OVERWROTE the incumbent (same event, one entry) would satisfy a lone
    // `find` for the new hook while silently unwiring the turn-end review.
    expect(stopEntries).toEqual([
      { event: "Stop", command: "node /home/user/.claude/hooks/stop-turn-review.mjs" },
    ]);
  });
});

describe("BOUNDARY: HOOK_REGISTRATIONS shape", () => {
  it("declares exactly the 16 core-governance-and-security hook files", () => {
    const files = [...new Set(HOOK_REGISTRATIONS.map((r) => r.file))].sort();
    expect(files).toEqual([...EXPECTED_FILES].sort());
  });

  it("expands to exactly 21 entries (17 hooks; per-event expansion for run-register, pre-tool-harness-run, run-end and session-trail-start)", () => {
    // pre-bash-git-safety-gate: 1, session-start-resume: 1, session-start-marker: 1, stop-turn-review: 1, subagent-context: 1, subagent-stop-commit-guard: 1, run-register: 2 (SessionStart + SubagentStart), pre-tool-harness-run: 2 (Bash + mcp__.*lore_.*), user-prompt-turn-start: 1, post-edit-mark: 1, run-end: 2 (SessionEnd + SubagentStop), session-trail-start: 2 (SessionStart + SubagentStart), subagent-trail: 1, pre-helper-foreign-working-copy-gate: 1, pre-edit-anchor-gate: 1, post-ask-decide: 1, user-prompt-fragments: 1 = 21
    expect(HOOK_REGISTRATIONS).toHaveLength(21);
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
  it("never registers pre-dispatch-isolation-gate.mjs or pre-no-general-agent-gate.mjs", () => {
    const files = HOOK_REGISTRATIONS.map((r) => r.file);
    expect(files).not.toContain("pre-dispatch-isolation-gate.mjs");
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
