---
id: TASK-046
type: task
role: plan
title: "T2: wire @tailwindcss/typography so prose classes render (AC-5/6)"
status: archived
priority: high
created: 2026-07-03
updated: 2026-07-03
tags: [spec-031]
parent: PLAN-011
plan: PLAN-011
---
Install @tailwindcss/typography and wire via Tailwind v4 CSS syntax (@plugin in src/index.css). Assert markdown heading structure renders inside the prose container in DocDetail component test. Files: packages/dashboard/package.json, src/index.css, tests/component/DocDetail.test.tsx. Oracles: typecheck + vitest.
