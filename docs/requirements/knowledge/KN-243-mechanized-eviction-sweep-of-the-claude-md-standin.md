---
id: KN-243
type: knowledge
role: knowledge
title: "Mechanized-eviction sweep of the CLAUDE.md standing-lessons layer: 4 evicted with demonstrated mechanisms, 15 kept as measured-unmechanized, 967 bytes freed"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-10
tags: []
parent: PRD-001
links:
  - {id: ADR-024, type: relates-to}
---
The one-time sweep mandated by `adr-a-claude-md-standing-lesson-is-evicted-when-a-deterministic`, executed
2026-08-01 under `task-sweep-the-claude-md-standing-lessons-layer-against-the`.

Every line of the root CLAUDE.md standing-lessons layer was judged against the ADR's single question:
*can an agent violate this lesson and have something other than prose stop it?* Nothing was evicted on
suspicion — each EVICT below names an artifact AND an executed demonstration that it fires.

**Measured result**: root CLAUDE.md went from 24571/24576 bytes (5 remaining) to 23604/24576 (972
remaining), 205 → 204 lines. 967 bytes freed. `lore status --check-claude-md` exit 0 both before and
after; the max_bytes near-ceiling advisory that fired before the sweep no longer fires.

## EVICTED — mechanism named and demonstrated

### 1. False-oracle vectors 1-4 (partial eviction of the compound line)

**Mechanism**: `judgeCompleteness` (`packages/core/src/attestation-completeness.ts:468-500`) fed by
`countExplicitPathArgs` / `parseExecutedUnits`, `resolveVerifyExecutionRoot`
(`packages/core/src/verify-execution-root.ts:163-198`), and `judgeBinaryFreshness`
(`attestation-completeness.ts:511-600`) — all wired into `VerifyRunnerService._runVerification`
(`verify-runner-service.ts:676-727`). A bad verdict downgrades the recorded result `pass` →
`inconclusive`; `lore verify` maps that to exit 3.

**Demonstration** (live `dist/lore` against a throwaway corpus, never the repo corpus):
- under-match: 3 declared path tokens, 1 executed → **exit 3**,
  `{"result":"inconclusive","exit_code":0,"completeness":"under_match","executed_files":1,"declared_paths":3}`.
  Control AC in the SAME run with 1 declared == 1 executed recorded `"result":"pass"` — the guard does
  not misfire.
- execution root: a real `git worktree add` linked worktree, AC command literally `pwd`. The captured
  stdout (not a self-reported field) printed the corpus root when run from the main checkout and the
  worktree path when run from the worktree, with `execution_mode` `corpus_root` vs `worktree`.
- stale binary: planted `dist/lore` dated 2026-01-01 + a source file dated 2026-08-01 → **exit 3**,
  `{"result":"inconclusive","exit_code":0,"binary_freshness":"stale"}`, stderr naming `bun run build`.

**What was KEPT, because it is measured NOT to be mechanized**: vector 5 (a silently-inert CLI flag),
and a NEW sixth face surfaced by this sweep — the SELF-REPORT path. `lore evidence` refuses a missing
oracle file and a `-t` filter that matched nothing, but an UNFILTERED multi-file `--result pass` with
no `--output-tail` was **accepted, exit 0**, with nothing verifying that a run picked up all the
declared files. That residual is precisely the slice only `lore verify`'s real spawn closes, and it is
the path every dispatched implementer actually takes.

### 2. Subagent termination discipline (partial — the "is mechanized" assertion)

**Mechanism**: `assets/hooks/subagent-stop-commit-guard.mjs`, a SubagentStop hook with three checks,
each `block()` → `process.exit(2)`.

**Demonstration**: the real script was fed synthetic stdin payloads against a synthetic worktree —
uncommitted changes → **exit 2**; 0 commits ahead on a clean tree → **exit 2** (fires even when the
message carries `STATUS: DONE` / `Test Files 1` / `exit code 0`); a deferral-signal final message →
**exit 2**. Negative controls: same dirty payload with `cwd` = main checkout → **exit 0**, empty
stderr; same payload with `stop_hook_active: true` → **exit 0** (loop safety).

The block message names itself explicitly, so no POINTER fragment is needed. **KEPT**: the known-gap
clause (a LIVE background child at hook-fire time slips past; do NOT "fix" it) — confirmed prose-only
BY DESIGN, since judging *expected* work is not something a repo-state probe can decide.

