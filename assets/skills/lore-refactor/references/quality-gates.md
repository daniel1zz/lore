# Quality Gates & Exit Criteria

> Hard gates for refactoring. Every gate is a MUST-PASS — if any gate fails, the refactoring is not complete.
> Aspirational targets are explicitly marked as "stretch" and do not block completion.

## Gate Definitions

### Gate 0: Pre-Refactoring (ENTRY gate)

```yaml
entry_gate:
  must_pass:
    - "Baseline test suite passes (green before touching code)"
    - "Baseline metrics captured: complexity, coverage, duplication, dependency count"
    - "Refactoring scope defined and bounded (target files/modules listed)"
    - "Rollback strategy documented (git stash, branch, or revert plan)"
  hard_block: true
  action_on_fail: "DO NOT start refactoring. Fix baseline first."
```

### Gate 1: Per-Step Verification (CONTINUOUS gate)

```yaml
step_gate:
  after_each_refactoring_step:
    - "Tests pass (no regressions)"
    - "TypeScript compiles (tsc --noEmit)"
    - "No new lint errors introduced"
  hard_block: true
  action_on_fail: "Revert last step. Diagnose. Retry or choose different approach."
  checkpoint: "Create git stash / local patch after each green step"
```

### Gate 2: Scope Guard (CONTINUOUS gate)

```yaml
scope_gate:
  rules:
    - "Changes stay within declared scope (target files/modules)"
    - "No new features added during refactoring"
    - "No unrelated fixes bundled in"
    - "If scope creep detected: STOP, document the new finding, defer to separate task"
  time_box:
    code_mode: "Max 2 hours per refactoring target"
    architecture_mode: "Max 4 hours per architectural change"
    migration_mode: "Per-phase milestones with go/no-go checkpoints"
    debt_mode: "Time-boxed per debt item (effort estimate from RICE)"
  action_on_breach: "STOP. Checkpoint current progress. Re-scope or split."
```

### Gate 3: Post-Refactoring (EXIT gate)

```yaml
exit_gate:
  must_pass:
    - "All tests pass (same or more tests than baseline)"
    - "TypeScript compiles cleanly"
    - "No new lint warnings/errors"
    - "Behavior preserved: same observable outputs for same inputs"
    - "No metric regression (complexity, coverage, duplication must not worsen)"
  should_improve:
    - "At least one target metric improved vs baseline"
    - "Reduced complexity OR reduced duplication OR improved coverage"
  hard_block: true
  action_on_fail: "Revert to last good checkpoint. Investigate."
```

### Gate 4: Verification Evidence (COMPLETION gate)

```yaml
completion_gate:
  must_produce:
    - "Before/after metrics comparison table"
    - "List of all files changed"
    - "Test execution evidence (pass count, coverage delta)"
    - "Confirmation that no behavior changed (or explicit list of intentional behavior changes)"
  format: |
    ## Refactoring Verification
    | Metric | Before | After | Delta |
    |--------|--------|-------|-------|
    | Cyclomatic Complexity (max) | {n} | {n} | {+/-n} |
    | Test Coverage | {n}% | {n}% | {+/-n}% |
    | Duplication | {n}% | {n}% | {+/-n}% |
    | Files Changed | - | {n} | - |
    | Tests | {pass}/{total} | {pass}/{total} | {+/-n} |

    Behavior preserved: YES / NO (list changes)
```

## Abort Criteria — When to STOP Refactoring

```yaml
abort_triggers:
  must_stop:
    - "Test failures that cannot be resolved within 15 minutes"
    - "Discovered the change requires a design decision not yet made → escalate to design skill"
    - "Refactoring reveals a bug → hand off to diagnose skill (do not fix inline)"
    - "Scope has grown beyond original plan by >50%"
    - "Time box exceeded with no clear path to completion"

  action_on_abort:
    1: "Revert to last green checkpoint"
    2: "Document what was learned and what remains"
    3: "Create follow-up task(s) for remaining work"
    4: "Report partial completion with evidence"
```

## Refactor-vs-Rewrite Decision Framework

```yaml
decision_framework:
  evaluate_first:
    description: "Before starting any refactoring, assess if refactor or rewrite is appropriate"

  refactor_when:
    - "Core design is sound, implementation needs cleanup"
    - "Tests exist and cover key behaviors"
    - "Changes are incremental and reversible"
    - "Team understands the existing codebase"
    - "Business continuity required (cannot afford downtime)"

  rewrite_when:
    - "Fundamental design flaws (wrong paradigm, wrong data model)"
    - "No tests exist AND code is untestable (cannot add tests without rewriting)"
    - "Technology is EOL with no migration path"
    - "Estimated refactoring effort > 70% of rewrite effort"
    - "The code is < 500 LOC (small enough that rewrite is low-risk)"

  decision_matrix:
    "| Factor | Favors Refactor | Favors Rewrite |"
    "| Design soundness | Core design OK | Fundamentally flawed |"
    "| Test coverage | >60% | <20% and untestable |"
    "| Codebase size | >2000 LOC | <500 LOC |"
    "| Team knowledge | Team knows the code | Nobody understands it |"
    "| Downtime tolerance | Cannot afford | Can afford reset |"
    "| Effort ratio | Refactor < 50% rewrite | Refactor > 70% rewrite |"

  escalation:
    condition: "If rewrite is chosen for >500 LOC"
    action: "Escalate to architecture mode or design skill — rewrite is an architectural decision"
```

## Metric Thresholds

```yaml
thresholds:
  cyclomatic_complexity:
    acceptable: "<=10 per function"
    warning: "11-20 per function"
    critical: ">20 per function"

  function_length:
    acceptable: "<=30 LOC"
    warning: "31-50 LOC"
    critical: ">50 LOC"

  class_length:
    acceptable: "<=300 LOC"
    warning: "301-500 LOC"
    critical: ">500 LOC"

  test_coverage:
    minimum: ">=60% (hard gate for refactored code)"
    target: ">=80% (stretch goal)"

  duplication:
    acceptable: "<=5%"
    warning: "5-10%"
    critical: ">10%"

  parameter_count:
    acceptable: "<=4"
    warning: "5-6"
    critical: ">6"

  dependency_depth:
    acceptable: "<=3 import levels"
    warning: "4-5 levels"
    critical: ">5 levels"
```
