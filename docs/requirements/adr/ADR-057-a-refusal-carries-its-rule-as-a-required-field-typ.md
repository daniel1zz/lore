---
id: ADR-057
type: adr
role: decision
title: "A refusal carries its rule as a required field; type checking replaces the site census"
status: approved
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
links:
  - {id: ADR-055, type: relates-to}
---
## Context

D1 of `adr-facts-live-once-next-to-what-they-describe-corpus-changes` moved rule mappings from the corpus into code. It kept the unit of the old design, the refusal site: the source line of an `err(...)` call, reached from a command by a static walk over call paths (the site census).

Running the conversion on 2026-10-20 measured that unit:
- Of 1,356 corpus mappings, 147 shared refusal sites carried 522 mappings to different rules. One site, `gate-enforcer.ts:715`, carried 35.
- A shared chokepoint does not decide any rule. The decision is made upstream, by the predicate that produced the refusal. The census cannot see that link, so it needs heuristics: nearest tagged function, `generic` status, conflict policies.
- A mechanical placement attributed 54 unrelated sites to one function. A lowest-id policy picked rules by number.

The census, the call-path walk and per-leaf site coverage are machinery whose only job is to recover a fact that is already known, exactly, at the moment the refusal is constructed.

## Decision

The rule is a required field of the refusal value, set where the refusal is constructed. Type checking, not a census, guarantees completeness.

1. `LoreError.rule` is required, and the type ties it to the error code. The codes that report a dependency failure (storage, transport, rate limit, AI provider) take `"infrastructure"` or a rule id; every other code, which reports a business decision such as validation, lifecycle or conflict, takes a rule id (`BR-n`). Code that sets no rule, or labels a business refusal `"infrastructure"`, does not compile.
2. A shared chokepoint passes the refusal through and never chooses a rule.
3. The build fails on a rule id in source that is not a live rule of the baseline snapshot it is built against, naming file:line.
4. The rule-to-code index is derived from source: the lines that construct a refusal carrying the id. A rule's acceptance criteria prove that it is enforced, by asserting the reported refusal's rule.
5. Coverage keeps one question: is every runnable command declared on a business leaf? The site census, `lore baseline sites`, per-leaf site coverage and every site-mapping rule are removed.

## Consequences

- D1's conversion result stays: 644 mappings placed at the line that constructs the refusal.
- The 712 corpus mappings that were not placed (522 on shared sites, 140 stale, 6 on non-live rules, 44 in deleted or held code) are exported to a reference document before the corpus keys are removed. They are hints for labelling, never labels themselves.
- There is no optional period. One integration branch makes the field required, and the same branch labels every construction the compiler then lists. Agents work module by module on sub-branches merged into it, and it lands once. Each label sits in the predicate where the decision is made, and acceptance criteria assert it.
- Supersedes the parts of D1 that keep a census: statement tags on call points, `generic` attribution, and site coverage per leaf. D2 to D4 are unchanged.
