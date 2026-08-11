---
id: KN-244
type: knowledge
role: knowledge
title: "Three of four remaining assess gaps were bundle-visibility artifacts, not defects: the diff was never passed, the ledger was never shown, the counter was monotonic by construction"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: KN-246, type: relates-to}
---
## Purpose

`knowledge-assessment-implementation-lore-ac-set-the-dangling-ac` (met, 80/100) left five
typed gaps. One — the missing RED-first evidence row — was already carried into
`task-red-first-discipline-is-asked-for-in-prose-but-never`. This document dispositions the
remaining four **by measurement**, taken 2026-08-01 in the session that consumed
`knowledge-handoff-agent-main-orchestrator-57` (NS5). Three of the four turn out to be
misdiagnosed in a way that matters: the artifact the auditor wanted already existed, or the
recommended remedy is not executable in the form recommended.

## G1 — `diff_available=false` / `tests_touched=false` (major, evidence_integrity)

**Assess statement**: nothing in the bundle lets an auditor confirm that `ac-service.ts` routes
demotion through `CorpusService` (D2), that argv faults are raised pre-service (D5a), or that
the sibling-identity test compares bytes.

**Measured disposition — caller omission, not a missing capability.** `lore assess --help`
exit 0 shows both `--diff <range>` and `--diff-file <path>`. The assess run simply passed
neither, so the judge scored a bundle it had no source for.

**But the standing remedy is insufficient, and this is the finding worth keeping.** CLAUDE.md's
lesson says: derive the range from the plan's own first task commit. Applied here that gives
`ad8ac92^..f9794e5`. Measured contents of that range:

- 13 non-merge commits
- **6 of them belong to OTHER plans** — AC-RCH resume-coverage (`0019494`, `86c34a7`), the
  task-create ac_scope gate (`dc1b6e5`, `e4cc579`, `acad8e0`), the adhoc ac_ref resolver
  (`1fffbf0`), plus a dashboard adjudication fix (`03f63c3`)

≈46% foreign content. The plan's own commits (`ad8ac92`, `90fdc7e`, `dc2135b`, `24eae58`,
`da42c33`, `f9794e5`) are **non-contiguous in main** because concurrent sessions merged
between them. So a range — ANY range — cannot isolate this plan, and the CLAUDE.md rule as
written produces exactly the false-scope-drift diff it exists to prevent. Under concurrent
multi-plan sessions only a `--diff-file` assembled from the plan's own commits is precise.

**Not re-run.** The specific D2 routing concern is being closed structurally rather than
re-audited: `task-the-approved-to-draft-demotion-rule-is-mirrored-in-ac` removes the mirrored
rule entirely, which makes "does ac-service route through CorpusService" a question that no
longer has a wrong answer. Re-judging the old bundle would grade a shape that is being deleted.

Mechanism gap filed: `lore assess` should derive the plan's own commit set itself instead of
asking the caller for a range that cannot be correct.

## G2 — AC-ACS-4 and AC-ACS-1 are compound (minor, outcome + spec recommendation)

**Assess statement**: AC-ACS-4 has two halves (approved→draft, and draft-stays-draft with
`lore log` recording no status transition); only the first is named by an evidenced oracle.
Recommendation: split into one oracle per assertion.

**Disposition: executable, but NOT as a bare corpus edit — deferred to a task, deliberately.**

The naive read is that splitting is unsafe because it strands the evidence rows pointing at the
old id — the rm+add cycle that produced the three dangling `ac_ref` KD1 measured. That read is
wrong: the split is `lore ac set` on the original (narrow the statement **in place**, id
preserved, no dangling window — this is precisely what that command shipped for) plus
`lore ac add` for the second half under a NEW id. No existing ref is stranded.

The real reason not to do it here: the new id would be born with zero evidence, on a spec whose
plan is already closed and assessed. A criterion that is declared-and-unverified is a worse
corpus state than a compound criterion that is honestly reported as compound — it manufactures a
permanent unmet AC nobody is scheduled to run. The split is only complete when the second
half's oracle runs in the same slice. Hence a task, not an edit.

