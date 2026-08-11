---
id: KN-319
type: knowledge
role: knowledge
title: "Eight findings from building and closing the plan-close-invariants slice: an inert --ac flag, an unwritable decision_status, evidence with no commit provenance, and a dev symlink that swapped the CLI's build"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PRD-001
links:
  - {id: ADR-017, type: informs}
  - {id: KN-326, type: relates-to}
  - {id: SPEC-111, type: relates-to}
  - {id: KN-327, type: relates-to}
  - {id: ADR-018, type: informs}
  - {id: SPEC-113, type: informs}
  - {id: SPEC-115, type: informs}
---
# Eight findings from building and closing the plan-close-invariants slice: two inert/unwritable surfaces, evidence with no commit provenance, a dev symlink that swapped the CLI's build, and three signals that pointed the wrong way

## Context

Measured while implementing `spec-plan-close-predicates-measure-invariants-an-applicability` (8 tasks, 16 script-mode ACs, 6 dispatched implementer agents) and closing both it and the plan the governing ADR was written about, on 2026-07-30. None of the eight is about that feature; all were surfaced by dogfooding it.

Outcome first, because it is the evidence the ADR asked for: both plans are `archived` with `exempt=[]` asserted on each — no `attestation_exempt`, no `prd_sync_exempt`, no `assessment_freshness_exempt` was written at any point. The motivating plan's denial changed from `ATTESTATION_FLOOR_NOT_MET + PRD_OUTLINE_NOT_SYNCED` to a single legitimate `ASSESSMENT_STALE` (SPEC-106, a real 34-second staleness cleared by re-running `lore assess`).

## 1. `lore verify --ac <id>` is silently inert

Documented as "Restrict the run to this declared AC id (repeatable)". Six per-task attestation runs each passed one or more `--ac` values; every run executed all 16 declared ACs. Measured directly: the run restricted to `--ac AC-PCI-10` logged `✔ AC-PCI-1 … ✔ AC-PCI-16`, sixteen lines.

This is the FIFTH false-oracle vector (`knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false`) recurring on a different flag — an oracle passes a flag, the flag never takes effect, and nothing in the exit code or the summary reveals it. `--no-open` was rewritten by citty/mri into `{open:false}`; `--ac` is repeatable, so the likely shape is a single value arriving as a string where an array is expected, silently failing an `Array.isArray`-style guard.

**Irreversible consequence, recorded because it cannot be retracted:** every task in the plan now carries runner-attested entries for all 16 ACs, including ACs it never claimed. The data is real (each command genuinely ran and exited 0), but per-task evidence scope is now overstated, and `verification_evidence` is append-only. Any future scope-fidelity analysis over this plan reads a wider claim than each task actually made.

**Mechanization.** The AC-restriction path needs an oracle that asserts the SIDE EFFECT, not the flag's presence — the same lesson `--no-open` produced: assert the executed-AC set equals the requested set, plus a control run proving the assertion is live. A flag that silently widens scope is strictly worse than one that errors.

## 2. `extra.decision_status` is authored at create and writable by NO CLI surface afterwards

`lore create adr --decision-status <s>` exists. `lore set` has no `--extra` and no `--decision-status`. So through the CLI alone an ADR's `decision_status` is frozen at creation: **a `proposed` ADR can never become `accepted`** — the single most common transition an ADR has. The MCP surface can write it (`lore_set`'s schema carries `extra`), so this slice's T6 had to flip the field through MCP.

Class: the MIRROR of the recorded "a gate demanding a field no surface can author" defect — here a field the CREATE surface authors has no UPDATE surface maintaining it. Both fail silent: nothing errors, the value simply stays wrong, and every "which decisions are accepted" read reports a stale answer forever.

**Mechanization.** A narrow, non-demoting field writer, following the precedent already carved out for `--slug` on `lore set` ("Does not reset an approved doc to draft"): either `lore set --decision-status <s>` or a dedicated `lore adr accept|deprecate|supersede` verb. Wholesale `--extra` on the CLI is the wrong shape — it invites exactly the clobbering `CorpusService.set`'s dropped-field guard exists to catch. Needs an author→read end-to-end oracle: create with one value, update to another, assert the read surface reports the new one.

## 3. Evidence carries no commit provenance, so a pass outlives its truth across a merge

AC-PCI-2 and AC-PCI-3 held `result: pass` evidence recorded by T1 while their own tests were measurably RED (6 failed / 13 passed) on the merged tree at `5fcb07f`. Two anchor-disjoint branches were each green in isolation; their union was not. T8 recorded fresh evidence rather than rewriting history, which is correct — but nothing in the system could have DETECTED the staleness.

**Root cause:** an `EvidenceEntry` records the command, the result, the actor and the time, but not the commit it was measured at. So "this pass was measured on a tree that no longer exists" is not expressible, and no gate can ask it. The assessment judge caught it by reading two tasks' histories against each other — a human-grade inference, not a mechanism.

**Mechanization.** Stamp the resolved HEAD (and dirty-tree flag) on every evidence entry the runner writes, then a plan-close conjunct can ask whether every claimed AC's newest attested entry was measured at an ancestor of the closing commit. That is the same shape as the per-claimed-AC coverage conjunct this slice just landed, one dimension over: coverage asks *whether* an AC was attested, provenance asks *where*.

## 4. The `lore` on PATH is a dev symlink into a checkout another session can re-branch

