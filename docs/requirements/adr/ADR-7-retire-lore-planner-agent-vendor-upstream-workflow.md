---
id: ADR-007
type: adr
role: decision
title: "Retire lore-planner agent; vendor upstream workflow skills into assets SSOT"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-07-18
tags: [distribution, subagents, skills, spec-046]
parent: PRD-001
links:
  - {id: SPEC-085, type: informs}
---
# ADR — Retire lore-planner agent; vendor upstream workflow skills into assets/ SSOT

## Status

Accepted (owner decision 2026-07-17, "按推荐执行").

## Context

The distributed subagent roster was 4 agents (explorer / planner / implementer / reviewer). A design review of "should subagent capabilities fold into skills?" established the governing principle: **skills carry procedural knowledge (how), agents carry the execution container (where / as whom / with what permissions)** — tool-permission enforcement (`disallowedTools`), context isolation, parallelism, and distinct actor identity (`LORE_ACTOR`, which the SPEC-042 anchor-overlap gate depends on) are container properties a skill cannot provide. Folding those into skill text would demote deterministic enforcement to advisory prompt discipline — the inverse of lore's own gate philosophy.

Per-role assessment against that principle:

- **lore-implementer — keep.** Worktree isolation + parallel dispatch + per-agent `LORE_ACTOR` are structural: collapsing into the main agent means a single actor and the `task-claim` anchor-overlap gate never fires. The main agent is also hook-barred from writing source.
- **lore-reviewer — keep.** Mechanically read-only, and reviewer independence is the value (Self-Verification Paradox: the context that wrote the code must not grade it).
- **lore-explorer — keep.** Pure container value (isolating exploration reads from the main context); folding it into a skill is strictly negative (exploration would run IN the main context).
- **lore-planner — retire.** Its own definition already delegated the entire planning ceremony to the plan skill ("The skill is the single source of truth"). The `plan-promote` gate is enforced caller-independently at the service layer (GateEnforcer), so governance does not care who runs the skill. Decisively: a subagent has **no AskUserQuestion channel**, and planning is the workflow step that most needs interactive user confirmation — wrapping it in a subagent severed that channel. Read-heavy planning inputs can be delegated to lore-explorer instead.

A second defect made the retirement urgent: lore-planner hard-referenced `~/.claude/skills/plan/SKILL.md`, but the plan skill was **not** in the `assets/` SSOT — `lore setup` distributed the agent without the skill it depends on. On any third-party machine the reference 404'd and the agent would "invent its own protocol" (the exact failure its prompt forbids). Same distribution-pipe-needs-both-ends failure class as the Phase-C/governance-path incident (see CLAUDE.md eval log 2026-07-17).

## Decision

1. **Retire `lore-planner`** (reversible): removed from `assets/agents/` (git history preserves it) and the installed copy moved to `~/.claude/.retired-20260717/agents/`. Planning now runs in the **main agent via the plan skill** (interactive, AskUserQuestion-capable); the built-in `Plan` agent type remains available for isolated read-heavy planning and keeps its `subagent-context` directive.
2. **Vendor the upstream workflow skills into `assets/skills/`** so every skill the distributed workflow references ships with it: `plan` (planning ceremony), `product` (PRD chain), `design` (spec chain), `ai-native-coding` (referenced by lore-implementer), `review` (referenced by lore-reviewer). 72 files; `product/docs/.docman/*` (retired docman residue) excluded; zero `/Users/apple` hardcodes (conformance-tested).
3. **Consumers updated**: `pre-no-general-agent-gate.mjs` roster message and `subagent-context.mjs` directive map (planner mapping removed) — both `assets/` SSOT and installed copies; installed hook tests now REGRESSION-assert lore-planner is no longer advertised/mapped.
4. **Conformance manifests updated**: `assets-ssot.test.ts` `DECLARED_FILES` and `real-setup-ports.test.ts` `DECLARED_FILES_IN_SCOPE` → 99 entries (28 − 1 planner + 72 vendored).

## Consequences

- Distributed roster is now 3 agents (explorer / implementer / reviewer), each keeping capability in skills and only container concerns in the agent definition.
- `lore setup` now installs the full upstream skill chain — third-party machines get a working `product → design → plan` pipeline plus the skills the remaining agents reference, with no dangling `~/.claude/skills/*` references.
- The vendored skills' upstream SSOT is now `assets/skills/` in this repo; the owner's personal `~/.claude/skills/` copies are the install target, not the source of truth. Future skill edits must land in `assets/` first (or be synced back) — same discipline as `assets/hooks/`.
- This machine must NOT re-run a real `lore setup` blindly: it would reinstall `governance/corpus-workflow.md`, which was deliberately retired locally (discipline lives in personal CLAUDE.md; reinstalling causes double injection).
- Oracles at decision time: installed hook suites 35/35; manifest suites 84/84 (61 assets-ssot + 23 real-setup-ports); `lore setup --dry-run` shows all vendored skills in the install plan (92 identical-skips on this machine) and no planner agent.

