---
id: KN-630
type: knowledge
role: knowledge
title: "Fast-mode cross-branch frozen probe set: 20 questions over all 12 branches"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-23
tags: []
parent: PLAN-176
---
# Lore CLI blind probe set

Frozen cross-branch probe set (20 questions), all 12 areas. Each answer verified by code reading and CLI run against a throwaway corpus where possible. Do not edit after creation.

Provenance: binary `/Users/apple/.local/bin/lore` -> `dist/lore` (built 2026-10-08 16:33; the only later commit, a248efe0, touches docs only). Repo HEAD a248efe07c6f. Throwaway corpora were created with `lore init` under `.../scratchpad/xprobe/corpus.*` (the second one, "D2", was used for the sync and context runs). The ambient environment had `LORE_ACTOR=agent:task-retraction` and `CLAUDECODE=1`; later runs override `LORE_ACTOR`. File references are relative to the repo root `/Users/apple/Projects/zz/lore`.

## Questions

1. In a freshly initialised project, can a newly drafted architecture decision record be approved straight away without any review having been run? Is that also true for a product requirements document? Give the exit code of the refusal, and say whether there is an audited way around it.
2. An agent wants to see which draft tasks are waiting in the review queue, so it filters the queue by the task document type. What does it get back? Does the queue also show a document that someone has moved to "in-review" status?
3. A reviewer rejects a document that is in "in-review" status, giving a reason. Afterwards, what is the document's status and version number, where is the reason stored, and what does the command print? What happens (exit code) when someone tries to reject a document that is already approved?
4. The delete command says a deleted document is "recoverable for 30 days". Within those 30 days, how do you get a deleted document back? Can it still be read by its address, and does it show up in listing or search? What happens if you delete the same document a second time?
5. An agent creates a document and explicitly names "alice" as the actor. Who does the document's own history show as its creator, and does filtering the document list by author "alice" find it? Where does "alice" actually appear?
6. In the product baseline, rules get permanent numbers. If a rule submission is refused for failing validation, is a number used up? Can a retired rule be brought back to deprecated or live? What is required to retire one? Does moving a rule to another leaf change its number?
7. A specification has been approved. Someone then adds a brand-new acceptance criterion to it, and later rewords an existing criterion. After each step, is the specification still approved? What does this mean for claiming tasks under it?
8. Someone attaches a code location that does not exist (yet) to an approved specification. Is this accepted, does it change the specification's approval, and what does the drift health check report (exit code)?
9. A task declares which acceptance criteria it covers. What evidence must it hold before the "done" command will archive it, and is running the plan's verification command the only way to get a pass that counts?
10. Agent A has claimed a task. What happens (exit code) when agent B tries to claim the same task, and how can B take it over? Separately, can a task be claimed while its plan is still a draft, and what happens if the governing specification was just sent back to draft?
11. An agent declares that its task's tests were written "red-first". Does this declaration let the task skip recording a failing (red) test run before it is marked done?
12. An agent tries to write a session handoff as an ordinary knowledge document with the handoff sub-type, instead of using the dedicated handoff command. What happens, and does the error message tell it which command to use?
13. When writing a handoff, an agent records a key decision as "Login done@high" to note high confidence. What is stored as the judgment and the confidence? What happens with "@90", with "@150", and when no next step is given (exit codes)?
14. A project has no CLAUDE.md file at all. What does the CLAUDE.md budget health check report, and what is its exit code?
15. An agent records a retrospective (retro) knowledge document and later edits its content. What status does the retro have right after creation and right after the edit, how many versions does the edit add, and does it ever show up in the review queue?
16. In a project where no destination for defect reports has been configured, what happens when an agent tries to file a defect report (exit code), is anything sent anywhere, and which corpus does listing issues read?
17. Someone runs init in a directory that is already a Lore project. What happens to the existing data (exit code)? Can the governance contract text be printed in a directory that has no Lore project at all? How does the packaged dashboard log a browser in, and how long does that login link stay usable?
18. A project's config turns team sync on and names a remote URL, but the sync token is not set in the environment. What happens when an agent lists or creates documents with the CLI? What happens when it tries to push or pull?
19. The HTTP API server is running. What does an unauthenticated request to the documents endpoint get, and which endpoint works without a key? When an agent writes through the API with its key, how is it identified? If the key is revoked while the server keeps running, does it stop working without a restart? How is the key named when creating it and when revoking it?
20. A team hand-edits a line inside one of the Lore-managed sections of its CLAUDE.md and then runs the context refresh command. Is the hand edit overwritten? What does the command report, and what happens if they run context init again?

## Answers and evidence

### 1 (area: review)

**Answer**: No for the ADR, yes for the PRD. Approval of `spec` and `adr` docs requires an independent, non-rejecting, non-escalating AI review judgment for the doc's current version (config `workflow.review.judgment_required_types`, default `["spec","adr"]`). Without one, `lore approve` is refused with gate `review-judgment` / `NO_JUDGMENT`, **exit 4**, and the message suggests `lore review <doc>`. A PRD (type not in the list) is approved with no review at all (exit 0). The audited escape is `lore approve <doc> --override-no-judgment` (legal only when the doc has zero judgments ever; otherwise `--override-judgment <id>`), which succeeds with exit 0.

