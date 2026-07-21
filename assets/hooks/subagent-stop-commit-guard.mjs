#!/usr/bin/env node
/**
 * SubagentStop guard — blocks a worktree subagent from terminating while its
 * work is unpersisted.
 *
 * Why this exists (2026-07-21): the "commit before you stop" discipline lived
 * only in prose — the `lore-implementer` agent definition (added 2026-07-20)
 * and, later, in every dispatch bundle. It failed twice anyway. The second
 * failure (SPEC-060 T3) ended a turn with 18 minutes / 92 tool calls of work
 * existing ONLY as uncommitted files in a worktree, zero commits on its branch
 * — one `git worktree remove --force` away from the W4 data-loss incident.
 * Prompt-level reinforcement has measurably failed; this is the deterministic
 * backstop.
 *
 * Field contract — EMPIRICALLY MEASURED, not assumed:
 *   A probe hook captured a real SubagentStop payload on 2026-07-21. The 14
 *   fields present are:
 *     agent_id, agent_transcript_path, agent_type, background_tasks, cwd,
 *     effort, hook_event_name, last_assistant_message, permission_mode,
 *     prompt_id, session_crons, session_id, stop_hook_active, transcript_path
 *   ⛔ There is NO `worktree_path` field and NO `exit_code` field, despite a
 *   research pass confidently claiming both (it fabricated a field table; the
 *   official docs page has no SubagentStop input schema at all). `cwd` IS the
 *   worktree path for a worktree-isolated subagent — verified: a
 *   `lore-implementer` running under isolation reported
 *   `cwd = .../.claude/worktrees/agent-<id>`, while a non-isolated `Explore`
 *   agent reported the main checkout. `agent_type` may be an empty string for
 *   some internal calls, so never key behaviour on it alone.
 *
 * Blocking contract: exit code 2 blocks the stop and feeds stderr back to the
 * subagent (official docs: SubagentStop + exit 2 → "Prevents the subagent from
 * stopping"). Any other exit code allows termination.
 *
 * Fail-open by construction: every failure mode here (not a worktree, git
 * unavailable, malformed stdin, unexpected git output) ALLOWS the stop. A
 * guard that blocks on its own bug would wedge every subagent in the session —
 * strictly worse than the problem it solves.
 *
 * Loop safety: `stop_hook_active` is true when the subagent is already
 * continuing *because* a stop hook blocked it. Re-blocking then would loop
 * forever, so that case always allows.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** Allow termination. Used for every non-blocking path, including all failures. */
function allow() {
  process.exit(0);
}

/** Block termination; `reason` goes back to the subagent on stderr. */
function block(reason) {
  process.stderr.write(reason + "\n");
  process.exit(2);
}

/** Runs a git command in `cwd`; returns trimmed stdout, or null on any failure. */
function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  allow(); // unreadable/malformed stdin — never our call to block
}

// Already continuing because a stop hook blocked once — never block twice.
if (payload.stop_hook_active === true) allow();

const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
if (!cwd) allow();

// Only worktree-isolated subagents are in scope. A subagent running in the main
// checkout shares the operator's tree; its uncommitted files are not "its work
// about to be discarded", and blocking there would fire on every read-only
// agent the session spawns.
const gitCommonDir = git(cwd, ["rev-parse", "--git-common-dir"]);
const gitDir = git(cwd, ["rev-parse", "--git-dir"]);
if (gitCommonDir === null || gitDir === null) allow(); // not a repo / no git
if (gitCommonDir === gitDir) allow(); // main checkout, not a linked worktree

const agentLabel = typeof payload.agent_type === "string" && payload.agent_type
  ? payload.agent_type
  : "subagent";

// --- Check 1: uncommitted changes (tracked modifications OR untracked files) ---
const status = git(cwd, ["status", "--porcelain"]);
if (status === null) allow(); // git failed — fail open
if (status.length > 0) {
  const files = status
    .split("\n")
    .slice(0, 10)
    .map((line) => "    " + line)
    .join("\n");
  const extra = status.split("\n").length > 10 ? `\n    … and ${status.split("\n").length - 10} more` : "";
  block(
    `BLOCKED: ${agentLabel} has uncommitted changes in its worktree.\n` +
      `Worktree: ${cwd}\n` +
      `Uncommitted:\n${files}${extra}\n\n` +
      `Your work exists ONLY in this worktree and is not on any branch. If the ` +
      `worktree is removed, it is gone. Commit it now:\n` +
      `    git add -A && git commit -m "<what you did>"\n\n` +
      `If some files are deliberate scratch, remove them instead — but do not ` +
      `end your turn with work uncommitted. After committing, finish your ` +
      `completion report.`,
  );
}

// --- Check 2: zero commits ahead of the base branch ---
// A clean tree with no commits means either "did nothing" or "committed
// nowhere". Both warrant a stop-and-explain rather than a silent finish.
const base = git(cwd, ["rev-parse", "--verify", "main"]) !== null ? "main" : null;
if (base === null) allow(); // no `main` to compare against — fail open

const aheadRaw = git(cwd, ["rev-list", "--count", `${base}..HEAD`]);
if (aheadRaw === null) allow();

const ahead = Number.parseInt(aheadRaw, 10);
if (!Number.isFinite(ahead)) allow(); // unparseable — fail open

if (ahead === 0) {
  block(
    `BLOCKED: ${agentLabel}'s branch has 0 commits ahead of ${base}.\n` +
      `Worktree: ${cwd}\n\n` +
      `A completed implementation task with an empty branch means the ` +
      `orchestrator will merge nothing and may then remove this worktree — the ` +
      `exact shape of this repo's W4 data-loss incident.\n\n` +
      `If you did produce work: commit it now (git add -A && git commit).\n` +
      `If you genuinely produced no code (investigation-only, or blocked): say ` +
      `so EXPLICITLY in your final report so the orchestrator does not treat an ` +
      `empty branch as a protocol violation. Then you may stop — this guard ` +
      `will not fire twice.`,
  );
}

allow();
