---
name: lore-iterative-review
description: "Multi-round review-fix loop that drives code to zero issues. Dispatches parallel review subagents (code quality, security, testing), auto-fixes findings, re-reviews, and repeats until clean or max rounds reached. Use when user says 'review and fix', 'iterative review', 'review loop', 'keep reviewing until clean', 'multi-round review', 'review N rounds', '多轮review', '迭代review', '反复review', 'polish this code', 'review until done', or wants automated review->fix cycles rather than a one-shot review report. Even simple 'review and fix my code' should trigger this skill."
---

# Iterative Review — Review -> Fix -> Repeat

Automated loop: dispatch parallel reviewers, aggregate findings, auto-fix, verify with oracle, repeat until clean.

## Arguments

`/iterative-review [rounds] [paths...]`

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `rounds` | number | until clean (max 10) | Max review-fix iterations |
| `paths` | file/dir | branch diff vs main | Scope override |

Examples:
- `/iterative-review` — review branch diff, loop until clean (max 10)
- `/iterative-review 3` — max 3 rounds
- `/iterative-review src/auth/` — scope to directory
- `/iterative-review 5 src/` — 5 rounds on src/

## Execution

### Step 0: Scope Resolution

Determine review target:

**Branch diff** (no paths given):
```bash
git diff --name-only main...HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.py' '*.go' '*.rs' '*.java' '*.vue' '*.svelte'
```
If no diff exists, ask the user what to review.

**Explicit paths** (paths given):
Expand directories, filter to source files only.

Output: `**[SCOPE]** {N} files | Mode: {branch-diff|paths}`

Parse arguments: first arg that's a number = rounds; everything else = paths. No number = unlimited (capped at 10).

### Step 1: Review (parallel subagents)

Dispatch **3 review subagents in a single message** so they run concurrently. Each receives the full file contents within scope and returns a JSON array of findings.

Read `references/reviewer-prompts.md` for the exact prompts. The three reviewers:

| Reviewer | Focus |
|----------|-------|
| **Code Quality** | Logic errors, structure, naming, patterns, immutability, complexity |
| **Security** | Input validation, injection, auth, data safety, OWASP top 10 |
| **Testing** | Coverage gaps, assertion quality, 6-dimension check, missing test files |

Each reviewer is dispatched as `Agent(subagent_type="claude")`. They are strictly read-only — they analyze and output findings, they don't modify code. If `lore-reader` is available and the project has a lore corpus, prefer it for the review agents (it has no Write/Edit/NotebookEdit tools; Bash writes are not mechanically prevented, so the reviewer prompt must still forbid them).

**Subagent prompt structure** (details in references):
1. Role declaration
2. Review checklist for their dimension
3. File contents to review
4. Output format: JSON array of findings
5. Severity calibration rules

### Step 2: Aggregate

When all 3 reviewers return:

1. **Parse** JSON arrays from each reviewer's output (extract JSON from markdown code blocks if wrapped)
2. **Dedup** — same file + overlapping line range + same issue type = merge, keep highest severity
3. **Assign IDs** — `R{round}-{dim}-{seq}` (e.g. `R1-CQ-003`, `R1-SEC-001`, `R1-TST-002`)
4. **Detect oscillation** — if a finding matches one from 2+ rounds ago (same file, same issue description), tag `[OSCILLATING]` and exclude from fix list
5. **Sort** — blocker > major > minor

Output round summary to user:
```
**[ROUND {N}/{max}]** {total} findings: {blockers} blocker, {majors} major, {minors} minor
{table of findings: ID | severity | file:line | issue summary}
```

**Zero actionable findings → EXIT.** Jump to Step 5 (Final Report).

### Step 3: Fix (subagent)

Dispatch fix subagent(s) to resolve all non-oscillating findings. Read `references/fix-agent-prompt.md` for the exact prompt template and oracle detection logic.

**Dispatch strategy**:
- **<=10 findings**: Single fix subagent handles all
- **>10 findings**: Group by directory, dispatch parallel fix subagents (one per group, in a single message)

