---
id: KN-158
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
---
# Handoff — agent:main-orchestrator

## Plan

plan-spec-046-distribution-p0-p1-asset-ssot-local-safe-installer

## Task Refs

(none)

## Modified Files

- assets/ (new SSOT tree, 26 files)
- packages/core/src/{setup-manifest,merge-settings,register-mcp}.ts
- packages/lore/src/service/{setup-service,project-setup-service}.ts + flows/{setup-project-flow,init-corpus}.ts
- packages/lore/src/adapters/real-{asset-source,setup-fs,mcp-registrar}.ts + cli/{commands/setup.ts,setup-args.ts,setup-render.ts}
- CLAUDE.md (SPEC-046 entry + Dogfooding Eval Log section) + service/cli CLAUDE.md

## Key Decisions

| Judgment | Confidence |
|---|---|
| SPEC-046 (PRD §17 P0+P1) fully landed: 11/11 tasks archived, all ACs attested/evidenced incl. F sandbox smoke post empty-dir fix (c769d0e); plan assess ×2 done | 95 |
| AC-046-E attested-fail ×2 root-caused as load-sensitive vitest onTaskUpdate RPC flake, NOT a regression — see knowledge-lore-verify-long-oracle-flake-vitest-ontaskupdate-rpc (approved); re-run quiet machine before treating as real | 90 |
| uninstall empty-dir semantics: removeDirIfEmpty ancestor sweep, empty-only never-force; pre-existing user dir emptied by our removal IS pruned (documented simplification, dir-provenance tracking deliberately out of scope) | 85 |
| owner granted full execution delegation 2026-07-16 (owner judges, agent executes) — judgment points still go back via AskUserQuestion | 95 |

## Failing Oracle

(none)

## Next Steps

- Owner judgment pending: start P2 (npm single-platform publish + TTY postinstall, needs new spec under PRD §17) or P3 spike (bun cross-compile --target matrix + multi-file asset embed feasibility) — P2 recommended first per phased de-risking
- lore pending queue: 2 SPEC-046 assessment drafts + 3 older items await review/approve
- Real-machine install (owner's actual ~/.claude) NOT yet exercised — production path sets LORE_SETUP_ALLOW_REAL=1 via adapter; do a supervised real install when owner wants to dogfood lore setup on this machine (NOTE: assets/hooks session-start-resume.mjs etc. would overwrite-with-backup the live hooks — review plan output first)
- Dogfooding eval log has 3 open GLOBAL skill-fix recommendations (product/design mode-$0 validation, mode-prd subagent_type, g1 hook UNRESOLVED_CONTENT_FILE) — all need owner greenlight, they touch ~/.claude global skills
