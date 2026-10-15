---
id: KN-616
type: knowledge
role: knowledge
title: "Historical execution debt cleanup 2026-10-10: 68 archived, 25 tasks and 15 plans deprecated, baseline and specs kept"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
---
Historical execution debt cleanup, 2026-10-10 (owner: "我们其实关键的是 Baseline，其他很多都是历史执行", then "全部归档/弃用，保留 baseline 和 spec", then "可以都抛弃"). Under ADR adr-the-product-is-a-baseline-tree-specs-are-implementations the product is defined by the baseline tree; plans, tasks and handoffs are execution history. Nothing was hard-deleted: archived/deprecated docs stay readable and counted.

## What was done
| Item | Count | Transition | Note |
|---|---|---|---|
| Expired handoffs and archive candidates | 68 | archived | `lore archive --apply` (tool-judged) |
| Open draft tasks of the 15 old plans | 25 | draft -> approved -> deprecated | draft cannot go to deprecated directly; archiving would read as "done", so not used. One task held a 45-day-stale claim by agent:worktree-agent-ad35e1fa2ebd602b9; deprecated on the owner's "可以都抛弃", claim not released |
| Old plans with abandoned tasks, plus pilots v2/v3 | 11 | deprecated | work not finished; remaining needs live as open issues |
| Old plans whose tasks were all archived | 4 | deprecated (should have been archived) | slice-1, claude-md-root-section, context-fragments, close-the-read-side: plan-close refused on ASSESSMENT_STALE (+ PRD_OUTLINE_NOT_SYNCED for two); I deprecated instead of re-assessing. **Read these 4 as COMPLETED, not abandoned.** Deprecated is terminal, so the label cannot be corrected |
| Old knowledge drafts (pre-2026-10-07) | 14 | draft -> archived | |
| Old ADR/spec drafts | 10 | reviewed | 4 approved; 6 stay draft (2 rejected, 2 escalated, 2 blocked by an earlier reject/escalate judgment on the same version): adr-a-guard-does-not-exist-until-it-runs-against-the-real-tree, spec-declaring-ac-scope-is-required-at-task-creation-so-the, spec-spec-ac-quantifiability-gate-design-time-standardization-en, adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own, adr-distribution-first-every-improvement-names-its-consumer, adr-product-skill-chain-derive-features-via-ost-execute-graded |

## Deliberately kept
- 721 uncited legacy criteria: they are the specs' running checks; the citation gate refuses only added/revised ones.
- 98 gh-intake draft tasks: projections of open issues.
- 643 rules without a live script-mode citation (unconfirmed/undecided): baseline's own open work, not history.
- 31 drafts created during the baseline migration (probes, assessments, pilot logs): the evidence records of SPEC-157's rubric criteria.
- 121 baseline nodes: to be reviewed and approved once #107 lets the judge see their rules.

## Gaps this exposed
- `lore set --status deprecated` on a plan applies no plan-close check at all, and draft -> archived on a knowledge doc likewise: both are legal by VALID_TRANSITIONS, so "discard" leaves no reason anywhere but this record.
- An earlier reject/escalate judgment on a version blocks approval even after a later approve on the same version (2 ADRs above).
