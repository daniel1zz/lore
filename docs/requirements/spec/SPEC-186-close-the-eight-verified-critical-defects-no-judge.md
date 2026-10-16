---
id: SPEC-186
type: spec
role: spec
title: "Close the eight verified critical defects: no judge, listing, mirror, worktree or closure path stays silent"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
links:
  - {id: SPEC-040, type: relates-to}
  - {id: SPEC-137, type: relates-to}
  - {id: SPEC-153, type: relates-to}
  - {id: SPEC-043, type: relates-to}
  - {id: SPEC-099, type: relates-to}
  - {id: SPEC-141, type: relates-to}
  - {id: SPEC-155, type: relates-to}
  - {id: SPEC-166, type: relates-to}
  - {id: SPEC-107, type: relates-to}
  - {id: TASK-727, type: resolves}
  - {id: TASK-913, type: resolves}
  - {id: TASK-726, type: resolves}
  - {id: TASK-720, type: resolves}
  - {id: TASK-713, type: resolves}
  - {id: TASK-729, type: resolves}
  - {id: TASK-936, type: resolves}
  - {id: TASK-884, type: resolves}
  - {id: TASK-719, type: resolves}
  - {id: TASK-711, type: resolves}
  - {id: TASK-728, type: resolves}
  - {id: TASK-701, type: relates-to}
---
## Overview/Goal

Close the eight open CRITICAL defect reports (plus four same-root reports) that were re-verified on main @ 8395a3b6 on 2026-10-16. Each one makes the corpus lie or go silent: a judge scores text it never saw, a listing hides a population without a trace, a mirror check reports OK over drift, a worktree test silently migrates the shared live corpus, an injection silently exceeds the harness cap, and `lore done` either refuses a compliant command or advises archiving a plan that was never decomposed.

This spec carries the acceptance criteria for the fixes only. Each fix extends an approved governing spec, linked below, without editing it (editing would demote it to draft and block every plan that depends on it).

## Scope

In scope (report slug -> governing spec):

| # | Report(s) | Verified state on 8395a3b6 | Governing spec |
|---|---|---|---|
| F1 | task-lore-review-truncates-the-parent-spec-before-the-judge; task-gh-1343388703-34 | reproduces: `review-template.ts:518` cuts the parent, the Truncation Notice covers the body only (`:525-541`), the judgment records only a body bool (`ai-provider-service.ts:2131`) | spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s (D8) |
| F2 | task-lore-assess-scores-findings-against-files-listed-in-its | reproduces (code read): `diff:<path>` entries in `truncated[]` are read by neither `suppressUngroundedAbsenceFindings` nor `verifyFindingPaths` | spec-judgment-surfaces-must-verify-before-they-certify-machine |
| F3 | task-the-two-mirror-exporters-disagree-bun-run-mirror-export; task-mirror-export-never-rewrites-an-existing-file-whose; task-the-mirror-export-silently-skips-a-changed-knowledge-doc | partial: frontmatter is rewritten (44923c61); a body change is still skipped without `--force` (`export-docs-service.ts:664`), `parseMirrorArgv` has no `--force`, and `computeMirrorContentDrift` (`export-spec-mirror-core.ts:277`) ignores `frontmatter_repaired`/`frontmatter_declined` | spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by |
| F4 | task-lore-list-silently-omits-invalidated-docs-and-reports-a | reproduces: knowledge list 672 vs 695 with `--include-invalid`, no trace (`corpus-service.ts:3642-3648`, `list.ts:523`) | spec-spec-043-memory-hygiene-part-1-bi-temporal-invalidation-h1 (D3) |
| F5 | task-gh-1343388703-189 | reproduces (code read): the `git_common_dir` fallback (`corpus-resolution.ts:227-233`) hands a worktree the main checkout's db and `SQLiteStore`'s constructor migrates unconditionally (`sqlite-store.ts:256`) | spec-workflow-hardening-evidence-red-vocabulary-claim-worktree (M4); spec-corpus-resolution-carries-provenance-and-a-foreign-write |
| F6 | task-gh-1343388703-20 | partial: governance prose left the hook (4925ff37); a worktree session concatenates seat briefing (~2.7K) + framing + bootstrap (budget 8000, emitted unclipped) with no check on the total | spec-context-fragments-config-driven-layered-rule-injection; spec-session-start-injection-carries-only-the-session-s-own |
| F7 | task-the-cwd-blind-spot-is-a-class-not-one-function-lore-done-s; task-the-oracle-file-existence-precheck-understands-only-the-cd | partial: the `cd` form is fixed (804360d2); `commandRunsFileUnfiltered` and `findMissingOracleFiles` take no execution root, so a `lore verify --execution-root` row can never satisfy the unfiltered floor; the refusal's remediation (`task-workflow-service.ts:3572-3577`) prescribes a self-reported `--result pass` that `lore evidence` always refuses | spec-workflow-hardening-evidence-red-vocabulary-claim-worktree (M3) |
| F8 | task-lore-done-tells-you-to-archive-a-plan-whose-declared | reproduces: `computePlanNowFullyTerminal` (`task-workflow-service.ts:4709-4746`) never reads `plan.extra.phases` | spec-plan-closure-must-be-loud-terminality-divergence-silent (DD-2) |

