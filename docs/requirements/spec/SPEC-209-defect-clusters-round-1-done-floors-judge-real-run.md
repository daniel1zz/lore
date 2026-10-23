---
id: SPEC-209
type: spec
role: spec
title: "Defect clusters round 1: done floors judge real runs on landed work; filters validated; one write path; shell cwd parsing"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
---
## Overview/Goal

Four defect clusters confirmed by the 2026-10-19 triage of open issue reports (each report re-checked on main by reproduction or code reading). Each cluster is one root cause behind several reports; fixing the root closes them together. The user asked for the four to be fixed concurrently.

## Scope

D1 — `lore done` floors judge real runs, on landed work.
Reports: #171 (done does not check the work reached main), #174 / BR-212 (`lore set --status archived` archives a task with no floor), #188 (an attested e2e pass is not counted for a test-file anchor), #49 (refusal text says verify is the sole attestation issuer; `--capture` also attests), #51 (an archived task can be claimed again), local reports "red-first floor ignores capture_source" (+ #11), "an attested fail beside a pass still archives", "test-anchor refusal text demands attestation wording that no longer matches".
End state: every route that archives a task (done, set --status, plan close) applies the same floors; a floor counts a row only when a runner produced it (verify attestation or --capture), for red-first as for pass; per criterion the latest attested result decides; a task whose claim recorded a branch is archived only when that branch's head is an ancestor of main; terminal tasks refuse claim; refusal texts name every route that satisfies them.

D2 — Filter values are validated, never silently empty.
Reports: #81 (pending --type/--since), #243 (calibration --doc-type), #248 (list --type/--status), #283 (audit / trace --since), #278 (status --fix ignored without --check-tree), #80 (review --pending ignores a named doc).
End state: one shared validator for enumerated filters (doc type, status, sub-type) and dates; an unknown value or unreadable date exits 4 naming the accepted values or format; a flag that needs another flag, or two that exclude each other, exits 4 naming both. BR-318's "not refused" behaviour is replaced.

D3 — Every corpus write goes through one write path.
Reports: #252 (restore records the doc's creator, not the caller), #253 (migration writes no audit row, ignores insertVersion failure), #255 (validity / version / migration services skip the foreign-corpus refusal), #113 (restore is not one transaction), #145 (rule move records no run), #161 (ordinal / phase migrations bypass the record lock), #44 (phase rename rewrites tasks with no version or audit row), #276 (tree-check --fix bumps the version with no version row), #297 (baseline depends writes a version when nothing changed), #298 (requirement add attributes to 'system').
End state: a single write chokepoint owns version row, audit row (caller actor and run), foreign-corpus refusal, record-lock check and transaction; services call it instead of store.update / insertVersion; a write that changes nothing writes nothing.

