# Mode: Create

**Purpose**: Create a new plan with phases + task docs in the lore corpus

## Triggers

- Cross-session work OR significant complexity/risk/ambiguity OR user requests plan
- Workflow ANALYZE routes here when complexity = complex

## Complexity Routing

For small plans (≤3 tasks, single session, clear scope), skip the full ceremony:
- Skip: Risk Register (2.1), Critical Path (6), Estimation Summary (8.4), Overlap Review (8.5)
- Keep: Invariants (2), task creation (5), validation gate (8), the bundle's single S4 approval (8.7)
- This avoids overhead that doesn't pay off for simple, well-understood work.

## Workflow

```yaml
# 1. Gather context — find upstream docs
- Pull `lore bootstrap --json` on demand (the session-start injection does not carry it) → active_plans, armed_gates, pending_reviews
- lore search "{task keywords}" --type prd --json     → find the PRD this plan implements
- lore search "{task keywords}" --type spec --json    → find the governing spec
- lore search "{task keywords}" --type adr --json     → find design decisions
- lore tree                                            → orient in the doc hierarchy
- Save found slugs for step 4 (--parent) and step 7 (lore link)

# 1.1. ⛔ Upstream Document Gate (HARD — must pass before step 2)
#
# A plan decomposes requirements into tasks. Without upstream docs, the plan
# has nothing to decompose — it becomes speculation. The chain is
# prd → spec → plan, and lore enforces the promotion half mechanically:
# `plan-promote` (fires on `lore approve <plan>`) requires the spec-tier
# ancestor APPROVED with ≥1 structured AC. Verify the chain NOW so the gate
# passes later instead of bouncing your approve at step 8.6.
#
# Principle: upstream docs are living snapshots — always reflect current
# system state. Every plan iteration must verify coverage AND freshness.
#
# ── Feature development (not refactor/bugfix/debt/upgrade) ──
#
# Check 1: PRD exists?
#   YES → save prd slug, proceed to Check 1b
#   NO  → ⛔ STOP. Invoke Skill("product") to create PRD first.
#         Output: "⛔ No upstream PRD found. Invoking /product to create one."
#         After PRD created → re-enter step 1 to search and continue.
#
# Check 1b: PRD covers current initiative?
#   Read PRD content (lore get <prd-slug>). Compare with current initiative scope.
#   COVERED → proceed to Check 2
#   GAP     → ⛔ STOP. Invoke Skill("product") to UPDATE the PRD.
#         Output: "⛔ PRD does not cover {initiative}. Invoking /product to update."
#         Note: editing an approved doc auto-resets it to draft — re-approve after.
#         After update → re-enter Check 1b.
#
# Check 2: Spec exists for this initiative? (lore get <spec> / lore ac list <spec>)
#   YES → save spec slug; scan content for [NEEDS CLARIFICATION] markers
#         (resolve before step 2); verify ≥1 structured AC. A DRAFT spec produced
#         in this same batched-governance S2 run is fine — specs and plans are
#         approved together in S4 (specs first); an approved spec is fine too.
#         Spec approved but has 0 ACs → the gap belongs to the SPEC AUTHOR:
#         report it upstream (Skill("design") owns `lore ac add`), don't
#         self-author ACs silently.
#   NO  → ⛔ STOP. Invoke Skill("design") to create the spec first —
#         it runs `lore feed spec-create` then
#         `lore create spec --title ... [--kind feature|tech|design]` (no parent: cite rules with
#         `lore ac add ... --cite BR-<n>` / `lore ac cite`; BR-1007)
#         and declares ACs via `lore ac add`.
#         After the spec exists as a draft with its ACs → re-enter step 1.1
#         (same S2 run — do not wait for its approval).
#
# ── Technical plans (refactor/bugfix/debt/upgrade) ──
#
# Check 3: Tech spec (--kind tech) or ADR exists?
#   YES → save slug, proceed to Check 3b
#   NO  → ⛔ STOP. Invoke Skill("design") to create one first.
#         Output: "⛔ No tech spec/ADR found. Invoking /design to document the approach."
#         After doc created → re-enter step 1.1.
#
# Check 3b: Does the change introduce new technology or alter architecture?
#   YES → Verify relevant ADRs reflect the change. If an ADR is outdated →
#         invoke Skill("design") to create the successor
#         (lore create adr --parent <spec it governs> --supersedes <old-adr> invalidates the old one loudly).
#   NO  → proceed to step 2.
#
# Gate summary:
#   Feature plan: PRD (exists + covers) → spec (approved, ≥1 AC) → plan
#   Technical plan: tech spec/ADR (exists + current) → plan
#   Each link is a dedicated skill with its own quality standards.
#   The plan-promote gate re-checks this chain deterministically at approve time.

# 1.2. Clarification — answered in the batched-governance S1 interview
#
# The plan's HOW questions are asked in the ONE S1 decision interview
# (`~/.claude/skills/shared/batched-governance.md`), together with the
# product and design questions — never in a separate plan-time sitting,
# never one question per message.
#
# Coverage the S1 interview must include for this plan (skip ≤3-task plans):
#   medium plan: >= 5 dimensions | complex plan: >= 8 dimensions
#   □ Tech stack & framework constraints   □ Data model / storage approach
#   □ Auth & permissions model             □ Third-party dependencies (search
#     npm/context7/deepwiki FIRST, present findings as options)
#   □ Error handling & failure modes       □ Testing strategy
#   □ Deployment & infrastructure          □ Performance / scalability
#   □ Security considerations              □ Migration / backward compatibility
#
# A dimension already answered by code, corpus or upstream docs is NOT asked —
# record the answer and its source. A dimension the S1 interview missed is
# decided by the AI during S2 and listed as an AI-made decision in S4; it never
# opens a new mid-production stop.
#   ⛔ "I'll use ST to answer a preference question myself" — preference
#      questions belong in S1; ST is for questions with a factual answer.

# 1.3. Strategy Exploration (MANDATORY for medium and complex; skip small)
# Use Sequential Thinking (mcp__sequential-thinking__sequentialthinking) to
# generate >= 2 decomposition strategies. Each strategy includes:
#   - Name (e.g., "Vertical Slices", "Horizontal Layers", "Risk-First")
#   - Phase outline (titles + sequence)
#   - Pros / Cons
#   - Which Skills each phase leverages
#   - Estimated total phase count
#
# The AI selects the strategy (unless the user stated a preference in S1) and
# records chosen + rejected strategies with rationale in the plan's Decisions
# Log. The comparison is shown in the single S4 approval — no separate pick.
#
# Common archetypes (non-exhaustive):
#   - Vertical Slices: each phase delivers end-to-end functionality
#   - Horizontal Layers: backend → frontend → integration → deploy
#   - Risk-First: spike unknowns → core features → polish
#   - Dependency-Ordered: build foundation → dependents → integration
#   - TDD-Driven: test infrastructure → red-green per feature → refactor
#
# Anti-pattern:
#   ⛔ "Only one reasonable way to decompose this" — almost never true.
#   Force a second strategy even if the first seems clearly superior.

# 1.4. Per-Phase Research Gate (MANDATORY for implement/design/refactor phases)
# Before creating task docs for any phase whose primary skill is
# implement, design, or refactor:
#   1. Identify the phase's technical domain(s)
#   2. Search for existing solutions:
#      - npm/PyPI/crates.io (context7 for docs)
#      - GitHub patterns / starter templates
#      - deepwiki reference architectures
#      - lore search — a prior research/reference knowledge doc may already answer this
#   3. Record: library name, version, fit, decision (USE/REJECT + reason)
#   4. Record the USE/REJECT decision in the plan's Decisions Log (shown in S4)
#   5. Only AFTER research → create the phase's task docs
#   6. Non-trivial conclusions worth reuse → lore create knowledge --parent <spec or prd it concerns> --sub-type research
#
# Domain-specific research checklist:
#   □ Utility functions → Lodash / Radash / Remeda
#   □ Date/time → Dayjs / date-fns
#   □ HTTP client → Axios / ky / ofetch
#   □ Validation → Zod / Valibot
#   □ Money/decimal → bignumber.js / Decimal.js / dinero.js
#   □ State management → framework-native first
#   □ Auth → existing SDK (Auth0/Clerk/Lucia) before custom
#   □ Testing → Vitest/Jest + MSW + Playwright
#   □ ORM/DB → Prisma / Drizzle / Kysely
#
# Rules:
#   ⛔ "The use case is too simple for a library" is NOT valid.
#      Even one function from Dayjs beats a hand-rolled date parser.
#   ⛔ "I'll wrap the SDK" — check if the SDK already provides the
#      wrapper pattern. Read docs (context7) before writing abstractions.
#
# Output: phase_research notes → fold into each phase's --description and
# the relevant tasks' Approach/Source fields.

# 2. Scope analysis (informed by found docs + matched Scenario skill chain)
- Define Invariants (global constraints — each must be verifiable, not vague)
- Decompose into Phases (3-5 tasks each, ~1 session per phase)

# 2.1. Risk Identification
- Use ST reasoning to identify risks across 4 categories:
  - **Technical**: unknown API, new technology, complex integration, performance uncertainty
  - **Dependency**: external service, third-party library, upstream team deliverable
  - **Scope**: requirements unclear, [NEEDS CLARIFICATION] markers, scope creep potential
  - **Quality**: insufficient test coverage, complex edge cases, accessibility requirements
- For each risk, assess:
  - **Impact**: H (blocks plan) / M (blocks phase) / L (delays task)
  - **Trigger**: observable condition that means the risk has materialized
  - **Mitigation**: preventive action (built into task tree as a task or AC)
  - **Contingency**: reactive action (what to do if risk triggers despite mitigation)
- H-impact risks need a corresponding mitigation task in the task tree — otherwise the risk is identified but not addressed
- Output: `**[RISK_REGISTER]** {count} risks identified: {H_count}H / {M_count}M / {L_count}L`

# 3. Skill→Task mapping + Approach routing
- Take the matched Scenario skill chain from ANALYZE
- Map each skill step to one or more tasks:
  - research:sdk → "Research: evaluate existing solutions"
  - design:architecture → "Design: architecture specification"
  - implement:backend → split into concrete implementation tasks
  - test:unit → "Test: unit test coverage"
- Adjust: merge trivial steps, split large ones, add domain-specific tasks
- Do not over-decompose — a task under ~5 min of AI time doesn't need to exist separately
- Define dependencies: apply the 3-layer parallelism model (§ 5.3) — justify each blocks edge with a concrete artifact

## 3.1. Approach routing — every implement task needs an approach
For each implement task, determine approach source:
  1. **Spec How section** covers it → `Approach: per spec {spec-slug} {section}` → single-phase
  2. **Research step** already concluded → `Approach: {library/pattern} (from research)` → single-phase
  3. **Existing project pattern** → `Approach: follow {file/module} pattern` → single-phase
  4. **None of above** → **split into two tasks** (an implement task without a known approach will stall during execution):
     - `[Plan] {topic} — research & design approach` (skills: [research/design], AC: output approach)
     - `[Implement] {topic} — execute per approach` (skills: [implement], blocked by the [Plan] task)
     - The [Plan] task's AC includes: "Update the [Implement] task content with Approach field (lore set <task> --fields-file ...)"

**Rule**: implement task without Approach = not ready for execution. The lore-reader audit (8.3) will flag it.

# 4. Create plan document
- # NOTE: `lore feed` supports artifact checkpoints only (spec-create etc.) — there is NO plan-promote feed checkpoint (verified 2026-07-19: `unknown checkpoint`). The plan-promote gate's rules are enforced at `lore approve` (step 8.6); nothing to pre-pull here.
- `lore template show plan --blank > /tmp/plan-fields.yaml`, then fill it (Overview, Invariants, Risk Register, Estimation
  Summary, Critical Path placeholder, Exit Criteria, Phase Descriptions,
  Pre-registered Branches, Decisions Log — see plan-file-format.md)
  - Governance: batched, one flow (`shared/batched-governance.md`) — no mode field.
    Phase Gates auto-proceed; Invariant violations hard-block.
- lore create plan --title "{title}" --parent <spec-slug> --fields-file /tmp/plan-fields.yaml --json
  → save the returned plan slug

# 5. Declare phases, then create task docs
- Phases are declared on the plan; tasks are individual lore docs assigned to a phase.

# 5A. Declare ALL phases:
- lore phase add <plan> "Phase 1: {name}" --description "{scope, approach, key files, constraints}"
- lore phase add <plan> "Phase 2: {name}" --description "..."
- Always include a final verification/review phase — without it the plan has no
  final gate and can be declared complete prematurely.

# 5B. Create every leaf task (ALL phases decomposed at planning time — no deferred phases):
- lore create task --title "[Skill:xxx] {description}" \
    --parent <plan> --plan-id <plan> --phase "Phase N: {name}" \
    --anchor <repo-relative-path> [--anchor <path> ...] \
    --priority <critical|high|medium|low> \
    --fields-file /tmp/task-fields.yaml --json   # skeleton: lore template show task --blank
- Task creation validates --phase against the plan's declared phases at write time —
  unknown phase → exit 4 VALIDATION_ERROR (fix the name, don't fight it).

# 5C. Wire dependencies (blocker FIRST, blocked SECOND):
- lore link <blocker-task> <blocked-task> --type=blocks
- Readiness derives from these links: a task is ready iff every blocker is archived.

## 5.1. Full upfront decomposition (single-pass)

⛔ **All phases — including implement, test, deploy — MUST have their task docs created during the planning stage.** This ensures the complete DAG is visible upfront, enabling global parallelism analysis and accurate critical path calculation.

**Rationale**: Deferred decomposition (declaring phases without tasks) destroys global DAG visibility — the planner can only see partial parallelism, and the critical path calculation is incomplete. The cost of re-planning a few tasks later is far lower than the cost of systematically under-parallelizing every plan.

### When approach is unknown for implement tasks
If an implement task lacks a known approach (no spec coverage, no existing pattern, no prior research):
- Use the **two-task pattern** from § 3.1: `[Plan] research & design approach` → blocks → `[Implement] execute per approach`
- Both tasks are created upfront with their `blocks` link declared
- The [Plan] task's AC includes: "Update the [Implement] task content with Approach field"
- This preserves full DAG visibility while handling approach uncertainty

## 5.2. Task content format
  - title: "[Skill:xxx] Description"
  - content (for implement tasks):
    ```
    Estimate: S|M|L|XL
    Approach: {library/pattern/API to use}
    Source: {spec section / research conclusion / existing pattern file}
    Dimensions: {D-FUNC, D-CODE | D-UI, D-BEAUTY | D-UX, D-A11Y | etc.}
    Scope-Alt: {what can be descoped without blocking plan — supports Negotiable in INVEST}
    Covers: {spec AC ids this task's work satisfies, e.g. AC-AUTH-1, AC-AUTH-3}

    AC:
    - [acceptance criterion 1 — Given/When/Then, see ac-quality.md]
    - [acceptance criterion 2]
    ```
  - **Estimate field** (required for all tasks): T-shirt sizing
    - `S` = <1 session, trivial change
    - `M` = ~1 session, standard task
    - `L` = ~2 sessions, complex task
    - `XL` = >2 sessions → split into smaller tasks (violates Small in INVEST)
  - **Scope-Alt field**: Documents what can be reduced/deferred if needed (supports Negotiable in INVEST)
  - **Dimensions field**: Lists which quality dimensions this task is responsible for.
    Derived from the spec's quality dimensions. Each task should cover 1-3 dimensions max.
  - **Covers field**: spec AC ids from `lore ac list <spec>` — the implementer records
    evidence against them (`lore evidence ... --ac <id>`), and coverage is checked in 8.2.
  - For non-implement tasks (research/design/test): Approach field is optional, Estimate is still required
  - **--anchor** (mandatory for any task intended for parallel dispatch): repo-relative
    POSIX paths this task will touch; trailing `/` declares a directory scope. The
    `task-claim` gate rejects overlapping fresh claims by different actors — but it can
    only see what is DECLARED. Undeclared conflicts are invisible to it. (Legacy alias,
    SPEC-056 D7: a `phase` doc's claim gates on the additive `phase-claim` checkpoint —
    same anchor-overlap predicate; `task-claim` keeps gating legacy `task` docs
    unchanged until migration.)
  - **--priority**: based on urgency + critical path position (step 6)

## 5.3. Parallel/Serial Judgment — 3-Layer Model

Apply these three layers **in order** to maximize parallelism at both phase and task level:

### Layer 1: Artifact Dependency Graph (most critical)

For each task, identify **produces** (files, types, APIs created) and **consumes** (artifacts it reads/imports).

| Relationship | Judgment |
|---|---|
| B does NOT consume any artifact from A | **Parallel** — no blocks link |
| B consumes A's artifact, but interface can be pre-defined | **Interface-First → Parallel** (see Layer 3) |
| B MUST wait for A's runtime output (DB schema, generated code, test results) | **Serial** — `lore link A B --type=blocks` |

⛔ Every `blocks` edge MUST be justified by a concrete artifact. "A comes before B logically" is NOT a valid reason.

### Layer 2: File Contention Domain

Tasks modifying the **same files** are a natural serialization point. Mitigation strategies:

1. **Split file responsibility** — extract into focused modules so each task's anchors are disjoint
2. **Serialize the conflicting pair** — declare overlapping anchors honestly AND add a `blocks` link between the two tasks. Never leave the conflict to dispatch time: the anchor-overlap gate would reject the second claim, stalling an agent.
3. **Additive-only files** (e.g., route registrations, re-exports) — can parallelize if each task appends independently (no read-modify-write)

  - ✅ Parallel: Task A anchors `hooks/`, Task B anchors `skills/` — disjoint
  - ❌ Parallel: Both tasks anchor `server.ts` — add a blocks link, or extract registration into separate files
  - ⚠️ Mitigate: Both add entries to `index.ts` — additive-only, can parallelize with a merge step

### Layer 3: Interface-First Decomposition (highest-leverage multiplier)

When multiple tasks implement against a shared contract:

```
Phase 0: Define types/interfaces/schemas (1 task, serial — foundational)
Phase 1: All implementations behind those interfaces (N tasks, ALL parallel)
Phase 2: Integration + wiring (1 task, serial — connects the pieces)
```

This converts O(N) sequential work into O(1) critical-path depth. Prefer this over horizontal-layer splitting ("all models → all services → all handlers"), which forces each layer to depend on the previous.

### Anti-patterns to avoid

- **Lazy Serial Chain**: A→B→C→D where B/C/D don't actually consume A's output. Justify each edge.
- **Horizontal Layer Split**: Sequential layers create artificial bottlenecks. Use vertical feature slices.
- **Missing anchors**: Without declared file anchors, the anchor-overlap gate is blind and parallelism safety cannot be validated. Always declare for parallel-dispatch tasks.

### Quick reference

- Intra-phase deps: apply all 3 layers between sibling tasks within a phase
- Inter-phase deps: **Default** is each Phase N task chain hanging off Phase N-1's last task. **Override** (no cross-phase blocks links) when all 3 layers confirm independence. Use ST reasoning to justify.
- Phases in lore are labels, not tasks — inter-phase serialization is expressed as `blocks` links between the relevant leaf tasks (typically last-of-phase → first-of-next-phase).

## 5.4. TDD Injection Pass (when the plan contains implement or refactor tasks)

> **Separation of concerns**: Business decomposition (5.1-5.3) and test design (5.4) must happen in two separate passes.
> Doing "what to build" + "how to test" in the same pass dilutes attention on both, causing test scenarios to become placeholders.
> This pass has singular focus: design tests for finalized implement tasks only — do not revisit business decomposition.

**Trigger**: the decomposed plan contains `[Skill:implement]` or `[Skill:refactor]` tasks (TDD enabled by default for implement/refactor intents).
Skip when: pure research/design plan, no implement tasks, or user explicitly opts out of TDD.

**Pass workflow** (operates on implement tasks created in 5.1-5.3, does not modify business structure):

1. **Iterate implement tasks** — for each `[Skill:implement]` task:
   - Read its AC, Approach, and the spec AC ids it covers
   - Use ST to derive test scenarios (each AC needs at least 1 happy path + 1 edge/error case)
   - Scenarios must be **behavioral assertions** (Given/When/Then), not step descriptions
     - ✅ `Given empty cart, When checkout, Then return 400 with code=CART_EMPTY`
     - ❌ `Test that checkout function handles empty cart correctly`

2. **Fold the red step into the implement task** — never split the red step into its own task, and never make another task block the implement task for it. A red test that lands on main alone turns `bun run typecheck` red for every concurrent session, and a test task that blocks its implementer can never satisfy `lore done`'s floors. One task carries the whole cycle:
   - Write the scenarios into the implement task's own content, under a `Scenarios:` heading:
     ```
     Scenarios:
     - {scenario 1, Given/When/Then format}
     - {scenario 2, ...}

     Red-first: capture the failing tests before implementing, then capture the pass.
     ```
   - Add the implement task's test file path to its `--anchor` list.
   - Declare the task red-first: `lore red-first <impl-task>`.

3. **No extra dependency edges** — the red step adds no task and no `blocks` edge. The implement task keeps only the prerequisites it already had.

   The implementer then runs, inside its own worktree, in this order:
   1. write the failing tests; run `lore evidence <impl-task> --oracle test --command "<cmd>" --result expected-fail --capture` (the runner records the red);
   2. implement until green;
   3. `lore verify` (or `lore evidence ... --result pass --capture`) records the pass;
   4. commit test and implementation together, so the red never lands on main alone; after landing, `lore done <impl-task>` archives it.

**Output**:
```
**[TDD_INJECTION]** impl tasks: N | red-first declared: N | scenarios total: M | avg per task: M/N
```

**Anti-pattern guards**:
- scenario count < the implement task's AC count → warn "insufficient test coverage"
- scenarios contain implementation details like "call function X" → warn "tests should not anchor to implementation"
- impl AC changed but scenarios not updated → the lore-reader audit (8.3) should flag as stale

# 6. Critical Path Analysis
- After task docs + blocks links are created, identify the critical path:
  1. Map all blocks links as a DAG (directed acyclic graph). The graph may have multiple
     roots (tasks with no blockers). Start critical path calculation from ALL root nodes.
  2. For each path from any root to the final task, sum the estimates (S=1, M=2, L=3, XL=4 session-units)
  3. The longest path = critical path (determines plan duration). With multi-root DAGs,
     parallel branches reduce total duration — only the longest branch counts.
  4. Tasks NOT on the critical path have slack (can be delayed without affecting plan duration)
- Mark critical path tasks: `lore set <task> --priority critical` (or high) — priority is
  the stored scheduling signal; readiness stays computed
- Record the path in the plan doc's Critical Path section (update the content file, re-set)
- Output: `**[CRITICAL_PATH]** duration: {N} session-units | path: task-a → task-b → task-c → ... | slack tasks: {count}`
- If critical path has an XL task → split before proceeding (XL violates INVEST "Small")

# 7. Link to upstream docs
- The plan's parent is already the spec (step 4). Add the remaining edges:
- lore link <plan> <spec> --type=implements
- lore link <adr> <plan> --type=informs          # each ADR found in step 1
- lore link <plan> <related-doc> --type=relates-to  # anything else load-bearing

# 8. Plan Validation Gate

# 8.1. Structural check
- lore ready <plan> --json → verify:
  - every task appears in the report (none orphaned off the plan)
  - initial ready set is non-empty (at least one root task is ready)
  - anchor_conflicts[] is empty (no two parallel-intended tasks share anchors without a blocks link)
  - no cycle symptoms (a nonempty plan with an empty ready set and no archived tasks = cycle in blocks links)

# 8.2. Cross-Artifact Coverage Check
- lore ac list <spec> → extract all declared AC ids
- Compare against task tree → check each spec AC id appears in ≥1 task's Covers field
- Check for orphan tasks (tasks not traceable to any spec AC or explicit supporting rationale)
- Output: `**[COVERAGE]** spec ACs covered: X/Y | orphan tasks: N`
- If coverage < 100% → create missing tasks or justify gap before proceeding
- If orphan tasks > 0 → review: either link to a requirement or remove

# 8.3. Independent review — one lens of the single S3 bundle review
- Do NOT dispatch a reviewer per plan. When EVERY plan of the initiative exists
  as a draft, the S3 bundle review dispatches lore-reader ONCE over all of
  them (plus their specs) with this 5-dimension task-quality audit as its plan lens:
  1. executability — can a cold-start implementer execute each task from its content alone?
  2. ac_oracle_binding — is every AC verifiable by a named oracle (tsc/test/lint/build/e2e/script)?
  3. context_sufficiency — Approach + Source + Covers present where required?
  4. atomicity — INVEST-compliant, no XL, no under-decomposed grab-bags?
  5. dependency & anchor safety — every blocks edge artifact-justified; anchors declared
     and non-overlapping for parallel tasks?
- Verdict = BLOCK or NEEDS_WORK → fix in one pass, re-review only what changed (S3: max 2 rounds total)
- Verdict = PASS → proceed
- **DoR check**: verify every task meets Definition of Ready (see SKILL.md § Definitions)
- **Risk validation**: verify all H-impact risks have mitigation tasks in the tree

# 8.4. Estimation Summary
- Sum all task estimates per phase and for the full plan:
  - Output: `**[ESTIMATION]** Total: {N} session-units | Phase 1: {n1} | Phase 2: {n2} | ... | Critical path: {cp} session-units`
  - If total > 10 session-units → warn user: large plan, consider splitting into sub-plans
  - If critical path > 6 session-units → warn user: long critical path, review parallelization opportunities

# 8.5. Overlap Review (semantic — AI layer, not gate)
- Use ST reasoning to scan the task tree for semantic overlap:
  1. Compare each pair of tasks: do they target the same file/module/concept?
  2. Check for duplicate AC coverage: does the same spec AC map to >1 task without differentiation?
  3. Check for near-identical intents: tasks with similar titles in different phases
- Output: `**[OVERLAP_CHECK]** duplicates: N | near-duplicates: N`
- If duplicates > 0: merge or remove before proceeding
- If near-duplicates > 0: add clarifying Scope.in/Scope.out to each task's content

# 8.6. Promote the plan — in the S4 approval batch, after its specs
- lore approve <plan>   # only after the user's single S4 approval; specs/ADRs first
- This fires the deterministic plan-promote gate: spec-tier ancestor must be approved
  with ≥1 structured AC. Exit 4 + feeding pack = fix per the pack (usually: the spec
  is unapproved or missing ACs — route the gap upstream per step 1.1), then retry.
  ⛔ Never LORE_GATE_BYPASS=1 without explicit user say-so.

# 8.7. User confirmation — the single S4 approval, not a per-plan stop
- Contribute to the S4 bundle summary: lore tree <plan> (tasks under phase headers),
  Invariants + Risk Register + Critical Path + Estimation Summary + reviewer
  verdict + coverage check + chosen/rejected strategy + pre-registered branches
- The user approves the whole bundle once; no separate per-plan confirmation
- lore ready <plan> --json → show first ready tasks (critical path tasks highlighted)
```

## Quality Rules — INVEST Complete

All 6 INVEST criteria are enforced:

- **Independent**: Can verify alone — no hidden coupling to other tasks' internal state
- **Negotiable**: `Scope-Alt` field documents what can be descoped/deferred without blocking the plan
- **Valuable**: Delivers a testable outcome — not just "in progress on X" but "X works and passes AC"
- **Estimable**: `Estimate: S|M|L|XL` is required — if you can't estimate, you don't understand it enough (split into [Plan] + [Implement])
- **Small**: ≤1 session preferred, ≤2 sessions max — `XL` tasks must be split
- **Testable**: `AC:` criteria are required — each criterion must be verifiable (not "works well" but "returns 200 with valid JWT")

### Additional quality rules:
- **No implement task without Approach**: every implement task must have `Approach:` + `Source:` in content. If approach unknown at plan time → split into [Plan] + [Implement] two-task pattern
- **Invariants = verifiable**: "Follow best practices" is NOT an invariant. "All API paths follow /api/v1/{resource}" IS.
- **Phase sizing**: 3-5 tasks, completable in ~1 session, independently verifiable
- **Skill traceability**: task title format: `[Skill:xxx] Description`
- **Risk-linked**: H-impact risks need at least one mitigation task
- **Anchor honesty**: anchors describe what the task will actually touch — an undeclared conflict is invisible to the anchor-overlap gate

## Required Output

- lore plan doc created (with Invariants + Risk Register + Exit Criteria in content), approved in the S4 batch (plan-promote gate passed)
- Phases declared + all task docs created (with estimates, anchors, priorities, blocks links)
- Upstream docs linked
- **Risk register displayed** (count by impact level, mitigation task links)
- **Critical path identified** (longest dependency chain, total session-units)
- **Estimation summary** (per-phase and total session-units)
- **Bundle-review verdict displayed** (PASS + round count)
- Task tree included in the single S4 approval summary
- First ready tasks shown (`lore ready <plan> --json`, critical path tasks highlighted)

## Dual Validation — pre-exec and post-exec

Validation happens at **two** points:
1. **Pre-execution** (step 8): `lore ready --json` structural check + coverage check +
   independent lore-reader audit + the deterministic plan-promote gate → catches missing
   coverage, weak AC, unsplit tasks, anchor conflicts BEFORE any dispatch
2. **Post-execution** (once, at the END of the initiative — all its plans in parallel; a
   pre-registered pilot plan is the only one assessed as it closes): `lore assess <plan> [--diff <git-range>]` —
   LLM-as-judge grades the plan's evidence trail against the spec's ACs and persists the
   verdict as an assessment knowledge doc linked to the plan

### Pre-completion flow (automated in autopilot and end-of-plan):
1. `lore verify <plan>` → attested runs of every script-mode AC (exit code decides; CI adds `--allow-new-commands`)
2. `lore assess <plan> --diff <range>` → output `**[GAP_ANALYSIS]** overall: {verdict} | issues: {list or NONE}`
3. Coverage backtrack: `lore ac list <spec>` vs evidence `--ac` refs → `**[FEATURE_BACKTRACK]** covered: X/Y | missed: {list or NONE}`
4. DoD checklist: verify all DoD conditions from SKILL.md are met
5. Estimation accuracy: compare actual sessions per phase vs. estimated → `**[ESTIMATION_ACCURACY]** Phase 1: estimated {e} actual {a} | ...`
6. Risk register review: all risks either mitigated/accepted/not-triggered → `**[RISK_FINAL]** mitigated: {n} | accepted: {n} | triggered: {n} | open: {n}`
7. If issues found → warn user before declaring plan complete
