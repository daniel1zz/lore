---
id: SPEC-258
type: spec
role: spec
title: "A decision-carrying write records its decision on its version row, and the milestone review re-checks it"
status: approved
priority: medium
created: 2026-10-27
updated: 2026-10-28
tags: []
links:
  - {id: ADR-064, type: implements}
  - {id: SPEC-239, type: relates-to}
---
# A decision-carrying write records its decision on its version row, and the milestone review re-checks it

## Overview/Goal

Implements `adr-an-agent-s-decision-between-milestones-is-a-record-gates` (approved; corrected twice on 2026-10-27). An agent's decision between milestones (edit a rule directly or through a spec, correct an approved spec, change a baseline node) leaves no structured trace today: `lore rule set` records only which fields changed (`rule-service.ts:418`), the route is chosen by skill text, and the milestone review never sees the premises, alternatives or gates behind a write.

Goal: every decision-carrying write made by an agent carries `reason`, `premises`, `alternatives` and, where relevant, `gates`, `scores` and `refs`, stored on the version row it creates; one missing them is refused with exit 4 in the service layer; the milestone review re-checks each recorded decision (deterministically where a tool can, by the judge where only judgment can) and re-runs the criteria citing a directly edited rule; a traced escaped defect is linked to the decision that let it through, giving a failure rate per gate and dimension.

Relates to: `spec-ai-decision-correctness-outcome-attribution-and-audit` (scores review judgments and autonomy decisions; this spec scores write decisions).

Benchmark (from the ADR): Kepner-Tregoe, Spinnaker Kayenta `critical` metrics, ITIL standard change, Open Policy Agent decision logs, credit scorecard reason codes.

## Scope

### Which writes carry a decision

