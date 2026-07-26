---
id: KN-111
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-07-24
tags: []
parent: PLAN-039
---
# Handoff — agent:main-orchestrator

## Plan

plan-implementation-spec-047-seat-auto-briefing-single-slice

## Task Refs

(none)

## Modified Files

- 主 checkout 有另一 session 的 4 个未提交文件(vitest.config.ts/package.json/assets/hooks/session-start-resume.mjs/CLAUDE.md,vitest 孤儿修复工作)— 不是你的,别动别提交

## Key Decisions

| Judgment | Confidence |
|---|---|
| SPEC-048 APPROVED(owner 2026-07-17),5 ACs 就位,实现未开始 | 95 |
| 并行 session 协调规则(owner 关切'两个session会不会串'的答案):corpus/worktree 层机制隔离;主 checkout git 写权与全量测试是仅有的冲突面 → 错峰 | 90 |

## Failing Oracle

(none)

## Next Steps

- SPEC-048 实现:planner 分解 + worktree implementer 波次可立即开始(不碰主树)
- ⛔ MERGE GATE:合并任何分支回 main 前,先 git status —— 存在非本 session 的未提交改动(尤其 CLAUDE.md/vitest.config.ts/package.json/assets/hooks)则 HOLD merge,等那个 session 收工提交;绝不把外来文件夹带进自己的 commit
- ⛔ 全量测试(bun run test / lore verify 全量 AC)错峰:开跑前 pgrep -f 'vitest|bun test' 确认无并发 suite
- CLAUDE.md doc-sync 只追加自己 spec 的条目,不碰 eval-log 区(另一 session 在维护)
- owner 行动项不变:清磁盘;AC-048-E 真机 beta 装留 owner
