---
id: PLAN-079
type: plan
role: plan
title: "Land oracle executability: the discovery-refusal primitive, both call sites, and the audited escape for not-yet-written tests"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-13
tags: []
parent: SPEC-130
phases:
  - {name: "mechanism", description: "findDiscoveryRefusal + the attested call site + the promoted existence primitives with their declaration-time consumer and audited escape"}
  - {name: "corpus-cleanup", description: "Correct the three mistyped commands, re-attest all four reds, and re-capture the refusal phrases from the live runners"}
  - {name: "backlog-and-arm", description: "Clear the 29 pass_unfalsified criteria, compute the discovery population as content-union-subprocess, then arm the gate"}
---
# Goal

Land M6.1-M6.4 of the governing spec as ONE coherent slice, one phase per scope band:

| Phase | Spec scope | Deliverable |
|---|---|---|
| `mechanism` | M6.1-M6.3 | the `findDiscoveryRefusal` primitive in `@lore/core`, the attested call site that consumes it, and the promoted file-existence primitives with their declaration-time consumer plus the audited `--allow-missing-path` escape (spec §D8) |
| `corpus-cleanup` | M6.4 first half | correct the three mistyped commands, re-attest all four reds, re-capture the refusal phrases from the live runners |
| `backlog-and-arm` | M6.4 second half | clear the 29 `pass_unfalsified` criteria, compute the discovery population as content-union-subprocess, then arm the gate |

⛔ CORRECTION 2026-08-13: an earlier Goal scoped this plan to "M6.1-M6.3" while its own phase list already carried `corpus-cleanup` and `backlog-and-arm`, which ARE M6.4 — so the plan understated itself and the phase-order constraint below appeared to order against a sibling plan that does not exist. The scope band each phase owns is now stated per phase. No phase was added or removed by this correction.

⛔ Phase order is a HARD constraint, not a preference: `lore ac set` demotes its spec to `draft` and freezes every descendant claim, so `corpus-cleanup` (which edits SPEC-061/062/064 ACs) MUST NOT start until `mechanism` is merged.

⛔ The obvious one-line fix is a measured NO-OP — see the spec's §M6.1. Any task here that reports success without the discovery-refusal patterns in place has measured nothing.