A write carries a decision when **all** of these hold:
- it is made by an agent run (`inv.identity` source `run`); a write as a human party (human session, dashboard login, HTTP key) never does (ADR correction 2);
- its target is not a draft. For a spec, ADR or weight table, "not a draft" means a status other than `draft`. For a baseline node it means the node has an approved version: a pending revision does not make it a draft for this purpose (a baseline node's status is derived from its pending items, `corpus-service.ts:3171-3182`);
- it changes more than status.

| Command | Service entry |
|---|---|
| `lore set` on a spec, ADR or baseline node (CLI; HTTP set routes, where a human party is exempt) | `CorpusService.set` |
| `lore rule set` (CLI) | `RuleService.setRule` |
| `lore rule add` (CLI) | `RuleService.addRule` |
| `lore rule propose` on a spec that is not a draft (a correction) | `RuleChangeService.propose` |
| `lore ac add|set|rm|supersede|cite|exempt` on a spec that is not a draft | `AcService` / `RuleCitationService` / `AcExemptionService` entries |
| `lore baseline set-label|depends|glossary|map` on a node with an approved version | the baseline services |
| `lore weights set` on a weight table that is not a draft | `WeightTableService.set` (new) |

The refusal fires on the write that records a pending revision (for example `rule set`); approving it later is status-only and carries none. Internal status-only callers (archive in `assess.ts`, the bulk lifecycle service) are unaffected; `assess-file-issues.ts` writes a plan, which is not in the table.

**Trivial** (no decision required): a `rule set` whose patch holds only `examples`, or only `confidence` moved lower in the order `established` > `observed` > `unconfirmed` > `undecided` (D3).

### The decision payload

```ts
/** Recorded on the version row a decision-carrying write creates (packages/core/src/decision-record.ts). */
interface DecisionRecord {
  reason: string;
  premises: Premise[];
  alternatives: { option: string; why_rejected: string }[];
  gates?: { id: string; verdict: "pass" | "fail"; evidence: string; computed: boolean }[];
  scores?: { option: string; dimension: string; value: -1 | 0 | 1; evidence: string }[];
  weight_table?: { slug: string; version: number };   // required when scores are given
  refs?: { practice: string; difference: string }[];
  before?: string;                                     // rule set statement change: the statement replaced
}
type Premise =
  | { claim: string; tier: Tier; source: { kind: "file"; path: string; lines: [number, number]; sha: string; quote: string } }
  | { claim: string; tier: Tier; source: { kind: "cmd"; command: string; expect: string } }
  | { claim: string; tier: Tier; source: { kind: "issue"; number: number } }
  | { claim: string; tier: Tier; source: { kind: "doc"; slug: string; version?: number } };
type Tier = "S" | "A" | "B" | "C" | "D" | "E";
```

- **CLI flags** (repeatable where plural): `--reason`, `--premise "<claim>|<source>|<tier>"`, `--alt "<option>|<why>"`, `--gate "<id>|<pass|fail>|<evidence>"`, `--score "<option>|<dimension>|<-1|0|1>|<evidence>"`, `--weight-table <slug>@<version>`, `--ref "<practice>|<difference>"`.
- **Source syntax:** `file:<path>:<from>[-<to>][@<sha>]`, `cmd:<command> ~ <expected substring>`, `issue:#<n>`, `doc:<slug>[@<version>]`.
- **File sources are quoted by lore, not the writer.** At write time lore reads the named lines and stores them as `quote`.
- **The commit is pinned.** A file source without `@<sha>` is stamped with HEAD, refused (exit 4) when that file has uncommitted changes.

### Refusal (write time, local, before anything is written; exit 4, field `decision`, naming each missing part)

- **Missing parts:** a decision-carrying, non-trivial write without `reason`, without one premise of tier S..C, or without one alternative.
- **Unreadable sources:** a file source whose lines do not exist at its commit.
- **Weight tables:** `scores` without `weight_table`, or a table that is not the approved version of the weight table whose kind the command fixes. The kinds are: `rule revision` for `rule set|add|propose`; `document revision` for every other command. Also refused: a score on a dimension the table lacks.
- **Statement changes on `rule set`:**
  - the service computes the gate `evidence-s-to-c`: pass when every premise is tier S..C, fail when any is D or E (recorded, not refused; the refusal above already requires one S..C premise), so the rates show how often a decision leaned partly on weak evidence;
  - a raise of confidence is refused and goes through `lore rule propose`;
  - the writer must give `meaning-unchanged|pass|<evidence>`, the one judged gate; it is refused if missing or `fail`;
  - the service stores `before`.

### Storage

- **Migration:** the next store migration (041 at the time of writing; renumbered at integrate if main already holds 041) adds `versions.decision TEXT NULL` (JSON) in SQLite, Turso and InMemory.
- **Write path:** the value travels through `DocWriteRequest` and the four store-side version writers that bypass `VersionRecord` (`store-interface.ts:443, 465, 484, 899, 957`).
- **Address:** the audit entry's `details.version` joins it; a decision is addressed as `<slug>@<version>`.
- **Display:** `lore log <doc>` prints each version's decision.

### Weight tables

- **What it is:** a knowledge `reference` document carries `extra.weight_table: { kind, dimensions: Record<string, number> }`. Every weight is > 0, and the weights sum to 1 within 1e-9.
- **Who writes it:** only `lore weights set <doc> --kind <k> --dimension <name>=<w>...`. `lore set` refuses the key, like the glossary.
- **One table per kind:** `lore weights set` refuses (exit 4) a kind already held by another live document, naming it.
- **Lifecycle:** the table is reviewed and approved like any reference document.
- **Changing an approved table** is decision-carrying, and its decision must hold a premise whose source is a milestone review document or a traced issue (the ADR: weights change only by a decision citing a drill-down).

### Milestone re-check (after the judge, beside `applyRegressionFloor`)

- **Which decisions:** the version rows with a non-null `decision` that either
  - (a) wrote one of the plan's targets: the plan's spec, its criteria, the leaves in its rule change set, and the ADR it implements (weight tables are no plan's target; a table change belongs to a plan only through (b)); or
  - (b) were written by a run recorded in a `claim` audit row of one of the plan's tasks (`queryAudit({action:"claim"})`) between that claim and the task's archive.

  New store query `listDecisionVersions({docIds, runs, windows})`.
- **Deterministic checks**, each finding naming `<slug>@<version>`, the part and the fact:
  - **file sources** (premises and gate or score evidence of kind file):
    - `sha` not reachable: **unverifiable**;
    - the line range absent at `sha`, or its text there differs from `quote`: **wrong-when-written**;
    - the same lines' text differs at main: **stale-since**;
    - the comparison is by line content, never the whole file;
  - **command sources** whose command is on the read-only allowlist (`lore get|list|search|tree|rule show|rule find|ac list|log`, `git show|log|grep|diff`, `grep`, `rg`) are re-run in a detached worktree at main with the verify environment allowlist (`resolveVerifyEnv`); an output that no longer contains `expect` is **stale-since**. Any other command is **not-rerunnable** and is not run;
  - **`issue:` and `doc:` sources** are re-resolved; an unresolvable one is **wrong-when-written**.
- **Judged checks** (milestone judge input, a new `decisions` section). For each recorded decision the judge receives the claim with its stored `quote`, the alternatives, and for a rule statement change `before` and the new statement. It answers per decision:
  - is each premise supported by its quote;
  - is `meaning-unchanged` true;
  - is there a better option than the one chosen, named.

  A "no" is a finding.
- **Re-run:** for every recorded `rule set` statement change, the criteria citing that rule are re-run by the verify runner at the milestone; a failing one is a finding.
- **Outcome:** a wrong-when-written finding fails `snapshot_accuracy`. Findings are stored as `extra.milestone_review.decision_findings`.

### Outcome link and rates

- **Trace:** `lore decision trace <plan> --issue <n> --decision <slug>@<version> --part <gate id | dimension | premise>` appends `{issue, decision, part}` to `extra.milestone_review.traced_decisions` of the plan's latest milestone-review document:
  - it uses the document's expected version (compare-and-swap; a lost race re-reads and re-appends);
  - it is idempotent by the triple;
  - it is the only writer of `traced_decisions` and `decision_findings`, and `lore set` refuses both keys.
- **Rates:** `lore decision rates [--kind <k>] [--since <date>]` is read-only and prints, per gate id and per score dimension:
  - the decisions passed;
  - the traced failures;
  - the share, labelled a lower bound;
  - the rule-of-three upper bound at zero failures;
  - the decisions belonging to no plan (by the selection above), as a separate count.

  Beside them, two guard figures over the same window: traced links per milestone review, and decisions per archived task. Agents write both the decisions and the links that grade them.

## Out of scope

- Automatic changes to any gate or weight (ADR: only a recorded decision changes them).
- Writes to drafts, status-only writes, writes as a human party.

## Design Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Where the decision is stored | new nullable column on versions | audit `details`; doc `extra`; the decision-log table | ADR: the version row is a corpus record; `extra` would pollute the doc; the decision-log table records pending decisions awaiting a human or machine |
| D2 | Where the refusal runs | the service entries in the table | CLI argument parsing | CLI usage errors exit 2 and HTTP would bypass them; gates run in the service layer |
| D3 | Confidence order | established > observed > unconfirmed > undecided | none (no order exists, `baseline.ts:91`) | established needs a check-decided criterion; observed is measured in code without one; unconfirmed lacks either; undecided waits on intent |
| D4 | Which decisions a review re-checks | writes to the plan's targets, plus writes by its tasks' claim runs within each claim's window | run id alone; a time window alone | rule proposals precede any claim, and the main agent's corrections run under no task claim; a session-level run can span plans, so runs are bounded by each claim's window |
| D5 | File premises | lore quotes the lines at write time; compared by line content | file existence; whole-file change | existence misses the ADR's own example (a file that exists but says 180000, not 60000); whole-file change marks almost every premise stale |
| D6 | Judged checks | in the milestone judge, with quotes and before/after text | at write time; not at all | the ADR keeps judgment at milestones; only judgment can tell whether a quote supports a claim or a rewording keeps its meaning |
| D7 | Computed gates | the service computes `evidence-s-to-c`; a confidence raise is refused and goes through a spec, so no gate is needed for it | the writer declares them | a declared verdict for a fact the service can compute invites a false declaration |
| D8 | Weight table choice | the command fixes the kind; only the approved version of that kind | the writer names any table | choosing a table after seeing the options would let weights be chosen after the fact |
| D9 | Human writes | exempt (owner, 2026-10-27) | fields on dashboard and HTTP forms | the ADR records agent decisions; a human edit is the owner's decision |

## Acceptance Criteria

Declared with `lore ac add` (AC-DR-1..10), each citing the rule it pins.

## Structure

```
packages/core/src/decision-record.ts                       (new: schema, parser, confidence order, trivial check, gate ids)
packages/core/src/milestone-review.ts                      (decision_findings, traced_decisions)
packages/core/src/schemas.ts, packages/core/src/index.ts   (weight_table; exports)
packages/lore/src/store/migrations/migration-041.ts        (versions.decision; renumbered if taken)
packages/lore/src/store/{sqlite,turso,in-memory}-store.ts, store-shared.ts, store-interface.ts, write-context-store.ts, schema-version.ts
packages/lore/src/service/decision-gate.ts                 (new: the refusal, shared by every service entry)
packages/lore/src/service/{corpus,rule,rule-change,ac,rule-citation,ac-exemption}-service.ts, baseline services
packages/lore/src/service/weight-table-service.ts          (new)
packages/lore/src/service/decision-recheck.ts              (new: deterministic checks, judge section, criteria re-run)
packages/lore/src/service/rule-state-service.ts            (GitPort gains showFile, moved from own-diff-judgment.ts)
packages/lore/src/service/milestone-review-service.ts, milestone-review-inputs.ts, packages/lore/src/ai/milestone-review-template.ts
packages/lore/src/adapters/cli/commands/{set,rule,ac,baseline,log,weights,decision}.ts, adapters/cli/index.ts
```


## Acceptance Criteria (structured)

- [⚑] [script] AC-DR-1: After the store migration, a decision-carrying write stores its DecisionRecord on the version row it creates (SQLite, Turso and InMemory each round-trip it; older rows read null; running the migration twice changes nothing); the audit entry joins it by doc and version; lore log prints the decision under that version.
  script: test — bun run test:file packages/lore/tests/integration/store/decision-column.bun.test.ts -t 'AC-DR-1' && echo 'AC-DR-1 PASS: decision stored on the version row in all three stores'
- [⚑] [script] AC-DR-2: An agent's lore set on an approved spec (a correction), on an approved ADR, and on a baseline node that has an approved version and a pending revision, and an agent's lore baseline set-label, depends, glossary and map on such a node, each with reason, a tier S..C premise or an alternative missing, exit exactly 4 naming each missing part and write no version; a direct CorpusService.set call refuses the same way; a draft spec edit, a status-only write, and the same write as a human party succeed with no decision.
  script: test — bun run test:file packages/lore/tests/integration/cli/decision-refusal.bun.test.ts -t 'AC-DR-2' && echo 'AC-DR-2 PASS: non-draft writes refused without a decision on CLI and MCP'
- [⚑] [script] AC-DR-3: Unit (core decision-record): the trivial check holds only for a rule patch of examples alone or of confidence alone moved lower in established > observed > unconfirmed > undecided; the source parser accepts file:<path>:<from>[-<to>][@<sha>], cmd:<command> ~ <expect>, issue:#<n>, doc:<slug>[@<v>] and rejects anything else; tier S..C detection.
  script: test — bun run test:file packages/core/tests/decision-record.test.ts -t 'AC-DR-3' && echo 'AC-DR-3 PASS: trivial check and confidence order'
- [⚑] [script] AC-DR-4: lore rule set: examples-only needs no decision; a confidence raise exits exactly 4; a statement change without meaning-unchanged, or with it fail, exits exactly 4 and records no revision; with it passing plus reason, premise and alternative, the revision records the decision with the replaced statement and the computed gate evidence-s-to-c (fail when a D or E premise is present, still recorded); lore rule add by an agent on an approved leaf without a decision exits exactly 4; direct RuleService.setRule and addRule calls refuse the same way.
  script: test — bun run test:file packages/lore/tests/integration/cli/rule-set-decision.bun.test.ts -t 'AC-DR-4' && echo 'AC-DR-4 PASS: direct rule edits gated'
- [⚑] [script] AC-DR-5: lore rule propose with --correction on a locked spec without a decision exits exactly 4 and leaves the change set unchanged, and on a draft spec succeeds without one; lore ac add, set, rm, supersede, cite and exempt on an approved spec without a decision each exit exactly 4 and leave the criteria unchanged, and on a draft spec succeed without one.
  script: test — bun run test:file packages/lore/tests/integration/cli/decision-refusal.bun.test.ts -t 'AC-DR-5' && echo 'AC-DR-5 PASS: rule proposals and criteria writes need a decision'
- [⚑] [script] AC-DR-6: File premises at write time: lore stores the named lines' text as the quote; a source without @sha is stamped with HEAD; one naming a file with uncommitted changes and no @sha exits exactly 4; one whose lines do not exist at its commit exits exactly 4.
  script: test — bun run test:file packages/lore/tests/integration/cli/decision-premise-quote.bun.test.ts -t 'AC-DR-6' && echo 'AC-DR-6 PASS: file premises quoted and pinned at write time'
- [⚑] [script] AC-DR-7: Milestone deterministic re-check: a premise quoting registry.ts:59 as 60000 where that line reads 180000 at its commit is wrong-when-written and fails snapshot_accuracy; a line changed only at main is stale-since while an unrelated edit to the same file is not; an unreachable commit is unverifiable; an allowlisted command whose output lost its expected text is stale-since; a non-allowlisted command is not-rerunnable and is not run; gate and score file evidence are checked the same way; a rule proposal made before any claim and a main-agent correction on the plan's spec are selected; a decision by another plan's run is not.
  script: test — bun run test:file packages/lore/tests/integration/milestone/decision-recheck.bun.test.ts -t 'AC-DR-7' && echo 'AC-DR-7 PASS: recorded decisions re-checked deterministically'
- [⚑] [script] AC-DR-8: Milestone judged checks: the judge input holds a decisions section with each premise's quote, the alternatives, and old and new statements for a rule rewording; a stub judge answering not supported, meaning changed, or a named better option produces a finding naming slug@version; after a direct statement change, a citing criterion that now fails when re-run is a finding.
  script: test — bun run test:file packages/lore/tests/integration/milestone/decision-judged-checks.bun.test.ts -t 'AC-DR-8' && echo 'AC-DR-8 PASS: decisions judged at the milestone and citing criteria re-run'
- [⚑] [script] AC-DR-9: lore decision trace appends issue, decision and part to the plan's latest milestone review once (a repeat is a no-op; two concurrent traces both land); lore set refuses traced_decisions and decision_findings with exit 4; lore decision rates prints per gate and dimension the decisions passed, traced failures, the share labelled a lower bound, the rule-of-three bound at zero failures, decisions in no plan, and the two guard figures.
  script: test — bun run test:file packages/lore/tests/integration/cli/decision-trace-rates.bun.test.ts -t 'AC-DR-9' && echo 'AC-DR-9 PASS: outcome links and rates'
- [⚑] [script] AC-DR-10: lore weights set writes a reference document's weight table (weights > 0 summing to 1 within 1e-9, else exit 4) and refuses a kind another live document already holds; lore set refuses the weight_table key; a decision with scores and no table, a table of the wrong kind or not the approved version, or a dimension the table lacks exits exactly 4; changing an approved table without a premise citing a milestone review or traced issue exits exactly 4.
  script: test — bun run test:file packages/lore/tests/integration/cli/weight-table.bun.test.ts -t 'AC-DR-10' && echo 'AC-DR-10 PASS: scores bound to the approved weight table'
  other_command=2
