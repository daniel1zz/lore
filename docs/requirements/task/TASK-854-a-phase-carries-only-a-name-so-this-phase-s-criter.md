---
id: TASK-854
type: task
role: plan
title: "A phase carries only a name, so 'this phase's criteria' is unfalsifiable and an empty phase vacuously satisfies the one implicit condition"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"addressability","tags":["phase","vacuous-truth","addressability","north-star"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"795b0d8e-892a-4acd-9335-d57a508f96b7"}
---

A phase can carry only a name and an optional prose description. No field exists for a checkable completion condition. So any statement of the form "this phase's criteria include X" is unfalsifiable, and the one implicit condition — every child task archived — is vacuously true for an empty phase.

MEASURED 2026-08-25, and the framing was corrected once during measurement, which is worth stating: my first probe printed `exit_criteria: null` and I nearly reported that as "the field is unset". It was my own `.get()` default. `lore phase add --help` is the authority: `USAGE phase add [OPTIONS] <PLAN> <NAME>`, options `--description` and `--json`. The stored object for a real phase on a real plan is `{"name": "P5: Verification"}` — keys: `['name']`.

## The measured cost

Handoff ticket 131 asserted "P5 deliberately NOT archived. Its criteria include a green full suite". I consumed that ticket, repeated the claim three times across a session, and blocked on it — declining to close the plan because a criterion I could not check said not to.

There was nothing to check it against. The phase declares no criteria and cannot. When I finally stopped repeating the claim and just ran the real gate, it refused for two entirely different, NAMED reasons (`PRD_OUTLINE_NOT_SYNCED`, `ASSESSMENT_STALE`) — neither of which had anything to do with a full suite. The deterministic gate was informative; the prose criterion was not, and it cost a session's worth of wrong blocking.

⛔ Note what this is NOT: it is not "the agent should have verified the claim". That is true and I did not, but a claim that CANNOT be checked will keep being repeated by the next reader too. `plan-close` gates on real predicates and says exactly which failed; phase completion has no equivalent, so phase prose fills the vacuum and nothing arbitrates it.

## Why "just add exit_criteria" is probably the wrong fix

`adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan` deliberately keeps phases SOFT groupings. This report does not ask to overturn that. Two narrower things follow from the measurement:

1. **The implicit condition is vacuously satisfiable.** "Every child task archived" is true of a phase with zero children. This project's own North Star already names it — *"'Vacuously true' must be distinguishable from 'true' — an empty phase satisfies 'every child task archived'"* — so the property is a stated requirement that nothing currently enforces.
2. **Phase completion has no addressable statement**, so prose about it is load-bearing and unarbitrated. Either give phase completion a machine-checkable form, or make the absence explicit at the surfaces that report phases, so a reader cannot mistake a soft grouping for a gated one.

⛔ Whichever is chosen, the thing that must stop is a handoff being able to assert a phase criterion that no command can confirm or deny.

## Falsifier

⛔ Not "a phase can declare criteria" — a declarable-but-unchecked field reproduces the same vacuum one layer up. Two conjuncts:
(a) a phase with ZERO child tasks must NOT report as complete/satisfied by whatever surface reports phase state — assert the empty and the all-archived cases render DIFFERENTLY;
(b) a claim about a phase's completion must be answerable by a command that can return NO — i.e. there exists an invocation that prints a refusal naming the unmet condition, the way `plan-close` already does.
Smallest mutation that turns it red: make the empty phase and the fully-archived phase print the same thing.

**Expected:** Phase completion is either machine-checkable — a command that can return NO and name the unmet condition, the way plan-close does — or its absence is explicit at every surface that reports phases, so a reader cannot mistake a soft grouping for a gated one. An empty phase must not render the same as a fully-archived one.
**Actual:** lore phase add accepts only NAME and an optional --description; the stored object for a real phase is {"name": "..."} with no field for a completion condition. So a handoff can assert 'this phase's criteria include a green full suite' and no command can confirm or deny it. Measured cost: I consumed exactly such a claim from a resume ticket, repeated it three times, and declined to close a plan on the strength of it. When I finally ran the real gate it refused for two different NAMED reasons (PRD_OUTLINE_NOT_SYNCED, ASSESSMENT_STALE), neither related to a full suite. Separately, the one implicit condition — every child task archived — is vacuously true of a phase with zero children, which this project's own North Star already names as a property nothing enforces.
**Repro command:** `lore phase add --help 2>&1 | grep -A4 OPTIONS`

Reported by: agent:main-orchestrator
