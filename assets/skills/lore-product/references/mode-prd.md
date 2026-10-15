# Mode: PRD

**Purpose**: Multi-stakeholder PRD writing — requirements validated from every angle before commitment

> **Templates**: `~/.claude/templates/prd-full.md` | `~/.claude/templates/prd-minimal.md`
> **Detailed Guide**: [prd-guide.md](prd-guide.md)

## Phase 0: Upstream Chain Gate (HARD — before ANY PRD work)

A PRD **records** decisions; it is not where they get made. If the requirements are first conceived while drafting this document, they are the author's guesses wearing the authority of a spec.

⛔ **REFUSE to start PRD drafting** unless the upstream artifacts exist (`lore search` to confirm, don't assume):

| Required upstream | Produced by | Supplies |
|------------------|-------------|----------|
| Feature Matrix | `lore-product-benchmark` | Table-stakes floor + explicit traps (non-goals) |
| Opportunity Solution Tree | `/lore-product opportunity` | The derived feature candidates, each traced to an evidenced need |
| Validation Ledger | `/lore-product validate` | Per-requirement `validated` / `unvalidated` / `accepted bet` status |
| Story map | `/lore-product decompose` | The requirement rows themselves, incl. empty/error/return paths. Required whenever the change adds a step to the user's journey |

**Exceptions** (each must be stated explicitly in the PRD, not assumed silently):
1. **PRD UPDATE** of an existing document → proceed; the chain ran when it was created
2. **Minimal PRD** (improvement, <2wk, low risk, no new user-facing bet, touching a single existing journey step) → benchmark + OST + story map may be waived; validation status is still mandatory
3. **User explicitly waives** ("跳过" / "skip the chain") → proceed, and mark every requirement `⚠️ unvalidated` with a `source: user directive`

Missing an artifact with no exception → route to the producing mode first and say which one is missing. Do not "cover it inline" — the whole point of the chain is that PRD drafting is the wrong place to invent, derive, or validate.

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "The user gave a clear direction, the chain is overkill" | Clear input tells you WHAT they pictured, not which parts matter or whether anyone else wants it. |
> | "I can infer the requirements from the benchmark" | Inference ≠ derivation ≠ validation. The benchmark is a `source`; it never establishes that our users need the row. |
> | "I'll just write the PRD and validate afterwards" | Nothing gets validated after a PRD exists — the document becomes the commitment. That is the failure mode this gate blocks. |
> | "Running the chain costs more than just writing it" | It costs less than building the wrong thing, which is the alternative being compared against. |

## Phase 1: Context & Draft

### Phase 1A: Key Decisions Gate (HARD — before writing full PRD)

After ST analysis and before drafting the full PRD, identify **3-5 key decisions** — the highest-leverage questions that shape the entire PRD. They are asked in the ONE batched-governance S1 decision interview (`~/.claude/skills/shared/batched-governance.md`), in the same sitting as the design and plan questions for this initiative — not in a PRD-only stop.

⛔ **REFUSE to write the full PRD body** until the S1 interview has answered these questions.

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

### Phase 1C: Provenance & Validation Gate (HARD)

⛔ **Every requirement carries two mandatory fields.** A requirement that cannot fill them was invented during PRD drafting — which is the one place it must never be invented, because the PRD is where guesses acquire the authority of decisions.

| Field | Allowed values | Meaning |
|-------|---------------|---------|
| `source` | OST leaf id · benchmark matrix row · user decision (Phase 1A) · regulatory/technical constraint | Where this requirement came from |
| `validation` | `✅ validated` (experiment ran and passed) · `⚠️ unvalidated` (not tested) · `🎲 accepted bet` (user explicitly chose to proceed untested) | What we actually know |

⛔ **`validation` is copied from the Validation Ledger, never asserted here.** Reasoning your way to "validated" during PRD writing is the precise failure [mode-validate.md](mode-validate.md) exists to block.

**P0 rule (HARD)**: a P0 requirement whose value risk is `⚠️ unvalidated` must be one of:
1. Demoted below P0, or
2. Preceded by a validation task in the downstream plan, or
3. Escalated to the user in the S1 decision interview and, if they choose to proceed, recorded as `🎲 accepted bet` — using that word, in the PRD.

⛔ **Never silently promote `unvalidated` to `validated`** because the idea is compelling, the stakeholder review liked it, or the schedule is tight.

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "This feature is obviously needed, validation is ceremony" | Obviousness is the feeling that precedes most shipped-and-unused features. Mark it `🎲 accepted bet` and move on — the label costs nothing and is the record. |
> | "The benchmark has it, so it's validated" | Benchmark presence proves someone else shipped it, not that our users want it. That is `source`, not `validation`. |
> | "5 stakeholder agents approved it" | Agents review the document's structural quality. None of them are a user, and none of them ran an experiment. |

## Phase 2: Multi-Stakeholder Parallel Review

These 5 lenses are the PRD lens of the ONE batched-governance S3 bundle review — dispatched when the whole initiative (PRD + every spec + every plan) exists as drafts, each lens reading the full bundle, never a PRD-only review round of its own. A PRD with no downstream work in this run (standalone PRD update) is its own bundle.

Launch **5 parallel subagents**, each reviewing the draft PRD from a different stakeholder lens.
Use `Agent` tool — send ALL 5 in a single message for true parallel execution.

⛔ **Always pass an explicit `subagent_type`** — never rely on the `general-purpose` default (some environments hard-block it via a pre-agent gate, no bypass). Pick a READ-ONLY, review-natured specialized type your environment allows (e.g. `lore-reader` in lore-governed projects); the Identity Prompt below explicitly overrides that agent's default framing to the stakeholder lens, so any reviewer-shaped type works.

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

## Phase 3.5: User Approval — the single S4 approval (HARD — before marking PRD "approved")

⛔ **REFUSE to set PRD status to "approved"** without explicit user confirmation — given ONCE, in the batched-governance S4 approval of the whole bundle, never in a PRD-only stop.

The PRD's contribution to the S4 summary:
1. **Executive summary** (2-3 sentences)
2. **Key trade-offs made** (what we chose and what we rejected)
3. **Scope boundaries** (what's IN and what's explicitly OUT)
4. **Top risk** (the #1 thing that could go wrong)

On S4 approve, the PRD is approved FIRST in the batch (before its specs and plans).

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
| **Provenance** | **Every requirement has a `source` (OST leaf / benchmark row / user decision / constraint)?** |
| **Validation** | **Every requirement tagged validated / unvalidated / accepted bet, copied from the Ledger — and no P0 left silently unvalidated?** |

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
3. **Link upstream (all that exist)**: `lore link <prd> <ost-doc> --type=implements` · `lore link <prd> <validation-ledger> --type=implements` · `lore link <prd> <benchmark-teardown> --type=relates-to`
4. **Quality check**: Run checklist before marking `in-review` (`lore set <prd> --status in-review`)

⛔ A PRD with no upstream links is a claim that its requirements came from nowhere. If the chain genuinely was waived, record that as the reason rather than leaving the links absent and unexplained.

## Triggers
"Write PRD", "Document requirements", "Spec this feature", "Create product spec"
