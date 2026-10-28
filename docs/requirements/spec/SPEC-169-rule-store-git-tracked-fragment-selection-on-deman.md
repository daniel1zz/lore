---
id: SPEC-169
type: spec
role: spec
title: "Rule store: git-tracked fragment selection, on-demand skill delivery, deterministic duplicate-line check"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-23
tags: [context-fragments, rule-store]
---
## Overview/Goal

Option A of `knowledge-rule-store-a-selectable-fragment-catalog-composed-per`, with the user's decisions D1-D7 of 2026-10-12.

Today, every main session in this repo loads 39,441 B of static rules, and 5,623 B of them restate shipped text. User-layer copies of lore-tool facts go stale: user-03 still says "4 gates". The project disable list lives in the untracked `.lore/config.yaml` (`.gitignore:18`), which breaks D14 ("identical bytes per teammate") of `spec-context-fragments-config-driven-layered-rule-injection`. That spec's D7 also claims `lore status` runs the fragments check, and it does not.

This spec makes six changes:

- (a) Selection moves into git-tracked `selection.yaml` files. It is opt-out: every fragment is on unless disabled (D1, D2).
- (b) Situational fragments can use a new `delivery: skill` (D5).
- (c) A deterministic duplicate-line finding fails the check (D7).
- (d) lore-tool facts are promoted to shipped fragments, and `agent-rules` is trimmed (D3, D6).
- (e) Prose that restates shipped hooks moves into the hooks' own output.
- (f) `lore status --check-fragments` runs the same check, and one resolver finds the user's fragments and selection.

Two things do not change. Hooks still never open the corpus (D13). Fragments stay files.

Governing rules:

- New: BR-1060 to BR-1068.
- Deprecated, and retired when this lands: BR-890, BR-895, BR-901, BR-903, BR-916.

## Scope

1. **Fragment format** (`packages/core/src/context-fragments.ts`)
   - Add optional `delivery: rules|skill`. An absent value means `rules`.
   - `description` (at most 1,536 chars) is required exactly when delivery is `skill`.
   - Skill delivery requires `mode: static` and `audience: [main]`.
   - `OUTLET_IDS` gains `skills:project` and `skills:user`. `resolveContextConfig` handles them the same way it handles `rules:*`.
2. **Selection files** (new `packages/lore/src/service/context-fragments/selection.ts`)
   - Shape: `{schemaVersion: 1, disable: string[]}`, Zod strict.
   - Locations: project `.lore/context/selection.yaml`, user `<userConfigDir>/context/selection.yaml`.
   - Operations: pure parse, serialize and add/remove.
   - `selectionToLayer` maps a selection onto the existing `ContextConfigLayer.context.fragments.disable`, so `select.ts` and `checkOverrides` keep their signatures. It refuses a config-file `fragments.disable`. `contextConfigSchema` (15 importers) stays unchanged.
3. **Routing** (`select.ts`)
   - Skill fragments are excluded from `rules:*` and `hook:*`.
   - They route to `skills:project` (shipped and project layers) or `skills:user` (user layer).
4. **File shape** (`section.ts`, still the only owner of file shapes)
   - `lore-<id>/SKILL.md` is frontmatter (`name`, `description`), then the fingerprint comment, then the body.
   - Add `parseSkillFile` and `isLoreSkillDir`. `isLoreSkillDir` is true only when the fingerprint is intact.
   - In `render.ts`, `skills:*` outlets have no cap.
5. **Duplicate detector**: new pure module `service/context-fragments/duplicates.ts` (BR-1067).
6. **Flows**
   - `fragments-flow.ts` check gains findings for `duplicate_line`, `selection_unknown_id`, `selection_in_config`, `skill_collision`, and project skill drift.
   - `context-flow.ts` refresh writes and prunes skill folders under the existing CAS.
   - New `flows/selection-flow.ts` handles list/add/remove, with a CAS write of the selection file (exit 5 on conflict).