**Code**: `packages/core/src/config.ts:679` (default `["spec","adr"]`); `packages/lore/src/service/review-service.ts:419-497` (`enforceJudgmentRequiredGate`, ungated types only blocked by an escalate); `review-service.ts:735-757` (`--override-no-judgment` legal only with zero judgments); `packages/lore/src/adapters/cli/commands/approve.ts:43-58`.

**CLI**:
```
$ lore create prd --title "Probe Product" --content "Hello world body"   -> exit 0
$ lore approve prd-probe-product        -> exit 0  "Approved prd-probe-product → status: approved (v2)"
$ lore create adr --title "Use SQLite" --content "Decision body" --decision-status proposed
$ lore approve adr-use-sqlite           -> exit=4
Error: Validation failed on field 'gate:review-judgment:judgment-required': Gate "review-judgment" blocked: NO_JUDGMENT
... Recovery: run `lore review adr-use-sqlite`.
$ lore approve adr-use-sqlite --override-no-judgment  -> exit=0  "Approved adr-use-sqlite → status: approved (v2)"
```

### 2 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: Nothing. `lore pending --type task` prints "No pending documents." (exit 0), even when draft tasks exist. The default queue hides all `task` docs and the ledger knowledge sub-types (assessment/retro/handoff/uat) ("pending = promises"). The type filter narrows the store query, but the task/ledger exclusion is applied afterwards, so only `--all` shows them. The queue also never shows an `in-review` doc: it queries `status = 'draft'` only.

**Prose conflict**: `packages/lore/src/adapters/cli/commands/pending.ts:57` describes `--type` as "Filter by document type" with no caveat. Line 48, "List documents in draft status (pending review)", suggests that every draft document awaiting review is listed. In fact a whole document type is unreachable through the filter, and docs in `in-review` status (the one status literally named "review") are never listed.

**Code**: `packages/lore/src/service/review-service.ts:525-530` (store filter `status: "draft"`); `review-service.ts:553-554` (post-filter `!isLedgerOrTaskDoc` unless `all`); `review-service.ts:1055` (`isLedgerOrTaskDoc`).

**CLI**:
```
$ lore pending --type task          -> exit=0  "No pending documents."
$ lore pending --type task --all    -> exit=0  lists task-third-task, task-second-task ("2 pending documents")
$ lore set knowledge-authored-note --status in-review   -> exit=0 "Updated knowledge-authored-note → v2"
$ lore pending | grep -c authored   -> 0
```

### 3 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: A reject on an `in-review` doc moves it to `draft`. The version number does not change: no version row is written, so `lore log` shows nothing new. The reason is stored only in the audit trail (`lore audit <doc>` shows action `reject`, `from_status: in-review`). The CLI prints "Rejected <slug> (status remains: draft)" even though the status just changed from in-review. Rejecting an `approved` doc fails with **exit 4** ("Cannot transition from 'approved' to 'draft'"). Only `draft` and `in-review` docs can be rejected.

**Prose conflict**: `packages/lore/src/adapters/cli/commands/reject.ts:21` says "Reject a draft document", but in-review docs are accepted too. `reject.ts:91` prints "status remains", and the comment at `packages/lore/src/service/review-service.ts:976` says "Status stays 'draft'". Both are wrong for an in-review doc, which actually changes status.

**Code**: `packages/lore/src/service/review-service.ts:950-1010` (`canReject` = draft|in-review; `store.update` to draft with no `insertVersion`; audit `details.reason`).

**CLI**:
```
$ lore reject knowledge-authored-note --reason "too thin"   -> exit=0
Rejected knowledge-authored-note (status remains: draft)
  Reason: too thin
$ lore get knowledge-authored-note --json   -> "status": "draft", "version": 2   (was v2 before the reject)
$ lore log knowledge-authored-note          -> only v1 create, v2 update (no reject row)
$ lore audit knowledge-authored-note --action reject
2026-10-09 05:20:15  probe-main  reject  {"reviewer":"probe-main","from_status":"in-review","to_st...
$ lore reject prd-probe-product --reason x  -> exit=4
Error: Cannot transition from 'approved' to 'draft'.
```

### 4 (area: corpus) (PROSE-vs-CODE discriminator)

**Answer**: No CLI, service or HTTP path brings a deleted document back. Delete only sets `deleted_at` and prints "Recoverable until <date+30d>". The doc disappears from `list` and `search`, but `lore get <slug>` still returns it (exit 0) and the text view gives no sign that it was deleted (only `--json` shows `deleted_at`). `lore restore <doc> <version>` succeeds on a deleted doc and writes a new version, but `deleted_at` stays set, so the doc stays deleted. Deleting the same doc a second time fails with **exit 1**: "Storage failure: UNIQUE constraint failed: versions.doc_id, versions.version" (suspected defect). Delete without `--confirm` is exit 4.

