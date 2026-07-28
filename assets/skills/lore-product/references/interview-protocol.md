# Interview Protocol

**Purpose**: The instrument that produces E1-E4 evidence. Every other product mode *demands* observed behavior, spend, workarounds, and past-behavior quotes — this file is how you actually obtain them from a human being.

> Method basis: Rob Fitzpatrick's *The Mom Test*, Eric Migicovsky's Five Questions (YC), Gustaf Alstromer's follow-up framework, Teresa Torres's story-based interviewing, Bob Moesta's causal-trigger method. Tiers referenced here are the Evidence Ladder in [mode-validate.md](mode-validate.md) — this file feeds that ladder, it does not redefine it.

## Why this file exists

`mode-opportunity` requires ≥2 independent evidenced sources per opportunity. `mode-validate` requires a tier on every score. Neither ships a way to get one. An instrument-free evidence requirement does not produce evidence — it produces **fabricated evidence**, because inventing a plausible quote is cheaper than scheduling a call. This file removes that excuse.

## The three core rules

Each rule exists because of a specific failure, not as etiquette.

| Rule | Failure it prevents |
|------|--------------------|
| **Talk about their life, not your idea.** The interview is a fact-finding trip into how they work today. Your product does not appear until the last two minutes, if at all. | The moment you describe the idea, the subject switches from *reporter* to *reviewer*. Reviews are opinions about a hypothetical, which is E6. You cannot un-ring that bell mid-interview. |
| **Ask about the past, not the future.** "Tell me about the last time…" never "would you…". | People are bad at predicting their own behavior and good at being polite. Future-tense answers are E6 by construction, no matter how emphatic. Past-tense answers are recoverable facts — E4, and they point at the E1/E2/E3 artifacts you can go look at. |
| **Ask for specifics, not generalities.** "Always", "often", "everyone" are unanchored — pin every one to a date, a name, a number, a file. | Generalities cannot be scored. `Frequency × Intensity × Workarounds × WTP` needs a countable frequency and an actual workaround; "it's a constant pain" scores nothing and silently becomes an invented 3. |

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "I understand the domain well enough to write what a user would say" | A synthesized quote is your prior wearing a user's voice. It corroborates only itself, and it will pass every downstream gate because it looks exactly like real evidence. That is precisely what makes it the worst artifact this skill can emit. |
> | "The user is the target user, so interviewing them covers it" | They are one source, and a maximally warm one. They are also the person whose idea is being tested. Their data counts, discounted — it is not a segment. |
> | "Nobody is reachable, so I'll approximate the interview" | Unreachable users mean the honest output is `⚠️ unvalidated` plus a recruiting task. Approximation converts "we don't know" into "we checked", which is strictly worse than knowing nothing. |
> | "The questions are obvious, I'll improvise the guide" | Improvised questions default to the leading form, because the leading form is what the model already believes. The script exists to survive your own priors. |
> | "They said they'd definitely pay, that's basically E2" | E2 is money that left their account. "Would pay" is E6 and stays E6 no matter who said it or how confident they sounded. |

## Bad question → good question

The bad column is not merely weaker. It yields a different, near-worthless tier.

| ❌ Bad | Tier it yields | ✅ Good | Tier it yields |
|---|---|---|---|
| "Would you use a tool that does X?" | E6 — hypothetical | "Walk me through how you did X the last time." | E4, and names the artifacts to ask for |
| "How much would you pay for this?" | E6 — imagined budget | "What have you already spent trying to fix this — tools, contractors, anything?" | E2 if money moved |
| "Don't you think X is a problem?" | E6 — you supplied the answer | "What was the hardest part of X last week?" | E4 |
| "Would this feature be useful?" | E6 — politeness | "Can you show me your current workflow? Screen-share it." | E1 — you observe it |
| "Do you like this idea?" | E6 — compliment | "What have you tried so far, and why did you stop?" | E4 + E3 |
| "Is this a pain point for you?" | E6 — yes/no with a socially correct answer | "How many times did this come up in the last month?" | E4, countable → scoreable |
| "What features do you want?" | E6 — a wish list, plus it moves you into solution space | "What happens today if you just do nothing about it?" | E4 — reveals real intensity |
| "Would you switch from your current tool?" | E6 | "What made you start looking, the last time you switched anything?" | E4 — the causal trigger |

