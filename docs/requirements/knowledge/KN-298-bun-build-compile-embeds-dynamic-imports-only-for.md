---
id: KN-298
type: knowledge
role: knowledge
title: "bun build --compile embeds dynamic imports only for literal specifiers (F5a spike)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-31
tags: [bun, build, embedding, f5a]
parent: SPEC-105
links:
  - {id: KN-098, type: relates-to}
  - {id: SPEC-105, type: informs}
---
# bun build --compile embeds dynamic imports ONLY for literal specifiers

## Finding (empirically probed 2026-07-28, F5a T1 spike)

`bun build --compile` resolves and embeds a dynamic `import()` target **only when the call-site argument is a direct string literal**. A variable or computed specifier — including the idiomatic `await import(pathToFileURL(p).href)` — is invisible to the bundler: the compiled binary carries nothing for it and the import fails at runtime.

Confirmed by three build+run probes, not by reading: the variable-specifier form failed at runtime **even when the target module was additionally listed as a second `Bun.build` entrypoint**; the literal-specifier form succeeded, including after deleting the source tree and moving the binary elsewhere.

Separately confirmed working as documented: `with { type: "file" }` asset embedding survives source deletion and binary relocation, served via `Bun.file(embeddedPath)`.

## Why this bites

The natural way to write a *guarded, optional* dynamic import (so `tsc` never statically resolves a git-ignored generated module) is a variable specifier — which is exactly the form the compiler cannot see. The two goals collide:

- typecheck-safety wants a non-literal specifier;
- compile-time embedding requires a literal one.

## Resolution used in F5a (`packages/lore/src/adapters/http/dashboard-assets-loader.ts`)

Two paths behind one union-returning loader:

- production path: **literal** specifier guarded with `@ts-ignore` — deliberately NOT `@ts-expect-error`, which would itself become an error once the generated file exists after a build;
- test-seam path: keeps the variable specifier (never compiled, only run from source).

Second-order trap found while verifying: `packages/lore/tsconfig.json`'s broad `include` type-checks the generated file even though nothing imports it, and bun-types ships no ambient declarations for `.css` / `.js` `with { type: "file" }` imports. Fix: the generator emits `@ts-ignore` above each generated import line.

Third trap (build-determinism, unrelated to embedding): a content-digest short-circuit computed *before* the dashboard build never matches, because `prebuild` regenerates `routeTree.gen.ts` on every invocation. The stamp digest must be computed **after** the build completes.

## Applies to

Any future single-binary embedding work in this repo (assets, additional generated manifests, plugin bundles). Check this before designing an optional-module loader that must survive `--compile`.
