---
id: TASK-538
type: task
role: plan
title: "lore 全局纪律缺一条：「绝不屏蔽 lore 自身输出」应进 governance corpus-workflow 资产（原建议的 hook 方案已作废）"
status: draft
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PRD-001
---
# lore 全局纪律缺一条：「绝不屏蔽 lore 自身输出」应进 `lore governance corpus-workflow` 资产

## 修订说明（提交后自我修正）

本报告初版建议「在 `lore setup` 安装的 PreToolUse hook 集里增加一条拦截」。**该建议是次优解，已作废**。正确的落点是 **`lore governance corpus-workflow` 治理文案资产**——即随 lore binary 版本化、由 `lore setup` 安装、经 session-start 注入到每个 agent 上下文的那段 `<corpus-workflow>` 片段。理由见下「为什么是指令层而非 hook 层」。

## 真实事故

guyin 项目，2026-07-29，SPEC-01KYPEHP 执行期。编排 agent 为保持终端输出简洁，把 spec 正文更新写成：

```bash
lore set <spec> --content-file X >/dev/null 2>&1
```

连续 3 次。**lore 本身行为完全正确**——每次都在 stdout 打印了：

```
Updated spec-… → v44
  (approved doc demoted to draft because content changed)
```

但该告警被调用方重定向丢弃。编排者因此不知道 spec 已退回 draft，继续 dispatch 了一个 lore-implementer subagent；该 agent 在自己 worktree 内 claim 时撞上 `gate:task-claim UPSTREAM_NOT_APPROVED`，正确地停止并报回（未 bypass、未写代码），但已空转 **198 秒 / 69k tokens**。成本纯由「告警被静音」产生。

事后编排者甚至一度把根因误判为「lore 静默降级、缺少提示」，直到复现一次未重定向的 `lore set` 才发现工具一直在告警。**即：屏蔽输出不仅导致当次失败，还导致对工具的错误归因。**

## 为什么是指令层（governance 资产）而非 hook 层

1. **同类纪律已经全在那里**。`lore governance corpus-workflow` 现有条目包含：`never bypass with LORE_GATE_BYPASS=1 without explicit user consent`、`never let an LLM self-grade its own work`、`Shared mutable state must be re-evidenced in the turn you assert it`、`never leave it quietly stale`。本条与它们完全同构，尤其与「re-evidenced」那条同源——那条防「拿旧快照当现状」，本条防「把当前状态丢掉」，两者都是保证 agent 看见真实状态。

2. **跨机器分发是 lore 的既有能力，而个人配置不是**。写进用户个人 `~/.claude/CLAUDE.md` 无法跨机器（实测：该文件与 `~/.claude/hooks/` 均不随 git 走；`.lore/lore.db` 亦被 `.lore/.gitignore` 排除，实测本仓库 16MB db 未被跟踪，故 corpus 沉淀的复盘同样到不了另一台机器）。`lore governance` 资产随 binary 版本化 + `lore setup` 安装，是唯一能把这条纪律一次性送达任意机器的通道。

3. **成本对称性**：一行 prose 注入 vs 一个需要正则匹配 Bash 命令、可能误伤合法用法（如 `lore list >/dev/null` 探活）的拦截 hook。指令层零误伤、零维护面；hook 可作为可选的第二道防线，但不该是主要手段。

## 建议的资产改动

在 `corpus-workflow` 的 EXECUTE 段（现有 `External oracles only` / `Shared mutable state must be re-evidenced` 邻近）增加一条，措辞与现有条目风格一致：

> - Never suppress lore's own stdout/stderr. `lore set|approve|reject|claim|release|evidence|invalidate|archive` print state transitions and gate preconditions — most critically, editing an approved doc's content demotes it to `draft`, which silently freezes every downstream `task-claim`. Redirecting these to `/dev/null` blinds you to the one signal that predicts the next gate denial. Need terser output? Pipe through `| tail -3`; never discard the stream.

## 复现

```bash
lore set <an-approved-spec> --content-file <changed.md> >/dev/null 2>&1
lore get <that-spec> --json | grep status   # → draft，而调用方从未看到降级告警
# 随后任何 lore claim <task-under-that-spec> → gate task-claim UPSTREAM_NOT_APPROVED
```

## Expected

`lore governance corpus-workflow` 资产包含「绝不屏蔽 lore 自身输出」的纪律，使该约束随 `lore setup` 分发到任意机器、注入每个 agent 的上下文，无需依赖用户个人的全局 CLAUDE.md 或本机 hooks。

## Actual

lore 正确打印了降级告警，但治理资产未告知 agent「这些输出不可丢弃」，也没有任何机制阻止调用方将其重定向到 `/dev/null`。后果延迟到下游 `task-claim` gate 才暴露，代价是一个 subagent 的完整空转，外加对工具的错误归因。
