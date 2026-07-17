# Skill-to-Skill Handoff Protocols

> Input/output contracts for refactor skill interoperability.
> Refactoring does not operate in isolation — it has upstream triggers and downstream consumers.

## Handoff Map

```
[diagnose] ──→ [refactor] ──→ [review]
[review]   ──→ [refactor] ──→ [test]
[refactor] ──→ [diagnose] (when refactoring reveals a bug)
[refactor] ──→ [design]   (when refactoring requires architectural decision)
```

## Upstream: Receiving Work FROM Other Skills

### From: review skill

```yaml
input_contract:
  trigger: "Review identifies code quality issues requiring structural changes"
  receives:
    - file_paths: "List of files flagged by review"
    - issues: "Specific review findings (smell type, location, severity)"
    - suggested_refactoring: "Optional — reviewer's recommended approach"
  validation:
    - "Issues must include file:line locations"
    - "Each issue must map to a recognized smell category (see smell-detection.md)"
  action: "Create refactoring plan scoped to review findings"
```

### From: diagnose skill

```yaml
input_contract:
  trigger: "Diagnosis identifies root cause as structural code issue (not a logic bug)"
  receives:
    - root_cause: "Structural issue description"
    - affected_files: "Files involved in the structural problem"
    - diagnosis_evidence: "Why this is a structural issue, not a logic bug"
  validation:
    - "Root cause must be structural (coupling, complexity, duplication), not behavioral"
    - "If behavioral bug → reject handoff, return to diagnose"
  action: "Plan refactoring to address structural root cause"
```

### Self-initiated (mode: debt)

```yaml
input_contract:
  trigger: "Proactive debt reduction (not triggered by another skill)"
  receives:
    - scope: "Module/area to assess"
    - constraints: "Time box, priority, acceptable risk"
  action: "Run full smell detection pipeline → prioritize → execute"
```

## Downstream: Handing Work TO Other Skills

### To: review skill (post-refactoring)

```yaml
output_contract:
  trigger: "Refactoring complete — request review of changes"
  provides:
    - changed_files: "List of all modified files"
    - refactoring_summary: "What was changed and why"
    - before_after_metrics: "Metrics comparison table (from quality-gates.md Gate 4)"
    - test_evidence: "Test pass/fail results"
  expectation: "Review validates that refactoring improved quality without regressions"
  when_to_trigger:
    - "Architecture mode refactorings (always)"
    - "Code mode refactorings with high structural impact (public API changes, cross-module moves, invariant shifts)"
    - "Migration mode after each phase"
```

### To: test skill

```yaml
output_contract:
  trigger: "Refactoring needs additional test coverage"
  provides:
    - refactored_files: "Files that were restructured"
    - new_interfaces: "Any new APIs/interfaces introduced"
    - coverage_gaps: "Areas where coverage dropped or was already low"
  expectation: "Test skill writes tests for refactored code"
  when_to_trigger:
    - "Coverage dropped during refactoring"
    - "New abstractions/interfaces introduced that need contract tests"
    - "Extracted modules need unit tests"
```

### To: diagnose skill

```yaml
output_contract:
  trigger: "Refactoring reveals a bug (not a structural issue)"
  provides:
    - bug_description: "What unexpected behavior was found"
    - discovery_context: "How it was found during refactoring"
    - affected_code: "File:line where bug manifests"
    - refactoring_state: "Current checkpoint (can resume after bug fix)"
  action: "STOP refactoring. Checkpoint. Hand off bug to diagnose."
  expectation: "Diagnose fixes the bug, then refactoring can resume"
```

### To: design skill

```yaml
output_contract:
  trigger: "Refactoring requires an architectural decision not yet made"
  provides:
    - decision_needed: "What architectural question needs answering"
    - options: "Candidate approaches identified during refactoring"
    - constraints: "Technical constraints discovered"
    - current_state: "Architecture as-is diagram or description"
  action: "STOP refactoring. Checkpoint. Request design decision."
  expectation: "Design skill produces ADR, then refactoring resumes with clear direction"
```

## Escalation Decision Table

```yaml
during_refactoring:
  "Found a bug":
    action: "STOP → checkpoint → hand off to diagnose"
    do_not: "Fix the bug inline during refactoring"
    reason: "Bug fixes require different verification (regression tests, root cause analysis)"

  "Need architectural decision":
    action: "STOP → checkpoint → hand off to design"
    do_not: "Make architectural decisions ad-hoc during refactoring"
    reason: "Architectural decisions need ADR documentation and stakeholder alignment"

  "Tests inadequate for safe refactoring":
    action: "PAUSE → hand off to test skill for coverage → resume"
    do_not: "Refactor without test safety net"
    reason: "Refactoring without tests is rewriting blindly"

  "Scope growing beyond plan":
    action: "STOP → checkpoint → split into separate tasks"
    do_not: "Keep expanding scope to 'finish properly'"
    reason: "Unbounded refactoring is the #1 cause of refactoring failure"

  "Refactoring effort exceeds rewrite cost":
    action: "STOP → evaluate refactor-vs-rewrite (see quality-gates.md)"
    do_not: "Continue refactoring past the point of diminishing returns"
```

## lore Integration

```yaml
task_tracking:
  on_handoff_received:
    action: "Create refactoring leaf task under the current phase linked to source task"
    tool: "lore create task --parent <plan> --plan-id <plan> --phase <current-phase> --title '<leaf task>'"

  on_handoff_sent:
    action: "Create downstream leaf task under its owning phase and link to refactoring task"
    tool: "lore create task --parent <plan> --plan-id <plan> --phase <downstream-phase> --title '<leaf task>'"

  on_completion:
    action: "Update refactoring task with verification evidence, then release the claim"
    tool: "lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual> --command \"<cmd>\" --result pass|fail; lore release <task>"
```
