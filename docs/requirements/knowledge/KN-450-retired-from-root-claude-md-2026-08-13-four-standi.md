---
id: KN-450
type: knowledge
role: knowledge
title: "Retired from root CLAUDE.md 2026-08-13: four standing lessons evicted verbatim to free bytes for a correction"
status: approved
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
---
Verbatim text of three standing lessons evicted from the root `CLAUDE.md` on
2026-08-13 to free bytes under its `max_bytes` ceiling (the guard refused a
one-line correction with 10 bytes of headroom, which is what forced the
eviction). Nothing here is retracted — each remains in force. They were chosen
because each is narrow and self-contained: two describe surfaces outside this
repo's own source, and one is a meta-process rule with no live oracle.

## 1. subagent-stop-commit-guard's known harness-timing gap

> `subagent-stop-commit-guard.mjs` has one known harness-timing gap — probed
> sound, do NOT "fix" it.

Standing force: the gap was probed and found sound. A future session that
rediscovers it should read this line before "fixing" a non-defect.

## 2. mode-$0.md skills validate the mode before reading

> `mode-$0.md` skills validate the mode against the known set BEFORE any `Read`.

Standing force: applies to skill authoring, not to this repo's binary. A skill
that `Read`s a mode file named by unvalidated input turns a typo into a file-not
-found stack rather than a usage error.

## 3. Escalation is not a build order

> Escalation ≠ build: a twice-recommended mechanization triggers a VERIFICATION
> pass first.

Standing force: when the same mechanization is recommended by two independent
passes, the correct next step is to VERIFY the recommendation still holds
against current code — not to start building. A recommendation repeated by two
judges reading the same stale context is one observation, not two.

## 4. Checklists are a floor, not a ceiling

> Checklists are a floor, not a ceiling — also ask what uncatalogued problem
> this session has.

Standing force: a session that satisfies every catalogued check has proven only
that the catalogue is satisfied. The uncatalogued problem is the one worth
finding, and by construction no checklist will prompt for it. This session's
own instance: nothing in any checklist asks "did repairing a defect break a
test that depended on the defect".
