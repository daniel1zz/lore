---
id: KN-183
type: knowledge
role: knowledge
title: "Seven of lore's own outputs misled this session — a false plan-close hint over an ungated cascade, a gate shipped without its feeding source, a silent oracle, an empty log from a short-circuited chain, an AC edit that froze all downstream claims three times, an 82% figure off by 20x, and an unanchorable private symbol"
status: approved
priority: medium
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
---
# What happened

Three of lore's own outputs misled this session. Each was caught ONLY by constructing a
control; each would have read as success without one. All three measured 2026-08-07 on `main`
@ `1b90fabe`, two of them inside a throwaway `lore init` corpus so the real corpus was never
written to.

⛔ The common root is not carelessness. It is that **a governance tool's output is a claim, and
this repo's own discipline exempts it from the scepticism it demands everywhere else.** A gate
that passes, a hint that tells you what to run next, and a `--capture` that succeeds are all
treated as settled facts. None of the three is.

# F1 — `lore done`'s plan-close hint is FALSE, and the command it recommends silently cascade-archives non-terminal children

When the last child task archives, `lore done` prints:

> ⚠ "<plan>" has no more non-terminal tasks — every child task is now archived/deprecated. The
> plan itself is still open; the plan-close gate will evaluate it once you run:
> `lore set <plan> --status archived`

Measured, with a discriminating negative control:

| Probe | Result |
|---|---|
| `lore set <plan> --status archived`, all children archived | exit 0, output `Updated <plan> → v4`. No gate output. |
| **CONTROL** — same command on a plan whose child task was still `approved` (non-terminal) | **exit 0**, plan archived, and the open task **cascade-flipped to `archived`** with zero output |
| That cascade-archived task's state | **0 evidence rows**, non-empty `ac_scope: ["AC-PROBE-1"]`, no `red_first` opt-in |
| `lore set <plan> --status active` afterwards | exit 4 — `Allowed transitions from 'archived':` (EMPTY). Terminal, irreversible. |

⛔ The control is what makes this conclusive. Exit 0 with no output is **indistinguishable**
between "the gate ran and passed" and "no gate ran at all" — the first probe alone proves
nothing. Only the non-terminal-child case discriminates, and it shows the gate never evaluates.

The cascaded task reached `archived` in exactly the two states `lore done` REFUSES:
no `attestation` (measured: `lore done` exits 4 with a paragraph explaining
`attestation` ≠ `capture_source`) and no red-first evidence (measured: exits 4 demanding an
`expected-fail` row or `--declare-no-new-tests`). So `lore set --status archived` is a complete
bypass of the `lore done` gate stack — reachable by copy-pasting a command `lore done` itself
prints, into an irreversible transition.

**Mechanism root.** Two write paths reach `archived` and only one is gated. `lore done` owns the
`approved→active→archived` transition and enforces attestation + red-first; `lore set --status`
is a generic field setter that happens to accept `archived` and happens to cascade. The hint
advertises the gated semantics for the ungated path.

**Mechanization fix (not prose).** Either the plan-close gate fires on `lore set --status
archived` for `plan` docs (and refuses when any child is non-terminal), or that verb refuses
`--status archived` on a plan outright and directs to a dedicated `lore plan close`. ⛔ Fixing
only the hint's wording is the wrong layer: the bypass is the defect, the misleading sentence is
its symptom. Until then the hint MUST NOT print a paste-ready write command.

# F2 — a fresh consumer install hits the `spec-create` gate with an EMPTY feeding pack

In a corpus created by `lore init` (plus `lore setup --yes`, run as a control to rule out
install ordering):

```
lore create spec --title "…" --parent <prd> --kind tech
→ Error: gate:spec-create blocked: MISSING_SKELETON
  [source: unknown, trust: team-authored]
  ## Rule            ← EMPTY
lore feed spec-create
→ no approved governing skill for spec
```

CONTROL, same binary, this repo's corpus: `lore feed spec-create` prints the full rule set from
`knowledge-write-spec-rules-gate-feeding-source`.

