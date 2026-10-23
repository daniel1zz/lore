---
id: ADR-055
type: adr
role: decision
title: "Facts live once next to what they describe, corpus changes ride with their branch, and enforcement sits at the merge point"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
## Context

On 2026-10-19 one orchestrator session plus two peer sessions landed about 108 branches on main through `lore integrate`. The work finished, but most of the orchestrator's effort went to hand work after each agent returned, and several correctness failures were caught by chance rather than by a mechanism. Measured on that day:

- Almost every branch failed its first integrate on `check:baseline-coverage`; the orchestrator mapped sites by hand. One function rename (`resolveDoc` to `lookupDoc`) needed its mapping copied onto 115 leaves. The live corpus holds 26,934 site-map rows over 1,429 unique sites; 11,560 rows are `owned-by` copies and 609 of those 661 sites already carry a direct rule elsewhere. 60 sites are a direct rule on one leaf and `infrastructure` on another.
- Main went red for every session three times because corpus rows (site mappings, a rule retirement) were removed before the branch that removes the code landed. The corpus is one shared, unbranched store; code is branched.
- Splitting a spec dropped its rule changes; an audit found 46 rules that would describe old behaviour once their fixes landed. No record says which code sites enforce a rule, so a rule's text can change without any code in view.
- Three tests were red on main and found only by accident: the integrate floor runs no test suite.
- Whole-file anchor locks on hot files (`app.ts`, `tools.ts`) and a directory anchor on `tests/integration/` serialised six tasks; about five implementers edited files through shell commands the edit-time hook cannot see.
- Several `lore done` refusals surfaced only at the end (an anchored test file without an unfiltered runner pass), each needing a round trip to the worktree.
- Silent fallbacks were found by accident: an unparsable project config ignored wholesale (about 109 tests silently ran with gates on), a malformed sync section running on the local file, a schema migration triggered by an unknown first command, a store CAS check trusting a stale row count.
- Acceptance criteria were approved that did not match reality (a wrong exit code; a flag that does not exist, so the test passes trivially).

## Decision

Four root causes, four end-state designs. Each removes a class of failure by construction; none adds a check on top of the old design.

D1. Facts are stored once, next to what they describe. A refusal site's rule (or its non-business class) is declared in code at the site, not in per-leaf corpus rows. Leaf completeness is derived: every site a leaf's commands reach must carry exactly one declaration, and a cited rule must be live anywhere in the tree. The rule-to-site index is computed from code, so a rule's enforcing sites are always visible, move with renames and branches, and merge through git. The corpus keeps what only it can express: rules, leaves, their declared commands and the tree.

D2. Corpus changes ride with the branch that needs them. A corpus write made under a claim from a linked worktree is recorded as that branch's pending change set; reads in that worktree see main plus the change set; `lore integrate` lands code and change set as one unit, and the floor judges main + code + change set. A change can no longer reach the shared corpus before or after the code it describes.

D3. Enforcement sits at the merge point, judged on artifacts; tool-call hooks are early feedback. Integrate judges the branch's actual diff (files and symbols touched against its claims), whatever tool produced it. Concurrent edits are optimistic: the edit hook warns when another live branch touched the same symbol and refuses only a write into a file another live claim holds exclusively. Tests run hermetically and incrementally: each test's declared inputs (`@reads`) are hashed and its result reused when unchanged, so every landing is judged as if the full suite ran. Landings go through a queue that may batch branches under one floor and bisects on failure; it runs `lore done` after a landing. A task's definition of done (the evidence each floor will demand) is computed when it is created, so an implementer meets it while working instead of discovering it at archive time. No worktree may hold `main` checked out.

D4. Contracts are checked against reality before approval. A script criterion must run red on main before its spec can be approved, and every CLI flag it names must parse against the command's help. Silent fallbacks become a structural census like refusal sites: every place that substitutes a default for a failure (a catch returning a default, a `?? {}` on a loaded config) must declare the rule that allows it, or the floor fails.

Order of work: D1, then D3, then D2, then D4. D1 removes the largest recurring cost and is the base for D2 (fewer corpus facts need to ride with branches) and D4 (the rule-to-site index). D3 removes serialisation and hidden red tests. D2 is the largest change and gets its own spec after D1 lands.

## Consequences

- `extra.site_map`, the `owned-by` grammar, `lore baseline map --site/--sites-file`, the site parts of the main-tree removal guard and the debt-ledger data are retired once D1 lands; a one-time converter writes the existing mappings into code and resolves the 60 conflicting sites and 30 doubled-prefix rows explicitly.
- `LoreError` gains an optional rule reference; the eight local `validationError` copies become one helper that carries it. Call-point sites (injected ports, interface methods: about 370 of 1,429) are declared once on the port or interface, not per call.
- Rule edits show their enforcing sites; a guaranteed rule with no enforcing site is reported.
- `lore integrate` and the floor change shape (diff judgement, incremental tests, queue); the per-session serial integrate and the main agent as the landing loop go away.
- Branch-scoped corpus writes (D2) change what a worktree sees; tooling that reads the shared corpus from a worktree must read through the change-set view.
- Superseded by this decision where they conflict: the per-leaf site map in `adr-mapping-a-census-site-does-not-demote-a-baseline-leaf-an`, and the per-session serial landing in `adr-main-advances-only-by-lore-integrate-per-session` (main still advances only by integrate).
