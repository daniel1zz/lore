# Mode: Validate

**Purpose**: Execute the cheapest experiments that could prove the bet wrong, and grade the resulting evidence — before engineering is committed.

> Method basis: Marty Cagan's four product risks (*INSPIRED*), Rob Fitzpatrick's *The Mom Test*, and multiplicative problem scoring. This mode is the difference between "we listed some validation steps" and "we know."

📎 **Read [example-validation-ledger.md](example-validation-ledger.md) first** — a fully worked ledger where the expensive experiment fails, showing what an honest result looks like and how a reshaped bet stays `⚠️ unvalidated`.
📎 Talking to users is the instrument behind E1-E4: [interview-protocol.md](interview-protocol.md).

## Why this mode exists

The chain ideation → discovery → PRD produces a *plan to validate* and then never validates. Requirements enter the PRD carrying the same confidence as facts, and the first real feedback arrives after the code ships. This mode is the missing execution step, and it is a **gate**: what passes here enters the PRD as validated; what does not enters flagged, or not at all.

⛔ **Discovery output is validated ideas backed by evidence — not a document.** A validation section nobody executed is a liability, because it reads as diligence.

## The Evidence Ladder (used by ALL product modes)

Every claim about users or demand is tagged with its tier. This ladder is about **product/user evidence**; it is orthogonal to the S/A/B/C technical-source tiers in CLAUDE.md, which grade documentation for technical claims.

| Tier | Evidence | Weight |
|------|----------|--------|
| **E1** | **Observed behavior** — you watched them struggle, or instrumented data shows the behavior | Strongest |
| **E2** | **Money spent** — they already pay for a partial solution or a competitor | Strong |
| **E3** | **Time invested** — they built a spreadsheet, script, or manual process to cope | Strong |
| **E4** | **Past-behavior quotes** — Mom-Test-compliant interview answers about what they actually did | Moderate |
| **E5** | **Public complaints** — support tickets, forum/review posts with specifics | Moderate |
| **E6** | **Stated intent** — survey answers, "I would definitely use that" | ⛔ Near-zero. Never sufficient alone |

⛔ **Enthusiasm is not evidence.** "This looks amazing" and "I'd pay for that" are E6. They predict nothing. The only future-tense signal that counts is one backed by an irreversible commitment (prepayment, a signed pilot, a calendar hold, real data uploaded).

⛔ **Warm sources are discounted one full tier.** Friends, teammates, and existing champions want to be encouraging.

## Part A: Is the problem worth solving?

Score four dimensions 1-5. **Every score cites evidence with its tier** — an uncited score is invalid, not "assumed 3".

| Dimension | 5 | 3 | 1 |
|-----------|---|---|---|
| **Frequency** — how often does it occur? | Daily+ | Monthly | Rarely / once |
| **Intensity** — how bad when it does? | Blocks critical work; real loss of money/time/reputation | Annoying but manageable | Barely noticed |
| **Workarounds** — have they already tried to solve it? | Paying for partial solutions or built custom tooling | Basic tedious process | Never attempted |
| **Willingness to pay** | Already spending on partial solutions | "Probably would" (hypothetical — discount) | Never considered paying |

**Score = Frequency × Intensity × Workarounds × WTP** (range 1-625)

| Score | Verdict |
|-------|---------|
| **≥250** | Strong signal → proceed |
| **100-249** | Promising → gather evidence on the weakest dimension before committing |
| **<100** | Weak → reframe the problem or walk away |

Multiplicative, not additive, on purpose: a zero-ish dimension cannot be averaged away. A daily, intense problem nobody has ever tried to solve is not a problem — it is a fact of life users have accepted.

**Worked example** — "PDF export": Frequency 3 (monthly board reports, E5 ticket) × Intensity 2 (screenshot workaround exists, E1) × Workarounds 4 (3 users built print-to-PDF flows, E3) × WTP 1 (nobody pays for export tooling, E2 absent) = **24 → Kill.**

⛔ **The workaround dimension is the honest one.** If nobody has ever cobbled anything together, the pain is below the threshold where people act, no matter how loudly they complain.

## Part A2: Assumption map — decide what to test FIRST

⛔ **Do not test all four risks on every solution in parallel.** That spends the expensive tests before the cheap ones have had a chance to make them unnecessary.

List every assumption the branch rests on, place each on importance × evidence, and test in that order:

| | **No evidence** | **Some evidence** | **Strong evidence** |
|---|---|---|---|
| **High importance** | ⚠️ **Test first — this is the bet** | Test second | Don't test — already known |
| **Low importance** | Note it, don't test | Ignore | Ignore |

The riskiest assumption is the one that, if false, makes everything downstream pointless. Test it with the cheapest instrument that could kill it. A three-day engineering spike queued behind a two-hour fake door is not slower — it is often never needed, because the fake door already killed the idea.

## Part B: The four risks (per solution)

A solution is validated only when **all four** are addressed — but addressed in assumption-map order, not all at once. Each has its own cheapest test.

| Risk | Question | Cheapest test | Pass bar |
|------|----------|--------------|----------|
| **Value** | Will they use/buy it? | Fake door, concierge, pre-sale, Wizard of Oz | Behavioral commitment from ≥5 target users, not warm contacts |
| **Usability** | Can they figure it out? | Prototype (`lore-prototype`) + 5 target users, unassisted | ≥4/5 complete the core task without help |
| **Feasibility** | Can we build it? | Engineering spike, timeboxed | Spike answers the specific unknown; no "probably fine" |
| **Viability** | Does it work for the business/us? | Unit economics, legal/privacy, support load, maintenance surface | Explicit numbers or an explicit accepted risk |

