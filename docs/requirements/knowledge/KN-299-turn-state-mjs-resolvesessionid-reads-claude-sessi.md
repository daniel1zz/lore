---
id: KN-299
type: knowledge
role: knowledge
title: "turn-state.mjs resolveSessionId reads CLAUDE_SESSION_ID, but this harness provides CLAUDE_CODE_SESSION_ID — 73 of 73 state dirs are ppid-named"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PRD-001
---
## The defect

`assets/hooks/lib/turn-state.mjs` documents its contract as `resolveSessionId(): CLAUDE_SESSION_ID env > ppid-$PPID fallback` and comments the fallback as guarding against cross-instance collision. Measured 2026-07-30 in this harness:

- `CLAUDE_SESSION_ID` is **UNSET**. The field actually exported is `CLAUDE_CODE_SESSION_ID` (alongside `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`).
- Consequently the first priority **never** matches. `~/.claude/session-state/sessions/` holds **73** directories and **0** of them are non-`ppid-` named — every session in the recorded history took the fallback.

## Why it has stayed invisible

Existing consumers write and read per-turn state from the SAME side: `stop-doc-sync.mjs` checks `getTurnDir()/edited.flag` and `edited-files.jsonl`, and every writer is also a hook spawned by the Claude Code process, so the ppid is stable within a session and the feature works. The defect only surfaces when a second process must agree on the identity.

## The three consequences that do bite

1. **Cross-process state is unusable.** A Stop hook is spawned by the Claude Code process; a `lore` invocation runs under a Bash-tool shell. They resolve DIFFERENT ppids, so state written by one is invisible to the other — and a consumer whose contract is "no recorded state → exit 0" degrades to **silent inertness**, shipping a gate that never fires. This was measured while designing `spec-resume-ticket-coverage-a-shipped-upper-bound-left-the`, which consequently chose a zero-cross-process-state design (its D8) rather than build on turn-state.
2. **Restart orphans state.** A new Claude Code process gets a new ppid, so prior turn state is stranded. The 73 accumulated directories are that residue.
3. **ppid reuse can collide** — exactly the cross-instance collision the fallback comment claims to prevent. The OS reuses pids; two sessions separated in time can land the same ppid and share a state directory.

## Not fixed here

The fix is a one-line env-var read, but its blast radius is every hook that relies on per-turn state, and a naive change flips all 73 existing sessions to a new directory scheme at once. It needs its own spec: read `CLAUDE_CODE_SESSION_ID` with `CLAUDE_SESSION_ID` retained as an accepted alias, decide whether the ppid fallback should remain at all or fail loud, and state a migration/abandonment policy for the existing directories.

Delivery surface when it is fixed: `assets/hooks/lib/turn-state.mjs` (SSOT) → assets manifest regeneration → `lore setup`. A fix applied only to the installed copy under `~/.claude/` does not exist for consumers.
