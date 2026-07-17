# 决策辅助资源（借鉴标杆索引）

> 90% 架构/设计靠借鉴。匹配场景 → 找标杆 → 抄交互 + 抽象模式。下表所有条目预设为 Tier S/A，可直接作为证据栈来源。

| 用途 | Tier S 入口（首选） | 补充 |
|---|---|---|
| 库 / SDK 文档 | `context7` MCP / `deepwiki` MCP | `gitmcp` MCP / WebFetch 官方 docs |
| 代码用法借鉴 | `grep` MCP（Vercel）/ DeepWiki | GitHub code search / Sourcegraph |
| 技术选型 / 趋势 | ThoughtWorks Tech Radar / CNCF Landscape | O'Reilly Radar / SO Developer Survey |
| 系统设计案例 | ByteByteGo / High Scalability | DDIA 书 / System Design Primer (donnemartin) |
| Engineering blogs | Netflix / Stripe / Uber / Airbnb / Cloudflare / GitHub / Vercel | LinkedIn Eng / Discord Eng / Shopify Eng |
| ADR 决策记录 | MADR 模板 | Log4brains / adr-tools |
| UI / UX 借鉴 | Mobbin（移动+web）/ Webframe（SaaS）| UXArchive / Refero / Land-book / Awwwards / Dribbble / Page Flows / Pttrns |
| 包体积 / 健康度 | Bundlephobia / npm trends | Snyk Advisor / Socket.dev / OpenSSF Scorecard |
| 浏览器兼容 | Can I Use / MDN compat tables | caniemail（邮件 HTML） |
| 调查数据 | State of JS / State of CSS / State of HTML | Web Almanac (HTTP Archive) / Stack Overflow Survey |
| 安全 / 合规 | OWASP（Top10 / ASVS / Cheat Sheets）| CVE / NVD / GHSA / Snyk DB / NIST CSF |
| LLM / Agent | Anthropic docs / OpenAI Platform / Google AI docs | HuggingFace Papers / arXiv / Papers with Code |
| 资讯雷达 / 实时拉取 | OpenCLI（HN / arxiv / lobsters / devto / lesswrong / SO / HF / wikipedia / google-scholar） | 零 token、deterministic、并行；详见 on-demand `opencli-query` |
| 性能基准 | Web.dev / Chrome User Experience Report (CrUX) | TechEmpower benchmarks |

⛔ **不在此清单的来源**默认 Tier D；陌生站点先验证：(a) 作者署名 + 背景，(b) 是否标注更新日期，(c) 与官方 docs 是否一致。
