---
id: KN-576
type: knowledge
role: knowledge
title: "Rule store: a selectable fragment catalog composed per project and per role (measurements, overlap census, options)"
status: archived
priority: medium
created: 2026-10-11
updated: 2026-10-23
tags: [fragments, rules, composition, roles, config]
links:
  - {id: KN-580, type: relates-to}
  - {id: SPEC-155, type: informs}
  - {id: KN-586, type: relates-to}
---
# Rule store: a selectable fragment catalog, composed per project and per role

Research, 2026-10-12. Not a decision: the open decisions D1–D8 at the end are the user's to make. Inputs: user requirements of 2026-10-11 (project rules hold only project-specific content, user rules hold general mechanisms, a rule library chosen at setup and changed later by configuration, merged with role templates — `knowledge-role-templates-with-role-bound-and-context-bound`), and the governing spec `spec-context-fragments-config-driven-layered-rule-injection` (approved, v87).

## Measurements

All numbers were measured on 2026-10-12 in `/Users/apple/Projects/zz/lore` with `wc -lc` (`LC_ALL=C`, bytes), `lore fragments render --explain`, and `sqlite3 .lore/lore.db`.

### Layers (three, override by id; project > user > shipped)

| Layer | Root (as built) | Files | Bytes | Audience |
|---|---|---|---|---|
| shipped | `<assetsRoot>/context` → `assets/context/*.md` | 6 | 12,617 (fragment files) | 5 `main` static (`corpus-workflow-{0..4}`), 1 subagent (`agent-rules`) |
| user | `$LORE_CONFIG_HOME` > `$XDG_CONFIG_HOME/lore` > `~/.config/lore` + `/context` | 17 `.md` (+4 `.bak-*`, ignored because the scan keeps only `*.md`) | 29,000 | all static; 8 main-only, 9 also subagent |
| project | `<projectRoot>/.lore/context` | 3 | 2,453 | all subagent-only static (implementer / tester / reviewer) |

The roots are built in `packages/lore/src/adapters/cli/commands/fragments.ts:160-162` (`join(assetsRoot,"context")`, `join(resolveUserConfigDir(),"context")`, `join(projectRoot,".lore","context")`) and again in `packages/lore/src/flows/context-flow.ts:387,433-434` for the writer. `FragmentRoots` (`service/context-fragments/discover.ts`) is the 3-field type; `fragments-flow.ts` discovers each layer separately so `checkOverrides` sees un-merged fragments. `.lore/context/` is git-tracked (`.gitignore` `!.lore/context/`, D14); `.lore/config.yaml` is NOT (`.gitignore:18 .lore/*`).

### Selection and config

`select.ts` pipeline: outlet layer routing → id override → `disable` → audience/mode routing → `when` matchers. `rules:project` sees shipped+project only, `rules:user` sees user only, hook outlets see all three. `checkOverrides` refuses cross-file override/disable of a static main fragment (D14).

Config keys that exist today (`packages/core/src/config.ts`): `ContextFragmentsSettingsSchema` (l.177, also the global-config `context` subset, l.216) and `contextConfigSchema` (l.1210):
- `context.language` (string; projects into Claude Code `language`, drives `when.language`)
- `context.fragments.disable` (string[] of ids)
- `context.memory_files.*` (CLAUDE.md / rules-file budget lint — not selection)

There is NO opt-in key: every fragment present in a layer is selected unless disabled. Fragment frontmatter (`packages/core/src/context-fragments.ts:41`, strict) has only `id, title, audience, mode, when{language}`. `WHEN_MATCHERS` has one key (`language`). Nothing models stack, paths, role, or capability.

### Rendered output

| Outlet | What is rendered | Size |
|---|---|---|
| `rules:user` → `~/.claude/rules/lore-user-*.md` | 17 files | 150 lines, 28,205 B |
| `rules:project` → `.claude/rules/lore-*.md` | 5 files (`corpus-workflow-*`) | 42 lines, 11,236 B |
| `hook:session-start` | 0 fragments (`additionalContext: ""`) | 0 |
| `hook:subagent-start`, `lore-implementer` | 13 fragments (agent-rules, 3 project, 9 user) | 8,720 chars of the 9,400 `SUBAGENT_FRAGMENT_CAP` (92.8%, 680 chars headroom) |

