---
id: TASK-246
type: task
role: plan
title: "Add defaults.editor to CONFIG_DENY_KEYS"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-22
tags: []
parent: PLAN-061
plan: PLAN-061
---
# Add defaults.editor to CONFIG_DENY_KEYS

## Evidence of the gap (already reproduced — do not re-litigate, extend)

1. `packages/core/src/config.ts:369` — `defaults: LoreDefaultsSchema.optional()` inside `LoreConfigSchema`, i.e. `defaults.editor` lives in the PROJECT config, not only the XDG global one.
2. `packages/lore/src/adapters/cli/editor.ts:67-118` — `resolveEditorCommand(defaults)` returns `defaults.editor` ahead of `$EDITOR`, then `openEditor` splits it on whitespace and `spawnSync`s the first token with the temp file as an argument.
3. Measured: `findDeniedConfigKeys({defaults:{editor:"/tmp/evil.sh"}})` returns `[]` — so a cookie-authenticated `PATCH /api/dashboard/config` accepts it today.

Threat: deferred-execution RCE. The write lands silently; the payload runs on the operator's next interactive `lore create` / `lore set` with no flags. Same class as `ai.providers.*.command`, missed by SPEC-062's table.

Honest bounds (state them in the module header, do not overclaim): requires a valid cookie session (localhost dashboard, CSRF-Origin enforced); `shell: true` is NOT used so there is no shell-metacharacter injection — but the executed binary path is fully attacker-chosen; only fires under `process.stdin.isTTY`.

## Change

Add `"defaults.editor"` to `CONFIG_DENY_KEYS` in `packages/core/src/config-editability.ts`, with a header comment entry matching the style of the existing three (name the spawn site `adapters/cli/editor.ts::openEditor` and the deferred-execution property explicitly — it is what makes this one non-obvious).

Consider and DECIDE explicitly, recording the reasoning in the header: `defaults.format` and `defaults.color` are the only other keys under `defaults` and are inert (an enum and a boolean). They must remain WRITABLE. Do not deny the `defaults` subtree wholesale — but note that T4's proper-ancestor rule now means a patch of `{defaults: null}` IS denied, which is correct and should be asserted.

## Required tests

`packages/core/src/config-editability.test.ts`:
- HAPPY: `{defaults:{editor:"/tmp/evil.sh"}}` → exactly `["defaults.editor"]`
- NEGATIVE: `{defaults:{format:"json"}}` and `{defaults:{color:false}}` → exactly 0 denied
- BOUNDARY/ancestor interaction: `{defaults:null}` → denied (proper ancestor of `defaults.editor`); `{defaults:{}}` → denied
- REGRESSION: the existing 4 deny entries and the benign-patch set still behave identically

`packages/lore/tests/unit/service/config-service.test.ts`:
- A `ConfigService.update` call with `{defaults:{editor:"/tmp/evil.sh"}}` is rejected with `VALIDATION_ERROR` naming the key, and the on-disk `config.yaml` is byte-identical before and after (assert bytes/sha256, not just the Result).

## Acceptance

`AC-062-13` on `spec-spec-062-config-write-layer-configservice-http-surface-and`.
Oracle: `bunx vitest run packages/core/src/config-editability.test.ts packages/lore/tests/unit/service/config-service.test.ts` — cross-check the runner reports `Test Files 2 passed`.
