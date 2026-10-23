---
id: SPEC-038
type: spec
role: spec
title: "AC-as-code: structured acceptance criteria + oracle binding"
status: approved
priority: medium
created: 2026-07-08
updated: 2026-10-23
tags: [acceptance, oracle, evidence, assess]
links:
  - {id: ADR-001, type: implements}
---
# SPEC-038 — AC-as-code:结构化验收标准 + oracle 绑定

> Feature spec (draft)。Module-primary design: core schema + service 校验 + assess 消费 + CLI 面。
> Upstream: PRD §14 R1(judge 输入质量)、PRD §13 output contract(SPEC-032 后继)。
> Origin: 2026-07-07 loop 工程讨论 + Anthropic 官方调研(knowledge doc 另存);经 4 路并行评审(coupling/cohesion/reuse/testing)修订。

## 1. Problem & Goal

spec 的验收标准今天是散文。三个消费者都因此受损:

| 消费者 | 现状 | 代价 |
|---|---|---|
| SPEC-026 assess judge | prompt 塞 spec 全文,指示"从散文里自己找 AC 标识符"(assess-template.ts:235) | judge 自造 id(语料实测:`D1`、`D2-triage` 混在 `AC-*` 里),ac_scores 不可跨次对齐 |
| SPEC-025 evidence | oracle 记录无法声明"验证的是哪条 AC" | 无法计算 per-AC 覆盖,`lore ready` 只见 blocker 不见验收面 |
| 人/agent 执行者 | AC 与验证命令的绑定只存在于作者脑中 | Anthropic 观察的 #1 失败模式:"mark complete without proper testing" |

**Goal**:AC 成为 spec 上的类型化数据——每条绑定一个 verify 途径(script 命令 / AI rubric / human),写入时校验,evidence 可引用,assess 按声明集裁决。**验收在规格时刻就是可执行的程序**。

**Loop 定位**(为什么是这一块):loop 有效性 = 反馈 × 反馈可信度 × 回路闭合。本 spec 做"反馈的标准化供给端";trusted runner(可信度)与自动消费(闭合)分别是 SPEC-039 候选与 PRD §14 R2(ADR-gated),明确不在本 spec。

## 2. Layer Stack 映射

```
packages/core/src/acceptance.ts        ← NEW 纯模块: AC_VERIFY_MODES, SCRIPT_ORACLES, acceptanceCriterionSchema,
                                          specAcceptanceCriteriaSchema, computeAcCoverage (facts only)
packages/core/src/task-workflow.ts     ← 提取导出 ORACLE_KINDS(收编 3 处拷贝);evidenceEntrySchema += ac_ref?
packages/core/src/schemas.ts           ← specExtraSchema += acceptance_criteria?;superRefine 唯一 id(create+set 双路径,镜像 spec_kind)
packages/lore/src/service/ac-service.ts       ← NEW AcService(镜像 PhaseService):add/list/rm/set
packages/lore/src/service/corpus-service.ts   ← resolveDeclaredAcIds(planId) 只读投影(跨实体遍历唯一 locus)
packages/lore/src/service/task-workflow-service.ts ← addEvidence 经注入的 resolveDeclaredAcIds 端口校验 ac_ref
packages/lore/src/ai/assess-template.ts       ← 结构化 AC 表渲染(含 per-AC coverage);verbatim fallback;PROMPT_VERSION 3→4
packages/lore/src/service/ai-provider-service.ts ← assessPlan 后校验 validateAcIdContainment(直接 err,不占 retry)
packages/lore/src/adapters/cli/commands/ac.ts ← NEW: lore ac add/list/rm/set
packages/lore/src/adapters/cli/commands/evidence.ts + mcp/tools.ts ← --ac / ac_ref 参数;枚举改引 ORACLE_KINDS
SPEC-032 文本投影 seam                  ← get 非 raw / export-docs 渲染 AC 清单(勾选态来自 coverage)
```

## 3. Schema(core,browser-safe)

