---
id: TASK-695
type: task
role: plan
title: "lore done --override-attestation demands fresh prose that restates evidence rows already on the task — let it CITE a recorded row instead, with refusals that keep the cheaper path from being the weaker one"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
`lore done --override-attestation "<reason>"` demands free prose every time. For adhoc tasks —
which have no plan, so `lore verify` structurally cannot attest them — it is not an exception but
the ONLY archival path. Measured 2026-08-12: three adhoc tasks archived in one session, three
hand-written justifications, each restating measurements ALREADY recorded as `lore evidence` rows on
the same task.

That is worse than verbose. Prose typed at archive time is a fresh self-report; an evidence row is a
timestamped record carrying the actual command, result, and runner output tail. **Forcing the prose
form makes the audit trail weaker, not stronger**, and the cost pressure pushes toward rubber-stamp
reasons — the exact dilution `knowledge-handoff-agent-main-orchestrator-71` NS1 warned about.

## Required

Add a way to satisfy the override by CITING an existing `extra.verification_evidence` row instead of
retyping it. `verification_evidence` is append-only (max 50) and rows carry no id field, so a
1-based index is a stable reference; `recorded_at` is the alternative. Pick one and justify.

⛔ Cheaper must not mean weaker. The citation MUST be refused when the cited row cannot bear the
weight:
- `result` is not `pass`
- `output_tail` is empty — the standing rule is that an empty tail does not count as AC coverage
- the index is out of range

Each refusal names the reason and the offending row. ⛔ A silently accepted bad citation is worse
than the prose it replaces.

⛔ The archived record MUST stay self-contained: snapshot the cited row's identifying fields
(`oracle` / `command` / `result` / `recorded_at` / `recorded_by` / `capture_source`) into the
override record, not just the index. A bare pointer forces every future auditor to go re-read the
task, and `lore get` on an archived doc is not where people look.

⛔ Keep the free-text form working — some overrides genuinely have no matching row (a manual
inspection, a structural argument). This ADDS a path, it does not replace one.

⛔ Do NOT let citation launder a `capture_source: "self-report"` row into something that reads as
attested. Whatever is stored must preserve the distinction verbatim: `lore evidence --capture` is
already known to produce a `runner`-labelled row with NO attestation block, and only `lore verify`
produces real attestation. If the cited row is self-reported, the override record must say so.

## Oracle

- HAPPY: citing a valid `pass` row with a non-empty tail archives the task, and the archived doc
  carries the snapshotted fields.
- NEGATIVE ×3: citing a `fail` row / an empty-tail row / an out-of-range index each refuses, names
  the reason, and archives NOTHING.
- REGRESSION: the existing free-text `--override-attestation "<reason>"` behaves exactly as today.
- REGRESSION: `lore done` without any override still refuses a self-reported-only task.
- BOUNDARY: index 0 and index 1 (off-by-one), and a task with zero evidence rows.
- CONTROL: revert the new path and confirm the HAPPY case fails again.
- Exit codes measured as TWO SEPARATE statements (`cmd > out 2>&1` then `echo $?`).
- ⛔ Never write to this repo's own `.lore/`; use `mkdtemp` + `lore init`.

## Provenance

Requested by the user 2026-08-12 after a process review found the override to be routine rather than
exceptional for adhoc tasks.
