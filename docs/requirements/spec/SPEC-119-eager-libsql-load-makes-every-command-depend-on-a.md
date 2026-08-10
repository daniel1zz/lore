---
id: SPEC-119
type: spec
role: spec
title: "Eager libsql load makes every command depend on a healthy TMPDIR"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: [store, compiled-binary, native-module, dogfood]
parent: PRD-001
---
## Overview/Goal

Every `lore` command that constructs an `App` eagerly loads the libsql native module, even when the corpus is SQLite-only and `sync` is absent from config. In a compiled binary the embedded `.node` must be unpacked to `$TMPDIR` before `dlopen`; when `TMPDIR` is missing or unwritable the unpack fails, `dlopen` falls back to the bunfs virtual path, and the process dies with a trace that never names `TMPDIR`.

Net effect: a corpus that never uses Turso is fully inoperable in any environment with an unhealthy `TMPDIR`, and the operator has no way to diagnose it. Observed as a Claude Code Stop-hook failure — the hook pipes to `lore handoff coverage-check`, and the hook's spawn environment carries a `TMPDIR` the interactive shell does not.

Goal: (1) a corpus without `sync.enabled` must not require a usable `TMPDIR` in order to operate; (2) when libsql genuinely IS required, an unusable `TMPDIR` must produce an error that names `TMPDIR` and prescribes the fix, never a raw `dlopen` trace.

Goal (1) is phrased against what the oracle can observe. The stronger-sounding "must never load libsql at all" is deliberately NOT the wording, because no stable oracle reads the loaded-module set of a compiled bun binary. Note the two are equivalent for this defect anyway: under an unusable `TMPDIR` any attempt to load the native module necessarily fails, so surviving that environment IS the evidence that the load did not happen on that path.

**Measured root cause** (reproduced from first principles, this repo, binary at `afdaf81`):

| invocation | exit | output |
|---|---|---|
| `./dist/lore status` | 0 | normal corpus status |
| `TMPDIR=/nonexistent-tmpdir-probe ./dist/lore status` | **1** | `ERROR dlopen(/$bunfs/root/index-vrkyg1eb.node, 0x0001): ... (no such file)` |
| `TMPDIR=/System ./dist/lore status` (exists, read-only) | **1** | identical trace |
| `env -i ... ./dist/lore status` (no TMPDIR, system default) | 0 | normal |

Load path: `app.ts:22` statically imports `TursoStore` → `turso-store.ts:21` statically imports `@libsql/client` → the native module is resolved at module-load time, before any store-selection decision runs.

This contradicts the documented D-007 contract ("no config / `sync.enabled !== true` → SQLiteStore"): the selection is conditional, the dependency is not.

## Scope

**In scope**

- `packages/lore/src/app.ts` — the eager `TursoStore` import; `createApp` MUST stay synchronous (two overloads, 20 external call sites) unless the implementer demonstrates the async conversion is complete and typecheck-clean.
- `packages/lore/src/store/turso-store.ts` — the module-level `@libsql/client` import; defer it so importing this module does not resolve the native binding.
- A diagnostic layer at the point libsql is actually needed: probe `TMPDIR` usability and fail loud naming it, rather than surfacing `dlopen`.
- `packages/lore/src/adapters/cli/commands/sync.ts` and `packages/lore/src/adapters/http/sync-push.ts` — the other two static `@libsql/client` import sites; both are lazily reachable today (lazy subcommand import / http adapter only), but must be audited so neither reintroduces the eager path.

**Out of scope**

- Changing which store a config selects (D-007 semantics are unchanged).
- Making `TMPDIR` self-healing by silently rewriting it — prohibited as a silent fallback; the operator must be told.
- The upstream bun behaviour (unpack-then-dlopen) itself.

## Acceptance Criteria