So every main session in this repo loads 22 rules files = 192 lines / 39,441 B at launch (plus the 23,588 B project `CLAUDE.md`, outside fragments). `~/.claude/CLAUDE.md` is a 390 B pointer. `lore fragments check`: "7 outlet checks across 4 agent types — ok".

### Composition record

`assets/hooks/run-register.mjs` is a blind pipe to `lore run register`. The composition is computed in `packages/lore/src/adapters/cli/commands/run.ts:71-86` (`computeComposition`): it calls `runFragmentsRender` for `hook:subagent-start` (subagent) or `hook:session-start` (main) and records `{schemaVersion: 1, fragments: [{id, sha256-of-file}]}`; `service/run-service.ts` only validates and persists (D5). Type: `CompositionRecord` in `packages/core/src/run-identity.ts:48`.

Runs table today (28 runs): main 2 runs with **0** fragments each; lore-implementer 15 runs × 13; lore-reviewer 7 × 10; lore-explorer 2 × 8; Explore and researcher 1 × 7 each. A main run's composition is empty because all main fragments are static rules files, which `hook:session-start` never selects. BR-1028 ("a run records … the context fragments it was given at start") therefore does not hold for main runs. Filed as issue #167. No role is recorded: `agent_type` is the only role-like column.

## Overlap census

User fragments compared, by meaning, against every shipped and project fragment. "Twice" = the same session loads both copies. Main sessions load `rules:user` + `rules:project` together, so a user/main line that repeats a `corpus-workflow-*` line is paid twice in every main session.

