---
id: SPEC-146
type: spec
role: spec
title: "CLAUDE.md governance — content-dimension checks: wire the dead admission half, split capacity from content, and measure what the contract asks for"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-24
tags: [claude-md, memory-files, governance, admission, distribution]
parent: PRD-001
links:
  - {id: SPEC-095, type: relates-to}
  - {id: SPEC-098, type: relates-to}
  - {id: SPEC-095, type: implements}
---
## Overview/Goal

The CLAUDE.md governance mechanism (SPEC-095 contract + ceiling lint, SPEC-098 admission checks) measures **capacity** — lines and bytes — and nothing else. Every content-dimension check it declares is either unwired or structurally unable to see what the contract asks it to verify. This spec closes that gap and splits the module along the seam that already exists inside it.

Measured on this repo 2026-08-23, before any change:

| Claim the mechanism makes | Measured reality |
|---|---|
| `MemoryFileFindingKind` declares 4 kinds | Production can emit 3. `checkReferenceExistence` (kind `reference_missing`, DETERMINISTIC) has **zero call sites** repo-wide. |
| Contract: "That pointer must resolve" | 21 corpus-slug pointers in the root file. The grammar's first line skips every token without `/`; slugs contain none, so **not one is ever checked**. |
| `detectNarrativeSmells` detects event narrative | **Zero call sites.** Root file carries 11 ISO dates + 13 status words, all invisible. |
| Anthropic [S]: "If you emphasize many lines, none of them stands out." | Not measured anywhere. Root file 30 ⛔ (1.4/KB); user-global 86 ⛔ (4.0/KB). |
| Contract cites the official under-200-lines target | No output reports distance from it. Ceiling is looser by design (D3) and reports green. |
| Official remedy for bloat is `.claude/rules/` | Contract mentions it 0 times; the template 0 times; `real-memory-file-probe.ts` **excludes `.claude/` entirely**. |

**Root cause, one defect repeated twice**: AC-CTX-2 asserted *"the admission-check unit suite passes"* — which was true — while nothing called the functions in production. Both admission functions shipped fully unit-tested and permanently dead. The standing lesson names it exactly: *capability implemented ≠ production wiring; the two MUST be the same acceptance unit.*

## Scope

**In**: 3-way split of `service/claude-md-check.ts` into `claude-md-budget.ts` (capacity) / `claude-md-admission.ts` (content) / `claude-md-findings.ts` (shared types); sole composition entry `runMemoryFileChecks` consumed by BOTH `adapters/cli/commands/status.ts` and `flows/context-flow.ts`; new `adapters/cli/claude-md-render.ts`; new deterministic `slug_pointer_missing` (on a NEW corpus-loading `lore status --check-memory-pointers`, N14) + `emphasis_saturated` (on the corpus-free `--check-claude-md`); new advisory `line_length` + `target_distance`; wiring of the two dead functions; `reference_missing` grammar repair (five measured false-positive classes); third `MemoryFileRole` `"rules"` + `.claude/rules/**/*.md` discovery (while `.claude/worktrees/` stays excluded); `memory_files.rules` + `memory_files.emphasis` config blocks; contract prose additions (rules section, reworded reflow clause, eviction-stub rule); template pointer line.

**Out**: tightening the emphasis threshold to a level that actually trips existing files (own later slice, own sweep); arming `reference_missing`/narrative smells as deterministic — gated on the **two-repo** condition in N3, which no work inside this slice can discharge; `paths:` frontmatter semantics beyond discovery; per-path budget overrides; dashboard rendering.

## Module Boundary

