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

// --- Check 3: deferred-continuation termination ---------------------------
// Distinct failure mode from checks 1-2, learned the hard way: an agent whose
// work IS committed (so checks 1-2 pass) can still end its turn announcing it
// has started something in the background and will "continue when notified".
// A subagent that stops with no live background children never gets that
// notification — it just hands the orchestrator a non-report and stalls the
// pipeline until a manual recall. Observed 3x across two days, twice after the
// prose-level rule was added to the agent definition AND to the dispatch
// bundle.
//
// Deliberately NOT a general "is this a completion report?" judgement — that is
// semantic and would misfire. This matches only explicit self-announced
// deferral, and only in the first ~400 chars of the final message (a real
// report that merely MENTIONS a background run mid-body is not caught). A false
// negative here costs one recall; a false positive would wedge a finished
// agent, so the pattern stays narrow on purpose.
const finalMessage =
  typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : "";
const head = finalMessage.slice(0, 400);

// Length is the discriminator that phrasing alone cannot provide. Both observed
// deferral messages were ~130-150 chars ("I've kicked off X… I'll continue once
// the notification arrives."). A genuine completion report cannot be that short
// — the dispatch bundle requires a file list, per-oracle commands with observed
// results, and `git log --oneline`. Without this bound the patterns misfire on a
// real report that merely NARRATES a past background run ("I had earlier started
// a background run but read its output before finishing") — caught by this
// guard's own test suite before it ever wedged an agent.
const REPORT_MIN_CHARS = 600;

// An honest short "I am blocked" report is legitimate and must never be caught.
const BLOCKED_REPORT = /\b(?:BLOCKED|blocked report|STATUS:\s*BLOCKED)\b/;

// Structural evidence that this IS a report rather than a promise to produce
// one later. Length alone proved insufficient: a terse-but-complete report can
// sit under the char bound while a padded deferral could sail over it. A
// deferral message has none of these markers — it has no results to structure.
const REPORT_STRUCTURE = [
  /\bSTATUS:\s*(?:DONE|COMPLETE|BLOCKED)\b/i,
  /\bfiles? (?:changed|modified)\b/i,
  /\bgit log\b/i,
  /\bTest Files\s+\d+/i,
  /\bexit (?:code )?0\b/i,
];

if (
  finalMessage.length >= REPORT_MIN_CHARS ||
  BLOCKED_REPORT.test(head) ||
  REPORT_STRUCTURE.some((re) => re.test(finalMessage))
) {
  allow();
}

// Single-keyword signals, NOT multi-word phrases. An earlier version enumerated
// exact phrasings ("waiting for the monitor", "I'll continue once…") and was
// defeated within hours by "Waiting for the bun test monitor to report back" —
// two words inserted between `the` and `monitor` broke the contiguity the regex
// assumed. That is the same contiguous-substring trap that made a `-t
// 'caller-supplied inconclusive'` filter match zero tests when the describe
// title read `caller-supplied result: "inconclusive"`.
//
// So: match on lone words that a *finished* report has no reason to contain,
// and rely on the two negative conditions already established above (message is
// short AND carries no report structure) to keep the false-positive rate down.
// Any one of these words, in a sub-600-char message with no results in it, means
// the agent is describing what it is about to do rather than what it did.
const DEFERRAL_SIGNALS =
  /\b(?:monitor|background|waiting|notification|notified|finaliz\w*|resume|meanwhile|shortly|afterwards?)\b/i;

if (DEFERRAL_SIGNALS.test(head)) {
  block(
    `BLOCKED: ${agentLabel} is ending its turn on a deferred continuation.\n` +
      `Worktree: ${cwd}\n\n` +
      `Your final message announces that you started something and will ` +
      `continue when notified. You will NOT be notified: a subagent that stops ` +
      `with no live background children simply returns a non-report to the ` +
      `orchestrator, and the pipeline stalls until a human or the orchestrator ` +
      `manually recalls you.\n\n` +
      `Do the remaining work NOW, in the foreground:\n` +
      `  - run the command directly and read its output yourself, or\n` +
      `  - if it is already running in the background, read its output file before ending.\n\n` +
      `Then end with your actual completion report (or an explicit BLOCKED ` +
      `report naming what stopped you). This guard will not fire twice.`,
  );
}

allow();
