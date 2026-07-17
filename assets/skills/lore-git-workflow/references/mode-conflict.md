# Git Workflow Mode: Conflict

> Merge conflict resolution strategies and guided conflict resolution.

## Scope

```yaml
scope:
  - Merge conflict detection and analysis
  - Guided conflict resolution
  - Rebase conflict handling
  - Prevention strategies

outputs:
  - Cleanly resolved conflicts
  - Preserved intended changes from both sides
```

## Conflict Resolution Principles

```yaml
principles:
  1_understand_both_sides:
    description: "Read both versions before resolving"
    rule: "Never blindly accept one side"

  2_preserve_intent:
    description: "Keep the intended behavior from both changes"
    rule: "Merge logic, not just text"

  3_test_after_resolve:
    description: "Always verify after resolution"
    rule: "Run tests, check compilation"

  4_ask_when_unsure:
    description: "Complex business logic conflicts need human judgment"
    rule: "Flag ambiguous conflicts to the user"
```

## Workflow

### 1. Detect Conflicts

```yaml
actions:
  - Check for conflict state: "git status"
  - List conflicted files: "git diff --name-only --diff-filter=U"
  - Categorize conflicts by complexity:
    simple: "Same file, different sections (auto-resolvable)"
    moderate: "Same file, adjacent lines"
    complex: "Same lines modified differently"
    semantic: "No textual conflict but logical conflict"
```

### 2. Analyze Each Conflict

```yaml
for_each_conflicted_file:
  - Read the full conflict markers
  - Identify HEAD (current) changes and their purpose
  - Identify incoming changes and their purpose
  - Check git log for both sides:
    - "git log --oneline HEAD -- <file>"
    - "git log --oneline MERGE_HEAD -- <file>"
  - Determine if changes are:
    independent: "Different concerns, keep both"
    overlapping: "Same concern, need merge"
    contradictory: "Opposite intent, need decision"
```

### 3. Resolve Strategy

```yaml
strategies:
  independent_changes:
    description: "Changes touch different logical concerns"
    action: "Keep both changes, ensure they integrate correctly"
    example: "One side adds a method, other modifies a different method"

  overlapping_changes:
    description: "Both sides modify the same concern"
    action: "Merge the intent of both changes into one"
    example: "Both sides add validation, combine validation rules"

  contradictory_changes:
    description: "Changes have opposite intent"
    action: "Ask user which direction to take"
    example: "One side removes a feature, other enhances it"

  structural_conflicts:
    description: "File moved/renamed on one side, modified on other"
    action: "Apply modifications to the new location"

  dependency_conflicts:
    description: "package.json, lock files, etc."
    action: "Accept one side, then regenerate lock file"
    command: "npm install / yarn install / pnpm install"
```

### 4. Execute Resolution

```yaml
actions:
  - Edit conflicted files to remove markers and merge content
  - Stage resolved files: "git add <file>"
  - Verify no remaining markers: search for "<<<<<<", "======", ">>>>>>"
  - Run tests/compilation to verify
  - Complete merge: "git commit" (for merge) or "git rebase --continue" (for rebase)

tools:
  serena:
    - read_file: Read conflicted file content
    - replace_content: Remove conflict markers and apply resolution
    - search_for_pattern: Find remaining conflict markers
  bash:
    - "git add": Stage resolved files
    - "git commit": Complete merge
    - "git rebase --continue": Continue rebase
```

### 5. Verify Resolution

```yaml
checks:
  - No conflict markers remain in any file
  - Code compiles/transpiles without errors
  - Tests pass
  - Git status shows clean state
  - "git diff" shows expected final state
```

## Rebase Conflict Handling

```yaml
rebase_specific:
  workflow:
    1. "git rebase <base>" triggers conflicts
    2. Resolve each commit's conflicts one at a time
    3. "git add <resolved-files>"
    4. "git rebase --continue"
    5. Repeat until rebase completes

  abort_when:
    - Too many conflicts (> 5 commits with conflicts)
    - Conflicts are too complex to resolve safely
    - "git rebase --abort" to return to original state

  prefer_merge_when:
    - Branch has been shared/pushed
    - Many commits with potential conflicts
    - Complex history that's hard to replay
```

## Prevention Strategies

```yaml
prevent_conflicts:
  - Pull/rebase frequently from base branch
  - Keep branches short-lived (< 1 week)
  - Communicate with team about overlapping work
  - Use feature flags to avoid long-lived branches
  - Split large changes into smaller, focused PRs
```
