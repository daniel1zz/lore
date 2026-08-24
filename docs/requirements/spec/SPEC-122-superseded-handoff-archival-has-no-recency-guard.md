---
id: SPEC-122
type: spec
role: spec
title: "Superseded-handoff archival has no recency guard"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Superseded-handoff archival has no recency guard, so a live session's ticket is an instant candidate

## Overview/Goal

`computeArchiveCandidates` (`packages/core/src/archive-candidates.ts`) applies two
handoff rules with asymmetric protection:

| rule | conditions |
|---|---|
| R2 superseded | grouped by `[doc.parent_id, handoff.by]`; every non-newest member of a group ≥2 is a candidate. **No age condition. No plan condition.** |
| R3 expired | `age > handoffTtlMinutes` (strict) **AND** (planless OR parent plan terminal) |

Measured 2026-07-31: writing a session-closing handoff as `agent:main-orchestrator`
made another concurrently-running session's handoff an immediate `superseded_handoff`
candidate — `lore archive --sweep` proposed archiving a ticket that session was still
using. The reverse also fired: this session's own handoff was archived as superseded
by an unrelated session's, minutes after being written.

The grouping key is why. Planless handoffs all carry the root PRD as `parent_id`, so
the key degenerates to actor alone, and every session that does not export a distinct
`LORE_ACTOR` competes for one slot. The guidance in force tells orchestrators to use
`agent:main-orchestrator`, so collision is the normal case, not an edge case.

Severity is LOW and measured rather than assumed: an archived handoff stays fully
resumable by explicit slug (`lore feed session-resume --handoff <slug>` → exit 0, full
render), so nothing becomes unrecoverable. What is lost is a row in `latest_handoffs`,
the neutral discovery directory an agent is forbidden to self-resume from anyway.

## Scope

**In scope**

- R2 gains the recency guard R3 already has: a superseded handoff is a candidate only
  once it is older than `handoffTtlMinutes`. A ticket young enough to be live becomes
  unreachable by the sweep.
- R2 stays distinct from R3 rather than collapsing into it — it must still reclaim
  superseded handoffs under an ACTIVE plan, which R3 never touches.

**Out of scope**

- Keying supersession on session identity. `HandoffExtra` carries no session field, and
  SPEC-042's `(by, machine, worktree)` triple does NOT discriminate: two concurrent
  orchestrator sessions run on the same machine, in the same checkout, under the same
  actor, so all three components match. A real fix needs a new identifier plumbed into
  `lore handoff`, which raises a distribution question (the harness gives hooks a
  session id; a consumer invoking the bare binary has none, so the field would be
  absent and the grouping would degenerate right back). That is an owner-level design
  decision, recorded in the governing retro, deliberately not decided here.
- An explicit `--supersedes` edge on `lore handoff`. Adjacent capability, not this fix.
- Changing `handoffTtlMinutes` itself.

## Decisions

**D1 — reuse `handoffTtlMinutes`; do not introduce a second threshold.** The question
R2 needs answered is the same one R3 asks ("is this old enough that nobody is using
it?"), and a second knob would need its own default, its own config surface, and its
own explanation of how it differs. One threshold, two rules.

**D2 — the guard is on the SUPERSEDED doc's age, not the superseding doc's.** What must
not be archived is a possibly-live older ticket. The newer handoff's age is irrelevant
and reading it would invert the protection.

**D3 — R2 keeps precedence over R3 for candidate attribution.** R3 already skips
anything R2 flagged (`supersededIds`), preserving the module's one-candidate-per-doc
invariant. With the age guard, a doc old enough for R2 may also satisfy R3; R2 must
still win so the reported `reason` names supersession, which is the more specific and
more actionable explanation.

**D4 — the sweep/apply split is unchanged and is the standing mitigation.**
`lore archive --sweep` printing candidates for a human to read, separately from
`--apply`, is what prevented harm here. This fix reduces what reaches the proposal; it
does not make `--apply` safe to run unread.

## Acceptance Criteria

Script-mode ACs verified by `lore verify`, against `computeArchiveCandidates` directly
(pure, `nowIso` and TTLs injected — no clock, no store).

The load-bearing assertion is the NEGATIVE one: two handoffs sharing
`[parent_id, by]`, the older one YOUNGER than the TTL, must yield **zero**
`superseded_handoff` candidates. A test that only checks the old-enough case passes
against today's defective behaviour, which flags regardless of age.


## Acceptance Criteria (structured)

- [⚑] [script] AC-R2-1: NEGATIVE, load-bearing: two handoffs sharing the same parent_id and by, with the OLDER one younger than handoffTtlMinutes, yield ZERO superseded_handoff candidates. A test asserting only the old-enough case passes against today's behaviour, which flags regardless of age — so this negative half is the whole measurement.
  script: test — bunx vitest run packages/core/tests/unit/archive-candidates-recency.test.ts -t 'a young superseded handoff is not a candidate'
- [⚑] [script] AC-R2-2: The guard reads the SUPERSEDED doc's age, not the superseding doc's (D2): an OLD superseded handoff paired with a freshly written newer one is still a candidate. Inverting the comparison would silently invert the protection, and no assertion on the young case alone can detect that.
  script: test — bunx vitest run packages/core/tests/unit/archive-candidates-recency.test.ts -t 'the guard reads the superseded docs age'
- [⚑] [script] AC-R2-3: R2 stays distinct from R3 rather than collapsing into it: an old superseded handoff under an ACTIVE parent plan is still reported, with rule superseded_handoff and a reason naming supersession — R3 never touches an active plan, and R2 must keep precedence for attribution so the more specific reason is the one surfaced.
  script: test — bunx vitest run packages/core/tests/unit/archive-candidates-recency.test.ts -t 'R2 stays distinct from R3'
- [⚑] [script] AC-R2-4: The pre-existing rules are unchanged: the whole archive-candidates suite passes, covering expired_handoff's own TTL-and-plan-terminal conditions and done_plan_straggler, plus the one-candidate-per-doc invariant. No test total is hardcoded.
  script: test — bunx vitest run packages/core/tests/unit/archive-candidates.test.ts

## Code anchors

- packages/core/src/archive-candidates.ts#computeArchiveCandidates
