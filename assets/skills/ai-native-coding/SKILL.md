---
name: ai-native-coding
description: "AI-native coding paradigm reference for implementer / reviewer subagents. Use when writing or reviewing source code (implementation, not tests) to ensure the code itself carries enough context for the NEXT session's AI to safely modify it. Triggers: writing a new module, adding a function/class, changing an existing module's surface, designing an error model, modeling state, choosing a name, adding logging, deciding whether to abstract."
---

# AI-Native Coding

## Core Proposition

> **Human paradigm**: context lives in the developer's head; code can "be understood when read together with the developer."
>
> **AI agent paradigm**: every session may lose context; code MUST be **self-evident** — types, validation, naming, errors, state, side effects, and the "why" of decisions are all **codified in the source**.

Code is no longer written **for the next human reader**. It is written **for the next AI session that may have lost every prior turn's context**. That session must:

1. Open one file and understand what the module does, what it depends on, and what it must NOT do — without reading the whole repo.
2. Tell, from types alone, what is valid input vs invalid input.
3. See, in error names and payloads, why a failure happened and what to fix.
4. Recognize, from names, whether a function is a query or a command, pure or effectful.
5. Find every related symbol via grep / LSP without guessing aliases or abbreviations.
6. Know, from inline comments, which lines look weird **on purpose** and must not be "cleaned up."

If the code does not provide these, the next session will guess — and guesses compound into bugs.

## When to Consult This Skill

| Trigger | Section |
|---|---|
| About to write a new module / file / exported function | `references/jsdoc-as-context.md` + `references/naming-as-index.md` |
| Data comes in from HTTP / IPC / LLM / DB / env / config | `references/zod-as-ssot.md` |
| About to `throw new Error("...")` | `references/typed-errors.md` |
| Multiple boolean flags describe a state | `references/state-as-data.md` |
| About to write `console.log` / `console.error` | `references/observability-as-code.md` |
| The code looks weird but is correct — a future session will "fix" it | `references/resumability.md` |
| Reviewer scanning for AI-specific footguns | `references/ai-anti-patterns.md` |
| Tempted to extract an abstraction "for future flexibility" | `references/ai-anti-patterns.md` §"Premature Abstraction" |

## References

| File | Theme | Read when |
|------|-------|-----------|
| `references/jsdoc-as-context.md` | JSDoc is the AI's primary context anchor in `.ts` files | Creating any exported symbol; revising a module's public API |
| `references/zod-as-ssot.md` | Zod schema is the single source of truth; types derive from schema | Any data crosses an untrusted boundary; defining DTOs, env, IPC payloads |
| `references/typed-errors.md` | Errors carry classification + context payload, not just a message | Designing the error model for a module; about to `throw new Error("...")` |
| `references/error-handling-strategy.md` | Cross-cutting error policy: 3-axis classification, boundary translation, retry/circuit-breaker | Designing the module's error policy (not a single throw) |
| `references/naming-as-index.md` | Names are LSP/grep keys, not labels | Naming a function, file, module, branded type, or domain concept |
| `references/state-as-data.md` | Discriminated unions and typestate over boolean flags | Modeling lifecycle, workflows, async result states, machine state |
| `references/observability-as-code.md` | Logs and spans are first-class, not afterthought | Adding logging; choosing what to instrument; deciding error context shape |
| `references/resumability.md` | Code must survive the next session that has no memory | Writing non-obvious code; encoding a hard-won design decision |
| `references/design-principles.md` | SoC, SOLID, DDD (value objects/aggregates/events), composition over inheritance, Repository pattern | Structuring a new module / choosing between patterns / boundary design |
| `references/backend-layering.md` | Layer architecture, dependency direction, API Zod, ORM at repo edge, graceful shutdown | Writing handlers/services/repositories or designing data flow |
| `references/security-essentials.md` | Secret management — env vars, no hardcoded keys | Touching `process.env`, credentials, API keys |
| `references/coding-fundamentals.md` | Language-agnostic baseline: immutability (CRITICAL), file organization, file/function size, code quality gates | Always — reference this with `typescript-conventions.md` |
| `references/typescript-conventions.md` | TS/JS specifics: strict mode, no `any`, named exports, no enum (use `as const`), no barrel files, early returns, no `console.log` in production, function/file size limits | When writing `.ts` / `.tsx` / `.js` / `.jsx` |
| `references/ai-anti-patterns.md` | AI agents reliably write these; reviewers grep for them | Reviewing your own code before commit; reviewing a subagent's output |

## ⛔ Pre-Commit Checklist (subagent runs before reporting task done)

Each item is **grep-verifiable** or **type-verifiable** — not subjective.

### 1. Module header
- [ ] File begins with a module-level docstring stating: **purpose (1 sentence), public surface, invariants, side-effect class** (pure / IO / stateful). See `references/jsdoc-as-context.md`.

### 2. Exported symbols documented
- [ ] Every `export function` / `export class` / `export const` (non-trivial) has JSDoc with `@param` / `@returns` / `@throws` / `@example` when applicable.
- [ ] Grep: `grep -c '^export ' <file>` vs `grep -B1 '^export ' <file> | grep -c '\*/'` — counts must match (every export has a closing JSDoc block above it).

### 3. Boundary data validated
- [ ] All `JSON.parse(...)`, `process.env.X`, `req.body`, IPC payload, LLM JSON output → flows through a `*.parse(...)` Zod call. See `references/zod-as-ssot.md`.
- [ ] Grep: `grep -n 'JSON.parse\|process\.env\.' <file>` — each hit traceable to a Zod parse within 5 lines.

