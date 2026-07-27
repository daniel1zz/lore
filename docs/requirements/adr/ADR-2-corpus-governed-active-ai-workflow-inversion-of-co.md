---
id: ADR-002
type: adr
role: decision
title: "Corpus-governed active AI workflow (Inversion of Control) with deterministic gates"
status: approved
priority: critical
created: 2026-07-08
updated: 2026-07-08
tags: [architecture, paradigm, ai-workflow, governance, inversion-of-control]
links:
  - {id: ADR-001, type: relates-to}
---
## Status

**Accepted (direction).** The paradigm and its boundaries are decided; concrete implementation designs (follow-up specs P1–P4) are pending and will link `implements → this ADR`. Supersede this ADR if the direction itself changes, not for implementation detail.

## Context

Lore today governs **artifacts** (PRD / spec / ADR / plan / task / knowledge) but not their **upstream production functions** — the prompts and skills that *produce* and *consume* those artifacts. Those live outside the corpus (Claude Code skills, CLAUDE.md, tribal memory): unversioned, unreviewable, untraceable. The knowledge base only has its bottom half.

Current AI workflows are "AI free-runs / random research": output quality is probabilistic and swings with model capability; it is not reproducible. The team wants the inverse: **data/document governance actively driving the AI**, with deterministic scaffolding backstopping the model's instability so the instruction → artifact → verification loop actually closes.

This is an **Inversion of Control**. Lore evolves from a passive *library* (the agent queries it when it remembers) into an active *framework* (Hollywood principle: "don't call us, we'll call you"). The agent drops from autonomous author to a governed, actively-fed executor.

## Decision

Adopt the paradigm, scoped and bounded as below. Four capabilities:

1. **Upstream asset governance** — promote **prompt** and **skill** to first-class, versioned, linkable, eval-bearing doc types (same review → evidence → calibration loop as SPEC-034/035/039 gives artifacts).
2. **Active feeding** — at lifecycle nodes, push the *right* skill / prompt / upstream doc to the agent. Just-in-time: **pointers + summaries, never full dump**.
3. **Deterministic hook gate** — bind gate conditions to **knowledge-graph state** (no AC → block, no evidence → block, no review → block), enforced through harness hooks. The corpus *predicate* is the moat, not the hook mechanism.
4. **Bidirectional linkage** — skill/prompt ↔ the artifacts they produce/consume, so provenance is queryable both ways.

## Evidence (research 2026-07-08, four parallel Tier-tagged researchers)

- **C1 — "actively feed the right context beats relying on the model."** Sub-claim A (context engineering is the dominant quality lever) = **HIGH** [Tier S] Anthropic *Effective Context Engineering*. Sub-claim B (the *ordering* "context > model") = **MEDIUM** — no controlled head-to-head benchmark; stronger models still keep lowering failure rates. Treat the ">" as an assumption, not a measured fact.
- **C2 — "deterministic orchestration beats letting the agent free-run."** = **HIGH**. Anthropic + OpenAI verbatim, no stance reversal 2024→2026: workflows give "predictability and consistency for well-defined tasks"; agents only when deterministic approaches "fall short." Compounding-error math (0.85^10 ≈ 20%) is the quantitative basis for short-chain + per-segment deterministic verification.
- **C3 — "structured flow + scripts backstop model instability."** = **HIGH** [Tier A] AlphaCodium (arXiv:2401.08500): same GPT-4, pass@5 19% → 44% (validation; 29% test) purely via structured test-driven flow; ~10,000× fewer calls than the fine-tuned AlphaCode at comparable accuracy. **Necessary condition: an executable oracle in the loop.** Quality's determinism comes from the oracle, not the orchestration.
- **C4 — the four-in-one is an unfilled gap.** = **HIGH**. No single product does all four; the market splits into four mature-but-independent clusters (SDD tools / prompt registries / harness hooks / policy engines). Closest competitor Tessl ($125M A) still lacks the deterministic gate and the IoC. Strongest external endorsement: GitHub Spec-Kit officially admits embedded checklists "cannot be 100% guaranteed to be followed" — **an in-prompt checklist is theater, not a gate.** Deterministic hook-gate is the direct answer.

## Boundaries (non-negotiable, evidence-backed)