Fix subagents are `Agent(subagent_type="claude")`. If `lore-implementer` is available, prefer it (it has Write/Edit/Bash + oracle tools).

**What the fix agent receives**:
1. The findings JSON (IDs, file paths, line numbers, issue descriptions, fix suggestions)
2. Oracle commands for the project (auto-detected from project config files)
3. Rules: immutability, false-positive handling, test writing, security remediation patterns

After fix subagents complete, the main agent collects their summaries:
```
**[FIX]** Applied: {N} | Skipped (false positive): {N} | Failed: {N}
```

### Step 4: Oracle Verification

Run external verification to catch regressions introduced by fixes. The main agent runs these commands itself (not via subagent) to get direct oracle feedback.

Auto-detect oracle commands from project config (see `references/fix-agent-prompt.md` for the detection table). Common examples:

```bash
# TypeScript: npx tsc --noEmit 2>&1 | head -50
# Tests:     npm test 2>&1 | tail -30
# Lint:      npm run lint 2>&1 | head -30
# Python:    python -m pytest 2>&1 | tail -30
# Go:        go vet ./... && go test ./... 2>&1 | tail -30
# Rust:      cargo check && cargo test 2>&1 | tail -30
```

If no oracle commands are detectable, skip this step and note `**[ORACLE]** skipped — no project toolchain detected`.

- **Oracle passes** → proceed to next round (back to Step 1)
- **Oracle fails** → dispatch a fix subagent with the error output, then re-run oracle. If oracle still fails after 2 fix attempts, report the failure and stop the loop.

### Step 5: Final Report

After the loop ends (clean or max rounds), output:

```markdown
## Iterative Review Complete

**Rounds**: {completed}/{max}
**Exit reason**: {clean | max-rounds | oracle-failure | user-stop}
**Total findings across all rounds**: {N}
**Fixed**: {N} | **Skipped**: {N} | **Oscillating**: {N}

### Round-by-Round Summary
| Round | Findings | Fixed | New Issues | Oracle |
|-------|----------|-------|------------|--------|
| 1     | 12       | 10    | -          | pass   |
| 2     | 5        | 5     | 2 new      | pass   |
| 3     | 1        | 1     | 0          | pass   |
| 4     | 0        | -     | -          | pass   |

### Remaining Issues (if any)
{list of unfixed/oscillating findings}
```

## Convergence Rules

The loop stops when ANY of these is true:
1. **Clean**: Zero findings in a review round AND the failure-coverage gate holds — the Testing reviewer must confirm (shared discipline `../shared/verification-discipline.md`) that the diff's tests exercise rejection/error/boundary behavior, not only happy paths, and that every fix verified this loop has a paired negative control (the adjacent behavior that must STILL fail). A round with zero findings but happy-path-only test evidence is NOT clean — it emits exactly one D-TEST blocker and loops once more.
2. **Max rounds**: Round count reaches the limit
3. **Diminishing returns**: Findings count unchanged for 2 consecutive rounds (same issues keep appearing)
4. **Oracle stuck**: Oracle fails and fix subagent can't resolve it after 2 attempts
5. **Oscillation dominant**: >50% of findings are tagged `[OSCILLATING]`

## Finding Schema

Every finding follows this structure (enforced in reviewer prompts):

```json
{
  "dimension": "code-quality | security | testing",
  "severity": "blocker | major | minor",
  "file": "relative/path/to/file.ts",
  "line": 42,
  "code": "the problematic code snippet (1-3 lines)",
  "issue": "clear description of what's wrong",
  "fix": "concrete suggestion — what to change and why"
}
```

## Tracking State

Maintain a `review_state` object across rounds (in memory, not persisted):

```json
{
  "round": 1,
  "max_rounds": 10,
  "scope_files": ["src/foo.ts", "src/bar.ts"],
  "history": [
    {
      "round": 1,
      "findings": [...],
      "fixed": 10,
      "skipped": 2,
      "oracle_pass": true
    }
  ],
  "known_oscillations": ["R1-CQ-003 <-> R2-CQ-001"]
}
```

This state is used for oscillation detection and the final report.
