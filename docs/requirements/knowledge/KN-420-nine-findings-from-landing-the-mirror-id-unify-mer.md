---
id: KN-420
type: knowledge
role: knowledge
title: "Nine findings from landing the mirror-id-unify merge: two concurrent sessions poisoning one checkout, a suite mutually exclusive with its own corpus, an ordinal reversion loop the merge armed, an AI judge that read a rename backwards, and an exclusivity probe of mine that lied"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
---
# Nine findings from landing the mirror-id-unify merge: two concurrent sessions poisoning one checkout, a suite mutually exclusive with its own corpus, an ordinal reversion loop the merge armed, an AI judge that read a rename backwards, and an exclusivity probe of mine that lied

## Context

Measured 2026-08-11 while resuming `knowledge-handoff-agent-main-orchestrator-87` and executing its
NS1 (merge `worktree-agent-a9f801dd0f61837b2`, full suite, `lore verify --ac AC-FR-10`, `lore done`,
first `lore assess` of `plan-land-falsifiability-reachability-the-attested-red-runner-a`).

The merge itself was uneventful. Everything below surfaced from trying to produce a *trustworthy*
verdict on the merged tree — six of the nine are defects in the oracles doing the verifying, one is
a defect in the merged code, one is a defect in the tooling's diagnosability, and one is a defect in
the author's own measurement, recorded at equal weight because it would have produced a
confidently-wrong "exclusivity proven" claim.