⛔ **Any question answerable with "yes" or "sure" is a compliment generator.** Rewrite it until the only possible answer is a story.

## The 30-minute script

Say these sentences. They are calibrated; paraphrasing reintroduces the leading form.

**Opening — 2 min.**
> "Thanks for the time. I'm trying to understand how people actually handle {domain} today. I'm not selling anything and there are no right answers — if it turns out this is a non-issue for you, that's a useful result for me. Mind if I take notes?"

⛔ Do not state a hypothesis here. "We think X is painful" pre-loads every subsequent answer.

**The Five Questions — 15 min.** Ask in order; each digs one layer past the last.
> 1. "What's the hardest part about {doing the thing}?"
> 2. "Tell me about the last time that happened." — *then stop talking. Let the silence do the work.*
> 3. "Why was that hard?" — *ask it up to three times; the first answer is always the surface.*
> 4. "What, if anything, have you done to try to solve it?"
> 5. "What don't you love about the things you've tried?"

**Signal probes — 8 min.** These are what convert the story into a scoreable row.
> - "How often does this come up — was last week typical?" → Frequency
> - "Can you show me how you handle it today?" → Workarounds, and E1 if they share the screen
> - "Have you ever paid for anything to deal with this? What happened to it?" → WTP, E2
> - "What did this cost you the last time — hours, money, a missed deadline?" → Intensity

Watch for the energy shift: sighing, speeding up, unprompted storytelling. That is where the real pain is. Note it — it is a signal about *which* thread to pull, not evidence on its own.

**Closing — 3 min.** The closing is not a farewell, it is the ask. See the ladder below.
> - "Who else deals with this that I should talk to? Would you introduce me?"
> - "Is there anything I should have asked but didn't?"
> - *Then the specific ask you prepared, from the highest currency you think is reachable.*

## Commitment currencies — the ask is what makes it evidence

A pleasant conversation produces at most E4. **The ask at the end is the conversion step**: it charges them something real, and what they are willing to pay is the measurement. Ordered weakest to strongest.

| Currency | The ask, said out loud | Tier it produces |
|---|---|---|
| **Time** | They showed up. No ask needed. | None on its own — everyone is polite. The transcript is E4 at best |
| **Reputation** | "Would you introduce me to two people on your team who deal with this?" | Confirms the E4 is not politeness. A refused intro downgrades everything they said |
| **Access** | "Can you send me the spreadsheet you use? Can I watch you do it Thursday?" | **E3** (the workaround artifact), **E1** if you observe the session |
| **Money** | "We're running a paid pilot at {price} — can I put you down?" | **E2** — the only tier that survives every discount |
| **Behavior change** | "Here's the prototype. Use it for your next real {task} and tell me what broke." | **E1** — strongest available pre-launch |

⛔ **"Sounds great, keep me posted" is a declined ask, not a soft yes.** Log it as such. An interview that ended with no ask made produced no commitment data at all — record that gap rather than reading enthusiasm into the silence.

## Anti-patterns

| Anti-pattern | Why it destroys the result |
|---|---|
| **Leading questions** | You supplied the answer; the subject only chose whether to agree. Records your prior, tagged as their evidence |
| **Pitching during discovery** | Ends learning at that timestamp. Everything after is feedback on your pitch, not data on their life |
| **Only fans and warm contacts** | They are optimizing for your feelings. Discounted per [mode-validate.md](mode-validate.md), and a set that is *entirely* warm cannot reach a go/no-go at any count |
| **Hypotheticals** | E6 in, E6 out. Includes the magic-wand question — usable to frame the ideal outcome, never as evidence |
| **Averaging across segments** | Two segments' contradictory answers average into a persona nobody is. Segment first, then look for patterns *within* a segment |
| **Accepting compliments as signal** | Compliments are the fee people pay to end a conversation politely. Deflect on the spot: "Thanks — but tell me how you handle it today." |
| **Stopping at the feature request** | A request is their guess at a solution. Push back to the need: "What would that let you do that you can't do now?" |
| **Talking more than 20% of the time** | If you are talking, you are not collecting. Track it |

## Recording the output

