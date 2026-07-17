---
name: lore-analyze
description: >
  Deep analysis skill using world-class thinking methodologies. 
  Applies First Principles, MECE, Systems Thinking, Inversion, 5 Whys, 
  Second-Order Effects, and Steelmanning to any high-level topic — 
  strategy, business, product, decisions, or abstract problems. 
  NOT for code-level analysis (use review/diagnose for that).
---

<EXTREMELY-IMPORTANT>
This skill is for HIGH-LEVEL, ABSTRACT deep analysis ONLY.
- ✅ Strategy, business models, product decisions, market dynamics, organizational design
- ✅ Technology strategy (build vs buy, platform choices, ecosystem bets)
- ✅ Risk assessment, opportunity evaluation, tradeoff analysis
- ✅ Complex problem decomposition, root cause of systemic issues
- ❌ Code review, bug diagnosis, architecture review → use `review` / `diagnose` / `design`
- ❌ Library/SDK evaluation → use `research`
</EXTREMELY-IMPORTANT>

# Deep Analysis Framework

## Invocation

```
/my-analyze <topic or question>
```

No modes. One unified, abstract analytical process that adapts depth per methodology based on the subject.

## Core Principle

> "The quality of your analysis is bounded by the quality of your questions, not your answers."

This skill forces structured, multi-lens examination. Each methodology attacks a different cognitive blind spot. The synthesis is where insight emerges.

---

## Phase 1: FRAME — Define the Problem Space

Before analyzing, ensure the right problem is being analyzed.

### 1.1 Problem Statement Crystallization
- Restate the topic as a **falsifiable hypothesis** or **precise question**
- Identify the **decision** this analysis should inform (if any)
- Define **success criteria** — what would a "good answer" look like?

### 1.2 Scope & Boundaries
- What is IN scope vs OUT of scope?
- What **time horizon** applies? (tactical vs strategic)
- Who are the **stakeholders** affected?

### 1.3 Bias Pre-Check (Metacognition)
- What is the **default/obvious answer**? (anchoring awareness)
- What would I **want** the answer to be? (confirmation bias awareness)
- What information am I **missing** that I don't know I'm missing? (unknown unknowns)

Output: `**[FRAME]** Problem: ... | Decision: ... | Time Horizon: ... | Default Assumption: ...`

---

## Phase 2: DECOMPOSE — Multi-Methodology Deep Dive

Apply each lens independently. Do NOT blend them during analysis — synthesis comes in Phase 3.

### Lens 1: First Principles Decomposition
Strip away conventions, assumptions, and analogies. Reduce to fundamental truths.

- What are the **irreducible facts** (physics, economics, human nature)?
- What is **convention** vs **constraint**? (convention can be broken, constraint cannot)
- Rebuild from ground truth: if we were starting from zero, what would we build?
- **Litmus test**: "We do X because Y" — is Y still true? Was Y ever verified?

### Lens 2: MECE Breakdown (Mutually Exclusive, Collectively Exhaustive)
Structure the problem so nothing is missed and nothing overlaps.

- Partition the problem into **3-7 non-overlapping categories**
- For each category: what is the **current state**, **desired state**, and **gap**?
- Verify exhaustiveness: is there a category you're tempted to ignore?
- **Anti-pattern**: if categories overlap → re-cut. If >7 → group hierarchically.

### Lens 3: Systems Thinking (Feedback Loops & Dynamics)
Map the system, not just the components.

- **Causal Loop Diagram**: identify reinforcing (+) and balancing (-) feedback loops
- **Stocks & Flows**: what accumulates? What depletes? Where are the delays?
- **Leverage Points** (Donella Meadows): where does small intervention → large effect?
- **Emergent properties**: what behaviors arise from interactions that no single component exhibits?

### Lens 4: Inversion (Pre-Mortem & Via Negativa)
Instead of asking "how to succeed", ask "how to certainly fail".

- **Pre-Mortem**: assume the initiative has failed catastrophically — what happened?
- **Via Negativa**: what should we **stop doing** or **remove**? (subtraction > addition)
- **Worst case**: what is the **irreversible** downside? Can we survive it?
- **Charlie Munger test**: "All I want to know is where I'm going to die, so I'll never go there."

