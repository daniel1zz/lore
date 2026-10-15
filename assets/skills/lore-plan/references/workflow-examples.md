# Plan Workflow Examples

## Routing Decision

| Scenario | Route |
|----------|-------|
| Low risk, self-contained change (clear scope, no ambiguity) | Direct execution, no tracking |
| Moderate scope, single session (multiple coordinated changes) | Session-local task list |
| High complexity, cross-session, or significant risk/ambiguity | lore plan + task docs |

## Example: Create (auth system)

```
# ANALYZE matches "Backend feature" → skill chain:
# research:sdk → design:architecture → implement:backend → test:unit

# Skill("plan","create")

1. Context: `lore bootstrap` (pulled on demand) + lore search "auth" --type spec --json
   → spec-user-auth found, status=approved
   lore ac list spec-user-auth → AC-AUTH-1..4 declared (plan-promote gate will pass)

2. Define Invariants:
   - REST: /api/v1/{resource}
   - Error format: { code, message, details }
   - Coverage ≥80%

2b. Risk Identification:
   **[RISK_REGISTER]** 3 risks identified: 1H / 1M / 1L
   | # | Category | Impact | Trigger | Mitigation | Contingency |
   | 1 | Technical | H | JWT library lacks refresh token rotation | Research phase evaluates libs | Switch to passport-jwt |
   | 2 | Dependency | M | Redis unavailable for rate limiting | Use in-memory fallback | Deploy without rate limiting, add later |
   | 3 | Scope | L | OAuth requirement added mid-sprint | [NEEDS CLARIFICATION] marker | Defer to Phase 3 |

3. Skill→Task mapping:
   research:sdk    → "Research auth approaches" (Phase 1)
   design:arch     → "Design auth API + DB schema" (Phase 1)
   implement:be    → split into 4 concrete tasks (Phase 2)
   test:unit       → "Unit test auth module" (Phase 2)

4. lore calls:
   lore feed plan-promote
   lore create plan --title "User Authentication" --parent spec-user-auth \
     --content-file /tmp/plan-content.md --json
   → plan-user-authentication
   # Content includes: Invariants + Risk Register + Estimation Summary + Critical Path + Exit Criteria

5. Phases, then task docs:

   # 5A. Declare ALL phases (include a final verification phase)
   lore phase add plan-user-authentication "Phase 1: Research & Design"
   lore phase add plan-user-authentication "Phase 2: Implementation"
   lore phase add plan-user-authentication "Phase 3: Verification" \
     --description "Final gate: e2e + review before plan completion"

   # 5B. Create every leaf task
   lore create task --title "[Skill:research] Evaluate auth approaches" \
     --parent plan-user-authentication --plan-id plan-user-authentication \
     --phase "Phase 1: Research & Design" \
     --content "Estimate: M\nScope-Alt: Can skip OAuth evaluation if only JWT needed\n\nAC:\n- Comparison table with >=5 criteria"
   → task-evaluate-auth-approaches

   lore create task --title "[Skill:design] Design auth API" \
     --parent plan-user-authentication --plan-id plan-user-authentication \
     --phase "Phase 1: Research & Design" \
     --content "Estimate: M\nApproach: OpenAPI-first design\nSource: prd-auth section 4\nScope-Alt: Can defer admin endpoints to Phase 3\nCovers: AC-AUTH-1\n\nAC:\n- OpenAPI spec, all endpoints documented"
   → task-design-auth-api

   lore create task --title "[Skill:implement] JWT middleware" \
     --parent plan-user-authentication --plan-id plan-user-authentication \
     --phase "Phase 2: Implementation" \
     --anchor src/middleware/jwt.ts --priority critical \
     --content "Estimate: M\nApproach: express-jwt\nSource: research conclusion\nDimensions: D-FUNC, D-SEC\nScope-Alt: Can defer refresh rotation to later task\nCovers: AC-AUTH-2\n\nAC:\n- Given a valid Bearer token, When any /api/v1/* route is hit, Then req.user is populated\n- Given an invalid/expired token, When any protected route is hit, Then 401 with { code, message }"
   → task-jwt-middleware
   # ... remaining Phase 2 + Phase 3 tasks ...

   # 5C. Wire dependencies (blocker FIRST, blocked SECOND)
   lore link task-evaluate-auth-approaches task-design-auth-api --type=blocks
   lore link task-design-auth-api task-jwt-middleware --type=blocks

6. Critical Path Analysis:
   **[CRITICAL_PATH]** duration: 8 session-units | path: task-design-auth-api → task-jwt-middleware → task-auth-routes → task-e2e-auth | slack tasks: 2
   lore set task-design-auth-api --priority critical   # etc. for path members

7. Estimation Summary:
   **[ESTIMATION]** Total: 10 session-units | Phase 1: 4 | Phase 2: 6 | Critical path: 8 session-units

8. Validation gate:
   lore ready plan-user-authentication --json   # structural: all tasks present, ready set non-empty, no anchor conflicts
   lore ac list spec-user-auth                  # coverage: every AC id in some task's Covers → 4/4
   S3 bundle review: ONE lore-reader dispatch over spec-user-auth + this plan (5-dimension plan lens) → PASS
   lore review spec-user-auth                   # per-version judgment, once, on the final spec
   S4: one AskUserQuestion over the whole bundle (lore tree output, strategy chosen/rejected, branches) → 批准
   lore approve spec-user-auth && lore approve plan-user-authentication   # specs first; plan-promote → pass

9. lore ready plan-user-authentication --json → first ready task: task-evaluate-auth-approaches (⭐ critical path)
```

