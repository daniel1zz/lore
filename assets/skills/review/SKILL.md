---
name: review
description: "Use when reviewing code changes, PRs, diffs, or assessing code quality. Also use for 'find bugs', 'check this code', 'is this safe', 'review my implementation', 'what could go wrong', or any request to evaluate code correctness/security/quality."
---

# Review — Skill (Level 1, inline specialist dispatch)

Self-executing skill with inline parallel agent dispatch for specialist reviews.
No named agent — specialists are prompt-driven generic subagents.

## Mode: $0

Read `references/mode-$0.md` before starting. No mode -> ask user.

| Mode | Reference | Focus |
|------|-----------|-------|
| `code` | `references/mode-code.md` | Multi-specialist parallel review (primary mode) |
| `security` | `references/mode-security.md` | Security-focused review |
| `architecture` | `references/mode-architecture.md` | Architecture review |
| `accessibility` | `references/mode-accessibility.md` | A11y audit |
| `ui` | `references/mode-ui.md` | Visual UI/UX verification via browser |
| `ddd` | `references/mode-ddd.md` | DDD tactical pattern & layering review |

## Quality Dimensions

This skill owns deep verification of these dimensions. Output `[DIMENSION CHECK]` in review summary.

| Dimension | Standard |
|-----------|----------|
| **D-FUNC** | Behavioral correctness vs spec/AC, state transitions, invariants, edge cases |
| **D-CODE** | Naming, abstractions, DRY, error handling patterns |
| **D-TEST** | Test existence, 6-dimension coverage, test design quality, mocking appropriateness |
| **D-PERF** | No N+1 queries, no unnecessary re-renders, bundle size impact, lazy loading |
| **D-SEC** | Input validation, auth/authz checks, OWASP top 10, secrets exposure |
| **D-BIZ** | Prompt design, output validation, domain logic correctness (conditional — auto-append only) |

## Mandatory Context Loading

Before any review work, load upstream documents to establish behavioral baseline:

1. **Spec search**: `lore search "<keywords from changed files>" --type spec --json` -> load full content via `lore get <slug>`
2. **ADR search**: `lore search "<q>" --type adr --json` for approved ADRs/knowledge retros related to the change (limit 3)
3. **Fallback**: No spec found -> log `'No feature-spec found — structural review only'`. Proceed with code quality review.

> Without spec context, review can only verify structural quality — not behavioral correctness.

## Auto-Append Rules

After completing `mode-code`, auto-append additional checks based on content signals:

| Trigger | Append | Condition |
|---------|--------|-----------|
| **DDD** | `mode-ddd` checks | lore corpus has DDD ADRs or knowledge retros, OR changed files in `domain/`/`entities/`/`aggregates/` dirs |
| **D-BIZ** | D-BIZ checklist (`references/d-biz-checklist.md`) | Changed files import AI/LLM packages, OR contain LLM calls, OR in `ai/`/`agents/`/`prompts/` dirs |
| **Security** | Security specialist (elevated priority) | Changed files import auth/crypto packages, OR in `auth/`/`middleware/` dirs, OR new route definitions |
| **A11y** | A11y checks (sections 1-3 from mode-accessibility) | Changed files create/modify UI components (`.tsx`/`.jsx`/`.vue`), contain ARIA attrs, or form elements |

## Scale Classification

Determines dispatch strategy. Applies to mode-code; other modes run single-agent.

| Scale | Signals | Dispatch |
|-------|---------|----------|
| **Trivial** | Config/env, typo, dep bump, type-only, <20 changed lines | Inline single-pass — no specialist dispatch |
| **Standard** | Feature code, bug fix, refactor — normal scope | Selective — Correctness + relevant specialists |
| **Complex** | Cross-module, auth/payments, core domain, state machines, >500 lines | Full dispatch + Codex cross-engine |

## Specialist Dispatch (mode-code)

Mode-code uses **adaptive specialist dispatch** — see `references/mode-code.md` for full protocol.

### Dispatch Decision

After Phase 1 context analysis, decide based on **what the code does** (not file/line counts):
- **Which specialists**: Correctness always; others based on code domains touched
- **Whether Codex cross-engine**: Based on risk/complexity, not size

Output: `**[DISPATCH]** {selected specialists} | Codex: YES/NO | Rationale: {why}`

### Available Specialists (inline agents)

All specialists are spawned as **generic Agent() calls in a single message** for parallel execution.

| Specialist | When Relevant | Key Procedure |
|-----------|--------------|---------------|
| **Correctness Reviewer** | Always | Latent Bug Discovery (state transitions, invariants, error paths, boundaries) |
| **Security Reviewer** | Auth, input handling, data access, crypto | OWASP patterns, taint analysis |
| **Performance Reviewer** | DB queries, loops, rendering, APIs | Hot-path classification, N+1 detection, resource lifecycle |
| **Maintainability Reviewer** | Non-trivial logic, new abstractions | SDK check (hand-written vs library), test coverage gaps |
| **Architecture Reviewer** | Cross-module changes, new modules | SOLID, layering, dependency direction |

