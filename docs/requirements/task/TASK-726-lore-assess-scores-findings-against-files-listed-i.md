---
id: TASK-726
type: task
role: plan
title: "lore assess scores findings against files listed in its OWN truncation manifest, so a path the judge never saw is reported as a MAJOR gap"
status: draft
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PRD-001
---
Companion to 01KZWVCPCTKAVXZ3068HRZ8SGK (same root cause on lore review). Both judge surfaces truncate their input and then score the absent region as if it were absent from the codebase. Measured difference worth noting for the fix: when review truncates the SUBJECT document it emits a Truncation Notice and the judge correctly discounts the cut region (observed 2026-08-13 on spec-multi-session-concurrency-queryable-ownership-checkout: 'Per the Truncation Notice, only trailing content within the final section was cut'). When review truncates the PARENT CONTEXT there is no such notice, and the judge treated the cut as a missing section. assess has the manifest but no equivalent discount rule at scoring time. So the mechanism is already half-built on one surface — the fix is to make the notice cover every truncated region on both surfaces AND make a finding whose subject lies in a truncated region non-scoring by construction, rather than relying on the judge to notice.
