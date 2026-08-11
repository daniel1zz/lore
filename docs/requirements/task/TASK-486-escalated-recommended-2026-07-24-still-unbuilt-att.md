---
id: TASK-486
type: task
role: plan
title: "ESCALATED (recommended 2026-07-24, still unbuilt): attestation_exempt is a gate-read field with no writer verb"
status: archived
priority: high
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Task

`extra.attestation_exempt` is a gate-read field with **no writer verb**. The
attestation floor consults it; nothing in the CLI can author it.

## Why this is an ESCALATED finding, not a new one

`knowledge-spec-072-autopilot-execution-retro-reverse-import` finding 3
(**2026-07-24**) already recommended exactly this mechanization —
`lore plan exempt-attestation <plan> --reason …`. Verified still absent on
2026-07-31:

```
grep -r attestation_exempt packages/lore/src/adapters/cli   →  0 hits
```

while its structural sibling `prd_sync_exempt` **does** have a writer
(`lore outline exempt`). Two identical gate-read fields, one authorable, one not.

Per the project's own rule, a twice-recommended un-built mechanism is itself a
governance failure — the corpus flagged the class and nothing mechanized it. This
is the last recommendation for the class; the next step is the verb, not a third
retro.

## The consequence that has now actually occurred

On 2026-07-31 four plans were archived with `attested_evidence_ratio 0.00` by riding
a vacuous predicate. The auditable alternative — declaring an attestation exemption
with a reason — **did not exist as a command**. When the only opt-out is unavailable,
the undocumented path becomes the path of least resistance. The missing writer is
what made that hole load-bearing rather than merely present.

This is also the CLAUDE.md-recorded pattern in its exact shape: *"a gate demanding a
field no surface can author fails SILENT"* — and the paired rule that every gate-read
field needs an author→trip end-to-end oracle.

## Mechanism required

1. A dedicated writer, shaped like `lore outline exempt`:
   `lore plan exempt-attestation <plan> --reason "<why>"` — read-merge-write onto
   `extra.attestation_exempt`, never via `lore set` (which replaces `extra`
   wholesale).
2. The exemption is **typed and audited**: actor, timestamp, reason, and the AC/task
   set it covers. An exemption with no reason is refused.
3. The floor's output NAMES an active exemption whenever it is what allowed the
   close — an invisible exemption is the same failure as a vacuous predicate.
4. Audit the same question for **every** other gate-read `extra.*` field: does a
   writer exist? This task's finding is one instance of a class that has now
   produced a real incident.

## Oracle

- `lore plan exempt-attestation` authors the field and `lore get --json` reports it.
- A plan that would otherwise be denied by the attestation floor closes WITH the
  exemption, and the close output names the exemption and its reason.
- The same plan WITHOUT the exemption is still denied (the control — proves the
  exemption is what changed the verdict, not something else).
- `lore set --attestation-exempt` does not exist (exit 2, unknown flag), matching
  the dedicated-writer discipline.
- An exemption with an empty/missing reason is refused.
