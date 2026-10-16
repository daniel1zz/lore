---
id: SPEC-184
type: spec
role: spec
title: "Shipped skill descriptions state when to use the skill"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
---
## Overview/Goal

A skill's `description` is the only text an agent sees before it chooses a skill. Today several shipped skills (`assets/skills/*/SKILL.md`) describe HOW they work instead of WHEN to pick them: `lore-analyze` and `lore-biz-review` carry no trigger at all; `lore-uat`, `lore-session-review`, `lore-init-context`, `lore-product-lens`, `lore-bug-hunt` and others run 600-1300 characters of process detail that belongs in the body; "new project" / "新项目" is claimed by both `lore-kickoff` and `lore-auto-wire`, "业务规则" by both `lore-baseline` and `lore-domain`; `lore-design-ui` points at `ui-ux-pro-max` and `frontend-design`, `lore-uat` at `verify`, none of which lore ships. This spec makes every shipped description a trigger statement (BR-1099) and turns that into a test so it cannot drift back.

## Scope

In scope:
- The `description` frontmatter of every `assets/skills/*/SKILL.md`, and the repo-tracked copy `.claude/skills/lore/SKILL.md` (its description must equal `assets/skills/lore/SKILL.md`'s).
- Process detail removed from a description moves into that skill's body when the body does not already say it — nothing is lost.
- `assets/skills/lore-write-a-skill/SKILL.md` body states the description standard.
- A new vitest test `packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts` enforcing the standard.
- Regenerated `packages/lore/src/generated/assets-manifest.ts`.

Out of scope: skill bodies beyond moved text; the mode `Args:` suffix contract (owned by `skill-mode-arg-contract.test.ts`, must stay green); user-level files under `~/.claude/`; the wider drift of `.claude/skills/lore/SKILL.md` body.

### The standard

Let `core` = the description with any trailing ` Args: '<mode> [context]' …` suffix removed.
1. `core` starts with `Use when`.
2. `core.length <= 500`.
3. Every skill named as a redirect — the target of `(use X)` / `use X` inside a NOT-for clause, and every `lore-*` token — is a directory under `assets/skills/`.
4. No quoted trigger phrase (`'…'` or `"…"` containing at least one letter or CJK character, compared case-insensitively after trim) appears in the `core` of two different shipped skills.
5. Neighbour pairs name each other in their descriptions: lore-kickoff ↔ lore-auto-wire, lore-kickoff ↔ lore-project-bootstrap, lore-auto-wire ↔ lore-project-bootstrap, lore-design ↔ lore-design-ui, lore-refactor ↔ lore-improve-codebase-architecture, lore-baseline ↔ lore-domain, lore-analyze ↔ lore-product-lens, lore-biz-review ↔ lore-domain.

## Acceptance Criteria

- AC-SD-1: every shipped skill's core description starts with "Use when" (≥40 skills scanned, else red).
- AC-SD-2: every core description is ≤500 characters.
- AC-SD-3: every redirect target and every lore-* token in a description is a shipped skill directory.
- AC-SD-4: no quoted trigger phrase is claimed by two shipped skills.
- AC-SD-5: each listed neighbour pair names each other.
- AC-SD-6: negative controls — the checker reports a violation for each of: the old lore-analyze description (no "Use when"), a 501-char core, a description saying "use verify", and two descriptions both quoting 'new project'.
- AC-SD-7: `.claude/skills/lore/SKILL.md` description equals `assets/skills/lore/SKILL.md`'s, and `lore-write-a-skill`'s body states the "Use when" opening and the 500-character limit.
- Existing `skill-mode-arg-contract.test.ts` stays green.


## Acceptance Criteria (structured)

- [⚑] [script] AC-SD-1: Every shipped skill's core description (Args suffix removed) starts with 'Use when'; at least 40 skills are scanned.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts -t 'AC-SD-1' > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-SD-1 PASS: all descriptions open with Use when'
- [⚑] [script] AC-SD-2: Every shipped skill's core description is at most 500 characters.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts -t 'AC-SD-2' > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-SD-2 PASS: all core descriptions <=500 chars'
- [⚑] [script] AC-SD-3: Every redirect target ('use X' / '(use X)') and every lore-* token in a shipped description names a directory under assets/skills.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts -t 'AC-SD-3' > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-SD-3 PASS: no dangling skill references'
- [⚑] [script] AC-SD-4: No quoted trigger phrase (containing a letter or CJK character, case-insensitive, trimmed) appears in the core description of two different shipped skills.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts -t 'AC-SD-4' > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-SD-4 PASS: trigger phrases are disjoint'
- [⚑] [script] AC-SD-5: Each neighbour pair names the other in its description: kickoff/auto-wire, kickoff/project-bootstrap, auto-wire/project-bootstrap, design/design-ui, refactor/improve-codebase-architecture, baseline/domain, analyze/product-lens, biz-review/domain.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts -t 'AC-SD-5' > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-SD-5 PASS: neighbour pairs cross-reference'
- [⚑] [script] AC-SD-6: Negative controls: the checker reports a violation for the old lore-analyze description, a 501-char core, a description saying 'use verify', and two descriptions both quoting 'new project'.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts -t 'AC-SD-6' > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-SD-6 PASS: checker rejects each negative control'
- [⚑] [script] AC-SD-7: No repo-tracked copy of the lore skill exists (.claude/skills/lore/SKILL.md is absent; assets/skills/lore/SKILL.md is the single source and lore setup renders the installed copy — issue #218); lore-write-a-skill's body states the 'Use when' opening and the 500-character limit.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts -t 'AC-SD-7' > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-SD-7 PASS: repo copy in sync and authoring guide states the standard'

## Code anchors

- packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts
- assets/skills/lore-write-a-skill/SKILL.md
