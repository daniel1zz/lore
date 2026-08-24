---
id: KN-543
type: knowledge
role: knowledge
title: "An equality oracle over two copies goes vacuous the moment the copies are collapsed, plus three findings from closing the defect channel's SSOT"
status: approved
priority: high
created: 2026-08-24
updated: 2026-08-24
tags: [oracle-design, vacuous-ac, ssot, mirror, concurrency, triage, retro]
parent: PRD-001
---
# An equality oracle over two copies goes VACUOUS the moment the copies are collapsed — plus three other things measured while closing the defect channel's SSOT

Measured 2026-08-24 across `spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired`
and `spec-the-retired-shape-refusal-message-has-two-byte-identical`, both closed and pushed
(`ecf02cee`).

## F1 — AC-MS-2's behavioural half is VACUOUS after the fix it verifies

`lore assess` named it precisely: AC-MS-2 asserts the MCP handler's refusal message EQUALS
`buildRetiredFeedbackUpstreamError()`'s output. Before the fix, the handler had its own copy,
so the comparison had real discriminating power (and it did fail — measured). After the fix the
handler CALLS that builder, so the assertion compares a value to its own source. It passes by
construction and can never fail again.

⛔ The general shape: **an oracle whose subject is "two things agree" loses all power the
moment the two things become one thing.** Its red state is only reachable in the pre-fix world.
That is not an argument against writing it — the red run is what proved the defect — but it
means the AC cannot be counted as ongoing protection. The ongoing protection here is AC-MS-1's
whole-tree grep (zero source files outside the classifier hold the literal), which stays
falsifiable forever: any future copy trips it.

⇒ When a plan collapses N definitions into one, the DURABLE oracle is the structural one that
counts definitions, not the behavioural one that compares them. Write both; expect only the
first to survive the merge. ⛔ And say so in the AC, otherwise a later reader counts a vacuous
AC as coverage.

## F2 — I wrote "byte-identical" three times and it was false every time

The spec title, root `CLAUDE.md`, `KN-522`'s F1 note, and the plan's baseline table all claimed
the two copies of the retired-shape message were byte-identical. Measured with
`git show <pre-fix>:<path>` on both files:

- `report-issue-wiring.ts` -> `... to file/list issue reports via GitHub.`
- `adapters/mcp/tools.ts`  -> `... to file issue reports via GitHub.`

⛔ Root cause of the false claim, and it is mechanical, not careless: I grepped the SHARED
substring (`configured with the retired SQLite shape`), found it in both files, and recorded
"byte-identical". **A partial comparison is not an equality check.** The bytes that differed
were precisely the bytes outside my grep pattern — which is the same failure mode as a
structural AC being only as wide as the file list it greps, one abstraction level down.

The drift had been live, unobserved, for as long as the duplicate existed. So the plan was not
preventing a hypothetical future divergence; it was closing an actual one. assess caught the
contradiction between the shipped docstring (correct) and the plan's baseline (wrong) and was
right about which was which.

## F3 — 10 red tests, 9 of them self-inflicted, separated by ONE ordering step

Full vitest on main after four merges: 10 failed / 9335 passed. Triage:

| after | failures | cause |
|---|---|---|
| initial run | 10 | — |
| `bun run mirror:export` | 9 | 1 was a frontmatter-status parity failure from corpus writes not yet projected |
| `+ lore export-docs --force` | 1 | 8 more were BODY drift; `mirror:export` alone does NOT rewrite an existing file's body |
| — | 1 | the deferred ENOBUFS (`lore list --type knowledge --json` = 21.57 MiB vs a 20 MiB maxBuffer) |

⛔ `mirror:export` and `lore export-docs --force` are NOT interchangeable: the first reconciles
count/slug parity, the second reconciles BODIES. Running only the first after a batch of corpus
writes leaves body drift, which surfaces as `expected 2 to be +0` — an assertion on
`runMirrorScript(["--check"])`'s exit code, where 2 is `MIRROR_DRIFT_EXIT_CODE`. That message
names no corpus, no file, and no drift; it reads like a failed count comparison. The full order
is: all corpus writes -> `mirror:export` -> `export-docs --force` -> commit -> run suites.

⇒ Before attributing ANY mirror-test failure to code, run those two commands and re-run. Nine
of ten failures here dissolved without a line of code changing.

## F4 — The mirror content-parity oracle is unsatisfiable under concurrency, now with direct proof

`knowledge-the-mirror-content-parity-oracle-is-structurally` argued this from mechanism. Direct
evidence measured this session: minutes after a clean `check:spec-mirror` (EXIT=0), it returned
EXIT=2 naming docs THIS SESSION NEVER TOUCHED — `KN-542-a-dry-run-flag-that-does-not-exist`,
`SPEC-148-lore-phase-add-and-phase-rm`, `ADR-038-phase-writes-log-a-version-row`. All three
were written by a CONCURRENT session against the shared corpus.

⛔ So the oracle's green state is not merely fragile, it is not OWNED by any one session: no
sequence of actions available to me keeps it green while another writer exists. The standing
brief already disqualifies this shape ("an answer that relies on exclusivity ... is a refusal
of the target state"). Practical consequence recorded: `check:spec-mirror`'s content half must
not be used as a release gate, and it is correctly absent from `hooks/pre-push`.
