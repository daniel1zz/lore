---
id: TASK-662
type: task
role: plan
title: "Add the gitignored .scratch probe namespace asserted from both sides, and a checkout-level oracle mutex that fails loud at exit 5 and reclaims a stale lock"
status: archived
priority: high
phase: "isolation"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-124
plan: PLAN-124
---
AC-OX-3 / AC-OX-4, D4 / D5 / D6. There is no probe namespace and no concurrency guard: two concurrent full-suite runs were measured interleaving in this checkout, and a peer's non-gitignored broken probe produced a FALSE typecheck failure. Add .scratch/ to .gitignore (it already sits outside every tsconfig include glob) and assert it from both sides: a broken probe inside .scratch leaves bun run typecheck at exit 0, the byte-identical probe inside a typechecked glob drives it to exit EXACTLY 1 with that filename in the output. Pinning 1-and-named is what separates a detected compile error (TS2322 / TS1136, both exit 1, measured 2026-08-11) from a TS18003 config fatal at exit 2 where nothing was checked. Then build scripts/oracle-lock.ts with an exported main(root) returning an exit code and never calling process.exit (match the armable shape of scripts/check-ordinal-write-sites.mjs): uncontended 0, live-holder contention EXACTLY 5 printing the holder pid, and a lock naming a pid the test itself spawned and REAPED gets reclaimed to 0. Never guess an unused pid. Wire it onto the test script in package.json. The reverse control uses a unique per-run filename and cleans up in a finally block.
