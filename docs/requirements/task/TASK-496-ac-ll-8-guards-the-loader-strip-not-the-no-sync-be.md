---
id: TASK-496
type: task
role: plan
title: "AC-LL-8 guards the loader strip, not the no-sync-bearing-createApp-call-site invariant"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Gap

`AC-LL-8` (added to `spec-eager-libsql-load-makes-every-command-depend-on-a-healthy` by the orchestrator, implemented by T3) asserts that `lore status` survives a sync-enabled corpus under a hostile `TMPDIR`. That guards ONE thing: `adapters/cli/loader.ts` still strips `config.sync`.

It does NOT guard the invariant the fallback's safety actually rests on: **no `createApp` call site anywhere passes a sync-bearing config**. Those are different propositions. Add such a call site — in `dashboard.ts`, `init.ts`, `flows/init-corpus.ts`, `mount/mount-registry.ts`, or anything new — and every one of AC-LL-1 … AC-LL-9 stays green while a compiled binary throws `Cannot find module '@libsql/client'` at runtime, because `turso-store.ts::loadLibsqlClientModuleSync` (`createRequire`) is reachable only from source mode.

Identified by `lore assess` (met, 82/100) on the third assessment pass. The orchestrator had chosen a behavioural assertion over the source scan that T3's own task body recommended ("Prefer the scan — it fails at the moment the call site is added, not when someone happens to run the right command"), reasoning that behaviour is harder to circumvent. That reasoning was wrong here: behaviour and the call-site set are not the same invariant, and only the scan covers the one that matters.

## What to build

Declare `AC-LL-10` on the governing spec (orchestrator does this, not the implementer) and implement a source-scanning call-site pin:

- Enumerate every `createApp(` call site outside `app.ts` itself, and assert each either passes exactly one argument, or passes a config value that provably has `sync` removed (the `loader.ts:160` destructure shape, or an equivalently-named sync-free local).
- Pair it with a **control assertion** proving the scan is live — e.g. assert the scan finds the known-good call sites at all (a scan whose regex silently matches nothing passes vacuously; that exact vector is documented in this repo's CLAUDE.md).
- Verify it cannot be dodged by reformatting: a call spread across multiple lines must still match.

**Precedent to follow**: `spec-lore-setup-deletes-repo-source-through-dev-symlinks` AC-SL-2 — "Every writer.remove call site in setup-service.ts passes the boundary option, asserted by scanning the source for removal calls lacking it, paired with a control assertion that at least ..." — including its later note that the pin was verified against multi-line reformatting.

## Constraints

- Do NOT weaken or replace AC-LL-8. It guards the strip and should keep doing so; this is additive.
- The scan must fail at the moment an offending call site is ADDED, not when someone happens to exercise a particular command.
- If a legitimate future caller genuinely needs a sync-bearing `createApp`, the correct resolution is to make `loadLibsqlClientModuleSync` unnecessary (i.e. finish the async conversion), not to add an exception to the scan.
