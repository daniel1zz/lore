---
id: ADR-060
type: adr
role: decision
title: "A Bash call's run identity travels in a per-call environment value that lore verifies against its own process ancestry"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-28
tags: [run-identity, governance-mechanism-fixes]
parent: PRD-001
links:
  - {id: ADR-044, type: relates-to}
  - {id: ADR-045, type: relates-to}
  - {id: SPEC-245, type: informs}
---
# A Bash call's run identity travels in a per-call environment value that lore verifies against its own process ancestry

Status: proposed (S2 draft, governance-mechanism-fixes initiative). Supersedes decision 2's carrier clause of `adr-run-identity-is-issued-by-lore-and-attested-by-the-harness` (ADR-044: "Per-invocation, never through an environment variable") for Bash calls only. Every other decision of ADR-044 and of `adr-write-identity-is-the-attested-run-alone-a-run-s-claims-end` (ADR-045) stands. Resolves GitHub #418 (duplicates #410, #311 closed into it). User decision D14 (2026-10-25) chose the carrier; this record states why it answers ADR-044's objection.

## Context

ADR-044 decision 2 carries the run into a Bash call by rewriting the command text: `lore run attest-input` (packages/core/src/run-identity.ts `transform`, ~304-401) inserts `--harness-run <run>` after every command-position word that is exactly `lore`, and strips a caller-written `--harness-run` only inside such a command. The binary accepts any registered agent run the flag names (`resolveInvocationIdentity`, packages/core/src/run-identity-node.ts:117-150) and never proves the caller is that run.

