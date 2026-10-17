---
id: SPEC-039
type: spec
role: spec
title: "Trusted runner: attested evidence for script-mode ACs"
status: approved
priority: medium
created: 2026-07-08
updated: 2026-10-17
tags: [verify, attestation, evidence, runner, spec-039]
links:
  - {id: ADR-001, type: relates-to}
---
# SPEC-039 — Trusted runner:script-mode AC 的 attested evidence

> Feature spec (draft)。Module-primary: core schema + runner service + spawn executor + CLI/MCP 面。
> Upstream: SPEC-038(AC-as-code,verify.script 预留扩展点)、SPEC-025(evidence)、PRD §14(反馈可信度,非 R2 内容)。
> 经 4 路并行评审(coupling/cohesion/reuse+security/testing)修订;两处草案错误被评审证据纠正(见 §9)。

## 1. Problem & Goal

SPEC-038 后 AC 已结构化,但 evidence 的 `result` 仍是调用方断言——`lore evidence --result pass` 与真实跑过命令之间没有机械关联。Anthropic 观察的长时 agent #1 失败模式("mark complete without proper testing")在自报模式下只能靠纪律防守。

**Goal**:`lore verify` 让 lore 亲自执行 AC 绑定的 command,**result 由 exit code 推导**(exit 0 → pass,非零 → fail),evidence 携带 attestation 元数据,且 attestation **只有一个注入点**(伪造在 schema 层被拒)。反馈可信度从"信任声明"升级为"默认路径机械可信"。

**信任边界(显式声明,不卖安全剧场)**:
- 命令来自 spec 的 acceptance_criteria 声明 = 团队已审计,信任级 = npm scripts;调用方本就有 shell,runner 不构成提权,不做容器沙箱
- env 直通 process.env 是**有意识的 trade-off**(测试命令常需要真实环境;恶意命令威胁模型已在 npm-scripts 级接受)——不加 denylist
- attestation 的价值是"默认路径可信 + 伪造有闸",非密码学不可篡改(本地 SQLite 任何进程可写)
- runner 不自动改任何 doc 状态、不 approve(§14 R2 红线)

## 2. Layer Stack 映射

```
packages/core/src/task-workflow.ts     ← ATTESTATION_RUNNERS = ["lore-cli"] as const(枚举 tuple,非裸 literal——ORACLE_KINDS 教训);
                                          evidenceEntrySchema += attestation?: z.object({runner: z.enum(ATTESTATION_RUNNERS),
                                          exit_code: int, duration_ms: int≥0, timed_out: boolean}).optional() ⛔必须 optional
                                          (extractEvidence 整数组 fail-closed:必填会让全部存量 evidence 静默归零);
                                          + resolveTargetTask(tasks, opts) 纯函数(组合 extractClaim/isClaimStale)
packages/core/src/acceptance.ts        ← verify.script += timeout_ms?: int>0 optional(D2 预留字段首启;cwd/env 继续延后);
                                          computeAcCoverage facts += refs[].attested + attested_pass/attested_fail(attested 判定唯一推导点)
packages/core/src/config.ts            ← 新 verify 段:{ default_timeout_ms: 300000 }(对齐 audit.* 独立段先例)
packages/lore/src/service/task-workflow-service.ts
                                       ← EvidenceInput 改 Omit<EvidenceEntry,"recorded_at"|"attestation">;
                                          addEvidence 收到带 attestation 的输入 → VALIDATION_ERROR fail-loud(不静默剥离);
                                          NEW recordVerifiedEvidence(idOrSlug, entry+attestation, now) —— attestation 唯一注入点,
                                          不暴露给 CLI/MCP,仅 VerifyRunnerService 调用
packages/lore/src/service/verify-runner-service.ts
                                       ← NEW VerifyRunnerService:纯编排四步全委托——
                                          ① 注入的 getPlanBundle 取数(bound-function 端口,镜像 resolveDeclaredAcIds 装配)
                                          ② core resolveTargetTask 解析宿主 task(显式 --task 优先;缺省唯一非 stale claim;0/n → err 列候选)
                                          ③ 注入的 executor 执行 ④ 注入的 recordVerifiedEvidence 记账
packages/lore/src/service/verify-spawn.ts     ← 纯函数(vitest):buildVerifySpawnSpec(criterion, config) + deriveVerifyResult(exitCode, timedOut)
packages/lore/src/service/verify-executor.ts  ← bun-only(文件头声明,镜像 claude-cli-provider):Bun.spawn detached 新进程组,
                                          kill(-pid) SIGTERM → 5s grace → kill(-pid) SIGKILL(⚠ 新行为:现有 provider 只发 SIGTERM,
                                          此处为 SPEC-039 新增的升级链,防 fork 子孙存活);stdout+stderr 合并截断 4000 → output_tail
packages/lore/src/adapters/cli/commands/verify.ts ← lore verify <plan> [--ac <id>...] [--task <t>] [--json] [--by]
packages/lore/src/adapters/mcp/tools.ts    ← NEW lore_verify {plan, ac?, task?, by}(第 24 个工具;agent 面的自报替代)
packages/lore/src/ai/assess-template.ts    ← AC 表 coverage 列加 attested 注记("2 pass (1 attested)");ASSESS_PROMPT_VERSION 4→5
ac list 渲染                                ← attested-pass 前缀 ⚑✔(渲染归消费者,判定在 computeAcCoverage)
```

