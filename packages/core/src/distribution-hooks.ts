/**
 * Distribution hook-registration domain — pure, browser-safe SSOT for which
 * vendored `assets/hooks/*` files `lore setup` auto-registers into a target
 * machine's Claude Code `settings.json` PreToolUse/SessionStart/Stop/
 * SubagentStart groups.
 *
 * Owner decision (2026-07-20) reversing SPEC-041 D7's original "Lore does not
 * install or manage hooks" stance: `lore setup` previously only copied hook
 * FILES into `<claude-dir>/hooks/` — the settings.json wiring that makes a
 * copied hook file actually RUN was left to the human, an inert-until-wired
 * gap noted in the root CLAUDE.md's SPEC-046 dogfood-log entry for
 * `pre-bash-git-safety-gate.mjs`. This module is the declared list that
 * closes that gap: eleven hooks classified "core governance + security" are
 * auto-registered; two orchestration-POLICY hooks
 * (`pre-subagent-gate.mjs`, `pre-no-general-agent-gate.mjs`) are deliberately
 * EXCLUDED — they encode this specific team's subagent-dispatch discipline,
 * not a safety/governance invariant every `lore setup` consumer should
 * inherit unasked; a team that wants them can still hand-wire the copied
 * files (`lore setup` still ships them under `hooks/`, unregistered).
 *
 * `subagent-stop-commit-guard.mjs` (added 2026-07-21, SPEC-046 amendment)
 * joins the governance/safety set on the same reasoning: it prevents a
 * worktree-isolated subagent from terminating while its work exists ONLY as
 * uncommitted files in a worktree — a data-loss shape any team dispatching
 * worktree subagents can hit (this repo did, twice in two days), not a
 * decision about HOW or WHEN to dispatch subagents. That distinction is what
 * separates it from the excluded orchestration-policy pair above: those two
 * hooks encode this team's own subagent-*routing* rules (which agent type is
 * allowed to run at all); this hook encodes a *data-safety backstop* that
 * applies regardless of routing policy — a team with an entirely different
 * dispatch discipline still loses work identically if a subagent stops with
 * an uncommitted, unpushed worktree. It is fail-open by construction (see the
 * hook's own module header) so a mis-registration cannot itself wedge a
 * session, matching the risk profile of the rest of the set.
 *
 * `claude-md-guard.sh` (added D10/D11,
 * spec-context-verb-family-two-zone-claude-md-anatomy-lore) joins the set for
 * the same reason as the pair above: it is a data/governance backstop, not a
 * routing policy — it fires on PostToolUse Edit|Write, fast-paths away from
 * every non-`CLAUDE.md` edit, and only ever runs `lore status --check-
 * claude-md` (the sole budget measurement point) against a repo that
 * actually owns a `.lore/` corpus. Fail-open by construction (see the hook's
 * own module header) on every anomaly — a mis-registration cannot itself
 * block an unrelated Edit/Write.
 *
 * `stop-handoff-coverage.mjs` (added 2026-07-31, owner classification decision
 * of spec-resume-ticket-coverage-a-shipped-upper-bound-left-the) joins the
 * governance set beside `stop-doc-sync.mjs`, its nearest sibling: both are
 * turn-end accounting gates, differing only in WHAT must be accounted for
 * (docs the turn made stale vs. resume-ticket items the turn left
 * undispositioned). It constrains "the consumer accounts for every ticket
 * item" — a governance invariant any team consuming resume tickets needs, not
 * a statement about how this team routes subagents, which is what keeps it on
 * the auto-registered side of the line the excluded orchestration-policy pair
 * sits on. Registering it is what makes the spec's own Delivery constraint
 * satisfiable: a fresh `lore init` + `lore setup` project must be unable to
 * reach the original defect, and an INSTALLED-but-unregistered hook leaves
 * that project in exactly the defect state (the hook file lands under
 * `<claude-dir>/hooks/` and never fires) — the silent-inertness class the
 * spec's D6 exists to forbid. Like every hook in this set, it is fail-open by
 * construction (see the hook's own module header) and is a blind pipe to
 * `lore handoff coverage-check`, holding no grammar of its own, so a
 * mis-registration cannot wedge a session and a grammar change cannot
 * strand it.
 *
 * Public surface:
 *   - HookRunner — the closed `"node" | "bash"` interpreter set
 *   - HookRegistration — one settings.json hook registration (file/runner/event/matcher?)
 *   - HOOK_REGISTRATIONS — the full declared set, fully expanded per-matcher
 *     (one array entry per distinct `(event, matcher)` pair a hook file needs)
 *   - buildHookSettingsEntries(claudeDir) — pure builder → `SettingsHookEntry[]`
 *
 * Invariants:
 *   - Pure, browser-safe — no Node builtins (no `node:path`; command strings
 *     are built via plain string concatenation, mirroring this package's
 *     `merge-settings.ts`/`register-mcp.ts` precedent of keeping settings.json
 *     shaping logic import-safe from `@lore/dashboard`'s Vite bundle).
 *   - `buildHookSettingsEntries` does NOT know or care whether `claudeDir` is
 *     a real resolved path or the literal placeholder token `"{{CLAUDE_DIR}}"`
 *     — it just concatenates whatever string it's given with `/hooks/<file>`.
 *     This lets `RealAssetSource` (which has no knowledge of the eventual
 *     install target) call it with the placeholder to produce a
 *     target-agnostic synthetic asset, and `SetupService.resolvePayload`
 *     (which DOES know the real `targetDir`) do a plain string-replace of
 *     that placeholder before handing the result to `mergeSettings` — see
 *     each module's own doc comment for its half of this handshake.
 *   - `HOOK_REGISTRATIONS` is intentionally already matcher-EXPANDED (a hook
 *     needing N matchers under an event contributes N array entries) rather
 *     than a nested `{file, event, matchers: string[]}` shape — this is the
 *     exact granularity `SettingsHookEntry`/`mergeSettings` consume, so
 *     `buildHookSettingsEntries` is a trivial 1:1 map with no grouping logic
 *     of its own (matcher/event GROUPING for the actual `settings.json`
 *     `hooks[event][]` array shape is `mergeSettings`' job, not this one's).
 *   - `command` is always `"<runner> <claudeDir>/hooks/<file>"` — a trailing
 *     slash on `claudeDir` is tolerated (stripped) so both `"~/.claude"` and
 *     `"~/.claude/"` produce an identical, double-slash-free command string
 *     (this is the identity key `mergeSettings` diffs against on re-run —
 *     see that module's "Identification, not ownership metadata" invariant).
 *
 * Source: SPEC-046 (settings.json auto-registration amendment, 2026-07-20 owner directive).
 */

