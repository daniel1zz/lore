---
id: KN-009
type: knowledge
role: knowledge
title: "Assess reliability findings from round-2 self-hosted loop (SPEC-029 candidates)"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-03
tags: [assess, reliability, backlog]
parent: SPEC-028
---
Two defects observed while self-hosting the SPEC-027-R2/SPEC-028 assessment loop (2026-07-03), candidates for a follow-up spec: (1) JUDGE REASONING LENGTH HARD-FAIL — first PLAN-R2 assess attempt died with 'ac_scores.0.reasoning: String must contain at most 300 character(s)' AFTER the one corrective retry; the retry prompt embeds the Zod parse error but the judge still wrote long reasoning, so a verbose-but-valid judgment kills the whole run and wastes two provider calls. Options: state the 300-char limit explicitly in the base judge prompt AND the corrective prompt; or truncate reasoning service-side post-parse (lossy but never fatal); or raise the schema cap. (2) MISLEADING ERROR HINT — the AI_PROVIDER_ERROR path prints 'Retry with --no-ai to use the editor instead', but assess has NO non-AI mode (--no-ai always exits 2 per SPEC-026); the hint is inherited from the create/set flow and actively misleads. Fix: surface-specific error hints. Both reproduced on claude-cli provider, prompt v1.
