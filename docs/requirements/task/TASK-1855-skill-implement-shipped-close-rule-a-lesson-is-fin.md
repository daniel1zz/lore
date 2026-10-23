---
id: TASK-1855
type: task
role: plan
title: "[Skill:implement] Shipped CLOSE rule: a lesson is finished only when it changes a mechanism"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PRD-001
---
Retroactive task for work done by helper run a86ee62141a599a42 without a claimed task (turn-end review finding, 2026-10-18): commit 5d422f88, merged in 8e90f06f. Replaces the deprecated retro-contract spec (spec-a-retro-lesson-names-the-mechanism-that-stops-it-recurring): the lesson->mechanism principle lives in the always-loaded CLOSE rule; its output is enforced by the v5 design_necessity judge; the trigger itself is stated as not enforced.
