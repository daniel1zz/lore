# Mode: code - Multi-Perspective Code Review

**Purpose**: Parallel specialist review for comprehensive, unbiased code assessment

## Supplementary References

- **MANDATORY**: Read `references/code-review-checklist.md` for detailed review criteria.
- **CONDITIONAL**: If feature-spec found in Step 4, also read `references/ears-verification.md` for EARS requirement verification.

## Phase 1: Context & Preparation (single agent)

```yaml
workflow:
  1_context:
    action: "Understand PR context (description, linked issues, related docs)"
    tools: [github pull_request_read, lore search]

  2_automation_check:
    action: "Ask user if linter/type-checker has been run; suggest if not"
    recommend: "ESLint/Biome, TypeScript strict, project-specific linter"
    note: "Don't duplicate what automated tools already catch"

  3_doc_check:
    action: "For unfamiliar libraries in changed code, consult official docs"
    tools: [context7 query-docs, mcp-deepwiki ask_question]

  4_feature_spec:
    action: "⛔ MANDATORY: Search the lore corpus for feature-spec and approved ADRs related to code under review"
    steps:
      - "lore search \"{keywords from changed files/PR title}\" --type spec --json (filter results to extra.spec_kind = \"feature\")"
      - "lore search \"{keywords}\" --type adr --json (limit 3, approved/active status); lore search \"{keywords}\" --type knowledge --json for retros"
    if_found:
      - "Load full spec content via `lore get <slug> --resolve-mdx` — extract AC section (`lore ac list <slug>`)"
      - "Include spec AC + approved ADR titles in review brief for ALL specialist subagents"
      - "Correctness Reviewer MUST verify code against spec AC (Stage 1)"
    if_not_found:
      - "Log: 'No feature-spec found — standard review only'"
    rationale: "Without spec injection, review cannot verify behavioral correctness — only structural quality"

  5_change_detection:
    action: "Identify changed files — do NOT use git diff. Use session context directly."
    routes:
      plan_completed: "If a lore Plan was executed this session → collect ALL files modified across all plan tasks (from executor agent outputs and task extra.verification_evidence, see `lore evidence <task>`)"
      no_plan: "If no plan → collect files modified in this session (from tool call history: Write, Edit calls)"
    note: "git diff is UNRELIABLE — repo may be untracked, uncommitted, or have no baseline. Always derive file list from session activity."
    output: "List of changed file paths with brief change description per file"

  6_dispatch_decision:
    action: "Classify scale (see SKILL.md §Scale Classification) and decide dispatch strategy"
    inputs: "Changed files list, change descriptions, code domains touched"
    scale_first:
      trivial: "Config/env, typo, dep bump, type-only, <20 changed lines → skip Phase 2 dispatch, do inline quick checklist (D-CODE + D-FUNC only), go directly to Phase 3"
      standard: "Feature code, bug fix, refactor → Correctness always + relevant specialists based on code domains"
      complex: "Cross-module, auth/payments, core domain, state machines, >500 lines → all relevant specialists + Codex cross-engine"
    decide:
      - "Classify scale: trivial / standard / complex"
      - "If standard/complex: which specialists are relevant?"
      - "If complex: Codex cross-engine = YES"
    output: "**[DISPATCH]** Scale: {T/S/C} | {selected specialists} | Codex: YES/NO | Rationale: {brief justification}"
```

Output: **Review Brief** — change description, changed files list (from session context), spec summary (if any), library list, **scale classification**.

## Phase 1.5: Review Reading Strategy

Before dispatching specialists, establish a systematic reading order for understanding the changed code.

