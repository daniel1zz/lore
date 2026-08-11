---
id: KN-338
type: knowledge
role: knowledge
title: "Retro — plan-close's recovery text is not executable: omitted exempt_kind, and a merge instruction that collides with dedicated writers"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PRD-001
---
## Symptom

Closing `plan-fix-dashboard-no-open-inert-nonce-failure-page-f5a-defects` took FOUR
attempts, three of which were caused by the gate's own recovery text being incomplete
rather than by anything wrong with the plan.

## D1 — the plan-close feeding pack omits a field its own predicate requires

The `ATTESTATION_FLOOR_NOT_MET` deny prints a long, otherwise-excellent recovery paragraph:

> the exemption is declared on the PLAN ITSELF, never on a task: set
> `extra.attestation_exempt: true` plus a non-empty `extra.attestation_exempt_reason`

Following it EXACTLY produces a second deny — `ATTESTATION_EXEMPT_KIND_INVALID` — because
`gate-predicates.ts::attestationExemptKindValid` additionally requires
`extra.attestation_exempt_kind` to be a member of `attestationExemptKindSchema`
(`"red-tdd" | "no-oracle" | "pipeline-unreachable" | "other"`, `packages/core/src/schemas.ts:454`).
That field name appears NOWHERE in the recovery text, and neither does its enum.

The predicate is right to demand a typed kind — a bare `attestation_exempt: true` is exactly
the silent-fallback shape this repo bans, and its JSDoc says so. The defect is purely that
the guidance and the predicate disagree: a caller who does precisely what the pack says is
guaranteed to be denied again. Feeding packs exist so a deny is actionable in ONE round trip.

Fix: the `plan-close` pack must name `extra.attestation_exempt_kind`, list the four valid
members, and ideally show the whole merged `extra` object. A regression oracle for this class
is "apply the pack's own instructions verbatim → the gate passes" — an ergonomics contract no
current test asserts.

## D2 — the pack's "merge the existing extra" instruction collides with a dedicated writer

The same paragraph instructs: fetch `.extra`, merge your keys in while KEEPING every existing
key, then call `lore_set` with the FULL object. Doing that verbatim after an earlier
`lore outline exempt` call fails with:

    extra.prd_sync_exempt cannot be changed via `lore set` — use `lore outline exempt` instead

`prd_sync_exempt` has a dedicated writer (the same discipline as `extra.validity`,
`extra.handoff`, `extra.file_anchors`), so echoing it back unchanged inside a wholesale
`extra` replacement is rejected — even though the value is byte-identical to what is stored.
The two instructions ("keep every existing key" and "these keys have dedicated writers") are
individually correct and jointly unsatisfiable whenever both exemptions are in play, which is
the COMMON case: a defect-fix plan typically needs the outline exemption AND the RED-TDD
attestation exemption.

Fix candidates: make `lore set` tolerate a dedicated-writer key whose value is UNCHANGED
(idempotent no-op rather than a rejection), or give `attestation_exempt` its own CLI writer
(`lore attestation exempt <plan> --kind <k> --reason "..."`) so no caller ever has to
hand-merge `extra` at all. The pack already admits the gap: "`lore set` (CLI) has no
dedicated flag for this field yet."

## Why this matters beyond ergonomics

Both defects push the operator toward `LORE_GATE_BYPASS=1`. A gate whose stated remedy does
not work is training its users to bypass it — the failure mode most corrosive to a
deterministic-gate design. Neither was caught by tests because the pack text and the
predicate are asserted separately; nothing asserts they agree.

## Status

Recorded, not fixed — out of scope for the plan that surfaced them. Both are small, well
localized (`checkpoint-registry.ts` pack text + `gate-predicates.ts`), and testable.
