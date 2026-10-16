---
id: SPEC-190
type: spec
role: spec
title: "Session trail: a session-local record of what each run changed, judged at turn end and carried by the handoff"
status: approved
priority: high
created: 2026-10-16
updated: 2026-10-16
tags: [session, turn-end, handoff, run-identity, hooks]
---
## Overview/Goal

The hooks already observe a session's file changes, but the state they keep is three loose per-turn files with no model behind them (`current-turn.id`, `<turn>/turn-start-snapshot.json`, `<turn>/edited-files.jsonl`). Four judgments a session needs about ITS OWN work cannot be made from recorded facts today:

| Judgment | Why it fails today |
|---|---|
| Did the main session change source this turn? | Only Edit/Write records count; a `sed -i`, a generator script or `mv` is invisible to BR-1089 |
| What did a helper agent change? | A helper's edits carry its `agent_id`, but nothing records its end, its working copy, or its shell-made and committed changes |
| Did a change to A come with its required change to B? | No co-change mechanism exists |
| What files does this handoff carry forward? | `modified_files` is whatever the agent types into `--file` (BR-343); a handoff from a session that landed four plans recorded `(none)` |

**Goal**: one session-local, hook-written **session trail** (turns, per-file changes each labelled with a change source, and per-helper measurements) and the consumers that judge it inside the same session: the turn-end review (unknown-source edits, co-change rules, helper scope) and the handoff (changed files filled from the trail).

**Scope decisions (user, 2026-10-16)**: everything in one spec; the trail is consumed inside its own session and crosses sessions only through a handoff; helper scope findings surface at the parent's turn end (not at SubagentStop); Bash-made changes are attributed at turn end as "source unknown" (no per-Bash snapshot); co-change rules are project config with no shipped defaults; trails idle for 14 days are removed at session start.

## Scope

**IN**
- Trail layout and writers (hooks only): turn snapshot extended with HEAD; per-turn change summary at turn end; helper record at SubagentStart/SubagentStop with end and judged-end counts.
- Change-source attribution at turn end (run / vcs / unknown), as a pure function in the hook library.
- Helper measurement at SubagentStop in the helper's own working copy (untracked files included).
- Turn-end review: BR-1089 counts unknown-source changes; co-change findings; helper scope findings; every helper judged exactly once.
- `lore run tasks <run-id> --json`: the tasks a run ever claimed, with their file anchors.
- `lore session trail [--turn <id>|--run <id>] [--json]`: the caller's own trail.
- `lore session trail-review --turn <id> --json`: config- and corpus-dependent judgments, relayed by the hook.
- `lore handoff`: changed files filled from the trail of the caller's attested session.
- Retention: trails idle for more than 14 days removed at SessionStart, leaving a removal marker.
- Config: `workflow.turn_end.co_change` (default `[]`), validated fail-loud; this repo's rule in `.lore/config.yaml`.

**OUT**
- Any cross-session read of a trail other than through a handoff (user decision).
- A per-Bash-call snapshot (user decision; a snapshot costs 393-819 ms on this repo, 4711 files).
- A session-end reminder: SessionEnd output never reaches the agent; the handoff fill covers "changes not carried forward".
- The legacy `~/.claude/session-state/state.db` (written only by hooks retired 2026-07-13/17): not read, not removed.
- Re-scoping `lore session list|show` (claims + liveness, corpus-wide).
- Who started a nested helper: the trail stores run ids only and defers parentage to the run registry (BR-1027, BR-1038); whether the registry is right for nested helpers is run identity's question.

## Design

### Trail layout (local, under the existing state base)

