# Acceptance Criteria Quality

> Layer 2 hard discipline. AC 是 final acceptance — 措辞模糊就是 implementer 的窄解释授权。

## Root failure mode

模糊 AC + 缺少 Integration AC → 组件存在 + 测试 GREEN ≠ 用户能用到。

观察过的失败链（**反复出现**）：
| Spec 文字 | Implementer 窄解释 | 实际用户体验 |
|---|---|---|
| "Onboarding wizard 跑通" | vitest 24/24 GREEN | App 没挂 wizard 路由，用户永远看不到 |
| "wire setLastPush" | hook 暴露 API | 真 ticker 流没调用，WS chip 永远 DISCONNECTED |
| "Intent classifier 实现" | regex fallback 100% accuracy | LLM path TODO，4 fallback trigger 条件无 wire |
| "Tauri notification 集成" | plugin.init() + dispatch fn | watcher_service 没接 dispatch，5min dedup 无 impl |

每次都"完成了"但"没接通"。根因是 AC 没把"用户能观察到"作为强制条件。

## ⛔ Banned verbs (无观察主体)

这些动词允许 implementer 把验证降到"代码存在 + 单测过"。MUST NOT 出现在 AC 文本：

| Banned | Why | Replace with |
|---|---|---|
| 跑通 / works / runs | 谁跑通？什么观察？ | `When 用户 X, observe Y` |
| 实现 / implement | 实现到哪一层？ | `Given Z 状态, observe W` |
| 集成 / integrate / wire | 接到哪？ | `From 入口 E, performing P → effect F` |
| 支持 / support | support 谁？怎么验？ | `Action A → outcome O` |
| 可用 / functional | 谁能用？ | `User flow F completes with result R` |
| 100% / 完整 / full coverage | 覆盖什么？ | 列出可数 criterion |

## ✅ Required AC shape (every criterion)

每条 AC MUST 是可外部观察的状态转移，结构 = **Given / When / Then**：

```
- Given <precondition observable from user entry>,
  When <user action OR external trigger>,
  Then <observable outcome via UI / IPC response / log line / DB state>
```

- **precondition**: 从用户视角的初始 state（"first launch with no settings", "API key configured"）
- **action/trigger**: 用户操作（"clicks Skip"）OR 外部事件（"ticker push arrives"）
- **outcome**: 必须是 EXTERNALLY observable —— 渲染元素 / IPC return value / tracing log key / SQLite row state / file content。NOT internal function return.

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "Component renders correctly" | Where does it render? Who triggers it? Observe what? Concrete or rewrite. |
> | "API works end-to-end" | Trace one concrete payload: input → IPC call → response → UI state. |
> | "Tests pass" 作为 AC | Tests passing is the oracle, NOT the AC. AC is what the test asserts about user-observable behavior. |

## ⛔ Integration AC — MANDATORY for every user-facing feature

每个 user-visible 功能 MUST 至少有 **1 条 Integration AC**，证明"从用户入口可达"：

```
- Integration: From <app entry point — initial route / menu item / first-launch state>,
  performing <user navigation / action>,
  Then <component X renders / feature Y is reachable / event Z fires>
```

判定"user-facing"：触及 component / page / screen / menu / route / system notification / 用户可观察日志 → MUST 包含 Integration AC。

仅触及内部 service / pure compute / data model / DI wiring → 豁免（但 doc_refs 中标注谁会消费）。

## ⛔ Anti-Pattern: 测试 GREEN 当 Integration 证据

- vitest 测组件 isolation → 测的是组件契约，**不是** integration
- cargo test 测 fn 返回 → 测的是函数契约，**不是** wiring
- benchmark accuracy ≥ X% → 测的是算法，**不是** 它在生产路径上被调用

Integration AC 需要 separate oracle：dogfood / E2E / integration test / 验证调用点存在的 grep。

## Examples — 反例 / 正例

### ❌ Bad
```
AC:
- Onboarding wizard 4 step 跑通
- Skip 走默认安全配置
- Onboarding D1 完成率 ≥ 60% telemetry
```
窄解释：vitest 测组件 4 step + payload + tracing 调用 — 全 GREEN，wizard 没挂路由。

### ✅ Good
```
AC:
- D-FUNC: Given fresh install (no onboarding_completed_at in SQLite settings),
  When user opens app,
  Then OnboardingWizard renders as first interactive surface (not behind any route guard).
- D-FUNC: Given user clicks Skip on step 1,
  When wizard dispatches onComplete,
  Then SQLite settings table contains row {key: 'onboarding_completed_at', value: <ISO timestamp>}
  AND {key: 'trading_env', value: 'paper'}
  AND {key: 'risk_preference', value: 'conservative'}.
- Integration: From cold-start app launch (DB empty),
  When app's root component mounts,
  Then route resolves to /onboarding/step-1 (not /agent or other default).
- Integration: After completion,
  When user re-launches the app,
  Then onboarding_completed_at is present AND wizard does NOT render (route resolves to /agent).
```

### ❌ Bad
```
AC:
- wire setLastPush in BinanceMarketStream
- WS latency chip 实时刷新
```

### ✅ Good
```
AC:
- D-FUNC: Given BinanceMarketStream subscribed to BTCUSDT@ticker,
  When a ticker frame arrives at the onmessage handler,
  Then setLastPush(Date.now()) is called BEFORE the callback returns
  (verified by grep: 'setLastPush' present in src/infrastructure/exchange/binance/market-stream.ts at line ≤ <onmessage end>).
- Integration: Given app running with live Binance WS connection,
  When the dev observes ActiveAgentBar for 5 seconds,
  Then ws-latency chip's data-latency-tier attribute updates at least once from initial 'red' to 'green' or 'yellow'
  (proof: take 2 screenshots 3 seconds apart, attribute value differs).
```

## Enforcement

- Spec-level structured ACs: `lore ac add <spec> <AC-ID> --statement "..." --mode script|ai|human` — script mode binds an oracle (`--oracle test --command "..."`), executed as attested evidence by `lore verify <plan>`; the `spec-promote` gate requires ≥1 AC before a spec can be approved
- lore-reader audit (mode-create step 8.3, dimension `ac_oracle_binding`): scan AC text for banned verbs → flag; every user-facing task's content MUST contain an `Integration:` block — missing = NEEDS_WORK verdict
- AC reviewer at phase gate: explicit check "is feature reachable from app entry point" per task
- Dogfood gate: Integration AC supplies the dogfood test script — gate failure = re-open Integration AC, not "SKIP because Tauri"

## Triggers — when to consult this file

- 写 / review / 修改 AC 文本
- `lore ac add` / `lore create task`（写 task AC 内容时）
- Phase Gate AC review / lore-reader 5-dimension audit
- 解释 implementer 为什么"按 AC 做完了"但功能不通
