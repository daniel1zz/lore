# Mode: Create

**Purpose**: Create a new plan with phases + task docs in the lore corpus

## Triggers

- Cross-session work OR significant complexity/risk/ambiguity OR user requests plan
- Workflow ANALYZE routes here when complexity = complex

## Complexity Routing

For small plans (≤3 tasks, single session, clear scope), skip the full ceremony:
- Skip: Risk Register (2.1), Critical Path (6), Estimation Summary (8.4), Overlap Review (8.5)
- Keep: Invariants (2), task creation (5), validation gate (8), user confirmation (8.7)
- This avoids overhead that doesn't pay off for simple, well-understood work.

## Workflow

```yaml
# 1. Gather context — find upstream docs
- Hook-injected bootstrap (lore bootstrap --json ran at SessionStart) → active_plans, armed_gates, pending_reviews — consume, don't re-call
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
#         (resolve before step 2); verify status=approved and ≥1 structured AC.
#         Spec approved but has 0 ACs → the gap belongs to the SPEC AUTHOR:
#         report it upstream (Skill("design") owns `lore ac add`), don't
#         self-author ACs silently.
#   NO  → ⛔ STOP. Invoke Skill("design") to create the spec first —
#         it runs `lore feed spec-create --parent <prd>` then
#         `lore create spec --title ... --parent <prd> [--kind feature|tech|design]`
#         and declares ACs via `lore ac add`.
#         After spec created + approved → re-enter step 1.1.
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
#         (lore create adr --supersedes <old-adr> invalidates the old one loudly).
#   NO  → proceed to step 2.
#
# Gate summary:
#   Feature plan: PRD (exists + covers) → spec (approved, ≥1 AC) → plan
#   Technical plan: tech spec/ADR (exists + current) → plan
#   Each link is a dedicated skill with its own quality standards.
#   The plan-promote gate re-checks this chain deterministically at approve time.

# 1.2. ⛔ Clarification Sprint (HARD GATE — REFUSE decomposition without it)
#
# ⛔ REFUSE to create task docs until minimum dimension coverage is met.
# This is NOT optional. "Upstream docs are detailed enough" is NOT a valid skip reason.
# Upstream docs capture WHAT to build; clarification captures HOW the user wants it built.
#
# Minimum dimension coverage by complexity:
#   medium plan: >= 5 dimensions covered
#   complex plan: >= 8 dimensions covered
# Small plans (≤3 tasks): skip this step.
#
# Dimension checklist — ask user about each applicable dimension:
#   □ Tech stack & framework constraints
#   □ Data model / storage approach
#   □ Auth & permissions model
#   □ Third-party dependencies / existing libraries to leverage
#   □ Error handling & failure modes
#   □ Testing strategy (unit/integration/e2e)
#   □ Deployment & infrastructure
#   □ Performance / scalability requirements
#   □ Security considerations
#   □ Migration / backward compatibility
#
# Rules:
#   - One question per message (not batched)
#   - Prefer closed-form questions (AskUserQuestion with options)
#   - For "Third-party dependencies": MUST search npm/context7/deepwiki
#     BEFORE asking — present findings as options, not open-ended
#   - Track: dimension_name + question + answer
#   - Only proceed to 1.3 after minimum coverage met
#
# Anti-pattern guard:
#   ⛔ "The PRD/spec already covers these dimensions" — PRD/spec define
#      WHAT; clarification validates the user's preferences for HOW.
#      Example: PRD says "5-min cache" but user may prefer "invalidate on write".
#   ⛔ "I'll use ST to answer these myself" — ST is for AI reasoning, NOT for
#      substituting user input. If a question is about user preference, ASK THE USER.

# 1.3. Strategy Exploration (MANDATORY for complex, RECOMMENDED for medium)
# Use Sequential Thinking (mcp__sequential-thinking__sequentialthinking) to
# generate >= 2 decomposition strategies. Each strategy includes:
#   - Name (e.g., "Vertical Slices", "Horizontal Layers", "Risk-First")
#   - Phase outline (titles + sequence)
#   - Pros / Cons
#   - Which Skills each phase leverages
#   - Estimated total phase count
#
# Present comparison to user with recommendation. User selects strategy.
# Record: chosen strategy name + rationale → goes into the plan doc's
# Decisions Log at creation time.
#
# Common archetypes (non-exhaustive):
#   - Vertical Slices: each phase delivers end-to-end functionality
#   - Horizontal Layers: backend → frontend → integration → deploy
#   - Risk-First: spike unknowns → core features → polish
#   - Dependency-Ordered: build foundation → dependents → integration
#   - TDD-Driven: test infrastructure → red-green per feature → refactor
#
# Enforcement:
#   - complex: MUST present >= 2 strategies (HARD GATE)
#   - medium: MUST present >= 2 strategies (HARD GATE — upgraded from advisory)
#   - small: skip
#
# ⛔ User Selection Gate:
#   REFUSE to create the plan doc until user has selected a strategy.
#   Present strategies via AskUserQuestion with:
#     - Strategy name + phase outline as preview
#     - Pros/Cons in description
#     - Recommended option marked
#
#   Anti-pattern guard:
#   ⛔ "Interface-First is clearly optimal, no need to ask" — present it as
#      the recommended option, but the user MUST see and select it.
#      The act of choosing creates ownership; the act of skipping creates drift.
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
#   4. Present findings to user with recommendation
#   5. Only AFTER research → create the phase's task docs
#   6. Non-trivial conclusions worth reuse → lore create knowledge --sub-type research
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
     - The [Plan] task's AC includes: "Update the [Implement] task content with Approach field (lore set <task> --content-file ...)"

**Rule**: implement task without Approach = not ready for execution. The lore-reviewer audit (8.3) will flag it.

# 4. Create plan document
- lore feed plan-promote                       # feed-before-produce: pull the governing rules the promote gate will enforce
- Write plan content to a temp file (Overview, Invariants, Risk Register, Estimation
  Summary, Critical Path placeholder, Exit Criteria, Phase Descriptions,
  Governance Mode, Decisions Log — see plan-file-format.md)
  - **Governance Mode**: `attended` (default) or `unattended`. Attended = phase gate
    requires user confirmation. Unattended = auto-proceed (autopilot sets this).
    Invariant violations hard-block regardless of mode.
- lore create plan --title "{title}" --parent <spec-slug> --content-file /tmp/plan-content.md --json
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
    --content-file /tmp/task-content.md --json
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
    only see what is DECLARED. Undeclared conflicts are invisible to it.
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

2. **Generate preceding test tasks** — create a paired test task for each implement task:
   ```
   lore create task --title "[Skill:test] {feature} — RED test scenarios" \
     --parent <plan> --plan-id <plan> --phase "{same phase as impl}" \
     --anchor <test-file-path> --content-file /tmp/test-task.md
   ```
   test task content:
   ```
   Estimate: S (test tasks are typically S, same phase as impl)
   Source: AC of task-{impl-slug}
   TDD-Role: red | Paired-Impl: task-{impl-slug}

   Scenarios:
   - {scenario 1, Given/When/Then format}
   - {scenario 2, ...}

   AC:
   - All scenarios written as executable tests
   - Run tests → all RED (must fail)
   - Failure reason is "missing implementation", not "test bug"
   ```

3. **Wire dependency** — `lore link <test-task> <impl-task> --type=blocks`
   - test blocks impl: RED before GREEN
   - Preserves existing cross-task blocks edges (the test task inherits the impl task's original prerequisites — re-link them onto the test task)

**Output**:
```
**[TDD_INJECTION]** impl tasks: N | test tasks generated: N | scenarios total: M | avg per task: M/N
```

**Anti-pattern guards**:
- test task scenario count < paired impl task AC count → warn "insufficient test coverage"
- scenarios contain implementation details like "call function X" → warn "tests should not anchor to implementation"
- impl AC changed but scenarios not updated → the lore-reviewer audit (8.3) should flag as stale

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

# 8.3. Independent Review Loop (Self-Verification Paradox mitigation)
- Dispatch the lore-reviewer agent for a manual 5-dimension task-quality audit:
  1. executability — can a cold-start implementer execute each task from its content alone?
  2. ac_oracle_binding — is every AC verifiable by a named oracle (tsc/test/lint/build/e2e/script)?
  3. context_sufficiency — Approach + Source + Covers present where required?
  4. atomicity — INVEST-compliant, no XL, no under-decomposed grab-bags?
  5. dependency & anchor safety — every blocks edge artifact-justified; anchors declared
     and non-overlapping for parallel tasks?
- Verdict = BLOCK or NEEDS_WORK → fix the flagged issues, request re-review (max 2 iterations)
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

# 8.6. Promote the plan
- lore approve <plan>
- This fires the deterministic plan-promote gate: spec-tier ancestor must be approved
  with ≥1 structured AC. Exit 4 + feeding pack = fix per the pack (usually: the spec
  is unapproved or missing ACs — route the gap upstream per step 1.1), then retry.
  ⛔ Never LORE_GATE_BYPASS=1 without explicit user say-so.

# 8.7. User confirmation
- lore tree <plan> → display task tree (grouped under phase headers) for user review
- Display: Invariants + Risk Register + Critical Path + Estimation Summary +
  reviewer verdict + coverage check
- User must confirm before execution begins
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

- lore plan doc created (with Invariants + Risk Register + Exit Criteria in content), approved (plan-promote gate passed)
- Phases declared + all task docs created (with estimates, anchors, priorities, blocks links)
- Upstream docs linked
- **Risk register displayed** (count by impact level, mitigation task links)
- **Critical path identified** (longest dependency chain, total session-units)
- **Estimation summary** (per-phase and total session-units)
- **lore-reviewer verdict displayed** (PASS + iteration count)
- Task tree displayed (`lore tree <plan>`) for user confirmation
- First ready tasks shown (`lore ready <plan> --json`, critical path tasks highlighted)

## Dual Validation — pre-exec and post-exec

Validation happens at **two** points:
1. **Pre-execution** (step 8): `lore ready --json` structural check + coverage check +
   independent lore-reviewer audit + the deterministic plan-promote gate → catches missing
   coverage, weak AC, unsplit tasks, anchor conflicts BEFORE any dispatch
2. **Post-execution** (when all tasks done): `lore assess <plan> [--diff <git-range>]` —
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
