---
id: SPEC-195
type: spec
role: spec
title: "Test governance: guards that refuse bad tests, declared inputs for scoped selection, one full run per round"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-17
tags: []
---
## Overview/Goal

Make the test suite cheap to run incrementally and unable to lie, so every task proves itself with a scoped run and the full suite runs once per round as a cross-check.

Measured on main 2fc7661e (2026-10-16):
- Cost: vitest 730 files, about 5 minutes wall time (888 s summed per file); bun test 311 files, 3140 tests, 1235 s run serially (`test:bun` passes no concurrency flag). No single hotspot: the 60 slowest bun files are 65% of the time.
- Size: about 336k lines of tests against about 160k lines of source; 185 bun test files spawn a subprocess, 271 create a temporary repository.
- Selection: `bun run test:changed` on e58b9365 (one changed line in a rules fragment plus the regenerated `assets-manifest.ts`) selected 264 test files: 220 as `binary-consumer`, 28 as `tree-scan-oracle`, 1 changed test. The 6 tests that actually read the fragment were all selected; everything else was selected by blanket rules, because tests do not declare the files they read.
- Runners: vitest 3.2.6 has `--changed` / `related` but sees only static imports of vitest files; bun test 1.3.10 has no change-based selection. Two runners exist because 78 files under `packages/lore/src` import `bun:sqlite`, which vitest (running on Node) cannot load (AS-13).
- Isolation: 10 tests read or write this repository's live corpus or tree (audit 1: 5 to move, 4 to rewrite, 1 to delete). Nothing refuses a test-time write to the repo's `.lore/lore.db` (AS-14 is prompt-only).
- Prose pins: 4 tests pin whole sentences of rules fragments or CLAUDE.md (audit 2); about 12 more pin whole runtime error sentences; 4 tombstone tests duplicate one retirement fact.
- Oracle drift: 46 of 684 test paths named by AC commands do not exist; AC-080-1's oracle file was deleted in 4b515543 and the AC still renders attested_pass (violates AS-17). Store test files are copied three times (about 5000 lines) and already disagree.

## Scope

In scope, in this order:

1. Runner decision (ADR, user decides): measure (a) bun test only, with our own change-based selection; (b) vitest running under the Bun runtime; (c) a storage seam so most tests run in vitest on the in-memory store. Measure compatibility (files that fail unchanged), wall time, and the number of test files that must change. Includes the audit of the tests that start the compiled binary: which can call the command in-process instead.
2. Guards that refuse bad tests mechanically:
   - a test-run marker (`LORE_TEST_SANDBOX=1`, set by vitest `setupFiles` and a bun `preload`) under which corpus resolution refuses this repository's own `.lore/lore.db` (AS-14 target rule);
   - a repo-tree snapshot before and after each runner invocation that fails on any new or modified tracked/untracked file, with exceptions only in `scripts/test-isolation-ledger.json`;
   - `scripts/check-prose-pins.ts`: a test asserting a string literal of 5 or more words against a rules fragment, CLAUDE.md or other shipped prose fails unless `scripts/prose-pin-ledger.json` names the consumer of that prose; wired into `hooks/pre-push` and the shipped `assets/project/pre-push`;
   - `check:ac-oracle-ownership`: every script AC's command names test files that exist, and each AC has exactly one owning test file;
   - `lore verify` records an AC whose oracle file is missing as not measured (naming the path), never pass or fail, and `lore done` refuses a task covering it until the AC is repointed (AS-17).
3. Declared test inputs: each test that reads a file other than through a static import declares that file (format chosen after the runner ADR); the selector uses static imports plus declared inputs, and drops the blanket `tree-scan-oracle` rule.
4. Cleanup of existing tests: the 10 live-corpus / repo-write tests; the 4 prose pins and the runtime-error sentence pins; the 4 duplicate tombstone files merged into one retirement registry test; the three store test copies merged into shared files; the 46 missing oracle paths repointed; true duplicate AC tests (AC-AI-5/6/7/11, AC-ACODE-3, AC-ROI-1 and the rest found by the ownership check) merged.
5. Cadence: each task runs the selected tests plus `bun run typecheck`; the full suite runs once per round on main, in parallel, and its result is used to check the selector (a test that failed in the full run but was not selected for the commits that broke it is reported).

Approved ACs touched by the cleanup (AC-MOS-2, AC-PHASEVER-2/3, AC-FR-6/7/10, AC-GV-5, AC-BFI-6/7, AC-TC-2, AC-OX-6) are changed with `lore ac set --correction` and a written reason, never silently.

Out of scope: the 8 defect-backlog plans and plan-repository-upkeep-backlog; the dashboard Playwright suite.

## Acceptance Criteria

AC-TG-1..11 (`lore ac add`). AC-TG-1 is the user-facing runner decision; AC-TG-2..6 are the guards; AC-TG-7/8 the selector; AC-TG-9 the cleanup exit; AC-TG-10/11 the full run on main and its wall-time limit.


## Acceptance Criteria (structured)