- **Public API**: `runMemoryFileChecks(files, budgets, deps) → { deterministic: MemoryFileFinding[]; advisory: AdvisoryFinding[]; headroom: HeadroomReport[]; warnings: AdvisoryFinding[] }` — the ONLY entry. ⛔ `headroom`/`warnings` are INSIDE the composition (N15). Phase 1 shipped them as direct `computeHeadroom`/`computeHeadroomWarnings` calls in `status.ts`, outside the entry, and AC-COMPOSE-1's banned-function list did not name them — so "the ONLY entry" was a FALSE LABEL for one slice. A boundary that says sole and is not is the defect class this spec exists to close. `AdmissionDeps = { fileExists: (p: string) => boolean; docExists: (slug: string) => boolean }`. `MemoryFileRole = "root" | "module" | "rules"`.
- **Internal**: every individual metric function. ⛔ Callers never compose their own subset — that is the opt-in-per-surface hole the current module header already warns about, and two independent call sites is precisely what produced the drift this spec repairs.
- **Dependencies**: none new. Both existence predicates are injected, so both service modules stay pure and store-free; neither may import `node:fs` or the store. `docExists` is owned by the CLI/flow layer, which already holds the corpus handle.
- **Constant**: `OFFICIAL_LINE_TARGET` lives as a module constant in `claude-md-admission.ts`, ⛔ NOT in `contextConfigSchema`. That schema's anti-dual-write invariant covers *ceilings* — per-repo tunable numbers needing exactly one writer. The official target is the opposite number-class: a fixed external citation nobody tunes. Conflating them puts two number-classes under a rule written for one.

## Design Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| N1 | M0 shape | split into M0a slug pointers / M0b file paths | wire `checkReferenceExistence` as-is | Measured: wiring as-is emits 18 findings on the root file, **16 false**. The module's own stated risk posture is "misses acceptable, false alarms not". |
| N2 | M0a arming | deterministic, same slice | advisory first | Measured: all 21 slug pointers resolve today. Zero back-catalog debt — the sweep obligation is satisfied vacuously and is recorded as vacuous. |
| N3 | M0b arming | advisory this slice; arming requires zero false positives on this repo **AND** on at least one consumer repo | deterministic day 1 | 76 findings across 9 module files, single-digit genuine. AC-GRAM-1 discharges only the first half — the grammar's module-relative resolution changes behaviour in ways no single repo can evidence. |
| N13 | `reference_missing` type class | migrate it from `MemoryFileFindingKind` to `AdvisoryFindingKind` in this slice | leave it typed deterministic while wiring it as advisory | ⛔ A kind typed deterministic but rendered advisory is exactly the false-label defect this spec exists to close. The downgrade costs nothing real: the deterministic declaration has had **zero call sites since it shipped**, so no enforcement is being removed — only a claim that was never true is being retracted. N10's later arming migrates it back, on the N3 condition. |
| N14 | Where the slug-pointer check runs | a NEW `lore status --check-memory-pointers`, inside the corpus-loading check family | fold it into `--check-claude-md` | ⛔ `--check-claude-md` is CORPUS-FREE by SPEC-095 D9 and dispatches before `loadLoreApp` — its help says "Config-only, never loads the corpus DB", and `assets/hooks/claude-md-guard.sh` maps its exit codes 0→allow / 3→block / everything-else→fail-open. Slug existence REQUIRES the corpus, so folding it in would either break that contract or force a silent skip. The new flag joins `--check-tree`/`--check-drift`/`--check-requirements`/`--check-prd-budget`/`--check-issues`, which already share one `loadLoreApp()`. Not merged INTO `--check-drift`: that flag verifies a spec's declared `code_anchors`, a different subject; one flag, one job. Emphasis stays on `--check-claude-md` — it is pure text, no corpus needed. |
| N15 | Headroom's place | INSIDE `runMemoryFileChecks`; AC-COMPOSE-1's banned list extended to `computeHeadroom`/`computeHeadroomWarnings` | leave them as direct calls, as Phase 1 shipped | The Module Boundary declared a sole entry while two functions bypassed it, and the AC that was supposed to enforce that declaration had a banned list that omitted exactly those two — a self-consistent pair of statements that were jointly false. Also unblocks AC-RULES-1, whose oracle reads `role: rules` headroom entries that the declared return type did not expose. |
| N4 | M0b grammar | exclude npm scope names, glob metacharacters, `~/` home paths; resolve module-relative paths against the file's own directory | repo-relative only | All five false-positive classes measured and mechanically decidable. Module-relative is not noise — it is the convention module files actually use (`commands/set.ts` inside the cli module). |
| N5 | Emphasis band | deterministic, single threshold, ⛔ NOT the 3-band ceiling machinery | reuse warn/evict bands | Marker density is not capacity. Reusing the bands smuggles a third capacity concept into a schema restricted to lines/bytes. |
| N6 | Emphasis default | `memory_files.emphasis.max_per_kb`, default above this repo's measured spread | hardcoded constant | Ships deterministic to every consumer via `lore setup`; D3's install-must-not-fail reasoning applies unchanged. |
| N7 | rules role | third `MemoryFileRole` + own budget block | reuse `module` | The budget module's messages would print "module ceiling" for a non-module file; the two populations have different natural sizes. |
| N8 | rules discovery | recursive glob under `.claude/rules/`, `.claude/worktrees/` still excluded | drop `.claude` from the probe's exclusion set | That exclusion exists specifically to stop counting worktree copies of the same file. Needs precision, not removal. |
| N9 | M4/M5 config | hardcoded module constants | config knobs | Advisory-only; no exit-code payoff justifies a support surface. |
| N10 | Later arming of narrative smells | type migration gated by a spec phase + measured sweep | per-metric `enforcement: advisory\|deterministic` config flag | A runtime toggle lets consumers diverge on what gates their push — recreating the opt-in-per-surface hole verbatim. |
| N11 | Contract reflow clause | reword to separate ceiling-gaming from readability | delete / leave as-is | As written it forbids exactly what a per-line cap encourages. Both intents are valid; they need disentangling, not a winner. |
| N12 | Split timing | split before the new metrics land | add metrics to the existing file, split later | Nothing outside the file has ever called the admission half — the cheapest possible moment. Deferring triples the blast radius and risks the new content metrics anchoring to capacity machinery by proximity. |