| User fragment | Overlapping fragment | Overlapping rule (short) | Paid twice? | Suggested owner |
|---|---|---|---|---|
| user-03 l.3 | corpus-workflow-overview | gates intercept writes (exit 4 + feeding pack); judge advisory; no `.lore/` → suggest `lore init` | main | shipped |
| user-03 l.6-9 | corpus-workflow-feed b1,b3,b5,b6 | consume injected bootstrap; `feed session-resume`; `feed <checkpoint>` before producing; search before creating, `lore link` | main | shipped |
| user-03 l.11-14 | corpus-workflow-produce b1,b2,b4 | prd→spec→plan→task chain; gate deny → fix per feeding pack, no `LORE_GATE_BYPASS` without consent; adr / knowledge sub-types | main | shipped (user copy is stale: says "4 gates", shipped adds phase-claim) |
| user-03 l.4 | — | CLAUDE.md holds only timeless static discipline; state/history → corpus | no | shipped (lore memory-hygiene rule; belongs in corpus-workflow-close) |
| user-04 l.3, l.11 | corpus-workflow-execute b1,b2 | `ready --json` then claim; identity injected per run; implementer claims inside own worktree | main | shipped |
| user-04 l.12, l.14 | corpus-workflow-execute b9,b10 | `release` only drops the lease; `done` archives, run by whoever can assert merged; readiness computed, never hand-marked | main | shipped |
| user-04 l.9 (partial) | corpus-workflow-execute b5, produce b3 | editing approved content (incl. `ac add/set`) demotes to draft → re-review/approve | main | shipped |
| user-04 l.4,5,7,8,10 | — | AC falsifier self-check; red-then-edit oracle = re-baseline; capability ≠ wiring; fix gap + its comment together; rubric AC with zero evidence blocks archive | no | shipped (lore methodology) — or mechanism (TASK-921 falsifier, archive gate) |
| user-04 l.13 | — | `ready --json .records` includes archived rows; filter `ready===true` | no | none: a tool-output defect, fix the output instead of carrying prose |
| user-05 l.3-4 | corpus-workflow-execute b3,b7 | external oracles only; `lore evidence … --result pass` with a real output tail; prefer `lore verify` | main + implementer/tester (vs agent-rules b2) | shipped |
| user-05 l.5-6 | — | `--capture` attestation does not prove provenance; script AC must print a summary line | no | shipped (facts about lore's own binary) |
| user-06 l.2-7 | corpus-workflow-close b1-b6 | assess; anchor add after landing; invalidate superseded; `lore handoff` (not create); report the ticket; maintenance cadence | main | shipped |
| user-06 l.3 clause | — | test-identifier anchors; `#Symbol` accepts ASCII identifiers only | no | shipped, or a tool fix |
| user-07 l.4 | corpus-workflow-produce b2 | process order comes from gate denial + feeding pack, not memory | main | shipped |
| user-09 l.5 | corpus-workflow-execute b4; agent-rules b1 | shared mutable state re-queried in the asserting turn | main + subagents | user-general (principle); shipped keeps the lore-specific instance |
| user-09 l.10, l.11 (partial) | agent-rules b3, b4; corpus-workflow-close b7 | no silent fallback; out-of-scope defect → `lore report-issue`, finish original task | implementer/reviewer/explorer subagents; main (l.11 vs close b7, partial) | user-general |
| user-10 l.6, l.7 (partial) | corpus-workflow-execute b7,b8; agent-rules b2 | exit code measured without a pipe; RED runs recorded as `expected-fail` | main + implementer/tester | user-general (l.6); shipped (l.7, lore evidence verb) |
| user-17 l.6, l.11 | corpus-workflow-execute b2,b10 | implementer claims in own worktree; evidence + release, main does `done` after merge | main | shipped |
| user-17 l.12, l.14 | project-scoped-oracles-in-worktrees b1-b4 | scoped oracles in worktrees (`bun run test:changed`), full suite on main; build `packages/*` before dependents | no (project copy is subagent-only) — misplaced | project (it names this repo's scripts); widen the project fragment's audience to `main` |
| user-15 | (shipped hook `assets/hooks/pre-subagent-gate.mjs`) | main agent must not write code; exemptions; bypass env vars | n/a — prose restating a shipped mechanism | shipped (in the hook's denial text, not in a rules file) |
| user-16 Stop part | (shipped hook `assets/hooks/stop-doc-sync.mjs`) | doc-sync check at Stop | n/a — prose restating a shipped mechanism | shipped hook message |
| user-00, 01, 02, 08, 12, 13, 14, 16 (hygiene part) | — | no overlap | no | user-general (user-02 is a candidate for an on-demand skill, see D5) |

The suspicion is confirmed: user-03/04/05/06 together render to 10,878 B, and 4,605 B of that (42%) restates `corpus-workflow-*` line for line.

Bytes each session pays twice:
- **Every main session:** 25 fully duplicated lines = 5,623 B (user-03 1,199; user-04 1,203; user-05 743; user-06 1,460; user-07 119; user-09 284; user-17 615). Counting 4 partially duplicated lines (user-04 l.9 507, user-09 l.11 672, user-10 l.6-7 752) raises it to 29 lines / 7,554 B. That is 14.3%–19.2% of the 39,441 B static payload.
- **Every lore-implementer subagent:** `agent-rules` (936 chars) repeats meaning already carried by user-09 l.5,10,11 + user-10 l.6 + user-05 l.3 = 1,517 B of user text. This sits inside a 9,400-char cap that is already 92.8% full.
- Token counts were not measured (no tokenizer was run); all figures are bytes.

A finding that comes before any store design: lore-tool facts kept in the user layer go stale when the binary changes. user-03 l.13 still says "4 deterministic gates" while shipped `corpus-workflow-produce` lists phase-claim too. Nothing checks the user copy against the shipped one. Under the user's split (general → user, lore → shipped/project), about 70% of user-04/05/06/17 belongs with the binary that it describes.

## Options

All three options keep the existing fragment format, the four outlets, CAS rules-file writes (D8) and `lore fragments check` as the single checker. They differ in where the library lives and what selects from it.

### Option A — Catalog in the existing layers + opt-in selection + `lore context add|remove`

- **Shape.** Each layer may hold catalog fragments that are not selected by default (frontmatter `default: false`, or a `catalog/` subdirectory). New config key `context.fragments.enable: [id…]` beside `disable`. `lore context list` prints the catalog (id, layer, audience, chars, selected?). `lore context add|remove <id> [--scope user|project]` edits the selection and then runs `refresh`. The project selection lives in a git-tracked file, because `.lore/config.yaml` is untracked here (D2).
- **What refuses a violation.** Zod strict schema on the selection; `check` and `refresh` exit non-zero for an unknown id, an id enabled and disabled at once, a scope enabling another scope's static main id (the existing D14 rule extended to `enable`), or a selected set over the hook caps (D6). New, cheap, mechanical: an exact-or-normalized duplicate-line detector across selected fragments, which turns this census into a `check` finding.
- **Concurrency.** The selection file is written with the same hash-precondition CAS as rules files (D8): read and hash, apply the set operation, write only if the hash is unchanged, else `CONFLICT`. Set add/remove is idempotent, so a retry converges. A running Claude Code session keeps the rules it loaded at launch until restart or compaction re-injection. The existing D7 stale notice covers that gap.
- **Distribution.** Shipped catalog = more `assets/context/*.md`, already manifest-tracked and shipped in the binary assets. No new runtime or DB dependency; the hook path stays bootstrap-stage without `bun:sqlite` (D13).
- **Migration of user-01..17.** Data only. Delete the 25 duplicate lines. Move lore-tool facts (user-04 methodology lines, user-05 l.5-6, user-06 clause, user-17 dispatch protocol, user-15 table) into shipped catalog fragments such as `ac-design`, `worktree-dispatch` and `evidence-attestation`, selected by default for lore users. Move user-17 l.12/14 into the project fragment and widen its audience. Turn user-04 l.13 and the `#Symbol` limit into issues. The user layer keeps 00, 01, 02, 08, 09, 10 (general parts), 12, 13, 14, 16.
- **Token cost per session.** Main: 39,441 B − 5,623 B (dup removal) = about 33.8 KB with the default selection, lower when the user or project opts out of a catalog fragment. Implementer: −936 chars if `agent-rules` becomes opt-out when the user layer covers it (D6).

### Option B — Corpus-native rules (new knowledge sub-type, selected in `.lore/config.yaml`)

- **Shape.** Each rule is a corpus doc (for example `knowledge --sub-type norm`; `rule` is taken by baseline `BR-*` rules and `lore rule add`). Selection lives in config, and an export step projects the selected docs to fragment files that the hooks read.
- **What refuses a violation.** Corpus gates: review/approve, record-lock, writer identity, audit chain. Every change has history and attribution, which A lacks.
- **Concurrency.** SQLite transactions plus doc versioning. Strongest of the three.
- **Distribution.** Weakest. (1) User-general rules have no home, because a corpus is per project and the user layer is machine scope, so B needs a cross-project corpus that does not exist. (2) The hooks are deliberately bootstrap-stage without `bun:sqlite` (spec D13), so they cannot read the corpus. A DB→file export hop has to be added and kept in sync, which recreates the staleness problem that D7 exists to catch. (3) A shipped library must be seeded into each corpus at `lore init`, so it can then drift from the binary.
- **Migration.** Import the 17 user files as docs (needs a home, see 1). Shipped fragments are seeded per corpus.
- **Token cost.** Same as A after export, plus the export machinery. No per-session saving over A.

### Option C — Role templates as named bundles resolved at run registration

- **Shape.** `assets/roles/<role>.yaml` (shipped) plus user and project overrides by id: `{id, extends?, fragments: [id…], when?: {paths/stack}, capabilities: {agent_type, skills: [...]}}`. Project config names the roles in use (`context.roles: [backend, java-backend]`). `lore run register` resolves role → fragment list and records `{schemaVersion: 2, role, role_hash, fragments[]}` in `runs.composition`.
- **What refuses a violation.** `run register` fails loud on an unknown role or fragment id, and `check` budgets every role × agent type against the caps. Capability claims can be checked only against what Claude Code exposes. A role's `agent_type` must exist, and the declared skills must exist. lore cannot grant or revoke tools at runtime: plugins and agent definitions carry skills, agents, hooks and MCP servers (Claude Code plugin docs, S tier, `code.claude.com/docs/en/plugins/overview`), and a plugin has no rules or memory component.
- **Concurrency.** Role files are immutable assets or git-tracked files. Selection is per run and is stored first-wins in `runs` (BR-1029). The only shared mutable state is the project's role list, which uses the same CAS as A.
- **Distribution.** Roles ship in assets. Context-bound selection (for example Java) needs new `WHEN_MATCHERS` keys (`paths`, `stack`) and a stack fact that lore does not collect today (`context-facts.ts` has only the module index and scripts).
- **Migration.** Needs A's catalog first: a bundle is a list of catalog ids. Without A, roles would bundle today's flat user layer.
- **Token cost.** Can only grow per run unless roles replace the current all-or-nothing user layer for subagents. The binding constraint is measured: lore-implementer already uses 8,720 / 9,400 chars, so a role that adds about 700 chars fails D6 today. C is only viable after A's dedup frees room or the cap policy changes.

### Comparison

| Criterion | A catalog + selection | B corpus-native | C role bundles |
|---|---|---|---|
| Refusal mechanism | strict schema + `check`/`refresh` exit, D14 extended, dup detector | corpus gates + audit chain | `run register` + `check` per role × agent |
| Concurrent selection change | CAS on selection file, idempotent retry | DB transaction | first-wins per run; CAS on role list |
| Fits bootstrap-stage hooks (D13) | yes | no (needs export hop) | yes |
| Home for user-general rules | yes (user layer) | no | via user-layer roles |
| Audit trail of selection changes | git history of the tracked selection file | full | git + run records |
| Records what a run carried | unchanged (issue #167 must be fixed separately) | unchanged | yes: role + fragments |
| New code surface | small: 1 config key, 3 verbs, 1 check | large: sub-type, export flow, seeding | medium: role schema, matchers, composition v2 |
| Per-session bytes vs today | −5.6 KB main baseline, more with opt-outs | same as A | +role content; blocked by the 680-char cap headroom |

## Recommendation

**A now, built so that C can be added later; reject B.** Confidence: MEDIUM-HIGH (75%).

- A is the only option that removes the measured waste (5.6–7.6 KB per main session) without a new storage or runtime path. It reuses the checker, CAS, outlets and layers that are already built and approved.
- The user's split rule ("project = project-specific, user = general mechanisms") becomes checkable under A. `check` gains a duplicate-meaning finding (exact and normalized lines). The migration moves lore-tool facts next to the binary that they describe, which also ends the measured staleness (user-03's "4 gates").
- B fails two hard constraints that were measured or specified: hooks must not open the corpus (D13), and user-general rules have no corpus home. Its one advantage, the audit trail, is mostly covered by keeping A's project selection in a git-tracked file.
- C is the right model for NS5, but it depends on A (a bundle needs a catalog) and on budget room that A's dedup creates. Its composition v2 also needs issue #167 fixed first, because a main run's composition is empty today. Sequence: A → fix #167 (composition includes `rules:user` + `rules:project` selections) → C as `role = named enable-list + agent_type + when` on top of A's catalog.
- Prefer mechanisms to prose. A's dup detector and C's per-role cap check are mechanisms. In the census, user-15 and user-16 restate shipped hooks (`pre-subagent-gate.mjs`, `stop-doc-sync.mjs`). Their prose should move into each hook's own denial or Stop message, so the rule appears only when the mechanism fires.

Unknowns that keep confidence below HIGH: no token measurement; no evidence yet that role-specific norms change outcomes (the role-templates knowledge doc rates its evidence E6); Claude Code's behaviour for rules files changed mid-session was taken from the spec's citations, not re-fetched this session.

## Open decisions for the user

- **D1 — Default selection.** Should catalog fragments be opt-in (nothing beyond the current core unless enabled) or opt-out (everything shipped is on unless disabled, as today)? Opt-in gives smaller sessions. Opt-out keeps fresh installs safe.
- **D2 — Where the project selection lives.** `.lore/config.yaml` is untracked in this repo, so a selection there diverges per clone. That already contradicts D14's "every teammate renders identical bytes" for `disable`. The choice is a tracked `.lore/context/selection.yaml`, tracking `config.yaml`, or accepting per-clone selection.
- **D3 — Ownership of lore-tool facts now in the user layer** (user-04 methodology, user-05 attestation facts, user-15 table, user-17 dispatch protocol). Promote them to shipped catalog fragments, which then ship to every lore user and need English bodies, or keep them personal?
- **D4 — Mechanism or prose for the tool-quirk lines** (user-04 l.13 `.records` filter; user-06 `#Symbol` ASCII limit). File them as defects and delete the prose, or keep the prose until fixed?
- **D5 — On-demand delivery.** Should A add a third delivery mode that renders a fragment as a skill (`~/.claude/skills/lore-<id>/SKILL.md`, loaded by description) for situational rules such as user-02 agent-browser (2,167 B every main session)? Skill triggering is probabilistic, so always-must rules stay static. Which fragments qualify is your call.
- **D6 — `agent-rules` versus user subagent fragments.** Keep the 936-char overlap (safe for users without a user layer), make `agent-rules` disable-able from the user scope for subagent outlets only, or trim it to non-overlapping lines?
- **D7 — Duplicate detector strength.** Should it be a hard `check` failure or advisory? And should it match exact plus whitespace-normalized lines only (deterministic), or also judge meaning (an LLM, therefore advisory by lore's own rule)?
- **D8 — Role scope for C, when it comes.** Is a role chosen per project (config), per dispatch (an explicit `--role` in the bundle), or derived from agent type plus task anchors? And should the cap policy (9,400 chars for subagents) be raised, or should roles replace parts of the user layer for subagents?
