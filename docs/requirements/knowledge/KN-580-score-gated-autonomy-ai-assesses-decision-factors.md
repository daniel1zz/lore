---
id: KN-580
type: knowledge
role: knowledge
title: "Score-gated autonomy: AI assesses decision factors, the program scores and compares against configured thresholds"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: [autonomy, config, decision-log]
links:
  - {id: KN-041, type: relates-to}
---
## Requirement (user, session e25636da, 2026-10-11)

An agent decides by itself unless a judgment is too uncertain. The uncertainty analysis is the AI's; the score and the escalation comparison are the program's, and both are configurable.

- AI emits per-factor assessments with reasons: evidence strength, reversibility, oracle verifiability, consistency with precedent, blast-radius class.
- The program computes the score from configured weights (`.lore/config.yaml`), compares it to a configured threshold plus a blast-radius rule, returns `autonomous | escalate`, and appends the decision, factors, score and verdict to a durable decision log.
- This prepares wider configurability: thresholds, weights and the escalation rule are data, not prose.

## Prior art and why it did not fire

`01KX2XW42Y` (P2 decision-score log, knowledge) defined score-gated autonomy as prose: `[CONF: NN]`, escalate iff CONF < 70 or blast-radius critical. No code reads or computes it, so in session e25636da the agent fell back to asking the user to accept an ADR the user had already directed. Prose without a mechanism does not bind (root CLAUDE.md North Star).

## Open design questions

- Where the verdict is enforced: which writes (ADR accept, spec approve, plan promote, dispatch) must carry a decision record, and which gate refuses one without it.
- How the factor schema is validated (Zod), and how a factor scale is calibrated against later outcomes (reverts, reopened issues).