## Migration — back-catalog sweep, same slice

A new deterministic gate retroactively invalidates the back-catalog; the sweep plus a written exemption must budget into the SAME slice.

| New deterministic check | Measured debt | Sweep |
|---|---|---|
| `slug_pointer_missing` | **0** across 21 pointers | none — vacuous, recorded as vacuous |
| `emphasis_saturated` | default set above the measured 0–1.4/KB spread → 0 files trip on landing | none this slice; the tightening pass that WILL trip files is deliberately Out of scope with its own sweep |
| `reference_missing` | 76 findings / 9 module files | **downgraded to advisory this slice (N13)** — exit code unaffected, so no obligation. It was typed deterministic and never called; the downgrade retracts a false claim rather than removing enforcement. |

⛔ No file receives an exemption comment. Emphasis lands non-tripping by construction.

## Risks

- The split touches a pinned RED test whose unnarrowed field access depends on `MemoryFileFinding`'s flat shape — the shared type must be extracted and re-exported, ⛔ never forked.
- `.claude/rules/` discovery runs adjacent to `.claude/worktrees/`; an imprecise glob double-counts every worktree's memory files.
- Emphasis ships deterministic to consumers on `lore setup`; a default below real-world density breaks install-to-first-write.
- Adding `.strict()` config keys means an older binary rejects a newer config.yaml (inherent to every past key addition; document the version floor).

## Acceptance Criteria

Typed ACs authored via `lore ac add` (script mode). Coverage contract:

⛔ **Every WIRING AC drives the CLI subprocess, never the unit function directly** — a unit-only wiring AC is the exact defect this spec exists to prevent, and one that passes while the function is unwired has no discriminating power. This binds AC-WIRE-1/2, AC-SLUG-1/2, AC-EMPH-1/2, AC-ADV-1 and AC-RULES-1. It deliberately does NOT bind the source-level assertions (AC-PURE-1, AC-COMPOSE-1), the pure-grammar unit suite (AC-GRAM-1), or the distribution assertions (AC-CONTRACT-1, AC-TEMPLATE-1) — those assert properties a CLI run cannot observe.

- Wiring ACs: a tmpdir fixture containing a dangling reference / a dense-ISO-date paragraph / an over-threshold marker density, run through `lore status --check-claude-md --json`, asserting the finding `kind` appears **by name** and the exit code is **exactly** the declared value — ⛔ never merely "non-zero". Smallest red mutation for each: delete the corresponding call from the composition entry, reverting to today's dead-code state.
- Purity ACs: neither service module imports `node:fs` or the store.
- Composition AC: `status.ts` and `context-flow.ts` each reference `runMemoryFileChecks` and no individual metric function.
- Discovery AC: a tmpdir with both `.claude/rules/**/*.md` and a `.claude/worktrees/**/CLAUDE.md` — rules files counted, worktree copies not.
- Vacuity AC: the slug-pointer check emits a finding on a fixture containing a nonexistent slug — proving a green run on the real corpus means "checked and clean", not "never ran".
- Fixtures use `mkdtemp` + cwd inside it. ⛔ Never the repo's own `.lore/` or `.claude/`.
- ⛔ `bun run test:changed` is structurally blind to the admission suite (dynamic `import()` defeats static selection) — running it by hand is mandatory and must be stated in every dispatch bundle.