**Prose conflict**: `packages/lore/src/adapters/cli/commands/delete.ts:12` says "Soft-delete a document (recoverable for 30 days)". The 30 days is only a computed date (`packages/lore/src/service/corpus-service.ts:3218`). No code anywhere clears `deleted_at`: a grep for `undelete` finds nothing, and the only `deleted_at: null` writes are initial inserts and migrations.

**Code**: `packages/lore/src/service/corpus-service.ts:3195-3266` (delete; writes a versions row with sentinel `version: 0` at `:3236`, which is why the second delete collides); `packages/lore/src/store/sqlite-store.ts:968-975` (direct-address lookups deliberately do not filter `deleted_at`); `packages/lore/src/service/version-service.ts:197` (restore does not touch `deleted_at`).

**CLI**:
```
$ lore delete knowledge-temp-note           -> exit=4 "Deletion requires confirmation."
$ lore delete knowledge-temp-note --confirm -> exit=0 "Deleted 01M4FH6X... Recoverable until: 2026-11-08"
$ lore get knowledge-temp-note              -> exit=0, normal view, Status: draft
$ lore get knowledge-temp-note --json       -> "deleted_at": "2026-10-09T05:12:11.331Z"
$ lore list --type knowledge                -> "No documents found."
$ lore restore knowledge-temp-note 1        -> exit=0 "Restored ... from v1 → new version v2"; deleted_at unchanged
$ lore create knowledge --title "Twice Del" ...; lore delete knowledge-twice-del --confirm -> 0
$ lore delete knowledge-twice-del --confirm -> exit=1
Error: Storage failure: UNIQUE constraint failed: versions.doc_id, versions.version
```

### 5 (area: corpus) (PROSE-vs-CODE discriminator)

**Answer**: The doc's own record shows "system": `lore get` shows "Created: ... by system" and `lore log` shows author `system` for v1. `lore list --author alice` finds nothing ("No documents found."). "alice" appears only in the audit trail (`lore audit <doc>` shows actor `alice`, action `create`). CLI, MCP and bearer-token HTTP writes all stamp `created_by = "system"`. Only the dashboard's cookie-session writes put the real actor into `created_by`.

**Prose conflict**: `packages/lore/src/adapters/cli/commands/create.ts:237` says `--by` is the "Actor identity to attribute this create to". `packages/lore/src/adapters/cli/commands/list.ts:271` documents `--author` as "Filter by author (created_by)", which can never match a CLI-supplied actor.

**Code**: `packages/lore/src/service/corpus-service.ts:1666` (`created_by: opts?.attributeCreatedBy === true ? resolvedActor : "system"`); `corpus-service.ts:247-268` (`attributeCreatedBy` is wired only from HTTP cookie sessions); `packages/lore/src/adapters/http/auth.ts:446-466`.

**CLI**:
```
$ LORE_ACTOR=probe-env lore create knowledge --title "Authored Note" --sub-type reference --content x --by alice -> exit=0
$ lore get knowledge-authored-note   -> "Created: 2026-10-09 by system"
$ lore log knowledge-authored-note   -> v1 create system
$ lore audit knowledge-authored-note -> 2026-10-09 05:13:18  alice  create  {...}
$ lore list --author alice           -> "No documents found."
```

### 6 (area: product-baseline)

**Answer**: A refused rule does not use up a number: validation runs before allocation, and numbers are `MAX(n)+1` across a corpus-wide registry that is never reissued. Lifecycle only moves forward (live -> deprecated -> retired; live -> retired directly is allowed). Going back is refused with **exit 4** ("lifecycle is forward-only"). Retiring requires a note (without `--note` the refusal is exit 4). Moving a rule to another leaf keeps its BR number. A rule also needs 1-3 examples (exit 4 without one), and a leaf can only sit under a root or a branch (exit 4 under a leaf).

**Code**: `packages/lore/src/service/rule-service.ts:23-26` (allocation only through the registry, never reissued, validation before allocation, forward-only lifecycle, retire needs a note); `packages/lore/src/store/sqlite-store.ts:2073` (`SELECT COALESCE(MAX(n), 0) + 1 ... FROM rule_registry`).

**CLI**:
```
$ lore baseline add prd-probe-product --node root --label Product --title "Product Baseline" -> 0
$ lore baseline add baseline-auth-branch --node leaf --label Login --title "Login Leaf"       -> 0
$ lore baseline add baseline-login-leaf --node leaf ...  -> exit=4 "node=leaf requires a parent baseline with node root|branch (got leaf)"
$ lore rule add baseline-login-leaf --statement "...five failed logins" --confidence established --enforced-by guaranteed --example "6th try refused" -> "Added BR-1"
$ lore rule add baseline-login-leaf --statement "Passwords are never shown" --confidence observed --enforced-by both -> exit=4 "rule.examples: Array must contain at least 1 element(s)"
$ (same with --example "masked field")      -> "Added BR-2"   (refused attempt burned no number)
$ lore rule set BR-2 --lifecycle retired    -> exit=4 "lifecycle=retired requires --note"
$ lore rule set BR-2 --lifecycle retired --note obsolete -> exit=0 "Updated BR-2 [retired]"
$ lore rule set BR-2 --lifecycle deprecated -> exit=4 "cannot move retired -> deprecated; lifecycle is forward-only"
$ lore rule add baseline-direct-leaf ...    -> "Added BR-3"
$ lore rule set BR-1 --move-to baseline-direct-leaf -> exit=0 "Updated BR-1 [live] on baseline-direct-leaf"
```