```typescript
// packages/core/src/acceptance.ts
export const AC_VERIFY_MODES = ["script", "ai", "human"] as const;

// 显式字面量(不用 filter 派生)+ 类型级穷举断言:新增 OracleKind 时编译期强制在此做决策
export const SCRIPT_ORACLES = ["tsc", "test", "lint", "build", "e2e", "other"] as const;
type _ScriptOraclesCoverAllButManual =
  [OracleKind] extends [(typeof SCRIPT_ORACLES)[number] | "manual"] ? true : never;

export const acceptanceCriterionSchema = z.object({
  // 语料实测格式全集:AC-33-1 / AC-ASSESS-10 / AC-AUDIT-ACTOR / AC-EXPORT-COLLISION-1
  id: z.string().regex(/^AC-[A-Z0-9]+(-[A-Z0-9]+)*$/),
  statement: z.string().min(1).max(2000),
  verify: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("script"), oracle: z.enum(SCRIPT_ORACLES), command: z.string().min(1).max(1000) }),
    z.object({ mode: z.literal("ai"), rubric: z.string().min(1).max(2000) }),
    z.object({ mode: z.literal("human"), note: z.string().max(500).optional() }),
  ]),
});

export const specAcceptanceCriteriaSchema = z.array(acceptanceCriterionSchema).max(50);

/** Pure facts, no presentation. Renderers live with each consumer (评审 3: 反预聚合). */
export function computeAcCoverage(
  criteria: AcceptanceCriterion[], tasks: DocRecord[],
): AcCoverageFact[]  // { ac_id, mode, pass: number, fail: number, refs: EvidenceRefLite[] }
```

`specExtraSchema` 增 `acceptance_criteria: specAcceptanceCriteriaSchema.optional()` + superRefine 唯一 id。**id 正则只约束新声明**;历史 assessment 文档中 judge 自造的 `ac_scores[].ac_id`(自由串)不受影响,无迁移。

> **后续追加字段(本节代码块是 SPEC-038 落地时的快照,非当前 schema 全集)**:`covers?: string[]` 由 **SPEC-055** 追加,语义是这条 AC 覆盖的 PRD requirement id(如 `R-1`),CLI 面为可重复的 `--covers`。以本 spec §3 代码块判断"字段是否存在"会得出错误结论——`packages/core/src/acceptance.ts` 才是 schema 的 SSOT。此注记于 2026-08-01 补,起因是 `lore ac set` 的评审发现 §6 的 `--covers` 在 §3 查无此字段。

## 4. Evidence 联动(SPEC-025 扩展)

- `evidenceEntrySchema += ac_ref?: z.string()`(REGRESSION-safe,已核对现有测试无字段数快照断言)。
- `lore evidence <task> --ac AC-X-1 ...` / MCP `lore_evidence_add.ac_ref`。
- **跨实体校验**(评审 1+2 张力的化解):`TaskWorkflowService.addEvidence` 不自建图遍历;经构造注入的窄端口 `resolveDeclaredAcIds(planId): Promise<Result<Set<string> | null>>` 校验,该端口由 `CorpusService` 实现(跨实体读的唯一 locus,与 getPlanBundle 同族)、`app.ts` 装配。测试注入 stub,零 3-hop fixture。
- fail-loud:`ac_ref` 指向未声明 id,或 plan 的父 spec 无结构化 AC → `VALIDATION_ERROR`。无 `ac_ref` 的 evidence 照旧(增量采纳)。

## 5. Assess 消费(SPEC-026 扩展)

- spec 声明了结构化 AC → `buildAssessPrompt` 用确定性 AC 表(id/statement/verify 途径/per-AC coverage,来自 computeAcCoverage)替换 "Spec Acceptance Criteria (verbatim)" 段,并指示 judge:**ac_id 只准取声明集,script-mode AC 以 evidence 记录为主要依据**。未声明 → verbatim fallback(现行为)。`ASSESS_PROMPT_VERSION` 3→4(calibration 按 prompt_version 分层,SPEC-035 自动隔离新旧)。
- **containment 后校验**(评审 1+4):`AIProviderService.assessPlan` 内命名函数 `validateAcIdContainment(output, declaredIds)`,schema 通过后执行;违反 → 直接 `VALIDATION_ERROR`,**不占 corrective retry**(retry 语义保持"仅 JSON parse/schema 失败"单轴,单断言 oracle),不建文档。

## 6. CLI / 投影面

