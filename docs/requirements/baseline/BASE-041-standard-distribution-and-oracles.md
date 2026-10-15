---
id: BASE-041
type: baseline
role: intent
title: "Standard: distribution and oracles"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-094
links:
  - {id: SPEC-096, type: supersedes}
---
# Standard: distribution and oracles

Rules for what reaches consumer projects and for the oracles lore relies on to judge its own corpus.

Each rule is an AS-n in four parts. The rule records (`extra.rules`) are the source of truth; the section below renders them as stored on 2026-10-11 so a reader of this body sees all four parts. Edit rules with `lore rule set`, then re-render.

## AS-15: Anything meant for consumer projects ships through a delivery surface: the vendored assets/ tree plus the embedded assets manifest, or binary-side output; a change that exists only in this repo's files or this machine's ~/.claude has not shipped.

- Confidence: established; enforced by: both; lifecycle: live
- **Current Reality**: packages/lore/src/generated/assets-manifest.ts is generated from assets/ by scripts/embed-assets-manifest.mjs (--check verifies freshness) and compiled into dist/lore by scripts/build.ts; packages/lore/tests/unit/assets-ssot.test.ts checks the manifest against assets/ in both directions; lore setup --check compares installs against it. Naming the surface for each improvement is held by adr-distribution-first-every-improvement-names-its-consumer.
- **Target Rule**: Same as today: every consumer-facing change lands in assets/ (manifest regenerated) or in binary output.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed.
- **Examples**:
  - A new skill is added under assets/skills/ and the manifest is regenerated with scripts/embed-assets-manifest.mjs.
  - Editing only ~/.claude/skills/lore/SKILL.md on one machine is not a landed improvement.

## AS-16: Every shipped command works from the compiled binary, not only from a source checkout.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: Every shipped command runs from the compiled binary. The completeness census, the last command that needed a source checkout, now runs from dist/lore: packages/lore/src/service/site-census.ts:146 loads the compiler with a literal require("typescript") that bun build --compile embeds (issue #58 fixed 2026-10-10). packages/lore/tests/integration/cli/compiled-census.bun.test.ts runs lore baseline sites and coverage from dist/lore (AC-BLC-4); no test runs every other command from the binary, so the rule as a whole is held by prompt.
- **Target Rule**: Any command listed in lore --help runs from the compiled binary with the same result as from source.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None remaining for the census; issue #131 tracks the ~50 ms startup cost the embedded compiler adds.
- **Examples**:
  - lore baseline coverage run from dist/lore gives the same answer as from bun run dev.
  - A command needing a dev-only package (typescript) at runtime must bundle it or refuse with a named, documented reason.

## AS-17: A completeness or fidelity oracle never reports complete or faithful over what it could not see: anything it skipped is counted and named in its output.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: The fidelity judge now reads the source of every test file a cited criterion's command names and counts a criterion with an unreadable test file as not_seen, never faithful or wrong (packages/lore/src/service/fidelity-sample.ts:17-21 and :493; issue #117 fixed, AC-BLC-8). The site census still reports complete over material it did not see: it stops descending at MAX_CALL_DEPTH = 12 (packages/lore/src/service/site-census.ts:74, :656) without reporting the cut (AD-1), and an injected property call is followed only to the bindings implementationsBehindReceiver can see (site-census.ts:655-657, :701), so a second binding made by an assignment, untyped literal or spread is missed (AD-2).
- **Target Rule**: Each completeness or fidelity verdict carries what was not examined, and a verdict over unexamined material is never 'complete' or 'faithful'.
- **Current Exceptions**: AD-1, AD-2
- **Migration**: Issues #112 (report or remove the depth cut-off) and #118 (follow every possible binding or report the ambiguity) close AD-1 and AD-2. Issue #117 (the fidelity judge's view of test code) is closed.
- **Examples**:
  - If the census stops at a call depth limit, it reports the truncated call chains rather than 0 gaps.
  - A fidelity verdict on a citation states whether the cited test's code was examined.