Out of scope:
- Parsing `--cwd` flags inside commands. The execution root is supplied by the caller (`lore verify --execution-root`, the evidence row's attestation), never inferred from command text.
- Changing the review verdict itself when input was cut (refusing or downgrading `approve`, asked for by task-gh-1343388703-34). F1 makes the cut machine-readable and visible; the verdict policy is a separate decision. task-gh-1343388703-34 therefore stays OPEN after F1 lands, with a comment naming the F1 commit and the remaining verdict-policy half.
- Policy changes stated here, not hidden: F3 changes only the mirror script's overwrite policy; F6 drops (never clips) the bootstrap block when the total would exceed the harness cap.
- task-gh-1343388703-27: appears fixed at the pure-function level by 804360d2; it is closed only after a CLI repro, in the verification task.

## Design

- F1: the Truncation Notice covers every cut section, the parent included, with shown/total chars and the omitted headings (reuse `buildOmittedSectionsNotice`). The stored judgment keeps `truncated: true` for a cut body (AC-ADF-8 unchanged) and ADDS `truncation: [{section, shown_chars, total_chars}]`; inputs that fit store no `truncation` key. `lore review` prints one line per cut section.
- F2: in `_finalizeAssessment`, before `verifyFindingPaths`, a finding any of whose `paths[]` is a WHOLLY omitted file moves to `unverifiable_findings[]` with reason `not-shown-to-judge`; a head-truncated file (`headTruncatedFile`) counts as shown. The omitted set is passed as its own field from the code that renders the manifest, not re-parsed from `truncated[]`. `unverifiableFindingSchema` (packages/core/src/assessment.ts:452) gains `reason`; the moved findings get their own count, separate from `path_verification.unverifiable` (which keeps meaning "file absent at the commit").
- F3: the mirror directories are a projection of the corpus, so the mirror script (`bun run mirror:export`) passes the body-overwrite option to ExportDocsService; `lore export-docs` keeps SPEC-021 A2 (a changed body is overwritten only with `--force`). `--check` counts `frontmatter_repaired` and `frontmatter_declined` as drift.
- F4: the validity filter counts what it removes and returns it as `omitted_invalid` beside `total` (CorpusService.list and the CLI full-record path); the text footer shows it; MCP `lore_list` passes it through.
- F5: the SQLiteStore constructor is unchanged (src has 14 direct `new SQLiteStore` sites and ~200 test call sites). One store-layer guard (`packages/lore/src/store/foreign-schema-guard.ts`) decides "foreign" from the db path itself: the caller's cwd is in a linked worktree (git-dir differs from git-common-dir) and the db is the common-dir checkout's `.lore/lore.db`. When foreign and its `user_version` (read through a read-only handle) is behind `LATEST_SCHEMA_VERSION`, it refuses. Every open path calls it before `new SQLiteStore`: the CLI loader (`adapters/cli/loader.ts`, which also serves MCP via `index.ts`) returns VALIDATION_ERROR (exit 4); `createApp` (`app.ts`, the composition root that scripts and tests call directly as `createApp(findLoreDbPath())`, e.g. scripts/tests/spec-mirror-export.test.ts) throws a named error before construction. The remaining direct `new SQLiteStore` sites take their path from the loader; `baseline-adopt.ts:73` opens its own `.lore` at init and `mount-registry.ts` opens registered paths, so neither can resolve a foreign db; the implementer records this per site in evidence. `lore gate`, which must never exit on this path, skips its audit write with one warning instead. The owning checkout migrates as before. scripts/tests/spec-mirror-export.test.ts keeps reading the live corpus (AC-FR-6/AC-FR-10 require it); the refusal is what protects it.
- F6: SPEC-080 forbids clipping (`packages/core/src/session.ts:150-163,1386-1392`: over budget is returned whole), so the hook checks the FINAL concatenated `additionalContext`: when seat briefing + framing + bootstrap fence reach 10,000 chars, the bootstrap fence is dropped whole and a degradation is recorded (as the existing backstop at `session-start-resume.mjs:335` does); the seat briefing is never cut. Nothing is truncated mid-text.
- F7: `commandRunsFileUnfiltered` and `findMissingOracleFiles` take an optional execution root, joined with any `cd` offset; `findMissingUnfilteredTestFileRuns` feeds each row's `attestation.execution_root`. The refusal names only paths that pass: a repo-root-relative command, or `lore verify --execution-root`.
- F8: plan-terminality compares declared phases with member tasks' phases; a plan with a declared phase that has no member gets a distinct result that names the empty phases, prints no archive command, and names how to close the gap (`lore phase rm <plan> <phase>` or adding a task), keeping BR-211's "names how to close it".

## Acceptance Criteria

Structured criteria are declared with `lore ac add` (ids AC-CRIT-1 .. AC-CRIT-11).

## Links

Extends (not edits) the governing specs in the Scope table; each fix task links its report(s).


## Acceptance Criteria (structured)

- [⚑] [script] AC-CRIT-1: Given a parent spec longer than max_context_chars whose heading '## D8' starts after the cut, the built review prompt contains a parent truncation notice stating shown and total chars and listing 'D8'; given a parent that fits, the prompt contains no parent truncation notice
  script: test — bunx vitest run packages/lore/tests/unit/ai/review-parent-truncation.test.ts
- [⚑] [script] AC-CRIT-2: A review whose body and parent were both cut keeps truncated=true (AC-ADF-8 unchanged) and stores truncation as exactly two entries {section, shown_chars, total_chars} for body and parent whose numbers equal the shown and full lengths, and both survive a SQLite write and re-open (read back from a real SQLiteStore); lore review text output prints one line per cut section; a review whose inputs fit reads back with no truncation key and prints no such line
  script: test — bunx vitest run packages/lore/tests/unit/service/review-truncation-record.test.ts && bun test packages/lore/tests/unit/store/judgment-truncation-roundtrip.bun.test.ts
- [⚑] [script] AC-CRIT-3: Given an assessment whose omitted-file list holds src/a.ts (wholly omitted, not head-truncated) and a MAJOR finding whose paths[] include src/a.ts (a file that exists at the assessed commit), the finalized assessment lists that finding in unverifiable_findings with reason 'not-shown-to-judge' and counts it in a not_shown count separate from path_verification.unverifiable, and not in typed_gaps; a finding on a file the judge was shown, wholly or head-truncated, stays in typed_gaps
  script: test — cd packages/lore && bun test tests/unit/service/assess-truncated-path-findings.bun.test.ts
- [⚑] [script] AC-CRIT-4: In a throwaway corpus, after changing the body of an exported spec and of an exported knowledge doc, running the mirror export script (bun run mirror:export entry point) with no flags rewrites both mirror files with the new body and the following --check exits 0; lore export-docs without --force still leaves a changed body untouched (SPEC-021 A2 unchanged)
  script: test — bunx vitest run scripts/tests/mirror-body-drift-rewrite.test.ts -t 'body change'
- [⚑] [script] AC-CRIT-5: In a throwaway corpus, after changing ONLY a doc's status, the mirror --check run before any export exits exactly 2 and its output names that doc's mirror file
  script: test — bunx vitest run scripts/tests/mirror-body-drift-rewrite.test.ts -t 'status-only'
- [⚑] [script] AC-CRIT-6: In a throwaway corpus with two knowledge docs, one invalidated: 'lore list --type knowledge --json' exits 0 with data.total=1 and data.omitted_invalid=1, its text output contains '1 invalidated hidden', and with --include-invalid it reports total=2 and omitted_invalid=0; the MCP lore_list result carries the same omitted_invalid
  script: test — cd packages/lore && bun test tests/integration/cli/list-omitted-invalid.bun.test.ts
- [⚑] [script] AC-CRIT-7: Given a temp git repo whose .lore/lore.db user_version is one below the code's and a linked worktree without .lore: (a) a CLI command run from the worktree that resolves the corpus through the git_common_dir fallback exits exactly 4 with a VALIDATION_ERROR naming the schema mismatch; (b) createApp(findLoreDbPath()) called in-process with the worktree as cwd throws the named schema-mismatch error before opening the store; (c) 'lore gate spec-create' run from the worktree with LORE_GATE_BYPASS=1 (the bypass-audit path that must never exit) exits exactly 0 and prints one warning line naming the mismatch; after (a)-(c) the main db's user_version is unchanged; (d) the same CLI command run from the main checkout migrates the db to the code's version
  script: test — cd packages/lore && bun test tests/e2e/worktree-no-foreign-migration.bun.test.ts
- [⚑] [script] AC-CRIT-8: In a sandboxed worktree session whose seat holds claims: when seat briefing + framing + bootstrap fence total 10000 chars or more, the SessionStart hook's additionalContext is shorter than 10000 chars, the seat briefing is byte-identical to its unbudgeted form, the bootstrap fence is absent and the hook's existing backstop degradation record (the one session-start-resume.mjs writes when it drops bootstrap today) is present; when the total fits, the bootstrap fence is present unchanged. If seat briefing + framing alone reach 10000 chars, the hook still emits the seat briefing whole and records a cap-exceeded degradation (the seat is never cut)
  script: test — cd packages/lore && bun test tests/e2e/session-start-worktree-cap.bun.test.ts
- [⚑] [script] AC-CRIT-9: commandRunsFileUnfiltered('bun test tests/x.bun.test.ts', 'packages/lore/tests/x.bun.test.ts', {executionRoot: 'packages/lore'}) returns true and returns false without the execution root; with executionRoot 'packages' and command 'cd lore && bun test tests/x.bun.test.ts' it returns true (root joined before the cd offset); findMissingOracleFiles with the same execution roots reports no missing file
  script: test — bunx vitest run packages/core/tests/unit/execution-root-offset.test.ts
- [⚑] [script] AC-CRIT-10: lore done on a task whose only test-anchor pass row is a lore verify row with attestation.execution_root=packages/lore and command 'bun test tests/x.bun.test.ts' passes the unfiltered-run floor; when the floor refuses, its message contains no 'lore evidence' command with '--result pass' lacking '--capture' and names 'lore verify --execution-root'
  script: test — bunx vitest run packages/lore/tests/unit/cli/done-unfiltered-remediation.test.ts
- [⚑] [script] AC-CRIT-11: Given a plan declaring phases A and B with one task in A, lore done on that task returns a result naming B as an empty declared phase, and the formatLastTaskAdvisory output contains no '--status archived' and contains the literal 'lore phase rm <plan-slug> B'; given a plan whose every declared phase has a task and all tasks terminal, the advisory still prints 'lore set <plan> --status archived'
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-close-empty-phases.test.ts

## Code anchors

- packages/lore/src/ai/review-template.ts
- packages/lore/src/service/ai-provider-service.ts
- packages/lore/src/ai/assess-template.ts
- packages/core/src/assessment.ts
- packages/core/src/review-judgment.ts
- scripts/export-spec-mirror.ts
- scripts/export-spec-mirror-core.ts
- packages/lore/src/service/corpus-service.ts
- packages/lore/src/adapters/cli/commands/list.ts
- packages/lore/src/store/foreign-schema-guard.ts
- packages/lore/src/adapters/cli/loader.ts
- assets/hooks/session-start-resume.mjs
- packages/core/src/attestation-completeness.ts
- packages/core/src/oracle-file-existence.ts
- packages/lore/src/service/task-workflow-service.ts
- packages/lore/src/adapters/cli/done-render.ts
