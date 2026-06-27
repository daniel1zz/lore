# @lore/dashboard

**Status: placeholder slot.** No implementation yet.

This package is reserved for the future Lore Dashboard — a Vite + React + shadcn SPA
served by `lore serve` for read+write access to the corpus.

See `docs/requirements/spec/SPEC-014-monorepo-skeleton.md` §2.2 for the explicit
non-goals of the monorepo skeleton (which deferred dashboard implementation), and
the future Dashboard SPEC for when it lands.

## Why this exists today

Reserving the package now lets the monorepo skeleton (SPEC-014) commit the boundary
contract — `@lore/dashboard` will depend on `@lore/core` (pure types/errors/schemas)
and call `@lore/lore`'s HTTP API as a client. Sitting alongside `@lore/core` and
`@lore/lore` in `packages/` makes that boundary self-documenting before any code is
written.

## Out of scope (until the Dashboard SPEC lands)

- Vite config
- React / shadcn dependencies
- Any source files (`src/`)
- Build pipeline
- Static asset embedding into `dist/lore` binary