- `lore ac add <spec> <id> --statement <s> --mode script --oracle test --command "bun test x"`(ai: `--rubric`;human: `--note`);`lore ac list <spec> [--json]`(附 coverage,当 spec 下有 plan);`lore ac rm <spec> <id>`(有 evidence 引用 → 拒绝,`--force` 覆盖;镜像 phase rm 语义)。经 NEW `AcService`(镜像 PhaseService,CLI 保持薄管道)。
- `lore ac set <spec> <id>`(2026-08-01 补齐,SSOT: `spec-lore-ac-set-in-place-edit-of-a-declared-acceptance`)——**就地**改写既有 criterion 的 `--statement`/`--oracle`/`--command`/`--rubric`/`--note`/`--covers`;`id` 与 `mode` 不可改(改 mode 等于换了一个 criterion,历史 attested evidence 的语义会漂移,那条路仍走 `rm`+`add` 并显式承担 `ac_ref` 后果)。补齐的动机不是便利:在此之前 `statement` 是**每个 oracle 都读、却没有任何 verb 能修正**的字段,唯一修正路径 `rm --force`+`add` 会留下 dangling 窗口——本文 §测试矩阵 STATE 一行早已预见"ac rm 后 evidence ac_ref 悬挂",而 2026-08-01 的实测确认它已真实发生 3 次。退出码边界随既有约定(SPEC-003 §5):纯 argv 可判定 → 2(零字段、`--mode`),需读文档才可判定 → 4(未知 id、mode 不匹配的字段)。`approved` spec 被编辑后按与正文编辑相同的规则降级回 `draft`——验收标准即契约,改了契约就没被评审过。
- **dangling `ac_ref` 检测器**(同批):`bun scripts/check-ac-ref-integrity.ts` 遍历每个 task 的 `verification_evidence[].ac_ref`,断言其指向的 id 仍声明在治理 spec 上。exit 0 干净;exit 2 逐条列出 `(task, ac_ref)` 新债;exit 5 报告 `scripts/ac-ref-exemption-ledger.json` 中已不再匹配真实悬挂的孤儿行(豁免不得比它描述的债活得更久)。豁免 ledger 沿用 `test-budget-ledger` 的形状与可审计性要求(`adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`):criterion 确系被取代 → 记一条带诊断依据的豁免;确系遗失 → 用 `lore ac set`/`add` 以原 id 复declare。⛔ 永不为通过检测器而合成一条 criterion。
- 文本投影(SPEC-032 seam):`lore get` 非 raw 与 `export-docs` 在 spec 正文后渲染 `## Acceptance Criteria (structured)` 清单;有 coverage 时前缀由 `packages/core/src/acceptance.ts::projectAcCoverageGlyph` 单点投影(SPEC-143 C4/D7,2026-08-23 换掉原三字形规则)。⛔ 字形表的唯一 SSOT 是该函数自身的 `switch`,此处与本文档任何位置都不得转写;`scripts/check-ac-state-renderers.ts --rule glyph-projection` 拒绝 `acceptance.ts` 之外的第二处投影。
- MCP:仅扩展 `lore_evidence_add`(ac_ref)与既有 get 通道(extra 自然透传);不新增 MCP 工具(SPEC-024 面控)。

## 7. Design Decisions

| # | Decision | Choice | Rationale | Trade-off |
|---|---|---|---|---|
| D1 | AC 落点 | `spec.extra.acceptance_criteria`(类型化数组) | 备选:独立 doc type(过度规范化、破坏树);repo yaml(脱离版本/评审/sync)。extra + Zod 是 spec_kind/phases 既定模式 | 单 spec ≤50 条,巨型 spec 需拆分(本就该拆) |
| D2 | verify 形状 | script/ai/human 判别联合,**不含** cwd/env/timeout | SPEC-039 runner 落地时作 optional 字段增量,不破坏存量(评审 3) | 现在无法声明超时预期 |
| D3 | oracle 枚举 | `ORACLE_KINDS` 提取到 task-workflow.ts 导出,收编 3 处拷贝(task-workflow.ts:45 / mcp tools.ts:194 / cli evidence.ts:31);`SCRIPT_ORACLES` 显式字面量 + 类型级穷举断言 | 单一 SSOT + 新增 kind 编译期强制决策(化解评审 1"防静默继承"vs 评审 2"防平行真理"张力) | 新 kind 必须改两处(有编译器押阵) |
| D4 | ac_ref 校验归属 | addEvidence + 注入端口 `resolveDeclaredAcIds`(CorpusService 实现) | 不给 TaskWorkflowService 图遍历能力(评审 1);不引 service→service 全量依赖(评审 2);可 stub(评审 4) | app.ts 多一根装配线 |
| D5 | containment 失败语义 | 直接 `VALIDATION_ERROR`,不 retry,不建文档 | retry 保持单轴可测(评审 4);fail-loud 项目铁律 | judge 手滑打错 id 需重跑 assess |
| D6 | coverage 计算 | core 纯函数,facts only,呈现归各消费者 | evaluateReadiness 先例;反 SRP 违例的预聚合(评审 3) | 三个消费者各写一小段渲染 |
| D7 | 存量兼容 | 字段 optional + passthrough 不动;assess verbatim fallback | 100+ 存量 spec 零迁移 | 新旧 spec 的 assess 输入质量不齐(prompt_version 分层可观测) |

