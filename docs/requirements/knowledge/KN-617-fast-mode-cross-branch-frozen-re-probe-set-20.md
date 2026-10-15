---
id: KN-617
type: knowledge
role: knowledge
title: "Fast-mode cross-branch frozen re-probe set: 20 questions after attempt 1"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: PLAN-176
---
Frozen cross-branch re-probe set (20 questions), all 12 areas. Each answer verified by code reading and CLI run against a throwaway corpus where possible. Do not edit after creation.

Evidence conventions (apply to every answer below):
- Throwaway corpus: `mkdir -p .../scratchpad/xprobe2 && D=$(mktemp -d .../scratchpad/xprobe2/corpus.XXXXXX); cd "$D"; git init; lore init` -> `corpus.1JZQ2m`. Never the repo, never the real HOME.
- The CLI was run from source (`bun /Users/apple/Projects/zz/lore/packages/lore/src/index.ts`), because `dist/lore` was built 10 minutes before HEAD (a248efe0). The wrapper refused to run outside xprobe2/, set `HOME=xprobe2/home`, and pinned `LORE_ACTOR=agent:probe`. stdin was closed. Exit codes were measured without a pipe.
- The `serve` probe used port 39417 on 127.0.0.1 and was killed afterwards. Port 8787 and remote endpoints were never contacted.
- Code paths are relative to `/Users/apple/Projects/zz/lore/packages/`. Prose paths are relative to the repo root.
- Exit-code map (lore/src/adapters/cli/utils.ts:93-128): 3 = not found / check failed, 4 = validation, invalid transition or gate denial, 5 = write contention, 2 = usage error.

## Questions

1. Can a document be linked to itself? Does it matter which kind of link it is, and does the built-in link-health evaluation notice?
2. Besides ideation, retro, research and reference, which other kinds of knowledge note can a person create directly with the ordinary create command?
3. In the product-baseline tree, can a branch hang directly under a PRD? Can one PRD carry two baseline roots?
4. A specification criterion claims to cover requirement R-99, but the PRD never declared R-99. Is the claim refused, and does the requirement-coverage check flag it?
5. How much structure must a new specification's body have before the creation gate accepts it? Are vaguely worded specs ("it works and supports everything") turned away?
6. If you attach a shell command to a criterion that is checked by a human, what happens when you add it? What happens when you edit it later?
7. Once a document is moved to "in review", does it still show up in the pending-review queue?
8. When an AI agent's terminal is the caller, a surface where AI is off by default, does the review command still call the AI judge? What happens if the agent explicitly says "no AI"?
9. When must a new task declare which acceptance criteria it covers? Is a criterion id that the specification does not have rejected?
10. A test run passed and its output was saved to a file. Can an agent record that pass by handing over the saved file?
11. A task was claimed without naming a working directory. Later, from inside a git checkout, the agent records a passing result. Is that let through as "could not measure", or refused?
12. Can a plan seat (a dedicated worktree) be opened on something that is not a plan, such as the PRD?
13. Does running the session start-up summary change anything stored in the project? How does that compare with reading a single document?
14. Which actions show up in the usage trace, and how does running the link-health evaluation affect the "never-read documents" figure?
15. In a brand-new project, what does asking for the spec-creation feed (with the intended parent) give you before you write your first spec?
16. With no upstream issue tracker configured, which project's issue reports does the issue listing show, and does it say so?
17. Can the project-level setup be previewed without writing anything? Can an agent run setup unattended?
18. Which HTTP API addresses answer without any credentials?
19. When an AI agent initializes the project memory file, it prints "no usable AI provider". Was AI actually tried? What happens if it is run again on a project that already has the file?
20. If someone edits or deletes rows of the audit trail directly in the database, does the audit verification notice, and with what exit code?

## Answers and evidence

### 1 (area: corpus)

**Answer**: It depends on the link kind. A non-parent self-link (relates-to, informs, and so on) is accepted, exit 0, because the link write path has no self-reference check. A parent self-link is refused as a cycle, exit 4 ("Link would create a cycle"). The link-health evaluation (`lore eval links`) reports a live self-link as a self-loop and fails with exit 1. Caveat: the evaluation only walks live documents, so a self-link on an invalidated document is invisible to it (it reported 0 links in that case).

