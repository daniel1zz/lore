---
id: TASK-523
type: task
role: plan
title: "T5 compiled e2e suite proving every surface from a throwaway corpus and install dir"
status: archived
priority: medium
phase: "P3 governance and distribution"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-101
plan: PLAN-101
---
Author the compiled e2e suite, and regenerate the embedded assets manifest (moved here from T4: T2 and T4 both edited assets/ concurrently, so only a task running after both can regenerate a digest covering both).

Test names, matched by the ACs -t filters, each UNIQUE within the file:

- "framing line" (AC-CP-10, which REPLACED the retired AC-CP-3) — the framing line is served by the governance verb, NOT by --injection stdout. Assert: (a) lore governance bootstrap-framing stdout equals BOOTSTRAP_FRAMING_LINE by identity, (b) lore bootstrap --injection stdout is bare compact JSON that JSON.parse accepts with NO splitting, per SPEC-080 AC-080-3, (c) the hook composes the framing line OUTSIDE the markdown fence with the JSON inside it, (d) both retired strings ("## Lore Bootstrap (hook-injected)" and "Corpus pointer set") return zero literal hits in assets/hooks/session-start-resume.mjs. T2 already covers the governance verb itself in tests/e2e/governance-bootstrap-framing-compiled.bun.test.ts — do not duplicate that; your job here is the END-TO-END composition (verb + injection + hook render shape together).

- "scope closure" (AC-CP-4) — RESUME_SCOPE_CLOSURE appears verbatim on BOTH the CLI stdout and the MCP lore_feed session-resume response; iterate BOOTSTRAP_INJECTION_KNOWN_KEYS asserting the constant names each member.

- "governance rule" (AC-CP-9, which REPLACED the retired AC-CP-5) — iterate BOOTSTRAP_INJECTION_KNOWN_KEYS EXCEPT resume_hint, asserting the lore governance FEED text names each; iterate SOURCE_CATEGORY_TOKENS the same way; PLUS a paired assertion that resume_hint still has zero literal occurrences in assets/governance/corpus-workflow.md. The exclusion is MANDATORY: spec-session-start-handoff-neutrality enforces that zero-occurrence invariant, so an unconditional ten-key iteration is unsatisfiable. The paired assertion prevents the carve-out from silently widening to a second key.

- "fresh install" (AC-CP-6) — mkdtemp corpus under the OS temp root (OUTSIDE this repo tree) with cwd inside it; assert the resolved corpus root is that temp path and never the repo .lore; assert both boundary declarations match their exported constants by identity.

- "manifest parity" (AC-CP-7) — run lore setup against a throwaway --claude-dir, then byte-compare each edited asset (assets/hooks/session-start-resume.mjs, assets/governance/corpus-workflow.md) against its freshly INSTALLED copy read back from that dir. Storage parity is not distribution; the oracle is the installed file.

Requires bun run build first — these spawn dist/lore.