```
<stateBase>/sessions/<session_id>/          # stateBase: CLAUDE_STATE_BASE_OVERRIDE || ~/.claude/session-state
  current-turn.id                            # existing
  session.json                               # NEW: {started_at} written once at SessionStart (own-commit window); a session resumed after removal restores started_at from removed.json, so the window never shrinks
  removed.json                               # NEW: {removed_at, started_at} left by retention; started_at copied from the removed session.json
  <turn_id>/turn-start-snapshot.json         # existing + "head": <commit|null>
  <turn_id>/edited-files.jsonl               # existing, unchanged (BR-1088)
  <turn_id>/changes.json                     # NEW, written by the turn-end review
  helpers/<agent_id>.json                    # NEW: written ONLY by SubagentStart/SubagentStop (temp file + rename)
  helpers/<agent_id>.judged.json             # NEW: written ONLY by the turn-end review: {judged_end_count}
```

```ts
// packages/core/src/session-trail.ts — zod schemas + reader + stateBase()/sessionOfRun() (twin of
// assets/hooks/lib/turn-state.mjs getStateBase and lib/run-id.mjs); assets/hooks/lib/session-trail.mjs
// mirrors writers/reader for hooks. One parity test pins schema, state-base resolution and run-id parsing.
type ChangeSource = { kind: "run"; run: string } | { kind: "vcs" } | { kind: "unknown" };
interface TrailChange { path: string; status: "A" | "M" | "D"; lines: number; source: ChangeSource }
type Measured<T> = { measured: true; value: T } | { measured: false; reason: string };
interface TurnChanges { turn: string; at: string; shared_working_copy: boolean; changes: Measured<TrailChange[]> }
interface HelperRecord {           // run facts the corpus run registry does not hold; parentage is NOT stored here
  run: string;                     // cc:<session>:<agent_id>
  started_at: string; ended_at?: string; end_count: number;   // judged_end_count lives in <agent_id>.judged.json
  working_copy?: string;           // SubagentStop payload cwd (measured 2026-07-21: the worktree when isolated)
  isolated?: boolean;              // git-common-dir != git-dir
  changes?: Measured<{ base: string; files: TrailChange[] }>;
}
```

The corpus run registry (run identity D4) is the authority for a run's kind, type, parent and registration; the trail holds only what the registry cannot: per-turn changes, a helper's working copy, end time and measured files. The trail works in a project with no corpus.

### Attribution at turn end — `attributeTurn()` pure function in `lib/session-trail.mjs`

Inputs: `D = diff(turnStartTree, nowTree)`, the turn's edit records, the HEAD reflog entries written during the turn.

