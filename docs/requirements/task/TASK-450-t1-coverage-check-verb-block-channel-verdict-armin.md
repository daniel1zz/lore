---
id: TASK-450
type: task
role: plan
title: "T1 — coverage-check verb: block-channel verdict, arming provenance, cross-turn accumulation"
status: archived
priority: medium
phase: "verb"
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-086
plan: PLAN-086
links:
  - {id: TASK-453, type: blocks}
  - {id: TASK-452, type: blocks}
---
# T1 — coverage-check verb: block-channel verdict, arming provenance, cross-turn accumulation

## Task Objective

Make the resume-ticket coverage floor actually change assistant behaviour, and stop it firing on tickets that were merely read or already accounted for. All four changes live in the `coverage-check` verb; the Stop hook asset is NOT to be edited.

## Spec Reference

`spec-resume-ticket-coverage-floor-blocking-channel-arming` — decisions H1–H6. Read the spec before starting; the measured 10-vs-0 control arm in its Overview is the reason this task exists.

## Changes

1. **Verdict channel (H1/H2).** On an incomplete accounting, write ONE JSON object to stdout — `{"decision":"block","reason":<text>}` — and exit 0. Keep writing the per-id `Undispositioned resume ticket item: <id>` lines to stderr. Remove the `process.exitCode = 1` verdict entirely: after this change incomplete / complete / no-ticket / malformed-stdin / unreadable-transcript ALL exit 0, and stdout is the only channel that separates them.

2. **Reason template (H3).** Build the reason from the `@lore/core` exports `RESUME_DISPOSITION_MARKER`, `RESUME_DISPOSITION_DONE`, `RESUME_DISPOSITION_DEFERRED_PREFIX`. It must state what output is required and carry one line per missing id such that feeding the reason text back through the verb's own `parseDispositionedIds` recognises exactly those ids. No hand-typed marker literal in the verb source — AC-RCH-2 runs a zero-hit search for one. Model the shape on `stop-doc-sync.mjs`'s `PROMPT` + `Required output` framing, which is the arm that measured 10/10 compliance.

3. **Arming provenance (H4).** Today `findLatestTicket` scans every `tool_result` for a cardinality line, so `cat`-ing an archived handoff arms a fabricated 9-item duty (probed 2026-08-01). Pair each candidate `tool_result` with its originating `tool_use` via `tool_use_id` and arm ONLY for a `lore feed session-resume` call:
   - Bash-shaped: the `command` string contains the lone tokens `feed` AND `session-resume`, order-independent, non-adjacent permitted. Never match a contiguous phrase — a reworded command line must not degrade silently to "no ticket → exit 0".
   - MCP-shaped: tool name `lore_feed` with a `session-resume` checkpoint argument.
   Preserve the SPEC-112 D10 exemption exactly as it is: `RESUME_COVERAGE_FLOOR` absent → no block, checked before any disposition inspection.

4. **Cross-turn accumulation (H5).** Expected ids are satisfied by the UNION of dispositions found in (a) every assistant text message in the transcript after the ticket and (b) `last_assistant_message`. Keep the current turn's dispositions coming from `last_assistant_message` only — the transcript's newest entry may be unflushed at Stop time, which is why SPEC-112 D8 split the channels in the first place.

## Acceptance Criteria

AC-RCH-1 … AC-RCH-8 on the governing spec. T1 owns the implementation; the oracles are written independently in T2/T3. Do NOT write or edit `packages/lore/tests/unit/handoff-coverage-check.test.ts` or `packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts` — they are another task's anchors and a concurrent claim would be denied.

## Context Digest

- `runCoverageCheck` / `findLatestTicket` / `parseDispositionedIds` / `buildCardinalityLineMatcher` all live in `packages/lore/src/adapters/cli/commands/handoff.ts`.
- The hook (`assets/hooks/stop-handoff-coverage.mjs`) already relays child stdout byte-for-byte and relays the child exit status — that is why no asset edit is needed. Do not touch it.
- SPEC-112 D9 forbids any grammar in the hook; keeping the template in the binary is what preserves that.
- The transcript entry shapes were measured, not assumed: a tool result arrives as `type:"user"` with `message.content[]` holding `{type:"tool_result", content}`; a tool call arrives as `type:"assistant"` with `{type:"tool_use", id, name, input}`.

## File Anchors

`packages/lore/src/adapters/cli/commands/handoff.ts`, `packages/core/src/session.ts` (only if a new exported constant is genuinely needed for the template).

## Oracle

`bun install` FIRST in the worktree, then `bun run test:changed <base>` plus `bun run typecheck`. Never the full suite from a worktree.
