---
id: KN-678
type: knowledge
role: knowledge
title: "Retro: template variables for lore-owned context — TDD-pairing deadlock, S3 design reversals, five filed defects"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
links:
  - {id: PLAN-185, type: relates-to}
---
## Context

Session that designed and landed `spec-lore-owned-agent-context-is-generated-from-templates-and` via `plan-generate-lore-owned-agent-context-from-templates-and` (13 tasks, all archived; 8/8 AC-CV attested on main; assessment `knowledge-assessment-generate-lore-owned-agent-context-from`).

## Findings (each with its mechanism root and where it went)

1. **TDD pairing deadlocks against `lore done`** — lore-plan's injected `[Skill:test]` RED task blocks its impl task; readiness needs every blocker archived; `lore done` needs an attested pass per test-file anchor, which a RED task cannot have before the impl lands (`--override-attestation` does not lift the test-anchor rule). Workaround used: after the RED test merged with expected-fail evidence recorded, `lore unlink <test> <impl>`; impl tasks then recorded their own red run before editing src and `lore red-first`; the test task was archived after the impl landed. Same shape recurred for any task whose AC goes green only after a downstream task (T4 → AC-CV-6 needed T6's `mcp_tool_count`). Filed **#217**.
2. **Phase descriptions cannot be edited** once tasks reference the phase (`phase` has add/list/rm/rename only; rename keeps the description). After S3 changed scope, two descriptions state a rejected design; corrected only by a note in the plan body. Filed **#216**.
3. **Repo-tracked `.claude/skills/lore/SKILL.md` is a hand-synced copy** of the shipped asset and had drifted (23 vs 45 tools, missing tail line). Filed **#218**.
4. **`check-shipped-defaults` verdict depends on the gitignored `.lore/config.yaml`** (red in the main checkout, green in any worktree). Filed **#219**.
5. **Malformed `{{lore:…}}` tokens pass through silently** (spec D2 vs plan I1). Filed **#220**.
6. **Mode-routed skills hid their first-token arg contract** — fixed in `cc8c25c9` (#213) with a test binding descriptions to `references/mode-*.md`.

## Design lessons (S3 review changed the design materially)

- Before designing a "configurable variable", check whether the config file is tracked: `.lore/config.yaml` is gitignored, so project-config values cannot feed project outlets without breaking BR-902 byte identity. Configurability stayed at fragment level.
- Before designing install-time behaviour, read how setup actually installs: the embedded manifest holds only hashes and `RealAssetSource` copies raw files, so expansion had to live in `RealAssetSource.load()` with the manifest hashing the same bytes.
- The approved CLAUDE.md content contract puts code-derivable facts OUT; the SSOT fix for a stale count in a memory file is deletion plus a lint, not generation.
- Verify every reviewer claim with a tool before acting; all three S3 lenses' blockers held up under direct checks.

## Full-suite state on main after the plan (for the next reader)

vitest: 20 failing tests in 10 files — 19 identical to the session-start baseline `cc8c25c9` (#10, #32, #197, #199, #200, #210 and two script oracles), 1 environment-dependent (#219). bun: 2 failing, identical to baseline (#197, #201); the one regression this plan introduced (manifest `--check` under `node`) was fixed in `57f499b9`.
