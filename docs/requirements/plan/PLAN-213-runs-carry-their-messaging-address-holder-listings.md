---
id: PLAN-213
type: plan
role: plan
title: "Runs carry their messaging address; holder listings show it"
status: archived
priority: medium
created: 2026-10-20
updated: 2026-10-25
tags: []
parent: SPEC-231
phases:
  - {name: "record", description: "Hook flag, migration 027, store writers, run show (AC-MA-1, AC-MA-2)"}
  - {name: "surface", description: "Holder listings join runs by harness_run; e2e (AC-MA-3, AC-MA-4)"}
---
## Goal

Implement spec-runs-carry-their-messaging-address-holder-listings-show-it (AC-MA-1..4): a session's main run records the Claude Code messaging socket as an address (BR-1360) and every claim-holder listing shows the holder session's main-run address (BR-1363).

## Tasks

- T1 = `task-runs-record-their-messaging-address-on-every-register-run` (phase `record`).
- T2 = `task-holder-listings-show-the-holding-run-s-messaging-address` (phase `surface`).

## Invariants

- I1: The hook exits 0 on every path, including a failed register (BR-1030, AC-RID-3). `lore run register` stores NULL when no socket is passed or the run is a subagent; it fails loud (exit 2, nothing stored) when a socket is passed for a harness with no known address grammar or the socket value is empty or not an absolute path. It never stores a guessed, transformed-beyond-grammar, or previous value.
- I2: Every register writes the address column (value or NULL); no code path keeps a previous registration's address (AC-MA-2 third register).
- I3: Holder listings resolve each claim's `harness_run` to its run, then to the main run of that run's session derived from the session id (the hook registers subagents without a parent link); never by `parentRunId`, `claim.session_id` or display name. No holder row is dropped (AC-MA-3 counts).
- I4: Shipped surface only: the hook change lives in `assets/hooks/` with the regenerated manifest, verified from a fresh consumer install (AC-MA-4).

## Phases

- record (T1): hook forwards the raw socket on SessionStart; `run register --messaging-socket` composes `uds:<path>` for claude-code; the NEXT FREE migration number on main at claim time (027 is taken by the blocker) adds nullable `runs.message_address` on SQLite, Turso and in-memory; unconditional per-register write; `run show` text and JSON (`messageAddress`). Covers AC-MA-1, AC-MA-2.
- surface (T2): `readySessionSchema.message_address` resolved per I3; shown in bootstrap active_sessions, `lore ready` sessions (JSON and text line), phase-plan sessions schema (consistency only, no production caller), territory foreign holders (JSON and text line), and the dashboard ReadySession type and its fixture; e2e from a fresh install. Covers AC-MA-3, AC-MA-4.

## Risk Register

- R1 (resolved by ordering): `task-claims-compare-runs-only-the-store-refuses-a-run-less` adds migration 027 and edits the same services; it blocks T1 and T2.
- R2 (L): Turso store diverges from SQLite → AC-MA-2 covers both store kinds the existing run tests cover.
- R3 (L): an exited session's address lingers → out of scope (spec Out); liveness stays with `lore session list`.

## Critical path

task-claims-compare-runs-only-the-store-refuses-a-run-less (external) → T1 → T2.
