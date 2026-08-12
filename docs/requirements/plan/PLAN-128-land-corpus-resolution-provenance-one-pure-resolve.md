---
id: PLAN-128
type: plan
role: plan
title: "Land corpus-resolution provenance: one pure resolver, one boundary detector, and a foreign-write guard keyed on declared intent"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: SPEC-141
phases:
  - {name: "resolver"}
  - {name: "guard"}
---
Implements spec-corpus-resolution-carries-provenance-and-a-foreign-write (AC-CP-1..5). Two phases: resolver lands the pure decision, the collapse, the relocation out of utils.ts and its false header; guard lands the config sub-predicate, the lease-derived intent check, and the adapter matrix including the tested HTTP exemption. Ordering is a real dependency, not preference: the guard has nothing to key on until provenance exists.
