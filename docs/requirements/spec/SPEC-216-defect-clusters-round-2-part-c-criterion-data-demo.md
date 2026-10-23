---
id: SPEC-216
type: spec
role: spec
title: "Defect clusters round 2 part C: criterion data, demotion notices, site census, sub-types, red-first pairing, Turso sync"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
---
## Overview/Goal

Defect clusters round 2, part C of 4: criterion data, demotion notices, the site census, knowledge sub-types, red-first pairing and Turso sync. The round closes 29 clusters (69 open GitHub issues in daniel1zz/lore plus 4 local reports) at their mechanism root; it is split in four specs so each is reviewed whole. Every root cause was read on main `f80a2933`; line numbers refer to that commit. Each Dn names its reports, the root cause and the END STATE. No group introduces a stopgap, a guard on an old design, a fallback, or a phased migration.

User decisions built in:
- D22: `sync.enabled` is honoured through the Turso embedded replica, failures are loud with no local fallback. This reverses BR-925.

## Scope

### D17 — Corpus criterion data corrected to commands that decide their own statement (no code)

- Reports: #74, #75, #103, #187. Lands after D15.
- Root cause:
  - AC-TIER-10's `-t ai_provenance` misses the positive test (tiered-review.test.ts:417).
  - AC-053-n share one unfiltered command.
  - AC-RC-12's filter matches 0 of 74 tests, and its statement contradicts the approved AC-RCH-1/AC-RCH-8.
  - AC-WTC-1/2 describe the removed quiet window, and AC-WTC-2's file is deleted.
  - Found while drafting: AC-053-1 states `REVIEW_PROMPT_VERSION === 'v2'`, while its test asserts `'v5'` (review-template-v2.test.ts:77).
- End state, exactly:
  - Corrected through `lore ac set <spec> <AC> --command … --correction "<reason>"` (status kept):
    - spec-tiered-review-ledger-fast-track-judgment-required-promote **AC-TIER-10**: `bunx vitest run packages/lore/tests/unit/service/tiered-review.test.ts -t ai_provenance` → `bun run test:file packages/lore/tests/unit/service/tiered-review.test.ts -t "AC-TIER-6 provenance write half" && echo 'AC-TIER-10 PASS: real model id recorded when exposed; ai_provenance omitted when not'`.
    - spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review: the shared three-file command → per-criterion commands:
      - **AC-053-2**: `bun run test:file packages/core/tests/unit/review-advisory.test.ts -t "AC-053-2 —" && echo 'AC-053-2 PASS: …'`.
      - **AC-053-3/4/5/6**: `bun run test:file packages/lore/tests/unit/ai/review-template-v2.test.ts -t "AC-053-n —" && echo 'AC-053-n PASS: …'`.
      - **AC-053-7**: `bun run test:file packages/lore/tests/unit/adapters/cli/review-render-advisory.test.ts -t "AC-053-7 —" && echo 'AC-053-7 PASS: …'`.
  - Superseded through `lore ac supersede` (D15):
    - **AC-053-1** → spec-design-necessity-rule-v5-separate-what-a-design-needs-from:AC-DN5-1.
    - spec-resume-ticket-coverage-a-shipped-upper-bound-left-the **AC-RC-12** → spec-resume-ticket-coverage-floor-blocking-channel-arming:AC-RCH-8.
    - spec-lore-owns-worktree-cleanup-archive-removes-the-task-s **AC-WTC-1** → spec-one-worktree-removal-test-for-the-guard-lore-done-and-a:AC-WS-3.
    - **AC-WTC-2** → the same spec's AC-WS-2.
  - `bun run test:file` exits 1 when a filter collects nothing (scripts/test-file.ts:11, :18-19, :130).

### D18 — Every demotion is announced, and the help around it says what the gates do

- Reports: #176; the local "lore ac add/set 静默把 approved spec 打回 draft", scoped to its still-open `ac set` half; #116 and #110 (folded in from help-text-drift: this group owns ac.ts, ac-service.ts and evidence.ts).
- Root cause:
  - `RuleService.demoteIfApproved` writes the demotion as its own version (packages/lore/src/service/rule-service.ts:843-849), but rule.ts:394/:445 print only the final version.
  - `AcService.setCriterion` demotes (ac-service.ts:960) and `ac set` prints `Updated …` (ac.ts:769).
  - The cite help and comments say "report-only" (ac.ts:79, :283, :468, :655; ac-service.ts:504, :523-524), contradicting BR-86/BR-257.
  - evidence.ts:29 restates a 600000 ms default, while the config default is 1_200_000 (config.ts:588).