### 7 (area: specification)

**Answer**: Adding a new criterion (`lore ac add`) leaves the spec approved: it logs a version but never changes status. Editing an existing criterion (`lore ac set`) demotes the spec to draft and prints a notice with the number of descendant task claims it now blocks. From then on every task claim under the spec fails with `UPSTREAM_NOT_APPROVED` (exit 4) until it is re-approved. A spec also cannot be approved with zero criteria at all (gate `spec-promote`, exit 4).

**Code**: `packages/lore/src/adapters/cli/commands/ac.ts:103-104` (`set` on an approved spec demotes it to draft); `ac.ts:128-136` (`ac add` "never changes status at all"); demotion rule `resolveStatusAfterContractEdit` (`@lore/core`).

**CLI**:
```
$ lore approve spec-login-flow --override-no-judgment (no ACs) -> exit=4 "Gate \"spec-promote\" blocked: NO_ACCEPTANCE_CRITERIA"
$ lore ac add spec-login-flow AC-LOGIN-1 --statement "User can log in" --mode human; approve -> approved (v4)
$ lore ac add spec-login-flow AC-LOGIN-2 --statement "Lockout after 5 tries" --mode human -> exit=0; status "approved"
$ lore ac set spec-login-flow AC-LOGIN-2 --statement "Lockout after 5 failed tries"      -> exit=0
Notice: this edit demoted spec "spec-login-flow" from approved to draft ... It now blocks 0 descendant task claim(s) until the spec is re-approved.
  -> status "draft"
(later, with 2 tasks: "It now blocks 2 descendant task claim(s)"; lore claim task-second-task -> exit=4 UPSTREAM_NOT_APPROVED)
```

### 8 (area: specification)

**Answer**: It is accepted (exit 0) and the spec stays approved: adding a code anchor does not demote it. `lore status --check-drift` then reports the anchor as `file_missing`, gives a fix hint (`lore anchor rm ...`) and exits **3**.

**Code**: `packages/lore/src/adapters/cli/commands/anchor.ts` (spec targets take `path[#Symbol]`); `packages/lore/src/adapters/cli/commands/status.ts:80` (drift findings, exit 3).

**CLI**:
```
$ lore anchor add spec-login-flow src/missing.ts -> exit=0 "Added 1 anchor(s) to spec-login-flow"
$ lore get spec-login-flow --json               -> "status": "approved"
$ lore status --check-drift                      -> exit=3
Code drift: 1 drift(s) (1 spec(s) + 0 knowledge doc(s) checked)
  - [spec] spec-login-flow → src/missing.ts (file_missing)
    fix: lore anchor rm spec-login-flow 'src/missing.ts' (or update the path/export)
```

### 9 (area: execution) (PROSE-vs-CODE discriminator)

**Answer**: The task needs two things:

1. At least one `pass` row that carries a runner `attestation`.
2. Because it declares the ACs it covers, red-first proof as well: an `expected-fail`/`fail` row, or the audited `--declare-no-new-tests "<reason>"` escape.

`lore verify` is NOT the only source of a pass that counts: `lore evidence --capture` (Lore runs the command itself) stamps `capture_source: runner` plus an attestation, and that clears `lore done`'s floor. A hand-typed tail with `--result pass` is refused at write time (exit 4). Done with no qualifying rows fails with exit 4. With a captured pass plus an expected-fail row, `lore done` walks approved -> active -> archived (exit 0).

**Prose conflict**: `packages/lore/src/service/task-workflow-service.ts:867` (the message `lore done` prints) says "`lore verify <plan>` — the SOLE issuer of `attestation`". The live run below archived a task whose only attested pass came from `lore evidence --capture`.

**Code**: `packages/lore/src/adapters/cli/commands/evidence.ts:639-650` (capture path stamps `capture_source: "runner"` + `capture_attestation`, promoted to `attestation`); `task-workflow-service.ts:251-266` (no-new-tests floor keyed on presence of `ac_scope`).