## Acceptance Criteria (structured)

- [⚑] [script] AC-WIRE-1: reference_missing is reachable from the CLI as ADVISORY: a tmpdir CLAUDE.md containing a backtick-quoted nonexistent repo-relative path makes 'lore status --check-claude-md --json' emit a finding of kind exactly 'reference_missing' in the advisory array, with exit code exactly 0; and the kind no longer appears in MemoryFileFindingKind (N13 type migration). Deterministic arming is gated on N3's two-repo condition, which this slice cannot discharge. Covered by describe 'claude-md wiring — reference_missing reaches the CLI as advisory'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-wiring.test.ts 2>&1 && echo 'AC-WIRE-1 PASS: reference_missing emitted in the advisory array by the CLI, exit code exactly 0, kind absent from MemoryFileFindingKind'
- [⚑] [script] AC-WIRE-2: iso_date_density is reachable from the CLI as ADVISORY: a tmpdir CLAUDE.md whose paragraph carries ISO dates AT the module's declared density threshold makes 'lore status --check-claude-md --json' emit an advisory finding of kind exactly 'iso_date_density', while one date BELOW the threshold emits none; both runs exit exactly 0. The comparison is >= (claude-md-check.ts:472 pre-split), so the threshold value itself fires — an AC asserting silence AT the threshold would describe a semantics this code does not have and could only be satisfied by an unauthorised behaviour change. Read the threshold from the exported constant; never restate the number. Covered by describe 'claude-md wiring — narrative smells reach the CLI without affecting exit'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-wiring.test.ts -t 'narrative smells reach the CLI' 2>&1 && echo 'AC-WIRE-2 PASS: iso_date_density fires at threshold+1 and stays silent at threshold, exit code exactly 0 in both runs'
- [⚑] [script] AC-COMPOSE-1: Both production call sites consume ONLY the composition entry: status.ts and context-flow.ts each reference runMemoryFileChecks and neither names ANY individual metric function — lintMemoryFiles, checkReferenceExistence, detectNarrativeSmells, checkSlugPointers, measureEmphasis, computeHeadroom, computeHeadroomWarnings. ⛔ The last two are in the list as of N15: Phase 1 shipped them as direct calls outside the entry while the Module Boundary claimed a sole entry, so the boundary statement and the AC enforcing it were jointly false. Two independent call sites composing their own subset is the exact drift this spec repairs.
  script: lint — bun scripts/check-claude-md-composition.ts 2>&1 && echo 'AC-COMPOSE-1 PASS: status.ts and context-flow.ts reference runMemoryFileChecks only, zero direct metric-function references (7 functions checked incl. computeHeadroom/computeHeadroomWarnings)'
- [⚑] [script] AC-PURE-1: Both service modules stay pure: claude-md-budget.ts and claude-md-admission.ts contain no import of node:fs, node:path, or any store module — every IO capability enters as an injected predicate (fileExists, docExists).
  script: lint — bun scripts/check-claude-md-purity.ts 2>&1 && echo 'AC-PURE-1 PASS: claude-md-budget.ts and claude-md-admission.ts import no node:fs / node:path / store'
