---
id: KN-072
type: knowledge
role: knowledge
title: "Ideation — Dashboard capability expansion (6-role brainstorm, 2026-07-24)"
status: draft
priority: medium
created: 2026-07-24
updated: 2026-07-25
tags: [dashboard, ideation, product]
parent: PRD-001
links:
  - {id: SPEC-075, type: informs}
---
# Ideation — Dashboard capability expansion (2026-07-24)

> Mode: `/lore-product ideation` — 6-role parallel brainstorm (Target User / Business Strategist / Tech Architect / UX Designer / Devil's Advocate / Investor).
> Trigger: owner request "拓展 dashboard，让能力更丰富". Current surface: SPEC-015/016/022/027/033/036/064 + SPEC-074 (Issues triage, in-flight).

## 1. Consensus Signals (3+ roles agree — high confidence)

1. **Execution view ("Mission Control") is the top-value direction** (5/6 roles: User, Business, Tech, UX, Investor). Plan → phase → task → claim (TTL) → verification evidence rendered as a live, read-only surface. The data already exists structured in the corpus (claims, evidence, phases, sessions, anchors) — only the projection layer is missing. UX framing: Langfuse-style trace timeline; Investor framing: "the only screen that answers *what are my 5 agents doing right now, and who can prove it*".
2. **Read-only first; execution verbs never enter the UI** (User, UX, Devil, Tech). Adjudication verbs (approve/reject/UAT verdict) are the only writes the dashboard should grow. claim/release/evidence stay CLI-only — every new write surface pays the gate/audit/CAS consistency tax (SPEC-062 precedent).
3. **Positioning must be decided before any build** (4/6 critical questions converge): is the dashboard a *human adjudication cockpit* (read + adjudicate, converged scope) or a *general admin console* (broad CRUD, dilutes gate discipline)? Every roadmap disagreement below traces back to this.
4. **No CLI-feature-parity work** (Business, Devil): the dashboard should only do what the CLI structurally cannot (timelines, global state, graphs, trust visualization).

## 2. Creative Tensions

- **Binary embedding priority**: User/Business/Devil call production build + single-binary embedding P0 ("foundation before furniture"; two-process dev topology means nobody else can even open it). Tech Architect says defer 6+ months (bun compile asset bloat ~80→120MB, embedding risk) and ship HTTP-route-driven views first. → Resolution candidate: spike the embed to get a real size number before committing either way.
- **Home identity**: UX proposes Inbox-first home (needs-your-decision digest; PRD demoted to a tab) — this conflicts with the approved SPEC-033 owner directive (Home = resolved living PRD). Changing it requires an explicit owner reversal, not a silent redesign.
- **Assumed value vs measured value**: Devil demands 30-day usage measurement before any expansion (open frequency; "if <3 opens/day, freeze"); other roles proceed on assumed daily need.

## 3. Blind Spots (single-role insights)

- **No usage telemetry on the dashboard itself** (Devil; echoed by Business) — expansion decisions are currently evidence-free, violating the project's own evidence-driven rule.
- **Latency SLA undefined** (Tech): polling vs SSE must be decided from "how fast must a human see an evidence append" (≤1s → SSE; 5–30s → polling suffices). Partial-live is worse than all-stale (UX).
- **Judgment badge needs a "show reasoning" drill-down** (UX) — without it humans either blindly trust or ignore the badge, wasting the calibration loop.
- **HTTP response-shape drift risk** (Tech): task/evidence/phase projections need spec-pinned response shapes (SPEC-036 ancestors precedent).
- **Hosted/multi-viewer is the monetization line** (Investor): local-dev-only dashboard has no revenue model; Turso sync already paves the path.

## 4. Top Opportunities (ranked, cross-role weighted)

1. **Read-only Execution view** (`/execution` or per-plan page): sessions, claims with TTL countdown, evidence timeline (pass/fail sparkline, attested vs self-reported visual split, `output_tail` terminal-style panel), phase progress, anchor conflicts. Requires the missing `/api/ready` route (+ spec-pinned shapes).
2. **Production build + single-binary embedding** — `lore dashboard` one command, zero dev processes. Gate on an embed-size spike.
3. **Adjudication workbench upgrades**: Evidence/AC tab on doc detail (AC coverage matrix, attestation ratio beside the approve button), keyboard-first triage (Linear-style j/k/a/x/e), judgment-reasoning drill-down.
4. **Attention feed / digest**: needs-action-layered inbox (pending adjudications, overnight decisions, fail evidence, stale claims, drift) — placement depends on the Home-identity decision.
5. **Trust panel deepening + read-only share mode**: calibration/attestation visualization as demo material (unique vs Langfuse/LangSmith/Linear).
6. **Corpus graph view** (React Flow DAG) — cheap, differentiating, lower urgency.

## 5. Kill Risks

- Building for an unmeasured user (n=1 human who lives in the terminal) — Devil's critical question stands unanswered.
- Write-surface sprawl silently eroding gate discipline (2026-07-07 pollution incident class).
- "Richer" staying an unquantified abstraction → scope black hole (violates the abstract-word-quantification rule).
- Platform absorption (Investor): Claude Code natively growing memory/tasks/dashboards.

## 6. Validation Roadmap (cheapest first)

1. Owner answers the positioning question (cockpit vs console) — free, unblocks everything.
2. Add dashboard open/route telemetry (JSONL, existing telemetry infra) — 30-day baseline.
3. Decide evidence-visibility latency SLA (polling vs SSE) — one owner sentence.
4. `/api/ready` route + minimal read-only execution view — validates the #1 consensus bet with real daily usage.
5. Binary-embed spike — measure real binary size delta, then commit or defer with data.

## 7. Verdict Summary

| Role | Verdict | Top Concern | Top Opportunity |
|---|---|---|---|
| Target User | cautiously optimistic | two-process topology; stale data driving dispatch decisions | execution map + evidence-based adjudication |
| Business Strategist | cautiously optimistic | gilding the secondary channel; CLI-parity trap | binary embed (P0) + Mission Control hero screen |
| Tech Architect | cautiously optimistic | binary bloat; auth model beyond localhost; shape drift | `/api/ready` quick win; staged HTTP-first build order |
| UX Designer | excited | dual-SSOT perception; notification junkyard | Langfuse-style trace view + Linear-style inbox/triage |
| Devil's Advocate | skeptical | zero usage data; per-feature cost; foundation missing | measure first; read-only only; foundation before features |
| Investor | cautiously optimistic | platform absorption; dashboard = table stakes not moat | execution war-room + hosted path + calibration GTM story |

## 8. Refined Idea Statement

Reframe "expand the dashboard" as: **make the dashboard the human adjudication cockpit for a multi-agent execution loop** — a read-only, live projection of what agents are doing (claims/evidence/phases/sessions) plus evidence-grounded adjudication verbs (approve/reject/UAT), delivered as a single-command single-binary experience; explicitly NOT a general admin console, NOT CLI feature parity, and no execution verbs in the UI. Sequencing gates: positioning decision → usage telemetry → `/api/ready` + execution view MVP → embed spike.

## 9. Assumptions (explicit, with confidence)

- A1 (MEDIUM): the owner will use an execution view daily once it exists — asserted by the User role, unmeasured (telemetry will test it).
- A2 (HIGH): execution data is already fully structured in the corpus; projection is the only missing layer.
- A3 (LOW): binary embedding is cheap — contested by Tech; needs the spike.
- A4 (MEDIUM): read-only surfaces avoid most consistency tax — grounded in SPEC-062 experience.

## 10. Next Step

Recommendation: **Proceed to PRD update** (not full discovery — internal dogfooding, user = owner) once the positioning question is answered; the PRD delta then feeds `/lore-design` for a feature-spec. Cross-cutting concerns reviewed: no privacy/ethics exposure beyond existing local-corpus surface; read-only share mode (opportunity #5) would need a redaction pass before any external exposure.

## 11. Owner Decisions (2026-07-24, post-brainstorm adjudication)

- **D1 — Positioning: general admin console** (owner OVERRULED the 6-role consensus recommendation of "adjudication cockpit"). The dashboard will progressively grow full CRUD + execution-operation surfaces, accepting the dual-write-surface consistency cost. Mitigation already in place: `GateEnforcer` runs at the SERVICE layer (not per-adapter), so HTTP dashboard writes hit the same deterministic gates as CLI/MCP — the "console dilutes gate discipline" risk is structurally bounded to UX-affordance design, not gate bypass. Dissent recorded: 4/6 roles warned about consistency tax (SPEC-062 precedent) and write-surface sprawl; owner decision stands.
- **D2 — First investment batch: adjudication workbench** (over execution-view-first and foundation-first): Evidence/AC tab on doc detail (AC coverage matrix + attestation ratio beside approve), keyboard-first triage flow (j/k/a/x/e), judgment-reasoning drill-down. Execution view and binary-embed spike are NOT killed — deferred to subsequent batches.
- **D3 — Usage telemetry ships WITH the first batch** (route-level, reusing the JSONL telemetry infra) — validates assumption A1 without blocking work.