**Code**:
- lore/src/service/corpus-service.ts:4606-4700 (`_linkImpl`): type-contract checks only for `parent` and `resolves`, and no from === to check.
- lore/src/store/sqlite-store.ts:1282-1284 runs the cycle detection for parent links only. lore/src/store/store-shared.ts:715-716 returns `LINK_CYCLE` when fromId === toId.
- lore/src/eval/scenarios/link-integrity.ts:118-155 iterates `corpusService.list({})`, which excludes invalidated docs. Line 172 is the self-loop detection.
- lore/src/adapters/cli/commands/eval.ts:67/90 sets `exitCode = passed ? 0 : 1`.

**CLI**:
```
$ lore link knowledge-prompt-note knowledge-prompt-note --type informs   -> Linked ... (informs)            [exit=0]
$ lore link prd-probe-product prd-probe-product --type parent           -> Error: Link would create a cycle  [exit=4]
$ lore eval links   -> Self-loops: 1 ... "--[informs]--> itself" ... Result: FAILED                    [exit=1]
(earlier, self-link only on an invalidated doc) $ lore eval links -> Total links: 0 ... PASSED          [exit=0]
```

### 2 (area: corpus) (PROSE-vs-CODE discriminator)

**Answer**: Nine kinds are valid in total. Besides the four named, there are assessment, prompt, skill, handoff and uat. `prompt` and `skill` can be created directly, exit 0. assessment, handoff and uat pass the kind check but are refused (exit 4) unless their structured payload is present. For example, `--sub-type assessment` gives "knowledge sub_type 'assessment' requires a Zod-valid extra.assessment". The create help itself lists all nine.

**Prose**: CLAUDE.md:131 says "`knowledge` requires `extra.sub_type` (`ideation | retro | research | reference`)", which names only 4 kinds. A code comment repeats the same 4: lore/src/adapters/cli/commands/create.ts:6.

**Code**:
- core/src/types.ts:222-232 (`KNOWLEDGE_SUB_TYPES`, 9 members).
- core/src/schemas.ts:130 (enum) and :198-214 (assessment and handoff payload requirements).
- lore/src/adapters/cli/commands/create.ts:185 (help lists all 9).

**CLI**:
```
$ lore create knowledge --title "Prompt Note" --sub-type prompt --content p   -> Created knowledge document ... draft (v1)  [exit=0]
$ lore create knowledge --title "Ledger Note" --sub-type assessment --content x
  -> Error: Validation failed on field 'extra.assessment': knowledge sub_type 'assessment' requires a Zod-valid extra.assessment  [exit=4]
```

### 3 (area: product-baseline)

**Answer**: No branch can sit directly under a PRD. Only a root node takes a PRD parent, while branch and leaf nodes need a baseline root or branch parent, so the attempt is refused with exit 4. One PRD can carry two (or more) baseline roots: nothing enforces uniqueness, and both creations exit 0 and both appear in `lore baseline tree`.

**Code**: core/src/baseline.ts:127-149 (`validateBaselineParent`). Line 132-135: root requires a prd parent. Line 136-146: branch and leaf require a baseline parent whose node is root or branch. No sibling or uniqueness check exists.

**CLI**:
```
$ lore baseline add prd-probe-product --node branch --label B --title "Direct Branch"
  -> Error: Validation failed on field 'parent': node=branch requires a baseline parent (got prd)  [exit=4]
$ lore baseline add prd-probe-product --node root --label R  --title "Root Node"    -> Created baseline root ...  [exit=0]
$ lore baseline add prd-probe-product --node root --label R2 --title "Second Root"  -> Created baseline root ...  [exit=0]
$ lore baseline tree -> "root R (baseline-root-node, draft)" / "root R2 (baseline-second-root, draft)"            [exit=0]
```

### 4 (area: product-baseline)

