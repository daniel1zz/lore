---
id: KN-793
type: knowledge
role: knowledge
title: "Measured cost of a lore integrate attempt (2026-10-19)"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
links:
  - {id: ADR-052, type: relates-to}
---
# Measured cost of a lore integrate attempt, 2026-10-19

Measures the cost assumption of `adr-main-advances-only-by-lore-integrate-per-session` (Option A: per-session CAS integration, "~110 s per attempt"). Source: the per-attempt records `lore integrate` now writes (`.lore/integrate-attempts/<branch>.json`, task-integrate-records-per-attempt-phase-durations-so-the-floor, merge f83d00f0), 9 attempts between 07:58 and 08:17 UTC, floor = `bun install --frozen-lockfile && bun run check:floor` (16 steps; the ADR measured `check:static`).

## Numbers

| Phase | Median | Max |
|---|---|---|
| Whole attempt | 155 s | 218 s |
| Floor | 152 s | — |
| Corpus snapshot (VACUUM INTO, 1.2 GB) | 2.6 s | 3.9 s |
| Merge + CAS | < 0.3 s | — |

Floor steps by median: `check:ac-oracle-ownership` 84 s (55 % of the floor), `typecheck` 42 s, `check:baseline-coverage` 16 s, `build` 6 s, every other check ≤ 1 s.

Outcomes: 5 landed, 2 lost races, 1 floor failed, 1 conflict.

Earlier the same day, before the records existed, three consecutive attempts took ~18 min each (snapshot lines 04:42, 05:01, 05:19) and all lost the race: the machine was at load 17–26 on 8 cores with two floors and three typecheck chains running. Attempt cost scales with machine load, not with corpus size (the snapshot is ~3 s).

## Reading against the ADR

- The ADR's cost (~110 s) is low by ~40 % at normal load; its own estimate then gives, for K = 3 sessions integrating every T = 10 min, P(loss) ≈ 1 − exp(−2·155/600) ≈ 0.40 — consistent with 2 lost of 9 here.
- The decision (Option A) still holds: losses are bounded (3 attempts, exit 75, visible in `lore status` with the median attempt duration), the system as a whole progresses, and no queue or lock is needed at this cost.
- The lever is the floor itself: one step, `check:ac-oracle-ownership`, is more than half of every attempt. Making it incremental (task-check-ac-oracle-ownership-scans-only-what-changed-so-the) shortens the race window for every session. Under overload the window grows ~7×; that is a property of the machine, recorded here so the next starvation report is read against it.