### Codex Cross-Engine (optional)

For high-risk changes (auth, payments, core domain, complex state machines):
```bash
cat > /tmp/codex-review-prompt.txt << 'PROMPT'
{review prompt with changed files + context}
PROMPT
codex exec --full-auto - < /tmp/codex-review-prompt.txt
```
Send Codex Bash call in the SAME message as Claude Agent calls for true parallelism.

## Synthesis Rules

After all dispatched reviewers return:

1. **Dedup**: Same issue by multiple reviewers -> merge, use highest severity
2. **Cross-validate**: Security + Performance finding on same code -> likely BLOCKER
3. **Stage ordering**: Spec compliance = Stage 1 (fix first); rest = Stage 2
4. **Severity calibration**: Disagreement -> use higher severity
5. **Cross-engine** (Complex scale — when Codex dispatched): Codex-only findings = high-value signal; consensus = highest confidence; contradictions = flag for judgment

## Evidence Standards

Every finding MUST include verifiable evidence:

```yaml
per_finding:
  required: [file_path:line, code_evidence, reasoning]
  recommended: [tool_verification, reproduction, reference]

confidence_levels:
  HIGH: "Tool-verified OR reproducible code path fully traced -> any severity"
  MEDIUM: "Code inspection with logical reasoning -> up to MAJOR"
  LOW: "Heuristic pattern match -> cap at MINOR"

calibration:
  cross_engine_consensus: "Both Claude + Codex -> bump to HIGH"
  multi_specialist: "2+ specialists independently -> bump one level"
```

## Review Scope

```yaml
primary: "Review diff + 1-level context (direct callers/callees)"
pre_existing_issues: "Flag ONLY if they interact with new code. Mark as [PRE-EXISTING], one severity lower."
large_diff_budget:
  tier_1: "Security-sensitive (auth, crypto) -> thorough"
  tier_2: "Core business logic -> thorough"
  tier_3: "Glue, config, boilerplate -> scan"
  tier_4: "Auto-generated, type defs -> skip unless manually modified"
```

## Exit Criteria

Review is NOT complete until all exit gates pass. Output `**[EXIT CHECK]**` in report.

| Gate | Rule | Threshold |
|------|------|-----------|
| **Coverage** | Every changed file assessed by >= 1 specialist | 100% |
| **Finding completeness** | All findings have file:line, confidence level, evidence | All |
| **Spec gate** | If feature-spec exists, EARS verification completed | Yes/No/N/A |
| **Verdict** | Apply thresholds consistently | See below |

### Verdict Thresholds

| Verdict | Condition |
|---------|-----------|
| Request changes | Any BLOCKER, OR >= 3 MAJORs, OR any HIGH-confidence security finding |
| Approve with comments | 1-2 MAJORs (no BLOCKERs), OR >= 5 MINORs in same area |
| Approve | Only MINORs/NITs, no systemic patterns |

## Downstream Handoff

When review finds actionable issues, output `**[HANDOFF]**`:

| Trigger | Action |
|---------|--------|
| BLOCKER findings | -> `/implement` for code fixes |
| Missing tests | -> `/test unit` or `/test integration` |
| Missing eval | -> `/test eval` for output-producing code |
| Design smells (MAJOR) | -> `/refactor code` or `/refactor architecture` |
| Security concerns | -> `/diagnose security` for full audit |

## Output Format

```markdown
## Review Summary
**Dispatch**: {specialists} | Codex: {YES/NO} | Rationale: {why}

| Reviewer | Blockers | Major | Minor | Nits |
|----------|----------|-------|-------|------|
| ... | N | N | N | N |

**Verdict**: Approve / Approve with comments / Request changes

## Stage 1: Spec Compliance
[Findings from spec verification — must resolve first]

## Stage 2: Code Quality
[Merged findings sorted by severity]

## Findings
### BLOCKER/MAJOR/MINOR/NIT: [title]
**File**: `path:line` | **Confidence**: H/M/L | **Reviewer**: [who] | **Issue**: ... | **Fix**: ...

## SDK Assessment
| Hand-written Domain | Recommended Library | Severity |
|-------------------|-------------------|----------|

## Positive Highlights
[Good patterns worth noting]

**[DIMENSION CHECK]**
- D-FUNC/D-CODE/D-TEST/D-PERF/D-SEC: pass/fail {evidence}
- D-BIZ (if applicable): pass/fail {evidence}

**[EXIT CHECK]**
- [COVERAGE] n/total (pct%)
- [FINDINGS] All evidence complete: yes/no
- [SPEC] Verified / No spec / N/A
- [VERDICT] Threshold: {rule applied}

**[HANDOFF]** (if any BLOCKERs/MAJORs)
- -> Action: `/skill mode` -- {reason}
```
