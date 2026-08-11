---
id: KN-400
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
---
# Handoff — agent:main-orchestrator

## Plan

plan-implementation-spec-084-corpus-allocated-ordinal-identity

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| Judgment | Confidence |
|---|---|
| SPEC-084（序号体系终态）已 approved 且实现 plan 已过 reviewer 审计+approve，8 任务全部就绪待 autopilot；设计定案：store 原子分配（insertWithAllocatedOrdinal + allocateOrdinalForExisting）+ DB 部分唯一索引含软删永不复用 + title 纯文本双路守卫 + export 读取化 + 一次性修复迁移@high | — |

## Failing Oracle

(none)

## Next Steps

- 1) 对该 plan 跑 autopilot（入口 lore ready plan-implementation-spec-084-corpus-allocated-ordinal-identity --json，唯一 ready 根 T1 RED；P1 串行 T1→T3→T2，P2 三路并行 T4/T5/T6，P3 T7→T8）；2) ⛔ T8 的活语料 migrate ordinals --apply 是 M2 硬门：必须先呈报完整 old→new 映射报告并经 AskUserQuestion 用户明示批准（预期结局 080=bootstrap-injection/081=PRD-as-outline/082=audit-hardening-2，072/073 export 漂移归位），dry-run 与 --apply 同一坐次执行防 R5；3) T2 领任务时先查 migrations 链最新编号（R1 并发撞链）；4) 收尾闭环：CLAUDE.md 补 SPEC-084 条目 + lore invalidate 撞号 knowledge 的手工协议段（successor=已执行的迁移）+ lore assess；5) 遗留观察项：lore get 对 lore list 展示的 10 字符截断 ID 前缀解析两次失败（SPEC-065 findByTypeIdPrefix 路径疑似活 bug，未深究），值得立 adhoc task 查证