**Answer**: It is not refused: `ac add ... --covers R-99` succeeds with exit 0 and stores `requirement_refs: ["R-99"]`. The coverage check never flags it either. `lore status --check-requirements` only walks the PRD's declared requirements and asks whether some spec criterion references each one, so unknown references are ignored. With R-1 (P0) covered by another criterion the check reports "all P0 requirements covered" with exit 0. Before R-1 was covered it exited 3. An uncovered P1 or P2 never fails the check. Requirement ids themselves are validated: a duplicate id or a malformed id ("req1") is exit 4.

**Code**:
- lore/src/service/corpus-service.ts:4013-4027 (gathers refs from child specs and calls `computeRequirementCoverage`).
- core/src/requirement.ts:110-127 (loops over declared requirements only, with no unknown-ref output) and :138-140 (exit 3 iff an uncovered P0 exists).

**CLI**:
```
$ lore requirement add prd-probe-product R-1 --statement "Users can sign in" --priority P0   [exit=0]
$ lore requirement add prd-probe-product R-1 ...   -> Duplicate requirement id "R-1"         [exit=4]
$ lore requirement add prd-probe-product req1 ...  -> Requirement id must match R-<SEGMENT>... [exit=4]
$ lore status --check-requirements -> UNCOVERED P0 ... R-1                                    [exit=3]
$ lore ac add spec-sign-in-spec AC-SI-2 --statement "covers ghost" --mode human --covers R-99 -> Added ... [exit=0]
$ lore ac add spec-sign-in-spec AC-SI-5 --statement "covers R1" --mode human --covers R-1     -> Added ... [exit=0]
$ lore ac list spec-sign-in-spec --json -> AC-SI-2 "requirement_refs": ["R-99"], "dangling": []
$ lore status --check-requirements -> Requirement coverage: all P0 requirements covered (1 PRD(s) checked).  [exit=0]
```

### 5 (area: specification) (PROSE-vs-CODE discriminator)

**Answer**: The body needs just one level-2 markdown heading (any line starting with `## `). Any heading works: a body of `## Notes` followed by "It works and supports everything." was accepted, exit 0. A body with no `## ` heading is refused with exit 4 (`gate:spec-create`, MISSING_SKELETON). The parent must be a PRD: a knowledge parent gives exit 4. Vague wording is not checked at all.

**Prose**:
- packages/dashboard/CLAUDE.md:55 says e2e fixtures "must supply `## Overview/Goal` / `## Scope` / `## Acceptance Criteria` headings — the spec-create gate denies content-less specs".
- The rule text the gate itself prints on denial (lore/src/service/corpus-service.ts:189-193) says "Content must include at minimum: `## Overview/Goal`, `## Scope`, `## Acceptance Criteria`" and "vague verbs ("works", "support") are rejected".

**Code**: lore/src/service/gate-predicates.ts:220 (`SKELETON_HEADING_PATTERN = /^##\s/m`) and :234-239 (`hasSkeleton`, a single heading is enough). No vague-verb predicate exists anywhere in lore/src or core/src (grep for "vague verbs" finds only the prose constant).

**CLI**:
```
$ lore create spec --title "Sign In Spec" --parent prd-probe-product --content "spec body"
  -> Gate "spec-create" blocked: MISSING_SKELETON ... (prints the 3-heading / vague-verb rule text)   [exit=4]
$ lore create spec --title "Sign In Spec" --parent prd-probe-product --content $'## Notes\nIt works and supports everything.'
  -> Created spec document ... spec-sign-in-spec draft (v1)                                        [exit=0]
$ lore create spec --title "Under Knowledge" --parent knowledge-prompt-note --content "## Notes"
  -> Invalid parent type for 'spec'. ... Allowed parent types: prd                                   [exit=4]
```

### 6 (area: specification)

**Answer**: Add and edit disagree. On add, the command is silently thrown away: the criterion is created as plain human mode, exit 0, no warning, and `ac list --json` shows `"verify": {"mode": "human"}` with no command. On edit (`ac set --command` against a human criterion), the same mismatch is refused with exit 4: `--command only applies to a "script"-mode criterion — "AC-SI-4" is mode "human"`.

**Code**:
- lore/src/adapters/cli/commands/ac.ts:742-746 (add, human branch: keeps only `note` and drops `command` and `oracle`).
- lore/src/service/ac-service.ts:1400 (set: mode-inconsistent flag refusal). The ac.ts header at :100-101 documents the exit 4 for `set` only.

