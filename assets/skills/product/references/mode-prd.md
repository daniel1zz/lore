# Mode: PRD

**Purpose**: Multi-stakeholder PRD writing — requirements validated from every angle before commitment

> **Templates**: `~/.claude/templates/prd-full.md` | `~/.claude/templates/prd-minimal.md`
> **Detailed Guide**: [prd-guide.md](prd-guide.md)

## Phase 0: Brainstorming Gate (HARD — before ANY PRD work)

⛔ **REFUSE to start PRD drafting** unless one of these is true:
1. `superpowers:brainstorming` was already invoked this session (check conversation history)
2. User explicitly said "skip brainstorm" / "跳过头脑风暴" / provided a complete brief with problem+users+scope
3. This is a PRD UPDATE (existing PRD being revised), not a new PRD

If none apply → invoke `Skill("superpowers:brainstorming")` FIRST. Brainstorming surfaces:
- User's actual intent (which may differ from their stated request)
- Priority dimensions (what matters MOST vs nice-to-have)
- Hidden constraints and non-obvious requirements
- Alternative approaches the user hasn't considered

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "User gave a clear screenshot + direction, brainstorming is overkill" | Clear input ≠ validated intent. A screenshot shows WHAT, not WHY or WHICH PARTS matter. |
> | "I can infer the requirements from the benchmark" | Inference ≠ alignment. 10 minutes of questions prevents 2 hours of wrong-direction work. |

## Phase 1: Context & Draft

### Phase 1A: Key Decisions Gate (HARD — before writing full PRD)

After ST analysis and before drafting the full PRD, present **3-5 key decisions** to the user via `AskUserQuestion`. These are the highest-leverage questions — they shape the entire PRD.

⛔ **REFUSE to write the full PRD body** until user has answered these questions.

**How to identify key decisions:**
- Dimensions/scope: "Which of these capabilities do you want in v1?" (multi-select)
- Framing: "How should we present data to users?" (options with trade-offs)
- Priority: "What matters more: X or Y?" (forced ranking)
- Exclusion: "Which of these should we explicitly NOT do?" (multi-select)

**Rules:**
- Use `AskUserQuestion` with concrete options (never open-ended "what do you think?")
- Each question must have ≥2 substantive options with descriptions
- If a decision has an obvious winner, still present alternatives (≥2 options is CLAUDE.md policy)
- Record answers → they become PRD constraints

### Phase 1B: Draft PRD

**Only after Phase 1A answers received.** Write initial PRD using template (Full or Minimal based on scope). Include:
- Problem statement, user definition, goals/non-goals
- Draft requirements with priorities (MoSCoW)
- Draft success metrics
- Known risks and assumptions
- **Explicitly mark which decisions came from user (Phase 1A) vs AI analysis**

Output: **Draft PRD** for stakeholder review.

## Phase 2: Multi-Stakeholder Parallel Review

Launch **5 parallel subagents**, each reviewing the draft PRD from a different stakeholder lens.
Use `Agent` tool — send ALL 5 in a single message for true parallel execution.

⛔ **Always pass an explicit `subagent_type`** — never rely on the `general-purpose` default (some environments hard-block it via a pre-agent gate, no bypass). Pick a READ-ONLY, review-natured specialized type your environment allows (e.g. `lore-reviewer` in lore-governed projects); the Identity Prompt below explicitly overrides that agent's default framing to the stakeholder lens, so any reviewer-shaped type works.

### Stakeholder Matrix

| # | Stakeholder | Identity Prompt | Review Focus |
|---|------------|----------------|-------------|
| 1 | **End User Advocate** | "You represent the end users of this product. Judge whether this PRD truly solves their problem." | Does the problem statement match real user pain? Are requirements user-centric or feature-centric? Missing user journeys? Non-goals that cut important user needs? AC testable from user perspective? |
| 2 | **Engineering Lead** | "You are the tech lead who will implement this. Judge feasibility, clarity, and completeness." | Can eng work from this? Ambiguous requirements? Missing technical constraints? Untestable AC? NFRs realistic? Are estimates reasonable? Hidden complexity? |
| 3 | **QA/Test Lead** | "You are the QA lead planning test strategy. Judge testability and completeness of acceptance criteria." | Every requirement has AC? AC follows Given-When-Then? Edge cases covered? Missing error scenarios? How would you test each requirement? Any requirement untestable? |
| 4 | **Product Strategist** | "You are a senior product strategist. Judge strategic alignment and scope discipline." | Why now? Why us? Kill criteria defined? Scope creep risks? Non-goals sufficient? Success metrics SMART with baseline? Feature priority defensible? Solution-first thinking detected? |
| 5 | **Devil's Advocate** | "You challenge every assumption in this PRD. Find what will go wrong." | Biggest unvalidated assumption? What if market is smaller? What if users don't care about this solution? Over-scoped for first iteration? Missing competitive response? What does the post-mortem say? |