- [⚑] [script] AC-SLUG-1: slug_pointer_missing fires on the corpus-loading surface: a mkdtemp repo whose CLAUDE.md cites a backtick-quoted corpus slug absent from that repo's corpus makes 'lore status --check-memory-pointers --json' emit a finding of kind exactly 'slug_pointer_missing' with exit code exactly 3. This closes the structural blindness where the reference grammar's includes('/') guard skipped every slug pointer. ⛔ The check runs on --check-memory-pointers, NOT --check-claude-md, which is corpus-free by SPEC-095 D9 (N14). Covered by describe 'slug pointers — a dangling slug is refused'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-slug-pointers.test.ts 2>&1 && echo 'AC-SLUG-1 PASS: slug_pointer_missing emitted for a dangling slug, exit code exactly 3'
- [⚑] [script] AC-SLUG-2: The real corpus is clean AND the check demonstrably ran: one suite asserts BOTH a positive control (a mkdtemp fixture with a dangling slug yields exactly one slug_pointer_missing via 'lore status --check-memory-pointers --json') AND the negative claim (every memory file in THIS repo yields zero). The positive control is mandatory because a skipped check and a passing check both produce zero findings — vacuously true must be distinguishable from true. Covered by describe 'slug pointers — positive control plus real-corpus sweep'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-slug-pointers.test.ts -t 'positive control plus real-corpus sweep' 2>&1 && echo 'AC-SLUG-2 PASS: positive control fired AND all repo memory files yield zero slug_pointer_missing'
- [⚑] [script] AC-EMPH-1: emphasis_saturated fires above the shipped default and not at it: a fixture whose marker density is TWICE the resolved max_per_kb yields exactly one emphasis_saturated with exit code exactly 3, while a fixture at exactly the default yields none with exit code exactly 0. The test reads the default from resolved config and constructs both fixtures from it — ⛔ the number is never restated in the test or in this AC (anti-dual-write). The finding carries no warn/evict fraction field, because marker density is not a capacity metric. Covered by describe 'emphasis saturation — over-threshold density is refused'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-emphasis.test.ts 2>&1 && echo 'AC-EMPH-1 PASS: fires at 2x default (exit 3), silent at default (exit 0), no ceiling-band fields on the finding'
- [⚑] [script] AC-EMPH-2: Emphasis lands non-tripping by construction: one suite asserts BOTH a positive control (an over-threshold fixture yields exactly one emphasis_saturated) AND that every memory file in this repo yields zero at the shipped default. The positive control is required because disabling the metric also yields zero. No file receives an exemption comment; the later tightening pass that WILL trip files is out of this spec's scope. Covered by describe 'emphasis saturation — positive control plus repo sweep at shipped default'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-emphasis.test.ts -t 'positive control plus repo sweep' 2>&1 && echo 'AC-EMPH-2 PASS: positive control fired AND all repo memory files pass at the shipped default'
- [⚑] [script] AC-GRAM-1: The reference grammar's five measured false-positive classes are all excluded — npm scope names (@lore/core), glob metacharacters (hooks/**), tilde home paths (~/.claude/), brace expansion (docs/requirements/{prd,spec}/), and module-relative paths resolved against the file's own directory (commands/set.ts inside the cli module) — while a genuinely dangling repo-relative path is still reported. Asserted as a positive control PLUS a zero-false-positive sweep over all repo memory files, because excluding everything also yields zero. Covered by describe 'reference grammar — five exclusion classes with a genuine-dangling control'.
  script: test — bunx vitest run packages/lore/tests/unit/service/claude-md-reference-grammar.test.ts 2>&1 && echo 'AC-GRAM-1 PASS: genuine dangling still reported, five false-positive classes excluded, zero false positives across repo memory files'
- [⚑] [script] AC-RULES-1: Rules discovery is precise inside .claude/, asserted through the CLI: a mkdtemp repo containing BOTH .claude/rules/a.md, .claude/rules/nested/b.md AND .claude/worktrees/w/CLAUDE.md, run through 'lore status --check-claude-md --json' with cwd inside it, yields headroom entries for exactly two files at role 'rules' and zero entries sourced from .claude/worktrees/. The existing .claude exclusion must be narrowed, not removed — it exists to stop counting worktree copies of the same file. Covered by describe 'rules discovery — counted while worktree copies stay excluded'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-rules-discovery.test.ts 2>&1 && echo 'AC-RULES-1 PASS: CLI JSON reports exactly two role=rules files and zero worktree copies'
- [⚑] [script] AC-CONTRACT-1: The distributed contract carries all three prose changes and ships byte-identically: assets/governance/claude-md-contract.md contains a .claude/rules/ section, the reworded reflow clause separating ceiling-gaming from readability, and the rule binding eviction stubs to the Index-Entry Contract; and 'lore governance claude-md' stdout is byte-identical to that asset. Prose-only delivery does not reach consumers unless the asset ships. Covered by describe 'contract asset — three additions and governance-verb byte parity'.
  script: test — bunx vitest run packages/lore/tests/unit/assets/claude-md-contract-content.test.ts 2>&1 && (cd packages/lore && bun test tests/e2e/governance-claude-md-compiled.bun.test.ts) 2>&1 && bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts 2>&1 && echo 'AC-CONTRACT-1 PASS: contract asset carries the rules section + reworded reflow clause + eviction-stub rule, governance stdout is byte-identical, and the assets manifest is in sync'
