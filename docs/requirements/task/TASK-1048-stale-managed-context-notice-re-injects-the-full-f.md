---
id: TASK-1048
type: task
role: plan
title: "stale-managed-context notice re-injects the full fresh section while Claude Code still loads the stale rules file, so the model gets two versions of the same rule"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"context","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e85fb8c1-96e7-4d86-b03c-d3b165634976"}
---

When a project .claude/rules/lore-*.md file differs from a fresh render, 'lore fragments render --outlet hook:session-start' emits 'lore:stale-managed-context: the project .claude/rules/lore-*.md files differ from a fresh render. Run lore context refresh ...; the changed content follows.' followed by the ENTIRE freshly rendered section. Claude Code independently loads the stale file itself at launch (rules without paths frontmatter load unconditionally, https://code.claude.com/docs/en/memory). Result in this repo: lore-corpus-workflow-feed.md (3,756 B, stale) is loaded by Claude Code AND a 3,818-char fresh FEED section is injected by the hook — the same ~3.8K rule twice per session and again after each /compact, with the two copies differing in exactly the drifted clause (`spec-create --parent <prd>` vs `spec-create`). Nothing tells the model which copy wins; per the memory docs, conflicting instructions may be followed arbitrarily. The notice also does not name which file drifted (lore fragments check does). Related but distinct from #102 item (2) (stale warning that never clears for hand-edited files): this is about the payload shape, not whether the warning clears.

**Expected:** The notice names the drifted file(s) and injects only the delta (or only the fresh text with an explicit 'this supersedes <file>' marker), so the model sees one authoritative version; size stays proportional to the drift, not to the whole section.
**Actual:** Notice + full fresh section (3,818 chars) injected alongside the full stale file (3,756 B) loaded by Claude Code; the drifted file is not named in the injection.
**Repro command:** `lore fragments check; echo '{"cwd":"'$PWD'"}' | node assets/hooks/session-start-fragments.mjs | jq -r .hookSpecificOutput.additionalContext | head -5`

Reported by: agent:main-orchestrator