**CLI**:
```
$ lore ac add spec-sign-in-spec AC-SI-4 --statement "human with command" --mode human --command "true"
  -> Added acceptance criterion "AC-SI-4" ... AC-SI-4 — human with command [human]          [exit=0]
$ lore ac list spec-sign-in-spec --json -> {"id":"AC-SI-4", ..., "verify": {"mode": "human"}}
$ lore ac set spec-sign-in-spec AC-SI-4 --command true
  -> Error: Validation failed on field 'verify': --command only applies to a "script"-mode criterion — "AC-SI-4" is mode "human"  [exit=4]
```

### 7 (area: review)

**Answer**: No. The pending queue lists only documents whose status is exactly `draft`. A document moved to `in-review` drops out of `lore pending` and stays out under `--all`, because `--all` only re-adds tasks and ledger knowledge notes. In the probe the queue went from 5 to 4 entries. By default the queue also hides tasks, ledger notes (assessment/retro/handoff/uat) and invalidated drafts.

**Code**: lore/src/service/review-service.ts:525-527 (store filter `status: "draft"`), :544-547 (excludes invalidated docs), :553-554 and :1055-1057 (hides tasks and ledger notes unless `all`).

**CLI**:
```
$ lore pending        -> lists spec-sign-in-spec + 4 others ... "5 pending documents"    [exit=0]
$ lore set spec-sign-in-spec --status in-review -> Updated spec-sign-in-spec → v6        [exit=0]
$ lore pending        -> spec-sign-in-spec absent ... "4 pending documents"              [exit=0]
$ lore pending --all  -> spec-sign-in-spec still absent ... "4 pending documents"        [exit=0]
```

### 8 (area: review) (PROSE-vs-CODE discriminator)

**Answer**: Yes, it still calls the AI judge. The built-in "AI off" default for agent surfaces does not stop `lore review`. Only an explicit config override (`ai.default_per_surface.<surface>: false`) brakes it, with exit 2 and "Pass --ai to override". With `--no-ai`, review always exits 2 ("lore review requires AI; --no-ai is a contradiction"), apart from the read-only `--staleness --list` mode. In the probe, CLAUDECODE=1 plus plain `lore review` invoked the claude-cli provider, which failed in the isolated HOME, giving exit 6.

**Prose**: CLAUDE.md:138 says "AI is ON for human surfaces ... and OFF for agent surfaces (`agent` — signalled by `CLAUDECODE=1` ...), `mcp`, `http_token`) ... Override per call with `--ai` / `--no-ai`".

**Code**:
- lore/src/adapters/cli/commands/review.ts:45-48 (the per-surface default "does NOT brake either path").
- review.ts:333-337 (the `--no-ai` exit 2) and :351-361 (brake only when `isAssessAiBraked`).
- lore/src/ai/resolve-ai.ts:130-132 (`source === "config" && !ai`).

**CLI** (env CLAUDECODE=1):
```
$ lore review spec-sign-in-spec --no-ai -> Error: lore review requires AI; --no-ai is a contradiction. Omit the flag to proceed.  [exit=2]
$ lore review spec-sign-in-spec         -> Error: AI provider "claude-cli" failed. ... This command has no non-AI fallback.    [exit=6]
```

### 9 (area: execution)

**Answer**: Declaring covered criteria becomes mandatory once the task's plan sits under a spec that declares at least one script-mode (machine-run) criterion. It is also always mandatory for ad-hoc tasks. Omitting the declaration is then refused at creation with exit 4 (gate reason AC_SCOPE_REQUIRED). An explicitly empty declaration (`--ac-scope ""`) is accepted as "claims nothing". When the spec has only human or AI criteria, omitting it is fine (exit 0). The ids are not checked against the spec: `--ac-scope AC-NOPE-9` (not declared anywhere) is accepted with exit 0 and no warning, and `lore scope list` shows it.

**Code**: lore/src/service/gate-predicates.ts:417-431 (`acScopeRequiredAtCreate`: vacuous without a spec ancestor or with 0 script criteria; presence of the key, even an empty one, satisfies it; no membership check).

