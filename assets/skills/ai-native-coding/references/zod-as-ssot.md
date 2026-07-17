# Zod as Single Source of Truth

> Schemas come first. Types derive from schemas. There is one definition per shape — never two.

## Why this matters

The dual-source bug: a developer writes `interface User { ... }` for type safety AND `const UserSchema = z.object({ ... })` for runtime validation. Over time, one drifts from the other. A field is added to the interface but not the schema, or vice versa. The compiler is happy. The runtime validates the *old* shape. Production breaks.

For human developers, dual-source is a slow leak — caught eventually in review. For an AI agent making changes across sessions, dual-source is a **fast leak**: the agent reads one source, edits it, has no memory that the other source exists, and ships the drift in a single commit.

The fix is structural: **the schema is the only definition of a shape; the type is a one-line derivation.**

## ⛔ Core rules

1. **Schema first**: when a shape is being defined, write the Zod schema first; derive the type via `z.infer`.
2. **No dual definitions**: for any shape that has a Zod schema, there MUST NOT be a hand-written `interface` or `type` alias with the same shape.
3. **Parse at boundaries**: every byte of data crossing into your code from an untrusted source MUST flow through `schema.parse(...)` or `schema.safeParse(...)`.
4. **Trust nothing from `JSON.parse`**: the return type is `any` by definition. Always parse the result.
5. **Trust nothing from `process.env`**: env values are `string | undefined` regardless of what your config expects.

## The canonical pattern

```typescript
// ✅ Schema is the source. Type is derived.
import { z } from 'zod'

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.coerce.date(),
  role: z.enum(['admin', 'member', 'viewer']),
})

export type User = z.infer<typeof UserSchema>

// Boundary parse
export function parseUser(raw: unknown): User {
  return UserSchema.parse(raw)
}
```

The next session opens this file and sees in 10 seconds:
- The shape (one block).
- The constraints (Zod chain — `uuid`, `email`).
- The boundary parser.
- The exported type.

No dual sources. No drift possible.

## The boundary checklist — every entry point MUST parse

| Boundary | What to parse | Schema pattern |
|---|---|---|
| HTTP request body | `req.body` | `RequestBodySchema.parse(req.body)` in handler |
| HTTP query params | `req.query` | `QuerySchema.parse(req.query)` — note Zod will coerce strings |
| HTTP path params | `req.params` | `ParamsSchema.parse(req.params)` |
| Tauri IPC payload | `command(payload: unknown)` | `PayloadSchema.parse(payload)` on entry |
| WebSocket message | `JSON.parse(msg)` | `MsgSchema.parse(JSON.parse(msg))` |
| LLM JSON output | `JSON.parse(response.content)` | `OutputSchema.parse(JSON.parse(...))` — see `llm-output` below |
| Env vars | `process.env` | `EnvSchema.parse(process.env)` at boot, exported as `env` |
| Config files | `JSON.parse(fs.readFileSync(...))` | `ConfigSchema.parse(...)` at boot |
| DB row | ORM query result | `RowSchema.parse(row)` at the repository boundary (defensive) |
| Third-party API response | `await res.json()` | `ExternalSchema.parse(json)` |
| File contents (YAML/JSON/TOML) | parsed value | `Schema.parse(parsed)` |
| Cross-process / cross-tab message | `event.data` | `MsgSchema.parse(event.data)` |

The grep oracle: every `JSON.parse(...)`, `req.body`, `process.env.`, IPC entry function, `fetch(...).json()`, and `readFileSync(...)` should be followed within ~5 lines by a `.parse(...)` call.

```bash
grep -nE '(JSON\.parse|req\.body|process\.env\.[A-Z]|readFileSync|\.json\(\))' src/
# Each hit MUST have a Zod parse nearby.
```

## Env vars — special discipline

Boot-time env parse is one of the highest-leverage uses of Zod. Do it once, export a typed object, never read `process.env` directly anywhere else.