- End state:
  - Every write that can demote returns `demoted?: {slug, from, to, version}` from one helper over `resolveStatusAfterContractEdit`. CLI prints `<slug> was <from> and is now <to> (v<n>): re-review and approve it`, and JSON and MCP carry `demoted`.
  - The cite help states both modes.
  - The capture-window comment names `workflow.evidence.capture_timeout_ms` and no number.
  - Demotion semantics are unchanged.

### D19 — The site census records where it stops instead of dropping sites

- Reports: #94 (second positional), #112, #118.
- Root cause:
  - `baseline sites` declares one positional (packages/lore/src/adapters/cli/commands/baseline.ts:678-690).
  - `handleCall` returns silently at the depth bound (packages/lore/src/service/site-census.ts:922; :80), and `visit` marks a function visited whatever its depth (:889-890).
  - `valuesBoundTo` says `opaque: false` while ignoring assignments, spreads and untyped literals (:1100-1132).
- End state:
  - All positional tokens form the command path, and an unresolvable path exits 4 (BR-664).
  - A depth cut records a `not_measured` `depth-bound` site.
  - The visited set keys on the shallowest depth.
  - An unmodelled binding records a `not_measured` dynamic site. This retires AD-1 and AD-2.

### D20 — The knowledge sub-type set and create's per-type required flags each have one derivation

- Reports: #17, #88, local "lore create --help never marks per-type required flags" (folded in from help-text-drift: this group owns create.ts).
- Root cause:
  - `KNOWLEDGE_SUB_TYPES` (9 members, packages/core/src/types.ts:226) is hand-copied: schemas.ts:708 (8), create.ts:6 (4), and the shipped asset assets/context/corpus-workflow-2-produce.md:11 (4). The guarding test is an alternation regex (cli-create.bun.test.ts:399, :419).
  - The schema presence checks (schemas.ts:216-232) fail before the writer guards (corpus-service.ts:1735-1768).
  - `create --help` does not mark the per-type required flags held in create-task-validation.ts and decision-status-validation.ts.
- End state:
  - `WRITER_OWNED_KNOWLEDGE_SUB_TYPES` and `CREATABLE_KNOWLEDGE_SUB_TYPES` are derived in core. The message, help and asset (generated, checked by `embed-assets-manifest --check`) render from them.
  - The writer check runs before the schema, naming `lore handoff` / `lore uat record`.
  - `create --help` marks required flags from the validators' requiredness map.

### D21 — The red step lives in the implementing task, so a red never lands on main alone

- Reports: #23, #26.
- Root cause: the lore-plan skill pairs every implement task with a separate RED task and wires `test blocks impl` (assets/skills/lore-plan/SKILL.md:99; references/mode-create.md:370-395, :386-387). The RED task cannot meet `lore done`'s floors until the impl lands, and the impl cannot start until the RED task is archived (BR-110, BR-205): a deadlock. Landing the RED branch alone turns main's typecheck red.
- End state: TDD injection adds red-first to the implement task itself. Expected-fail, implementation and pass all happen in one worktree, landing as one branch. The skill creates no RED tasks or test→impl `blocks` edges.

### D22 — With sync.enabled every route reads and writes through the Turso embedded replica, or fails loud

- Reports: #84.
- Root cause:
  - The CLI loader strips `sync` before `createApp` (packages/lore/src/adapters/cli/loader.ts:337, :437). `lore serve` (serve.ts:39) and the MCP server go through the same loader.
  - The dashboard mounts registered projects as plain local SQLite (commands/dashboard.ts:154-170).
  - So writes in a sync-enabled project land only locally, with exit 0 (BR-925 today).
- End state (decided):
  - The loader passes the full config. `createApp` opens the Turso embedded replica when `sync.enabled`.
  - A missing URL or token, or a remote that is unreachable at open, fails with exit 1 naming the setting or address before any write. There is never a fallback to the local file.
  - Dashboard mounts use the same selection. BR-925 is modified as in `rule-changes.json`.

