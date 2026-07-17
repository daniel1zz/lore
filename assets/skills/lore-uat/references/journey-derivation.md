# Journey Derivation — from anchor to Journey Matrix

The quality of acceptance is capped by the quality of the journeys. A brilliant execution of the wrong journeys still misses by 10 km. Spend real effort here.

## Step 1: Build the requirement inventory

Before deriving a single journey, enumerate what the anchor actually promises. Walk the PRD/spec and extract every **user-facing commitment** as a numbered requirement:

```yaml
# journeys/requirements.yaml
- id: R-01
  statement: "A buyer can find a laptop under a price ceiling and complete checkout"
  source: "PRD §2.1"
  severity: P0        # same scale as journey priority: P0 core value / P1 supporting / P2 edge
- id: R-02
  statement: "A returning buyer can see their order history and each order's delivery status"
  source: "PRD §3.2"
  severity: P1
```

Rules for the inventory:
- A requirement is a **user outcome**, not a feature name — apply the same translation discipline as Step 3 goals.
- Non-functional promises the spec makes to users (e.g. "works on mobile", "loads instantly") belong in the inventory too; they will be verified by the UIUX audit or by journeys with matching personas/contexts.
- If the anchor is a reconstructed model (no PRD), the inventory inherits the UNCONFIRMED flag.

