---
id: SPEC-217
type: spec
role: spec
title: "Defect clusters round 2 part D: store selection, runs, requirements, context, fragments, agent keys, dashboard command"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
---
## Overview/Goal

Defect clusters round 2, part D of 4: store selection, runs, requirement parsing, context, fragments, agent keys and the dashboard command. The round closes 29 clusters (69 open GitHub issues in daniel1zz/lore plus 4 local reports) at their mechanism root; it is split in four specs so each is reviewed whole. Every root cause was read on main `f80a2933`; line numbers refer to that commit. Each Dn names its reports, the root cause and the END STATE. No group introduces a stopgap, a guard on an old design, a fallback, or a phased migration.

User decisions built in:
- D23 lands after D22 (spec C).

## Scope

### D23 — Every CLI read goes through the App's store; no command opens a second SQLiteStore

- Reports: #152 (CLI half). Lands after D22.
- Root cause: 20 CLI sites construct `new SQLiteStore(dbPath)` beside the App's store: get.ts:203, log.ts:43, status.ts:1547/1622/1859, gate.ts:273, ac.ts:435, baseline.ts:175/265/422, baseline-adopt.ts:79/152, calibration.ts:150, stash.ts:103, autonomy.ts:47, status-autonomy-thresholds.ts:28, status-decision-log.ts:33, pending-decisions-render.ts:38/54, decide-flow.ts:80.
- End state: every site uses `app.store`; production code obtains a store only through app.ts's selection function. TypeScript has no module-private visibility across files and hundreds of tests construct `SQLiteStore` directly, so the import boundary cannot be made unreachable by the type system; it is enforced by a `check:store-construction` script in `check:static` that refuses `new SQLiteStore(` (and the Turso store constructor) in packages/lore/src outside store/ and app.ts's selection function. This is the boundary's only enforcement, not a re-check of something the design already guarantees.

### D24 — A run records what it was given and only the parent it was told

- Reports: #167, #230.
- Root cause:
  - `computeComposition` records no fragments for a main run (packages/lore/src/adapters/cli/commands/run.ts:104-109), although rules files carry them.
  - Every helper's parent is set to the main run (packages/lore/src/service/run-service.ts:190-194).
- End state: the main-run composition lists the `rules:user` and `rules:project` selections (id + sha256). A helper's parent is the harness-supplied parent or `null`, rendered `parent: unknown`.

### D25 — A malformed requirement list or criteria list fails loud and is never overwritten

- Reports: #111, #279.
- Root cause:
  - `extractRequirements` returns `[]` on a parse failure (packages/lore/src/service/requirement-service.ts:369-372). `add` overwrites on that basis (:112-114), and coverage reads the same way (corpus-service.ts:4660-4661).
  - Withdrawal skips unparseable specs (requirement-service.ts:331-332).
  - Raw MCP `extra` writes can store a malformed list.
