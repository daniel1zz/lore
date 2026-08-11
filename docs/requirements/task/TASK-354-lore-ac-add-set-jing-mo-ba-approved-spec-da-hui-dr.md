---
id: TASK-354
type: task
role: plan
title: "lore ac add/set 静默把 approved spec 打回 draft，进而阻塞并发批次中后发 task 的 claim"
status: draft
priority: medium
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
---
一条完整的 spec→plan→task 链上实际发生的顺序：

1. `lore create spec` → draft；`lore ac add` ×10
2. `lore review` + `lore approve` → **approved (v13)**
3. plan review 提出 blocking question，据此 `lore ac add AC-TD-3-WEB` + `lore ac set`（修一个 oracle 空过洞）
4. `lore approve <plan>` → gate 拒：`gate:plan-promote blocked: UPSTREAM_NOT_APPROVED`，理由「Parent spec ... (status: **draft**)」

第 3 步把 spec 从 approved 打回 draft，**全程无任何提示** —— `ac add`/`ac set` 的输出只回显 AC 列表。发现方式是在下游 gate 撞墙，而错误码 `UPSTREAM_NOT_APPROVED` 描述的是状态、不是因果，需要自己回溯才能定位到那条 ac 命令。

这个降级本身是合理的（口径变更后重新审批是应该的），缺陷在于**静默**，以及它连带的三个后果：

(a) **阻塞后发 task 开工（最严重）**：`gate:task-claim` 要求上游 spec approved。并发批次里，plan 要求每个 task 完成时用 `lore ac set` 补测试标识锚 → 任一 task 收尾即把 spec 打回 draft → 后发 task 的 claim 被 `UPSTREAM_NOT_APPROVED` 拒，而 implementer 无权自解（`lore approve` 是 orchestrator 职责）。实测代价：一个 subagent 整轮空跑，把全部调研做完后只能报 BLOCKED 交回；另一个 subagent 在补做时无法 re-claim，只能在无 advisory lease 的状态下继续工作（如实上报了，但 anchor gate 期间是失效的）。

(b) **attestation 安全窗口**：`lore verify` 在 spec 非 approved 时照常签发 attestation（SPEC-039 §3 明确不是硬 gate，只 warn）。于是若某 agent 在补锚时顺手改了 AC 的 `--command`，后续 attestation 会为一条**未经审批的验收口径**背书 —— 而 attestation 恰恰是 `lore done` 唯一认可、用于压制自报证据的凭据。

(c) 一个 7-task 的 plan 需要重新审批 7 次，每轮 LLM review 2–4 分钟。

根因判断：补测试标识锚是**声明**，不是验收口径变更，本不该触发重新审批。
