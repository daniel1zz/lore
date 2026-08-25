---
id: TASK-839
type: task
role: plan
title: "The mirror --check absorbed the content probe in 90951390 without re-measuring its 13 callers: re-separate the halves or make it incremental"
status: draft
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: [oracle-design, scale, north-star]
parent: PRD-001
links:
  - {id: TASK-837, type: relates-to}
  - {id: KN-531, type: relates-to}
---
MEASURED 2026-08-25 on main @ 3331a98e, while fixing `task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus`. That task removes the redundancy (13 full-corpus `--check` passes down to 5) and the shared-mutable-fixture race. It does NOT remove the O(corpus) property. This task is that residual, filed deliberately rather than folded in, because the fix changes a COMMAND's surface and therefore what an approved spec's oracle drives — a spec-level decision, not a test repair.

## The root cause, established by measurement (not inference)

`bun scripts/export-spec-mirror.ts --check` takes **27.9s cold / 13.8s warm** on this corpus (839 task mirrors + five other types).

The split, MEASURED DIRECTLY by importing the two halves and timing them against a warmed real `App` — not inferred:

| half | ms | share |
|---|---|---|
| `runCheck` (parity: count + slug + `existsSync`) | **302** | 3% |
| `runContentCheck` (`exportDocs({dryRun:true})` per type) | **11,457** | **97%** |

⛔ An earlier revision of this task cited "the corpus read is 0.41s, measured via `lore list --type task --json --include-invalid`" as the evidence for that conclusion. **That citation was OFF-PATH and is retracted**, even though the conclusion it supported is the correct one. `--check` never spawns `lore list`: `main` runs in-process against a real `App`. This is the exact misattribution `knowledge-two-attributions-in-the-corpus-growth-threshold` (approved 2026-08-24) was written to correct — it records that a prior handoff proposed `lore list` field projection to shrink these very runs and that the fix "cannot shrink those runs by one millisecond". Citing a subprocess timing for an in-process path reproduces that error one step removed, which is why the direct split above replaces it.

That cost was not always in `--check`. Commit `90951390` (2026-08-17, "feat(mirror): compare mirror bodies against corpus content in the spec-mirror check") ADDED `runContentCheck` to the SAME `--check` invocation that previously ran `runCheck` (parity only — six corpus lists plus an `existsSync` per file). Verified two ways:

- `git show 90951390^:scripts/export-spec-mirror.ts` — the `if (checkMode)` branch calls `runCheck` alone; no content probe.
- `git diff 90951390^..90951390 -- scripts/tests/spec-mirror-export.test.ts` is EMPTY: the commit that multiplied the cost of `--check` did not touch a single timeout literal in the file that invokes `--check` thirteen times.

⛔ So this is not "the corpus grew". Corpus growth is the amplifier; the step change was one command absorbing a second, far more expensive check while every caller's declared budget stayed where it was. Naming that matters, because the same shape recurs: any commit that widens what a command does must re-measure the budgets of the commands' callers, and nothing enforces that today.

## Why AC-FR-6 and AC-FR-7 pay for a check they never assert on

`spec-falsifiability-reachability-a-feedable-checkpoint-an`:

- AC-FR-6 asserts count-and-slug PARITY against the live corpus.
- AC-FR-7 asserts the check is SEPARATE from the export (does not regenerate what it inspects), by exit code and named slug.

Neither statement mentions body content. Content drift has its OWN oracle with its OWN declared budget: `scripts/tests/spec-mirror-content-drift.test.ts` (AC-BFI-8, six cases at 120_000). So every `--check` pass driven by an AC-FR-6/AC-FR-7 case pays ~27.5s for a comparison that a different, adequately-budgeted AC already owns.

## Scope

The decision to make, with both options stated because neither is obviously right:

1. **Re-separate the two halves at the command surface.** Give the script a parity-only invocation so callers that assert only parity stop paying for the content probe. ⛔ The trap this must answer first: the chain-wired command (`check:spec-mirror`, reached from `bun run test`) is the FULL `--check`. If AC-FR-6/AC-FR-7's oracles then drive a narrower variant, the production command's drift behaviour is no longer what any AC exercises — the exact shape of `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`. Any option-1 design MUST name which AC keeps driving the full command.
2. **Make the check incremental** — compare only the docs whose `updated_at` moved since the last recorded check, keeping ONE full pass as a separately budgeted oracle. This is what the project's North Star actually asks for ("Self-checking must stay cheaper than corpus growth"; "Prefer incremental, local, concurrency-safe checks"). Harder: it needs durable state for "last checked", and that state is another thing that can lie.

Out of scope, deliberately: raising any timeout number (the predecessor task already declared budgets from measured cost — that is done, and it is a ceiling, not a fix).

## Falsifier for whichever option is chosen

⛔ Not "the suite is faster" — wall clock is a machine property. The oracle must be: a full-corpus `--check` and the new narrower/incremental path, run over the SAME seeded drift, both report that drift (same exit code, same named slug). Smallest mutation that turns it red: make the narrow path skip the type the drift was seeded in. A timing assertion alone has no discriminating power and must not be the oracle.
