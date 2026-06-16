---
id: TECH-01KV4W88GZF74B98BHCBBV9GHD
type: tech-spec
category: architecture
title: 文档树一致性保证 (Tree Consistency Guarantees)
summary: >-
  两道闸保证文档树与声明式期望一致：结构闸(create/link 父子类型契约硬闸 + 复用 store 既有环检测) +
  蓝图闸(lore.tree.yaml vs 实际树 diff，四类漂移)。存量错位由 check-tree --fix 半自动归位。零新增依赖。已纳入 4
  路并行评审 9 项修订。
status: approved
priority: high
tags:
  - tree
  - consistency
  - schema
  - cli
  - validation
  - 'module:tree-consistency'
created: '2026-06-15T05:32:14.754Z'
updated: '2026-06-15T05:34:26.684Z'
version: 1.0.1
---
# Tech-Spec: 文档树一致性保证 (Tree Consistency Guarantees)

> Module-primary design, spanning database(schema/yaml) + api(CLI). Consumer: plan → test → implement.
> Upstream intent: **PRD-001 §1 "PRD-as-living-root: every document is reachable through a tree rooted at the product PRD."**
> v2 — 已纳入 4 路并行评审(coupling/schema/algorithm/testing)修订，见 §9。

## 1. Problem & Goal

文档树形状当前依赖创建者手填正确 `parent_id`，缺可校验 SSOT。评审核实后，三缺口的**真实状态**：

| 缺口 | 真实现状(核实后) | 本设计动作 |
|---|---|---|
| 父子类型语义 | 完全缺失 | **新增**契约表 + create/link 硬闸 |
| 环检测 | **link 路径已实现**(store.addLink→detectParentCycle，走 link 表) | **复用**；仅补 `fix` 绕过缺口 |
| 声明式期望骨架 | 完全缺失 | **新增** lore.tree.yaml + check-tree |

**Goal**: 两道闸 —— 结构闸(硬，create-time) + 蓝图闸(软，check-time)；存量错位由 `--fix` 半自动归位。

## 2. Layer Stack 映射

```
src/core/doc-type-rules.ts ← 父子类型契约 PARENT_TYPE_CONTRACT + isValidParentType (新增，独立于 schemas)
src/core/tree-blueprint.ts ← lore.tree.yaml 的 Zod schema + parseTreeBlueprint (新增)
src/core/graph-utils.ts    ← ancestorChainWalk 纯函数(环/祖先链 SSOT) (新增)
src/core/errors.ts         ← 新增 INVALID_PARENT_TYPE；复用 LINK_CYCLE / SCHEMA_VIOLATION
src/service/corpus-service.ts     ← create 加父类型+父存活闸；link 复用 store 环检测(不重复) (改)
src/service/tree-check-service.ts ← 期望树 vs 实际树 diff + fix (新增模块)
src/adapters/cli/commands/status.ts ← --check-tree / --fix (改)
src/adapters/cli/commands/tree.ts   ← --orphans (改)
```

## 3. Database/Schema 维度

### 3.1 父子类型契约表 — 放独立 core 模块 (评审1: SRP)

不塞进 `schemas.ts`(其职责是 Zod schema + superRefine)。新建 `src/core/doc-type-rules.ts` 作领域关系 SSOT，create/link/check 三处共用。

```typescript
// src/core/doc-type-rules.ts
import type { DocType } from "./types.js";

// 文档类型的合法父类型集合。空集 = 只能作根(parent_id=null)。
export const PARENT_TYPE_CONTRACT = {
  prd:       [],                    // 根，不可有父
  spec:      ["prd"],               // spec 只能挂 prd
  adr:       ["prd", "spec"],       // 决策可挂 prd 或 spec
  plan:      ["prd", "spec"],       // 计划可挂 prd 或 spec
  task:      ["plan"],              // 任务只能挂 plan
  knowledge: ["prd", "spec", "adr", "plan", "knowledge"], // 自由挂载，可嵌套
} as const satisfies Record<DocType, readonly DocType[]>;
// satisfies 是穷举守卫：新增 DocType 未补契约 → 编译期报错

export function isValidParentType(child: DocType, parent: DocType): boolean {
  return (PARENT_TYPE_CONTRACT[child] as readonly DocType[]).includes(parent);
}
export const ROOT_TYPES: readonly DocType[] =
  (Object.keys(PARENT_TYPE_CONTRACT) as DocType[]).filter(t => PARENT_TYPE_CONTRACT[t].length === 0);
```