- End state:
  - `readRequirements` returns a `Result`, and every consumer propagates exit 4 naming the PRD.
  - Withdrawal refuses with exit 4, naming any unparseable descendant spec.
  - `extra.requirements` is a dedicated key (writer `lore requirement add|migrate|withdraw`, D8's mechanism).

### D26 — `lore context` says what it did and never calls AI for a refused init

- Reports: #90, #92, #266.
- Root cause:
  - commands/context.ts:369 prints `Wrote` unconditionally.
  - :692-697 warns "no usable AI provider" even under `--no-ai`.
  - The AI call at :692 runs before the refusal at flows/context-flow.ts:462-481.
- End state:
  - The result carries `changed` and the skipped sections. Output says `No change to <path>` when no byte changed.
  - The warning distinguishes `AI disabled (--no-ai)`.
  - The existing-file refusal runs first.

### D27 — `lore fragments check` covers every agent type and both rules scopes

- Reports: #35, #265.
- Root cause: `enumerateAgentTypes` lists shipped agents only (packages/lore/src/flows/fragments-flow.ts:438-444), and check compares project rules only (:647).
- End state: agent types are the union of shipped, user, project and audience-named types. Rules drift is checked for both scopes, with exit 4.

### D28 — `lore agent` uses one argument style and the standard exit codes

- Reports: #91, #240.
- Root cause: agent.ts:50/:159 return a literal 1, and `ApiKeyStore` errors (packages/lore/src/adapters/http/auth.ts) carry no typed code. `create` uses `--name` (:20) while `revoke` uses a positional (:136-137).
- End state: typed errors exit through `exitCode()` (duplicate 4, unknown 3). Both subcommands take `--name`, and a positional exits 2.

### D29 — The dashboard reports an unreadable machine config and survives a missing browser opener

- Reports: #262, #263.
- Root cause: `loadGlobalConfig` maps any read error to `ok({})` (packages/core/src/config-node.ts:196-202). The opener's ENOENT is an async event that escapes its try/catch (commands/dashboard.ts:183-193), and on win32 `start` is a shell builtin.
- End state: only ENOENT means "no global config", and other read errors get the parse-error warning naming the path. The opener is an injected port with an `error` listener that prints the URL, and win32 uses `cmd /c start "" <url>`. The server keeps running.

### Citation notes

- D15: no live rule covers per-criterion supersession, which is a new capability. BR-163 is cited because verify's selection changes. A rule is added to baseline-declare-an-acceptance-criterion after landing.
- D19 cites debt-registry rules AD-1 and AD-2, which the fix retires.
- D23 cites BR-925 as modified (reads go through the selected store).
- Help/comment text folded into D11, D18 and D20 has no rule of its own. The ACs of those groups assert it alongside their cited behaviour.

## Acceptance Criteria

Structured ACs AC-DC2-23..AC-DC2-29 (`lore ac list`).


## Acceptance Criteria (structured)

- [·] [script] AC-DC2-23: (a) `bun run check:store-construction` exits 0 on the tree, and exits 1 naming the file when a fixture copy contains `new SQLiteStore(` in packages/lore/src/adapters/cli/commands/get.ts or in packages/lore/src/adapters/cli/decide-flow.ts; it scans every file under packages/lore/src except store/ and app.ts's selection function. (b) With sync off, `lore get`, `lore log`, `lore status`, `lore gate spec-create`, `lore ac list` and `lore baseline sites ac` each construct exactly one store per command (construction spy). (c) With the replica-store double from store-selection, `lore get` and `lore log` read through the double (no direct file read). SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a construction check scanning only adapters/cli/commands (misses adapters/cli/*.ts such as decide-flow.ts). The fixture plants the call in a non-commands file too. Made red once by re-adding `new SQLiteStore(dbPath)` in commands/get.ts.
  script: test — bun run test:file packages/lore/tests/integration/dc2-cli-store-reuse.bun.test.ts && echo 'AC-DC2-23 PASS: no second SQLiteStore outside store selection; reads go through the selected store'
- [⚑] [script] AC-DC2-24: Throwaway project with shipped fragments installed. (a) `lore run register --harness claude-code --session S` (main) exits 0 and the stored composition's fragments are set-equal (id + sha256) to the union of `lore fragments render --outlet rules:user` and `--outlet rules:project` explain rows, and non-empty. (b) `lore run register --harness claude-code --session S --agent-id A --agent-type t` without `--parent`: `lore run show <A> --json` has parentRunId null and text output `parent: unknown`; with `--parent <run>` it records that run. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a one-level helper whose real starter is the main run (today's guess happens to be right). The test asserts null when no parent is supplied. Made red once by restoring the main run as the default helper parent in RunService.register.
  script: test — bun run test:file packages/lore/tests/integration/dc2-run-registry.bun.test.ts && echo 'AC-DC2-24 PASS: main run lists its rules fragments; unknown helper parent stored as unknown'
  other_command=1
