---
id: SPEC-215
type: spec
role: spec
title: "Defect clusters round 2 part B: review, pending queue, corpus-scope guard, criterion tooling"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
---
## Overview/Goal

Defect clusters round 2, part B of 4: review, the pending queue, the corpus-scope guard and criterion tooling. The round closes 29 clusters (69 open GitHub issues in daniel1zz/lore plus 4 local reports) at their mechanism root; it is split in four specs so each is reviewed whole. Every root cause was read on main `f80a2933`; line numbers refer to that commit. Each Dn names its reports, the root cause and the END STATE. No group introduces a stopgap, a guard on an old design, a fallback, or a phased migration.

User decisions built in:
- D9: the document under review is never cut, and a judgment made on cut input cannot approve.

## Scope

### D9 — The judge sees the whole document under review, and a judgment on cut input cannot approve

- Reports: #34, #114.
- Root cause:
  - The template cuts the document body by byte prefix (packages/lore/src/ai/review-template.ts:18-31, :643).
  - F1 (86fd439f) records `truncated`/`truncation`, but `checkReviewJudgment` decides on decisions only (packages/lore/src/service/checkpoint-registry.ts:2180-2196), and the gate context (review-service.ts:510) carries no truncation. So an approve over unseen text certifies it (BR-269).
  - Baseline structured data omits rule `examples` and the leaf's `commands` (review-template.ts:405-411; schema packages/core/src/baseline.ts:109, :182).
- End state (decided):
  - The document under review is never cut; only context sections have budgets. A body the provider cannot take ends as an AI failure (exit 6, nothing recorded, BR-264).
  - `checkReviewJudgment` refuses approval on any judgment with `truncated: true` (`JUDGMENT_INPUT_TRUNCATED`, exit 4). A judgment on cut input can never be the approving record, including rows the old template already wrote.
  - Baseline rendering includes each rule's examples and the leaf's commands.
  - If the change lands as prompt v6, AC-DN5-1 ("current version is v5") is superseded through D15.

### D10 — Review command output states what happened

- Reports: #67, #71, #82.
- Root cause:
  - reject.ts:77 prints `status remains` from the post-write doc.
  - review-render.ts:74 prefixes `v` to an already-`v`-prefixed version (review-template.ts:102).
  - review.ts:552-554 returns 6 for any all-failed batch.
- End state:
  - Reject returns and prints `from_status` (`(in-review -> draft)` / `(status unchanged: draft)`).
  - The prompt version is printed verbatim.
  - The batch exit is the shared `exitCode` when every failure has the same code, else 1 with per-code counts.
  - A batch with at least one success and at least one failure exits with the same rule applied to its failures (shared code, else 1), and prints per-code counts; a batch with no failure exits 0.

### D11 — The review queue includes in-review documents and says what it hides

- Reports: #68, #93, #69 (folded in from help-text-drift: this group owns the files).
- Root cause:
  - `pending` queries `status: "draft"` only (packages/lore/src/service/review-service.ts:553-558).
  - The M3 filter silently empties `--type task` (:577-578; help pending.ts:54, :61-64).
  - The comments at pending.ts:14 and review-service.ts:566 say a draft never reaches archived, which `VALID_TRANSITIONS` contradicts for knowledge and task.
- End state:
  - `isPendingReviewDoc` (new pending-queue.ts) admits draft and in-review.
  - `--type task` (or a ledger type) without `--all` exits 2 naming `--all`. Help names the hidden classes.
  - The comments cite `VALID_TRANSITIONS` instead of restating it.

### D12 — The claim-scoped corpus guard is armed in the service layer for every adapter and every scoped write

- Reports: #57, #63, #72.
- Root cause:
  - The authority is armed only in the CLI loader (packages/lore/src/adapters/cli/loader.ts:550-557).
  - `authorizeCite` runs only for `ac cite` (ac-service.ts:569), not for add (:505) or set (:900-906), and it scans every baseline doc first (:394-418).
  - `addNode` and a baseline body `set` have no scope path (BR-618).
- End state:
  - `createApp` builds and arms the authority for all adapters.
  - Every cite-changing, node-creating or baseline-body write asks it. It decides "foreign crossing?" before any lookup and resolves rule→leaf through the registry index.
  - In-scope node creation and body edits succeed with a `corpus-scope-write` audit entry.

