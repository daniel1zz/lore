# Test Anti-Patterns — Known False-Green Patterns

> External oracle grep 可检测的假绿模式。每个模式附 grep 命令 + 修复方案。

## ⛔ P1: Whole-Module vi.mock (Mock Amnesia)

**症状**: `vi.mock('module')` 或 `vi.mock('module', () => ({...}))` 替换整个模块，测试验证的是 mock 行为而非真实行为。

**grep 检测**:
```bash
grep -rn 'vi\.mock(' <test-file> | wc -l  # count total mocks
grep -rn 'vi\.mock([^,]*$' <test-file>     # auto-mock (no factory) — worst case
```

**修复**: 用 `vi.spyOn` 替代 — 保留真实实现，只监控调用。必须 mock 时用 partial mock (`vi.mock('mod', async () => { const actual = await vi.importActual('mod'); return { ...actual, specificFn: vi.fn() }; })`)。

**判定阈值**: 同一文件 ≥3 个 `vi.mock` 且无 `vi.importActual` → 红旗。

## ⛔ P2: Stub Empty Transaction Data ('AA==' / empty Buffer)

**症状**: 交易/payload 用 `'AA=='`、`Buffer.alloc(0)`、`''` 等空占位符，测试通过但真实数据解析会失败。

**grep 检测**:
```bash
grep -rn "AA==" <test-file>
grep -rn "Buffer\.alloc(0)" <test-file>
grep -rn "transaction.*['\"]\\s*['\"]" <test-file>
```

**修复**: 使用从真实环境录制的 fixture 数据，或用 builder pattern 构造符合 schema 的最小有效数据。

## ⛔ P3: Fetch Mock Without Request Body Verification

**症状**: mock fetch 只验证 URL 被调用，不验证请求体内容。接口签名变更时测试仍绿。

**grep 检测**:
```bash
# 查找 fetch mock 设置
grep -n 'mockResolvedValue\|mockReturnValue\|respondWith' <test-file>
# 查找是否验证了 request body
grep -n 'toHaveBeenCalledWith\|calledWith.*body\|request\.body\|req\.body' <test-file>
```

**修复**: 在 `expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ body: expect.stringContaining(...) }))` 中验证请求体。或用 msw 的 `req.json()` 在 handler 内断言。

## ⛔ P4: `as unknown as Type` Type Safety Bypass

**症状**: 测试 fixture 用 `as unknown as Config` 绕过类型检查，接口新增必需字段时测试不报错。

**grep 检测**:
```bash
grep -rn 'as unknown as' <test-file>
grep -rn 'as any' <test-file>
```

**修复**:
- 用 `satisfies` 操作符: `const config = { ... } satisfies Config`
- 用 factory/builder: `const config = createTestConfig({ override: 'value' })`
- 用 Zod parse: `const config = ConfigSchema.parse({ ... })` — 缺字段直接 throw

## ⛔ P5: Snapshot-Only Assertion (Frozen Bug)

**症状**: 只用 `toMatchSnapshot()` / `toMatchInlineSnapshot()`，bug 引入后 `--update` snapshot 就"修复"了。

**grep 检测**:
```bash
grep -c 'toMatchSnapshot\|toMatchInlineSnapshot' <test-file>
grep -c 'toEqual\|toBe\|toThrow\|toHaveBeenCalled' <test-file>
# snapshot count >> explicit assertion count → 红旗
```

**修复**: Snapshot 只用于 UI 渲染输出、序列化格式等 structural output。业务逻辑用 explicit assertion。Ratio: explicit ≥ 2× snapshot。

## ⛔ P6: Test-Implementation Tautology

**症状**: 测试直接复制了实现逻辑来构造 expected value，实现有 bug 测试也有同样的 bug。

**检测**: 人工判断或 AI review — 比较 test assertion 逻辑与 source 实现逻辑的相似度。

**修复**: Expected value 从 spec/AC 推导，不从实现代码推导。用 hardcoded known-good values（从手算或外部工具确认）。

## ⛔ P7: Mocking the Unit Under Test

**症状**: 对被测对象自身的方法做 mock/spy，测试的是 mock 框架而非代码。

**grep 检测**:
```bash
# 如果 describe 块名是 FooService，检查是否 mock 了 FooService 的方法
grep -A5 'describe.*FooService' <test-file> | grep 'spyOn.*FooService\|mock.*FooService'
```

**修复**: 只 mock 外部依赖，不 mock 被测对象。如果必须 mock 内部方法，说明设计有问题 — 提取为依赖注入。

## ⛔ P8: No Assertion Test (Silent Pass)

**症状**: `it('should work', () => { doSomething(); })` — 没有 expect/assert，永远通过。

**grep 检测**:
```bash
# 找到 it/test 块但没有 expect/assert 的
grep -c 'it(\|test(' <test-file>
grep -c 'expect(\|assert' <test-file>
# it count >> expect count → 存在无断言测试
```

**修复**: 每个 `it` 块必须至少 1 个 `expect` 或 `assert`。ESLint rule: `vitest/expect-expect`。

## Quick Audit Command

```bash
# Run all checks on a test file
FILE="src/foo.test.ts"
echo "=== Anti-Pattern Scan: $FILE ==="
echo "P1 vi.mock:     $(grep -c 'vi\.mock(' "$FILE") mocks, $(grep -c 'vi\.importActual' "$FILE") importActual"
echo "P2 stub data:   $(grep -c 'AA==\|Buffer\.alloc(0)' "$FILE") hits"
echo "P3 fetch mock:  $(grep -c 'toHaveBeenCalledWith' "$FILE") body checks"
echo "P4 type bypass: $(grep -c 'as unknown as\|as any' "$FILE") hits"
echo "P5 snapshot:    $(grep -c 'toMatchSnapshot\|toMatchInlineSnapshot' "$FILE") snapshots vs $(grep -c 'toEqual\|toBe\|toThrow' "$FILE") explicit"
echo "P8 no assert:   $(grep -c 'it(\|test(' "$FILE") tests vs $(grep -c 'expect(' "$FILE") expects"
```