### Subagent Prompt Template

Each subagent receives:

```
## Stakeholder Role
{Identity Prompt}

## Draft PRD
{full draft PRD content}

## Your Task
Review this PRD from your stakeholder perspective.

Provide:
1. **Strengths** (2-3): What's good about this PRD from your lens?
2. **Gaps** (3-5): What's missing or unclear? Be specific — cite requirement IDs.
3. **Risks** (2-3): What could go wrong that this PRD doesn't address?
4. **Suggested Changes**: Concrete edits (add/modify/remove requirements, clarify AC, adjust scope)
5. **Quality Score**: 1-10 from your perspective, with 1-sentence justification

Keep output concise (300 words max). Reference specific sections/requirement IDs.
```

## Phase 3: Synthesis & Revision

After all 5 stakeholders return, synthesize:

### Synthesis Framework

1. **Cross-stakeholder consensus** — issues flagged by 3+ stakeholders (must fix)
2. **Stakeholder-specific gaps** — valid but perspective-limited (evaluate)
3. **Quality Score Aggregation**: average + lowest score highlights weakest area
4. **Revised PRD** — incorporate all must-fix items, evaluate perspective-specific items

## Phase 3.5: User Approval Gate (HARD — before marking PRD "approved")

⛔ **REFUSE to set PRD status to "approved"** without explicit user confirmation.

After stakeholder synthesis and revision, present to the user:
1. **Executive summary** (2-3 sentences)
2. **Key trade-offs made** (what we chose and what we rejected)
3. **Scope boundaries** (what's IN and what's explicitly OUT)
4. **Top risk** (the #1 thing that could go wrong)

Use `AskUserQuestion`:
- "PRD 最终确认" — 批准进入设计阶段 / 需要调整 / 推翻重来
- If "需要调整" → iterate and re-present
- Only "批准" → set status to approved

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "5 stakeholder reviews already validated this" | Stakeholder reviews check structural quality, NOT user intent alignment. |
> | "User said '继续' earlier, that implies approval" | '继续' means 'proceed with the process', not 'I approve this specific document'. |

### Quality Checklist (auto-verify after revision)
| Check | Question |
|-------|----------|
| Problem | User-centric with evidence? |
| Scope | Goals AND Non-goals clear? |
| Requirements | Every FR has ID, priority, AC? |
| AC | All testable (Given-When-Then)? |
| Metrics | SMART with baseline and target? |
| Risks | Assumptions and risks documented? |
| Downstream | Can design/eng/QA work from this? |
| **User Alignment** | **Key decisions confirmed by user (Phase 1A)?** |

## Writing Principles
- Describe problem better than solution
- Success metrics before features
- Trade-offs explicitly documented
- Non-goals as important as goals
- Every requirement needs AC
- Priority framework: MoSCoW — consistent across all requirements
- NFRs are requirements too

## Common PRD Failures
Feature list without context, no metrics, baked-in scope creep, solution-first thinking, missing/untestable AC, no kill criteria, ignoring NFRs

## Cross-Cutting Concerns Gate (MANDATORY)

Add to Phase 3 quality checklist — PRD MUST address:
- [ ] **Privacy**: Data collection justified and minimized? Consent architecture defined?
- [ ] **Ethics**: Dark pattern audit passed? AI ethics checklist completed (if applicable)?
- [ ] **Accessibility**: WCAG AA target stated? Specific a11y requirements in NFRs?
- [ ] **Inclusivity**: Multiple interaction modes? Cultural considerations documented?
- [ ] **Impact traceability**: Every requirement traces to an Impact Map deliverable (if map exists)?

See [cross-cutting-concerns.md](cross-cutting-concerns.md) for full framework.
See [impact-mapping.md](impact-mapping.md) for Goal→Deliverable traceability.

## JTBD Integration (RECOMMENDED)

When JTBD analysis exists from discovery/ux-research:
- **Outcome statements** → PRD success metrics (already quantified, solution-agnostic)
- **Job map steps** → functional requirement generation seeds
- **Forces analysis** → inform non-goals (don't increase anxiety, don't break habit of current)

See [jtbd-framework.md](jtbd-framework.md) for framework details.

## PRD Structure Summary

**Full** (major features): Context → Users → Solution → Requirements → AC → Risks → Validation → Appendix
**Minimal** (improvement, <2wk, low risk): metadata + problem + 1 goal + ≥2 non_goals + P0 requirements + success criteria

## lore Protocol (MANDATORY)

1. **Search first**: `lore search "{feature}" --type prd --json` — may need update, not new doc
2. **Create**: `lore create prd --title '{feature}' --tags '{feature}' --content ...`
3. **Link upstream**: `lore link <prd> <discovery-or-ideation-doc> --type=implements`
4. **Quality check**: Run checklist before marking `in-review` (`lore set <prd> --status in-review`)

## Triggers
"Write PRD", "Document requirements", "Spec this feature", "Create product spec"