**CLI**:
```
(spec has only human criteria) $ lore create task --title "Scopeless Task" --plan-id plan-sign-in-plan --parent plan-sign-in-plan --content x  [exit=0]
$ lore ac add spec-sign-in-spec AC-SI-6 --statement "exit zero" --mode script --oracle other --command "true"   [exit=0]
$ lore create task --title "Scopeless Two" ...                    -> Missing: - AC_SCOPE_REQUIRED ...   [exit=4]
$ lore create task --title "Empty Scope" ... --ac-scope ""        -> Created task document                [exit=0]
$ lore create task --title "Ghost AC Three" ... --ac-scope AC-NOPE-9 -> Created task document (no warning) [exit=0]
$ lore scope list task-ghost-ac-three -> "1. AC-NOPE-9"                                                  [exit=0]
```

### 10 (area: execution) (PROSE-vs-CODE discriminator)

**Answer**: No. A self-reported `pass` with a hand-supplied tail is refused with exit 4, whether it comes through `--output-tail` or `--output-tail-file` (even one containing "Tests 3 passed"). The message reads 'a self-reported result "pass" is not provable by a hand-authored output_tail alone'. Only two ways are accepted: `--capture`, where lore runs the command itself and records `capture_source: runner`, or `--oracle manual` with a non-empty description. A hand-supplied tail is still accepted for `fail` and `expected-fail`.

**Prose**: .claude/rules/lore-corpus-workflow-execute.md:10 says "Oracle passes → `lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual> --command "<cmd>" --result pass`. Give every row a REAL captured tail via `--output-tail-file <the file you redirected the run into>`".

**Code**: lore/src/service/task-workflow-service.ts:1440-1466 (`rejectMissingPassOutputTail`: passes only for a non-pass result, for `captureSource === "runner"`, or for manual with a non-empty tail).

**CLI**:
```
$ lore evidence task-login-task --oracle test --command true --result pass --output-tail-file xprobe2/tail.txt   ("Tests 3 passed")
  -> Error: Validation failed on field 'output_tail': a self-reported result "pass" is not provable by a hand-authored output_tail alone ...  [exit=4]
$ lore evidence task-login-task --oracle other --command true --result expected-fail --output-tail "1 failed" -> Recorded ... (expected-fail) [exit=0]
$ lore evidence task-login-task --oracle other --command "echo 1 passed" --result pass --capture -> Recorded other evidence (pass) ... [captured in 3ms ...] [exit=0]
```

### 11 (area: execution) (PROSE-vs-CODE discriminator)

**Answer**: It is refused with exit 4. When a claim exists but recorded no working directory, and the evidence call runs from inside a real git repository, `lore evidence --result pass` refuses ("its claim recorded NO worktree, but this call is running from inside a git repository"). It is let through only when there is no claim at all, or when the caller is not inside a git repo. Relatedly, when the claim did record a directory and that directory has uncommitted changes (even an untracked new file), the pass is refused with exit 4. After cleaning up, the same pass records with exit 0.

**Prose**: .claude/rules/lore-corpus-workflow-execute.md:9 says "When the guard cannot measure (no recorded worktree, not a git repo) it records a distinct not-measured value and lets the call through".

**Code**: lore/src/service/task-workflow-service.ts:3954-3976 (no claim means proceed; a claim with no worktree plus a caller inside a git repo calls `buildNoWorktreeMismatchRefusal`, defined at :1861). :3979-3983 is the dirty-worktree refusal.

**CLI**:
```
$ lore claim task-scopeless-task                     -> Claimed task-scopeless-task by agent:probe (v2)  [exit=0]
$ lore evidence task-scopeless-task --oracle other --command "echo 1 passed" --result pass --capture
  -> Refused: ... its claim recorded NO worktree, but this call is running from inside a git repository (...)  [exit=4]
$ lore claim task-login-task --worktree <corpus dir>; echo dirty > dirty.txt
$ lore evidence task-login-task ... --result pass --capture -> Refused: ... has uncommitted change(s): dirty.txt  [exit=4]
$ rm dirty.txt; same command -> Recorded other evidence (pass) on task-login-task (v4)                         [exit=0]
```