This inventory is the denominator of the whole acceptance run. Without it, "we accepted the product" silently means "we accepted the journeys we happened to think of" — the spec-sampling illusion (failure mode #6).

## Step 2: Extract personas

From the anchor (PRD / spec / reconstructed model), list every distinct user group. A persona is worth separating when it differs in at least one of:

- **Knowledge** — what they already know (a returning power user vs. someone who arrived from a marketing link)
- **Goal** — why they came
- **Context** — device, urgency, permissions/role

Write each persona as a **persona card** — this is the ONLY product knowledge the executor will receive, so it must be self-contained and must NOT leak implementation details:

```yaml
persona:
  name: "Xiao Wang, first-time buyer"
  knows: "Heard from a friend that this site sells refurbished laptops cheaply. Has never seen the site."
  wants: "Buy a laptop under ¥3000 and know when it will arrive."
  context: "On a phone-sized window, in a hurry, will give up after ~10 minutes of confusion."
```

The `knows` field is a whitelist, not a summary — anything not listed there is knowledge the executor may not use.

## Step 3: Extract goals per persona

For each persona, list the jobs-to-be-done the spec claims the product serves. A goal is an outcome in the user's world ("know when the laptop arrives"), never a feature name ("use the order-tracking page"). If the spec only lists features, translate each feature back into the user outcome it exists for — features that translate to no outcome are themselves a finding to report.

## Step 4: Cross with scenarios — the Journey Matrix

For each persona × goal pair, derive journeys across scenarios. Scenarios come in two groups:

**Session scenarios** — what can happen within one sitting. The happy path is one row; these four are mandatory for every P0 goal (failure mode #4's countermeasure):

| Scenario | What it exposes |
|----------|-----------------|
| **First-time / empty state** | Onboarding gaps, blank screens with no guidance, cold-start dead ends |
| **Error recovery** | Wrong input, network failure mid-flow: is data lost? is the error message actionable to THIS persona? |
| **Abandon and return** | Close the tab mid-flow, come back: draft preserved? cart intact? forced restart? |
| **Real-world messy input** | Pasted whitespace, 60-char names, emoji, IME composition, double-clicks on submit |

**Lifecycle scenarios** — what happens to a real user over days and months. Session scenarios only ever meet the product on day one; a real user relationship has stages, and products routinely pass day one and fail week three (failure mode #7). Two of these are mandatory for every P0 goal:

| Scenario | Mandatory | What it exposes |
|----------|-----------|-----------------|
| **Return user** | ✅ per P0 goal | Close the browser entirely, reopen the entry URL later (same profile): is the user still signed in or re-entry graceful? Is yesterday's data intact, findable, and *continuable* — not just present but usable to pick up where they left off? |
| **Accumulated state** | ✅ per P0 goal | Seed a realistic volume of aged data (default: 30+ records with varied dates/lengths/states — scale to what the spec implies a month of real use produces). Does the core flow still work? Can the user still find what matters, or has the UI degenerated into an unusable wall? Pagination, search, and performance under real load live here |
| **Sunset** | thorough tier | Export my data, delete an account/workspace, downgrade: does the product honor the exit honestly (complete export, real deletion, no dark patterns)? |

The `accumulated-state` seed is prepared by the main agent **before dispatch** (fixtures, API calls, or a seeding script) — never by the executor mid-journey. The persona card then honestly reflects it: "You have been using this app for a month; your data is in it." That familiarity belongs on the `knows` whitelist; the seed's implementation details do not.

Not every cell needs a journey — collapse cells that would exercise identical product surface. But record the collapse decision in the journey file's `coverage_notes` so the next run knows it was deliberate, not forgotten.

## Step 5: Set business-outcome success criteria

This is the single highest-leverage rule in the skill. A success criterion must be observable **in the user's world or in the data**, never in the UI's mood:

| ❌ UI-state criterion | ✅ Business-outcome criterion |
|----------------------|------------------------------|
| "Success toast appears" | "The order exists with the right items, total, and address; confirmation email/record is queued" |
| "Form submits without error" | "The created project appears in the list and can be opened; its settings match what was entered" |
| "Export button works" | "The downloaded CSV contains exactly the filtered rows with correct values" |

Each criterion gets an `oracle` hint: how it can be verified (`ui` — visible in product; `api` — checkable via request; `artifact` — downloadable file to inspect). The JUDGE phase and Playwright compilation both consume this.

## Step 6: Prioritize

- **P0** — journeys embodying the product's core value proposition. Ask: "if this journey fails, does the product have a reason to exist?" Typically 3–7 journeys. Any P0 hard-gate failure → overall REJECT.
- **P1** — supporting journeys: account management, settings, secondary flows the spec commits to.
- **P2** — edge journeys: rare personas, unusual scenarios. Run when budget allows; never block the verdict alone.

## Step 7: Coverage audit — close the loop against the inventory

Derivation runs forward (spec → journeys); coverage runs backward (requirement → which journeys verify it). After the matrix is drawn, audit it:

1. Every journey's `spec_ref` must cite requirement IDs (`R-##`) from the inventory, not free-text headings.
2. For every requirement, record its coverage in `journeys/coverage.md`:

```markdown
| Req | Severity | Covered by | Status |
|-----|----------|------------|--------|
| R-01 | P0 | J-001, J-003 | covered |
| R-02 | P1 | J-007 | covered |
| R-09 | P1 | — | UNCOVERED: cut by standard tier budget |
| R-12 | P2 | — | UNCOVERED: requires SMS gateway not present in staging |
```

3. Every UNCOVERED row needs an honest reason (budget cut / environment limitation / not user-observable). "Forgot" is not a reason — it is the bug this step exists to catch.
4. **A P0 requirement may never be UNCOVERED.** Budget pressure resolves by cutting P1/P2 coverage or collapsing scenario cells, never by dropping a P0 requirement. If a P0 requirement genuinely cannot be exercised (environment limitation), the run cannot cleanly ACCEPT — the verdict carries a `COVERAGE-GAP` modifier (see judging-rubric.md, the aggregation SSOT).

After all journeys are judged, the REPORT phase fills a final column (`verdict`) per requirement — so the report answers "which promises were verified, which passed, and which were never checked" directly, not implicitly.

## Step 8: Fit the budget tier

Journey count is `personas × goals × scenarios` — it explodes fast (5 personas × 3 goals × 7 scenarios ≈ 105 journeys, each an executor + a judge). Unbounded derivation is what exhausted budget and lost every verdict in the first real run. Pick a tier and cap accordingly; the priority-tiered checkpoint order (P0 fully judged and written before P1 starts) means an over-budget run still delivers the verdicts that matter most.

| Tier | Covers | Per-P0-goal scenarios | Max concurrent executors |
|------|--------|----------------------|--------------------------|
| **quick** | P0 only | happy + the 1 riskiest non-happy + return-user | 2 |
| **standard** (default) | P0 + P1 | happy + all 4 session + return-user + accumulated-state | 3 |
| **thorough** | P0 + P1 + P2 | all of standard + sunset + edge personas | 4 |

Before dispatch, estimate journey count × ~2 subagents and state it. If it exceeds the run's budget, drop to a lower tier (or P0-only) rather than starting a run that will die mid-way. Collapse cells that would exercise identical product surface, and record the collapse in `coverage_notes`. Whatever the tier cuts, the coverage audit (Step 7) records — a lower tier shrinks the *journey list*, never the honesty of the *coverage report*.

## Incremental derivation (Journey Ledger exists)

When `journeys/*.yaml` survives from a previous run:

1. Diff current spec against the ledger's `spec_ref` fields **and rebuild the requirement inventory** — new/changed/removed requirements drive the journey diff.
2. New spec items → new journeys. Changed items → update affected journeys, reset their `last_verdict`.
3. Removed items → mark journeys `status: retired` (do not delete — history matters for regression archaeology).
4. Unchanged journeys keep their compiled Playwright specs as the regression floor; re-execute semantically only the changed/new ones, plus one unchanged P0 journey as a canary.
5. Regenerate `journeys/coverage.md` from the updated inventory — a stale coverage matrix is worse than none.
