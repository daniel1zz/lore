---
id: TASK-714
type: task
role: plan
title: "The Lore-Session trailer is inert whenever core.hooksPath is outside the git dir, which is this repo's own configuration"
status: draft
priority: medium
phase: "remediation"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-129
plan: PLAN-129
---
Machine-checked 2026-08-13: this repo runs 'git config core.hooksPath /Users/apple/Projects/zz/lore/hooks', and real-git-port.ts:386 returns 'skipped-unsafe-hooks-path' whenever the hooks dir is not inside the git dir. The trailer capability therefore does nothing in the repository it was built for, while AC-OWN-4 is attested green.

The AC's oracle exercises real git repos it creates itself, where hooksPath is default and the hook installs. That is why it passes. It never drives the configuration this repo actually ships.

Also in scope: writeClaimSessionMarker is a current-state pointer with no clearing path on release, so after a claim is released every later commit in that worktree keeps carrying the stale session trailer.

Either support a hooksPath outside the git dir, or make the skip loud at the surface that promises the trailer - a capability that silently no-ops is worse than an absent one, because the attestation certifies it.
