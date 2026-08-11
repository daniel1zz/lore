---
id: TASK-400
type: task
role: plan
title: "The session-start marker collapses five distinct conditions into one undefined, so the new same-session check can be entirely inert on any install that has not re-run lore setup — and nothing anywhere says so"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: TASK-407, type: relates-to}
  - {id: ADR-028, type: relates-to}
---
Residual found by the orchestrator's own code review of `def21ac` (merged as `edc0b8d`), the fix for
`task-verifying-a-handoff-you-just-authored-arms-the-coverage`. Not a regression — the merged
behaviour is fail-SAFE in direction. The defect is that the mechanism can fail COMPLETELY and
SILENTLY, which is the governing ADR's Question 2 verbatim.

## Measured by reading the merged source, not the tests

`readSessionStartIso` (`packages/lore/src/flows/feed-flow.ts`) collapses FIVE distinct conditions
into one `undefined`:

1. neither `CLAUDE_CODE_SESSION_ID` nor `CLAUDE_SESSION_ID` is set;
2. the marker file does not exist (the SessionStart hook never fired — e.g. an install that has not
   re-run `lore setup` since this shipped);
3. `JSON.parse` throws on a corrupt marker;
4. the parsed object has no string `started_at`;
5. any IO error (`catch { return undefined }`).

`buildResumeFeed` then does `suppressFloor = isSameSessionAuthorship(resume.handoff, currentActor,
sessionStartIso)`, and `isSameSessionAuthorship` returns `false` when `sessionStartIso === undefined`.

So every one of those five conditions arms the floor. **That direction is correct** and was
deliberately chosen (the task's Q2 answer: "the fail-safe direction is TO ARM"). Verified by
reading both call sites, not by trusting the test names.

## Why it is still a defect

Condition 1 and 2 are the STEADY STATE of every install that has not re-run `lore setup`. In that
state the new mechanism is not merely degraded — it is entirely inert, and the original false
obligation (a session charged with the next-steps it is handing off) recurs on every single
self-verification, forever, with:

- no marker in the feed output saying the check could not run,
- no stderr line,
- every test green (the test suite supplies the env var and the marker itself, so it exercises the
  measured path and never the unmeasured one),
- and an operator who cannot distinguish "you are not the author" from "authorship was never
  determined".

`undefined` therefore means BOTH "measured: different session" and "not measured at all" — the exact
"an empty result and a clean result must not be the same value" failure the ADR names. A mechanism
whose total absence is invisible cannot be known to be working, and this one currently is not
observable at all from the outside.

## Required

- Make `readSessionStartIso` return a DISCRIMINATED outcome, not `string | undefined`: at minimum
  `{kind:"measured", startedAt}` / `{kind:"no-session-id"}` / `{kind:"no-marker"}` /
  `{kind:"unreadable", detail}`. Keep the arming behaviour byte-identical for every non-`measured`
  kind — this task changes OBSERVABILITY, never the verdict.
- Surface the non-`measured` kinds where the affected human looks: one line in the
  `session-resume` output (and its `--json` payload) stating that same-session authorship could not
  be determined and the floor was therefore armed unconditionally. `unreadable` additionally warrants
  a stderr line — a corrupt marker is a real fault, not a normal state.
- ⛔ Do NOT change the fail-safe direction, do NOT add a flag to suppress arming, and do NOT make a
  missing marker an error that blocks `lore feed session-resume` — the ticket must always render.

## Proxy / Silence / Opt-in

- **Proxy** — none added; this only makes an existing proxy's unmeasured state legible. The marker
  file remains a proxy for "this session started at T" (a stale marker from a crashed same-id
  session would satisfy it), which the parent task already accepted in writing.
- **Silence** — this task IS the silence fix. Success criterion: an operator reading the resume
  output can tell, without opening any source file, whether the authorship check actually ran.
- **Opt-in** — the discrimination is unconditional. Note the parent mechanism has its own opt-in
  residual worth naming here: it only functions after `lore setup` installs the SessionStart hook,
  so every not-yet-updated install silently sits in the inert state — which is precisely why the
  inert state must be visible rather than assumed away.

## Oracle

- RED first: with no `CLAUDE_CODE_SESSION_ID` set, `lore feed session-resume --handoff <slug>`
  currently prints no indication that authorship was undetermined; after the fix it says so, and the
  floor still arms. Both halves asserted — the arming assertion is the anti-regression guard.
- RED first: with the env var set but the marker file absent, same requirement, and the reported
  kind must be `no-marker`, distinguishable from `no-session-id`. Assert the KIND VALUE.
- RED first: with a marker containing `{"started_at": 12345}` (wrong type) and with one containing
  invalid JSON, the reported kind is `unreadable` and a stderr line is emitted. Assert both cases
  separately — they take different code paths.
- CONTROL: with a valid marker and matching actor, the floor is still suppressed and the output is
  byte-identical to today's for that path.
- CONTROL: every test landed by `edc0b8d` stays green — `packages/core/tests/unit/same-session-authorship.test.ts`, `packages/lore/tests/unit/feed-resume-same-session.test.ts`, `packages/lore/tests/unit/feed-resume-coverage.test.ts`, `packages/lore/tests/unit/handoff-coverage-check.test.ts`, `packages/lore/tests/unit/stop-handoff-coverage.test.ts`, and `packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts`.