## 8. SPEC-038 自身的 AC(dogfood;实现后第一批转结构化)

| id | statement | verify |
|---|---|---|
| AC-ACODE-1 | acceptanceCriterionSchema 拒绝:重复 id、非法 id 格式、script 缺 command、rubric 超长 | script:test — `bunx vitest run packages/core/tests/unit/acceptance.test.ts` |
| AC-ACODE-2 | create 与 set 双路径:非法 acceptance_criteria → VALIDATION_ERROR;合法写入可读回 | script:test |
| AC-ACODE-3 | evidence --ac 未声明 id → VALIDATION_ERROR(exit 3);声明 id → ac_ref 落库、版本 bump | script:test |
| AC-ACODE-4 | 声明结构化 AC 的 spec:assess prompt 含 AC 表(id 全集、coverage 行)且版本=4;未声明:verbatim 段保持 | script:test |
| AC-ACODE-5 | judge 输出含未声明 ac_id → err,无 knowledge doc 落库(InMemoryAIProvider sequence 驱动) | script:test |
| AC-ACODE-6 | computeAcCoverage:pass/fail 按 ac_ref 聚合正确;无 ac_ref evidence 不计入;空任务集 → 全 0 | script:test |
| AC-ACODE-7 | lore ac add/list/rm 往返;rm 被 evidence 引用时拒绝、--force 通过 | script:test |
| AC-ACODE-8 | oracle 枚举定义仅存一处(task-workflow.ts),adapters 均引用 ORACLE_KINDS | script:other — `grep -rn '"tsc", "test", "lint"' packages/ → 1 hit` |
| AC-ACODE-9 | 文本投影:get 非 raw 与 export-docs 渲染 AC 清单;raw 不渲染 | script:test |
| AC-ACODE-10 | 全量既有测试零回归(枚举提取与 evidenceEntrySchema 变更波及面) | script:test — `bun run test` |
| AC-ACODE-11 | typecheck 通过 | script:tsc — `bun run typecheck` |

## 9. 测试策略(六维度)

- HAPPY: AC-2/3/6/7/9;NEGATIVE: AC-1/3/5;BOUNDARY: 50 条上限、statement/command/rubric 长度、空数组、coverage 空任务集;ERROR: containment err 路径、resolveDeclaredAcIds 端口返回 err 透传;STATE: ac rm 后 evidence ac_ref 悬挂(rm --force 的既有引用保持,list 标 dangling)、set 覆盖 AC 后版本历史;REGRESSION: AC-10(全量)+ 既有 assess 快照(verbatim fallback 不变)。
- 校验与纯函数 → vitest(core);store 交互路径 → `.bun.test.ts`;assess 路径用 InMemoryAIProvider sequence(SPEC-026 先例)。⛔ 一律 throwaway corpus。

## 10. Non-goals(显式)

- **Trusted runner**(lore 亲自执行 script AC 并 attest evidence)→ SPEC-039 候选,verify.script 已留 additive 扩展点
- **assess gaps/recommendations 自动开 task**、**calibration-gated 自治** → PRD §14 R2,ADR-gated,数据未到不建
- Dashboard AC 写 UI → SPEC-022 后继
- 声明式 AC 的批量导入/从散文迁移工具 → 存量 spec 按需手工转

## 11. Perspective Tensions Resolved

| Tension | 视角 | Resolution |
|---|---|---|
| SCRIPT_ORACLES 显式 vs 派生 | Coupling vs Cohesion | 显式字面量 + 类型级穷举断言:双向都锁死 |
| ac_ref 校验归属 | Coupling(CorpusService)vs Cohesion(TaskWorkflowService+getPlanBundle)vs Testing(可 stub) | 窄端口注入:遍历归 CorpusService,调用留 addEvidence,测试注 stub |
| containment retry vs err | Testing(err)vs 容错性 | err;retry 单轴不动,typo 重跑成本可接受 |

