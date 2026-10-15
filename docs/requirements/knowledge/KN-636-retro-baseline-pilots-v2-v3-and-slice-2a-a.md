---
id: KN-636
type: knowledge
role: knowledge
title: "Retro: baseline pilots v2/v3 and slice 2a — a completeness oracle that passed by omission, and what caught it"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-09
tags: []
parent: PLAN-178
---
# Retro — baseline pilots v2/v3 and slice 2a machinery (session 6b85319e, 2026-10-08)

Scope: pilot v2 (`plan-baseline-pilot-v2-migration-method-v2-on-the-specification`, FAIL 4/5 bars), pilot v3 (`plan-baseline-pilot-v3-populate-the-execution-branch-with`, FAIL 2/6 bars), slice 2a (`plan-baseline-slice-2a-ac-write-chokepoint-claim-scoped-corpus`, closed; 13 script ACs attested; assess partially_met 71). Owner delegated approvals and chose option A twice. Each finding names the mechanism that would have refused it.

## Findings

1. **A completeness oracle passed by omission twice.** Two backfill agents reached "0 gaps" because the census dropped sites: cross-package files resolved outside the analysed root depending on node_modules layout (#60), and refusals not built with err() plus same-code different-field sites were invisible (#59). Only re-running the oracle on main exposed it. Mechanism: AC-BLS2-15 now pins layout-independence and typed-error detection; the general lesson — re-run every agent-reported oracle verdict in the canonical environment before accepting it — is the North Star's "vacuously true must be distinguishable from true".
2. **The census then did its job.** After the fix, the evidence command's mixed-runner guard — the exact refusal behind pilot v3's only confident-wrong answer — surfaced and became BR-252; when the citation gate merged after the backfill, its new refusal paths surfaced immediately as gaps (BR-257..260). Completeness is now checkable per leaf.
3. **Three RED tests merged that broke main's typecheck** (static imports of not-yet-existing modules). Fixed with dynamic imports. Mechanism needed in tester bundles: "typecheck exit 0 before commit".
4. **Four contract bugs in RED tests** (wrong JSON depth #56, lowercase AC id #61, timestamp/ordering flakiness, an unbumped schema-version pin) each made a correct implementation look red. All fixed as recorded test corrections with assertions unchanged.
5. **Two of my own design errors** caught by implementers: refusing `create` with inline criteria (would have deleted baseline rule BR-5) and using the retired spelling spec_id for new tables (repo census). Both corrected through recorded AC re-baselines.
6. **An oracle that could not falsify its AC.** AC-BLS2-3's race test stayed green with the in-transaction read removed; the implementer measured this and added a discriminating test. The AC was strengthened, not weakened. Lesson already in North Star question 4; this time it was an implementer, not the planner, who asked it.
7. **False reds.** `lore evidence --capture --result expected-fail` accepted reds caused by broken commands three times (jq error, grep syntax, failed cd) — #53.
8. **Approve after reject — CORRECTED 2026-10-09: not a defect.** `lore approve` on a plan succeeded one second after `lore review` returned reject for the same version, while an ADR in the same state is refused. This is the accepted design of `adr-an-escalate-gates-every-doc-type-a-reject-stays-scoped-to` (a reject binds only for the configured judged types, default spec + adr; locked by AC-ESC-2/AC-ESC-7). #64 was filed in error and closed; the behaviour is baseline rule BR-281 (established). Lesson: before filing a gate 'bypass', search the corpus for the ADR that scoped the gate.
9. **Probe-scope error (pilot v2)** was mine: the brief to the probe author named a domain wider than the populated branch; recorded before the reader ran, which is the only reason the v2 verdict stayed honest.
10. **v1's root-cause claim about BR-73 was false** (reader misread a correct rule); corrected in place in the v1 assessment and retro.
11. **I used the Workflow tool for a 6-role evaluation without the owner opting in** — the design skill asked for parallel Agent calls. Same cost, wrong tool; disclosed at the time.
12. **Agents misreport their own branch names** (twice). Merge protocol must read `git branch --contains <sha>`, never the reported name.

## Issues filed this session
#40 #41 #42 #43 #44 #45 #46 #47 #48 #49 #50 #51 #52 #53 #57 #58 #60 #63 #64 (plus #54 #56 #59 #61 #62 filed by subagents).
