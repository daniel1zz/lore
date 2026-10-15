---
id: BASE-039
type: baseline
role: intent
title: "Architecture debt registry"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-092
links:
  - {id: SPEC-030, type: supersedes}
---
# Debt registry

One AD-n entry per known structural gap between the current state and the standards. Each entry's statement names its tracking issue (GitHub issue number, or the corpus doc that schedules it). An entry is live while its gap exists in the code on main. It is retired when the fix lands on main, with a retirement note that names the fix; the standard that listed it drops it from Current Exceptions in the same change. The GitHub issue can close later, when main is pushed, so a retired entry can still name an issue that is open on GitHub.

The entry records (`extra.rules`) are the source of truth; this body renders them as stored on 2026-10-11.

Counts: 13 entries, 9 open (live), 4 resolved (retired).

## Open debt

| Entry | Excepts standard | Tracking |
|---|---|---|
| AD-1 | AS-17 | issue #112 (open) |
| AD-2 | AS-17 | issue #118 (open) |
| AD-6 | AS-2 | issue #120 (open) |
| AD-7 | AS-14 | issue #121 (open) |
| AD-8 | AS-7 | issue #84 (open) |
| AD-9 | AS-7 | issue #2 (open) |
| AD-10 | AS-8 | issue #50 (open) |
| AD-11 | AS-8 | issue #57 (open) |
| AD-12 | AS-10 | issue #113 (open) |

### AD-1

Site census stops following calls at depth 12, so a refusal site deeper than that is dropped and a leaf can read complete while missing it. Tracked by issue #112 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-17
- Examples:
  - A refusal reached through 13 nested calls from a command handler is absent from lore baseline sites output.
  - Coverage reports 0 gaps for a leaf whose rule is only enforced 13 calls deep.

### AD-2

Site census treats an injected property's single visible binding as its only implementation, ignoring assignments, untyped literals or spreads that could bind others, so sites can be silently omitted. Tracked by issue #118 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-17
- Examples:
  - A port wired by an object spread in app.ts resolves to one implementation; refusal sites in the other are not listed.
  - A property reassigned after construction keeps the census pointed at the original function.

### AD-6

Two service-layer sites construct another service instead of receiving it from app.ts: RuleService's constructor builds an ungated new CorpusService(store) when no createDoc port is passed, and baseline-status.ts calls new AcExemptionService(store). Tracked by issue #120 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-2
- Examples:
  - new RuleService(store) without the port creates baseline nodes with no GateEnforcer.
  - Exemption counts in baseline status come from an AcExemptionService that app.ts never wired.

### AD-7

Nothing mechanically stops a test or smoke run from writing this repository's own .lore corpus; only the dashboard e2e global setups isolate, everything else relies on CLAUDE.md prose. Tracked by issue #121 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-14
- Examples:
  - A bun test that spawns lore create with cwd inside the repo writes the team's live corpus and passes.
  - Only packages/dashboard/tests/e2e/global-setup*.ts use mkdtemp + lore init and refuse a foreign server.

### AD-8

With sync.enabled, CLI corpus writes land only in the local store: loadLoreApp strips the sync section before createApp, with no warning. Tracked by issue #84 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-7
- Examples:
  - A project with sync.enabled runs lore create; the doc exists locally and never reaches the replica.
  - loader.ts loadProjectConfig destructures sync away before every createApp call.

### AD-9

One unknown key or other parse failure in .lore/config.yaml makes the CLI loader drop the whole project config to undefined and run on defaults, and the error then reads as if nothing was configured. Tracked by issue #2 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-7
- Examples:
  - A typo'd top-level key silently disables every workflow.gates setting in that config file.
  - loader.ts documents the degrade-to-undefined path as the historical silent fallback for non-ai sections.

### AD-10

Setting a plan's status straight to approved through lore set (CorpusService.set) skips the plan-promote gate; only ReviewService.approve enforces it, plus the shipped agent hook. Tracked by issue #50 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-8
- Examples:
  - lore set <plan> --status approved succeeds for a plan that lore approve would refuse at plan-promote.
  - corpus-service.ts enforces spec-promote on a status change but has no plan-promote enforce call.

