---
id: SPEC-110
type: spec
role: spec
title: "Context provenance: injected corpus-global state and a pasted resume ticket must each declare their own scope"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-10-17
tags: []
---
## Overview

Two independent context sources land in the same AI context window at session start, and once there they are **indistinguishable**:

1. the SessionStart hook's `lore bootstrap --injection` payload — a **corpus-GLOBAL** snapshot spanning every plan, every actor, and every concurrent session;
2. the user's explicitly pasted resume ticket — `lore feed session-resume --handoff <slug>` — whose scope is **exactly one handoff**.

Neither output declares its own provenance or scope. A consumer that reads both attributes global-snapshot items to the user's narrow request and reports them as one undifferentiated worklist. Under concurrent multi-session work (lore's own dispatch model) that produces cross-session trespass.

**Measured 2026-07-30, this repo.** The user pasted exactly one handoff ticket (`knowledge-handoff-agent-main-orchestrator-38`). The assistant merged that ticket's three next-steps with hook-injected global state and reported them as one status list, then recommended two actions wholly outside the ticket's scope: (a) path-scoped-committing another live session's dirty `CLAUDE.md`, and (b) fast-forwarding a shared branch carrying several sessions' commits into `main`. Neither was caught by any mechanism — only by the user asking "is this everything, or only the handoff's?".

**Prior art that does NOT cover this.** Two partial defenses already exist and both held during the incident, which is what proves they are the wrong layer:

- `spec-session-start-handoff-neutrality-injection-drops-resume` drops `resume_hint` from an ordinary session's injection so the payload never *points at* a thread. It says nothing about the remaining fields' scope.
- `assets/governance/corpus-workflow.md` §FEED tells the consumer that `latest_handoffs` is "a NEUTRAL directory … NEVER start resuming work from an injected handoff pointer on your own initiative". The assistant obeyed this literally — it did not self-resume — and still trespassed, because the rule covers ONE field and forbids ONE action (self-initiated resumption), not attribution of the other fields.

**Root cause.** Provenance is carried by neither payload. The consumer is asked to remember, from prose located far from the data, which of two adjacent context blocks each fact came from. Every field of the injection is corpus-global, yet the injection's own framing line reads `Corpus pointer set — deep-dive via …`, which is an invitation to consume, not a scope boundary. Self-describing data is the mechanism; prose recall is not.

**Delivery constraint (CLAUDE.md dogfooding rule).** A fresh `lore init` + `lore setup` project must not be able to hit this. That rules out fixing only the installed hook copy: the framing prose is currently hard-coded inside `assets/hooks/session-start-resume.mjs`, so an un-reinstalled hook would keep emitting the old boundary-free header even after the binary is upgraded — the exact drift class SPEC-083 already retired for governance prose by moving it into a runtime binary verb. The boundary declaration therefore has to be emitted **binary-side**, where it ships with every upgrade and cannot diverge from the payload it describes.

## Scope

**In scope**

- `buildBootstrapInjection` (`packages/core/src/session.ts`) — the projection gains a leading, self-describing scope field; the SPEC-080 projection contract (field order, count caps, char budget, single `omitted` ledger, no mid-JSON slicing) is extended, never duplicated.
- `lore governance` (`packages/lore/src/adapters/cli/commands/governance.ts`) — gains a `bootstrap-framing` topic serving `BOOTSTRAP_FRAMING_LINE`, so the hook stops owning that prose. `lore bootstrap --injection` (`packages/lore/src/adapters/cli/commands/bootstrap.ts`) is deliberately UNCHANGED: it keeps emitting bare compact JSON per SPEC-080 AC-080-3. See D2 — an earlier draft of this bullet put the framing line on `--injection`'s stdout, an implementer correctly followed it, and it broke that contract.
- `assets/hooks/session-start-resume.mjs` — Phase E's hard-coded `## Lore Bootstrap (hook-injected)` header and `Corpus pointer set …` sentence are replaced by verbatim relay of binary-side output; the blind-pipe contract (SPEC-080 D3) is preserved and strengthened.
- `lore feed session-resume` render path (`packages/lore/src/flows/feed-flow.ts` + its CLI/MCP surfaces) — the ticket output declares its own scope closure.
- `assets/governance/corpus-workflow.md` §FEED — the `latest_handoffs`-only rule generalizes to the whole injected payload and adds the source-labelling duty on report.
- Assets manifest regeneration, so both edited assets are embedded in the binary with current digests. Note the two have DIFFERENT delivery surfaces and this spec does not change either: `hooks/session-start-resume.mjs` is written to disk by `lore setup`, while `governance/corpus-workflow.md` is retired from the install set (`isRetiredFromInstall`, SPEC-083 D3) and reaches consumers only via the binary's embedded copy served by the runtime `lore governance` verb. Manifest regeneration is what keeps the embedded digests current for both; "ships" means embedded-and-current, not installed-to-disk, for the second. See D5 for the two distinct verification oracles this forces.

