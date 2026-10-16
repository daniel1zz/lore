---
id: KN-699
type: knowledge
role: knowledge
title: "Proposals moved out of the defect channel (2026-10-16 audit, BR-1153)"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
## Overview

Feature requests and design proposals that were filed as defect reports and moved out of the defect channel on 2026-10-16 under BR-1153 (a report is only for a defect of lore itself). Current behaviour in each is not wrong or misleading; each is a candidate for a future spec. The original report keeps its full text and is resolved 'rejected' with a pointer here.

## Proposals

- #216 `task-gh-1343388703-216` — No way to edit a plan phase's description after tasks reference it
- #198 `task-gh-1343388703-198` — A rule proposed in a draft spec's change set cannot be corrected or withdrawn before it lands
- #76 `task-gh-1343388703-76` — No CLI or MCP read shows which criteria are exempted from the citation gate; lore status prints only a count
- #73 `task-gh-1343388703-73` — lore baseline map cannot point a site at another leaf's rule, so shared-command sites are filed as non-business 'owned-by' text
- #128 `task-gh-1343388703-128` — Audit rows record no write surface: dashboard and CLI/MCP writes are indistinguishable in the audit trail
- #108 `task-gh-1343388703-108` — Discarding a plan or a draft leaves no reason and runs no check: lore set --status deprecated skips every plan-close condition, and draft -> archived on knowledge needs no reason
- #232 `task-gh-1343388703-232` — lore worktree sweep has no plan/spec scope: a plan's worktrees cannot be cleaned up together when the plan closes
- #5 `task-gh-1343388703-5` — A resume ticket structurally cannot name the project goal: handoff has no goal anchor, and SCOPE CLOSURE explicitly excludes the one field that points at the root PRD
- #7 `task-gh-1343388703-7` — The escalate verdict has been overturned 17 times out of 17: it has never once produced a valid block, so it is pure cost
- #8 `task-gh-1343388703-8` — lore review --staleness ships a complete probe that has never run once: review_judgments.kind holds only review, and the audit trail has zero staleness rows
- #9 `task-gh-1343388703-9` — The judge confidence field is collapsed: 85 percent of all 580 judgments sit in exactly two buckets (0.7 and 0.8), so any threshold over it has almost no discriminating power
- #28 `task-gh-1343388703-28` — Task file anchors miss tests that pin exact asset/hook sets, so adding one asset turns out-of-anchor tests red mid-wave
- #165 `task-gh-1343388703-165` — Nothing typechecks a merge result before it lands, so two individually green branches can break main's build
- #166 `task-gh-1343388703-166` — plan-promote does not check that a removed channel's consumers are all inside some task's anchors
- `task-que-di-wu-ge-gate-dispatch-time-pai-subagent-shi-shi-qian` — 缺第五个 gate：dispatch-time（派 subagent 实施前无 claimed task）——四个 gate 全在 corpus 写入路径上，绕过 corpus 的工作零阻力
- `task-lore-setup-de-hook-ji-que-yi-tiao-zhuang-tai-zhuan-huan` — lore 全局纪律缺一条：「绝不屏蔽 lore 自身输出」应进 governance corpus-workflow 资产（原建议的 hook 方案已作废）
- `task-lore-verify-wu-kua-task-de-attestation-fu-yong-tong-head` — lore verify 无跨 task 的 attestation 复用：同 HEAD 同命令重复执行
- `task-lore-assess-jin-kao-commit-message-pi-pei-guan-lian-task` — lore assess 仅靠 commit message 匹配关联 task，未利用已声明的 file_anchors
- `task-scoped-oracles-cannot-verify-integration-reachability-an` — Task-scoped oracles cannot verify integration reachability: an AC passes green while its deliverable is dead code
- `task-no-gate-arms-the-doc-code-drift-oracle-a-spec-whose` — No gate arms the doc-code drift oracle: a spec whose implementation merged with zero code_anchors passes every existing gate
- `task-design-setup-must-be-a-brownfield-aware-completeness` — Design: setup must be a brownfield-aware, completeness-guaranteed onboarding orchestrator (skill-driven), not a silent file-copying CLI step
- `task-lore-set-content-file-silently-accepts-a-replacement-that` — lore set --content-file silently accepts a replacement that deletes most of a document, with no volume-delta warning and no confirmation