### 4. Types derive from schema
- [ ] No `interface Foo` AND `const FooSchema = z.object({...})` coexisting for the same shape.
- [ ] Grep: `interface <Name>` and `<Name>Schema = z.object` for the same `<Name>` → MUST NOT both exist; use `type <Name> = z.infer<typeof <Name>Schema>`.

### 5. Errors are typed values
- [ ] No bare `throw new Error("...")` in `src/` (allowed only in tests, scripts).
- [ ] Each `throw` uses a named subclass with a `context` payload (`field`, `value`, `reason`, `cause`). See `references/typed-errors.md`.
- [ ] Grep: `grep -n 'throw new Error(' src/` → expect 0 hits in non-test code.

### 6. No silent fallback
- [ ] `?? <default>` only on **truly optional** fields. Required fields → fail loud.
- [ ] No `catch { return null }` / `catch (e) {}` / `catch { return [] }`.
- [ ] Grep: `grep -nE 'catch[^{]*\{\s*(return|\})' <file>` → each hit reviewed.

### 7. State is discriminated, not boolean-bagged
- [ ] If 3+ booleans describe the same state machine → MUST be a discriminated union. See `references/state-as-data.md`.
- [ ] Pattern matches MUST be exhaustive (compile-time `never` check on the default branch).

### 8. Naming is grep-friendly
- [ ] No abbreviations in exported symbols (`usr` → `user`, `ctx` allowed only in narrow scopes, `mgr` forbidden).
- [ ] CQS verb on the symbol: `get*` / `find*` / `is*` / `has*` (query, no observable side effects) vs `create*` / `update*` / `delete*` / `send*` / `sync*` (command, mutates or IO). See `references/naming-as-index.md`.

### 9. Observability is wired
- [ ] No `console.log` / `console.error` in `src/` (allowed in CLI entrypoints with `// CLI surface` marker).
- [ ] Errors logged with structured payload (`logger.error({ err, ...context })`, NOT `logger.error(\`failed: ${err}\`)`).

### 10. Non-obvious code carries a why-comment
- [ ] Any line that a future session would plausibly "simplify" but must NOT — has a `// reason:` comment AND links to ADR / issue / spec. See `references/resumability.md`.

### 11. No TODO / FIXME / "later"
- [ ] Grep: `grep -nE '(TODO|FIXME|XXX|HACK)' <file>` → expect 0 hits. If found: either complete the work or open a tracked issue and use a typed `@deprecated` / `// pending: <ADR-XXX>` instead.

### 12. AI-specific anti-pattern scan
- [ ] Run the scan from `references/ai-anti-patterns.md` §"Audit Commands". Expected: 0 hits across all 8 categories.

## Triggers — when this skill MUST be in context

- An implementer subagent is dispatched to write or modify **business-logic** source code (not tests, not config, not docs).
- A reviewer subagent is doing a non-test code review.
- Main agent is about to perform a `git commit` of source code changes — final gate.

## When this skill does NOT apply

- Tests (use `~/.claude/skills/test/`).
- Configuration (`.json` / `.yaml` / `.toml`) — naming and validation conventions still apply but no JSDoc / observability section.
- Throwaway scripts in `scripts/` or `tools/` — relaxed JSDoc, but typed errors and Zod for external input still apply.
- Generated code (`*.gen.ts`, `*.pb.ts`) — exempt from JSDoc, naming, anti-pattern checks.

## Trigger Checkpoints — STOP and consult

| About to do | Stop and check |
|---|---|
| Write `interface Foo { ... }` for data crossing a boundary | Should this be `const FooSchema = z.object(...)` first? — `zod-as-ssot.md` |
| Write `throw new Error("X failed")` | What's the typed error class + context payload? — `typed-errors.md` |
| Add `isLoading: boolean` + `hasError: boolean` + `data: T \| null` | Promote to `type State = Loading \| Success \| Error` — `state-as-data.md` |
| Add `console.log("debug:", x)` | Use structured logger; what's the event name + payload? — `observability-as-code.md` |
| Name a function `process` / `handle` / `doStuff` / `manage` | Reach for a CQS verb — `naming-as-index.md` |
| Write a workaround / non-obvious line | Add `// reason: <why> — see ADR-XXX` — `resumability.md` |
| Extract a generic abstraction after 1-2 use sites | Wait for Rule of Three — `ai-anti-patterns.md` §"Premature Abstraction" |
| Write code without JSDoc because "it's obvious" | Next session won't have your context — write the JSDoc — `jsdoc-as-context.md` |

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "JSDoc is verbose, the code is self-documenting" | "Self-documenting code" assumes the reader has your context. The next AI session does not. JSDoc costs 30 seconds. |
> | "Zod parsing is overhead, this data is internal" | Internal today, exposed tomorrow. The cost of one `parse` is dwarfed by one corrupted-state bug. |
> | "A typed error class is overkill for this one throw" | The one throw is what the next session will catch and silently swallow. Name it, payload it. |
> | "The boolean flags are clearer than a union here" | Booleans permit impossible states. The compiler should reject them, not your eyes. |
> | "I'll add observability when something breaks" | When something breaks, you have no log to read. Instrument now. |
> | "This is a one-off, the abstraction will hurt" | Then don't extract one. Three call sites of slightly-duplicated code beat one wrong abstraction. |
