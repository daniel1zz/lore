---
id: TASK-440
type: task
role: plan
title: "check-ac-ref-integrity prints an exemption COUNT, not its justification — echo each applied exemption's version citation and merged/lost verdict"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

`scripts/check-ac-ref-integrity.ts` prints only a COUNT of exemptions:

```
check-ac-ref-integrity: OK — 0 dangling ac_ref(s); 3 pre-existing exemption(s) via scripts/ac-ref-exemption-ledger.json.
```

The ledger itself is exemplary — measured 2026-08-01, every row carries the per-id spec-version
diagnosis the plan demanded (`lore diff --from 43 --to 44`, the removal version and timestamp, the
superseding AC id, the merged-vs-lost judgement, and why re-declaring the old id would violate
D7's never-synthesize-a-criterion rule). None of that reaches any default view.

The consequence was measured, not hypothesised: `lore assess` scored AC-ACS-7 down for a missing
citation that existed the whole time. Its own Unverifiable Materials section says exactly why —
"Referenced only by count in output tails; contents and per-id spec-version citations not in the
bundle." The auditor's verdict was bounded by the bundle, and the count is what the bundle carried.

## Mechanism root

An exemption is an audited escape hatch: it converts a detector failure into a deliberate,
justified pass. Its justification is therefore load-bearing output, not archival metadata. A
detector that reports "3 exemptions" and nothing else is asking every future auditor to go find
the reasons, which is precisely what an audit trail is supposed to remove.

Same shape as the assess recommendation:

> Record the T3 diagnosis — per-id spec version of disappearance and the merged/lost judgement —
> in the ledger row reason field and echo it in the detector's exemption output line. An exemption
> is auditable only if the reason survives; the current output names a count, not a justification.

The ledger half is already done. Only the echo is missing.

## Requirement

Each applied exemption prints its `(spec, id)` and its reason on the detector's own output, in a
form an auditor reads without opening the ledger. Reasons are long (the three current ones are
paragraphs) so a truncated-with-pointer form is acceptable — but the version citation and the
merged-vs-lost verdict must survive truncation, since those are the two facts the plan required.

## Oracle

- With ≥1 exemption applied, the detector's stdout names each exempted `(spec, id)` and carries
  its version citation. Assert on the citation substring, not on the row count.
- CONTROL, so the assertion cannot pass vacuously: a run with an EMPTY ledger prints no exemption
  lines at all, and a run with a STALE row still exits 5 naming that row (existing behaviour —
  assert unchanged).
- BOUNDARY: a reason long enough to require truncation still emits the version citation and the
  merged/lost verdict. A test whose fixture reason is short enough to escape truncation does not
  measure this.
