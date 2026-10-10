# <One verb, in business language>

> One sentence describing this leaf. It names a single verb; if it needs "and" or "or", split the leaf.

## Behaviour

**Command**: who triggers this, with what.
**Constraint**: the business rule that governs it (each constraint becomes a rule below).
**Domain event**: what has happened, past tense.

## Rules

Rules are not written in this document. Add each one with:

```
lore rule add <this-leaf-slug> --statement "<one sentence, business language, no implementation>" \
  --confidence established|observed|unconfirmed|undecided \
  --enforced-by guaranteed|both|prompt-only \
  --example "<boundary example>" --example "<second example>"
```

State thresholds with their side ("30 days inclusive") and rounding ("round down to the cent").
If two rules can both fire and the outcome differs, say which wins and why in a line here.

## Depends on

Rules of other leaves this leaf's rules rely on: `lore baseline depends <this-leaf-slug> --add BR-n`.

## Open questions

One line per `undecided` / `unconfirmed` rule: the rule id, the question, the owner, and which kind it is.
