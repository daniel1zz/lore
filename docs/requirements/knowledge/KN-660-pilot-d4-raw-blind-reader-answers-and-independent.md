---
id: KN-660
type: knowledge
role: knowledge
title: "Pilot D4 raw: blind reader answers and independent grading"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: [baseline, pilot]
parent: KN-655
links:
  - {id: PLAN-172, type: informs}
---
# Pilot D4 raw: blind reader answers and independent grading

## Grading

## [D4] Pilot grading: specification & acceptance probe set

Verdict: FAIL. Score 8/10, 2 confident-wrong (bar: >= 9/10 and 0 confident-wrong).

### 1. Truth audit (against current main, throwaway corpus at mktemp dir, never the repo corpus)
| Q | Frozen truth | Status | Evidence |
|---|---|---|---|
| 1 | refused a,b,c,e,g; accepted d,f | CONFIRMED | CLI: spec under spec -> "Invalid parent type"; no parent -> "require a parent"; kind research -> enum error; anchor nonexistent/f.ts created; /abs/f.ts -> "must be repo-relative" |
| 2 | "## Notes" accepted; only-h3 refused | CONFIRMED | "### only" -> gate MISSING_SKELETON; "## N" created |
| 3 | in-review allowed; approve refused (floor 1) | CONFIRMED for approve; in-review UNVERIFIABLE now | `lore gate spec-promote --spec spec-sdom` (domain-overview, 0 ACs) -> 'has no structured acceptance criteria (needs >= 1 for spec_kind "domain-overview")'. My `lore set --status` was blocked by the session hook, so the in-review half was not re-run. Code: gate-predicates.ts:962 DEFAULT_MIN_ACS = 1, :1004 `profile?.min_acs ?? DEFAULT_MIN_ACS` |
| 4 | ac rm refused w/o --force; force leaves dangling evidence, spec stays approved | CONFIRMED by code and prior CLI run only | not re-run (needs approved spec plus task evidence); ac-service.ts header invariant unchanged |
| 5 | only (c),(d) demote | CONFIRMED by code | ac-service.ts:756 `resolveStatusAfterContractEdit(spec.status, true)` in setCriterion path; add/remove do not demote |
| 6 | rewrite accepted; refused first at approval | CONFIRMED | `lintAcQuantifiability` is called once, in addCriterion (ac-service.ts:349); no call in the set path |
| 7 | only (5) refused | CONFIRMED | CLI: AC-1,2,3,4,6 added; AC-5 "It is Secure" -> 'abstract word "secure" has no measurable anchor'. "Section 3 ..." added because the digit counts as an anchor |
| 8 | (ii),(iv) refused | CONFIRMED | CLI: ai "judge it holistically" refused; ai "at most 3 reviewers disagree" added; human refused; script lint added |
| 9 | partial mutation refused; full mutation on human silently dropped | CONFIRMED (still unfixed on main) | CLI: human AC with 4 falsifier flags -> added; `lore get --json` shows verify {mode: human} only. Partial case not re-run (prior CLI run + schema) |
| 10 | missing test path refused; --allow-missing-path reason; same on edit | CONFIRMED (add path) | CLI: 'names path(s) that do not exist yet ... pass a non-empty --allow-missing-path'. Edit path by code (findMissingOracleFiles, ac-service.ts:842) |

Stale: only code line numbers cited in the truth (ac-service.ts :342/:507/:946 etc. have moved; e.g. lint call is now :349, status demotion :756). No answer content went stale from the later cites/ac cite/create-guard/evidence-stamp merges. The truth's "prose conflicts" (rule text omits domain-overview, "works" vague verbs, domain-overview "no AC requirement") remain true of the code.

