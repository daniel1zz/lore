---
id: IDEATION-001
type: knowledge
role: knowledge
sub_type: ideation-synthesis
title: "Lore (DocMan v2) Positioning — 6-Role Parallel Brainstorm Synthesis"
status: published
priority: high
created: 2026-06-07
updated: 2026-06-07
tags: [ideation, brainstorm, positioning, v2, lore, multi-role-synthesis]
derived_from: []
informs:
  - PRD-001-lore-positioning
---

# Ideation Synthesis — Lore (DocMan v2) Positioning

> Output of `/product ideation` mode: 6 parallel role agents brainstormed v2 positioning. This document is the synthesis input that informs `PRD-001-lore-positioning.md`.

## Product Brief (input to all roles)

> **DocMan v2** — AI-native documentation + structured memory platform, delivered as a single CLI binary (with optional HTTP/TUI modes). Universal entry point for AI agents (and humans) to read, write, and navigate a project's PRDs, specs, ADRs, plans, knowledge. Greenfield rewrite of v1 (single-user stdio MCP server, frozen). v2 targets cross-project / cross-user / cross-AI-agent shared corpus with cloud-syncable storage and web UI consuming a "living PRD outline" tree — PRD is single root, child docs grow as placeholder components. No v1 compatibility (one-shot migrate tool only). Differentiation hypothesis: AI-native graph corpus + PRD-as-living-root + multi-agent shared memory + vendor-neutral CLI primary.

## Verdict Summary

| Role | Verdict | Top Concern | Top Opportunity |
|---|---|---|---|
| Target User | Cautiously optimistic | "no v1 compat" + "web UI" feels like founder ego | PRD-as-living-root + agent-neutral CLI is genuine gap |
| Business Strategist | **Skeptical** | Anthropic / Cursor commoditizes in 12-18mo | Become the agent memory **protocol** (standard, not app) |
| Tech Architect | Cautiously optimistic | CRDT + relational graph is a minefield (Notion rejected) | libSQL + Replicache server-authoritative pull |
| UX Designer | Cautiously optimistic | Multi-agent merge UX is unsolved | git-like 5-verb CLI + on-this-page TOC |
| Devil's Advocate | **Skeptical** | Anthropic ships native shared memory in 12mo, zeros TAM | (Grudging) MCP wedge if you own the canonical server |
| Investor | **Skeptical, pass at seed** | Foundation-model commoditization clock 12-18mo | Agent memory is hottest infra wedge of 2026 |

**3/6 skeptical, 3/6 cautiously optimistic, 0 excited** — strong "proceed with caution" signal.

## Consensus Signals (3+ roles agree)

1. 🔴 Anthropic / Cursor commoditization is the existential risk (4/6)
2. ✅ CLI + vendor-neutral direction is correct (5/6)
3. 🟡 Web UI should be killed / deferred (4/6)
4. 🟡 "No v1 compat" decision is questioned (User strongly, Tech notes migration non-trivial, Devil mocks)
5. ⚠️ Multi-agent shared memory demand is unvalidated (Devil "founder hallucination", Investor demands design partners)

## Key Creative Tension — App play vs Protocol play

The most strategic insight: **3 independent roles (Business + Investor + Devil) converged on "Lore should be a protocol + reference implementation, not an app"**.

| Frame | Supporters | Implication |
|---|---|---|
| **App play** (original brief) | Tech / UX work assumed this | DocMan v2 = product. CLI + web UI + cloud + paid subscription |
| **Protocol play** (3-role convergence) | Business + Investor + Devil grudging | DocMan v2 = standard + reference implementation. Switzerland positioning. Anthropic / Cursor / Codex can all ship into this protocol. Moat = protocol ownership |

## Blind Spots Revealed

- **Tech alone**: CRDT vs OT vs Replicache is the critical 3-month MVP technical decision
- **Business + Investor joined**: Protocol > app for defensibility
- **Devil alone**: Specific dead startups (Mem.ai, Almanac, Dust.tt pivots, Slab zombie)
- **Investor alone**: $400M valuation at $5M ARR (Linear comparable) only achievable if "collaboration infra → multi-agent team" is real

## Top Opportunities (cross-role weighted)

