# Git Workflow Mode: PR

> Pull request creation, templates, description generation, and review workflow.

## Scope

```yaml
scope:
  - PR creation with proper templates
  - PR description generation from commits
  - Reviewer assignment guidance
  - PR checklist enforcement
  - Draft PR workflow

outputs:
  - Pull request with structured description
  - Linked issues and reviewers
```

## Workflow

### 1. Pre-PR Checks

```yaml
actions:
  - Verify branch is up to date with base: "git fetch origin && git log HEAD..origin/main --oneline"
  - Check all commits are clean: "git log origin/main..HEAD --oneline"
  - Verify no WIP commits: scan for "wip", "fixup", "squash" in messages
  - Run tests if configured: check package.json scripts
  - Check for uncommitted changes: "git status"
```

### 2. Detect PR Template

```yaml
actions:
  - Search for PR templates in repo:
    paths:
      - ".github/PULL_REQUEST_TEMPLATE.md"
      - ".github/PULL_REQUEST_TEMPLATE/"
      - ".github/pull_request_template.md"
      - "docs/pull_request_template.md"
  - If template found → use it as structure
  - If no template → use default structure below
```

### 2.5. Lore Context (RECOMMENDED)

```yaml
lore_context:
  purpose: "Find related project documents to reference in PR description"
  trigger: "Always attempt; skip silently if the project has no .lore/ corpus or no docs found"

  steps:
    1_extract_feature:
      action: "Extract feature name from branch name (e.g., feature/auth-login → auth login)"

    2_search_docs:
      tool: "lore search"
      queries:
        - command: 'lore search "{feature_name}" --type prd --json'
        - command: 'lore search "{feature_name}" --type spec --json'
        - command: 'lore search "{feature_name}" --type adr --json'
          note: "one call per type (lore search --type takes a single doc type); filter results to approved/active status client-side"
          limit: 5

    3_collect_references:
      action: "Extract doc slugs and titles from search results"
      output: "docs_referenced: [{slug, title, type}]"

  skip_conditions:
    - "No .lore/ corpus found for this project"
    - "No documents found matching feature"
    - "Hotfix/chore branch with no feature scope"
```

### 3. Generate PR Description

```yaml
default_template: |
  ## Summary
  <!-- Brief description of what this PR does -->

  ## Changes
  <!-- List of changes made -->

  ## Type
  - [ ] Feature
  - [ ] Bug fix
  - [ ] Refactor
  - [ ] Documentation
  - [ ] CI/CD
  - [ ] Other

  ## Testing
  <!-- How was this tested? -->

  ## Related Issues
  <!-- Closes #xxx, Fixes #xxx -->

  ## Related Documents
  <!-- lore references (auto-populated if available) -->
  <!-- - prd-xxx: Document title -->
  <!-- - spec-xxx: Document title -->

  ## Checklist
  - [ ] Code follows project conventions
  - [ ] Tests added/updated
  - [ ] Documentation updated (if needed)
  - [ ] No breaking changes (or documented)

generation_strategy:
  summary:
    - Analyze all commits: "git log origin/main..HEAD --format='%s%n%b'"
    - Synthesize into 1-2 sentence summary
    - Focus on the WHY, not the WHAT
  changes:
    - Group commits by type/scope
    - List key changes with file references
  testing:
    - Check if test files were modified
    - Describe test coverage
  issues:
    - Extract issue references from commit messages
    - Link with "Closes #xxx" syntax
  documents:
    - Include docs_referenced from Step 2.5 (if any)
    - Format as "- {id}: {title}" list
```

### 4. Create PR

```yaml
actions:
  - Determine base branch (main/develop/release)
  - Push branch if not yet pushed: "git push -u origin <branch>"
  - Create PR via GitHub MCP:
    tool: mcp__github__create_pull_request
    params:
      title: "Short, descriptive title (< 70 chars)"
      body: "Generated description from template"
      head: "current branch"
      base: "target branch"
      draft: "true if WIP"

title_rules:
  - Max 70 characters
  - Prefix with type if using conventional commits: "feat: ...", "fix: ..."
  - No period at end
  - Imperative mood
```

### 5. Post-Creation

```yaml
actions:
  - Check for CODEOWNERS to suggest reviewers
  - Add labels if applicable
  - Link related issues
  - Verify CI checks are triggered
```

## PR Size Guidelines

```yaml
ideal_pr_size:
  files_changed: "< 10"
  lines_changed: "< 400"
  review_time: "< 30 minutes"

when_too_large:
  - Split into stacked PRs
  - Use feature flags for partial delivery
  - Create a tracking issue for the full feature
  - Each PR should be independently reviewable
```

## Draft PR Workflow

```yaml
use_draft_when:
  - Work in progress, seeking early feedback
  - CI validation needed before full review
  - Dependent on another PR being merged first

convert_to_ready:
  - All CI checks pass
  - Self-review completed
  - Description is complete
  - Tests are passing
```
