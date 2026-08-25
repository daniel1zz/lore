---
id: TASK-837
type: task
role: plan
title: "[Skill:test] the mirror end-to-end oracles cost O(corpus) against a fixed 30s timeout and now exceed it"
status: draft
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: [oracle-design, scale, north-star]
parent: PRD-001
---
MEASURED 2026-08-25 on main, during the full-suite gate of the read-side slice.

Three cases in scripts/tests/spec-mirror-export.test.ts fail, and the failure is a TIMEOUT, not an assertion mismatch: 'Error: Test timed out in 30000ms.' The affected cases are AC-FR-10 HAPPY (a+b), and both AC-FR-7 drift-check-is-separate cases.

ARITHMETIC, measured directly: the corpus holds 1704 docs (826 task / 161 spec / 531 knowledge / 147 plan / 38 adr / 1 prd). A SINGLE 'bun scripts/export-spec-mirror.ts --check' pass takes 12s; write mode also 12s. Those cases run a baseline plus two consecutive --check passes, i.e. 24-36s against a 30s budget. The suite running them concurrently with 500+ other files makes it worse.

⛔ This is NOT a pathological complexity bug — 12s over 1704 docs is linear and reasonable per pass. It is a BUDGET that no longer fits, and it will keep not fitting: every doc added to the corpus makes it worse, permanently.

⛔ Root-cause framing, so this is not fixed by bumping the number and moving on: the project's own North Star says 'Self-checking must stay cheaper than corpus growth' and 'Prefer incremental, local, concurrency-safe checks'. An oracle whose cost is O(corpus) per pass and which is invoked 2-3 times per test case is exactly the shape that rule forbids. Raising the timeout is defensible ONLY as a stopgap and only stated as one; the real fix is an incremental check (diff the docs that changed) or a scoped fixture corpus for the end-to-end cases, keeping ONE full-corpus pass as a separate, budgeted oracle.

⛔ ATTRIBUTION, stated as reasoning and NOT as measurement: the read-side slice added roughly 15 docs to a corpus of 1704 (0.9%), so it cannot plausibly be the cause; but nobody has run these cases against a pre-slice commit, so 'it was already failing' is inference from the arithmetic, not an observation. Whoever picks this up should establish that first — it is one checkout and one 3-minute run.

## ADDENDUM 2026-08-25 — the timeouts are not self-contained: they redden an unrelated test

Measured after the six-flags task landed. A full `bun run test:vitest` reports 4 failures: the 3 timeout cases above, PLUS `scripts/tests/mirror-status-parity.test.ts`.

That 4th one is CONSEQUENCE, not an independent defect. Established by isolation:
- run alone → `mirror-status-parity.test.ts` passes (1 passed)
- `bun run check:spec-mirror` → exit 0
- `git status --porcelain docs/requirements` → clean

⛔ Mechanism: `spec-mirror-export.test.ts`'s RED cases deliberately MUTATE the real `docs/requirements` mirror (delete one exported file, rewrite one frontmatter id) to prove the checker notices. When those cases time out at 30s they never reach their restore step, so they leave the SHARED, REAL mirror dirty — and `mirror-status-parity.test.ts`, reading that same real mirror, then legitimately reports drift.

⛔ So there are TWO defects here, and fixing only the budget leaves the second one armed:
1. the O(corpus) cost against a fixed timeout (above), and
2. **two test files share a mutable REAL-corpus fixture with no isolation and no guaranteed restore.** A restore that only runs on the success path is not a restore. Any interruption — timeout, crash, Ctrl-C — leaves the repo's real mirror mutated, and the next reader blames itself.

The second is the more dangerous of the two: it makes a failure in one file present as a failure in another, which is how a red suite becomes uninterpretable. Whoever takes this should fix isolation (a temp-dir corpus for the mutation cases) or make restoration unconditional, independently of whatever is decided about the timeout budget.


