# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Lore** — AI-native shared knowledge / memory platform for AI-first teams (3-5 people + multiple AI agents). Greenfield rewrite of DocMan v1 (which was a single-user stdio MCP server for local markdown at `/Users/apple/.claude/docman-mcp`).

Lore delivers a single CLI binary that:
- Reads/writes a typed, navigable corpus of PRDs, specs, ADRs, plans, knowledge
- Syncs corpus across devices and team members (cloud-backed)
- Exposes same surface to AI agents (MCP server adapter mode) and humans (web UI)
- Centers on PRD-as-living-root: PRD embeds MDX placeholder components that resolve to live subtrees on read → entire corpus navigable from one document

## Status

**Pre-implementation — PRD phase. No code yet.**

- PRD draft v0.1 at `docs/requirements/prd/PRD-001-lore-positioning.md`
- 6-role ideation synthesis at `docs/knowledge/ideation/IDEATION-001-v2-positioning-synthesis.md`
- Next: Phase 2 stakeholder review of PRD → Phase 3 synthesis → user approval → design phase → tech-spec → plan → implementation

## Key Decisions Locked

1. **Positioning**: Internal-first product (no SaaS in v1.0), OSS path later
2. **ICP**: AI-first founding teams (3-5 people + multi-agent)
3. **MVP scope**: Full (CLI + cloud sync + web UI + multi-tenant + auth) — 9mo+ target
4. **Distribution**: Vendor-neutral CLI on Homebrew / npm (not Claude-Code-MCP-only)
5. **v1 compatibility**: None — one-shot `lore migrate v1` tool only

## Architecture Direction (not yet committed)

- Lang: TypeScript + Bun compile (likely — single binary, JS ecosystem alignment)
- Storage: libSQL / Turso (likely — embedded SQLite + cloud sync)
- Sync model: Server-authoritative pull (Replicache pattern, not raw CRDT)
- Placeholder syntax: MDX `<Component />` (carried over from v1 ADR-01KT8X72 thinking)
- Multi-transport: same binary serves CLI / MCP server / HTTP / TUI / web UI backend

These are working hypotheses pending tech-assessment phase.

## v1 Predecessor

`/Users/apple/.claude/docman-mcp` — frozen, stays operational for solo use.

v1 design artifacts that informed v2 thinking:
- `ARCH-01KPZ6GG4N4AXRHX9WKE6DVP6P` — v1 architecture-outline (9 modules)
- `PRD-01KJ2MTE53XHNSPJY1W43YMRZQ` — v1 main PRD
- `ADR-01KT8X72CJM7GB0QQKHD551DY5` — PRD-as-living-outline-via-MDX (v1 attempt)
- `TECH-01KT8XDXQ135ZPXH863X13GHR1` — get_outline tool design (v1, never implemented)
- `PLAN-01KT8YBZ5JPW75VKD2FE7SD89P` — implementation plan (archived)

Do NOT carry over v1 schema / API / code shape verbatim. v2 is greenfield by design.

## Document Convention (until tooling exists)

While Lore itself doesn't exist yet, docs in this project follow conventions Lore will eventually enforce:
- YAML frontmatter with `id`, `type`, `status`, `priority`, `tags`, `created`, `updated`
- File naming: `{TYPE}-{NNN}-{slug}.md` (no ULID yet — v2 will decide ID scheme)
- Roles: `intent` (PRD, user-story), `spec` (feature-spec, tech-spec), `decision` (ADR), `plan`, `knowledge` (ideation, retros)
- Links: explicit in frontmatter `links:` array (no auto-extraction yet)

## How to Work in This Project

- **Read PRD first**: `docs/requirements/prd/PRD-001-lore-positioning.md` is the source of truth for product direction
- **Don't create design / tech-spec / code yet** — PRD not approved; design phase is the next gate
- **Reference v1 thoughtfully** — many ideas from v1 (PRD-as-living-root, MDX placeholders) are likely correct for v2, but v2 owns its own decisions
- **No tooling install required** — pure markdown until Lore exists to manage itself