> **正交性与错误码两阶段**(评审2)：现有 `superRefine` 的"spec/task 必填 parent_id"在 **Zod 层先触发**(`PARENT_REQUIRED`/`VALIDATION_ERROR`)；父类型合法性在 **service 层后触发**(`INVALID_PARENT_TYPE`)。二者两阶段防御，错误码共存：`create spec` 不填 parent → 只会收到 `PARENT_REQUIRED`。

### 3.2 lore.tree.yaml 期望树蓝图格式

放项目根(与 `.lore/` 同级)，纳入 git。节点按 **type + 层级位置 + 基数(min/max)** 匹配，不引用 ULID。

```yaml
version: 1
root:
  type: prd
  slug: prd-*            # 可选 glob
  children:
    - type: spec
      min: 1
      max: null
      children:
        - type: plan
          min: 0
          children:
            - { type: task, min: 0 }
    - type: adr
      min: 0
```

### 3.3 Zod Schema (外部数据边界，禁止裸 parse；含 min/max 互约束)

```typescript
// src/core/tree-blueprint.ts
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { docTypeSchema } from "./schemas.js";

const treeNodeSpecSchema: z.ZodType<TreeNodeSpec> = z.lazy(() =>
  z.object({
    type: docTypeSchema,
    slug: z.string().optional(),
    min: z.number().int().min(0).default(0),
    max: z.number().int().positive().nullable().default(null), // null=无上限；positive 排除 0/负
    children: z.array(treeNodeSpecSchema).default([]),
  }).superRefine((node, ctx) => {
    if (node.max !== null && node.max < node.min)
      ctx.addIssue({ code: z.ZodIssueCode.custom,
        message: `max (${node.max}) must be >= min (${node.min})`, path: ["max"] });
  }),
);

export const treeBlueprintSchema = z.object({ version: z.literal(1), root: treeNodeSpecSchema });
export type TreeBlueprint = z.infer<typeof treeBlueprintSchema>;

export function parseTreeBlueprint(raw: string): Result<TreeBlueprint, LoreError> {
  let doc: unknown;
  try { doc = parseYaml(raw); }
  catch (e) { return err({ code: "VALIDATION_ERROR", field: "lore.tree.yaml",
                           message: `YAML parse failed: ${(e as Error).message}` }); }
  const parsed = treeBlueprintSchema.safeParse(doc);
  if (!parsed.success) return err({ code: "VALIDATION_ERROR", field: "lore.tree.yaml",
                                    message: parsed.error.issues[0]?.message ?? "invalid blueprint" });
  return ok(parsed.data);                          // fail loud
}
```

## 4. Module 维度

### 4.1 结构硬闸：create / link 注入点 (评审1+3 修正)

**环检测复用既有 store 实现，service 层不重复**：`store.addLink(link_type='parent')` 已做 `detectParentCycle` 返回 `LINK_CYCLE`；`corpus-service.link` 先 `addLink`(成环即 return)再 `update parent_id`，顺序已安全。**link 路径无需新增环检测。**

`create` **唯一缺口是父类型契约 + 父存活**(create 新节点无子，不可能造环)：

```typescript
// corpus-service.create — resolve parent 后追加
if (data.parent_id) {
  const parent = (await this.store.find(resolvedParentId)).value;
  if (!parent || parent.deleted_at !== null)
    return err({ code: "DOC_NOT_FOUND", id: resolvedParentId });
  if (!isValidParentType(data.type, parent.type))
    return err({ code: "INVALID_PARENT_TYPE", child: data.type,
                 parent: parent.type, allowed: [...PARENT_TYPE_CONTRACT[data.type]] });
}
```
`link(type==='parent')` 仅追加**父类型契约**校验(环检测由 store 兜底)。