### 2. Per-question grading
| Q | Grade | Note |
|---|---|---|
| 1 | CORRECT | all 7 parts right, HIGH |
| 2 | CORRECT | both parts right |
| 3 | WRONG (confident-wrong) | said approve ACCEPTED with HIGH, citing BR-73 "min 0 for domain overview". Code default floor is 1; approval is refused. In-review part: "NOT ANSWERABLE" (NOT-ANSWERED half). Root cause: baseline BR-73 repeats the spec-kind.ts prose, not the code |
| 4 | CORRECT | refused; override removes, evidence dangling, spec stays approved |
| 5 | CORRECT | c,d demote; a,b stay approved |
| 6 | CORRECT | not refused; refused at approval |
| 7 | WRONG (confident-wrong) | refused (2) AND (5) at MEDIUM-HIGH. (2) is accepted because "3" is a measurable digit anchor; reader missed the digit rule. It hedged that the question wants a single one, yet still committed (2) as refused |
| 8 | CORRECT | ii and iv refused |
| 9 | CORRECT | partial refused; full-on-human accepted and silently discarded (BR-59 matches code) |
| 10 | CORRECT | refused without reason, accepted with reason, same on edit; "depends on route" hedge is immaterial |

The reader beat the frozen truth nowhere. It did flag honestly that the baseline lacks the full abstract-word list and the review branch (Q3), but those were not the cause of its errors.

### 3. Score
8.0/10 (8 CORRECT, 0 PARTIAL, 2 WRONG). Confident-wrong: 2 (Q3, Q7).
Discriminating questions (reader failed): Q3 (baseline rule BR-73 contradicts code, a baseline defect) and Q7 (the digit-anchor rule is missing or underweighted in BR-18 and the glossary). Q6 and Q9 also targeted prose-vs-code traps and the reader passed both, because the baseline captured those correctly (BR-37, BR-59).

### 4. Pre-registered bar
Pass only if score >= 9/10 AND 0 confident-wrong. Got 8/10 and 2 confident-wrong: FAIL on both conditions. The failure traces to two baseline-content defects (BR-73 default floor; BR-18 digit-anchor rule), not reader misbehaviour. Fix them in the baseline (and verify BR-73 against gate-predicates.ts:962/:1004) before any re-run; the probe set is frozen and must not change.

### 5. Probe-set timestamp (AC-BLS1-11 rubric b)
Probe doc created_at 2026-10-07T13:00:21.794Z; min created_at of type='baseline' docs 2026-10-07T14:33:02.943Z. The probe set precedes every baseline doc by about 1h33m: PASS.

## Reader answers

## Blind Reader Report: Specification & Acceptance Baseline

**Pilot Task [D4]** — Answers based solely on lore product baseline documents (specification & acceptance branch).

---

### Answers

#### Question 1: Which attempts to create a specification are refused or accepted?

(a) placing it under another specification — **REFUSED**  
(b) placing it under an architecture decision record — **REFUSED**  
(c) giving it no parent at all — **REFUSED**  
(d) placing it under a product requirements document with "narrative domain overview" kind — **ACCEPTED**  
(e) placing it under a product requirements document with made-up kind "research" — **REFUSED**  
(f) placing it under a product requirements document and declaring a code anchor on a source file that does not exist yet — **ACCEPTED**  
(g) same as (f) but anchor path begins with slash — **REFUSED**  

**Rule IDs:** BR-1, BR-2, BR-3, BR-65, BR-63  
**Confidence:** HIGH  

---

#### Question 2: Body structure and heading level requirements

*Part 1:* A body with exactly one section heading titled "Notes" and no other sections — **ACCEPTED**  
*Part 2:* A body whose only heading is a third-level heading — **REFUSED**  

**Rule IDs:** BR-4  
**Confidence:** HIGH  

**Notes:** BR-4 requires "at least one second-level section heading". A "## Notes" heading satisfies this; a third-level heading alone does not.

---

#### Question 3: Domain overview with zero criteria in fresh project

Can it be moved to "in review"? — **NOT ANSWERABLE** (review branch not populated; status transitions outside this branch)  
Can it be approved? — **ACCEPTED**  

**Rule IDs:** BR-72, BR-73  
**Confidence:** HIGH for approval; N/A for review transition  

