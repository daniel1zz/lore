---
id: PLAN-01KV4WHJGNDEYB4D8Z3JBDKF8G
type: plan
category: planning
title: 实现：文档树一致性保证
summary: >-
  按 TECH-01KV4W88GZF74B98BHCBBV9GHD 实现文档树一致性：core 契约/图算法/yaml 解析 → create/link
  类型硬闸(复用 store 环检测) → TreeCheckService(diff+fix) → CLI(status
  --check-tree/--fix, tree --orphans)。Interface-First 依赖序，TDD 配对，双 runner 全绿。
status: archived
priority: high
tags:
  - tree
  - consistency
  - cli
  - validation
  - 'module:tree-consistency'
created: '2026-06-15T05:37:19.893Z'
updated: '2026-06-15T10:06:49.289Z'
version: 1.0.2
plan_category: technical
governance_mode: attended
invariants:
  - 零新增 npm 依赖：package.json dependencies 在实现前后逐字不变(复用 yaml@2.7.1 / zod@3.24.4)
  - >-
    SSOT：PARENT_TYPE_CONTRACT 仅定义于 doc-type-rules.ts、ancestorChainWalk 仅定义于
    graph-utils.ts，全代码库无第二处实现(grep 验证)
  - >-
    无裸 Result 访问：所有 store.find/findMany 调用先 if(!r.ok) return r 再取 .value(tsc
    strict 通过 + grep 无 `.value` 紧跟 await)
  - >-
    I/O 隔离：TreeCheckService 与 core 模块不 import fs/path；blueprint 读取仅在
    src/adapters/cli 层
  - 双 runner 全绿：bun run test(vitest + bun test)全部通过
  - 回归零破坏：现有 21 个 CLI 命令与 spec/task 必填 parent 规则行为不变
---
# 实现：文档树一致性保证

## Overview
落地 tech-spec TECH-01KV4W88GZF74B98BHCBBV9GHD。两道闸：create/link 类型契约硬闸(环检测复用 store 既有 detectParentCycle) + lore.tree.yaml 蓝图软校验(check-tree diff 四类漂移) + check-tree --fix 半自动归位。

## 策略
Interface-First 依赖序(2 候选中选定)：P1 core 契约/types/纯函数先固定 → P2(硬闸)+P3(TreeCheckService) 并行实现(不同文件) → P4 CLI 接线 → P5 集成/回归测试 + review gate。

## Risk Register
| ID | 类别 | 影响 | 触发条件 | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | Technical | M | check-tree 报环与 store link 表不一致 | check 以 parent_id 字段为权威；P3 task 注释双轨 | 后续单独 task 对账 link 表↔parent_id |
| R2 | Quality | M | spec 挂错到 plan 下同时报 misplaced+missing | P5 专门回归测试 case(spec §7 重复计数回归) | 修 diff 计数逻辑 |
| R3 | Technical | L | fix 归位到自身后代成环 | fix 自带 ancestorChainWalk 环守卫 + STATE 测试 | 该项降级 SKIPPED |
| R4 | Scope | L | 存量错位文档过多无法自动归位 | --fix 模棱两可 skip 并报告，不猜 | 人工逐个 link |

## Exit Criteria
- 全 phase 通过 Phase Gate；pre-completion validate_plan pass
- 6 invariants 全部可验证通过(tsc/grep/test oracle)
- spec §7 六维度测试全绿(vitest + bun test)
- 现有 21 CLI 命令回归无破坏

## Governance
attended —— 每个 Phase Gate 需用户确认；invariant 违规硬阻塞。


## 决策记录 (post-DocReview)
- **D-RECONCILE (2026-06-15, 用户批准)**：store「link 表 vs parent_id 字段」双轨对账**纳入本 plan P5** —— TreeCheckService 增加 link-vs-parentid 一致性检测，status --check-tree 报告此类不一致。R1 不再是延后项，升级为 P5 显式 task。
- **安全中断点 (MINOR2 fix)**：P1(core) Gate = 最晚可干净中止点；P2/P3 并行实现启动后进入不可逆区，中止需回滚两条分支。Phase Gate 全程 attended。