## Amendment — 2026-07-17 (same day): lore- name prefix + zz-* convergence

Owner directives following the initial decision:

1. **All distributed skills carry the `lore-` name prefix.** The five vendored skills were renamed `lore-plan` / `lore-product` / `lore-design` / `lore-ai-native-coding` / `lore-review` (directories, frontmatter `name:`, and every functional cross-reference: agent prompts, intra-skill `/x mode` invocations, `~/.claude/skills/<name>/` paths). Naming rule going forward: anything shipped by `lore setup` is namespaced `lore-*` — skills, agents, hooks alike.
2. **The owner's `zz-*` skills converged into the distribution** under the same prefix: `lore-auto-wire` (ex-`zz-auto-wire`, incl. two executable scripts), `lore-init-context` (ex-`zz-init-context`), `lore-uat` (ex-`zz-uat`; `evals/` excluded — personal fixture with `/Users/apple` paths). Runtime config path `~/.config/zz-auto-wire/` renamed to `~/.config/lore-auto-wire/` in skill content; the owner's machine had the config dir copied over (old dir retained for compat).
3. **Local machine parity**: personal `~/.claude/skills/` copies renamed to match (install-target discipline); `/product` `/design` `/review` command shims retarget the lore- names, and the legacy docman-era `/plan` command doc was replaced by a thin shim to `lore-plan` (original preserved at `~/.claude/.retired-20260717/plan-command-legacy.md`).

Distribution skill set is now 13: `lore` + `lore-kickoff` + `lore-session` + `lore-autopilot` + `lore-doctor` + the eight above. Conformance manifests: 121 entries.

## Amendment 2 — 2026-07-17: full dev-workflow vendoring (new-machine turnkey)

Owner directive: "新机器 `lore setup` 后整个开发工作流开箱即用,第三方 skill 除外" — the distribution goal escalated from "skills the workflow references" to "the entire authored dev workflow". Boundary ratified via AskUserQuestion: **Tier 0+1+2, excluding framework-knowledge and Claude-Code-meta skills.**

27 skills vendored under `lore-` names (in addition to the 13 lore-native + 5 upstream from the prior rounds):
- **Tier 0 (mechanical — dangling from already-shipped assets):** `lore-research`/`lore-test`/`lore-refactor`/`lore-diagnose` (named by the shipped `subagent-context.mjs` executor/Plan directive; the directive was updated to the lore- names), plus a `shared/` references library (referenced via relative `../shared/` by several skills — a LIVE defect the prior round introduced by vendoring skills that depend on it).
- **Tier 1 (authored methodology):** git-workflow, bug-hunt, iterative-review, tdd, dogfood, design-ui, deploy, operate, domain, npm-publish, product-lens, biz-review, best-practice (ex-my-best-practice), analyze (ex-my-analyze), triage, to-issues, to-prd, prototype.
- **Tier 2 (meta/codebase tooling):** project-bootstrap, improve-codebase-architecture, context-optimizer, write-a-skill, harness-dev.

**`shared/` is the one prefix exemption:** it is a library dir (no `SKILL.md` entry, not invokable), installs to `~/.claude/skills/shared/`, and keeps its bare name because sibling skills hardcode `../shared/...` relative paths — renaming would break all of them.

**Excluded as third-party (owner ratified both edge classes out):**
- External-tool MCP/CLI wrappers: agent-browser, gitnexus-* (7), domscribe, langfuse.
- Framework/language knowledge: nextjs, uniapp, tailwind-css-patterns, polyglot-coding, screenshot-to-code.
- Claude-Code meta: claude-code-config, find-skills. (`write-a-skill` was kept — it authors OUR skills; `context-optimizer` kept — it manages our context budgets.)

**Byproduct fix:** the ex-`design` skill's dangling `preview.py` (4 call sites) and `ui-standards-template.md` refs — logged OPEN the prior round — resolved to their real sibling homes now that the siblings ship: `preview.py` → `shared/scripts/preview.py`, template → `lore-design-ui/templates/`. Root cause was cross-skill coupling invisible while skills lived un-vendored; vendoring the whole workflow surfaced + fixed it.

**Naming rule crystallized:** everything `lore setup` ships is `lore-*` namespaced (skills, agents, hooks). Personal namespaces (`my-*`, `zz-*`) collapse into `lore-*` on convergence (drop the personal prefix, not stack it). The one exemption is non-invokable library dirs like `shared/`.

Distribution skill set is now 40 (13 lore-native + 27 workflow) + `shared/` lib. Command shims for the renamed skills (`/test`→`lore-test`, etc.) preserve muscle memory. Conformance manifests: 264 skill files.
