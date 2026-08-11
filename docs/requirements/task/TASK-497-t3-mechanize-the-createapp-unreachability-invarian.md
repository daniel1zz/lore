---
id: TASK-497
type: task
role: plan
title: "T3 mechanize the createApp-unreachability invariant and the untested ordering half"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-094
plan: PLAN-094
---
## Objective

Close the two coverage gaps `lore assess` identified on this plan (78/100, partially_met). The delivered implementation is correct; what is missing is a mechanical guard for the invariant it depends on, and the untested half of an ordering rule the spec pins.

## Gap 1 — the unreachability invariant has no oracle

`TursoStore`'s constructor, when no `injectedClient` is supplied, resolves `@libsql/client` through `createRequire`. The implementation's own comment states this throws `Cannot find module` from a compiled binary; it is safe ONLY because `adapters/cli/loader.ts` strips `config.sync` unconditionally, so no compiled-CLI path reaches `app.ts`'s Turso branch with a sync-enabled config.

That invariant was verified ONCE, by hand, by the orchestrator enumerating every production `createApp` call site (`dashboard.ts`, `init.ts`, `init-corpus.ts`, `mount-registry.ts` all single-arg; `loader.ts:288` passes a telemetry-only config). A hand check is not a guard: the day someone adds a call site that passes a sync-bearing config, the compiled binary throws `Cannot find module` at runtime and no test catches it.

Needed: a deterministic oracle asserting the invariant. Either a source-scanning call-site pin (the precedent is the `writer.remove` boundary pin in `spec-lore-setup-deletes-repo-source-through-dev-symlinks` AC-SL-2, which scans for calls lacking a required argument and pairs that with a control assertion), or a compiled-binary test proving the branch is unreachable. Prefer the scan — it fails at the moment the call site is added, not when someone happens to run the right command.

## Gap 2 — the pinned ordering is only half-tested

AC-LL-4 pins: credential validation FIRST, `TMPDIR` usability probe SECOND, native load only after both. Its fixture supplies a VALID token, so the run cannot distinguish credential-first from probe-first — both orderings produce the same observable outcome under that fixture.

Needed: the reverse case. A corpus with `sync.enabled: true`, credentials MISSING, run under an unusable `TMPDIR`, must report the CREDENTIAL error — not the TMPDIR error. That is the only observation that distinguishes the two orderings, and the spec's ordering clause is unverified without it.

## Constraints

- Declare the new criteria as AC-LL-8 (Gap 1) and AC-LL-9 (Gap 2) on the governing spec via `lore ac add`, with `--command` pointing at the test that implements them. Editing an approved spec resets it to draft — re-run `lore review` then `lore approve`.
- Test names must contain the literal AC id; the AC command selects with `-t`.
- Report matched counts for every filtered run.
- Do NOT weaken any existing AC or test to accommodate the new ones.
