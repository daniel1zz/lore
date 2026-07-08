---
id: KN-032
type: knowledge
role: knowledge
title: "Anthropic Official Agent-Loop Engineering — Research Digest"
status: draft
priority: medium
created: 2026-07-08
updated: 2026-07-08
tags: [loop, research, anthropic, acceptance]
parent: PRD-001
links:
  - {id: ADR-001, type: informs}
---
# Anthropic Official Agent-Loop Engineering — Research Digest (2026-07-07)

> Research capture for the SPEC-038 "AC-as-code" design discussion. Six Tier-S primary
> sources fetched and quote-verified on 2026-07-07 by two parallel research agents.
> Motivating question: what makes an agent loop trustworthy enough for automated
> acceptance of a large 0→1 requirement?

## 1. Source timeline

| Date | Article | Contribution to loop engineering |
|---|---|---|
| 2024-12 | Building effective agents | workflow-vs-agent definition; loop prototype; 3-tier termination |
| 2025-06 | How we built our multi-agent research system | orchestrator-worker loop, two-level parallelism, token economics |
| 2025-09 | Building agents with the Claude Agent SDK | named 3-phase loop: **Gather Context → Take Action → Verify Work → Repeat** |
| 2025-09 | Effective context engineering for AI agents | compaction / sub-agent isolation / just-in-time retrieval |
| 2025-09 | Writing effective tools for AI agents | tool consolidation reduces loop iterations; agent-driven tool optimization |
| 2025-11 | Effective harnesses for long-running agents | outer loop: two-agent harness, state recovery across fresh contexts |

Canonical URLs (two have migrated):
- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://claude.com/blog/building-agents-with-the-claude-agent-sdk (308 from anthropic.com/engineering/...)
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/writing-tools-for-agents
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://code.claude.com/docs/en/best-practices (308 from anthropic.com/engineering/claude-code-best-practices)

## 2. The loop definition

The 2025-09 Agent SDK article names the canonical agentic loop:
**Gather Context → Take Action → Verify Work → Repeat.**

> "Agents that can check and improve their own output are fundamentally more reliable."
> — Building agents with the Claude Agent SDK, §Verify your work

Verify paths are enumerated as: (1) rules-based feedback (deterministic checks — lint,
tests), (2) visual feedback (screenshots), (3) LLM-as-judge. The verify phase is the
de-facto termination criterion — the 2024-12 article's three-tier control (natural
completion / max-iterations guardrail / human checkpoint) is refined into "completion =
verification passes".

> "During execution, it's crucial for the agents to gain 'ground truth' from the
> environment at each step (such as tool call results or code execution) to assess its
> progress." — Building effective agents, §Agents

## 3. Context is the binding constraint, not step count

> "Context, therefore, must be treated as a finite resource with diminishing marginal
> returns." — Effective context engineering, §Why Context Engineering is Important

Practices: compaction preserving architectural decisions + unresolved bugs while
discarding redundant tool output; sub-agents exploring in isolated windows and returning
1,000–2,000-token summaries; just-in-time retrieval (hold lightweight identifiers — file
paths, queries — and load at runtime).

## 4. The outer loop, made official (2025-11)

"Effective harnesses for long-running agents" is the official engineering version of the
community "Ralph loop": an **Initializer Agent** (feature list JSON with per-feature
verification standards, init.sh, claude-progress.txt, git baseline) plus a **Coding
Agent** (each fresh session: read progress + git log → pick one failing feature →
implement → descriptive commit → update progress).

> "The key insight here was finding a way for agents to quickly understand the state of
> work when starting with a fresh context window, which is accomplished with the
> claude-progress.txt file alongside the git history." — §State recovery

> "Compaction isn't sufficient... even a frontier coding model like Opus 4.5... will
> fall short of building a production-quality web app if it's only given a high-level
> prompt." — §Context/session management

**The observed #1 failure mode**:

> "One final major failure mode that we observed was Claude's tendency to mark a feature
> as complete without proper testing." — §Failure modes

Their mitigation: browser-automation (Puppeteer MCP) end-to-end verification, and
initial prompts expanded into full feature definitions **with step-by-step verification
standards** — i.e. acceptance criteria bound to oracles, decided before implementation.

## 5. Verifier independence and gate strength

Claude Code best practices grades verification gates by strength: in-prompt iteration →
independent evaluator per round → deterministic Stop-hook gate → fresh-context
adversarial review ("the doer must not grade itself"):

> "Claude stops when the work looks done. Without a check it can run, 'looks done' is
> the only signal available... Give Claude something that produces a pass or fail, and
> the loop closes on its own." — code.claude.com/docs/en/best-practices

> "A reviewer running in a fresh subagent context sees only the diff and the criteria
> you give it, not the reasoning that produced the change, so it evaluates the result on
> its own terms." — ibid.

## 6. Multi-agent loop economics

Orchestrator-worker (lead plans, spawns 3–5 subagents in parallel; each subagent calls
3+ tools in parallel) cuts research time up to 90%, at ~15× chat token cost; token spend
explains 80% of benchmark performance variance.

> "Multi-agent systems use about 15× more tokens than chats. For economic viability,
> multi-agent systems require tasks where the value of the task is high enough to pay
> for the increased performance." — multi-agent research system, §Token economics

## 7. Synthesis for Lore

Loop effectiveness = **feedback × feedback trustworthiness × loop closure** (all three
multiply; any zero zeroes the whole).

Oracle pyramid mapped to Lore:
- Tier 1 deterministic scripts (tsc/test/lint/build/coverage) → SPEC-025 evidence
- Tier 2 end-to-end behavior (browser e2e/UAT) → evidence oracle kind `e2e`
- Tier 3 LLM-as-judge vs spec ACs → SPEC-026 assess, SPEC-034 review judgment
- Tier 4 human sampling + escalation → SPEC-034 triage, PRD §14 I2 sampling floor

Gaps this research motivated (in leverage order):
1. **Structured, oracle-bound acceptance criteria** (specs' ACs are prose today) → SPEC-038
2. Trusted runner: evidence is self-reported; lore should execute script oracles itself
   and attest results (SPEC-039 candidate)
3. Loop closure: assess `gaps`/`recommendations` have no automated consumer (PRD §14 R2,
   data-gated)
4. Calibration-gated autonomy: use SPEC-035 Wilson lower bounds as the autonomy valve
   (PRD §14 R2/R3, ADR-gated)

Anthropic's per-feature verification standards (harness article) are the exact
precedent for SPEC-038's AC-as-code: acceptance made machine-checkable at
specification time, so the loop's verify phase has a standard to close against.