## CORRECTION 2026-08-25 (agent:main-orchestrator) — the addendum's mechanism claim above is FALSE, measured

The addendum asserts: "When those cases time out at 30s they never reach their restore step, so they leave the SHARED, REAL mirror dirty." ⛔ That is wrong, and it was reasoning presented as mechanism. Measured directly with a purpose-built probe:

A vitest case whose body is FULLY SYNCHRONOUS (which every case in `spec-mirror-export.test.ts` is — `spawnSync`, `readFileSync`, `unlinkSync`, `writeFileSync`, no `await` on the mutation path) cannot be interrupted by the runner's timeout. The runner races the test against a timer; a synchronous body runs to completion first, so `finally` ALWAYS executes and the timer only then reports "Test timed out". Probe: a case with a 1000ms budget, an `unlinkSync`, a `spawnSync("sleep", ["3"])`, and a restoring `finally`. Result: the case FAILED with "Test timed out in 1000ms" AND the deleted file was present with its original bytes afterwards. `finally` ran.

⛔ Consequence for whoever implements this: "make restoration unconditional" is NOT the fix — restoration is already unconditional (`finally`) and already verified byte-exact inside each block (`expect(readFileSync(absPath, "utf8")).toBe(original)`). Implementing that would be a no-op change certified by a passing suite.

## The REAL mechanism for the cross-file redness, measured

`vitest.config.ts` runs with `fileParallelism` at its default (true) and `maxWorkers: 4`. `spec-mirror-export.test.ts` and `mirror-status-parity.test.ts` therefore execute in DIFFERENT worker processes AT THE SAME TIME. While a mutation case in the first file holds a real mirror file deleted — a window of 30-60s now, since each `--check` pass measures 27.9s — the second file's single case walks `.lore/export-index.json`, calls `existsSync` on every mapped path, and legitimately records `file_absent` for the file that is, at that instant, absent.

So defect 2 is not a missing restore. It is: **one test file mutates shared real state that other test files read concurrently.** The window is what makes it visible, which is why it appeared only once the per-pass cost grew.

⛔ This also means the two defects are ONE root cause with two symptoms, in this precise sense: shrinking the window (fewer/cheaper passes) makes the race rarer WITHOUT fixing it. A rarer race is worse than a reliable one. Isolation must be structural, not a consequence of the file being faster.

Corroborating fact, worth knowing before designing: `spec-mirror-export.test.ts` is the ONLY mirror test file that mutates the real tree. Its four siblings that drive the same script (`spec-mirror-content-drift.test.ts`, `mirror-frontmatter-drift.test.ts`, `mirror-prune-retire-deleted-doc-mapping.test.ts`, `corpus-resolver-collapse.test.ts`) already confine every mutation to a `mkdtemp` root — `spec-mirror-content-drift.test.ts` states exactly that in its own header and declares 120_000 budgets. The pattern this file needs already exists in the repo, one directory over.

## ATTRIBUTION — answered by measurement, closing the open question above

The section above asks whoever picks this up to establish whether the cases were already failing before the read-side slice, and calls the arithmetic "inference, not an observation". Established, without needing a second checkout:

`git diff --stat 90951390..HEAD -- scripts/tests/spec-mirror-export.test.ts scripts/export-spec-mirror.ts scripts/export-spec-mirror-core.ts` is EMPTY. All three files are byte-identical across the 251 commits from 2026-08-17 to HEAD. The read-side slice is exonerated by measurement: it changed none of this code.

The step change was `90951390` itself (2026-08-17, "compare mirror bodies against corpus content in the spec-mirror check"), which moved `--check` from parity-only (`runCheck`: six corpus lists plus an `existsSync` per file) to parity PLUS a full `exportDocs({ dryRun: true })` body probe per type — and `git diff 90951390^..90951390 -- scripts/tests/spec-mirror-export.test.ts` is EMPTY, so it did not touch one timeout literal in the file that invokes `--check` thirteen times. Cost split measured today: 27.9s per pass total, of which the corpus read is 0.41s.