### 12 (area: session)

**Answer**: Yes. This is a defect. `lore seat <PRD slug>` is not type-checked: on a clean checkout it prints "Entered seat for plan prd-probe-product", creates branch `plan/prd-probe-product` and a sibling worktree `<repo>-seat-prd-probe-product`, and exits 0. `lore seat list` then shows it as an active seat. The only refusal seen came earlier, from a dirty main checkout (`gate:seat-entry:dirty-main`, exit 4). That check runs before anything that could notice the target is not a plan.

**Code**:
- lore/src/service/seat-service.ts:191-224 (`enter`: resolve any doc, then isDirty, rebase, ready report, worktreeAdd; no `type === "plan"` check). :160-164 computes the sibling path.
- lore/src/adapters/cli/commands/seat.ts:145 (success message).

**CLI**:
```
(dirty checkout) $ lore seat prd-probe-product -> Seat entry blocked: main checkout ... has uncommitted changes  [exit=4]
(after commit)   $ lore seat prd-probe-product
  -> Entered seat for plan prd-probe-product: .../corpus.1JZQ2m-seat-prd-probe-product (plan/prd-probe-product)  [exit=0]
$ lore seat list -> Active seats (1): - plan/prd-probe-product — created ... [merged]                             [exit=0]
$ git worktree list -> ...corpus.1JZQ2m-seat-prd-probe-product 5313cd9 [plan/prd-probe-product]
```

### 13 (area: session)

**Answer**: No. `lore bootstrap` is a pure read: the row count of every table was identical before and after, and it exits 0 (also on an empty corpus). Reading a single document with `lore get` is not a pure read: each successful `get` adds one row to the usage-trace table.

**Code**:
- lore/src/adapters/cli/commands/bootstrap.ts:13 ("zero store mutations") and :57-58 (exit 0 on empty corpus).
- lore/src/service/corpus-service.ts:1926-1927 (`get` calls `traceRecorder.recordGet` after a successful read).

**CLI** (row counts via sqlite3 over every non-FTS table):
```
$ lore bootstrap                     [exit=0]   diff(before, after) -> no differences (diff-exit=0)
$ lore get prd-probe-product         -> trace_events 23 -> 24
```

### 14 (area: hygiene)

**Answer**: The trace records only five kinds of event: document reads (get), searches, feeds, context bundles and gate denials. Listing, tree views and bootstrap leave nothing. Running `lore eval links` reads every live document through the normal read path, so it adds one "get" row per live document (13 in the probe). That drives the "Never-read docs" figure in `lore trace stats` down, which makes documents nobody read look read. Zero-result searches, including a search whose only match was an invalidated doc, are counted as zero-hit searches.

**Code**:
- core/src/trace.ts:32 (`TRACE_EVENT_KINDS = ["get","search","feed","context_bundle","gate_deny"]`).
- lore/src/service/corpus-service.ts:1926-1927 (get records a trace row).
- lore/src/eval/scenarios/link-integrity.ts:155 (`app.corpusService.get(summary.id)` for each live doc).
- lore/src/service/trace-stats-service.ts:148 (`never_read_docs_count`).

**CLI**:
```
start:            feed|1 gate_deny|5 get|22 search|2
after lore list:  feed|1 gate_deny|5 get|22 search|2
after lore tree:  feed|1 gate_deny|5 get|22 search|2
(13 live docs)  after lore eval links: get|35
$ lore trace stats -> "Never-read docs: 1"  (earlier, before eval runs: "Zero-hit searches: 2", "Never-read docs: 3")
```

### 15 (area: autonomy) (PROSE-vs-CODE discriminator)

**Answer**: Essentially nothing. Until the team seeds an approved "skill" knowledge note for specs, `lore feed spec-create --parent <prd>` prints one line, "no approved governing skill for spec", and exits 0. It does not include the parent PRD summary, even though `--parent` was given, and it does not show the built-in fallback rules that the spec-create gate itself uses and prints when it denies. So the "feed before you write" step tells a new project nothing that the gate will later enforce. An unregistered checkpoint name gives exit 2.

