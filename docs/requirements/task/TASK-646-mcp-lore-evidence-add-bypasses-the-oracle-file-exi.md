---
id: TASK-646
type: task
role: plan
title: "MCP lore_evidence_add bypasses the oracle-file-existence precheck — routes directly to TaskWorkflowService.addEvidence, so an MCP-originated self-reported test/e2e pass citing a missing file records cleanly (CLI is gated since e6aa451)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Repro
adapters/mcp/tools.ts lore_evidence_add calls taskWorkflowService.addEvidence / requirePhaseWorkflowService(app).addEvidence directly; grep confirms zero imports of commands/evidence or evidence-precheck. The CLI precheck (evidence-precheck.ts, merged e6aa451) therefore does not cover MCP callers.
## Expected
MCP evidence path runs the same precheck (extractTestFileTokens/findMissingOracleFiles with a real FileExistsPort resolved against the corpus root) with identical VALIDATION_ERROR semantics; manual/lint/build/tsc oracles and result=fail unaffected. Consider hoisting the precheck call into a shared seam both adapters use rather than duplicating.
## Anchor
packages/lore/src/adapters/mcp/tools.ts, packages/lore/src/adapters/cli/evidence-precheck.ts
## Provenance
Implementer AC-4 scope finding, task-lore-evidence-self-reported-pass-lacks-oracle-file (2026-07-26).
