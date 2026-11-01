# Mode: Decompose

**Purpose**: Expand a *validated* solution into the concrete steps a user actually walks, so requirements are read off a map instead of invented while drafting the PRD.

> Method basis: Jeff Patton's user story mapping. This mode exists because a validated OST leaf is one sentence, and one sentence is not a scope.

## Why this mode exists

`opportunity` derives *which* bet to make. `validate` proves the bet is real. Neither produces detail. Without this step, the chain hands the PRD a line like "suggested starting dashboards" — and the PRD author fills in the twenty decisions hiding inside it: what happens on failure, what the second-time user sees, what "suggested" means when there is nothing to suggest from.

Those twenty decisions are where a product is actually decided, and inventing them during PRD drafting is the exact failure the upstream gates were built to stop. It is also where "the AI's output is coarse" comes from: a one-line feature prompts a one-line requirement.

⛔ **Decompose only what survived validation.** Mapping a refuted or untested solution is elaborate fiction — and the elaboration makes it more convincing, not less wrong.

## Input contract

| Required | Source |
|----------|--------|
| A solution marked `✅ validated` (value + usability at minimum) | [mode-validate.md](mode-validate.md) Validation Ledger |
| The need it serves | [mode-opportunity.md](mode-opportunity.md) OST |
| Observed behaviour of the current path | Interviews / session replays / benchmark teardown |

Not available → go back. This mode cannot manufacture them.

## Step 1: The backbone — what the user does, in order

Write the **user's activity sequence** left to right, in their vocabulary, in the present tense. The backbone describes the journey **as it will be**, including steps that exist today and are unchanged.

```
Connect a source → See what's possible → Build first view → Trust the number → Share it
```

Rules:
- Backbone steps are **user activities**, never system components. "Authenticate" is a step; "auth service" is not.
- 4-8 steps. More means you are describing implementation; fewer means you are describing a slogan.
- ⛔ Include the steps you are **not** changing. Scope decisions made without the surrounding journey visible are how a feature ships into a flow that cannot reach it.

## Step 2: Tasks under each step

Under each backbone step, list what the user must accomplish there — ordered vertically by necessity, most essential at the top.

```
Connect a source      See what's possible        Build first view
─────────────────     ──────────────────────     ─────────────────
pick a source         see suggestions from       edit a suggested view
authenticate          MY data                    add a second metric
pick tables           understand why these       rename it
retry after failure   dismiss ones I don't want  start from scratch instead
resume tomorrow       ask for different ones     undo a bad edit
```

**Force the unhappy paths onto the map.** For every step, ask the four questions explicitly — a map without them is a demo script, and the missing rows become production defects:

| Question | Example row it produces |
|----------|------------------------|
| What if it fails? | "retry after failure" |
| What if they leave and return? | "resume tomorrow" |
| What if there is nothing yet? | "understand why there are no suggestions" |
| What if there is far too much? | "find one dashboard among sixty" |

## Step 3: Slice

Draw a horizontal line across the map. **Everything above it is the first release.**

A valid slice is a **thin walk of the entire backbone** — the user can get from the first step to the last, badly. An invalid slice is one step built completely while a later step has nothing.

| ✅ Valid slice | ❌ Invalid slice |
|---------------|-----------------|
| Connect 2 sources → 3 suggestions → edit one → see freshness → copy a link | Connect all 8 sources perfectly, nothing after it |

⛔ **A vertical slice ships a working journey; a horizontal slice ships a component.** Only the first can be put in front of a user, which means only the first produces evidence.

State explicitly what falls below the line and why. Below-the-line rows are not deleted — they are the next slice, and having them written down is what stops them being rediscovered as "new requirements" mid-build.

## Step 4: Read off the requirements

Each row above the line becomes one requirement, inheriting its provenance:

| Map row | Requirement | `source` | `validation` |
|---------|------------|----------|-------------|
| see suggestions from MY data | FR-001 Suggested dashboards for inferable schemas | OST O1/S1 → map step 2 | ✅ validated (ledger: 27% CTR, 5/5 usability) |
| understand why there are no suggestions | FR-003 Empty-state fallback with reason | map step 2, unhappy path | ⚠️ unvalidated — derived from the map, never tested |

⛔ Rows produced by the unhappy-path questions are usually `⚠️ unvalidated` — validation tested the happy path. Tag them honestly rather than letting them inherit the parent's ✅. This is the most common way a ledger's credibility gets laundered onto untested scope.

## Exit Criteria

- [ ] Backbone is 4-8 user activities in the user's words, including unchanged steps
- [ ] Every step carries tasks ordered by necessity
- [ ] All four unhappy-path questions asked per step, with the produced rows on the map
- [ ] Slice line drawn; the above-the-line set walks the whole backbone end to end
- [ ] Below-the-line rows recorded, not discarded
- [ ] Every above-the-line row carries `source` + `validation`
- [ ] Persisted and linked to its ledger and OST

## Persist (MANDATORY)

```bash
lore create knowledge --parent <spec or prd it concerns> --sub-type research --title '{solution} Story Map' --fields-file f.yaml   # skeleton: lore template show knowledge --kind research --blank
lore link <map> <validation-ledger> --type=implements
```

## Handoff

| Next | Contract |
|------|----------|
| `/lore-product prd` | Above-the-line rows → requirements, provenance and validation status already attached |
| `/lore-product validate` | Any row the map exposed as a new untested bet (common for empty/error states) |
| `lore-design-ui` | The backbone is the screen flow; unhappy-path rows are the states to design |

## When to skip

Skippable for a Minimal PRD (improvement, <2wk, low risk) whose change touches a single existing step. ⛔ Not skippable when the change **adds a step to the journey** — that is precisely when the surrounding steps break in ways nobody enumerated.

## Triggers

"break this down", "story map", "what are the actual requirements", "decompose this feature",
"拆功能", "用户故事地图", "这个方案具体要做什么"
