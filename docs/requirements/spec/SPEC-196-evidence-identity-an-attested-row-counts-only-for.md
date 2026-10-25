---
id: SPEC-196
type: spec
role: spec
title: "Evidence identity: an attested row counts only for the check it ran"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
links:
  - {id: SPEC-143, type: relates-to}
  - {id: SPEC-195, type: relates-to}
---
## Overview/Goal

An AC's coverage verdict must describe the check it names. Today an evidence row counts toward AC-X whenever its `ac_ref` is AC-X, it passed and it is attested — whatever command it actually ran (`computeAcCoverage`, packages/core/src/acceptance.ts ~558-617, never reads `entry.command`). `lore evidence --capture --ac AC-X` with `echo ok` renders AC-X as ⚑✔. Live instance: AC-TG-11 rendered attested_pass while its oracle `scripts/measure-test-wall.ts` did not exist on main; the only "pass" ran a different test file.

Measured on main 2026-10-18 (read-only, every live spec's script ACs): 1008 ACs render attested_pass; 292 have no attested pass whose command equals the AC's current command. 263 of those come from the TG-23 one-runner rewrite (AC commands rewritten, old evidence kept the old command; 268 are already marked previous oracle_generation by BR-40 yet still render green), 24 are genuine mismatches (evidence ran a different check: AC-TG-11, AC-GI-9, AC-ROI-2, ...). Text normalisation rescues 5; runner equivalence (`bun test X` ≡ `bunx --bun vitest run X`) would rescue 176 but undo TG-23's generation bump. 54 ACs render fail only from rows under a superseded command; 13 of them already hold an equal-command attested pass.

Second gap, same root: missing-oracle detection (oracle-file-existence.ts, `TEST_FILE_TOKEN_PATTERN`) recognises only test-file paths, so an AC whose oracle is a script (`bun scripts/x.ts`) can never render not_measured; and TG-22 narrowed not_measured to "a pass that ran the missing file", so `lore verify` warns "an earlier attested pass no longer counts" while `lore ac list` still renders ⚑✔ for a pass that ran other files.

User decisions (2026-10-18): (1) only equal-command attested rows count — strict string equality, no normalisation; (2) symmetric: applies to fail rows too; (3) the ACs that drop are re-verified on main in the same phase the rule lands, so main never shows an unexplained red band.

## Scope

In scope:
1. Coverage counts only equal-command attested rows (pass and fail); other-command rows get their own tally, shown on every surface that renders the coverage state.
2. Missing-oracle detection covers interpreter-invoked script paths, and any missing oracle file renders not_measured regardless of what earlier passes ran (supersedes TG-22's narrowing; AC-TG-6's own text never had it).
3. Re-verification of every AC the rule drops, on main, with each remaining red triaged (fixed, or its command corrected with `lore ac set --correction`, or recorded as a task) — none left unexplained.

Out of scope: the `lore done` archival floor (BR-200: any attested pass on the task counts) — unchanged here, recorded as an open question for the user; write-time refusal of `lore evidence --ac` with a different command (rejected option: rendering is the root, old rows exist).

Related: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it (G1: a verdict carries the identity of what it measured), spec-test-governance-guards-that-refuse-bad-tests-declared (AC-TG-6, AC-TG-11).

## Acceptance Criteria

AC-EI-1..3 (`lore ac add`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-EI-1: AN ATTESTED ROW COUNTS ONLY FOR THE CHECK IT RAN. An evidence row with ac_ref=AC-X counts toward AC-X's attested pass AND fail tallies (and so its coverage state: attested_pass, fail, fail_superseded, pass_unfalsified) only when the row's command is string-equal to AC-X's CURRENT declared verify.command — no normalisation. Rows with ac_ref=AC-X and any other command are counted in a separate other_command tally named on every surface that renders the coverage state (lore ac list text and --json, lore status, the spec mirror, lore assess's AC table), never merged into the pass or fail tally and never dropped silently. Mandatory halves, in a throwaway corpus, exit codes asserted exactly: (1) a captured attested pass of `echo ok` with --ac AC-X, whose declared command differs, leaves AC-X not attested_pass and shows other_command=1; (2) control: a lore verify pass of AC-X's declared command renders attested_pass; (3) after lore ac set --correction changes AC-X's command, the earlier verify pass moves to other_command and AC-X stops rendering attested_pass until re-verified; (4) symmetric: an attested fail under a superseded command does not hold AC-X at fail once an equal-command attested pass exists; (5) one derivation: the command comparison lives only in computeAcCoverage (packages/core/src/acceptance.ts); `grep -rn "\.command" packages/lore/src/service/ac-service.ts packages/lore/src/adapters/cli/commands/ac.ts packages/lore/src/adapters/cli/commands/status.ts scripts/export-spec-mirror.ts packages/lore/src/service/assess*.ts` finds no comparison of an evidence row command against an AC command (the test asserts this on the file set named here).
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/ac-coverage-command-identity.test.ts && echo 'AC-EI-1 PASS: only equal-command attested rows count toward an AC pass or fail; other-command rows are tallied and shown separately'
  other_command=1
- [⚑] [script] AC-EI-2: A MISSING ORACLE IS NOT MEASURED, WHATEVER IT IS AND WHATEVER RAN BEFORE. Missing-oracle detection (oracle-file-existence.ts) extracts, besides test-file paths, every repo-relative file path a declared command hands to an interpreter or runner (bun, node, sh, bash, tsx, and bunx/npx followed by bun, node or tsx) — e.g. `bun scripts/measure-test-wall.ts --max-seconds 600` yields scripts/measure-test-wall.ts. Whenever any extracted path is missing on disk, the AC renders not_measured naming the path on lore ac list, lore verify and lore status — regardless of which files earlier passes ran (TG-22's 'passes that ran the missing file' narrowing is removed), and lore ac add/set refuses the missing script path without --allow-missing-path exactly as for a test path. Mandatory halves, throwaway corpus: (1) script-path AC with the script deleted after an attested pass renders not_measured naming it; (2) control: the same AC with the script present renders attested_pass; (3) a test-path AC whose missing file was never run by its earlier pass also renders not_measured (the TG-22 case); (4) lore ac add with a missing script path and no --allow-missing-path exits 4 naming the path; (5) a command segment the extractor cannot classify is listed in lore ac list --json as oracle_paths_unchecked (the segment text) and counted on the AC's text line as "N segment(s) not checked", never treated as checked-clean (AS-17).
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/missing-oracle-any-path.test.ts && echo 'AC-EI-2 PASS: missing script or test oracle renders not_measured regardless of prior passes; ac add refuses it'
  other_command=6
- [⚑] [script] AC-EI-3: NO AC DROPPED BY THE RULE IS LEFT UNEXPLAINED. The ACs that render attested_pass on main before AC-EI-1 lands and lose it under AC-EI-1 or AC-EI-2 (the drop set, computed at merge time and committed as scripts/evidence-identity-drop-set.json with spec slug, AC id, old and new state) are re-verified on main with lore verify in the same plan phase. scripts/check-evidence-identity-drop-set.ts reads that file and the live corpus and exits 0 only when every listed AC either is re-verified green now — it renders attested_pass, or fail_superseded (its newest attested pass is strictly newer than its newest fail, M4) (a command corrected with lore ac set --correction counts only once it is re-verified green under the new command); a plain fail never counts as green — or is not attested_pass AND named by a non-archived task whose slug is recorded in the file's row; it exits 1 naming each AC that is neither, and exits 2 when the drop-set file is absent or empty while the corpus has script ACs (never vacuously green). It prints the count per outcome. Control: a fixture row with no task and a non-attested state exits 1 naming it.
  script: other — bun scripts/check-evidence-identity-drop-set.ts && echo 'AC-EI-3 PASS: every AC dropped by evidence identity is re-verified green, owned by an open task, or corrected'
  other_command=2
