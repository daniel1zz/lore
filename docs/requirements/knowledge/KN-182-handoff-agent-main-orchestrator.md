---
id: KN-182
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-080
links:
  - {id: KN-181, type: supersedes}
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 6 next steps = 11 items to account for

## Plan

plan-land-fail-superseded-and-not-measured-as-one-widening-of

## Task Refs

(none)

## Modified Files

- packages/core/src/acceptance.ts
- packages/dashboard/tsconfig.tests.json
- package.json

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | M4 fail_superseded + M5 not_measured 全部落地并关闭：3 个 task 归档、plan archived、13/13 + 2/2 经 lore verify attested、双 runner 全量套件与 typecheck 在合并树上 exit 0、tree+drift consistent。语料状态迁移逐桶对账：62 个 fail 精确拆成 4 真红 + 58 fail_superseded，其余四桶不变，not_measured 出现 0 次@high | — |
| KD2 | spec 里 report-only 的承重数字被证伪：pass_unfalsified 真实为 29/724 = 4.0%，不是记录的 574/700 = 82.0%。574 与今天的 attested_pass(579) 几乎相等，而 attested_pass 在优先级中先于 pass_unfalsified，故原统计是优先级混淆而非漂移（移出 545 条需 545 次 lore verify，实际只在 6 个 task 上记过证据）。'落地即全仓违规'论证不成立，report-only 现仅靠'合成假红'一条站着@high | — |
| KD3 | dashboard typecheck 守卫经反向对照证明生效：tsconfig.tests.json 原先因 extends 不重置 exclude 而解析 ZERO 个测试文件，exit 0 是'什么都没量'；修复后解析 64 个文件，且故意省略 falsified 的探针使其 exit 2 并报 TS2741。已接进 bun run typecheck 链尾@high | — |
| KD4 | 冻结文件清单作为 AC oracle 的方法在本 slice 内两次失效：AC-FALS-12 漏掉 ac-service.test.ts（真回归从绿套件溜出），AC-FALS-13 漏掉 ac-list-falsified.bun.test.ts（由 lore assess 提示后经发现式 grep 查出）。两者已补全，⛔ 但残留未关闭——内容 grep 对 subprocess 型测试结构性盲，正确总体是内容发现与子进程推理的并集@high | — |
| KD5 | 本 session 记录 7 条治理工具缺口，每条配反向对照，全在 knowledge-three-of-lore-s-own-outputs-misled-this-session-a。其中排序规则（改治理文档后必须重查上游状态再 dispatch）被我违反 3 次，证明该规则处在错误的层：session 开始时读到的散文活不到编辑发生的那一刻@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: ⛔ 需要人类决定：是否把 pass_unfalsified 武装成阻塞 gate。29 条是可清积压而非全仓违规，spec 的 Out-of-scope 已把它标回 OPEN 而非既定非目标。反对理由只剩'清红线的压力会催生 M1 无法分辨的合成假红'一条
- NS2: 4 条真红 criteria 待处理，与本 plan 无关：AC-061-7（pass=1 fail=3）、AC-062-3、AC-062-5、AC-064-7。它们此前被永久钉在 fail 状态而不可区分，现在 fail_superseded 让它们从 58 条历史红中显现出来
- NS3: ⛔ 两条 lore 缺陷值得建 spec 修在机制根：(1) lore set <plan> --status archived 不评估 gate 且级联归档非终态子 task、不可逆，而 lore done 与 --check-tree 两个surface 措辞互相矛盾却都指向它；(2) lore ac add/set 会把 spec 打回 draft 并冻结所有下游 claim，编辑处无任何提示
- NS4: fresh 消费者安装的 spec-create gate feeding pack 为空（gate 随二进制分发、规则文档只在本仓库语料）。修法：lore init 从 assets/ 播种，或 gate 内置 fallback rule slice。⛔ 探针必须构造两端——用本仓库语料作活对照，否则单端探针空过
- NS5: tests/e2e 被排除后，其两个 .ts 辅助文件（mint-machine-dashboard-key.ts、multi-project-server.ts）不再被任何 typecheck 覆盖。不是回归（phase 1 前整个 tests 树都被排除），但是已命名的盲点，需要一个无 rootDir 的独立 e2e project 才能关闭
- NS6: typecheck:dashboard-tests 依赖 typecheck:dashboard 生成的 routeTree.gen.ts（git-ignored），存在时序耦合：单独运行该脚本会在新克隆里假红约 24 条。全链 bun run typecheck 顺序正确故 exit 0，但该脚本作为公开入口是个陷阱
