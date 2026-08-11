---
id: KN-209
type: knowledge
role: knowledge
title: "A handoff KD that counts un-persisted artifacts loses them; and a wrong --json path makes a successful write look failed, so the retry duplicates it"
status: approved
priority: medium
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Two defects measured while resuming a handoff, 2026-08-03

Both were found by a session doing nothing more exotic than consuming a resume ticket and
creating one task. Neither is caught by any existing lore invariant.

## 1. A handoff KD can record a SYMPTOM COUNT and lose the content it counted

`knowledge-handoff-agent-main-orchestrator-74` KD6 reads, verbatim:

> CLAUDE.md byte budget is SATURATED — root 34 bytes free, service/ 42. **Two real
> invariants could not be written this session.** Needs a governance decision: structural
> trim, or declare core command behaviour corpus-only

The governance decision was answerable and got answered (structural trim, executed:
`d70abf6`, 834 bytes recovered). **The two invariants themselves are unrecoverable.**
Measured on resume:

    lore list --type knowledge  →  today's only knowledge doc is handoff-74 itself
    (the preceding session wrote no retro; the invariant text existed only in its context)

The handoff faithfully recorded that content was blocked, and simultaneously became the
reason that content is gone: the ticket is what survives a session, so anything the ticket
only COUNTS instead of CARRYING dies with the context that produced it.

**Mechanism root.** A handoff KD is free-text with no obligation to be self-contained. A KD
naming a quantity of un-persisted artifacts ("two invariants could not be written", "three
sites left unswept", "one AC unrepaired") is a DANGLING REFERENCE — it points at content in
a store that is about to be destroyed. Nothing in `lore handoff` distinguishes that from a
KD whose content is fully present.

**Candidate mechanization (not built, deliberately named rather than assumed):** a handoff
predicate that flags a KD/NS matching a bare-quantity-of-artifacts shape (a numeral or
`one|two|three…` immediately governing a countable authored noun) and requires either the
content inline or a resolvable slug. This is a proxy over prose and will misfire; the
Proxy question must be answered before it is built. The alternative — CLAUDE.md prose
telling authors to inline the content — is explicitly NOT a mechanism
(`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`).

**Standing consequence, usable today with no tooling:** an invariant blocked from its
intended home is not "pending", it is UNWRITTEN. Persist the text into the corpus at the
moment it is blocked — the blockage is the trigger to write it somewhere, never a licence
to defer writing it at all.

## 2. `lore <cmd> --json` read through a WRONG jq path is indistinguishable from failure — and the retry duplicates the write

Measured directly. `lore create task --adhoc --json … | jq -r 'if .ok then .data.doc.slug …'`
printed ` | ` (empty). Read as "create failed". It had SUCCEEDED. The re-run created a
second doc, `…-isplanmember-survive-2`, which then had to be soft-deleted.

The envelope is `{ ok, data }` and `data` is shaped per command — `lore get` nests
`.data.doc`, and the create path does not put `slug` where the guessed expression looked.
jq's default for a missing path is `null`, `-r` renders `null` as empty, and the pipeline
exits 0. So:

    wrong-path read of a SUCCESSFUL write   →   empty output, exit 0
    a genuinely FAILED write                →   empty output, exit 0

Same observable. The two are not distinguishable at the call site, and the natural response
to the ambiguity — run it again — is precisely the destructive one for a create.

**This is the no-match/exit-0 family** (root CLAUDE.md, *Contiguous-substring assumption*)
appearing on a new surface: not a test filter or a grep matcher, but **the read-back that
confirms one's own write**. The earlier instances were all about failing to MEASURE
something; this one silently inverts the verdict on a MUTATION and then compounds it.

**Standing lesson.** Never let a `--json` projection be the sole evidence that a write
landed. Either run the command bare (its human output names the slug and the exit code) or
assert the RESULTING STATE by an independent query (`lore search` / `lore list` for the
title) before concluding anything. `⛔ For a create, assume success until an independent
query says otherwise` — the failure mode of a wrong retry is a duplicate doc, which is
strictly worse than a missed one.

**Why no CLAUDE.md line was added:** the *Contiguous-substring assumption* entry already
states the category ("no match + exit 0 is indistinguishable from passed"). Adding a second
entry for a fresh instance of a catalogued category is the bloat pattern that
`adr-claude-md-specs-section-is-pointer-only-per-spec-index` was written against, and this
same session had just recovered 834 bytes by compressing four over-long entries. The
instance belongs here; the category is already there.