| Rank | Opportunity | Evidence |
|---|---|---|
| ⭐⭐⭐⭐⭐ | PRD-as-living-root + agent-neutral CLI | User excited, Business validates, UX strengthens, Tech feasible |
| ⭐⭐⭐⭐ | **Agent-memory protocol play (not app)** | Business + Investor + Devil 3-role convergence |
| ⭐⭐⭐ | Vendor-neutral multi-agent shared corpus | User real pain, Investor sees wedge, Devil questions timing |
| ⭐⭐ | OSS-core + Linear-style monetization | Business + Investor both recommend |
| ⭐⭐ | Claude Code MCP plugin distribution wedge | Business + Investor + UX same voice |

## Kill Risks

1. 🔴 Anthropic ships native cross-agent memory in 12-18mo (Business / Devil / Investor)
2. 🔴 No design partner / founder-market-fit signal (Investor / Devil)
3. 🔴 CLI-primary blocks PM/VPE buyer adoption (Devil; Business echoes)
4. 🔴 Greenfield + no v1 compat = 6-9mo no revenue (Investor)
5. 🟡 Cold-start network effect — switching cost only at 1000+ docs / 6+ months (Investor)

## Validation Roadmap (cheapest first)

| # | Cost | Action |
|---|---|---|
| 1 | 0.5 day | Anthropic Claude Projects + Cursor Rules public roadmap research; Letta / Mem0 / Devin Memory adoption signals |
| 2 | 0.5 day | Mem.ai / Almanac / Dust.tt / Slab postmortem patterns |
| 3 | 1 day | 5-peer JTBD switch interviews (cross-agent shared memory really pain?) |
| 4 | 1 day | 3-5 multi-agent team outreach (current usage, willingness to pay) |
| 5 | 2 day | v1 user survey (would they migrate? what's missing?) |
| 6 | 1 day | PRD-as-living-root visual mockup with real v1 data (shown to design partners) |
| 7 | 1 day | Spec-Kit / Tessl / Kiro success/failure postmortem |

## Refined Idea Statement (pre-PRD)

> **Lore (DocMan v2, revised positioning)**: The agent-memory protocol + reference CLI for AI dev teams. Not a doc app, not a Notion competitor. Open standard for structured, navigable, multi-agent-shared product memory (PRDs, specs, ADRs, plans, knowledge) with PRD-as-living-root + graph-typed cross-doc links as canonical model. Reference impl = single CLI binary. Distribution wedge = Claude Code MCP server (zero CAC). OSS core. **Defensibility = protocol ownership + multi-vendor network effect** ("Switzerland of agent memory"), not app moat.

## User's Final Positioning Decisions (Phase 1A of PRD mode)

After ideation synthesis, user answered 4 key decision questions:

| Decision | User Choice | Reasoning |
|---|---|---|
| 1. Positioning | "Internal-first, not SaaS, OSS later" (4th option, user-provided) | Not chasing commercial TAM; dogfood + validate first |
| 2. ICP | AI-first founding team (3-5 people) | Matches user's own situation |
| 3. MVP scope | Full (CLI + cloud sync + web UI + multi-tenant + auth) — 9mo+ ship | No runway pressure (internal-first), can take time |
| 4. Distribution | Vendor-neutral CLI on Homebrew / npm | Not Claude-Code-MCP-only |

These 4 decisions are the strategic foundation of `PRD-001-lore-positioning.md`.

**Critical observation**: User's "internal-first + OSS later" framing **dissolves 70% of ideation kill risks**:

| Kill risk | Internal-first impact |
|---|---|
| Anthropic commoditization | Not applicable — no commercial TAM to defend |
| No design partner | Not applicable — user IS the design partner |
| 6-9mo no revenue | Not applicable — not chasing revenue |
| Cold-start network effect | Solved internally (team day-1 has data) |
| Multi-agent merge UX unsolved | Still real technical challenge |
| 9mo Full scope risk | Second-system syndrome risk remains |

## Recommended Next Step (was: Discovery)

Originally I recommended Proceed to Discovery to validate kill risks. After user's "internal-first" framing, **the kill risks largely dissolve** — proceeded directly to PRD draft (Phase 1B) with validation embedded inline in §11 of the PRD.

## Method Notes

- 6 roles dispatched in parallel via `Agent` tool, `researcher` subagent type
- Each role produced ≤300-word structured output (Opportunities / Concerns / Suggestions / Critical Question / Verdict)
- Synthesis pattern: consensus signals, creative tensions, blind spots, weighted opportunities, kill risks, validation roadmap, refined idea statement
- All real product / company names cited by role agents are Tier C-D evidence (LLM-recalled, datetime-sensitive); critical metrics flagged for verification before PRD finalization