**Notes:** In a fresh project, domain overview has minimum criteria count 0 (BR-73). This permits approval with zero criteria.

---

#### Question 4: Withdrawing a criterion with recorded evidence

Without override — **REFUSED**  
With override — **Accepted; criterion removed; evidence left untouched (becomes dangling); spec stays approved**  

**Rule IDs:** BR-46, BR-47, BR-48  
**Confidence:** HIGH  

---

#### Question 5: Actions that return an approved spec to draft

(a) adding a new criterion — **stays approved**  
(b) withdrawing a criterion that has no evidence — **stays approved**  
(c) rewriting an existing criterion with text identical to what it already says — **returns to draft**  
(d) changing only which product requirements an existing criterion covers — **returns to draft**  

**Rule IDs:** BR-25, BR-48, BR-38, BR-81  
**Confidence:** HIGH  

**Notes:** BR-81 states approved specs stay approved when criteria are "added or withdrawn" but "return to draft when a criterion is revised". Parts (c) and (d) are revisions.

---

#### Question 6: Rewriting approved criterion to unmeasurable wording

*Part 1:* Is the rewrite refused? — **NO, the revision is accepted**  
*Part 2:* At what first point does the system refuse this wording? — **At approval time**  

**Rule IDs:** BR-37, BR-74, BR-81  
**Confidence:** HIGH  

**Notes:** BR-37 states "Revising does not re-check abstract wording... the revision is accepted; the approval check refuses it later." The spec returns to draft upon revision (BR-81); attempting re-approval then fails BR-74.

---

#### Question 7: Which single criterion statement is refused by wording check?

*Assuming human-checked criteria:*

1. "The fast-path cache is used" — **ACCEPTED** (no whole-word abstract match)  
2. "Section 3 is simple and elegant" — **REFUSED** (abstract words "simple", "elegant")  
3. "Latency is low" — **ACCEPTED** ("low" not in abstract word list)  
4. "The export works" — **ACCEPTED** (no abstract word)  
5. "It is Secure" — **REFUSED** (abstract word "secure")  
6. "Output is secure-by-default" — **ACCEPTED** ("secure" not a whole word)  

**Rule IDs:** BR-18  
**Confidence:** MEDIUM-HIGH  

**Notes:** The baseline glossary lists abstract quality words. The rule requires whole-word matching. Statements (2) and (5) are refused; if the question expects only one, clarification is needed. Per BR-18, abstract words in person-decided or AI-judged criteria without measurable anchors are refused.

---

#### Question 8: Four ways to declare "Simple and elegant" — which are refused?

(i) by runnable command — **ACCEPTED**  
(ii) by AI judge, guidance "judge it holistically" — **REFUSED**  
(iii) by AI judge, guidance "at most 3 reviewers disagree" — **ACCEPTED**  
(iv) by human sign-off — **REFUSED**  

**Rule IDs:** BR-18, BR-19  
**Confidence:** HIGH  

**Notes:** BR-19 exempts checks from wording refusal. BR-18 requires measurable anchors in statement or (for AI) rubric. "Holistically" has no anchor; "at most 3" provides one. Person-decided lacks any anchor.

---

#### Question 9: Falsifier mutation handling

*Part 1:* Only target file supplied on check-decided criterion, other three fields omitted — **REFUSED**  
*Part 2:* Full falsifier on human-checked criterion: at declaration time — **ACCEPTED**; what is stored — **nothing (silently discarded)**  

**Rule IDs:** BR-52, BR-59  
**Confidence:** HIGH  

**Notes:** BR-52 requires all four parts together. BR-59 states a falsifier supplied when declaring person-decided or AI-judged criteria is silently discarded at declaration (defect filed).

---

#### Question 10: Test file that does not exist yet

Is it accepted as declared? — **Depends on route; without a reason: REFUSED (command-line); with a reason: ACCEPTED**  
Way to declare it anyway — **Supply a non-empty reason** (e.g., "red-first")  
Does same rule apply when editing? — **YES**  

**Rule IDs:** BR-21, BR-36  
**Confidence:** HIGH  