- [·] [script] AC-DC2-25: Throwaway corpus. (a) PRD whose stored extra.requirements is present but invalid (written through the store, as legacy data): `lore requirement list`, `lore requirement add P R-3 ...` and `lore status --check-requirements` each exit 4 naming the PRD; the stored list is byte-identical afterwards. (b) MCP `lore_set` and CLI `lore set --extra` changing extra.requirements on a PRD are refused with exit 4 naming `lore requirement add`. (c) A spec under the PRD whose acceptance_criteria fail to parse: `lore requirement withdraw P R-1` exits 4 naming that spec; never exit 0. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): an absent requirements key (legitimately empty) instead of a present-but-invalid one. The fixture stores an invalid entry. Made red once by restoring `parsed.success ? parsed.data : []` in extractRequirements.
  script: test — bun run test:file packages/lore/tests/integration/dc2-requirements-parse.bun.test.ts && echo 'AC-DC2-25 PASS: malformed requirement or criteria list fails loud and is never overwritten'
- [⚑] [script] AC-DC2-26: Throwaway lore project. (a) After `lore context init`, hand-edit one managed section and run `lore context refresh`: exit 0, CLAUDE.md byte-identical, stdout contains `No change to CLAUDE.md` and `skipped (diverged): <section>`, and no `Wrote`. (b) `lore context init --no-ai` on a fresh project: stderr contains `AI disabled (--no-ai)` and not `no usable AI provider`. (c) With CLAUDE.md present and a logging fake `claude` first on PATH: `lore context init --ai` exits 4 and the fake's log is empty. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): case (c) without a logging stub (the wasted AI call is invisible). The stub records each invocation. Made red once by moving the existing-file refusal after resolveInitNarrative.
  script: test — bun run test:file packages/lore/tests/integration/dc2-context-cmd.bun.test.ts && echo 'AC-DC2-26 PASS: refresh reports no change; --no-ai says disabled; init refuses before any AI call'
  other_command=1
- [⚑] [script] AC-DC2-27: Temp HOME with `~/.claude/agents/tester.md`, project `.claude/agents/res.md`, and a fragment whose audience is `subagent:ghost`. (a) `lore fragments check --json` exits 0 and `.data.agentTypes` contains tester, res, ghost, every shipped agent and `subagent:*`. (b) After appending a line to a lore-owned `~/.claude/rules/lore-user-*.md`, check exits 4 with a `rules_drift` finding naming that user-scope path; restoring the file returns exit 0. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): drifting a project rules file only (detected today). The test drifts a user-scope file. Made red once by removing the user scope from the drift detection call.
  script: test — bun run test:file packages/lore/tests/integration/dc2-fragments-check-scope.bun.test.ts && echo 'AC-DC2-27 PASS: check covers user and project agents and user-scope rules drift'
  other_command=1
- [⚑] [script] AC-DC2-28: Throwaway corpus. `lore agent create --name dup` exits 0; again exits 4. `lore agent revoke --name ghost` exits 3 and stderr names `ghost`. `lore agent revoke --name dup` exits 0. `lore agent revoke dup` (positional) exits 2. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): asserting a non-zero exit for the duplicate (1 passes today). Exact codes are asserted. Made red once by restoring `return 1` in agent create's error branch.
  script: test — bun run test:file packages/lore/tests/integration/dc2-cli-agent.bun.test.ts && echo 'AC-DC2-28 PASS: agent duplicate exit 4, unknown exit 3, --name on both subcommands'
  other_command=1
- [·] [script] AC-DC2-29: (a) Global config chmod 000 (test skipped when running as root): `lore dashboard --no-open` stderr contains `Warning: global config <path> ignored` and the cause, and the registry line states no extra projects were mounted; a missing config prints no warning. (b) With an injected opener whose spawn emits an async `error` (ENOENT): stdout contains `Could not open browser automatically. Visit: <url>`, the process is alive 2 s later, and GET <url> answers 200; on platform win32 the opener command is `cmd` with args `/c start "" <url>`. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): an opener that throws synchronously (caught today). The double emits the error event asynchronously. Made red once by removing the opener's `error` listener.
  script: test — bun run test:file packages/lore/tests/integration/dc2-dashboard-cmd.bun.test.ts && echo 'AC-DC2-29 PASS: unreadable machine config warned; missing opener keeps dashboard serving'
  other_command=3
