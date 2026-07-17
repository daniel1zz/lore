# OpenCLI 查询命令速查

零 LLM cost runtime；命令并行友好（`&` + `wait`）。**仅查询场景**——写新 adapter / 修坏 adapter / 站点交互需另装对应 skill，本规则不涉及。

## Public API（无需登录，开箱即用）

| 站点 | 命令 | 典型用法 |
|---|---|---|
| **arxiv** | `search` `paper` | `opencli arxiv search "agent memory" --limit 10` |
| **hackernews** | `top` `new` `best` `ask` `show` `jobs` `search` `user` | `opencli hackernews top --limit 30` / `opencli hackernews search "MCP"` |
| **stackoverflow** | `hot` `search` `bounties` `unanswered` | `opencli stackoverflow search "<error msg>"` |
| **lesswrong** | `curated` `frontpage` `top` `top-week` `top-month` `read` `tag` `tags` `comments` | `opencli lesswrong top-week` |
| **lobsters** | `hot` `newest` `active` `tag` | `opencli lobsters tag rust` |
| **wikipedia** | `search` `summary` `random` `trending` | `opencli wikipedia summary "Model Context Protocol"` |
| **devto** | `top` `tag` `user` | `opencli devto tag ai` |
| **hf** | `top` | `opencli hf top` |
| **bluesky** | `search` `profile` `feeds` `trending` `thread` | `opencli bluesky trending` |
| **google-scholar** | `search` `cite` `profile` | `opencli google-scholar search "agent rag"` |
| **baidu-scholar / wanfang** | `search` | 中文学术 |
| **paperreview** | `submit` `review` `feedback` | 论文评审 |

## Browser 模式（需 Chrome 已登录目标站）

| 站点 | 命令 | 备注 |
|---|---|---|
| **reddit** | `hot` `frontpage` `subreddit` `search` `read` `user-posts` | `opencli reddit subreddit ClaudeCode hot --limit 20` |
| **substack** | `feed` `search` `publication` | 技术 newsletter |
| **producthunt** | `posts` `today` `hot` `browse` | 新工具发现 |
| **medium** | `feed` `search` `user` | 技术博客 |

## 用法约定（MUST）

- **优先级**：调研类任务先想 OpenCLI（零 token、deterministic），再想 WebSearch / WebFetch。
- **并行**：多源调研 MUST 并行 — `cmd1 & cmd2 & cmd3 & wait`。
- **命令名**：不确定时跑 `opencli <site> --help`，禁止凭记忆瞎写。
- **空数据排查**：返回空多半是站点改版，告知用户跑 `opencli-autofix` skill 修复（用户按需一次性补救，本规则不展开）。
- **超时**：默认 60s，慢站点用 `OPENCLI_BROWSER_COMMAND_TIMEOUT=120 opencli ...`。
- **登录态**：Browser 模式调用前必须先在 Chrome 登过；否则会返回 401/空。

## 触发示例（何时 Read 本规则）

✅ "调研一下 RAG 最新方案"、"HN 上对 MCP 的讨论怎么样"、"找几篇 agent memory 的 paper"、"这个 error 别人遇到过吗"、"r/LocalLLaMA 最近热点"、"看看今天 ProductHunt 有什么新工具"

❌ 写代码、改 bug、跑测试、文档查询（用 context7/deepwiki/gitmcp）、代码搜索（用 grep MCP / serena）、整 repo 语义问答（用 deepwiki）

## 信息源
- [docs/adapters/index.md](https://github.com/jackwener/opencli/blob/main/docs/adapters/index.md) — 命令清单 Tier S 来源
- 命令名实测：`gh api repos/jackwener/opencli/contents/clis/<site>` (2026-04-28)
