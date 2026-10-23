---
id: KN-634
type: knowledge
role: knowledge
title: "Review-branch frozen re-probe set: 10 questions written from code only before the remediation revision"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-23
tags: []
parent: PLAN-177
---
Frozen review re-probe set (10 questions), areas: review + specification/execution. Each answer verified by code reading and CLI run against a throwaway corpus. Do not edit after creation.

Throwaway corpora used for the CLI runs (both created with the mandated `mktemp -d … && cd && lore init` pattern under `/private/tmp/claude-501/-Users-apple-Projects-zz-lore/6b85319e-c895-4c9d-84c0-ab5ad4984378/scratchpad/review-probe2/`): `corpus.DEniDU` (questions 5, 6, 8) and `corpus.oi9rhX` (questions 1, 2, 3, 4, 7, 9, 10). Binary: `~/.local/bin/lore` -> `/Users/apple/Projects/zz/lore/dist/lore` (built 2026-10-08 16:33; the only later commit, a248efe0, touched module CLAUDE.md docs only, so the binary matches the source cited below). Runs used `CLAUDECODE=1` and `LORE_ACTOR=agent:probe-author` unless stated otherwise. No run reached the AI judge: every review shown was decided by the deterministic checks.

## Questions

1. A document's only review so far was produced by the mechanical (non-AI) checks and came out as a rejection. How does the review queue listing label that document's review? What changes in the label after the document is edited? Does the document appear when the queue is filtered to escalated items only?
2. Someone runs a review of a spec and names themselves as the person requesting the review. Who ends up recorded as the actor of the review in the audit trail and on the stored review? Is the requester's name kept anywhere?
3. The review queue holds a draft spec, a draft plan and a draft task. Someone runs the "review everything in the pending queue" batch command. Which of the three get a review recorded, and what does the batch summary report?
4. What exit code does the review command return, and is any review recorded, when (a) the project's tree blueprint file exists but is malformed, (b) the named document does not exist, (c) no document is named and batch mode is not requested?
5. An AI coding agent (a session where AI is off by default for agents) runs the review command on a document. Does the agents' AI-off default stop the review? What does stop it, and with what exit code?
6. A reviewer runs the review command on a draft task that has no recorded verification evidence. Is an AI judge consulted? What decision and confidence are recorded, what exit code does the command return, and do the task's status or version change?
7. The project settings list the document types that need a review on record before approval. What happens to approving a never-reviewed spec when that list is set to empty? What happens when the list names only knowledge notes, both for a never-reviewed knowledge note and for a never-reviewed spec?
8. Can a draft document be moved straight to "archived" without ever being approved? Does the answer depend on the document type? Can an archived document be moved back to draft?
9. When approving, the approver can be named with two different options. What happens if both are given with different names, and if both are given with the same name? Can the author of a document approve it themselves, and who is recorded as the approver?
10. An approved spec has exactly one acceptance criterion, and it is removed. Is the removal accepted? What status does the spec end up in, is a version recorded, and how many acceptance criteria does the approved spec have afterwards?

## Answers and evidence

### 1 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: The queue shows `[AI: reject 1.00]` in its "AI Judgment" column, even though no AI was involved: the judge was `deterministic-checks`, model `n/a`. The badge prefix is always "AI:" for any judgment. After an edit bumps the version past the reviewed one, the label becomes `[AI: reject 1.00] (stale)`. Filtering to escalated items (`lore pending --escalated`) shows nothing (`No escalated documents.`, exit 0), because only a current-version `escalate` decision counts, not a reject.

**Prose that conflicts**: `packages/lore/src/adapters/cli/pending-render.ts:53` column header "AI Judgment", and `packages/lore/src/adapters/cli/commands/pending.ts:4` "every pending doc gains an "AI Judgment" badge". The badge labels mechanical-check verdicts as AI verdicts.