**CLI**:
```
$ lore evidence task-implement-login --oracle test --command "echo ok" --result pass --output-tail-file tail.txt -> exit=4
Error: ... a self-reported result "pass" is not provable by a hand-authored output_tail alone ... Retry with `--capture` ...
$ lore done task-implement-login -> exit=4 "... holds no `result:\"pass\"` evidence row ... (1) `lore verify <plan>` — the SOLE issuer of `attestation` ..."
$ lore evidence task-implement-login --oracle test --command "echo '1 passed'" --result pass --capture -> exit=0 (row has capture_source "runner" + attestation)
$ lore done task-implement-login -> exit=4 "declares extra.ac_scope (AC-LOGIN-1) with no \"expected-fail\"/\"fail\" evidence entry and no extra.red_first opt-in ..."
$ lore evidence task-implement-login --oracle test --command false --result expected-fail --output-tail-file red.txt -> exit=0
$ lore done task-implement-login -> exit=0 "task-implement-login archived (v7): approved -> active -> archived"
```

### 10 (area: execution)

**Answer**: B's claim is refused with **exit 5** (CLAIM_CONFLICT, the same family as a stale write): "Task ... is claimed by 'agent:a' (claimed 0m ago). Pass --steal (claim) or --force (release) to override, or wait for the lease to expire" (default lease 120 minutes). A draft plan does not block claiming: the task-claim gate checks the ancestor spec, not the plan, and a task in a draft plan was claimed with exit 0. If the governing spec is draft (for example just demoted by an AC edit), the claim is refused with **exit 4**, `UPSTREAM_NOT_APPROVED`.

**Code**: `packages/lore/src/adapters/cli/utils.ts:108-122` (CLAIM_CONFLICT -> 5); `packages/core/src/config.ts:408` (`claim_ttl_minutes` default 120); `packages/lore/src/service/gate-predicates.ts:295` (`UPSTREAM_NOT_APPROVED`); `lore gate --help` (task-claim: "when the task's plan has a spec-tier ancestor, it must be approved").

**CLI**:
```
$ lore claim task-implement-login --by agent:a   (plan-login-plan status: draft) -> exit=0 "Claimed ... by agent:a (v2)"
$ lore claim task-implement-login --by agent:b   -> exit=5
Error: Task 01M4FH9N... is claimed by 'agent:a' (claimed 0m ago).
  Pass --steal (claim) or --force (release) to override, or wait for the lease to expire.
$ lore ac set spec-login-flow AC-LOGIN-2 ...; lore claim task-second-task --by agent:c -> exit=4
Error: ... Gate "task-claim" blocked: UPSTREAM_NOT_APPROVED ... Parent spec: spec-login-flow — "Login Flow" (status: draft).
```

### 11 (area: execution)

**Answer**: No, it does the opposite. `lore red-first <task>` sets `extra.red_first: true`, and from then on `lore done` additionally requires an `expected-fail`/`fail` evidence row next to the attested pass. With only an attested pass, done is refused (exit 4). The declaration also turns off the `--declare-no-new-tests` escape, which applies only when red_first is not declared.

**Code**: `packages/lore/src/service/task-workflow-service.ts:251-266` (opt-in red-first floor; no-new-tests floor short-circuits when red_first is declared); `task-workflow-service.ts:817` (reads `extra.red_first`).

**CLI**:
```
$ lore claim task-second-task; lore evidence task-second-task --oracle test --command "echo '2 passed'" --result pass --capture -> 0
$ lore red-first task-second-task -> exit=0
Declared red-first test discipline on task-second-task (v4)
  `lore done task-second-task` now also requires an "expected-fail"/"fail" evidence row alongside the pre-existing passing one.
$ lore done task-second-task -> exit=4
Error: ... declares extra.red_first but holds no "expected-fail"/"fail" evidence entry ...
```

### 12 (area: session) (PROSE-vs-CODE discriminator)

**Answer**: It is refused with **exit 4**, but the message is a schema error: "Validation failed on field 'extra.handoff': knowledge sub_type 'handoff' requires a Zod-valid extra.handoff". It does NOT name `lore handoff`. The writer-identity guard that would print "may only be created via `lore handoff`" sits behind the schema check, which fires first. The same happens for `uat` ("requires a Zod-valid extra.uat") and `assessment`. The dedicated `lore handoff` command works, and its doc is created already `approved` (v1).

**Prose conflict**: `packages/lore/src/adapters/cli/commands/create.ts:108-113` says the guard "rejects ... with a VALIDATION_ERROR naming `lore handoff` as the sole legitimate writer ... so the service's own naming message is what the user sees". `.claude/rules/lore-corpus-workflow-close.md:7` and `assets/context/corpus-workflow-4-close.md:12` say the guard rejects "naming `lore handoff` as the sole writer". `assets/governance/seat-briefing.md:31` says the same.

**Code**: `packages/lore/src/service/corpus-service.ts:1169-1191` (writer-identity guard with the "may only be created via `lore handoff`" message, never reached from the CLI); schema check `knowledgeExtraSchema` superRefine (`packages/core/src/schemas.ts`).

**CLI**:
```
$ lore create knowledge --title "My handoff" --sub-type handoff --content x -> exit=4
Error: Validation failed on field 'extra.handoff': knowledge sub_type 'handoff' requires a Zod-valid extra.handoff
$ lore create knowledge --title U --sub-type uat --content x -> exit=4 "... requires a Zod-valid extra.uat"
$ lore handoff --by probe-main --plan plan-login-plan --decision "Login done@high" --next "Ship it" -> exit=0
Recorded handoff by probe-main
  Slug:   knowledge-handoff-probe-main
  Status: approved (v1)