One mechanism, three observed consequences (issue #418):

1. Not tagged, write refused: `./dist/lore` (#410); `lore` after `do`/`then`/`else`/`if`/`!`/`{`, inside functions and loops (#311); wrappers `env`, `sudo`, `xargs`, `timeout`, `exec`, `command`; `sh -c '...'`; quoted command substitution; aliases; scripts; `bun run dev`.
2. The refusal names `lore setup` although setup is installed (run-identity-node.ts:153-156 via `refusalNamingHowToBecomeKnown`).
3. A lore invocation the rewriter does not recognise keeps a caller-written `--harness-run`, so the binary attributes the write to whatever registered run the caller named.

A full shell parser would still miss paths, wrappers, aliases and scripts: the word `lore` is not the invocation.

Measured 2026-10-26 (`sqlite3 -readonly .lore/lore.db`): 783 runs; 413 have no `harness_pid` (105 main, 308 subagent), 115 of them not ended. `harness_pid` has been recorded since 2026-10-16 (main) and 2026-10-18 (subagent) by `assets/hooks/run-register.mjs:94` (`process.ppid` of the hook = the harness), resolved past shell wrappers by `resolveHarnessPid` (packages/lore/src/adapters/process-table-port.ts:186), and re-recorded on every registration (`recordRunProcess`: "the newest registration wins").

## ADR-044's objection, and why it does not apply here

ADR-044 rejected "identity in OS environment variables" because such a value (a) is inherited by every child process, (b) can be set by any shell-profile line, and (c) is untraceable: a stale `export LORE_ACTOR=...` attributed every session's writes to one name. The rejected design was a *long-lived, self-declared name read without verification*. This decision differs on each count:

| ADR-044 objection | This design |
|---|---|
| Set once, lives for the whole shell or profile | Written by the PreToolUse hook into the command of ONE Bash call, before the call's own text; every Bash call gets it re-written, so a value from a profile or an earlier call is overwritten at the start of each call |
| Any value is believed | The binary believes the value only when it walks its own ancestor processes and reaches the named run's registered harness process (pid AND recorded start time). A profile value, a value copied from another session, or a value naming a run whose harness is not an ancestor is refused |
| Inheritance spreads it to unintended processes | Inheritance is exactly what is wanted within one call: `./dist/lore`, `sh -c`, `xargs`, functions, loops, scripts and `bun run dev` all inherit it. Outside the call's process tree it is useless, because the ancestry check fails in any other harness's tree |
| Untraceable | The run is still recorded on every write (BR-1032); a refusal names the run, the harness pid it expected and the ancestry it found |

**Trust boundary (user decision D19, 2026-10-26).** Verification is per SESSION: the agents of one session are one trust domain. Cross-session impersonation and accidental misattribution are refused. A subagent naming a sibling run of the same session is accepted, recorded under that sibling, and documented as the accepted residual. The spec's AC-RV-9 pins both sides.

**Permission rules.** Claude Code evaluates permission rules against the input the hook returns ([evidence S] code.claude.com hooks reference). `lore setup` therefore installs one allow rule for the export line only; the user's rules keep deciding the rest, and the hook never approves a call. A live-session criterion (AC-RV-12) pins it.

What the ancestry check does NOT separate: two runs of the same harness process (a main session and its subagents share one harness pid). Within one harness the hook is the only writer of the value and writes the calling agent's own run (it receives `agent_id` on every PreToolUse inside a subagent, F1-F3 of the validation ledger). A cooperative agent that deliberately types another run's id inline in its own command is the residual risk ADR-044 U1 (cooperative but error-prone agents) already accepts; it is strictly narrower than today, where a caller can name a run of ANY session.

## Decision

1. **Carrier.** For every Bash call, the PreToolUse hook prepends one line, `export LORE_HARNESS_RUN='<run>'`, followed by a newline and the call's original command, unchanged. The hook does not look for the word `lore`; every Bash call is prefixed. The run is the calling agent's own run (`cc:<session>` on the main thread, `cc:<session>:<agent_id>` in a subagent, BR-1027).
2. **Verification in the binary.** A lore process that finds `LORE_HARNESS_RUN` looks the run up in the registry and walks from itself up its ancestor chain (its own pid first, then parent pid by parent pid, up to pid 1). The identity is accepted only when a visited process has the run's recorded `harness_pid` AND that process's start time equals the recorded `harness_pid_start`. Any other outcome is refused (exit 4) before anything is written, with a message naming the cause: unknown run, run ended, run registered without a harness pid (re-registration on resume records one), harness process not among the ancestors, or harness pid reused by another process (start time differs).
3. **The command-line flag is retired.** `--harness-run` is no longer an input: a command line carrying it is refused as a usage error (exit 2) naming the per-call value. The text transform (`transform`, `rewriteBashCommand`, `stripHarnessRunFlag`) is deleted, not kept as a fallback.
4. *Amended 2026-10-28: void. The lore tool server and its `mcp__*lore_*` tools were deleted on 2026-10-27 (`adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only`) and the hook rewrites Bash input only, so decisions 1-3 cover every attested call. Original text kept as the record:* **Tool-protocol calls keep their structured argument and gain the same verification.** The hook still writes `harness_run` into `mcp__*lore_*` tool input (a structured field, not text). The tool server, a child of the harness, verifies the named run with the same ancestry function before any write.
5. **The refusal names the real cause.** When a process carries an agent harness marker but no `LORE_HARNESS_RUN`, the binary checks whether the hook is installed in the effective settings. Installed: the refusal says the value was removed between the Bash call and lore (for example `sudo` resetting the environment, or `env -i`), or the hook failed on this call. Not installed: it names `lore setup`. `lore setup` is never named when the hook is installed.
6. **Legacy runs are not believed without a harness pid.** No fallback: a run without `harness_pid` is refused with the instruction that resuming or restarting the session re-registers it (registration records the newest process).

## Options considered (decided with Sequential Thinking, 2026-10-26)

| Choice | Chosen | Rejected and why |
|---|---|---|
| Carrier (user decision D14) | Per-call exported value + ancestry check | Full shell parser: still misses paths, wrappers, aliases, scripts. Signed tokens (ADR-044 O2-S5): built for adversarial agents, out of scope under U1 |
| Value content | Run id only | Run id + per-call nonce stored in the corpus: one corpus write per Bash call and an expiry policy (single-use breaks loops calling lore repeatedly); its only gain is within one harness process, the residual U1 accepts |
| Prefix form | `export ...;` line before the unchanged command | `VAR=x cmd` assignment prefix: applies only to the first simple command (`cd x && lore ...` loses it). Subshell wrap `( ... )`: breaks working-directory persistence between calls |
| `--harness-run` flag | Retired, refused (exit 2) | Kept as a second verified carrier: two carriers need a precedence rule and a conflict case for no gain; tests register a run whose harness pid is the test process |
| Legacy runs without a harness pid | Refused, naming re-registration | Accepted unverified with a label: a silent fallback that re-opens consequence 3. Back-filled: the pid is unknowable |
| Tool-protocol path | Same verification | Left unverified: the server is a harness child, so the check costs one ancestry walk and closes the same gap |

## Consequences

- Positive: every shell form listed in #418 carries identity; a caller cannot name a run outside its own harness process; refusals name the cause; the 400-line text rewriter and its quoting/heredoc edge cases disappear.
- Negative: each verification walks the process table (`ps`), on every write invocation; a process detached from the harness (re-parented to pid 1 after its shell exited) is refused; tests must register runs bound to the test process.
- Concurrency: the value is per process; two simultaneous Bash calls of two agents each carry their own run, and verification only reads. No shared state is written.
- Distribution: hook asset, its registration and the refusal text ship in the binary and `assets/`; a fresh-install probe verifies them.

## Baseline impact

`baseline-attribute-work-to-a-run`: BR-1055 (identity sources), BR-1218 (what the hook does to a call, plus the one permission setup installs) and BR-1351 (refusal wording) are modified; BR-1424 states the ancestry verification and its per-session boundary. BR-1093 (tool-protocol rewrite) is unchanged. Proposed through the spec's rule change set.
