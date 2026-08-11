---
id: KN-226
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
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
| KD1 | 交接单 13 项全部 done：7 个任务落地 main 并归档，NS5 以 ADR 结项，NS6 经取证自然消解。全量套件在 989a4f5 干净树通过（vitest 430 文件/7493 pass，bun 157 文件/1719 pass/0 fail），9 行含 fail 已逐行核实均为测试名或测试数据@high | — |
| KD2 | plan-close 对 extra.adhoc 任务结构性失效（无 plan 则永不触发）——这是本 session 反复命中的同一教训。三道 done() 地板（result:pass / red_first / unfiltered 见证）因此全部落在 task 级，彼此独立不遮蔽@high | — |
| KD3 | NS5 的前提被推翻：--override-judgment 与 --override-no-judgment 早已发布，'一次掷币锁死版本直到编辑文档'是错的。且 N 次连续 escalate 反而奖励重掷（每个 approve 采样重置计数器、不留痕迹）。flip 数据仅 n=1，凭此改 gate 语义即是本纪律要防的事。决定保持 D5 不变、不建新机制@high | — |
| KD4 | 我自己上一轮的诊断被 implementer 推翻并已作废：根因不是 lore evidence --ac 该拒绝 adhoc，而是 check-ac-ref-integrity 私有的 resolveGoverningSpec 只走 task→plan→spec、比写入端的共享 resolveGoverningSpecByAcScope 窄。照原方向实现会为迁就过时消费者而砍掉正确能力@high | — |
| KD5 | unfiltered 见证的文件集只能来自 extra.file_anchors：绑定命令含 cd&&/glob/脚本间接无法可靠解析，runner 输出经 parseExecutedUnits 只有计数没有文件名。file_anchors 不是第二真相来源，是 noAnchorOverlap gate 已在消费的既有声明@medium | — |

## Failing Oracle

(none)

## Next Steps

- NS1: 6 条 dangling ac_ref（AC-069-15/16 + AC-ACS-1/4/8/9）全部是假阳性，待 task-check-ac-ref-integrity-re-implements-governing-spec 修复 detector 后自动消解。⛔ 禁止为它们补 ledger exemption——它们是活的、有 evidence 的判据，不是被退役的
- NS2: 本 session 新立 8 个 task 待实施，HIGH 优先：task-two-more-evidence-consumers-erase-an-expected-fail-row-doc（doc-type-meta 与 evidence-panel 把 expected-fail 既不计 pass 也不计 fail，dashboard 显示 status=none）、task-test-changed-selects-nothing-for-any-scripts-change-and（scripts/ 改动选 0 文件仍 exit 0）、task-resume-coverage-disposition-parser-an-unrecognised-token、task-a-task-cannot-be-retracted-supersedes-emits-a-repair
- NS3: medium：task-ac-acs-1-and-ac-acs-9-are-still-compound-after-the-split（拆分残留，且根因是原任务 Scope 与 AC 自相矛盾）、task-the-judge-truncation-notice-says-content-was-cut-but-never、task-a-stale-untracked-dashboard-assets-ts-breaks-every
- NS4: truncation 任务新增反向补强证据（本轮实测）：SPEC-026 复审时 judge 正确遵守了截断通知未误报缺失，但同时写明 §6 与 §8.2 被反复引用却不可见、无法验证。通知能防误报，不能让 judge 验证被截内容——引用了窗口外章节的 spec 其一致性依然无人能审
