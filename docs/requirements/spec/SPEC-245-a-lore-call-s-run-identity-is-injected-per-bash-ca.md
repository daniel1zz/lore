---
id: SPEC-245
type: spec
role: spec
title: "A lore call's run identity is injected per Bash call and verified per session against the caller's process ancestry (resolves #418, #457)"
status: approved
priority: critical
created: 2026-10-26
updated: 2026-10-27
tags: [governance-mechanism-fixes, issue-418, run-identity]
---
# A lore call's run identity is injected per Bash call and verified against the caller's process ancestry (resolves #418)

## Overview/Goal

Every lore invocation made from an agent's Bash call carries that call's run identity, whatever the shell form. The binary believes the identity only when it runs inside the named run's own harness process, so a caller cannot name another session's run.

Today identity reaches the binary only by text rewriting: `lore run attest-input` inserts `--harness-run` after a command-position word that is exactly `lore` (packages/core/src/run-identity.ts `transform`, `inLore = word === "lore"`, ~369). The binary accepts any registered agent run the flag names (`resolveInvocationIdentity`, run-identity-node.ts:117-150).

**Mechanism.** Identity is attached to the *text* of the command, not to the *process* that runs lore, and nothing binds the named run to its caller.

**End state.** Decision record: `adr-a-bash-call-s-run-identity-travels-in-a-per-call` (supersedes the carrier clause of ADR-044 decision 2; user decision D14).
- The PreToolUse hook prefixes EVERY Bash call with one line, `export LORE_HARNESS_RUN='<run>'`, followed by the unchanged command.
- The binary verifies the run by walking its own ancestor processes to the run's registered harness process (pid AND start time).
- `--harness-run` is retired and the text transform is deleted.
- Tool-protocol calls keep their structured `harness_run` argument and gain the same verification.
- Every refusal names its real cause.

Issues: GitHub #418 (bound through this spec's plan; #410 and #311 were closed as its duplicates) and #457 (claims of ended runs stay live; carried by its task, joined here per user decision D20).

## Trust boundary (user decision D19)

Verification is **per session**. All runs of one Claude Code session (its main run and every subagent run) share one harness process: on 2026-10-26 every `cc:7903287b*` run had `harness_pid` 87262. The ancestry check therefore proves "this lore process belongs to session S", and nothing finer.
- **Refused:** cross-session impersonation (naming a run of another session, or of no live session), and accidental misattribution (an inherited value from a shell profile, an earlier call or another session).
- **Accepted and documented:** a subagent of session S naming a sibling run of the same session S passes verification and is recorded under the named sibling. Within one session the hook is the only writer of the value, and it writes the calling agent's own run. The residual is a deliberate in-session forgery, which the cooperative-agent threat model (ADR-044 U1) accepts. AC-RV-9 pins both sides of this boundary.

## Scope