### Lens 5: 5 Whys + Ishikawa (Root Cause Chain)
Drill past symptoms to structural causes.

- Ask "Why?" iteratively — stop when you hit a **policy, incentive, or structural constraint**
- At each level, ask: "Is this the cause, or a **co-occurring symptom**?"
- Map causes to Ishikawa categories if applicable: People, Process, Policy, Environment, Resources
- **Trap avoidance**: don't stop at the first comfortable answer

### Lens 6: Second-Order Effects & Temporal Analysis
Most analysis stops at first-order consequences. Go deeper.

- **Order mapping**: 
  - 1st order: what happens immediately?
  - 2nd order: what does the 1st-order effect cause?
  - 3rd order: what new equilibrium emerges?
- **Temporal phases**: 
  - Short-term (0-3mo): what changes?
  - Medium-term (3-12mo): what adapts?
  - Long-term (1-3yr): what is the new normal?
- **Unintended consequences**: who/what is affected that wasn't considered?

### Lens 7: Steelmanning & Dialectic
Build the strongest possible case for the opposing view.

- **Steelman**: construct the BEST argument against your emerging conclusion
- **Dialectic**: thesis → antithesis → synthesis. What higher truth reconciles both?
- **Red Team**: if a smart adversary wanted to exploit your conclusion, how would they?
- **Ideological Turing Test**: can you argue the opposing position so convincingly that a believer can't tell you apart?

---

## Phase 3: SYNTHESIZE — Convergent Insight

### 3.1 Cross-Lens Pattern Recognition
- Which findings appear across **multiple lenses**? (high-confidence signals)
- Which findings appear in **only one lens**? (potential blind spots or unique insights)
- Where do lenses **contradict** each other? (tension = where the real insight lives)

### 3.2 Insight Hierarchy
Rank findings by:

| Tier | Criteria | Action |
|------|----------|--------|
| **S — Structural** | Changes the problem definition itself | Reframe before proceeding |
| **A — Strategic** | Shifts the optimal strategy | Decide now |
| **B — Tactical** | Improves execution within current strategy | Plan & schedule |
| **C — Contextual** | Good to know, no action required | Document for reference |

### 3.3 Confidence Calibration
For each key insight:
- **Evidence strength**: anecdotal → pattern → data → causal proof
- **Reversibility**: if we act on this and it's wrong, how bad is it?
- **Information value**: what additional data would most change this conclusion?

---

## Phase 4: DELIVER — Actionable Output

### Output Structure

```markdown
## Deep Analysis: [Topic]

### Frame
- **Core Question**: ...
- **Decision**: ...
- **Time Horizon**: ...
- **Key Bias Risk**: ...

### Key Insights (ranked S→C)

#### [S] Structural Insight: ...
- Evidence: ...
- Confidence: H/M/L
- Implication: ...

#### [A] Strategic Insight: ...
...

### Tensions & Unresolved Questions
- [Tension between Lens X and Lens Y]: ...
- [Open question requiring more data]: ...

### Recommendations
1. **Immediate**: ... (if confident enough to act)
2. **Investigate**: ... (if more data needed before acting)
3. **Monitor**: ... (watch for signals that change the analysis)

### Anti-Recommendations (what NOT to do)
- ...
```

---

## Execution Protocol

1. **Always use `sequential-thinking` MCP tool** for Phase 2 lens work — structured external reasoning prevents premature convergence
2. **Parallel subagents**: for complex topics, launch lenses 1-7 as parallel agents, then synthesize
3. **Evidence over assertion**: every claim must cite observable fact, not just reasoning
4. **Time-box per lens**: ~2-3 min each. If a lens yields nothing, say so explicitly — "Lens X: no additional insight beyond what other lenses revealed"
5. **User interaction**: after Phase 1 FRAME, pause and confirm with user before deep dive — wrong framing wastes all subsequent analysis

## Integration with Other Skills

| If analysis reveals... | Route to... |
|------------------------|-------------|
| Implementation needed | `Skill("design")` → `Skill("plan")` |
| Risk/incident pattern | `Skill("operate", "incident")` |
| Product opportunity | `Skill("product", "ideation")` |
| Domain knowledge gap | `Skill("domain", "analyze")` |
| Evaluation needed | `/my-eval` |
