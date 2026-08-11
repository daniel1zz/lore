---
id: TASK-364
type: task
role: plan
title: "An invalidated doc is indistinguishable from a live one in lore list (both surfaces) and every --json payload, and --include-invalid is silently inert"
status: archived
priority: high
created: 2026-08-04
updated: 2026-08-06
tags: []
parent: PRD-001
links:
  - {id: TASK-366, type: relates-to}
---
# Defect — a RETRACTED doc is indistinguishable from a live one in `lore list` (both surfaces) and in every `--json` payload

SPEC-043 D3, this repo's root CLAUDE.md, and `lore list --help` all state the same contract:

> `--include-invalid`  Include invalidated knowledge/adr/task docs (**excluded by default**).

Measured on `main @ d8a3e53` against `task-lore-evidence-ac-accepts-an-ac-ref-on-an-ad-hoc-task-that`
(id `01KYYB5HZS47KXEHA3K3DSCH1J`), invalidated 2026-08-01 and carrying an explicit
`⛔ RETRACTED — DO NOT IMPLEMENT` body. Presence determined by **ID-prefix match on column 1**, not
by title (the title column truncates at ~34 chars — two earlier title-based probes gave false
"absent" readings and had to be discarded):

| probe | expected per contract | measured |
|---|---|---|
| `lore list --type task` (human), row for that id | absent | **present, 1 row** |
| that row's rendered status | — | `draft`, **no invalidation badge** |
| `lore list --type task --include-invalid` (human) | present + badged | present, **still no badge** |
| human data rows, default vs `--include-invalid` | different | **604 vs 604** |
| `lore list --type task --json` docs, default vs `--include-invalid` | different | **604 vs 604, slug sets identical (0 symmetric difference)** |
| validity-bearing key on any `--json` record | some | **NONE** — keys are exactly `content, created_at, created_by, deleted_at, extra, id, ordinal, parent_id, priority, role, slug, status, tags, title, type, updated_at, version` |
| `lore get <slug>` (human) | banner | **banner shown correctly** ✅ |
| `lore get <slug> --json` | some validity field | **NONE** |

So: the direct-address HUMAN read is the ONLY surface where invalidation is observable. Every
list read and every machine-readable payload presents a retracted doc as a live one.

## Measured cost, same session

The orchestrator enumerated open tasks via `lore list --type task --json`, counted 31 open, and
wrote a handoff sequencing this very retracted task into the next wave's serial chain. Nothing in
the payload could have prevented it: there is no field to filter on. The error was caught only
because a human-readable `lore get` was run for an unrelated reason and the `RETRACTED` heading
happened to be visible.

⛔ Note the flag is not merely ineffective — it is **silently inert**: `--include-invalid` changes
neither surface's output in any way, while `--help` documents it as the switch that restores
excluded docs. That is this repo's named fifth false-oracle vector (a flag whose side effect is
never asserted), reproduced on a shipping command.

# Mechanism root — validity is a rendering concern instead of a data-model concern

Invalidation is applied at ONE render site (the human `get` banner) rather than being (a) a filter
predicate the list query applies and (b) a field every payload carries. Consequences follow
mechanically:

- a filter that exists in prose and in `--help` but in no query path cannot exclude anything;
- a consumer that cannot SEE the property cannot honour it, however disciplined — the `--json`
  record has no field to check, so "just filter it out" is not advice a caller can follow;
- the human `get` banner creates false confidence that the corpus is invalidation-aware.

This is the same family as `task-lore-get-s-default-render-silently-omits-structured-extra`: the
human projection and the machine projection disagree, and neither announces the disagreement.
⛔ They are NOT duplicates — that task is about `extra` being dropped from a render; this one is
about validity being absent from the DATA. Fixing either does not fix the other. Link them.

# Required fix

1. **Data first**: every `--json` doc payload (`list`, `get`, and any other command emitting doc
   records) carries validity explicitly — invalidated-or-not, and when invalidated, the
   `superseded_by` + reason already stored. A consumer must be able to decide without a second call.
2. **Then the filter**: `lore list`/`search` actually EXCLUDE invalidated docs by default and
   actually INCLUDE them under `--include-invalid`, on BOTH the human and `--json` surfaces.
3. **Then the badge**: an included-because-`--include-invalid` row is visibly badged in the human
   view, so presence never reads as validity.
4. **SWEEP — the sweep result IS part of this task's scope**: this was measured on `type: task`.
   Determine for `knowledge` and `adr` (the other two types the help text names) whether the same
   three failures occur, and check every other command that emits doc records or counts
   (`tree`, `pending`, `ready`, `feed`, `export`, `status`). Report the full per-surface matrix.
   ⛔ Do NOT assume `task` is the only affected type — an assumption of exactly this shape is what
   turned nine plan-member sites into thirteen in this repo.

⛔ Do NOT "fix" this by documenting that callers should call `lore get` per doc to check validity:
604 extra calls to enumerate one list is not a mechanism, and the prose layer is already where this
contract failed.

# Acceptance criteria

- **AC-1** DATA: a `--json` record for an invalidated doc carries an explicit validity indicator
  and its `superseded_by`; a valid doc's record is unambiguously distinguishable. Assert on the
  parsed object, never on rendered text.
- **AC-2** FILTER, default: `lore list --type task` (human AND `--json`) OMITS the invalidated doc.
  Assert by ID, never by title — the title column truncates and produced two false readings while
  this defect was being measured.
- **AC-3** FILTER, opt-in: `--include-invalid` INCLUDES it on both surfaces, and the two runs
  differ in row/doc count by exactly the number of invalidated docs. ⛔ Assert the DIFFERENCE, not
  just that the flag is accepted — an inert flag passes any exit-code-only check.
- **AC-4** BADGE: the `--include-invalid` human row is visibly marked. Assert two independent lone
  tokens, never one remembered sentence.
- **AC-5** REGRESSION: `lore get <slug>` (human) still shows the existing banner unchanged, and
  direct-address reads still resolve invalidated docs rather than hiding them (SPEC-043's
  deliberate asymmetry — list hides, direct address shows).
- **AC-6** STATE: a doc invalidated and then superseded-by-chain still reports correctly; a doc
  that was never invalidated is never marked.
- **AC-7** the sweep matrix from Required #4 is recorded in the task's evidence, with a per-surface
  verdict for `knowledge` and `adr` and for every record-emitting command checked.
- **AC-8** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO selection
  (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "The doc appears in `lore list` with status `draft`" is a proxy for "this is live work".
Concrete input satisfying the proxy while violating the property: the measured task, whose body
begins `⛔ RETRACTED — DO NOT IMPLEMENT`. The fix removes the proxy by putting validity in the data.

**Silence.** Total, and doubly so: the retracted doc is silently present, AND the flag documented
to control that presence silently does nothing. Neither failure emits any signal on any surface.

**Opt-in.** The exclusion must be the DEFAULT, with `--include-invalid` as the opt-in — the
direction the help text already promises. ⛔ Do not invert it: a corpus that shows retracted work
by default and hides it only on request re-creates this defect with an extra step.
