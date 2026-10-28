---
id: SPEC-249
type: spec
role: spec
title: "A defect report states its mechanism or is marked symptom-only (resolves #420)"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-28
tags: [governance-mechanism-fixes, issue-420, issue-loop]
links:
  - {id: SPEC-252, type: blocks}
---
# A defect report states its mechanism or is marked symptom-only (resolves #420)

## Overview/Goal

Every defect report lore files either states its mechanism (what design choice allows the problem, and the end state that makes it impossible) or is explicitly marked symptom-only. `lore issues` shows which, so a symptom-only report is never read as a diagnosis.

Today `lore report-issue` requires title, description, expected and actual (BR-491), and nothing else. On 2026-10-25 one session filed 9 issues; a later code trace found:
- 0 of 9 stated the full mechanism;
- 3 stated a symptom or a wrong cause (#408's diagnosis was wrong);
- 2 duplicated an existing mechanism (#410/#311 of #418).

The project rule "fix at the mechanism root" depends on the issue naming the mechanism. "An agent should remember" is not enforced.

**Mechanism.** The report format has no field for the mechanism and no marker for its absence, so a symptom and a diagnosis look the same.

**End state.**
- Filing requires either `--mechanism` AND `--end-state`, or `--symptom-only`; these are mutually exclusive.
- The filed issue carries a diagnosis label (`diagnosis:mechanism` or `diagnosis:symptom-only`) and, for a diagnosed report, `## Mechanism` and `## End-state fix` sections.
- `lore issues` shows a diagnosis column (`mechanism`, `symptom-only`, or `unstated` for issues filed before this change or outside lore), counts each value, and filters by it.
- A new verb, `lore issue diagnose <n>`, records or corrects a diagnosis on a filed report.

Issue: GitHub #420 (bound through this spec's plan).

## Scope

**In:**
- refusing a fix carrier (`create plan|task --issue`, `issue adopt`) for an issue that is not diagnosed (`symptom-only`, `unstated` or `conflicting`);
- `lore report-issue` flags;
- the `lore_report_issue` tool arguments;
- the automatic filer of `lore assess --file-issues` (files `--symptom-only` explicitly: a milestone finding is a symptom until traced);
- the issue body parts;
- the diagnosis label;
- `lore issues` column, counts and `--diagnosis` filter;
- `lore issue diagnose <n> --mechanism --end-state [--correction <why>]`;
- the new baseline leaf `baseline-diagnose-a-defect-report`.

**Out:**
- The dashboard issues page (BR-990): it keeps its columns; a later spec may add the label.
- An AI check of mechanism quality.
- Re-labelling the issues already filed: they read `unstated` until someone runs `lore issue diagnose`.

## Design

### Filing

| Flags given | Outcome |
|---|---|
| `--mechanism M --end-state E` (both non-blank) | filed; label `diagnosis:mechanism`; body gains `## Mechanism` (M) and `## End-state fix` (E) after Expected/Actual, before the optional parts |
| `--symptom-only` | filed; label `diagnosis:symptom-only`; body gains the line `Diagnosis: symptom only — mechanism not traced.` |
| neither | exit 2, naming both choices; nothing read or sent (same point as BR-491's refusal) |
| `--symptom-only` with `--mechanism` or `--end-state` | exit 2 |
| only one of `--mechanism` / `--end-state`, or a blank one | exit 2 naming the missing part |

The label is created in the repository on first use, through the same GitHub port that sets resolution labels. The repeat key (BR-498) is unchanged: re-filing reports the earlier issue.

### Listing

`diagnosis` is read from the issue's labels: exactly one `diagnosis:*` label gives its value; none gives `unstated`; two gives `conflicting` (shown, counted, never resolved silently). The summary line counts each value. `--diagnosis mechanism|symptom-only|unstated|conflicting` filters, and the printed total is the filtered count (as BR-509).

### Diagnose

`lore issue diagnose <n> --mechanism M --end-state E`:
- On an `unstated` or `symptom-only` issue: replaces the diagnosis label with `diagnosis:mechanism`, removes the symptom-only line and appends the two sections. All other text stays byte-identical.
- On an issue already `mechanism`: refused (exit 4) unless `--correction <why>` is given. With it, the earlier sections are kept under `## Superseded diagnosis (<date>): <why>` and the new ones are appended.
- On a `conflicting` issue (both labels): it is not diagnosed, so no `--correction` is needed. Diagnose removes both labels and sets `diagnosis:mechanism`, removes the symptom-only line, and keeps any existing Mechanism and End-state sections under `## Superseded diagnosis (<date>): conflicting labels` before appending the new ones.
- Writes only GitHub (edit body, set labels); nothing in the corpus.
- An unknown issue number gives exit 3.
- GitHub unreachable fails by kind (BR-504).

### No fix work on an undiagnosed issue

The symptom-only mark must not turn into a permanent escape, and a later diagnosis must not depend on someone remembering it. So a fix carrier is accepted only for a diagnosed issue. `symptom-only`, `unstated` and `conflicting` are all "not diagnosed"; only `mechanism` is.

The carrier paths are `lore create plan --issue <n>`, `lore create task --issue <n>` and `lore issue adopt <n>`. No tool-protocol path creates a carrier: `lore_create` has no issue argument, and adoption is CLI-only.

Checks, in this order; the first that applies decides:
1. The number is a positive whole number (BR-520), else exit 4.
2. The issue is in the repository's live listing (BR-522), else exit 4.
3. For `lore issue adopt` only: the issue already has a live naming task or plan gives `Already adopted` (exit 0). No carrier is created, so there is nothing to refuse; existing carriers are never touched, whatever their issue's diagnosis.
4. The diagnosis read from the issue's labels is not `mechanism`: exit 4, nothing created. The output names the diagnosis found and `lore issue diagnose <n>`; for `conflicting`, diagnose resolves it as described above.

Labels: `lore create --issue` already reads the live listing once (`resolveGithubIssueListing`, `packages/lore/src/adapters/cli/create-issue-refs.ts`), and adoption does the same. Every listing entry carries its `labels` array (`github-intake-port.ts:113-121`), so `readDiagnosis` reads that same listing and no extra GitHub request is made on either path.

### Version skew (why a label, not the field block)

`issueFrontMatterFieldsSchema` is `.strict()` (packages/core/src/issue-front-matter.ts:74). A new key in the field block would make every older lore binary that lists the shared repository throw a malformed-front-matter error. A label is ignored by older binaries and is visible on GitHub itself.

### Public interface (falsifier literals, verbatim, once each)

- `packages/core/src/issue-diagnosis-vocab.ts`:
  - `export const DIAGNOSIS_LABEL_PREFIX = "diagnosis:";`
  - `if (diagnosisLabels.length === 0) return "unstated";`
- `packages/lore/src/adapters/cli/commands/report-issue.ts`: `if (!symptomOnly && (mechanism === undefined || endState === undefined)) throw usage(MISSING_DIAGNOSIS)`.
- `packages/lore/src/service/issue-diagnosis-service.ts`: `if (current === "mechanism" && correction === undefined) return refuseDiagnose("already-diagnosed"`.
- `packages/lore/src/adapters/cli/assess-file-issues.ts`: `symptomOnly: true`.
- `issue-diagnosis-service.ts` (`assertDiagnosedForCarrier`, called by `create-issue-refs.ts` (both create plan and create task) and `issue-adoption.ts`; there is no tool-protocol carrier path): `if (diagnosis !== "mechanism") return refuseUndiagnosed(`.

## Design Decisions

Decided with Sequential Thinking (2026-10-26).

| # | Choice | Chosen | Rejected (why) |
|---|---|---|---|
| D1 | What a diagnosis is | Two required parts (`--mechanism`, `--end-state`) or an explicit `--symptom-only` | One free-text `--mechanism`: lets the end state be omitted, which #420 names as half the requirement. An AI check of the text: adds an AI dependency to filing, and its verdict is advisory anyway |
| D2 | Where the diagnosis is recorded | GitHub label + body sections | A key in the field block: `.strict()` parsing makes older binaries throw on every listing. Body sections only: not filterable without parsing every body, and a hand edit can make them disagree with nothing to show it |
| D3 | Upgrading a symptom-only report | `lore issue diagnose` verb, with an audited `--correction` | Hand-editing on GitHub: the label keeps saying symptom-only (the corpus lies), and a wrong diagnosis (#408) is overwritten without trace |
| D4 | Automatic filer (milestone review) | Files `--symptom-only` explicitly | Inferring a mechanism from the finding text: a milestone finding states a failed dimension, not a traced cause |
| D5 | Keeping symptom-only from becoming permanent | A fix carrier (create --issue, adopt) is refused until the issue is diagnosed | A reminder or a status count of symptom-only reports: depends on someone acting on it. Refusing symptom-only filings: loses real observations that are not traced yet |
| D6 | `conflicting` diagnosis | Not diagnosed: carriers refused; diagnose resolves it without --correction, keeping earlier sections as superseded | Treat it as mechanism (one of its labels says so): fix work would start on a contradictory report. Require --correction: it would block the only path out of a state no person chose |
| D7 | Order against 'Already adopted' | Already-adopted (exit 0) before the diagnosis check | Diagnosis first: re-running adopt on an existing carrier would exit 4 although nothing is created, breaking BR-1300's idempotent report |

## Acceptance Criteria

Stored with `lore ac add`; repeated here for readers of the body.

- **AC-MI-1** (BR-491): with a fake GitHub port, the following are refused and nothing is sent: neither diagnosis choice (exit 2, naming both); `--symptom-only` with `--mechanism` (exit 2); only `--mechanism`, or a blank `--end-state` (exit 2 naming the missing part). Simplest false green: asserting only "non-zero"; exit 2 and the zero send-count are asserted exactly. Test: `packages/lore/tests/unit/adapters/report-issue-required-flags.test.ts` (`-t 'AC-MI-1'`).
- **AC-MI-2** (BR-494): a diagnosed filing produces exactly one issue with label `diagnosis:mechanism` and a body whose parts appear in this order: field block, description, Expected, Actual, Mechanism, End-state fix, then the optional parts. A symptom-only filing has label `diagnosis:symptom-only` and the symptom-only line. Test: `packages/lore/tests/integration/cli/report-issue-body-contract.bun.test.ts` (`-t 'AC-MI-2'`).
- **AC-MI-3** (BR-1427, BR-509): `lore issues` over fixture issues (one per label state: mechanism, symptom-only, none, two labels) shows the diagnosis column as mechanism / symptom-only / unstated / conflicting, and the summary counts 1 / 1 / 1 / 1. `--diagnosis unstated` lists exactly one and prints total 1. Test: `packages/lore/tests/unit/service/github-issue-listing-diagnosis.test.ts`.
- **AC-MI-4** (BR-1428): `lore issue diagnose` on a symptom-only issue swaps the label, removes the symptom-only line and appends both sections; text outside those parts is byte-identical. On a diagnosed issue without `--correction` it exits 4 with nothing written; with `--correction` the earlier sections survive under `Superseded diagnosis`. On a `conflicting` issue it needs no `--correction`: both labels give way to `diagnosis:mechanism`, and earlier sections survive under `Superseded diagnosis (<date>): conflicting labels`. Test: `packages/lore/tests/integration/cli/issue-diagnose.bun.test.ts`.
- **AC-MI-5** (BR-491, BR-494): wiring. The `lore_report_issue` tool refuses a call with neither choice. The `lore assess --file-issues` filer sends `diagnosis:symptom-only`. The compiled `dist/lore report-issue --help` lists `--mechanism`, `--end-state` and `--symptom-only`. Test: `packages/lore/tests/e2e/report-issue-diagnosis-compiled.bun.test.ts`.
- **AC-MI-6** (BR-1300, BR-522): over fixture issues labelled symptom-only, unlabelled and conflicting, each of `lore create plan --issue <n>`, `lore create task --issue <n>` and `lore issue adopt <n>` is refused (exit 4, nothing created, output naming the diagnosis found and `lore issue diagnose <n>`). A `diagnosis:mechanism` issue is accepted on all three (exit 0). `lore issue adopt` of an already-adopted symptom-only issue reports `Already adopted` (exit 0), proving check 3 precedes check 4. The fake GitHub port counts exactly one listing request per command. Test: `packages/lore/tests/integration/cli/fix-carrier-requires-diagnosis.bun.test.ts`.

## Rule changes

Modified: BR-491 (diagnosis required), BR-494 (issue parts and label). Added: BR-1427 on `baseline-list-defect-reports` (diagnosis column), BR-1300 modified on `baseline-adopt-a-github-issue` (a fix carrier needs a diagnosed issue), BR-1428 on the new leaf `baseline-diagnose-a-defect-report` (draft, created 2026-10-26 for this verb: one verb per leaf).


## Acceptance Criteria (structured)

- [·] [script] AC-MI-1: With a fake GitHub port, lore report-issue is refused with exit 2 and zero sends when: neither diagnosis choice is given (output names both); --symptom-only is combined with --mechanism; only --mechanism is given, or --end-state is blank (output names the missing part). False green guarded: asserting 'non-zero' would pass a crash; exit 2 and the zero send count are asserted exactly.
  script: test — bun run test:file packages/lore/tests/unit/adapters/report-issue-required-flags.test.ts -t 'AC-MI-1' && echo 'AC-MI-1 PASS: a report without a diagnosis choice is refused before sending'
- [·] [script] AC-MI-2: A diagnosed filing produces exactly one issue labelled diagnosis:mechanism whose body parts appear in order: field block, description, Expected, Actual, Mechanism, End-state fix, optional parts; a symptom-only filing is labelled diagnosis:symptom-only and carries the symptom-only line. False green guarded: checking only that the sections exist would pass a wrong order; the order is asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/report-issue-body-contract.bun.test.ts -t 'AC-MI-2' && echo 'AC-MI-2 PASS: the filed issue carries its diagnosis label and sections'
- [·] [script] AC-MI-3: lore issues over four fixture issues (labelled mechanism; symptom-only; none; both) shows diagnosis mechanism / symptom-only / unstated / conflicting and counts 1 each; --diagnosis unstated lists exactly one and prints total 1. False green guarded: a listing that defaults missing labels to mechanism passes the labelled cases; the unlabelled case must read unstated.
  script: test — bun run test:file packages/lore/tests/unit/service/github-issue-listing-diagnosis.test.ts && echo 'AC-MI-3 PASS: the listing shows and counts each diagnosis'
- [·] [script] AC-MI-4: lore issue diagnose on a symptom-only issue swaps the label to diagnosis:mechanism, removes the symptom-only line and appends both sections, all other text byte-identical; on a diagnosed issue without --correction it exits 4 and writes nothing; with --correction the earlier sections survive under 'Superseded diagnosis'; on a conflicting issue it needs no --correction, both labels give way to diagnosis:mechanism and earlier sections survive under 'Superseded diagnosis (<date>): conflicting labels'. False green guarded: overwriting a wrong diagnosis passes a happy-path test; the exit-4, superseded and conflicting cases are asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-diagnose.bun.test.ts && echo 'AC-MI-4 PASS: a diagnosis is recorded or corrected without losing the earlier one'
- [·] [script] AC-MI-5: Wiring: the lore assess --file-issues filer sends diagnosis:symptom-only; the compiled dist/lore report-issue --help lists --mechanism, --end-state and --symptom-only. False green guarded: the CLI test passes while the assess filer still files undiagnosed reports; both the CLI and the assess filer are exercised.
  script: test — bun run test:file packages/lore/tests/e2e/report-issue-diagnosis-compiled.bun.test.ts && echo 'AC-MI-5 PASS: every filing caller requires or states a diagnosis'
- [·] [script] AC-MI-6: Over fixture issues labelled symptom-only, unlabelled and conflicting, each of lore create plan --issue <n>, lore create task --issue <n> and lore issue adopt <n> is refused (exit 4, nothing created, output naming the diagnosis found and lore issue diagnose <n>); a diagnosis:mechanism issue is accepted on all three (exit 0); lore issue adopt of an already-adopted symptom-only issue reports 'Already adopted' (exit 0), proving that check precedes the diagnosis check; the fake GitHub port counts exactly one listing request per command. False green guarded: testing create task and adopt only would leave create plan unchecked; all three carrier paths are asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/fix-carrier-requires-diagnosis.bun.test.ts && echo 'AC-MI-6 PASS: fix work starts only on a diagnosed issue'