### D13 — A citation can be repaired without demotion, and the hint matches the refused action

- Reports: #135, #141.
- Root cause:
  - `findAcCiteViolations` re-checks every existing cite (packages/lore/src/service/gate-predicates.ts:474-490).
  - `buildCiteFeedingPack` suggests `lore ac add <slug>` even for a refused create (packages/lore/src/service/ac-cite-gate.ts:505-507; create path ac-write-chokepoint.ts:463-469).
- End state:
  - The gate judges the cites a write adds, plus "at least one live (or own-proposed) cite or an unexpired exemption after the write". `lore ac cite` repairs without demotion (BR-87).
  - A create refusal's hint re-runs `lore create spec`.

### D14 — A criterion detail that belongs to another mode is refused on add, as it is on set

- Reports: #29.
- Root cause: `buildCriterionCandidate` keeps oracle, command, timeout and falsifier only for script mode and silently drops them for ai/human (packages/lore/src/adapters/cli/commands/ac.ts:840-865). `ac set` refuses the same input (BR-24 vs BR-32).
- End state: the CLI passes every supplied field through. One strict per-mode verify schema (packages/core/src/acceptance.ts) refuses a foreign field with exit 4, naming the field and the mode, on add and set alike.

### D15 — A single criterion can be superseded by another spec's criterion and then stops verifying

- Reports: #154.
- Root cause: criteria have no superseded state (packages/core/src/acceptance.ts), and `lore verify` runs every criterion of a spec, warning only on non-approved specs (packages/lore/src/service/verify-runner-service.ts:1073-1077). A retired AC re-verifies green against new behaviour.
- End state:
  - An optional, immutable `superseded_by: {spec, ac, reason, by, at}` is written only by `lore ac supersede <spec> <AC> --by <spec2>:<AC2> --reason <r>`. The target must exist and not be the AC itself.
  - Superseding writes one version and never demotes.
  - A superseded AC refuses `ac set`, `ac rm` and a second supersede.
  - `ac list/get` render it, and `lore verify` skips it and lists it as superseded.
  - Lands early (wave 2) because D17 and D9 depend on it.

### D16 — Every ac_scope id must be a criterion the governing spec declares

- Reports: #225.
- Root cause:
  - Membership is checked only for plans (corpus-service.ts:1872-1906, :2965-3004).
  - Task create checks presence only (gate-predicates.ts:428; corpus-service.ts:2138-2175).
  - `editAcScope` checks nothing (packages/lore/src/service/task-workflow-service.ts:4552; phase-workflow-service.ts:1297).
- End state: one membership validator for task, phase and plan create, `scope add` and plan set. It refuses unknown ids with exit 4, naming them and the declared list.

### Citation notes

- D15: no live rule covers per-criterion supersession, which is a new capability. BR-163 is cited because verify's selection changes. A rule is added to baseline-declare-an-acceptance-criterion after landing.
- D19 cites debt-registry rules AD-1 and AD-2, which the fix retires.
- D23 cites BR-925 as modified (reads go through the selected store).
- Help/comment text folded into D11, D18 and D20 has no rule of its own. The ACs of those groups assert it alongside their cited behaviour.

## Acceptance Criteria

