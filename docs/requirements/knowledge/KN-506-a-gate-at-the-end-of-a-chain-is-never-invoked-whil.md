---
id: KN-506
type: knowledge
role: knowledge
title: "A gate at the end of a && chain is never invoked while main is red, and the blast radius my dispatch bundle carried was wrong by 10 sites"
status: approved
priority: high
created: 2026-08-23
updated: 2026-08-23
tags: [oracle-wiring, anchor-design, worktree-node-modules, site-scan, spec-038, spec-143]
parent: PRD-001
links:
  - {id: SPEC-143, type: informs}
  - {id: SPEC-038, type: informs}
---
Measured 2026-08-23 by `agent:ct-t2-green-glyph`, reviewed and merged by `agent:main-orchestrator` (SPEC-143 AC-CT-1 + AC-CT-7, the plan's only L stage). Findings ordered by how badly each would mislead the next session.

## 1. A gate wired at the END of a `&&` chain is never invoked while anything upstream is red

AC-CT-7 requires the renderer site scan to be "wired into `bun run test` so it is INVOKED, not merely present, because an existing sound oracle is not a gate until something invokes it". The implementer wired it and then noticed the wiring satisfied the letter and not the property: behind an 869-second two-runner suite joined by `&&`, the scan is only reached when everything before it is green — and **main is not green** (39 failures at merge time, all pre-existing). It moved the scan to the FRONT of the script and verified by observation that the run's first lines are the scan invoking and printing OK.

The standing lesson said an oracle is not a gate until something INVOKES it. This adds the half that lesson missed: **position inside the invoking command decides whether it is invoked at all.** A `&&`-terminal check in a repo whose suite is red is exactly as inert as a check nothing calls, and it LOOKS wired in the script. Any future "wire X into `bun run test`" AC needs to pin the position, or assert the invocation with the suite deliberately red.

## 2. The Rule 1 blast radius the dispatch bundle carried was wrong: 22 sites across 4 files, not 12

The bundle (copied from the prior session's handoff, NS6) named 12 sites across `outline-service.ts`, `evidence-panel.ts`, `assess-template.ts`, `phase-workflow-service.ts`. Re-measured with the allowlist emptied: **22 sites** — `commands/ac.ts` 8 (a real site the bundle OMITTED entirely), `evidence-panel.ts` 6, `assess-template.ts` 6, `phase-workflow-service.ts` 2. `outline-service.ts` is absent only because this very commit fixes it.

⛔ The error is the ORCHESTRATOR's, not the implementer's: a count transcribed from a handoff into a dispatch bundle without re-measurement is a literal claim with no oracle, which is the exact defect this project already recorded about counts inside governance docs. The implementer re-measured and reported the discrepancy rather than padding an allowlist to fit the number it was handed.

Four waivers were written, each FUNCTION-scoped rather than file-scoped so a new read in the same file still reddens, each carrying measured line numbers:

- `commands/ac.ts::coverageBadge` and `assess-template.ts::renderCoverageCell` / `renderFactsSection` — real `AcCoverageFact` reads, used for count DISPLAY only; `deriveAcCoverageState` decides precedence first.
- `evidence-panel.ts` and `phase-workflow-service.ts` — **not fact reads at all**: the receiver is an `EvidenceResultTally`. These two are the textual matcher's known over-match, and the waiver reasons say exactly that rather than pretending they are exceptions.

Rule 2's allowlist is EMPTY, which is the point of a ratchet.

## 3. Every worktree in this batch was silently measuring the MAIN checkout's `@lore/core`

A worktree has no `node_modules`, so `@lore/core` resolves to `<main>/packages/core`. The scan suite imports `@lore/core` (the RED agent's deliberate choice, so the alphabet is not re-listed), which means the test was reading another tree's source. Fixed inside the worktree with `bun install --frozen-lockfile` (lockfile unchanged).

**Two of three agents in this batch hit this independently**, and the third recorded the compile-time half plus the fact that the documented remedy ("build the sub-package first") is a NO-OP for `@lore/core`, which maps to `./src/index.ts` with no `dist`. Nothing warns about it. `bun install` inside the worktree is the actual fix, and it belongs in the dispatch protocol rather than in three separate agents' discovery.

## 4. Fixing the renderer reddened two suites outside every declared anchor — the fourth and fifth D7 sites

D7 named three sites that had to move in the same commit. Landing it reddened two more, neither an anchor on any task: `outline-render.test.ts` (3 assertions) and `export-docs-service.test.ts` (1), both pinning the retired three-glyph rule.

The implementer re-baselined them and recorded, in place, the three facts an audit needs: the command, the exact failure text, and why it is a correction rather than a weakening. Independently reviewed before merge and the reasoning holds: the assertions got STRICTER (each now names the single glyph its own state projects to, so a `pass_unfalsified` collapsing back into `pass` reddens), the untouched `none` half remains as a control, glyphs are written LITERALLY rather than read from the function under test, and a new NEGATIVE test asserts a `fail` / `fail_superseded` distinction the old renderer could not express at all.

⛔ This is an ANCHOR-DESIGN failure, not an execution one, and it is the third instance in one wave (T1 needed four undeclared files; T0's anchors were fine only because its change was additive). A spec's file anchors must cover every site that ASSERTS the behaviour being changed, not only the site that implements it — tests that pin the old rule are part of the change's blast radius by construction.

## 5. A gitignored generated file made the scan's own file count non-deterministic

`packages/dashboard/src/routeTree.gen.ts` is gitignored and exists only after a dashboard prebuild, so the same tree scanned 362 or 363 files depending on whether anyone had run it. The implementer found this and closed it by skipping `*.gen.ts` / `*.generated.ts` in the new scan.

Worth recording because the shared helper `isScannableSourceFile` excludes a `generated/` DIRECTORY but not a `.gen.ts` FILE, and widening the shared helper would silently change the OTHER scan's scope. So the fix is correctly local, and the shared helper's asymmetry remains a live trap for the next scan author.

## 6. Two gates were passed EXPLICITLY, which is itself the signal

- `lore verify` first exited 7 and needed `--allow-new-commands`, even though the commands are verbatim what SPEC-143 declares. The implementer named it rather than treating the flag as routine.
- AC-CT-1 and AC-CT-7 carry NO `--falsifier-*` fields despite SPEC-143's own note that every script-mode AC carries them, so the three falsifiers actually run could not be machine-replayed via `lore verify --falsifier`. Adding them is a spec write the implementer was not authorised to make.

## 7. Pre-existing red that this wave did not cause and did not fix

- `check:spec-mirror`: 14 `task/TASK-*` frontmatter drifts, red before this wave started. Task docs carry no AC checklist, so the renderer change cannot be the cause. Needs `lore export-docs --force`.
- SPEC-038's review (run to restore it to `approved` after D7's amendment) surfaced four findings, ALL pre-existing and none introduced by the amendment: an exit-code contradiction between §6's convention and §8's dogfood row for AC-ACODE-3 (4 vs 3); AC-ACODE-8's oracle unsatisfiable by construction given D3's explicit literal (a `wc -l` of 1 that must be >= 2); seven dogfood ACs declaring `script:test` with NO command, which cannot be transcribed into structured form without an author decision each; and AC-ACODE-1 attributing duplicate-id rejection to the wrong schema. Approved anyway, deliberately: leaving SPEC-038 in `draft` hard-blocks every descendant claim, which is worse than four recorded defects. They are recorded HERE rather than waved through.
