---
id: BASE-083
type: baseline
role: intent
title: "Standard: layering and dependency direction"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-094
links:
  - {id: SPEC-009, type: supersedes}
  - {id: SPEC-001, type: supersedes}
  - {id: SPEC-014, type: supersedes}
---
# Standard: layering and dependency direction

Rules on which module may depend on which. Dependencies point down the layer stack: adapters -> app.ts -> services -> store -> core.

Leaf IO ports (`packages/lore/src/adapters/*-port.ts`: `real-git-port`, `process-probe-port`, `session-heartbeat-port`) sit BELOW the services in this stack despite their directory: each wraps one OS facility (git, process table, heartbeat file), imports nothing from the adapters above, and holds no adapter logic. AS-3 therefore permits them and is not an upward dependency; any other adapter import from a service is one.

Each rule is an AS-n in four parts. The rule records (`extra.rules`) are the source of truth; the section below renders them as stored on 2026-10-10 so a reader of this body sees all four parts. Edit rules with `lore rule set`, then re-render.

## AS-1: Services depend on StoreInterface only, never on a concrete store (SQLiteStore, TursoStore) or on bun:sqlite.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: Measured 2026-10-10: no file under packages/lore/src/service imports SQLiteStore, TursoStore or bun:sqlite; the names appear only in comments. InMemoryStore is the test double behind the same interface.
- **Target Rule**: Every store-holding service receives a StoreInterface; store-specific behaviour is added to the interface and implemented by all three stores.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed; keep the interface as the only seam. A store-specific need extends StoreInterface with parity tests (batch-methods.shared.ts pattern).
- **Examples**:
  - A new service takes 'store: StoreInterface' in its constructor and is wired in app.ts.
  - Refused in review: a service importing SQLiteStore to run a raw query.

## AS-2: Services do not construct or import another store-holding service; app.ts composes them and injects collaborators. Store-less pure modules are shared by import instead.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: The service module doc states the rule, but two sites break it: rule-service.ts constructs new CorpusService(store) when no port is passed, and baseline-status.ts constructs new AcExemptionService(store).
- **Target Rule**: No file under packages/lore/src/service imports a store-holding service class at runtime (type-only imports allowed); collaborators arrive through constructor ports wired in app.ts.
- **Current Exceptions**: AD-6
- **Migration**: Issue #120: make the RuleService createDoc port required and pass AcExemptionService (or its counts port) into baseline status from app.ts; then add a source-scan test refusing runtime service-to-service imports.
- **Examples**:
  - RuleService receives corpusService.create as a port from app.ts rather than building a CorpusService.
  - gate-predicates.ts, a pure module, is imported by several services; that is allowed.

## AS-3: Services import no adapter module except the leaf IO ports under packages/lore/src/adapters/*-port.ts.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: Measured 2026-10-10: the only adapter imports under service/ are task-workflow-service.ts -> adapters/real-git-port.js and session-service.ts -> adapters/process-probe-port.js and adapters/session-heartbeat-port.js, all leaf IO ports documented in the service module doc.
- **Target Rule**: A service may import only adapters/*-port.ts leaf IO ports; anything else an adapter owns is reached by the adapter calling the service.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed; a new IO need adds a new *-port.ts leaf rather than importing adapter code.
- **Examples**:
  - TaskWorkflowService imports adapters/real-git-port.js to capture the claim branch; allowed (a leaf port).
  - Refused: a service importing adapters/cli/utils.ts to format an error.

## AS-4: The @lore/core default barrel is browser-safe: Node builtins are imported only in *-node.ts files exposed through @lore/core/node, and the dashboard imports @lore/core only.

- Confidence: established; enforced by: guaranteed; lifecycle: live
- **Current Reality**: Measured 2026-10-10: Node builtin imports in packages/core/src occur only in config-node.ts, telemetry-node.ts, actor-resolution-node.ts and slugify-node.ts; packages/dashboard/src has no @lore/lore, bun:sqlite, child_process or node:fs import. Oracle: packages/lore/tests/unit/core/barrel-isolation.test.ts.
- **Target Rule**: Same as today: the barrel's transitive import graph contains no Node builtin, and the dashboard never imports @lore/lore or @lore/core/node.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed; the barrel-isolation test refuses a regression.
- **Examples**:
  - Config file IO lives in config-node.ts and is imported via @lore/core/node by packages/lore.
  - A top-level fs import in a barrel module blanks the dashboard SPA before React mounts; barrel-isolation.test.ts fails.
