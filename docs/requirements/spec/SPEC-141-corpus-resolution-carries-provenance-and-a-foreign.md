---
id: SPEC-141
type: spec
role: spec
title: "Corpus resolution carries provenance, and a foreign write is a decision not an accident"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
links:
  - {id: SPEC-099, type: relates-to}
---
# Corpus resolution carries provenance, and a foreign write is a decision — not an accident

## Problem

`findLoreDbPath()` (`packages/lore/src/adapters/cli/utils.ts:124`) returns a bare `string`. It reaches that string by two routes and the caller cannot tell which:

1. **Upward walk** — `cwd` → filesystem root, looking for `.lore/lore.db`.
2. **§M4 fallback** — `findMainCheckoutLoreDb()` (`utils.ts:76`) compares `git rev-parse --git-common-dir` against `--git-dir`; on a linked worktree it resolves the MAIN checkout's corpus.

Harness worktrees live at `<main>/.claude/worktrees/agent-*` — NESTED inside the main checkout — so route 1 walks straight out of the worktree into the main checkout's `.lore/`. The path is a *write* path. A process therefore writes into a corpus it does not own, with no signal that it crossed a boundary.

### Measured 2026-08-12 (throwaway `mktemp` repo; the real corpus was never touched)

| Probe | Result |
|---|---|
| nested worktree, no own `.lore/`, read | sees the parent's sentinel doc — resolves the PARENT corpus |
| nested worktree, **write** (`lore create knowledge`) | parent corpus 1 → 2 docs — **wrote into a corpus it does not own** |
| CONTROL: worktree WITH its own `.lore/` | 0 docs, parent sentinel invisible — the probe discriminates |

## What this spec must NOT do

⛔ **Route 2 is load-bearing and stays.** `spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M4` added it deliberately: a fresh `git worktree add` tree never materializes `.lore/`, so `lore claim` / `lore evidence` / `lore release` / `lore verify` from an agent's own worktree reach the main corpus through it. The entire worktree-dispatch protocol runs on that. A NESTED and a NON-NESTED worktree both legitimately end at the main corpus; they differ only in route.

⇒ **Any rule keyed on "the corpus is outside my worktree" is wrong** — it refuses the dispatch protocol's own writes. The refusal must key on *declared intent*, not on location.

⛔ **Do not fix this by making tests skip.** The tests are correct; the resolution is what surprises.

## Design

### D1 — one boundary detector, never a third

`utils.ts` already carries TWO independent worktree-boundary detectors that can disagree: `findMainCheckoutLoreDb` (`:76`, shells out to git, 5000 ms timeout) and `detectWorktreeDerivedActor` (`:496`, never calls git — reads the `.git` FILE and parses its `gitdir:` pointer). They diverge whenever git is off PATH, the spawn times out, or a `.git` pointer exists but the shellout fails.

The walk halts at the caller's own working-tree boundary, and it does so by **reusing one of the two existing detectors**, extracted into a single shared primitive. Crossing into the main checkout then happens ONLY via route 2. Nested and non-nested worktrees collapse into one case reached by one code path, so the policy has exactly one attachment site.

### D2 — provenance in the return type

```ts
// packages/core/src/  — browser-safe, no fs/path/os at top level
export type CorpusProvenance =
  | "own"           // found inside the caller's own working tree
  | "git_common_dir" // reached the MAIN checkout from a linked worktree (§M4)
  | "undetermined";  // gitFacts.resolved === false with no hit inside the caller's
                     // own tree — whether crossing would be the §M4 route or an
                     // accidental escape is UNKNOWN, so neither may be assumed

export interface ResolvedCorpus {
  readonly path: string;
  readonly provenance: CorpusProvenance;
}
```

`"undetermined"` mirrors `VerifyGitFacts.resolved` (`packages/core/src/verify-execution-root.ts:60`). Without it a detector disagreement forces a silent pick — the repo's own ⛔ no-silent-fallback rule violated in the design itself.

