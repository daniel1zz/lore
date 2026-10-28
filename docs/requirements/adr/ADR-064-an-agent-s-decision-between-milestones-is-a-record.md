---
id: ADR-064
type: adr
role: decision
title: "An agent's decision between milestones is a record: gates, scored options, checked premises, its outcome"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PRD-001
links:
  - {id: ADR-058, type: relates-to}
---
# An agent's decision between milestones is a record: gates, scored options, checked premises, its outcome

## Context

`adr-ai-decision-standard-four-checks-references-from-excellent` (approved 2026-10-23) lets an AI decide everything except three kinds of thing (its check 1), requires every conclusion to name a reference with the difference that could invalidate it (check 3), runs judgment only at milestones, and measures quality by escaped defects per plan. It leaves four gaps, all seen in session 203c17cc on 2026-10-26:

1. **Decisions between milestones leave no structured trace.** An agent chose between "write a spec" and "edit the rule directly" for BR-500 and BR-527. The choice lived only in chat. `lore rule set` records which fields changed (`baseline-revise-a-business-rule`, Event), not why nor on what basis; it has no reason or evidence input (`lore rule set --help`). The route (spec or direct edit) is chosen by skill text only (`~/.claude/skills/lore-baseline/SKILL.md:87-89`), which no check reads.
2. **Wrong premises go unnoticed until a fact is re-checked.** Three premises in that session were false and were caught only by re-reading the source, never by a score: the claude-cli default timeout was stated as 60000 ms (the code says 180000, `packages/lore/src/ai/registry.ts:59`); a direct rule edit was stated to require a spec (`lore rule set` exists); a side note said the issue migration was still pending (`lore issues migrate` dry run: 0 mirrors).
3. **Evidence is not graded.** A conclusion backed by a run's output and one backed by memory read the same. The owner's evidence tiers (S official .. E untrusted) live only in the prompt skill `lore-user-08-evidence-decisions`.
4. **Alternatives and references are checked only after landing.** The milestone review fails a technical choice with no external reference (`packages/lore/src/ai/milestone-review-template.ts:70-73`, design_necessity), but nothing records the alternatives a decision rejected, so "has evidence but is not the best answer" cannot be seen at all.

AI self-reported confidence is not usable as a score: the review judge returned reject at 0.74, 0.68 and 0.72 on three successive revisions of `baseline-file-a-defect-report` on 2026-10-26 (its `review_judgments` rows), while the reasons changed each time.

## Decision

### Record at write time, judge at milestones

A decision is recorded on the write that carries it out, in the version row that write creates (a corpus record, so the decision lives in the corpus as the parent PRD requires) and referenced by that write's audit entry. Every decision-carrying write command takes the fields: `lore rule set`, `lore rule propose`, `lore ac add|set`, and `lore set` on a spec, ADR or baseline node. A write is decision-carrying only when its target is not a draft (an approved or locked spec or ADR, including a correction, or a baseline node or rule); edits of a draft are not decisions, because its decision point is the review and approval that follows. A status-only write is not decision-carrying: approval has its own required reason. A rule change proposed on a draft spec is part of that draft (decided at its approval). A write made as a human party (a human session, a dashboard login, an HTTP key) is not decision-carrying: this record is for agent decisions, and a human's edit is already the owner's decision. There is no separate decision store and no judgment at write time, consistent with the approved ADR ("judgment work runs only at milestones"; write time keeps only cheap local invariants). The recorded fields:

- `--reason`: the question and the choice.
- `--premise "<claim>|<source>|<tier>"` (repeatable): each fact relied on, with a checkable source (`file:line`, a command and its output, an issue number, a document id) and its evidence tier S..E.
- `--alt "<rejected option>|<why>"` (at least one for a non-trivial decision). **Trivial** means a write whose changed fields are only a rule's examples, or only a decrease of its confidence; the command decides this from the fields given, with no judgment. Every other write is non-trivial, including a typo fix and any decision-carrying write to a spec, ADR, criterion or baseline node body; for a plain correction the alternative is simply `"leave it|<what stays wrong>"`.
- `--gate "<gate>|<pass|fail>|<premise or evidence>"` (repeatable): each MUST criterion the decision was screened against, with its verdict; the direct-edit gates below are the first defined set.
- `--score "<option>|<dimension>|<-1|0|+1>|<evidence>"` (optional): each option that passed every gate, compared per dimension on a fixed three-point scale with its evidence. The weighted total uses the **weight table** for the decision's kind (one corpus reference document per kind, for example "rule revision" or "technical design choice"); the record names the table and its version. A decision never sets its own weights, so weights cannot be chosen after the options are known.
- `--ref "<product and practice>|<difference that could invalidate it>"` (technical choices only, as check 3 requires).

