---
id: PLAN-270
type: plan
role: plan
title: "Known defects stay open, one issue per defect, falsely closed defects restored"
status: archived
priority: medium
created: 2026-10-25
updated: 2026-10-25
tags: []
parent: SPEC-236
phases:
  - {name: "R"}
---
Known defects recorded by the review batch must stay true: open until fixed (#404), one issue per defect (#405), and the 45 issues falsely closed on 2026-10-24 restored (owner chose: fix first, then reopen, merging duplicates so each defect is reopened once).

Done when: archiving an accepted-with-known-defects plan closes no issue; two reviews of one defect yield one issue; every falsely closed defect is open again exactly once (duplicates closed as duplicates of it) and linked as a known defect.
