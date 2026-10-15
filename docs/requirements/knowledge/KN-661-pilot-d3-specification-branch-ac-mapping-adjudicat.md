---
id: KN-661
type: knowledge
role: knowledge
title: "Pilot D3: specification-branch AC mapping, adjudication and citations"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: [baseline, pilot]
parent: PLAN-172
links:
  - {id: PLAN-172, type: informs}
---
# Pilot D3: specification-branch AC mapping, adjudication and citations

Pre-registered metric: see task task-skill-implement-map-adjudicate-and-cite-the-specification body (v3). Population 85 ACs of the 10 A5 specs.

## Result

- Mapper agreement: 43/85; disagreements 42/85 = **49.4%** — kill line (> 30%) **FIRED**. Post-hoc lenient reading (OUT-OF-BRANCH == NO-RULE, not a verdict): 28/85 = 32.9%, still above the bar.
- Where both mappers chose a rule: same rule 1/5.
- Disagreement composition: OUT-OF-BRANCH vs NO-RULE 14; BR vs OUT-OF-BRANCH 24; BR vs BR 4.
- Adjudication causes (42): branch-boundary ambiguity 14; missing rule 14 (mostly task/execution-branch behaviour); mapper misread 13; rule granularity 1.
- Mapper styles: P mapped by topic (revision AC -> revision rule even when it tests the CLI layer); Q separated rule from implementation. Missing: a written placement principle.
- Final: in-branch 15, out-of-branch 56, no-rule 14. 15 citations written with `lore ac cite` (all on live specs; 0 failures). `lore status` after: acs_citing 15, cites_dangling 0, cites_to_inactive 0, ambiguous_ac_ref 0, registry_mismatch 0, rules_total 95, rules_uncovered 83.

## Final assignments

```tsv
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-1	OUT-OF-BRANCH	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-2	BR-30	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-6	BR-35	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-7	OUT-OF-BRANCH	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-3	BR-29	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-4	BR-38	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-5	BR-32	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-8	OUT-OF-BRANCH	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-9	BR-39	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-10	BR-31	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-11	BR-35	approved
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-12	OUT-OF-BRANCH	approved
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-1	OUT-OF-BRANCH	draft
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-2	OUT-OF-BRANCH	draft
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-3	OUT-OF-BRANCH	draft
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-4	OUT-OF-BRANCH	draft
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-5	OUT-OF-BRANCH	draft
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-6	OUT-OF-BRANCH	draft
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-7	OUT-OF-BRANCH	draft
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-1	OUT-OF-BRANCH	approved
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-2	OUT-OF-BRANCH	approved
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-3	OUT-OF-BRANCH	approved
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-5	OUT-OF-BRANCH	approved
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-6	OUT-OF-BRANCH	approved
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-4	OUT-OF-BRANCH	approved
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-1	OUT-OF-BRANCH	approved
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-2	OUT-OF-BRANCH	approved
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-3	OUT-OF-BRANCH	approved
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-4	OUT-OF-BRANCH	approved
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-5	OUT-OF-BRANCH	approved
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-6	OUT-OF-BRANCH	approved
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-7	OUT-OF-BRANCH	approved
spec-spec-055-requirement-ac-completeness-oracle	AC-055-1	OUT-OF-BRANCH	approved
spec-spec-055-requirement-ac-completeness-oracle	AC-055-2	OUT-OF-BRANCH	approved
spec-spec-055-requirement-ac-completeness-oracle	AC-055-3	OUT-OF-BRANCH	approved
spec-spec-055-requirement-ac-completeness-oracle	AC-055-4	OUT-OF-BRANCH	approved
spec-spec-055-requirement-ac-completeness-oracle	AC-055-5	OUT-OF-BRANCH	approved
spec-spec-055-requirement-ac-completeness-oracle	AC-055-6	OUT-OF-BRANCH	approved
spec-spec-055-requirement-ac-completeness-oracle	AC-055-7	OUT-OF-BRANCH	approved
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-1	OUT-OF-BRANCH	approved
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-2	OUT-OF-BRANCH	approved
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-3	OUT-OF-BRANCH	approved
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-4	OUT-OF-BRANCH	approved
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-5	OUT-OF-BRANCH	approved
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-6	OUT-OF-BRANCH	approved
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-7	OUT-OF-BRANCH	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-1	BR-16	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-2	BR-15	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-3	BR-15	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-4	NO-RULE	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-5	OUT-OF-BRANCH	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-6	OUT-OF-BRANCH	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-7	OUT-OF-BRANCH	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-8	OUT-OF-BRANCH	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-9	BR-25	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-10	OUT-OF-BRANCH	approved
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-11	OUT-OF-BRANCH	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-1	NO-RULE	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-2	BR-56	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-3	OUT-OF-BRANCH	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-4	NO-RULE	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-5	NO-RULE	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-6	OUT-OF-BRANCH	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-7	OUT-OF-BRANCH	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-8	NO-RULE	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-9	NO-RULE	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-10	OUT-OF-BRANCH	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-11	BR-51	approved
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-12	BR-51	approved
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-1	OUT-OF-BRANCH	approved
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-2	OUT-OF-BRANCH	approved
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-3	OUT-OF-BRANCH	approved
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-4	OUT-OF-BRANCH	approved
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-5	OUT-OF-BRANCH	approved
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-6	OUT-OF-BRANCH	approved
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-7	OUT-OF-BRANCH	approved
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-8	OUT-OF-BRANCH	approved
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-1	NO-RULE	draft
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-2	NO-RULE	draft
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-3	NO-RULE	draft
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-4	NO-RULE	draft
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-5	NO-RULE	draft
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-7	NO-RULE	draft
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-6	NO-RULE	draft
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-8	NO-RULE	draft
```

