---
id: TASK-576
type: task
role: plan
title: "T4: give ModelAwareProvider its real implementor (HttpAIProvider.modelId)"
status: archived
priority: medium
phase: "P3-hardening"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-109
plan: PLAN-109
---
SPEC-103 T3 introduced the structural ModelAwareProvider capability ({ readonly modelId?: string }) in ai-provider-service.ts so ai_provenance can carry a REAL model id instead of the provider name — but shipped it with ZERO implementors, because no provider file was inside T3's anchors. Net effect today: ai_provenance is omitted for every generate() call, and the capability is dead abstraction. Fix: HttpAIProvider already holds a configured real model (private cfg.model) — expose it as a readonly modelId so the capability has its one honest implementor. Do NOT invent a modelId for ClaudeCliProvider (it shells out to 'claude -p' and genuinely cannot know which model served the call — omission there is correct and already documented) or for InMemoryAIProvider (test double). Oracle: a test asserting HttpAIProvider.modelId equals the configured model and that it satisfies the ModelAwareProvider shape, plus proof that an AIProviderService wired with an HttpAIProvider stamps ai_provenance.model with that real id (not the provider name). Consequence to state in the test or its header: on THIS corpus the active provider is claude-cli, so ai_provenance stays omitted here — I1 collision detection is genuinely N/A for claude-cli-generated docs, by design, not by oversight.
