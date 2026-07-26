---
id: TASK-304
type: task
role: plan
title: "[Skill:implement] SetupService lifecycle + invariant tests I1-I5 (AC-046-B)"
status: archived
priority: critical
phase: "services"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-302, type: blocks}
  - {id: TASK-303, type: blocks}
---
Estimate: L
Approach: Implement `SetupService` (stateless, Result<T,LoreError>) consuming the core-pure modules, with constructor-injected ports; plus its lifecycle vitest carrying dedicated tests for invariants I1–I5. Mirror gate-enforcer / drift-check-service DI precedent.
Source: SPEC-046 Design (service/setup-service.ts); invariants I1–I5.
Dimensions: D-FUNC, D-CODE
Scope-Alt: uninstall roundtrip could be a follow-up, but I3 requires it — keep in scope.
Covers: AC-046-B

Ports (constructor-injected):
- AssetSource { load(): Promise<Result<AssetPayload>> }  (P1 impl reads assets/ dir; swappable for P3 binary-embed WITHOUT touching this service)
- SetupFsReader { read, stat }  — planInstall() receives THIS ONLY (structurally cannot write)
- SetupFsWriter { write, mkdir, backup, remove }  — install()/uninstall() only
- McpRegistrar { add, remove }
- targetDir is a RESOLVED string PARAM (no homedir()/env reads in the service)

Test port strategy (IMPORTANT): this task's tests use TWO test doubles it defines LOCALLY — a spy fake-fs (for I1/I2/I4 + fault injection) AND a minimal test-local real-fs port backed by node:fs against a mkdtemp dir (for the I3 roundtrip). The test-local real-fs is a THROWAWAY test helper in this task's test file — it is NOT the production `real-setup-fs.ts` (built later by the real-setup-ports task, which is blocked by this task). Do NOT import or pre-build production adapter code here; do NOT fake the I3 roundtrip (a fake defeats the byte-identical-restore invariant).

Methods: planInstall() / install() / uninstall(). sha256 computed over FINAL ON-DISK BYTES (I5). Atomic write delegated to the writer port. Backup-before-overwrite; restore-from-backup IS uninstall for merge-target files. `claude` absent → loud, receipt marks MCP skipped, exit≠0, file assets still installed.

AC:
- Given `bunx vitest run packages/lore/tests/unit/service/setup-service.test.ts`, When it runs, Then it exits 0.
- I1: Given a spy fake-fs whose settings.json is malformed, When install() runs, Then ZERO SetupFsWriter calls occur across the entire run (assert via spy call-count === 0) and the result is err.
- I2: Given a target already byte-identical to the payload, When install() re-runs, Then every entry is reported `skipped` and zero writer calls fire.
- I3: Given install() then uninstall() over the test-local real-fs backed by a mkdtemp dir, When uninstall completes, Then every backed-up merge-target file is restored byte-identically (hash equality) and the manifest is removed.
- I4: Given planInstall() (dry-run path), When called, Then zero SetupFsWriter calls fire (reader port only).
- I5: Given a completed install, When the manifest is read, Then each SetupEntry.sha256 equals sha256(final on-disk bytes) — not the raw payload.
- Fault injection: Given a spy fake writer where write #2 of 3 throws, When install() runs, Then file 1 is committed, file 3 is never attempted, the receipt honestly reports partial, and a re-run converges (I2 holds).
- Test-safety guard (I6): the service's test constructor REFUSES a targetDir inside the real ~/.claude or the repo's own .lore/ (mkdtemp only).
- Oracle: `bunx vitest run packages/lore/tests/unit/service/setup-service.test.ts` exits 0.
