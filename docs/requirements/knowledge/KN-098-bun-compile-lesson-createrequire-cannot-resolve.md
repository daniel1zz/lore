---
id: KN-098
type: knowledge
role: knowledge
title: "bun compile lesson: createRequire cannot resolve packages from bunfs — lazy-load via static-specifier dynamic import; always e2e the compiled artifact outside the repo"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: [spec-068, bun-compile, dogfood, oracle-pattern]
parent: SPEC-089
links:
  - {id: SPEC-089, type: informs}
---
SPEC-068 hotfix lesson (2026-07-23). (1) Inside a bun build --compile binary, createRequire(import.meta.url)(pkg) fails at runtime — the bunfs virtual root (/$bunfs/root) cannot resolve node packages, and no cwd node_modules rescues it. Lazy-loading MUST use await import("pkg") with a STATIC string literal specifier: the bundler inlines it (probe: 29ms load compiled vs 978ms source-mode top-level import), laziness is preserved, and it works in both source and compiled modes. Never a template/variable specifier (not statically analyzable, silently unbundled). (2) Generalized oracle pattern (now pinned as AC-068-10 / packages/lore/tests/integration/cli/slugify-compiled.bun.test.ts): any feature whose runtime behavior can diverge between source mode and the compiled artifact needs an e2e that runs dist/lore FROM A CWD OUTSIDE THE REPO (mkdtemp, no node_modules reachable) — 9 source-mode ACs were green while the production form was completely broken; exit-code-true != measured-the-right-thing strikes again, this time as measured-the-wrong-runtime-form. (3) The failure was found only by a post-merge manual smoke in a throwaway corpus — cheap final smoke tests of the shipped artifact remain worth the 30 seconds even after full AC green.