**Prose**: .claude/rules/lore-corpus-workflow-feed.md:9 says "Before producing any artifact: `lore feed <checkpoint>` (e.g. `spec-create --parent <prd>`) pulls the governing rules slice plus upstream summaries — pull proactively, do not wait for a gate to reject you first." The `feed --help` says of `--parent`: "its MDX-resolved summary is included when supplied".

**Code**:
- lore/src/flows/feed-flow.ts:399-401 returns early when no skill doc is found, before the parent summary (:406-407) is ever resolved.
- lore/src/service/corpus-service.ts:183-200 (`FALLBACK_SPEC_CREATE_RULE_MARKDOWN`, used by the gate only).

**CLI**:
```
$ lore feed spec-create --parent prd-probe-product -> no approved governing skill for spec                       [exit=0]
$ lore create spec ... --content "spec body"       -> [source: built-in fallback (no seeded rule doc) ...] ## Rules a candidate spec must satisfy ...  [exit=4]
$ lore feed nonsense-checkpoint -> Error: unknown checkpoint "nonsense-checkpoint" — not registered as a lore gate checkpoint.  [exit=2]
```

### 16 (area: issue-loop)

**Answer**: It shows this project's own reports (the corpus found from the current directory), the same as `--local`. It says so on the first line, "Corpus: <path>", and prints "(no open issue reports)" with exit 0 when there are none. An upstream configured in the retired shape is refused loudly rather than treated as absent. A GitHub-shaped upstream goes to the GitHub listing path.

**Code**: lore/src/adapters/cli/commands/issues.ts:627-639 (retired shape refused, GitHub shape routed) and :660-681 (local source with `upstreamCorpusPath: undefined`; the `upstream` variant is unreachable, so local rows are read).

**CLI**:
```
$ lore issues          -> Corpus: .../xprobe2/corpus.1JZQ2m \n (no open issue reports)   [exit=0]
$ lore issues --local  -> Corpus: .../xprobe2/corpus.1JZQ2m \n (no open issue reports)   [exit=0]
```

### 17 (area: distribution) (PROSE-vs-CODE discriminator)

**Answer**: Project setup cannot be previewed: `lore setup --project --dry-run` is refused with exit 2 ("project scaffolding has no plan-only preview mode"). Only the global install has `--dry-run`. Neither form runs unattended without consent: in a non-interactive session, both `lore setup` and `lore setup --project` refuse with exit 2 ("refusing to install/scaffold without confirmation in a non-interactive session — pass --yes"). No files were written in either case.

**Prose**: README.md:55 says "`lore setup` without `--project` is the global machine install; `--project` is the per-repo scaffold. Both support `--dry-run` (zero writes), `--check` ..., and `--uninstall`."

**Code**: lore/src/adapters/cli/setup-args.ts:154 (`--project` plus `--dry-run` refusal) and lore/src/adapters/cli/commands/setup.ts:275-282 (non-interactive without `--yes` gives exit 2).

**CLI** (HOME and --claude-dir isolated under xprobe2/home):
```
$ lore setup --project --dry-run -> Error: --project cannot be combined with --dry-run — project scaffolding has no plan-only preview mode.  [exit=2]
$ lore setup --project           -> Error: refusing to scaffold without confirmation in a non-interactive session — pass --yes.          [exit=2]
$ lore setup --claude-dir xprobe2/home/.claude -> Error: refusing to install without confirmation in a non-interactive session — pass --yes. [exit=2]
git status before/after: unchanged
```

### 18 (area: sync) (PROSE-vs-CODE discriminator)

**Answer**: Two addresses answer with no credentials: `GET /health` and `GET /api/health`, both HTTP 200. `/api/health` also reveals whether a dashboard bundle is embedded. Two more routes run their own checks without an API key: `POST /api/auth/local-bootstrap`, which checks a local token and the Origin (403 when Origin is missing or not allowed), and, in packaged-dashboard mode only, `GET /auth/bootstrap?nonce=`. CORS preflight (OPTIONS) is also answered before auth. Every other `/api/*` route returns 401 UNAUTHORIZED. The server's default port is 3456.

**Prose**: packages/lore/src/adapters/http/CLAUDE.md:11 says "All `/api/*` requests require a valid identity. ... `/health` is the ONLY unauthenticated route."