## 3. 关键语义

| 情形 | 行为 |
|---|---|
| exit 0 | evidence result=pass + attestation |
| 非零 exit | evidence result=fail + attestation(fail 是数据,不是错误) |
| 超时 | SIGTERM(-pid) → 5s → SIGKILL(-pid);evidence result=fail + timed_out=true |
| spawn 启动失败(ENOENT 等) | err(EXECUTION 类错误),**不记 evidence**(环境坏 ≠ 代码 fail,不诬陷代码) |
| 目标 task 歧义(0 或 >1 候选且无 --task) | err 列出候选,fail-loud |
| draft spec 的 AC | 执行 + stderr 警告行(不硬闸:实现期需要 verify,且调用方本就有 shell) |
| ai/human mode 的 AC | 跳过并在输出中列明(runner 只管 script) |
| 伪造:CLI/MCP evidence 带 attestation | VALIDATION_ERROR,拒收 |

## 4. Design Decisions

| # | Decision | Choice | Rationale(评审来源) | Trade-off |
|---|---|---|---|---|
| D1 | attestation 形状 | 嵌套 optional 对象;runner 用 as const tuple 枚举 | 缺席=self-reported 自描述;必填会触发 extractEvidence 整数组静默归零(Testing);裸 literal 重蹈三拷贝覆辙(Security) | 旧记录无法追溯标注 |
| D2 | 防伪 | 公开 EvidenceInput 排除 attestation + fail-loud 拒收;recordVerifiedEvidence 内部唯一注入点 | 不修则 spec 反向制造虚假可信信号,比没有更糟(Security,critical) | 多一个 service 方法 |
| D3 | runner 依赖 | 双 bound-function 端口(getPlanBundle + recordVerifiedEvidence),app.ts 装配 | 不引 service→service 依赖;不建第二条遍历 locus(Coupling) | 装配线 +2 |
| D4 | task 匹配 | core 纯函数 resolveTargetTask,组合既有 isClaimStale/extractClaim | 可测启发式不裸写进 service(Cohesion);fixture 零新增(Testing) | core +1 导出 |
| D5 | spawn 拆分 | 纯 spec builder + result mapper(vitest)/ bun-only executor 两文件 | hermetic-spawn/provider 既有二分先例(Coupling/Testing) | 文件 +1 |
| D6 | 进程树终止 | detached 进程组 + kill(-pid),SIGTERM→5s→SIGKILL | 顶层 kill 杀不死 fork 子孙(Security);⚠ 显式标注为新行为,无既有先例(Coupling 纠错) | 平台语义依赖 POSIX |
| D7 | env | 直通,不加 denylist | 威胁模型已在 npm-scripts 级接受,加即过度设计(Security) | 秘密对被执行命令可见(已声明) |
| D8 | attested 推导 | computeAcCoverage 单点;渲染归消费者 | SPEC-038 D6 约定延续(Cohesion) | 消费者各写格式化 |
| D9 | config | 独立 verify.* 段 | audit.* 先例(Cohesion) | — |
| D10 | 真实 spawn 测试经济 | 双注入测全部业务逻辑;真 spawn 仅 2 个 bun test(SIGTERM 短 stub + SIGKILL trap-stub 各 1,后者 ≥5s 唯一一次) | ai-timeout.bun.test.ts 既有经济模式(Testing) | SIGKILL 路径 1 次 5s 真实耗时 |

