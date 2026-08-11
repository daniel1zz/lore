---
id: TASK-520
type: task
role: plan
title: "缺第五个 gate：dispatch-time（派 subagent 实施前无 claimed task）——四个 gate 全在 corpus 写入路径上，绕过 corpus 的工作零阻力"
status: draft
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PRD-001
---
lore 的四个确定性 gate（spec-create/spec-promote/plan-promote/task-claim）全部位于 corpus 写入路径。对一个「从不写 corpus」的操作者，它们全部不可达——而「派 subagent 去实施」正是这条路径：无 corpus 写入、无 gate、无摩擦。缺的是 dispatch 时刻的拦截，即 harness 的 PreToolUse(Agent/Task) 位点。

⚠️ 必须由 lore setup 承载，不能靠使用者自己写本机 hook。理由与已归档 issue 01KYPRS2T7RHAK966NQGXKSDKC 同源（其标题结尾即『该纪律无法跨机器分发』）：本机 ~/.claude/hooks/ 下的自制 hook 不在 lore 的 embedded asset manifest 里（实测 lore setup --dry-run 的 plan.writes 不含它），因此不跨机器、不随 lore 升级更新；而注册它所需的 settings.json 恰恰是 lore managed（plan.writes 含 settings-hook | settings.json），下次 lore setup 会把使用者的条目判为 diverged，--force-diverged 直接覆盖。即：使用者的本机补丁既不可分发、又会被 lore 自己抹掉。

建议实现要点（本机原型已验证可行，六维度 + 反向对照测试通过，可作参考）：仅在 prompt 呈『实施形态』（Task Objective / AC / File Anchors / 实现·重构·修复 / 分支名·worktree 等）且当前无任何 claimed task（读 lore bootstrap 的 my_claims + active_sessions，任一 actor 的 claim 均计入）时告警；read-only agent type（Explore/*-reviewer/*-explorer/researcher/Plan）按类型豁免；lore 不可用或 stdin 异常一律静默放行，绝不阻塞派发；advisory-only（exit 0 + warn），不 deny——启发式分类上做硬阻断会比问题本身更糟。