Structured ACs AC-DC2-9..AC-DC2-16 (`lore ac list`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-DC2-9: AI test double capturing the prompt; the pre-change document-section budget key set to 2,000 chars in the test config (the key no longer bounds the document under review; only context-section budgets remain). (a) A spec whose body is 4,000 chars: the captured prompt contains the body's last line verbatim (nothing of the document under review is cut, only context sections may be), and the recorded judgment has no `truncated` field. (b) A judgment row stored with `truncated: true` and decision approve on the spec's current version (the shape the old template wrote): `lore approve <spec>` exits 4, stderr contains `JUDGMENT_INPUT_TRUNCATED`, and the spec stays draft; adding a fresh untruncated approve judgment for the same version lets `lore approve` exit 0. (c) A body larger than the provider limit (double reports a context-limit error): `lore review` exits 6 and records no judgment. (d) A baseline leaf whose rules carry examples and whose leaf declares commands: the captured prompt contains every example string and every command string. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a body under the budget (nothing to cut, so a cutting template passes); an approve gate tested only with untruncated judgments (passes without the new reason); a baseline leaf whose rules carry no examples. The fixture sets a small budget, a truncated row, and real examples and commands. Made red once by restoring truncateSection on the document-under-review section in review-template.ts.
  script: test — bun run test:file packages/lore/tests/integration/dc2-review-judge-input.bun.test.ts && echo 'AC-DC2-9 PASS: document under review never cut; truncated judgment cannot approve; examples and commands rendered'
  other_command=1
- [⚑] [script] AC-DC2-10: (a) `lore reject` on an in-review doc exits 0 and stdout contains `(in-review -> draft)` and not `remains`; on a draft doc stdout contains `(status unchanged: draft)`; `--json` `.data.from_status` is `in-review` / `draft`. (b) A judgment rendered by review-render shows `prompt ` followed by REVIEW_PROMPT_VERSION verbatim, and the output never contains `vv`. (c) `lore review --pending` where every doc fails with VALIDATION_ERROR exits 4; every doc fails with AI_PROVIDER_ERROR exits 6; one of each exits 1 and stderr lists `VALIDATION_ERROR: 1` and `AI_PROVIDER_ERROR: 1`. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a judgment whose stored prompt_version is a bare number (the prefix looks right); an all-AI-failure batch (6 is correct today). The test uses the real constant and a non-AI failure batch. Made red once by restoring `return 6` for any all-failed batch in review.ts.
  script: test — bun run test:file packages/lore/tests/integration/dc2-review-cli-output.bun.test.ts && echo 'AC-DC2-10 PASS: reject names the transition; prompt version printed once; batch exit reflects failure codes'
- [⚑] [script] AC-DC2-11: Throwaway corpus with an in-review spec S, a draft spec, and a draft task T. (a) `lore pending --json` lists S and the draft spec; `lore review --pending` (AI test double) judges S. (b) `lore pending --type task` exits 2 and stderr names `--all`; `lore pending --type task --all --json` lists T. (c) `lore pending --help` names the hidden classes (tasks, ledger records, invalidated). (d) #69: the source of pending.ts and review-service.ts contains no `never transitions to \`archived\`` and no `no draft->archived`; both name `VALID_TRANSITIONS` instead, and a knowledge draft moved to archived through `lore set --status archived` exits 0 (the comment's subject). SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a fixture with no in-review document. The fixture moves S to in-review first. Made red once by removing `in-review` from isPendingReviewDoc.
  script: test — bun run test:file packages/lore/tests/integration/dc2-pending-queue.bun.test.ts && echo 'AC-DC2-11 PASS: in-review docs queued and judged; --type task without --all exits 2; archive comments cite VALID_TRANSITIONS'
  other_command=1
- [·] [script] AC-DC2-12: Throwaway repo + corpus with a linked worktree W and a claim from W with `--corpus-scope <branch-B>`. From W: (a) MCP `lore_rule_add` on a leaf under another branch is refused with the same token as CLI `lore rule add` (exit 4); on a leaf under B it is accepted. (b) `lore ac add S AC-X ... --cite BR-out` and `lore ac set S AC-1 --cite BR-out` (BR-out on a leaf outside B) exit 4; with an in-scope rule they pass the scope check. (c) `lore baseline add <B> --node leaf --label T --title X` and `lore set <B-leaf> --content-file f` exit 0, each with one audit entry `corpus-scope-write`; outside B both exit 4. (d) From the main checkout, `lore ac cite S AC-1 BR-in` performs zero `findMany({type: "baseline"})` calls (store spy). SIMPLEST GREEN-BUT-BROKEN CASE (asserted): running the MCP and cite cases from the main checkout (no foreign crossing, so an unarmed service passes). Every refusal case runs from W. Made red once by moving the authority arming back from createApp into the CLI loader.
  script: test — bun run test:file packages/lore/tests/integration/dc2-corpus-scope-guard.bun.test.ts && echo 'AC-DC2-12 PASS: scope guard armed for MCP and ac add/set cite; baseline add and body set allowed in scope'
- [⚑] [script] AC-DC2-13: Throwaway corpus, citation gate enforce on an armed branch. Approved spec S whose AC-1 cites BR-r, then BR-r retired. (a) `lore ac cite S AC-1 BR-live` exits 0 and S stays approved; then `lore ac cite S AC-1 BR-r --remove` exits 0, AC-1 cites [BR-live], and S stays approved. (b) `lore ac cite S AC-1 BR-r2` (another retired rule) exits 4 with AC_CITE_REQUIRED naming BR-r2. (c) Removing BR-live from an AC whose other cite is retired exits 4. (d) `lore create spec` with an uncited inline criterion exits 4; its `Cite one:` line starts with `lore create spec`, and `lore get <would-be-slug>` exits 3. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): an AC citing only live rules (cite add/remove pass today); a create refusal checked only for exit 4. The fixture retires a cited rule and checks the hint text. Made red once by making findAcCiteViolations iterate every existing cite again.
  script: test — bun run test:file packages/lore/tests/integration/dc2-ac-cite-gate.bun.test.ts && echo 'AC-DC2-13 PASS: retired cite repaired via ac cite without demotion; create refusal hint re-runs create'