`/Users/apple/.local/bin/lore` → `/Users/apple/Projects/zz/lore/dist/lore`. A co-resident session switched that checkout to `main`, so every `lore` invocation silently became a build WITHOUT this slice's work. Measured discriminator: the global `lore gate plan-close --explain` exits 1 (unknown subcommand) while the integration worktree's own `dist/lore` exits 0 and prints the contract table.

Consequence: a plan-close attempt was judged by the OLD gate, and its denial text quoted a `min_ratio` default this slice had already removed ("must be >= 0.5 (currently 0.27)"). Reading that denial as evidence about the new predicates would have been completely wrong.

This is the "stale compiled binary" false-oracle vector one layer out: not a stale `dist/lore` relative to source, but **a CLI on PATH that is a different build from the code under test, whose identity depends on which branch another session left the shared checkout on**. The existing "a dev symlink is a shadow, not a pipeline" lesson (`adr-distribution-first-…`) named this shape for assets; it applies to the binary itself.

**Mechanization.** Any oracle that exercises gate/CLI behaviour must invoke the binary built from the tree under test (`<worktree>/dist/lore`), never the PATH name, and should assert the binary's identity first — a subcommand or flag that only the new build knows is a sufficient discriminator and costs one call.

## 5. A background oracle's harness-reported exit code described the wrong command

`bun run test:bun > log 2>&1; echo "BUN_FULL_EXIT=$?" >> log` was launched in the background. The completion notification reported **exit code 0** — the trailing `echo`'s. The log's own line read `BUN_FULL_EXIT=1` (1600 pass / 1 fail). The same trap fired again on `lore verify` (notification 0, real `VERIFY_EXIT=4`).

Trusting either notification would have recorded a red run as green with a plausible audit trail behind it.

**Standing lesson.** A background command's reported status describes the outer shell line, not the oracle inside it. Capture the oracle's exit code INSIDE the command and read it back from the log. Same family as "exit code 不经管道测量" (`cmd | tail` yields `tail`'s status), one layer out.

## 6. `AC-072-9` is a pre-existing concurrency flake, attributed by measured rate on both trees

Full bun suite on a clean tree at `8227dd1`: 1600 pass / 1 fail across 147 files. The failure is `issue-report-cross-corpus.bun.test.ts` → "2 concurrent CLI invocations", failing at `expect(r1.exitCode).toBe(0)` with `Received: 1`.

| tree | runs | failures |
|---|---|---|
| `17c1a44` (before this slice's first commit) | 10 | 1 |
| `8227dd1` (slice fully merged) | 9 | 1 |

Same ~10% rate, so the flake is pre-existing. A plausible-sounding hypothesis — that T1's new best-effort `gate_not_applicable` audit row added write contention — was FALSIFIED by the baseline measurement rather than reasoned away.

Sample-size trap this nearly walked into: an initial 4/4 green on the baseline looked like proof of innocence, but 0 failures in 4 runs is consistent with a rate as high as ~40%. Attribution of a flaky failure needs a measured rate on BOTH trees.

**Root cause is unspecified behaviour, not a missing retry.** Nothing in `report-issue`'s contract says whether two concurrent invocations against one upstream corpus are supported; the test encodes "both exit 0" as if they are. The fix is to DECIDE the contract and enforce it — a documented single-writer boundary that fails loud with an actionable message, or genuine serialization at the store edge — never a bare retry/backoff bolted on to make the assertion pass, which converts a specification gap into invisible latency.

## 7. A pinned AC oracle that uses `grep -q` cannot self-evidence

AC-PCI-15's command is `lore get <adr> | grep -q '^## Revision 2026-07-30'`. `-q` closes the pipe as soon as it matches, so `lore` takes EPIPE and every one of the eight recorded runs captured only `ERROR EPIPE: broken pipe` as its `output_tail`. The pass verdict rests on an exit code with no corroborating output; the affirmative capture had to come from a supplementary `grep -c` run (matches=1).

The AC was NOT rewritten. It already carried evidence, and re-using an evidenced AC id for a different statement converts a visible weakness into an invisible wrong one (`knowledge-gates-and-the-review-judge-validate-a-spec-against` §2).

**Standing lesson for AC authoring.** A script-mode AC's command must leave a POSITIVE artifact in its own output — `grep -c`, `grep -o`, a count assertion — never a silent-success form. "Exit 0 with an empty tail" is indistinguishable from "the oracle measured nothing", which is the whole false-oracle family in one line.

## 8. Design question the slice's own logic raises: `attestationFloor`'s condition 1 forces N verify runs for an N-task plan

Condition 1 (every evidence-bearing task needs ≥1 runner-attested entry) is retained unchanged by this slice, deliberately, as a per-task backstop. But `lore verify` attaches attested evidence to ONE task per run, so an 8-task plan whose implementers recorded self-reported evidence needs 8 verify runs to close — and with `--ac` inert (finding 1) each of those runs re-executes every AC in the plan.

The governing ADR's own argument against the ratio applies here: "attesting the same command ten times proves exactly what attesting it once proves". With per-claimed-AC coverage now in place, the fabrication risk condition 1 exists to catch is addressed at AC granularity; whether the task-granular condition still earns its cost is a real question. NOT changed here — recorded so the next slice evaluates it deliberately rather than inheriting it as settled.

## Standing lesson (cross-cutting)

Five of these eight were near-misses where a plausible signal pointed the wrong way: a notification's exit code, a baseline's green streak, a directory full of reverted-looking files, a `--ac` flag that appeared to scope a run, and a gate denial quoting a default that had already been removed. In every case the correct answer came from measuring the thing itself — the oracle's own exit line, failure rates on both trees, the branch ref, the executed-AC set, the binary's own identity — never from the summary standing in front of it.
