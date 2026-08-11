---
id: PLAN-079
type: plan
role: plan
title: "Land oracle executability: the discovery-refusal primitive, both call sites, and the audited escape for not-yet-written tests"
status: draft
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: SPEC-130
phases:
  - {name: "mechanism", description: "findDiscoveryRefusal + the attested call site + the promoted existence primitives with their declaration-time consumer and audited escape"}
  - {name: "corpus-cleanup", description: "Correct the three mistyped commands, re-attest all four reds, and re-capture the refusal phrases from the live runners"}
  - {name: "backlog-and-arm", description: "Clear the 29 pass_unfalsified criteria, compute the discovery population as content-union-subprocess, then arm the gate"}
---
# Goal

Land M6.1-M6.3 of the governing spec as ONE coherent slice: the `findDiscoveryRefusal` primitive in `@lore/core`, the attested call site that consumes it, and the promoted file-existence primitives with their new declaration-time consumer plus the audited `--allow-missing-path` escape (D8).

⛔ Phase order is a HARD constraint, not a preference: `lore ac set` demotes its spec to `draft` and freezes every descendant claim, so the corpus-cleanup phase (which edits SPEC-061/062/064 ACs) MUST NOT start until the mechanism phase is merged.

⛔ The obvious one-line fix is a measured NO-OP — see the spec's §M6.1. Any task here that reports success without the discovery-refusal patterns in place has measured nothing.
