---
name: lore-bug-hunt
description: "Use when proactively scanning a codebase for latent bugs without running the app: 'hunt bugs', 'find bugs', 'scan for bugs', 'audit this code', 'bug sweep', 'any bugs in this codebase?', '找bug', '代码审计'. NOT for a known reproducible bug (use lore-diagnose), a PR or diff review (use lore-review), or a running app (use lore-dogfood)."
---

# Bug Hunt — Proactive Multi-Agent Bug Discovery

Find bugs before users do. This skill dispatches parallel specialist agents that each look at code through a different lens — logic, boundaries, error handling, async, security, type safety — then aggregates their findings into a severity-ranked report.

**This is NOT for:**
- Known bugs with symptoms → use `/diagnose`
- Reviewing a PR or diff → use `/review`
- Exploratory testing of a running app → use `/dogfood`

**This IS for:** scanning existing code that "works" but may harbor latent defects.

## Phase 1 — Scope the Hunt

Before dispatching agents, determine what to scan. The goal is to give each agent a focused, manageable set of files — not the entire repo.

### Determine scan target

Ask the user if they didn't specify:
- **Targeted**: specific directory, module, or file list
- **Broad**: entire package or codebase (expensive — warn about token budget)

### Build the file manifest

1. List all source files in the target (exclude tests, configs, generated code, node_modules, dist)
2. If > 50 files, prioritize:
   - Files with recent git churn (`git log --since="3 months ago" --name-only --pretty=format:""`)
   - Files with high complexity (long files, deep nesting — a quick `wc -l` + `grep -c 'if\|switch\|try\|catch'` heuristic)
   - Files at architectural boundaries (adapters, composition roots, error handling entry points)
3. Partition files into chunks of ~15-25 files per agent (each agent gets the full list but should focus on their specialty)

### Gather context

Before dispatching, collect context that all agents need:
- Project language, framework, key dependencies (from package.json / pyproject.toml / etc.)
- Architecture notes (CLAUDE.md, README, or similar)
- Error handling patterns in use (error catalog, custom error classes)
- Type system configuration (tsconfig strictness, mypy settings)

## Phase 2 — Dispatch Specialist Agents

There are two execution modes depending on your environment. Pick the one that applies.

### Mode A: Parallel subagents (preferred)

If you can dispatch subagents (you are the orchestrating agent with `Agent()` tool access), launch specialists in parallel. Use `lore-reader` subagent type (read-only code review). Each gets the same file manifest but hunts for their specific category.

Launch **all selected agents in a single turn** so they run concurrently.

### Mode B: Sequential specialist passes (fallback)

If you cannot spawn subagents (you ARE the executing agent), work through each specialist category one at a time. For each category:

1. Read the agent prompt from `references/agent-prompts.md`
2. Use grep/search to find patterns relevant to that specialty
3. Read surrounding context for suspicious hits
4. Collect findings in the structured format
5. Move to the next category

This mode is slower but produces equivalent results — iteration-1 benchmarks showed the sequential approach actually uses fewer tokens (112k vs 143k average) because it avoids duplicating project context across agents.

### Selecting which specialists to dispatch

| Agent | Category | What they look for |
|-------|----------|--------------------|
| **Logic Hunter** | Logic & Correctness | Off-by-one errors, wrong boolean conditions, missing return paths, incorrect state transitions, operator precedence bugs, comparison vs assignment |
| **Boundary Hunter** | Boundary & Edge Cases | Null/undefined access, empty array/string handling, integer overflow, division by zero, index out of bounds, type coercion traps, missing default cases |
| **Error Hunter** | Error Handling | Swallowed exceptions, missing catch blocks, error paths that lose context, silent fallbacks, unreachable error handlers, inconsistent error propagation |
| **Async Hunter** | Concurrency & Async | Missing await, unhandled promise rejections, race conditions, event ordering assumptions, stale closures, concurrent mutation, deadlock patterns |
| **Security Hunter** | Security | Injection vectors (SQL/XSS/command), auth bypass paths, secrets in code/logs, unsafe deserialization, SSRF, path traversal, timing attacks, insecure crypto |
| **Type Hunter** | Type Safety | Unsafe casts (`as any`, `as unknown as X`), missing type guards before narrowing, schema drift between runtime/compile-time, unvalidated external data, overly permissive generics |

**Selection rules:**
- If the user specifies categories (e.g., "only security and async"), dispatch ONLY those. Respect user scope — do not add extras.
- If the user doesn't specify: for ≤15 files, pick the 3-4 most relevant categories based on the code domain. For >15 files, dispatch all 6.
- Read `references/agent-prompts.md` for the exact prompts.

### Agent prompt structure

Each agent prompt must include:

1. **Role**: "You are a [category] specialist. Your sole job is finding [category] bugs."
2. **File list**: The files to scan
3. **Project context**: Language, framework, architecture notes
4. **Output format**: Structured findings (see Phase 3)
5. **Calibration guidance**: "Report only issues you are ≥70% confident are real bugs or will cause bugs under realistic conditions. Do NOT report style issues, minor code smells, or theoretical issues that require exotic conditions."
6. **The "Breaks when" requirement**: Every finding MUST include a concrete, specific scenario describing exactly when and how the bug manifests. Not "could theoretically fail if..." but "when a user does X, this returns Y instead of Z." This is the single most important field — a finding without it is worthless.
7. **Silent-fallback hunting is a first-class category** (shared discipline `../shared/verification-discipline.md`, rule 4): every specialist also flags places where invalid input produces silence-plus-defaults instead of a loud error — unknown/ignored options, out-of-range config values swallowed to defaults, `catch { return null }`, `?? "default"` on required fields. These rarely crash, which is exactly why a scan is the only thing that finds them.
8. **Cheap disprove before report**: before a finding lands in the report, attempt ONE refutation (re-read the callers/guards that would prevent it; check whether a test already pins the behavior). A finding that survives its own refutation attempt reports with higher confidence; one that doesn't is dropped — never padded into the count.
7. **Grep-first approach**: "Do NOT read every file end-to-end. Use grep/search to find patterns relevant to your specialty, then read surrounding context for the suspicious hits. This is faster and more thorough than linear reading."