```yaml
reading_strategy:
  order:
    1_tests_first:
      action: "Read test files for changed code first"
      rationale: "Tests reveal intended behavior, edge cases, and expected contracts"
      tool: "serena search_for_pattern — find test files matching changed file names"

    2_entry_points:
      action: "Read routes, handlers, exports — the public surface area"
      rationale: "Entry points define WHAT the code does; internals define HOW"
      tool: "serena get_symbols_overview — identify exported symbols"

    3_core_logic:
      action: "Read business rules, state transitions, data mutations"
      rationale: "This is where bugs, security issues, and performance problems live"
      tool: "serena find_symbol — read function bodies of core logic"

    4_supporting_code:
      action: "Scan utilities, helpers, config, types"
      rationale: "Usually lower risk, but can hide subtle issues (type widening, config drift)"

  context_depth:
    rule: "Review diff + 1-level context (direct callers and callees of changed functions)"
    tool: "serena find_referencing_symbols — find callers; serena find_symbol — read callees"
    pre_existing:
      rule: "Flag pre-existing issues ONLY if they interact with new code"
      label: "Mark as '[PRE-EXISTING]' with one severity level lower than normal"
      rationale: "Reviewer's job is the diff, not a full codebase audit"

  include_in_brief:
    action: "Add reading strategy summary to Review Brief for specialists"
    output: "**Reading Order**: {list of files in recommended review order with brief rationale}"
```

## Phase 2: Adaptive Specialist Dispatch

### Dispatch Decision

After Phase 1 analysis, determine which specialists to launch based on **what the code does**, not file/line counts.

**Correctness Reviewer is always included.** All others are dispatched only when the change content warrants it.

Use `Agent` tool — send ALL selected subagents in a single message for true parallel execution.
For Codex (when selected): use `Bash` tool with `codex exec --full-auto` in parallel with Claude subagents.

Output: `**[DISPATCH]** {selected specialists} | Codex: YES/NO | Rationale: {brief justification}`

### Available Specialists

| # | Specialist | Identity Prompt | When Relevant |
|---|-----------|----------------|--------------|
| 1 | **Correctness Reviewer** | "You are a logic and correctness expert. Your job is to find bugs, missing edge cases, and specification violations. Use the Latent Bug Discovery Procedure." | **Always.** Logic errors, off-by-one, null paths, missing error handling, race conditions, spec violations. **MUST follow Latent Bug Discovery Procedure (see below).** |
| 2 | **Security Reviewer** | "You are a security engineer reviewing for vulnerabilities. Think like an attacker." | Auth, input handling, data access, crypto, API endpoints, user-facing surfaces. |
| 3 | **Performance Reviewer** | "You are a performance engineer. Find what will be slow at scale. Use the Performance Discovery Procedure." | DB queries, loops over data, rendering logic, API calls, resource-intensive operations. **MUST follow Performance Discovery Procedure (see below).** |
| 4 | **Maintainability Reviewer** | "You are a senior engineer focused on long-term code health and team productivity." | Non-trivial logic, new abstractions, SDK/library usage, test coverage gaps. |
| 5 | **Architecture Reviewer** | "You are a software architect focused on structural integrity, SOLID principles, and layering discipline." | Cross-module changes, new modules, dependency changes, layer boundary touches. |

### Codex Cross-Engine Reviewer

**Purpose**: Cross-engine second opinion using a different AI model to counter single-model self-consistency bias.
**When to include**: High-risk changes (auth, payments, core domain logic, complex state machines, security-sensitive code), or when you judge the change complexity warrants a second engine. Not needed for config, docs, simple UI, or straightforward CRUD.

**Execution method**: Write the review prompt to a temp file, then run via Bash:
```bash
cat > /tmp/codex-review-prompt.txt << 'PROMPT'
{codex review prompt — see template below}
PROMPT
codex exec --full-auto - < /tmp/codex-review-prompt.txt
```

**Codex Review Prompt Template**:
```
You are a senior code reviewer performing an independent second-opinion review.
Review the following code changes comprehensively — correctness, security, performance, maintainability, architecture.

## Context
**PR/Change**: {title + description}
**Changed Files**: {file list}
**Spec**: {feature-spec summary or "No spec found"}

## Your Task
1. Read each changed file in the working directory (use the file paths below)
2. Review ALL changes from a holistic perspective
3. Focus especially on: logic bugs, security vulnerabilities, performance bottlenecks, and architecture violations
4. Flag issues that might be missed by reviewers who only see individual quality dimensions

Changed file paths:
{list of changed file paths, one per line}

For each finding, provide:
- **Severity**: BLOCKER / MAJOR / MINOR / NIT
- **File**: `path:line`
- **Issue**: What's wrong
- **Fix**: How to fix it

Also note 1-2 positive highlights.

Output as a structured findings list. Be concise — 800 words max.
```

