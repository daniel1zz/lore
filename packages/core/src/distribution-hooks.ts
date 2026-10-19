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
 * closes that gap: the hooks classified "core governance + security" are
 * auto-registered; the orchestration-POLICY hooks
 * (`pre-no-general-agent-gate.mjs`, `pre-dispatch-isolation-gate.mjs`) are deliberately
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
 * `stop-turn-review.mjs` (spec-interception-moves-off-every-tool-call-one-turn-
 * end-review, Scope 4-5) is the ONE turn-end review of the main session. It
 * replaced three retired hook families: `stop-doc-sync.mjs` (turn-end doc
 * reminder), `claude-md-guard.sh` (per-edit CLAUDE.md ceiling check, now
 * finding (c) of the turn-end review) and the four per-call checkpoint gate
 * hooks (the service-layer write refuses instead: `GateEnforcer.enforce`). BR-1092: no registered
 * per-tool-call hook refuses anything except irreversible git operations
 * (`pre-bash-git-safety-gate.mjs`). Converge (BR-823 / BR-975) removes the
 * retired files and settings entries from older installs.
 *
 * `stop-handoff-coverage.mjs` (added 2026-07-31, owner classification decision
 * of spec-resume-ticket-coverage-a-shipped-upper-bound-left-the) joins the
 * governance set beside `stop-turn-review.mjs`, its nearest sibling: both are
 * turn-end accounting gates, differing only in WHAT must be accounted for
 * (findings in the turn's own work vs. resume-ticket items the turn left
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
 * `session-start-marker.mjs` (added 2026-08-01,
 * task-verifying-a-handoff-you-just-authored-arms-the-coverage D1) joins the
 * set for the SAME "governance backstop, not routing policy" reasoning as
 * the pair above: it constrains a single, universal fact — "this session's
 * own start time is recorded" — needed by `lore feed session-resume`'s
 * `buildResumeFeed` (`packages/lore/src/flows/feed-flow.ts`) to narrow WHEN
 * the resume-ticket coverage floor arms (never suppressing it for an
 * unrelated, genuinely earlier session's ticket — the floor stays
 * unconditional otherwise, no new flag, no opt-in). Registering it is what
 * makes the fix reachable: `readSessionStartIso` degrades to "unknown
 * boundary" (fail-safe: arms) whenever no marker exists, so an
 * INSTALLED-but-unregistered copy would leave every project in exactly the
 * pre-fix defect state — the same silent-inertness class `stop-handoff-
 * coverage.mjs`'s own note above already forbids. Fail-open by construction
 * (see the hook's own module header): an absent session-id env var or any fs
 * error is silently skipped, never blocking session start.
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
 *     a real resolved path or the literal placeholder token `"{{lore:claude_dir}}"`
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
  /** Optional per-hook budget in seconds, emitted as `timeout` in settings.json. Absent keeps the harness default (SessionEnd's is 1.5 s shared, too short to spawn `lore`). */
  readonly timeout?: number;
}

/** run-end.mjs budget in seconds; must stay >= 10 (AC-ROI-7). */
const RUN_END_HOOK_TIMEOUT_SECONDS = 10;

/**
 * The full declared "core governance + security" hook set (owner decision,
 * 2026-07-20; `subagent-stop-commit-guard.mjs` added 2026-07-21;
 * `stop-handoff-coverage.mjs` added 2026-07-31; `session-start-marker.mjs`
 * added 2026-08-01; `stop-turn-review.mjs` replaced `stop-doc-sync.mjs` and
 * `claude-md-guard.sh`) — already matcher-expanded, one entry per distinct
 * `(event, matcher)` pair.
 * Deliberately EXCLUDES `pre-no-general-agent-gate.mjs` and
 * `pre-dispatch-isolation-gate.mjs` (orchestration-policy hooks, not
 * governance/security — see module doc).
 */
export const HOOK_REGISTRATIONS: readonly HookRegistration[] = [
  // pre-bash-git-safety-gate.mjs — blocks destructive git commands (reset --hard, branch -D, worktree remove --force, ...).
  { file: "pre-bash-git-safety-gate.mjs", runner: "node", event: "PreToolUse", matcher: "Bash" },

  // session-start-resume.mjs — injects bootstrap/seat/resume-hint state at session open.
  { file: "session-start-resume.mjs", runner: "node", event: "SessionStart" },

  // session-start-marker.mjs — records this session's own start time (tmpdir marker, keyed by session id) so `lore feed session-resume` can tell a just-authored handoff from a genuinely earlier session's.
  { file: "session-start-marker.mjs", runner: "node", event: "SessionStart" },

  // user-prompt-turn-start.mjs — producer of current-turn.id and turn-start-snapshot.json (opens a turn per user message); stop-turn-review.mjs reads them. Consumer and producers MUST ship together (lore issue #156; pinned by turn-state-producers.test.ts).
  { file: "user-prompt-turn-start.mjs", runner: "node", event: "UserPromptSubmit" },

  // post-edit-mark.mjs — producer of edited.flag / edited-files.jsonl on every editing tool; stop-turn-review.mjs reads them.
  { file: "post-edit-mark.mjs", runner: "node", event: "PostToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit" },

  // stop-turn-review.mjs — the one turn-end review of the main session: opt-in source edits, anchor drift, CLAUDE.md ceiling; one block listing every finding, silent otherwise.
  { file: "stop-turn-review.mjs", runner: "node", event: "Stop" },

  // stop-handoff-coverage.mjs — resume-ticket coverage floor on turn end: blind pipe to `lore handoff coverage-check` (no matcher; Stop does not scope by one).
  { file: "stop-handoff-coverage.mjs", runner: "node", event: "Stop" },

  // subagent-context.mjs — per-agent-type directive + lore project context injection.
  { file: "subagent-context.mjs", runner: "node", event: "SubagentStart" },

  // subagent-stop-commit-guard.mjs — blocks a worktree subagent from terminating with unpersisted (uncommitted or unbranched) work.
  { file: "subagent-stop-commit-guard.mjs", runner: "node", event: "SubagentStop" },

  // run-register.mjs — registers this session's / helper's run via `lore run register` (fail-open, loud) so a fresh install attributes its first write (BR-1044, spec-run-identity-slice-1 D1/D2).
  { file: "run-register.mjs", runner: "node", event: "SessionStart" },
  { file: "run-register.mjs", runner: "node", event: "SubagentStart" },

  // run-end.mjs — ends the run on SessionEnd (main) / SubagentStop (helper) via `lore run end`, releasing its claims (BR-1059, spec-run-only-write-identity-and-run-end-claim-release Scope 6). timeout 10 s: SessionEnd's default budget is 1.5 s.
  { file: "run-end.mjs", runner: "node", event: "SessionEnd", timeout: RUN_END_HOOK_TIMEOUT_SECONDS },
  { file: "run-end.mjs", runner: "node", event: "SubagentStop", timeout: RUN_END_HOOK_TIMEOUT_SECONDS },

  // session-trail-start.mjs — session trail writer: retention + session.json on SessionStart, helpers/<agent_id>.json on SubagentStart (spec-session-trail D13; silent, always exit 0).
  { file: "session-trail-start.mjs", runner: "node", event: "SessionStart" },
  { file: "session-trail-start.mjs", runner: "node", event: "SubagentStart" },

  // subagent-trail.mjs — measures an isolated helper's changes at its end (spec-session-trail D13). timeout 10 s: it runs git against the helper's working copy.
  { file: "subagent-trail.mjs", runner: "node", event: "SubagentStop", timeout: RUN_END_HOOK_TIMEOUT_SECONDS },

  // pre-tool-harness-run.mjs — rewrites each lore call to carry `--harness-run <run>` (updatedInput only, never a permissionDecision — D12); covers raw Bash and every lore MCP tool.
  { file: "pre-tool-harness-run.mjs", runner: "node", event: "PreToolUse", matcher: "Bash" },
  { file: "pre-tool-harness-run.mjs", runner: "node", event: "PreToolUse", matcher: "mcp__.*lore_.*" },

  // pre-helper-foreign-working-copy-gate.mjs — refuses a Write/Edit/MultiEdit/NotebookEdit by a worktree-isolated helper whose target is inside a git working copy that is not its own (the shared checkout, another worktree, another repo): harm that lands at once on someone else and cannot be undone by the actor (BR-1092). Never applies to the main session; writes outside every working copy are left to the turn-end helper-scope review.
  { file: "pre-helper-foreign-working-copy-gate.mjs", runner: "node", event: "PreToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit" },

  // pre-edit-anchor-gate.mjs — a helper's Write/Edit/MultiEdit/NotebookEdit outside the anchors of its claimed task is declared through `lore anchor declare` (the task-claim gate's overlap predicate; free path -> added to the task's anchors) or denied before it happens (path held by another live claim, no claim, anything undecidable). Git-ignored paths pass. Never applies to the main session; Bash writes stay with the turn-end helper-scope review.
  { file: "pre-edit-anchor-gate.mjs", runner: "node", event: "PreToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit" },
] as const;

/** Strips exactly one trailing `/` (never more — a caller-malformed `claudeDir` with repeated trailing slashes is out of scope). */
function stripTrailingSlash(dir: string): string {
  return dir.endsWith("/") ? dir.slice(0, -1) : dir;
}

/**
 * Builds the desired `settings.json` hook-entry set for a given `claudeDir`
 * from {@link HOOK_REGISTRATIONS}. Pure 1:1 map — see module invariants for
 * why `claudeDir` may be a real path OR the `"{{lore:claude_dir}}"` placeholder
 * token.
 *
 * @param claudeDir - Target Claude Code config directory, OR the literal
 *   placeholder `"{{lore:claude_dir}}"` (see module doc). A trailing `/` is
 *   tolerated.
 * @returns One {@link SettingsHookEntry} per {@link HOOK_REGISTRATIONS} row,
 *   in declaration order.
 *
 * @example
 * buildHookSettingsEntries("/home/user/.claude")[0];
 * // => { event: "PreToolUse", matcher: "Bash", command: "node /home/user/.claude/hooks/pre-bash-git-safety-gate.mjs" }
 *
 * @example
 * buildHookSettingsEntries("{{lore:claude_dir}}")[0].command;
 * // => "node {{lore:claude_dir}}/hooks/pre-bash-git-safety-gate.mjs"
 */
export function buildHookSettingsEntries(claudeDir: string): SettingsHookEntry[] {
  const trimmedDir = stripTrailingSlash(claudeDir);
  return HOOK_REGISTRATIONS.map((reg) => {
    const command = `${reg.runner} ${trimmedDir}/hooks/${reg.file}`;
    return {
      event: reg.event,
      ...(reg.matcher !== undefined ? { matcher: reg.matcher } : {}),
      command,
      ...(reg.timeout !== undefined ? { timeout: reg.timeout } : {}),
    };
  });
}
