---
id: KN-650
type: knowledge
role: knowledge
title: "Pilot v2 placement: 1.4% kill-line disagreement, 12.9% full-granularity, 68 of 70 ACs out of branch"
status: archived
priority: medium
created: 2026-10-08
updated: 2026-10-23
tags: []
parent: PLAN-173
---
# Pilot v2 V2a: two independent mappers on the frozen 70-AC sample, agreement and adjudication

Inputs per mapper (identical, no lore commands, no corpus or mirror reads): the placement ADR (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`), the 10 exported baseline documents (no citations in them), and the frozen sample (`knowledge-pilot-v2-frozen-ac-sample-70-acs-seed-20261008-for`) plus each AC's check command and spec title. Agreement computed by script (`agree.py`, collapsed labels BR-n / OUT / GAP as pre-registered in the ADR).

## Result
- **Kill-line metric: 1 / 70 = 1.4% disagreement** (bar <= 30%; v1 was 49.4%). PASS.
- **Full granularity (exact branch or ARCH): 9 / 70 = 12.9% disagreement (87.1% agreement).**
- Label pairs: OUT/OUT 68, BR-21/BR-21 1, BR-2/BR-1 1.

## Validity caveat (decisive for interpretation)
68 of 70 sampled ACs were placed outside the specification branch by BOTH mappers; only 2 were in-branch. The keyword relevance filter did not concentrate in-branch ACs, because most ACs mentioning spec/AC/verify/evidence vocabulary are about execution, context, hygiene and so on. So the kill-line metric shows the in/out boundary is reproducible, but it has almost no power on "which rule inside the branch" (n = 2, 1 exact match). The v1 failure mode (BR vs OUT, 24 cases) did not recur at all; that is the part this measurement does establish.

## Disagreements (full granularity)
| n | AC | P | Q | Cause |
|---|---|---|---|---|
| 25 | AC-CF-8 | BRANCH:context | ARCH | Q1 mixed AC (business + resource bound) |
| 28 | AC-F5A-3 | ARCH | BRANCH:distribution | Q1 mixed (build artifact property) |
| 33 | AC-DI-3 | BRANCH:execution | ARCH | Q1 mixed (source assertion) |
| 39 | AC-097-4 | BRANCH:context | ARCH | Q1 mixed (key order) |
| 53 | AC-VRF-5 | BRANCH:execution | ARCH | Q1 mixed (process signals) |
| 54 | AC-DR-5 | BRANCH:hygiene | ARCH | Q1 mixed (tool count) |
| 55 | AC-050-4 | BR-2 | BR-1 | Q3 has no tie-break for two rules on the same leaf |
| 65 | AC-GI-10 | BRANCH:distribution | BRANCH:issue-loop | Q2 table has no row for project configuration keys |
| 66 | AC-GI-14 | BRANCH:distribution | BRANCH:issue-loop | same |

6 of 9 share one cause: the ADR's Q1 does not say whether ONE technical clause makes a mixed AC ARCH (Q applied it literally) or whether the MAIN assertion decides (P). Both mappers flagged this independently in their notes. Fix: amend Q1 with a main-assertion rule.

## Adjudication (owner-delegated, orchestrator)
- #55 AC-050-4 ("valid parent accepted, no-parent still refused"): both rules are falsified; primary BR-2 (the false-deny fix concerns the legal parent), secondary BR-1. Written as `lore ac cite ... AC-050-4 BR-2 BR-1`.
- #57 AC-061-20: both mappers BR-21 primary, BR-36 secondary. Written as `lore ac cite ... AC-061-20 BR-21 BR-36`.
- Mapper finding to carry: the declare leaf says the missing-test check exists only on the command-line route; AC-061-20 shows it at the service layer (rule text vs AC disagree on the route — BR-21's enforced-by was already relabelled guaranteed in V1b).

## Mapper P table
```tsv
n	spec	ac_id	primary	secondaries	decided_by	reason	confidence
1	spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start	AC-070-3	BRANCH:context		Q2	feed task-start acceptance view: which facts an agent is shown (no-ACs note, dangling scoped row)	HIGH
2	spec-075-dashboard-adjudication-workbench-route-telemetry-prd	AC-075-1	ARCH		Q1	a dashboard component's rendering (monospace tail, panel layout); the same evidence facts could be shown differently	MED
3	spec-078-dashboard-multi-project-mount-registry-machine-scope	AC-078-6	BRANCH:corpus		Q2	doc edit/approve lands only in the addressed project corpus, cross-project token refused: generic document state	LOW
4	spec-080-bootstrap-injection-projection-tier-1-tier-2-payload	AC-080-2	BRANCH:context		Q2	bootstrap injection payload content (active_sessions listed) is what an agent is shown	MED
5	spec-080-prd-as-outline-contract-structured-outline-domain	AC-080-6	BRANCH:hygiene		Q2	content-flight scan produces a budget finding (flag) over a doc's extra prose; a health finding	MED
6	spec-081-audit-hardening-part-2-gate-skip-observability-push	AC-080-2	BRANCH:corpus		Q2	gate bypass writes a gate_skipped audit entry across all checkpoints; generic audit record, not spec-specific	LOW
7	spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	AC-084-1	ARCH		Q1	store-level ordinal contract (bun:sqlite, CAS-guarded store primitive, internal error text); store behaviour, spec+ADR alike	LOW
8	spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	AC-084-4	BRANCH:hygiene		Q2	repair of duplicated ordinals on an incident fixture; produces repairs and a mapping report	LOW
9	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-4	BRANCH:corpus		Q2	search returns a hit carrying the superseded (invalidated) signal; generic find/invalidate	HIGH
10	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-6	BRANCH:hygiene		Q2	predicate deciding which knowledge docs owe code anchors; a health/staleness finding over knowledge docs	LOW
11	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-9	BRANCH:execution		Q2	verify --falsify runs produce attested reds; the AC records' falsifier fields are only consulted (produced beats consulted)	LOW
12	spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	AC-GR-1	BRANCH:issue-loop		Q2	lore issues reads GitHub defect reports	HIGH
13	spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	AC-GR-12	BRANCH:issue-loop		Q2	the defect read path writes nothing	HIGH
14	spec-a-write-side-fact-with-no-read-side-address-counts-with-no	AC-RR-10	ARCH		Q1	main assertion is a rename: zero retired field spellings in source; same facts with old names would turn it red	MED
15	spec-a-write-side-fact-with-no-read-side-address-counts-with-no	AC-RR-6	BRANCH:corpus		Q2	list/filter refusal (exit 2) on any document type; generic finding of documents	HIGH
16	spec-an-escalate-blocks-approval-for-every-doc-type-and-the	AC-ESC-1	BRANCH:review		Q2	approval refused due to an escalate judgment on a knowledge doc; condition is not type-specific	HIGH
17	spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor	AC-BFI-12	ARCH		Q1	test infrastructure: happy path and falsifier share one assertion function	HIGH
18	spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor	AC-BFI-9	BRANCH:distribution		Q2	shipped pre-push asset must invoke the checker and match the repo copy; installed project assets	LOW
19	spec-claude-md-governance-content-dimension-checks-wire-the	AC-TEMPLATE-1	BRANCH:distribution		Q2	setup --project installs a CLAUDE.md that contains the rules pointer	HIGH
20	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-1	BRANCH:context		Q2	fragment discovery: layer override and duplicate-id refusal decide what an agent is shown	HIGH
21	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-16	BRANCH:context		Q2	fragment containing a system-reminder tag is refused; fragments are context	HIGH
22	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-18	BRANCH:context		Q2	fragments check refuses language drift; setup refuses unknown context.language code	MED
23	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-20	BRANCH:context		Q2	cross-file fragment override refused or accepted by fragment kind	HIGH
24	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-7	BRANCH:context		Q2	subagent hook delivers the project fragment to the agent	HIGH
25	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-8	BRANCH:context		Q2	what the session-start hooks show (size cap, governance moved to rules files); setup registration is secondary	MED
26	spec-corpus-resolution-carries-provenance-and-a-foreign-write	AC-CP-1	ARCH		Q1	purity census of the resolver module's import graph; a rewrite with same answers but different imports turns it red	LOW
27	spec-corpus-truthfulness-a-verdict-must-carry-the-state-it	AC-CT-6	ARCH		Q1	constant store-call count and side-effect freedom of the push step: performance/resource bound	MED
28	spec-dashboard-production-packaging-one-command-lore-dashboard	AC-F5A-3	ARCH		Q1	built dashboard bundle contains no token mechanism: build artifact property	MED
29	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-1	BRANCH:execution		Q2	verification run attests exactly the task's declared ac_scope	HIGH
30	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-11	BRANCH:execution		Q2	a task's ac_scope written by scope add/rm; set --ac-scope refused	HIGH
31	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-2	BRANCH:execution		Q2	verification run attests the wider declared scope	HIGH
32	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-3	BRANCH:execution		Q2	verify refused (exit 4) when the task has no declared scope	HIGH
33	spec-dispatch-isolation-must-be-enforced-by-a-gate-and	AC-DI-3	BRANCH:execution		Q2	dispatch-isolation gate decides whether implementer/tester work may start; concurrent work isolation	LOW
34	spec-eager-libsql-load-makes-every-command-depend-on-a-healthy	AC-LL-5	BRANCH:sync		Q2	sync enabled without token is refused, never downgraded to local-only store	MED
35	spec-evidence-output-tail-integrity-a-self-reported-non-pass	AC-ETI-5	BRANCH:execution		Q2	runner-attested fail evidence row with empty tail is still recorded	HIGH
36	spec-governance-defaults-must-ship-and-every-recorded-gap-must	AC-GD-4	BRANCH:issue-loop		Q2	report-issue's unconfigured-upstream refusal message (reason an agent acts on)	MED
37	spec-governance-visibility-an-armed-gate-that-vacuously-passes	AC-GV-1	BRANCH:execution		Q2	plan-close verdicts distinguish vacuous from satisfied pass	HIGH
38	spec-governance-weight-must-scale-with-measured-blast-radius-a	AC-GRADE-1	BRANCH:autonomy		Q2	risk grade that sets governance weight per task; deterministic and total, undeclared layer refused	LOW
39	spec-lifecycle-archival-plan-close-cascade-deterministic	AC-097-4	BRANCH:context		Q2	archive_candidates key present in bootstrap injection only when count is positive	MED
40	spec-lore-assess-project-evidence-rows-instead-of-embedding-the	AC-AEP-12	BRANCH:review		Q2	assessment judgment keeps grounded gap rows and never asserts clean work	LOW
41	spec-lore-assess-project-evidence-rows-instead-of-embedding-the	AC-AEP-4	ARCH		Q1	two prompt builders produce the same shape: refactor equivalence	MED
42	spec-mirror-identifier-ssot-one-writer-for-export-index-human	AC-MIS-1	ARCH		Q1	zero-padding of human ids in mirror paths vs unpadded display: formatting of the same facts	MED
43	spec-multi-session-concurrency-queryable-ownership-checkout	AC-OWN-5	BRANCH:session		Q2	session list liveness verdict from pid + start time	HIGH
44	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-6	BRANCH:hygiene		Q2	mirror/corpus status parity over the real tree: drift finding	MED
45	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-7	ARCH		Q1	test-oracle lock directory resolution is test infrastructure	HIGH
46	spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	AC-OX-11	BRANCH:hygiene		Q2	corpus-wide census of failing criteria naming offenders: health finding	MED
47	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-12	ARCH		Q1	a fixed list of test files exits 0: test infrastructure	HIGH
48	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-13	ARCH		Q1	a fixed list of bun test files exits 0: test infrastructure	HIGH
49	spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr	AC-P2-8	BRANCH:execution		Q2	plan approval and task claim refused while the spec is draft; refused objects are plan and task (produced beats consulted)	HIGH
50	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-19	BRANCH:execution		Q2	plan with zero evidence still closes	HIGH
51	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-8	BRANCH:execution		Q2	attestation min_ratio decides plan close	HIGH
52	spec-report-issue-has-no-specified-concurrency-contract-ac-072	AC-IC-2	BRANCH:issue-loop		Q2	concurrent report-issue produces the declared loud failure	MED
53	spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	AC-VRF-5	BRANCH:execution		Q2	verify timeout kills the process group and records fail with timed_out	HIGH
54	spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3	AC-DR-5	BRANCH:hygiene		Q2	main assertion is drift report parity across MCP and CLI; anchor_set replace semantics is a side clause	MED
55	spec-spec-050-gate-hooks-cross-corpus-false-deny-fix-cd-prefix-t	AC-050-4	BR-2	BR-1	Q3	spec creation via hook: valid requirements-doc parent accepted (no false deny), missing parent still refused	MED
56	spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	AC-P-5	ARCH		Q1	phase migration fidelity and idempotency: migration mechanics that preserve the same facts	MED
57	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-20	BR-21	BR-36	Q3	declare/revise refuses a check command naming a missing path in a runner segment; echo prose is not a named file	MED
58	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-7	BRANCH:execution		Q2	coverage counting of evidence results (inconclusive is neither pass nor fail); evidence is execution's	MED
59	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-G1	BRANCH:execution		Q2	evidence row with result=inconclusive refused on the phase path	HIGH
60	spec-spec-063-verify-execution-root-correctness-under-linked-wor	AC-063-6	BRANCH:execution		Q2	verify spawns from the explicit execution root	HIGH
61	spec-spec-066-git-safety-gate-heredoc-string-literal-awareness-c	AC-066-5	BRANCH:execution		Q2	git-safety gate's allow/block decision on agent commands; closest owner is concurrent work execution	LOW
62	spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	AC-069-13	BRANCH:execution		Q2	plan close with an attestation exemption is allowed and names it	HIGH
63	spec-the-defect-channel-cannot-be-honestly-maintained-an	AC-DC-11	BRANCH:context		Q2	feed task-start shows the retired-oracle marker to the agent	MED
64	spec-the-defect-channel-cannot-be-honestly-maintained-an	AC-DC-6	BRANCH:issue-loop		Q2	issues --local reads the local corpus's defect reports	HIGH
65	spec-the-defect-channel-reaches-no-machine-but-its-own-github	AC-GI-10	BRANCH:distribution		Q2	project config with a retired key is accepted with a warning: upgrade compatibility	LOW
66	spec-the-defect-channel-reaches-no-machine-but-its-own-github	AC-GI-14	BRANCH:distribution		Q2	project config with retired transport keys is accepted with warnings: upgrade compatibility	LOW
67	spec-the-defect-channel-reaches-no-machine-but-its-own-github	AC-GI-7	ARCH		Q1	gh is spawned from exactly one module: module layout	HIGH
68	spec-the-retired-shape-refusal-message-has-two-byte-identical	AC-MS-1	ARCH		Q1	refusal message defined in exactly one source file: module layout	HIGH
69	spec-tiered-review-ledger-fast-track-judgment-required-promote	AC-TIER-2	BRANCH:corpus		Q2	editing an approved doc: ledger re-fast-tracked, spec back to draft; corpus owns revision-to-draft	LOW
70	spec-workflow-hardening-evidence-red-vocabulary-claim-worktree	AC-WH-3	BRANCH:execution		Q2	lore done archives a task and refuses without passing evidence	HIGH
```

## Mapper Q table
```tsv
n	spec	ac_id	primary	secondaries	decided_by	reason	confidence
1	spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start	AC-070-3	BRANCH:context		Q2	Facts in the task-start feed's acceptance view (no-ACs note, dangling scoped id, command strings); a feed is what an agent is shown	MED
2	spec-075-dashboard-adjudication-workbench-route-telemetry-prd	AC-075-1	ARCH		Q1	Asserts "monospace output_tail" rendering, which a rewrite showing the same facts could turn red; otherwise it is evidence display (execution)	LOW
3	spec-078-dashboard-multi-project-mount-registry-machine-scope	AC-078-6	BRANCH:corpus		Q2	Edit/approve addressed to project A lands only in A, unknown project and cross-project If-Match refused; the object is a generic document write	MED
4	spec-080-bootstrap-injection-projection-tier-1-tier-2-payload	AC-080-2	BRANCH:context		Q2	Bootstrap still reports a session whose plan is left out of the projection; bootstrap is in the context row	MED
5	spec-080-prd-as-outline-contract-structured-outline-domain	AC-080-6	BRANCH:hygiene		Q2	The budget scan flags an over-long free-text string on a PRD; the output is a health finding, not a refusal	MED
6	spec-081-audit-hardening-part-2-gate-skip-observability-push	AC-080-2	BRANCH:corpus		Q2	The gate-bypass audit row applies to every checkpoint (task-claim, plan-promote, spec-create ...); not spec-specific, so it falls to a generic audit record	LOW
7	spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	AC-084-1	ARCH		Q1	Store contract suite under bun:sqlite (CAS retry, STORE_ERROR message, allocateOrdinalForExisting symbol), i.e. storage engine and error plumbing; the baseline itself counts store-only tests as not falsifying BR-12	MED
8	spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	AC-084-4	BRANCH:hygiene		Q2	One-shot repair of a live numbering incident (reassignment, mapping report, idempotent rerun); the object is a repair	LOW
9	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-4	BRANCH:corpus		Q2	A search hit carries the superseded signal; search and invalidation are corpus	HIGH
10	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-6	BRANCH:hygiene		Q2	Decides which knowledge docs owe a code anchor, i.e. which docs a convergence finding flags	LOW
11	spec-a-conclusion-with-no-currency-signal-and-no-falsifier	AC-CONV-9	BRANCH:execution		Q2	The oracle drives verify --falsify to an exact exit code per AC (attested red, owned by execution); the falsifier records are only consulted	LOW
12	spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	AC-GR-1	BRANCH:issue-loop		Q2	lore issues reads GitHub defect reports	HIGH
13	spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	AC-GR-12	BRANCH:issue-loop		Q2	The defect-report read path writes no task or version	HIGH
14	spec-a-write-side-fact-with-no-read-side-address-counts-with-no	AC-RR-10	ARCH		Q1	Renames drift-row fields spec_*->doc_* and counts retired spellings in source; a rewrite reporting the same facts could fail the census	MED
15	spec-a-write-side-fact-with-no-read-side-address-counts-with-no	AC-RR-6	BRANCH:corpus		Q2	lore list refuses a sub-type filter outside knowledge with exit 2; listing documents is corpus	HIGH
16	spec-an-escalate-blocks-approval-for-every-doc-type-and-the	AC-ESC-1	BRANCH:review		Q2	An escalate judgment blocks approval of a knowledge doc; the condition is not spec-specific	HIGH
17	spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor	AC-BFI-12	ARCH		Q1	Test structure: happy path and falsifier share one assertion function, plus a code-comment disposition	HIGH
18	spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor	AC-BFI-9	BRANCH:distribution		Q2	Shipped pre-push asset must invoke the anchor checker and stay byte-identical to the repo copy; the object is an installed project asset	MED
19	spec-claude-md-governance-content-dimension-checks-wire-the	AC-TEMPLATE-1	BRANCH:distribution		Q2	Template asset and the CLAUDE.md that setup --project installs both carry the rules pointer	HIGH
20	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-1	BRANCH:context		Q2	Fragment layer override, and a duplicate id is refused	HIGH
21	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-16	BRANCH:context		Q2	A fragment body containing <system-reminder is refused	HIGH
22	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-18	BRANCH:context		Q2	fragments check refuses language drift; the setup half (unknown code refused) is distribution	MED
23	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-20	BRANCH:context		Q2	Cross-file fragment override refused or applied by layer	HIGH
24	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-7	BRANCH:context		Q2	The subagent hook delivers the project-layer fragment	HIGH
25	spec-context-fragments-config-driven-layered-rule-injection	AC-CF-8	ARCH		Q1	The 10,000-character cap on hook output is a resource bound a same-facts rewrite could break; the rest is distribution or context	LOW
26	spec-corpus-resolution-carries-provenance-and-a-foreign-write	AC-CP-1	ARCH		Q1	Purity census (no fs/path/os imports, no process.cwd) of the resolver module; the outcome rows alone would be sync or corpus	MED
27	spec-corpus-truthfulness-a-verdict-must-carry-the-state-it	AC-CT-6	ARCH		Q1	Store-call count of 2, size independence and a 2s wall-clock bound are performance and resource bounds	HIGH
28	spec-dashboard-production-packaging-one-command-lore-dashboard	AC-F5A-3	BRANCH:distribution		Q2	The packaged dashboard build serves no secret material; no branch fits cleanly, and packaging is the closest	LOW
29	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-1	BRANCH:execution		Q2	verify attests exactly the task's ac_scope	HIGH
30	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-11	BRANCH:execution		Q2	A task's ac_scope add/rm round trip; set --ac-scope refused with exit 2	HIGH
31	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-2	BRANCH:execution		Q2	A wider ac_scope attests 3 refs instead of 2	HIGH
32	spec-declared-scope-attestation-contract-task-owned-ac-scope	AC-VS-3	BRANCH:execution		Q2	verify refuses (exit 4) a task with no scope before running anything	HIGH
33	spec-dispatch-isolation-must-be-enforced-by-a-gate-and	AC-DI-3	ARCH		Q1	Includes a source assertion (hook hardcodes no branch name or tip) that a same-behaviour rewrite could fail; the allow-path rows would be execution	LOW
34	spec-eager-libsql-load-makes-every-command-depend-on-a-healthy	AC-LL-5	BRANCH:sync		Q2	With sync enabled and no token the app is refused, never silently downgraded to local-only; the object is replicated corpus state	MED
35	spec-evidence-output-tail-integrity-a-self-reported-non-pass	AC-ETI-5	BRANCH:execution		Q2	A runner-attested fail with an empty tail is still appended as an evidence row	HIGH
36	spec-governance-defaults-must-ship-and-every-recorded-gap-must	AC-GD-4	BRANCH:issue-loop		Q2	Wording of the report-issue disclosure when no upstream is configured (the reason an agent acts on)	MED
37	spec-governance-visibility-an-armed-gate-that-vacuously-passes	AC-GV-1	BRANCH:execution		Q2	Plan-close verdicts tell a vacuous pass from a satisfied one	HIGH
38	spec-governance-weight-must-scale-with-measured-blast-radius-a	AC-GRADE-1	BRANCH:autonomy		Q2	A task's risk grade sets governance weight (trust calibration); execution would also be defensible	LOW
39	spec-lifecycle-archival-plan-close-cascade-deterministic	AC-097-4	ARCH		Q1	"Byte-stable key order" of the injection is ordering with the same facts; key presence alone would be context	LOW
40	spec-lore-assess-project-evidence-rows-instead-of-embedding-the	AC-AEP-12	BRANCH:review		Q2	The assessment judgment keeps grounded gaps and does not claim the work is clean; the object is a judgment	LOW
41	spec-lore-assess-project-evidence-rows-instead-of-embedding-the	AC-AEP-4	ARCH		Q1	Two internal prompt builders produce the same shape (refactor equivalence)	MED
42	spec-mirror-identifier-ssot-one-writer-for-export-index-human	AC-MIS-1	ARCH		Q1	Zero-padded vs unpadded spelling of the same ids in a migration reconcile entry (formatting, migration mechanics)	MED
43	spec-multi-session-concurrency-queryable-ownership-checkout	AC-OWN-5	BRANCH:session		Q2	Session liveness verdict comes from a pid plus start-time probe	HIGH
44	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-6	BRANCH:hygiene		Q2	Mirror-file status matches corpus status across the real tree (a drift finding)	MED
45	spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	AC-OX-7	ARCH		Q1	The test-runner lock directory resolves at checkout level (test infrastructure)	HIGH
46	spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	AC-OX-11	BRANCH:hygiene		Q2	Corpus-wide census of ACs in fail state that names offenders (a health finding)	MED
47	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-12	ARCH		Q1	The whole oracle is "this list of test files exits 0" (test infrastructure)	MED
48	spec-oracle-tier-falsifiability-a-criterion-never-observed-red	AC-FALS-13	ARCH		Q1	The whole oracle is "this list of bun test files exits 0" (test infrastructure)	MED
49	spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr	AC-P2-8	BRANCH:execution		Q2	Plan approval and task claim are refused while the spec is draft; the refused objects (plan, claim) win over the consulted spec	HIGH
50	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-19	BRANCH:execution		Q2	A plan with zero evidence still closes	HIGH
51	spec-plan-close-predicates-measure-invariants-an-applicability	AC-PCI-8	BRANCH:execution		Q2	The attestation min_ratio setting decides whether a plan close is denied	HIGH
52	spec-report-issue-has-no-specified-concurrency-contract-ac-072	AC-IC-2	BRANCH:issue-loop		Q2	Concurrent report-issue under contention fails loudly	HIGH
53	spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	AC-VRF-5	ARCH		Q1	SIGTERM to the process group and SIGKILL after the grace period are process mechanics; the "fail, timed_out" evidence half would be execution	LOW
54	spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3	AC-DR-5	ARCH		Q1	MCP/CLI parity of the same drift facts, an unchanged argless shape, and an MCP tool count of 30 are adapter mechanics	MED
55	spec-spec-050-gate-hooks-cross-corpus-false-deny-fix-cd-prefix-t	AC-050-4	BR-1	BR-2	Q3	Spec creation through the hook: a valid parent is accepted and the no-parent variant is still refused; create leaf	MED
56	spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	AC-P-5	ARCH		Q1	Migration fixture: reconciliation diff 0 and idempotent second run (migration mechanics)	MED
57	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-20	BR-21	BR-36	Q3	Declare/revise accepts echo prose but still refuses a missing test path in a runner segment; declare is primary, revise secondary	MED
58	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-7	BRANCH:execution		Q2	AC coverage counts derived from evidence or attestation; an inconclusive result is neither pass nor fail	MED
59	spec-spec-061-attestation-completeness-guard-detect-zero-match-u	AC-061-G1	BRANCH:execution		Q2	An inconclusive evidence result on the phase path is refused with exit 4	HIGH
60	spec-spec-063-verify-execution-root-correctness-under-linked-wor	AC-063-6	BRANCH:execution		Q2	verify --execution-root sets where the run spawns and is reported	HIGH
61	spec-spec-066-git-safety-gate-heredoc-string-literal-awareness-c	AC-066-5	BRANCH:execution		Q2	The git safety gate's allow/deny on an agent's git command; no table row fits exactly	LOW
62	spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	AC-069-13	BRANCH:execution		Q2	A plan close allowed by an exemption names it; without the exemption it is still denied	HIGH
63	spec-the-defect-channel-cannot-be-honestly-maintained-an	AC-DC-11	BRANCH:context		Q2	The task-start feed shows the retired-oracle marker, and omits it when prior_refs is 0	MED
64	spec-the-defect-channel-cannot-be-honestly-maintained-an	AC-DC-6	BRANCH:issue-loop		Q2	lore issues --local reads and names the consumer corpus	HIGH
65	spec-the-defect-channel-reaches-no-machine-but-its-own-github	AC-GI-10	BRANCH:issue-loop		Q2	A legacy feedback cap key is accepted with a warning naming it; distribution (upgrade) also plausible	LOW
66	spec-the-defect-channel-reaches-no-machine-but-its-own-github	AC-GI-14	BRANCH:issue-loop		Q2	Retired feedback transport keys are accepted with a warning naming each; distribution also plausible	LOW
67	spec-the-defect-channel-reaches-no-machine-but-its-own-github	AC-GI-7	ARCH		Q1	gh is spawned from exactly one module (module layout)	HIGH
68	spec-the-retired-shape-refusal-message-has-two-byte-identical	AC-MS-1	ARCH		Q1	Source grep: the message is defined in one file only (module layout, SSOT)	HIGH
69	spec-tiered-review-ledger-fast-track-judgment-required-promote	AC-TIER-2	BRANCH:corpus	BR-81	Q2	Editing an approved doc: the ledger stays approved and a spec returns to draft; corpus owns "revision returns an approved doc to draft"	MED
70	spec-workflow-hardening-evidence-red-vocabulary-claim-worktree	AC-WH-3	BRANCH:execution		Q2	lore done archives a task, refuses without passing evidence, and is idempotent	HIGH
```

## Mapper Q notes
## Notes

Places where the procedure itself was ambiguous:

1. **Q1 says nothing about ACs that mix a business clause with a technical one.** I read the Q1 test literally: if any asserted clause could turn red under a rewrite that keeps the same decisions, state and reported facts, the AC is ARCH. That decided #2 (monospace), #25 (10,000-character cap), #26 (purity census), #33 (source assertion), #39 (byte-stable key order), #53 (signal handling) and #54 (MCP tool count). A mapper who places by the main clause would put these in context / execution / sync / context / execution / hygiene, and #2 in execution. Because ARCH and BRANCH both count as OUT in the kill-line metric, this only moves the secondary metric.
2. **#7 (store contract suite) vs BR-9/BR-10.** The AC asserts spec numbering, but at the store layer. I chose ARCH because the create leaf's own downgrade note says a store-only test does not falsify BR-12. A mapper who places by topic would pick BR-9 or BR-10, and that is a kill-metric disagreement.
3. **The Q2 table has no row for some objects:**
   - #6: a gate-bypass audit row across all checkpoints. The spec branch's cross-cutting note mentions the bypass switch, but no numbered rule does.
   - #28: dashboard secrets.
   - #61: an agent's git command.
   - #38: task risk grade, autonomy vs execution.
   - #40: assessment judgment.
   - #65 and #66: legacy config keys, issue-loop vs distribution.
4. **Read-only reports.** The table is written for state transitions. Reports (#1, #4, #5, #10, #44, #46, #58, #63) needed a judgment call between context, hygiene and execution. The spec branch says the "criteria coverage" listing belongs to it but has no rules, so I sent #58 to execution, which produces the evidence.
5. **#11 (AC-CONV-9)** checks that this spec's own ACs carry falsifiers and that the falsifiers fire. That could be read as a specification property, which would be a GAP since BR-56 makes falsifiers optional. I chose execution because a falsifier run is what produces the result. This is a kill-metric risk.
6. **#57 vs the baseline.** The declare leaf says the missing-test check runs only on the command-line route, but this AC asserts the refusal at the service layer. BR-21's behaviour still turns the oracle red, so I cited it. The leaf's route statement may be out of date.
7. **#69** could also go to review or autonomy, since re-fast-tracking is an automatic approval. I chose corpus because the transition is an edit of an approved document.