## Quality Gates(module mode)
- [x] 无循环依赖(acceptance.ts→task-workflow.ts 单向;schemas.ts→acceptance.ts 单向;core 不引 lore)
- [x] 单一职责(acceptance.ts=schema+纯函数;AcService=AC 写编排;渲染归消费者)
- [x] 公共 API 足以黑盒测试(schema parse / computeAcCoverage / 端口 stub)
- [x] 依赖可注入(resolveDeclaredAcIds 构造注入;provider 走既有 registry)


## Acceptance Criteria (structured)

- [○] [script] AC-ACODE-1: acceptanceCriterionSchema rejects duplicate ids, malformed id format, script without command, overlong rubric; legal script/ai/human inputs parse
  script: test — bunx vitest run packages/core/src/acceptance.test.ts
- [○] [script] AC-ACODE-2: create and set paths both reject invalid acceptance_criteria with VALIDATION_ERROR; valid writes roundtrip
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts
- [○] [script] AC-ACODE-3: evidence --ac with undeclared id fails VALIDATION_ERROR (exit 4); declared id records ac_ref and bumps version
  script: test — bunx vitest run packages/lore/tests/integration/cli/task-workflow.test.ts
- [⊖] [script] AC-ACODE-4: spec with structured ACs: assess prompt contains AC table (full id set, coverage rows) at ASSESS_PROMPT_VERSION 4; undeclared spec keeps verbatim section byte-identical
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess.test.ts
- [⊖] [script] AC-ACODE-5: judge output containing undeclared ac_id errors without creating a knowledge doc and without consuming the corrective retry
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess.test.ts
- [○] [script] AC-ACODE-6: computeAcCoverage aggregates pass/fail per ac_ref; evidence without ac_ref excluded; empty task set yields all-zero facts
  script: test — bunx vitest run packages/core/src/acceptance.test.ts
- [○] [script] AC-ACODE-7: lore ac add/list/rm roundtrip; rm refused while evidence references the id; --force overrides leaving dangling ref visible in list
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts
- [·] [script] AC-ACODE-8: oracle enum kinds defined exactly once (task-workflow.ts ORACLE_KINDS); both adapters reference the SSOT
  script: other — test $(grep -rln 'z.enum(\[.tsc.,' packages/lore/src/adapters/ | wc -l) -eq 0
  other_command=1
- [○] [script] AC-ACODE-9: text projection renders structured AC checklist in get non-raw and export-docs body; raw output untouched. AMENDED 2026-08-23 BY SPEC-143 D7, IN THE SAME COMMIT AS THE RENDERER FIX: the coverage prefix is NO LONGER the three-glyph `✔/✘/·` rule this criterion used to imply. `outline-service.ts::acCoveragePrefix` now DELEGATES to `packages/core/src/acceptance.ts::projectAcCoverageGlyph` over `deriveAcCoverageState`, so all SEVEN coverage states render PAIRWISE-DISTINCT glyphs and the renderer holds no glyph and no precedence rule of its own. ⛔ The authoritative glyph list is that function’s own `switch`, never a transcription here or in the spec body — SPEC-143 AC-CT-1 measures its injectivity (seven states → set size 7, eighth state a compile error) and `scripts/check-ac-state-renderers.ts --rule glyph-projection` refuses any second projection outside `acceptance.ts`. Why amended rather than left alone: fixing the renderer alone would have turned this criterion into a corpus falsehood the mirror check then enshrines. BODY AMENDED IN THE SAME SESSION (v22, agent:main-orchestrator): the 文本投影 bullet now names `projectAcCoverageGlyph` as the single projection instead of transcribing glyphs, closing the residual the implementing agent could only report. ⛔ Mechanically checkable, not prose: `lore get SPEC-038 --json | jq -r .data.doc.content | grep -c '✔/✘/·'` MUST print 0.
  script: test — bunx vitest run packages/lore/tests/unit/service/outline-render.test.ts packages/lore/tests/unit/service/outline-service.test.ts
- [·] [script] AC-ACODE-10: full existing suites pass on both runners (enum extraction + evidenceEntrySchema blast radius)
  script: test — bun run test
  other_command=2
- [○] [script] AC-ACODE-11: monorepo typecheck passes
  script: tsc — bun run typecheck

## Code anchors

- packages/core/src/acceptance.ts
- packages/lore/src/service/ac-service.ts
