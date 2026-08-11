---
id: TASK-502
type: task
role: plan
title: "T1 boundary required on removal ports (D8, AC-SL-7/8)"
status: archived
priority: medium
phase: "Fix"
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-099
plan: PLAN-099
---
# T1 — boundary becomes a required parameter on the removal ports (D8, AC-SL-7/8)

## Task Objective

Move enumeration of removal call sites from a remembered regex to the type checker. `boundary` is currently optional (`opts?: { boundary?: string }`) and the ancestor-symlink scan is SKIPPED when it is absent — so a forgotten argument silently reinstates a data-loss path that no behavioural test of the writer can observe.

## Spec Reference

`spec-lore-setup-deletes-repo-source-through-dev-symlinks` (approved, amended). **D8 is the governing decision** — read it verbatim; it states what must NOT change as precisely as what must.

## Acceptance Criteria

AC-SL-7 and AC-SL-8, declared as this task's `ac_scope`. AC-SL-1 … AC-SL-6 are an unchanged regression floor — they must keep passing, but they are not this task's to re-verify.

## Context Digest — already measured, do not re-derive

Current signatures:

- `packages/lore/src/adapters/real-setup-fs.ts:192` — `async remove(path: string, opts?: { boundary?: string }): Promise<void>`
- `packages/lore/src/adapters/real-setup-fs.ts:366` — `export function removeProjectPath(path: string, opts?: { boundary?: string }): void`
- `packages/lore/src/service/setup-service.ts:292` — the port interface declaring `removeDirIfEmpty` / `remove`

All **9 production call sites already pass `boundary`** — measured, not assumed: `setup-service.ts:625,784,835,898,903,924` and `setup-project-flow.ts:632`, `setup-project-uninstall.ts:223,228,240`. So no production caller changes behaviour; the work is the port declarations plus the test doubles.

### What must NOT change (D8, explicit)

The **runtime** `boundary === undefined` branch inside `remove` stays reachable and stays tested. Required-ness is a TypeScript constraint; a runtime that reinterpreted a missing boundary as "scan to the filesystem root" would refuse every removal for anyone whose install root is itself a symlink — the exact case D4 exists to avoid. Do not delete `if (opts?.boundary !== undefined)`.

Likewise D3's refusal semantics, D6's `ENOTDIR` swallow, and the write-side `renameSync`-replaces-the-link behaviour are all settled and out of scope.

## AC-SL-7 — the negative control is the load-bearing half

`bun run typecheck` passing proves nothing on its own: a signature left optional also typechecks. The AC requires a fixture that OMITS `boundary` and that `tsc` must REJECT. Build it so a signature quietly reverted to optional turns this AC red — e.g. an expect-error-annotated fixture, or a checked-in snippet compiled in a dedicated tsc pass whose FAILURE is the pass condition. Whichever mechanism you pick, prove it discriminates: show it red when the signature is optional and green when required.

## AC-SL-8 — suite-membership floor

An independent review found that AC-SL-4 ("the whole suite passes with zero failures") also passes if the suite SHRINKS — deleting the ancestor-refusal case leaves zero failures and exit 0. Add a monotonic floor on the symlink suite's own executed-case count (never fewer than today's), not an exact total: an exact total was already tried in this spec's history and drifted silently as the suite grew.

## File Anchors

- `packages/lore/src/adapters/real-setup-fs.ts`
- `packages/lore/src/service/setup-service.ts`
- `packages/lore/src/flows/setup-project-flow.ts`
- `packages/lore/src/flows/setup-project-uninstall.ts`
- `packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts`
- `packages/lore/tests/unit/service/setup-service.test.ts`

⛔ Do NOT commit `packages/lore/src/generated/assets-manifest.ts`. A concurrent task owns that file; if `bun run build` regenerates it, leave it out of your commit.

## Test discipline (binding)

- Real filesystem for symlink assertions — a `MapFs`-style fake models paths as string keys and cannot represent a link, so this defect class is unreachable by fakes.
- Test doubles must supply a `boundary`. A double typed loosely enough to skip it re-opens the hole in test space and makes AC-SL-7 vacuous.
- `-t` title filters exit 0 on zero match. Copy `describe`/`it` titles literally into the AC commands.