Log during or immediately after the session — memory degrades within the hour and degrades *toward your hypothesis*.

Per interview: participant ID + segment + warm/cold + date. Per finding, one row:

```markdown
| # | Finding (their words) | Verbatim quote | Tier | Artifact obtained | Commitment given |
|---|----------------------|----------------|------|-------------------|------------------|
| 1 | Rebuilds the export by hand every Monday | "I've got a macro I wrote in 2022 that I re-run every Monday morning." | E3 | macro file received | Access |
| 2 | Pays for a tool that half-solves it | "We're on the $40 Zapier plan basically just for this." | E2 | invoice screenshot | Access |
| 3 | Says a scheduler would be great | "Honestly I'd use that in a second." | E6 | — | declined pilot |
```

⛔ **A finding with no verbatim quote is not a finding, it is your summary.** Paraphrase loses the user's own vocabulary, which is the raw material `mode-opportunity` needs to state needs in the user's terms.

⛔ **≥5 people in the target segment before any go/no-go**, and never only fans — same bar as [mode-validate.md](mode-validate.md). Warm sources carry the one-full-tier discount defined there; apply it in the `Tier` column at logging time, not later. Stop when new interviews stop producing new findings — typically 5-8 for a focused problem space, with sharply diminishing returns past ~14.

## Synthesis → opportunity candidates

Interviews do not hand you opportunities. Converting them is a deliberate step, and it is where feature requests smuggle themselves in.

1. **Extract needs, not features.** Every row becomes a phrase in the user's terms, containing no product noun. "I lose my place when I come back the next day" — not "add a resume banner". Run the solution-in-disguise detector in [mode-opportunity.md](mode-opportunity.md) on each one before promoting it.
2. **Cluster by underlying need, not by the words used.** Two people describing "search is bad" and "I can't find last quarter's file" may be one need or two — the deciding question is whether the same change satisfies both.
3. **⛔ A pattern needs ≥3 independent sources before it becomes an opportunity.** Independent means different people, different orgs, and not referred by each other — a chain of three referrals from one champion is one source. Below 3, it stays a hypothesis and goes into the research backlog, not into the tree.
4. **Carry the tier forward.** A cluster's strength is the strength of its *best-evidenced* member plus its source count. A cluster of three E6 rows is still E6 and enters `mode-opportunity` marked `⚠️ unevidenced`.
5. **Report the disconfirming interviews.** Subjects for whom the problem was a non-issue are the highest-value rows you have — they define the segment boundary. Dropping them is how a niche pain gets sized as a market.

## When the user cannot reach real users

Sometimes there is genuinely no access. Some substitutes are legitimate; one is not.

| Substitute | Tier ceiling | Notes |
|---|---|---|
| Support tickets, sales-call notes, churn reasons | **E5**, E1 where the ticket contains a reproduction | Already in the org. Check `lore search` first |
| Product analytics, funnel drop-off, session recordings | **E1** | The strongest source that needs no interview — recordings are observed behavior |
| Public forum complaints (Reddit, HN, Discord, issue trackers) | **E5** | Specific and dated posts only; upvote counts are not frequency data |
| Competitor review mining (G2, Capterra, app stores) via `agent-browser` | **E5** | Mine 1-2★ reviews for the workaround and the trigger, not the star rating |
| Internal proxies — sales, support, CS staff | **E5**, discounted | They are reporting hearsay and carry their own agenda. Bridge only; never the go/no-go basis |

⛔ **Inventing a persona and interviewing yourself is not on this list.** A simulated interview produces **E6 at absolute best** — it is the model's prior, restated in dialogue form, and it corroborates nothing because both the question and the answer came from the same place. If you do it as a thinking aid, every resulting row MUST be labelled `E6 · simulated` and MUST NOT be counted toward the ≥2-source opportunity gate or the ≥3-source pattern rule.

⛔ **Zero real sources means the honest output is `⚠️ unvalidated` plus a recruiting task** — not a thinner interview. Say which segment you could not reach and what it would take to reach them.

## Triggers

"Interview users", "talk to customers", "discovery interview", "interview guide", "Mom Test", "customer development", "how do I ask users about this",
"用户访谈", "怎么问用户", "访谈提纲", "去跟用户聊", "客户调研"