## Example: Gate denial is the system working

```
lore approve plan-user-authentication
→ exit 4 + feeding pack: "plan-promote: spec-tier ancestor spec-user-auth is draft
   (requires approved) ..."

# Fix per the pack — the gap belongs upstream:
#   spec not approved → route to /design owner: lore approve spec-user-auth
#     (spec-promote requires >=1 structured AC — lore ac add belongs to the spec author)
# Then retry:
lore approve plan-user-authentication → ok
# ⛔ Never LORE_GATE_BYPASS=1 without explicit user say-so.
```

## Example: Resume (with risk + schedule awareness)

```
`lore bootstrap` on demand → active plan plan-user-authentication detected
lore feed session-resume --plan plan-user-authentication
→ latest handoff: decisions (bcrypt rounds=12), next steps, no failing oracle

lore get plan-user-authentication → Invariants, Risk Register, Estimation Summary
lore tree plan-user-authentication →
  Phase 1: ✅ 3/3 archived | Phase 2: 🔄 2/5
lore ready plan-user-authentication --json →
  ready: [task-jwt-middleware, task-password-hashing]  (no mutual blocks — parallel)
  sessions: []            # nobody else working
  anchor_conflicts: []

Output:
  **Resuming Plan: User Authentication** (plan-user-authentication)
  Progress: 62.5% (5/8 archived)
  Schedule: 6 session-units remaining | on-track (Phase 1 actual=4su vs estimated=4su)
  Invariants: REST /api/v1/{resource}, error format, coverage ≥80%
  Phase 2 Constraints: bcrypt (decided Phase 1), JWT RS256 (decided Phase 1)

  **Active Risks** (2):
  - 🔴 #1 Technical (H): JWT refresh rotation — mitigated (jsonwebtoken lib selected)
  - 🟡 #2 Dependency (M): Redis for rate limiting — active, trigger: Redis connection timeout

  **Critical Path** (remaining: 5 session-units):
  → task-jwt-middleware (M) → task-auth-routes (M) → task-e2e-auth (S)

  **Ready Tasks**: ⭐ task-jwt-middleware (critical path), task-password-hashing (slack: 2 units)
```

## Example: Update with Evidence + Risk Tracking

