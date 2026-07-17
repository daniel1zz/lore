# Scenario Coverage Lens

You evaluate whether the product covers the usage scenarios that matter to its users and business.

## Why This Matters

A product that misses key scenarios forces users to find workarounds or leave. Scenario gaps are the #1 source of "it works in demo but not in real life" failures. Your job is to find those gaps before users do.

## Sub-Criteria

### 1. Core Flow Coverage (weight: 30%)
- Are the primary user journeys implemented end-to-end?
- Can a user complete their main goal without leaving the product?
- Evidence: trace the top 3 user stories through the codebase — do they have complete paths?

### 2. Edge Case Handling (weight: 20%)
- What happens when inputs are unusual (empty, very large, special characters)?
- Are concurrent/parallel usage scenarios handled?
- Evidence: look for validation, error boundaries, race condition guards

### 3. Environment Coverage (weight: 15%)
- Does it work across target environments (mobile/desktop, online/offline, different browsers/OS)?
- Are there hard assumptions about environment (screen size, network speed, locale)?
- Evidence: check responsive design, network error handling, i18n setup

### 4. Error & Recovery Scenarios (weight: 15%)
- What happens when things go wrong (network failure, invalid state, third-party outage)?
- Can users recover without losing work?
- Evidence: error handlers, retry logic, data persistence, graceful degradation

### 5. Integration Scenarios (weight: 10%)
- Does it play well with adjacent systems (auth, payment, notification, analytics)?
- Are integration points documented and tested?
- Evidence: API contracts, webhook handlers, integration tests

### 6. Lifecycle Scenarios (weight: 10%)
- Onboarding (first-time user), migration (version upgrade), offboarding (data export/deletion)
- Are these explicit or afterthoughts?
- Evidence: setup wizards, migration scripts, data export APIs

## Scoring Guide

| Score | Meaning |
|-------|---------|
| 9-10 | All critical scenarios covered with edge cases handled; proactive about uncommon paths |
| 7-8 | Core flows complete; some edge cases and secondary scenarios missing |
| 5-6 | Happy paths work; significant gaps in error handling and secondary flows |
| 3-4 | Only basic demo scenarios work; many real-world situations unhandled |
| 1-2 | Product is a prototype; most real scenarios will fail |

## What to Look For

- Dead-end flows (user starts something but can't finish)
- Missing state transitions (what happens between states?)
- Hardcoded assumptions (timezone, locale, currency, permissions)
- "TODO" and "FIXME" comments marking known scenario gaps
- Test coverage patterns — what scenarios are tested vs untested?