**Out of scope**

- Adding per-plan actor attribution to `active_plans` (who holds what). `active_sessions` already carries `(by, machine, worktree)` and the payload is char-budgeted; attribution is a separate change with its own budget analysis.
- Any change to `BootstrapReport` (the full tier-2 report) shape — SPEC-080 D1's "do not touch the full report's schema" constraint stands; this is a projection-layer change only.
- The three unrelated mechanism gaps in `knowledge-retro-three-mechanism-gaps-found-while-building-the`.

## Design Decisions

**D1 — the injection payload self-describes its scope, as its FIRST key.** `buildBootstrapInjection` emits a leading string field declaring that the payload is a corpus-global snapshot spanning all plans/actors/sessions, that it is not the session's worklist, and that it is not any handoff ticket's scope. First position is deliberate: a consumer reading top-down meets the boundary before the data, and a lost-in-middle truncation of later fields cannot strip it. It participates in the existing char budget and is never dropped by the trimmer — it is the one field whose absence changes the meaning of every other field.

The declaration text is a SINGLE exported constant in `@lore/core`; the payload field carries that constant, and every AC asserts **identity against the constant**, never a remembered substring. Rationale: this repo has measured five distinct false-oracle vectors, two of which (contiguous-substring assumption; paraphrase-tolerant matching) fire exactly here — an assertion written from memory silently degrades to a no-match or passes on a paraphrase that dropped the disclaimer. A constant makes the assertion referentially transparent and leaves zero drift surface between the text that ships and the text under test.

The disclaimer obligations the constant must discharge are themselves an exported array, `REQUIRED_DISCLAIMER_TOKENS` — the AC iterates it with one assertion per member, so adding a fourth obligation fails the AC until the constant carries it. Without this, "carries every required disclaimer" would be a semantic half with no detector, which D6 forbids.

**Over-budget behaviour is SPEC-080's existing rule, unchanged — there is NO short-circuit.** SPEC-080's char-budget rule reads: drop whole trailing entries from `latest_handoffs` then `active_plans`, incrementing `omitted.budget_drops`, never a mid-JSON slice, and "both arrays empty and still over → `budget_exceeded: true`, payload returned **intact**". The declaration participates in the char measurement and is never a drop candidate, but it must NOT buy its own survival by discarding the data fields: that would be the same "sacrifice content to fit the budget" that SPEC-080 forbids, merely at field granularity instead of character granularity, and it would fire on ANY `char_budget` configured below the declaration's length regardless of how small the actual report is (`char_budget` is `positive()` with no floor, so that is a reachable config). An earlier draft of this spec did pin such a short-circuit; it was removed on measurement — it broke SPEC-080's own BOUNDARY oracle (oversized single field with both droppable arrays empty) and forced a fabricated all-zero `omitted` ledger plus a schema cast-gap for a shape the schema rejects.

The over-budget fixture for AC-CP-2 is therefore pinned to SPEC-080's own construction: a `BootstrapReport` whose droppable arrays are empty and which carries a single oversized field, projected against a char budget it cannot meet — assert `budget_exceeded: true`, the declaration present and unsliced at position 1, every data field still intact, and the declaration never named in the omission ledger.