**In**
- Production code that spawns a lore child with `--harness-run` moves to passing the per-call value in the child's environment. The child inherits the ancestry, so it verifies. Sites: `real-human-channel-port.ts:107`, `review-batch-wiring.ts:66`, `integrate-service.ts:912` (the migrate child). `human-channel.ts:208` detects agent ancestry from the value, not argv. The message at `commands/session.ts:217` is updated.
- Claims of ended runs (#457): claim conflict and release read the holder run's state, so a claim whose run has ended is stale at once (BR-1058, already a live rule that the code does not apply), and the output names the ended run. A claim held by a legacy run that has no harness pid and never ended cannot be renewed (its writes are refused), so it expires on the normal lease. The 81 unended legacy test runs are ended by the evaluation plan's repair (S-A), not here.
- `lore setup` installs one allow rule for the export line into the `settings.json` it already writes hooks into (`merge-settings.ts`), and uninstall removes it (see Permission rules).
- Hook output for Bash: the export prefix, for main and subagent runs (`agent_id`).
- `verifyRunAncestry` in the binary, used by the CLI entry and the tool server.
- Retirement of `--harness-run` and of the text transform (`transform`, `rewriteBashCommand`, `stripHarnessRunFlag`).
- Refusal texts.
- Fresh-install distribution of the changed hook and registration.
- `assets/hooks/pre-edit-anchor-gate.mjs`, which today spawns `lore anchor scope|declare --harness-run <run>`: it passes the run as the per-call value instead (a hook is a harness child, so it verifies).
- Test helpers that pass `--harness-run` (30 test/script files on 2026-10-26, measured with `grep -rl -e --harness-run -e HARNESS_RUN_FLAG packages/*/tests scripts`; 44 files and 177 lines across src, assets, tests and scripts, among them `tests/helpers/test-run-identity.ts`, `known-party-corpus.ts`, `test-invocation.ts`, `run-lore-in-process.ts`) move to a run registered with the test process as harness.
- Shipped text naming `--harness-run` (`packages/lore/src/adapters/cli/CLAUDE.md`).

**Out (non-goals)**
- The run registry, run end and claim rules (ADR-045, unchanged).
- Human sessions, HTTP keys and dashboard logins (BR-1055's other three parties, unchanged).
- Adversarial agents: signed tokens stay out of scope (ADR-044 U1).

## Design

### Carrier

`prefixRunExport(command, run)` returns `export LORE_HARNESS_RUN='<run>'` + `\n` + `command`, byte-for-byte unchanged otherwise. `lore run attest-input` returns it as `updatedInput.command` for every Bash payload, whether or not the command mentions lore. The run is `cc:<session>` on the main thread and `cc:<session>:<agent_id>` when the payload carries `agent_id` (BR-1027). The hook stays a blind pipe that never gives a permission decision (BR-1218).

### Verification (`verifyRunAncestry`)

Input: the run named by `LORE_HARNESS_RUN` (CLI) or `harness_run` (tool server), the registry row, and a process-table port (`process-table-port.ts`, extended with `parentOf(pid)` and `startTimeOf(pid)`). Walk from the lore process itself (`pid = process.pid`, so an in-process test whose run is registered with the test process's pid verifies) upward through parent pids until pid 1. The run is accepted iff a visited pid equals `runs.harness_pid` and that process's start time equals `runs.harness_pid_start`. Outcomes:

| Case | Outcome (exit 4 for writes; reads never refused, BR-1351) | Cause named |
|---|---|---|
| Run unknown | refused | `unknown run <id>` |
| Run ended | refused | `run <id> ended at <t> (<reason>)` |
| Run has no harness pid (legacy: 413 of 783 runs on 2026-10-26, 115 unended) | refused | `run <id> was registered before lore recorded harness processes; resume or restart the session so it re-registers` (re-registration records the newest process, `recordRunProcess`) |
| Harness pid not among ancestors | refused | `this process does not descend from run <id>'s harness process <pid>` (also: a process re-parented after its shell exited) |
| Pid found, start time differs | refused | `harness pid <pid> now belongs to another process (started <t1>, run registered <t2>)` |
| Process table unreadable | refused, never fail-open | the port's reason |

### No value present

If the process carries the agent harness marker but no `LORE_HARNESS_RUN`, the binary reads the effective Claude Code settings:
- Hook installed: the refusal says the value was removed between the Bash call and lore (`sudo` resetting the environment, `env -i`), or the hook failed on this call.
- Hook not installed: the refusal names `lore setup`.

No marker and no value: the human-session path is unchanged (BR-1350).

### Every shell form in #418

These forms inherit the exported value and pass verification, because lore runs as a descendant of the harness: `lore x`; `./dist/lore x`; an absolute path; `for … do lore x; done`; `if … then lore x; fi`; `! lore x`; `{ lore x; }`; a shell function; `env A=1 lore x`; `xargs lore x`; `timeout 5 lore x`; `exec lore x`; `command lore x`; `sh -c 'lore x'`; `echo "$(lore x)"`; an alias; a script file; `bun run dev x`.

`sudo lore x` resets the environment by default and is refused with the "value removed" cause (not with `lore setup`).

### Permission rules (BR-1218)

Claude Code evaluates permission rules against the input the hook returns, not the input the agent sent ([evidence S] code.claude.com hooks reference, PreToolUse `updatedInput`). The export line therefore takes part in permission matching. `lore setup` writes exactly one allow rule matching the export line, and no other permission. The user's own allow and deny rules keep deciding the rest of the command, and the hook still never returns a permission decision.

Which rule syntax Claude Code matches for an `export NAME='value'` line is not documented, so it is pinned by a live-session human criterion (AC-RV-12) rather than assumed. If no rule can match the line, the plan stops at that task and the decision returns to the user. It is not worked around with a hook `allow`, which would bypass the user's rules.

### Concurrency

The value is per process. Two simultaneous Bash calls (main and a subagent, or two subagents) each carry their own run. Verification only reads (registry row, process table). There is no shared mutable state and no lock.

### Public interface (names the falsifiers mutate; each literal appears verbatim, once)

- `packages/core/src/run-identity.ts`: `export const HARNESS_RUN_ENV = "LORE_HARNESS_RUN";`. `prefixRunExport` builds the line with the literal `` `export ${HARNESS_RUN_ENV}=` ``. The attest path calls `prefixRunExport(command, runOfPayload(payload))`.
- `packages/core/src/run-identity-node.ts`: reads the value with the literal `env[HARNESS_RUN_ENV]`. It refuses a flag with the literal `if (runFlag !== null) throw harnessRunFlagRetired()`. It names the real cause with `if (hookInstalled) return refusal(ENV_REMOVED_CAUSE)`. `verifyRunAncestry` contains `if (visited.startTime !== record.harness_pid_start) return refuseAncestry("harness-pid-reused"`.
- `packages/lore/src/adapters/mcp/call-scope.ts`: `if (!verified.ok) return refuseCall(verified.error)`.
- `run-identity-node.ts` (`verifyRunAncestry`): `const visited = walk.find((entry) => entry.pid === record.harness_pid);`
- `packages/lore/src/service/task-workflow-service.ts`: `if (holderRun?.ended_at != null) return staleBecauseRunEnded(` (#457; BR-1058).
- `packages/lore/src/adapters/cli/review-batch-wiring.ts`: `env: { ...opts.env, [HARNESS_RUN_ENV]: opts.harnessRun }`, and the same shape at the other spawn sites.
- `packages/core/src/distribution-hooks.ts`: the existing `{ file: "pre-tool-harness-run.mjs", runner: "node", event: "PreToolUse", matcher: "Bash" }` entry.

## Design Decisions

Chosen with Sequential Thinking (2026-10-26). The carrier itself is user decision D14; full rationale is in the ADR.

| # | Choice | Chosen | Rejected (why) |
|---|---|---|---|
| D1 | Value content | Run id only | Run id + per-call nonce stored in the corpus: one write per Bash call plus an expiry policy (single-use breaks loops); gains only inside one harness process, the residual U1 accepts |
| D2 | Prefix form | `export …` line before the unchanged command | `VAR=x cmd`: only the first simple command sees it (`cd d && lore x` loses it). Subshell `( … )`: breaks working-directory persistence |
| D3 | `--harness-run` | Retired, exit 2 | Kept as a verified second carrier: a precedence rule and a conflict case for no gain |
| D4 | Legacy runs without harness pid | Refused, naming re-registration | Accepted unverified with a label (silent fallback, re-opens consequence 3); back-fill (pid unknowable) |
| D5 | Tool-protocol path | Same `verifyRunAncestry` | Unverified: the server is a harness child, so one walk closes the same gap |
| D6 | No-value refusal | Cause-specific (hook installed or not) | One generic message: today's text names `lore setup` while setup is installed (#418 consequence 2) |
| D7 | Permission matching of the export line | `lore setup` installs one allow rule for the export line only; a live-session criterion pins it | Hook returns `allow` with the rewritten input: approves every call and bypasses the user's rules (BR-1218). No rule: every Bash call may prompt in a session whose rules allowed it before |
| D8 | Claims of ended runs (#457) | Liveness read from the holder run's state at conflict and release time (BR-1058) | Releasing claims only when the run-end hook fires: the hook ran in #457 and the claims stayed live anyway, and no hook fires on a crash. Shorter lease TTL: still blocks, only for less time |
| D9 | Trust boundary (user decision D19) | Per session: cross-session refused, in-session sibling naming accepted and documented | A per-call nonce or a per-agent process: no per-agent process exists in the harness, and a nonce gains only inside one session (see ADR) |

## Acceptance Criteria

Stored with `lore ac add`; repeated here for readers of the body.

- **AC-RV-1** (BR-1218, BR-1027): for each command in the #418 shell-form table, `lore run attest-input` returns `updatedInput.command` equal to `export LORE_HARNESS_RUN='cc:S'` + newline + the original command, byte for byte. A payload with `agent_id` A gives `cc:S:A`. A command without `lore` in it is prefixed too. Test: `packages/lore/tests/unit/core/run-export-prefix.test.ts`.
- **AC-RV-2** (BR-1055, BR-1424): compiled-binary end to end. Every shell form performs a write under its verified run in a throwaway corpus (the agent marker is set, so the human-session path is closed). Test: `packages/lore/tests/e2e/run-identity-shell-forms.bun.test.ts`.
- **AC-RV-3** (BR-1424, BR-1351): over a fake process table, each refusal case (unknown, ended, no harness pid, harness not an ancestor, reused pid, unreadable table) is refused with its named cause and nothing written. A legacy run re-registered with a pid is accepted. Test: `packages/lore/tests/unit/core/run-ancestry-verification.test.ts`.
- **AC-RV-4** (BR-1055): `lore claim T --harness-run cc:S` exits 2 naming the per-call value. No file under `packages/*/src`, `packages/*/tests`, `assets` or `scripts` contains `--harness-run`, `HARNESS_RUN_FLAG`, `stripHarnessRunFlag`, `rewriteBashCommand` or `function transform(`, except the retirement refusal (`run-identity-node.ts`) and its test. This covers the production spawners, the pre-edit hook, the 30 test/script callers and the shipped text. Test: `packages/lore/tests/integration/cli/harness-run-flag-retired.bun.test.ts`.
- **AC-RV-5** (BR-1351): marker present and no value: with the hook installed the message names the removed value and never `lore setup`; without the hook it names `lore setup`. Test: `packages/lore/tests/unit/core/run-identity-refusal-cause.test.ts`.
- **AC-RV-6** (BR-1034, BR-1424): a tool-server call whose `harness_run` names a run whose harness is not an ancestor is refused; with a matching ancestor it is stamped. Test: `packages/lore/tests/integration/mcp/harness-run-ancestry.test.ts`.
- **AC-RV-7** (BR-1027, BR-1036): concurrent subagent calls (`a` and `b`, 20 parallel writes each) each carry exactly their own run. Test: `packages/lore/tests/e2e/run-identity-concurrent-subagents.bun.test.ts`.
- **AC-RV-8** (BR-1218, BR-1093): a fresh `lore setup` registers the Bash hook; a payload piped to the INSTALLED hook prints the prefix; the `settings.json` lore setup writes gains exactly one allow rule, for the export line, and uninstall removes it. Test: `packages/lore/tests/e2e/fresh-install-run-identity.bun.test.ts`.
- **AC-RV-9** (BR-1424, D19): trust boundary. Two harness processes A and B (two sessions). A value naming a run of B, used under A, is refused (exit 4, naming B's harness process). A value naming sibling subagent `cc:A:y`, used by `cc:A:x`, is accepted (exit 0) and recorded as `cc:A:y`, the documented in-session residual. Test: `packages/lore/tests/integration/cli/run-identity-session-boundary.bun.test.ts`.
- **AC-RV-10** (BR-1058, BR-1040): a task claimed by run R, after R ends (`ended_at` set), is claimed by another run with no `--steal` (exit 0, output names R as ended). A plain `lore release` by R's session is accepted. A claim of a live run still refuses (exit 5). Test: `packages/lore/tests/integration/cli/claim-of-ended-run.bun.test.ts`.
- **AC-RV-11** (BR-1218): the child processes lore spawns (review batch, integrate's migrate step, the human channel) carry the caller's run in their environment and write under it; none passes a flag. Test: `packages/lore/tests/integration/cli/child-spawns-carry-run.bun.test.ts`.
- **AC-RV-12** (BR-1218, human): in a live Claude Code session with the user rules `allow Bash(lore get:*)` and `deny Bash(rm:*)`, a prefixed `lore get x` runs without a prompt and a prefixed `rm -rf x` is denied. Recorded with `lore uat record` before plan close.

## Rule changes

Proposed through this spec's change set (`lore rule changes`):
- BR-1424 added on `baseline-attribute-work-to-a-run`: ancestry verification with the per-session boundary (D19).
- BR-1055, BR-1218 and BR-1351 modified. BR-1218 now includes the single permission that setup installs.
- BR-1093 (tool-protocol rewrite) and BR-1058 (an ended run's claim is stale at once) are unchanged. BR-1058 is now enforced (AC-RV-10).


## Acceptance Criteria (structured)

- [·] [script] AC-RV-1: For each command of the #418 shell-form table (lore x; ./dist/lore x; loop, if, !, braces, function bodies; env, xargs, timeout, exec, command, sh -c, quoted command substitution, alias, script, bun run dev), lore run attest-input returns updatedInput.command equal to the line export LORE_HARNESS_RUN='cc:S', a newline, then the original command byte for byte; a payload with agent_id A gives cc:S:A; a command not naming lore is prefixed too. False green guarded: comparing only a prefix would pass a mangled command; the whole string is asserted.
  script: test — bun run test:file packages/lore/tests/unit/core/run-export-prefix.test.ts && echo 'AC-RV-1 PASS: every Bash call is prefixed with its own run, command unchanged'
  other_command=2
- [⚑] [script] AC-RV-2: End to end with the compiled binary: a run registered with harness_pid equal to the test process; every shell form of the table, run through bash -c with the hook's prefix and the agent harness marker set, performs a write in a throwaway corpus with exit 0 and the stored harness_run equal to the run. False green guarded: the marker is set so a human-session fallback cannot make the write pass.
  script: test — bun run test:file packages/lore/tests/e2e/run-identity-shell-forms.bun.test.ts && echo 'AC-RV-2 PASS: every shell form writes under its verified run'
  other_command=1
- [·] [script] AC-RV-3: Over a fake process table, verifyRunAncestry refuses with its named cause and writes nothing for: unknown run, ended run, run without harness pid, harness pid not among ancestors, harness pid found with a different start time, unreadable process table; a legacy run re-registered with a pid is then accepted. False green guarded: a check of pid only passes the reused-pid case; that case is asserted as refused.
  script: test — bun run test:file packages/lore/tests/unit/core/run-ancestry-verification.test.ts && echo 'AC-RV-3 PASS: every unverifiable run is refused with its cause'
  other_command=2
- [·] [script] AC-RV-4: lore claim T --harness-run cc:S exits 2 naming the per-call value and writes nothing; and no file under packages/*/src, packages/*/tests, assets or scripts contains --harness-run, HARNESS_RUN_FLAG, stripHarnessRunFlag, rewriteBashCommand or 'function transform(' except the retirement refusal (run-identity-node.ts) and its test: covers the production spawners, the pre-edit hook, the 30 test/script callers and shipped text. False green guarded: a grep scoped to src only would pass while tests and hooks still pass the flag; all four trees are scanned.
  script: test — bun run test:file packages/lore/tests/integration/cli/harness-run-flag-retired.bun.test.ts && test "$(grep -rlE -e '--harness-run|HARNESS_RUN_FLAG|stripHarnessRunFlag|rewriteBashCommand|function transform\(' packages/core/src packages/lore/src packages/dashboard/src packages/core/tests packages/lore/tests assets scripts | grep -v -e 'packages/core/src/run-identity-node.ts' -e 'harness-run-flag-retired.bun.test.ts' | wc -l | tr -d ' ')" = 0 && echo 'AC-RV-4 PASS: the flag is refused and no caller or rewriter remains'
  other_command=2
- [·] [script] AC-RV-5: Agent harness marker present and no run value: with the hook installed in the effective settings the refusal contains 'removed between the Bash call and lore' and does not contain 'lore setup'; with the hook not installed it names 'lore setup'. Exit 4, nothing written, in both. False green guarded: asserting only that some message appears would pass today's wrong advice; the absence of 'lore setup' is asserted.
  script: test — bun run test:file packages/lore/tests/unit/core/run-identity-refusal-cause.test.ts && echo 'AC-RV-5 PASS: the refusal names the real cause'
  other_command=2
- [⊖] [script] AC-RV-6: A tool-server call whose harness_run names a run whose harness process is not an ancestor of the server process is refused and writes nothing; the same call with a matching ancestor is stamped with that run. False green guarded: testing only the matching case passes an unverified server; the mismatch case is asserted.
  script: test — bun run test:file packages/lore/tests/integration/mcp/harness-run-ancestry.test.ts && echo 'AC-RV-6 PASS: the tool server verifies the run like the CLI'
  other_command=5
- [⚑] [script] AC-RV-7: Two PreToolUse payloads for subagents a and b of one session go through lore run attest-input concurrently; both resulting commands run in parallel 20 times, each writing to a throwaway corpus; every stored write carries exactly its own run (cc:S:a or cc:S:b), zero cross-attribution. False green guarded: running the commands one after another hides shared state; they are started together.
  script: test — bun run test:file packages/lore/tests/e2e/run-identity-concurrent-subagents.bun.test.ts && echo 'AC-RV-7 PASS: concurrent subagent calls each carry their own run'
  other_command=1
- [⚑] [script] AC-RV-8: Fresh install: lore setup into a temporary HOME registers the Bash PreToolUse hook from the shipped assets; a Bash payload piped to the INSTALLED hook file prints updatedInput.command with the export prefix; the settings.json lore setup writes gains exactly one allow rule, matching the export line, and no other permission; uninstall removes it. False green guarded: testing the repo copy of the hook passes while the shipped registration is wrong; the installed file and the written settings are asserted.
  script: test — bun run test:file packages/lore/tests/e2e/fresh-install-run-identity.bun.test.ts && echo 'AC-RV-8 PASS: a fresh install injects the per-call run'
  other_command=4
- [·] [script] AC-RV-9: Trust boundary (D19): with two harness processes A and B, a value naming a run of B used under A is refused with exit 4 naming B's harness process; a value naming sibling subagent cc:A:y used by cc:A:x is accepted with exit 0 and recorded as cc:A:y (the documented in-session residual). False green guarded: testing only the refusal would hide that the boundary is the session; the accepted sibling case pins it.
  script: test — bun run test:file packages/lore/tests/integration/cli/run-identity-session-boundary.bun.test.ts && echo 'AC-RV-9 PASS: cross-session refused, in-session sibling accepted as documented'
  other_command=2
- [·] [script] AC-RV-10: A task claimed by run R whose worktree is clean or gone is, after R ends (ended_at set), claimed by another run without --steal (exit 0, output names R as ended); a plain lore release by R's session is accepted; a claim of a live run still refuses (exit 5); an ended run whose worktree exists with uncommitted changes still refuses (exit 5, BR-1057 kept). False green guarded: testing only after the lease TTL would pass without reading run state; the claim is younger than the TTL.
  script: test — bun run test:file packages/lore/tests/integration/cli/claim-of-ended-run.bun.test.ts && echo 'AC-RV-10 PASS: a claim ends with its run'
  other_command=4
- [·] [script] AC-RV-11: The child processes lore spawns (the review batch, integrate's migrate step, the human channel) carry the caller's run in their environment and write under that run; no spawn passes a run flag; the human channel's agent-ancestry refusal reads the value, not argv. False green guarded: a child spawned without the value would be refused as unattested, so each spawn's write is asserted stamped.
  script: test — bun run test:file packages/lore/tests/integration/cli/child-spawns-carry-run.bun.test.ts && echo 'AC-RV-11 PASS: spawned lore children inherit the verified run'
  other_command=3
- [·] [human] AC-RV-12: In a live Claude Code session with the integration installed and user rules allow Bash(lore get:*) and deny Bash(rm:*), a prefixed 'lore get x' runs without a permission prompt and a prefixed 'rm -rf x' is denied. Harness permission matching cannot run offline, so a person records the observation with lore uat record before plan close. False green guarded: a hook returning allow would pass the first case; the deny case must still be denied.
  human: Pins BR-1218 against the documented fact that permission rules see the hook's rewritten input (code.claude.com hooks reference).