7. **CLI**
   - `lore context list|add|remove <id> [--scope project|user] [--json]` (`commands/context.ts`).
   - Selection loading in `commands/fragments.ts` `buildFlowDeps`.
   - `lore status --check-fragments` (`commands/status.ts`). Read status's exit-precedence first.
   - One shared user-config-dir resolver used by both `fragments` and `context refresh` (BR-1065). Today `fragments` reads `LORE_CONFIG_HOME` while refresh reads `XDG_CONFIG_HOME/lore`.
8. **Hooks**
   - `assets/hooks/pre-subagent-gate.mjs` emits `hookSpecificOutput.additionalContext` with the reason, the exemptions and both bypass variables (BR-1068). Today it writes to stderr with exit 0, which the model never sees.
   - `pre-no-general-agent-gate.mjs` lists `tester`.
9. **Migration (data)**
   - New shipped fragments: `assets/context/lore-ac-design.md`, `lore-evidence-attestation.md`, `lore-dispatch-bundle.md` and `lore-worktree-dispatch.md`, all with English bodies.
   - Trim `assets/context/agent-rules.md` to its non-overlapping line.
   - Add `main` to the audience of the `scoped-oracles` project fragment.
   - New `.lore/context/selection.yaml` (`disable: []`).
   - Regenerate `.claude/rules/`.
   - The user layer (`~/.config/lore/context/`) is migrated by a HUMAN step that follows the table in this spec's plan, followed by `lore context refresh --scope user && lore fragments check`.
   - The user-15 dispatch lines stay in the user layer until the user decides to register the dispatch hooks at user scope. Those hooks are registered only in this repo.

Out of scope:

- role templates (option C) and D8;
- #167 (empty main-run composition);
- meaning-level (LLM) duplicate detection;
- project `context.language` still being untracked.

Probes before the related ACs are relied on:

- (a) a fingerprint comment after the SKILL.md frontmatter still triggers on `description`;
- (b) a new skill dir is picked up live;
- (c) PreToolUse `additionalContext` with exit 0 reaches the model on Edit.

## Acceptance Criteria

Structured criteria: `lore ac list <this spec>`, AC-RS-1 to AC-RS-15. Each cites its governing rule.


## Acceptance Criteria (structured)

- [⊖] [script] AC-RS-1: Fragment frontmatter: delivery skill without description, with a 1537-char description, with mode dynamic, or with a non-[main] audience is a schema error; a 1536-char description passes; absent delivery parses as rules.
  script: test — o=$(mktemp); bunx vitest run packages/core/tests/unit/rs-frontmatter-delivery.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-RS-1 PASS: skill delivery schema bounds'
  other_command=2
- [⊖] [script] AC-RS-2: A skill-delivery fragment appears in no rules:* and no hook:* outlet and in exactly one of skills:project / skills:user according to its layer.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/context-fragments/rs-select-skill-routing.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-RS-2 PASS: skill fragments leave rules and hooks'
  other_command=2
- [⚑] [script] AC-RS-3: Selection add/remove are idempotent (byte-equal on repeat); an unknown id is refused; a project selection disabling a user static-main fragment is refused; a config-file fragments.disable is refused naming selection.yaml.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/context-fragments/rs-selection.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-RS-3 PASS: selection ops idempotent and refusals'
  other_command=3
- [⚑] [script] AC-RS-4: Duplicate detection: an exact and a whitespace-variant duplicate across two fragments read by one main session give 2 findings naming both paths; a repeat inside one fragment, headings and blank lines give 0; a line shared only by two different helper types' fragments gives 0.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/context-fragments/rs-duplicates.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-RS-4 PASS: duplicate-line detection exact and normalized'
  other_command=3
- [⚑] [script] AC-RS-5: Refresh writes lore-<id>/SKILL.md with description frontmatter and fingerprint, prunes a fingerprinted skill dir whose fragment is gone, leaves a fingerprint-less lore-plan/ byte-unchanged, and refuses fragment id plan with zero writes.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/context-fragments/rs-refresh-skills.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-RS-5 PASS: skill write prune and collision refusal'
  other_command=8