**Not a fourth member for "this adapter has no per-call cwd".** That is a different question, answered at the port by `CorpusProvenance | null` (see D5).

### D3 — collapse the two resolvers, leave the 6 callers alone

`findLoreDbPath` and `findLoreDbPathQuiet` differ only in terminal behaviour (`process.exit(1)` vs `undefined`) around an identical walk. ONE shared resolver returns `ResolvedCorpus | undefined`; both existing names become ≤3-line wrappers keeping their current signatures, so the six real callers stay untouched (`loader.ts:157,217`, `context.ts:273`, `report-issue-wiring.ts:129`, `scripts/check-ac-ref-integrity.ts:185`, `scripts/export-spec-mirror.ts:292`). A separate `resolveCorpus()` exposes provenance at the composition boundary only.

Pure decision, IO supplied as data — the `resolveVerifyExecutionRoot` precedent (`verify-execution-root.ts`): the pure resolver takes `{cwd, probeExists, gitFacts}` and is unit-testable with zero fs and zero git; the adapter supplies the real `existsSync` walk, the real git probe, and the `process.exit(1)`.

### D4 — the guard is a gate sub-predicate, not a new ceremony

`GateCheckpointConfigSchema` (`packages/core/src/config.ts:236-296`) already carries six `.strict()` sub-predicates (`anchor_overlap`, `actor_identity`, `ac_quantifiable`, `oracle_coverage`, `requires_uat`, `prd_sync`), each with a `resolve*GateEnabled` helper (`config.ts:1240-1363`). `foreign_corpus_write` joins them in that exact shape.

**Distribution**: it ships inside `dist/lore`'s own schema default, so a project that just ran `lore init` is covered with zero config edits and no `assets/` sync.

⛔ **It is NOT scoped to the `task-claim` checkpoint.** The measured pollution came from `lore create knowledge`, which never touches `task-claim`. This is a corpus-**write**-level predicate.

### D5 — declared intent, per adapter, stated honestly

The guard lives in the service layer so CLI / MCP / HTTP call one predicate. But the FACT it keys on is only producible where a per-call caller directory exists:

| Adapter | Per-call caller directory | Provenance supplied |
|---|---|---|
| CLI | `process.cwd()` of a fresh subprocess | derived from the walk |
| MCP | the explicit `caller_cwd` tool parameter (`adapters/mcp/tools.ts:561` — "this field EXISTS SOLELY to feed…", because the server's own `process.cwd()` is fixed at startup) | derived from `caller_cwd` when supplied |
| HTTP | none — `serve.ts:26` resolves the app ONCE at boot; zero `process.cwd()` reads in `adapters/http/**` | `null` → predicate inert |

⛔ The HTTP row is a **named exemption with its reason**, not a claim of uniformity. Writing this table into the spec is the point: an unstated exemption is how "the gate covers all three adapters" becomes false without anyone noticing.

**Intent is declared ONCE, at claim, and PERSISTS in the lease — it is not a per-command flag.**

Measured 2026-08-12: `--worktree` exists on `lore claim` and on NO other lifecycle verb — `lore evidence`, `lore release`, `lore verify` and `lore done` all lack it. A design that demanded the flag on every foreign write would therefore refuse the dispatch protocol's own `evidence`/`release` writes, the exact outcome this spec's ⛔ constraint forbids.

The resolution is that `taskClaimSchema` (`packages/core/src/task-workflow.ts:597`) already persists `worktree?: string` on the advisory lease. So:

- `lore claim --worktree <path>` is the ONE place intent is declared, using the already-mandatory flag (SPEC-042), not a new env var.
- Every later lifecycle verb operating on that task reads intent from the **task's own claim lease**, never from its argv.

This is why the signal is verifiable rather than aspirational: `worktree-corpus-resolution.bun.test.ts:243-246` already passes `--worktree`, and every dispatch bundle in this repo already claims with it, so "the real protocol declares intent" is provable with zero bundle edits and zero new flags. A new env var — or four new `--worktree` flags nothing sets today — could only be shown set by hand-auditing every bundle, the distribution-first failure mode this repo has already recorded. It also makes intent a durable corpus fact rather than a ceremony repeated at each call, so it cannot drift between the claim and the writes that follow it.

### D6 — the stale header dies in the same change

`utils.ts`'s module header (`:1-23`) carries three assertions that are false today:

- "No business logic here; only terminal I/O concerns" — the file holds `findLoreDbPath`, `findMainCheckoutLoreDb`, `detectWorktreeDerivedActor`.
- "Note: DB discovery and App construction live in `loader.ts`" — **the opposite of the truth**; DB discovery is in THIS file at `:76-149`. This line is what made the originating defect report anchor on `loader.ts`.
- "Side-effect class: pure (no IO, no process.exit)" — `spawnSync` + `existsSync` + `process.exit(1)` + stderr writes.

Relocating DB discovery out of the 1175-line `utils.ts` and correcting this header is part of THIS acceptance unit. A header that records a property which stopped being true is the failure class this repo has already paid for.

## Acceptance Criteria

Declared separately via `lore ac add`. Each carries a control that goes red if the check refuses everything, and each command prints a `<AC-ID> PASS: <fact>` line.

The central one, AC-CP-3, is a **2×2 against ONE fixture** (nested worktree, no own `.lore/`):

| | intent declared | intent NOT declared |
|---|---|---|
| lifecycle verb (`claim`/`evidence`/`release`) | **allow** | refuse |
| non-lifecycle verb (`create`) | refuse | refuse |

⛔ It asserts the exit code AND a stderr string naming the guard. Asserting only "the parent corpus doc count did not change" is the empty-artifact false oracle: it cannot distinguish "the guard fired" from "the process died before reaching the guard".

## Quality gates (module mode)

- **No circular dependencies** — pure types and the pure resolver live in `@lore/core`; the adapter depends on core, never the reverse. The service-layer predicate consumes `CorpusProvenance | null` as data.
- **Single clear responsibility** — resolution (where + whose) is separated from policy (may this write proceed); DB discovery leaves `utils.ts`.
- **Public API sufficient for black-box testing** — `resolveCorpus()` / the pure resolver are callable with supplied facts; no `process.cwd()` read and no `process.exit` inside the decision.
- **Dependencies injectable** — `probeExists` and `gitFacts` arrive as parameters, mirroring `resolveVerifyExecutionRoot`.

## Provenance of this design

Authored through `/lore-design` in `module` mode: a four-perspective parallel review (coupling, cohesion, reuse/extension, testing), then synthesis. Four tensions were resolved rather than averaged; two reviewer claims were machine-checked before being adopted, and one was corrected — the `task-claim` checkpoint scoping in D4. The originating defect report's own causal story was measured and partially falsified; see the re-baseline log on `task-a-worktree-nested-inside-the-main-checkout-resolves-the`.

## Re-baseline log — 2026-08-12, before any implementation

Three ACs were revised between authoring and approval. Recorded here because "AC red → edit AC → green" and "concealed failure" are indistinguishable in an audit no matter how justified the edit, so the pattern itself is the risk and visibility is the only remedy.

**What produced the revisions.** `lore review` on v1 of this spec returned ONE blocking question and four `ac_quantifiability` advisories. No implementation existed and no AC had been run, so nothing red was masked — this is pre-implementation tightening, the legitimate moment for it.

**AC-CP-3 — blocking, and the reviewer was right.** v1 declared a 2×2 whose fourth cell (non-lifecycle verb WITH declared intent) is **unconstructible**: D5 fixes the declared-intent signal as `--worktree`, which exists only on the lifecycle verbs, so `lore create knowledge` has no way to declare intent and that cell can never be invoked in a way that reaches the guard. Two repairs were possible — invent a general intent flag, or drop to three cells. Invented flag REJECTED: a flag nothing in the dispatch protocol would ever set cannot be shown to be set by the real protocol, which is the exact verifiability argument that chose `--worktree` over a new env var in D5. Dropped to three cells, with the fourth documented as absent by design. **Not a weakening**: two-sidedness is preserved without it — cell 1 still reddens a refuse-everything guard, cells 2 and 3 still redden a refuse-nothing guard.

**AC-CP-1, AC-CP-2, AC-CP-3 — advisory, all adopted.** v1 NAMED its oracle values without FIXING them: "the EXACT exit code" without saying which, "a stderr string naming this guard" without the literal needle, three header claims identified by paraphrase, "still call the string-returning wrappers" satisfiable by a name grep, and an `undetermined` row defined by a pre-change condition ("the two detectors disagree") that D1 dissolves by collapsing those detectors. Each was pinned: exit code exactly 4 and the literal token `gate:corpus-write:foreign-provenance` (fixed once here because AC-CP-5(a) asserts it equal across CLI and MCP); the three header needles quoted verbatim; caller preservation restated as a type-level assertion plus a no-member-access check; and `undetermined` redefined in terms of the supplied fact shape (`gitFacts.resolved === false` with no hit inside the worktree). **Not a weakening in any case**: every revision made an assertion harder to satisfy accidentally, and none removed a check.

### Round 2 — measured answer to the review's blocking question

**Q: is `--worktree` parser-enforced on `lore claim`, which would make AC-CP-3 cell 2 unconstructible for the same reason the 2×2's fourth cell was dropped?**

**A: No — measured, not assumed.** `packages/lore/src/adapters/cli/commands/claim.ts:103` builds the service payload as `...(typeof args.worktree === "string" ? { worktree: args.worktree } : {})`, and the command's own header (`:22-25`) states it outright: "`--worktree` is ALWAYS explicit — never auto-captured … Omitted → no `worktree` field is sent to the service at all." The flag is mandated by the dispatch PROTOCOL and by this repo's CLAUDE.md, never by the argument parser: `lore claim <task>` without it parses cleanly and reaches the service with no worktree field.

⇒ AC-CP-3 cell 2 is constructible exactly as written, and the three-cell shape stands. The asymmetry with the dropped fourth cell is real rather than arbitrary: `--worktree` is an OPTIONAL flag that lifecycle verbs accept and non-lifecycle verbs do not define at all — so "lifecycle without intent" is a reachable state while "non-lifecycle with intent" is not expressible.

Three further advisories were adopted in this round: AC-CP-1's purity oracle was censusing the TEST file's imports while claiming a property of the MODULE under test (two different things — a clean test file is fully compatible with a module that imports `node:fs` itself); AC-CP-4 asserted the sub-predicate resolves "through the same `resolve*GateEnabled` path" with no oracle for that half, which a hard-coded default plus an ad-hoc resolver would satisfy identically; and AC-CP-2(b) named its intent ("no member access") without naming a mechanism, while a `.path` grep is defeated by an intermediate binding on a separate line. Each is now pinned to a mechanism rather than an intention. D2's inline `"undetermined"` comment was also corrected — it still defined the state by the pre-change two-detector disagreement that D1 dissolves, which is precisely the stale-comment class D6 exists to eliminate, appearing inside the very spec that legislates against it.

### Round 3 — a real design flaw, caught by review before implementation

**The blocking question was correct and D5 was broken as written.** v11's D5 fixed the declared-intent signal as `--worktree`, while D1 routes EVERY worktree (nested or not) to the main corpus under the same `git_common_dir` provenance — so the guard's refusal branch covers all foreign writes, including `lore evidence` and `lore release`. Measured: `--worktree` exists on `lore claim` and on NO other lifecycle verb (`evidence`, `release`, `verify`, `done` all lack it). v11 would therefore have refused the dispatch protocol's own evidence/release writes — precisely the outcome this spec's own ⛔ constraint forbids, written into the spec that forbids it.

Two repairs were possible. **Adding `--worktree` to the four remaining verbs: REJECTED** — nothing in any dispatch bundle sets it today, so it would fail the same verifiability test that rejected a new env var in the first place, and it repeats a ceremony at every call where it can drift. **Adopted instead**: intent is declared once at claim and read thereafter from the lease, which `taskClaimSchema` (`task-workflow.ts:597`) already persists as `worktree?: string`. Strictly stronger than v11 — the signal is now a durable corpus fact that the existing protocol already produces, rather than argv that four commands cannot even accept.

Three further advisories adopted: AC-CP-2(c)'s "ZERO definition of db discovery" carried no needle or mechanism while the rest of that AC explicitly rejects name-greps; AC-CP-4(c)'s "reached through the same lookup" named no oracle, and it was the one clause carrying the load that (a) and (b) provably cannot; AC-CP-5(c) asserted the HTTP predicate "receives null" with no way to observe it — via HTTP behaviour alone, a null argument is indistinguishable from the predicate never being invoked, the same false-oracle class this spec calls out for doc-count assertions. Each is now pinned to an AST/Program check, a keyed-dispatch assertion, and a typed spy on the predicate's provenance argument respectively.

⇒ Three review rounds produced one unconstructible oracle cell, one broken intent mechanism, and eight unpinned oracle values — none of which an implementation-first order would have surfaced before an implementer had already built against them.

### Incident disclosed — a destructive probe on a live object (2026-08-12)

This spec's version history contains one version in which AC-CP-2's statement reads exactly `TEST PROBE`. That was not a draft; it was my error, and it is recorded here because an unexplained mutation in an audited chain is worse than a disclosed one.

Sequence: a batched `lore ac set` reported `AC-CP-2 FAILED` with its output suppressed by `> /dev/null 2>&1`. To find out why, I re-ran the same command against the REAL criterion with the placeholder statement `TEST PROBE` — and it succeeded, overwriting the criterion. The actual cause was neither quoting nor the batch: `acceptance_criteria[].statement` is capped at **2000 characters**, and that revision was ~2100. The cap is a real, undocumented-here constraint worth knowing when authoring mechanism-pinned ACs, which run long by construction.

Two rules were broken at once, both already written down: ⛔ never experiment on a real object for an irreversible action, and ⛔ never suppress the output of a write command you intend to diagnose — the suppression is what turned a one-line validation error into a destructive probe. The correct move was to re-run with output shown, which is what finally produced the answer. AC-CP-2 was restored at 1990 characters with every pinned mechanism intact (AST FunctionDeclaration query, checker-resolved call-site types, three verbatim needles, runtime-concatenated needles, positive file count, and the relocated-module control) and verified by reading all five statements back.


## Acceptance Criteria (structured)

- [·] [script] AC-CP-1: The corpus resolver is a PURE decision, and the oracle measures the MODULE under test rather than the test file. Input is the supplied fact shape {cwd, probeExists, gitFacts} -- gitFacts mirroring VerifyGitFacts (verify-execution-root.ts:51-74), probeExists an injected path-existence predicate; output is ResolvedCorpus or undefined. FOUR outcomes, each defined by that INPUT SHAPE so every row has a reproducible input: (a) probeExists finds .lore/lore.db at or above cwd and STILL INSIDE the caller worktree root yields own; (b) no hit inside the worktree, gitFacts.resolved true, isLinkedWorktree true, and probeExists finds the corpus under the main-checkout root yields git_common_dir; (c) no hit inside the worktree and gitFacts.resolved FALSE yields undetermined -- the resolver MUST NOT pick either crossing story; (d) no hit inside the worktree with gitFacts.resolved true and isLinkedWorktree false, or the common-dir corpus absent, yields undefined. CONTROL: rows (a), (b) and (d) all return a DEFINITE answer, so a resolver answering undetermined for everything goes RED exactly as one that never answers it does. PURITY ORACLE, corrected: the census walks the RESOLVER MODULE own import graph transitively -- not the test file imports, which prove nothing about the module -- and asserts zero reachable fs / path / os / child_process / node: builtin specifiers, plus zero process.exit and zero process.cwd occurrences in that module source. The walk reports a POSITIVE count of modules visited, so a traversal that visited nothing cannot pass.
  script: test — bunx vitest run packages/core/tests/corpus-provenance-resolver.test.ts 2>&1 && echo "AC-CP-1 PASS: corpus provenance is decided purely from supplied facts, with a distinct undetermined state and a definite-answer control"
- [·] [script] AC-CP-2: The two near-duplicate resolvers collapse into one, the six call sites keep their exact contract, and the stale header dies in the same change. THREE halves, each pinned to a MECHANISM because this AC rejects name-greps throughout. (a) BEHAVIOUR, driven not read: both wrappers delegate to the ONE shared resolver and keep their terminal contracts -- the loud one still exits 1, the quiet one still returns undefined for the same input. The loud one stderr is asserted by EXACT EQUALITY against a baseline captured from the PRE-CHANGE utils.ts source and pinned as a literal in the test, so no implementer may pin a different amount of that message. (b) CALLER PRESERVATION via the TypeScript compiler API over a real Program: findLoreDbPath declared return type is EXACTLY string and findLoreDbPathQuiet EXACTLY string-or-undefined; and at each of the six call sites (loader.ts twice, context.ts, report-issue-wiring.ts, scripts/check-ac-ref-integrity.ts, scripts/export-spec-mirror.ts) the checker-resolved type of the call expression is the string primitive and no PropertyAccessExpression or destructuring BindingPattern has that call as its initializer, followed transitively through any intermediate binding. A grep for a .path access is defeated by an intermediate const on a separate line; an AST plus checker query is not. (c) RELOCATION AND HEADER on that same Program: utils.ts declares ZERO FunctionDeclarations named findLoreDbPath, findLoreDbPathQuiet or findMainCheckoutLoreDb -- an AST query, so a residual helper cannot be argued about -- and its source contains ZERO occurrences of each of the three verbatim header needles quoted in D6. Needles are assembled by concatenation at runtime so the census file cannot match itself, and the scan reports a positive count of files visited. CONTROL: the relocated module DOES declare those three functions, asserted on the same Program in the same run, so a check that passed by pointing at the wrong tree goes RED.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/corpus-resolver-collapse.test.ts 2>&1 && echo "AC-CP-2 PASS: one shared resolver behind two unchanged wrappers, six callers untouched, and utils.ts no longer carries db discovery or its three false header claims"
- [·] [script] AC-CP-3: THE CENTRAL GUARD as a THREE-cell oracle against ONE fixture -- a throwaway mktemp git repo whose worktree is NESTED at repo/.claude/worktrees/agent-x with no .lore/ of its own, so every cell resolves the parent corpus by the same route. Intent is a LEASE fact, not argv (D5): declared once by lore claim --worktree and read thereafter from taskClaimSchema.worktree. Cells: (1) ALLOWED -- lore claim --worktree <path>, then lore evidence on that SAME claimed task, which carries no --worktree flag at all and must be permitted by inheriting intent from the lease; (2) REFUSED -- lore claim WITHOUT --worktree, and lore evidence on a task whose lease has no worktree field; (3) REFUSED -- a non-lifecycle write, lore create knowledge. ⛔ The fourth cell of the obvious 2x2, non-lifecycle WITH declared intent, is UNCONSTRUCTIBLE BY DESIGN and deliberately absent: no non-lifecycle verb defines --worktree and no general intent flag is introduced, because a flag nothing in the dispatch protocol sets could not be shown set by the real protocol. Two-sidedness survives without it: cell 1 reddens a refuse-everything guard, cells 2 and 3 redden a refuse-nothing guard, and cell 1 second half specifically reddens a guard that reads argv instead of the lease. PINNED ORACLE VALUES: every refused case asserts exit code EXACTLY 4 and stderr CONTAINING the literal token gate:corpus-write:foreign-provenance -- the same token AC-CP-5(a) asserts equal across CLI and MCP, fixed here once. ⛔ A refused cell asserting only that the parent doc count did not change is the empty-artifact false oracle: it cannot distinguish the guard firing from the process dying before reaching it. Cell 1 asserts both writes LANDED in the parent corpus, proving allow positively. ⛔ Every fixture is an mkdtemp git repo asserted to live outside REPO_ROOT; the real corpus is never touched.
  script: test — bun test packages/lore/tests/e2e/foreign-corpus-write-guard.bun.test.ts 2>&1 && echo "AC-CP-3 PASS: only a declared-intent lifecycle write may reach a corpus the caller does not own, proven by a 2x2 where each of the four cells can independently go red"
- [·] [script] AC-CP-4: DISTRIBUTION: a project that ran nothing but lore init is already covered, with no config edit and no assets/ sync. FIXTURE, stated here so this AC is reproducible without reading another: the SAME shape AC-CP-3 uses -- a throwaway mktemp git repo created by the COMPILED binary running lore init and nothing else, with a NESTED worktree at repo/.claude/worktrees/agent-x carrying no .lore/ of its own, so every write below is genuinely foreign. Without that construction an implementer could make a non-foreign write, see no refusal, and be unable to tell a broken default from a correctly inert guard. (a) BEHAVIOURAL DEFAULT: a non-lifecycle foreign write from that worktree is actually REFUSED -- the default proven by behaviour, never by reading a schema literal. (b) CONTROL, so the knob is real in both directions: writing foreign_corpus_write.enabled false into that same project config makes the IDENTICAL write SUCCEED. A default asserted only through the enabled branch cannot distinguish a live default from a hard-coded refusal. (c) STRUCTURAL SAME-PATH CHECK, with the lookup mechanism NAMED because (a) and (b) provably cannot distinguish a shared path from an ad-hoc one: iterating GateCheckpointConfigSchema own shape enumerates SEVEN keys asserted AS A SET -- foreign_corpus_write plus the six pre-existing sub-predicates -- each carrying the identical .strict() enabled-boolean shape; and resolveForeignCorpusWriteGateEnabled is retrieved by the SAME keyed dispatch entry that yields the six existing resolve*GateEnabled helpers (config.ts:1240-1363), asserted by driving that shared lookup with all seven keys and getting a live helper for each, so a seventh predicate wired past the table goes RED. Requires a freshly built dist/lore (assertFreshBinary) -- a stale binary is a documented false oracle in this repo.
  script: test — bun test packages/lore/tests/e2e/foreign-corpus-write-default.bun.test.ts 2>&1 && echo "AC-CP-4 PASS: a bare lore init project has the foreign-corpus-write guard on by default, and the config knob flips it both ways"
- [·] [script] AC-CP-5: THE ADAPTER MATRIX IS ASSERTED, INCLUDING ITS EXEMPTION. (a) MCP INHERITS: driving the MCP tool handler with caller_cwd pointing INTO a nested worktree, a non-lifecycle write is refused carrying the SAME literal token gate:corpus-write:foreign-provenance the CLI emits -- one vocabulary across both surfaces, asserted by equality against the CLI string, never by each surface having its own wording. (b) MCP CONTROL: the same MCP call with caller_cwd inside the corpus own tree is ACCEPTED and the doc lands, so the refusal tracks provenance rather than refusing every MCP write. (c) THE HTTP EXEMPTION IS OBSERVED AT THE PREDICATE BOUNDARY, not inferred from behaviour: a typed spy wraps the service predicate and asserts it WAS invoked exactly once on an HTTP-adapter write with its provenance argument EXACTLY null, and that the write landed. ⛔ Asserting only that the HTTP write succeeded is the same false-oracle class this spec rejects elsewhere -- via behaviour alone a null argument is indistinguishable from the predicate never being called at all, so the spy is what makes the exemption falsifiable rather than decorative.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/foreign-corpus-write-adapters.test.ts 2>&1 && echo "AC-CP-5 PASS: MCP inherits the guard via caller_cwd under one message vocabulary, and the HTTP null-provenance exemption is asserted rather than assumed"