Note the governance side effect the task must expect: editing a declared criterion demotes the
approved spec to `draft` (D2), so the slice ends with a re-review and a g2 re-promotion. That is
the designed path, not an obstacle.

## G3 — T3's exemption citations "absent" (minor, outcome)

**Assess statement**: the plan required citing the spec version where each id disappeared; that
citation is absent from every T3 evidence row and output tail.

**Measured disposition: the citation EXISTS and is fully auditable — the auditor could not
reach it.** `scripts/ac-ref-exemption-ledger.json` carries, per exempted id, exactly what the
plan demanded:

- AC-CP-3 — diagnosed via `lore diff --from 43 --to 44` / `--from 44 --to 45`; removed at v44
  (2026-07-30T03:47:39.797Z), replaced 0.56s later at v45 by AC-CP-10 on the identical oracle
  test name (`framing line`)
- AC-CP-5 — `--from 39 --to 40` / `--from 40 --to 41`; removed v40, replaced 0.56s later at v41
  by AC-CP-9 (`governance rule`)
- AC-CP-7 — `--from 47 --to 48` / `--from 48 --to 49`; removed v48, replaced 0.43s later at v49
  by AC-CP-11 (`manifest parity`)

Each row states the merged-vs-lost judgement, names the superseding id, and explains why
re-declaring the old id would duplicate it (D7's never-synthesize-a-criterion rule). The
assess report's own Unverifiable Materials section is precise about what went wrong:
"Referenced only by count in output tails; contents and per-id spec-version citations not in the
bundle."

**So this is an assess-INPUT visibility gap, not a missing diagnosis.** The detector prints a
count (`3 pre-existing exemption(s) via scripts/…`) and the count is what reached the judge. The
assess recommendation — echo the reason in the detector's exemption output line — is the correct
mechanism and is filed as a task. A durable justification that no auditor's default view reaches
is only half an audit trail.

## G4 — scanned-row drift 2191 / 2212 / 2214 / 2215 never reconciled (minor, evidence_integrity)

**Reconciled exactly. There was never an anomaly.**

Re-measured 2026-08-01: `bun run scripts/check-ac-ref-integrity.ts` exit 0 →
`scanned 526 task(s), 2216 evidence row(s) carrying an ac_ref`. An independent count over
`lore list --type task --json`, summing evidence entries that carry an `ac_ref`, returns
**2216** — two independent code paths agree, so the number is not a truncation artifact.

Every observed value is explained by row accumulation, and the rows are timestamped, which is
why the drift was reconcilable all along — nobody looked at the timestamps:

- 2164 (baseline probe) < 2191 < 2212 < 2214 < 2215 < 2216 — strictly increasing, no decrease
  ever observed
- 83 `ac_ref`-carrying rows were written on 2026-08-01 alone
- the newest row in the corpus is stamped `2026-08-01T04:33:15.445Z`, i.e. BEFORE the handoff at
  04:41:45; **zero rows have been added since**, so the value reproduces exactly today
- therefore the handoff's 2215 was a reading taken before the final 04:33:15 row landed; the
  true end-of-session value was 2216

**The structural point outlives the arithmetic**: this counter is a corpus-global running total
that increments whenever ANY session records evidence ANYWHERE in the corpus. Two runs separated
by any evidence write differ BY CONSTRUCTION. It therefore cannot function as a run-to-run
reproducibility check, and asking for a per-run "reconciliation" of its movement is asking for
something unobtainable in principle. Its only sound assertion is a floor — `>= previous
observation` — which is exactly what T2's own digest warning said ("a lower count should trigger
truncation suspicion"). The assess gap flagged normal, correct behaviour as unexplained drift.

## Standing lesson

An auditor's verdict is bounded by the bundle it is handed, not by what exists in the repo. Three
of these four gaps were artifacts of that bound: a diff the caller never passed, a ledger the
judge never saw, and a monotonic counter mistaken for an unstable measurement. Before treating an
assess gap as a defect, check whether the artifact exists somewhere the judge could not reach —
and if it does, the mechanism fix is to route it INTO the bundle, never to author it a second
time.
