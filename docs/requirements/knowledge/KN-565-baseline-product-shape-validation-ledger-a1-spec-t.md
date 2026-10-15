---
id: KN-565
type: knowledge
role: knowledge
title: "Baseline product shape — Validation Ledger (A1 spec-to-leaf fit, A2 cold reader, A3 baseline vs corpus)"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: [baseline, validation-ledger, product-shape]
parent: ADR-041
links:
  - {id: ADR-041, type: implements}
---
# Baseline product shape — Validation Ledger (2026-10-07)

Governs: `adr-the-product-is-a-baseline-tree-specs-are-implementations`. **Numbering note**: ADR decision numbers cited in this ledger ("decision 9–10", "decision 11", "decision 12") are the ADR's numbering at v8; the ADR (v11+) restates them in final form — old 3 (ACs must cite rules) → final 5, old 9+10 → final 3, old 11 → history, old 12 → final 5 (see the ADR's Decision history). Raw data: child doc `knowledge-baseline-validation-raw-data-a1-a5-tsvs-probes-and`. Run inside `/lore-product prd` Phase 1A → validate, before the PRD body. Kill conditions were written before each run and are unchanged. Raw artifacts (scratch, not committed): experiment dir `scratchpad/exp/` of session 6b85319e — `mapping/a1.tsv`, `mapping/a1-rerun.tsv`, `leaves/specification/*.md`, `probes/{questions,answers,reader-leaf,reader-corpus,grading}.md`.

Evidence tier note: lore's users include AI agents; agent behaviour observed in a controlled run is graded E1 for agent-user claims. Nothing here measures human users.

## Assumption map

| # | Assumption | Importance | Prior evidence | Order |
|---|---|---|---|---|
| A1 | Existing specs each hang under one business-point leaf | High | none | 1st |
| A2 | A leaf written by the method lets a cold reader predict behaviour correctly | High | none | 2nd |
| A3 | Baseline answers "what are the current rules of X" better than today's corpus | High | none | 3rd |

## Ledger

| # | Claim | Experiment | Kill line (pre-set) | Result | Tier | Verdict |
|---|---|---|---|---|---|---|
| A1 | Every live spec maps to exactly one business point | Agent classified all 164 live specs into ONE / MULTI / NONE / NOT-PRODUCT against the 12 owner-approved branches | < 70% ONE | Run 1: 83/164 = **50.6%**. Run 2 (fresh agent, corrected bucket definition — see re-baseline note): 99/164 = **60.4%** | E1 | ❌ **refuted as specified** |
| A1b | Spec→leaf placement can be decided by an agent reproducibly | Same 164 specs, two independent agents | (not pre-set — derived finding) | Bucket agreement **107/164 = 65%**; of 70 specs both called ONE, same branch 60/70 = 86%. Run 2 put `spec-review-workflow` in NONE | E1 | — observed (no pre-set bar; not a verdict) |
| A2 | Cold reader with only the leaves predicts behaviour | Drafted `specification` branch (7 leaves, 69 rules) from code; independent agent set 10 boundary probes with code-verified truth; blind reader saw leaves only; independent grader audited truth then graded | leaf reader < 8/10 | **10/10** (strict: 9/10), 0 confident-wrong. Reader still raised 32 gap questions and 10 assumptions | E1 | ✅ validated (one branch, n=10) |
| A3 | Baseline beats today's corpus on the same questions | Control reader used only `lore search/get/list` | leaf reader not > corpus reader | Corpus reader **8/10, 2 confident-wrong** (Q3 stale SPEC-002 parent table; Q5 read schema, missed the quantifiability lint), self-reported "no contradictions" | E1 | ✅ validated (margin 2/10, one branch) |

### Re-baseline note (A1 run 1 → run 2)
- Original instruction: bucket NOT-PRODUCT = "describes this repo's own dev process rather than lore-the-product".
- Exact failure: run 1 placed 53 specs in NOT-PRODUCT, including shipped product behaviour (gates, evidence/attestation integrity, falsifiers, verify, assess, git-safety gate, audit trail, bootstrap injection) — lore's product IS governance tooling.
- Why a correction, not a weakening: the kill line (70%) did not move and both results are reported; only the bucket definition was clarified to "exists ONLY to build/test this repository and never reaches a consuming project". A fresh agent re-ran without seeing run 1. The corrected run still fails the bar.

## What the results mean