```
# task-jwt-middleware done → AC check + evidence + archive

**[AC CHECK]** task-jwt-middleware:
  ✅ Valid token → req.user populated
  ✅ Invalid/expired token → 401 { code, message }

lore evidence task-jwt-middleware --oracle test \
  --command "bunx vitest run src/middleware/jwt.test.ts" --result pass \
  --ac AC-AUTH-2
lore evidence task-jwt-middleware --oracle tsc \
  --command "bunx tsc --noEmit" --result pass

**[ESTIMATE_ACTUAL]** task-jwt-middleware: estimated M actual M

lore release task-jwt-middleware
lore set task-jwt-middleware --status approved
lore set task-jwt-middleware --status archived     # DONE — unblocks dependents

# Risk check: not a mitigation task, no risk triggers observed
lore ready plan-user-authentication --json
→ newly ready: task-auth-routes (⭐ critical path), task-password-hashing still ready

**[HEALTH_CHECK]** criteria: all_clear
```

## Example: Phase Gate (with risk review + estimation accuracy)

```
Last Phase 2 task archived → Phase Gate triggered:

1. Invariants check (lore get plan-user-authentication → parse Invariants):
   ✅ REST conventions: /api/v1/auth/*
   ✅ Error format: { code, message, details }
   ✅ Test coverage: 85%

2. Acceptance check (lore list --type task --plan-id plan-user-authentication --phase "Phase 2: Implementation" --json):
   ✅ task-password-hashing — pass evidence: test (bcrypt rounds=12)
   ✅ task-jwt-service — pass evidence: test (RS256, 15min access)
   ✅ task-jwt-middleware — pass evidence: test + tsc

3. Cross-phase consistency:
   ✅ API paths match Phase 1 design
   ⚠️ Refresh token rotation added (not in Phase 1 design)
      → Logged in Decisions Log (step 6 batched edit)

4. Risk review:
   **[PHASE_RISK]** mitigated: 1 | triggered: 0 | new: 0 | carried: 1

5. Estimation accuracy:
   **[PHASE_ESTIMATE]** estimated: 6 session-units | actual: 7 session-units | accuracy: 86%
   → RCF multiplier: 1.17 (applied to remaining Phase 3 estimate: 4 × 1.17 ≈ 5 su)

6. Batched plan-doc edit (risk register + RCF + Decisions Log in ONE edit):
   lore get plan-user-authentication --raw → edit → lore set plan-user-authentication --content-file /tmp/plan.md
   lore approve plan-user-authentication    # edit reset it to draft; re-approve

7. No user stop: gate passed, no Invariant violated → auto-proceed

Phase Gate: PASSED → proceed to Phase 3
```

## Example: Replan (scope change)

```
# User: "We need to add OAuth support, not just JWT"

Skill("plan","replan") on plan-user-authentication

1. Load state: lore tree + lore ready --json
   Phase 1: ✅ | Phase 2: ✅ | Phase 3: 🔄 (1/3 archived)

2. Change Request Analysis (ST reasoning):
   - What changed: New requirement — OAuth2 provider support (Google, GitHub)
   - Affected: Phase 3 tasks + need new Phase 4
   - Critical path: extends by ~4 session-units
   - New risks: OAuth callback URL management, token refresh complexity
   - NOTE: spec gap — OAuth is not in spec-user-auth. Route upstream FIRST:
     /product updates PRD → /design updates spec + lore ac add AC-AUTH-5/6 → then replan.

3. Impact assessment:
   **[REPLAN_IMPACT]**
   Change: Add OAuth2 support (Google + GitHub providers)
   Affected tasks: task-e2e-auth (needs OAuth cases)
   Critical path: shifted from 8 → 12 session-units (+4)
   New risks: 1H (OAuth callback security), 1M (provider API changes)
   In-flight collisions: none (no fresh claims per lore ready sessions[])
   Recommended approach: Option A — keep Phase 3, add Phase 4 for OAuth
   New scope outside every pre-registered branch → S1–S4 scoped to the change: user confirms Option A.

4. Execute modifications:
   lore phase add plan-user-authentication "Phase 4: OAuth"
   lore create task --title "[Skill:research] Evaluate OAuth libraries" \
     --parent plan-user-authentication --plan-id plan-user-authentication \
     --phase "Phase 4: OAuth" --content "Estimate: S\n..." → task-evaluate-oauth-libs
   lore create task --title "[Skill:implement] OAuth provider integration" \
     --phase "Phase 4: OAuth" --anchor src/auth/oauth/ --content "Estimate: L\n..." \
     --parent plan-user-authentication --plan-id plan-user-authentication → task-oauth-providers
   lore create task --title "[Skill:implement] OAuth callback handlers" ... → task-oauth-callbacks
   lore create task --title "[Skill:test] OAuth E2E tests" ... → task-oauth-e2e
   lore link task-evaluate-oauth-libs task-oauth-providers --type=blocks
   lore link task-oauth-providers task-oauth-callbacks --type=blocks
   lore link task-oauth-callbacks task-oauth-e2e --type=blocks

5. Critical path recalculated:
   **[CRITICAL_PATH_DELTA]** old: ...→task-e2e-auth (8 su) → new: ...→task-oauth-e2e (12 su)

6. Batched plan edit: Decisions Log + Risk Register (+2 risks) + Critical Path
   | 2026-03-22 | REPLAN: Add OAuth2 support | User requested Google+GitHub OAuth | +4 su, +4 tasks, +2 risks |
   lore set plan-user-authentication --content-file /tmp/plan.md && lore approve plan-user-authentication

7. lore ready plan-user-authentication --json → validation clean; user confirmation: ✅
```

