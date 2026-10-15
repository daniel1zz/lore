---
id: KN-261
type: knowledge
role: knowledge
title: "Recovering attestation on an already-archived plan: the --task + explicit --ac escape is the sanctioned path, a plan-wide verify run is the catalogued false pass"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-10
tags: []
parent: PRD-001
---
Applied 2026-08-01 to four plans archived at attested_evidence_ratio 0.00 (declared-scope-attestation-contract, report-issue-concurrency-contract, proposed-to-accepted-decision-status-writer, declared-timeout-budgets-for-spawn-heavy). Result: 30 runner-attested entries recovered across 9 of 10 evidence-bearing tasks.

## The mechanism that makes recovery possible

`verify-runner-service.ts::_selectDeclaredScopeCriteria` is three-valued over the TASK`s
`extra.ac_scope` (its own doc comment carries the table):

  | declared ac_scope | --ac absent                      | --ac present                        |
  | ABSENT            | REFUSE, naming `lore scope add`  | run exactly the named ids (D2)      |
  | EMPTY []          | REFUSE                           | REFUSE (un-declaration claims nothing)|
  | POPULATED         | run scope INTERSECT criteria     | REFUSE if any id outside scope      |

Legacy tasks predate `ac_scope`, so they are the ABSENT row. An explicit `--ac` is therefore
the DESIGNED escape (D2), not a workaround:

    lore verify <plan> --task <task-slug> --ac <AC-ID> [--ac ...] --yes

Works on archived plans and archived tasks; no claim needed.

## Do NOT use a plan-wide run instead

`lore gate plan-close --explain` records, under attestation-floor known_false_pass, exactly
this shape: "a plan-wide run attests every claimed acceptance criterion regardless of which
task`s own declared scope it belongs to -- measured across 8 tasks x 16 attested entries
produced by 8 unrestricted `lore verify` runs ... the per-claimed-AC coverage conjunct passes
while the invariant that EACH task`s declared scope was actually exercised remains unproven."
A bare `lore verify <plan> --yes` recovers the RATIO while destroying the very invariant the
recovery exists to restore. It also simply refuses here (ABSENT + no --ac).

## Where the --ac values come from (do not invent them)

Read them off the task`s OWN existing evidence rows, which already carry `ac_ref`:

    lore get <task> --json | jq -r "[.data.doc.extra.verification_evidence[] | .ac_ref // empty] | unique"

NOTE the path: `.data.doc.extra...`. `.data.extra` and `.doc.extra` both yield null, and jq
returns EMPTY rather than erroring -- which reads as "this task has no evidence" and will send
you down a completely wrong plan. Cross-check any absence with /usr/bin/grep before believing it.

Inventing `--ac` ids from task titles would fabricate a scope the task never claimed --
the same defect as retro-declaring `ac_scope`, wearing a different hat.

## When a task genuinely cannot be recovered

One task (T1 of report-issue-concurrency) carried 6 rows all `oracle=manual` pointing at
one-shot probe scripts under /tmp that no longer exist, and zero `ac_ref`. There is no
re-executable oracle. Correct action is a TYPED, audited exemption, never a synthesised
AC association:

    lore plan exempt-attestation <plan> --kind no-oracle --reason "<which task, why unrecoverable, what WAS recovered>"

An exemption stays auditable forever; a doc authored to satisfy a predicate is afterwards
indistinguishable from a real one.

## Recording a genuine failure is part of recovery, not a defect to avoid

AC-TB-1`s script (`bun run check:test-budgets`) genuinely exited 2 at recovery time. It was
recorded as an attested FAIL rather than skipped -- which then served as the attested RED
baseline for the fix that followed, and after that fix the same command re-run produced an
attested PASS. One AC, red then green, same runner, same command, both in the permanent record.