- [⚑] [script] AC-RS-6: A selection write interleaved by another write between read and write returns CONFLICT and leaves the file equal to the interleaved bytes.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/flows/rs-selection-cas.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-RS-6 PASS: selection write refuses lost update'
  other_command=2
- [⊖] [script] AC-RS-7: Spawned lore in a temp HOME and lore-init corpus: context list --json lists every fragment with layer, delivery and selected; context remove corpus-workflow-close records it in selection.yaml and deletes .claude/rules/lore-corpus-workflow-close.md; a repeat exits 0 leaving the file byte-equal; add restores the rules file; remove of an unknown name exits 4.
  script: e2e — o=$(mktemp); bun run build > $o.b 2>&1 || { tail -5 $o.b; false; } && { bunx --bun vitest run packages/lore/tests/e2e/rs-context-selection-cli.bun.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-RS-7 PASS: context list add remove drive the selection'; }
  other_command=2
- [⚑] [script] AC-RS-8: Spawned lore fragments check: a cross-layer whitespace-normalized duplicate exits 4 with [duplicate_line] naming both files on stderr, and exits 0 once removed; a .lore/config.yaml carrying context.fragments.disable exits 4 naming selection.yaml.
  script: e2e — o=$(mktemp); bun run build > $o.b 2>&1 || { tail -5 $o.b; false; } && { bunx --bun vitest run packages/lore/tests/e2e/rs-fragments-check-duplicates.bun.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-RS-8 PASS: check fails exit 4 on duplicate line'; }
  other_command=4
- [⚑] [script] AC-RS-9: Spawned lore status --check-fragments on the AC-RS-8 duplicate fixture exits 4 with the same duplicate_line finding, and exits 0 on a clean fixture.
  script: e2e — o=$(mktemp); bun run build > $o.b 2>&1 || { tail -5 $o.b; false; } && { bunx --bun vitest run packages/lore/tests/e2e/rs-status-check-fragments.bun.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-RS-9 PASS: status runs the fragments check'; }
  other_command=2
- [⚑] [script] AC-RS-10: Spawned lore: a user fragment with delivery skill carrying a nonce makes context refresh --scope user write HOME/.claude/skills/lore-<id>/SKILL.md and no HOME/.claude/rules/lore-<id>.md, and the nonce is absent from fragments render of hook:session-start and of hook:subagent-start for lore-implementer.
  script: e2e — o=$(mktemp); bun run build > $o.b 2>&1 || { tail -5 $o.b; false; } && { bunx --bun vitest run packages/lore/tests/e2e/rs-skill-delivery-cli.bun.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-RS-10 PASS: skill fragment renders as skill only'; }
  other_command=2
- [⚑] [script] AC-RS-11: rules:project and skills:project renders are byte-equal across two runs that differ only in user layer, user selection and global config.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/context-fragments/rs-selection-determinism.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-RS-11 PASS: project render identical across teammates'
  other_command=4
- [⚑] [script] AC-RS-12: RETIRED HOOK, surviving half: the pre-subagent-gate.mjs edit-notice hook was retired in ee114c62; pre-no-general-agent-gate.mjs refuses a general-purpose dispatch with exit 2 and its message lists exactly lore-reader and lore-implementer, never tester
  script: test — bunx --bun vitest run packages/lore/tests/unit/hooks/pre-no-general-agent-gate-message.test.ts
  other_command=2
- [⚑] [script] AC-RS-13: Spawned lore with the shipped catalog in a temp HOME: fragments check --json exits 0; shipped ids include ac-design, evidence-attestation, dispatch-bundle and worktree-dispatch; agent-rules keeps only its non-overlapping line; the hook:subagent-start lore-implementer render is at most 9400 chars; this repo's rules:project includes the scoped-oracles fragment.
  script: e2e — o=$(mktemp); bun run build > $o.b 2>&1 || { tail -5 $o.b; false; } && { bunx --bun vitest run packages/lore/tests/e2e/rs-shipped-catalog.bun.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-RS-13 PASS: shipped catalog passes check within caps'; }
  other_command=3
- [⚑] [script] AC-RS-15: With LORE_CONFIG_HOME set, context refresh --scope user and fragments check both read that folder's context/ fragments and context/selection.yaml (spawned lore, temp HOME).
  script: e2e — o=$(mktemp); bun run build > $o.b 2>&1 || { tail -5 $o.b; false; } && { bunx --bun vitest run packages/lore/tests/e2e/rs-user-config-resolver.bun.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-RS-15 PASS: refresh and check share one user config dir'; }
  other_command=2
- [⚑] [script] AC-RS-14: On this machine after the user-layer migration, the main session's static rules (.claude/rules/lore-*.md plus ~/.claude/rules/lore-*.md) hold 0 whitespace-normalized duplicate non-heading lines, total at most 33818 bytes (39441 minus the measured 5623 duplicate bytes), and lore fragments check exits 0.
  script: other — cd /Users/apple/Projects/zz/lore && f=".claude/rules/lore-*.md $HOME/.claude/rules/lore-*.md"; d=$(cat $f | grep -v "^<!-- lore:managed" | sed -E "s/[[:space:]]+/ /g;s/^ //;s/ \$//" | grep -vE "^\$|^#{1,6} |^\`\`\`|^---\$" | sort | uniq -d | wc -l | tr -d " "); b=$(LC_ALL=C cat $f | wc -c | tr -d " "); lore fragments check > /dev/null 2>&1; rc=$?; echo "dups=$d bytes=$b check=$rc"; [ "$d" -eq 0 ] && [ "$b" -le 33818 ] && [ $rc -eq 0 ] && echo "AC-RS-14 PASS: main static rules $b B, 0 duplicate lines"
  other_command=1

## Code anchors

- packages/core/src/context-fragments.ts#FragmentFrontmatterSchema
- packages/lore/src/service/context-fragments/select.ts#selectFragments
- packages/lore/src/service/context-fragments/section.ts#isLoreSkillFileBytes
- packages/lore/src/service/context-fragments/duplicates.ts#findDuplicateLines
- packages/lore/src/service/context-fragments/selection.ts#selectionToLayer
- packages/lore/src/service/context-fragments/user-config-dir.ts#resolveUserConfigDir
- packages/lore/src/flows/fragments-flow.ts#runFragmentsCheck
- packages/lore/src/flows/context-flow.ts#runContextRefresh
- packages/lore/src/flows/selection-flow.ts#runSelectionChange
- packages/lore/src/adapters/cli/commands/context.ts
- packages/lore/src/adapters/cli/commands/status.ts
- packages/core/tests/unit/rs-frontmatter-delivery.test.ts
- packages/lore/tests/unit/context-fragments/rs-select-skill-routing.test.ts
- packages/lore/tests/unit/context-fragments/rs-selection.test.ts
- packages/lore/tests/unit/context-fragments/rs-duplicates.test.ts
- packages/lore/tests/unit/context-fragments/rs-refresh-skills.test.ts
- packages/lore/tests/unit/flows/rs-selection-cas.test.ts
- packages/lore/tests/unit/context-fragments/rs-selection-determinism.test.ts
- packages/lore/tests/e2e/rs-context-selection-cli.bun.test.ts
- packages/lore/tests/e2e/rs-fragments-check-duplicates.bun.test.ts
- packages/lore/tests/e2e/rs-status-check-fragments.bun.test.ts
- packages/lore/tests/e2e/rs-skill-delivery-cli.bun.test.ts
- packages/lore/tests/e2e/rs-shipped-catalog.bun.test.ts
- packages/lore/tests/e2e/rs-user-config-resolver.bun.test.ts
- packages/lore/tests/unit/context-fragments/rs-duplicates.test.ts#"findDuplicateLines"
- packages/lore/tests/unit/hooks/pre-no-general-agent-gate-message.test.ts