import type { SettingsHookEntry } from "./merge-settings.js";

/** The closed set of interpreters a registered hook's `command` invokes with. */
export type HookRunner = "node" | "bash";

/** One vendored `assets/hooks/<file>` registration into a `settings.json` event/matcher slot. */
export interface HookRegistration {
  /** Filename under `assets/hooks/` (and, post-install, `<claude-dir>/hooks/`). */
  readonly file: string;
  /** Interpreter the `command` string is prefixed with. */
  readonly runner: HookRunner;
  /** Claude Code hook event name (`"PreToolUse" | "SessionStart" | "Stop" | "SubagentStart"`, ...). */
  readonly event: string;
  /** Optional tool/agent matcher — omitted for events that don't scope by matcher (SessionStart/Stop/SubagentStart here). */
  readonly matcher?: string;
}

/**
 * The full declared "core governance + security" hook set (owner decision,
 * 2026-07-20; `subagent-stop-commit-guard.mjs` added 2026-07-21;
 * `stop-handoff-coverage.mjs` added 2026-07-31) — already matcher-expanded,
 * one entry per distinct `(event, matcher)` pair.
 * Deliberately EXCLUDES `pre-subagent-gate.mjs` and
 * `pre-no-general-agent-gate.mjs` (orchestration-policy hooks, not
 * governance/security — see module doc).
 */
