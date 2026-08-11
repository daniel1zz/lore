---
id: KN-214
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator-82242b77"
status: approved
priority: medium
created: 2026-08-02
updated: 2026-08-02
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator-82242b77

SCOPE: 5 decisions + 5 next steps = 10 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | NS1 前提被现网代码推翻：ad-hoc attestation 路径已上线并接线（verifyAdhocTask verify.ts:459 + resolveDeclaredAcIdsForAdhocTask app.ts:637/968）。真根因是 ac-scope requiredness 挂在 parent plan's spec 上而 --adhoc 保证其恒假 → 最近 25 个 adhoc 任务 24 个 ac_scope=null → override-attestation 成常态（审计 400 行内 19 次）@high | — |
| KD2 | NS2：合取检测器不推广，任何 severity 都不。全 corpus 实测 577/720=80.1% 命中、全文标注精确率 50%（TP6/FP6，独立吻合交接单 5/12）。决定性理由不是误报率高，而是误报恰好是遵守 false-oracle 纪律的 AC——AC-LL-1 自陈 exit 0 alone is insufficient；凑绿最短路径就是拆掉退出码+输出的配对断言@high | — |
| KD3 | AC-ACQ-7 由构造为真：statement 限定 script-mode，而 ac-quality.ts 不变量正是从不拦截 script-mode；其 oracle 只读 9 条手写 fixture 从不碰 corpus。控制组（同 696 条改标 human-mode）出 5 条 block 且 5/5 全误报，根因是连字符构成词边界（fast-track→fast、best-effort→best），文档只覆盖后缀@high | — |
| KD4 | actor 塌缩根因：LORE_ACTOR（tier 2）压制 session tier（tier 3，precedence 中唯一带 session 区分量的一档，utils.ts:576-578），且 deriveSessions 分组键 by/machine/worktree（session.ts:550）不含 session 事实 → 两个主 checkout orchestrator 三元组逐字节相同。为修 tier-5 而立的纪律造出了 tier-2 塌缩@high | — |
| KD5 | 三处 plan-keyed 谓词对 adhoc 静默失效已归并为同一机制根因而非三个独立 bug：plan-close 门（71 KD3）、ac-scope requiredness（本轮）、active_sessions 派生（并发 session 立案）。--adhoc 切断 plan 边，所有读该边的谓词退化为 inert 而非 refuse，且无处宣告自己退出@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: 本轮 5 个新任务全部 draft/adhoc/ac_scope=[]，均带强制的 Proxy-Silence-Opt-in 三问，均未派实现（用户决策：只立任务）。高优三条：task-two-concurrent-orchestrators-both-resolve-to-agent-main、task-mcp-lore-create-supersedes-still-creates-then-fails-the、task-an-ad-hoc-task-can-never-reach-the-attestation-path-that
- NS2: 中优两条：task-ac-acq-7-is-vacuous-by-construction-and-its-oracle-never、task-a-mistyped-task-file-anchor-is-stored-and-consulted。后者已明确否决「在 normalizeFileAnchors 加硬校验」方案（core 须 browser-safe，且 task anchor 合法地可指向未创建文件），只能做 advisory + lore ready 侧读出
- NS3: ⛔ 派任何实现前必须先修 actor 塌缩：noAnchorOverlap 对两个都叫 agent:main-orchestrator 的 orchestrator 完全失效，并发写入此刻无机制保护。我已改用 agent:main-orchestrator-82242b77，但那只是本 session 自救，不是机制修复
- NS4: 并发 session 交接单 01KZ17MQ 有 6 条自己的未完 NS + 3 个 locked worktree（a6b80ecc/aa74dc92/aaec037c，均在 a62a0dd）。其中 task-active-sessions-derives-only-over-active-plans- 已覆盖本线 NS3b 且结论更强（0 active plan + adhoc 挂 PRD → 该字段恒为空），⛔ 勿重复造
- NS5: adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the 是新的强制评审镜头：每个新增或变更的确定性机制必须在自己的文档或 JSDoc 里回答 Proxy / Silence / Opt-in 三问才算建成。本轮 5 个任务已按此格式写，实现者不得省略