- [⊘] [script] AC-DC2-14: Throwaway corpus, spec S. (a) `lore ac add S AC-H --statement s --mode human --note n --falsifier-path a.ts --falsifier-find x --falsifier-replace y --falsifier-exit-code 1` exits 4, stderr names `falsifier` and the mode `human`, and `lore ac list S --json` has no AC-H. (b) `lore ac add S AC-A --mode ai --rubric r --command c` exits 4 naming `command` and `ai`; `--mode human --note n --timeout-ms 5` exits 4 naming `timeout`. (c) The same inputs through `lore ac set` on an existing human criterion are refused with the same message text (add and set share one validator). (d) A valid `--mode script` add with all four falsifier flags exits 0 and stores the falsifier. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): testing only `--timeout-ms` (already refused on add, ac.ts:826) or only `ac set` (already refuses). The test uses the falsifier flags on add. Made red once by restoring the mode-specific field filtering in buildCriterionCandidate (ac.ts) so a human criterion drops the falsifier again.
  script: test — bun run test:file packages/lore/tests/integration/dc2-ac-falsifier-refusal.bun.test.ts && echo 'AC-DC2-14 PASS: mode-foreign falsifier, command or timeout refused on ac add exit 4'
  other_command=1
- [⚑] [script] AC-DC2-15: Throwaway corpus, approved specs S (AC-1, AC-2 script) and S2 (AC-9). (a) `lore ac supersede S AC-1 --by S2:AC-9 --reason r` exits 0; `lore ac list S --json` shows AC-1 `superseded_by` = {spec: S2 id, ac: AC-9, reason: r, by, at}; S stays approved and gains one version and one audit entry. (b) `lore verify` on S's plan records no evidence row for AC-1, records AC-2 normally, and lists AC-1 under superseded. (c) `lore ac set S AC-1 --statement z` and `lore ac rm S AC-1` exit 4 naming `superseded`; a second supersede of AC-1 exits 4. (d) `--by S2:AC-404` exits 4 naming AC-404; `--by S:AC-1` (self) exits 4; a missing `--reason` exits 2. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): checking supersession only through `ac list` (verify would still run and pass the old command). The test runs verify and counts evidence rows per criterion. Made red once by removing the superseded filter from verify-runner-service.ts's criterion selection.
  script: test — bun run test:file packages/lore/tests/integration/dc2-ac-supersede.bun.test.ts && echo 'AC-DC2-15 PASS: superseded AC excluded from verify, immutable, no demotion'
  other_command=1
- [·] [script] AC-DC2-16: Throwaway corpus: spec S declares script criteria AC-1 and AC-2; plan P under S. (a) `lore create task --plan-id P --title t --ac-scope "AC-1 AC-2"` exits 4, stderr names the unknown id `AC-1 AC-2` and the declared list [AC-1, AC-2], and no task is created. (b) `lore create task --plan-id P --title t --ac-scope AC-1 --ac-scope AC-2` exits 0. (c) `lore scope add T AC-404` exits 4 with the same message shape and T's scope is unchanged; `lore scope add T AC-2` exits 0. (d) The same check refuses for a phase document and for an `--adhoc` task whose scope names an id its spec does not declare. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a spec with no script-mode criteria (the requiredness gate is vacuous, so any id passes). The fixture declares script criteria. Made red once by removing the membership check from the task-create path.
  script: test — bun run test:file packages/lore/tests/integration/dc2-ac-scope-check.bun.test.ts && echo 'AC-DC2-16 PASS: unknown ac_scope ids refused exit 4 on create and scope add'