### 3. Session-start hooks never do blocking work

**Mechanism**: `packages/lore/tests/unit/hooks/session-start-freshness.test.ts` — a real-subprocess
BOUNDARY oracle asserting the hook exits in <100ms while a REAL detached child later writes the cache,
plus HAPPY/NEGATIVE cases asserting "spawns 0 lore child processes" and exact injected-byte counts.
Companion: `session-bootstrap-injection.test.ts` pins the injected-state contract.

**Demonstration**: 13/13 passed, exit 0, run standalone.

**KEPT**: "static discipline belongs in CLAUDE.md layers, never in a hook" — a placement rule for
authoring new hooks, which nothing enforces.

### 4. Playwright suite serialization (full eviction)

**Mechanism**: `packages/dashboard/playwright.config.ts` `workers: 1` + `fullyParallel: false` (real
config fields, not comments) for within-run serialization; `assertPortFree`
(`packages/dashboard/tests/e2e/global-setup.ts:137-147`) for the cross-run case.

**Demonstration**: bound 127.0.0.1:8787 with a squatter socket, then ran `bunx playwright test`. The
run died in globalSetup — **exit 1**, `e2e globalSetup: port 8787 (lore serve API) is already in use
... Refusing to proceed`, no dev server and no browser spawned. Port released afterwards (verified).
The message is self-explanatory, so no pointer remains.

### 5. `--flag=<value>` equals form for `-`-leading values (clause of the compound shell-hazard line)

**Mechanism**: `packages/lore/src/adapters/cli/strict-flags.ts::findUnknownFlag`, wired once via
`index.ts::wrapDefault` → `wrapCommandStrict`.

**Demonstration** (throwaway corpus): space form
`lore ac add fake-spec fake-id --statement "--by wins" --mode human` → **exit 2**,
`Error: Unknown option: --by wins`. Equals form `--statement="--by wins"` → **exit 3**,
`Error: Document not found: fake-spec` — parsing succeeded and reached business logic. Self-mechanizing:
the refusal names the offending token.

### 6. "A gate demanding a field no surface can author" (example inside the consumer-audit line)

**Mechanism**: SPEC-069 AC-069-12 — a source scan enumerating every plan-level `extra.*` field the
plan-close checkpoint reads, asserting each has an authoring surface under `packages/lore/src/adapters`.

**Demonstration**: the suite ships its OWN liveness controls — `AC-069-12 CONTROL: a synthetic region
reading an unwritable field is FLAGGED`, `... hiding a field behind an UNREGISTERED helper is FLAGGED`,
`... missing sentinels THROW rather than silently scanning nothing`. `-t "AC-069-12"` → 12 passed,
exit 0. **KEPT**: the line's other faces (a writer whose reader was retired, a reader without a writer,
a roster map with renamed types) and the general claim, since AC-069-12 covers only the plan-close
checkpoint, not every gate-read field.

## KEPT — searched, no mechanism found

