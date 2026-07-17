# Skill Recommendation Map

DNA dimensions → recommended skills. Skill names match installed skill registry.

## By Framework

| Framework | Skills | Notes |
|-----------|--------|-------|
| Next.js | `frontend-design`, `tailwind-css-patterns`, `deploy` | Vercel deploy common |
| Nuxt | `frontend-design`, `tailwind-css-patterns`, `deploy` | |
| UniApp | `uniapp`, `wechatpay-basic-payment` | WeChat ecosystem |
| NestJS | `design` (api mode), `deploy` | API design critical |
| FastAPI | `design` (api mode), `deploy` | API design critical |
| Electron | `electron` | Desktop automation |
| Tauri | `tauri-v2` | Cross-platform desktop |

## By Platform Dependency

| Platform | Skills | Notes |
|----------|--------|-------|
| WeChat Pay | `wechatpay-basic-payment`, `wechatpay-product-coupon` | Payment integration |
| Vercel | `vercel-sandbox`, `deploy` | Hosting + serverless |
| Solana | `solana-dev`, `raydium` | Web3 ecosystem |
| AWS | `deploy` | Cloud infrastructure |
| Supabase | `deploy` | BaaS |
| Cloudflare | `deploy` | Edge + Workers |

## By Business Domain

| Domain | Skills | Notes |
|--------|--------|-------|
| Fintech | `security-review` (critical), `design` | Extra security gates |
| E-Commerce | `wechatpay-basic-payment`, `design` | Payment flows |
| SaaS | `design`, `deploy`, `operate` | Full lifecycle |

## Universal (All Projects)

These skills are recommended for every project:

| Skill | Purpose |
|-------|---------|
| `review` | Code review and quality |
| `test` | Test strategy and writing |
| `diagnose` | Bug investigation |
| `git-workflow` | Structured git operations |
| `design` | Architecture and API design |
| `domain` | Domain model analysis |
| `product` | PRD and requirements |
| `plan` | Cross-session task planning |
| `lore-kickoff` | Knowledge corpus setup |

## Output Format

When presenting recommendations, group as:

```markdown
### Recommended Skills for [Project Name]

**Framework-specific:**
- `/uniapp` — UniApp cross-platform development patterns

**Domain-specific:**
- `/wechatpay-basic-payment` — WeChat payment integration

**Platform-specific:**
- `/deploy` — Vercel deployment and CI/CD

**Universal (all projects):**
- `/review`, `/test`, `/diagnose`, `/git-workflow`, `/design`
```
