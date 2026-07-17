---
name: lore-auto-wire
description: One-command project infrastructure autowiring — provisions database (Neon), auth (Better-Auth + shared OAuth), deployment (Vercel web / Railway workers), and all env vars from a single entry point. Self-evolving via discover mode that auto-finds CLIs, MCP servers, and skills for any platform. Use when user says 'auto-wire', 'new project', 'provision project', 'setup infra', 'init tools', 'wire up', 'configure everything', 'one-click setup', 'discover tools', 'find CLI for X', 'what MCP servers exist for X', '一键配置', '新项目', '自动装配', '配置基础设施', '发现工具', or wants to create/manage multi-project infrastructure without repetitive manual configuration. Also triggers on 'check what CLIs are installed', 'rotate secrets', 'add service to project', 'project status'.
---

# lore-auto-wire — Multi-Project Infrastructure Autowiring

One entry point to provision, configure, and manage all project infrastructure.
Think of it as `@Autowired` for your entire tech stack — database, auth, deployment, secrets, all wired up in one command.

## Architecture

```
lore-auto-wire/
├── SKILL.md              ← you are here (mode router)
├── references/
│   ├── mode-init-tools.md    ← install + authenticate all CLIs
│   ├── mode-init-project.md  ← create new project from template
│   ├── mode-status.md        ← check global + per-project config
│   ├── mode-add.md           ← add service to existing project
│   ├── mode-rotate.md        ← rotate secrets across projects
│   ├── mode-discover.md      ← auto-discover CLI/MCP/skill for any platform
│   └── tools/                ← per-tool CLI reference
│       ├── neonctl.md
│       ├── vercel-cli.md
│       ├── gcloud.md
│       ├── gh-cli.md
│       └── railway.md        ← from discover (2026-07-03)
└── scripts/
    └── check-tools.sh        ← detect installed CLIs
```

## Mode Router

| Mode | Command | What It Does |
|------|---------|-------------|
| `init-tools` | `/lore-auto-wire init-tools` | Install + authenticate neonctl, vercel, gcloud, gh CLIs |
| `init-project` | `/lore-auto-wire init-project [name]` | Full project creation: template → DB → OAuth → Vercel → deploy. Name optional — defaults to current directory name |
| `status` | `/lore-auto-wire status` | Show what's configured, what's missing (global + current project) |
| `add` | `/lore-auto-wire add <service>` | Add a service (stripe, resend, etc.) to current project |
| `rotate` | `/lore-auto-wire rotate <secret>` | Rotate a secret and sync across all projects |
| `discover` | `/lore-auto-wire discover <platform>` | Auto-discover CLI, MCP server, skills for any platform → self-extend |

No mode specified → ask user what they want to do.

## Step 1: Detect Mode

Parse user input to determine mode. Map natural language to modes:

| User Says | Mode |
|-----------|------|
| "set up a new project", "create project", "new app" | `init-project` |
| "install tools", "set up CLIs", "first time setup" | `init-tools` |
| "what's configured", "check status", "what's missing" | `status` |
| "add stripe", "add email", "add analytics" | `add` |
| "rotate key", "update secret", "change credentials" | `rotate` |
| "discover stripe", "find CLI for X", "what MCP for X", "add support for X" | `discover` |

## Step 2: Load Mode Reference

Read the corresponding `references/mode-{mode}.md` file.
Each mode file contains:
- Prerequisites (which tools must be installed)
- Step-by-step procedure
- Verification checks
- Rollback instructions if something fails

## Step 3: Check Prerequisites

Before executing any mode, run the prerequisite check:

```bash
bash ~/.claude/skills/lore-auto-wire/scripts/check-tools.sh
```

This reports which CLIs are installed and authenticated. If a required tool is missing, guide the user to `init-tools` mode first.

## Step 4: Execute Mode

Follow the mode-specific reference file instructions. Key principles:

1. **Auto-fix, don't report**: When a problem is detected (missing PATH, not authenticated, missing config), fix it directly — never just tell the user what to do. The user invoked this skill to have things done, not to receive instructions.
2. **Escalation ladder**: CLI first → REST API second → agent-browser third → ask user last. Only stop when all automated options are exhausted.
3. **Skill-aware**: Before using an unfamiliar CLI, check if a relevant skill exists (`ls ~/.claude/skills/ | grep <tool>`) and read it for best-practice commands. The discover mode should also search for skills as part of its pipeline.
3. **Fail-loud**: If truly impossible to automate, explain WHY (not just what to do). Execute auth commands directly and wait for completion.
3. **Idempotent**: Running the same command twice should be safe (check before creating)
4. **Verify each step**: After provisioning, verify it worked (query the DB, curl the endpoint)
5. **Report progress**: Show `✅ Step N: description` as each step completes

## Global Config

The skill stores global config (shared across all projects) at:
```
~/.config/lore-auto-wire/config.json
```

```json
{
  "google_oauth": {
    "client_id": "...",
    "project_id": "...",
    "oauth_app_name": "..."
  },
  "github_oauth": {
    "client_id": "...",
    "app_name": "..."
  },
  "neon": {
    "org_id": "..."
  },
  "template": {
    "repo": "user/next-forge-template",
    "branch": "main"
  },
  "projects": {
    "gankjob": {
      "neon_project_id": "...",
      "vercel_project_id": "...",
      "domain": "gankjob.vercel.app"
    }
  }
}
```

This config is created by `init-tools` and updated by `init-project`. Secrets (client_secret, API keys) are NOT stored here — they live in Vercel env vars or the user's secret manager.

## Tool Stack

| Tool | Purpose | CLI |
|------|---------|-----|
| **Neon** | PostgreSQL database per project | `neonctl` |
| **Vercel** | Deployment + env vars | `vercel` |
| **Google Cloud** | OAuth app management | `gcloud` |
| **GitHub** | OAuth app + repo management | `gh` |
| **Railway** | Worker/long-running service hosting (Docker) | `railway` (see `references/tools/railway.md`) |
| **Self-Hosted PG** | Shared Postgres on own VPS, one DB per project (bypass Neon/Supabase quota) | `ssh myserver` → `postgres` container (see `references/tools/selfhosted-pg.md`) |

Future tools can be added by creating a new `references/tools/<tool>.md` and referencing it from the relevant mode files.

## Extending with New Modes

To add a new mode:
1. Create `references/mode-<name>.md` with the procedure
2. Add the mode to the router table above
3. Add natural language triggers to the mode detection table
