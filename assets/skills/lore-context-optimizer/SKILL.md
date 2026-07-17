---
name: lore-context-optimizer
description: "Use when CLAUDE.md or skills exceed token budgets, user says 'compress prompts', 'reduce context size', 'optimize tokens', 'context too large', '压缩上下文', or when system prompt injection causes context overflow."
---

# Context Optimizer

Analyze and compress AI prompts, skills, and documentation to maximize information density.

## Strategies (in order)
1. **Remove AI common knowledge**: Delete anything a well-trained LLM already knows (SOLID, TDD, REST patterns, etc.)
2. **Merge redundancy**: Consolidate duplicate content across files
3. **Simplify structure**: Replace verbose YAML/tables with concise prose or keyword anchors
4. **Increase density**: Use methodology names as anchors instead of expanding definitions
5. **Progressive disclosure**: Move details to reference files, keep summaries in main files

## Content Classification
- **Essential**: Project-specific conventions, unique workflows, override behaviors → KEEP
- **Valuable**: Decision tables, routing logic, checklists → COMPRESS
- **Redundant**: Repeated across files, already in shared files → MERGE
- **Low-value**: Common knowledge, obvious instructions → DELETE

## Verification
After optimization: preserved completeness (no project-specific info lost), reduced token count (target ≥40%), maintained quality (no ambiguity introduced).
