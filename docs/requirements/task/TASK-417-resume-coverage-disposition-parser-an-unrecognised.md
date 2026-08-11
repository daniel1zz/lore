---
id: TASK-417
type: task
role: plan
title: "Resume-coverage disposition parser: an unrecognised token on a KNOWN item id is reported as an unmentioned item, and done rejects the trailing reason that deferred accepts"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

The resume-coverage disposition parser accepts `deferred:` with a trailing reason but
rejects `done` with one, and the rejection is reported as "item never mentioned" rather
than "disposition token not recognised". The two failures are indistinguishable to the
author, so the natural repair — re-emitting the same line — fails identically.

`packages/lore/src/adapters/cli/commands/handoff.ts:499-512`:

```ts
const colonIndex = rest.indexOf(":");
const itemId = rest.slice(0, colonIndex).trim();
const disposition = rest.slice(colonIndex + 1).trim();
const deferralReason = disposition.startsWith(RESUME_DISPOSITION_DEFERRED_PREFIX)
  ? disposition.slice(RESUME_DISPOSITION_DEFERRED_PREFIX.length).trim()
  : undefined;
const isAccepted =
  disposition === RESUME_DISPOSITION_DONE || (deferralReason !== undefined && deferralReason.length > 0);
if (itemId.length > 0 && isAccepted) dispositioned.add(itemId);
```

- `deferred:` is matched with `startsWith`, and everything after the prefix becomes the
  reason. `deferred:anything at all` is accepted.
- `done` is matched with `===`. Any trailing text makes the whole disposition unequal to
  `"done"`, so the line is skipped.

The asymmetry is invisible from the emitted instruction, which shows both tokens side by
side as if they parsed alike.

## Reproduced live, twice, in one session (2026-08-01)

A session emitted, for a real ticket item:

```
**[RESUME_DISPOSITION]** NS6: done——git branch -a shows only main, the named stale branch no longer exists
```

The em-dash follows `done` with no separator, so `disposition` was
`done——git branch -a shows only main…`, which `!== "done"`. The hook reported NS6 as
unaccounted. The session re-emitted the same shape and was rejected again. Sibling items
written as a bare `done` were accepted in the same message, which is what makes the
failure so misleading: the format demonstrably "works", so the author concludes the line
was dropped, not that it was parsed and discarded.

## Mechanism root

`isAccepted` collapses two distinct outcomes into one boolean:

1. this line does not concern a ticket item, and
2. this line names a ticket item but carries a token I do not recognise.

Only (1) justifies silence. Case (2) has all the information needed for a precise
diagnostic — the item id parsed fine — and throws it away. A parser that has already
identified the item and still reports "never mentioned" is asserting something it knows
to be false.

This is the silent-no-match family already catalogued in CLAUDE.md ("no match + exit 0 is
indistinguishable from passed"), in its read-side form: no match reported as an absence
that the author cannot tell from a genuine omission.

## Requirement

1. **A recognised item id with an unrecognised disposition MUST fail loud**, naming the
   item id, the verbatim token received, and the two accepted forms. It must NOT be
   reported as an unmentioned item.
2. **Decide the `done` trailing-text question explicitly** and record the reasoning.
   Either accept `done` with a trailing annotation (symmetric with `deferred:`), or keep
   the strict equality and let requirement 1 make the rejection legible. ⛔ Do not do both
   halves silently — if `done<separator><text>` becomes legal, the separator set is part
   of the exported grammar in `packages/core/src/session.ts` and must be stated there, not
   discovered by authors through rejection.
3. The grammar stays in `packages/core/src/session.ts` as its sole owner. ⛔ Do NOT
   reimplement any matching in `assets/hooks/stop-handoff-coverage.mjs` — that file is
   defined by holding no grammar (spec-resume-ticket-coverage-… D9, AC-RC-10 pins a
   zero-hit search over it for every exported grammar value).

## Oracle

- A line naming a real ticket item with an unrecognised disposition token produces a
  diagnostic containing that item id AND the received token. Assert on the token
  substring, not on a remembered phrase of the whole message.
- CONTROL, so the assertion cannot pass vacuously: a line that names NO ticket item and
  carries garbage still produces no diagnostic — silence is still correct for case (1).
- REGRESSION: a bare `done` and a `deferred:<reason>` are both still accepted, and a bare
  `deferred:` with an empty/whitespace-only reason is still REJECTED (S1, already
  covered — assert it is unchanged).
- BOUNDARY: the exact live failure — `done` immediately followed by a non-ASCII dash and
  a reason, no space — is covered by a named test case. ⛔ A fixture using `done ` plus a
  space does not reproduce this; the absence of a separator is the point.
- The em-dash case must be asserted with the literal character, not a normalised ASCII
  stand-in — an assertion rewritten to `done--reason` would pass against code that still
  mishandles the character that actually occurred.
