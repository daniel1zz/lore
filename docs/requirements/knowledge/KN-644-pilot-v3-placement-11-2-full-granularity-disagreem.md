---
id: KN-644
type: knowledge
role: knowledge
title: "Pilot v3 placement: 11.2% full-granularity disagreement, 22 in-tree, 20/20 same rule"
status: archived
priority: medium
created: 2026-10-08
updated: 2026-10-23
tags: []
parent: PLAN-174
---
# Pilot v3 W2a: two independent mappers on the frozen 80-AC sample (two populated branches, amended ADR)

Inputs per mapper (identical; no lore commands, no corpus or mirror reads): the amended placement ADR (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome` v7), the 19 exported baseline documents (no citations in them), and the frozen sample (`knowledge-pilot-v3-frozen-ac-sample-80-acs-seed-20261009-for`) with each AC's command and spec title. Agreement computed by script from the two tables below.

## Result
- **Full-granularity disagreement: 9 / 80 = 11.2%** (bar <= 30%). PASS.
- **In-tree count (placed on a BR rule by >= 1 mapper): 22** (bar >= 20). PASS — narrowly.
- Both mappers placed 20 ACs on a rule, and chose the SAME rule for all 20 (20/20). This is the in-branch rule-choice agreement v2 could not measure (n=2 there).
- Collapsed metric (v1/v2 comparability): 5 / 80 = 6.2%. Labels: P = 22 BR, 29 BRANCH, 23 ARCH, 6 GAP; Q = 20 BR, 29 BRANCH, 24 ARCH, 7 GAP.

## Disagreements and adjudication (owner-delegated, orchestrator)
| n | AC | P | Q | Adjudicated | Why |
|---|---|---|---|---|---|
| 4 | AC-084-5 | BRANCH:hygiene | BRANCH:corpus | hygiene | the AC is a one-shot repair of an existing numbering incident (hygiene row: repairs) |
| 10 | AC-CF-11 | BRANCH:distribution | BRANCH:context | context | main assertion: fragments are re-injected (what an agent is shown); setup registration is the means |
| 18 | AC-VS-8 | GAP | BRANCH:context | GAP (execution) | explains plan-close predicates to an agent; the explanation describes execution's closure contract; no rule states it |
| 32 | AC-OWN-3 | BRANCH:context | BRANCH:session | session | the reported fact is a session's branches; bootstrap is only the carrier |
| 39 | AC-FALS-19 | ARCH | GAP | GAP (specification) | distinct markers per coverage state are what make the facts distinguishable to a reader, so not pure formatting |
| 41 | AC-FALS-5 | ARCH | GAP | GAP (specification) | same as 39 |
| 64 | AC-061-1 | BR-176 | ARCH | ARCH | oracle calls an internal helper directly; a rewrite with the same decisions could turn it red (Q1 literal) |
| 67 | AC-061-18 | BR-176 | ARCH | ARCH | same as 64 |
| 73 | AC-MOS-1 | BRANCH:corpus | ARCH | ARCH | main assertion is a source-level property |

Causes: 5 of 9 are display/helper-level ACs sitting on the Q1 line (39, 41, 64, 67, 73); 3 are reports carried by bootstrap (10, 18, 32) where the Q2 table's "bootstrap → context" row competes with the owner of the reported fact; 1 is hygiene vs corpus for a repair. A further ADR clarification ("a report belongs to the owner of the reported fact, not to its carrier") would remove the bootstrap class.

## Citations written
The 20 ACs both mappers placed on the same rule were cited (primary plus secondaries both mappers named): `lore ac cite` x 20, 0 failures. GAP placements are not written as rules here (drafting new rules is out of this measurement's scope); they are listed for the branch owners: n=18, 37, 39, 40, 41, 47, 70, 79 (execution or specification gaps, draft rules in the mapper tables).

## Mapper P table
```tsv
n	spec	ac_id	primary	secondaries	decided_by	reason	confidence
1	spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start	AC-070-17	ARCH		Q1	Q1: asserts store-read counts and refactor-equivalent output; same decisions/state/facts could still turn it red	HIGH
2	spec-071-execution-liveness-signals-session-actor-tier-evidence	AC-069-4	BR-141		Q3	Q3: holder evidence renews claim in same change, foreign evidence leaves claim untouched; violating BR-141 reds it (CAS single-write is secondary technical clause)	HIGH
3	spec-071-execution-liveness-signals-session-actor-tier-evidence	AC-069-6	BRANCH:context		Q2	Q2: produced fact is a field of the bootstrap report an agent is shown -> context	MED
4	spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	AC-084-5	BRANCH:hygiene		Q2	Q2: dry-run/apply repair migration of ordinal identity; repairs owned by hygiene (spans SPEC and ADR numbering, not spec-only)	LOW
5	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-3	BRANCH:corpus		Q2	Q2: search hit reports superseded fact; generic document search is corpus (same-SQL/query-count clause is secondary)	MED
6	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-7	BRANCH:corpus		Q2	Q2: refusal concerns conclusion-bearing (knowledge) docs generically, not specs or execution objects	LOW
7	spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	AC-GR-10	BRANCH:issue-loop		Q2	Q2: which defect reports the GitHub listing shows -> issue-loop	HIGH
8	spec-a-write-side-fact-with-no-read-side-address-counts-with-no	AC-RR-4	BRANCH:hygiene		Q2	Q2: drift finding for a knowledge code anchor -> hygiene	HIGH
9	spec-assessment-freshness-plan-close-denies-a-stale-assessment	AC-FRESH-3	BR-225		Q3	Q3: plan-close freshness predicate; BR-225 says cosmetic task edits do not count, only evidence/archival activity	HIGH
10	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-11	BRANCH:distribution		Q2	Q2: first clause is setup registering a hook entry (installed project assets); re-emission of fragments is secondary context clause	LOW
11	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-12	BRANCH:context		Q2	Q2: what the session-start hook shows the agent (stale marker, budget) -> context	HIGH
12	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-13	BRANCH:context		Q2	Q2: refresh of rendered rule fragments refuses a lost update; fragment rendering is context	MED
13	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-19	BRANCH:context		Q2	Q2: which fragments each outlet receives -> context	HIGH
14	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-2	BRANCH:context		Q2	Q2: fragment selection by audience/language/disable -> context	HIGH
15	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-6	BRANCH:context		Q2	Q2: refresh writes/skips/prunes rendered rule fragments -> context	MED
16	spec-corpus-truthfulness-a-verdict-must-carry-the-state-it	AC-CT-1	ARCH		Q1	Q1: glyph rendering injectivity enforced by compile fixture and source scan; output formatting/code structure, facts unchanged	MED
17	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-7	BR-220	BR-221	Q3	Q3: task with only self-reported rows does not block close when owned criteria attested elsewhere and is listed unattested; no minimum share by default	HIGH
18	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-8	GAP		Q3	Q2 execution (plan-close gate); no rule states what the gate explanation reports. Draft: 'The plan-close explanation names each condition's known false pass.'	LOW
19	spec-eager-libsql-load-makes-every-command-depend-on-a-healthy	AC-LL-3	ARCH		Q1	Q1: storage-library load/TMPDIR dependency control; resource/engine behaviour	HIGH
20	spec-evidence-output-tail-integrity-a-self-reported-non-pass	AC-ETI-6	BR-149		Q3	Q3: self-reported non-pass row without output refused, on the phase route too (refusals hold on every route)	MED
21	spec-governance-visibility-an-armed-gate-that-vacuously-passes	AC-GV-5	BR-6		Q3	Q3: spec-creation refusal must quote the rule text it is held to; an empty rule slice in a fresh install violates BR-6	MED
22	spec-issue-closure-loop-computed-resolution-agent-reachable	AC-ICL-6	BRANCH:issue-loop		Q2	Q2: flags unresolved/stale defect reports -> issue-loop	MED
23	spec-issue-closure-loop-computed-resolution-agent-reachable	AC-ICL-8	BRANCH:issue-loop		Q2	Q2: computed resolution of a defect report -> issue-loop	HIGH
24	spec-judgment-surfaces-must-verify-before-they-certify-machine	AC-JV-3	BR-187	BR-186	Q3	Q3: falsifier throwaway copy taken from the separate working copy incl. its uncommitted change; main-copy control must not see it	HIGH
25	spec-judgment-surfaces-must-verify-before-they-certify-machine	AC-JV-5	BRANCH:review		Q2	Q2: stored assessment (judge review) path verification -> review	MED
26	spec-judgment-surfaces-must-verify-before-they-certify-machine	AC-JV-6	ARCH		Q1	Q1: source comment text currency; no product outcome changes	HIGH
27	spec-lore-assess-ai-plan-outcome-assessment-llm-as-judge-feedbac	AC-ASSESS-15	BRANCH:review		Q2	Q2: assessment reports a named outcome when no commits found -> review	MED
28	spec-lore-assess-project-evidence-rows-instead-of-embedding-the	AC-AEP-3	ARCH		Q1	Q1: internal truncation-entry vocabulary byte-identity for downstream computation	MED
29	spec-lore-assess-project-evidence-rows-instead-of-embedding-the	AC-AEP-9	ARCH		Q1	Q1: prompt template version freeze/reproducibility; internal plumbing	MED
30	spec-lore-setup-deletes-repo-source-through-dev-symlinks	AC-SL-4	BRANCH:distribution		Q2	Q2: setup removal must not delete through symlinks; installed project assets -> distribution	MED
31	spec-lore-setup-deletes-repo-source-through-dev-symlinks	AC-SL-7	ARCH		Q1	Q1: type-level required parameter verified by typecheck	HIGH
32	spec-multi-session-concurrency-queryable-ownership-checkout	AC-OWN-3	BRANCH:context		Q2	Q2: field of the bootstrap active_sessions report an agent is shown -> context (session data, but produced object is the bootstrap)	LOW
33	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-2	ARCH		Q1	Q1: test-suite pollution guard wiring; test infrastructure	HIGH
34	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-3	ARCH		Q1	Q1: scratch namespace/tsconfig/typecheck exit behaviour; build infrastructure	HIGH
35	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-5	BRANCH:hygiene		Q2	Q2: detection and convergent repair of mirror drift -> hygiene	MED
36	spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	AC-OX-7	ARCH		Q1	Q1: how AC-oracle test-file population is computed; test infrastructure	MED
37	spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	AC-OX-8	GAP		Q3	Q2 execution (coverage state from evidence); no rule fixes coverage-state precedence. Draft: 'A criterion with any failing evidence and no pass is reported as failing.'	LOW
38	spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	AC-OX-9	BR-21	BR-36	Q3	Q3: missing test file needs non-empty reason; pending count recomputed so creating the file drops it	HIGH
39	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-19	ARCH		Q1	Q1: CLI badge markers for coverage states; output formatting of facts available elsewhere	MED
40	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-3	GAP		Q3	Q2 execution (coverage state); no rule says attested pass outranks never-falsified. Draft: 'A criterion with an attested pass is reported as passing even if never observed red.'	LOW
41	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-5	ARCH		Q1	Q1: human table marker rendering of a state also in machine output; formatting	LOW
42	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-9	BR-154		Q3	Q3: piped self-reported command refused (exit 4), same with capture accepted	HIGH
43	spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr	AC-P2-5	BR-129	BR-104	Q3	Q3: task claim refused while plan's spec unapproved, accepted once approved	HIGH
44	spec-p4-upstream-downstream-linkage-feed-before-produce-protocol	AC-P4-3	BRANCH:corpus		Q2	Q2: produced object is a governs link between documents -> corpus (no spec-only deciding property)	LOW
45	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-17	BR-219		Q3	Q3: evidence-bearing task with undeclared scope denies close with distinct reason	HIGH
46	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-20	BR-227		Q3	Q3: all-not-applicable close prints nothing-measured notice; absent when something measured	HIGH
47	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-4	GAP		Q3	Q2 execution (plan approval); no rule covers the outline-sync advisory at plan approval. Draft: 'Approving a plan whose spec resolves no domain document warns, naming the spec and how to link one.'	MED
48	spec-plan-closure-must-be-loud-terminality-divergence-silent	AC-CLOSURE-2	BRANCH:hygiene		Q2	Q2: tree-check drift finding and what repair refuses to fix -> hygiene	HIGH
49	spec-plan-closure-must-be-loud-terminality-divergence-silent	AC-CLOSURE-3	BR-211		Q3	Q3: archiving last open task names plan and how to close it; plan unchanged	HIGH
50	spec-report-issue-has-no-specified-concurrency-contract-ac-072	AC-IC-1	BRANCH:issue-loop		Q2	Q2: concurrent defect report filing outcomes -> issue-loop	HIGH
51	spec-report-issue-has-no-specified-concurrency-contract-ac-072	AC-IC-3	ARCH		Q1	Q1: source grep for timer/retry code	HIGH
52	spec-report-issue-has-no-specified-concurrency-contract-ac-072	AC-IC-5	ARCH		Q1	Q1: content of a test file's assertions; test infrastructure	MED
53	spec-resume-coverage-floor-the-satisfaction-boundaries-a	AC-RCS-4	BRANCH:session		Q2	Q2: resume ticket deferral disposition -> session	HIGH
54	spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	AC-VRF-10	BR-162	BR-169,BR-170	Q3	Q3: verify refuses ambiguous target task; title lists happy/negative paths incl. no-check criteria and draft-spec warning	MED
55	spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	AC-VRF-9	ARCH		Q1	Q1: assess prompt version bump and test migration; internal prompt plumbing	MED
56	spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s	AC-ADF-10	BRANCH:review		Q2	Q2: assessment facts computed for spec-less bundle and before truncation -> review	MED
57	spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles	AC-SL-11	BRANCH:session		Q2	Q2: handoff resolution newest-wins per actor -> session	HIGH
58	spec-spec-042-session-layer-part-2-session-registry-file-anchor	AC-S3-9	ARCH		Q1	Q1: tree badge rendering of claim holder/branch; formatting regression	MED
59	spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3	AC-DR-4	BRANCH:hygiene		Q2	Q2: doc-code drift findings and exit codes -> hygiene	HIGH
60	spec-spec-054-uat-verdict-as-plan-close-gate	AC-054-7	BR-224	BR-228	Q3	Q3: close denied without acceptance verdict names how to record one	HIGH
61	spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	AC-P-3	BR-130	BR-131	Q3	Q3: anchor-overlap claim refusal applied to phase claims; same-actor negative case; config alias is tie-break 3	MED
62	spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	AC-P-4	BRANCH:context		Q2	Q2: phase start feed pack -> context	HIGH
63	spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a	AC-S-1	BRANCH:session		Q2	Q2: seat naming/readiness/resume hint -> session	MED
64	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-1	BR-176		Q3	Q3: declared-path count decides 'ran fewer of declared test files' inconclusive verdict	LOW
65	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-12	BR-153		Q3	Q3: filtered pass with zero-case or unparseable summary refused	HIGH
66	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-14	ARCH		Q1	Q1: single definition site source scan	HIGH
67	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-18	BR-176	BR-21	Q3	Q3: only runner segments contribute declared paths; affects verify under-match verdict and declare-time missing-file refusal	LOW
68	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-21	BR-21		Q3	Q3: declare refused (exit 4, nothing written) only when runner segment names a missing test file	HIGH
69	spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	AC-069-4	BR-222	BR-223	Q3	Q3: exempt plan closes without attested evidence; assess-facts clause secondary	MED
70	spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	AC-069-6	GAP		Q3	Q2 execution (create a task); no rule on linkage justification. Draft: 'A task may record a justification for plan membership, stored as given and reported in the plan's assessment facts.'	MED
71	spec-the-defect-channel-cannot-be-honestly-maintained-an	AC-DC-8	BR-40	BR-41	Q3	Q3: command rewrite bumps generation, earlier evidence reported as prior generation, rows untouched	HIGH
72	spec-the-defect-channel-reaches-no-machine-but-its-own-github	AC-GI-9	ARCH		Q1	Q1: source grep for deleted symbols	HIGH
73	spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by	AC-MOS-1	BRANCH:corpus		Q2	Q2: which fields document listing reports per row -> corpus	MED
74	spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by	AC-MOS-2	ARCH		Q1	Q1: listing payload size against a buffer bound on the real corpus; resource bound	MED
75	spec-two-runner-changed-test-selection-deterministic-test	AC-TC-4	ARCH		Q1	Q1: changed-test selector script; test infrastructure	HIGH
76	spec-two-runner-changed-test-selection-deterministic-test	AC-TC-5	ARCH		Q1	Q1: changed-test selector scope classification; test infrastructure	HIGH
77	spec-typecheck-coverage-two-named-blind-spots-and-the-stale	AC-TC-1	ARCH		Q1	Q1: typecheck chain wiring; build infrastructure	HIGH
78	spec-typecheck-coverage-two-named-blind-spots-and-the-stale	AC-TC-3	ARCH		Q1	Q1: dashboard typecheck prerequisite; build infrastructure	HIGH
79	spec-verify-reachability-plan-promote-early-warning	AC-VRW-1	GAP		Q3	Q2 execution (plan approval); no rule on verify-reachability advisory. Draft: 'Approving a plan whose criteria verification cannot reach warns without changing the verdict.'	MED
80	spec-workflow-hardening-evidence-red-vocabulary-claim-worktree	AC-WH-2	BR-136		Q3	Q3: blank working-copy value refused before anything is written	HIGH
```

## Mapper Q table
```tsv
n	spec	ac_id	primary	secondaries	decided_by	reason	confidence
1	spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start	AC-070-17	ARCH		Q1	Q1: no-duplicate-store-reads and call counts are performance/refactor equivalence; same outputs asserted	HIGH
2	spec-071-execution-liveness-signals-session-actor-tier-evidence	AC-069-4	BR-141		Q3	Q3: holder evidence renews claim, foreign evidence leaves it untouched = BR-141; single-CAS-write clause is a secondary technical note	HIGH
3	spec-071-execution-liveness-signals-session-actor-tier-evidence	AC-069-6	BRANCH:context		Q2	Q2: asserts a field every bootstrap active_plans entry must carry; bootstrap output is context	MED
4	spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	AC-084-5	BRANCH:corpus		Q2	Q2: ordinal migration rewrites SPEC/ADR numbering across doc types and lore get SPEC-n resolves; a generic document identity field (repair reading would be hygiene)	LOW
5	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-3	BRANCH:corpus		Q2	Q2: search hits report supersedes edge vs explicit absence; finding documents is corpus	MED
6	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-7	BRANCH:corpus		Q2	Q2: refusal of an undeclared anchor intersection between two knowledge/conclusion docs is a generic document write, not a spec; test file absent in repo, placed from statement	LOW
7	spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	AC-GR-10	BRANCH:issue-loop		Q2	Q2: GitHub defect listing excludes local-only reports; defect reports are issue-loop	HIGH
8	spec-a-write-side-fact-with-no-read-side-address-counts-with-no	AC-RR-4	BRANCH:hygiene		Q2	Q2: knowledge code-anchor drift reported by --check-drift; drift findings are hygiene	HIGH
9	spec-assessment-freshness-plan-close-denies-a-stale-assessment	AC-FRESH-3	BR-225		Q3	Q3: plan close assessment freshness ignores cosmetic edits, only evidence/done activity counts = BR-225	HIGH
10	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-11	BRANCH:context		Q2	Q2: compact-matcher hook re-emits fragments after compaction (what agent is shown); setup registering the hook is configuration of that feature (tie-break 3)	LOW
11	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-12	BRANCH:context		Q2	Q2: SessionStart fragment output carries stale marker and budget-bounded listing; what agent is shown	HIGH
12	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-13	BRANCH:context		Q2	Q2: context refresh of managed rules files refuses a lost update with CONFLICT; context-fragment feature	MED
13	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-19	BRANCH:context		Q2	Q2: which static fragments go to which outlet (project vs user); what agent is shown	HIGH
14	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-2	BRANCH:context		Q2	Q2: subagent fragment selection by audience/language/disable; what agent is shown	HIGH
15	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-6	BRANCH:context		Q2	Q2: context refresh renders/skips/prunes managed rules fragment files; context-fragment feature	MED
16	spec-corpus-truthfulness-a-verdict-must-carry-the-state-it	AC-CT-1	ARCH		Q1	Q1: main oracle is a source-scan rule on where glyph projections may live plus a compile-time exhaustiveness fixture; code structure, not a reported fact	LOW
17	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-7	BR-220		Q3	Q3: a task with no attested rows does not block close when all criteria attested elsewhere, still listed as unattested = BR-220	HIGH
18	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-8	BRANCH:context		Q2	Q2: gate --explain prints a known-false-pass note; no state transition, it is governance text shown to an agent (alt: execution GAP)	LOW
19	spec-eager-libsql-load-makes-every-command-depend-on-a-healthy	AC-LL-3	ARCH		Q1	Q1: no-regression control for lazy library loading under TMPDIR; technical property, command behaviour unchanged	MED
20	spec-evidence-output-tail-integrity-a-self-reported-non-pass	AC-ETI-6	BR-149		Q3	Q3: self-reported non-pass row without output is refused on the phase tier too = BR-149 (rule text says task; phase docs are outside execution leaves)	MED
21	spec-governance-visibility-an-armed-gate-that-vacuously-passes	AC-GV-5	BR-6		Q3	Q3: a spec-create refusal must quote the rule text it is held to (non-empty named rule slice) = BR-6	MED
22	spec-issue-closure-loop-computed-resolution-agent-reachable	AC-ICL-6	BRANCH:issue-loop		Q2	Q2: --check-issues flags unclosed escalations and stale open reports without mutating; defect report resolution is issue-loop (health-finding reading would be hygiene)	MED
23	spec-issue-closure-loop-computed-resolution-agent-reachable	AC-ICL-8	BRANCH:issue-loop		Q2	Q2: issue resolution computed fixed via resolves edge, omitted from --open; issue-loop	HIGH
24	spec-judgment-surfaces-must-verify-before-they-certify-machine	AC-JV-3	BR-187		Q3	Q3: proving a red from a linked worktree uses that copy incl. uncommitted changes, main-checkout control does not = BR-187	HIGH
25	spec-judgment-surfaces-must-verify-before-they-certify-machine	AC-JV-5	BRANCH:review		Q2	Q2: stored assessment records checked/unverifiable finding paths; assessment is a review judgment	MED
26	spec-judgment-surfaces-must-verify-before-they-certify-machine	AC-JV-6	ARCH		Q1	Q1: grep that source comments no longer state a stale gap; comment text only	HIGH
27	spec-lore-assess-ai-plan-outcome-assessment-llm-as-judge-feedbac	AC-ASSESS-15	BRANCH:review		Q2	Q2: assess reports a named no-commits outcome instead of a silent empty diff; assessment (review judgment)	MED
28	spec-lore-assess-project-evidence-rows-instead-of-embedding-the	AC-AEP-3	ARCH		Q1	Q1: truncated[] vocabulary byte-identical so internal ratio/grounding helpers are unaffected; internal format regression guard	MED
29	spec-lore-assess-project-evidence-rows-instead-of-embedding-the	AC-AEP-9	ARCH		Q1	Q1: assess prompt template version freeze/reproducibility; prompt rendering is internal to the judge	MED
30	spec-lore-setup-deletes-repo-source-through-dev-symlinks	AC-SL-4	BRANCH:distribution		Q2	Q2: setup removal unlinks symlinks without deleting their targets; installing/upgrading project files is distribution	HIGH
31	spec-lore-setup-deletes-repo-source-through-dev-symlinks	AC-SL-7	ARCH		Q1	Q1: type-level required parameter verified by typecheck; compile-time property	HIGH
32	spec-multi-session-concurrency-queryable-ownership-checkout	AC-OWN-3	BRANCH:session		Q2	Q2: active_sessions entries report the claiming session's branches; fact about sessions (bootstrap reading would be context)	LOW
33	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-2	ARCH		Q1	Q1: repo-corpus pollution guard inside the test suite; test infrastructure	HIGH
34	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-3	ARCH		Q1	Q1: scratch probe namespace ignored by git/tsconfig, tsc exit semantics; build/test infrastructure	HIGH
35	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-5	BRANCH:hygiene		Q2	Q2: status-only mirror drift detected, repaired convergently, declined files named; drift and repair are hygiene	MED
36	spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	AC-OX-7	ARCH		Q1	Q1: computes the test-file population for frozen-file-list oracles; meta test infrastructure	MED
37	spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	AC-OX-8	GAP		Q3	Q3: criterion coverage state reported by ac list (spec read-only query) keeps fail-over-pass precedence; no rule states it. Draft: A criterion whose only check results are failures is reported failing, never passing or unmeasured	MED
38	spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	AC-OX-9	BR-21	BR-36	Q3	Q3: a missing named test file needs a non-empty reason and stays pending until the file exists = BR-21 (declare); revise-route counterpart BR-36	HIGH
39	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-19	GAP		Q3	Q3: ac coverage markers must keep fail-superseded and not-measured distinct from each other and from residual states; no rule. Draft: Every criterion coverage state is shown with its own marker, never shared with another state	MED
40	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-3	GAP		Q3	Q3: coverage state precedence (attested pass not outranked by never-falsified) for ac list; no rule. Draft: A criterion with an attested pass is reported as passing even when it was never observed red	MED
41	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-5	GAP		Q3	Q3: ac list marks a criterion never observed red and not one with an expected-fail ref; no rule. Draft: A check-decided criterion never observed failing is reported as unfalsified	MED
42	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-9	BR-154		Q3	Q3: self-reported piped command refused (exit 4), same command with capture accepted = BR-154	HIGH
43	spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr	AC-P2-5	BR-129	BR-104	Q3	Q3: task claim refused while the plan's spec is not approved, accepted once approved = BR-129	HIGH
44	spec-p4-upstream-downstream-linkage-feed-before-produce-protocol	AC-P4-3	BRANCH:corpus		Q2	Q2: produced object is a skill-governs-spec link, written idempotently; links are corpus (refused/produced beats consulted)	MED
45	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-17	BR-219		Q3	Q3: close denied (blocking) when an evidence-bearing task never declared scope = BR-219	HIGH
46	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-20	BR-227		Q3	Q3: all-not-applicable close prints a literal unmeasured notice, absent when something was measured = BR-227	HIGH
47	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-4	GAP		Q3	Q3: plan approval returns a prd_sync advisory when outline sync is on and the spec resolves no domain doc; no plan-approval rule. Draft: With outline sync on, approving a plan whose spec has no domain document returns an advisory naming the spec and how to link one	MED
48	spec-plan-closure-must-be-loud-terminality-divergence-silent	AC-CLOSURE-2	BRANCH:hygiene		Q2	Q2: --check-tree reports plan-terminality drift and --fix leaves it; drift/repair is hygiene	HIGH
49	spec-plan-closure-must-be-loud-terminality-divergence-silent	AC-CLOSURE-3	BR-211		Q3	Q3: archiving the last open task reports the plan has none left and how to close it, plan unchanged = BR-211	HIGH
50	spec-report-issue-has-no-specified-concurrency-contract-ac-072	AC-IC-1	BRANCH:issue-loop		Q2	Q2: concurrent report-issue invocations end in declared outcomes; defect reports are issue-loop	HIGH
51	spec-report-issue-has-no-specified-concurrency-contract-ac-072	AC-IC-3	ARCH		Q1	Q1: source grep for timers/retries over named paths; code structure	HIGH
52	spec-report-issue-has-no-specified-concurrency-contract-ac-072	AC-IC-5	ARCH		Q1	Q1: asserts what a test case in a test file checks and which assertions were removed; test infrastructure	MED
53	spec-resume-coverage-floor-the-satisfaction-boundaries-a	AC-RCS-4	BRANCH:session		Q2	Q2: handoff resume-ticket deferral needs a destination, distinct refusal prefix; handoff/resume ticket is session	HIGH
54	spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	AC-VRF-10	BR-162	BR-169,BR-170	Q3	Q3: verify refuses an ambiguous target task = BR-162; no-check-criteria run reports nothing run (BR-169), unapproved spec only warns (BR-170)	MED
55	spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	AC-VRF-9	ARCH		Q1	Q1: assess prompt version bump and AC-table annotation in the prompt; internal judge input	MED
56	spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s	AC-ADF-10	BRANCH:review		Q2	Q2: assessment facts computed from full bundle, identical under truncation, spec-less bundle handled; assessment is review	MED
57	spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles	AC-SL-11	BRANCH:session		Q2	Q2: handoff resolution newest-wins per plan/actor; session	HIGH
58	spec-spec-042-session-layer-part-2-session-registry-file-anchor	AC-S3-9	ARCH		Q1	Q1: tree claim badge string format (by@branch) with other suffixes unchanged; output formatting	LOW
59	spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3	AC-DR-4	BRANCH:hygiene		Q2	Q2: doc-code drift classes, exit codes, armed/disabled reporting; drift is hygiene	HIGH
60	spec-spec-054-uat-verdict-as-plan-close-gate	AC-054-7	BR-224	BR-228	Q3	Q3: close denied for user acceptance names how to record a verdict = BR-224	HIGH
61	spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	AC-P-3	BR-130	BR-131	Q3	Q3: claim refused on anchor overlap with another fresh claim = BR-130; same-actor case BR-131 (applied to phase docs, outside the leaves' task wording); config-alias warning is secondary	MED
62	spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	AC-P-4	BRANCH:context		Q2	Q2: phase start pack (feed) sections, exclusions, truncation; what agent is shown	HIGH
63	spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a	AC-S-1	BRANCH:session		Q2	Q2: seat naming, location classes, seat entry readiness, resume hint; seats are session	MED
64	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-1	ARCH		Q1	Q1: unit count of a command-token helper; internal parsing function, decision effect asserted elsewhere	MED
65	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-12	BR-153		Q3	Q3: filtered pass with zero-case or unparseable summary refused = BR-153	HIGH
66	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-14	ARCH		Q1	Q1: single definition site via source scan of imports; code structure	HIGH
67	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-18	ARCH		Q1	Q1: both internal path extractors share one segmentation seam; helper-level parsing (CLI effect is AC-061-21)	MED
68	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-21	BR-21		Q3	Q3: declaring a criterion naming a missing test path in its runner segment refused (exit 4, nothing written), echo prose not treated as a path = BR-21	HIGH
69	spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	AC-069-4	BR-222	BR-223	Q3	Q3: exempt plan closes without attested evidence = BR-222; exemption surfaced in output BR-223	MED
70	spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	AC-069-6	GAP		Q3	Q3: task creation stores a linkage justification verbatim and assess facts include it; no create-a-task rule. Draft: A task may record why it belongs to its plan; the text is stored verbatim and reported with the plan's facts	MED
71	spec-the-defect-channel-cannot-be-honestly-maintained-an	AC-DC-8	BR-40	BR-41	Q3	Q3: rewriting a check command bumps generation, earlier evidence reported as prior generation = BR-40; rows byte-identical BR-41	HIGH
72	spec-the-defect-channel-reaches-no-machine-but-its-own-github	AC-GI-9	ARCH		Q1	Q1: case-sensitive source grep for deleted symbols; code structure	HIGH
73	spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by	AC-MOS-1	ARCH		Q1	Q1: list --json row key-set contract to keep output small; output layout/performance	MED
74	spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by	AC-MOS-2	ARCH		Q1	Q1: real-corpus list output fits a 20MB buffer; resource bound	HIGH
75	spec-two-runner-changed-test-selection-deterministic-test	AC-TC-4	ARCH		Q1	Q1: changed-test selector picks pre-push guard tests; build/test infrastructure	HIGH
76	spec-two-runner-changed-test-selection-deterministic-test	AC-TC-5	ARCH		Q1	Q1: tree-scan scope classification returns a set; test selection infrastructure	HIGH
77	spec-typecheck-coverage-two-named-blind-spots-and-the-stale	AC-TC-1	ARCH		Q1	Q1: typecheck chain includes dashboard e2e project; build infrastructure	HIGH
78	spec-typecheck-coverage-two-named-blind-spots-and-the-stale	AC-TC-3	ARCH		Q1	Q1: typecheck script handles missing generated route tree; build infrastructure	HIGH
79	spec-verify-reachability-plan-promote-early-warning	AC-VRW-1	GAP		Q3	Q3: plan approval returns a verify-reachability advisory when no criterion is reachable, verdict unchanged; no plan-approval rule. Draft: Approving a plan whose spec has no check-decided criterion verification could run returns an advisory without changing the verdict	MED
80	spec-workflow-hardening-evidence-red-vocabulary-claim-worktree	AC-WH-2	BR-136		Q3	Q3: claim with empty/blank working copy refused before anything is written = BR-136	HIGH
```
