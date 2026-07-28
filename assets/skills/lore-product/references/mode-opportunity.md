# Mode: Opportunity

**Purpose**: Derive the feature list instead of inventing it — an Opportunity Solution Tree (OST) that connects one measurable outcome to evidenced customer needs to competing solutions to disproving experiments.

> Method basis: Teresa Torres, *Continuous Discovery Habits*. This mode is the structural answer to "the AI keeps asking me what to build."

📎 **Read [example-ost.md](example-ost.md) before producing a tree** — a filled tree at the expected granularity, plus the same tree done badly. Output detail anchors on the exemplar you have seen; the bad half is what this mode degrades into when the gates below are applied loosely.
📎 No user evidence yet? [interview-protocol.md](interview-protocol.md) is the instrument for obtaining it.

## Why this mode exists

Ideation produces enthusiasm and concerns. Discovery produces market signal. Neither produces a **defensible feature list** — so the list ends up coming from whoever is in the room, and the AI's contribution degrades to transcribing the user's own ideas back to them.

The OST closes that gap by making features a *derived artifact*: every requirement that later appears in the PRD must trace to a leaf of this tree, or it does not belong in the PRD.

## Input contract

| Required | Source |
|----------|--------|
| One measurable business/product outcome | User, roadmap, or discovery output |
| Research evidence about user pain | `lore-product-benchmark` gaps, ux-research, discovery, support tickets, analytics, interviews |

If evidence is absent → do NOT proceed by brainstorming opportunities from imagination. Route to `lore-product-benchmark` (what exists and what nobody serves) or `/lore-product ux-research` (talk to users) first, and say so.

## Level 1: Desired Outcome (exactly one)

A measurable metric with a **baseline and a target**, not a project name.

| ✅ Valid | ❌ Invalid | Why |
|---------|-----------|-----|
| "7-day activation 23% → 40%" | "Improve onboarding" | Not measurable |
| "Weekly retained teams 120 → 200" | "Launch mobile app" | That is a solution |
| "Median time-to-first-value 40min → 5min" | "Make users happier" | No baseline, not observable |

⛔ One outcome per tree. Two outcomes = two trees. A tree serving "growth and retention and revenue" cannot prioritize.

If no baseline is known, the first deliverable of this mode is *instrumentation to obtain it* — state that plainly rather than inventing a number.

## Level 2: Opportunities (customer needs, evidence-gated)

An opportunity is a **need, pain, or desire stated in the user's terms**. It never contains a product noun.

**Solution-in-disguise detector** — reject the opportunity if any is true:
1. It names a UI element, page, or system ("a dashboard", "an onboarding wizard", "AI-powered X")
2. Prefixing "users need " makes it ungrammatical or absurd
3. There is exactly one obvious way to satisfy it (a real need admits many)

| ✅ Opportunity | ❌ Solution in disguise |
|---------------|----------------------|
| "New users don't know what to do first" | "Add an onboarding wizard" |
| "I lose my place when I come back the next day" | "Add a resume banner" |
| "I can't tell whether the run succeeded" | "Add a status badge" |

**Evidence gate (HARD)**: each opportunity cites **≥2 independent sources**, tagged with tier from the evidence ladder in [mode-validate.md](mode-validate.md). Opportunities resting only on E5/E6 (survey answers, "would you use") are marked `⚠️ unevidenced` and may not be selected for the branch to pursue.

Opportunities must be **independent** — if satisfying A requires first satisfying B, B is the real opportunity and A is a sub-branch.

## Level 3: Solutions (≥3 per opportunity — HARD)

⛔ **Fewer than 3 solutions means the solution space was not explored.** One solution is not a choice, it is an anchor.

Force diversity — a set of three near-identical variants does not count. Generate across these axes:

| Axis | Prompt |
|------|--------|
| **Remove** | Can we make the need disappear instead of serving it? (best solutions often delete a step) |
| **Automate** | Can the system do it without the user? |
| **Assist** | Can we make the user's existing path faster/clearer? |
| **Defaults** | Can a better default make the decision unnecessary? |
| **Borrow** | What did the benchmark teardown show others doing here? |
| **Absurd** | The version that is obviously too much — it exposes hidden constraints |

**Parallelization**: for ≥3 opportunities, dispatch one subagent per opportunity to generate its solution set concurrently. Pass the outcome, the opportunity, its evidence, and the axes table. Always pass an explicit `subagent_type` (never rely on a `general-purpose` default — some environments hard-block it).

## Level 4: Experiments (must be able to disprove)