1. **"Every spec hangs under a business leaf" fails as stated.** Both runs show a stable class of purely technical specs (adapters, schema, storage engine, sync, telemetry, layering; 22 specs NONE in both runs) with no business point. The owner then decided (ADR decision 9–10) that technical architecture is a separate tree following `everything-workspace/architecture/`. That reshaped rule — *behaviour specs hang under a baseline leaf, technical specs under the architecture tree* — is derived from these results and is **⚠️ unvalidated**: re-measure before it becomes a gate.
2. **Placement cannot be left to agent judgment.** 65% inter-agent agreement means a re-parent sweep run by agents would produce a different tree each time. The 164-spec migration needs an owner-adjudicated mapping (agents propose, owner disposes) or a mechanical criterion; a gate that asks "is this the right leaf" has no deterministic oracle yet.
3. **The leaf format works for answering, on this evidence.** Fresh, rule-id'd leaves beat the corpus on boundary questions, and the corpus's two misses were silent (confident, "no contradictions"). Caveat: the leaves were written minutes before the test, so this measures a fresh baseline vs an aged corpus — it does not show the baseline stays fresh. Freshness has to come from mechanism (spec ACs must cite live rule ids; a rule change surfaces dependent specs), not from the format.
4. **Confidence 🟡 does not fire on excavated rules.** All 69 drafted rules came out 🟢 (code is ground truth for "what it does today"); every real uncertainty ("is this intended?") landed in Open questions (28). The Undecided/Unconfirmed split is useful for NEW requirements, not for excavation — the design must say where "current behaviour, intent unconfirmed" lives.
5. **"No implementation detail" is hard to hold for lore.** Lore's business vocabulary is technical (files, tests, exit codes, commands, anchors). The drafter recorded 8 concrete places the boundary blurred (anchor paths are domain objects; quantifiability rule is a heuristic; format limits; enforced_by across CLI/agent/web routes; refusal messages; exit codes; config switches; 🟡 not firing). The design needs an explicit lore-specific boundary rule, e.g. "the user's files are domain objects; lore's own files are implementation".

## A4 — two-tree placement re-test (owner chose "re-measure now", 2026-10-07)

Rule under test (reshaped after A1): a behaviour spec hangs under a baseline leaf, a technical spec under the architecture tree (ADR decisions 9–10). Two fresh agents (X, Y) classified all 164 live specs with identical instructions (`exp/two-trees.md` + `exp/branches.md`), blind to each other and to A1.

| # | Claim | Kill line (pre-set) | Result | Tier | Verdict |
|---|---|---|---|---|---|
| A4a | Every spec gets exactly one home in one of the two trees | < 90% placed, per agent | X 150/164 = **91.5%**, Y 162/164 = **98.8%**; 0 UNPLACEABLE in both | E1 | ✅ validated |
| A4b | Two agents agree on which tree | < 85% agreement | **109/164 = 66.5%** (A1 was 65%); 41 of 55 disagreements are BASELINE↔ARCH | E1 | ❌ refuted |
| A4c | (reported, no bar) branch agreement where both said BASELINE | — | 59/86 = 69%; leaf names free-text so leaf agreement is not measurable (0 exact) | E1 | — |
| A4d | (reported, no bar) section agreement where both said ARCH | — | 17/22 = 77% | E1 | — |

Sampled disagreements include placements that are plainly wrong on one side (e.g. the PRD-outline spec placed under replica sync; a test-timeout-budget spec under browser-safety), so the issue is not only a fuzzy boundary but unreliable judgment.

**Meaning.** The two-tree rule is sound as a *space* — almost every spec has a home. It is not *decidable by agent judgment*: placement by reading a spec and choosing is not reproducible (≈ 66% in both independent pairings: A1 run 1 vs run 2 65%, A4 X vs Y 66.5%). A gate or a migration that relies on "an agent decides where this spec goes" would produce a different tree per run. Placement needs a mechanical criterion. Candidate (derived, ⚠️ unvalidated): a spec's home is computed from what its ACs cite — rule ids of a baseline leaf → that leaf; rule ids of an architecture standard → that standard. That makes placement a consequence of decision 3 (ACs must cite rules) rather than a judgment.

## A5 — AC→rule mapping reproducibility (tests ADR decision 11)

85 ACs from the 10 live specs that earlier runs placed in the `specification` branch (`exp/a5-acs.tsv`); two fresh agents (P, Q) mapped each AC to a primary rule id from the drafted specification leaves, or NO-RULE / OUT-OF-BRANCH. Computed spec home = the leaf cited by ≥ half of the spec's ACs, else MOSTLY-ELSEWHERE.

