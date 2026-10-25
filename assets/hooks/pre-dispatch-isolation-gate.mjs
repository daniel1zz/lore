#!/usr/bin/env node
/**
 * pre-dispatch-isolation-gate.mjs — PreToolUse hook on Agent|Task.
 *
 * HARD gate: blocks dispatch of an IMPLEMENTATION subagent that did not ask for
 * worktree isolation. Prose reinforcement measurably failed — one session
 * omitted `isolation: 'worktree'` on three consecutive dispatches, and the
 * agents worked in the shared checkout while 8 concurrent commits landed around
 * them. Isolation rested on agent judgement, which is not a mechanism.
 *
 * MEASURED CONTRACT (probed 2026-07-31, this harness, positive+negative runs):
 *   dispatch WITHOUT isolation → tool_input keys = [description, prompt, subagent_type]
 *   dispatch WITH    isolation → tool_input keys = [description, isolation, prompt, subagent_type]
 * The field is ABSENT (not null, not "") when unset, so `hasOwnProperty` and a
 * plain !== 'worktree' comparison are both sound. Do not "harden" this against
 * a null case that the harness never produces.
 *
 * WHY ONLY ONE AGENT TYPE (deliberately narrow):
 *   `lore-implementer` is the only shipped write type (it also writes tests),
 *   and it is the type the measured incident involved.
 *   `claude` and `general-purpose` are NOT listed: the first is a catch-all
 *   routinely used for read-only work (listing it would produce false denials,
 *   and a gate that cries wolf gets bypassed), and the second is already denied
 *   outright by pre-no-general-agent-gate.mjs. Read-only types (Explore,
 *   lore-reader, Plan, researcher) cannot corrupt a shared
 *   checkout because they cannot write to it.
 *
 * WHY THE BASE CHECK IS DIAGNOSTIC AND NOT A DENIAL:
 *   The harness cuts every worktree from the shared checkout's CURRENT HEAD.
 *   `isolation` and base-correctness are independent axes: a dispatch can be
 *   correctly isolated and still land on a tree where the target code does not
 *   exist (measured — the integration line sat 60 commits ahead of `main` for a
 *   whole plan). But nothing in the payload says which base was INTENDED, and
 *   no local signal distinguishes "HEAD is behind the line I meant" from "HEAD
 *   is exactly right and other branches are unrelated". Denying on a guess
 *   would produce false denials on every repo that merely has feature branches.
 *   So this half reports what it can prove — HEAD, and any local branch
 *   strictly ahead of it — and leaves the judgement to the dispatcher.
 *
 * Exit codes: 2 = denied (missing isolation). 0 = allowed. Never any other code
 * — a crash in the diagnostic half must not block a legitimate dispatch, so the
 * whole git section is wrapped and failure-tolerant.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { trackOutcome, noteHookCwd } from './lib/check-outcome.mjs';
trackOutcome('hook:pre-dispatch-isolation-gate');

/** Subagent types whose purpose is writing source/tests. See module doc for why this list is short. */
const WRITING_AGENTS = new Set(['lore-implementer']);

let payload = {};
try {
  payload = noteHookCwd(JSON.parse(readFileSync(0, 'utf8')));
} catch {
  // Unreadable payload: this gate has nothing to assert on. Never block.
  process.exit(0);
}

if (!['Agent', 'Task'].includes(payload.tool_name)) process.exit(0);

const subagentType = payload?.tool_input?.subagent_type ?? '';
if (!WRITING_AGENTS.has(subagentType)) process.exit(0);

const isolation = payload?.tool_input?.isolation;

if (isolation !== 'worktree') {
  const observed = isolation === undefined ? '<absent>' : JSON.stringify(isolation);
  process.stderr.write(`[DISPATCH_ISOLATION_GATE] Blocked: ${payload.tool_name} with subagent_type="${subagentType}" and isolation=${observed}.

An implementation subagent must run in its own git worktree. Without it the
agent writes into the SHARED checkout, where it races every other live session:
one measured run had three such dispatches and 8 concurrent commits landing
mid-flight, with isolation left to each agent noticing the checkout was busy.

How to fix:
  Pass isolation: "worktree" on the Agent tool call.

Then, in the dispatch bundle, tell the agent to CORRECT ITS BASE — the harness
cuts the worktree from this checkout's current HEAD, which is a separate axis
this gate cannot decide for you:

  git merge --ff-only <integration-tip>
  git log --oneline -1        # MUST print <integration-tip>
  bun install                 # FIRST — module resolution otherwise walks up
                              # into the main checkout and oracles test stale source

Use \`git merge --ff-only\`, never \`git reset --hard\` (the git-safety gate
blocks it, correctly).

If this subagent genuinely does not write files, dispatch a read-only type
instead (Explore, lore-reader, Plan, researcher).
`);
  process.exit(2);
}

// ─── Allowed. Report what is provable about the base (never blocks) ──────────
/** Hard cap per git call. A PreToolUse hook sits in front of the dispatch, so a hung git (index.lock contention, a network-backed filesystem) would stall the whole tool call. */
const GIT_TIMEOUT_MS = 2000;
/** Cap on how many branch names the diagnostic prints — a repo with 200 branches must not bury the message it is attached to. */
const MAX_BRANCHES_SHOWN = 5;

try {
  const cwd = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  const git = (args) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }).trim();

  const head = git(['rev-parse', '--short', 'HEAD']);
  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

  // Refs that CONTAIN HEAD but are not HEAD itself are strictly ahead of it, so
  // a worktree cut here would lack their commits.
  //
  // `for-each-ref`, NOT `branch --contains`: the latter emits git's synthetic
  // display row `(HEAD detached at <sha>)` in a detached worktree, and
  // `--abbrev-ref HEAD` returns the literal "HEAD" there, so no filter on the
  // current branch name removes it. That row would then be printed as a "branch
  // strictly behind" and this message tells the agent to
  // `git merge --ff-only <that>` — a command that cannot work, because the row
  // is not a ref at all. Measured in a real detached worktree in this repo.
  // `for-each-ref` enumerates only real refs, and including `refs/remotes`
  // additionally covers a local branch sitting behind its upstream, which a
  // heads-only scan reports as no diagnostic at all.
  const ahead = git(['for-each-ref', '--contains', 'HEAD', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name.length > 0 && name !== currentBranch);

  if (ahead.length > 0) {
    const shown = ahead.slice(0, MAX_BRANCHES_SHOWN).join(', ');
    const overflow = ahead.length > MAX_BRANCHES_SHOWN ? ` (+${ahead.length - MAX_BRANCHES_SHOWN} more)` : '';
    process.stderr.write(`[DISPATCH_ISOLATION_GATE] allowed; base diagnostic: this worktree will be cut from ${currentBranch}@${head}, which is strictly BEHIND: ${shown}${overflow}. If the work needs code from one of those, have the agent \`git merge --ff-only <tip>\` and assert \`git log --oneline -1\` before it starts.\n`);
  }
} catch {
  // Diagnostics are best-effort by construction — never convert a git failure
  // (not a repo, git absent, timeout, unborn HEAD) into a blocked dispatch.
}

process.exit(0);
