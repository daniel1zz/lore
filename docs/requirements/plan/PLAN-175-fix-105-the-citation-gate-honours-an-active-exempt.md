---
id: PLAN-175
type: plan
role: plan
title: "Fix #105: the citation gate honours an active exemption on an uncited criterion"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: SPEC-157
phases:
  - {name: "fix", description: "RED then implement"}
---
# Fix #105: the citation gate honours an active exemption on an uncited criterion

governance_mode: unattended (owner delegation "后面全自动"; handoff knowledge-handoff-agent-main-orchestrator-140 NS1)

## Goal
Under ac-cite enforce, a criterion holding an unexpired exemption may be left uncited, so the 8 citations judged unfaithful in the AC-BLS2-14 sample (AC-069-5, AC-RR-4, AC-ADV-1, AC-076-8, AC-053-7, AC-061-11, AC-068-1, AC-OX-2) can be removed without switching the gate to report (which would be a bypass). Spec basis: SPEC-157 D3/D4 already state the bar as "cited or exempt"; the gate ignoring exemptions contradicts its own spec. Rules: BR-959 (new), BR-257 (narrowed).

## Acceptance
AC-BLS2-19 (script, bun test tests/unit/service/cite-gate-exemption.bun.test.ts).

## Invariants
- An exemption only waives "uncited". A cite of a missing/deprecated/retired rule is refused regardless (spec C4).
- Expiry is measured with the same rule as AcExemptionService.counts: active iff expires_at > now.
- Exemption scope is (spec doc_id, ac_id): an exemption on another criterion or another spec admits nothing.
- decideCiteGate stays pure; the chokepoint loads exemptions and passes them in. No silent fallback: a failed exemption read is an error, not "no exemptions".
- Report-mode findings for an exempted uncited criterion are not recorded as would-refuse (it would be admitted under enforce).
- AC-BLS2-2 / AC-BLS2-3 / AC-BLS2-10 / AC-BLS2-11 stay green.

## Tasks
1. RED (tester, worktree): write the AC-BLS2-19 test; it must fail on main for the exempted-removal case and pass for the refusal cases. Record expected-fail evidence at the moment it is red.
2. Implement (implementer, worktree): make it green.
3. Orchestrator after merge: lore verify; remove the 8 cites under enforce; re-run AC-BLS2-14 with a new seed.

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| Exemptions become a blanket escape from citation | M | Cap stays 10% (AC-BLS2-10); exemptions need reason + expiry; retired/missing cites still refused |
| Exemption expires between check and write | L | Accepted: an exemption valid at check time admits; recorded here |
| Concurrent exemption grant and AC write | L | The write itself remains CAS on spec version (BR-243) |
