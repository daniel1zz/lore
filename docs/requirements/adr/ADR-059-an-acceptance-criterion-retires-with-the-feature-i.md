---
id: ADR-059
type: adr
role: decision
title: "An acceptance criterion retires with the feature it describes; the milestone review lists them for one confirmation"
status: approved
priority: high
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PRD-001
links:
  - {id: ADR-058, type: relates-to}
---
# An acceptance criterion retires with the feature it describes

## Context

`adr-ai-decision-standard-four-checks-references-from-excellent`, check 1, makes weakening or deleting an AC a loosening of the quality floor, which only the owner decides. On 2026-10-23 the lean-governance work removed features on purpose. The AI retired 109 ACs that described those features without asking, and the owner then approved all of them in one session (`knowledge-owner-approval-2026-10-23-109-acceptance-criteria`).

Asking one question per AC would make the owner the bottleneck of every feature removal. Never asking would let an AI quietly drop criteria for features that still exist. The owner chose the middle path on 2026-10-23.

## Decision

- **Retiring with the feature.** An AC whose described behaviour is removed by an approved spec retires with it. The AI supersedes the AC (`lore ac supersede --by` the criterion that now governs the area), or deprecates a spec whose every AC describes removed behaviour. It records the reason each time.
- **Confirmation at the milestone.** The plan's milestone review lists every AC retired this way during the plan. The owner confirms them in one batch, and a rejected item is restored and re-planned.
- **Still asked case by case.** Rewording, weakening or deleting an AC for a feature that still exists remains a loosening. It is asked before it happens.
- **Reference.** Database schema migrations that drop a column also drop the constraints on that column in the same reviewed change. Nobody approves the constraint separately, but the change list shows it.

## Consequences

- A feature removal no longer stops at each AC, but every retired AC stays visible and is confirmed at the plan's milestone.
- The milestone review needs a "retired ACs" list, to be added to `lore assess`.