### How it is judged (at the milestone review)

- **Gates before scores** (Kepner-Tregoe: MUSTs screen, WANTs are weighted). A dimension whose failure alone must stop a decision is a gate, never a heavy weight: a weight large enough to always stop it is a gate, and written as a weight it passes silently when a weight or threshold changes (Spinnaker Kayenta marks such a metric `critical`, scoring the whole canary 0, because group averaging hides one failing metric).
- **Premises are re-checked by tools at the milestone**: each `file:line` re-read, each command re-run, each issue or document re-resolved. A premise whose source no longer says what the record claims is a finding naming the decision.
- **Weak evidence is refused at write time, not escalated.** A non-trivial write without `--reason`, without at least one `--premise` of tier S..C, or without at least one `--alt`, is refused (exit 4) by a cheap local check on the arguments, the kind of write-time invariant the approved ADR keeps; following it, "no reference found" means the search is not finished. The tier is declared by the writer, so the milestone review re-checks each declared S..C premise against its source.
- **Gates and scores are re-read like premises**: each `--gate` verdict's evidence is re-read; each `--score` entry's evidence is re-read for the chosen option and the alternatives, and a score its evidence no longer supports is a finding.
- **Alternatives** are re-read at the milestone: an `--alt` whose reason no longer holds, or a better option the review can name, is a finding naming the decision.
- **Every finding states its reason**, naming the decision, the dimension and the fact, never only a total (credit scorecard reason codes; Regulation B requires the actual principal reasons).

### Who decides

Unchanged from the approved ADR's check 1: a human decides only an irreversible outward-facing action, input only a human has, or a change to the product goal or loosening of the quality floor. Everything else is decided by AI and recorded as above. A change of product behaviour goes through a spec and its criteria as today.

### Outcome feedback

Quality is still measured per plan (escaped defects and rework within 14 days of plan close, as the approved ADR defines). Each decision's outcome is attributed lazily, at the drill-down that already happens:

- **Denominator from the audit**: every recorded decision is an audit entry with an id, so the number of decisions each gate passed and each dimension scored is counted from the audit, with no extra data.
- **Numerator at drill-down**: when a plan's escaped defect or rework is traced down to a recorded decision, the review writes one link from that issue or reopened task to the decision's version row id, naming the gate or dimension that let it through. Filing an issue never requires naming a decision; the link is written only by the drill-down that found it.
- **Per-dimension failure rate** = traced failures / decisions passed. It is a lower bound (an untraced failure is not counted), and with few decisions it can only show that a gate is failing, never that it is reliable (rule of three: zero failures in n decisions bounds the rate below 3/n at 95% confidence).
- **Where the link lives**: in the plan's milestone-review document (`extra.milestone_review`), as `traced_decisions: [{issue, version_id, gate_or_dimension}]`, written by the review that traced it. It is a corpus record, versioned with that document; GitHub keeps owning the issue's state.
- **What the rates can change**: a gate whose traced failure rate is high is tightened or split by a recorded decision citing the rate. A weight is changed only when a drill-down shows a decision chose the wrong option because a dimension counted too much or too little; that decision edits the weight table and cites the drill-down. Failure rates validate gates; weights are never called validated, only revised with cited drill-downs. Nothing changes a gate or a weight automatically.

### First application: revising a baseline rule directly (candidate standard change)

ITIL's standard change: a low-risk, repeatable change of a defined kind skips the change board, while other changes are routed by risk. Applied here, the defined kind is the gate set below; the difference that could invalidate the analogy is that ITIL pre-approves a kind on its proven history, which lore's direct rule edits do not have yet, so the milestone review re-judges the meaning-unchanged gate of every direct edit in its batch rather than trusting the kind.

