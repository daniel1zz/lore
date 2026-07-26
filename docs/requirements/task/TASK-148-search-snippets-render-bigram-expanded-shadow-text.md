---
id: TASK-148
type: task
role: plan
title: "Search snippets render bigram-expanded shadow text (同步 步更 更新…) — collapse overlapping bigrams back to original prose in snippet output"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Byproduct of the CJK bigram shadow-column fix (migration-008, 2026-07-25): FTS5 snippet() generates from the indexed fts_content (bigram-expanded), so CJK result snippets show '…同步 步更 更新 新实 实测…' instead of '…同步更新实测…'. Search matching/ranking is correct; only snippet display is degraded. Observed live: lore search 交易 on the guyin corpus.

AC:
- Given a CJK hit, When search results render a snippet, Then contiguous overlapping-bigram runs are collapsed back to the original prose (deterministic: adjacent bigrams overlap by one char) while highlight markers and ASCII segments are preserved — pinned by store-level bun tests (pure collapse helper + end-to-end search snippet assertion with CJK, ASCII, and mixed fixtures).
- Given ASCII-only snippets, Then output is byte-identical to today (regression).
