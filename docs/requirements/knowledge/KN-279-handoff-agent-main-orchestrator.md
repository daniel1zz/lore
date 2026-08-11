---
id: KN-279
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- assets/hooks/pre-bash-git-safety-gate.mjs
- packages/lore/src/adapters/real-setup-fs.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Handoff-46 fully dispositioned. NS1+NS2 landed and attested (AC-GS 8/8, AC-SL 8/8), both plans assessed and archived. NS4 branch retired. NS5 archive applied, 6 stale reviews processed. NS6 deferral re-grounded on measurement. | 95 |
| KD2 | The ticket's NS1 root cause was WRONG, corrected in the spec: not quote-blanking but probeStash(_inner) never reading its argument. The UNQUOTED case over-reported identically. Measured both ways before any code changed. | 95 |
| KD3 | The fix closed a pre-existing UNDER-BLOCK nobody had found: a single-quoted double quote pairing with a later quoted token swallowed the separators plus a git reset --hard, exit 0. Safety gate reported success while the danger passed. Spec D6 + AC-GS-8. | 95 |
| KD4 | My claim that a judge's reject is always gate-enforced was FALSE. judgment_required_types defaults to [spec,adr], so knowledge approves regardless. An escalate carrying 3 owner-facing blocking questions got filed as approved. My wrong premise, not a lore defect. | 90 |
| KD5 | Two major assess gaps on AC-SL-7 are REFUTED: tsc --listFiles proves the type fixture is inside the tests project, so its 9 @ts-expect-error directives make typecheck discriminating. Judge ran diff-blind. Correction appended, judgment left intact. | 90 |
| KD6 | Full suite at 29376a9: vitest 6959 pass / 0 fail; bun 1629/1630. The one failure was the stale-binary mtime guard tripped by a concurrent session committing MID-RUN; green 5/5 after rebuild. No regression from either merge. | 92 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS3 needs the OWNER's shell (git-safety gate refuses it, correctly): drop the stash entry at index 0 — a redundant copy of the settings.json hook registration, byte-identical to commit 46e1157, cmp-verified twice.
- NS2: Answer the 3 blocking questions from the escalated grill-review doc that my approval filed away: (1) does its Decision 4 auto-approve supersede parent PRD G9's data gate or wait for Decision 3 trace data; (2) should Decisions 1+4 (freezing PRD-committed G5/G6, positioning change) land as ADR/PRD amendment; (3) how is writer-not-approver decided once actor derives from the worktree branch.
- NS3: Editorial fix only: knowledge-dashboard-human-friendliness-evaluation-2026-07-28 title says five direction verdicts, body enumerates six. Judge rejected on this alone and called the substance strong.
- NS4: Open SL-assessment recommendation: make AC-SL-8's floor test print observed-vs-floor counts. The tail shows only '1 passed | 20 skipped', so monotonic-floor vs exact-total is undecidable from the record, and an exact total already drifted once in that spec's history.
- NS5: Stale worktree fullsuite-wt (session 495922ce, dead ~23h) holds one dirty assets-manifest.ts build byproduct. Non-force removal refuses it correctly; clearing needs --force, which the git-safety gate blocks. Owner's shell or explicit authorisation.
- NS6: Policy question for the owner: should judgment_required_types include knowledge? Today a reject or escalate there is advisory in the strictest sense and an escalate's blocking_questions are silently filed. Deliberate design, so a decision rather than a bug.
