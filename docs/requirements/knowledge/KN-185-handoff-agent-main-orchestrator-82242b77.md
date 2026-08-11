---
id: KN-185
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator-82242b77"
status: archived
priority: medium
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-081
---
# Handoff — agent:main-orchestrator-82242b77

SCOPE: 5 decisions + 5 next steps = 10 items to account for

## Plan

plan-land-oracle-tier-falsifiability-falsified-coverage

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | 三个机制已全部落地 main（1b90fabe）：falsified 第四覆盖维度 + pass_unfalsified 状态、含管道自报证据的拒绝（已在 CLI 与 MCP 两个调用点接线）、unclaimed-oracle 检查。13 条 AC 全部经 lore verify 真实 attestation，6/6 任务归档，其中 5 条完全不需 --override-attestation@high | — |
| KD2 | 追溯政策由实测数据定而非直觉：700 条 criterion 中 574 条（82.0%）会落 pass_unfalsified。若武装成阻塞 gate，落地那个 commit 就让 82% 的 corpus 违规，而清红线的压力会催生合成假红——恰好摧毁该机制的意义。故 report-only，存量由 spec 里写下来的可审计豁免接管@high | — |
| KD3 | 本 session 三次同型失误的根因都是我的锚划错、非 implementer 失职：能力实现未圈生产接线点（M2 守卫休眠、M3 检查零调用）、必填字段涟漪未纳入任何锚（12 文件，merge 会打红 main）。已落 knowledge-the-anchor-set-is-the-acceptance-unit-design-so-an，含一条规划期就能跑的 typecheck 涟漪探针@high | — |
| KD4 | lore assess 判定 met 85/100，并抓出我 spec 里一个真逻辑错误：原 dogfood 判据「若 criterion 落 pass_unfalsified 即证明机制诚实」由构造不可证伪——同一段的 expected-fail 要求强制 falsified>=1，故 pass_unfalsified 永不可达。已更正为「每条读 falsified>=1 且带 attested green」并在 spec 内留下更正记录@high | — |
| KD5 | 退出码经管道的陷阱本 session 第四次复现，且第四次是我自己：把 lore verify 写成复合命令后 harness 报的是末尾 tail 的 exit 0，实际 verify 以 validation error 失败根本没跑。M2 机制拦的是 lore evidence 写入路径，⛔ 拦不到编排层的复合命令——这是已知残余范围@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: 两个新立的 high 任务，均未派实现：task-one-honest-historical-fail-row-pins-a-criterion-to-state（fail-first 无 recency，一条历史 fail 永久钉住状态，即使后有 attested pass；已给三个候选方案各带残留，⛔ 禁止删改历史行、禁止让作者把真红标成 expected-fail）与 task-deriveaccoveragestate-fails-open-on-an-absent-falsified-so（absent 与 observed-red 读数相同，且 dashboard tsconfig 排除 tests 使必填字段违规对 typecheck 不可见）
- NS2: ⛔ plan 尚未关闭（仍 approved，6 个子任务已全部 archived）。lore done 提示跑 lore set <plan> --status archived，但根 CLAUDE.md 明载该提示与 lore status --check-tree 的措辞互相矛盾（一说 gate never evaluated、一说 will evaluate once you run），⛔ 照抄前必须先用临时 plan 做可控实验确认 gate 是否真生效，⛔ 不要拿这个真 plan 试，archived 可能不可逆
- NS3: packages/core/src/CLAUDE.md 已进 warn band（14863/16384，余 1521 字节），advisory 不影响退出码、未触 eviction 地板。⛔ 触了地板只能靠 eviction（block 迁 corpus + 一行指针），不得抬 ceiling、不得拆长行（约束是 BYTES）
- NS4: AC-FALS-7 已按 assess 建议改为描述其 oracle 实际测量的东西（findPipeRefusal 返回 refusal / null），活进程退出码断言归 AC-FALS-9。spec 因两处编辑降级后已重新评审（approve 0.82）并批准至 v24
- NS5: assess 另有两条未处理建议：为源码级禁令类约束（SSOT 复用、do-not-touch、必填 vs 可选形状）附 diff 或文件级变更清单进审计包；attested 比例 0.26（57 行中 42 条自报，但 13 条 AC 每条至少一条 attested pass）