**D2 — the framing line is emitted binary-side as a governance topic, NOT on `--injection`'s stdout.** The human/AI-readable boundary line is served by the existing governance-prose verb (`lore governance <topic>`, whose topic set already carries `corpus-workflow` / `seat-briefing` / `claude-md`), and the hook's Phase E spawns it exactly as Phase C and Phase D already spawn that same verb. The hook then places the line OUTSIDE the markdown fence — where its own retired header used to sit — and the JSON payload inside it.

Three constraints force this placement, and only this placement satisfies all three:

- **SPEC-080 AC-080-3 pins `--injection`'s stdout as compact JSON** ("returns compact JSON whose key order matches the literal contract list"). That is a documented public CLI contract; prepending a prose line to it breaks every `lore bootstrap --injection | jq` consumer and forces the hook to split a stream it is contractually forbidden to inspect. An earlier draft of this spec said the framing line prints "together with the payload" and an implementer correctly followed it, breaking exactly that invariant and having to rewrite SPEC-080's own e2e assertions to compensate — the wording was the defect, not the implementation.
- **Blind pipe (SPEC-080 D3)** stays strictly stronger this way: two independent spawns, each relayed verbatim, zero parsing. A single mixed stream would require the hook to know where prose ends and JSON begins.
- **The boundary line is an instruction to the reader, not data.** Inside a fenced code block it reads as part of the payload; outside it, it frames the payload — which is precisely the position the retired hook header occupied.

The line's text remains the exported `BOOTSTRAP_FRAMING_LINE` constant (identity-asserted per D6), so the governance topic and the constant can never drift. Rationale: an installed hook file drifts independently of the binary (SPEC-083's retired governance-snapshot defect); prose describing a payload must ship in the same artifact as the payload. The retirement is verified by a **zero-hit** search for the two literal retired strings (`## Lore Bootstrap (hook-injected)` and `Corpus pointer set`) in the hook source — a named-string absence check, not a judgment about whether remaining prose "describes meaning".

The framing line is likewise a single exported constant (`BOOTSTRAP_FRAMING_LINE`), and the AC asserts binary stdout **identity** against it. "Emitted by the binary" is otherwise not decidable at assert time: an absence check on the hook proves only that the hook stopped saying it, not that anything started. Identity against a binary-side constant proves the positive half directly.

**D3 — the resume ticket declares scope closure, on EVERY surface that renders it.** `lore feed session-resume` output carries an explicit boundary block stating that the ticket's scope is exactly the plan / modified files / next-steps it printed, and naming the injected global fields that are NOT part of it. Like D1 this block's text is a single exported constant (`RESUME_SCOPE_CLOSURE`) asserted by identity. This is the counterpart declaration to D1: the two adjacent blocks each say what they are, so no recall is required to keep them apart.

Two obligations that a single-surface AC would silently miss:

- `RESUME_SCOPE_CLOSURE` must name EVERY member of `BOOTSTRAP_INJECTION_KNOWN_KEYS`, asserted by iterating that set exactly as D4 does. A newly added injected field must then fail both the governance-rule AC and this closure AC until it is named in each — one-sided coverage is how a new field silently escapes labelling.
- The closure block must appear on the **CLI stdout AND the MCP `lore_feed` response** for `checkpoint: "session-resume"`. Both are consumed by agents; a render path that declares closure on stdout while the MCP response omits it reproduces the original defect for every MCP-based consumer. This repo has already measured that class ("a writer whose reader was retired, a reader without a writer … all fail SILENT") — so the AC asserts both surfaces, not the CLI alone.

**D4 — the governance rule generalizes from one field to the whole payload, and adds the report duty.** §FEED's `latest_handoffs` clause becomes a payload-wide rule: every injected field is corpus-global; when reporting state to the user, each item is labelled with its source (pasted ticket vs. session-start injection vs. this-turn query). Payload-wideness is verified by **iterating `BOOTSTRAP_INJECTION_KNOWN_KEYS`** (the projection contract's own field-name set) and asserting the rule text names each member — so adding a tenth injected field automatically fails this AC until the rule covers it, rather than silently leaving the new field unlabelled. Prose alone was measured insufficient — it is retained as the *why*, with D1/D3 as the mechanism.

