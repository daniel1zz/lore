---
name: lore-project-bootstrap
description: Configure Claude Code best practices for any project before writing business code. Auto-detects or collects project DNA (language, framework, business domain, platform dependencies) then generates project CLAUDE.md, .claude/settings.json, and skill recommendations. Optional enhanced mode adds hooks and MCP config. Use when 'bootstrap project', 'setup project', 'configure project for AI', 'prepare project', '项目装配', '项目初始化', or when starting a new project or onboarding Claude Code to an existing codebase.
---

# Project Bootstrap

Configure Claude Code for a project based on its DNA — before writing any business code.

## Phase 1: Detect or Collect Project DNA

**Branch A — Existing project** (has `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`):
1. Auto-scan config files + directory structure
2. Detect: language, framework, monorepo (`pnpm-workspace.yaml`/`turbo.json`/`nx.json`), platform deps from dependencies
3. Derive platform type from framework (Next.js→SSR, UniApp→cross-platform, NestJS→Backend API, etc.)
4. `AskUserQuestion`: present detected DNA for confirmation + ask business domain (cannot auto-detect)

**Branch B — New project** (empty or minimal):
1. `AskUserQuestion` round 1: Language + Framework (use options with common choices)
2. `AskUserQuestion` round 2: Business Domain + Platform Dependencies

**DNA dimensions collected**:
| Dimension | Required | Auto-detectable |
|-----------|----------|-----------------|
| Language | Yes | Yes (existing projects) |
| Framework | Yes | Yes (existing projects) |
| Business Domain | Yes | No — always ask |
| Platform Dependencies | Optional | Partial (from deps) |
| Monorepo | Auto-only | Yes |
| Platform Type | Derived | From framework |

## Phase 2: Assemble Configuration

Read reference blocks matching detected DNA — see [Reference Index](#reference-index).

Compose three outputs:

### 1. Project CLAUDE.md
Assemble from language + framework + domain + testing reference blocks into a coherent project CLAUDE.md. Include:
- Language-specific coding conventions
- Framework architecture patterns and file organization
- Domain terminology and security requirements
- Test runner configuration and coverage expectations
- Relevant `## Skill Chain` section listing recommended skills

### 2. .claude/settings.json (project-level)
Generate **minimal delta** from user's global settings. Only add:
- Framework-specific permission allowlists (from `references/permission-map.md`)
- Project-specific environment variables
- Never duplicate what's already in `~/.claude/settings.json`

### 3. Skill Recommendation Report
Lookup from `references/skill-map.md`. Output as a categorized list the user can act on.

## Phase 3: Write & Verify

1. Preview generated CLAUDE.md content → `AskUserQuestion` to approve
2. **Existing CLAUDE.md** → show what would change, offer: Merge / Overwrite / Skip
3. **Existing .claude/settings.json** → merge new permissions into existing, preserve user customizations
4. Write approved files
5. Display skill recommendation report

**Enhanced mode** (opt-in via `AskUserQuestion` after core generation):
- Generate quality-gate hooks (`.claude/hooks/`) for the framework's toolchain
- Configure recommended MCP servers in settings.json

## Phase 4: Chain-Forward

Recommend next skills — DO NOT call them internally:
- `/lore-kickoff` — initialize the lore knowledge corpus
- `/design` — architecture decisions and API design
- `/domain` — domain model and business rule analysis
- `/my-rules` — project-specific rule files

## Idempotency

Safe to run multiple times. Detect existing config → diff → confirm → merge. Never destructive overwrite.

## Reference Index

| Path | Content |
|------|---------|
| `references/languages/{lang}.md` | Coding conventions, type system, error handling |
| `references/frameworks/{fw}.md` | Architecture patterns, file org, required permissions |
| `references/domains/{domain}.md` | Terminology, security level, compliance rules |
| `references/testing/{runner}.md` | Config, mocking, coverage patterns |
| `references/skill-map.md` | DNA → skill recommendation mapping table |
| `references/permission-map.md` | Framework → CLI permission allowlists |

Available: `typescript`, `python` | `nextjs`, `nuxt`, `uniapp`, `nestjs`, `fastapi` | `fintech`, `ecommerce`, `saas` | `vitest`, `pytest`