| Lesson | What was searched, and what was found instead |
|---|---|
| Contiguous-substring assumption | Only ONE historical instance was hardened (`subagent-stop-commit-guard.mjs:228` rewritten from a contiguous phrase to lone-token form). No lint/CI catches a NEW phrase-based matcher. |
| SSOT↔installed asset parity | Real oracles exist for 2-3 NAMED pairs (`pre-push-parity.test.ts` with a non-tautology control; `resume-coverage-compiled.bun.test.ts` AC-RC-8 with a fresh scratch install + liveness control) — but no general per-manifest-entry parity check, and none is wired into pre-push or CI (this repo has no `.github/workflows`). Compounded by `knowledge-an-ssot-to-installed-parity-check-is-unfalsifiable`: most `assets/skills/*` pairs are symlinks on this machine, so naive shasum parity is structurally unfalsifiable. |
| Consumer/end-to-end audits (residual faces) | See EVICT #6 — only the plan-close slice is mechanized. |
| Worktree dispatch: `bun install` FIRST | The instruction exists ONLY inside `pre-dispatch-isolation-gate.mjs`'s DENIAL message (line 84). A correctly-isolated dispatch takes the allow path (line 96), which prints a base diagnostic and never mentions `bun install`. Nothing detects a worktree that skipped it. |
| Worktree dispatch: verify `git log` before merge | No hook intercepts `git merge`; `pre-bash-git-safety-gate.mjs` covers only `git worktree remove --force` / `git branch -D`. |
| Escalation ≠ build | Reasoning discipline, unmechanizable — and it FIRED CORRECTLY during this very session (see below). |
| `spawnSync` maxBuffer | No lint. Live unguarded call sites found: `commands/assess.ts:153`, `commands/setup.ts:346`, `scripts/build.ts:327`. Filed as `task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1`. |
| Never discard stderr on batch corpus writes | No lint; no violation found in production either. |
| `set -e` is INERT in the agent shell | RE-CONFIRMED this session: top-level `set -e; false; echo REACHED` printed REACHED; the same body via `bash -c` / `zsh -c` / `sh -c` correctly aborted. Environmental calibration, nothing to fix. |
| `mode-$0.md` skill pattern | No test enforces mode validation before `Read` in any `assets/skills/*/SKILL.md`. |
| Checklists are a floor, not a ceiling | Reasoning discipline. |
| `lore assess --diff` range derivation | `commands/assess.ts:150-160` shells `git diff <range>` VERBATIM; the range is 100% caller-supplied. The only range-adjacent logic (`computeScopeMismatchWarning`) compares touched FILES to task anchors and is explicitly non-blocking. |
| Main-checkout oracle runs need `LORE_ACTOR` | The OS-fallback advisory is a bare `process.stderr.write` — exit stays 0, the resolved actor is unaffected. Demonstrated: main checkout with all tiers unset → warning + `{"actor":"apple","source":"os-fallback"}`, exit 0. SPEC-104's worktree tier CANNOT help here: `detectWorktreeDerivedActor` fires only when `.git` is a FILE, and a main checkout's `.git` is always a directory (contrast run: worktree got a silent `worktree-derived` actor). |
| Distribution-first fixes | Nothing inspects a diff for a named delivery surface. `scripts/embed-assets-manifest.mjs --check` is a manual command, wired into neither `package.json` scripts nor pre-push nor CI. The governing ADR states its own enforcement is a review question. |
| Spec close-outs write NOTHING to CLAUDE.md | The byte/line ceiling IS mechanized and IS wired into `hooks/pre-push` — demonstrated red in a scratch corpus (30814 bytes → exit 3). But it is CONTENT-BLIND: a realistic simulated per-spec close-out line added under budget → exit 0, "within budget". `checkReferenceExistence` flags only DANGLING backtick paths (real spec mirrors exist, so it is silent), and `detectNarrativeSmells` never affects exit code. `lore governance claude-md` prints the contract and enforces nothing. The practice ban itself is unmechanized. |
| Commit PATH-SCOPED in a shared checkout | Self-declared unmechanized; confirmed — the git-safety gate covers `reset --hard` / `branch -D` / `worktree remove --force`, never a bare `git commit`. |
| Full-suite verdict requires a CLEAN tree | Nothing in `hooks/pre-push`, `package.json` scripts, or `scripts/` inspects tree cleanliness. `scripts/changed-tests.ts` uses `git status --porcelain` for the OPPOSITE purpose — to INCLUDE uncommitted changes in its changed-set. |
| A new gate retroactively invalidates the back-catalog | Planning meta-lesson; no predicate can enforce it. |

## The rule earned its keep during its own sweep

The handoff that scheduled this work carried NS5: *"assert executed-test-count >= 1 after any filtered
AC command at the lore verify layer"* — recommended, and recorded as NOT built. It was already built
TWICE over: `judgeCompleteness`'s `hasCaseFilter` branch at the verify layer, and
`findFilteredPassRefusal` at the evidence layer (ec87d44, 2026-07-31 — landed BEFORE the handoff that
recommended building it was even written). The standing "escalation ≠ build" lesson is exactly what
converted that into a verification pass instead of a duplicate build. A twice-recommended mechanization
is evidence to CHECK, not evidence to BUILD.

## Residual policy note

Of 19 standing lessons, 4 were fully or partly evicted and 15 survive as load-bearing prose. That ratio
is the ADR's own alternative-considered talking back: if the unmechanizable residue keeps growing, the
honest response is a justified ceiling change, not compression. It is NOT there yet — 972 bytes of
headroom now exist where 5 did.
