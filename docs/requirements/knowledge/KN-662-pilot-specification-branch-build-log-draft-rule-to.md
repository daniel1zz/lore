---
id: KN-662
type: knowledge
role: knowledge
title: "Pilot: specification branch build log (draft rule to BR id mapping)"
status: archived
priority: medium
created: 2026-10-07
updated: 2026-10-23
tags: [baseline, pilot]
parent: PLAN-172
links:
  - {id: PLAN-172, type: informs}
---
# Pilot: specification branch build log

Executed 2026-10-07T14:33:58Z from the main checkout by agent:main-orchestrator (task [D2]); content and verification authored in a worktree by the D2 implementer (worktree corpus writes are refused — issue #39). First baseline doc created_at 2026-10-07T14:33:02.943Z, after the probe freeze 2026-10-07T13:00:21.794Z.

## Mapping (draft rule id -> allocated BR id)

```tsv
draft_id	disposition	br_id	leaf_slug	note
SPCR-001	kept	BR-1	baseline-create-a-spec	established/guaranteed
SPCR-002	kept	BR-2	baseline-create-a-spec	established/guaranteed
SPCR-003	kept	BR-3	baseline-create-a-spec	established/guaranteed
SPCR-004	kept	BR-4	baseline-create-a-spec	established/guaranteed
SPCR-005	kept	BR-5	baseline-create-a-spec	observed/guaranteed
SPCR-006	rewritten	BR-6	baseline-create-a-spec	observed/guaranteed
SPCR-007	new	BR-7	baseline-create-a-spec	observed/guaranteed
SPCR-010	kept	BR-8	baseline-create-a-spec	established/guaranteed
SPCR-011	kept	BR-9	baseline-create-a-spec	established/guaranteed
SPCR-012	kept	BR-10	baseline-create-a-spec	established/guaranteed
SPCR-013	kept	BR-11	baseline-create-a-spec	observed/guaranteed
SPCR-014	new	BR-12	baseline-create-a-spec	established/guaranteed
SPCR-015	new	BR-13	baseline-create-a-spec	observed/guaranteed
SPCR-020	new	BR-14	baseline-create-a-spec	undecided/prompt-only
ACDC-001	kept	BR-15	baseline-declare-an-acceptance-criterion	established/guaranteed
ACDC-002	kept	BR-16	baseline-declare-an-acceptance-criterion	established/guaranteed
ACDC-003	kept	BR-17	baseline-declare-an-acceptance-criterion	established/guaranteed
ACDC-004	kept	BR-18	baseline-declare-an-acceptance-criterion	observed/both
ACDC-005	kept	BR-19	baseline-declare-an-acceptance-criterion	observed/guaranteed
ACDC-006	kept	BR-20	baseline-declare-an-acceptance-criterion	established/guaranteed
ACDC-007	kept	BR-21	baseline-declare-an-acceptance-criterion	observed/prompt-only
ACDC-008	kept	BR-22	baseline-declare-an-acceptance-criterion	observed/guaranteed
ACDC-009	kept	BR-23	baseline-declare-an-acceptance-criterion	observed/guaranteed
ACDC-010	new	BR-24	baseline-declare-an-acceptance-criterion	unconfirmed/guaranteed
ACDC-020	kept	BR-25	baseline-declare-an-acceptance-criterion	observed/guaranteed
ACDC-021	kept	BR-26	baseline-declare-an-acceptance-criterion	observed/guaranteed
ACDC-022	kept	BR-27	baseline-declare-an-acceptance-criterion	observed/guaranteed
ACDC-030	new	BR-28	baseline-declare-an-acceptance-criterion	undecided/prompt-only
ACRV-001	kept	BR-29	baseline-revise-an-acceptance-criterion	established/guaranteed
ACRV-002	kept	BR-30	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-003	kept	BR-31	baseline-revise-an-acceptance-criterion	established/guaranteed
ACRV-004	kept	BR-32	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-005	rewritten	BR-33	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-006	kept	BR-34	baseline-revise-an-acceptance-criterion	established/guaranteed
ACRV-007	kept	BR-35	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-008	new	BR-36	baseline-revise-an-acceptance-criterion	observed/prompt-only
ACRV-009	new	BR-37	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-020	kept	BR-38	baseline-revise-an-acceptance-criterion	established/guaranteed
ACRV-021	kept	BR-39	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-022	kept	BR-40	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-023	kept	BR-41	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-024	kept	BR-42	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-025	kept	BR-43	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACRV-026	kept	BR-44	baseline-revise-an-acceptance-criterion	observed/guaranteed
ACWD-001	kept	BR-45	baseline-withdraw-an-acceptance-criterion	observed/guaranteed
ACWD-002	kept	BR-46	baseline-withdraw-an-acceptance-criterion	observed/guaranteed
ACWD-003	kept	BR-47	baseline-withdraw-an-acceptance-criterion	observed/guaranteed
ACWD-004	kept	BR-48	baseline-withdraw-an-acceptance-criterion	observed/guaranteed
ACWD-005	kept	BR-49	baseline-withdraw-an-acceptance-criterion	observed/guaranteed
ACWD-006	kept	BR-50	baseline-withdraw-an-acceptance-criterion	observed/guaranteed
FALS-001	kept	BR-51	baseline-declare-a-falsifier	established/guaranteed
FALS-002	rewritten	BR-52	baseline-declare-a-falsifier	observed/guaranteed
FALS-003	kept	BR-53	baseline-declare-a-falsifier	established/guaranteed
FALS-004	kept	BR-54	baseline-declare-a-falsifier	observed/guaranteed
FALS-005	kept	BR-55	baseline-declare-a-falsifier	observed/guaranteed
FALS-006	kept	BR-56	baseline-declare-a-falsifier	established/guaranteed
FALS-007	kept	BR-57	baseline-declare-a-falsifier	observed/guaranteed
FALS-008	kept	BR-58	baseline-declare-a-falsifier	observed/guaranteed
FALS-009	new	BR-59	baseline-declare-a-falsifier	unconfirmed/guaranteed
FALS-010	new	BR-60	baseline-declare-a-falsifier	unconfirmed/guaranteed
FALS-011	new	BR-61	baseline-declare-a-falsifier	unconfirmed/guaranteed
ANCH-001	kept	BR-62	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-002	kept	BR-63	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-003	kept	BR-64	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-004	kept	BR-65	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-005	kept	BR-66	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-006	kept	BR-67	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-007	kept	BR-68	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-008	new	BR-69	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-010	kept	BR-70	baseline-declare-a-code-anchor	observed/guaranteed
ANCH-011	kept	BR-71	baseline-declare-a-code-anchor	observed/guaranteed
SPAP-001	kept	BR-72	baseline-approve-a-spec	established/guaranteed
SPAP-002	kept	BR-73	baseline-approve-a-spec	established/guaranteed
SPAP-003	kept	BR-74	baseline-approve-a-spec	observed/guaranteed
SPAP-004	kept	BR-75	baseline-approve-a-spec	established/guaranteed
SPAP-005	kept	BR-76	baseline-approve-a-spec	established/guaranteed
SPAP-006	rewritten	BR-77	baseline-approve-a-spec	observed/guaranteed
SPAP-007	kept	BR-78	baseline-approve-a-spec	observed/guaranteed
SPAP-008	kept	BR-79	baseline-approve-a-spec	observed/guaranteed
SPAP-020	kept	BR-80	baseline-approve-a-spec	observed/guaranteed
SPAP-021	kept	BR-81	baseline-approve-a-spec	observed/guaranteed
SPAP-030	new	BR-82	baseline-approve-a-spec	unconfirmed/guaranteed
SPAP-031	new	BR-83	baseline-approve-a-spec	observed/guaranteed
SPAP-040	new	BR-84	baseline-approve-a-spec	observed/guaranteed
CITE-001	new	BR-85	baseline-cite-a-baseline-rule	established/guaranteed
CITE-002	new	BR-86	baseline-cite-a-baseline-rule	established/guaranteed
CITE-003	new	BR-87	baseline-cite-a-baseline-rule	established/guaranteed
CITE-004	new	BR-88	baseline-cite-a-baseline-rule	established/guaranteed
CITE-005	new	BR-89	baseline-cite-a-baseline-rule	established/guaranteed
CITE-006	new	BR-90	baseline-cite-a-baseline-rule	observed/guaranteed
CITE-007	new	BR-91	baseline-cite-a-baseline-rule	observed/guaranteed
CITE-008	new	BR-92	baseline-cite-a-baseline-rule	observed/guaranteed
CITE-009	new	BR-93	baseline-cite-a-baseline-rule	observed/guaranteed
CITE-010	new	BR-94	baseline-cite-a-baseline-rule	established/guaranteed
CITE-020	new	BR-95	baseline-cite-a-baseline-rule	undecided/prompt-only
```

## D2 verification record: specification branch, every draft rule re-checked

Task: task-skill-implement-build-lore-s-baseline-root-specification (plan baseline slice 1, spec §C8 step 2).
Input: knowledge-specification-branch-baseline-draft-from-experiment (7 leaves, 69 rules, excavated at 67db6557).
Checked against: main at c55661a3 (the [C7] merge), binary built from that commit in this worktree (`bun run build` exit 0, provenance c55661a3).
Independence: the frozen probe set, the validation raw data and the probes directory were not read; no corpus search for "probe".

### Method

1. Diffed the code the draft's rules rest on between 67db6557 and c55661a3 (`git diff --stat` over the AC, anchor, gate, kind, approval and corpus services). Only `acceptance.ts`, `config.ts`, `doc-type-rules.ts`, `schemas.ts`, `ac.ts`, `ac-service.ts` and `corpus-service.ts` changed, all by additive baseline/citation work. No existing spec-branch behaviour was altered; the new behaviour is `cites`, `ac cite`, `--cite`, citation warnings and the replace guard.
2. Re-ran each behavioural claim in throwaway corpora (never the repo corpus) with this worktree's `./dist/lore`. Probe scripts are saved next to this file and can be re-run: `p1.sh` to `p19.sh` (they `rm -rf` and rebuild only their own folders under the scratchpad). `lib.sh` holds the shared helper.
3. For claims a command line cannot reach (criteria at creation, concurrency inside the store, runner behaviour), read the code and the governing spec text, and ran a scoped test where one existed: `bunx vitest run packages/lore/tests/unit/service/ac-quantifiable-gate.test.ts` gave 20 passed (exit 0).
4. Intent (confidence): `established` only where an approved corpus spec or the product's own rule text says the behaviour is wanted (named per rule below). `observed` where the product does it today and I found no approved statement of intent. `undecided` and `unconfirmed` mark open business questions and suspected defects. I did not upgrade anything because it looked sensible.

Governing specs used for "established" (all read in this session, all approved): spec-spec-038-ac-as-code (schema, 50 criteria, 2000/1000/2000/500 limits, lines 57-65), spec-lore-ac-set-in-place-edit-of-a-declared-acceptance (id and mode not editable line 59; a no-op is an error D3; `--covers ""` clears; approved spec demoted on a contract edit), spec-084-corpus-allocated-ordinal-identity (domain overview numberless line 39; forced-collision retry), spec-spec-032-output-contract-mechanization (default kind feature line 40), spec-spec-058-verification-profiles (script-mode-only coverage lines 47 and 55; unconfigured is a vacuous pass line 53), spec-080-prd-as-outline-contract C2 line 97 (domain overview needs no criteria), spec-falsifiability-reachability D2 line 79 (falsifier is optional and belongs to a script-mode criterion) and D4 line 90 (exact exit code, never non-zero), spec-baseline-slice-1 (§C4 citation, §C7 status counts, QA-6, trade-off Q3 no demotion on cite). The product's own built-in spec-creation rule text (printed by the creation gate) states the parent, kind and skeleton rules. The AC-quantifiability spec is still in draft status, so the wording rules stay `observed`.

### Per-rule record

Columns: draft id, disposition (kept / rewritten / new), confidence and enforcement as built, evidence. "probe pN" is the saved script; "code" is file:line in this worktree.

#### Create a spec (SPCR)

| Draft id | Disp. | Conf. / enforced | Evidence |
|---|---|---|---|
| SPCR-001 | kept | established / guaranteed | probe p1: create with no parent exits 4 "require a parent". Built-in rule text 1. |
| SPCR-002 | kept | established / guaranteed | probe p1, p2, p15: parent decision record, spec, plan, knowledge document and task each refused "Allowed parent types: prd"; code gate-predicates.ts:171,187-195. |
| SPCR-003 | kept | established / guaranteed | probe p1: kind bogus refused listing the four kinds; probe p2: stored kind is feature when omitted; SPEC-032 line 40; gate-predicates.ts:209-218. |
| SPCR-004 | kept (text extended) | established / guaranteed | probe p1, p14: body without heading, only a level-1 heading, only a level-3 heading and an empty body refused; heading after intro text accepted. code gate-predicates.ts:220,235 (pattern: line-start two hashes plus whitespace). |
| SPCR-005 | kept | observed / guaranteed | probe p17: pre-flight with an unmeasurable human criterion returns AC_NOT_QUANTIFIABLE naming "fast"; test ac-quantifiable-gate.test.ts:130 (create refused). The command line cannot supply criteria at creation (no such flag), so the live create route was not run. Governing spec is draft, hence observed. |
| SPCR-006 | rewritten | observed / guaranteed | Draft said "every condition the candidate failed". Probe p17 shows the creation check lists PARENT_REQUIRED, MISSING_SKELETON and AC_NOT_QUANTIFIABLE together and quotes the rule text; but a real create refuses wrong parent and unknown kind earlier on shape (probe p1 NoSkelBadKind shows only the kind error). Statement narrowed to "every unmet condition of that check"; the shape-first fact became SPCR-007. code checkpoint-registry.ts:846-855. |
| SPCR-007 | new | observed / guaranteed | Was a table row in the draft ("When two rules both apply"). Probe p1: kind bogus plus no heading refused only for the kind. |
| SPCR-010 | kept | established / guaranteed | probe p1, p2: new spec status draft. (The draft's "even when it carries criteria" was dropped: not reachable from the command line.) |
| SPCR-011 | kept | established / guaranteed | probe p2: ordinals 1, 2, null (domain overview), 3. SPEC-084 line 39. |
| SPCR-012 | kept | established / guaranteed | probe p10: eight parallel creates all exit 0 with ordinals 6..13, no duplicate. code sqlite-store.ts:660-700 (retry on collision). |
| SPCR-013 | kept | observed / guaranteed | probe p6: create with an outside-project anchor refused; a good anchor stored and listed. |
| SPCR-014 | new | established / guaranteed | probe p14: domain overview with no number, kind set to feature, receives ordinal 16. SPEC-084 (allocation for an existing document on a kind flip). |
| SPCR-015 | new | observed / guaranteed | probe p14: kind set back to domain overview keeps ordinal 16. |
| SPCR-020 | new | undecided / prompt-only | ADR-041 target; draft open question Q1. Nothing enforces it today. |

#### Declare an acceptance criterion (ACDC)

| Draft id | Disp. | Conf. / enforced | Evidence |
|---|---|---|---|
| ACDC-001 | kept | established / guaranteed | probe p3: declare on a plan exits 4 "Expected a spec document". SPEC-038. |
| ACDC-002 | kept | established / guaranteed | probe p3: `ac-1` and `AC-A_B` and `AC-` refused; `AC-1` and `AC-OK-1` accepted; duplicate AC-OK-1 refused "must be unique". code acceptance.ts:204-208. |
| ACDC-003 | kept | established / guaranteed | probe p3: 2001-char statement, 501-char note, 1001-char command, 2001-char rubric each refused; probe p4: 51st criterion refused "at most 50". code acceptance.ts:299; SPEC-038 lines 57-65. |
| ACDC-004 | kept (example added) | observed / both | probe p3: "The UI is fast" refused; "P95 < 200ms, fast" ok; "fast-track approval works" ok; "faster and breakfast" ok; AI mode with rubric anchor ok, rubric without anchor refused; Chinese word refused even with a note. code ac-service.ts:349. Governing AC-quantifiability spec is draft. |
| ACDC-005 | kept | observed / guaranteed | probe p3: check-decided "The UI is fast" with command true accepted; test ac-quantifiable-gate.test.ts:172. |
| ACDC-006 | kept | established / guaranteed | probe p3: script mode with no oracle or command, AI mode with no rubric refused; bogus oracle refused listing the six kinds. SPEC-038. |
| ACDC-007 | kept | observed / prompt-only | probe p3: absent test path refused; with reason "red-first" accepted; empty reason refused; probe p8: withdraw drops the pending count 1 to 0. code ac-service.ts:319,367 and ac.ts:301: the only caller is the command line, so only that route enforces it. |
| ACDC-008 | kept | observed / guaranteed | probe p3: covers R-999 accepted (stored as requirement_refs). |
| ACDC-009 | kept | observed / guaranteed | probe p3: AC-OK-1 declared on two specs, both ok. |
| ACDC-010 | new | unconfirmed / guaranteed | probe p3: a human criterion declared with a check command is accepted, stored without it (AC-M4); probe p7: falsifier on a human criterion dropped (issue 29). Revise refuses (probe p4). |
| ACDC-020 | kept | observed / guaranteed | probe p5: add on an approved spec leaves it approved (v4 to v5). |
| ACDC-021 | kept | observed / guaranteed | probe p5: version increments on each add. |
| ACDC-022 | kept | observed / guaranteed | probe p10: six parallel adds, four refused "Version conflict ... Expected version 1 but current is 2", two landed, none merged. code ac-service.ts:968-994 (compare-and-set). |
| ACDC-030 | new | undecided / prompt-only | ADR-041 target gate; slice 2. |

#### Revise an acceptance criterion (ACRV)

| Draft id | Disp. | Conf. / enforced | Evidence |
|---|---|---|---|
| ACRV-001 | kept (enforcement raised from both to guaranteed) | established / guaranteed | probe p4: revise with no part exits 2 listing the parts. Service enforces it: code ac-service.ts:636-650. ac-set spec D3. |
| ACRV-002 | kept | observed / guaranteed | probe p4: AC-NOPE refused "Declared ids: ...". |
| ACRV-003 | kept | established / guaranteed | probe p4: `--mode` refused (exit 2) pointing at withdraw then declare. ac-set spec line 59. |
| ACRV-004 | kept | observed / guaranteed | probe p4: command on human, rubric on human, note on script, rubric on script, falsifier on human each refused naming part and actual mode. code ac-service.ts:1266. |
| ACRV-005 | rewritten (split into 005, 008, 009) | observed / guaranteed | Draft bundled shape, test-file check and (implicitly) all declare rules. Probe p17 and p18: 2001-char statement and 1001-char command refused on revise; probe p4: test-file check also runs (ACRV-008). Wording does not (ACRV-009), so "meets every declaration rule" was not true. |
| ACRV-006 | kept | established / guaranteed | probe p4: covers replaced, empty clears (accepted). ac-set spec (`--covers ""` sets an empty list). |
| ACRV-007 | kept | observed / guaranteed | probe p17: after revising one criterion the other criteria serialise byte-identical ("other criteria byte-identical"). |
| ACRV-008 | new | observed / prompt-only | probe p4: statement-only revise of a criterion with an absent test file refused. Same command-line-only route as ACDC-007 (ac-service.ts:745). |
| ACRV-009 | new | observed / guaranteed | probe p4: AC-1 reworded to "The UI is fast" accepted on revise; probe p5: approval then refused naming "fast". code: wording lint is called only at ac-service.ts:349 (add). Open question Q4 on the leaf. |
| ACRV-020 | kept | established / guaranteed | probe p5: revise on approved spec returns it to draft with notice; schemas.ts:961-969; ac-set spec. |
| ACRV-021 | kept | observed / guaranteed | schemas.ts:956 (only approved demotes). Not run for an active spec (no CLI path to make one cheaply); open question Q1. |
| ACRV-022 | kept | observed / guaranteed | probe p4, p13: command "true" to "true " gives generation 2; same text again stays 2; going back to "true" gives 3; evidence reported as current_refs 0, prior_refs 1. |
| ACRV-023 | kept | observed / guaranteed | probe p13: the task's evidence for the criterion is still present after the rewrite (count 1). |
| ACRV-024 | kept | observed / guaranteed | probe p7: revising only the expected code refused "falsifier.path Required"; all four parts accepted and replaced. |
| ACRV-025 | kept | observed / guaranteed | probe p15: `log --json` entry says "(demoted approved to draft on edit)" for the demoting revise and nothing about status for add. |
| ACRV-026 | kept | observed / guaranteed | same compare-and-set as ACDC-022 (ac-service.ts:968-994); not separately raced. |

#### Withdraw an acceptance criterion (ACWD)

| Draft id | Disp. | Conf. / enforced | Evidence |
|---|---|---|---|
| ACWD-001 | kept | observed / guaranteed | probe p8: `ac rm` of an undeclared id refused "does not exist on this spec". code ac-service.ts:572. |
| ACWD-002 | kept | observed / guaranteed | probe p8: refused naming task-t-one with evidence (captured run recorded through the evidence command). code ac-service.ts:547-591. |
| ACWD-003 | kept | observed / guaranteed | probe p8: with the force option the criterion is removed; `ac list` shows "Dangling ac_ref ... AC-OK-1"; evidence still on the task. |
| ACWD-004 | kept | observed / guaranteed | probe p5: withdraw on approved spec leaves it approved. |
| ACWD-005 | kept | observed / guaranteed | probe p5: version increments; same compare-and-set. |
| ACWD-006 | kept | observed / guaranteed | probe p3, p8: status enumeration lists the pending declaration, and is empty after the withdraw. |

#### Declare a falsifier (FALS)

| Draft id | Disp. | Conf. / enforced | Evidence |
|---|---|---|---|
| FALS-001 | kept | established / guaranteed | probe p4: falsifier on a human criterion refused on revise; falsifier spec D2 line 79. |
| FALS-002 | rewritten | observed / guaranteed | Draft said the file is "named relative to the project"; probe p7 shows `../x.ts` and an absolute path accepted, so that clause was false and was dropped (new FALS-010). Four-part rule: probe p7: missing find, missing replace, missing path each refused naming the part; empty replacement accepted. |
| FALS-003 | kept | established / guaranteed | probe p7: "non-zero" refused (not a number); 7 accepted. falsifier spec D4 line 90. |
| FALS-004 | kept | observed / guaranteed | code verify-runner-service.ts:738 (`content.replace`, first occurrence). Execution-time; not run here. |
| FALS-005 | kept | observed / guaranteed | probe p7: nonexistent path accepted at declaration; code verify-runner-service.ts:716-735 refuses a missing file or missing find text at run time. |
| FALS-006 | kept | established / guaranteed | probe p7: criteria without a falsifier accepted; code verify-runner-service.ts:1665-1672 "declares no falsifier". falsifier spec D2. |
| FALS-007 | kept | observed / guaranteed | code: the falsifier is read only in the falsifier run (verify-runner-service.ts:1665); ordinary verification does not consult it. Not run. |
| FALS-008 | kept | observed / guaranteed | probe p7 (see ACRV-024). |
| FALS-009 | new | unconfirmed / guaranteed | probe p7: human criterion with all four falsifier parts accepted, stored without it. Issue 29 (open). |
| FALS-010 | new | unconfirmed / guaranteed | probe p7: `../x.ts` and `/abs/x.ts` accepted. Code anchors refuse both (probe p6). |
| FALS-011 | new | unconfirmed / guaranteed | probe p7: expected codes 0 and 256 accepted. falsifier spec D4 also asks for an output condition; the declaration has none. |

#### Declare a code anchor (ANCH)

| Draft id | Disp. | Conf. / enforced | Evidence |
|---|---|---|---|
| ANCH-001 | kept | observed / guaranteed | probe p6: plan, decision record and PRD refused "Expected ... task, spec, knowledge"; knowledge accepted. |
| ANCH-002 | kept | observed / guaranteed | probe p6, p7: `../x.ts`, `/etc/x.ts`, `src/a/../b.ts`, backslash separators refused; `src/` accepted; 513 characters refused, 512 accepted. |
| ANCH-003 | kept | observed / guaranteed | probe p6: folder with a name, spaces and colon, non-Latin name, leading digit refused; Foo, Bar and a dollar-and-underscore name accepted. code code-anchors.ts:70. |
| ANCH-004 | kept | observed / guaranteed | probe p6: `src/nope.ts` accepted. (Drift report not run here: hygiene owns it.) |
| ANCH-005 | kept | observed / guaranteed | probe p6, p7: re-adding a present anchor leaves the list unchanged; first-declared order kept. |
| ANCH-006 | kept | observed / guaranteed | probe p7: `src/a.ts#Foo` and `src/a.ts#Bar` both listed. |
| ANCH-007 | kept | observed / guaranteed | probe p5: add and remove on an approved spec leave it approved. |
| ANCH-008 | new | observed / guaranteed | probe p6: `./src/c.ts` listed as `src/c.ts`. |
| ANCH-010 | kept | observed / guaranteed | probe p7: removing Bar leaves the others in order. |
| ANCH-011 | kept | observed / guaranteed | probe p6, p7: removing an absent anchor prints success and changes nothing. |

#### Approve a spec (SPAP)

| Draft id | Disp. | Conf. / enforced | Evidence |
|---|---|---|---|
| SPAP-001 | kept | established / guaranteed | probe p5: no criteria refused "needs >= 1 for spec_kind feature"; probe p9 with the repository-style profiles; gate "base 1-criterion rule" in the product's gate description; SPEC-080. |
| SPAP-002 | kept | established / guaranteed | probe p9: domain overview with minimum 0 and no criteria approved. SPEC-080 C2 line 97; code gate-predicates.ts:956-1005. |
| SPAP-003 | kept | observed / guaranteed | probe p5: spec-s1 approval refused naming AC-1 "fast" (criterion arrived by revise). test ac-quantifiable-gate.test.ts:256,277. |
| SPAP-004 | kept | established / guaranteed | probe p9: human, AI-judged and end-to-end criteria give "missing oracle test"; one test-kind script criterion lets it through. SPEC-058 D3 line 55. |
| SPAP-005 | kept (clause added) | established / guaranteed | code review-service.ts:273-290 and corpus-service.ts:2405-2423 (kind judged is the one the patch will persist; absent means feature). SPEC-058 D2. |
| SPAP-006 | rewritten | observed / guaranteed | Draft claimed the conditions hold "on every route" as intended. Probes show the conditions run on direct status set (p5, p9); review route runs them after the judgment gate (code review-service.ts:268-290; probe p5 `approve` stops at NO_JUDGMENT). Re-stated as what happens, with the direct-route gap split out as SPAP-030. |
| SPAP-007 | kept | observed / guaranteed | probe p9: no criteria plus missing test check gives one refusal with both reasons and the "Also" lines. |
| SPAP-008 | kept | observed / guaranteed | probe p9: approved spec with its only criterion withdrawn, status set to approved again, "Updated" with no re-check (spec-hollow). |
| SPAP-020 | kept | observed / guaranteed | probe p9: approved domain overview changed to design stays approved (design needs an end-to-end check, spec has none). |
| SPAP-021 | kept | observed / guaranteed | probe p5: priority, tags, kind, add, withdraw, anchor add and remove leave approved; body and title edits and criterion revise return to draft. |
| SPAP-030 | new | unconfirmed / guaranteed | probe p5, p9: specs reached approved by direct status set with no judgment. Draft Q2. |
| SPAP-031 | new | observed / guaranteed | probe p5: `approve` on an unreviewed spec exits 4 NO_JUDGMENT "run lore review". code review-service.ts:268-272. |
| SPAP-040 | new | observed / guaranteed | probe p11: a spec whose criteria cite non-existent rules was set to approved. |

#### Cite a baseline rule (CITE), all new in this plan

| Id | Conf. / enforced | Evidence |
|---|---|---|
| CITE-001 | established / guaranteed | probe p11: `br-1`, `BR-0`, `BR-01` refused ("must match BR-<n> with n >= 1"); an 11th id refused "at most 10". spec-baseline-slice-1 §C4; code acceptance.ts:181,280-283. |
| CITE-002 | established / guaranteed | probe p11, p12: BR-99 stored with "dangling" warning; deprecated and retired ids stored with "inactive" warnings; live ids no warning. QA-6. |
| CITE-003 | established / guaranteed | probe p11: `ac cite` on an approved spec leaves it approved (v11 to v12), `log` shows "citations updated", `audit` shows cites and cite_warnings. |
| CITE-004 | established / guaranteed | probe p11, p15: declare with a citation on an approved spec stays approved; `ac set --cite` demotes with the notice. §C4. |
| CITE-005 | established / guaranteed | probe p11: BR-1 cited twice, stored once. |
| CITE-006 | observed / guaranteed | probe p11: `--remove` of BR-77 not held prints success, list unchanged. |
| CITE-007 | observed / guaranteed | probe p11: AC-NOPE refused "Declared ids: AC-1, AC-2, AC-3". |
| CITE-008 | observed / guaranteed | probe p11: statement revise keeps cites; withdraw removes the criterion with them. |
| CITE-009 | observed / guaranteed | probe p11: no hint before any baseline document existed, hint "cites no baseline rule" after. |
| CITE-010 | established / guaranteed | probe p12: status shows "Baseline warnings: 7 dangling cites, 4 cites to inactive rules ..." and the JSON baseline block. §C7. |
| CITE-020 | undecided / prompt-only | ADR-041 target gate (slice 2); not built. |

### Dropped, rewritten, split, retained-with-changed-level

Dropped outright: none. Every one of the 69 draft rules still describes behaviour I could reproduce, or read in code, on c55661a3.

Rewritten (4):
- SPCR-006: "every condition the candidate failed" is false across the shape checks; narrowed to the creation check, and the ordering fact became SPCR-007.
- ACRV-005: the draft implied a revision meets every declaration rule. Wording is not re-checked on revise (code ac-service.ts:349 is in the add path only). Split into ACRV-005 (shape and limits), ACRV-008 (test-file check, command-line route only) and ACRV-009 (wording not re-checked).
- FALS-002: removed the claim that the file is "named relative to the project" (not enforced; FALS-010).
- SPAP-006: restated as observed behaviour; the direct-route judgment gap is SPAP-030.

Clause-level edits to kept rules: SPCR-004 (explicit about heading levels), SPCR-010 (dropped the unreachable "even when it carries criteria"), ACDC-004 (Chinese-word example added), SPAP-005 (kind judged is the one persisted in the same step).

Level changes versus the draft: every draft 🟢 became `established` only where listed above with a named governing text; the rest became `observed`. ACRV-001 enforcement `both` became `guaranteed` (the service itself refuses, not only the command line).

New rules (26): SPCR-007, 014, 015, 020; ACDC-010, 030; ACRV-008, 009; FALS-009, 010, 011; ANCH-008; SPAP-030, 031, 040; CITE-001 to CITE-010 and CITE-020. A new leaf, `Cite a baseline rule`, holds the citation rules; it is an addition beyond the seven drafted leaves and can be removed from the script (its content file, one `node` line, the CITE block and one `dep` line) if the owner prefers citation rules to live in the declare leaf.

### Not verified here (honest list)

- Criteria supplied at creation (SPCR-005): reached only by the agent tool server or the web service; verified by the pre-flight check and the unit test, not by a live create.
- Any behaviour for an `active`, `in-review`, `archived` or `deprecated` spec (ACRV-021, issues 30): no cheap command-line path; code and the spec header only.
- Runner behaviour of falsifiers (FALS-004, 005, 007): code read, not executed.
- Issue 36 (wholesale `extra` replacement through the agent tool server and web service): taken from the filed report, not re-probed (the command line has no flag that reaches it).
- Drift report over anchors (hygiene) and evidence attribution to rules by commit (product-baseline): out of this branch's scope. `baseline tree --states` was run in the throwaway corpus without git, so every state read "unverified"; the live run has git.
- Concurrency rules ACRV-026 and ACWD-005 share the compare-and-set of ACDC-022 and were not raced separately.
- BL-11: the write path does not lint (the count is computed when `status` is read), so there are no write-time warnings to list. In the throwaway run `rules_with_impl_detail=0` of 95 rules (no tokens flagged).
