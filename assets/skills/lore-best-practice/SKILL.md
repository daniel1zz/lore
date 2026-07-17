---
name: lore-best-practice
description: "Use when reviewing a proposed solution that smells like a hack, workaround, or shortcut. Also use when user says 'do it right', 'best practice', 'no hacks', 'proper solution', or when tempted to write TODO/FIXME."
---

# Best Practice Enforcer

You are in **best-practice-only mode**. Every decision MUST choose the correct, maintainable solution over the fast, temporary one.

## Task: $ARGUMENTS

## Constraint Protocol

Before writing ANY code, run this decision gate for each change:

### Gate 1: Anti-Pattern Blacklist

Reject and rewrite if ANY of these appear:

| Anti-Pattern | Example | Required Instead |
|---|---|---|
| `any` / `unknown` type assertion | `as any`, `x as unknown as Y` | Proper generic or type narrowing |
| eslint/ts-ignore suppression | `// eslint-disable`, `// @ts-ignore` | Fix the underlying type/lint issue |
| setTimeout/setInterval as sync hack | `setTimeout(() => retry(), 1000)` | Proper retry with exponential backoff, or event-driven |
| Empty catch / catch-ignore | `catch (e) {}`, `catch (_) { /* ignore */ }` | Explicit error handling or propagation |
| Magic numbers/strings | `if (status === 3)`, `role === 'a'` | Named constants or enums |
| Inline styles (web) | `style={{ color: 'red' }}` | CSS modules, Tailwind, or design tokens |
| Direct DOM manipulation (React) | `document.getElementById` | Refs or state-driven rendering |
| Monkey-patching | `Array.prototype.custom = ...` | Utility function or proper extension |
| Global mutable state | `window.appState = {}` | State management (store, context, signal) |
| String concatenation for SQL/HTML | `` `SELECT * WHERE id=${id}` `` | Parameterized queries / template engine |
| Hardcoded secrets/URLs | `const API = 'https://...'` | Environment variables / config |
| Copy-paste duplication | Same logic in 2+ places | Extract shared function/component |

### Gate 2: Solution Quality Check

For each implementation decision, ask:

1. **Is there an established pattern?** Search official docs (context7/deepwiki) for the canonical way.
2. **Would a senior engineer approve this in code review?** If hesitant, find the proper approach.
3. **Will this survive a dependency upgrade?** No reliance on undocumented internals.
4. **Is this the API's intended usage?** Not a clever workaround that happens to work.

### Gate 3: Approach Selection

When multiple approaches exist:

```
For each candidate:
  - Name the pattern/principle it follows
  - Check: is it documented in official sources?
  - Check: is it the RECOMMENDED approach (not just "possible")?
  - Score: maintainability (1-5), correctness (1-5), community adoption (1-5)

Select: highest total score. Tie-break: community adoption wins.
```

## Execution Rules (SOLID + Clean Code)

1. **Docs first**: Before implementing with any library/framework API, consult official docs via context7 or deepwiki. No guessing from training data.
2. **No TODO/FIXME/HACK markers**: If you'd write a TODO, solve it now or explicitly flag as out-of-scope to the user.
3. **Type-safe boundaries**: Zod or equivalent validation at every external data boundary (API response, user input, file read).
4. **Error handling is not optional**: Every error path must be explicitly handled — propagate, recover, or inform the user.
5. **Naming = documentation**: Variable/function names must convey intent. No `data`, `result`, `temp`, `obj`, `item` without qualifier.
6. **Single responsibility**: Each function does one thing. Each file has one clear purpose.
7. **Prefer SDK over raw HTTP**: If an official SDK exists, use it. Don't hand-roll API calls.

## Output Format

Before starting implementation, output:

```
**[BEST-PRACTICE GATE]**
- Task: {what you're about to do}
- Pattern: {named pattern/approach you'll follow}
- Source: {official doc reference confirming this is best practice}
- Rejected alternatives: {what you're NOT doing and why}
```

Then implement. After completion, output:

```
**[BEST-PRACTICE VERIFY]**
- Anti-pattern scan: {PASS/FAIL — list any flags}
- Type safety: {PASS/FAIL}
- Error handling: {PASS/FAIL}
- Doc-verified APIs: {list of APIs used and doc source}
```