**Code**: `packages/lore/src/adapters/cli/utils.ts:920-928` (`formatJudgmentBadge`: hard-coded `[AI: <decision> <confidence>]`, `(stale)` when `judgment.doc_version < docVersion`); `packages/lore/src/adapters/cli/commands/review.ts:129-144` (deterministic judgment, provider `deterministic-checks`); `packages/lore/src/adapters/cli/commands/pending.ts:40-43` (`isFreshEscalation`: decision escalate AND same version).

**CLI**:
```
printf 'version: 1\nroot:\n  type: prd\n' > lore.tree.yaml     (models only prd, so spec/plan fail tree_position)
lore review --pending --by agent:batch-requester   -> exit 0 (see Q3)
lore pending --all
  plan-login-plan  plan  Login Plan  ... 1  [AI: reject 1.00]
  spec-login-flow  spec  Login Flow  ... 2  [AI: reject 1.00]
lore audit spec-login-flow --action judge --json -> "actor": "ai:deterministic-checks:n/a:v2"
lore set spec-login-flow --title "Login Flow Two"  (v2 -> v3)
lore pending | grep spec-
  spec-login-flow  spec  Login Flow Two  ... 3  [AI: reject 1.00] (stale)
lore pending --escalated  -> exit 0, "No escalated documents."
```

### 2 (area: review)

**Answer**: The audit entry (action `judge`) and the stored review's `created_by` both name the judge identity, `ai:deterministic-checks:n/a:v2` (format `ai:<provider>:<model>:<prompt_version>`), not the requester. The requester name (`--by agent:alice`) is only echoed back as `requested_by` in the command's JSON output. It is stored nowhere: a full dump of the corpus database contains zero occurrences of it. (Only the staleness-probe variant of review, which is out of scope here, records the requesting actor.)

**Code**: `packages/lore/src/adapters/cli/commands/review.ts:158` (`reviewOneDoc(app, idOrSlug, blueprint)`, no actor parameter), `:577` (actor used only for `requested_by` output; `:529` the same in batch mode), `:263` (help: "Actor requesting the review/probe"); `packages/lore/src/service/judgment-service.ts:175` (`created_by: formatJudgeActor(judge)`), `:202` (audit actor = `auditActor` override, only set by staleness probing, else `created_by`); `packages/core/src/audit-actor.ts:46-47`.

**CLI**:
```
lore review spec-login-flow --by agent:alice --json  -> exit 0
  "requested_by": "agent:alice", ... "doc_version": 2, "created_by": "ai:deterministic-checks:n/a:v2"
sqlite3 -readonly .lore/lore.db "select count(*) from audit where actor like '%alice%' or details like '%alice%'"   -> 0
sqlite3 -readonly .lore/lore.db "select count(*) from review_judgments where created_by like '%alice%'"            -> 0
sqlite3 -readonly .lore/lore.db .dump | grep -c alice           -> 0   (probe-author: 14, batch-requester: 0)
```

### 3 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: Only the spec and the plan are reviewed. The draft task is silently skipped: it gets no review and stays `[unreviewed]`. The summary says `2 reviewed, 0 failed`, exit 0. Batch review works from the default pending queue, which hides task documents (and ledger knowledge sub-types: assessment, retro, handoff, uat), and the batch command has no option to include them. Exit code 6 is returned only if every document in the batch fails.

**Prose that conflicts**: `packages/lore/src/adapters/cli/commands/review.ts:239` help for `--pending`: "Batch-review every document in the pending (draft) queue". A draft task is a draft but is not reviewed.

**Code**: `packages/lore/src/adapters/cli/commands/review.ts:502` (`app.reviewService.pending()` called with no filters), `:557-559` (exit 6 only when every doc failed); `packages/lore/src/service/review-service.ts:553-554` (task and ledger docs filtered out unless `all`), `:1055-1057` (`isLedgerOrTaskDoc`).

