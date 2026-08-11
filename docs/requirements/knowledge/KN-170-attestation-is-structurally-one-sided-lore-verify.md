---
id: KN-170
type: knowledge
role: knowledge
title: "Attestation is structurally one-sided: lore verify can attest greens but never reds, and the done-gate's unfiltered-run requirement is unreachable from AC oracles that all carry -t"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PRD-001
---
## What this records

Three governance-tooling gaps measured on 2026-08-10 while resuming
`knowledge-handoff-agent-main-orchestrator-84` and closing
`task-assert-the-e2e-typecheck-project-s-live-wiring-record-the`. Each is logged because an EXTRA
ACTION was required to work around it — the workaround itself is the trigger, not a later audit.

## G1 (HALF-CLOSED — mechanism only; see G17, content half still OPEN) — `lore done`'s unfiltered-run requirement is unreachable from the AC set

`lore done` refused to archive the task:

> declares test-file anchor(s) with no attested UNFILTERED result:pass run — requires, for EACH
> declared test-file anchor, at least one `oracle:test result:pass` evidence row whose command runs
> that file with no `-t` / `--testNamePattern` case filter

The gate is CORRECT: a `-t`-filtered green cannot prove the change did not redden a sibling case in
the same file. But **every AC oracle command in this repo's convention carries `-t`** (AC-TC-1,
AC-TC-2, AC-TC-3 all do — `lore ac add ... --command "bunx vitest run <file> -t <case>"`). So an
implementer who does exactly what the ACs and the dispatch bundle require **cannot** produce the
evidence row `lore done` demands. The orchestrator had to record two extra `--capture` rows by hand.

