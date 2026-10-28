---
id: SPEC-225
type: spec
role: spec
title: "Every write is made by a known party: an attested agent run or an explicitly registered human session; no name fallback"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-28
tags: [identity, session, claim]
---
## Overview/Goal

Every write that records an actor is made by a known party: an agent run attested by the agent integration, or a person who registered a human session. A write that is neither is refused and names how to become one. Today a write with no run silently takes a name from the session id, the working copy's branch, an argv `--by`, or the computer's user name, and is kept as "unattested" (BR-1035, BR-1055). That fallback needs patches: a same-name collision check (BR-134), a switch for it (BR-1163), name comparison when neither side has a run (BR-1040, BR-130, BR-131, BR-1056), and a legacy pre-run claim path (BR-1042, BR-1043).

Observed 2026-10-19: a test run outside any agent session took the identity "apple", and an unrelated claim was refused by the same-name check. User decision (2026-10-19): a person working by hand registers an identity explicitly, and people and agents share one identity mechanism.

## End state

1. **Identity sources.** There are exactly four:
   - An agent run, attested by the harness (`--harness-run` / `harness_run`, BR-1093).
   - A human session.
   - The name of an HTTP bearer key.
   - A dashboard login session.

   The resolver has no other layer. The explicit `--by` argv layer, the worktree-derived layer, the environment-session-id name layer and the computer-user-name layer are deleted. `NameSource` keeps only `run`, `human`, `api-key` and `dashboard`.
2. **Human session.**
   - `lore session start --human <name>` registers a run with harness `human` and the given name. The run is bound to this machine and this checkout and is stored in the runs registry like any run.
   - It stays open until `lore session end`.
   - A write from that checkout on that machine with no harness run uses it, unless the process runs inside an agent harness, which is detected by the harness's own environment marker. An agent never writes under a person's session.
   - `lore session show` names the open human session.
   - Starting a second human session in the same checkout is refused while one is open; it names the open one.
3. **Refusal.** A write with no attested run and no applicable human session is refused with exit 4 before anything is written. The refusal names `lore session start --human <name>` for a person and `lore setup` for an agent integration. A harness run the registry does not know is refused the same way, never downgraded. Reads are unaffected. An MCP call without `harness_run` is refused. HTTP keeps its two sources: bearer key name and dashboard login.
4. **Every party has a run.** A human session is a run with harness `human`. An HTTP bearer key and a dashboard login each register a run on first use, with harness `api-key` or `dashboard`, named by the key or the person, and reused for later writes by the same key or login. Claims, releases, overlap checks and the done holder check compare runs only. The store refuses to write a claim, refresh or release without a run (BR-1352). Deleted: the name and session comparison, the same-name check, and its `actor_identity` setting. That key is then rejected by the strict config schema as unknown, like any other unknown key. There is no dedicated retired-setting refusal. `lore migrate config-keys` removes the key from a project config. Claims recorded before runs existed are expired once by the schema upgrade (`lore migrate schema`); this is a migration step, not a standing rule.
The harness marker is part of each agent integration that `lore setup` installs: every shipped integration must declare its marker, and today the only one is Claude Code with `CLAUDECODE=1`. An agent tool that lore ships no integration for sets no marker. Lore cannot tell it from the person's own terminal, so in a checkout where that person opened a session, its writes are recorded as that person, who launched it. Such a tool has no run to attest, which is why it falls under this rule. The spec states this limit instead of guessing.
5. **Binding of a human session.** `lore session start` writes a random session token to a file in the user's lore state directory, keyed by the checkout's absolute path. The file lives outside the repository and is never committed. The registry stores only the token's hash with the run. A write finds the human session by reading that file for its checkout. Host and computer-user names are never consulted. `lore session end` deletes the file and ends the run.
6. **Attribution records.** Every audit and version row records the run, the name and its source: `run`, `human`, `api-key` or `dashboard`. No write is "unattested" anymore. Status and attribution reports count by those sources.

## Rule changes

These are proposed in this spec's change set:

- Modify BR-1055, BR-1032, BR-1040, BR-1043, BR-1056 and BR-130.
- Retire BR-1035, BR-1030, BR-1042, BR-131, BR-134 and BR-1163. The setting BR-1163 described is simply removed.
- Add BR-1350 (human session), BR-1351 (refusal) and BR-1352 (every stored claim names its run).

## Scope

