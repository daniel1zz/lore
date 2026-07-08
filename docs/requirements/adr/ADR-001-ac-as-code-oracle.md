---
id: ADR-001
type: adr
role: decision
title: "AC-as-code — 验收标准作为类型化 oracle 绑定数据"
status: draft
priority: medium
created: 2026-07-08
updated: 2026-07-08
tags: [acceptance, oracle, loop, spec-038]
parent: PRD-001
---
# ADR: AC-as-code — 验收标准作为类型化、oracle 绑定的数据

## Status

proposed (2026-07-08)

## Context

Loop 有效性 = 反馈 × 反馈可信度 × 回路闭合(Anthropic 官方 loop 工程调研结论,见 knowledge doc "Anthropic Official Agent-Loop Engineering — Research Digest")。Lore 已有反馈的**记录层**(SPEC-025 evidence)与**判断层**(SPEC-026 assess、SPEC-034 review judgment、SPEC-035 calibration),但反馈的**标准供给端**是散文:spec 的验收标准无类型、无 oracle 绑定,导致——

1. assess judge 被指示"从 spec 散文里自己找 AC 标识符"(assess-template.ts:235),语料实测 judge 自造 id(`D1`、`D2-triage` 混在 `AC-*` 约定里),`ac_scores` 无法跨次、跨版本对齐,SPEC-035 calibration 的 per-AC 粒度失真。
2. SPEC-025 evidence 无法声明"这条 oracle 记录验证的是哪条 AC",per-AC 覆盖不可计算。
3. AC 与验证命令的绑定只存在于作者脑中——正是 Anthropic 观察到的长时 agent #1 失败模式("mark a feature as complete without proper testing")的温床。

PRD §14 已规划自主反馈回路的 staging(R1 已落地,R2 自治解锁 ADR-gated 于 R1 数据)。本决策**不触碰** §14 R2 的任何内容;它解决的是所有 R 阶段共同依赖的输入质量问题。

## Decision

**验收标准成为 spec 文档上的类型化数据**:`spec.extra.acceptance_criteria: Array<{id, statement, verify}>`,其中 `verify` 是三态判别联合——

- `script`:绑定 oracle 种类(复用 SPEC-025 枚举)+ 可执行 command。可机械裁决的 AC 一律用此态。
- `ai`:绑定 rubric,供 LLM-as-judge 逐条裁决(SPEC-026 消费)。
- `human`:显式声明需要人裁决(PRD §14 I2 采样底线的对象)。

配套不变量:
- **写入时校验**(create + set 双路径),id 唯一、格式受约束;fail loud。
- **evidence 可引用 AC**(`ac_ref`),引用未声明 id → 错误;per-AC 覆盖由纯函数从 evidence 计算,永不落库(镜像 computed readiness)。
- **assess 按声明集裁决**:judge 的 `ac_scores[].ac_id` 必须 ⊆ 声明集,越界即错、不建档。
- **oracle 种类单一 SSOT**:全仓 3 处枚举拷贝收编为一处导出。

落地为 SPEC-038(schema、校验、CLI、assess 集成的完整设计与 AC 见该 spec)。

## Alternatives Considered

1. **维持散文 + judge 自行抽取(现状)** — 零成本,但 id 漂移已在语料中实测发生,calibration 分层随 prompt 演进持续失真。拒绝。
2. **独立 AC 文档类型(spec 的子节点)** — 过度规范化:AC 无独立生命周期,拆出会破坏树契约(PARENT_TYPE_CONTRACT)并把每次 spec 评审变成多文档事务。拒绝。
3. **repo 根 yaml(lore.ac.yaml,类比 lore.tree.yaml)** — AC 属于单个 spec 的内容而非仓库级契约;脱离 corpus 即脱离版本历史、review 工作流与 Turso sync。拒绝。
4. **现在就做 trusted runner(lore 亲自执行 command)** — 与数据模型正交且引入执行沙箱、超时、密钥等独立风险面;verify.script 已留 additive 扩展点。延后为 SPEC-039 候选。

## Consequences

- (+) assess 的 per-AC 判决获得稳定坐标系;SPEC-035 calibration 的 doc_type × prompt_version 分层在 AC 粒度上可信。
- (+) "写 spec 的那一刻就在写验收程序"——需求级 TDD;Anthropic harness 文章的 per-feature verification standards 是直接先例。
- (+) 为 SPEC-039(trusted runner / attested evidence)与 §14 R2(数据解锁自治)提供无需返工的数据基础。
- (−) 作者需为每条 AC 显式选择 verify 途径——刻意的摩擦:无法机械验证的 AC 从此在类型上现形。
- (−) 新旧 spec 的 assess 输入质量双轨并存(prompt_version 分层可观测,存量零迁移)。

## References

- SPEC-038(落地 spec)/ SPEC-025 / SPEC-026 / SPEC-032 / SPEC-034 / SPEC-035
- PRD §13(output contract)、§14(autonomous feedback loop;本决策服务其输入质量,不触其 R2 staging)
- knowledge: "Anthropic Official Agent-Loop Engineering — Research Digest (2026-07-07)"
