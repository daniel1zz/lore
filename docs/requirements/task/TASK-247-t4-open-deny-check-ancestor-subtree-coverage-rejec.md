---
id: TASK-247
type: task
role: plan
title: "T4 (open) — deny-check ancestor-subtree coverage: reject patches touching a protected subtree root"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-21
tags: []
parent: PLAN-062
plan: PLAN-062
---
# T4 — deny-check ancestor-subtree coverage

## Problem

`findDeniedConfigKeys` (`packages/core/src/config-editability.ts`) matches a patch's LEAF dotted-paths against `CONFIG_DENY_KEYS` with EXACT-LENGTH wildcard semantics. A patch that replaces a protected SUBTREE ROOT with a value that has no leaves under it therefore produces a leaf path SHORTER than every deny pattern and is not denied:

- `{ai: {providers: null}}` → leaf `ai.providers` — no match against `ai.providers.*.command`
- `{ai: {providers: {}}}` → leaf `ai.providers` (the empty-object-is-a-leaf branch)
- `{ai: {providers: []}}` → leaf `ai.providers` (arrays are leaves by invariant)
- `{verify: {env: null}}` → leaf `verify.env` — no match against `verify.env.passthrough_all`
- `{ai: null}` → leaf `ai`

Today this is bounded by validate-then-write: the merged result fails the `LoreConfig` Zod schema and 0 bytes are written. So it is **defence-in-depth, not an open hole** — but the deny table is supposed to be the structural guarantee, independent of whatever the schema happens to accept. It becomes a real hole the moment the schema loosens (an optional field, a `.passthrough()`, a union that admits `null`).

## Change

Extend the deny check so a leaf path is denied when it EITHER matches a deny pattern exactly (current behaviour, unchanged) OR is a **proper ancestor** of one — segment-wise, wildcard-aware: path segments must be a strict prefix of the pattern's segments, with a pattern `*` matching any single path segment.

Keep `flattenConfigLeafPaths` semantics untouched — this is a matching change, not a walk change.

## Scope guard (must NOT regress)

Benign sibling patches must still yield exactly 0 denied keys:

- `{ai: {provider: "cli"}}` — `ai.provider` is a different segment from `ai.providers`
- `{ai: {http: {timeout_ms: 1000}}}` — not an ancestor of `ai.http.headers.*`... it IS `ai.http.timeout_ms`, a sibling leaf, not a prefix
- `{workflow: {claim_ttl_minutes: 30}}`
- `{sync: {enabled: true}}`

Note the deliberate consequence to state in the module header: `{ai: null}` and `{verify: null}` are now denied, because wholesale replacement of those subtrees destroys/overrides protected keys. That is the intended widening, not collateral damage.

## Test gap this also closes

`packages/core/src/config-editability.ts` has **no colocated test file** — core tests live beside their source (`packages/core/src/*.test.ts`) and this module's only coverage today is indirect, via `packages/lore/tests/unit/service/config-service.test.ts`. Create `packages/core/src/config-editability.test.ts` with six-dimension coverage over all four exported functions (`findDeniedConfigKeys`, `flattenConfigLeafPaths`, `redactConfigValues`, `classifyConfigEffect`), including BOUNDARY (depth cap, empty object, array-as-leaf) and REGRESSION (existing exact-leaf denials and benign patches unchanged).

## Acceptance

- `AC-062-12` on `spec-spec-062-config-write-layer-configservice-http-surface-and`
- Oracle: `bunx vitest run packages/core/src/config-editability.test.ts`
