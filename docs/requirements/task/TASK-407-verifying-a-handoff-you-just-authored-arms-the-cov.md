---
id: TASK-407
type: task
role: plan
title: "Verifying a handoff you just authored arms the coverage floor against the writing session, charging it with the next steps it is explicitly handing off"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
## Measured 2026-08-01, end of the six-agent evidence/assess session

The session wrote its outgoing handoff (`knowledge-handoff-agent-main-orchestrator-66`), then
ran ONE verification call to confirm the ticket a human would paste is actually consumable:

    lore feed session-resume --handoff knowledge-handoff-agent-main-orchestrator-66

The Stop-time coverage floor then armed against the WRITING session and demanded disposition
of all 16 items — 8 key decisions and 8 next steps — of the ticket that session had just
authored for its SUCCESSOR.

## Why this is a false obligation, not a strict-but-fair one

The two halves of a handoff have opposite ownership:

- `key_decisions` are a RECORD of what the writing session already established. Dispositioning
  them as "done" is vacuous — they were done by definition before the ticket existed.
- `next_steps` are, by construction, the work the writing session is EXPLICITLY handing off.
  Their existence is the statement "this session is not doing these". Charging the author with
  them inverts the field's meaning: the more honestly a session enumerates what it is leaving,
  the larger the false obligation it incurs at its own Stop.

The floor is a good mechanism for a CONSUMED ticket — that is the case it was built for
(`spec-resume-coverage-floor-the-satisfaction-boundaries-a`, and the sidechain/deferral-reason
tightenings landed earlier the same day). The gap is that arming cannot distinguish
"consumed someone's ticket" from "verified my own".

## Second-order effect worth naming

The corpus-workflow discipline REQUIRES the author to report a paste-ready resume command to
the user. Verifying that the command actually works before handing it over is exactly the
"non-亲眼所见默认不可信" discipline — and doing it is what triggers the penalty. So the
mechanism currently penalises the more careful behaviour, which is the shape that makes agents
quietly stop verifying.

## Candidate predicates (pick one, mechanize it)

1. **Author identity**: do not arm when the handoff's `extra.handoff.by` equals the arming
   session's resolved actor. Cheapest and precise for the single-orchestrator case; blind to a
   session verifying a ticket it wrote under a different actor.
2. **Same-session authorship**: do not arm when the handoff document was CREATED during the
   currently-arming session (compare the doc's `created_at` against session start). Stronger —
   it keys on the actual invariant ("you cannot hand off to yourself") rather than on identity.
3. **An explicit verification flag**: `lore feed session-resume --handoff <slug> --verify-only`
   that renders the ticket and explicitly does not arm. Most honest about intent, but adds a
   flag an agent can forget — and a forgotten flag reproduces today's behaviour, so this is the
   weakest of the three unless combined with (1) or (2).

Prefer (2): it is a fact about the data, not about the caller's discipline.

## Oracle

- RED first: a session that authors a handoff and then runs `lore feed session-resume` on it
  currently arms the floor for that ticket's items; after the fix it does not.
- CONTROL, the case the floor exists for: consuming a handoff authored by a DIFFERENT session
  still arms, with the same item set and the same blocking behaviour — assert the item ids, not
  merely that something armed.
- CONTROL: consuming a handoff authored by the same actor in an EARLIER session still arms
  (this is a legitimate resume — the actor is stable across sessions for a single orchestrator,
  which is precisely why predicate (1) alone is insufficient).
- CONTROL: the deferral-reason and sidechain-non-discharge tightenings landed earlier the same
  day stay green.


## Proxy / Silence / Opt-in — ADR three-question review (2026-08-01, agent:main-orchestrator)

Answered per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` BEFORE
implementation.

**Q1 Proxy — predicate (2) is the closest to the property but is STILL a proxy, and its residual
must be established as FACT before any code is written.**
The property is "you cannot hand off to yourself".
- Predicate (1) actor identity is a proxy the task body already measures as WRONG: a single
  orchestrator's actor is stable across sessions, so (1) suppresses arming for a legitimate
  next-session resume — a false negative against the mechanism's entire purpose. REJECTED.
- Predicate (3) a `--verify-only` flag is a discipline, not a mechanism; a forgotten flag
  reproduces today's behaviour exactly. REJECTED as a standalone.
- Predicate (2) same-session authorship keys on data rather than on caller discipline. ACCEPTED,
  with this named residual: it depends on a reliable SESSION-START BOUNDARY. If no such boundary
  exists as data — only as a heuristic time window — then (2) silently degrades into "authored
  recently", which is a weaker and different claim, and a long session would then re-arm against
  its own ticket anyway.
  ⛔ First implementation step is therefore a measurement, not an edit: establish whether a
  session-start timestamp exists as a stored fact. If it does not, that finding CHANGES the
  choice and must be reported back — do not paper over it with a time window.

**Q2 Silence — the fail-safe direction is TO ARM, and any fall-through to "do not arm" is
rejected.**
When the authorship question cannot be answered (missing `created_at`, no session boundary,
unresolved actor), the mechanism MUST arm. Arming yields a false obligation the operator
discharges with one deferral line; skipping yields a silently unbounded ticket — which is the
exact failure the coverage floor was built to prevent. The asymmetry is deliberate: a false
positive costs a sentence, a false negative costs the floor.

**Q3 Opt-in — clean, and must STAY clean.** Arming is unconditional today. This task narrows
WHEN it arms; it must not introduce a flag, an env var, or a declaration that a caller can
forget — that is what makes predicate (3) unacceptable alone.

**Live confirmation of the defect's cost (2026-08-01, this session).** The incoming ticket
`knowledge-handoff-agent-main-orchestrator-69` printed 19 items (9 key decisions + 10 next
steps). Its 9 key decisions are a RECORD of what the previous session established — dispositioning
them is vacuous by construction, exactly as argued above — yet the floor demands all 19. The
ratio (9 of 19 items structurally vacuous) is the measured tax, and it grows with how honestly a
session documents itself.