> **已知双轨风险(flag，不扩大范围)**：store 的 `detectParentCycle` 走 **link 表**，而 tree/check/fix 走 **DocRecord.parent_id 字段**。二者理论应一致，但 migrate 导入或直接改字段可能漂移。check-tree 以 `parent_id` 字段为权威；link 表一致性属既有设计，不在本次范围。

### 4.2 graph-utils 纯函数 — 环/祖先链 SSOT (评审1)

```typescript
// src/core/graph-utils.ts — 无 store 依赖，纯函数，可独立单测
export function ancestorChainWalk(
  startId: string, getParent: (id: string) => string | null,
): { hasCycle: boolean; path: string[] } {
  const path: string[] = []; const seen = new Set<string>();
  let cur: string | null = startId;
  while (cur !== null) {
    if (seen.has(cur)) return { hasCycle: true, path };
    seen.add(cur); path.push(cur);
    cur = getParent(cur);
  }
  return { hasCycle: false, path };
}
```
TreeCheckService 的 `detectCycles` 与 `fix` 的环守卫都基于它(按 `parent_id` 字段构造 `getParent`)。

### 4.3 TreeCheckService — 蓝图软校验模块

**Module Boundary**：Public `checkTree(blueprint)→Result<TreeReport>`、`fix(blueprint)→Result<FixReport>`；依赖注入 `StoreInterface`；**不碰 fs**(blueprint 由 CLI 读入传进)。

```typescript
export type DriftKind = "missing" | "extra" | "misplaced" | "cycle" | "orphan";
export interface TreeDrift {
  kind: DriftKind;
  expected?: { type: DocType; min: number; max: number | null; at: string };
  actual?:   { id: DocId; slug: string; type: DocType; parent_id: DocId | null };
  blocked_by_cycles?: DocId[];     // missing 因节点在环中而非真缺
  detail: string;
}
export interface TreeReport { consistent: boolean; drifts: readonly TreeDrift[]; }
export interface FixReport { fixed: FixedItem[]; skipped: SkippedItem[]; stillInconsistent: boolean; }
```

**Diff 算法(四类漂移，修正重复计数 + 悬挂父)**：

```
1. allDocs = store.findMany({ exclude_deleted: true })       // 字段是 exclude_deleted
2. byId = Map(id→doc); getParent = id => byId.get(id)?.parent_id ?? null
3. cycles = 用 ancestorChainWalk 对每个 doc 探测 → cyclic:Set<id>；产出 cycle drifts
4. orphan = allDocs.filter(d => d ∉ cyclic && (
              (d.parent_id===null && d.type ∉ ROOT_TYPES)      // 该是子却无父
           || (d.parent_id!==null && !byId.has(d.parent_id)))) // 父软删/不存在=悬挂引用
5. misplaced = allDocs.filter(d => d ∉ cyclic && d.parent_id!==null && byId.has(d.parent_id)
                && !isValidParentType(d.type, byId.get(d.parent_id).type))
6. walk(node, actualParentId):
     siblings = allDocs.filter(c => c.parent_id===actualParentId && c ∉ cyclic)
     matched  = siblings.filter(c => c.type===node.type && globOk(c.slug, node.slug))
     misSameType = siblings.filter(c => c.type===node.type
                     && !isValidParentType(c.type, byId.get(actualParentId)?.type))
     deficit = node.min - matched.length
     if deficit > 0 && (deficit - misSameType.length) > 0:
        push missing{ deficit: deficit - misSameType.length, blocked_by_cycles }
     if node.max!==null && matched.length > node.max: push extra(超出的具体 docs)
     for child in node.children: for m in matched: walk(child, m.id)
7. consistent = drifts.length === 0
```
> 复杂度 O(N·depth)，N<1000。`globOk` 用字面前缀匹配(非用户正则，避免 ReDoS)。

### 4.4 `--fix` 半自动归位 (评审3 修正：唯一 AND 无环)

**"明确归位"完整判定 = 唯一合法父 ∧ 归位不成环**：