**CLI**:
```
lore pending --all --json   -> task-build-page, plan-login-plan, spec-login-flow (all draft)
lore review --pending --by agent:batch-requester  -> exit 0
  01M4FD1M70  Login Plan  reject  1.00
  01M4FD1KXM  Login Flow  reject  1.00
  2 reviewed, 0 failed
lore audit task-build-page --action judge --json | grep -c '"action"'  -> 0
lore pending --all   -> task-build-page ... [unreviewed]
```

### 4 (area: review)

**Answer**: (a) Malformed blueprint: exit 4 (`Validation failed on field 'lore.tree.yaml': Invalid literal value, expected 1`). The command stops before any check runs and no review is recorded (review count 3 before and 3 after). A *missing* blueprint is not an error: the tree-position check is just reported as skipped. (b) Unknown document: exit 3, `Document not found: spec-does-not-exist`, nothing recorded. (c) No document and no batch mode: exit 2, `a document ID or slug is required unless --pending or batch --staleness is passed.`

**Code**: `packages/lore/src/adapters/cli/commands/review.ts:118-126` (`loadBlueprintOrExit`: missing -> undefined, invalid -> `process.exit(4)`), `:339-341` (no doc -> exit 2); `packages/lore/src/adapters/cli/utils.ts:95-97` (`DOC_NOT_FOUND` -> 3); `packages/core/src/review-checks.ts:186-189` (no blueprint -> `skipped`).

**CLI**:
```
printf 'version: 2\nroot:\n  type: prd\n' > lore.tree.yaml
lore review spec-login-flow       -> exit 4, "Error: Validation failed on field 'lore.tree.yaml': Invalid literal value, expected 1"
review_judgments row count: before=3 after=3
printf 'version: 1\nroot:\n  type: prd\n' > lore.tree.yaml
lore review spec-does-not-exist   -> exit 3, "Error: Document not found: spec-does-not-exist"
lore review                       -> exit 2, "Error: a document ID or slug is required unless --pending or batch --staleness is passed."
```

### 5 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: No. The built-in "AI off for agent surfaces" default does **not** stop `lore review`: the command treats itself as an AI request and goes ahead (it runs the deterministic checks, then calls the AI judge if they all pass). Only two things stop it, both with exit 2 before any check runs: (1) an explicit config override `ai.default_per_surface.<surface>: false` in `.lore/config.yaml` ("AI is required for `lore review` but is disabled for this surface by config.ai.default_per_surface. Pass --ai to override."), and (2) the explicit opt-out flag `--no-ai` ("lore review requires AI; --no-ai is a contradiction."). A braked run records no judgment.