**Usability testing discipline**: give the task, then stay silent. The moment you explain, the test is over and its result is void. Record where they hesitate, not what they say afterwards.

**Value testing discipline**: a fake door measures intent to click, which is weaker than intent to pay. Escalate to the strongest signal the stage affords — clicks < signups < uploaded real data < prepayment.

## Part C: Execute (this is the part that gets skipped)

⛔ **This mode does not end with a plan. It ends with results.** If an experiment cannot be run now, say which one and why, and mark the item `unvalidated` — never mark it validated by reasoning.

| Tool | Use for |
|------|---------|
| `lore-prototype` | Usability + logic/state questions; throwaway by construction |
| `agent-browser` | Standing up a fake-door page, driving a live prototype, capturing user-session evidence |
| `lore-design-ui` | Higher-fidelity prototype when the question is visual comprehension |
| Engineering spike (subagent, worktree) | Feasibility unknowns |
| `lore search` / support data / analytics | E1/E5 evidence already sitting in the corpus or product |

Run experiments **concurrently** where independent — dispatch one subagent per experiment.

⛔ **Report failed experiments alongside passing ones.** Cherry-picking evidence to support a conclusion already chosen is the single most damaging thing this mode can do, because it launders a guess into "validated". If three of five tests failed, the headline is that three failed.

## Output: the Validation Ledger

```markdown
## Validation Ledger — {opportunity or feature set}

**Problem score**: F4 × I4 × W5 × P3 = 240 → promising (weakest: WTP — 3 hypothetical, no observed spend)

| # | Solution | Risk | Experiment run | Result | Evidence tier | Verdict |
|---|----------|------|---------------|--------|--------------|---------|
| 1 | Guided first-run | Value | Fake door, 340 visitors | 18% click vs 5% kill line | E1 | ✅ validated |
| 1 | Guided first-run | Usability | Prototype, 5 users | 3/5 completed — below bar | E1 | ❌ refuted — redesign |
| 1 | Guided first-run | Feasibility | — | not run (no eng capacity) | — | ⚠️ unvalidated |
| 2 | Sample workspace | Value | Fake door, 340 visitors | 4% click | E1 | ❌ refuted — dropped |

**Carried into PRD**: R1 (value validated, usability rework required)
**Dropped**: Solution 2 — value refuted
**Entering PRD flagged `unvalidated`**: R1 feasibility
```

Every row is one of exactly three states — `✅ validated` (experiment ran, passed its stated bar), `❌ refuted` (experiment ran, failed), `⚠️ unvalidated` (not run). ⛔ There is no fourth state for "we reasoned about it and it seems fine."

## Handoff

| Next | Trigger | Contract |
|------|---------|----------|
| `/lore-product decompose` | Solution `✅ validated` on value + usability | Validated leaf → story map → requirements read off the map |
| `/lore-product opportunity` | Everything refuted | Back to the tree — the branch is dead, the outcome is not |
| `/lore-product prd` | Minimal PRD only (single existing step, low risk) | Ledger rows → requirements directly |

## Gate into PRD (HARD)

⛔ **Every P0 requirement carries a validation status.** A P0 requirement whose value risk is `⚠️ unvalidated` must be either (a) demoted below P0, (b) preceded by a validation task in the plan, or (c) explicitly accepted by the user as a bet, recorded with that word.

⛔ **Never silently upgrade `unvalidated` to validated** because the team likes the idea, the deadline is close, or the reasoning is compelling. That is the exact failure this gate exists to catch.

## Exit Criteria

- [ ] Problem scored on all four dimensions, every score citing evidence with a tier
- [ ] Assumption map built; the riskiest high-importance / no-evidence assumption tested first
- [ ] Each surviving solution assessed on all four risks
- [ ] Experiments actually executed, or explicitly marked not-run with the reason
- [ ] Failed experiments reported alongside passing ones
- [ ] Validation Ledger persisted to corpus and linked to its OST
- [ ] Every item entering the PRD tagged validated / refuted / unvalidated

## Persist (MANDATORY)

```bash
lore create knowledge --parent <spec or prd it concerns> --sub-type research --title '{feature} Validation Ledger' --fields-file f.yaml   # skeleton: lore template show knowledge --kind research --blank
lore link <ledger> <ost-doc> --type=implements
```

If an experiment refutes something the corpus already asserts:
```bash
lore invalidate <old-doc> --superseded-by <ledger> --reason "fake door 4% vs 15% assumed"
```

## Guidelines

- CRITICAL: NEVER validate from opinions, surveys, or reasoning alone. Require evidence of past or observed behavior.
- ALWAYS require workaround evidence — no workarounds means the pain is below the action threshold.
- NEVER count "I would definitely use that" as validation.
- ALWAYS talk to ≥5 people in the target segment before a go/no-go, and never only to fans.
- ALWAYS state the kill condition before running the experiment, never after seeing the data.
- NEVER deceive test users beyond what a valid result requires — a fake door is acceptable; collecting payment for a product that does not exist is not.

## Triggers

"Validate this", "test the assumption", "run an experiment", "is this worth building",
"验证一下", "这功能有人要吗", "先验证再做"