```typescript
// src/env.ts
import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // No defaults for required secrets — fail loud at boot if missing
  STRIPE_SECRET_KEY: z.string().min(1),
})

export const env = EnvSchema.parse(process.env)
export type Env = z.infer<typeof EnvSchema>
```

Now anywhere in the codebase, `env.DATABASE_URL` is `string`, not `string | undefined`. A typo (`env.DATBASE_URL`) is a compile error. Missing required var = boot-time crash with a Zod error pointing exactly at the problem.

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "I'll just read `process.env.X` here, it's quick" | One day `X` will be missing or empty and a runtime `undefined` will silently break a downstream check. Centralize and parse once. |

## LLM JSON output — Zod is mandatory

LLMs are statistically reliable but not deterministic. JSON returned from `response_format: json_object` or `tool_use` MUST be parsed.

```typescript
const ClassificationSchema = z.object({
  intent: z.enum(['greeting', 'question', 'request', 'other']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(500),
})
export type Classification = z.infer<typeof ClassificationSchema>

export async function classifyIntent(message: string): Promise<Classification> {
  const raw = await llm.complete({ ..., response_format: 'json_object' })
  return ClassificationSchema.parse(JSON.parse(raw.content))
  //                                 ^ parse may throw if the LLM returned malformed JSON
  //                                   — that's correct; surface it, don't swallow.
}
```

For LLM output, prefer `safeParse` only when you want to retry on validation failure — never to silently fall back to a "default" classification.

```typescript
// ✅ Retry with feedback if the LLM violated the schema
const result = ClassificationSchema.safeParse(JSON.parse(raw.content))
if (!result.success) {
  throw new LlmSchemaViolationError({
    schema: 'ClassificationSchema',
    issues: result.error.issues,
    raw: raw.content,
  })
  // The catch above this can decide to retry with a "fix your output" prompt.
}
return result.data
```

## Internal data — what about the inside of the system?

Zod is for **untrusted** data. Inside a well-typed module, data is already validated; re-parsing on every internal call wastes cycles.

Rule of thumb:

| Source | Parse? |
|---|---|
| User input, network response, file, env, DB read | ⛔ Parse |
| LLM output | ⛔ Parse |
| Cross-process / cross-thread / cross-tab message | ⛔ Parse |
| Function call within the same compiled module | ✅ Trust the types |
| Repository → domain (you just parsed at the repo edge) | ✅ Trust |
| Test fixture you constructed in-process | ✅ Trust |

Anti-pattern: defensive `schema.parse` on every internal function entry. This is type system distrust and indicates a deeper problem (probably `as` casts somewhere upstream).

## ❌ Bad — dual sources

```typescript
// Two definitions, will drift.
interface User {
  id: string
  email: string
  role: 'admin' | 'member'
}

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(['admin', 'member']),
  // someone added 'viewer' here but forgot the interface
})
```

## ✅ Good — single source

```typescript
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
})
export type User = z.infer<typeof UserSchema>
```

## ❌ Bad — trusting `JSON.parse`

```typescript
const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'))
// config is `any` — every downstream access is unchecked
startServer(config.port, config.host)  // What if port is missing? a string? -1?
```

## ✅ Good — parse at the read

```typescript
const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  host: z.string().min(1),
  ssl: z.boolean().default(false),
})

const config = ConfigSchema.parse(
  JSON.parse(fs.readFileSync('config.json', 'utf-8'))
)
// config is fully typed; missing/wrong fields throw at boot, not at request time
```

## ❌ Bad — `safeParse` to silent fallback

```typescript
const result = UserSchema.safeParse(input)
if (!result.success) {
  return null  // silent fallback — the validation error is lost
}
return result.data
```

The next session sees `null` returned from a "valid" path and writes a downstream branch that handles "not found" — but the bug is actually a schema mismatch.

## ✅ Good — `safeParse` with structured failure

