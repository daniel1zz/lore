---
id: TASK-369
type: task
role: plan
title: "LORE_GATE_BYPASS honored by 'lore gate' subcommands but ignored by the same gate logic embedded in create/set write paths"
status: archived
priority: high
created: 2026-07-28
updated: 2026-08-04
tags: []
parent: PRD-001
---
# Defect — one env var, two opposite semantics depending on invocation path

`LORE_GATE_BYPASS=1` short-circuits every `lore gate <name>` subcommand to exit 0, but the SAME
checkpoint predicates executed inline inside the write paths ignore it and deny regardless.

Measured on `main @ 6788989` by the orchestrator:

| where | reads `LORE_GATE_BYPASS`? | sites |
|---|---|---|
| `packages/lore/src/adapters/cli/commands/gate.ts` | **YES** — 5 short-circuits | lines 347, 402, 436, 479, 524 |
| `packages/lore/src/service/gate-enforcer.ts` | **NO** — mentioned in comments (110, 112, 143, 338) and never read | — |

`GateEnforcer` is what runs inside `CorpusService.create` / `set`, `ReviewService.approve`,
`TaskWorkflowService.claim` — i.e. every CLI, MCP and HTTP write. So the variable is honoured on
the diagnostic surface and ignored on every surface that actually writes.

Field observation (babyai, 2026-07-28, a 428-doc historical backfill into a fresh corpus): with
`LORE_GATE_BYPASS=1` exported, `lore create spec` still failed `MISSING_SKELETON` and
`lore set <spec> --status approved` still failed `NO_ACCEPTANCE_CRITERIA`.

# Mechanism root — an escape hatch documented at the wrong layer

The variable is named, documented and audited (`gate-bypass-audit.ts`, SPEC-080 G4) as a
user-authorized bypass. Team hook protocols and the root CLAUDE.md both treat it as one ("⛔ 未
经用户明示不得 `LORE_GATE_BYPASS=1`" presupposes that setting it WORKS). But its implementation
lives in a single adapter command file, so its scope is "the `lore gate` command", not "the gate".
Nothing in the name, the docs, or the failure message carries that boundary — the user learns it
only by watching a bypass silently not apply.

⛔ Note the asymmetry is currently **silent in the informative direction**: the write path's
denial is a normal gate denial. It does not say "you set `LORE_GATE_BYPASS`; it does not apply
here". A user who set the variable reads the denial as the variable being broken.

# Required decision — TWO candidate mechanisms, pick one and justify it in the JSDoc

⛔ This task's core is a design decision, not a code edit. Do NOT pick by convenience. State the
choice and its reasoning in the module JSDoc of whichever file you change, and in your report.

**Option A — honour it in `GateEnforcer` too (one variable, one meaning).**
`GateEnforcer` consults `LORE_GATE_BYPASS=1` and short-circuits, recording a skip through the
existing `gate-bypass-audit.ts` port exactly as the CLI branch does.
- For: a single semantics; the documented escape hatch works everywhere; the backfill scenario
  that produced this report becomes possible.
- Against: it widens a bypass from a diagnostic command to every write path including MCP and
  HTTP — an env var on a long-lived `lore serve` process would silently disarm gates for every
  remote caller. Consider whether the bypass must be restricted by caller surface (SPEC-024
  already classifies `cli` / `agent` / `mcp` / `http_cookie` / `http_token`).

**Option B — keep write-path enforcement, make the boundary LOUD.**
The inline enforcement stays unconditional (defense-in-depth), but when
`LORE_GATE_BYPASS=1` is set and a write-path gate denies, the denial explicitly states that the
variable does not apply to write paths, names why, and names the supported path.
- For: no widening of a bypass into MCP/HTTP; converts a silent misunderstanding into a loud one.
- Against: the variable keeps two meanings; docs must carry the boundary permanently.

Whichever you choose, the outcome must satisfy: **no caller can set the variable, observe a
denial, and be unable to tell whether the variable applied.**

# Acceptance criteria

- **AC-1** the chosen semantics is asserted by test on BOTH surfaces: `lore gate <name>` and a
  write path (`lore create spec` with a non-compliant skeleton, or `lore set --status approved`
  on a 0-AC spec), each with `LORE_GATE_BYPASS=1` set and unset. Four cases minimum.
- **AC-2** ERROR-path assertion for Option B (or the surface-restriction branch of Option A): the
  denial output names the variable's applicability. Assert on two independent lone tokens, never
  one remembered sentence (contiguous-substring rule).
- **AC-3** the audit trail is preserved: whichever path short-circuits records a skip through
  `gate-bypass-audit.ts`'s existing port (SPEC-080 G4). Assert the recorded row, not just the
  exit code. If Option B is chosen, assert that NO skip row is written for the write path.
- **AC-4** REGRESSION: with `LORE_GATE_BYPASS` UNSET, every existing gate behaviour is byte-for-byte
  unchanged on both surfaces. The existing suites covering this
  (`tests/integration/gate-spec-create.bun.test.ts`, `gate-hooks.bun.test.ts`,
  `adhoc-claim-and-feed.bun.test.ts`) must pass untouched.
- **AC-5** STATE: the per-checkpoint config knob (`workflow.gates.<checkpoint>.enabled: false`)
  and the env var compose predictably; assert the documented precedence explicitly.
- **AC-6** the module JSDoc of the changed file states WHICH option was chosen and WHY, and
  `packages/lore/src/adapters/cli/CLAUDE.md` no longer describes a scope that contradicts it.
- **AC-7** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

⛔ `packages/lore/tests/integration/gate-p2-cross-tier.bun.test.ts` is being modified by a
concurrent task (`task-a-test-s-green-depends-on-an-ambient-claude-code-session`). Do NOT edit
it. If your change would alter its expectations, STOP and report.

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "`lore gate <name>` exits 0 under the variable" is today a proxy for "gates are
bypassed". Concrete input satisfying the proxy while violating the property: the measured
babyai backfill — `lore gate` said yes, `lore create spec` said no. The fix makes proxy and
property coincide (Option A) or makes the gap explicit at the point of denial (Option B).

**Silence.** The failure mode is a silence in the write path's denial: it never mentions the
variable. Both options must remove that silence; Option A by making the variable effective,
Option B by naming it in the refusal.

**Opt-in.** The whole feature IS an opt-in escape hatch, and its blast radius is the decision
above. ⛔ Under no reading may this task make gates weaker by DEFAULT — with the variable unset,
behaviour is unchanged (AC-4 pins this).