```
for d in (orphan ∪ misplaced):                  // cycle 类永不 fix，仅报告
  positions = blueprint 中 child.type===d.type 的所有节点
  legalParents = allDocs 中匹配这些 position 的父候选(type+slug+层级)
  if legalParents.length !== 1:  record SKIPPED(0-or-many candidates); continue
  cand = legalParents[0]
  if ancestorChainWalk(cand.id, getParentAfterAssuming(d.id→cand.id)).hasCycle:
       record SKIPPED(would-create-cycle); continue
  store.update(d.id, { parent_id: cand.id, updated_at })    // 追加 version (与 restore 一致)
  store.insertVersion({ doc_id: d.id, ... })
  record FIXED{ id: d.id, newParentId: cand.id, newVersion }
```
- fix 走 `store.update` 绕过 addLink 环检测 → **必须自带环守卫**。
- `fix` 幂等：第二次执行无可归位项 → 全 SKIPPED，version 不再增。

## 5. API/CLI 维度

| 命令 | 行为 | 退出码 |
|---|---|---|
| `lore status --check-tree` | 读 `lore.tree.yaml`，输出 drift 报告(表格 / `--json`) | 一致=0，不一致=3，无蓝图=4 |
| `lore status --check-tree --fix` | 先 check，对明确归位者 fix，输出 FIXED/SKIPPED | fix 后仍不一致=3，全消解=0 |
| `lore tree --orphans` | 列出 `parent_id===null && type∉ROOT_TYPES` 及悬挂引用文档 | 有=3，无=0 |

退出码实现时核对 `adapters/cli/utils.ts` 现有码表对齐。CLI 层负责读文件→`parseTreeBlueprint`→传 service；fs 读取失败转 exit 4。退出码与 fs 读取只能 bun 子进程集成测试覆盖，service 逻辑走 vitest。

## 6. 错误码变更 (errors.ts)

```typescript
| { code: "INVALID_PARENT_TYPE"; child: string; parent: string; allowed: string[] }  // 新增 1 个
// 复用 0 改动：LINK_CYCLE{path}、SCHEMA_VIOLATION{type,missing,extra}、VALIDATION_ERROR、PARENT_REQUIRED、DOC_NOT_FOUND
```

## 7. Downstream Handoff

### → test (六维度，含评审补充)
- HAPPY: 合法父子 create 成功；蓝图全匹配→consistent=true,exit 0
- NEGATIVE: `create spec --parent <task>`→`INVALID_PARENT_TYPE`；`link` 造 A→B→A→`LINK_CYCLE`(store 既有)；self→self link→`LINK_CYCLE`
- BOUNDARY: min=0 不报 missing；max=null 永不报 extra；max=1 恰好 1 个不报 extra；min=2 恰好 1 个报 missing(off-by-one)；空蓝图 root-only
- ERROR: 非法 YAML / schema 不符 / max<min → `VALIDATION_ERROR` fail loud；无文件→exit 4；悬挂父→归 orphan
- STATE: `--fix` 后 version+1 且 version 记录追加；fix 幂等(二次全 SKIPPED)；归位到后代→SKIPPED(would-create-cycle)
- REGRESSION: 现有 spec/task 必填 parent 的 `PARENT_REQUIRED` 不被新码覆盖(两阶段独立)；现有 21 CLI 命令行为不变
- 重复计数回归: `spec` 挂错到 `plan` 下 → 只报 misplaced，不同时报 prd 下 missing
- runner: service 逻辑主体走 vitest + InMemoryStore；CLI 退出码/fs 走 bun 子进程集成

### → implement (锚点)
- 零新增依赖(yaml@2.7.1, zod@3.24.4 已在)
- `PARENT_TYPE_CONTRACT`(doc-type-rules.ts)、`ancestorChainWalk`(graph-utils.ts) 各为 SSOT，禁止复制实现
- `findMany({ exclude_deleted: true })`(非 `{deleted_at:null}`)
- store 环检测走 link 表、check/fix 走 parent_id 字段 → 见 §9 双轨风险
- blueprint I/O 在 CLI 层，service 不碰 fs

### → plan (分解锚点)
phase: ①core(doc-type-rules / graph-utils / tree-blueprint / errors) → ②create/link 硬闸 → ③TreeCheckService(diff+fix) → ④CLI 接线 → ⑤测试贯穿。①是 ②③ 依赖，先行。

