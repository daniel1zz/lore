---
id: PLAN-132
type: plan
role: plan
title: "Land M7: an adopted state that frees defect-channel quota without retiring the claim, with abandonment counted"
status: deprecated
priority: high
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: SPEC-139
phases:
  - {name: "m7", description: "The adopted state, its required owner pointer, the abandonment count with its enumerator, and the compiled-CLI wiring half."}
---
# Goal

Land M7: give the defect channel a NON-TERMINAL, quota-freeing exit that requires an owner, so
an accepted-but-unfinished defect stops occupying quota forever.

# Why now

Measured 2026-08-21: `lore issues --all` shows 32 reports, of which the 10 filed by this
project are all `open`, all `draft`, all filed 2026-08-12/13. The cap is full and refuses every
new report from this project. M1–M6 shipped and work — the cap now counts computed resolution,
`resolveOpenReportCap` reads the upstream's own config, and `superseded`/`duplicate` are live
non-derogatory terminal states. The channel is still stuck, because every exit M1–M6 provides
asserts something about the CLAIM, and the true state of all ten is "real, accepted, not yet
done".

⛔ The closure escape was TESTED rather than assumed: two of the ten were re-probed on
2026-08-20 after `AC-BFI-8` landed a mirror content check, in case they had become honestly
closable. A two-line body drift was injected into a mirror file and `bun run mirror:export`
was run with no `--force`; the drift SURVIVED. Both reports are still valid. Closing one to
free a slot would mark an unresolved defect resolved and would afterwards be
indistinguishable from a real fix.

# The cost already being paid

Because the channel refuses input, four governance gaps measured 2026-08-18/19 were written
into `knowledge-four-governance-gaps-measured-while-resuming-handoff` instead — a document
**no `--check` reads**. The standing "report a tool gap immediately" discipline has degraded
from enforced to advisory and nothing announced the change. That is the same shape as an armed
gate that vacuously passes: the mechanism looks present and is not.

# Acceptance Criteria

On `spec-the-defect-channel-cannot-be-honestly-maintained-an` §M7:

- `AC-DC-14` — adopting frees quota AND the adopted report stays listed as unfinished
- `AC-DC-15` — the owner pointer is required, must resolve to a live plan/task, and a refusal
  writes nothing (exit exactly 4, target `extra` byte-identical)
- `AC-DC-16` — abandonment is COUNTED and the count names its members, with three red seeds
  isolating each conjunct
- `AC-DC-17` — production wiring at the compiled CLI, with binary freshness asserted (exit
  exactly 0 from `--check-binary-provenance`) and a stale binary FAILING rather than skipping

⛔ `AC-DC-16` is the load-bearing one. Adopting is cheap; the only thing that stops `adopted`
from becoming a quieter `rejected` is that abandonment is visible and attributable.

# Sequencing note

One task, on purpose. The four criteria share `TERMINAL_ISSUE_RESOLUTIONS`' consumers and the
single quota-occupancy seam; splitting them would put two agents on the same vocabulary module.
The implementer's `lore ac set` step is therefore safe here — there is no sibling claim to
freeze — but the orchestrator still restores the spec to `approved` after the merge.