### Citation notes

- D15: no live rule covers per-criterion supersession, which is a new capability. BR-163 is cited because verify's selection changes. A rule is added to baseline-declare-an-acceptance-criterion after landing.
- D19 cites debt-registry rules AD-1 and AD-2, which the fix retires.
- D23 cites BR-925 as modified (reads go through the selected store).
- Help/comment text folded into D11, D18 and D20 has no rule of its own. The ACs of those groups assert it alongside their cited behaviour.

## Acceptance Criteria

Structured ACs AC-DC2-17..AC-DC2-22 (`lore ac list`).


## Acceptance Criteria (structured)

- [·] [script] AC-DC2-17: Corpus data only (no code, no test file). The corrected commands and supersessions listed exactly in this spec's D17 section are applied: AC-TIER-10 and AC-053-2..AC-053-7 get `ac set --correction` commands, each running one file through `bun run test:file` with its own `-t` filter and a PASS echo (status kept); AC-053-1 is superseded by AC-DN5-1, AC-RC-12 by AC-RCH-8, AC-WTC-1 by AC-WS-3 and AC-WTC-2 by AC-WS-2 (`lore ac supersede`). The command runs every corrected filter through bun run test:file (exit 1 on a filter that collects nothing) and reads the stored criteria back, asserting each corrected command text and each superseded id's successor exactly as D17 lists them. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a corrected command that still uses `bunx vitest run -t` (exits 0 with every test skipped, as AC-RC-12 does today); every corrected command must use the `bun run test:file` form. Made red once by changing the AC-053-7 filter to `-t "AC-053-77 —"` (test:file exits 1: path collected no tests).
  script: test — bun scripts/check-dc2-17-ac-command-data.ts && echo 'AC-DC2-17 PASS: corrected AC commands collect tests and superseded ids name their successors'
- [⚑] [script] AC-DC2-18: Throwaway corpus, record-edit gate off. (a) Approved leaf L: `lore rule add L ...` exits 0 and stdout contains `L was approved and is now draft (v<n>): re-review and approve it`; `--json` `.data.demoted` equals {slug L, from approved, to draft, version n}; the same holds for `lore rule set`. (b) Approved spec S: `lore ac set S AC-1 --statement x` exits 0 and prints the same line for S; MCP `lore_rule_add` results carry `demoted`. (c) `lore ac add S AC-2 ...` on approved S prints no demotion line and S stays approved (the fixed half stays fixed). (d) `lore rule add` on a draft leaf prints no demotion line and `.data.demoted` is absent. (e) #116: `lore ac add --help`, `ac set --help` and `ac cite --help` describe cites as refused under enforce on an armed branch and stored with a warning under report/off, and ac.ts/ac-service.ts contain no `report-only` or `never rejects`. (f) #110: the evidence.ts capture-window sentence names `workflow.evidence.capture_timeout_ms` and contains no digit run. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a draft leaf (no demotion, so no line is right today); a help check for the literal `600000` only (passes after someone writes `600_000`). The fixture approves L and S first, and the help check refuses any digit run. Made red once by dropping the demotion line render from rule.ts.
  script: test — bun run test:file packages/lore/tests/integration/dc2-demotion-notice.bun.test.ts && echo 'AC-DC2-18 PASS: rule add/set and ac set announce demotion on stdout and JSON; cite and capture help state the real behaviour'
  other_command=1
- [⚑] [script] AC-DC2-19: (a) `lore baseline sites gate spec-create --json` exits 0 and reports command `gate spec-create` with the spec-create entry symbol; `lore baseline sites gate spec-create extra` exits 4 naming `gate spec-create extra`. (b) A fixture TS root with a 14-call chain ending in a refusal: the census lists one not_measured site of kind `depth-bound` naming the function where the walk stopped, and `lore baseline coverage` for a leaf declaring that command reports it incomplete (exit 1). (c) A function first reached at depth 12 and again at depth 3: the refusal sites of its callees are listed. (d) A fixture with `deps.fn = other` assigned after construction: the census records a not_measured dynamic site for `deps.fn`. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a chain shorter than MAX_CALL_DEPTH (nothing to cut) and a visit order where the shallow path comes first. The fixtures force the deep-first order. Made red once by restoring `if (depth >= MAX_CALL_DEPTH) return;` without recording a site.
  script: test — bun run test:file packages/lore/tests/integration/dc2-site-census-not-measured.bun.test.ts && echo 'AC-DC2-19 PASS: nested sites command resolved; depth cut and unmodelled bindings recorded not_measured'
  other_command=1
