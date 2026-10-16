---
id: KN-692
type: knowledge
role: knowledge
title: "Compressing always-loaded instructions without losing rules, and grading the result (Anthropic docs, 2026-10-16)"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: [prompting, content-tiers, evaluation]
parent: PRD-001
links:
  - {id: SPEC-185, type: relates-to}
---
# Research: how to compress always-loaded instructions without losing rules, and how to grade the result

Date 2026-10-16. Sources are Anthropic first-party docs (tier S), fetched this day.

## Findings

1. A stated reason improves adherence. "Providing context or motivation behind your instructions, such as explaining to Claude why such behavior is important, can help Claude better understand your goals and deliver more targeted responses." Example: instead of "NEVER use ellipses", "Your response will be read aloud by a text-to-speech engine, so never use ellipses since the text-to-speech engine will not know how to pronounce them." — platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
2. Dial back aggressive emphasis: "Where you might have said 'CRITICAL: You MUST use this tool when...', you can use more normal prompting like 'Use this tool when...'." — same page.
3. Remove what goes stale and what Claude already knows: "Avoid time-sensitive information", "Only add context Claude doesn't already have … Does this paragraph justify its token cost?" — platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
4. Always-loaded memory holds "facts Claude should hold in every session"; multi-step procedures or part-of-codebase facts move to a skill or a path-scoped rule; "target under 200 lines … Longer files consume more context and reduce adherence"; specific beats vague; contradictions make Claude "pick one arbitrarily". — code.claude.com/docs/en/memory
5. LLM grading: "Have detailed, clear rubrics"; "instruct the LLM to output only 'correct' or 'incorrect'"; grader "reasons before it produces an evaluation score"; "use a different model to evaluate than the model used to generate the evaluated output". — platform.claude.com/docs/en/test-and-evaluate/develop-tests
6. Evaluation-driven development: build evaluations first, measure a baseline, write minimal instructions, iterate; test with a fresh instance (Claude B) on real tasks and observe. — agent-skills best-practices page.

## What this corrects in lore (2026-10-15 work)

- The Content Tiers rule said "A tier-1 line states the rule, never the reasoning". Finding 1 contradicts the absolute form. Corrected rule: a tier-1 line is the rule plus at most one short reason clause when that reason sets where or when the rule applies; history, incidents, dated measurements and mechanism walkthroughs are tier 2 (finding 3). A qualifier that limits when a rule applies (only when, where configured, unless) is part of the rule.
- The rule-wording compression (plan-always-loaded-lore-fragments-state-the-rule-only) set a byte ceiling before measuring; it forced rule cuts, and three assessments (AC-RW-5 at 65, 50, 62) found lost qualifiers. A preset reduction target is the defect; measure after a no-loss pass.
- AC-RW-5 was a single vague rubric graded first by the authoring model's own session. Finding 5: per-item binary checklist, reasoning before verdict, different grader.
