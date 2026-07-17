# EARS Feature-Spec Verification

**Purpose**: Verify code implementation against EARS-structured feature-spec requirements from the lore corpus.
**Activation**: Only when a feature-kind spec document (`extra.spec_kind = "feature"`) is found for the code under review.
**Fallback**: If no feature-spec is found, skip this entirely — standard checklist review applies.

---

## §1 Feature-Spec Discovery

Search the lore corpus for a feature-spec matching the code under review. Use multiple signal sources:

```yaml
discovery:
  signals:
    1_explicit_reference:
      detect: "PR description, commit messages, or branch name contains a spec slug (e.g., 'spec-xxx')"
      action: "lore get spec-xxx --resolve-mdx"

    2_pr_title_keywords:
      detect: "Extract feature keywords from PR title"
      action: "lore search \"{keywords}\" --type spec --json"

    3_branch_name:
      detect: "Parse branch name (e.g., feat/user-auth → 'user auth')"
      action: "lore search \"{parsed keywords}\" --type spec --json"

    4_changed_files:
      detect: "Extract feature area from file paths (e.g., src/features/checkout/ → 'checkout')"
      action: "lore search \"{feature area}\" --type spec --json"

    5_fallback:
      action: "lore search \"{broader keyword}\" --json"
      when: "All above return 0 results"

  result_handling:
    found: "Filter results to feature-kind specs (extra.spec_kind = \"feature\"), load full content via `lore get <slug>` → proceed to §2"
    multiple_found: "Select most relevant by title match, note others in Doc References"
    not_found: "Log: '⚠️ No feature-spec found — skipping EARS verification.' → continue standard review"
```

---

## §2 Parse Feature-Spec Sections

Extract three sections from the loaded feature-spec:

```yaml
sections:
  requirements:
    pattern: "REQ-{N}: ..."
    categories:
      core: "Ubiquitous — The system shall..."
      behavioral: "Event/State — When/While..."
      error_handling: "Unwanted — If...then..."
      optional: "Optional — Where..."

  acceptance_criteria:
    pattern: "AC-{N} | Given | When | Then | Priority"
    priority_levels: [must, should, could]

  boundaries:
    always: "Safe actions — code should freely allow"
    ask_first: "High-impact actions — code should gate with confirmation"
    never: "Hard stops — code must prevent"
```

---

## §3 Requirement Verification

For **each** REQ-N in the feature-spec:

```yaml
per_requirement:
  1_locate:
    action: "Find code implementing this requirement"
    tools: [serena.find_symbol, serena.search_for_pattern, serena.get_symbols_overview]
    search_for:
      - Function/method names matching requirement keywords
      - Conditional logic matching EARS trigger/state keywords
      - Error handling matching EARS unwanted behavior patterns
    scope: "Search entire codebase, not just PR diff (requirement may be pre-existing)"

  2_assess:
    implemented: "Code clearly implements the requirement"
    partial: "Some aspects implemented, gaps identified"
    missing: "No implementation found"

  3_severity:
    core_missing: "→ BLOCKER"
    behavioral_missing: "→ MAJOR"
    error_handling_missing: "→ BLOCKER (if data-loss risk) or MAJOR"
    optional_missing: "→ MINOR"
```

### EARS Pattern-Specific Checks

```yaml
ears_checks:
  ubiquitous:
    verify: "Requirement is always active — no conditional guard disables it"
    flag: "Wrapped in feature flag or conditional that can turn it off → MAJOR"

  state_driven:
    verify: "While-state is checked before system response executes"
    flag: "Response executes without state precondition check → BLOCKER"

  event_driven:
    verify: "Trigger event is handled and produces specified response"
    flag: "No event handler or wrong response → MAJOR"

  unwanted:
    verify: "Error condition is caught and recovery action is implemented"
    flag: "Error not caught → BLOCKER (data-loss risk) or MAJOR"

  optional:
    verify: "Feature gate exists; behavior varies when feature is present vs absent"
    flag: "No feature gate for optional behavior → MINOR"

  complex:
    verify: "Both state precondition AND event trigger are checked"
    flag: "Missing either check → BLOCKER"
```

---

## §4 Acceptance Criteria Verification

For **each** AC-N in the feature-spec:

```yaml
per_criterion:
  1_find_test:
    action: "Search test files for tests matching this AC"
    tools: [serena.search_for_pattern, serena.find_symbol]
    search_in:
      - "**/*.test.{ts,tsx,js,jsx}"
      - "**/*.spec.{ts,tsx,js,jsx}"
      - "**/__tests__/**"
      - "**/e2e/**"
    match_by:
      - Test name containing Given/When/Then keywords from AC
      - Test description matching AC scenario
      - Test assertions matching expected outcome

  2_assess:
    covered: "Test exists and covers the AC scenario"
    partial: "Test exists but misses edge cases from AC"
    missing: "No test found for this AC"

  3_severity:
    must_missing: "→ BLOCKER"
    should_missing: "→ MAJOR"
    could_missing: "→ MINOR"
```

---

## §5 Boundary Verification

```yaml
boundary_checks:
  never:
    check: "Actions listed as 'Never' are prevented by code"
    verify: "Validation guards, permission checks, disabled UI elements, server-side rejection"
    violated: "→ BLOCKER"

  ask_first:
    check: "Actions listed as 'Ask First' have confirmation/approval gates"
    verify: "Confirmation dialogs, approval workflows, two-step processes"
    no_gate: "→ MAJOR"

  always:
    check: "Actions listed as 'Always' are not blocked or gated unnecessarily"
    verify: "No unnecessary confirmation for safe actions"
    over_restricted: "→ MINOR"
```

---

## §6 Acceptance Matrix Output

Append this section to the review output when a feature-spec was found:

```markdown
## Acceptance Matrix

**Feature-Spec**: [{title}](SPEC-{ID})

### Requirements Coverage

| REQ | EARS Pattern | Status | Evidence | Gap |
|-----|-------------|--------|----------|-----|
| REQ-1 | Ubiquitous | ✅ Implemented / ⚠️ Partial / ❌ Missing | `file:line` | — / severity |

### Acceptance Criteria Coverage

| AC | Priority | Test Status | Test Location | Gap |
|----|----------|-------------|---------------|-----|
| AC-1 | must | ✅ Covered / ⚠️ Partial / ❌ Missing | `test-file:line` | — / severity |

### Boundary Compliance

| Boundary | Type | Status | Evidence |
|----------|------|--------|----------|
| {action} | Never / Ask First / Always | ✅ Compliant / ❌ Violation | `file:line` |

### Coverage Summary
- **Requirements**: {n}/{total} implemented ({pct}%)
- **Acceptance Criteria**: {n}/{total} tested ({pct}%)
- **Boundary Rules**: {n}/{total} compliant ({pct}%)

### Verdict
- All green (100% coverage) → no EARS-related findings
- Any BLOCKER → 🚫 Request changes
- Any MAJOR (no BLOCKER) → ⚠️ Approve with comments
- Only MINOR → ✅ Approve (note gaps for future)
```