```

### 13 (area: session)

**Answer**: Only a trailing `@` followed by 1-3 digits is parsed as a confidence (0-100). For "Login done@high" the whole string "Login done@high" is stored as the judgment, with no confidence: the resume view shows the confidence as "—" and no warning is printed. "Chose A@90" stores judgment "Chose A" with confidence 90 (exit 0). "@150" is refused with **exit 2** ("Number must be less than or equal to 100"). Leaving out `--next` is refused with **exit 2** (`next_steps` needs at least 1 element).

**Code**: `packages/lore/src/adapters/cli/handoff-input.ts:33-46` (`/^(.*)@(\d{1,3})$/`; non-matching input becomes the judgment only); `lore handoff --help` (`--decision "<judgment>[@<confidence 0-100>]"`).

**CLI**:
```
$ lore feed session-resume --handoff knowledge-handoff-probe-main -> exit=0
SCOPE: 1 decisions + 1 next steps = 2 items to account for
| KD1 | Login done@high | — |
$ lore handoff --by probe-x --decision "Chose A@90" --next n  -> exit=0
$ lore handoff --by probe-y --decision "Chose B@150" --next n -> exit=2
Error: invalid handoff payload — field 'key_decisions.0.confidence': Number must be less than or equal to 100
$ lore handoff --by probe-z --decision only -> exit=2
Error: invalid handoff payload — field 'next_steps': Array must contain at least 1 element(s)
```

### 14 (area: hygiene) (PROSE-vs-CODE discriminator)

**Answer**: It reports a pass on a file that does not exist: "CLAUDE.md: within budget (0 findings).", followed by an adoption line that claims "the file conforms". The exit code is **0**. No used/ceiling/remaining headroom line is printed (`headroom: []` in `--json`), so a missing file looks the same as a file that is within budget.

**Prose conflict**: `packages/lore/src/adapters/cli/commands/status.ts:1040` (help) says "always reporting used/ceiling/remaining headroom". The module header at `status.ts:15-16` says it "ALWAYS additionally reports used/ceiling/remaining headroom for every measured file". With no file, nothing is measured and nothing is reported, yet the verdict says "within budget".

**Code**: `packages/lore/src/adapters/real-memory-file-probe.ts:125-138` (`discoverMemoryFiles` silently skips a missing file, returning `[]`); `packages/lore/src/adapters/cli/claude-md-render.ts:196-199` (zero findings prints "within budget").

**CLI** (throwaway corpus with no CLAUDE.md; `test -f CLAUDE.md` printed NO_CLAUDE_MD):
```
$ lore status --check-claude-md -> exit=0
CLAUDE.md: within budget (0 findings).
WARN adoption=warn (mode_source=default): 0 finding(s) downgraded to advisory; the file conforms — promote with ...
$ lore status --check-claude-md --json -> "findings": [], "headroom": [], ...
```

### 15 (area: autonomy)

**Answer**: Retro is a "ledger" sub-type, as are assessment, handoff and uat. It is created already `approved` (v1) and never enters the review queue (`lore pending` hides ledger sub-types by default). An edit to its content first logs the usual "approved -> draft" update and then, in the same command, a second update re-approving it. So one edit adds **two** versions (v1 -> v3), and the doc ends `approved`. No "demoted to draft" notice is printed. A non-ledger doc such as a PRD ends in `draft` after the same edit, with the notice "(approved doc demoted to draft because content changed)".

**Code**: `packages/core/src/types.ts:278` (`isLedgerKnowledgeSubType`); `packages/lore/src/service/corpus-service.ts:1472-1475` (fast-track on create); `corpus-service.ts:2919-2935` (re-fast-track version `resetVersion + 1` on edit); `packages/lore/src/service/review-service.ts:553-554` (pending hides ledger docs).

**CLI**:
```
$ lore create knowledge --title "Sprint Retro" --sub-type retro --content "went ok" -> exit=0 "Status: approved (v1)"
$ lore set knowledge-sprint-retro --content "went ok, edited" -> exit=0 "Updated knowledge-sprint-retro → v3"
$ lore get knowledge-sprint-retro --json -> "status": "approved"
$ lore log knowledge-sprint-retro -> v3 update, v2 update, v1 create (same timestamp)
(control) $ lore set prd-probe-product --content "Hello world body edited" -> "Updated prd-probe-product → v3
  (approved doc demoted to draft because content changed)"; status "draft"
