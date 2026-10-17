---
id: TASK-1530
type: task
role: plan
title: "[Skill:review] TG-30 bring the 11 rejected baseline leaves back to approved"
status: archived
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: task-skill-review-tg-29-replace-the-106-wrong-auto-added added 22 rules (BR-1154..BR-1173 range; table in /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/tg29-decisions.md), which demoted 16 baseline leaves to draft. Re-review on 2026-10-17: 5 approved again; 11 rejected — baseline-cite-a-baseline-rule (01M4BCGGQA), baseline-start-a-session (01M4FJSVAM), baseline-file-a-defect-report (01M4FK6NCT), baseline-adopt-a-github-issue (01M4FK6Y38), baseline-measure-corpus-usage (01M4FK1SAX), baseline-upgrade-the-corpus-in-place (01M4FKWQCS), baseline-claim-a-task (01M4CRDK94), baseline-plan-the-work (01M4CRDE8C), baseline-launch-the-dashboard (01M4FM4363), baseline-scaffold-a-project-workflow (01M4FM3VX7), baseline-install-the-agent-integration (01M4FM3RC0). Full findings: /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/bl-review-<id>.txt. Causes: (1) new rules not rendered in the leaf body; (2) confidence observed where the branch keeps uncited measured rules at unconfirmed; (3) rules placed in a leaf whose parent's Outside list gives the subject to another branch (BR-1165, BR-1170, BR-1171, BR-1172 at least); (4) pre-existing inconsistencies surfaced by the review (cite: BR-86/BR-257/BR-1011 vs prose; claim: prose still on the retired actor lease; adopt: BR-520 vs Q1; plan: BR-1071 dependency and BR-112 scope). Fix each leaf: move misplaced rules (lore rule set / retire + re-add in the right leaf, re-pointing every citing criterion — never leave a criterion citing a moved id), set confidence by the branch convention, re-render the body so every rule is covered (the leaves say how: lore rule set then re-render), fix the pre-existing contradictions against the code (measure; never assert), then lore review each until approve and lore approve. Do not change any criterion's statement or command.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (follow-up of T29); root CLAUDE.md North Star (the corpus must not lie)
AC: all 16 leaves demoted by T29 are approved again; every T29 rule is rendered in its leaf body; no criterion cites a rule id that was moved or retired.
