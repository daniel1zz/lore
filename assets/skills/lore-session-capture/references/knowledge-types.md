# Knowledge Types Reference — lore corpus mapping

Detailed mapping of session-knowledge categories to lore document types.
lore has SIX fixed types (`prd | spec | adr | plan | knowledge | task`); knowledge
sub-types carry the finer taxonomy (`ideation | retro | research | reference |
assessment | prompt | skill | handoff`). All persistence routes through the lore
CLI — no direct file I/O into `.lore/`.

## Routing Decision Tree

```
Session knowledge → lore CLI
│
├─ Decision (tech / architecture / business rule) → lore create adr --decision-status accepted|proposed
├─ Bug pattern / retro learning                   → lore create knowledge --sub-type retro
├─ Research finding / benchmark / comparison      → lore create knowledge --sub-type research
├─ SDK gotcha / playbook / reusable reference     → lore create knowledge --sub-type reference
├─ Raw idea, not yet decided                      → lore create knowledge --sub-type ideation
├─ Feature requirements (structured, with ACs)    → lore feed spec-create
│                                                   then lore create spec --kind feature + lore ac add
├─ API contract / data model / UI standard        → belongs on the governing spec. Read its Standing in `lore get`:
│                                                   not locked → lore set <spec>; locked, no evidence →
│                                                   lore reopen <spec> --reason, then edit; locked with evidence →
│                                                   new spec + lore link <new> <old> --type relates-to
│                                                   (typo only: lore set --correction "<reason>"). No spec home →
│                                                   knowledge --sub-type reference (living: edited in place)
├─ Unfinished-work handoff                        → lore handoff --decision "..." --next "..."
│                                                   (⛔ NOT create --sub-type handoff — rejected; SPEC-041)
└─ Knowledge proven WRONG                          → lore invalidate <old> [--superseded-by <new>] --reason "..."
```

**Before creating**: always `lore search "<topic>" --json` first.
**After creating**: always `lore link <new> <related> --type=informs|relates-to`.

---

## 1. Architecture / Technical Decisions

**Detection signals**: library/framework selected, module restructured, design pattern
introduced, layer boundary moved, security/perf strategy chosen — *with an alternative
rejected*. No rejected alternative → it's a learning, not a decision.

**Persist**: `lore create adr --title "<descriptive title>" --decision-status accepted`
(use `proposed` when the user hasn't ratified it).

**Content template**:
```markdown
**Context**: {problem}
**Decision**: {what was decided}
**Rationale**: {why this option}
**Alternatives Considered**: {options + why rejected}
**Consequences**: {implications}
```

## 2. Business Rules / Domain Invariants

**Detection signals**: conditional logic enforcing policy, validation invariants,
state-transition guards, access-control rules.

**Persist**: `lore create adr` — a rule is a decision about the domain.

**Content template**:
```markdown
**Context**: {when this rule applies}
**Constraint**: {what must / cannot happen}
**Reason**: {why}
**Enforced at**: `{code location}`
```

## 3. Bug Fix Learnings

**Detection signals**: non-obvious root cause identified, fix applied with explanation,
similar bugs plausible elsewhere. Obvious typo-class fixes are noise.

**Persist**: `lore create knowledge --sub-type retro --title "Bug: <brief>"`

**Content template**:
```markdown
**Symptom**: {observed}
**Root Cause**: {actual problem}
**Fix**: {solution}
**Prevention**: {how to avoid}
**Related Files**: `{paths}`
```

## 4. SDK / Tooling Patterns

**Detection signals**: non-trivial SDK integration implemented, gotcha discovered while
debugging, effective multi-SDK combination, version-specific workaround.

**Persist**: `lore create knowledge --sub-type reference --title "<SDK> Playbook"`
(or `Integration: <A> + <B>` for combinations).

**Dedup rule**: `lore search "<sdk name>" --type knowledge --json` — found → extend via
`lore set`, appending to sections; not found → create.

**Content template**:
```markdown
### Versions Tested
### Recommended Patterns
### Anti-Patterns
### Gotchas
### Integration Notes
```

## 5. Research Findings

**Detection signals**: benchmark run, options compared with evidence, external source
verified (keep the URLs/tier).

**Persist**: `lore create knowledge --sub-type research`

## 6. Feature Requirements

**Detection signals**: requirements formalized (EARS-style When/While/If-then),
acceptance criteria in Given/When/Then, scope boundaries agreed.

**Persist** — this is a real spec, gated:
```bash
lore feed spec-create        # read the feeding pack FIRST
lore create spec --title "..." --kind feature   # a spec takes no parent; cite rules per criterion:
lore ac add <spec> ... --cite BR-<n>             # or: lore ac cite <spec> <AC> BR-<n> (BR-1007: no approval without a citation)
lore ac add <spec> AC-1 --statement "..." --mode script|ai|human [--oracle test --command "..."]
```

## 7. Invalidated Knowledge (memory hygiene)

**Detection signals**: this session's evidence contradicts an existing knowledge/adr doc;
a new decision replaces an old one; a documented pattern turned out to be an anti-pattern.

**Persist**:
```bash
lore invalidate <old> --superseded-by <new> --reason "..."   # replacement exists
lore invalidate <old> --reason "disproven: <evidence>"        # no replacement
lore create adr --title "..." --supersedes <old>              # create + invalidate in one
```
Never leave a disproven doc standing un-invalidated — filtered reads (`search`/`list`)
would keep feeding it to future sessions as truth.

## 8. Handoff

**Detection signals**: WIP remains at session end — claimed tasks, half-done plan,
uncommitted direction.

**Persist**: `lore handoff [--plan <plan>] --decision "<judgment>[@conf]" --next "<step>" [--file <path>]...`
(or `--json-file <payload.json>` — the file IS `extra.handoff`). ⛔ NOT
`lore create knowledge --sub-type handoff` — create rejects it; `lore handoff` is the
sole writer and the body is a deterministic projection of the structured fields
(SPEC-041). Link `--type=informs` to the plan.

**Consumed by**: `lore feed session-resume` in the next session.
