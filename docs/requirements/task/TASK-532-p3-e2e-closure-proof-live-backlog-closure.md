---
id: TASK-532
type: task
role: plan
title: "P3 — e2e closure proof + live backlog closure"
status: archived
priority: medium
phase: "P3 closure"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
plan: PLAN-103
---
## Objective

Prove the loop terminates on the real shape, then apply it to the live backlog — the mechanism's first and decisive consumer.

## Deliverables

- **AC-ICL-8 e2e** — a filed issue plus an `archived` spec carrying a `resolves` edge computes `fixed`; `lore issues --open` omits it; `lore status --check-issues` reports it as an unclosed escalation until the issue task itself is archived.
- **Live closure** — apply the new mechanism to this corpus's real backlog:
  - `task-no-init-setup-path-provisions-feedback-upstream-lore` ← `resolves` edge from `spec-out-of-box-reporting-channel-report-issue-self-provisions` (shipped and archived 2026-07-29; `lore report-issue --auto-config` is live in the CLI). Then archive the issue task per the detector's prompt.
  - Run `lore issues --all` and `lore status --check-issues` and record the output as the closing evidence: the other 8 reports must show `open`, and none may be silently mutated.

## Acceptance Criteria

AC-ICL-8. Oracle: `cd packages/lore && bun test tests/e2e/issue-closure-e2e.bun.test.ts -t AC-ICL-8`.

## Constraints

- The e2e AC runs against a throwaway corpus. The live-closure step is the ONLY step that touches this repo's real `.lore/`, and it is a deliberate corpus write via the new verbs — no test may ever write there.
- Do the live closure with the new mechanism (`lore link --type resolves`), never by hand-setting a status. Hand-setting is precisely the anti-pattern this plan removes.

## Live closure ALREADY DONE by the orchestrator (2026-07-29) — do not repeat it

The live-corpus half of this task is complete. It was performed with the new mechanism, from the main checkout, by `agent:main-orchestrator`:

- `lore link plan-implementation-out-of-box-reporting-channel-self-provision task-no-init-setup-path-provisions-feedback-upstream-lore --type resolves`
- `lore link spec-out-of-box-reporting-channel-report-issue-self-provisions task-no-init-setup-path-provisions-feedback-upstream-lore --type resolves`
- computed resolution went to `fixed`; `lore status --check-issues` then flagged it as an *unclosed escalation* with an executable remediation; the issue task was walked to `archived` per that prompt.

Measured end state on the real corpus: `--open` 9, `--resolved` 2 (`fixed` for the escalated one, `closed` for the pre-mechanism SPEC-069 one), `--check-issues` → `consistent`.

**Your scope is now ONLY the AC-ICL-8 e2e proof against a throwaway corpus.** Do NOT touch this repo's `.lore/` — the live step is finished and repeating it would corrupt the corpus.
