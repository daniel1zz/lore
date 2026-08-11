---
id: KN-305
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-31
tags: []
parent: PRD-001
---
> ⚠ INVALIDATED 2026-07-28T13:08:59.802Z — superseded by knowledge-session-retro-2026-07-28-grill-to-shipped-three-specs; Retired at the user's direction: every next-step it listed was executed in the same session (test:changed gap refuted by measurement; ac-add defect refuted, replaced by the set -e finding; assess --diff applied to all three plans; per-task attestation resolved as existing-flag discipline; plus an assessment-driven hardening round). Its two time-dependent items — re-measure the trace never-read baselines, re-audit babyai post-migration — now live in the session retro.

# Handoff — agent:main-orchestrator

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| Judgment | Confidence |
|---|---|
| Grill 七项决策已全部落地为可运行机制:SPEC-102 trace(读/deny 可观测,已在三 corpus 实测)、SPEC-103 tiered review(ledger 自动落账 + 持久类 judgment 强制,已实战生效于本 session 的 retro 文档)、SPEC-104 worktree actor 自动推导。全量套件在干净隔离 worktree 上 vitest 全绿 / bun 1471-of-1475,4 个残留失败全部是并发 session 自标注的 F5a RED 测试,与本次三 spec 无关。@high | — |

## Failing Oracle

(none)

## Next Steps

- 1) trace 基线已录:lore 823/831 文档从未被读、guyin 161、babyai 432 — 两周后复测这三个数,看分层 review + feed 是否真的改变读消费(这是判断机制有效性的唯一数据依据,不要靠体感)。2) test:changed 仍有第二个欠选缺口:porcelain 路径 bug 已修并加回归测试,但传递性反向依赖闭包在 SPEC-103 上只选中 2 个文件(实际 ~161 消费者),需要一个 source→consumer 边被选中的断言 oracle,在此之前不可把 test:changed 当 worktree 唯一 gate。3) lore ac add 拒绝以 -- 开头的 --statement 且批处理中不 fail-loud(实测独立调用 exit 2,批内被吞)— 两处缺陷待修;当下纪律:每批 ac add 后必须断言 AC id 集合。4) 今后所有 lore assess 必须带 --diff(范围取该 plan 首个 task commit)— 两份 assessment 的 scope_fidelity 都因 diff_available:false 只能按 absence 打分(68-70)。5) 分发仍冻结:guyin 为 qualified-with-caveats,babyai 是今日迁入的 Day-1 corpus,需在迁移后 2-4 周带 trace 数据复审才算第二采纳样本。6) 并发 session 共享同一 checkout 时,提交必须 path-scoped(git commit -- <paths>),本 session 已因裸 commit 裹入对方已 stage 的重命名(无数据损失,未做历史重写)。