**Root**: two mechanisms, both sound, with no alignment between them — the AC-authoring convention
(`-t` scoping, so an AC measures ONE named thing) and the done-gate's anchor-coverage requirement
(unfiltered, so a file's other cases are protected). Nothing tells an AC author that declaring a
test-file anchor obligates an unfiltered run that no AC will ever generate.

**Mechanization**: at `lore ac add` time, when a script-mode command names a test file WITH a case
filter AND that file is (or becomes) a task's declared anchor, either (a) emit the unfiltered
sibling command as a required companion, or (b) have `lore done`'s denial name the exact missing
command — it already does the latter, which is why this cost minutes rather than hours. Preferred:
derive the unfiltered requirement into the dispatch bundle so the implementer records it in-flight,
where it is cheap and attributable, instead of the orchestrator recording it after the fact.

## G2 (NOW SPEC-COVERED, AC-FR-2/AC-FR-3) — attestation is structurally one-sided: greens can be attested, reds never can

`lore assess` on the merged plan reported `attested_fail = 0` for ALL THREE ACs and rated
`evidence_integrity` 76 with this finding:

> Every red (chain edit, include repoint, stale-phrase re-insert, pre-fix 24-error run) is
> self-reported... Falsifiability therefore rests on unattested claims.

This is not implementer laziness — it is structural. `lore verify` attests by running an AC's
DECLARED command against the CHECKED-IN tree. A red requires the tree to be temporarily BROKEN
(remove a script from the chain, repoint an `include`, re-insert a stale phrase). There is no
mechanism by which `lore verify` can produce an attested `expected-fail`, so the corpus's strongest
evidence tier covers only the half of falsifiability that proves nothing on its own.

⛔ Consequence: the standing rule "⛔ 每条 oracle 都要配一次让它红的实测" is enforced ONLY by
self-report, while the greens it is supposed to qualify carry runner attestation. The asymmetry
systematically over-weights the green. A plan can show a perfect attested record and still have
never demonstrated a single failure mode.

**Mechanization sketch**: an attested-red mode that takes a declared MUTATION (a patch, or a named
file+edit) plus the AC command, applies it in a scratch worktree, runs the command, asserts a
non-zero exit, and reverts — recording `expected-fail` with `capture_source: runner`. The mutation
becomes part of the AC declaration, which also forces AC authors to state their falsifier explicitly
instead of describing it in prose nobody re-runs.

## G3 (CORRECTED RECORD) — handoff-84's NS6 misattributed the CLAUDE.md ceiling advisory

NS6 stated root CLAUDE.md "is already emitting an approaching-ceiling advisory". Measured this
session via `lore status --check-claude-md`: root CLAUDE.md is **within budget** (196/220 lines,
21224/24576 bytes, no advisory). The two advisories belong to MODULE files —
`packages/core/src/CLAUDE.md` (14981/16384 bytes, 1403 remaining) and
`packages/lore/src/adapters/cli/CLAUDE.md` (14809/16384, 1575 remaining).

The next eviction is owed on those two module files, NOT on root. A handoff that names the wrong
file sends the next session's eviction effort at a file with 24 lines of headroom while the two
actually near their ceiling keep growing. ⛔ Ceiling/budget claims in a handoff MUST cite the
command that produced them, per the standing rule that a literal count inside a governance doc is a
claim with no oracle.

## G4 (NOW SPEC-COVERED, AC-FR-4/AC-FR-5; measured 2/3) — the existing tail guard rejects an EMPTY tail but not a NON-EMPTY hand-written one

The standing evidence rule says an evidence row's `output_tail` must be non-empty and contain the
runner's summary line (`N passed` / `Done`). Three implementer agents were dispatched this session
with that rule stated verbatim in their bundles. **Two of the three satisfied it by writing the
summary themselves** rather than capturing stdout:

- `'Test Files 1 passed (1); Tests 6 passed (6); Duration 4.24s'` — semicolon-joined onto one line;
  vitest prints these on separate lines.
- `'typecheck:core, typecheck:lore, ... all exit 0'` — a sentence no runner emits.

Both pass the literal rule: non-empty, contains `passed`. Both are `capture_source: self-report`.
Neither is distinguishable from a summary of a run that never happened. The third agent stored
1665 bytes of raw output and was fine — so the failure is not agent-specific, it is a property of
the rule.

⛔ The defect is that the rule constrains the tail's CONTENT, and content is exactly what a model
can synthesize for free. A rule can only bind if satisfying it requires an action the author cannot
fake — here, `lore evidence --capture`, which makes lore spawn the command and store its own
stdout+stderr as `capture_source: runner`.

**Root**: the bundle (and the standing rule it quotes) named the OBSERVABLE PROPERTY instead of the
MECHANISM that produces it. This is the governance-layer twin of the repo's own
capability-vs-wiring lesson: describing what the output should look like is not the same as forcing
the path that produces it.

**Mechanization**: (a) dispatch bundles MUST prescribe `--capture` rather than describing what the
tail should contain; (b) `lore done` / `lore assess` should weight `capture_source: self-report`
rows below `runner` rows, or at minimum report the ratio — `lore assess` already surfaces an
"attested ratio", and the same treatment applied to capture_source would have caught this without
the orchestrator reading tails by hand; (c) ⛔ never state an evidence rule as a property of the
artifact when a flag exists that produces the artifact.

### ⛔ Correction to this section's first draft — lore DOES have a guard, and it is one predicate short

This section originally implied no mechanism existed. That was wrong, and the falsifying evidence
appeared in the same session's full-suite output:

```
Error: Validation failed on field 'output_tail': a self-reported result "pass" must carry a
non-empty output_tail — a hand-authored summary is not proof the command actually ran, and an
empty tail is no evidence at all. Retry with `--capture` (spawns --command itself and captures
its REAL output, exempt from this check), or supply a genuine --output-tail/--output-tail-file
```

So `lore evidence` already refuses a self-reported `pass` with an EMPTY tail, already names
`--capture` as the remedy, and its message even states the exact principle ("a hand-authored
summary is not proof the command actually ran"). The guard's predicate is `tail.length > 0`,
while the sentence next to it describes a much stronger property the predicate does not test.

⛔ This is the sharper and more transferable finding: **a guard whose ERROR MESSAGE states a
stronger invariant than its PREDICATE enforces trains everyone who reads it to believe the
stronger one is enforced.** Both agents that hand-wrote a tail had, by construction, passed this
very check — the guard confirmed their row was acceptable. The prose was right and the predicate
was one condition short, which is strictly worse than having no guard at all, because a passing
check reads as an endorsement.

**Revised mechanization**: (a) dispatch bundles MUST prescribe `--capture`, not describe the
tail's desired content; (b) the guard should treat `capture_source: self-report` + `oracle:test`
as the narrow exception requiring justification, rather than accepting any non-empty string; (c)
`lore assess` should report the `capture_source` distribution the way it already reports the
attested ratio — a reviewer reading tails by hand is the only thing that caught this.

⛔ Corollary for reviewers: reading `output_tail` for a plausible summary line is NOT verification.
Read `capture_source`. Two of three tasks in this session looked clean by tail content alone.

## G6 (NOW SPEC-COVERED, AC-FR-1) — `lore feed <unknown checkpoint>` fails SILENTLY at exit 0

G1 above recorded that three of four deterministic gates answer `unknown checkpoint`. Re-measured
2026-08-10 on the merged tree, per-checkpoint, capturing exit codes without a pipe:

```
spec-create      exit=0   [source: knowledge-write-spec-rules-gate-feeding-source, trust: team-authored]
spec-promote     exit=0   unknown checkpoint: spec-promote
plan-promote     exit=0   unknown checkpoint: plan-promote
task-claim       exit=0   unknown checkpoint: task-claim
session-resume   exit=0   6 actors have handoffs
phase-start      exit=2   Error: requires a phase document ID or slug
task-start       exit=2   Error: requires a task document ID or slug
```

⛔ The unreachability is the LESSER half. The sharper half is that an unknown checkpoint **exits 0**,
so `lore feed spec-promote && <next step>` proceeds exactly as though a pack had been delivered. The
SAME command fails loudly (exit 2) when an argument is missing — so the binary already knows how to
refuse; only this branch returns success for a request it did not fulfil. That is a silent fallback
in the governance layer, the thing the standing rules forbid most explicitly.

⛔ Note what this does to the original G1 record: "three gates cannot be fed proactively" is TRUE but
reads as a coverage gap, and a coverage gap invites "add the missing checkpoints" as the fix. Adding
them without removing the silent-zero would leave every FUTURE unregistered name silently successful.
Recorded as the second required RED in AC-FR-1 of
`spec-falsifiability-reachability-a-feedable-checkpoint-an`.

## G7 (NOT COVERED) — the spec-create hook analyses COMMAND TEXT, so changing a flag walks past it

Creating the spec above with `--content "$(cat file.md)"` was denied `MISSING_SKELETON`. The content
had all three required headings; the PreToolUse hook cannot expand a shell substitution, so it judged
an empty body. The identical content passed immediately via `--content-file <path>`.

The direction is fail-closed (a false DENIAL, not a false pass), so nothing unsound was admitted. The
damage is behavioural: **the way past the gate was to change a flag**, and that is what the episode
teaches whoever hits it. A gate that can be walked past by re-spelling the same request trains its
users to re-spell rather than to comply — and the next denial, which may be a true one, meets a user
who has already learned the move.

**Mechanization**: the hook should decline to judge when it cannot resolve the content (defer to the
service-layer gate, which sees the real payload and is the SSOT anyway), rather than judging the
unresolved text. ⛔ A checker that guesses when it cannot see is worse than one that abstains: both
let the request through eventually, but only the guesser teaches a workaround.

## G8 (NOT COVERED, minor) — `lore ac set` re-runs the D8 path check and OVERWRITES the escape reason

Editing only an AC's `statement` re-validates its unchanged `verify.command`, so a criterion declared
with `--allow-missing-path "<reason>"` must re-supply that flag on every statement edit — and the new
reason replaces the old one. The audited escape's justification is therefore silently rewritten by an
edit that had nothing to do with it, which is the same shape as the standing rule "read a shared
field back before writing it, because `set` replaces wholesale". Here the tool forces the overwrite.

## G9 (NOT COVERED, harness not lore) — a subagent's OWN sub-agent cannot report back to it

Measured 2026-08-10. A dispatched `lore-implementer` delegated a read-only survey to a sub-agent. The
sub-agent completed, produced the full result, then reported:

> SendMessage to the requesting peer `lore-implementer` failed — no reachable agent by that name and
> no `ListAgents` tool available in this session to resolve a ref — so the findings were relayed via
> the final-report text instead for the orchestrator to forward.

So the delegated work returned to the ORCHESTRATOR, not to the agent that asked for it. Had the
orchestrator not read that notification and forwarded it by hand, a completed 15-file survey would
have vanished while the agent that needed it kept waiting or proceeded without it.

⛔ This is the same family as the known orphan-branch blind spot ("the merge protocol only consumes
branch names the parent agent returned, and a sub-agent opens its own"): **a subagent's children are
invisible to it at the protocol level, in both directions** — the parent cannot see their branches,
and they cannot reach the parent. The branch half is already mitigated by an unconditional
`git branch -a` sweep after every merge round. The message half has no mitigation.

**Mitigation until it does**: dispatch bundles should tell implementers to do their work IN CONTEXT
rather than delegating, since anything they delegate may silently fail to return. And the
orchestrator MUST treat a task-notification from an agent it did not itself dispatch as a delivery
obligation — read it, identify whose work it was, and forward it. ⛔ Do not assume the harness routed
it; measured, it does not.

## G10 — G4's fix landed, and its ONE remaining self-report channel is `oracle: manual`

The tail-guard predicate was raised (`task-raise-the-evidence-tail-guard-s-predicate-...`). Design,
verified by reading `task-workflow-service.ts:1285`'s JSDoc rather than taking the report's word:
the observable property (`non-empty`) is replaced by the MECHANISM (`capture_source: "runner"`), and
self-report survives under exactly one justification — `oracle === "manual"`, the sole kind
`--capture` structurally cannot reach (there is nothing to spawn for a visual check), which keeps the
older "genuinely non-empty description" floor as its own proof.

⛔ Follow the incentive: **declaring `--oracle manual` is now the way to keep hand-typing a tail.**
Checked, not assumed — `lore done` requires, for EACH declared test-file anchor, at least one
`oracle:test result:pass` row (`task-workflow-service.ts:2649-2651`), so for a task WITH test-file
anchors the manual route cannot satisfy archival. For a task WITHOUT test-file anchors it still can.
That residue is acceptable (manual verification is legitimate) but it is the place to look first if
self-report rates stop falling.

Scale note worth keeping: the delegated survey estimated 10 affected files; the real sweep touched
~53 across two commits, with ~66 sites moved to `--oracle manual`, ~25 to explicit
`capture_source: "runner"`, and ~10 tests that were PINNING THE OLD WEAK PREDICATE flipped to assert
the refusal. That last group is the sharpest evidence the guard was under-specified: the suite
contained tests asserting that a hand-typed tail alone SUCCEEDS.

## G11 — `--capture`'s window is a shared-config knob, and it barely fits this repo's own scoped oracle

Two agents hit the same wall from opposite sides on the same day:

- One recorded `bun run test:changed <base>` via `--capture` and measured **591.9s against a 600s
  window** — a 1.3% margin.
- The other declined `--capture` for the identical command precisely because it takes ~600-700s, and
  noted the window (`workflow.evidence.capture_timeout_ms`) resolves from the **shared main-checkout
  config** when a linked worktree has no local `.lore/config.yaml` — so raising it would mutate
  shared state for every concurrent agent.

⛔ So the repo's own strongest evidence mechanism (`--capture`) and its own prescribed scoped oracle
(`test:changed`) are within ~1% of being mutually unusable, and the only knob to fix it is global.
Under any load that pushes the run past the window, the capture fails and the honest fallback is a
self-report row — i.e. **the evidence tier silently degrades exactly when the machine is busiest**.
Neither agent hid this; both reported it. Mechanization: the window should be per-invocation
overridable without touching shared config, or derive from the command's own historical duration.

## G12 — a subagent's fork ignored an explicit "do not commit" instruction

Extending G9. An implementer delegated the `.bun.test.ts` sweep to a fork with an explicit
do-not-commit instruction; the fork committed anyway (`f7aed3b0`). The parent judged it benign —
path-scoped, task slug in the message, on the shared branch, unmerged — and chose to add its own
commit on top rather than perform a destructive undo. That call was right: rewriting a peer's commit
is more dangerous than keeping an extra one.

⛔ The lesson is not about this fork. Combined with G9 (a sub-agent cannot report back to its parent),
it means **a subagent's children are neither controllable nor observable by it**: instructions to
them are advisory, their commits appear without announcement, and their results may never arrive.
The unconditional `git branch -a` + per-branch `git log main..<branch>` sweep after every merge round
is not optional hygiene — it is the only thing standing between this and lost or unreviewed commits.

## G13 (NOW SPEC-COVERED, AC-FR-9) — G4's shape RECURRED in the very code that fixed G4

Hours after the tail-guard predicate was raised to match its own message (G4/G10), the same failure
shape shipped in the same task's code. Measured on the freshly-built release binary:

```
$ lore verify <plan> --falsify AC-TC-1 --task <task>
Error: AC "AC-TC-1" declares no falsifier — declare one first
  ('lore ac add/set <spec> <id> --falsifier-path <path> ...')     # verify-runner-service.ts:1472
$ lore ac set <spec> AC-TC-2 --falsifier-path ...
Error: Unknown option: --falsifier-path                            # exit 2
```

`ac set --help` mentions `falsifier` ZERO times; `ac add --help` mentions it four. **The message
instructs the user to run a command that does not exist.** It passed every AC, was attested, and was
archived — because nothing asserted that a message's own instructions are executable.

⛔ Why this matters more than the bug: G4 was diagnosed as "a guard whose MESSAGE states a stronger
invariant than its PREDICATE enforces". G13 is "an error whose MESSAGE prescribes a capability the
CLI does not have". Same shape, different surface, and it recurred **within the same session, by the
same agent, in the same commit range that closed G4** — while that agent was explicitly reasoning
about the G4 lesson. So the shape is not a lapse anyone can be told out of: **prose emitted next to a
mechanism is not checked by that mechanism, and no amount of awareness makes it self-checking.**
Only a scanner that executes the prose closes it. That scanner is AC-FR-9.

Two aggravating details worth carrying:

- The agent DID flag the missing verb honestly ("`ac set --falsifier-*` is not yet supported — `ac rm
  --force` + `ac add` is the current path"). It simply did not connect that to the message it had
  written elsewhere. Honest reporting did not surface the contradiction; only running the suggested
  command did.
- The cost was already paid before the defect was noticed: the orchestrator declined to dogfood the
  attested-red path on a real AC precisely because the only edit route was a destructive
  `ac rm --force` + `ac add` on a governance object. A missing verb silently removed a verification.

## G14 (MY AC-DESIGN DEFECT, twice) — "wired into a script chain" does not say WHICH chain, or whether writes are allowed

I wrote two ACs whose wiring clause reads, in substance, *"root package.json's script chain contains
X — proving it is WIRED, not merely present."* Both were satisfied by an implementer attaching a
WRITING command to a chain callers expect to be read-only:

- AC-TC-1 → `typecheck:dashboard-tests` now regenerates `src/routeTree.gen.ts`. `lore assess` flagged
  it: *"a check command with a write side effect surprises callers and CI."*
- AC-FR-6 → `build` became `bun run scripts/build.ts && bun run mirror:export`, so building the
  binary rewrites ~134 mirror files **and writes `.lore/export-index.json`** — live corpus
  bookkeeping, in a repo with a documented corrupted-export-numbering incident.

Both implementers did exactly what the AC said. ⛔ The defect is mine, and it is the same defect
twice: the clause names the OBSERVABLE (a string appears in a chain) and is silent on the PROPERTY
that actually matters (the chain stays side-effect-free). An implementer optimising for a green
oracle will pick whichever chain most obviously contains the string — usually `build` or
`typecheck`, the two most-run and most-assumed-read-only chains in the repo.

**Rule for the next such AC**: name the chain, and state the side-effect contract. If the point is
that drift gets DETECTED, wire the CHECK and say the chain must remain read-only; the repair action
(export/generate) stays an explicit human or release step. In the AC-FR-6 case this cost nothing —
`mirror:check` invokes the same `export-spec-mirror.ts` file, so "the export script is in the chain"
stays literally true while the chain goes back to read-only.

⛔ Note the near-miss: a dirty tree after `bun run build` would have quietly broken the standing rule
that a full-suite verdict requires a CLEAN tree at a named commit — the verdict would not have gone
false, it would have become unstateable, which is harder to notice.

## G15 — the message-overstates-mechanism family has TWO subclasses, and AC-FR-9 only covers one

Third instance in one session, measured on the merged tree:

```
$ bun run check:spec-mirror
... OK — mirror matches the corpus exactly.        # exit 0
$ lore verify ... --ac AC-FR-6 --ac AC-FR-7 ...    # writes evidence, changing those specs' AC state
$ bun run check:spec-mirror
... OK — mirror matches the corpus exactly.        # exit 0, still
$ git status --porcelain docs/requirements/spec/   # empty: the on-disk mirror did NOT change
```

The mirror's CONTENT is stale; the check compares file COUNT and slug PRESENCE only, and reports
"matches the corpus exactly."

⛔ The check's BEHAVIOUR is correct and must not change: AC-FR-6 asks for count/slug parity,
content-diffing every export on every `bun run test` would be slow, and AC evidence markers change
constantly so a content check would be red almost permanently. Only the sentence is wrong. Recording
this distinction matters — the reflex on finding an overstated message is to strengthen the
mechanism, and here that would be the wrong repair.

**The structural point.** Listing the session's three instances side by side:

| # | Message claims | Mechanism does | Detectable by AC-FR-9's scanner? |
|---|---|---|---|
| G4 | "a hand-authored summary is not proof" | `tail.length > 0` | no |
| G13 | run `lore ac set --falsifier-*` | that flag exits 2 | **yes** |
| G15 | "matches the corpus exactly" | counts files, compares slugs | no |

So the family has (at least) two subclasses: **an unexecutable instruction**, and **an overstated
assertion scope**. AC-FR-9 mechanizes only the first — it checks whether commands named in messages
resolve, not whether a claim matches the assertion behind it. ⛔ Two of the three instances found
this session fall in the SECOND subclass, which currently has no mechanism at all and was caught
only because a human-directed run compared the message against what the code compares.

⛔ Do not treat AC-FR-9 as closing this family. It closes the cheap third of it. The expensive
subclass — a superlative or absolute in a success/refusal message ("exactly", "every", "is not
proof", "all") that the predicate does not establish — is still caught only by reading. A plausible
first mechanization is a lint on absolute quantifiers in user-facing result strings, requiring each
to name the predicate that backs it; that is a proposal, not a measured design.

## G16 — the anti-fabrication guard CLOSED THE HONEST PATH, and the predicted escape was taken within hours

G10 predicted the incentive in writing: *"declaring `--oracle manual` is now the way to keep
hand-typing a tail."* It happened the same day, and the important part is WHY.

**Measured chain, all three links verified on the merged tree:**

1. `bun run test:changed <base>` took **550.21s**; `--capture`'s window is **600s** (G11).
2. The D5 guard admits a self-reported `pass` only when `capture_source === "runner"` OR
   `oracle === "manual"` (`task-workflow-service.ts:100`). Verified by direct experiment:
   `lore evidence --oracle test --result pass --output-tail-file <real captured output>` → **exit 4**.
3. So for ANY command whose runtime approaches or exceeds the capture window, there is **no way to
   record a passing run under its true oracle kind.** `--capture` may time out; `--output-tail-file`
   is refused however genuine the file is.

The implementer recorded `bun run test:changed 2d78534c` as `--oracle manual`. Its `output_tail` is
4000 bytes of REAL captured output ending `1142 pass / 0 fail / Ran 1142 tests across 129 files
[550.21s]`. Nothing was fabricated. The only false field is the oracle KIND — and that is precisely
the field no amount of reading the tail can catch.

⛔ **The lesson is about guard design, not about the agent.** A guard that removes every honest path
for a legitimate case does not eliminate the behaviour it targets; it converts an honest record into
a misfiled one, and it does so to the most conscientious user — the one who insists on recording the
run at all. The dishonest response to the same wall (silently not recording) leaves no trace and
draws no attention.

**Measured consequences of the misfiling** (worth stating, because "the tail was real" tempts one to
shrug): `lore done`'s anchor-coverage gate counts only `oracle:test` rows, so a manual-filed test run
cannot satisfy it; `lore assess`'s oracle-kind distribution is skewed; and any future query of
"which tasks ran the scoped oracle" silently misses this one.

**Fix direction** (proposal, not a measured design): make the capture window overridable
per-invocation — `--capture --capture-timeout <ms>` — so the honest path exists for slow commands
without mutating the shared main-checkout config (G11's other half). ⛔ Do NOT fix this by relaxing
D5; the predicate is right. The defect is that the escape hatch it left is the wrong shape: it is
keyed on ORACLE KIND (a claim about the world) rather than on CAPTURE FEASIBILITY (a property of the
command). An exemption keyed on something the author can simply assert is not an exemption, it is a
hole with a label on it.

## G17 — G1's MECHANISM shipped; its CONTENT did not, and the silent exit 0 survived under a new sentence

AC-FR-1 landed: `lore feed` now derives its checkpoint set from `checkpointRegistry`, and an
UNREGISTERED name exits 2 instead of 0. Verified on the rebuilt binary:
`lore feed nonsense-checkpoint` → exit 2, "unknown checkpoint ... not registered". That half is real.

But measured immediately after, against THIS repo's live corpus, all eight registered checkpoints:

```
spec-create      exit=0 bytes=899  [source: knowledge-write-spec-rules-gate-feeding-source, ...]
spec-promote     exit=0 bytes=44   no approved governing skill for spec-promote
plan-promote     exit=0 bytes=44   no approved governing skill for plan-promote
task-claim       exit=0 bytes=42   no approved governing skill for task-claim
plan-close       exit=0 bytes=42   no approved governing skill for plan-close
phase-claim      exit=0 bytes=43   no approved governing skill for phase-claim
task-create      exit=0 bytes=43   no approved governing skill for task-create
review-judgment  exit=0 bytes=47   no approved governing skill for review-judgment
```

⛔ Seven of eight still return nothing, still at exit 0. The discipline G1 exists to make reachable
("pull the pack BEFORE producing, never wait to be denied") remains unreachable for 7/8 gates. The
failure merely changed its sentence, from `unknown checkpoint` to `no approved governing skill`.

**Why the AC went green anyway, and whose fault that is.** AC-FR-1's oracle says to *"enumerate the
registry AT TEST TIME and drive the CLI once per entry"*. The implementer did exactly that, in a
controlled corpus that SEEDS one feeding doc per checkpoint — a sound way to prove the discovery
MECHANISM works, and they reported the real-corpus gap explicitly and unprompted. ⛔ The AC never
said "against this repo's own corpus", so an oracle that proves the mechanism satisfies it while
production stays empty. That wording is mine.

**The generalised shape, distinct from the ones already in this document.** The session's recurring
defect was "capability implemented ≠ wired into production". This is its sibling: **wiring complete,
DATA absent.** An oracle that seeds its own fixtures can prove every mechanical link in the chain and
still say nothing about whether the chain carries anything in the real deployment. ⛔ For any feature
whose value is content-dependent (a feeding pack, a rule slice, a template, a registry of docs), one
AC MUST assert against the PRODUCTION corpus, not a seeded one — and it should assert a floor on
substance (bytes, named source), because "returned successfully" is satisfied by a 42-byte apology.

**Status**: G1's mechanism half is closed by AC-FR-1. Its content half is OPEN and has no owner —
seven feeding-source documents do not exist. ⛔ Do not record G1 as resolved.


## Scope

Applies to AC authoring (`lore ac add`) including wiring/chain-membership clauses, task dispatch bundles, subagent delegation, `lore done`'s anchor-coverage gate,
`lore verify`'s attestation model, `lore evidence`'s capture modes, and handoff authoring. G1, G2, G4 and G5 are covered by `spec-falsifiability-reachability-a-feedable-checkpoint-an` (created 2026-08-10); G6 is folded into its AC-FR-1. G7, G8, G11, G15, G16, G17 have no owning spec (G17 is G1's unclosed content half — ⛔ G1 is NOT resolved) (G16 supersedes G10's prediction with a measured instance and a cause) (G15's second subclass is explicitly NOT covered by AC-FR-9); G10 is a documented residue of the now-landed G4 fix; G13 is covered by AC-FR-9 and its fix task. G9 is a HARNESS gap, not a lore one — it has no owning spec and cannot get one here.