## Phase 3 — Collect and Aggregate

### Finding format

Each finding must include ALL of these fields:

```
- id: "LOGIC-001" (category prefix + sequential number)
- severity: critical | high | medium | low
- title: Short descriptive title
- location: path/to/file.ts:42-48 (MUST include line numbers)
- description: What the bug is and why it's wrong
- scenario: MANDATORY — concrete "Breaks when" scenario
- suggested_fix: How to fix it (brief but actionable)
- confidence: high | medium
```

### Severity classification

| Severity | Criteria |
|----------|----------|
| **critical** | Data corruption, security vulnerability, crash in production path |
| **high** | Wrong behavior in common user flows, data loss under realistic conditions |
| **medium** | Wrong behavior in edge cases, degraded experience, error masking |
| **low** | Defensive gap unlikely to trigger but violates invariants, potential future breakage |

**Severity discipline:** Once you assign a severity, commit to it. If during analysis you realize a finding is less severe than initially tagged, update the severity rather than leaving the old tag and adding a disclaimer. A finding listed as [high] with a note saying "actually more like medium" confuses the reader.

### Aggregation steps

After all specialists complete:

1. **Parse** each specialist's findings
2. **Deduplicate**: Same file + overlapping line range + similar description → merge, keep higher severity, note which specialists both flagged it (cross-specialist confirmation increases confidence)
3. **Cross-validate**: Findings flagged by 2+ specialists get a confidence boost — note this as "confirmed by [other specialist]". Single-specialist findings at "medium" confidence stay as-is if their scenario is concrete.
4. **Sort**: critical → high → medium → low, then by confidence within each tier
5. **Assign IDs**: Sequential `BUG-001`, `BUG-002`, etc.

## Phase 4 — Generate Report

Output a structured markdown report directly in the conversation.

```markdown
# Bug Hunt Report — [target scope]

**Scan date**: YYYY-MM-DD
**Files scanned**: N across M directories
**Agents dispatched**: N (list which categories)

## Summary

| Severity | Count |
|----------|-------|
| Critical | X |
| High     | Y |
| Medium   | Z |
| Low      | W |
| **Total** | **N** |

## Critical & High Findings

### BUG-001 [critical] — Title
- **Category**: Logic & Correctness
- **Location**: `path/to/file.ts:42-48`
- **Found by**: Logic Hunter (confirmed by Boundary Hunter)
- **Description**: ...
- **Breaks when**: concrete scenario — the single most important field
- **Suggested fix**: ...
- **Confidence**: HIGH

## Medium Findings
### BUG-003 [medium] — Title
...

## Low Findings
### BUG-004 [low] — Title
...

## Scan Coverage Notes
- Logic Hunter: scanned N files, focused on ...
- Error Hunter: scanned N files, focused on ...

## Limitations
- Static analysis only — no runtime verification
- Confidence levels are estimates, not guarantees
- [any scope limitations]
```

### Report quality checklist

Before presenting the report, verify:
- [ ] Every finding has a "Breaks when" field with a concrete user-facing scenario
- [ ] Every finding has file path WITH line numbers
- [ ] Every finding has a suggested fix
- [ ] Summary table counts match actual findings
- [ ] No test files (.test.ts, .spec.ts) appear in findings
- [ ] Severity labels are consistent (no "high" finding with a "actually medium" disclaimer)
- [ ] Scan coverage notes explain what each specialist focused on

## Phase 5 — Next Actions

After presenting the report, offer the user these options:

1. **Deep-dive**: "Want me to trace any specific finding to verify it's real?" — dispatch a focused agent to read the exact code path and confirm/refute
2. **Fix**: "Want me to fix the critical/high issues?" — dispatch implementation agents for each fix
3. **Re-scan**: "Want to scan a different scope or different categories?"
4. **Export**: "Want me to create issues from these findings?" — format as issue-tracker-ready tickets

A clean scan with 0 findings is a valid, valuable result. Don't manufacture findings to justify the scan.

## Configuration Knobs

Users can customize the hunt through natural language:

| User says | Effect |
|-----------|--------|
| "just check security and error handling" | Dispatch only those 2 categories |
| "scan the adapters folder" | Scope to that directory |
| "only show me critical and high" | Filter report to critical+high |
| "keep it quick" | Reduce max files per agent, pick fewer categories |

## Guidance for the Orchestrating Agent

- **You are the orchestrator, not a hunter.** Your job is scoping, dispatching, aggregating, and reporting. Don't scan code yourself — that's what the specialists are for.
- **Dispatch all agents in a single message** with parallel `Agent()` calls.
- **Budget awareness**: 6 agents × 25 files each = significant token spend. If the user's scope is small (< 15 files), reduce to 3-4 most relevant categories.
- **Respect category constraints**: If the user says "only async and error handling", dispatch exactly those 2. Don't silently add others.
- **Don't over-report**: Quality over quantity. 3 concrete, well-evidenced findings beat 15 vague ones.

## Also use when

Other phrases that route here: 'what bugs are hiding', 'proactive bug scan', 'code audit', '扫描bug', 'what could go wrong in src/'. The skill dispatches parallel specialist subagents, one per bug category (logic errors, boundary conditions, error handling, async/concurrency, security, type safety); it is a static scan and never executes the app.