- [⚑] [human] AC-TG-1: An ADR records the measured comparison of three runner options (bun test only with our own selection; vitest under the Bun runtime; a storage seam letting most tests run in vitest on the in-memory store) and of in-process vs compiled-binary execution for the binary-spawning tests: for each option the count of test files failing unchanged, the wall time of the full suite on this machine, and the count of test files that must change; the user picks one option and the ADR is approved
- [⚑] [script] AC-TG-2: With LORE_TEST_SANDBOX=1, resolving a corpus whose lore.db lies inside this repository's own .lore/ fails with exit code 4 and a message naming LORE_TEST_SANDBOX and the refused path, for a read and a write; a throwaway corpus under mkdtemp resolves normally; vitest setupFiles and the bun preload both set the variable (asserted from inside each runner)
  script: test — bunx vitest run packages/lore/tests/integration/test-sandbox-guard.test.ts
- [·] [script] AC-TG-3: A runner invocation whose tests create or modify any file in the repository tree (tracked or untracked, gitignored build output excluded) fails with exit code 1 and names each such path, unless scripts/test-isolation-ledger.json lists that path with a reason; a run that writes only under mkdtemp passes
  script: test — bunx vitest run scripts/tests/test-tree-snapshot-guard.test.ts
- [⚑] [script] AC-TG-5: bun run check:ac-oracle-ownership exits exactly 1 naming the spec, the AC id and the path when a live script AC's command names a test file that does not exist, and when two live ACs name the same AC id inside one test file without a spec-qualified reference; it exits 0 when every script AC has exactly one existing owning test file
  script: test — bunx vitest run scripts/tests/check-ac-oracle-ownership.test.ts
- [⚑] [script] AC-TG-6: In a throwaway corpus, lore verify on a script AC whose command names a missing test file records the AC as not measured with the missing path in its output (never pass or fail), lore ac list no longer renders an earlier attested pass for it as passing, and lore done on a task covering that AC exits 4 naming the AC until its command is repointed to an existing file
  script: test — bunx vitest run packages/lore/tests/integration/cli/verify-missing-oracle-file.test.ts
- [·] [script] AC-TG-7: In a fixture repository, test:changed selects a test for a changed non-imported file exactly when the test declares that file (or a glob covering it) as an input; a test declaring nothing is selected only through static imports; no selection reason tree-scan-oracle exists; a test that reads a repository file at run time without declaring it makes the run fail naming the test and the path
  script: test — bunx vitest run scripts/tests/changed-tests-declared-inputs.test.ts
- [·] [script] AC-TG-8: Given a full-suite result file and a commit range, the selector cross-check exits exactly 1 and names each test that failed in the full run but would not have been selected for that range, and exits 0 when every failing test would have been selected
  script: test — bunx vitest run scripts/tests/selector-miss-report.test.ts
- [⚑] [script] AC-TG-4: bun scripts/check-prose-pins.ts exits exactly 1 and prints file:line for a test asserting a string or regex literal of 5 or more words that also occurs in a shipped or governing prose file (the set: assets/**/*.md, **/CLAUDE.md, **/SKILL.md, .claude/rules/*.md, docs/**/*.md except the generated corpus mirror docs/requirements/**), unless scripts/prose-pin-ledger.json names that test, a non-empty consumer and a non-empty reason; negated assertions, imported constants and markdown headings are not flagged; it exits 0 on a fixture without such a pin; hooks/pre-push and assets/project/pre-push both run it
  script: test — bunx vitest run scripts/tests/check-prose-pins.test.ts
- [⚑] [script] AC-TG-9: On main after the cleanup phase: check-prose-pins and check:ac-oracle-ownership exit 0 against the real tree; every entry of scripts/test-isolation-ledger.json and scripts/prose-pin-ledger.json has a non-empty reason (and, for prose pins, a non-empty consumer); the four tombstone files (setup-retires-session-start-fragments, init-context-skill-retirement, setup-retired-agent-types, and the retirement cases of setup-governance-retirement) are gone and one retirement registry test exists; no it() body appears in two of in-memory-store.test.ts, sqlite-store.bun.test.ts and turso-store.bun.test.ts after whitespace normalisation (shared cases live in *.shared.ts)
  script: test — bunx vitest run scripts/tests/test-cleanup-exit.test.ts
- [·] [script] AC-TG-10: On main after the plan's last merge, with dist/lore rebuilt and both runner guards active, bun run test exits exactly 0
  script: test — bun run test
- [·] [script] AC-TG-11: On the development machine this plan is run on (Apple Silicon M1 Pro, 8 CPUs, darwin; baseline: two runners, vitest ~282-300 s plus bun 1235-1753 s serial, measured 2026-10-16), the one-runner full run (vitest on the Bun runtime, ADR tg-1 option b, including the explicit Node project) finishes in 600 seconds or less of wall time with exit 0; the script prints the measured seconds, the worker count, the file count run and the machine (os, arch, cpu count), and exits 1 above the limit or when the file count run is lower than the test files on disk
  script: test — bun scripts/measure-test-wall.ts --max-seconds 600

## Code anchors

- scripts/check-ac-oracle-ownership.ts