That residual — a command that absorbed a second, far more expensive check — is filed separately as `task-the-mirror-check-absorbed-the-content-probe-in-90951390`, because fixing it changes a command surface and therefore what an approved spec's oracle drives.


## DEFECT 3, not previously recorded — `maxBuffer: 20MB` is already exceeded, and it fails as a LIE

Measured 2026-08-25 by running this file alone (`bunx vitest run scripts/tests/spec-mirror-export.test.ts`): **4 cases red, and NOT ONE of them a timeout.** The AC-FR-10 HAPPY (a+b) case fails in 17.7s against its 60_000 budget with:

```
Error: test setup: lore list --type knowledge --json --include-invalid failed (exit 1):
```

Note what follows the colon: nothing. Empty stderr. That message says the CLI is broken. The CLI is fine. Measured output sizes of the six calls this file makes:

| type | bytes | vs. this file's 20MB `maxBuffer` |
|---|---|---|
| prd | 38,359 | ok |
| adr | 267,917 | ok |
| plan | 492,093 | ok |
| spec | 2,805,635 | ok |
| task | 9,026,320 | ok |
| **knowledge** | **23,180,068** | **OVER by 2.2MB** |

`spawnSync` with `maxBuffer` exceeded returns `status: null` and an ENOBUFS `error`. `runLore` then collapses that to `result.status ?? 1` — a silent fallback that MANUFACTURES an exit code the child never returned, and truncates stderr to nothing. So a buffer that is 2.2MB too small is reported as "the corpus read failed", with no trace of the real cause.

⛔ Two fixes, not one, and the second is the load-bearing one:
1. The buffer must fit the measured population (the sibling `mirror-status-parity.test.ts` already uses 64MB for the same six reads — the lesson was learned one file over and never propagated).
2. `runLore` MUST fail LOUD when `status === null` or `error` is set, naming ENOBUFS and the buffer it was given. Without that, the NEXT time the corpus outgrows the constant, the failure lies again in exactly the same way. `⛔ 禁止无声 fallback` — `result.status ?? 1` is that fallback.

Structural residual, deliberately not fixed here: `lore list` has NO field-projection flag, so a caller that needs only `(id, slug, status)` must transfer every doc's full body. That is already tracked as ticket 121's `lore list --fields` item; a comment at the call site must point at it rather than restating it.

## COST MODEL CORRECTED — 13.8s warm, not 27.9s

The 27.9s figure measured earlier this session was a COLD run (bun transpile cache empty). Warm, immediately re-run: **13.8s** per `--check` pass. Both numbers matter and neither replaces the other — a worktree's first pass pays cold, the suite's later passes pay warm.

That reconciles the timeout report with today's observation: a case invoking three passes costs ~41s warm against a 30_000 budget (RED, as the handoff recorded), while AC-FR-10 HAPPY has a 60_000 budget and one pass, so it never times out — it dies on defect 3 instead. Any declared budget MUST be derived from the COLD figure, since a fresh worktree always pays it.

## ⛔ MEASUREMENT HAZARD for whoever runs this file — one this task cannot fix

The other three red cases today failed at `expect(baseline.exitCode).toBe(0)` with exit **2** (drift), NOT on time. Cause: the orchestrator created one adhoc task and edited another WHILE the run was in flight, which drifted `docs/requirements/prd/PRD-001-lore-positioning.md` (its child list is an MDX placeholder) and `docs/requirements/task/TASK-837-*.md`. Self-inflicted; recorded so it is never mistaken for a defect of this file.

This is `plan-close-the-read-side-a-github-filed-defect-becomes`'s KD3 measured a second time: **any corpus write during the run invalidates every `--check` baseline in it.** So the verification protocol for this task is: sync the mirror, commit, then run BOTH halves with ZERO `lore` writes in between. A green verdict obtained any other way is not a verdict.