### AD-11

The claim-scoped corpus-write guard is armed only by the CLI loader (setCorpusWriteContext in adapters/cli/loader.ts); MCP rule and AC tools and HTTP writes run with it unarmed. Tracked by issue #57 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-8
- Examples:
  - lore_rule_add over MCP from a session holding no claim writes a rule the CLI verb would refuse.
  - Only adapters/cli/loader.ts calls setCorpusWriteContext (on ruleService and acService); no MCP or HTTP adapter does.

### AD-12

lore restore writes the document first and its version row and audit entry afterwards, outside one transaction, so a failure between them leaves an unrecorded change. Tracked by issue #113 (open).

- Confidence: observed; enforced by: prompt-only; lifecycle: live
- Excepts: AS-10
- Examples:
  - VersionService.restore calls store.update, then insertVersion, then appendAuditEntry as three separate writes.
  - If insertVersion fails, the doc shows restored content at a version with no version row.

## Resolved debt (retired, no longer open)

These entries are kept for the record only. No standard lists them as an exception.

### AD-3

lore baseline fidelity judged a criterion's citation without the named test's code, so it could not check that the test would fail if the cited rule were false. Tracked by issue #117; fixed on main by merge 50f48c68 (2026-10-10); the GitHub issue stays open until that merge is pushed.

- Confidence: observed; enforced by: prompt-only; lifecycle: retired
- Resolved: Resolved 2026-10-10: the fidelity judge reads each named test file and counts unreadable ones as not_seen (issue #117 fixed, AC-BLC-8).
- Examples:
  - A citation whose test asserted nothing about the rule was judged faithful from the criterion text alone.
  - The judge could not name which assertion of the test exercised the cited BR-n.

### AD-4

lore baseline sites and coverage failed in the compiled binary because the census could not load typescript from /$bunfs (exit 4 census:typescript-unavailable, measured 2026-10-10), so completeness checks ran only from a source checkout. Tracked by issue #58; fixed on main by merge a45f1c9c (2026-10-10); the GitHub issue stays open until that merge is pushed.

- Confidence: observed; enforced by: prompt-only; lifecycle: retired
- Resolved: Resolved 2026-10-10: the compiled binary embeds typescript and runs the census (issue #58 fixed, AC-BLC-4).
- Examples:
  - lore baseline coverage <leaf> from dist/lore exited 4 naming census:typescript-unavailable.
  - The same command run via bun run dev from the repo succeeded.

### AD-5

The spec parent contract required a spec's parent to be the PRD (doc-type-rules.ts spec: [prd]), so specs were not related to the trees through citations alone. Scheduled in spec-baseline-slice-3a-architecture-tree-baseline-root (Non-goals) and closed by baseline slice 3b on 2026-10-10 (merge ab6eb38f; 173 specs migrated).

- Confidence: observed; enforced by: prompt-only; lifecycle: retired
- Resolved: Resolved 2026-10-10 by baseline slice 3b: specs take no parent and relate through citations; 173 specs migrated (AC-BLS3B-1, -7).
- Examples:
  - lore create spec under a baseline leaf was refused because only a prd could be a spec's parent.
  - All live specs carried parent_id = the root PRD, so lore tree showed them as PRD children.

### AD-13

lore link wrote the link, a parent link's parent_id change and the audit entry as three separate writes instead of one transaction, so a failure part-way could leave an unaudited relationship or parent change. Tracked by issue #123; fixed on main by merge 4d6d0649 (2026-10-10); the GitHub issue stays open until that merge is pushed.

- Confidence: observed; enforced by: prompt-only; lifecycle: retired
- Resolved: Resolved 2026-10-10: lore link parent writes link, parent_id and audit in one store transaction (issue #123 fixed, AC-BLC-7).
- Examples:
  - CorpusService.link called store.addLink, store.update(parent_id) and store.appendAuditEntry one after another.
  - If appendAuditEntry failed, docs.parent_id had changed and the audit trail had no link row.