| # | Claim | Kill line (pre-set) | Result | Tier | Verdict |
|---|---|---|---|---|---|
| A5a | Two agents name the same primary rule per AC | < 75% | **26/85 = 30.6%** strict. Post-hoc lenient reading (treat NO-RULE = OUT-OF-BRANCH, because Q used NO-RULE for other-branch ACs): 58/85 = 68.2% — still below the bar | E1 | ❌ refuted |
| A5b | Computed spec home agrees | < 85% | **8/10 = 80%** | E1 | ❌ refuted (n=10) |
| — | (reported) where both mapped an AC to a rule | — | same rule 24/35 = 69%; same leaf 31/35 = 89% | E1 | — |
| — | (reported) ACs that belong to another branch or to architecture | — | P: 43/85 out of branch + 4 generic typecheck/suite ACs; both agents: 6 of 10 specs are MOSTLY-ELSEWHERE | E1 | — |

**Confound.** Only one branch's rules existed, so every AC about execution / review / requirements had no rule to land on; the test could not compute a real home for 6 of 10 specs. A5 measures the mapping step, not a finished two-tree migration.

**What it shows.**
1. **A spec is not a leaf-shaped unit.** Even specs judged "specification" split their ACs across several branches (P: 51% out of branch). "One spec, one home" — under a parent edge — fights the data in every experiment (A1, A4, A5). The natural relation is many-to-many: each AC cites the rule(s) it verifies; the tree view of "what implements this leaf" is computed from citations, and a spec need not have a single parent.
2. **Leaf-level citation is reasonably reproducible, rule-level is not** (89% vs 69% where both mapped). Retroactive inference of exact rule ids is unreliable; citing at authoring time — when the author knows the intent — is a different, untested act.
3. **Generic quality ACs (typecheck, full suite green) verify no business rule.** They are architecture standards (build/test integrity), consistent with ADR decision 9.

## P1 — slice-1 pilot on the specification branch (hardened protocol), 2026-10-07

Source: `knowledge-pilot-assessment-baseline-slice-1-specification`. Bars pre-registered, none moved.

| # | Claim | Kill line (pre-set) | Result | Tier | Verdict |
|---|---|---|---|---|---|
| P1a | Two mappers agree on each AC's placement against a live, CLI-built branch (95 rules) | adjudicated > 30% | **42/85 = 49.4%** | E1 | ❌ refuted |
| P1b | A blind reader answers from the leaves alone; probe set frozen BEFORE the leaves, written by an agent that never saw them | < 9/10 or any confident-wrong | **8/10, 2 confident-wrong** — both caused by baseline content copying prose that contradicts code | E1 | ❌ refuted |

**Meaning.** A2/A3's advantage (10/10 vs corpus 8/10) did not replicate under the hardened protocol: the excavated baseline scored what the aged corpus scored in A3. Excavated rules inherit documentation errors unless each rule is backed by an executable citing AC; placement still lacks a written principle.

## Side findings (filed, not fixed here)
- issue #29 — `lore ac add` silently discards a falsifier on human/ai-mode criteria (exit 0). Reproduced by the main agent in a throwaway corpus.
- issue #30 — an archived spec still accepts new acceptance criteria (exit 0). Reproduced.
- issue #31 — `lore set` with identical content logs an empty version.
- Not filed (not independently reproduced): active spec not demoted on AC edit; kind change after approval not re-judged; generic edit route may replace the AC list wholesale.
- Not a defect: draft → approved directly is a legal fast-track transition; whether specs should be allowed it is an open product question.

## Carried into the PRD

| Requirement | Validation |
|---|---|
| Baseline tree as a first-class type holding current business rules with permanent ids | answerability: ✅ A2/A3 (fresh leaves, author had code) but ❌ P1b under the hardened protocol (8/10, 2 confident-wrong) — treat as NOT validated |
| The two trees together have room for nearly every spec (A4a: 91.5% / 98.8% placed) | ✅ validated as a SPACE only — it does NOT show a spec has exactly one home; A5 shows about half the ACs of a "specification" spec belong elsewhere |
| Placement decided by agent judgment | ❌ refuted (A4b: 66.5% agreement vs 85% bar) |
| Placement computed from the rule ids a spec's ACs cite, one home per spec | ❌ refuted as specified (A5a 30.6%, A5b 80%; confounded by single-branch rule set) |
| Many-to-many: each AC cites rules; leaf→implementations view is computed; no single spec parent | ⚠️ unvalidated (derived from A1/A4/A5) |
| Legacy migration by retroactive AC→rule inference | ⚠️ leaf-level 89% agreement, rule-level 69% — owner adjudication needed at rule level |
| Existing-spec migration by owner-adjudicated mapping | ⚠️ unvalidated; agent-only mapping ❌ refuted (A1b) |
| Spec ACs must cite live rule ids (gate) | 🎲 owner decision (ADR 3); freshness benefit unmeasured |
| Architecture tree per `everything-workspace/architecture/` | 🎲 owner decision (ADR 10) |
