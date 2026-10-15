---
id: BASE-075
type: baseline
role: intent
title: "Standard: gates and write paths"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-094
links:
  - {id: SPEC-008, type: supersedes}
  - {id: SPEC-006, type: supersedes}
  - {id: SPEC-001, type: supersedes}
---
# Standard: gates and write paths

Rules that keep every write surface (CLI, MCP, HTTP) behind the same service-layer checks, and every write recorded.

Each rule is an AS-n in four parts. The rule records (`extra.rules`) are the source of truth; the section below renders all 4 of them (AS-8, AS-9, AS-10, AS-19) as stored on 2026-10-10 so a reader of this body sees all four parts and each rule's stored examples. Edit rules with `lore rule set`, then re-render.

Confidence uses the baseline vocabulary (core baseline.ts RULE_CONFIDENCES): established, undecided, unconfirmed, observed. Established marks a standard adopted with the architecture baseline: its Target Rule is the decided intent, and its Current Reality is still measured from the code, which is why an established rule can list debt exceptions. Observed marks a rule recorded only from what the code does today, with the owner's intent not yet confirmed. As used in this node, enforced by guaranteed means a mechanism or test in the code refuses every violation, both means a mechanism or test covers the known paths and written guidance covers new ones, and prompt-only means written guidance only.

## AS-8: Every gate and every write guard runs in the service layer, so a write is checked the same way whether it arrives through the CLI, MCP or HTTP. No write path honours LORE_GATE_BYPASS; only the read-only 'lore gate' pre-flight check, which writes nothing, reads it.

- Confidence: established; enforced by: both; lifecycle: live
- **Current Reality**: Measured 2026-10-10: GateEnforcer.enforce runs spec-create (corpus-service.ts:1561), task-create (:1602), spec-promote on a draft->approved reached through set (:2474) and plan-close (:2704) in CorpusService; spec-promote on approve (review-service.ts:269), plan-promote (:339) and review-judgment (:458) in ReviewService; task-claim (task-workflow-service.ts:4336) and phase-claim (phase-workflow-service.ts:1670). spec-promote runs in both approve and set because both reach draft->approved, as the target requires. LORE_GATE_BYPASS only prints a note on a write. Gaps: AD-10, a plan set straight to approved via CorpusService.set skips plan-promote; AD-11, the claim-scoped corpus-write guard is armed by the CLI loader only.
- **Target Rule**: Each checkpoint is enforced at every service method that can perform its transition, so every surface reaching that transition is gated, and every write guard is armed in app.ts (or the shared composition step) rather than in one adapter.
- **Current Exceptions**: AD-10, AD-11
- **Migration**: AD-10 closes with issue #50: route a plan status change to approved in CorpusService.set through the plan-promote checkpoint. AD-11 closes with issue #57: arm the claim-scoped guard in the shared composition step so MCP and HTTP inherit it.
- **Examples**:
  - spec-create is enforced inside CorpusService create, so lore create, lore_create and the dashboard POST are denied alike.
  - LORE_GATE_BYPASS=1 on a lore create call is ignored; the write is still gated and the output says the variable does not apply.

## AS-9: Every write that changes a spec's acceptance criteria passes the single AC write chokepoint (ac-write-chokepoint.ts). A write that replaces a spec's whole extra object (lore set, MCP lore_set, HTTP PATCH) also passes it, and is accepted only when it carries the stored criteria unchanged.

- Confidence: established; enforced by: both; lifecycle: live
- **Current Reality**: Measured 2026-10-10: applyAcChange is called by AcService.writeCriteria (ac-verb), CorpusService create (create) and set (wholesale), VersionService.restore (restore) and MigrationService (import). The wholesale path refuses a changed criteria array with AC_WRITE_NOT_VIA_AC_VERB (ac-write-chokepoint.ts:59), pinned for CorpusService.set, MCP lore_set and HTTP PATCH by tests/unit/service/ac-write-chokepoint.test.ts (AC-BLS2-1). Nothing scans for new code that writes extra.acceptance_criteria through the store directly, so a new path is held by guidance only. Issues #54 and #36 are still open on GitHub but the code paths they describe now pass the chokepoint.
- **Target Rule**: Same as today: no code writes extra.acceptance_criteria except through applyAcChange with a declared path, and the citation gate decides every added or revised criterion.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed for code; close issues #54 and #36 against the current chokepoint call sites.
- **Examples**:
  - lore ac add goes through applyAcChange('ac-verb', ...) and admitAcWrite (citation gate).
  - MCP lore_set sending a reworded acceptance_criteria array is refused; sending the stored array back unchanged passes.

## AS-10: A document change is recorded with it: the doc write, its version row and its audit entry land together, or none of them do.

- Confidence: established; enforced by: both; lifecycle: live
- **Current Reality**: Measured 2026-10-10: CorpusService create, update and delete use the store's *WithProvenance methods (insertWithProvenance corpus-service.ts:1735, updateWithProvenance :2826), which commit the doc row, version row and audit entry in one transaction; link now uses addLinkWithProvenance (:4542), committing the link row, a parent link's parent_id and the audit entry together (commit a094b933, issue #123 still open on GitHub). One path does not: VersionService.restore issues store.update (version-service.ts:244), insertVersion (:272) and appendAuditEntry (:276) as three separate writes.
- **Target Rule**: Every path that changes a document commits the document row, the version row and the audit entry in one transaction.
- **Current Exceptions**: AD-12
- **Migration**: Issue #113: move restore onto the single-transaction provenance write. The link half (issue #123, AD-13) is fixed in code; AD-13 and #123 can close.
- **Examples**:
  - lore set writes the new content, a version row and a hash-chained audit entry in one store write.
  - A failed CAS write (STALE_VERSION) leaves no version or audit row behind.

## AS-19: Every audit entry written through an adapter records the surface the write came from (cli, agent, mcp, http_cookie or http_token) beside its acting identity, so one write is attributed the same way whichever surface it arrives through.

- Confidence: observed; enforced by: both; lifecycle: live
- **Current Reality**: Measured 2026-10-10 (commit 1cf5ae5d, on main): every audit entry is stamped at the store's single audit insert point by stampAuditSurface (store/audit-surface.ts), called in sqlite-store.ts:1792, turso-store.ts:1452 and in-memory-store.ts:1152, so every appendAuditEntry caller is covered. The surface goes into details.surface, inside the hash-chained payload, in the same entry as its actor field (core types.ts AuditEntry). Adapters declare it: CLI at loader.ts:479 (cli or agent), MCP at mcp/index.ts:38 and per tool call (mcp/tools.ts:1426), HTTP per request (http/index.ts:36). A write with no declared surface leaves the key absent, never guessed, and nothing refuses it, so a new adapter entry point that forgets to declare is held by guidance only. tests/integration/http/audit-surface.bun.test.ts (AC-BLC-1) covers CLI, MCP, cookie and token. Issue #128 still open.
- **Target Rule**: Every audit entry written by an adapter-driven write names the write surface in details.surface; a write with no adapter leaves the key absent rather than guessing one.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed for code; close issue #128 against the store-level stamp (store/audit-surface.ts).
- **Examples**:
  - A dashboard approve writes an audit entry with details.surface http_cookie; the same approve from the CLI writes cli (or agent when CLAUDECODE=1).
  - A service called from a unit test with no adapter writes an audit entry with no surface key.