- [·] [script] AC-DC2-20: (a) `lore create knowledge --title x --content y` (no sub-type) exits 2 (a usage error, BR-700); the parenthesised list in stderr, split on `|`, is SET-EQUAL to KNOWLEDGE_SUB_TYPES (9 members incl. `uat`). (b) The sub-type list in create.ts's help and in the shipped assets/context/corpus-workflow-2-produce.md is set-equal to CREATABLE_KNOWLEDGE_SUB_TYPES, and `bun scripts/embed-assets-manifest.mjs --check` exits 0. (c) `lore create knowledge --sub-type handoff --title x --content y` exits 4 with stderr containing `lore handoff` and not `Zod-valid`; `--sub-type uat` exits 4 naming `lore uat record`. (d) For each type in the create requiredness map, `lore create --help` marks every required flag (`--plan-id [required: task]`, `--decision-status [required: adr]`); a planted map entry in the test shows up in help without editing create.ts. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): an alternation regex over stderr (any one member satisfies it, as at cli-create.bun.test.ts:399); a help check for the two known flags only. The test parses the list, compares sets, and plants a map entry. Made red once by deleting `uat` from the derived message list (hard-coding it again).
  script: test — bun run test:file packages/lore/tests/integration/dc2-knowledge-subtype-message.bun.test.ts && echo 'AC-DC2-20 PASS: sub-type message equals enum; handoff and uat creates name their writer; create help marks required flags'
- [⚑] [script] AC-DC2-21: (a) The shipped assets/skills/lore-plan/SKILL.md and references/mode-create.md, and their copies in the embedded manifest, contain no instruction to create a `[Skill:test]` RED task or to `lore link <test-task> <impl-task> --type=blocks`, and describe red-first on the implement task. (b) Throwaway repo + corpus: task T declared red-first; inside T's worktree a failing test is captured as expected-fail (`lore evidence --capture --result expected-fail`), the module is implemented, a pass is captured, and after landing `lore done T` exits 0, with no second task and no blocks edge. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): checking SKILL.md only while mode-create.md still prescribes the pair (as it does at :386). Both files and the manifest copy are asserted. Made red once by re-adding the `lore link <test-task> <impl-task> --type=blocks` step to mode-create.md.
  script: test — bun run test:file packages/lore/tests/integration/dc2-tdd-red-pairing.bun.test.ts && echo 'AC-DC2-21 PASS: TDD injection is one red-first task; one task closes red then green'
  other_command=1
- [⚑] [script] AC-DC2-22: Throwaway corpus with `sync.enabled: true`. (a) URL set, token variable unset: `lore create knowledge ...` exits 1, stderr names the token variable; the local lore.db document count is unchanged and no replica file is created. (b) Token set, URL pointing at a closed local port: the same command exits 1 naming the URL; the local document count is unchanged (no fallback to the local file). (c) Through the store-selection seam with an injected replica-store double: `lore create knowledge ...` exits 0, the double records exactly one write, `lore get` reads the doc back through the double, and the local SQLite file is untouched; `lore serve` and `lore --mcp-server` (both built through loadLoreApp) and a dashboard-mounted sync-enabled project select the same double. (d) `sync.enabled: false`: commands use the local SQLiteStore as today. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): testing only the missing-token case while an open failure is caught and the local store used (the silent fallback the decision forbids). Case (b) asserts the unreachable remote fails with the local count unchanged. Made red once by catching the replica open error in createApp and returning the local SQLiteStore.
  script: test — bun run test:file packages/lore/tests/integration/dc2-store-selection.bun.test.ts && echo 'AC-DC2-22 PASS: sync-enabled writes go through the replica; missing token or unreachable remote exit 1 with no local write'
