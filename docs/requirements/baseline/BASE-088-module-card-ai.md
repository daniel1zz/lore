---
id: BASE-088
type: baseline
role: intent
title: "Module card: ai"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
links:
  - {id: SPEC-017, type: supersedes}
  - {id: SPEC-030, type: supersedes}
---
# Module card: ai

Source: `packages/lore/src/ai/CLAUDE.md`.

- **Responsibility**: AI provider implementations (`ClaudeCliProvider`, `InMemoryAIProvider`), provider registry, prompt templates for the assess and review judges, AI-default resolution per caller surface.
- **Public surface**: `buildProviderRegistry`, `ASSESS_TEMPLATES`/`getAssessTemplate`, `REVIEW_TEMPLATES`, `resolveAiDefault`, `isAssessAiBraked`, `buildHermeticSpawnSpec`.
- **Dependencies**: `@lore/core` (the `AIProvider` interface is type-only there). Used by `ai-provider-service.ts`, `app.ts`, the CLI and MCP adapters.
- **Invariants**:
  - Never throws; spawn failures map to `AI_PROVIDER_ERROR`.
  - Prompt text lives here, facts are computed once in `@lore/core` and passed in — a renderer never re-derives a fact.
  - Prompt versions are frozen registry keys; a new prompt adds a key.
  - A truncation notice names what was cut; the judge is spawned hermetically (neutral cwd, sanitised env).
