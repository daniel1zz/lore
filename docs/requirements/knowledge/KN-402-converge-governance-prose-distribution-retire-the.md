---
id: KN-402
type: knowledge
role: knowledge
title: "Converge governance prose distribution: retire the machine-level corpus-workflow.md file in favor of runtime injection from the binary"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PRD-001
---
## Context

Session discussion (2026-07-26) challenged why lore-managed guidance lives in two installed locations: the repo CLAUDE.md marker section (project stub) and ~/.claude/governance/corpus-workflow.md (machine-level workflow prose, hook-injected at session start by Phase C).

## Conclusion — the converged model

Management is already unified (one assets/ SSOT, embedded in the binary, one setup/converge/divergence machinery). What differs is deployment target, and each target is pinned by an external contract:

1. **Repo CLAUDE.md stub — the read-side zero-dependency bootstrap anchor.** Claude Code auto-loads per-repo context ONLY from CLAUDE.md (harness contract). One person runs `lore setup --project` once (write-side dependency, amortized by git); every teammate's fresh clone then gets the pointer with nothing installed. Its job is discovery + guiding installation ("corpus lives in .lore/, run lore setup"). Content must stay version-insensitive pointer semantics ONLY — never evolving workflow narrative.

2. **Workflow discipline — should be runtime-injected from the binary, NOT a static file.** The prose describes the binary's behavior (gate semantics, handoff verb, evidence rules) and must version-lock with the binary. The current machine-level FILE is a setup-time snapshot: binary upgraded via npm without re-running `lore setup` → stale prose; SPEC-076 Phase F check-advisory exists largely to patch exactly this drift class. But the session-start hook already spawns the binary (Phase E `lore bootstrap --injection`) — the governance prose can be emitted by the binary itself at runtime (folded into bootstrap output or a dedicated subcommand). Benefits: the static file, its install step, its whole drift class, and the check machinery covering it all disappear; prose is strictly same-version as the binary, always. Cost ~zero: spawn already paid, fail-open pattern already established.

## Rejected alternatives (with reasons)

- **Full workflow prose in repo CLAUDE.md**: M repos × N machines git-tracked copies, converge requires commit+push+pull ceremony, merge conflicts, binary-vs-prose version skew. Version-number-compare detection at session start does NOT rescue this: where detection can run (lore installed) runtime injection can simply supply current prose making the static copy dead weight; where the static copy is the only channel (lore absent) detection cannot run at all; and stale bytes are already natively loaded into context before any hook fires — contradictory guidance in-context.
- **Everything via session-start injection (no repo stub)**: injection is itself installed infrastructure (hook + binary, per consuming machine). A bootstrap instruction cannot live in a channel that only exists after bootstrap succeeds. The stub is the one read-side zero-dep channel and must remain.

## Next step (not yet spec'd)

Draft a spec: retire assets/governance/corpus-workflow.md as an installed file; session-start Phase C obtains governance prose from the binary at runtime; migrate/remove the Phase F check coverage for that file; keep seat-briefing.md handling separate (verify whether same reasoning applies).

## Byproduct already landed (this session)

assets/project/CLAUDE.md.template gained the bootstrap hint (run `lore setup` if machine assets missing; obtain the binary via team install channel if absent — npm scope still placeholder so no concrete install command); assets-manifest regenerated; assets-ssot + setup-project-claudemd suites pass (226 tests).