In:
- `packages/core/src` identity resolution: `actor-resolution-node.ts`, `run-identity-node.ts`, `run-identity.ts`, `invocation-node.ts`, `session-actor.ts`, `task-workflow.ts` (legacy tri-state), `config.ts`, `issue-front-matter.ts`, `errors.ts`;
- the services `gate-predicates.ts`, `checkpoint-registry.ts`, `gate-enforcer.ts`, `task-workflow-service.ts`, `phase-workflow-service.ts`, `run-identity-verify.ts`, `attribution-report.ts`, `corpus-service.ts`, `session-service.ts`;
- `store/write-context-store.ts` and the runs registry, including the schema upgrade step;
- CLI: `utils.ts`, `run-cli.ts`, `gate-bypass-audit.ts`, `report-issue-wiring.ts`, and the commands `session`, `claim`, `release`, `done`, `gate`, `report-issue`, `ac` and `status`;
- MCP `call-scope.ts`, HTTP `auth.ts`;
- the shipped skill and rules text that describe unattested writes.

Out: how the harness attests runs (unchanged, BR-1093); dashboard login itself.

## Acceptance Criteria

Structured criteria are recorded with `lore ac add` (AC-HID-1..6).


## Acceptance Criteria (structured)

- [⚑] [script] AC-HID-1: In a throwaway corpus with every identity env var stripped and no human session: lore claim, lore set and lore evidence each exit 4 naming 'lore session start --human' and 'lore setup' and write nothing (version and audit counts unchanged); lore get and lore list still exit 0; a write naming an unregistered harness run exits 4.
  script: test — bun run test:file packages/lore/tests/integration/write-requires-known-party.bun.test.ts && echo 'AC-HID-1 PASS: a write with no known party is refused'
  other_command=2
- [⚑] [script] AC-HID-2: After lore session start --human dana in a throwaway checkout: a lore set writes a version and audit row naming dana with source human and dana's run; lore session show names it; a second start exits 4 naming the open session; after lore session end the next write is refused as in AC-HID-1; a write from a process carrying the agent harness marker is refused rather than attributed to dana.
  script: test — bun run test:file packages/lore/tests/integration/human-session-attribution.bun.test.ts && echo 'AC-HID-2 PASS: a registered person is the writer'
  other_command=2
- [⚑] [script] AC-HID-3: Two runs with the same derived name are different parties: the second's claim of a held task exits 5 (CLAIM_CONFLICT) naming the first run; an overlapping anchor claim exits 4 naming holder run and locations; a release by the other run without force is refused; the same run re-claiming refreshes the lease; task and phase claims both compare runs only (claim-conflict-by-run, claim-release-by-run).
  script: test — bun run test:file packages/lore/tests/integration/claims-compare-runs-only.bun.test.ts packages/lore/tests/integration/cli/claim-conflict-by-run.bun.test.ts packages/lore/tests/integration/cli/claim-release-by-run.bun.test.ts && echo 'AC-HID-3 PASS: claims compare runs, never names'
  other_command=5
- [⚑] [script] AC-HID-4: A config naming the removed actor_identity setting is refused by the strict config schema as an unknown key (exit 4 naming the key); a store write of a claim without a run returns VALIDATION_ERROR and writes nothing; lore migrate schema on a corpus holding a claim with no harness_run key expires that claim, and a second run changes nothing.
  script: test — bun run test:file packages/lore/tests/integration/retired-actor-identity-and-legacy-claims.bun.test.ts && echo 'AC-HID-4 PASS: retired setting refused, legacy claims expired'
  other_command=1
- [⚑] [script] AC-HID-5: No identity fallback code remains: actorIdentityGuard, ACTOR_IDENTITY_COLLISION, os-fallback, detectWorktreeDerivedActor, the 'actor resolved to OS username' warning and any actor_identity key are gone from packages/core/src and packages/lore/src, except packages/core/src/retired-actor-identity-migration.ts, the lore migrate config-keys step that removes the key from a project config.
  script: other — ! grep -rnE --exclude=retired-actor-identity-migration.ts 'actorIdentityGuard|ACTOR_IDENTITY_COLLISION|os-fallback|detectWorktreeDerivedActor|actor resolved to OS username|actor_identity' packages/core/src packages/lore/src && echo 'AC-HID-5 PASS: no identity fallback remains'
  other_command=6
- [⚑] [script] AC-HID-6: HTTP: a bearer-key write is recorded with the key's name and source api-key; a dashboard cookie write is recorded with the logged-in person and source dashboard; neither depends on the lore serve process's own environment or computer user name.
  script: test — bun run test:file packages/lore/tests/unit/adapters/http/http-write-identity.test.ts && echo 'AC-HID-6 PASS: HTTP writes name their key or login'
  other_command=2