## Adjudication

```tsv
spec_slug	ac_id	final	branch_or_gap	cause	reason
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-1	OUT-OF-BRANCH	CLI	(a)	Tests CLI happy path (exit 0); no specific BR governs success code
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-2	BR-30	specification	(e)	Tests that non-existent AC id is refused; verifies BR-30 (undeclared AC refused)
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-6	BR-35	specification	(e)	Tests that other criteria unchanged; directly verifies BR-35
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-7	OUT-OF-BRANCH	Integrity	(a)	Tests corpus-wide dangling reference detection; crosses multiple specs
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-3	BR-29	specification	(e)	Tests that revision with no fields refused; directly verifies BR-29
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-4	BR-38	specification	(e)	Tests approved spec returns to draft on revision; directly verifies BR-38
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-5	BR-32	specification	(e)	Tests mode mismatch refusal; directly verifies BR-32
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-8	OUT-OF-BRANCH	CLI	(a)	Tests lore ac list output; CLI round-trip behavior not in SPEC rules
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-9	BR-39	specification	(e)	Tests draft spec stays draft on revision; directly verifies BR-39
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-10	BR-31	specification	(e)	Tests AC id immutable; directly verifies BR-31
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-11	BR-35	specification	(b)	Tests criterion count unchanged; verifies BR-35 (other criteria unchanged)
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-12	OUT-OF-BRANCH	CLI	(a)	Tests lore log behavior; not governed by SPEC rule about version history
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-2	BR-15	specification	(e)	Tests invalid AC rejected by create/set; verifies BR-15 (AC declared on spec)
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-3	BR-15	specification	(e)	Tests undeclared AC id refuses evidence recording; verifies BR-15
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-4	NO-RULE	Assess	(c)	AC about assess prompt composition for AI; not in SPEC specification rules
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-7	OUT-OF-BRANCH	CLI	(a)	Tests lore ac add/list/rm roundtrip; CLI implementation detail
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-9	BR-25	specification	(e)	Tests declaring AC does not change spec status; directly verifies BR-25
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-1	NO-RULE	Checkpoint	(c)	Checkpoint registry reachability not specified in baseline rules
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-2	BR-56	specification	(e)	Tests falsifier records attested red; relates to BR-56 (falsifier is optional)
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-3	OUT-OF-BRANCH	Execution	(a)	Tests falsifier isolation in worktree; execution layer concern
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-4	NO-RULE	Guard	(c)	Guard predicate for self-report evidence not specified in SPEC
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-5	NO-RULE	Count	(c)	Status count enumerators specification missing
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-8	NO-RULE	Audit	(c)	Gate audit trail specification not in SPEC rules
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-9	NO-RULE	Command	(c)	Error message command format not specified in SPEC
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-11	BR-51	specification	(e)	Tests green control before falsifier mutation; verifies BR-51 (falsifier behavior)
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-12	BR-51	specification	(e)	Tests falsifier persistence with inconclusive result; verifies BR-51
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-1	OUT-OF-BRANCH	Execution	(a)	Tests scratch worktree hybrid layout; execution implementation layer
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-2	OUT-OF-BRANCH	Execution	(a)	Tests workspace materialization derivation; execution implementation
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-3	OUT-OF-BRANCH	Execution	(a)	Tests mutation observability in scratch environment; execution layer
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-4	OUT-OF-BRANCH	Execution	(a)	Tests main checkout isolation after falsifier cycle; execution layer
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-5	OUT-OF-BRANCH	Execution	(a)	Tests both runners work in materialized worktree; execution layer
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-6	OUT-OF-BRANCH	Execution	(a)	Tests production wiring of falsifier verification; execution implementation
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-7	OUT-OF-BRANCH	Execution	(a)	Tests green control in materialized worktree; execution layer
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-8	OUT-OF-BRANCH	Execution	(a)	Tests cleanup symlink safety; execution implementation detail
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-1	NO-RULE	Task	(c)	Task AC scope requirement not specified in SPEC branch
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-2	NO-RULE	Task	(c)	Task AC scope storage not governed by SPEC rules
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-3	NO-RULE	Task	(c)	Empty AC scope for tasks not in SPEC specification
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-4	NO-RULE	Task	(c)	Vacuous predicate for task without script ACs not in SPEC
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-5	NO-RULE	Task	(c)	Adhoc task AC scope requirement not in SPEC branch
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-7	NO-RULE	Task	(c)	Refusal enumeration of spec AC ids not in SPEC specification
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-6	NO-RULE	Task	(c)	Regression: absent AC scope behavior not governed by SPEC
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-8	NO-RULE	Task	(c)	End-to-end task attestation not governed by SPEC branch rules

```

