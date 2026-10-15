---
id: PLAN-153
type: plan
role: plan
title: "Evidence labels and reds are honest"
status: archived
priority: high
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-173
phases:
  - {name: "falsifier-range", description: "#43: falsifier expected exit code 1..255 at declaration and at verify --falsify"}
  - {name: "capture-label", description: "#48: runner-unattested label for the inconclusive green-control row; injective rendering"}
  - {name: "pipe-refusal", description: "#19: one shared pipe detector; ac add/set refuse unsafe-piped test/e2e commands"}
  - {name: "red-proof", description: "#53: captured reds must show a failed test; 126/127 never a red; falsify discovery refusal"}
  - {name: "verification", description: "on main after the last merge: build, verify every script AC"}
links:
  - {id: SPEC-173, type: implements}
---
# Plan — Evidence labels and reds are honest

Implements `spec-evidence-labels-and-reds-are-honest` (AC-EH-1..11), baseline leaves `baseline-prove-a-red` (BR-1073, BR-1074, BR-1075), `baseline-declare-a-falsifier` (BR-1076), `baseline-record-evidence` (BR-1077), `baseline-declare-an-acceptance-criterion` (BR-1078). Issues #48, #43, #19, #53.

## Overview

Five implement units, each preceded by a RED test unit, serialized where they share files:

1. **falsifier-range** (#43): range 1..255 in the AC write chokepoint (every criteria write path, changed criteria only); `verify --falsify` refuses a stored out-of-range value before running.
2. **capture-label** (#48): `runner-unattested` in `CAPTURE_SOURCES`; every runner-observed unattested row uses it; both evidence writers refuse it with an attestation; status/assess/verify render a third label.
3. **pipe-refusal** (#19): `commandHasUnsafePipe` moves to `packages/core/src/command-pipe.ts`; the chokepoint refuses unsafe-piped commands for every script oracle except `other`, which gets a stderr advisory (user decision U1).
4. **red-proof (i)** (#53): `parseFailedCaseCount` + `findCapturedRedProofGap` on CLI and MCP capture; 126/127 never a red; the stored tail must carry the proof.
5. **red-proof (ii)** (#53): the falsify path records a discovery refusal or exit 126/127 as `inconclusive` / `runner-unattested`.

Order by shared files: #43 → {#48, #19}; #19 → #53(i); #48 → #53(ii). Cross-plan: Plan A's `task-skill-implement-extract-checkdonefloors-and-wire-the` blocks #48 (both edit task-workflow-service.ts; #48's done-floor assertion targets the extracted `checkDoneFloors`).

## Invariants

| # | Invariant | How it is checked |
|---|---|---|
| I1 | `bun run typecheck` exits 0 after every merge | AC-EH-11; orchestrator re-run on main |
| I2 | No service imports another service or an adapter module; the pipe detector lives in `@lore/core` | AC-EH-6 structural half; review of `ac-service.ts` imports |
| I3 | Every changed refusal names its exit: declaration refusals exit 4 (AC-EH-4, AC-EH-7); capture refusals are VALIDATION_ERROR on both surfaces (AC-EH-8, AC-EH-9); falsify refusal exit 4 with zero executor calls (AC-EH-5) | the named ACs |
| I4 | No AC command in this spec contains an unquoted pipe under any oracle except `other` (it would be refused by BR-1078 on its next edit); every runner command asserts exit 0 AND an executed-count floor without a pipe | `lore ac list spec-evidence-labels-and-reds-are-honest --json` checked by the verification task with the moved detector |
| I5 | Rendering is injective: runner + self-report + runner-unattested counts sum to the total | AC-EH-2 (c) |
| I6 | A RED task commits its tests on its own branch; the paired implement task branches from that commit plus every merged predecessor; nothing red merges to main alone | orchestrator merge order |
| I7 | No test writes the repository's live `.lore/` | mkdtemp + `lore init`; InMemoryStore |
| I8 | After the last merge: `bun run build` exits 0, the FULL `test:vitest` and `test:bun` suites pass, and `lore verify` of this plan passes on main | verification task |

## Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | The pipe detector refuses safe capture-then-pipe commands (measured: all 31 flagged stored commands are safe) | M | D7: re-check only on command/oracle/mode change; refusal names the POSIX mktemp form; flagged to the user as a measured cost of the reuse decision |
| R2 | A new `CaptureSource` member breaks an exhaustive switch the implement task did not anchor (adapter, MCP, eval) | M | `bun run typecheck` is the oracle; implement task adds the anchor with `lore anchor add` before editing any unlisted file |
| R3 | Playwright e2e reds have no recognised summary and are refused | M | out of scope by spec; refusal names the recognised formats; a follow-up issue if a dashboard RED task is blocked |
| R4 | A `--result fail` capture used today for a non-test oracle red with exit 127 is refused | L | D9 deliberately; message names the code |
| R5 | The falsify discovery check runs before the exit-code comparison and changes outcome codes | L | AC-EH-10 (d) control keeps the genuine-red path |

## Pre-registered branches

None.

## Decisions Log

- 2026-10-12 — user: #48 adds a new `capture_source` value meaning "runner observed, not attested"; the green-control-failed row uses it; readers treat it as not attested and render it distinctly. Name chosen: `runner-unattested`.
- 2026-10-12 — user: #43 (A) `ac add|set` refuses an expected exit code outside 1..255; (B) `verify --falsify` refuses a stored 0 before running, no row. Do not tighten the Zod schema.
- 2026-10-12 — user: #19 reuses `commandHasUnsafePipe`, moved to one shared pure module; the `set -o pipefail` false positive is accepted.
- 2026-10-12 — user: #53 for `--capture --result expected-fail` with test/e2e the tail must show a recognised runner summary with >= 1 failed test (reuse core summary patterns); 126/127 refused outright; add `findDiscoveryRefusal` to `verify --falsify`.
- 2026-10-12 — corpus author (needs the user's confirmation): #53's summary requirement also covers `--result fail`, because `lore done`'s red-first floor accepts `fail` rows (spec D8). Rejected: expected-fail only.
- 2026-10-12 — corpus author: #19 measured cost recorded (31/31 flagged stored commands are safe forms); kept the user's reuse decision (spec D7).
- 2026-10-12 — user (S3, U1): #19 refusal covers every script oracle except `other` (test, e2e, tsc, lint, build → exit 4); `other` gets a stderr advisory and exit 0.
- 2026-10-12 — S3 review: both criterion checks live in `ac-write-chokepoint.ts` for added/changed criteria on every write path; 126/127 on the falsify path is inconclusive; captured-red proof is read from the stored tail (a summary pushed out by later stderr is refused naming `2>&1`); the hand-printed-summary limit is stated in the spec; #53 split into capture (i) and falsify (ii) so no task is larger than M.
