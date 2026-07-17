# Tool: railway

## Overview
Railway — all-in-one cloud for deploying services from Dockerfiles/Nixpacks with per-service env vars, private networking, and cron. In zz stack: hosts long-running workers (anything that can't live on Vercel's request/response model, e.g. guyin's intraday polling worker).

## Installation
```bash
# Preferred (macOS)
brew install railway

# Or npm (official org-scoped package)
npm i -g @railway/cli

railway --version   # verify (latest known: 5.23.x)
```

## Authentication
Three modes — pick by context:

| Context | Method |
|---------|--------|
| Interactive dev machine | `railway login` (opens browser) |
| No-browser machine / SSH | `railway login --browserless` (prints pairing URL + code) |
| CI/CD, project-scoped (deploy/up/redeploy) | `RAILWAY_TOKEN=<project-token> railway up` |
| CI/CD, account/workspace-scoped (init/create) | `RAILWAY_API_TOKEN=<account-token>` |

⛔ `RAILWAY_TOKEN` and `RAILWAY_API_TOKEN` are mutually exclusive — setting both errors.
⛔ `railway login` is interactive-only: from an agent session, have the user run `! railway login` (or `--browserless`); token env vars are the only fully non-interactive path.
Project tokens are minted in the Railway dashboard per project+environment; account tokens under Account Settings → Tokens.

## Key Commands
```bash
railway init [--name <name>] [--workspace <ws>] [--json]  # create project, link cwd
railway link                          # link cwd to existing project/service
railway add -d postgres               # provision a database service
railway add                           # add an (empty) app service to the project
railway up [-d]                       # build + deploy linked service (-d = detach)
railway variables [--set KEY=VALUE]   # read/write service env vars
railway domain                        # assign a public domain to the service
railway logs                          # tail deploy/runtime logs
railway status                        # linked project/environment/service info
railway redeploy                      # redeploy latest build
```
Build config via `railway.json` at repo/service root:
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": { "preDeployCommand": "<migrations etc>" }
}
```

## MCP Integration
Official MCP server ships INSIDE the CLI (no separate npm package — `@railway/mcp-server` on npm is a deprecated shim):
```bash
railway mcp install   # merges Railway entry into existing MCP configs; re-run to update
```

## Env Vars
- `RAILWAY_TOKEN` — project-scoped CI auth (deploy-class commands)
- `RAILWAY_API_TOKEN` — account/workspace-scoped CI auth (project-create-class commands)
- Service runtime env vars are set per-service via `railway variables --set` (never committed)

## Integration with lore-auto-wire
- **init-project**: for projects with a worker component — `railway init --name <project>` → `railway add` (worker service) → `railway variables --set` (DATABASE_URL from Neon, provider keys) → `railway up` from the worker directory (Dockerfile builder) → record `railway_project_id` in `~/.config/lore-auto-wire/config.json` under the project entry.
- **add**: `add railway` on an existing project = install CLI if missing → auth (user `! railway login`, or token) → `railway init`/`link` → wire worker service + env vars → deploy.
- **rotate**: project/account tokens are minted+revoked in the Railway dashboard; runtime service env vars rotate via `railway variables --set KEY=NEWVALUE` + `railway redeploy`.

## Battle-tested Notes (guyin production deploy, 2026-07-03)
- **pnpm-monorepo Dockerfile pattern that works**: multi-stage build using `pnpm deploy --prod` (officially documented) to produce an isolated, prod-only package for the worker workspace; add `"files": ["dist"]` to the worker's package.json for deterministic packing. Build context = REPO ROOT (workspace deps), so `railway.json` lives at repo root with `dockerfilePath: apps/worker/Dockerfile` + a root `.dockerignore`.
- **railway.json schema**: verify keys against `https://backboard.railway.app/railway.schema.json`; `{"build":{"builder":"DOCKERFILE","dockerfilePath":"apps/worker/Dockerfile"},"deploy":{"restartPolicyType":"ALWAYS"}}` deployed successfully; `railway restart --service <name> --yes` observed SIGTERM → auto-respawn.
- **Vercel-side monorepo lessons (companion deploy)**: project Root Directory must be set via REST API (CLI 50.x rejects `rootDirectory` in vercel.json); `vercel deploy --prod` MUST run from repo root with the `.vercel` link AT ROOT — running it from `apps/web` uploads only the subdir, breaks the workspace build, and auto-creates a junk project named after the folder.
- Heartbeat-style always-on worker on Railway: deploy → poll your own liveness row via SQL as the acceptance oracle (guyin: ~4s cadence observed vs ≤60s requirement).

## Source
- CLI: `@railway/cli` (npm) / `railway` (brew) — https://github.com/railwayapp/cli
- MCP: built into CLI (`railway mcp install`), docs content/docs/ai/mcp-server.md
- Docs: https://docs.railway.com (auth: docs/cli/login.md; deploy: docs/cli/deploying.md) — retrieved via context7 `/railwayapp/docs` (Tier S)
- Discovered: 2026-07-03 (driver: guyin worker host per ADR-01KWGM99W24XJRP2NVGX2HRWJG)
