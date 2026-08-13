---
id: KN-044
type: knowledge
role: knowledge
title: "Retro — SPEC-041 session layer S1+S2 (3-lens review + dual worktree delivery + v6 second live run + export-bug root-cause)"
status: approved
priority: medium
created: 2026-07-10
updated: 2026-07-14
tags: [retro, spec-041, session, instrument]
parent: PLAN-025
---
## Context

Session 2026-07-11 (continuation of the instrument-first bootstrap session): SPEC-041 (session layer S1+S2) designed, 3-lens adversarially reviewed, implemented via two serial worktree agents, verified, and assessed by the v6 instrument — the first full cycle run entirely under the SPEC-040-hardened assessment framework.

## What shipped
- `lore bootstrap` / `lore_bootstrap` — read-only volatile pointer-set (root, active plans + task counts, pending, claims + staleness, armed gates with feeding_source, latest handoffs, resume_hint) for SessionStart hook injection.
- `lore handoff` / `lore_handoff` — typed, draft-first session digests (knowledge sub_type handoff; extra SSOT + deterministic projection; --json-file primary agent path; degraded git-only capture flag); writer-identity guard (attestation-pattern) + presence-check defense-in-depth.
- `lore feed session-resume` — newest-wins/direct-target replay with age + TTL warning, multi-actor surfacing, readiness pointer block.
- Drive-by repairs: CLI knowledge sub-type list → KNOWLEDGE_SUB_TYPES SSOT (pre-existing prompt/skill drift); export-docs phase frontmatter YAML-quoting bug (root-caused from a "pre-existing flake" report — see learnings).

## Learnings (durable)
1. **"Pre-existing failure" reports deserve root-causing, not acceptance.** T1's agent correctly attributed a migration-coverage failure as pre-existing via clean-baseline stash — but the orchestrator tracing it further found OUR OWN same-day export commit had introduced it (unquoted colon-bearing phase frontmatter). Attribution protocols bound blame; they do not locate causes. The dynamic-count e2e test design (fixing the "hardcoded literal bump" anti-pattern two iterations earlier) is what surfaced the bug at all.
2. **Adversarial review again outperformed the judge**: 5 HIGH-class findings pre-approve (forgeable exclusivity precedent, CLI SSOT drift, flag-surface ergonomics, hook-authorship conflation, feed-map mischaracterization) — none of which the 0.82-approve review judgment surfaced. Review depth scales with reviewer count and lens diversity, not judge confidence.
3. **Spec ACs can be wrong about layering**: AC-SL-4 demanded a stderr substring the CLI layer can never produce (the presence check fires before the writer guard — strictly stronger). Fixed the AC to match the actual, better contract with rationale, BEFORE running verify. ACs are contracts, not prophecies; correcting one with evidence is part of the loop.
4. **v6 instrument, second live run**: facts (attested ratio 0.85, per-AC test coverage) cited verbatim in dimension reasoning; scope_fidelity dimension correctly credited disclosed drive-by fixes as "no unexplained drift". The typed output continues to be directly consumable.

## Open items
- AC-SL-8 (human): owner fresh-session zero-re-briefing test — the plan's only unevidenced AC.
- S3 (session registry + file-anchor claim predicate) — next spec in the §15 sequence.
- §16 memory hygiene specs (H1 bi-temporal, H2 staleness probes, H3 drift oracle) — queued after S3.