- **Direct edit (`lore rule set`) is allowed** when every gate holds, each recorded as a `--gate` entry (a direct edit without all of them is refused at write time like a missing reason):
  - the change is to examples, a confidence decrease, or wording whose meaning is unchanged;
  - a tier S..C premise supports the new text (code `file:line`, a closed issue's decision, a landed spec);
  - confidence does not rise.
- **Otherwise** the change goes through a spec's rule change set (`lore rule propose`).
- The meaning-unchanged gate is judged by the editing agent with its evidence and re-judged at the milestone review; the criteria citing the rule are re-run there too (as `lore rule apply` already defers re-verification to plan close).
- First case: BR-527 (its example still lists the removed `adopted` state; `issue.ts:16` accepts only rejected, wontfix, superseded, duplicate). BR-500 is not a direct edit: turning "suspected defect" into intended behaviour changes its meaning, so it goes through a spec.

## Rejected options

| Option | Why rejected |
|---|---|
| Weighted score only, with a high weight on evidence | a weight high enough to always stop a decision is a gate; written as a weight, it passes silently when a weight or threshold changes |
| AI decides directly with a free-text reason | not checkable per premise or dimension, so a wrong premise cannot be located afterwards; AI confidence is not calibrated |
| A separate agent checks premises at every decision | judgment between milestones, which the approved ADR removed for its context and time cost; tools re-check premises at the milestone instead |
| A separate decision store, or a decision id required on every filed issue and reopen | the filer rarely knows which decision caused a defect, so the field would be guessed or empty; linking at drill-down records it only where it was established |

## Consequences

- A follow-up spec implements, at once for every decision-carrying write command named above:
  - the fields `--reason`, `--premise`, `--alt`, `--gate`, `--score` and `--ref`, stored on the write's version row;
  - the write-time refusal of a non-trivial write without a reason, an S..C premise or an alternative, and of a direct rule edit without all its gate entries or with any gate verdict `fail`;
  - fixed gate ids per decision kind (the direct-edit set first), so the local check matches gates by id, not by free text;
  - one weight table per decision kind as a corpus reference document, starting with "rule revision";
  - pinning: a `file:line` premise records the commit it was read at, so the milestone tells "wrong when written" (the claim fails at that commit) from "stale since" (it holds at that commit, not at main);
  - re-running: only commands on a read-only allowlist are re-run at the milestone; any other command premise is re-read from its recorded output and flagged as not re-runnable;
  - the milestone re-check of premises, gate evidence, score evidence and alternatives, and the `traced_decisions` outcome link.
- Marking the criteria that cite a reworded rule for re-check changes `baseline-revise-a-business-rule` (its boundary note "a revision does not touch the criteria that cite the rule", open question Q2); that change goes through the follow-up spec's rule change set, not this ADR.

## References

Each names the practice used, why it is the same scenario, and the difference that could invalidate it here.

- **Kepner-Tregoe decision analysis**: MUST criteria screen pass/fail, WANT criteria are weighted and scored, then adverse consequences of the top options are assessed. Same scenario: choosing among options under several criteria, some of them non-negotiable. Difference: KT weights are set by people deliberating over one decision; here one weight table per decision kind is reused across many agent decisions, so it is revised only by a recorded decision citing a drill-down.
- **Spinnaker Kayenta canary judgment** (spinnaker.io/docs/guides/user/canary/judge, /guides/user/canary/best-practices): per-metric pass/fail, group weights, a `critical` metric fails the whole canary. Same scenario: an automated go/no-go over several measured dimensions. Difference: Kayenta's metrics are numeric time series compared statistically; most of our dimensions are categorical facts, so the scale is three-point, not a statistical score.
- **ITIL standard change, as implemented in ServiceNow** (standard change catalog; change risk calculator routing to approval levels): Same scenario: deciding which changes skip review. Difference: a standard change needs a proven history, which lore's direct rule edits lack; hence every direct edit is re-judged at the milestone instead of being trusted by kind.
- **Open Policy Agent decision logs** (openpolicyagent.org/docs/v0.33.1/management-decision-logs): each decision is logged with the policy, its input, its result and a decision id. Same scenario: auditing automated decisions afterwards. Difference: OPA decides by deterministic policy; our decisions are made by agents, so the log also records the premises and alternatives a policy engine never has.
- **Credit scorecard reason codes** (PMML 4.3 Scorecard) **and Regulation B adverse-action reasons**: each adverse decision states its principal reasons, not just a score. Same scenario: an automated decision that must be explainable afterwards. Difference: reason codes there come from a fixed regulated list; ours name a dimension and a free-text fact.
- **MADR**: an architecture decision record lists considered options with their pros and cons and the decision drivers. Same scenario: recording why an option won. Difference: MADR records a few large decisions in files; here the fields ride on routine writes, so they must stay short.