## Mapper P

```tsv
spec_slug	ac_id	primary	others	note	confidence
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-1	OUT-OF-BRANCH		Scratch worktre	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-2	OUT-OF-BRANCH		Scratch worktre	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-3	OUT-OF-BRANCH		Scratch worktre	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-4	OUT-OF-BRANCH		Scratch worktre	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-5	OUT-OF-BRANCH		Scratch worktre	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-6	OUT-OF-BRANCH		Scratch worktre	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-7	OUT-OF-BRANCH		Scratch worktre	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-8	OUT-OF-BRANCH		Scratch worktre	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-1	OUT-OF-BRANCH		Task AC scope	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-2	OUT-OF-BRANCH		Task AC scope	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-3	OUT-OF-BRANCH		Task AC scope	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-4	OUT-OF-BRANCH		Task AC scope	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-5	OUT-OF-BRANCH		Task AC scope	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-6	OUT-OF-BRANCH		Task AC scope	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-7	OUT-OF-BRANCH		Task AC scope	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-8	OUT-OF-BRANCH		Task AC scope	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-1	OUT-OF-BRANCH		Falsifiability	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-10	OUT-OF-BRANCH		Falsifiability	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-11	BR-56		Green control	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-12	BR-56		Persistence	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-2	BR-56		Falsifier red	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-3	OUT-OF-BRANCH		Falsifiability	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-4	OUT-OF-BRANCH		Falsifiability	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-5	OUT-OF-BRANCH		Falsifiability	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-6	OUT-OF-BRANCH		Falsifiability	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-7	OUT-OF-BRANCH		Falsifiability	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-8	OUT-OF-BRANCH		Falsifiability	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-9	OUT-OF-BRANCH		Falsifiability	medium
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-1	BR-29	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39		high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-10	BR-31	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Id immutable	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-11	BR-31	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Id immutable	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-12	BR-39	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	No log entry	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-2	BR-30	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Revising unknow	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-3	BR-29	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	No changes refu	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-4	BR-38	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Approved->draft	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-5	BR-32	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Mode mismatch	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-6	BR-35	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Others untouche	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-7	BR-30	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Dangling refs	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-8	BR-26	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Visible after s	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-9	BR-39	BR-30,BR-31,BR-32,BR-35,BR-38,BR-39	Draft unchanged	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-1	BR-16	BR-16,BR-17,BR-20,BR-30,BR-32	Schema validati	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-10	OUT-OF-BRANCH	BR-16,BR-17,BR-20,BR-30,BR-32	AC structure	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-11	OUT-OF-BRANCH	BR-16,BR-17,BR-20,BR-30,BR-32	AC structure	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-2	BR-30	BR-16,BR-17,BR-20,BR-30,BR-32	Create/set	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-3	OUT-OF-BRANCH	BR-16,BR-17,BR-20,BR-30,BR-32	AC structure	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-4	OUT-OF-BRANCH	BR-16,BR-17,BR-20,BR-30,BR-32	AC structure	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-5	OUT-OF-BRANCH	BR-16,BR-17,BR-20,BR-30,BR-32	AC structure	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-6	OUT-OF-BRANCH	BR-16,BR-17,BR-20,BR-30,BR-32	AC structure	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-7	BR-15	BR-45	Add/list/rm	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-8	OUT-OF-BRANCH	BR-16,BR-17,BR-20,BR-30,BR-32	AC structure	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-9	OUT-OF-BRANCH	BR-16,BR-17,BR-20,BR-30,BR-32	AC structure	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-1	OUT-OF-BRANCH		Review advisory	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-2	OUT-OF-BRANCH		Review advisory	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-3	OUT-OF-BRANCH		Review advisory	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-4	OUT-OF-BRANCH		Review advisory	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-5	OUT-OF-BRANCH		Review advisory	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-6	OUT-OF-BRANCH		Review advisory	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-7	OUT-OF-BRANCH		Review advisory	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-1	OUT-OF-BRANCH		Req coverage	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-2	OUT-OF-BRANCH		Req coverage	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-3	OUT-OF-BRANCH		Req coverage	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-4	OUT-OF-BRANCH		Req coverage	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-5	OUT-OF-BRANCH		Req coverage	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-6	OUT-OF-BRANCH		Req coverage	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-7	OUT-OF-BRANCH		Req coverage	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-1	OUT-OF-BRANCH		Oracle coverage	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-2	OUT-OF-BRANCH		Oracle coverage	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-3	OUT-OF-BRANCH		Oracle coverage	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-4	OUT-OF-BRANCH		Oracle coverage	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-5	OUT-OF-BRANCH		Oracle coverage	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-6	OUT-OF-BRANCH		Oracle coverage	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-7	OUT-OF-BRANCH		Oracle coverage	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-1	OUT-OF-BRANCH		Requirement che	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-2	OUT-OF-BRANCH		Requirement che	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-3	OUT-OF-BRANCH		Requirement che	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-4	OUT-OF-BRANCH		Requirement che	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-5	OUT-OF-BRANCH		Requirement che	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-6	OUT-OF-BRANCH		Requirement che	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-1	OUT-OF-BRANCH		Gate enforcemen	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-2	OUT-OF-BRANCH		Gate enforcemen	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-3	OUT-OF-BRANCH		Gate enforcemen	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-4	OUT-OF-BRANCH		Gate enforcemen	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-5	OUT-OF-BRANCH		Gate enforcemen	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-6	OUT-OF-BRANCH		Gate enforcemen	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-7	OUT-OF-BRANCH		Gate enforcemen	high

```