- [⚑] [script] AC-ADV-1: The two always-on advisory metrics appear in machine-readable output on every run and never change the exit code: 'lore status --check-claude-md --json' yields, for EVERY discovered memory file, one advisory entry of kind exactly 'line_length' and one of kind exactly 'target_distance' whose measured field equals that file's line count minus OFFICIAL_LINE_TARGET, on a run whose exit code is exactly 0. Asserted on JSON kinds and fields, never on rendered prose. Anthropic defines 200 lines as a target, not a limit; rendering it as a breach would overwrite that definition. Covered by describe 'always-on advisories — printed every run, exit code untouched'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-advisories.test.ts 2>&1 && echo 'AC-ADV-1 PASS: line_length + target_distance present per memory file with measured deltas, exit code exactly 0'
- [⚑] [script] AC-TEMPLATE-1: The rules pointer actually ships to consumers: assets/project/CLAUDE.md.template contains a line pointing at .claude/rules/ as the path-scoped mechanism for instructions that should not load every session, AND a 'lore setup --project' run into a fresh mkdtemp installs a CLAUDE.md containing that same line. An asset edit with no installed-output assertion is the same capability-without-wiring failure this spec exists to close — in miniature. Covered by describe 'template pointer — present in the asset and in the installed output'.
  script: test — bunx vitest run packages/lore/tests/integration/claude-md-template-pointer.test.ts 2>&1 && echo 'AC-TEMPLATE-1 PASS: rules pointer present in the template asset and in the setup --project installed CLAUDE.md'
- [⚑] [script] AC-SPLITDEBT-1: SPEC-146's three-way split left its own name behind: every mention of claude-md-check in tracked source (excluding tests, docs/requirements, .lore) must either be GONE or sit on a line that also carries a history marker (pre-split | former | Extracted from | split of). Two conjuncts, both binding: zero UNMARKED mentions AND at least 4 history-marked mentions still present — the second exists because deleting every mention, including the four that correctly record the split's provenance, would otherwise satisfy the first. Measured red before the work: unmarked=8 marked=4, exit 1. Covers 7 present-tense JSDoc assertions (packages/core/src/config.ts x4, service/context-facts.ts x2, ai/assess-template.ts x1) plus ONE stale RUNTIME diagnostic in scripts/check-claude-md-purity.ts, whose PurityCheckError still tells the reader 'the three-way split of claude-md-check.ts has not landed yet' on a live failure path where a declared purity target is missing. No test file backs this AC; the oracle is the grep pair itself.
  script: lint — U=$(git grep -n claude-md-check -- . ":!docs/requirements" ":!.lore" ":!*tests/*" | grep -vE "pre-split|former |Extracted from|split of" | wc -l | tr -d " "); M=$(git grep -n claude-md-check -- . ":!docs/requirements" ":!.lore" ":!*tests/*" | grep -cE "pre-split|former |Extracted from|split of"); echo "unmarked=$U marked=$M"; test "$U" -eq 0 && test "$M" -ge 4 && echo "AC-SPLITDEBT-1 PASS: 0 unmarked claude-md-check mentions in tracked source, $M history-marked mentions preserved"

## Code anchors

- packages/lore/src/service/claude-md-admission.ts#runMemoryFileChecks
- packages/lore/src/service/claude-md-admission.ts#OFFICIAL_LINE_TARGET
- packages/lore/src/service/claude-md-budget.ts
- packages/lore/src/service/claude-md-findings.ts
- packages/lore/src/adapters/cli/claude-md-render.ts
- packages/lore/src/adapters/cli/commands/status.ts
- packages/lore/src/flows/context-flow.ts
- packages/lore/src/adapters/real-memory-file-probe.ts
- packages/lore/tests/integration/claude-md-wiring.test.ts
- packages/lore/tests/integration/claude-md-advisories.test.ts
- packages/lore/tests/integration/claude-md-slug-pointers.test.ts
- packages/lore/tests/integration/claude-md-emphasis.test.ts
- packages/lore/tests/integration/claude-md-rules-discovery.test.ts
- packages/lore/tests/integration/claude-md-template-pointer.test.ts
- packages/lore/tests/unit/service/claude-md-reference-grammar.test.ts
- packages/lore/tests/unit/service/claude-md-admission.test.ts
- packages/lore/tests/unit/assets/claude-md-contract-content.test.ts