```typescript
const result = UserSchema.safeParse(input)
if (!result.success) {
  throw new InvalidUserPayloadError({
    issues: result.error.issues,
    receivedKeys: Object.keys(input as object),
  })
}
return result.data
```

Now the catch site has a typed error with diagnostic context. See `typed-errors.md`.

## Schema composition

Schemas compose like types do — prefer composition over duplication.

```typescript
const BaseEntitySchema = z.object({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const UserSchema = BaseEntitySchema.extend({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
})

export const CreateUserSchema = UserSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})

export const UpdateUserSchema = CreateUserSchema.partial()

export type User = z.infer<typeof UserSchema>
export type CreateUser = z.infer<typeof CreateUserSchema>
export type UpdateUser = z.infer<typeof UpdateUserSchema>
```

The shape lives in one place; CRUD variants are mechanical derivations.

## Discriminated unions — Zod's superpower

```typescript
const SuccessSchema = z.object({
  kind: z.literal('success'),
  data: z.unknown(),
})

const ErrorSchema = z.object({
  kind: z.literal('error'),
  code: z.string(),
  message: z.string(),
})

export const ResultSchema = z.discriminatedUnion('kind', [
  SuccessSchema,
  ErrorSchema,
])
export type Result = z.infer<typeof ResultSchema>
```

This pairs with `state-as-data.md` — when state is a discriminated union AND the runtime validator IS the type, illegal state cannot enter the system or be constructed by code.

## Branded types from Zod

```typescript
export const UserIdSchema = z
  .string()
  .uuid()
  .brand<'UserId'>()

export type UserId = z.infer<typeof UserIdSchema>  // string & z.BRAND<'UserId'>

export const parseUserId = (s: string): UserId => UserIdSchema.parse(s)
```

Now `function getUser(id: UserId): User` cannot accept a raw `string` — the only way to construct a `UserId` is through `parseUserId`, which validates UUID format.

## Repository pattern — parse at the read edge (defensive option)

Even when the DB has constraints, schemas drift (ALTER TABLE, ORM type generation lag). A defensive parse at the repository boundary catches drift before it propagates.

```typescript
const UserRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
  created_at: z.coerce.date(),
})

export async function findUserById(id: UserId): Promise<User | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!row) return null
  return UserRowSchema.parse(row)
  //     ^ if a DB migration adds 'manager' to role but UserRowSchema doesn't know,
  //       this throws here, at the repository, not 7 layers up in the controller.
}
```

This is optional — `SHOULD` for high-stakes domains (finance, auth), `MAY` elsewhere. Cost is ~microseconds per row; payoff is catching schema drift at the source.

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| `interface Foo` for data that crosses any boundary | Write `FooSchema = z.object(...)` instead; derive type. |
| `JSON.parse(x)` | Where is the schema? Parse the result. |
| `process.env.SOMETHING` | Is it in `env.ts`? Add it. Never read `process.env.X` outside the central parser. |
| Receive an LLM JSON output | Define a schema. Parse it. No exceptions. |
| Define a DTO for a REST endpoint | Schema first, type derived. |
| Two definitions exist for the same shape | Delete one. Schema wins. |

## When in doubt

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "This data is internal, I trust it" | "Internal" today, exposed to a webhook tomorrow. The cost of one `z.object` is zero compared to one corrupted-state bug. |
> | "The TS type is enough — the API is typed" | Types are erased at runtime. The wire is bytes. A `string` field can contain `null` because the producer changed and the type lied. |
> | "`safeParse` returning null is fine, I'll handle null downstream" | The downstream null handler now serves two semantically distinct cases: "absent" and "malformed." That conflation is a bug factory. |
> | "Defining a schema is extra code" | Schema + `z.infer` = ONE definition. Interface + manual validation = two definitions and drift. Schema wins on character count. |
> | "Zod is slow" | Parse a 50-field object in <50µs. Compared to a network round-trip, this is free. |