⛔ And the SHIPPED governance prose (`lore governance corpus-workflow`) instructs the agent to do
the thing that is empty: *"a deny means fix per the feeding pack and retry"*, *"`lore feed
<checkpoint>` pulls the governing rules slice"*. Nothing shipped defines what a "skeleton" is.
`lore init` has no seed flags (`--name`, `--json` only).

**Mechanism root.** The gate ships in the binary; its feeding source ships as a document in
THIS repo's corpus. Distribution-first was satisfied for the enforcement half and skipped for
the guidance half, so a fresh consumer gets a refusal with a machine code and no remedy.

**Mechanization fix.** `lore init` seeds the gate feeding-source docs from `assets/` (SSOT +
manifest, the surface that ships), or the gate falls back to a binary-embedded rule slice when
no corpus feeding source resolves. Probe: fresh `mkdtemp` + `lore init` + trip the gate + assert
the printed `## Rule` is non-empty. ⛔ A one-ended probe vacuously passes here — it must assert
the EMPTY case fails, using this repo's corpus as the live control.

# F3 — an oracle that prints nothing cannot produce evidence, and the gate caught it before I did

While authoring AC-FALS-23 (a live-corpus wiring probe), the first version computed its verdict
and called `sys.exit(1)` without printing. Recording it was refused:

> Validation failed on field 'output_tail': a self-reported result "expected-fail" must carry a
> non-empty output_tail

⛔ `--capture` did not save it: capture records the command's real stdout+stderr, and the
command's real output was the empty string. The fix was to make the oracle PRINT its observation
(`AC-FALS-11=fail AC-FALS-13=fail AC-FALS-3=attested_pass -> FAIL`) before exiting, after which
the same row recorded with `capture_source: runner` and a meaningful tail.

**Transferable rule.** An oracle's exit code is its verdict; its stdout is the only thing that
makes the verdict auditable later. ⛔ A silent oracle is unrecordable BY DESIGN — treat the
refusal as correct and fix the oracle, never reach for `--output-tail` to hand-write a tail the
command never produced. Write every custom oracle to print the values it compared, not just to
exit.

# F4 — a NEW false-oracle vector: an empty log from a short-circuited chain reads as a clean run

This is the fifth recurrence of the exit-code family in two sessions, and the second by the
orchestrator. It is NOT the pipe vector, and none of the four mechanized guards reach it.

```
cd packages/dashboard && bunx tsc -p tsconfig.tests.json --noEmit > out.log 2>&1; echo "EXIT=$?"; wc -l < out.log
→ EXIT=0
→ 0
```

Read as "tsc ran, zero errors". Actual: `cd` is a zoxide shim in this shell and **failed**
(`zoxide: no match found`), `&&` short-circuited, and **tsc never ran**. The log was empty
because nothing wrote to it, and `EXIT=0` was the exit of the surviving statement. The failure
surfaced only because a LATER call happened to print zoxide's stderr, and a third call reported
`Shell cwd was reset` — the first call's own output contained no trace of it.

⛔ Why the usual guards miss it: there is no pipe, `$?` is read directly, and the redirect is
correct. The corruption is that the measured command was never among the commands that ran, and
an empty artifact is the same shape as a clean artifact.

**Transferable rule.** ⛔ Never infer "ran and found nothing" from an EMPTY output artifact. A
run that found nothing must be distinguishable from a run that did not happen — assert a
POSITIVE trace of execution (`--listFilesOnly | wc -l` > 0, a `N passed` summary line, a
`Done` marker), not merely the absence of errors. ⛔ And do not put a directory change in front
of a measurement in this shell: pass the project/path as an argument from the repo root
(`tsc -p packages/dashboard/tsconfig.tests.json`), or use `builtin cd` to bypass the shim.

The false reading here was consequential: it produced "`tsconfig.tests.json` typechecks the tests
cleanly", which is the exact claim the superseded defect task had also recorded — the same wrong
conclusion reached twice, by two agents, from the same silent short-circuit.

# F5 — a routine `lore ac set` silently disarms every downstream claim, and the orchestrator walked into it knowing the rule

A real regression escaped the green suite because AC-FALS-12's oracle is a FROZEN FILE
ENUMERATION and the affected file was not in it — the exact residual the review judge flagged
TWICE and this plan accepted in writing. `packages/lore/tests/unit/service/ac-service.test.ts`
held two stale exact-`toEqual` assertions; the phase-`derivation` implementer found them with a
full cross-runner sweep, correctly refused to edit a file outside its anchors, and reported the
gap.

