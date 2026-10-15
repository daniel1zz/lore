---
id: KN-218
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 4 next steps = 9 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | 本 session 全部完成：交接单 13 项 + 后续新立 8 个任务 + 1 个 main 回归修复，全部落地 main 并归档。最终全量在 3d84ebc 干净树三重取证为真绿：bun run test 自身退出码 0（分离语句捕获）、脚本 exited-with-code 行计数 0、vitest 434 文件/7635 pass、bun 160 文件/1738 pass/0 fail@high | — |
| KD2 | ⛔ 退出码测量陷阱（我犯了两次）：cmd > out 2>&1; echo $? 写成一条链时，整条链的退出码是 echo 自己的 0，harness 报告的正是它。我据此两次报告全量 exit 0，第二次实际是 exit 1 带 1 个失败。必须写成两条独立语句@high | — |
| KD3 | plan-close 对 extra.adhoc 任务结构性失效（无 plan 则永不触发）——本 session 命中三次。四道 done() 地板（result:pass / red_first / unfiltered 见证 / runner attestation）因此全部落在 task 级@high | — |
| KD4 | NS5 保持 D5 不变、不建新机制：--override-judgment 早已发布（前提被推翻），且 N 次连续 escalate 反而奖励重掷（每个 approve 采样重置计数器、不留痕迹）。flip 数据仅 n=1@high | — |
| KD5 | 我上一轮的诊断被 implementer 推翻并作废（已 lore invalidate + supersedes 关联）：根因不是 lore evidence --ac 该拒绝 adhoc，而是 check-ac-ref-integrity 私有 resolver 比共享的 resolveGoverningSpecByAcScope 窄@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: ⛔ 结构性张力待决：attestation floor 要求 runner-attested pass，而 adhoc 任务无 plan、无 script-mode AC，lore verify 结构上无法为其产生 attestation → 每个 adhoc 任务归档都被迫用 --override-attestation。逃生口一旦成为常态，审计价值即被稀释。需要为 adhoc 任务设计一条真实的 attestation 路径，或显式承认该类任务豁免
- NS2: task-ac-acs-1-and-ac-acs-9 那轮的机械检测器误报 5/12 条 AC（如 exits 4 and stderr enumerates the ids 实为一次错误路径观察的两面）。若要推广该检测器，需先解决 false-positive 率，否则会诱使作者为凑绿去改无关 AC
- NS3: task-a-task-cannot-be-retracted 的 implementer 主动上报两个 out-of-anchor 残留：MCP lore_create.supersedes 仍有同样的 create-then-fail 缺陷（只修了 CLI）；SessionService.bootstrap 的 active_sessions 派生不排除已撤回任务的 claim
- NS4: file_anchors 无存在性校验（normalizeFileAnchors 只做去重与 ../escape 拒绝），写错路径静默通过、互斥保护落空；而 spec 的 code_anchors 有 --check-drift 报 file_missing。这个不对称尚未立任务