1. A path named by an edit record of this turn → `source: run` (main, or `cc:<session>:<agent_id>`). Always first.
2. Else, a path changed by a reflog step that takes in OTHER commits — actions `merge`, `pull`, `checkout`, `rebase`, `reset`, `cherry-pick`, and `commit (merge)` (a merge concluded after conflicts, diffed against its first parent) — whose working-tree content equals the post-step HEAD, and that is not a conflicted path of that step → `source: vcs`. Conflicted paths of a merge step are recomputed from its two parents with `git merge-tree --write-tree --name-only` (no dependence on the index state at Stop). A step whose action is `commit` / `commit (amend)` never yields vcs; a squash merge is such a commit (D15). **Own commits are never laundered**: the session's own commits are every non-merge commit this checkout's HEAD reflog records with a `commit` or `commit (amend)` action since `session.json.started_at`; their `git patch-id --stable` values form the own set. A candidate vcs path is downgraded to `unknown` when any NON-MERGE commit in `oldHead..newHead` (`git rev-list --no-merges`) that changed it is an own commit or has a patch-id in the own set — so 'commit on a side branch, then merge it' and 'commit, reset, then cherry-pick it' (new SHA, same patch-id) both yield unknown, while the merge commit that concludes a `commit (merge)` step is never itself an own commit and cleanly merged paths stay vcs. Helper worktrees have their own HEAD reflogs, so helper commits merged in stay vcs.
3. Every other path → `source: unknown` (shell edits, the session's own commits of shell edits, `stash pop`, hand-resolved conflicts).
4. `shared_working_copy = true` when a non-isolated helper was running at any point in the turn.
5. Write `<turn>/changes.json`; any failed step writes `changes: {measured:false, reason}`.

The snapshot's temporary index is seeded by copying the real index (`git rev-parse --git-path index`) so unchanged files are not re-hashed.

### Helper measurement — `assets/hooks/subagent-trail.mjs` on SubagentStop (timeout 10)

Isolated helper: `base = merge-base(helper HEAD, main checkout HEAD)` computed at the helper's FIRST measured end and stored in its record; every later end reuses the stored base, so a main checkout that has meanwhile merged or moved past the helper's branch cannot shrink the measurement; files = diff(base, helper working tree via temporary index + `add -A`, untracked included); paths outside the working copy excluded from this diff. Non-isolated helper: `changes = {measured:false, reason:"not isolated"}` — its edit-tool changes are still in the parent's edit records. SubagentStop can fire more than once (another SubagentStop hook may block with exit 2): each firing overwrites the measurement and `ended_at`, `end_count` increments.

### Consumers

| Consumer | Reads | Judges |
|---|---|---|
| BR-1089 source-edit finding (existing, setting-gated) | `changes.json` | main-run + unknown count; vcs never; when `shared_working_copy` unknown is listed but not counted; attribution unmeasured → no verdict, one not-measured line; BR-1090 unaffected |
| Co-change (new) | helper ends not yet judged + `changes.json` | per run, plus unknown-source changes as one group: a changed path matching `when` and none matching `require` |
| Helper scope (new) | helper ends not yet judged; their files = measured changes ∪ edit records naming the helper anywhere; `lore run tasks` | a file no anchor of any task the helper claimed covers (anchor matching reuses `anchorsOverlap`, `file-anchors.ts`); a file outside its working copy; changed files and no claimed task; only when `.lore/` exists |
| Handoff (changed) | the whole trail of the attested run's session | fills changed files with source labels; author files kept and marked |

Judging each helper end once: every helper record carries `end_count` (incremented per SubagentStop); the review keeps `judged_end_count` in a separate file it alone writes, so no file has two writers. A review snapshots each helper's `end_count` when it starts, judges the helpers whose snapshot exceeds `judged_end_count`, and once its helper judgments complete writes `judged_end_count = <snapshot>` (never a re-read value); an end landing during the review raises `end_count` past the snapshot and is judged by the next review. Every trail file is written to a temporary file and renamed into place — so each END is judged by exactly one review, a helper ending between turns is judged by the next review, and a helper that ends again after being judged is judged again for that new end only. When `trail-review` fails or times out, nothing is marked judged: the not-measured line names the helpers left unjudged and the next review judges them.

Spawn gating: the hook spawns `lore session trail-review` only when some helper has `end_count > judged_end_count` or the `co_change` key is present (`readYamlScalar` returns `''` for a list key: presence only, no list grammar in the hook).

Blocking vs refusing: only `stop-turn-review.mjs` can block, and only a turn's end (BR-1087, allowed by BR-1092 because it is not a per-tool-call hook). Every trail hook added here (`session-trail-start.mjs`, `subagent-trail.mjs`, the turn-open and edit writers) exits 0 with empty stdout on every path.

Config failure: `trail-review` parses `workflow.turn_end.co_change` itself through the `@lore/core` schema (not the loader's silent fallback, `adapters/cli/loader.ts:21-26`). Invalid settings do NOT abort the run: the result carries `co_change: {measured:false, reason}` naming the key path (e.g. `workflow.turn_end.co_change[0].require`) and the helper judgments still complete; `lore config`-style validation of the same key exits 4 `VALIDATION_ERROR`. `trail-review` itself exits non-zero only when it cannot run at all; the hook turns any non-zero exit or timeout into the not-measured line (modified BR-1087), never into "no finding".

```yaml
workflow:
  turn_end:
    main_session_source_edits: off        # existing
    co_change:                            # NEW, default []
      - name: assets-manifest
        when: ["assets/**"]
        require: ["packages/lore/src/generated/assets-manifest.ts"]
```

### Run → tasks

`lore run tasks <run-id> --json` reads `queryAudit({action: "claim"})` rows whose `details.harness_run` equals the run (`task-workflow-service.ts:2960`; kept after release), then each task's current `file_anchors`. An unknown run id is refused like BR-1038.

### Run → session for CLI consumers

`lore session trail` and `lore handoff` take the caller's run from `--harness-run` (CLI, rewritten by `pre-tool-harness-run.mjs`) or `harness_run` (MCP), derive the session id from `cc:<session>[:<agent>]`, and read `<stateBase>/sessions/<session>`. A caller with no attested run, a non-`cc:` run, or a process whose state base holds no such session gets "not measured" (handoff) or exit 4 with a message naming the trail-access rule (trail).

## Design Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Name | "session trail" | "session ledger" | "ledger" names auto-approved records (autonomy) in the Session glossary; "trail" is qualified everywhere as "session trail" because "audit trail" names the corpus change history (leaves "Query/Verify the audit trail") |
| D2 | Where it lives | local state base, per session | corpus; SQLite `state.db` | user: session-only; a corpus write per edit breaks "self-checking cheaper than corpus growth"; the SQLite store was retired once |
| D3 | Writer | hooks only | agent-written fields | agent-written = self-report ("an agent should remember") |
| D4 | Bash changes | turn-end residual labelled unknown | per-Bash snapshot | user; ~0.8-1.6 s per Bash call |
| D5 | vcs label | only reflog steps taking in other commits, edit records first | content equality alone | content equality labels the session's own commits vcs and erases BR-1089 (review finding) |
| D6 | Helper base | merge-base at SubagentStop | SubagentStart snapshot | SubagentStart `cwd` = worktree is UNVERIFIED; SubagentStop `cwd` is measured |
| D7 | Helper scope timing | parent turn end, each helper END judged once (`judged_end_count`) | block at SubagentStop; "ended this turn"; one global time cursor | user; per-end counting catches helpers ending between turns and a helper that ends again, without judging any end twice (review findings) |
| D8 | Config/corpus judgments | binary verb, relayed | parse in hook | no list YAML grammar in a standalone hook (run identity D10 invariant) |
| D9 | Run → tasks | audit `claim` rows with `harness_run` | current claim; version scan | implementers release before stopping; the audit row survives release and is indexed by action |
| D10 | Parentage | not stored in the trail | trail field | the run registry is the authority (BR-1027); two stores already disagreed in review |
| D11 | Retention | idle > 14 days, marker left, starting session spared | liveness-gated; 30 days; none | user chose 14 days; the marker makes a resumed session's lost part read as removed, not as "no change", without claiming the session ended (Stale ≠ ended) |
| D12 | CLI surface | `lore session trail` / `trail-review` | top-level verb | the noun exists; `--session`-less: the session always comes from the caller's run, so the harness session id never meets the claim-derived "active session" id of `session list|show` |
| D13 | Where not-measured is seen | new trail hooks write nothing; failures become `measured:false` in the trail (every reader shows it). The turn-end review's not-measured line goes into the block reason when it blocks (the model sees it) and into `systemMessage` when it does not (shown to the user, hooks docs 'JSON output'), keeping the existing stderr line too so AC-TE-3 stays valid | stderr only | ADR delivery tiers: a hook output nobody sees belongs to no tier. UNVERIFIED: the Stop section of the hooks docs does not restate that Stop displays `systemMessage`; the measurement task confirms it once on a real session and records it as manual evidence |
| D15 | Squash merges | the squash commit is the session's own commit → unknown | treat as vcs | a squash commit has one parent: nothing distinguishes it from the session committing its own edits; this repo merges helper branches with `--no-ff` (worktree-dispatch rule), which is labelled vcs |
| D16 | Handoff fields | `modified_files` keeps exactly what the author typed (existing meaning, BR-343); new `changed_files` is the merged view (trail ∪ author, author entries marked) and is the one rendered | one list | keeps old handoffs and the author's raw input readable; the renderer shows one list |
| D17 | Removal markers | a marker is itself removed 90 days after the removal it records | keep forever | markers are a few bytes but would otherwise accumulate without bound |
| D14 | Unknown under a shared working copy | listed, not counted for BR-1089 | counted | a non-isolated helper's shell edits are indistinguishable from the main session's; counting would break BR-1088 |

## Known limitations (accepted at S4, 2026-10-16)

- **A failed edit-record write reads as `unknown`, not `unmeasured`.** If `post-edit-mark.mjs` cannot append its record, the turn-end attribution sees no record for that file and labels it unknown (it is still listed and, for the main session, still counted by BR-1089). The trail cannot tell "never recorded" from "no edit happened" because the writer that failed is the one that would say so.
- **Own-commit window after a long absence.** A removal marker expires 90 days after it is written; a session resumed more than 14 + 90 days after its last write starts a fresh own-commit window, so own commits from before that point could be labelled vcs if merged later.

## Acceptance Criteria

Structured criteria (`lore ac add`) are authoritative; each cites the rule it proves. All script ACs run in a throwaway git repo + `mkdtemp` state base (`CLAUDE_STATE_BASE_OVERRIDE`) and, where a corpus is needed, `mkdtemp` + `lore init`; never this repo's `.lore/` or the real `~/.claude`.

Performance is recorded at landing, not asserted as an AC (timing on a shared machine is not deterministic), p50 of 20 runs on this repo: Stop's added cost without a trail-review spawn, target ≤ 150 ms; with the spawn this repo will actually run (its `co_change` key is present), target ≤ 400 ms (`lore` cold start measured at ~230 ms); SubagentStop measurement ≤ 2 s. AC-ST-10 asserts the deterministic half: no `lore` spawn when nothing needs judging.

## Perspective Gates (module mode)

- [x] No circular dependencies: hooks → `lib/session-trail.mjs`; CLI → `@lore/core` `session-trail.ts`; hooks → CLI by spawn only.
- [x] Single responsibility: writers (hooks), attribution (pure `attributeTurn`), reader (lib/core), judgments (`trail-review`), consumers (review hook, handoff).
- [x] Public API sufficient for black-box testing: every judgment observable through hook stdout, trail files, or `--json` verbs.
- [x] Dependencies injectable: state base via `CLAUDE_STATE_BASE_OVERRIDE`, git via cwd, lore via PATH.


## Acceptance Criteria (structured)

- [⚑] [script] AC-ST-1: In a mkdtemp state base: an Edit payload with agent_id is recorded under helper run cc:S:A in session S trail and its turn; SubagentStart creates helpers/A.json in session S; a second SessionStart (source compact or resume) leaves existing trail files untouched; a payload with no session_id writes nothing and prints nothing on stdout or stderr; the hook reader and the @lore/core reader agree on a fixture trail, on state-base resolution (override and default) and on run-id parsing, and renaming one schema field in either reader turns that parity test red.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/session-trail-runs.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 7 ] && echo 'AC-ST-1 PASS: edits and helper records land in the parent session trail; readers agree on schema, state base and run id'
- [⚑] [script] AC-ST-2: In a throwaway repo with a linked worktree, SubagentStop with cwd = the worktree records exactly {src/b.ts (committed), src/c.ts (new untracked, written by shell)} and not a file written outside the worktree; firing SubagentStop twice keeps only the second measurement and end_count 2; a helper whose cwd is the main checkout records changes {measured:false, reason:not isolated}; a helper whose worktree was removed records measured:false with a reason; a helper that ends, whose branch the main checkout then merges, and that ends again still has src/b.ts recorded at its second end (the base stored at its first end is reused); every case exits 0 with empty stdout.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/subagent-trail.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 6 ] && echo 'AC-ST-2 PASS: isolated helper changes measured incl commits and untracked files; repeat end replaces; non-isolated reads unmeasured'
- [⚑] [script] AC-ST-3: attributeTurn and the turn-end hook in a throwaway repo write changes.json with: Edit -> run; Edit then commit -> run; sed -> unknown; sed then commit -> unknown; merge of another branch -> vcs; fast-forward pull -> vcs; rebase onto another branch -> vcs for that branch paths; cherry-pick -> vcs; reset --hard to another commit -> vcs; a merge concluded with commit after a conflict (reflog commit (merge)) -> cleanly merged paths vcs and the hand-resolved path unknown; squash merge then commit -> unknown; commit on a side branch in this checkout then merge it -> unknown; commit, reset --hard back, then cherry-pick that commit -> unknown (matched by patch-id); a conflicted merge concluded by commit leaves its cleanly merged paths vcs (the concluding merge commit is not an own commit); stash pop -> unknown; a rename -> D old + A new; non-git directory -> changes measured:false with a reason; a missing changes.json reads unmeasured through the reader, never as an empty list.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/session-trail-attribution.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 19 ] && echo 'AC-ST-3 PASS: every change gets run, vcs or unknown; own commits never vcs; conflicts and stash pop unknown; unmeasured is not empty'
- [⚑] [script] AC-ST-4: With main_session_source_edits: block: sed on 10 lines of src/e.ts -> one block whose text contains src/e.ts and source unknown; sed then commit -> the same finding; merging a 200-line branch -> exit 0, empty stdout; the same sed while a non-isolated helper record is open in the turn -> file listed as not counted, no block; attribution unmeasured -> no block, stdout JSON with no decision and a systemMessage naming the source-edit finding as not measured, plus one stderr line containing 'not measured' and 'source-edit'; attribution unmeasured together with another finding -> one block whose reason also names the source-edit finding as not measured; setting off -> exit 0, empty stdout.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/stop-turn-review-trail-source-edits.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 7 ] && echo 'AC-ST-4 PASS: source-edit finding counts main and unknown sources, never vcs; shared working copy listed not counted; unmeasured gives no verdict'
- [⚑] [script] AC-ST-5: SessionStart in a mkdtemp state base: another session trail whose newest write is 14 days + 1 hour old is replaced by removed.json carrying the removal date; one 13 days 23 hours old is kept; the starting session own trail with 30-day-old files is kept; state.db and a non-directory entry in the sessions base are untouched; a session that resumes after removal lists its earlier part as removed on that date via the reader; removed.json carries the started_at of the removed session.json and a session resumed after removal writes session.json with that same started_at; a marker written 90 days + 1 hour ago is removed and one written 89 days 23 hours ago is kept.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/session-trail-retention.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 8 ] && echo 'AC-ST-5 PASS: idle trails over 14 days removed with marker; own and recent trails kept; foreign entries untouched; removed part reads removed'
- [⚑] [script] AC-ST-6: lore session trail --json under --harness-run cc:S returns every file of fixture session S with status A/M/D and source run/vcs/unknown; --turn and --run narrow to exactly that turn or run; under cc:S:A it returns session S; an unmeasured turn is returned as unmeasured with its reason; with no attested run it exits 4 with a message containing BR-1143 and prints no file.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/cli/session-trail.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 6 ] && echo 'AC-ST-6 PASS: lore session trail lists the caller session by whole, turn and run; helpers see their session; no attested run refused'
- [⚑] [script] AC-ST-7: With co_change rule {name assets-manifest, when assets/**, require packages/lore/src/generated/assets-manifest.ts}: trail-review reports a helper run that changed assets/x.md only (finding names assets-manifest, the run, assets/x.md); none when the run also changed the manifest; one for unknown-source assets/y.md as the unknown group; none with no rule; a rule missing require makes trail-review exit 0 with co_change measured:false naming workflow.turn_end.co_change[0].require while a helper scope finding in the same run is still reported; stop-turn-review puts a relayed finding in its single block, and on a non-zero or timed-out trail-review prints one not-measured line and exits 0; the not-measured line for invalid settings is printed alongside a block when one exists. This repo .lore/config.yaml declares assets-manifest.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/cli/session-trail-review-co-change.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 9 ] && echo 'AC-ST-7 PASS: co-change judged per run and for the unknown group; invalid config fails loud; hook relays findings and failures'
- [⚑] [script] AC-ST-8: In a throwaway corpus: lore run tasks <helper-run> --json lists a task the run claimed then released, and a task it claimed that is now archived, each with its anchors; an unregistered run id exits 4 naming it; trail-review reports a helper file outside its task anchors (names helper, task, file); none when directory anchor src/ covers src/a/b.ts; a finding when the helper wrote by absolute path into the main checkout; a finding for changed files with no claimed task; none for a helper that changed nothing; none when the project has no .lore directory.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/cli/session-trail-review-helper-scope.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 9 ] && echo 'AC-ST-8 PASS: run tasks finds released claims; helper files outside anchors, outside its working copy, or without a claim are findings'
- [⚑] [script] AC-ST-9: A helper whose SubagentStop lands after turn 4 review and before turn 5 opens is judged by turn 5 review and not by turn 6 review; two helpers ending in turn 2 are both judged by turn 2 review; a review with no finding still records judged_end_count equal to the end_count it read at its start; a review whose trail-review exits non-zero leaves judged_end_count unchanged, names the helper in its not-measured line, and the next review judges it; a helper judged at end 1 that ends again is judged once for end 2 and end 1 is not re-reported; a SubagentStop that lands while a review is running (end_count raised after the review read it) is not marked judged by that review and is judged by the next one.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/stop-turn-review-cursor.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 6 ] && echo 'AC-ST-9 PASS: each helper end is judged by exactly one completed review, including ends between turns, repeated ends and failed reviews'
- [⚑] [script] AC-ST-10: With a PATH stub that counts lore invocations: a turn with no unjudged helper end and no co_change key in .lore/config.yaml spawns trail-review zero times; adding the co_change key makes it spawn exactly once; an unjudged helper end makes it spawn exactly once.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/stop-turn-review-spawn-gating.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 3 ] && echo 'AC-ST-10 PASS: no lore spawn when no helper ended and no co_change key; one spawn otherwise'
- [⚑] [script] AC-ST-11: lore handoff under --harness-run cc:S whose trail holds 6 files across 2 turns (sources run, vcs and unknown), given by separate fields with no --file, records all 6 with their sources; the same via --json-file records the same 6; an author --file absent from the trail is kept and marked as named by the author; with no attested run the rendered handoff reads changed files: not measured; a trail with one removed and one unmeasured turn renders those turns as removed and unmeasured, never as no change.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/cli/handoff-trail-files.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 5 ] && echo 'AC-ST-11 PASS: handoff lists every trail file with its source both ways of giving it; author files marked; no trail reads not measured'
- [⚑] [script] AC-ST-12: The shipped roster and the regenerated assets manifest register the trail hooks on SessionStart, SubagentStart, SubagentStop (timeout 10), UserPromptSubmit and PostToolUse for edits, and none on PreToolUse; each new trail hook exits 0 with empty stdout for: malformed stdin, missing session_id, an unwritable state base, a non-git cwd, and no lore on PATH.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/unit/hooks/session-trail-roster.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 7 ] && echo 'AC-ST-12 PASS: trail hooks shipped on session start, helper start and end, turn open and edits; none refuses a tool call; all fail open'

## Code anchors

- packages/core/src/session-trail.ts
- packages/core/src/session-trail-node.ts
- assets/hooks/lib/session-trail.mjs
- assets/hooks/session-trail-start.mjs
- assets/hooks/subagent-trail.mjs
- assets/hooks/stop-turn-review.mjs
- assets/hooks/user-prompt-turn-start.mjs
- packages/lore/src/adapters/cli/commands/session.ts
- packages/lore/src/adapters/cli/session-trail-render.ts
- packages/lore/src/service/helper-scope-review.ts
- packages/lore/src/service/co-change-review.ts
- packages/lore/src/service/run-service.ts
- packages/core/src/session.ts
- packages/lore/src/service/session-service.ts
- packages/core/src/distribution-hooks.ts
- packages/core/src/config.ts
