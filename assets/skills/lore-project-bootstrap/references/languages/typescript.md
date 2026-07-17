# TypeScript Conventions

## Strict Mode
- `strict: true` in tsconfig.json — no exceptions
- `noUncheckedIndexedAccess: true` for safe array/object access
- Prefer `unknown` over `any`; `any` requires justification comment

## Immutability
- `as const` for literal types
- `readonly` on all interface properties by default
- Spread (`{ ...obj, key: newVal }`) over mutation
- `ReadonlyArray<T>` for arrays that shouldn't be modified

## Data Boundaries
- Zod schemas at all system boundaries (API input, env vars, external data)
- Derive TypeScript types from Zod: `type X = z.infer<typeof XSchema>`
- Internal code trusts types — no runtime validation inside domain layer

## Error Handling
- Custom error classes extending `Error` for domain errors
- `Result<T, E>` pattern for expected failures (no throw for business logic)
- `try/catch` only at system boundaries (API handlers, CLI entry points)
- Never swallow errors: `catch(e) { /* empty */ }` is forbidden

## Import Conventions
- Path aliases (`@/` or `~/`) over relative paths deeper than 2 levels
- Barrel exports (`index.ts`) only at module boundary, not per-directory
- Type-only imports: `import type { X } from './y'`

## Naming
- `camelCase` for variables/functions, `PascalCase` for types/classes/components
- `UPPER_SNAKE_CASE` for constants
- Boolean variables: `is/has/should/can` prefix
- Async functions: no `-Async` suffix (TypeScript types make it obvious)

## File Organization
- One exported concept per file (component, hook, utility, type)
- Co-locate tests: `foo.ts` + `foo.test.ts` in same directory
- Max 400 lines typical, 800 absolute max

## CLAUDE.md Section Template

```markdown
## TypeScript
- strict: true + noUncheckedIndexedAccess
- Zod at system boundaries, derive types with z.infer
- Immutable by default: readonly props, spread over mutation, as const
- Result pattern for domain errors, try/catch only at boundaries
- Path aliases (@/) over deep relative imports
- Type-only imports for pure type references
```