## Example: Cancelling a task without stranding dependents

```
# task-redis-ratelimit cancelled (risk #2 accepted instead)

lore set task-redis-ratelimit --status approved
lore set task-redis-ratelimit --status deprecated

# ⛔ deprecated NEVER satisfies readiness — rewire every dependent:
lore unlink task-redis-ratelimit task-auth-routes
lore ready plan-user-authentication --json   # confirm task-auth-routes no longer blocked
```

## Example: Parallel Dispatch (anchors + distinct actors)

```
# Two ready tasks with disjoint anchors → dispatch two lore-implementer agents

lore ready plan-user-authentication --json
→ ready: task-jwt-middleware (anchors: src/middleware/jwt.ts),
         task-password-hashing (anchors: src/auth/hash.ts)
  anchor_conflicts: []

# Each agent is its own attested run (identity comes from the agent integration; no export needed):
#   agent A: implements task-jwt-middleware
#   agent B: implements task-password-hashing
# Each implementer claims FROM INSIDE ITS OWN WORKTREE:
#   lore claim task-jwt-middleware --worktree feat/jwt-middleware
#   lore claim task-password-hashing --worktree feat/password-hashing

# If anchors HAD overlapped: the second claim is REJECTED
# (gate:task-claim:anchor-overlap, exit 5-adjacent gate fail) — the feeding pack names
# the conflicting task/holder/paths. Planner's job: such pairs get a blocks link at
# plan time so this never fires at dispatch time.
# (Legacy alias, SPEC-056 D7: a `phase` doc's claim would instead surface
# gate:phase-claim:anchor-overlap — same predicate, additive checkpoint.)
```

## Example: Autopilot Integration

```
/lore-autopilot plan-user-authentication

[AUTOPILOT START]
Plans: 1 active (plan-user-authentication)
lore ready → task-jwt-middleware, task-password-hashing (parallel, ⭐ task-jwt-middleware)
Blocked: 0 | Active risks: 2 (1H mitigated, 1M active)

[TASK task-jwt-middleware] — dispatched (⭐ critical path)
  implementer: lore claim → implement → oracles →
  lore evidence --oracle test --result pass --ac AC-AUTH-2 → lore release
  orchestrator: merge → lore set --status approved → --status archived
[TASK task-jwt-middleware] ✅ archived

[TASK task-password-hashing] — dispatched
  ... same lifecycle ...
[TASK task-password-hashing] ✅ archived

[HEALTH_CHECK] criteria: all_clear
lore ready → task-auth-routes newly unblocked (⭐ critical path)
... continue loop ...

[PHASE GATE] Phase 2 complete → risk review + estimation accuracy → auto-proceed
[PLAN COMPLETE]
lore verify plan-user-authentication --allow-new-commands   # attested script ACs
lore assess plan-user-authentication --diff main..HEAD      # LLM-as-judge vs spec ACs — the initiative's single end-of-run assess (one plan here)
lore handoff --plan plan-user-authentication --next "monitor prod rollout"
Completed: 8 tasks | Estimate accuracy: 86% | Risks: 1 mitigated, 1 accepted
```
