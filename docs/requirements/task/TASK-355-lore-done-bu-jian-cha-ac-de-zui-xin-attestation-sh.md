---
id: TASK-355
type: task
role: plan
title: "lore done 不检查 AC 的最新 attestation 是否 pass —— task 可在 attested-fail 状态下被归档（不可逆）"
status: draft
priority: medium
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
---
在同一条 shell 命令里连续执行 `lore verify` 与 `lore done`：verify 刚刚为 AC-TD-5-B 记下一条 attested **fail**（exit 1），紧接着 `lore done` 就把该 task 从 approved→active→archived 归档完成，没有任何阻断。

实测输出：
```
✔ AC-TD-5-A pass (141ms, exit 0) [new]
✘ AC-TD-5-B fail (4856ms, exit 1) [new]
1 passed, 1 failed.
...
task-t5-ling-cheng-jiao-liang-san-tai-pai-sheng-ssot archived (v35): approved -> active -> archived
```

`lore done` 现有的前置检查是「存在 attestation」+「存在 red-first 证据（或 --declare-no-new-tests）」，但**不检查最新 attestation 的 result 字段**。

危害：它使「AC 全绿才归档」这个所有下游推理（尤其 `lore assess` 与 plan-close）都依赖的假设不成立。归档是 approved→active→archived 的唯一通路且不可逆，于是 corpus 里会出现「一条 attested fail 与一个 archived task 并存」的状态，而没有任何一步曾拒绝过它。

对照：red-first gate 做得很好 —— 它会拒绝并给出 `--declare-no-new-tests` 这个留痕的审计出口。attestation-result 检查缺的正是同一形态的把关。