**Error-code correction (made after T1's RED run measured it).** Missing sync credentials surface as `VALIDATION_ERROR`, NOT `STORE_ERROR`: `resolveSyncCredentials` (`packages/core/src/config.ts`, three return sites) yields `VALIDATION_ERROR` and `app.ts` propagates it verbatim. This spec's first draft pinned `STORE_ERROR` because CLAUDE.md's D-007 summary conflated credential failure with store-construction failure — that summary has now been corrected in place. `STORE_ERROR` remains correct for TursoStore *construction* failure. The mapping itself is pre-existing and already asserted by `tests/e2e/sync-cli.bun.test.ts`; changing it is explicitly out of scope, so AC-LL-5 and AC-LL-7(c) pin the actual code rather than the aspirational one. Eight rounds of `lore review` did not catch this — only running the oracle did, which is the whole argument for RED-before-GREEN.

Deterministic oracles only. AC-LL-1 is the RED→GREEN pin: it fails on the current binary and passes after the fix.

**Runner split is mandatory, not stylistic.** The AC set spans two files because the two observation channels are not reachable from one runner:

| ACs | file | runner | why |
|---|---|---|---|
| AC-LL-1 … AC-LL-4 | `packages/lore/tests/e2e/libsql-lazy-load.test.ts` | vitest | spawns the compiled binary as a subprocess with a doctored `TMPDIR`; touches no `bun:sqlite` itself |
| AC-LL-5, AC-LL-7 | `packages/lore/tests/integration/libsql-store-selection.bun.test.ts` | `bun test` | calls `createApp` in-process to read store identity — `bun:sqlite` is a vitest SSR external, so this is unreachable under vitest |
| AC-LL-6 | — | `bun run typecheck` | whole-repo tsc |

Putting the in-process assertions in the vitest file would fail to resolve `bun:sqlite`; putting the subprocess assertions in the `.bun.test.ts` file would hide them from `vitest --changed` selection. Do not merge the two.

- **AC-LL-1** — SQLite-only corpus, unusable `TMPDIR`: `TMPDIR=/nonexistent-tmpdir-probe lore status` exits 0 AND its stdout contains the literal substring `Total documents`. Currently exits 1 with a `dlopen` trace. Both conditions are required: exit 0 alone would also be produced by a command that silently does nothing.
- **AC-LL-2** — the same command's **combined stdout+stderr** contains neither the substring `dlopen` nor the substring `$bunfs`, asserted as two independent negative conditions. The channel is combined (not stderr-only) deliberately: a `dlopen` trace emitted on stdout must also fail. The forbidden literal is the narrow `$bunfs` (the virtual-path form), not a bare `bunfs`, so prose that merely explains the mechanism cannot trip it.
- **AC-LL-3** — **no-regression control** (NOT probe-liveness evidence): with a NORMAL writable `TMPDIR`, the same command exits 0 AND its stdout contains the literal substring `Total documents`. This run passes both before and after the fix and exercises no `TMPDIR` probe at all — its job is solely to exclude "AC-LL-1 was satisfied by breaking the command outright". Probe liveness is established by AC-LL-4, which is the AC that actually drives the probe. The substring is required because a control accepting empty stdout would itself be satisfiable by a command that does nothing.
- **AC-LL-4** — **invocation is `lore sync push`**, not `lore status`. `adapters/cli/loader.ts::loadLoreApp` strips `config.sync` unconditionally (`loader.ts:160`), so NO command routed through it can ever reach the credential-resolution/TursoStore branch — regardless of what T2 changes. `lore sync` is exempt from `loadLoreApp` by design (`loader.ts:13`) and reads `sync` unstripped, calling `resolveSyncCredentials` before touching `@libsql/client`, which is exactly the ordering this AC pins. (Discovered by T1's RED run; the earlier wording named no command and would have been unsatisfiable.) Sync-enabled corpus + unusable `TMPDIR`. **Fixture is fully specified**, because a credential-less sync config errors out per AC-LL-7(c) *before* libsql is ever needed and would never reach the probe: `sync.enabled: true`, `remote_url` present, and `LORE_SYNC_TOKEN` set to the literal `probe-token-not-a-real-credential` (no reachable network required — the run must fail at `TMPDIR`, earlier than any connection attempt). The literal is given rather than "a well-formed value" so the fixture is reproducible without guessing what the validator accepts; if credential validation is ever strengthened beyond a non-empty check, this AC's fixture must be updated to the minimum value that validator accepts, and that is a spec change, not an implementer's judgment call. **Ordering this pins on the implementation**: credential validation runs FIRST (so a missing-credential corpus still reports the credential error, not a TMPDIR error), the `TMPDIR` usability probe runs SECOND, and the native load only after both. Given that fixture, the run **exits 1** (the `STORE_ERROR` mapping in the CLI exit-code contract) AND its stderr contains all four of (a) the literal token `TMPDIR`, (b) the literal fixture value `/nonexistent-tmpdir-probe`, (c) a remediation line containing the literal substring `export TMPDIR=`, and (d) a FIRST line containing the token `TMPDIR`. The exit code is pinned explicitly because the four substring rules alone are satisfiable by a run that prints the right diagnostic and still exits 0. "Prescribed fix" is mechanically pinned to (c); (d) replaces the earlier unmeasurable "not a raw dlopen trace as the SOLE diagnostic" clause — "sole" is a relational judgment, whereas first-line position is a concrete substring rule and is what actually matters (the actionable diagnostic must lead, not sit buried under a native-loader trace). A `dlopen` mention later in the output is permitted: when libsql genuinely is required, the underlying loader error is legitimate context.
- **AC-LL-5** — no silent store downgrade, asserted in-process on the `createApp` return value: an `err(VALIDATION_ERROR)` Result, and never an `App` whose `store` is a `SQLiteStore` instance. Integration-level by necessity — store identity is not observable from outside the process.

  **Induction mechanism is deterministic and explicitly NOT the TMPDIR trick.** The TMPDIR route drives AC-LL-1/AC-LL-4 only because a *compiled* binary must unpack the `.node` out of `$bunfs`; under `bun test` `@libsql/client` resolves from `node_modules` and an unusable `TMPDIR` need not fail the load at all. This AC therefore induces failure through the one state that is unambiguously reachable in-process: `sync.enabled: true` with `LORE_SYNC_TOKEN` absent from the environment — which must yield `err(VALIDATION_ERROR)` with no `SQLiteStore`-backed `App`. A "malformed `remote_url`" variant was considered and deliberately dropped: which malformations the parser rejects is implementation-dependent, so two implementers could pick strings landing on opposite sides of the error boundary. The absent-token state needs no such judgment and is independently sufficient.

  The remaining path — failure *of the native load itself* — is covered at the CLI layer by AC-LL-4 instead, where the process exits loud and there is no downgrade window at all. Relationship to AC-LL-7(c): that AC pins the Result *shape* for the credential-less case as part of the D-007 semantics inventory; this AC pins the *anti-downgrade invariant* (no `SQLiteStore` instance is produced) across both induced states. Overlapping fixture, different assertion.
- **AC-LL-6** — `bun run typecheck` exits 0. Scope of this AC is exactly that: a green whole-repo tsc. It deliberately does NOT claim to prove the chosen import strategy is "complete rather than partial" — tsc cannot distinguish a full async conversion of all 20 `createApp` call sites from a lazy-require approach that never needed one, and a partial migration hidden behind `any` or a type assertion would still typecheck. Strategy completeness is covered behaviourally by AC-LL-1 (the lazy path works) and AC-LL-5/AC-LL-7 (the eager path's semantics are preserved), not by this oracle.
- **AC-LL-7** — under a healthy `TMPDIR` the documented D-007 store selection is unchanged across all three enumerated cases: (a) `sync` key absent → SQLiteStore; (b) `sync.enabled: false` → SQLiteStore; (c) `sync.enabled: true` with missing credentials → `err(VALIDATION_ERROR)`, never a store instance. **Observation channel** (same as AC-LL-5): in-process assertions on the `createApp` return value — the `store` property's constructor identity for (a)/(b), the Result shape for (c). Integration-level, not CLI.


## Acceptance Criteria (structured)

- [✔] [script] AC-LL-6: bun run typecheck exits 0 across the whole repo; this AC claims nothing beyond that, since tsc cannot distinguish a complete async conversion from a lazy require that never needed one, nor catch a partial migration hidden behind any or a type assertion
  script: tsc — bun run typecheck
- [✔] [script] AC-LL-3: No-regression control, not probe-liveness evidence: with a normal writable TMPDIR the same command exits 0 AND emits the literal substring Total documents on stdout. This run passes before and after the fix and drives no probe; its only job is to exclude the possibility that AC-LL-1 was satisfied by breaking the command outright. Probe liveness is established by AC-LL-4
  script: test — bunx vitest run packages/lore/tests/e2e/libsql-lazy-load.test.ts -t "AC-LL-3"
- [✔] [script] AC-LL-1: A SQLite-only corpus with no sync key in config runs lore status under TMPDIR set to the literal /nonexistent-tmpdir-probe and BOTH exits 0 AND emits the literal substring Total documents on stdout; exit 0 alone is insufficient because a command that silently does nothing would also produce it
  script: test — bunx vitest run packages/lore/tests/e2e/libsql-lazy-load.test.ts -t "AC-LL-1"
- [✔] [script] AC-LL-2: That same run's combined stdout plus stderr contains neither the substring dlopen nor the narrow substring dollar-sign bunfs, asserted as two independent negative conditions. Channel is combined rather than stderr-only so a dlopen trace emitted on stdout also fails; the forbidden literal is the virtual-path form with the dollar sign, not a bare bunfs, so prose explaining the mechanism cannot trip it
  script: test — bunx vitest run packages/lore/tests/e2e/libsql-lazy-load.test.ts -t "AC-LL-2"
- [✔] [script] AC-LL-4: Invocation is lore sync push, not lore status: loadLoreApp strips config.sync unconditionally so no command routed through it can reach the credential-resolution or TursoStore branch, while lore sync is exempt by design and calls resolveSyncCredentials before touching libsql. Fixture by literals: sync.enabled true, remote_url present, LORE_SYNC_TOKEN set to probe-token-not-a-real-credential, TMPDIR set to /nonexistent-tmpdir-probe, no reachable network. The run exits non-zero AND its stderr contains the literal token TMPDIR, the literal value /nonexistent-tmpdir-probe, a remediation line with the literal substring export TMPDIR= , and a first line containing TMPDIR
  script: test — bunx vitest run packages/lore/tests/e2e/libsql-lazy-load.test.ts -t "AC-LL-4"
- [✘] [script] AC-LL-5: Anti-downgrade invariant in-process on the createApp return value: err(VALIDATION_ERROR) and never an App whose store is a SQLiteStore instance. VALIDATION_ERROR rather than STORE_ERROR because resolveSyncCredentials returns it and app.ts propagates verbatim, as measured by T1's RED run; that mapping is pre-existing and out of scope. Induced by the one in-process reachable state, sync.enabled true with LORE_SYNC_TOKEN absent. Native-load failure itself is covered at the CLI layer by AC-LL-4
  script: test — cd packages/lore && bun test tests/integration/libsql-store-selection.bun.test.ts -t "AC-LL-5"
- [✘] [script] AC-LL-7: Under a healthy TMPDIR the D-007 store selection is unchanged across three cases asserted in-process on the createApp return value: sync key absent yields a SQLiteStore-backed App, sync.enabled false yields a SQLiteStore-backed App, and sync.enabled true with missing credentials yields err(VALIDATION_ERROR) and never a store instance; store identity read from the store property constructor, Result shape for the third
  script: test — cd packages/lore && bun test tests/integration/libsql-store-selection.bun.test.ts -t "AC-LL-7"
- [✔] [script] AC-LL-8: Unreachability guard for the source-mode-only synchronous fallback: a corpus with sync.enabled true, run under TMPDIR set to /nonexistent-tmpdir-probe via a command routed through loadLoreApp (lore status), exits 0 and emits Total documents. This holds only because loader.ts strips config.sync unconditionally so the compiled binary never reaches app.ts's Turso branch and its createRequire fallback, which is known to throw Cannot find module from a compiled binary. If that strip is ever removed, this AC goes red at once — replacing the orchestrator's one-time hand audit of every createApp call site with a standing oracle
  script: test — bunx vitest run packages/lore/tests/e2e/libsql-lazy-load.test.ts -t "AC-LL-8"
- [✔] [script] AC-LL-9: The pinned ordering's untested half: a corpus with sync.enabled true and credentials MISSING, run under TMPDIR set to /nonexistent-tmpdir-probe via lore sync push, reports the CREDENTIAL failure and not the TMPDIR failure. Concretely, stderr names the missing credential and its first line does not contain TMPDIR. This is the only observation that distinguishes credential-validation-first from probe-first, since AC-LL-4's fixture supplies a valid token and both orderings are indistinguishable under it
  script: test — bunx vitest run packages/lore/tests/e2e/libsql-lazy-load.test.ts -t "AC-LL-9"
- [·] [script] AC-LL-10: Source-scan call-site pin for the invariant AC-LL-8 does NOT cover: no createApp call site passes a sync-bearing config. AC-LL-8 proves lore status survives a hostile TMPDIR, which holds only because loader.ts strips config.sync; it says nothing about a NEW call site elsewhere, which would make turso-store.ts loadLibsqlClientModuleSync (createRequire, source-mode only) throw Cannot find module from the compiled binary while AC-LL-1..AC-LL-9 stay green. Scan every .ts under packages/lore/src except app.ts (which DEFINES createApp) and test files, for every createApp( invocation, matched ACROSS line breaks so a reformatted multi-line call is still found. scripts/ is out of scope: it runs in source mode where createRequire resolves. Every match must fall in exactly one class: (a) exactly one argument (the createApp(dbPath) overload, which cannot reach the Turso branch); or (b) two arguments whose second is literal undefined, or a bare identifier the same file binds from a rest-destructure discarding sync (the loader.ts:241 shape const { sync: _sync, ...configWithoutSync } = rawConfig). A match in neither class fails, naming file+line. Mandatory liveness control, three conditions so it cannot pass vacuously: (1) the scan finds at least 4 call sites (5 today: loader.ts:288, init.ts:93, dashboard.ts:151, flows/init-corpus.ts:143, mount/mount-registry.ts:144); (2) at least one match classifies as (b), so loader.ts:288 telemetryOnlyConfig reads as provably sync-stripped, not merely as lacking a second argument; (3) the SAME classifier applied to a synthetic in-test fixture holding a multi-line createApp call with a sync-bearing second argument reports it a violation. (3) separates a live scan from a regex matching nothing and proves reformat-resistance plus branch reachability; without it, zero-violations and nothing-scanned are indistinguishable (the no-match-equals-pass vector in this repo CLAUDE.md). Additive: AC-LL-8 keeps guarding the strip and both must stay green.
  script: test — bunx vitest run packages/lore/tests/e2e/libsql-lazy-load.test.ts -t "AC-LL-10"