**Code**: lore/src/adapters/http/index.ts:311-313 (`/health`), :329-332 (`GET /api/health`, unauthenticated, with a `dashboard` field), :343 (local-bootstrap bypass) and :367 (auth for the rest). lore/src/adapters/cli/commands/serve.ts:36 (default port 3456).

**CLI** (`lore serve --port 39417 --host 127.0.0.1`, killed afterwards):
```
GET /health                 -> {"ok":true,"status":"healthy"} [HTTP 200]
GET /api/health             -> {"ok":true,"status":"healthy","dashboard":{"embedded":false}} [HTTP 200]
GET /api/docs               -> {"ok":false,"error":{"code":"UNAUTHORIZED",...}} [HTTP 401]
GET /api/auth/me            -> UNAUTHORIZED [HTTP 401]
POST /api/auth/local-bootstrap (no token, no Origin) -> {"ok":false,"error":{"code":"VALIDATION_ERROR","field":"Origin",...}} [HTTP 403]
```

### 19 (area: context)

**Answer**: No, AI was not tried. On an agent surface AI is off, so the narrative step returns nothing without calling any provider. The command still prints "Warning: no usable AI provider — writing a skeleton narrative placeholder", which misreports "AI disabled" as "provider unusable". It then writes CLAUDE.md with the skeleton narrative plus its managed sections, exit 0. On a second run the narrative step runs first, so the same warning appears again (and on an AI-on surface a full AI generation would run). Only after that is the existing file noticed and the run refused with exit 4: "CLAUDE.md already exists — run `lore context refresh` ... or pass --force".

**Code**:
- lore/src/adapters/cli/commands/context.ts:227 (`if (!useAi) return undefined`).
- context.ts:416-424 (narrative resolved, then the warning on `undefined`, before `runContextInit`).
- lore/src/flows/context-flow.ts:357 (already-exists refusal).

**CLI** (CLAUDECODE=1 present in env):
```
$ lore context init -> Warning: no usable AI provider — writing a skeleton narrative placeholder ... \n Wrote CLAUDE.md (narrative: skeleton) ...  [exit=0]
$ lore context init -> Warning: no usable AI provider — ... \n Error: Validation failed on field 'path': CLAUDE.md already exists — run `lore context refresh` ...  [exit=4]
```

### 20 (area: hygiene)

**Answer**: Yes, in both cases, and verification exits 4 (not the 3 that `status --check-*` uses). Changing a row's actor directly breaks the hash chain: "Chain integrity: BROKEN at audit row id 2 (hash_mismatch)". Deleting the newest row leaves the hash chain intact, but the versions-to-audit cross-check reports "INCOMPLETE ... 1 missing entry" because that row recorded a document version. After `lore audit anchor`, the same deletion is also reported as "Anchor: MISMATCH (row_missing)". A clean trail exits 0.

**Code**: lore/src/adapters/cli/commands/audit.ts:204-239 (renders misses, chain break and anchor status; `process.exitCode = clean ? 0 : 4` at :208 and :239).

**CLI** (throwaway DB edited with sqlite3, then restored from a copy):
```
update audit set actor="mallory" where id=2; $ lore audit --verify -> Chain integrity: BROKEN at audit row id 2 (hash_mismatch) ...  [exit=4]
delete newest audit row (id 50);            $ lore audit --verify -> Audit trail is INCOMPLETE ... 1 missing entry ... Chain integrity: clean (49 entries checked).  [exit=4]
$ lore audit anchor; delete id 50;           $ lore audit --verify -> ... Anchor: MISMATCH (row_missing) — expected head id 50 ...  [exit=4]
restored;                                   $ lore audit --verify -> complete ... Chain integrity: clean (50 entries checked).  [exit=0]
```


## Freeze record
Author statement: "I did not read any baseline, pilot or probe document." Disclosed exposure: one grep for "Overview/Goal" printed heading lines and file names from docs/requirements/ files inside a .claude/worktrees/ copy; the author did not open or use them. Frozen before the first R1 corpus write of the remediation revision (AC-BLS2-13, one re-probe).