**Authoritative verdict for the record** (clean tree at named commit `01f056d9`, exclusivity
asserted, every stage's exit code persisted separately rather than `&&`-chained): typecheck 7/7 = 0;
vitest 494 files / 8698 passed / 4 skipped = 0; `bun test` 1873 pass / 0 fail / 177 files /
541.68s = 0; `check:spec-mirror` = 0. `lore verify --ac AC-FR-10` attested pass (exit 0, 19498ms).

## 1. Two concurrent sessions running oracles in one shared checkout mutually poison each other's verdicts

`bun run typecheck` on the freshly merged tree exited **2**. The sole error:

```
packages/dashboard/tests/typecheck-scope-probe-tmp/broken-fact.probe.ts(5,14):
error TS2741: Property 'falsified' is missing in type '{...}' but required in type 'AcCoverageFact'.
```

That file is a **deliberately type-broken fixture** created by
`packages/dashboard/tests/unit/typecheck-scope.test.ts:100` (`PROBE_DIR`), removed again in a
`try/finally`. It is **not** gitignored (`git check-ignore` exit 1).

Ancestry, measured with `ps -Ao pid,ppid,lstart,command`:

| pid | ppid | started | command | owner |
|---|---|---|---|---|
| 39206 | 39174 | 15:32:06 | `bun run test` | **a different Claude Code session's zsh** (`ppid 79682`) |
| 58812 | 38935 | 15:32:42 | `bun run test` | mine (`verify-merged.sh`, started 15:32:01) |

My `git status --porcelain` at 15:32:01 was **empty**; the probe file appeared inside my typecheck
window. The peer's suite, launched 5 seconds after my script, wrote a knowingly-broken `.ts` file
into the tree my `tsc` was reading.

Re-run alone at a clean tree at named commit `01f056d9`: **all 7 typecheck projects exit 0**,
including the one that had "failed" and the one that never ran (see finding 5).

**Root cause.** The repo's own oracles write fixtures into the shared working tree at *fixed,
non-gitignored* paths, and nothing serialises oracle runs per checkout. Two sessions with equal
claim to the same directory is not an exotic configuration — it is the default when a user resumes
one thread while another is still open.

**Mechanization.** (a) Every test fixture path must be BOTH gitignored and unique per run (pid /
`mkdtemp`), or live outside the repo entirely. (b) A checkout-level oracle lock (`flock` on a path
under `.git/`) so a second concurrent full-suite run FAILS LOUD instead of interleaving. ⛔ Prose
telling agents "don't run the suite concurrently" is not a mechanism — neither session can see the
other's intent, only its artifacts, and only by accident.

## 2. The full suite and the repo's own corpus are mutually exclusive whenever the mirror is stale

The authoritative bun-test run failed on exactly one case:

```
(fail) spec-loop-e2e.bun.test.ts: repo corpus pollution guard >
       `git status --short .lore` is empty in the repo root before and after this suite ran
Expected: ""   Received: "M .lore/export-index.json"
```

The polluter is another of the repo's own tests. `scripts/tests/spec-mirror-export.test.ts`'s
AC-FR-10 suite begins **every** case with `runMirrorScript([])` — a real export against the
production corpus — because AC-FR-10's own text mandates it ("asserted against THIS repo's
PRODUCTION corpus (never a seeded fixture)"). Meanwhile
`packages/lore/tests/integration/spec-loop-e2e.bun.test.ts:340` asserts `.lore/` is pristine.

What was actually stale: `KN-418`, **this plan's own handoff doc**, had no mirror file and no
export-index mapping; `KN-417`/`SPEC-134` had changed in the corpus after the last export.

⇒ **Writing any corpus doc — `lore handoff`, `lore assess`, `lore report-issue`, this very retro —
makes the next full-suite run red until a mirror export is committed.** The suite is not idempotent
with respect to the governance workflow it exists to serve, and the failure surfaces as a
pollution accusation, which reads like misconduct rather than staleness.

Resolution used: a deliberate `bun run mirror:export`, verified **byte-identical** (sha256 on all
four paths) to what the test's own export had produced, then committed path-scoped as `01f056d9`.
The idempotency check is the load-bearing step — it is what distinguishes "legitimate catch-up" from
"a test corrupted the tree", and the two are indistinguishable from `git status` alone.

**Mechanization.** The two tests must not both own `.lore/export-index.json`: either AC-FR-10's
oracle asserts against the production corpus by READING it (exporting into a temp copy), or the
pollution guard whitelists the export index and a separate *committed-mirror-freshness* check owns
that dimension. ⛔ Whichever is chosen, one path must have exactly one writer.

## 3. The merge armed a padded↔unpadded reversion loop between two services

Filed separately as a lore issue. Two write paths disagree on the mirror's canonical id form, and
each silently undoes the other:

- `packages/lore/src/service/ordinal-migration-service.ts:743` computes `expectedHumanId` with the
  **unpadded** `formatDocDisplayId`, then at `:758` (non-dry-run) writes it into
  `index.mappings[doc_id].human_id` and saves the index, and at `:754` emits
  `git mv 'docs/requirements/spec/SPEC-021-….md' 'docs/requirements/spec/SPEC-21-….md'`.
- `packages/lore/src/service/export-docs-service.ts:1031` computes `correctHumanId` with the
  **padded** `formatMirrorHumanId` and self-heals the same field back.

Neither detects the other. **This merge aggravated it**: before it, both sides were unpadded and
agreed. The new `formatMirrorHumanId` is otherwise clean — it reformats `formatDocDisplayId`'s own
output rather than re-composing, so the "one legal composition site" invariant holds; the defect is
purely that the *other* writer was never brought along. This is the "capability implemented ≠
production wiring" shape with the roles reversed: the capability was wired, and a pre-existing
consumer was left pointing the other way.

Also still open, unchanged by this merge and pinned by the attested AC-084-4 at
`packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts:205-207`: that test asserts
`old_human_id: "SPEC-3"`, `new_human_id: "SPEC-1"` and an unpadded `suggested_file_path`. So the
unpadded behaviour is not merely present — it is *load-bearing on a green attested oracle*, which is
why fixing it is a spec change, not a patch.

## 4. My own exclusivity trace was a false oracle, corrected in-flight

Having found finding 1, I armed a sampler to prove the authoritative re-run was exclusive:

```
ps -Ao command | grep -cE '[b]un run test$|[t]sc --noEmit|[n]ode \(vitest'
```

It printed `concurrent_oracles=0 → 2 → 5` and I nearly reported the 5 as a peer intrusion. It was
counting **my own vitest workers**. The measurement could not distinguish the thing it existed to
detect from the thing it was measuring.

The discriminator that actually works: count *orchestrators* (`bun run test:vitest`, exactly one per
suite run) and walk each candidate's ppid chain to my own script's pid. Measured: 1 orchestrator,
`38933<-38620` where `38620` is my `authoritative.sh`. ⇒ exclusive.

**Root cause.** A count with no member list, over a set that includes the observer. Same family as
the corpus's existing "a count with no member list" lesson, one turn after reading it.

## 5. `&&`-chained oracle scripts silently skip later stages, and the exit code cannot show it

- `bun run typecheck` is 7 `&&`-chained projects. The finding-1 failure landed on project 6
  (`typecheck:dashboard-tests`), so **`typecheck:dashboard-e2e` never ran at all**.
- `bun run test` is 3 `&&`-chained stages. The finding-2 failure landed on stage 2 (`test:bun`), so
  **`check:spec-mirror` never ran at all**.

Both reported one exit code that reads as "the suite failed" — never as "2 of 10 stages were never
measured". A skipped stage and a passing stage are indistinguishable downstream.

**Mechanization.** Run each stage independently, record a per-stage exit code, and make an
unmeasured stage a distinct, loud outcome from a failed one. The authoritative run in this session
did exactly that (7 typecheck exits + 3 suite-stage exits, each persisted to its own file), which is
the only reason the dashboard-e2e and spec-mirror dimensions have a verdict at all.

## 6. AC-FR-10's RED cases delete and mutate tracked files in the live working tree

Read from source while preparing to attest it: `scripts/tests/spec-mirror-export.test.ts`'s
RED (a) does `unlinkSync` on a real, tracked mirror file and RED (b) rewrites another's frontmatter,
each restoring via `runMirrorScript([])` in a `finally`.

Two consequences. (i) In a shared checkout, that deletion window is capturable by a concurrent
peer's `git status` or `git commit` — finding 1 proves the window is real, not theoretical. (ii) A
hard crash (SIGKILL, OOM) skips the `finally` and leaves the repo damaged, with the damage looking
exactly like a deliberate deletion.

This also confirms the handoff's G19 from source: because every case begins with a real export,
**pre-existing** drift is healed before any assertion, so the invariant cannot be driven red by the
condition it exists to detect. The test's own RED cases construct their red state *after* the
baseline export, so they falsify the detection logic — not the freshness of the tree.

## 7. `lore assess`'s AI judge inverted a rename and filed a MAJOR against a file the same commit deleted

The first-ever assess of this plan returned `partially_met (score: 74/100)` with one `major` against
AC-FR-10:

> The diff renames a mirror to `SPEC-054-054-uat-verdict-as-plan-close-gate.md` while rewriting its
> frontmatter to `id: SPEC-54` … The AC's test passed on the production corpus, so either the file is
> excluded from the scan or the assertion has a hole.

Refuted by two independent measurements:

1. The named file exists neither in the working tree nor at `HEAD`.
2. An independent scan of every `docs/requirements/*/*.md` comparing the filename's leading
   identifier against the frontmatter `id:` found **0 mismatches** repo-wide.

The error mode, from `git log --diff-filter=R`:

```
b791d657  R099  docs/requirements/spec/SPEC-054-054-uat-verdict-as-plan-close-gate.md
              → docs/requirements/spec/SPEC-054-uat-verdict-as-plan-close-gate.md
```

The judge read the **source** side of a rename as the resulting state. The commit it was assessing is
the one that *fixed* that filename; the judge reported the pre-fix name as the post-fix defect —
the finding is exactly backwards. (The file has bounced three times across the padding churn:
`SPEC-054-054-` → `SPEC-54-` at `a4c5f677`, back to `SPEC-054-054-` at `102d3059`, then to the
correct `SPEC-054-` here — which is context for finding 3, not for the judge's claim.)

**Why this matters more than a normal LLM miss.** The root CLAUDE.md records that assess is
"load-bearing, not advisory-in-practice" because it caught 2 of 3 attested-pass-without-wiring gaps.
That is true and this does not overturn it — but a real MAJOR and an inverted-rename MAJOR render
**identically**, both as a scored table row with a plausible mechanism. Nothing in the output
distinguishes them; only re-deriving the claim from the tree does.

**Mechanization.** Every assess finding that names a path MUST be machine-checked against the tree
before it reaches the report — a finding whose named file does not exist at the assessed commit is
dropped (or flagged `unverifiable`) rather than scored. The judge is fed a diff; the checker has the
tree. ⛔ Do not "improve the prompt" — path existence is decidable, so it should never be a judgment.
Contributing cause worth fixing separately: the diff was 5,347,242 chars against an
`ai.assess.max_diff_chars` budget of 80,000, so the judge saw a by-file truncation of a diff that is
98.5% generated mirror files. Assess over a plan that regenerates a mirror should exclude the
generated surface from the diff, not truncate it.

## 8. The defect-reporting channel every error message prescribes is unavailable exactly where lore is developed

The full-suite log printed this remedy six times:

> If, after re-checking your own input, you still judge this a lore reporting gap: run
> `lore report-issue --auto-config` …

In this repo `lore report-issue --list` refuses: `feedback.upstream is not configured`. The prescribed
remedy would self-provision the channel "from this install's own upstream lore corpus" — which here is
the corpus being reported about — and does so by writing `.lore/config.yaml`, a shared file a
concurrent peer session had just edited (`capture_timeout_ms`). Both reasons to refuse are
independent, so I did not run it.

The corpus does contain filed reports of exactly this shape (`TASK-643`…`TASK-646`, `parent: PRD-001`,
a `## Repro` section) — all dated 2026-07-26. So the channel worked once and silently lapsed.

**Consequence.** Every "report this as a lore gap" instruction printed by the binary is, in lore's own
repo, an instruction to run a command that fails — and the natural next step (`--auto-config`) mutates
shared state. The gap-reporting path is the one path that must never be the broken one, because its
failure suppresses the reports about every other failure.

## 9. Two diagnosability defects met in one command

**(a) An error message that points at information it did not print.** The first `lore assess` run
exited 6 with `AI provider "claude-cli" failed … Inspect the raw AI output above (already included in
the message) for clues.` No raw output appeared anywhere in stdout or stderr. A plain retry then
succeeded (exit 0), so the failure was transient — but the message spent its one chance to be useful
asserting the presence of evidence it had withheld. An independent probe (`printf … | claude -p`,
exit 0) is what ruled out the plausible-and-wrong hypothesis that nesting a `claude` call from inside
an agent session is refused.

**(b) The corpus pollution guard watches only `.lore/`.** `spec-loop-e2e.bun.test.ts:341` asserts on
`git status --short .lore`. The authoritative run finished green while leaving
`M docs/requirements/spec/SPEC-134-….md` in the tree — mirror content the suite's own export
regenerated after the peer changed that doc mid-run. So the suite does dirty tracked files outside
`.lore/`, and the guard cannot see it. Finding 2's contradiction is therefore only *half* covered:
the export-index half trips loudly, the mirror-content half is silent.
