---
id: SPEC-231
type: spec
role: spec
title: "Runs carry their messaging address; holder listings show it so a claim holder is reachable after a restart renames its session"
status: approved
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
---
## Overview/Goal

A session finds a claim holder by session id (`lore bootstrap` active_sessions, `lore ready --json` sessions[], `lore territory`), but Claude Code's cross-session messaging addresses sessions by a display name that changes when a session restarts. On 2026-10-20 a session could not map `a979eecd` / `b2737a57` to their new names and broadcast to every peer. This spec makes the run carry its messaging address (BR-1360) and every holder listing show it (BR-1363), so a holder is reachable by `SendMessage to: uds:<path>` from the corpus alone.

## Scope

In:
- `assets/hooks/run-register.mjs` forwards the raw `CLAUDE_CODE_MESSAGING_SOCKET` on SessionStart only as `lore run register --messaging-socket <path>`; the hook holds no address grammar (its D10 invariant). Manifest regenerated.
- `lore run register` composes the address per harness (`claude-code` → `uds:<path>`; an unknown harness given the flag fails loud). Only main runs store an address; subagent runs store NULL.
- `runs.message_address` nullable column (next free migration, SQLite + Turso + in-memory), written by an unconditional per-register store write (resume replaces it; an absent value stores NULL, never keeps the old one).
- `lore run show` text prints `address: <value>` / `address: none recorded`; JSON carries RunRecord's `messageAddress`.
- `readySessionSchema` gains `message_address: string | null`: the address of the holder session's MAIN run, resolved from each claim's `harness_run` to its run, then to the main run of that run's session (derived from the session id, since the hook registers subagent runs without a parent link). Surfaced by bootstrap active_sessions, `lore ready` sessions (JSON and text), territory foreign holders (JSON and text), and the dashboard ReadySession type.

Out:
- Any change to Claude Code's naming or to SendMessage.
- Liveness of the address (a recorded address may belong to an exited session; `lore session list` liveness stays as is).

## Acceptance Criteria

Structured criteria: `lore ac list` on this spec (AC-MA-1..AC-MA-4).


## Acceptance Criteria (structured)

- [⚑] [script] AC-MA-1: assets/hooks/run-register.mjs forwards the raw socket path and composes no address grammar (its D10 invariant): on a SessionStart payload with CLAUDE_CODE_MESSAGING_SOCKET=/tmp/x/1.sock it invokes lore run register with exactly '--messaging-socket /tmp/x/1.sock'; with the variable unset or empty it passes no --messaging-socket flag; on a SubagentStart payload it passes no --messaging-socket flag even when the variable is set; it exits 0 in every case. Separately, the shipped assets manifest sha256 for run-register.mjs matches the file.
  script: test — f=$(mktemp); bun run test:file packages/lore/tests/unit/hooks/run-register-hook.test.ts -t 'messaging socket' > "$f" 2>&1; ec=$?; cat "$f"; [ "$ec" -eq 0 ] && grep -Eq 'Tests +[1-9][0-9]* passed' "$f" && bun run test:file packages/lore/tests/unit/assets-ssot.test.ts && echo 'AC-MA-1 PASS: hook forwards the raw socket on SessionStart only (at least one messaging socket test passed), manifest in sync'
- [⚑] [script] AC-MA-2: In a mkdtemp corpus: opening a corpus at the schema version preceding this task's migration migrates it to that migration's version with a nullable runs.message_address column. lore run register --harness claude-code --session S (no --harness-pid) --messaging-socket /a stores uds:/a; a second register of S with --messaging-socket /b stores uds:/b; a third register of S with no flag stores NULL (the old value is not kept); a subagent run registered with --messaging-socket stores NULL. lore run show prints 'address: uds:/b' after the second register and 'address: none recorded' after the third; lore run show --json carries messageAddress (RunRecord's camelCase) with the same values. The same assertions pass on the in-memory store.
  script: test — bun run test:file packages/lore/tests/integration/cli/run-message-address.bun.test.ts && echo 'AC-MA-2 PASS: register stores, resume replaces, absent clears, subagent stores none, run show prints'
- [⚑] [script] AC-MA-3: Fixture: main run M1 (address uds:/one) holds task A; a subagent run of M1's session, registered WITHOUT --parent exactly as the hook does (parentRunId NULL), holds task B; main run M2 (no address) holds task C. bootstrap active_sessions, lore ready --json sessions[] (task plan; the phase-plan sessions schema is checked for the same field as a schema-consistency check only, it has no production caller), and lore territory --json foreign holders report message_address uds:/one for the holders of A and B and null for C. lore territory and lore ready text output print uds:/one on the M1 session's holder line. Holder counts equal those computed with the field removed (no holder dropped by the join).
  script: test — bun run test:file packages/lore/tests/unit/service/holder-message-address.bun.test.ts && echo 'AC-MA-3 PASS: every holder listing shows the main run address or null'
  other_command=1
- [⊘] [script] AC-MA-4: End to end with the built dist/lore and no live Claude Code session: in a mkdtemp project after lore init and lore setup, feeding the installed run-register hook a SessionStart payload with CLAUDE_CODE_MESSAGING_SOCKET=/tmp/e2e/7.sock, then claiming a task under that run, makes lore bootstrap --json list that session with message_address uds:/tmp/e2e/7.sock; feeding a resume SessionStart payload for the same session with /tmp/e2e/8.sock changes it to uds:/tmp/e2e/8.sock.
  script: e2e — bun run test:file packages/lore/tests/e2e/run-message-address-e2e.bun.test.ts && echo 'AC-MA-4 PASS: fresh install hook to bootstrap shows the current address after resume'
  other_command=1
