---
id: TASK-863
type: task
role: plan
title: "One documentation edit put main's CLAUDE.md eviction floor red, and neither the authoring path nor the pre-push path can see it"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"eviction-floor","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"771776c7-0b20-498b-97d6-70ac2ae27cd7"}
---

Measured on main 2026-08-25. Commit 5cb9b905 ("docs(store): record the cross-store DUPLICATE_SLUG winner-lookup invariant") added ONE line to packages/lore/src/store/CLAUDE.md and took the file from 13148 bytes to 14835. The advisory ceiling asserted by packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts is 14746, so main went red on that commit: "expected 14835 to be less than 14746".

Attribution is decidable and was machine-checked: `git show 5cb9b905~1:<file> | wc -c` = 13148 (clean), `git show 5cb9b905:<file> | wc -c` = 14835 (over). One commit, one line, 1687 bytes.

Two mechanisms failed together, and neither is the author's diligence:

(1) The AUTHORING path has no guard. `lore governance claude-md` prints a content contract and `lore status --check-claude-md` enforces a ceiling, but neither runs as part of writing a module CLAUDE.md, so an agent appending a normal, well-formed, genuinely useful invariant line has no way to learn it just crossed the floor. The line itself is good documentation - that is exactly why this is a mechanism gap and not an authoring mistake.

(2) The PRE-PUSH path cannot see it. hooks/pre-push runs NO tests by design, so a test-shaped oracle is push-invisible. The regression therefore reaches main, and every later session inherits a red suite whose cause is a documentation edit in an unrelated module.

Blast radius measured in this session: a second, concurrent session merged an unrelated feature and had to spend a full triage pass proving the red was not its own, by attributing byte counts across three commits. That cost is paid again by every session that runs the suite until someone evicts.

**Expected:** A module CLAUDE.md edit that would cross the eviction advisory ceiling is refused, or at minimum reported, AT AUTHORING TIME by the surface that already owns the contract (`lore status --check-claude-md` wired into the write path or into the pre-push chain), so the ceiling is enforced where the byte is added rather than discovered later by an unrelated session running the full suite.
**Actual:** The ceiling exists only as a vitest assertion. Nothing on the authoring path or the pre-push path evaluates it, so crossing it is invisible until some later session runs the full suite; main stays red in the meantime and the red misattributes to whoever happens to be merging at the time.
**Repro command:** `git show 5cb9b905~1:packages/lore/src/store/CLAUDE.md | wc -c    # 13148, under the 14746 ceiling
wc -c < packages/lore/src/store/CLAUDE.md                        # 14835, over it
bunx vitest run packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts`

Reported by: agent:main-orchestrator