## 5. SPEC-039 自身 AC(dogfood:实现后由 lore verify 亲自验证——attested evidence 验证 attestation 自身)

| id | statement | verify |
|---|---|---|
| AC-VRF-1 | attestation optional;混合数组(legacy 无 + 新 有)经 extractEvidence 整体可解析 | script:test — core 测试 |
| AC-VRF-2 | CLI/MCP evidence 输入携带 attestation → VALIDATION_ERROR 拒收(exit 4) | script:test |
| AC-VRF-3 | lore verify 走通:exit0 命令 → attested pass evidence(exit_code/duration_ms 正确) | script:test |
| AC-VRF-4 | deriveVerifyResult:0→pass,非零→fail;纯函数 | script:test |
| AC-VRF-5 | 超时:SIGTERM 达进程组;trap TERM 存活者 5s 后被 SIGKILL;evidence fail+timed_out | script:test — bun test(真 spawn ×2) |
| AC-VRF-6 | ENOENT → err,无 evidence 落库 | script:test |
| AC-VRF-7 | resolveTargetTask 矩阵:0/1/n claim、stale、--task 覆盖 | script:test |
| AC-VRF-8 | computeAcCoverage attested 计数正确;ac list 渲染 ⚑ 前缀 | script:test |
| AC-VRF-9 | assess prompt v5 + attested 注记;3 处版本断言同步更新 | script:test |
| AC-VRF-10 | lore verify CLI 与 lore_verify MCP happy/negative 路径 | script:test |
| AC-VRF-11 | 双 runner 全量零回归 | script:test — bun run test |
| AC-VRF-12 | typecheck 通过 | script:tsc — bun run typecheck |

## 6. 测试策略(六维度,按 Testing 视角经济模型)

HAPPY: VRF-3/4/8/10;NEGATIVE: VRF-2/6/7(歧义);BOUNDARY: timeout_ms 边界、输出 4000 截断、空 script AC 集;ERROR: 端口 err 透传、spawn 启动错;STATE: verify 后 coverage 从 ·→⚑✔、重复 verify 追加不覆盖;REGRESSION: VRF-1 混合数组(**新 oracle,现有兼容测试未覆盖**)、v4 断言迁移、VRF-11 全量。业务逻辑全走注入 double(vitest);真 spawn 仅 2 个 bun test。

## 7. Non-goals

容器/VM 沙箱;远程/CI runner(ATTESTATION_RUNNERS 枚举已留位);自动状态变更/auto-approve(§14 R2);ai/human mode 的自动裁决;attestation 密码学签名。

## 8. Perspective Tensions Resolved

| Tension | Resolution |
|---|---|
| 依赖形状(双 service vs 端口 vs 自建遍历) | 双 bound-function 端口(Coupling),getPlanBundle 复用不新增 resolvePlanScriptAcs |
| 防伪 vs API 简单 | 公开路径 fail-loud 拒收 + 内部唯一注入点(Security critical,成本一个方法) |
| 真 spawn 覆盖 vs flake | double 测逻辑 + 恰好 2 个真 spawn test(Testing) |
| env 净化 vs 过度设计 | 直通 + 显式声明 trade-off,不加 denylist(Security 自己反对加) |