**Notes:** BR-21 ("prompt-only" = command-line only) refuses missing test files unless author supplies a reason. BR-36 confirms the same check applies when revising a criterion's command.

---

### Gaps and Assumptions

#### Critical Gaps in Documents

1. **Review status transitions** — Question 3 asked whether an approved spec can be moved to "in review". The specification branch only covers "approved" status; transitions from draft/in-review/active are not specified here (owned by the review branch, not populated in this pilot).

2. **Project configuration not provided** — Some rules refer to per-project settings (minimum criteria counts, required check kinds, gate switches). The baseline assumes defaults but doesn't describe how they're configured. Question 3 depended on whether "fresh project" defaults exist.

3. **Abstract quality word list incompleteness** — The glossary lists abstract words but may not be exhaustive in all languages and contexts. Question 7's precision hinges on exact list membership (is "low" or "optimal" in the list?). The baseline says "from a fixed product list" but doesn't specify the full list.

4. **Interaction with archived/terminal specs** — Several rules note that archived/deprecated specs can have criteria added/withdrawn/revised, but whether this is intended or a defect is marked "undecided" (BR-80, open questions Q2 of Withdraw and Revise leaves). Behavior is defined but intent unclear.

5. **Evidence scope** — BR-46 (withdraw guard) only looks at tasks in plans under the spec. Ad hoc tasks outside plans are not protected. Baseline notes this as a "known gap" but doesn't close it.

#### Assumptions Made

1. **"Checked by a human" ≡ person-decided criterion** — Question 6-8 used "checked by a human" and "sign-off"; I mapped these to "person-decided" mode, which is distinct from "AI judgment" and "check".

2. **Fresh project ≡ new-project defaults** — Question 3 asked about "no custom configuration". I assumed this means the stated new-project defaults apply: domain overview minimum 0, feature/tech/design minimum 1.

3. **Wording check applies only to person-decided and AI-judged** — BR-19 explicitly exempts check-decided criteria from wording refusal. I assumed this is absolute.

4. **"Revision" includes any criterion part change** — Questions about "rewriting" a criterion: I interpreted this as any revision, including statement-only changes, because BR-38 says "Revising any part" returns approved specs to draft.

5. **"Accepted as declared" ≡ the action succeeds, creating/revising the object** — Baseline distinguishes between declaration succeeding but parts being silently discarded (BR-24, BR-59) and the action itself being refused. I followed that distinction.

6. **No merging of concurrent edits** — BR-27 and BR-44 state conflicts are resolved by refusing the stale writer, never merging changes.

7. **Citation is report-only in this slice** — BR-84 confirms approval ignores citations (slice 1 behavior). Target behavior (ADR-041) will require citations to live rules.

---

### Questions Asked But Unanswered by Baseline

#### For Product/Owner

1. Is a domain overview genuinely allowed zero criteria, or is the 0-minimum a configuration default that should be changed?
2. Should kind changes (e.g., feature → design) re-trigger approval checks, or is a kind change meant to be non-substantive?
3. Does the asymmetry hold: approved specs stay approved when criteria are added/withdrawn, but return to draft on revision? Why?
4. Should criterion ids be project-wide unique, or spec-scoped unique (as today)?
5. Should specs that are archived/deprecated refuse new/modified criteria, or is editing terminal specs intended?

#### For Engineering

1. Why is wording not re-checked on revision (BR-37), leaving approval as a backstop? Is this a permanent design or a simplification for now?
2. BR-59 (falsifier silently discarded on person-decided) is filed as a defect. Should both declare and revise refuse it?
3. BR-82 (direct status-to-approved skips review judgment): is this a gap or intended?
4. Evidence guard (BR-46) only looks at planned tasks. Should ad hoc task evidence also block withdrawal?

---

### Document Validity Status

All baseline documents read were marked `status: draft` and `validity_status: {invalidated: false}` as of 2026-10-07. No rules were flagged as invalid or deprecated during reading.

---

**End of Report**
