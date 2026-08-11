---
id: TASK-356
type: task
role: plan
title: "lore status --check-claude-md silently runs on SCHEMA DEFAULTS when the operator's context config fails to parse, so a configured budget is ignored with no message"
status: archived
priority: high
created: 2026-08-06
updated: 2026-08-07
tags: [defect, silent-fallback, claude-md, config, budget]
parent: PRD-001
links:
  - {id: TASK-358, type: relates-to}
---
# Defect — `lore status --check-claude-md` silently runs on SCHEMA DEFAULTS when the operator's `context` config fails to parse, so a configured budget can be ignored with no message

`resolveClaudeMdBudgets` (`packages/lore/src/adapters/cli/commands/status.ts:435-447`), verbatim as of `main @ 4d68c84a`:

```ts
function resolveClaudeMdBudgets(cwd: string): MemoryFileBudgets {
  const configResult = loadConfig(cwd);
  if (configResult.ok) return resolveMemoryFileBudgets(configResult.value);

  const { error } = configResult;
  if (error.code === "VALIDATION_ERROR" && typeof error.value === "object" && error.value !== null) {
    const contextCandidate = (error.value as Record<string, unknown>)["context"];
    const contextParse = contextConfigSchema.safeParse(contextCandidate);
    if (contextParse.success) return contextParse.data.memory_files;
  }

  return resolveMemoryFileBudgets(undefined);   // ← silent
}
```

Line 446 is the defect: when `.lore/config.yaml` fails to parse **and** its `context` sub-tree also fails to parse, the function returns schema defaults and **says nothing**. The check then runs, prints per-doc numbers, and exits 0 or 3 against thresholds the operator did not choose and cannot tell were substituted.

⛔ This is the repo's named forbidden pattern — a required value resolved by silent fallback instead of failing loud. Every other resolution path in this codebase either succeeds or returns a `Result` naming the failure.

## Why it is newly reachable, and therefore newly urgent

Merge `4d68c84a` armed `context.memory_files.evict_threshold_fraction` and made the pair ordered: a `warn_threshold_fraction` above the eviction floor is now an inverted pair and is **refused at parse time**. `warn: 1` was previously legal and is now impossible — correctly so, since it would warn only at 100%.

So there is now a concrete, realistic config an operator may already have on disk that (a) parsed fine before the merge and (b) after the merge fails to parse, taking the whole `context` sub-tree with it. That operator gets **default thresholds, silently**, on the exact command whose job is to enforce their thresholds. Reported by the implementer of that merge, who could not fix it: `status.ts` was held by a concurrent agent's anchor mutex.

## Mechanism root — a fallback where the caller cannot observe the substitution

The function's return type is `MemoryFileBudgets`, a plain value. It has no channel to say "these are not the ones you configured", so the silence is structural rather than an oversight in the code path. Any fix that keeps a plain-value return will reintroduce it the next time a config field is added.

# Required fix

1. **Fail loud, and decide WHICH kind of loud.** Two defensible shapes — pick one and record the reasoning in the JSDoc:
   - **Warn-and-proceed**: keep returning defaults but emit a stderr warning naming the parse error and the fact that defaults are in effect. Preserves the current exit-code contract exactly; the operator learns on the next run.
   - **Refuse**: return a `Result` and let `status` exit non-zero on an unparseable config, since a budget check against unknown budgets is not a measurement. Stronger, but changes the exit-code contract of a command wired into `hooks/pre-push`, so the blast radius must be enumerated first.
   ⛔ Whichever is chosen, `return resolveMemoryFileBudgets(undefined)` with no signal must not survive.
2. **Enumerate every consumer of the same resolution before changing behaviour.** `claude-md-check.ts::lintMemoryFiles` is the single admission seam, consumed by `lore status --check-claude-md`, `assets/hooks/claude-md-guard.sh`, `hooks/pre-push`, and `flows/context-flow.ts::runContextRefresh`. Check whether any of THEM resolves budgets by a parallel path with the same silent fallback — if the silence exists in two places, fixing one is the consumer-not-seam anti-pattern this repo has hit twice this week.
3. ⛔ **Do not "fix" this by making the config schema more permissive.** The ordered-pair refusal is correct; the defect is that its refusal is swallowed here.

# Oracle

- With a `.lore/config.yaml` whose `context` sub-tree is invalid (e.g. `warn_threshold_fraction: 1` against the armed eviction floor), the command emits a signal naming the substitution — assert two independent lone tokens — or exits non-zero, per the chosen shape.
- **CONTROL, both directions**: (a) a VALID config produces no such signal and the operator's thresholds are demonstrably in effect — assert a per-doc verdict that DIFFERS from the default-threshold verdict, so "the config was honoured" is proven rather than assumed; (b) an ABSENT config (the legitimate default case) is not treated as an error.
- **BOUNDARY**: config valid overall but `context` absent; config invalid in a NON-`context` sub-tree while `context` parses fine (the existing salvage path — assert it still salvages and stays silent, since nothing was substituted).
- REGRESSION: the exit codes for every currently-passing and currently-tripping doc are unchanged when the config is valid. Assert the per-doc byte numbers, never the summary line — the summary was green while the eviction-floor defect was live.
- `bun run typecheck` clean; `bun run test:changed <base>` with a NON-ZERO selection.
- Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "`lore status --check-claude-md` exited 0" is a proxy for "every memory file is within the operator's configured budget". Concrete input satisfying the proxy while violating the property: any corpus whose `context` config is unparseable and whose files are within DEFAULT budgets but outside the operator's stricter ones. The fix removes the proxy by making the substitution observable.

**Silence.** Total, and it is the second-order kind: the silenced thing is a REFUSAL that a different mechanism correctly raised. A gate's denial swallowed by its own caller is worse than a gate that never fired, because the operator has positive evidence (exit 0) that everything is fine.

**Opt-in.** None, and none may be added. ⛔ A `--strict-config` flag would leave the default read exactly as misleading as it is today.