D4 — Shell command text is read with the shell's working-directory semantics.
Reports: #229 (a `cd` after an earlier path segment is not applied, so an existing test file reads as missing), #164 (subshell `(cd … && …)` not recognised by done's unfiltered matcher), #221 (absolute `cd` outside the execution root accepted), #211 / #238 (git-safety-gate ignores an earlier `cd` and does not expand `$VAR`).
End state: one parser in @lore/core walks an `&&` / `;` chain, tracks the working directory across `cd` (relative, absolute, subshell scope), and returns per-segment cwd; a value it cannot determine (unset `$VAR`, `cd -`, command substitution) is reported as not measured, never guessed; every site that infers paths or cwd from command text uses it (oracle-file-existence, attestation-completeness / done's unfiltered matcher, the git-safety-gate hook asset).

## Acceptance Criteria

Structured ACs AC-DCL-1..AC-DCL-4 (`lore ac list`). Each cluster's task binds its reports with `--resolves`, so archiving it closes them.


## Acceptance Criteria (structured)

- [⚑] [script] AC-DCL-1: DONE FLOORS JUDGE REAL RUNS ON LANDED WORK. On throwaway repos and corpora, each case asserts the exact exit code and the refusing rule's name: (a) lore done on a task whose claim recorded a branch that lore integrate has not landed (no landing recorded on the task) exits 4 with the floor name not-landed, naming the branch; after lore integrate lands it, it archives; (b) lore set <task> --status archived on a task lacking a runner-attested pass exits 4 with the same floor refusal lore done gives (no route archives a task around the floors); (c) an attested oracle:e2e pass whose command runs a declared test-file anchor unfiltered satisfies that anchor; (d) a self-reported expected-fail row (no capture, no attestation) does not satisfy red-first, a --capture or verify-attested one does; (e) for a criterion whose latest attested result is fail after an earlier attested pass, done exits 4 naming the criterion; (f) lore claim on an archived or deprecated task exits 4; (g) every floor refusal text names both lore verify and lore evidence --capture as attestation routes. (h) closing the plan leaves a member task that fails a floor unarchived and names it (BR-1072), so plan close is no route around the floors either. Each case made red once by removing its check.
  script: test — bun run test:file packages/lore/tests/integration/done-floors-landed-real-runs.bun.test.ts && echo 'AC-DCL-1 PASS: done floors judge real runs on landed work'
  other_command=10
- [⚑] [script] AC-DCL-2: FILTER VALUES ARE VALIDATED. For lore pending (--type, --since), lore list (--type, --status), lore calibration --stats (--doc-type), lore audit (--since) and lore trace stats (--since): an unknown enumerated value exits 4 naming the accepted values; an unreadable date exits 4 naming the accepted format; a valid value behaves as before (asserted on a throwaway corpus with matching docs). lore status --fix without --check-tree exits 4 naming --check-tree; lore review <doc> --pending exits 4 naming both. A scan asserts every listed option is parsed through the one shared validator module (no command parses these values itself). Made red once by bypassing the validator in one command.
  script: test — bun run test:file packages/lore/tests/integration/filter-values-validated.bun.test.ts && echo 'AC-DCL-2 PASS: filter values validated by one shared validator'
  other_command=1
- [⚑] [script] AC-DCL-3: EVERY CORPUS WRITE GOES THROUGH ONE WRITE PATH. On a throwaway corpus, each of restore, the in-place migrations (ordinal, phase), validity transitions, rule move, phase rename (each renamed member task), tree-check --fix, requirement add and baseline depends writes exactly one version row and one audit row per changed document, attributed to the calling actor and run (not 'system', not the doc creator); a write from a linked worktree that resolved the main checkout's corpus is refused, asserted separately for restore (version service), a validity transition (validity service) and an in-place migration (migration service), by the same foreign-corpus rule as CorpusService writes; a locked record refuses those edits with RECORD_LOCKED; a write that changes nothing writes no version row; restore is one transaction (a failure injected after the doc update leaves no partial version or audit row). A static scan finds no store.update( / insertVersion( / appendAuditEntry( call in the nine D3 services (version, migration, ordinal-migration, phase-migration, validity, rule, phase, tree-check, requirement); the same rule for every other module is AC-DCL-5. Made red once by restoring one bare store.update.
  script: test — bun run test:file packages/lore/tests/integration/single-write-path.bun.test.ts && echo 'AC-DCL-3 PASS: every corpus write goes through one write path'
  other_command=4
- [⚑] [script] AC-DCL-4: SHELL COMMAND TEXT IS READ WITH CWD SEMANTICS. A table-driven test of the shared parser in @lore/core: 'a.test.ts && cd packages/lore && bun test tests/b.bun.test.ts' gives b at packages/lore/tests/b.bun.test.ts; '(cd packages/lore && bun test x.bun.test.ts) && bun test y.test.ts' scopes the cd to the subshell; 'cd /outside && bun test z' reports the absolute cwd outside the root as refused; 'cd $W && git worktree remove .' with $W unset reports not-measured naming $W, with $W given in the env resolves it; 'cd - ', command substitution and unbalanced quotes report not-measured. Integration: the oracle-file-existence precheck no longer reports the #229 file as missing; lore done's unfiltered matcher accepts the #164 subshell form; the git-safety-gate hook asset decides #211's command against the cd'd path. A scan asserts those three sites import the shared parser and contain no own cd handling. Made red once by dropping cd tracking.
  script: test — bun run test:file packages/core/tests/shell-cwd.test.ts packages/lore/tests/integration/shell-cwd-sites.bun.test.ts && echo 'AC-DCL-4 PASS: one cwd-aware parser at every site'