The orchestrator then widened AC-FALS-12's command to include that file and immediately
dispatched a follow-up task. The dispatch was **BLOCKED**: `lore claim` returned
`UPSTREAM_NOT_APPROVED`, because `lore ac set` had reset the governing spec from `approved` to
`draft`.

⛔ Root CLAUDE.md already carries this rule verbatim — *"dispatch 前确认上游治理文档处于可被 claim
的状态 … ⛔ 逐个 dispatch 前重查，不要凭批次开始时的快照"*. It was not an unknown-unknown. The
orchestrator knew the rule, had ALREADY been bitten by the same reset earlier in the session (the
`plan-promote` gate refused for the same reason after an earlier `ac set`), and still dispatched
without re-reading the spec's status.

**Mechanism root.** `lore ac set` / `lore ac add` are the SSOT-correct place to tighten an oracle,
and tightening one is a routine, encouraged action. But `extra.acceptance_criteria` edits reset an
approved spec to `draft`, and a `draft` ancestor hard-blocks EVERY descendant claim. So the
governance model makes "improve an AC" and "freeze all downstream execution" the same action, with
no warning at the point of the edit. Root CLAUDE.md's own lifecycle summary also says only
*"Editing content/title on an approved doc resets it to draft"* — `extra`-only edits reset too,
which the doc does not say.

**Mechanization fix, not more prose.** `lore ac add`/`ac set` should print, at the point of the
edit, that the spec dropped to `draft` and name the descendant tasks whose claim is now blocked —
the information is one query away and the operator is standing right there. A prose reminder in
CLAUDE.md demonstrably does not hold: it was present, read, and violated in the same session.

The blocked implementer's own conduct is the control that makes this diagnosable: it did not
bypass with `LORE_GATE_BYPASS=1`, did not run `lore approve` itself, produced an empty branch, and
said plainly that BLOCKED is not completed. ⛔ An agent reporting a clean block is the SUCCESS
case — do not read the empty branch as a protocol violation.

# F6 — the 82% figure justifying a report-only decision was off by 20x, and nothing was measuring it

The governing spec's Out-of-scope section grandfathered the back-catalogue with: *"Measured
2026-08-07: 574 of 700 criteria (82.0%) are `pass_unfalsified`. Arming a gate puts the corpus in
violation on the landing commit."* That number was carried into
`packages/lore/src/adapters/cli/CLAUDE.md` and into the session handoff as a load-bearing decision
premise (KD2: report-only *because* 82% would be in violation).

Re-measured across all 138 specs by iterating `lore ac list --json` and tallying
`deriveAcCoverageState`:

| State | Count |
|---|---|
| `attested_pass` | 579 |
| `fail_superseded` | 58 |
| `none` | 39 |
| **`pass_unfalsified`** | **29** |
| `pass` | 15 |
| `fail` | 4 |
| total | 724 |

**29 of 724 = 4.0%, not 82.0%.** The retracted 574 matches today's `attested_pass` (579) almost
exactly, and `attested_pass` is checked BEFORE `pass_unfalsified` in the precedence — so the
original tally was a precedence conflation, counting "pass with falsified === 0" without applying
the ordering. ⛔ It cannot be drift: moving 545 criteria out of `pass_unfalsified` would take 545
`lore verify` attestations, and the interim recorded evidence on 6 tasks.

⛔ **Consequence.** At 4.0% the "corpus in violation on the landing commit" argument is nearly
vacuous — 29 criteria is a clearable backlog. Report-only still stands, but only on the SECOND
reason, which never depended on the count: pressure to clear a red line manufactures synthesized
red runs that M1 cannot distinguish from real ones. Whether to arm it is now an OPEN human
decision, reopened by this correction.

**Mechanism root.** A hand-computed corpus statistic was written into an approved spec, a module
`CLAUDE.md`, and a handoff — three places — with no oracle recomputing it and nothing tying it to
the derivation whose ordering it depended on. It then justified a design decision for a full
session.

**Mechanization fix.** `lore status --json` already exposes `pass_unfalsified_count`; any doc
citing a corpus statistic should cite the FIELD, not a frozen literal (the phase-`derivation`
implementer independently reached this and replaced the `CLAUDE.md` citation with a non-drifting
pointer — that instinct was right). ⛔ Transferable: a literal count inside a governance document
is a claim with no oracle. If a decision rests on one, the decision inherits its rot.

# Unforced side effect, disclosed