## Mapper Q

```tsv
spec_slug	ac_id	primary	others	note	confidence
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-1	OUT-OF-BRANCH	 	lore CLI tool behavior, not specification rule	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-2	OUT-OF-BRANCH	execution	lore CLI command error handling	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-3	OUT-OF-BRANCH	execution	lore CLI flag validation	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-4	OUT-OF-BRANCH	execution	lore CLI spec status side-effect	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-5	OUT-OF-BRANCH	execution	lore CLI flag validation	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-6	OUT-OF-BRANCH	execution	lore CLI side-effect containment	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-7	OUT-OF-BRANCH	corpus	dangling reference detection	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-8	OUT-OF-BRANCH	execution	lore CLI output consistency	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-9	OUT-OF-BRANCH	execution	lore CLI status preservation	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-10	OUT-OF-BRANCH	execution	lore CLI invariant preservation	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-11	OUT-OF-BRANCH	execution	lore CLI invariant preservation	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-12	OUT-OF-BRANCH	execution	lore CLI log behavior	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-1	OUT-OF-BRANCH	review	lint gate findings	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-2	OUT-OF-BRANCH	architecture	code structure isolation	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-3	OUT-OF-BRANCH	execution	gate blocking behavior	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-4	OUT-OF-BRANCH	execution	gate configuration disable	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-5	OUT-OF-BRANCH	execution	gate deterministic without provider	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-6	OUT-OF-BRANCH	execution	spec's own ACs gate compliance	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-7	OUT-OF-BRANCH	review	lint pattern matching	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-1	OUT-OF-BRANCH	review	lint service interface	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-2	OUT-OF-BRANCH	execution	lint service refactoring	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-3	OUT-OF-BRANCH	execution	requirement service validation	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-5	OUT-OF-BRANCH	execution	workflow gate config disable	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-6	OUT-OF-BRANCH	architecture	suite typecheck enforcement	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-4	OUT-OF-BRANCH	execution	lore CLI exit code convention	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-1	OUT-OF-BRANCH	execution	oracle coverage test suite	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-2	OUT-OF-BRANCH	execution	gate oracle coverage predicate	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-3	OUT-OF-BRANCH	execution	gate plan promotion logic	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-4	OUT-OF-BRANCH	execution	config template scaffold	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-5	OUT-OF-BRANCH	architecture	suite typecheck enforcement	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-6	OUT-OF-BRANCH	execution	lore CLI plan creation flag	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-7	OUT-OF-BRANCH	execution	MCP plan creation interface	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-1	OUT-OF-BRANCH	execution	requirement schema validation	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-2	OUT-OF-BRANCH	execution	requirement schema validation	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-3	OUT-OF-BRANCH	execution	requirement coverage computation	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-4	OUT-OF-BRANCH	execution	requirement coverage exit code	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-5	OUT-OF-BRANCH	execution	requirement service persistence	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-6	OUT-OF-BRANCH	execution	requirement coverage aggregation	high
spec-spec-055-requirement-ac-completeness-oracle	AC-055-7	OUT-OF-BRANCH	execution	AC service requirement_refs field	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-1	OUT-OF-BRANCH	review	review prompt version constant	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-2	OUT-OF-BRANCH	review	advisory kind enum schema	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-3	OUT-OF-BRANCH	review	review prompt AC section rendering	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-4	OUT-OF-BRANCH	review	review prompt advisory clause	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-5	OUT-OF-BRANCH	review	review prompt advisory lint verdict	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-6	OUT-OF-BRANCH	review	review prompt version regression	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-7	OUT-OF-BRANCH	review	review output advisory rendering	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-1	BR-16	 	criterion id uniqueness within spec	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-2	BR-15	BR-17	criterion creation validation	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-3	BR-15	 	criterion must be declared on spec	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-4	NO-RULE	 	assess prompt composition not in spec rules	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-5	OUT-OF-BRANCH	review	judge output validation	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-6	OUT-OF-BRANCH	execution	AC coverage computation	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-7	OUT-OF-BRANCH	execution	lore ac CLI roundtrip	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-8	OUT-OF-BRANCH	architecture	oracle enum SSOT	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-9	BR-25	 	declaring criterion never changes status	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-10	OUT-OF-BRANCH	architecture	suite test pass requirement	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-11	OUT-OF-BRANCH	architecture	suite typecheck enforcement	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-1	NO-RULE	 	checkpoint registry reachability not specified	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-2	BR-51	 	falsifier attestation and evidence	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-3	BR-51	 	falsifier isolation worktree cleanup	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-4	NO-RULE	 	evidence guard predicate not specified	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-5	NO-RULE	 	status count enumerators not specified	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-6	OUT-OF-BRANCH	distribution	spec mirror export script	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-7	OUT-OF-BRANCH	distribution	spec mirror drift detection	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-8	NO-RULE	 	gate audit trail not specified	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-9	NO-RULE	 	error message command format not specified	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-10	OUT-OF-BRANCH	distribution	mirror integrity corpus state	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-11	BR-51	 	falsifier green control behavior	medium
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-12	BR-51	 	falsifier verify persistence behavior	medium
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-1	BR-51	 	falsifier scratch worktree hybrid layout	medium
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-2	BR-51	 	falsifier workspace derivation	medium
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-3	BR-51	 	falsifier mutation observability	medium
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-4	BR-51	 	falsifier isolation non-regression	medium
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-5	BR-51	 	falsifier runner hybrid operation	medium
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-6	BR-51	 	falsifier production wiring	medium
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-7	BR-51	 	falsifier green control invariant	medium
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-8	BR-51	 	falsifier cleanup non-destructive	medium
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-1	NO-RULE	 	task AC scope declaration not in spec	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-2	NO-RULE	 	task AC scope declaration not in spec	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-3	NO-RULE	 	task AC scope declaration not in spec	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-4	NO-RULE	 	task AC scope declaration not in spec	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-5	NO-RULE	 	task AC scope declaration not in spec	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-7	NO-RULE	 	task AC scope declaration not in spec	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-6	NO-RULE	 	task AC scope declaration not in spec	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-8	NO-RULE	 	task AC scope declaration not in spec	high

```