export const HOOK_REGISTRATIONS: readonly HookRegistration[] = [
  // pre-bash-git-safety-gate.mjs — blocks destructive git commands (reset --hard, branch -D, worktree remove --force, ...).
  { file: "pre-bash-git-safety-gate.mjs", runner: "node", event: "PreToolUse", matcher: "Bash" },

  // lore-gate-g1-spec-create.sh — spec-create checkpoint (gate hooks double-mount: both a raw Bash call and the MCP tool call are covered).
  { file: "lore-gate-g1-spec-create.sh", runner: "bash", event: "PreToolUse", matcher: "Bash" },
  { file: "lore-gate-g1-spec-create.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_create.*" },

  // lore-gate-g2-spec-promote.sh — spec-promote checkpoint (approve AND set can both promote a spec to approved).
  { file: "lore-gate-g2-spec-promote.sh", runner: "bash", event: "PreToolUse", matcher: "Bash" },
  { file: "lore-gate-g2-spec-promote.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_approve.*" },
  { file: "lore-gate-g2-spec-promote.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_set.*" },

  // lore-gate-g3-plan-promote.sh — plan-promote checkpoint (same approve/set duality as g2, on a plan doc).
  { file: "lore-gate-g3-plan-promote.sh", runner: "bash", event: "PreToolUse", matcher: "Bash" },
  { file: "lore-gate-g3-plan-promote.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_approve.*" },
  { file: "lore-gate-g3-plan-promote.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_set.*" },

  // lore-gate-g4-task-claim.sh — task-claim checkpoint (anchor-overlap safety on lore claim).
  { file: "lore-gate-g4-task-claim.sh", runner: "bash", event: "PreToolUse", matcher: "Bash" },
  { file: "lore-gate-g4-task-claim.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_claim.*" },

  // session-start-resume.mjs — injects bootstrap/seat/resume-hint state at session open.
  { file: "session-start-resume.mjs", runner: "node", event: "SessionStart" },

  // stop-doc-sync.mjs — doc-sync reminder gate on turn end.
  { file: "stop-doc-sync.mjs", runner: "node", event: "Stop" },

  // stop-handoff-coverage.mjs — resume-ticket coverage floor on turn end: blind pipe to `lore handoff coverage-check` (no matcher; Stop does not scope by one).
  { file: "stop-handoff-coverage.mjs", runner: "node", event: "Stop" },

  // subagent-context.mjs — per-agent-type directive + lore project context injection.
  { file: "subagent-context.mjs", runner: "node", event: "SubagentStart" },

  // subagent-stop-commit-guard.mjs — blocks a worktree subagent from terminating with unpersisted (uncommitted or unbranched) work.
  { file: "subagent-stop-commit-guard.mjs", runner: "node", event: "SubagentStop" },

  // claude-md-guard.sh — CLAUDE.md two-zone admission check on Edit|Write (delegates the actual ceiling measurement to `lore status --check-claude-md`).
  { file: "claude-md-guard.sh", runner: "bash", event: "PostToolUse", matcher: "Edit|Write" },
] as const;

/** Strips exactly one trailing `/` (never more — a caller-malformed `claudeDir` with repeated trailing slashes is out of scope). */
function stripTrailingSlash(dir: string): string {
  return dir.endsWith("/") ? dir.slice(0, -1) : dir;
}

/**
 * Builds the desired `settings.json` hook-entry set for a given `claudeDir`
 * from {@link HOOK_REGISTRATIONS}. Pure 1:1 map — see module invariants for
 * why `claudeDir` may be a real path OR the `"{{CLAUDE_DIR}}"` placeholder
 * token.
 *
 * @param claudeDir - Target Claude Code config directory, OR the literal
 *   placeholder `"{{CLAUDE_DIR}}"` (see module doc). A trailing `/` is
 *   tolerated.
 * @returns One {@link SettingsHookEntry} per {@link HOOK_REGISTRATIONS} row,
 *   in declaration order.
 *
 * @example
 * buildHookSettingsEntries("/home/user/.claude")[0];
 * // => { event: "PreToolUse", matcher: "Bash", command: "node /home/user/.claude/hooks/pre-bash-git-safety-gate.mjs" }
 *
 * @example
 * buildHookSettingsEntries("{{CLAUDE_DIR}}")[0].command;
 * // => "node {{CLAUDE_DIR}}/hooks/pre-bash-git-safety-gate.mjs"
 */
export function buildHookSettingsEntries(claudeDir: string): SettingsHookEntry[] {
  const trimmedDir = stripTrailingSlash(claudeDir);
  return HOOK_REGISTRATIONS.map((reg) => {
    const command = `${reg.runner} ${trimmedDir}/hooks/${reg.file}`;
    return reg.matcher !== undefined
      ? { event: reg.event, matcher: reg.matcher, command }
      : { event: reg.event, command };
  });
}
