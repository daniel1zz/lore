---
id: decision-records
title: "Decision records on writes"
inject: [launch]
---
## Decision records

An agent's write to an approved target must say why. The milestone review re-checks every recorded premise against git and judges whether the premises hold and whether a better option existed (`adr-an-agent-s-decision-between-milestones-is-a-record-gates`).

- **A write carries a decision when** an agent run makes it, the target is not a draft (an approved or locked spec or ADR, a correction included; a baseline node or rule with an approved version), and it changes more than status. Draft edits, status-only writes and writes as a human party carry none. Without the fields such a write exits 4 naming each missing part, and nothing is written.
- **Commands:** `lore set` (spec, adr, baseline), `lore baseline set-label|depends|glossary|map`, `lore rule set|add`, `lore rule propose` (on a non-draft spec), `lore ac add|set|rm|supersede|cite|exempt` (non-draft spec).
- **Required:** `--reason "<why>"`, at least one `--premise "<claim>|<source>|<tier>"` of tier S, A, B or C, at least one `--alt "<option>|<why rejected>"`. `lore ac supersede` and `lore ac exempt` already have `--reason`; it doubles as the decision's reason.
- **Optional:** `--gate "<id>|<pass|fail>|<evidence>"`, `--score "<option>|<dimension>|<-1|0|1>|<evidence>"` with `--weight-table <slug>@<version>`, `--ref "<practice>|<difference that could invalidate it>"`. The flags `--premise --alt --gate --score --ref` repeat.
- **Source syntax:** `file:<path>:<from>[-<to>][@<sha>]` (lore quotes the lines and pins the commit; refused if the file has uncommitted changes and no `@sha`), `cmd:<command> ~ <expected text>`, `issue:#<n>`, `doc:<slug>[@<version>]`.
- **Tiers:** S official or measured, A, B, C, D, E untrusted. A decision needs one premise of S to C.
- **`lore rule set`:** an examples-only edit, or one that only lowers confidence, needs nothing. Raising confidence is refused: use `lore rule propose`. A statement change needs `--gate "meaning-unchanged|pass|<evidence>"`; if the meaning changes, put it in a spec's rule change set (`lore rule propose <spec> modify BR-n ...`).

```
lore rule set BR-12 --statement "..." --reason "wording only" \
  --premise "old text restated|file:docs/refunds.md:10-14|A" \
  --alt "leave as is|the 31st-day example reads ambiguously" \
  --gate "meaning-unchanged|pass|both texts refuse day 31"
```
