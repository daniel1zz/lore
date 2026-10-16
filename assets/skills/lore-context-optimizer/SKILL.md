---
name: lore-context-optimizer
description: "Use when CLAUDE.md or skills exceed token budgets, user says 'compress prompts', 'reduce context size', 'optimize tokens', 'context too large', '压缩上下文', or when system prompt injection causes context overflow."
---

# Context Optimizer

Shorten always-loaded instructions without losing a rule. Follow in order.

1. **Snapshot** the verbatim before-text where the next editor can read it (for lore-governed content: a corpus reference doc) before editing.
2. **Classify** every clause of the before-text in a traceability table: KEPT (with the exact new phrase), MERGED (into which line), or DROPPED as one of: history, incident, dated measurement, mechanism walkthrough, duplicate-of <where>, common knowledge. Never drop an instruction, a condition or qualifier, a threshold, an ordering, an exit code, a command or a flag. Keep at most one short reason clause when it sets where or when the rule applies.
3. **Mechanical check** with a script, not a read-through: every KEPT phrase appears in the new text; every command and flag present before is still present.
4. **Grade the DROPPED list only**, with a grader that is a different run (preferably a different model) from the editor. Per item: reasoning first, then a binary verdict, instruction or explanation. Restore every item judged instruction.
5. **Measure the size last** and report it. Never set a reduction target before measuring: a preset target forces rule cuts.
6. Use normal phrasing; do not add CRITICAL / MUST emphasis.
7. For high-stakes files, run a behavioural check: a fresh instance on representative tasks with the old text vs the new text.

Reference: `references/optimization-principles.md`, `references/analysis-checklist.md`.