```

### 16 (area: issue-loop) (PROSE-vs-CODE discriminator)

**Answer**: Filing is refused with **exit 4** and nothing is sent. The message explains that `feedback.upstream` must be declared explicitly, either `vendor: true` (Lore's own GitHub intake) or `repo: "owner/repo"`, and that neither is a default because filing sends title, description, repro command and actor identity to GitHub. `--title`, `--description`, `--expected` and `--actual` are all required: leaving out `--description` is a usage error, exit 2. `lore issues` does not fail when upstream is unconfigured. It reads the local (cwd) corpus, exits 0 and prints "Corpus: <path>" with "(no open issue reports)".

**Prose conflict**: `packages/lore/src/adapters/cli/commands/issues.ts:542` (help) says it "reads the configured feedback.upstream corpus by default (--local reads this corpus)". With nothing configured it silently reads the local corpus. Only the module comment at `issues.ts:60-61` documents that fallback ("unconfigured, or `--local` passed → the cwd corpus").

**Code**: `packages/core/src/issue-report.ts:407` (unconfigured refusal message); `packages/lore/src/adapters/cli/commands/issues.ts:56-61`.

**CLI**:
```
$ lore report-issue --title t --expected e --actual a -> exit=2 "Usage error: missing required flag(s): --description."
$ lore report-issue --title "Delete twice fails" --expected e --actual a --description d -> exit=4
Error: Validation failed on field 'feedback.upstream': `feedback.upstream` is not configured — declare one of its two consent-bearing shapes ...
$ lore issues -> exit=0
Corpus: /private/tmp/.../xprobe/corpus.iDrHXq
(no open issue reports)
```

### 17 (area: distribution)

**Answer**: Re-running `lore init` in an existing project is refused with **exit 1** ("Lore project already initialised in this directory.") and leaves the existing corpus untouched. `lore governance claude-md` needs no corpus and works in an empty directory (exit 0). An unknown topic is exit 2. By contrast, corpus commands such as `lore list` fail with exit 1 outside a project. Dashboard (code reading only; a browser login cannot be run headless here): packaged mode is single-process. It mints a one-time nonce, prints `LORE_DASHBOARD_URL=<.../auth/bootstrap?nonce=...>` on stdout before opening the browser, and the API port defaults to 8787. The nonce is single-use with a default lifetime of **60 seconds**. A consumed, expired or unknown nonce gets HTTP **410** with an HTML failure page.

**Code**: `packages/lore/src/adapters/cli/commands/init.ts:59-64`; `packages/lore/src/adapters/cli/commands/dashboard.ts:5-7, 31-33, 288` (`parsePort(args["api-port"], "api-port", "8787")`); `packages/lore/src/adapters/http/static-serving.ts:96` (`DEFAULT_NONCE_TTL_MS = 60_000`), `:105-110, :327` (410 for consumed/expired/unknown).

**CLI**:
```
$ lore init (in existing corpus) -> exit=1 "Error: Lore project already initialised in this directory."
$ lore list --type prd -> still lists "Probe Product  approved"
(empty dir) $ lore governance claude-md -> exit=0 "<!-- lore claude-md-contract governance snippet ... --> <claude-md-contract> # CLAUDE.md Content Contract"
(empty dir) $ lore governance bogus -> exit=2 "unknown governance topic \"bogus\" (known topics: seat-briefing, claude-md, bootstrap-framing)"
(empty dir) $ lore list -> exit=1 "No Lore database found in this directory or any parent."
Dashboard: not run (code reading only).
```

### 18 (area: sync) (PROSE-vs-CODE discriminator)

**Answer**: Every ordinary CLI command ignores the sync section and silently works against the local SQLite file only. `lore list` exits 0 and `lore create prd ...` exits 0 and writes a local-only document, with no warning that sync credentials are missing. `lore sync status` just prints "Sync is enabled." and the remote URL. Only the sync commands check credentials: `lore sync push` and `lore sync pull` both fail with **exit 1**, "Sync credentials unavailable: ... Environment variable LORE_SYNC_TOKEN is not set or is empty". (The remote itself was not contacted; this was an offline run.)

**Prose conflict**: `CLAUDE.md:84` ("Store selection (D-007)") says "`sync.enabled` + `remote_url` + valid `LORE_SYNC_TOKEN` → `TursoStore` ... ⛔ No silent fallback: missing credentials → `err(VALIDATION_ERROR)` ... Offline writes must not land only-local." The CLI loader strips the `sync` section before calling `createApp`, so CLI writes always land local-only.

**Code**: `packages/lore/src/adapters/cli/loader.ts:12` ("loadLoreApp() strips the sync section — always returns App"), `loader.ts:399-403` (`const { sync: _sync, ...configWithoutSync } = rawConfig;`).

**CLI** (corpus D2, config `sync: {enabled: true, remote_url: libsql://example-probe.turso.io}`, run under `env -u LORE_SYNC_TOKEN`):
```
$ lore list -> exit=0 "No documents found."
$ lore create prd --title "Offline write" --content x -> exit=0 "Created prd document ... Slug: prd-offline-write"
$ lore sync status -> exit=0 "Sync is enabled. Remote URL: libsql://example-probe.turso.io  Token env var: LORE_SYNC_TOKEN"
$ lore sync push -> exit=1 "Error: Sync credentials unavailable: ... Environment variable LORE_SYNC_TOKEN is not set or is empty"
$ lore sync pull -> exit=1 (same message)
```

### 19 (area: sync)

**Answer**:

- **Unauthenticated access**: a request to `GET /api/docs` with no key, or with a wrong key, gets **401** with JSON `{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Invalid or missing API key"}}`. `GET /api/health` needs no key (200). A valid bearer key gets 200.
- **Attribution of API writes**: the audit trail records the key's agent name as the actor (`bot1`), but the doc's "Created by" is still `system` (same rule as Q5).
- **Revocation**: `lore agent revoke` takes effect on the running server immediately, with no restart; the very next request gets 401.
- **Key naming**: `agent create` takes the name as a flag (`--name bot1`; a positional name prints usage and exits 1). `agent revoke` takes it as a positional argument (`revoke bot1`; using `--name` exits 1, "Missing required positional argument: NAME").
- **Key display and duplicates**: the key is shown once ("cannot be retrieved again"). A duplicate name exits **1** with "VALIDATION_ERROR — Agent name 'bot1' already exists" (other commands map VALIDATION_ERROR to 4).

**Code**: `packages/lore/src/adapters/http/index.ts:191-196` (bearer auth, 401), `index.ts:238` (`/api/health` unauthenticated); `packages/lore/src/adapters/http/auth.ts:288` (revoke sets `revoked_at`), `auth.ts:23-24`; `packages/lore/src/adapters/cli/commands/agent.ts:17` (create `name` flag), `agent.ts:129-130` (revoke `name` positional); `packages/lore/src/adapters/http/auth.ts:33-39` (bearer writes pass `by: actor.name`, no `attributeCreatedBy`).

**CLI** (`lore serve --port 38917` on the throwaway corpus; key value redacted):
```
$ lore agent create --name bot1 -> exit=0 "Agent created: Name: bot1 API Key: <SECRET> ... Store this key securely — it cannot be retrieved again."
$ lore agent create --name bot1 -> exit=1 "Error: VALIDATION_ERROR — Agent name 'bot1' already exists"
curl /api/docs (no auth) -> 401 ; (Bearer nope) -> 401 ; (Bearer <key>) -> 200 ; /api/health (no auth) -> 200
POST /api/docs {"type":"knowledge","title":"Via HTTP",...} with key -> ok:true
$ lore audit knowledge-via-http -> "2026-10-09 05:18:28  bot1  create ..."
$ lore get knowledge-via-http   -> "Created: 2026-10-09 by system"
$ lore agent revoke --name bot1 -> exit=1 "[error] Missing required positional argument: NAME"
$ lore agent revoke bot1        -> exit=0 "Agent 'bot1' API key revoked."
curl /api/docs (Bearer <revoked key>) -> 401 immediately, still 401 after 2s; server not restarted
```

### 20 (area: context) (PROSE-vs-CODE discriminator)

**Answer**: The hand edit is NOT overwritten. Each managed section carries a content hash. A section whose body no longer matches its stored hash is reported as `diverged_skip` and left byte-for-byte untouched, while unedited sections are `unchanged`/`updated`. Hand-written text outside the managed zone is preserved as well. The command still prints "Wrote CLAUDE.md" and exits **0**, even though the file stayed byte-identical (diff empty). On the first refresh it also creates the five `.claude/rules/lore-corpus-workflow-*.md` files (init alone did not). Re-running `lore context init` on an existing CLAUDE.md is refused with **exit 4** and points to `refresh` or `--force`.

**Prose conflict**: the CLAUDE.md that `lore context init` generates says the managed sections "regenerate automatically via `lore context refresh` and should not be hand-edited" (`packages/lore/src/flows/context-flow.ts:150-154`, `SKELETON_NARRATIVE`). That implies refresh restores them, but a hand-edited section is never regenerated again.

**Code**: `packages/lore/src/service/context-projection.ts:390-403` (`resolveSection`: hash mismatch leads to `diverged_skip`, "leave it byte-for-byte untouched"); `context-projection.ts:136` (five splice states).

**CLI** (corpus D2):
```
$ lore context init --no-ai -> exit=0
Warning: no usable AI provider — writing a skeleton narrative placeholder ...
Wrote CLAUDE.md (narrative: skeleton)  module-index/command-table/governance-pointer/spec-discovery-pointer: appended
(hand-edit: command-table body -> "HAND EDITED LINE."; add "MY OWN RULE." above the placeholder; cp CLAUDE.md before.md)
$ lore context refresh -> exit=0
Wrote CLAUDE.md
  module-index: unchanged
  command-table: diverged_skip
  governance-pointer: unchanged
  spec-discovery-pointer: unchanged
  .claude/rules/lore-corpus-workflow-close.md: created   (… 5 files created)
$ diff before.md CLAUDE.md -> no output, exit 0
$ lore context init --no-ai -> exit=4
Error: Validation failed on field 'path': CLAUDE.md already exists — run `lore context refresh` to regenerate its managed sections, or pass --force ...
```