**Prose that conflicts**: `/Users/apple/Projects/zz/lore/CLAUDE.md:138` "AI is ... OFF for agent surfaces (`agent` — signalled by `CLAUDECODE=1` ...)". (The command's own help, `packages/lore/src/adapters/cli/commands/review.ts:268`, "review defaults to AI on every surface", matches the code; the general project prose does not apply to review.)

**Code**: `packages/lore/src/ai/resolve-ai.ts:131` (braked only when `source === "config"` and AI false); `packages/lore/src/adapters/cli/commands/review.ts:332-338` (`--no-ai` -> exit 2), `:350-360` (config brake -> exit 2), `:178` (AI judge call when checks pass).

**CLI** (all with `CLAUDECODE=1`):
```
lore review task-build-login-page --json   -> exit 0, judgment recorded (not blocked by the agent default; see Q6)
lore review task-build-login-page --no-ai  -> exit 2, "Error: lore review requires AI; --no-ai is a contradiction. Omit the flag to proceed."
(append to .lore/config.yaml:  ai: / default_per_surface: / agent: false)
lore review task-build-login-page          -> exit 2, "Error: AI is required for `lore review` but is disabled for this surface by config.ai.default_per_surface. Pass --ai to override."
lore audit task-build-login-page --action judge --json -> still only 1 judge entry (from the first run)
(config restored afterwards)
```

### 6 (area: review)

**Answer**: No AI judge is consulted. Five mechanical checks run (schema, parent contract, tree position, link integrity, evidence completeness). Evidence completeness fails ("task has no verification_evidence entries"), so a judgment is recorded directly: decision `reject`, confidence `1` (1.0), judge provider `deterministic-checks`, model `n/a`, pinned to `doc_version: 1`. Tree position shows `skipped` ("no lore.tree.yaml"). Exit code is 0 (the command's job is to record a judgment, and a reject counts as success). The task stays `draft` at version 1: reviewing changes neither status nor version.

**Code**: `packages/core/src/review-checks.ts:228-241` (evidence check, tasks only), `:256-263` (five checks in fixed order); `packages/lore/src/adapters/cli/commands/review.ts:171-176` (any failure -> record a deterministic reject, skip AI), `:129-144` (confidence 1.0, provider `deterministic-checks`).

**CLI**:
```
lore review task-build-login-page --json   -> exit 0
  "decision": "reject", "confidence": 1,
  checks: schema pass, parent_contract pass, tree_position skipped ("no lore.tree.yaml"),
          link_integrity pass, evidence_completeness fail ("task has no verification_evidence entries")
  "doc_version": 1, "provider": "deterministic-checks", "model": "n/a"
lore get task-build-login-page --json      -> "status": "draft", "version": 1
```

### 7 (area: review)

**Answer**: With the default list (spec, adr), a never-reviewed spec that has one acceptance criterion is refused, exit 4 `NO_JUDGMENT`. With the list set to empty (`workflow.review.judgment_required_types: []`), the review requirement is switched off for every type and the same spec approves, exit 0. With the list set to only `[knowledge]`, a never-reviewed knowledge note is refused (exit 4, `NO_JUDGMENT`), while a never-reviewed spec now approves (exit 0) because specs are no longer on the list. Under the default list the same kind of knowledge note approves with no review (exit 0). The other approval rules still apply under any setting: a spec with zero acceptance criteria is still refused (`NO_ACCEPTANCE_CRITERIA`, exit 4) even with an empty list.

**Code**: `packages/core/src/config.ts:679` (default `["spec","adr"]`); `packages/lore/src/service/review-service.ts:431-433` (empty list -> gate off), `:434` (`typeIsGated`), `:490-498` (for an unlisted type only an escalate blocks), `:281` (spec AC-count gate runs independently).

**CLI** (each config change appended to `.lore/config.yaml`, restored from a backup afterwards):
```
lore approve spec-signup                    (default config)          -> exit 4, blocked: NO_JUDGMENT
  + workflow: review: judgment_required_types: []
lore approve spec-signup                                              -> exit 0, "Approved spec-signup → status: approved (v3)"
  (config restored) + workflow: review: judgment_required_types: [knowledge]
lore approve knowledge-ref-note                                       -> exit 4, blocked: NO_JUDGMENT
lore approve spec-logout                                              -> exit 0, "Approved spec-logout → status: approved (v3)"
  (config restored)
lore approve knowledge-ref-note             (default config)          -> exit 0, "Approved knowledge-ref-note → status: approved (v2)"
(earlier attempt, before ACs were added: with [] the spec was refused, exit 4, blocked: NO_ACCEPTANCE_CRITERIA)
```

### 8 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: It depends on the type. A draft `task` or `knowledge` document can go straight to `archived` (exit 0, version logged). Every other type is refused with exit 4. For example, a draft plan gets `Cannot transition from 'draft' to 'archived'. Allowed transitions from 'draft': in-review, approved`. Archived is terminal: archived -> draft is refused with exit 4 and an empty allowed list.

**Prose that conflicts**: `/Users/apple/Projects/zz/lore/CLAUDE.md:114` lifecycle "draft → in-review | approved (fast-track)" (no draft -> archived edge for any type), and the base table `packages/core/src/schemas.ts:825` has the same two edges only.

**Code**: `packages/core/src/schemas.ts:849` (`DRAFT_TO_ARCHIVED_ALLOWED_TYPES` = task, knowledge), `:861-869` (`isValidTransition` adds the edge for those types), `:829` (archived: no outbound edge); `packages/lore/src/service/corpus-service.ts` set path calls `isValidTransition(existing.status, newStatus, existing.type)`.

**CLI**:
```
lore set knowledge-research-two --status archived -> exit 0, "Updated knowledge-research-two → v3"
lore set plan-login-plan --status archived        -> exit 4, "Cannot transition from 'draft' to 'archived'. Allowed transitions from 'draft': in-review, approved"
lore set knowledge-research-two --status draft    -> exit 4, "Cannot transition from 'archived' to 'draft'. Allowed transitions from 'archived': "
```

### 9 (area: review)

**Answer**: `--by` and `--reviewer` name the same thing (the approver). Given with different values, the command refuses before touching the document: exit 2, `--by and --reviewer were both provided with different values ('agent:dave' vs 'agent:erin'). Pass only one, or use matching values.` The document stays draft. Given with the same value, it is accepted. There is no self-approval check: a note created by `agent:carol` was approved by `agent:carol` (exit 0, v2), and the approve audit entry records `actor: agent:carol` and `reviewer: agent:carol`.

**Code**: `packages/lore/src/adapters/cli/utils.ts:710-723` (`resolveActorAlias`: conflict only when both are given AND they differ); `packages/lore/src/adapters/cli/commands/approve.ts:71-74` (conflict -> exit 2 before any service call); `packages/lore/src/service/review-service.ts:667-870` (`approve`: no comparison of reviewer to `created_by` / author anywhere), `:805-822` (audit `actor` and `details.reviewer` = resolved reviewer).

**CLI**:
```
LORE_ACTOR=agent:carol lore create knowledge --sub-type research --title "Carol Note" --content "c"  -> exit 0; audit create actor agent:carol
lore approve knowledge-carol-note --by agent:dave --reviewer agent:erin   -> exit 2
  Error: --by and --reviewer were both provided with different values ('agent:dave' vs 'agent:erin'). Pass only one, or use matching values.
lore get knowledge-carol-note --json        -> "status": "draft"
lore approve knowledge-carol-note --by agent:carol --reviewer agent:carol -> exit 0, "Approved knowledge-carol-note → status: approved (v2)"
lore audit knowledge-carol-note --action approve --json -> "actor": "agent:carol", "reviewer": "agent:carol"
```

### 10 (area: specification)

**Answer**: Accepted, exit 0 (`Removed acceptance criterion "AC-SIGNUP-1" ... No acceptance criteria remaining.`). The spec stays `approved`, with no demotion and no notice, and a version is logged (v3 -> v4, "Acceptance criteria updated"). Afterwards the approved spec has zero acceptance criteria (`No acceptance criteria declared on this spec.`), a state approval itself would have refused (`NO_ACCEPTANCE_CRITERIA`, needs >= 1). Removal is refused only when some task's recorded evidence references the criterion, unless forced.

**Code**: `packages/lore/src/service/ac-service.ts:648-697` (`removeCriterion`: evidence-reference check unless `force`, then `writeCriteria(spec, updated, "remove", …)` with no status), `:1094` (`newStatus = opts.status ?? spec.status`, so status is unchanged); contrast `:851` (`setCriterion` demotes).

**CLI**:
```
lore get spec-signup --json            -> "status": "approved", "version": 3   (one AC: AC-SIGNUP-1)
lore ac rm spec-signup AC-SIGNUP-1     -> exit 0
  Removed acceptance criterion "AC-SIGNUP-1" from spec spec-signup
  No acceptance criteria remaining.
lore get spec-signup --json            -> "status": "approved", "version": 4
lore ac list spec-signup               -> exit 0, "No acceptance criteria declared on this spec."
lore log spec-signup                   -> v4 update agent:probe-author "Acceptance criteria updated ..."
```