`lore setup --yes` was run inside the throwaway corpus to control for F2. ⛔ It is NOT
corpus-local: it wrote the USER's global `~/.claude` (`agents/lore-implementer.md`,
`hooks/session-start-marker.mjs`, and a merged `settings.json` hook entry), 290 assets skipped
as current. Backups at `~/.claude/.lore-backups/2026-08-07T13:09:03.218Z/`. Both diffs were
inspected and are corrective, not destructive — the settings change installs the SessionStart
marker hook whose ABSENCE this session's own resume ticket had flagged, and the agent change adds
one clarifying comment about `lore release` not archiving.

⛔ The lesson is not "check the diff afterwards". It is that a verb named `setup` with a
`--yes` flag, run from inside a scratch directory, reached outside it. Anything installing to
`~/.claude` should say so in its confirmation prompt BEFORE `--yes` can suppress it.

# F7 — an anchor on a non-exported symbol is permanently `symbol_missing`, and the suggested fix hides that

Declaring the governing spec's `code_anchors` at close (they were `null` through the whole first
slice — its own CLOSE-step gap) produced one drift:

```
spec-… → packages/lore/src/adapters/cli/commands/ac.ts#passUnfalsifiedMarker (symbol_missing)
  fix: lore anchor rm spec-… 'packages/…/ac.ts#passUnfalsifiedMarker' (or update the path/export)
```

The row also carried the scanner's standard false-positive disclaimer (`export * from`,
`module.exports`, re-export chains, `export type { X }`, destructured exports). ⛔ Investigated
instead of accepting either the disclaimer or the paste-ready fix: the function EXISTS at
`ac.ts:506`, and is declared `function passUnfalsifiedMarker(...)` with **no `export`**. So it is a
TRUE positive, and none of the disclaimed forms applies.

**Mechanism root.** `#Symbol` anchors resolve against the EXPORTED surface only. A private helper
is therefore unanchorable at symbol granularity — permanently drifting if anchored that way, and
invisible if not. The drift row does not say this; it offers `anchor rm` (which silently drops the
coverage claim) or "update the path/export" (which would mean exporting a helper purely to satisfy
the anchor checker — changing production surface to please a tool).

**Mechanization fix.** The `symbol_missing` row should distinguish "symbol absent" from "symbol
present but not exported" — the scanner already parses the file and can tell — and in the latter
case recommend the FILE-granularity anchor rather than `rm` or an export. ⛔ Until then, treat every
`symbol_missing` on a helper as a question about export status, not an invitation to delete the
anchor.

Resolution taken here: anchored at file granularity via the sibling `#coverageBadge` anchor on the
same file and removed the symbol anchor. `lore status --check-drift` then reported
`consistent (87 specs checked)`, exit 0.

# F1 addendum — the contradiction is a matched PAIR, observed on one plan minutes apart

Both of these fired about the same command, on the same plan:

- `lore done`: *"the plan-close gate **will evaluate** it once you run: `lore set <plan> --status archived`"*
- `lore status --check-tree`: *"The plan-close gate **never evaluated** it. Run: `lore set <plan> --status archived`"*

⛔ `--check-tree`'s past-tense claim is the accurate one; `lore done`'s future-tense promise is
false. Yet BOTH recommend the same paste-ready command, and that command evaluates nothing. Two
surfaces disagreeing about a gate, both routing to the ungated write path, is worse than either
one alone: a reader who notices the disagreement still cannot tell which surface to trust without
building the negative control.

# F5 addendum — the ordering rule was violated a THIRD time in the same session

After `lore assess` prompted a discovery pass, AC-FALS-13's enumeration was widened (`ac set`),
which reset the spec to `draft` again, and `lore approve <plan>` was then attempted before
`lore approve <spec>` — refused with `UPSTREAM_NOT_APPROVED` for the third time in one session, by
the same agent, on a rule it had already written into root `CLAUDE.md` twice.

⛔ Three violations of one documented rule by an agent that knew it, recorded it, and had just been
bitten by it, is not a discipline problem — it is proof the rule is in the wrong layer. Prose read
at session start does not survive to the moment of the edit. The fix has to fire AT the `ac set`
call, which is what F5's mechanization note asks for.

The gate itself performed perfectly all three times: it refused, named the blocker, and named the
recovery. ⛔ Nothing here is a gate failure — it is a failure to make the gate's precondition
visible before the operator trips it.