The three source categories a report must distinguish (pasted ticket / session-start injection / this-turn query) are an exported token array, `SOURCE_CATEGORY_TOKENS`, iterated by the same AC. Otherwise "carries the source-labelling duty" passes on any paraphrase of the governance prose — including one that silently drops a category, which is precisely the failure this spec exists to prevent.

**`resume_hint` carve-out (measured conflict, not an exemption of convenience).** "Names each member" is UNSATISFIABLE for one member: `spec-session-start-handoff-neutrality-injection-drops-resume` enforces ZERO literal occurrences of the string `resume_hint` anywhere in `assets/governance/corpus-workflow.md` (`packages/lore/tests/unit/setup-governance-retirement.test.ts`, with its own non-vacuity control test). Naming all ten keys and naming zero occurrences of one of them are mutually exclusive. `resume_hint` is therefore covered by a generic clause ("plus any seat-scoped conditional field") and EXCLUDED from the iteration, with a paired assertion that its zero-occurrence invariant still holds — so the exclusion cannot silently widen to a second key. The nine remaining keys are named literally and iterated.

This is the SECOND cross-spec contradiction authored into this spec (the first was D1 vs. SPEC-080's payload-returned-intact rule). Both were found by an implementer's scoped test run, neither by a gate or by three rounds of AI review — see `knowledge-gates-and-the-review-judge-validate-a-spec-against`. AC-CP-5 was RETIRED for this reason and replaced by AC-CP-9; per that retro's own standing lesson, the replacement uses a NEW id rather than re-using AC-CP-5's, so the evidence already recorded against AC-CP-5 becomes a visibly dangling reference instead of an invisibly mismatched one. The loud breakage is the intended outcome.

**D5 — fresh-install verification is an AC, not a review note.** One AC runs the whole path in a throwaway corpus (`mkdtemp` under the OS temp root, i.e. OUTSIDE this repo's tree) with cwd set inside it, asserting (a) the resolved corpus root is that temp path and not this repo's `.lore/`, and (b) both boundary declarations appear and match their exported constants by identity. A second AC proves **distribution**, not merely storage — but the two edited assets have DIFFERENT delivery surfaces, and an AC text that assumed one surface for both overstated what could be proven:

- `assets/hooks/session-start-resume.mjs` IS installed to disk. Its oracle is the installed file: run `lore setup` against a throwaway `--claude-dir`, then assert the installed copy is byte-identical to the SSOT.
- `assets/governance/corpus-workflow.md` is **retired from the machine install set** (`isRetiredFromInstall("governance/corpus-workflow.md") === true`, SPEC-083 D3) — no installed copy ever exists. Its delivery surface is embedding in the binary plus the runtime `lore governance` verb, which is precisely the mechanism SPEC-083 introduced so prose and binary version can never diverge. Its oracle is therefore: assert the file is ABSENT from the install dir, AND assert the compiled binary's `lore governance` output is byte-identical to the SSOT.

An earlier AC text bundled both under "each of the two assets is byte-identical to its installed copy". That is unsatisfiable for the second asset, and the implementer who substituted the verb oracle was shipping the correct check while diverging from the AC's own words — the AC, not the implementation, was wrong. Distribution-first verification means naming each artifact's ACTUAL delivery surface; assuming a single shared surface is the same error class as assuming a fix reaches everywhere it is needed. Manifest presence alone remains insufficient for both — it has been measured to leave "fixed in both copies" unverifiable.

**D6 — no AC in this spec may assert against remembered wording.** Every AC pins its oracle to one of three artifacts: identity against an exported constant (D1/D3), a zero-hit search for a named literal string (D2), or exhaustive iteration over an exported key set (D4). A semantic AC half with no declared detector passes on a paraphrase that drops the very disclaimer it exists to guarantee — the first draft of this spec carried four such halves, and the review judge named all four. Treat that as the standing rule for any AC asserting on prose.

## Acceptance Criteria

Structured, machine-checkable ACs are registered via `lore ac add`; the prose here is the rationale, not the executable list.

**Declared ids are AC-CP-1, -2, -4, -6, -9, -10, -11 — the gaps at 3, 5, 7, 8 are deliberate, not dropped coverage.** AC-CP-3 → AC-CP-10 (framing line moved from `--injection` stdout to the governance topic, D2), AC-CP-5 → AC-CP-9 (`resume_hint` carve-out, D4), AC-CP-7 → AC-CP-11 (the two assets' delivery surfaces split, D5); AC-CP-8 was never issued. Each retirement used a NEW id rather than re-using the old one, so the evidence already recorded against the retired ids stays a VISIBLY dangling reference (`lore ac list` reports them) instead of an invisibly mismatched one — see `knowledge-gates-and-the-review-judge-validate-a-spec-against` §2 for why the loud break is preferred. Every design decision D1-D6 still maps to at least one live AC.

- The injection payload's first key is the scope declaration, carried by identity from the exported constant.
- The declaration survives a maximally trimmed, budget-exceeded projection and is never selected for omission.
- The framing line originates from the binary, and the two named retired strings have zero hits in the hook source.
- The resume ticket output carries the scope-closure constant by identity and names the excluded injected fields.
- The governance FEED rule names every member of the projection's exported key set and states the source-labelling duty.
- A throwaway out-of-tree corpus reproduces both declarations, with the resolved corpus root asserted to be the temp path.
- Both edited assets are content-parity verified against the embedded manifest.


## Acceptance Criteria (structured)

- [⚑] [script] AC-CP-6: With cwd inside an out-of-tree mkdtemp corpus, the resolved corpus root is that temp path rather than the repo .lore directory, and both boundary declarations match their exported constants by identity
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts -t 'fresh install'
  other_command=3
- [⚑] [script] AC-CP-1: The first key of the bootstrap injection payload is the scope declaration and its value is strictly identical to the exported BOOTSTRAP_SCOPE_DECLARATION constant, and the test iterates the exported REQUIRED_DISCLAIMER_TOKENS array asserting the constant contains each member
  script: test — bunx vitest run packages/core/tests/unit/bootstrap-injection-provenance.test.ts -t 'first key'
- [⚑] [script] AC-CP-4: Both the CLI stdout and the MCP lore_feed session-resume response contain the exported RESUME_SCOPE_CLOSURE constant verbatim, and the test iterates BOOTSTRAP_INJECTION_KNOWN_KEYS asserting that constant names each member
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts -t 'scope closure'
  other_command=9
- [⚑] [script] AC-CP-2: Projecting a BootstrapReport with both droppable arrays empty and one oversized field against a char budget it cannot meet yields budget_exceeded true with EVERY data field intact per the SPEC-080 payload-returned-intact rule, the declaration present and unsliced at position 1, and the omission ledger never naming the declaration
  script: test — bunx vitest run packages/core/tests/unit/bootstrap-injection-provenance.test.ts -t 'budget-exceeded'
- [⚑] [script] AC-CP-9: The lore governance FEED rule text names each member of BOOTSTRAP_INJECTION_KNOWN_KEYS EXCEPT resume_hint (excluded by the handoff-neutrality zero-occurrence invariant, covered generically instead) and each member of SOURCE_CATEGORY_TOKENS, one assertion per member, plus a paired assertion that resume_hint still has zero literal occurrences in that file
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts -t 'governance rule'
  other_command=4
- [·] [script] AC-CP-10: The governance verb serves BOOTSTRAP_FRAMING_LINE verbatim as its own topic and the hook renders it OUTSIDE the markdown fence with the JSON inside, lore bootstrap --injection stdout remains bare compact JSON parseable with no split per SPEC-080 AC-080-3, and both retired hook strings return zero literal hits
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts -t 'framing line'
  other_command=8
- [⚑] [script] AC-CP-11: After lore setup against a throwaway claude-dir: the hook asset is byte-identical between its assets SSOT path and its installed copy read back from that dir, AND corpus-workflow.md is asserted ABSENT there because it is retired from the install set, with the compiled binary lore governance output asserted byte-identical to its SSOT as its actual delivery surface
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts -t 'manifest parity'
  other_command=2
