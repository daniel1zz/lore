---
id: SPEC-096
type: spec
role: spec
title: "Distribution & Adoption (phased, spike-gated one-step install) (domain overview)"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## 17. Distribution & Adoption (phased, spike-gated one-step install)

**Vision (owner, 2026-07-16)**: Lore's credibility rests on dogfooding — the tool that enforces best practice must itself be built and shipped by best practice. Adopting the full Lore-governed workflow is today tribal: hand-place a binary, hand-copy assets into `~/.claude/`, hand-merge `settings.json`, hand-register the MCP server. The end state is **one command on top of an existing Claude Code install**; the path there is **phased and spike-gated**, because two load-bearing technical assumptions (5-platform Bun cross-compile; multi-file asset-tree embed in a compiled binary) are as-yet **unverified against this repo's actual build** (`scripts/build.ts` resolves the libsql native addon via the build host's `process.platform`/`process.arch`, not a `--target` cross-compile).

**Positioning resolution (Internal-First vs public npm)**: Lore stays *internal-first by design*; distribution is *opt-in external*. Public npm is **not** the first deliverable — it is gated behind a private/allowlist beta that proves install safety on the owner's + teammates' machines first.

- **P0 — Asset SSOT (prerequisite, not distribution).** Vendor the distributable skills/agents/hooks into an in-repo `assets/` tree, and **author the `<corpus-workflow>` governance snippet as a standalone versioned file**, cleanly extracted from the owner's private global CLAUDE.md (today it is interleaved with unrelated personal rules — it must be authored fresh, not copied). This is the source of truth every later phase ships; done first, independent of any packaging.
- **P1 — Local safe installer (no npm, no cross-compile).** `lore setup` on the current platform only: materializes P0 assets into `~/.claude/`, and **records every written path/entry in an explicit `~/.claude/.lore-setup-manifest.json`** — the manifest is authoritative for uninstall/upgrade diffing, replacing any "sentinel"/ownership-inference guessing. `--dry-run` preview; backup-before-overwrite; `--uninstall` reverses strictly via the manifest; a post-run **receipt** prints what was written (binary found, N skills/agents/hooks, MCP registered ✓). `settings.json` merge touches only manifest-tracked entries; a malformed pre-existing `settings.json` → fail loud, no partial write. `lore setup --project` scaffolds a repo (init + gate hooks + pre-push + `lore.tree.yaml` + `core.hooksPath`). **Sandbox-testable via a `--claude-dir` / HOME override** — tests MUST NOT touch the real `~/.claude` or the repo's own `.lore/` corpus (2026-07-07 pollution-incident precedent). Target OS: **macOS + Linux**.
- **P2 — npm single-platform.** Publish the current-platform package with the P1 installer + a TTY-gated `postinstall` trigger (silent-skip in CI → prints `lore setup`; a loud one-line stderr nudge on non-TTY). Still no cross-compile.
- **P3 — Cross-platform + embed (spike-gated).** ONLY after a green **spike** proving (a) `bun build --compile --target=…` produces working `darwin-arm64`/`darwin-x64`/`linux-x64`/`linux-arm64` binaries with the libsql native-addon embed, and (b) a multi-file asset tree embeds into and re-extracts from a compiled binary. Then: `optionalDependencies` platform-split + node `bin` shim + version-lockstep 6-package release. **win32 is a separate later phase** — the bash hooks (`g1-g4.sh`, `pre-push`) need reimplementation; a documented WSL/git-bash prerequisite holds until then.

**Success metrics (SMART)**: install-to-first-gated-write completion rate ≥ 90% across the documented prereq matrix; `lore setup` failure rate < 2%; **zero user-`settings.json`-corruption incidents** (hard gate); D30 active-corpus retention tracked from P2 onward.

**Kill criterion**: if after two release cycles D30 active-corpus retention is below target OR public-install support load exceeds team capacity → sunset public npm, fold back to internal-only distribution (P1 stays).

**Non-goals**: no redistribution of skills we don't own (`tdd`/`to-prd`/`brainstorming`/other superpowers-plugin skills are declared *external dependencies*, never repackaged); no self-update / auto-upgrade daemon; no silent postinstall wiring of the global config; no "sentinel"-inference of ownership (the manifest is authoritative); AI-provider & sync prerequisites are documented, not bundled; win32 is not first-class scope until its own phase.

**Open technical questions (resolve before the owning specs lock)**: the exact Claude Code global-MCP registration surface (`~/.claude.json` vs `settings.json.mcpServers` vs `.mcp.json`); the P3 Bun cross-compile + multi-file-embed feasibility spike.

## Acceptance Criteria (structured)

- [·] [script] AC-DOV-1: Content parity with source PRD section holds: lore migrate prd-to-outline --dry-run for this section exits 0 reporting already_migrated=true with 0 failed invariants (char-coverage, section-ref set equality, R-id set equality)
  script: e2e — lore migrate prd-to-outline --prd prd-lore-internal-first-ai-team-knowledge-platform --section distribution-adoption-phased-spike-gated-one-step-install --dry-run