**Parallel dispatch**: The Codex `Bash` call MUST be sent in the SAME message as the 5 Claude `Agent` calls for true parallelism.

### Latent Bug Discovery Procedure (Correctness Reviewer)

The Correctness Reviewer MUST follow this systematic procedure instead of relying solely on pattern matching:

```yaml
latent_bug_discovery:
  step_1_state_transition_walkthrough:
    action: "For each stateful operation in changed code, enumerate all possible states"
    check:
      - "What states can this object/entity be in? (e.g., pending, active, cancelled)"
      - "Are all transitions valid? (e.g., cancelled → active should be impossible)"
      - "What happens if an operation is called in an unexpected state?"
      - "Are state invariants preserved across all transitions?"
    tool: "serena find_symbol — read the stateful class/module to understand all states"

  step_2_invariant_identification:
    action: "Identify what must ALWAYS be true, then verify code maintains it"
    examples:
      - "Balance must never go negative"
      - "Array length must match count field"
      - "Start date must be before end date"
      - "Unique constraint must hold across all paths"
    check: "For each invariant: trace all code paths that could violate it"

  step_3_error_path_trace:
    action: "For each operation that can fail, trace the error path completely"
    per_operation:
      - "What state is left after failure? (partial writes? dangling references?)"
      - "What does the caller see? (error type, message, recovery options)"
      - "Is cleanup performed? (rollback, resource release, partial undo)"
      - "Is the error propagated correctly? (not swallowed, not double-wrapped)"
    red_flag: "catch block that logs but doesn't re-throw or recover → likely bug"

  step_4_boundary_conditions:
    action: "Test mental model at boundaries"
    conditions:
      - "Empty collection (0 items) — does the code handle it?"
      - "Single item — is off-by-one possible?"
      - "Maximum size — does the code scale or crash?"
      - "Null/undefined input — handled or will throw?"
      - "Concurrent access — race condition possible?"
      - "Timeout/deadline — what happens when time runs out?"

  step_5_what_breaks_under:
    action: "Ask 'what breaks under...' for each changed function"
    scenarios:
      - "...retry? (idempotency — will retrying cause duplicates or corruption?)"
      - "...timeout? (cleanup — are resources released? is caller notified?)"
      - "...partial failure? (atomicity — is state consistent if step 3 of 5 fails?)"
      - "...concurrent modification? (locking — is there a race between read and write?)"
      - "...out-of-order delivery? (ordering — does the code assume sequence?)"
      - "...unexpected input shape? (validation — is Zod/schema checked at boundary?)"
```

### Performance Discovery Procedure (Performance Reviewer)

The Performance Reviewer MUST follow this systematic procedure:

```yaml
performance_discovery:
  step_1_identify_hot_paths:
    action: "Classify changed code by execution frequency"
    tiers:
      per_request: "Runs on every HTTP request / API call — highest scrutiny"
      per_event: "Runs on user events (click, submit, message) — high scrutiny"
      per_render: "Runs on every React render / DOM update — high scrutiny"
      per_schedule: "Runs on cron/schedule — medium scrutiny"
      per_deploy: "Runs once at startup/deploy — low scrutiny"
    output: "Classify each changed function into a tier"

  step_2_trace_per_hot_path:
    action: "For each hot-path function, trace resource consumption"
    per_function:
      allocations: "How many objects/arrays are created per call? (new Object, spread, map/filter chains)"
      io_calls: "How many I/O operations? (DB queries, HTTP calls, file reads) — count them"
      complexity: "What's the algorithmic complexity? (O(n), O(n^2), O(n log n))"
      data_size: "What's the expected data size? Does it grow with users/time?"
    red_flags:
      - "Loop containing await (sequential I/O — should batch or parallelize)"
      - "N+1 query pattern (query per item in a loop)"
      - "Unbounded array growth (no pagination, no limit)"
      - "Synchronous operation blocking event loop"

  step_3_optimization_check:
    action: "For each hot-path issue, check if it can be optimized"
    strategies:
      batch: "Can multiple I/O calls be combined into one? (batch query, bulk insert)"
      cache: "Is the result reusable? (memoize, HTTP cache, Redis, in-memory cache)"
      defer: "Can this be done lazily or asynchronously? (lazy loading, background job)"
      parallelize: "Can independent operations run concurrently? (Promise.all, concurrent queries)"

  step_4_resource_lifecycle:
    action: "Verify resources are properly managed"
    check:
      - "DB connections: returned to pool after use? (using/finally pattern)"
      - "Event listeners: removed on cleanup? (removeEventListener, unsubscribe)"
      - "Timers: cleared on unmount/destroy? (clearTimeout, clearInterval)"
      - "File handles: closed after use?"
      - "WebSocket connections: closed on disconnect?"
    red_flag: "Resource created in a function called repeatedly without cleanup → memory leak"
```

### Subagent Prompt Template

Each subagent receives the base template PLUS its specialist-specific checklist (see table below).

#### Specialist-Specific Context (MUST include in dispatch prompt)

| Specialist | Include in Prompt |
|-----------|------------------|
| **Correctness** | Latent Bug Discovery Procedure (§Phase 2 above — state transitions, invariants, error paths, boundaries, "what breaks under") |
| **Security** | Key patterns from `references/security-patterns.md` (injection detection, auth issues, data exposure — ~50 lines) |
| **Performance** | Performance Discovery Procedure (§Phase 2 above — hot path tiers, resource tracing, optimization, lifecycle) |
| **Maintainability** | SDK checklist (first 2 checks from `references/code-review-checklist.md`: reinventing_the_wheel + sdk_best_practice) + test coverage section |
| **Architecture** | Dependency direction rules from `references/mode-architecture.md` §1 step 2 (layered/hexagonal/modular allowed/forbidden) |

#### Base Template

```
## Specialist Role
{Identity Prompt}

## Review Brief
**PR**: {title + description}
**Changed Files**: {file list with line counts}
**Spec**: {feature-spec summary or "No spec found"}
**Libraries in Changed Code**: {list of third-party imports}

## Specialist Checklist
{Insert the specialist-specific content from the table above}

## Changed Code
{Read each changed file directly via Read tool. Do NOT rely on git diff — files may be untracked or uncommitted. For each file, include the full content or relevant sections.}

## Your Task
Review ALL changed code from your specialist perspective. Follow your Specialist Checklist systematically.

For each finding, provide:
- **Severity**: BLOCKER / MAJOR / MINOR / NIT
- **File**: `path:line`
- **Issue**: What's wrong
- **Fix**: How to fix it (code suggestion if possible)
- **Ref**: Link to docs/best-practice if applicable

Also note:
- **Positive Highlights**: Good patterns worth calling out (1-2 max)
- **SDK Check** (Maintainability only): Any hand-written logic that a mature library solves?
- **Architecture Check** (Architecture only): SOLID violations? Layer boundary breaches? If DDD project (check the lore corpus for domain ADRs): aggregate/entity/VO pattern compliance?

Output as structured findings list. 500 words max per specialist.
```

## Phase 3: Synthesis & Unified Report

After all dispatched reviewers return, synthesize into unified review:

### Synthesis Rules

> **SSOT**: Apply rules from SKILL.md §Synthesis Rules (5 rules: Dedup → Cross-validate → Stage ordering → Severity calibration → Cross-engine). For trivial scale, synthesize inline findings directly without specialist merge.

### UI Change Detection
If changed files include CSS, styled-components, UI components, layout, or theme files:
- Add note suggesting visual verification: `Skill("review","ui")`

### Output Format

