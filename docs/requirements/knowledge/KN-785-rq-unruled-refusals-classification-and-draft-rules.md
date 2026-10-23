---
id: KN-785
type: knowledge
role: knowledge
title: "RQ unruled refusals: classification and draft rules (2026-10-23)"
status: draft
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
---
## Purpose

Classification of the 29 `rule: "BR-0" /* UNRULED */` markers on branch `rq-integration` (commit 461320a2), made 2026-10-23 for plan `plan-rq-every-refusal-carries-its-rule-required-type-checked`. Each marker was read in code, and its exit code checked against `adapters/cli/utils.ts` exitCode. These are drafts for review, not applied rules.

## Decisions

**(a) An existing rule fits.**
- `core/src/code-anchors.ts:219` (test-title anchor grammar) → BR-1183. The comment there saying no rule exists is stale.
- `flows/setup-project-flow.ts:1311` (no commit on main) → BR-1343.

**(b) Not a business refusal.**
- `adapters/cli/commands/issues.ts:765` → defect: the upstream branch is unreachable.
- `adapters/cli/working-tree-root.ts:68` → dependency failure, git not runnable. VALIDATION_ERROR cannot carry "infrastructure", so change the code to STORE_ERROR.
- `ai/registry.ts:214` → defect: AiConfigSchema already refuses this case.
- `flows/setup-project-flow.ts:1590` and `flows/setup-project-uninstall.ts:222` → defect: repoDir is always absolute.
- `service/setup-service.ts:476` → defect: the guard only stops tests.
- `service/autonomy-calibration-service.ts:365` → defect: the only caller already filters.
- `service/decision-service.ts:215, 219, 271, 286` → defect: inputs are always lore-built.

**(c) A new rule is needed.**
- R1: `adapters/cli/loader.ts:463` and `adapters/cli/audit-backfill-migration.ts:87` (corpus schema behind)
- R2: `adapters/cli/editor.ts:136, 163, 171, 182, 195` (editor failures)
- R3: `adapters/cli/phase-wiring.ts:232, 240` and `adapters/cli/task-feed-wiring.ts:236, 244` (feed start: wrong type, no parent plan)
- R4: `ai/registry.ts:116, 244` (unusable AI provider settings)
- R5: `flows/context-flow.ts:911` and `service/context-facts.ts:547` (module card link refused)
- R6: `service/task-workflow-service.ts:5621` (task verbs given a non-task)

## Draft rules (leaf | statement | example | example; enforced_by guaranteed)

- **R1** `baseline-upgrade-the-corpus-in-place`
  - Statement: Every command except the schema upgrade refuses a corpus whose stored schema version is older than this program requires, with exit code 4, before anything is written. The message names the corpus location, the corpus's version and the required version, and says that only the schema upgrade (which can preview first) brings a corpus up to date, after which the command can be retried.
  - Example: A corpus at schema 40 opened by a program needing 41: 'lore list' exits 4 naming both versions and the schema upgrade command; nothing changes.
  - Example: The audit backfill run against that same older corpus is refused the same way, exit 4, before it reads or records anything.
- **R2** `baseline-revise-a-document`
  - Statement: At a terminal, when the editor opens to write or revise a document's body, the command stops with exit code 4 and nothing is written if the editor named is blank or cannot be found (the message names it and says to set EDITOR or the editor setting), the editor fails to start (naming it and the reason), the editor exits with a non-zero code (naming the code), or the saved text is empty.
  - Example: EDITOR=nosuchedit, then 'lore set <doc>' at a terminal: exit 4, "editor 'nosuchedit' not found; set $EDITOR or defaults.editor"; the document is unchanged.
  - Example: The author quits the editor with :cq while creating a document: exit 4; nothing is created.
- **R3** `baseline-pull-the-rules-before-writing`
  - Statement: The task-start pack refuses a document that is not a task, and the phase-start pack a document that is not a phase, with exit code 4 naming the expected and the actual type. A task or phase that has no plan or other document above it is refused with exit code 4 naming it. Nothing is written.
  - Example: Asking for the task-start pack of a spec: exit 4, "Expected a task document; got type 'spec'".
  - Example: Asking for the phase-start pack of a phase whose plan link was removed: exit 4, "Phase '<slug>' has no parent plan".
- **R4** `baseline-edit-project-settings` (the fit is weak; consider a new "AI settings" leaf, following BR-926 in SYCF)
  - Statement: Every command that opens the corpus refuses to start, with exit code 1, when the AI settings are unusable: a provider entry without its command or its arguments (the message names the entry and shows a complete entry), or a chosen provider that names no known provider (the message names it and lists the known ones).
  - Example: ai.providers.claude-cli set to only a timeout: 'lore list' exits 1 naming the entry and printing a full one.
  - Example: ai.provider: claud: every corpus command exits 1, "Unknown ai.provider 'claud'. Known: claude-cli, ...".
- **R5** `baseline-refresh-the-managed-part`
  - Statement: Refreshing the project memory files links each module's memory file to the one architecture module card that declares its folder. Refresh is refused with exit code 4 and nothing is written when two module cards declare the same folder (naming both and the folder) or when adding the link would push a module memory file over its limits (naming the file and each limit).
  - Example: Two cards both declare packages/core/src: refresh exits 4 naming both card slugs and the folder; no file changes.
  - Example: A module memory file already at its line limit: adding the card line is refused, exit 4, naming the file and the breached limit.
- **R6** `baseline-claim-a-task`
  - Statement: Claiming, releasing, recording evidence on, finishing, changing the code anchors of, or narrowing the criteria scope of a document that is not a task is refused with exit code 4, naming task as the expected type and the type found; nothing is written. An unknown document fails as not found (exit code 3).
  - Example: Claiming a plan: exit 4, "Expected a task document; got type 'plan'"; no claim is recorded.
  - Example: Adding a code anchor to a phase through the task anchor command: exit 4 naming 'phase'.

## Side findings (to file as issues when work resumes)

1. `editor.ts:131` splits on whitespace, so `EDITOR=" vim"` is reported as not found. It should trim first.
2. AI-settings errors exit 1 regardless of code (`loader.ts:569-575`), contrary to the exitCode contract (VALIDATION_ERROR → 4). R4 is written for the actual 1. Decide whether to fix the code before applying R4.
3. BR-1281 says git 2.28 but BR-1343 says 2.46: a spec contradiction, not yet checked against the code.
4. Editor not found / failed to start could instead count as a dependency failure. That would need a new external-process dependency code.
5. R2 and R6 span several leaves through one code site each. R6 could instead be split per verb with `nonTaskRule`, as BR-1213 does.