Each solution gets the **smallest test that could show it does not work**.

⛔ An experiment that can only confirm is not an experiment. State the kill condition before running it.

| Experiment | Answers | Cost |
|-----------|---------|------|
| Fake door / painted door | Does anyone want it? | Hours |
| Wizard of Oz (human behind the curtain) | Does the output actually help? | Days |
| Prototype + 5 target users (`lore-prototype`) | Can they figure it out? | Days |
| Engineering spike | Can we build it at all? | Days |
| Concierge (do it manually for 3 users) | Does solving it change their behavior? | Days |
| A/B test | Does it move the outcome at scale? | Weeks — last, not first |

Record for each: **hypothesis · kill condition · smallest test · what we will do with either result.**

## Tree shape

```
Outcome: 7-day activation 23% → 40%
├── Opportunity 1: "New users don't know what to do first"  [E1 x2, E3 x1]
│   ├── Solution A: Guided first-run task  → Exp: prototype w/ 5 users, kill if <3 complete
│   ├── Solution B: Ship with a populated sample workspace → Exp: fake door, kill if <10% click
│   └── Solution C: Remove setup entirely; infer from first import → Exp: eng spike, kill if >2wk
├── Opportunity 2: ...
└── Opportunity 3: ...
```

## Prioritization — pick ONE branch

You cannot test everything. Score each opportunity 1-5 on three anchored scales — anchored so two runs of this mode reach the same answer, and so a score can be argued with:

| | 1 | 3 | 5 |
|---|---|---|---|
| **Evidence strength** | Single E5/E6 source | 2 independent sources, best is E4 | ≥2 independent sources incl. E1/E2/E3 |
| **Outcome leverage** | Plausibly related; no line to the metric | Affects a step where some of the gap sits | Sits on the largest measured drop-off in the gap |
| **Disproof cost** | Needs live traffic or a full build (weeks) | Prototype or spike (days) | Fake door, existing data, or a support-log read (hours) |

Rank by the mean; break ties with disproof cost, because a cheap wrong answer is recoverable and an expensive one is not.

Then commit to exactly three labels — ⛔ producing only a winner hides the reasoning that will be re-litigated next month:

| Label | Meaning |
|-------|---------|
| **Recommended** | Pursue now — carry into `validate` |
| **Alternative** | Would pursue if the recommended branch is refuted — name the trigger that would promote it |
| **Not recommended** | Explicitly parked — record *why*, and what evidence would reopen it |

⛔ Pursue at most 2-3 opportunities simultaneously. A tree with every branch active is a backlog, not a strategy.

State the chosen branch, the rejected branches, and the reason for each rejection. Rejections are as valuable as the selection and must be preserved — they are what stops the same idea returning next month.

## Exit Criteria

- [ ] Exactly one outcome, measurable, with baseline (or an instrumentation task to get one)
- [ ] Every opportunity is a need, passes the solution-in-disguise detector, cites ≥2 independent sources with tiers
- [ ] Every opportunity has ≥3 materially different solutions
- [ ] Every solution has an experiment WITH a stated kill condition
- [ ] One branch selected; rejected branches recorded with reasons
- [ ] Persisted to corpus and linked upstream

## Persist (MANDATORY)

```bash
lore create knowledge --sub-type research --title '{outcome} Opportunity Solution Tree' --content ...
lore link <ost-doc> <benchmark-or-discovery-doc> --type=implements
```

## Handoff

| Next | Trigger | Contract |
|------|---------|----------|
| `/lore-product validate` | Branch selected | Solutions + experiments + kill conditions → executed validation |
| `/lore-product decompose` | Solution validated | Validated leaf → story map → requirements read off the map |
| `/lore-product ux-research` | Opportunities are `⚠️ unevidenced` | Need real user data before committing |

⛔ **Do not jump from this mode straight to PRD** with unvalidated solutions. That reintroduces exactly the guesswork the tree was built to remove — see [mode-validate.md](mode-validate.md).

## Guidelines

- CRITICAL: NEVER skip from outcome directly to solutions. The opportunity layer is where the insight lives.
- ALWAYS push a feature-shaped opportunity back to the underlying need before accepting it.
- NEVER accept a single solution per opportunity — that is an anchored decision wearing a tree's clothes.
- ALWAYS ground opportunities in research evidence, not plausibility.
- ALWAYS design experiments that could disprove the solution, not merely demonstrate it.

## Triggers

"What should we build", "derive the features", "opportunity tree", "OST", "map the solution space",
"该做什么功能", "功能怎么定", "机会树"