## 8. Quality Gates

**Module**: 无循环依赖(core 纯函数无服务依赖) / 单一职责(契约/解析/diff/图算法各独立文件) / 公共 API 黑盒可测 / 依赖可注入(InMemoryStore)
**Database/Schema**: Zod 边界 fail loud / min/max 整数+互约束 / 无破坏性迁移(fix append-only version；契约表正交新增) / 单次 findMany 全量 O(N·depth)
**Cross-cutting**: Security—blueprint 受 git 控制；glob 字面前缀防 ReDoS。Observability—drift 报告即可观测，`--json` 供 CI。

## 9. 评审修订记录 (4 路并行评审 → 修订)

| # | 评审来源 | 发现 | 修订 |
|---|---|---|---|
| R1 | coupling | 契约表塞 schemas.ts 违反 SRP | 提取 `doc-type-rules.ts` |
| R2 | coupling+testing | service 层 `#wouldCreateCycle` 与 store `detectParentCycle` 重复 | link 复用 store；抽 `graph-utils.ancestorChainWalk` 供 check/fix 共用 |
| R3 | 核实 | store 层环检测**早已存在**(addLink→detectParentCycle) | 删除原设计 link 新增环检测；create 只加类型+存活闸 |
| R4 | algorithm | misplaced+missing **重复计数** | missing 扣除同 type 错位兄弟 |
| R5 | algorithm | `fix` 走 update **绕过环检测**，归位到后代成环 | "明确归位"= 唯一 ∧ 无环；fix 自带 `ancestorChainWalk` 守卫 |
| R6 | schema | 悬挂父(parent 软删) 致 `parentTypeOf` 崩 | 悬挂引用归 `orphan`，不报 misplaced |
| R7 | schema | `max` 无 `>=min` 校验、`min(1)` 语义糊 | superRefine 校验 max≥min；max 用 `.positive()` |
| R8 | testing | 伪码 `{deleted_at:null}` 与真实 `exclude_deleted` 不符 | 全文改 `{ exclude_deleted: true }` |
| R9 | schema | create 两层错误码语义 | 文档明确两阶段防御(PARENT_REQUIRED 先于 INVALID_PARENT_TYPE) |
| 风险 | coupling+testing | store 环检测走 link 表 vs check 走 parent_id 字段 **双轨** | flag 为已知风险，不扩大本次范围；check 以 parent_id 为权威 |


## 10. 实现勘误 (post-DocReview MINOR fixes)

DocReview 通过(0 BLOCKER/0 MAJOR/3 MINOR)，以下 3 处以本节为准(覆盖正文伪码)：

**M1 — 上游决策标注(§1)**：本 spec 执行 PRD-001 已拍板的「方案 B：结构闸 + 蓝图闸」，**不重开方案选型**。

**M2 — create 伪码必须先解包 Result(§4.1，最高优先)**：`StoreInterface.find` 返回 `Promise<Result<DocRecord|null, LoreError>>`，禁止直接 `.value`。正确惯用法：
```typescript
if (data.parent_id) {
  const r = await this.store.find(resolvedParentId);
  if (!r.ok) return r;                                   // 透传 store 错误
  const parent = r.value;
  if (!parent || parent.deleted_at !== null)
    return err({ code: "DOC_NOT_FOUND", id: resolvedParentId });
  if (!isValidParentType(data.type, parent.type))
    return err({ code: "INVALID_PARENT_TYPE", child: data.type,
                 parent: parent.type, allowed: [...PARENT_TYPE_CONTRACT[data.type]] });
}
```
§4.3 diff 中所有 `store.find/findMany` 调用同此惯用法(先 `if (!r.ok) return r`)。

**M3 — FixReport 子类型补全(§4.3)**：
```typescript
export interface FixedItem   { id: DocId; fromParentId: DocId | null; toParentId: DocId; newVersion: number; }
export interface SkippedItem { id: DocId; reason: "0-or-many candidates" | "would-create-cycle"; candidates: DocId[]; }
```
