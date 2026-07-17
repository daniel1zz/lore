# Design Decisions Log

> **Maintained by design:ui skill**
> Purpose: keep an auditable, low-friction history of UI design decisions to prevent style drift.

---

## 2026-02-01 - Add Business Scenario Style Guide Module

**Status**: accepted

**Context**:
- The existing `ui-design.md` focused on technical implementation (components, tokens, responsive)
- Lacked guidance on **how to choose** appropriate styles for different business scenarios
- No systematic approach to map industry/product/user to visual language
- Users needed to manually determine style direction without framework support

**Decision**:
- Create new `ui-style-guide.md` with comprehensive business scenario style framework
- Adopt **Jennifer Aaker's 5-dimension brand personality model** as foundation
- Define **6 industry style profiles**: Fintech, Healthcare, Gaming, Education, E-commerce, Enterprise
- Add **style decision tree** with 5 questions for style determination
- Provide **query templates** for `ui-ux-pro-max` by industry and style
- Update workflow to include style decision step before design system generation

**Rationale**:
- Aaker framework is academically validated and widely adopted in branding
- Industry profiles provide actionable, specific guidance (not just generic principles)
- Decision tree reduces cognitive load when starting new projects
- Query templates ensure consistent use of `ui-ux-pro-max` tool

**Alternatives considered**:
- **12 Brand Archetypes model**: Rejected - more complex, harder to map to visual language
- **No framework (freeform)**: Rejected - leads to inconsistent style decisions
- **Single industry focus**: Rejected - limits skill applicability across projects

**Consequences**:
- **Easier**: Determining appropriate visual language for new projects
- **Easier**: Consistent style recommendations across different sessions
- **Easier**: Using `ui-ux-pro-max` with appropriate parameters
- **Harder**: May need updates as industries evolve (maintenance burden)
- **Harder**: Edge cases not covered by 6 industries need manual handling

**References**:
- Aaker, J. (1997). "Dimensions of Brand Personality". Journal of Marketing Research
- `skills/lore-design/references/ui-style-guide.md` - Full implementation
- `skills/lore-design/references/ui-design.md` - Technical implementation reference
- Research sources: MockFlow, Figma Resource Library, Chakra UI docs, Ant Design docs
