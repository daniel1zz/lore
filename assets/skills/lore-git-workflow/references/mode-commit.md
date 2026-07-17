# Git Workflow Mode: Commit

> Conventional commits, message formatting, and commit best practices.

## Scope

```yaml
scope:
  - Commit message generation following project conventions
  - Staged changes analysis and grouping
  - Conventional commit type selection
  - Breaking change detection and annotation
  - Multi-line commit body for complex changes

outputs:
  - Well-formatted git commit(s)
  - Commit message following detected/configured convention
```

## Conventional Commits Spec

```yaml
format: "<type>(<scope>): <subject>"

types:
  feat: "New feature (correlates with MINOR in semver)"
  fix: "Bug fix (correlates with PATCH in semver)"
  docs: "Documentation only changes"
  style: "Formatting, missing semicolons, etc (no code change)"
  refactor: "Code change that neither fixes a bug nor adds a feature"
  perf: "Performance improvement"
  test: "Adding or correcting tests"
  build: "Build system or external dependencies"
  ci: "CI configuration files and scripts"
  chore: "Other changes that don't modify src or test files"
  revert: "Reverts a previous commit"

rules:
  subject:
    - Imperative mood ("add" not "added" or "adds")
    - No period at the end
    - Max 50 characters (72 hard limit)
    - Lowercase first letter
  body:
    - Separated from subject by blank line
    - Wrap at 72 characters
    - Explain WHAT and WHY, not HOW
  footer:
    - "BREAKING CHANGE: <description>" for breaking changes
    - "Closes #123" for issue references
    - "Co-authored-by: Name <email>" for pair programming
    - "Refs: prd-xxx, spec-xxx" for lore document references (optional)
```

## Workflow

### 1. Analyze Staged Changes

```yaml
actions:
  - Run "git status" to see staged/unstaged files
  - Run "git diff --cached --stat" for staged change summary
  - Run "git diff --cached" for detailed staged diff
  - Group changes by logical concern
  - If changes span multiple concerns → suggest splitting into multiple commits
```

### 2. Detect Commit Convention

```yaml
actions:
  - Check for commitlint config files
  - Read last 10-20 commit messages for pattern
  - If conventional commits detected → use that format
  - If custom pattern detected → follow it
  - If no pattern → recommend conventional commits
```

### 3. Generate Commit Message

```yaml
actions:
  - Select appropriate type based on changes
  - Determine scope from affected module/component
  - Write concise subject line
  - Add body if changes are non-trivial
  - Add footer for breaking changes or issue refs
  - Use HEREDOC format for multi-line messages
```

### 4. Execute Commit

```yaml
safety_rules:
  - NEVER use --no-verify unless user explicitly requests
  - NEVER amend published commits
  - Prefer specific file staging over "git add -A"
  - Always verify staged files before committing
  - Use HEREDOC for commit messages to preserve formatting

format: |
  git commit -m "$(cat <<'EOF'
  type(scope): subject line

  Optional body explaining what and why.

  Optional footer.
  EOF
  )"
```

## Smart Commit Splitting

```yaml
when_to_split:
  - Changes touch unrelated modules
  - Mix of feature code and test code
  - Mix of refactoring and new functionality
  - Config changes alongside code changes

how_to_split:
  1. "git diff --cached --name-only" to list all staged files
  2. Group files by logical concern
  3. "git reset HEAD <files>" to unstage files not in first group
  4. Commit first group
  5. Stage and commit next group
  6. Repeat until all changes committed
```

## Examples

```yaml
simple_feature:
  message: "feat(auth): add password reset flow"

bug_fix_with_issue:
  message: |
    fix(api): handle null response from payment gateway

    The payment gateway returns null instead of an error object
    when the service is degraded. Added null check before
    accessing response properties.

    Closes #456

breaking_change:
  message: |
    feat(api)!: change authentication to JWT

    Migrate from session-based auth to JWT tokens.
    All API endpoints now require Bearer token header.

    BREAKING CHANGE: Session cookies are no longer accepted.
    Clients must use Authorization: Bearer <token> header.

    Migration guide: docs/migration/auth-jwt.md
```
