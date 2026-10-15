---
id: KN-406
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-10-10
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
| SPEC-084 全链落地并活语料修复完成@high：8+2 任务全归档、6 AC 受信 attested、plan-close gate 通过归档；活迁移已执行（94 kept/12 changed，80=bootstrap/81=outline/82=audit-2），幂等验证 0 写入 | — |

## Failing Oracle

(none)

## Next Steps

- 1) push 前跑 pre-push 三检（tree/drift/audit --verify + prd-budget）；2) 处理 2 条 adhoc 改进任务（ordinal-aware provenance composite 关 BUG-002 窗口；Invariant-2 三写点重述+grep oracle 机制化）；3) lore pending 清 14+ 审阅队列（含本 plan 的 assessment 与 retro）；4) 并发 SPEC-085 session 若创建新编号文档请确认其用新 binary（旧 binary 创建的 spec/adr 将是 NULL ordinal，export 有 loud warning 兜底）
