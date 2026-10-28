---
id: TASK-1686
type: task
role: plan
title: "check-ac-oracle-ownership checks only live criteria; superseded ones are skipped as verify skips them"
status: archived
priority: critical
created: 2026-10-20
updated: 2026-10-26
tags: []
parent: PRD-001
---
Resolves #313. The checker reports missing-owner-file for criteria marked superseded_by whose test file was deleted with the retired behaviour, failing the integrate floor of the identity branch. End state: criteria with superseded_by are not checked for an owner file nor counted as owners of AC references (lore verify already skips them). AC: red-first test that a superseded criterion naming a missing file yields no finding while a live one still yields missing-owner-file.