1. **Gate reliability ceiling = min(oracle coverage, oracle correctness).** Two-layer gate: the **deterministic zone** (script-AC / tsc / test / schema / exit-code) hard-blocks; the **probabilistic zone** (semantic correctness, requirement satisfaction — LLM-as-judge) is **advisory / escalate only, never a hard block** and never disguised as deterministic. Core leverage = converting more dimensions into executable oracles (AC-as-code), not writing a smarter judge prompt.
2. **Minimal context, not maximal.** "More context is better" is empirically false (Chroma: 18 models / 194,480 calls, recall monotonically degrades with length; *Lost in the Middle*, TACL 2024). Feed pointers + summaries just-in-time; lore's id/slug addressing + MDX placeholder resolution already fit this.
3. **An active framework amplifies its own errors deterministically, and the corpus becomes an attack surface.** A wrong gate blocks the correct thing *every time*, consistently (worse than sporadic model error). A passive-library bug hits only the querying call; an active-framework bug hits *every* driven flow. Kiro shipped an indirect-prompt-injection RCE CVE. Once the corpus drives a command-executing runner (SPEC-039), corpus content is an attack surface — trust boundary built in from day one, gate logic high-coverage fail-loud.

## Scope honesty (why this is NOT "the" universal best practice)

Conditional best practice for **structured / verifiable / multi-actor (humans + agents) / stability-seeking** work. It is the **spectrum default** — deterministic-first + on-demand autonomy + gate always — not the elimination of agent autonomy. Open-ended exploration and one-off prototyping → autonomy wins; this governance would be over-engineering there. Keep an explicit **escape hatch**; make **gate density configurable** (its value erodes as models strengthen — do not fossilize orchestration built for today's weaker models).

## Positioning / Buy-not-build

The net build is **thin glue**. Reuse, do not rebuild:

- Hook mechanism → **Claude Code hooks** (already the substrate)
- agent ↔ corpus → **MCP** (lore already ships 24 tools)
- deterministic policy beyond shell scripts → **OPA/Rego** or **AWS Cedar**
- prompt/skill eval loop → existing **SPEC-034 judge + SPEC-035 calibration** (+ Langfuse only if heavy prompt experimentation)
- passive-context interop → emit **AGENTS.md** from the corpus (do not compete with it)
- runner attestation trust boundary → borrow label-propagation + fail-closed patterns (Nucleus)

**Only true new build:** (a) the "corpus/graph state → inject which skill / block which Stop" mapping; (b) prompt/skill as first-class eval-bearing doc types. The moat is the **predicate** (gate condition = knowledge-graph query), which no existing product has.

## Consequences

- **(+)** The team's "how to make AI work well" becomes a versioned, reviewable, A/B-testable first-class asset — it compounds, and it directly attacks cross-session amnesia (skill/prompt improvements sediment instead of evaporating).
- **(+)** Targets a validated industry open wound (embedded-checklist non-enforcement) with a differentiated position: *governance-as-code for agent workflows*, not another SDD tool or prompt manager.
- **(−)** The governance layer itself needs governing (meta-eval via calibration); rigidity risk; corpus attack surface. All three are design constraints above, not blockers.

## Follow-ups (each its own spec → plan → task, linked implements → this ADR)

- **P1** Upstream asset-ization (prompt/skill as first-class eval-bearing doc types)
- **P2** Workflow state machine (phases + deterministic entry/exit checks)
- **P3** Active gate + hook bridge (deterministic gate command + Claude Code hook integration)
- **P4** Upstream-downstream linkage + "feed-before-produce" protocol

Recommended first cut: a **vertical slice through the spec-production node** (a thin sliver of P1+P2+P3+P4) to prove the Inversion of Control actually runs before scaling horizontally.

## References

- Research notes: `scratchpad/synthesis-notes.md` + `research-1..4-*.md` (four parallel researchers, 2026-07-08)
- Anthropic — *Building Effective Agents*; *Effective Context Engineering for AI Agents*
- OpenAI — *A Practical Guide to Building Agents*
- AlphaCodium — arXiv:2401.08500
- Chroma — *Context Rot*; Liu et al. — *Lost in the Middle*, arXiv:2307.03172 (TACL 2024)
