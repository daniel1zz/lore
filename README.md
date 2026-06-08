# Lore

> AI-native shared knowledge platform for AI-first teams.

**Lore** is the structured knowledge / memory substrate for teams that run multiple AI agents alongside humans. Every PRD, spec, ADR, plan, and decision lives in one navigable corpus — readable and writable by Claude Code, Cursor, Codex, custom agents, and humans alike.

## What This Is

A single CLI binary (`lore`) that:

- **Reads / writes** a typed, navigable corpus of project knowledge (PRDs, specs, ADRs, plans, retros)
- **Sync** corpus across devices and team members
- **Exposes** the same surface to AI agents via MCP server adapter (`lore --mcp-server`) and to humans via web UI
- **Centers** on the **PRD-as-living-root** model — every doc is reachable through a tree rooted at the product PRD, via MDX placeholder components that resolve to live subtrees on read

## Status

⚠️ **Pre-implementation — PRD phase**. No code yet.

- ✅ Product positioning locked (internal-first, OSS path, no SaaS in v1.0)
- ✅ ICP: AI-first founding teams (3-5 people + multi-agent)
- ✅ MVP scope: Full (CLI + cloud sync + web UI + multi-tenant + auth) — 9mo+ target
- ✅ Distribution: vendor-neutral CLI on Homebrew / npm
- ⏳ PRD draft v0.1 written (see `docs/requirements/prd/`)
- ⏳ PRD pending Phase 2/3 stakeholder review (see product skill flow)
- ⛔ Design / tech-spec / plan / code — not started

## Predecessors

- **DocMan v1** (`/Users/apple/.claude/docman-mcp`) — single-user stdio MCP server, frozen. Lore migrates v1 corpus via one-shot `lore migrate v1` (TBD).

## Documents

```
docs/
├── requirements/
│   └── prd/
│       └── PRD-001-lore-positioning.md   ← strategic source-of-truth (draft)
├── knowledge/
│   └── ideation/
│       └── IDEATION-001-v2-positioning-synthesis.md   ← 6-role brainstorm output
├── architecture/
│   ├── adr/                              ← decision records (empty)
│   └── tech-specs/                       ← technical specs (empty)
└── planning/
    └── plans/                            ← implementation plans (empty)
```

## Naming

**Lore** /lɔːr/ — "team lore", "project lore" — the accumulated knowledge that lives in a project's history. Pronounceable, 4 chars, CLI-friendly (`lore get spec auth-v2`).