## 9. 评审对草案的两处事实纠错(留档)

1. 草案称 SIGKILL 升级"镜像 ClaudeCliProvider"——实际 provider 只发 SIGTERM,无升级链。已改标为 SPEC-039 新行为(D6)。
2. 草案想当然认为 attestation 可平滑加入 schema——Testing 查证 extractEvidence 整数组 fail-closed,必填即静默数据事故;且现有兼容测试从未测混合数组。已锁定 optional + 新增混合数组 oracle(AC-VRF-1)。

## Quality Gates(module mode)
- [x] 无循环依赖(core 纯函数 ← service 编排 ← adapter;executor bun-only 隔离)
- [x] 单一职责(runner-service 四步全委托;判定逻辑全在 core 纯函数;注入点唯一)
- [x] 公共 API 足以黑盒测试(double executor + 端口 stub + 纯函数)
- [x] 依赖可注入(getPlanBundle/recordVerifiedEvidence/executor 三注入)


## Acceptance Criteria (structured)

- [⚑] [script] AC-VRF-1: attestation is optional on evidenceEntrySchema; a mixed evidence array (legacy entry without + new entry with attestation) parses as a whole via extractEvidence
  script: test — bunx vitest run packages/core/src/task-workflow.test.ts
- [⚑] [script] AC-VRF-2: evidence write surfaces (CLI lore evidence / MCP lore_evidence_add) reject input carrying attestation with VALIDATION_ERROR exit 4
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-service.test.ts
- [⚑] [script] AC-VRF-3: lore verify end-to-end: exit-0 command produces attested pass evidence with correct exit_code and duration_ms via recordVerifiedEvidence sole injection site
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts
- [⚑] [script] AC-VRF-4: deriveVerifyResult pure fn: exit 0 maps to pass, nonzero to fail, timeout flag preserved
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-spawn.test.ts
- [⚑] [script] AC-VRF-5: timeout delivers SIGTERM to the process group; a TERM-trapping survivor is SIGKILLed after the grace period; evidence records fail with timed_out true
  script: test — bunx --bun vitest run packages/lore/tests/integration/verify-executor.bun.test.ts
- [⚑] [script] AC-VRF-6: spawn launch failure (ENOENT) returns err and records no evidence
  script: test — bunx --bun vitest run packages/lore/tests/integration/verify-executor.bun.test.ts
- [⚑] [script] AC-VRF-7: resolveTargetTask matrix: zero/one/many fresh claims, stale claim excluded, explicit task override wins, ambiguity fails loud listing candidates
  script: test — bunx vitest run packages/core/src/task-workflow.test.ts
- [⚑] [script] AC-VRF-8: computeAcCoverage carries attested counts as the single derivation point; ac list renders attested-pass prefix
  script: test — bunx vitest run packages/core/src/acceptance.test.ts packages/lore/tests/unit/service/ac-service.test.ts
- [⚑] [script] AC-VRF-9: assess prompt bumps to version 5 with attested annotation in the AC table; the three version-4 assertions migrate in the same change
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess.test.ts
- [⚑] [script] AC-VRF-10: lore verify CLI and lore_verify MCP happy and negative paths (ambiguous task, no script ACs, draft-spec warning)
  script: test — bunx vitest run packages/lore/tests/integration/cli/verify.test.ts
- [⚑] [script] AC-VRF-11: full suites pass on both runners with zero regressions
  script: test — bun run test
- [⚑] [script] AC-VRF-12: monorepo typecheck passes
  script: tsc — bun run typecheck

## Code anchors

- packages/lore/src/service/verify-runner-service.ts
- packages/lore/src/service/verify-spawn.ts