```markdown
## Review Summary
**Dispatch**: {selected specialists} | Codex: {YES/NO} | Rationale: {why}

| Reviewer | Blockers | Major | Minor | Nits |
|----------|----------|-------|-------|------|
| {for each dispatched specialist} | N | N | N | N |
| Codex (if dispatched) | N | N | N | N |
| **Total** | **N** | **N** | **N** | **N** |

**Verdict**: ✅ Approve / ⚠️ Approve with comments / 🚫 Request changes

## Stage 1: Spec Compliance (from Correctness Reviewer)
[Findings — must resolve before Stage 2]

## Stage 2: Code Quality (all reviewers)
[Merged findings sorted by severity]

## Findings
### 🚫 BLOCKER: [title]
**File**: `path:line` | **Reviewer**: [who found it] | **Issue**: ... | **Fix**: ...

### ⚠️ MAJOR / 💡 MINOR / 🔍 NIT: [title]
(same format)

## SDK Assessment (from Maintainability Reviewer)
| Hand-written Domain | Recommended Library | Severity |
|-------------------|-------------------|----------|

| Library | Usage Issue | Best Practice (per docs) | Severity |
|---------|-----------|------------------------|----------|

## Cross-Engine Analysis (LARGE only)
### 🔍 Codex-Only Discoveries
[Issues found by Codex but missed by all Claude specialists — high-value signal]

### ⚡ Cross-Engine Consensus
[Issues found by both Claude and Codex — highest confidence]

### ⚖️ Contradictions
[Claude and Codex disagree — flag for human judgment]

## Cross-Specialist Insights
[Issues flagged by 2+ Claude specialists — highest priority]

## Positive Highlights
[Good patterns worth noting]
```

## Phase 4: Completeness Verification (Exit Criteria)

After synthesis, verify the review is complete before outputting the final report.

```yaml
completeness_verification:
  step_1_coverage_gate:
    action: "Verify every changed file was reviewed by at least 1 specialist"
    procedure:
      - "List ALL changed files from Phase 1 step 5"
      - "For each file: check if any specialist mentioned it in their findings or confirmed no issues"
      - "If any file was missed → run a focused review on it now"
    output: "**[COVERAGE]** {n}/{total} files reviewed ({pct}%)"
    threshold: "100% — review cannot complete with uncovered files"

  step_2_confidence_assessment:
    action: "Assign confidence level to each finding"
    levels:
      HIGH: "Tool-verified (Serena trace, tsc error, linter finding) OR reproducible code path fully traced"
      MEDIUM: "Code inspection with logical reasoning, but not tool-verified"
      LOW: "Heuristic pattern match, uncertain without runtime verification"
    calibration:
      - "Cross-engine consensus (Claude + Codex) → bump to HIGH"
      - "2+ Claude specialists independently found same issue → bump one level"
      - "Single-engine LOW confidence → cap severity at NIT"

  step_3_verdict_check:
    action: "Apply verdict thresholds from SKILL.md §Verdict Thresholds"

  step_4_self_check:
    action: "Final completeness checklist — all must be checked before output"
    items:
      - "[ ] All changed files assessed (coverage gate passed)"
      - "[ ] All findings have file:line evidence"
      - "[ ] All findings have confidence level assigned"
      - "[ ] Spec compliance checked (EARS if feature-spec exists)"
      - "[ ] SDK assessment completed (Maintainability Reviewer)"
      - "[ ] Downstream handoff actions identified (if any BLOCKERs/MAJORs)"
      - "[ ] Cross-engine analysis included (if LARGE scale)"
      - "[ ] Verdict threshold applied correctly"
```

## Primary Tools

```yaml
tools:
  code_understanding:
    - serena: find_symbol, get_symbols_overview, find_referencing_symbols
  pr_interaction:
    - github: pull_request_read (get_diff, get_files, get_review_comments)
    - github: add_comment_to_pending_review
  doc_consultation:
    - context7: resolve-library-id, query-docs
    - mcp-deepwiki: ask_question
  spec_verification:
    - lore: search, get
```
